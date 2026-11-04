export type ImageMode = 'mono' | 'gray2' | 'rgb565';
export type AppScreen = 'home' | 'folder' | 'study' | 'editor' | 'sync' | 'settings';

export interface Card {
  id: string;
  folder: string;
  front: string;
  back: string;
  frontImageId?: number;
  backImageId?: number;
  rating?: 1 | 2 | 3 | 4;
  bookmarked?: boolean;
}

export interface StoredImage {
  id: number;
  mode: ImageMode;
  width: number;
  height: number;
  bytes: ArrayBuffer;
  preview: string;
  createdAt: number;
}

export interface AppSettings {
  autoReconnect: boolean;
  motivationalQuote: string;
  defaultImageMode: ImageMode;
}

export interface LibraryData {
  cards: Card[];
  settings: AppSettings;
  lastSyncedAt?: number;
  lastSyncedCounts?: { cards: number; images: number; folders: number };
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoReconnect: true,
  motivationalQuote: "Who's gonna carry the boats!",
  defaultImageMode: 'gray2'
};

export const DEMO_CARDS: Card[] = [
  { id: 'demo-1', folder: 'Physics 101', front: 'What is the formula for speed?', back: 'Speed = distance ÷ time', rating: 2 },
  { id: 'demo-2', folder: 'Physics 101', front: "What is Newton's second law?", back: 'The net force equals mass multiplied by acceleration: F = ma.', rating: 3 },
  { id: 'demo-3', folder: 'Physics 101', front: 'What is kinetic energy?', back: 'KE = ½mv²', rating: 1 }
];
