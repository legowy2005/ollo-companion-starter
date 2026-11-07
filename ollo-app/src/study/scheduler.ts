import type { Card, Grade, Schedule } from '../types';

/**
 * Spaced repetition scheduler.
 *
 * Why it exists: recalling an answer from memory strengthens it far more than rereading, and the gain is
 * biggest when the next recall happens just as the memory starts to fade. So each answer you give decides
 * when the card comes back: a miss returns in minutes, an easy card waits days or weeks.
 *
 * This is a small SM-2 style scheduler with learning steps (the same family Anki's classic scheduler uses).
 * Everything here is a pure function so it is easy to test and to tune. Change the numbers below to change
 * how aggressively cards are repeated.
 */

export const SCHEDULER = {
  /** Minutes between the first repetitions of a new (or forgotten) card. */
  learningStepsMin: [1, 10],
  /** Interval after a new card is answered "Easy" on its first try. */
  easyStartDays: 4,
  startEase: 2.5,
  minEase: 1.3,
  /** "Hard" and "Easy" nudge the ease so cards you find hard come back sooner next time. */
  hardEaseDelta: -0.15,
  againEaseDelta: -0.2,
  easyEaseDelta: 0.15,
  hardMultiplier: 1.2,
  easyBonus: 1.3,
  /** After forgetting a review card, it restarts at this share of its old interval. */
  lapseKeep: 0.4,
  maxIntervalDays: 365,
  /** A card due within this many minutes may be shown again inside the same session. */
  sessionLookaheadMin: 20,
  /** Cards at or beyond this interval count as "known" in the mastery bar. */
  matureDays: 21
} as const;

export const MIN = 60_000;
export const DAY = 86_400_000;

/** What each grade button means. The words describe what happened, not how the card felt. */
export const GRADE_LABELS: Record<Grade, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** Old 4-level "difficulty" (1 = easy ... 4 = very difficult) kept on each card for older saved libraries. */
export function legacyRating(grade: Grade): 1 | 2 | 3 | 4 {
  return (5 - grade) as 1 | 2 | 3 | 4;
}

export function endOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isNewCard(card: Card): boolean {
  return !card.sched;
}

/** Ready to be reviewed now: learning cards that are almost up, and review cards due any time today. */
export function isReady(card: Card, now: number): boolean {
  const s = card.sched;
  if (!s) return false;
  return s.state === 'learning' ? s.due <= now + SCHEDULER.sessionLookaheadMin * MIN : s.due <= endOfToday(now);
}

const clampEase = (ease: number) => Math.max(SCHEDULER.minEase, Math.round(ease * 100) / 100);
const clampDays = (days: number) => Math.min(SCHEDULER.maxIntervalDays, Math.max(1, Math.round(days)));

/** The new schedule after the learner answers with `grade`. A card with no schedule yet is a new card. */
export function schedule(previous: Schedule | undefined, grade: Grade, now: number): Schedule {
  const steps = SCHEDULER.learningStepsMin;
  const base: Schedule = previous ?? { state: 'learning', due: now, interval: 0, ease: SCHEDULER.startEase, reps: 0, lapses: 0, step: 0 };
  const reps = base.reps + 1;

  if (base.state === 'learning') {
    if (grade === 1) return { ...base, reps, step: 0, due: now + steps[0] * MIN, last: now };
    if (grade === 2) {
      const delay = base.step === 0 ? Math.round((steps[0] + steps[Math.min(1, steps.length - 1)]) / 2) : steps[base.step];
      return { ...base, reps, due: now + delay * MIN, last: now };
    }
    const next = base.step + 1;
    if (grade === 3 && next < steps.length) return { ...base, reps, step: next, due: now + steps[next] * MIN, last: now };
    // Graduates to a review card.
    const pending = base.interval;
    const interval = grade === 4
      ? clampDays(Math.max(SCHEDULER.easyStartDays, (pending || 3) * SCHEDULER.easyBonus))
      : clampDays(pending || 1);
    return { ...base, state: 'review', reps, step: 0, interval, due: now + interval * DAY, ease: grade === 4 ? clampEase(base.ease + SCHEDULER.easyEaseDelta) : base.ease, last: now };
  }

  // Review card
  if (grade === 1) {
    return {
      ...base,
      state: 'learning',
      reps,
      lapses: base.lapses + 1,
      step: 0,
      interval: clampDays(base.interval * SCHEDULER.lapseKeep),
      ease: clampEase(base.ease + SCHEDULER.againEaseDelta),
      due: now + steps[0] * MIN,
      last: now
    };
  }
  let interval: number;
  let ease = base.ease;
  if (grade === 2) {
    interval = clampDays(Math.max(base.interval + 1, base.interval * SCHEDULER.hardMultiplier));
    ease = clampEase(ease + SCHEDULER.hardEaseDelta);
  } else if (grade === 3) {
    interval = clampDays(Math.max(base.interval + 1, base.interval * ease));
  } else {
    interval = clampDays(Math.max(base.interval + 2, base.interval * ease * SCHEDULER.easyBonus));
    ease = clampEase(ease + SCHEDULER.easyEaseDelta);
  }
  return { ...base, reps, interval, ease, due: now + interval * DAY, last: now };
}

/** Short label for how long until a card returns: "1m", "6m", "2h", "3d", "2mo". */
export function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MIN));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

/** What each grade button will do, shown on the button so the choice has a visible consequence. */
export function previewWaits(previous: Schedule | undefined, now: number): Record<Grade, string> {
  const out = {} as Record<Grade, string>;
  for (const grade of [1, 2, 3, 4] as const) out[grade] = formatWait(schedule(previous, grade, now).due - now);
  return out;
}

export type Stage = 'new' | 'learning' | 'young' | 'mature';

export function stageOf(card: Card): Stage {
  const s = card.sched;
  if (!s) return 'new';
  if (s.state === 'learning') return 'learning';
  return s.interval >= SCHEDULER.matureDays ? 'mature' : 'young';
}

export interface DeckCounts {
  total: number;
  new: number;
  /** Cards ready to review right now (learning + review). */
  due: number;
  learning: number;
  young: number;
  mature: number;
}

export function countCards(cards: Card[], now: number): DeckCounts {
  const counts: DeckCounts = { total: cards.length, new: 0, due: 0, learning: 0, young: 0, mature: 0 };
  for (const card of cards) {
    const stage = stageOf(card);
    if (stage === 'new') counts.new++;
    else counts[stage]++;
    if (isReady(card, now)) counts.due++;
  }
  return counts;
}

/** Human description of where a card stands: "New", "Due", "In 3d". */
export function dueLabel(card: Card, now: number): string {
  const s = card.sched;
  if (!s) return 'New';
  if (isReady(card, now)) return 'Due';
  return `In ${formatWait(s.due - now)}`;
}
