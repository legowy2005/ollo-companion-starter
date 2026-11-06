import type { LibraryData, Mood, Quote, QuoteOfTheDay } from '../types';
import { BUILT_IN_QUOTES } from './quotes';
import { EGG_LINE, OLLO_LINES, type OlloLine, type Situation } from './lines';
import { daysSincePractice, moodFromPractice, pickFromFamily } from './mood';

/** What is currently shown in the yellow quote spot, and the face ollo makes while it is there. */
export interface Display {
  /** Unique per showing, so the words animate in again every time */
  id: string;
  text: string;
  emotion: Mood;
  kind: 'quote' | 'ollo' | 'egg';
}

/** All the knobs for ollo's personality in one place. */
export const DIRECTOR_RULES = {
  /** Quote of the day changes this often (windows start at local midnight and noon) */
  quoteHours: 12,
  /** Re-opening the app within this many minutes counts as "back soon" */
  soonMinutes: 60,
  /** Chance ollo says something (instead of showing the quote) in everyday situations. Big moments always speak. */
  everydayLineChance: 0.6,
  /** Easter egg: this many app opens within eggOpenWindowMs ... */
  eggOpens: 4,
  eggOpenWindowMs: 3 * 60_000,
  /** ... or this many returns to the main menu within eggMenuWindowMs */
  eggMenuVisits: 4,
  eggMenuWindowMs: 30_000
} as const;

const ALWAYS_SPEAK: Situation[] = ['welcome', 'soon', 'missed', 'gone'];

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`;

export function quotePool(library: LibraryData): Quote[] {
  const { customQuotes, useBuiltInQuotes } = library.settings;
  const custom = (customQuotes ?? []).filter((quote) => quote.text.trim());
  const pool = [...(useBuiltInQuotes ? BUILT_IN_QUOTES : []), ...custom];
  return pool.length ? pool : BUILT_IN_QUOTES;
}

/** Index of the current 12-hour window in local time. */
export function quoteSlot(now: number): number {
  const offsetMs = -new Date(now).getTimezoneOffset() * 60_000;
  return Math.floor((now + offsetMs) / (DIRECTOR_RULES.quoteHours * 3_600_000));
}

/** Keeps the saved quote of the day while its window lasts; otherwise rolls a new one (never the same twice in a row). */
export function resolveQuoteOfTheDay(library: LibraryData, now: number): QuoteOfTheDay {
  const slot = quoteSlot(now);
  const pool = quotePool(library);
  const saved = library.quoteOfTheDay;
  if (saved && saved.slot === slot && pool.some((quote) => quote.id === saved.quoteId)) return saved;
  const candidates = pool.length > 1 ? pool.filter((quote) => quote.id !== saved?.quoteId) : pool;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return { slot, quoteId: chosen.id };
}

export function quoteDisplay(library: LibraryData, qotd: QuoteOfTheDay, now: number): Display {
  const pool = quotePool(library);
  const quote = pool.find((item) => item.id === qotd.quoteId) ?? pool[0];
  const base = moodFromPractice(library.practice, new Date(now));
  const emotion: Mood = quote.emotion === 'auto' ? pickFromFamily(base) : quote.emotion;
  return { id: nextId('quote'), text: quote.text, emotion, kind: 'quote' };
}

export function eggDisplay(): Display {
  return { id: nextId('egg'), text: EGG_LINE.text, emotion: EGG_LINE.emotion, kind: 'egg' };
}

function situationFor(library: LibraryData, now: number): Situation | null {
  const stats = library.practice;
  const meta = library.meta ?? {};
  const soon = meta.lastOpenAt !== undefined && now - meta.lastOpenAt < DIRECTOR_RULES.soonMinutes * 60_000;

  if (stats) {
    const days = daysSincePractice(stats, new Date(now));
    if (days >= 3) return 'gone';
    if (days === 2) return 'missed';
    if (soon) return 'soon';
    if (stats.streak >= 3) return 'streak';
    if (days === 0) return 'today';
    return 'yesterday';
  }
  // No practice yet: greet on the very first open, cheer if they come straight back.
  if (!meta.openCount) return 'welcome';
  return soon ? 'soon' : null;
}

function pickLine(situation: Situation, avoidId?: string): OlloLine {
  const all = OLLO_LINES[situation];
  const options = all.length > 1 ? all.filter((line) => line.id !== avoidId) : all;
  return options[Math.floor(Math.random() * options.length)];
}

function fillIn(text: string, library: LibraryData, now: number): string {
  const stats = library.practice;
  return text
    .replace('{streak}', String(stats?.streak ?? 1))
    .replace('{days}', String(stats ? daysSincePractice(stats, new Date(now)) : 0));
}

export interface OpenResult {
  display: Display;
  library: LibraryData;
}

/**
 * Called every time the app is opened (or comes back to the foreground).
 * Records the open, then decides whether ollo speaks, the Easter egg fires, or the quote of the day shows.
 */
export function handleAppOpen(library: LibraryData, now: number): OpenResult {
  const meta = library.meta ?? {};
  const recentOpens = [...(meta.recentOpens ?? []).filter((t) => now - t < DIRECTOR_RULES.eggOpenWindowMs), now];
  // Keeps teasing for as long as the user keeps reopening the app to fish for other emotions.
  const eggReady = recentOpens.length >= DIRECTOR_RULES.eggOpens;

  const situation = eggReady ? null : situationFor(library, now);
  const speaks = !!situation && (ALWAYS_SPEAK.includes(situation) || Math.random() < DIRECTOR_RULES.everydayLineChance);

  const qotd = resolveQuoteOfTheDay(library, now);
  let display: Display;
  let lastLineId = meta.lastLineId;
  let lastEggAt = meta.lastEggAt;

  if (eggReady) {
    display = eggDisplay();
    lastEggAt = now;
  } else if (situation && speaks) {
    const line = pickLine(situation, meta.lastLineId);
    display = { id: nextId('ollo'), text: fillIn(line.text, library, now), emotion: line.emotion, kind: 'ollo' };
    lastLineId = line.id;
  } else {
    display = quoteDisplay(library, qotd, now);
  }

  return {
    display,
    library: {
      ...library,
      quoteOfTheDay: qotd,
      meta: { ...meta, openCount: (meta.openCount ?? 0) + 1, lastOpenAt: now, recentOpens, lastEggAt, lastLineId }
    }
  };
}
