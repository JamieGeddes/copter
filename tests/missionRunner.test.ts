import { describe, expect, it } from 'vitest';
import { MissionRunner, MissionSnapshot } from '../src/missions/MissionRunner';
import { MissionDef } from '../src/missions/types';

const snap = (over: Partial<MissionSnapshot> = {}): MissionSnapshot => ({
  x: 0,
  y: 0,
  z: 0,
  agl: 0,
  groundSpeed: 0,
  landed: true,
  destroyed: false,
  groundY: 0,
  ...over,
});

const def = (over: Partial<MissionDef>): MissionDef => ({
  id: 't',
  title: 'Test',
  summary: '',
  skill: '',
  briefing: [],
  objectives: [],
  medals: { gold: 60, silver: 120 },
  ...over,
});

describe('MissionRunner', () => {
  it('completes a take-off objective once airborne', () => {
    const m = new MissionRunner(def({ objectives: [{ kind: 'takeoff', text: 'Up' }] }));
    expect(m.update(0.1, snap())).toEqual([]);
    const events = m.update(0.1, snap({ landed: false, agl: 5 }));
    expect(events.map((e) => e.type)).toEqual(['objectiveComplete', 'complete']);
    expect(m.status).toBe('complete');
  });

  it('requires a steady hover inside the box for the full time', () => {
    const m = new MissionRunner(
      def({ objectives: [{ kind: 'hover', text: 'Hover', x: 0, z: 0, radius: 5, minAlt: 8, maxAlt: 20, seconds: 2 }] }),
    );
    const good = snap({ landed: false, agl: 10 });
    for (let i = 0; i < 15; i++) m.update(0.1, good);
    expect(m.progress).toBeCloseTo(0.75);
    // Drifting too fast bleeds progress away.
    m.update(0.5, { ...good, groundSpeed: 6 });
    expect(m.progress).toBeLessThan(0.75);
    for (let i = 0; i < 30; i++) m.update(0.1, good);
    expect(m.status).toBe('complete');
  });

  it('counts gates in order only', () => {
    const gates = [
      { x: 0, z: 0, alt: 10, radius: 5, facing: 0 },
      { x: 100, z: 0, alt: 20, radius: 5, facing: 0 },
    ];
    const m = new MissionRunner(def({ objectives: [{ kind: 'gates', text: 'Gates', gates }] }));
    // Flying through the second gate first does nothing.
    m.update(0.1, snap({ x: 100, y: 20, landed: false }));
    expect(m.progress).toBe(0);
    const e1 = m.update(0.1, snap({ x: 1, y: 11, landed: false }));
    expect(e1[0]).toMatchObject({ type: 'gatePassed', index: 1, total: 2 });
    // Wrong altitude misses the gate.
    m.update(0.1, snap({ x: 100, y: 40, landed: false }));
    expect(m.progress).toBe(0.5);
    m.update(0.1, snap({ x: 100, y: 22, landed: false }));
    expect(m.status).toBe('complete');
  });

  it('only accepts a landing on the right pad', () => {
    const m = new MissionRunner(def({ objectives: [{ kind: 'land', text: 'Land', pad: 'roof' }] }));
    m.update(0.1, snap({ padId: 'base' }));
    expect(m.status).toBe('running');
    m.update(0.1, snap({ padId: 'roof' }));
    expect(m.status).toBe('complete');
  });

  it('rescues survivors then unloads them at the hospital', () => {
    const m = new MissionRunner(
      def({
        capacity: 4,
        objectives: [
          { kind: 'rescue', text: 'Rescue', survivors: ['a', 'b'] },
          { kind: 'deliver', text: 'Deliver', pad: 'hospital' },
        ],
      }),
    );
    m.notifyRescued('a');
    m.notifyRescued('a');
    expect(m.onboard).toBe(1);
    m.update(0.1, snap({ landed: false, agl: 10 }));
    expect(m.index).toBe(0);
    m.notifyRescued('b');
    m.update(0.1, snap({ landed: false, agl: 10 }));
    expect(m.index).toBe(1);
    expect(m.capacityLeft).toBe(2);
    const events = [];
    for (let i = 0; i < 40; i++) events.push(...m.update(0.1, snap({ padId: 'hospital' })));
    expect(events.filter((e) => e.type === 'passengerUnloaded')).toHaveLength(2);
    expect(m.status).toBe('complete');
    expect(m.delivered).toBe(2);
  });

  it('fails when the aircraft is destroyed or time runs out', () => {
    const a = new MissionRunner(def({ objectives: [{ kind: 'takeoff', text: 'Up' }] }));
    expect(a.update(0.1, snap({ destroyed: true }))[0]).toMatchObject({ type: 'failed' });
    const b = new MissionRunner(def({ timeLimit: 1, objectives: [{ kind: 'takeoff', text: 'Up' }] }));
    b.update(0.6, snap());
    b.update(0.6, snap());
    expect(b.status).toBe('failed');
    expect(b.failReason).toBe('Out of time');
  });
});
