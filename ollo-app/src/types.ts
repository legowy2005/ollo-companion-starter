export type ImageMode = 'mono' | 'gray2' | 'rgb565';
/** Every face ollo can make. */
export type Mood = 'neutral' | 'happy' | 'excited' | 'proud' | 'cocky' | 'sad' | 'angry';
/** A quote's emotion. 'auto' means "follow how the user has been practicing". */
export type QuoteEmotion = Mood | 'auto';

export interface Quote {
  id: string;
  text: string;
  emotion: QuoteEmotion;
}

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
  /** The untouched file the user picked. Shown inside the app; never sent to the glasses. */
  originalBlob?: Blob;
  originalWidth?: number;
  originalHeight?: number;
}

export interface AppSettings {
  autoReconnect: boolean;
  /** @deprecated Replaced by customQuotes. Kept so older saved libraries still load. */
  motivationalQuote: string;
  /** Quotes the user wrote themselves, each with the emotion ollo shows while it is on screen. */
  customQuotes: Quote[];
  /** Mix the built-in quotes into the quote of the day. */
  useBuiltInQuotes: boolean;
  defaultImageMode: ImageMode;
}

/** Bookkeeping for ollo's personality (when the app was opened, what he last said, ...). */
export interface MascotMeta {
  openCount?: number;
  lastOpenAt?: number;
  /** Recent app opens, used for the "stop trying to cycle my emotions" Easter egg */
  recentOpens?: number[];
  lastEggAt?: number;
  lastLineId?: string;
}

export interface QuoteOfTheDay {
  /** Index of the 12-hour window (local time) this quote belongs to */
  slot: number;
  quoteId: string;
}

/** Tracks how the user has been practicing, so ollo can react to it. */
export interface PracticeStats {
  /** Local calendar day of the last practiced card, YYYY-MM-DD */
  lastDay: string;
  lastAt: number;
  /** Unique cards practiced on lastDay */
  todayCount: number;
  /** Ids of the cards counted on lastDay, so re-studying the same card doesn't count twice */
  cardIds?: string[];
  /** Consecutive days practiced, ending at lastDay */
  streak: number;
}

export interface LibraryData {
  cards: Card[];
  settings: AppSettings;
  /** Last card shown while studying, so Play can continue where the user left off. */
  lastStudied?: { folder: string; cardId: string };
  lastCardByFolder?: Record<string, string>;
  practice?: PracticeStats;
  meta?: MascotMeta;
  quoteOfTheDay?: QuoteOfTheDay;
  lastSyncedAt?: number;
  lastSyncedCounts?: { cards: number; images: number; folders: number };
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoReconnect: true,
  motivationalQuote: "Who's gonna carry the boats!",
  customQuotes: [],
  useBuiltInQuotes: true,
  defaultImageMode: 'gray2'
};

export const DEMO_CARDS: Card[] = [
  { id: 'demo-1', folder: 'Physics 101', front: 'What is the formula for speed?', back: 'Speed = distance ÷ time', rating: 2 },
  { id: 'demo-2', folder: 'Physics 101', front: "What is Newton's second law?", back: 'The net force equals mass multiplied by acceleration: F = ma.', rating: 3 },
  { id: 'demo-3', folder: 'Physics 101', front: 'What is kinetic energy?', back: 'KE = ½mv²', rating: 1 }
];
