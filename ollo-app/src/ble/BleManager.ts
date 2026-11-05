import { Capacitor } from '@capacitor/core';
import { isTauri } from '@tauri-apps/api/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import type { Card, StoredImage } from '../types';
import {
  DEVICE_NAME,
  FLAG_CHUNKED_TEXT,
  NOTIFY_UUID,
  SERVICE_UUID,
  WRITE_UUID,
  cardFitsLegacy,
  makeCardPacket,
  makeChunkedCard,
  makeImageBeginPacket,
  parseDeviceInfo,
  parseStorage,
  u16,
  u32,
  type DeviceInfo,
  type StorageInfo
} from './protocol';

const SAVED_DEVICE_KEY = 'ollo.savedBleDevice';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';
type StatusListener = (state: ConnectionState, message: string) => void;
type InfoListener = (info: DeviceInfo | undefined, storage: StorageInfo | undefined) => void;
type ProgressListener = (done: number, total: number, label: string) => void;

type TauriBlec = typeof import('@mnlphlp/plugin-blec');
type PendingStatus = { resolve: (status: number) => void; reject: (error: Error) => void; timer: number };

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// The plugin's startScan() returns immediately and scans in the background,
// so we must wait here before calling stopScan().
async function waitFor(done: () => boolean, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!done() && Date.now() < end) await sleep(150);
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

class OllOBleManager {
  private initialized = false;
  private tauriApi?: TauriBlec;
  private connectedDeviceId?: string;
  private connectionState: ConnectionState = 'disconnected';
  private stateListeners = new Set<StatusListener>();
  private infoListeners = new Set<InfoListener>();
  private progressListeners = new Set<ProgressListener>();
  private pending = new Map<number, PendingStatus[]>();
  private currentInfo?: DeviceInfo;
  private currentStorage?: StorageInfo;

  get state(): ConnectionState { return this.connectionState; }
  get deviceId(): string | undefined { return this.connectedDeviceId; }
  get info(): DeviceInfo | undefined { return this.currentInfo; }
  get storage(): StorageInfo | undefined { return this.currentStorage; }

  onState(listener: StatusListener): () => void { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onInfo(listener: InfoListener): () => void { this.infoListeners.add(listener); return () => this.infoListeners.delete(listener); }
  onProgress(listener: ProgressListener): () => void { this.progressListeners.add(listener); return () => this.progressListeners.delete(listener); }

  private setState(state: ConnectionState, message: string): void {
    this.connectionState = state;
    for (const listener of this.stateListeners) listener(state, message);
  }

  private emitProgress(done: number, total: number, label: string): void {
    for (const listener of this.progressListeners) listener(done, total, label);
  }

  private emitInfo(): void {
    for (const listener of this.infoListeners) listener(this.currentInfo, this.currentStorage);
  }

  private isTauriDesktop(): boolean {
    return isTauri();
  }

  private async getTauriApi(): Promise<TauriBlec> {
    if (!this.tauriApi) this.tauriApi = await import('@mnlphlp/plugin-blec');
    return this.tauriApi;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.isTauriDesktop()) {
      const api = await this.getTauriApi();
      // On desktop this is a no-op permission check; on mobile Tauri it requests
      // Bluetooth permissions. Our production mobile shells are Capacitor.
      await api.checkPermissions(true);
    } else {
      await BleClient.initialize({ androidNeverForLocation: true });
    }
    this.initialized = true;
  }

  async autoReconnect(): Promise<boolean> {
    const savedId = localStorage.getItem(SAVED_DEVICE_KEY);
    if (!savedId || this.connectionState === 'connected' || this.connectionState === 'connecting') return false;
    try {
      await this.initialize();
      if (this.isTauriDesktop()) {
        // btleplug on Windows discovers peripherals through its scan cache.
        // Scan briefly for the previously selected address before reconnecting.
        const api = await this.getTauriApi();
        let foundAddress: string | undefined;
        await api.startScan((devices) => {
          const match = devices.find((device) => device.address.toLowerCase() === savedId.toLowerCase());
          if (match) foundAddress = match.address;
        }, 5000);
        await waitFor(() => foundAddress !== undefined, 5000);
        try { await api.stopScan(); } catch { /* scan may already have stopped */ }
        if (!foundAddress) return false;
        await this.connectById(foundAddress);
      } else {
        const platform = Capacitor.getPlatform();
        if (platform !== 'android') {
          const knownDevices = await BleClient.getDevices([savedId]);
          if (!knownDevices.some((device) => device.deviceId === savedId)) return false;
        }
        await this.connectById(savedId);
      }
      return true;
    } catch (error) {
      this.setState('disconnected', this.errorMessage(error));
      return false;
    }
  }

  async pairAndConnect(): Promise<void> {
    await this.initialize();
    this.setState('connecting', 'Looking for OllO glasses…');
    try {
      if (this.isTauriDesktop()) {
        const api = await this.getTauriApi();
        let candidate: { address: string; rssi: number } | undefined;
        const seen = new Map<string, string>();
        await api.startScan((devices) => {
          for (const device of devices) {
            seen.set(device.address, device.name || '(no name)');
            const hasService = device.services.some((service) => service.toLowerCase() === SERVICE_UUID);
            const hasName = (device.name || '').toLowerCase().includes(DEVICE_NAME.toLowerCase());
            if ((hasService || hasName) && (!candidate || device.rssi > candidate.rssi)) {
              candidate = { address: device.address, rssi: device.rssi };
            }
          }
        }, 15000);
        await waitFor(() => candidate !== undefined, 15000);
        try { await api.stopScan(); } catch { /* scan may already have stopped */ }
        if (!candidate) {
          const names = [...seen.values()].slice(0, 6).join(', ');
          throw new Error(`No OllO glasses found. Scan saw ${seen.size} Bluetooth device(s)${names ? `: ${names}` : ''}.`);
        }
        localStorage.setItem(SAVED_DEVICE_KEY, candidate.address);
        await this.connectById(candidate.address);
      } else {
        const device = await BleClient.requestDevice({ services: [SERVICE_UUID] });
        localStorage.setItem(SAVED_DEVICE_KEY, device.deviceId);
        await this.connectById(device.deviceId);
      }
    } catch (error) {
      this.setState('disconnected', this.errorMessage(error));
      throw error;
    }
  }

  private async connectById(deviceId: string): Promise<void> {
    this.setState('connecting', 'Connecting to OllO…');
    try {
      if (this.isTauriDesktop()) {
        const api = await this.getTauriApi();
        await api.connect(deviceId, () => {
          this.connectedDeviceId = undefined;
          this.rejectAllPending(new Error('The glasses disconnected.'));
          this.setState('disconnected', 'Glasses disconnected');
        });
        this.connectedDeviceId = deviceId;
        await api.subscribe(NOTIFY_UUID, SERVICE_UUID, (data) => {
          const bytes = Uint8Array.from(data);
          this.handleNotification(new DataView(bytes.buffer));
        });
      } else {
        await BleClient.connect(deviceId, () => {
          this.connectedDeviceId = undefined;
          this.rejectAllPending(new Error('The glasses disconnected.'));
          this.setState('disconnected', 'Glasses disconnected');
        });
        this.connectedDeviceId = deviceId;
        await BleClient.startNotifications(deviceId, SERVICE_UUID, NOTIFY_UUID, (value) => this.handleNotification(value));
      }
      this.setState('connected', `${DEVICE_NAME} connected`);
      await this.requestInfo();
      await this.requestStorage();
    } catch (error) {
      this.connectedDeviceId = undefined;
      this.setState('disconnected', this.errorMessage(error));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const id = this.connectedDeviceId;
    if (!id) return;
    try {
      if (this.isTauriDesktop()) {
        const api = await this.getTauriApi();
        await api.disconnect();
      } else {
        try { await BleClient.stopNotifications(id, SERVICE_UUID, NOTIFY_UUID); } catch { /* already disconnected */ }
        await BleClient.disconnect(id);
      }
    } finally {
      this.connectedDeviceId = undefined;
      this.rejectAllPending(new Error('Disconnected by user.'));
      this.setState('disconnected', 'Disconnected');
    }
  }

  forgetDevice(): void { localStorage.removeItem(SAVED_DEVICE_KEY); }

  private async write(bytes: Uint8Array): Promise<void> {
    if (!this.connectedDeviceId) throw new Error('OllO glasses are not connected.');
    if (this.isTauriDesktop()) {
      const api = await this.getTauriApi();
      await api.send(WRITE_UUID, Array.from(bytes), 'withoutResponse', SERVICE_UUID);
    } else {
      await BleClient.writeWithoutResponse(this.connectedDeviceId, SERVICE_UUID, WRITE_UUID, dataView(bytes));
    }
  }

  private waitForStatus(refType: number, timeoutMs = 8000): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const list = this.pending.get(refType) ?? [];
        this.pending.set(refType, list.filter((entry) => entry.timer !== timer));
        reject(new Error(`Timed out waiting for device response (0x${refType.toString(16)}).`));
      }, timeoutMs);
      const entry = { resolve, reject, timer };
      const list = this.pending.get(refType) ?? [];
      list.push(entry);
      this.pending.set(refType, list);
    });
  }

  private resolveStatus(refType: number, status: number): void {
    const list = this.pending.get(refType);
    const entry = list?.shift();
    if (!entry) return;
    window.clearTimeout(entry.timer);
    if (list?.length === 0) this.pending.delete(refType);
    entry.resolve(status);
  }

  private rejectAllPending(error: Error): void {
    for (const entries of this.pending.values()) {
      for (const entry of entries) {
        window.clearTimeout(entry.timer);
        entry.reject(error);
      }
    }
    this.pending.clear();
  }

  private handleNotification(value: DataView): void {
    if (value.byteLength < 1) return;
    const type = value.getUint8(0);
    if (type === 0x80 && value.byteLength >= 3) {
      this.resolveStatus(value.getUint8(1), value.getUint8(2));
      return;
    }
    if (type === 0x81) {
      this.currentStorage = parseStorage(value);
      this.emitInfo();
      return;
    }
    if (type === 0x82) {
      this.currentInfo = parseDeviceInfo(value);
      this.emitInfo();
    }
  }

  async requestInfo(): Promise<void> { await this.write(new Uint8Array([0x08])); }
  async requestStorage(): Promise<void> { await this.write(new Uint8Array([0x07])); }

  private async sendExpectStatus(packet: Uint8Array, refType: number, accepted: number[] = [0]): Promise<number> {
    const response = this.waitForStatus(refType);
    try {
      await this.write(packet);
    } catch (error) {
      this.rejectStatusWaiter(refType, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    const status = await response;
    if (!accepted.includes(status)) throw new Error(this.statusDescription(refType, status));
    return status;
  }

  private rejectStatusWaiter(refType: number, error: Error): void {
    const entry = this.pending.get(refType)?.shift();
    if (!entry) return;
    window.clearTimeout(entry.timer);
    entry.reject(error);
  }

  private statusDescription(type: number, status: number): string {
    if (type === 0x03 && status === 2) return 'This image is already stored on the glasses.';
    if (status === 3) return 'The glasses do not have enough storage or could not write to flash.';
    if (status === 2) return 'The device reported a conflict.';
    if (status === 1) return 'The glasses rejected the data packet. Check text and image limits.';
    return `OllO returned error ${status} for command 0x${type.toString(16)}.`;
  }

  private async imageChunkSize(): Promise<number> {
    if (!this.connectedDeviceId) throw new Error('OllO glasses are not connected.');
    if (!this.isTauriDesktop() && Capacitor.getPlatform() === 'web') return 15; // Fits the default ATT MTU of 23 bytes.
    try {
      const mtu = this.isTauriDesktop()
        ? await (await this.getTauriApi()).getMtu()
        : await BleClient.getMtu(this.connectedDeviceId);
      return Math.max(15, Math.min(mtu - 8, 506));
    } catch {
      return 15;
    }
  }

  /**
   * Sends one card as CARD_BEGIN + CARD_TEXT pieces + CARD_END. Only CARD_END is answered, after the
   * glasses have checked the lengths and checksum. Status 1 means a piece was missing or damaged,
   * so the whole card is simply sent again (up to 3 tries).
   */
  private async sendChunkedCard(card: Card, index: number, textChunk: number): Promise<void> {
    const packets = makeChunkedCard(card, index, textChunk);
    for (let attempt = 1; ; attempt++) {
      const response = this.waitForStatus(0x02);
      void response.catch(() => undefined);
      try {
        await this.write(packets.begin);
        for (const text of packets.texts) await this.write(text);
        await this.write(packets.end);
      } catch (error) {
        this.rejectStatusWaiter(0x02, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
      const status = await response;
      if (status === 0) return;
      if (status !== 1 || attempt >= 3) throw new Error(this.statusDescription(0x02, status));
      await sleep(50);
    }
  }

  async synchronize(cards: Card[], images: StoredImage[]): Promise<void> {
    if (!this.connectedDeviceId) throw new Error('Connect to OllO before synchronizing.');
    if (cards.length > 65535) throw new Error('The current glasses protocol supports up to 65,535 cards.');
    const uniqueImageIds = new Set<number>();
    for (const card of cards) {
      if (card.frontImageId) uniqueImageIds.add(card.frontImageId);
      if (card.backImageId) uniqueImageIds.add(card.backImageId);
    }
    const imagesById = new Map(images.map((image) => [image.id, image]));
    const syncImages = [...uniqueImageIds].map((id) => {
      const image = imagesById.get(id);
      if (!image) throw new Error(`Image ${id} is missing from local storage. Re-add it before syncing.`);
      return image;
    });

    // Find out what this firmware supports before touching anything on the glasses.
    if (!this.currentInfo) {
      try { await this.requestInfo(); await sleep(500); } catch { /* very old firmware */ }
    }
    const chunkedText = ((this.currentInfo?.flags ?? 0) & FLAG_CHUNKED_TEXT) !== 0;
    if (!chunkedText) {
      const tooLong = cards.findIndex((card) => !cardFitsLegacy(card));
      if (tooLong >= 0) {
        throw new Error(`Card ${tooLong + 1} has more text than this glasses firmware can receive. Update the ESP32 firmware, or shorten the card to about 200 bytes.`);
      }
    }
    const chunkSize = await this.imageChunkSize();
    const textChunk = Math.max(8, chunkSize - 1);

    const totalSteps = 1 + cards.length + syncImages.length + 1;
    let done = 0;
    this.emitProgress(done, totalSteps, 'Preparing synchronization');
    try {
      await this.sendExpectStatus(new Uint8Array([0x01, ...u16(cards.length)]), 0x01);
      done++;
      this.emitProgress(done, totalSteps, 'Sending flashcards');

      for (let index = 0; index < cards.length; index++) {
        if (chunkedText) await this.sendChunkedCard(cards[index], index, textChunk);
        else await this.sendExpectStatus(makeCardPacket(cards[index], index), 0x02);
        done++;
        this.emitProgress(done, totalSteps, `Sending card ${index + 1} of ${cards.length}`);
      }

      for (let imageIndex = 0; imageIndex < syncImages.length; imageIndex++) {
        const image = syncImages[imageIndex];
        this.emitProgress(done, totalSteps, `Preparing image ${imageIndex + 1} of ${syncImages.length}`);
        const bytes = new Uint8Array(image.bytes);
        for (let attempt = 1; ; attempt++) {
          const beginResponse = this.waitForStatus(0x03);
          await this.write(makeImageBeginPacket(image));
          const beginStatus = await beginResponse;
          if (beginStatus === 2) break; // already stored on the glasses
          if (beginStatus !== 0) throw new Error(this.statusDescription(0x03, beginStatus));
          let checksum = 0;
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
            for (const byte of chunk) checksum = (checksum + byte) & 0xff;
            await this.write(new Uint8Array([0x04, ...u32(offset), ...chunk]));
            if (chunkSize <= 15 && offset % (chunkSize * 16) === 0) await sleep(3);
          }
          // Status 1 = the glasses saw a missing or damaged piece: send this image again (up to 3 tries).
          const endStatus = await this.sendExpectStatus(new Uint8Array([0x05, checksum]), 0x05, [0, 1]);
          if (endStatus === 0) break;
          if (attempt >= 3) throw new Error(this.statusDescription(0x05, endStatus));
          this.emitProgress(done, totalSteps, `Resending image ${imageIndex + 1} (attempt ${attempt + 1})`);
        }
        done++;
        this.emitProgress(done, totalSteps, `Transferred image ${imageIndex + 1} of ${syncImages.length}`);
      }

      await this.sendExpectStatus(new Uint8Array([0x06]), 0x06, [0]);
      done++;
      this.emitProgress(done, totalSteps, 'Synchronization complete');
      await this.requestStorage();
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}

export const bleManager = new OllOBleManager();
