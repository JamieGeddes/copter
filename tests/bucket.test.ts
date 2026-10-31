import { describe, expect, it } from 'vitest';
import { Bucket, BucketEnv, BucketEvent, BucketHook, DROP_SECONDS, FILL_SECONDS, sprayRadius, sprayStrength } from '../src/missions/Bucket';

const DT = 1 / 60;
const ROPE = 10;

/** Land for x < 0, a lake at level 0 for x >= 0. */
const env: BucketEnv = {
  groundHeightAt: (x) => (x < 0 ? 1 : -3),
  isWater: (x) => x >= 0,
  waterLevel: 0,
};

const hookAt = (over: Partial<BucketHook> = {}): BucketHook => ({
  x: 20,
  y: 10,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  groundSpeed: 0,
  mass: 2600,
  ...over,
});

const run = (b: Bucket, seconds: number, hook: BucketHook, e = env) => {
  const events: BucketEvent[] = [];
  const sprays = [];
  for (let t = 0; t < seconds; t += DT) {
    const r = b.update(DT, hook, e);
    events.push(...r.events);
    if (r.spray) sprays.push(r.spray);
  }
  return { events, sprays };
};

describe('Bucket', () => {
  it('hangs from the hook on its rope', () => {
    const b = new Bucket(ROPE);
    const hook = hookAt({ y: 30 });
    b.attach(hook, env);
    run(b, 5, hook);
    expect(Math.hypot(b.x - hook.x, b.y - hook.y, b.z - hook.z)).toBeCloseTo(ROPE, 0);
    expect(b.liftedMass).toBe(b.mass);
  });

  it('fills in about two seconds when dipped in water', () => {
    const b = new Bucket(ROPE);
    const hook = hookAt({ y: 9 });
    b.attach(hook, env);
    const r = run(b, FILL_SECONDS * 0.7, hook);
    expect(b.fill).toBeGreaterThan(0.5);
    expect(b.fill).toBeLessThan(1);
    expect(b.hint).toBe('dipping');
    const r2 = run(b, FILL_SECONDS, hook);
    expect(b.fill).toBe(1);
    expect([...r.events, ...r2.events].filter((e) => e.type === 'filled')).toHaveLength(1);
  });

  it('does not fill over land or when pulled through the water too fast', () => {
    const land = new Bucket(ROPE);
    const h1 = hookAt({ x: -20, y: 9 });
    land.attach(h1, env);
    run(land, 4, h1);
    expect(land.fill).toBe(0);

    const fast = new Bucket(ROPE);
    const h2 = hookAt({ y: 9, groundSpeed: 15 });
    fast.attach(h2, env);
    run(fast, 4, h2);
    expect(fast.fill).toBe(0);
    expect(fast.hint).toBe('tooFast');
  });

  it('does not fill while the bucket hangs above the water', () => {
    const b = new Bucket(ROPE);
    const hook = hookAt({ y: 25 });
    b.attach(hook, env);
    run(b, 4, hook);
    expect(b.fill).toBe(0);
  });

  it('adds the weight of the water to what the aircraft lifts', () => {
    const b = new Bucket(ROPE);
    const hook = hookAt({ y: 9 });
    b.attach(hook, env);
    run(b, 3, hook);
    const full = b.mass;
    expect(full).toBeGreaterThan(1000);
    // Resting on the water, nothing is lifted until the line comes tight.
    run(b, 3, hookAt({ y: 30 }));
    expect(b.liftedMass).toBe(full);
  });

  it('cannot drop an empty bucket', () => {
    const b = new Bucket(ROPE);
    expect(b.drop()).toBe(false);
  });

  it('empties over a couple of seconds as a spray', () => {
    const b = new Bucket(ROPE);
    const wet = hookAt({ y: 9 });
    b.attach(wet, env);
    run(b, 3, wet);
    const up = hookAt({ x: -10, y: 25 });
    run(b, 6, up);
    expect(b.drop()).toBe(true);
    const { events, sprays } = run(b, DROP_SECONDS + 1, up);
    expect(b.fill).toBe(0);
    expect(b.dropping).toBe(false);
    expect(events.some((e) => e.type === 'dropEnd')).toBe(true);
    expect(sprays.length * DT).toBeGreaterThan(DROP_SECONDS * 0.9);
    expect(sprays.length * DT).toBeLessThan(DROP_SECONDS + 0.2);
    expect(b.delivered).toBeCloseTo(1, 1);
    expect(sprays[0].groundY).toBe(1);
  });

  it('spreads a high drop thinner and wider than a low one', () => {
    expect(sprayRadius(30)).toBeGreaterThan(sprayRadius(5));
    expect(sprayStrength(sprayRadius(30))).toBeLessThan(sprayStrength(sprayRadius(5)));
  });

  it('pulls the aircraft back when swinging', () => {
    const b = new Bucket(ROPE);
    let hook = hookAt({ x: -40, y: 25 });
    b.attach(hook, env);
    let pull = 0;
    for (let t = 0; t < 4; t += DT) {
      hook = { ...hook, x: hook.x + 15 * DT, vx: 15, groundSpeed: 15 };
      pull += Math.abs(b.update(DT, hook, env).dvx);
    }
    expect(pull).toBeGreaterThan(0);
  });
});
