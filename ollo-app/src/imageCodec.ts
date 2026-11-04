import type { ImageMode, StoredImage } from './types';

const LIMITS: Record<ImageMode, { width: number; height: number }> = {
  mono: { width: 640, height: 480 },
  gray2: { width: 640, height: 480 },
  rgb565: { width: 320, height: 240 }
};

function makeId(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 1;
}

export async function convertImage(file: File, mode: ImageMode): Promise<StoredImage> {
  const bitmap = await createImageBitmap(file);
  const limit = LIMITS[mode];
  const scale = Math.min(limit.width / bitmap.width, limit.height / bitmap.height, 1);
  const width = Math.max(1, Math.floor(bitmap.width * scale));
  const height = Math.max(1, Math.floor(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not prepare the image.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

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

  // Match the selected export mode in the preview as closely as possible.
  if (mode !== 'rgb565') {
    const preview = context.getImageData(0, 0, width, height);
    for (let i = 0; i < preview.data.length; i += 4) {
      const gray = Math.round(0.299 * preview.data[i] + 0.587 * preview.data[i + 1] + 0.114 * preview.data[i + 2]);
      const shown = mode === 'mono' ? (gray >= 128 ? 255 : 0) : Math.round(gray / 85) * 85;
      preview.data[i] = shown;
      preview.data[i + 1] = shown;
      preview.data[i + 2] = shown;
    }
    context.putImageData(preview, 0, 0);
  }

  const id = makeId();
  return {
    id,
    mode,
    width,
    height,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    preview: canvas.toDataURL('image/png'),
    createdAt: Date.now()
  };
}

export function imageModeLabel(mode: ImageMode): string {
  if (mode === 'mono') return 'Black & white';
  if (mode === 'gray2') return 'Grayscale · 4 tones';
  return 'Color · RGB565';
}

export function expectedImageBytes(width: number, height: number, mode: ImageMode): number {
  if (mode === 'mono') return Math.ceil(width / 8) * height;
  if (mode === 'gray2') return Math.ceil(width / 4) * height;
  return width * height * 2;
}
