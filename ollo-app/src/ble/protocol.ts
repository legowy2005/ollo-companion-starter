import type { Card, ImageMode } from '../types';
import type { StoredImage } from '../types';

export const SERVICE_UUID = '6f6c6c6f-0001-4000-8000-00805f9b34fb';
export const WRITE_UUID = '6f6c6c6f-0002-4000-8000-00805f9b34fb';
export const NOTIFY_UUID = '6f6c6c6f-0003-4000-8000-00805f9b34fb';
export const DEVICE_NAME = 'Ollo';

// Card text. Newer firmware (flag below) receives text in chunks, so the only limit is this
// generous per-side cap. Older firmware takes the whole card in one BLE write, which fits
// roughly 200 bytes of front + back combined.
export const MAX_TEXT_BYTES = 8192;
export const LEGACY_CARD_TEXT_BYTES = 200;
export const MAX_FOLDER_BYTES = 20;

/** DeviceInfo.flags bit 2: firmware understands CARD_BEGIN / CARD_TEXT / CARD_END. */
export const FLAG_CHUNKED_TEXT = 0x04;

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

const encoder = new TextEncoder();

function clampUtf8(source: Uint8Array, maxBytes: number): Uint8Array {
  if (source.length <= maxBytes) return source;
  let end = maxBytes;
  while (end > 0 && (source[end] & 0xc0) === 0x80) end--;
  return source.slice(0, end);
}

/** Folder names: one line, no control characters. */
function cleanFolder(value: string): Uint8Array {
  return clampUtf8(encoder.encode((value || 'OllO').replace(/[\t\r\n]/g, ' ')), MAX_FOLDER_BYTES);
}

/** Card text for chunked sync: keeps line breaks, drops carriage returns, tabs become spaces. */
function cleanText(value: string, maxBytes: number): Uint8Array {
  return clampUtf8(encoder.encode(value.replace(/\r/g, '').replace(/\t/g, ' ')), maxBytes);
}

export function cardTextBytes(card: Card): { front: number; back: number } {
  return { front: encoder.encode(card.front).length, back: encoder.encode(card.back).length };
}

/** True when the card fits the old single-packet format. */
export function cardFitsLegacy(card: Card): boolean {
  const { front, back } = cardTextBytes(card);
  return front + back <= LEGACY_CARD_TEXT_BYTES;
}

/** Old single-packet card, for firmware without chunked text. Line breaks become spaces. */
export function makeCardPacket(card: Card, index: number): Uint8Array {
  const clean = (value: string, maxBytes: number) => clampUtf8(encoder.encode(value.replace(/[\t\r\n]/g, ' ')), maxBytes);
  const folder = clean(card.folder || 'OllO', MAX_FOLDER_BYTES);
  const front = clean(card.front, LEGACY_CARD_TEXT_BYTES);
  const back = clean(card.back, LEGACY_CARD_TEXT_BYTES - front.length);
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

export interface ChunkedCard {
  begin: Uint8Array;
  texts: Uint8Array[];
  end: Uint8Array;
}

/**
 * Chunked card, in three kinds of packet:
 *   CARD_BEGIN 0x09  [index u16][frontImg u32][backImg u32][folderLen u8][frontLen u16][backLen u16][folder]
 *   CARD_TEXT  0x0A  [index u16][side u8 0=front 1=back][offset u16][bytes...]
 *   CARD_END   0x0B  [index u16][checksum u8]   checksum = sum of all front + back bytes, modulo 256
 * Only CARD_END is answered (status 0x02), so the glasses can check lengths and checksum first.
 * `textChunk` is the number of text bytes allowed per CARD_TEXT packet.
 */
export function makeChunkedCard(card: Card, index: number, textChunk: number): ChunkedCard {
  const folder = cleanFolder(card.folder);
  const front = cleanText(card.front, MAX_TEXT_BYTES);
  const back = cleanText(card.back, MAX_TEXT_BYTES);
  const begin = new Uint8Array([
    0x09,
    ...u16(index),
    ...u32(card.frontImageId ?? 0),
    ...u32(card.backImageId ?? 0),
    folder.length,
    ...u16(front.length),
    ...u16(back.length),
    ...folder
  ]);
  const texts: Uint8Array[] = [];
  let checksum = 0;
  const pushSide = (side: number, data: Uint8Array) => {
    for (let offset = 0; offset < data.length; offset += textChunk) {
      const part = data.subarray(offset, Math.min(offset + textChunk, data.length));
      for (const byte of part) checksum = (checksum + byte) & 0xff;
      texts.push(new Uint8Array([0x0a, ...u16(index), side, ...u16(offset), ...part]));
    }
  };
  pushSide(0, front);
  pushSide(1, back);
  return { begin, texts, end: new Uint8Array([0x0b, ...u16(index), checksum]) };
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
