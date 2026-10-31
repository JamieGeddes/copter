import { describe, expect, it } from 'vitest';
import { CargoDef, CargoEnv, CargoEvent, CargoSystem, HookState, SLING_APEX } from '../src/missions/Cargo';
import { Solid } from '../src/world/collision';

const DT = 1 / 120;
const ROPE = 14;

const box: CargoDef = { id: 'box', kind: 'pallet', label: 'Pallet', x: 0, z: 0, heading: 0, mass: 2000, w: 2, h: 1.5, d: 2 };
const girder: CargoDef = { id: 'g', kind: 'girder', label: 'Girder', x: 0, z: 0, heading: 0, mass: 4000, w: 3, h: 1.5, d: 24 };

const flat = (over: Partial<CargoEnv> = {}): CargoEnv => ({
  groundHeightAt: () => 0,
  isWater: () => false,
  solids: [],
  ...over,
});

const hookAt = (over: Partial<HookState> = {}): HookState => ({
  x: 0,
  y: 10,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  heading: 0,
  groundSpeed: 0,
  landed: false,
  mass: 11000,
  ...over,
});

const run = (sys: CargoSystem, seconds: number, hook: (t: number) => HookState | null, env = flat()) => {
  const events: CargoEvent[] = [];
  let dvx = 0;
  for (let t = 0; t < seconds; t += DT) {
    const r = sys.update(DT, hook(t), env);
    events.push(...r.events);
    dvx += r.dvx;
  }
  return { events, dvx };
};

/** Hooks the box and lifts it to hang freely beneath a hook at `y`. */
const lifted = (y = 30, def = box) => {
  const sys = new CargoSystem([def], flat(), ROPE);
  run(sys, 1.3, () => hookAt({ y: def.h + SLING_APEX + 6 }));
  expect(sys.hooked?.def.id).toBe(def.id);
  run(sys, 6, () => hookAt({ y }));
  return sys;
};

describe('CargoSystem', () => {
  it('hooks up after a steady hover within range', () => {
    const sys = new CargoSystem([box], flat(), ROPE);
    const { events } = run(sys, 1.3, () => hookAt({ y: 9 }));
    expect(events).toContainEqual({ type: 'hooked', id: 'box' });
    expect(sys.hint).toBe('carrying');
  });

  it('explains why it will not hook', () => {
    const sys = new CargoSystem([box], flat(), ROPE);
    run(sys, 0.1, () => hookAt({ y: 40 }));
    expect(sys.hint).toBe('tooHigh');
    run(sys, 0.1, () => hookAt({ y: 3 }));
    expect(sys.hint).toBe('tooLow');
    run(sys, 0.1, () => hookAt({ x: 8 }));
    expect(sys.hint).toBe('closer');
    run(sys, 0.1, () => hookAt({ groundSpeed: 5 }));
    expect(sys.hint).toBe('tooFast');
    expect(sys.hooked).toBeUndefined();
  });

  it('hangs a rope length below the hook once lifted', () => {
    const sys = lifted(30);
    const item = sys.items[0];
    expect(item.resting).toBe(false);
    expect(30 - item.liftY).toBeCloseTo(ROPE, 0);
    expect(Math.abs(item.x)).toBeLessThan(0.2);
    expect(sys.liftedMass).toBe(box.mass);
  });

  it('swings ahead when the aircraft stops suddenly', () => {
    const sys = lifted(30);
    // Fly at 15 m/s, then stop dead.
    run(sys, 4, (t) => hookAt({ y: 30, x: 15 * t, vx: 15, groundSpeed: 15 }));
    const stopX = 60;
    run(sys, 0.8, () => hookAt({ y: 30, x: stopX }));
    expect(sys.items[0].x).toBeGreaterThan(stopX + 1);
  });

  it('pulls the aircraft towards a swinging load', () => {
    const sys = lifted(30);
    sys.items[0].vx = 8;
    const { dvx } = run(sys, 0.5, () => hookAt({ y: 30 }));
    expect(dvx).toBeGreaterThan(0);
  });

  it('settles a swing over time', () => {
    const sys = lifted(30);
    sys.items[0].vx = 6;
    run(sys, 20, () => hookAt({ y: 30 }));
    expect(Math.abs(sys.items[0].x)).toBeLessThan(0.6);
  });

  it('sets down gently without damage and comes to rest after release', () => {
    const sys = lifted(30);
    const floor = box.h + SLING_APEX + 4;
    run(sys, 14, (t) => (30 - 2 * t > floor ? hookAt({ y: 30 - 2 * t, vy: -2 }) : hookAt({ y: floor })));
    const e = sys.release();
    expect(e).toEqual({ type: 'released', id: 'box' });
    run(sys, 1, () => hookAt({ y: 20 }));
    expect(sys.items[0].resting).toBe(true);
    expect(sys.items[0].damage).toBe(0);
  });

  it('is damaged when dropped from height', () => {
    const sys = lifted(30);
    sys.release();
    const { events } = run(sys, 4, () => hookAt({ y: 30 }));
    expect(events.some((e) => e.type === 'impact')).toBe(true);
    expect(sys.items[0].damage).toBeGreaterThan(0.3);
  });

  it('is lost when it falls in the water', () => {
    const env = flat({ isWater: () => true, seaLevel: 0, groundHeightAt: () => 0 });
    const sys = lifted(30);
    sys.release();
    const { events } = run(sys, 4, () => null, env);
    expect(events).toContainEqual({ type: 'lost', id: 'box' });
  });

  it('rests on two supports across water', () => {
    // Piers under each end, water in between.
    const piers: Solid[] = [
      { minX: -3, maxX: 3, minZ: -13, maxZ: -9, top: 5, landable: true },
      { minX: -3, maxX: 3, minZ: 9, maxZ: 13, top: 5, landable: true },
    ];
    const onPier = (x: number, z: number) => piers.some((p) => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ);
    const env = flat({
      solids: piers,
      seaLevel: 0,
      isWater: (x, z) => !onPier(x, z),
      groundHeightAt: (x, z) => (onPier(x, z) ? 5 : 0),
    });
    const sys = new CargoSystem([{ ...girder, z: 300 }], flat(), ROPE);
    const item = sys.items[0];
    item.x = 0;
    item.z = 0;
    item.y = 7;
    item.resting = false;
    run(sys, 2, () => null, env);
    expect(item.lost).toBe(false);
    expect(item.resting).toBe(true);
    expect(item.y).toBeCloseTo(5);
  });

  it('is damaged by dragging along the ground', () => {
    const sys = new CargoSystem([box], flat(), ROPE);
    run(sys, 1.3, () => hookAt({ y: 9 }));
    // Fly away low so the rope drags the load across the ground.
    run(sys, 4, (t) => hookAt({ y: 9, x: 10 * t, vx: 10, groundSpeed: 10 }));
    expect(sys.items[0].damage).toBeGreaterThan(0);
  });

  it('cannot hook delivered loads', () => {
    const sys = new CargoSystem([box], flat(), ROPE);
    sys.items[0].fixed = true;
    run(sys, 2, () => hookAt({ y: 9 }));
    expect(sys.hooked).toBeUndefined();
  });
});
