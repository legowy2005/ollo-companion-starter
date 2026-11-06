import type { Mood, PracticeStats } from '../types';

export type { Mood };

/**
 * Tweak these to change how quickly ollo gets upset or proud.
 * "Days" are calendar days in the user's local time zone.
 */
export const MOOD_RULES = {
  /** Missed this many calendar days (no practice at all) -> sad */
  sadAfterDays: 2,
  /** Missed this many calendar days -> angry */
  angryAfterDays: 3,
  /** Cards studied today needed for ollo to be proud instead of just happy */
  proudCardsToday: 10,
  /** A streak of this many days in a row also makes ollo proud (if at least 1 card was studied today) */
  proudStreakDays: 3
} as const;

/** Moods that feel alike. Used to vary ollo's face without changing how he "feels" overall. */
export const MOOD_FAMILY: Record<Mood, Mood[]> = {
  neutral: ['neutral'],
  happy: ['happy', 'excited'],
  excited: ['excited', 'happy'],
  proud: ['proud', 'excited'],
  cocky: ['cocky'],
  sad: ['sad'],
  angry: ['angry']
};

export function pickFromFamily(mood: Mood): Mood {
  const family = MOOD_FAMILY[mood];
  return family[Math.floor(Math.random() * family.length)];
}

export const MOOD_LABELS: Record<Mood, string> = {
  neutral: 'Calm',
  happy: 'Happy',
  excited: 'Excited',
  proud: 'Proud',
  cocky: 'Cocky',
  sad: 'Sad',
  angry: 'Angry'
};

export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/** Whole calendar days since the user last practiced (0 = today). */
export function daysSincePractice(stats: PracticeStats, now: Date = new Date()): number {
  return daysBetween(stats.lastDay, dayKey(now));
}

/** Returns the new stats after one card has been practiced. The same card only counts once per day. */
export function recordPracticeStats(previous: PracticeStats | undefined, cardId: string, now: Date = new Date()): PracticeStats {
  const today = dayKey(now);
  if (previous && previous.lastDay === today) {
    const known = previous.cardIds ?? [];
    if (known.includes(cardId)) return previous;
    return {
      ...previous,
      lastAt: now.getTime(),
      cardIds: [...known, cardId],
      todayCount: Math.max(previous.todayCount, known.length) + 1
    };
  }
  const continuesStreak = previous ? daysBetween(previous.lastDay, today) === 1 : false;
  return {
    lastDay: today,
    lastAt: now.getTime(),
    todayCount: 1,
    cardIds: [cardId],
    streak: continuesStreak && previous ? previous.streak + 1 : 1
  };
}

/** Picks ollo's base mood from how the user has been practicing. */
export function moodFromPractice(stats: PracticeStats | undefined, now: Date = new Date()): Mood {
  // Brand-new user: friendly and calm, nobody to be angry at yet.
  if (!stats) return 'neutral';

  const daysSince = daysSincePractice(stats, now);

  if (daysSince <= 0) {
    const proud = stats.todayCount >= MOOD_RULES.proudCardsToday || stats.streak >= MOOD_RULES.proudStreakDays;
    return proud ? 'proud' : 'happy';
  }
  if (daysSince >= MOOD_RULES.angryAfterDays) return 'angry';
  if (daysSince >= MOOD_RULES.sadAfterDays) return 'sad';
  return 'neutral';
}

const VALID: Mood[] = ['neutral', 'happy', 'excited', 'proud', 'cocky', 'sad', 'angry'];

/** Dev helper: open the app with ?mood=angry to force a face. */
export function moodFromUrl(): Mood | undefined {
  try {
    const value = new URLSearchParams(window.location.search).get('mood');
    return VALID.find((mood) => mood === value);
  } catch {
    return undefined;
  }
}
