import { describe, expect, it } from 'vitest';
import { Progress } from '../src/core/progress';
import { formatTime, medalFor } from '../src/missions/medals';

const memoryStore = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('medals', () => {
  const times = { gold: 60, silver: 120 };
  it('grades by time', () => {
    expect(medalFor(50, 0, times)).toBe('gold');
    expect(medalFor(90, 0, times)).toBe('silver');
    expect(medalFor(200, 0, times)).toBe('bronze');
  });
  it('drops a grade for heavy damage', () => {
    expect(medalFor(50, 0.3, times)).toBe('silver');
    expect(medalFor(90, 0.6, times)).toBe('bronze');
  });
  it('formats times', () => {
    expect(formatTime(75.9)).toBe('1:15');
  });
});

describe('Progress', () => {
  it('unlocks missions in order', () => {
    const p = new Progress(memoryStore());
    const order = ['a', 'b', 'c'];
    expect(p.isUnlocked('a', order)).toBe(true);
    expect(p.isUnlocked('b', order)).toBe(false);
    p.record('a', 100, 'bronze');
    expect(p.isUnlocked('b', order)).toBe(true);
    expect(p.isUnlocked('c', order)).toBe(false);
  });

  it('keeps the best time and best medal independently', () => {
    const p = new Progress(memoryStore());
    p.record('a', 100, 'gold');
    const r = p.record('a', 80, 'silver');
    expect(r).toEqual({ newBestTime: true, newMedal: false });
    expect(p.get('a')).toEqual({ completed: true, bestTime: 80, medal: 'gold' });
  });

  it('persists between instances and survives corrupt data', () => {
    const store = memoryStore();
    new Progress(store).record('a', 50, 'gold');
    expect(new Progress(store).get('a').medal).toBe('gold');
    store.setItem('copter.progress.v1', '{not json');
    expect(new Progress(store).get('a').completed).toBe(false);
  });
});
