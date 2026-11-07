import type { WeekDay } from '../study/progress';
import type { DeckCounts } from '../study/scheduler';
import { CheckIcon } from '../icons';

/** The goal indicator. It is the rounded frame of ollo's eyes, and it fills as cards are studied. */
export function Lens({ value, goal }: { value: number; goal: number }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const full = value >= goal && goal > 0;
  return (
    <div className={`lens ${full ? 'full' : ''}`} role="img" aria-label={`${value} of ${goal} cards today`}>
      <svg viewBox="0 0 84 98" aria-hidden="true">
        <rect className="lens-track" x="4" y="4" width="76" height="90" rx="26" />
        <rect className="lens-fill" x="4" y="4" width="76" height="90" rx="26" pathLength={100} strokeDasharray={`${pct} ${100 - pct}`} style={{ opacity: pct > 0 ? 1 : 0 }} />
      </svg>
      {full && <div className="lens-num"><CheckIcon style={{ fontSize: 32 }} /></div>}
    </div>
  );
}

export function WeekStrip({ days }: { days: WeekDay[] }) {
  return (
    <div className="week" role="img" aria-label={`Days practiced this week: ${days.filter((day) => day.count > 0).length} of 7`}>
      {days.map((day) => (
        <div key={day.key} className={`week-day ${day.count > 0 ? 'done' : ''} ${day.today ? 'today' : ''}`}>
          <span className="week-dot">{day.count > 0 && <CheckIcon />}</span>
          {day.letter}
        </div>
      ))}
    </div>
  );
}

/** Stacked bar of how many cards are new, being learned, getting known, and known. */
export function MasteryBar({ counts }: { counts: DeckCounts }) {
  const parts: [string, number][] = [['m-mature', counts.mature], ['m-young', counts.young], ['m-learning', counts.learning], ['m-new', counts.new]];
  const shown = parts.filter(([, n]) => n > 0);
  return (
    <div className="mastery" role="img" aria-label={`${counts.mature} known, ${counts.young} getting there, ${counts.learning} learning, ${counts.new} new`}>
      {shown.length ? shown.map(([cls, n]) => <span key={cls} className={cls} style={{ flex: n }} />) : <span className="m-new" style={{ flex: 1 }} />}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}
