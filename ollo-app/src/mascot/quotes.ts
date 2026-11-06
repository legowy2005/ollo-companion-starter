import type { Quote, QuoteEmotion } from '../types';

const q = (id: string, text: string, emotion: QuoteEmotion): Quote => ({ id: `builtin-${id}`, text, emotion });

/**
 * Quotes that ship with the app. They mix into the "quote of the day" together with the user's own.
 * `emotion` is the face ollo makes while the quote is on screen ('auto' = follows the user's progress).
 */
export const BUILT_IN_QUOTES: Quote[] = [
  q('boats', "Who's gonna carry the boats!", 'excited'),
  q('small-steps', 'Small steps still move you forward.', 'happy'),
  q('one-more', 'One more card. Just one.', 'cocky'),
  q('future-you', 'Future you is watching. Impress them.', 'proud'),
  q('early-drafts', 'Wrong answers are just early drafts.', 'happy'),
  q('hungry', 'Stay hungry. Stay curious.', 'excited'),
  q('consistency', 'Consistency beats intensity.', 'proud'),
  q('brain-muscle', 'Your brain is a muscle. Let’s lift.', 'excited'),
  q('beginner', 'Every expert was once a beginner.', 'neutral'),
  q('five-minutes', 'Five minutes today beats an hour someday.', 'auto'),
  q('discipline', 'Discipline is remembering what you want.', 'proud'),
  q('tired', 'Tired? Do one card anyway.', 'cocky'),
  q('not-done', 'You’re not done. You’re just warming up.', 'excited'),
  q('rep', 'Every review is a rep. Keep lifting.', 'happy'),
  q('forget', 'Forgetting is normal. Reviewing is the fix.', 'neutral'),
  q('progress', 'Progress looks boring. Do it anyway.', 'auto'),
  q('proud-soon', 'Soon you’ll be proud you started.', 'happy'),
  q('curious', 'Be curious, not furious.', 'happy'),
  q('mastery', 'Mastery is a lot of tiny wins.', 'proud'),
  q('show-up', 'Showing up is the hardest part. You did it.', 'auto'),
  q('level-up', 'Level up one card at a time.', 'excited'),
  q('easy', 'It gets easier. Then you get better.', 'neutral'),
  q('ahead', 'Everyone you admire started here too.', 'happy'),
  q('lazy', 'Bet you can’t stop at just one.', 'cocky')
];
