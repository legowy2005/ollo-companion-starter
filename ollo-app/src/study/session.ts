import type { Card, Grade, Schedule } from '../types';
import { MIN, SCHEDULER, isNewCard, isReady } from './scheduler';

/**
 * smart   - what is due plus a few new cards, mixed across folders. Grades change the schedule.
 * shuffle - every card in scope in random order. Practice only: the schedule is left alone.
 * resume  - the folder in order from where the learner stopped. Practice only.
 */
export type SessionMode = 'smart' | 'shuffle' | 'resume';

export interface Session {
  mode: SessionMode;
  /** Card ids still to answer. The first one is on screen. */
  queue: string[];
  /** Distinct cards the session started with */
  total: number;
  /** Cards that have left the queue for good */
  done: number;
  grades: Record<Grade, number>;
  startedAt: number;
  /** Folder the session is limited to, if any */
  folder?: string;
  /** How many of the starting cards had never been studied */
  newCards: number;
}

export function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Due cards first (mixed up so topics interleave), then new cards in the order they were written. */
export function smartQueue(cards: Card[], opts: { size: number; now: number; folder?: string; exclude?: Set<string> }): string[] {
  const pool = cards.filter((card) => (!opts.folder || card.folder === opts.folder) && !opts.exclude?.has(card.id));
  const due = shuffled(pool.filter((card) => isReady(card, opts.now)));
  const fresh = pool.filter(isNewCard);
  return [...due, ...fresh].slice(0, opts.size).map((card) => card.id);
}

export function startSession(mode: SessionMode, ids: string[], cards: Card[], now: number, folder?: string): Session {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return {
    mode,
    queue: ids,
    total: ids.length,
    done: 0,
    grades: { 1: 0, 2: 0, 3: 0, 4: 0 },
    startedAt: now,
    folder,
    newCards: ids.filter((id) => { const card = byId.get(id); return card && isNewCard(card); }).length
  };
}

/** A card that is still being learned comes back after a few other cards, in the same session. */
const REINSERT_GAP = 3;

export function applyGrade(session: Session, grade: Grade, next: Schedule | undefined, now: number): Session {
  const [, ...rest] = session.queue;
  const grades = { ...session.grades, [grade]: session.grades[grade] + 1 };
  const comesBack = session.mode === 'smart' && !!next && next.state === 'learning' && next.due <= now + SCHEDULER.sessionLookaheadMin * MIN;
  if (!comesBack) return { ...session, queue: rest, done: session.done + 1, grades };
  const queue = [...rest];
  queue.splice(Math.min(queue.length, REINSERT_GAP), 0, session.queue[0]);
  return { ...session, queue, grades };
}

export function gradedTotal(session: Session): number {
  return session.grades[1] + session.grades[2] + session.grades[3] + session.grades[4];
}

/** Share of answers that were Good or Easy, 0..1. */
export function recallRate(session: Session): number {
  const total = gradedTotal(session);
  return total ? (session.grades[3] + session.grades[4]) / total : 0;
}
