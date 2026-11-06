import type { Mood } from '../types';

/**
 * Things ollo says on his own (as opposed to the quote of the day).
 * Each line carries the emotion ollo makes while saying it.
 * {streak} and {days} get filled in with the user's numbers.
 */
export type Situation =
  | 'welcome'   // very first time the app opens
  | 'soon'      // user came back shortly after the last time
  | 'streak'    // several days in a row
  | 'today'     // already practiced today, opened the app again later
  | 'yesterday' // last practiced yesterday
  | 'missed'    // 2 days away
  | 'gone';     // 3+ days away

export interface OlloLine {
  id: string;
  text: string;
  emotion: Mood;
}

function lines(situation: Situation, entries: [string, Mood][]): OlloLine[] {
  return entries.map(([text, emotion], i) => ({ id: `${situation}-${i}`, text, emotion }));
}

export const OLLO_LINES: Record<Situation, OlloLine[]> = {
  welcome: lines('welcome', [
    ['Hi! I’m OllO. Let’s learn something.', 'happy'],
    ['New face! Let’s get started.', 'excited']
  ]),
  soon: lines('soon', [
    ['So back soon? NICE!', 'excited'],
    ['THAT’S THE SPIRIT!', 'excited'],
    ['Back already? I like it.', 'happy'],
    ['Can’t stay away, huh?', 'cocky'],
    ['Look who’s eager!', 'happy']
  ]),
  streak: lines('streak', [
    ['{streak} days in a row. Wow.', 'proud'],
    ['Look at you go!', 'excited'],
    ['Streak alive. Don’t ruin it.', 'cocky'],
    ['{streak} days! I’m impressed.', 'proud']
  ]),
  today: lines('today', [
    ['Round two? Let’s go!', 'excited'],
    ['You again? Love it.', 'happy'],
    ['Okay, overachiever.', 'cocky'],
    ['Still going? Impressive.', 'proud']
  ]),
  yesterday: lines('yesterday', [
    ['Ready for today’s round?', 'neutral'],
    ['Fresh day, fresh cards.', 'happy'],
    ['Let’s keep it rolling.', 'neutral']
  ]),
  missed: lines('missed', [
    ['I missed you…', 'sad'],
    ['Where have you been?', 'sad'],
    ['I almost thought you gave up.', 'cocky']
  ]),
  gone: lines('gone', [
    ['{days} days. We need to talk.', 'angry'],
    ['Oh, NOW you show up.', 'angry'],
    ['I almost thought you gave up.', 'cocky'],
    ['Cards don’t study themselves!', 'angry']
  ])
};

export const EGG_LINE: OlloLine = {
  id: 'egg-0',
  text: 'Trying to cycle to see my other emotions? Na na na you won’t.',
  emotion: 'cocky'
};
