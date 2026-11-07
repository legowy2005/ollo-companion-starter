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

export type AppScreen = 'home' | 'folder' | 'study' | 'summary' | 'editor' | 'sync' | 'settings';

/** How the learner judged an answer: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. */
export type Grade = 1 | 2 | 3 | 4;

/** When a card is due again. Cards without one have never been studied. */
export interface Schedule {
  state: 'learning' | 'review';
  /** Epoch ms when the card should come back */
  due: number;
  /** Review interval in days (while relearning: the interval to return to after the card is recalled) */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  /** Position in the learning steps */
  step: number;
  last?: number;
}

export interface Card {
  id: string;
  folder: string;
  front: string;
  back: string;
  frontImageId?: number;
  backImageId?: number;
  /** Legacy 4-level difficulty (1 easy ... 4 very difficult). Still written on every grade; the scheduler uses `sched`. */
  rating?: 1 | 2 | 3 | 4;
  sched?: Schedule;
  /** Last time the text, images or folder changed (epoch ms). Used to tell when the glasses are out of date. */
  updatedAt?: number;
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
  /** Cards to review per day. Sets the size of a session and fills the goal ring. */
  dailyGoal: number;
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
  /** Day a rest day was last used to save a streak (one missed day is forgiven per week) */
  shieldDay?: string;
}

export interface LibraryData {
  cards: Card[];
  settings: AppSettings;
  /** Last card shown while studying, so Play can continue where the user left off. */
  lastStudied?: { folder: string; cardId: string };
  lastCardByFolder?: Record<string, string>;
  practice?: PracticeStats;
  /** Unique cards reviewed per local day (YYYY-MM-DD), kept for about three months. */
  history?: Record<string, number>;
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
  defaultImageMode: 'gray2',
  dailyGoal: 10
};

export const DEMO_CARDS: Card[] = [
  { id: 'demo-1', folder: 'Physics 101', front: 'What is the formula for speed?', back: 'Speed = distance ÷ time', rating: 2 },
  { id: 'demo-2', folder: 'Physics 101', front: "What is Newton's second law?", back: 'The net force equals mass multiplied by acceleration: F = ma.', rating: 3 },
  { id: 'demo-3', folder: 'Physics 101', front: 'What is kinetic energy?', back: 'KE = ½mv²', rating: 1 }
];
