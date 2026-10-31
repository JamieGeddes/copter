import { describe, expect, it } from 'vitest';
import { SurvivorDef } from '../src/missions/types';
import { DEFAULT_WINCH, Winch, WinchAircraft, WinchEvent } from '../src/missions/Winch';

const survivor: SurvivorDef = { id: 's1', x: 0, z: 0, y: 0, placement: 'water' };
const hover = (over: Partial<WinchAircraft> = {}): WinchAircraft => ({ x: 1, y: 12, z: 0, groundSpeed: 0.5, landed: false, ...over });

const run = (w: Winch, seconds: number, heli: WinchAircraft, rescued = new Set<string>(), capacity = 5) => {
  const events: WinchEvent[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    const step = w.update(0.05, heli, [survivor], rescued, capacity);
    for (const e of step) if (e.type === 'rescued') rescued.add(e.id);
    events.push(...step);
  }
  return events;
};

describe('Winch', () => {
  it('lowers, attaches and raises a survivor while hovering steadily', () => {
    const w = new Winch();
    const events = run(w, 12, hover());
    expect(events.map((e) => e.type)).toEqual(['attached', 'rescued']);
    expect(w.state).toBe('idle');
  });

  it('gives guidance when out of position', () => {
    const w = new Winch();
    run(w, 0.1, hover({ y: 40 }));
    expect(w.hint).toBe('tooHigh');
    run(w, 0.1, hover({ y: 3 }));
    expect(w.hint).toBe('tooLow');
    run(w, 0.1, hover({ x: 10 }));
    expect(w.hint).toBe('closer');
    run(w, 0.1, hover({ groundSpeed: 6 }));
    expect(w.hint).toBe('tooFast');
    expect(w.state).toBe('idle');
  });

  it('reels the cable back in if the aircraft drifts off', () => {
    const w = new Winch();
    run(w, 1, hover());
    expect(w.state).toBe('lowering');
    const paid = w.cable;
    run(w, 0.5, hover({ x: 8 }));
    expect(w.cable).toBeLessThan(paid);
    run(w, 5, hover({ x: 8 }));
    expect(w.state).toBe('idle');
    expect(w.cable).toBe(0);
  });

  it('keeps raising a survivor once attached even if the aircraft moves', () => {
    const w = new Winch();
    run(w, 2.4 + DEFAULT_WINCH.attachSeconds + 0.2, hover());
    expect(w.state).toBe('raising');
    const events = run(w, 6, hover({ x: 30, groundSpeed: 10 }));
    expect(events.some((e) => e.type === 'rescued')).toBe(true);
  });

  it('will not start when the cabin is full', () => {
    const w = new Winch();
    run(w, 3, hover(), new Set(), 0);
    expect(w.state).toBe('idle');
    expect(w.hint).toBe('full');
  });

  it('ignores survivors already rescued', () => {
    const w = new Winch();
    run(w, 3, hover(), new Set(['s1']));
    expect(w.state).toBe('idle');
  });
});
