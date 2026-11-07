import type { LibraryData, PracticeStats } from '../types';
import { dayKey, daysBetween, daysSincePractice, shieldAvailable } from '../mascot/mood';

/** Streak that is still alive today. A streak survives until the end of tomorrow's missed day (or a rest day). */
export function activeStreak(stats: PracticeStats | undefined, now: Date = new Date()): { days: number; practicedToday: boolean; atRisk: boolean } {
  if (!stats) return { days: 0, practicedToday: false, atRisk: false };
  const gap = daysSincePractice(stats, now);
  if (gap <= 0) return { days: stats.streak, practicedToday: true, atRisk: false };
  if (gap === 1) return { days: stats.streak, practicedToday: false, atRisk: true };
  if (gap === 2 && shieldAvailable(stats, dayKey(now))) return { days: stats.streak, practicedToday: false, atRisk: true };
  return { days: 0, practicedToday: false, atRisk: false };
}

/** Cards reviewed today (unique cards). */
export function cardsToday(library: LibraryData, now: Date = new Date()): number {
  const stats = library.practice;
  return stats && stats.lastDay === dayKey(now) ? stats.todayCount : 0;
}

export interface WeekDay {
  key: string;
  /** Narrow weekday letter in the user's language */
  letter: string;
  count: number;
  today: boolean;
}

/** The last seven days ending today, oldest first. */
export function weekStrip(history: Record<string, number> | undefined, now: Date = new Date()): WeekDay[] {
  const days: WeekDay[] = [];
  for (let back = 6; back >= 0; back--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const key = dayKey(date);
    days.push({
      key,
      letter: new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(date),
      count: history?.[key] ?? 0,
      today: back === 0
    });
  }
  return days;
}

/** Keeps roughly the last 90 days of history. */
export function recordHistory(history: Record<string, number> | undefined, todayCount: number, now: Date = new Date()): Record<string, number> {
  const today = dayKey(now);
  const next: Record<string, number> = { ...(history ?? {}), [today]: todayCount };
  for (const key of Object.keys(next)) if (daysBetween(key, today) > 90) delete next[key];
  return next;
}
