import { MedalTimes } from './types';

export type Medal = 'gold' | 'silver' | 'bronze';

export const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };

/** Gold needs a fast and tidy flight; heavy damage drops a medal grade. */
export const medalFor = (seconds: number, damage: number, times: MedalTimes): Medal => {
  let medal: Medal = seconds <= times.gold ? 'gold' : seconds <= times.silver ? 'silver' : 'bronze';
  if (damage >= 0.25 && medal === 'gold') medal = 'silver';
  else if (damage >= 0.5 && medal === 'silver') medal = 'bronze';
  return medal;
};

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
