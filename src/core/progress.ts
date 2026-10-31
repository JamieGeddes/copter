import { Medal, MEDAL_RANK } from '../missions/medals';

export interface MissionRecord {
  completed: boolean;
  bestTime?: number;
  medal?: Medal;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'copter.progress.v1';

/** Saved mission results. Storage failures (private mode, quota) are ignored. */
export class Progress {
  private records: Record<string, MissionRecord> = {};
  private readonly store?: KeyValueStore;

  constructor(store?: KeyValueStore) {
    this.store = store;
    try {
      const raw = store?.getItem(KEY);
      if (raw) this.records = JSON.parse(raw) as Record<string, MissionRecord>;
    } catch {
      this.records = {};
    }
  }

  get(id: string): MissionRecord {
    return this.records[id] ?? { completed: false };
  }

  /** A mission is unlocked if it is first in the list or the one before it is complete. */
  isUnlocked(id: string, order: readonly string[]): boolean {
    const i = order.indexOf(id);
    return i === 0 || (i > 0 && this.get(order[i - 1]).completed);
  }

  /** Records a completed run. Returns whether the time or medal improved. */
  record(id: string, time: number, medal: Medal): { newBestTime: boolean; newMedal: boolean } {
    const prev = this.get(id);
    const newBestTime = prev.bestTime === undefined || time < prev.bestTime;
    const newMedal = !prev.medal || MEDAL_RANK[medal] > MEDAL_RANK[prev.medal];
    this.records[id] = {
      completed: true,
      bestTime: newBestTime ? time : prev.bestTime,
      medal: newMedal ? medal : prev.medal,
    };
    try {
      this.store?.setItem(KEY, JSON.stringify(this.records));
    } catch {
      // Progress simply won't persist.
    }
    return { newBestTime, newMedal };
  }
}
