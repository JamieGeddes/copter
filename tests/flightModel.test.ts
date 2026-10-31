import { describe, expect, it } from 'vitest';
import { FlightEnvironment, FlightInput, FlightModel } from '../src/heli/FlightModel';
import { KESTREL } from '../src/heli/HeliSpec';
import { Solid } from '../src/world/collision';

const DT = 1 / 120;
const IDLE: FlightInput = { moveX: 0, moveZ: 0, climb: 0 };

const flatEnv = (solids: Solid[] = [], slope = 0): FlightEnvironment => ({
  groundHeightAt: (x, z) => {
    let h = 0;
    for (const s of solids) {
      if (s.landable && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) h = Math.max(h, s.top);
    }
    return h;
  },
  slopeAt: () => slope,
  solids,
  bounds: { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 },
});

const run = (m: FlightModel, seconds: number, input: FlightInput, env: FlightEnvironment) => {
  const events = [];
  for (let t = 0; t < seconds; t += DT) events.push(...m.step(DT, input, env));
  return events;
};

const airborne = (env = flatEnv(), altitude = 20): FlightModel => {
  const m = new FlightModel(KESTREL);
  m.place(0, 0, 0);
  m.spool = 1;
  run(m, altitude / KESTREL.climbRate + 1.5, { ...IDLE, climb: 1 }, env);
  run(m, 2, IDLE, env);
  return m;
};

describe('FlightModel', () => {
  it('cannot lift off until the rotor has spooled up', () => {
    const m = new FlightModel(KESTREL);
    m.place(0, 0, 0);
    const env = flatEnv();
    run(m, 0.5, { ...IDLE, climb: 1 }, env);
    expect(m.landed).toBe(true);
    const events = run(m, 4, { ...IDLE, climb: 1 }, env);
    expect(events.some((e) => e.type === 'takeoff')).toBe(true);
    expect(m.y).toBeGreaterThan(1);
  });

  it('holds altitude when the collective is released', () => {
    const m = airborne();
    const before = m.y;
    run(m, 5, IDLE, flatEnv());
    expect(Math.abs(m.y - before)).toBeLessThan(0.05);
  });

  it('accelerates towards the stick direction and respects top speed', () => {
    const m = airborne();
    run(m, 20, { moveX: 1, moveZ: 0, climb: 0 }, flatEnv());
    expect(m.vx).toBeGreaterThan(KESTREL.maxSpeed * 0.95);
    expect(m.vx).toBeLessThanOrEqual(KESTREL.maxSpeed + 1e-6);
    expect(Math.abs(m.vz)).toBeLessThan(0.01);
  });

  it('turns the nose to face the direction of travel', () => {
    const m = airborne();
    run(m, 6, { moveX: 0, moveZ: -1, climb: 0 }, flatEnv());
    expect(Math.abs(Math.abs(m.heading) - Math.PI)).toBeLessThan(0.05);
  });

  it('drifts to a stop after the stick is released', () => {
    const m = airborne();
    run(m, 4, { moveX: 1, moveZ: 0, climb: 0 }, flatEnv());
    run(m, 6, IDLE, flatEnv());
    expect(m.groundSpeed).toBeLessThan(0.5);
  });

  it('lands gently without damage', () => {
    const m = airborne(flatEnv(), 6);
    const events = run(m, 15, { ...IDLE, climb: -0.3 }, flatEnv());
    expect(m.landed).toBe(true);
    expect(events.some((e) => e.type === 'landed')).toBe(true);
    expect(m.damage).toBe(0);
  });

  it('cushions a full-descent landing so holding the key settles gently', () => {
    const m = airborne(flatEnv(), 30);
    const events = run(m, 15, { ...IDLE, climb: -1 }, flatEnv());
    expect(m.landed).toBe(true);
    expect(events.some((e) => e.type === 'hardLanding')).toBe(false);
  });

  it('records a hard landing when touching down too fast', () => {
    const m = airborne(flatEnv(), 5);
    m.y = 0.02;
    m.vy = -(KESTREL.safeSinkRate + 2);
    const events = m.step(DT, IDLE, flatEnv());
    expect(events.some((e) => e.type === 'hardLanding')).toBe(true);
    expect(m.damage).toBeGreaterThan(0);
    expect(m.destroyed).toBe(false);
  });

  it('records a hard landing when sliding on at speed', () => {
    const m = airborne(flatEnv(), 3);
    run(m, 4, { moveX: 1, moveZ: 0, climb: 0 }, flatEnv());
    const events = run(m, 6, { moveX: 1, moveZ: 0, climb: -1 }, flatEnv());
    expect(events.some((e) => e.type === 'hardLanding' || e.type === 'crashed')).toBe(true);
  });

  it('is destroyed when it hits the ground at crash speed', () => {
    const m = airborne(flatEnv(), 5);
    m.y = 0.05;
    m.vy = -(KESTREL.crashSpeed + 1);
    const events = m.step(DT, { ...IDLE, climb: -1 }, flatEnv());
    expect(events.some((e) => e.type === 'crashed')).toBe(true);
    expect(m.destroyed).toBe(true);
  });

  it('rolls over when landing on steep ground', () => {
    const m = airborne(flatEnv([], 0.5), 5);
    const events = run(m, 15, { ...IDLE, climb: -0.3 }, flatEnv([], 0.5));
    expect(events.some((e) => e.type === 'crashed')).toBe(true);
  });

  it('lands on a rooftop', () => {
    const roof: Solid = { minX: -10, maxX: 10, minZ: -10, maxZ: 10, top: 8, landable: true };
    const m = new FlightModel(KESTREL);
    m.place(0, 20, 0);
    m.landed = false;
    m.spool = 1;
    run(m, 10, { ...IDLE, climb: -0.3 }, flatEnv([roof]));
    expect(m.landed).toBe(true);
    expect(m.y).toBeCloseTo(8, 5);
    expect(m.damage).toBe(0);
  });

  it('is pushed out of a wall and damaged by the impact', () => {
    const wall: Solid = { minX: 20, maxX: 40, minZ: -50, maxZ: 50, top: 60, landable: false };
    const m = airborne(flatEnv([wall]), 10);
    const events = run(m, 4, { moveX: 1, moveZ: 0, climb: 0 }, flatEnv([wall]));
    expect(m.x).toBeLessThan(20 - KESTREL.bodyRadius + 0.01);
    expect(events.some((e) => e.type === 'collision' || e.type === 'crashed')).toBe(true);
  });

  it('stays within the level bounds', () => {
    const env = { ...flatEnv(), bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } };
    const m = airborne(env);
    run(m, 20, { moveX: 1, moveZ: 1, climb: 0 }, env);
    expect(m.x).toBeLessThanOrEqual(100);
    expect(m.z).toBeLessThanOrEqual(100);
  });

  it('burns fuel in flight and descends when it runs dry', () => {
    const m = airborne();
    const before = m.fuel;
    run(m, 10, IDLE, flatEnv());
    expect(m.fuel).toBeLessThan(before);
    m.fuel = 0.0001;
    const y = m.y;
    const events = run(m, 3, IDLE, flatEnv());
    expect(events.some((e) => e.type === 'fuelEmpty')).toBe(true);
    expect(m.y).toBeLessThan(y);
  });

  it('refuels and repairs when serviced', () => {
    const m = new FlightModel(KESTREL);
    m.fuel = 0.5;
    m.damage = 0.5;
    m.service(1, 0.25, 0.1);
    expect(m.fuel).toBeCloseTo(0.75);
    expect(m.damage).toBeCloseTo(0.4);
  });
});

describe('FlightModel environment', () => {
  it('drifts downwind when the stick is centred', () => {
    const env = { ...flatEnv(), wind: { x: 6, z: 0 } };
    const m = airborne(env);
    const x0 = m.x;
    run(m, 10, IDLE, env);
    expect(m.x).toBeGreaterThan(x0 + 5);
  });

  it('can hold position into the wind', () => {
    const env = { ...flatEnv(), wind: { x: 6, z: 0 } };
    const m = airborne(env);
    run(m, 5, IDLE, env);
    // A small lean into the wind cancels the drift.
    run(m, 10, { moveX: -6 / KESTREL.maxSpeed, moveZ: 0, climb: 0 }, env);
    expect(Math.abs(m.vx)).toBeLessThan(0.5);
  });

  it('ditches when it touches water', () => {
    const env = { ...flatEnv(), isWater: () => true };
    const m = airborne(env, 5);
    const events = run(m, 15, { ...IDLE, climb: -0.3 }, env);
    expect(events.some((e) => e.type === 'crashed' && e.reason.includes('Ditched'))).toBe(true);
  });
});
