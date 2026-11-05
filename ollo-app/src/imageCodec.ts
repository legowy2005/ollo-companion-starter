import type { ImageMode, StoredImage } from './types';

/** The glasses copy is never larger than this (and never upscaled). */
export const GLASSES_MAX = { width: 640, height: 480 };

export const IMAGE_MODES: ImageMode[] = ['mono', 'gray2', 'rgb565'];

function makeId(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 1;
}

export interface GlassesVariant {
  mode: ImageMode;
  width: number;
  height: number;
  bytes: ArrayBuffer;
  /** PNG data URL showing how the glasses copy will look. */
  preview: string;
}

/** A picked image, converted once for every mode so the user can compare them before choosing. */
export interface PreparedImage {
  file: Blob;
  originalWidth: number;
  originalHeight: number;
  /** Small data URL of the original, for the comparison screen. */
  originalPreview: string;
  variants: Record<ImageMode, GlassesVariant>;
}

function convertVariant(bitmap: ImageBitmap, mode: ImageMode): GlassesVariant {
  const scale = Math.min(GLASSES_MAX.width / bitmap.width, GLASSES_MAX.height / bitmap.height, 1);
  const width = Math.max(1, Math.floor(bitmap.width * scale));
  const height = Math.max(1, Math.floor(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not prepare the image.');
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);

  const pixels = context.getImageData(0, 0, width, height).data;
  let bytes: Uint8Array;
  if (mode === 'mono') {
    const rowBytes = Math.ceil(width / 8);
    bytes = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        const gray = Math.round(0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]);
        if (gray >= 128) bytes[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  } else if (mode === 'gray2') {
    const rowBytes = Math.ceil(width / 4);
    bytes = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        const gray = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
        const level = Math.max(0, Math.min(3, Math.round(gray / 85)));
        bytes[y * rowBytes + (x >> 2)] |= level << ((x & 3) * 2);
      }
    }
  } else {
    bytes = new Uint8Array(width * height * 2);
    for (let i = 0; i < width * height; i++) {
      const r = pixels[i * 4] >> 3;
      const g = pixels[i * 4 + 1] >> 2;
      const b = pixels[i * 4 + 2] >> 3;
      const rgb565 = (r << 11) | (g << 5) | b;
      bytes[i * 2] = rgb565 & 0xff;
      bytes[i * 2 + 1] = (rgb565 >> 8) & 0xff;
    }
  }

  // Preview = exactly what the glasses copy contains.
  const preview = context.getImageData(0, 0, width, height);
  for (let i = 0; i < preview.data.length; i += 4) {
    if (mode === 'rgb565') {
      preview.data[i] = (preview.data[i] >> 3) * 255 / 31;
      preview.data[i + 1] = (preview.data[i + 1] >> 2) * 255 / 63;
      preview.data[i + 2] = (preview.data[i + 2] >> 3) * 255 / 31;
    } else {
      const gray = Math.round(0.299 * preview.data[i] + 0.587 * preview.data[i + 1] + 0.114 * preview.data[i + 2]);
      const shown = mode === 'mono' ? (gray >= 128 ? 255 : 0) : Math.round(gray / 85) * 85;
      preview.data[i] = shown;
      preview.data[i + 1] = shown;
      preview.data[i + 2] = shown;
    }
  }
  context.putImageData(preview, 0, 0);

  return { mode, width, height, bytes: bytes.slice().buffer as ArrayBuffer, preview: canvas.toDataURL('image/png') };
}

function smallPreview(bitmap: ImageBitmap): string {
  const scale = Math.min(640 / bitmap.width, 480 / bitmap.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
  canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Reads the picked file and builds the glasses copy for all three modes. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    return {
      file,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      originalPreview: smallPreview(bitmap),
      variants: {
        mono: convertVariant(bitmap, 'mono'),
        gray2: convertVariant(bitmap, 'gray2'),
        rgb565: convertVariant(bitmap, 'rgb565')
      }
    };
  } finally {
    bitmap.close();
  }
}

/** Keeps the original untouched and stores the chosen glasses copy next to it. */
export function finalizeImage(prepared: PreparedImage, mode: ImageMode): StoredImage {
  const variant = prepared.variants[mode];
  return {
    id: makeId(),
    mode,
    width: variant.width,
    height: variant.height,
    bytes: variant.bytes,
    preview: variant.preview,
    createdAt: Date.now(),
    originalBlob: prepared.file,
    originalWidth: prepared.originalWidth,
    originalHeight: prepared.originalHeight
  };
}

const urlCache = new WeakMap<Blob, string>();

/** What the app itself shows: the original picture when we have it, otherwise the glasses copy. */
export function displaySrc(image: StoredImage): string {
  if (!image.originalBlob) return image.preview;
  let url = urlCache.get(image.originalBlob);
  if (!url) {
    url = URL.createObjectURL(image.originalBlob);
    urlCache.set(image.originalBlob, url);
  }
  return url;
}

export function imageModeLabel(mode: ImageMode): string {
  if (mode === 'mono') return 'Black & white';
  if (mode === 'gray2') return 'Grayscale · 4 tones';
  return 'Color';
}

export function expectedImageBytes(width: number, height: number, mode: ImageMode): number {
  if (mode === 'mono') return Math.ceil(width / 8) * height;
  if (mode === 'gray2') return Math.ceil(width / 4) * height;
  return width * height * 2;
}
