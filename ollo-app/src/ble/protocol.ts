import type { Card, ImageMode } from '../types';
import type { StoredImage } from '../types';

export const SERVICE_UUID = '6f6c6c6f-0001-4000-8000-00805f9b34fb';
export const WRITE_UUID = '6f6c6c6f-0002-4000-8000-00805f9b34fb';
export const NOTIFY_UUID = '6f6c6c6f-0003-4000-8000-00805f9b34fb';
export const DEVICE_NAME = 'Ollo';

export const IMAGE_FORMAT: Record<ImageMode, number> = {
  mono: 0,
  rgb565: 1,
  gray2: 2
};

export type DeviceInfo = {
  protocolVersion: number;
  maxWidth: number;
  maxHeight: number;
  maxImageBytes: number;
  maxTextBytes: number;
  flags: number;
};

export type StorageInfo = { totalBytes: number; usedBytes: number };

export function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

export function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

export function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function makeCardPacket(card: Card, index: number): Uint8Array {
  const encoder = new TextEncoder();
  const clean = (value: string, maxBytes: number) => {
    const sanitized = value.replace(/[\t\r\n]/g, ' ');
    const source = encoder.encode(sanitized);
    if (source.length <= maxBytes) return source;
    let end = maxBytes;
    while (end > 0 && (source[end] & 0xc0) === 0x80) end--;
    return source.slice(0, end);
  };
  const folder = clean(card.folder || 'OllO', 20);
  const front = clean(card.front, 100);
  const back = clean(card.back, 100);
  const frontImage = card.frontImageId ?? 0;
  const backImage = card.backImageId ?? 0;
  return new Uint8Array([
    0x02,
    ...u16(index),
    ...u32(frontImage),
    ...u32(backImage),
    folder.length,
    front.length,
    back.length,
    ...folder,
    ...front,
    ...back
  ]);
}

export function makeImageBeginPacket(image: StoredImage): Uint8Array {
  const mode = IMAGE_FORMAT[image.mode];
  const dataLength = image.bytes.byteLength;
  return new Uint8Array([
    0x03,
    ...u32(image.id),
    ...u16(image.width),
    ...u16(image.height),
    ...u32(dataLength),
    mode
  ]);
}

export function parseDeviceInfo(view: DataView): DeviceInfo | undefined {
  if (view.byteLength < 12 || view.getUint8(0) !== 0x82) return undefined;
  return {
    protocolVersion: view.getUint8(1),
    maxWidth: readU16(view, 2),
    maxHeight: readU16(view, 4),
    maxImageBytes: readU32(view, 6),
    maxTextBytes: view.getUint8(10),
    flags: view.getUint8(11)
  };
}

export function parseStorage(view: DataView): StorageInfo | undefined {
  if (view.byteLength < 9 || view.getUint8(0) !== 0x81) return undefined;
  return { totalBytes: readU32(view, 1), usedBytes: readU32(view, 5) };
}
