import { describe, expect, it } from 'vitest';
import { LIFELINE } from '../src/heli/HeliSpec';
import { NIGHT_MEDEVAC } from '../src/levels/nightMedevac';
import { HANDOVER_SECONDS, IDLE_CALL_DELAY, LOAD_SECONDS, Medevac, MedevacAircraft, MedevacEvent } from '../src/missions/Medevac';
import { MissionRunner, MissionSnapshot } from '../src/missions/MissionRunner';
import { lampPositions } from '../src/render/night';
import { CasualtyDef, MissionDef } from '../src/missions/types';
import { planCity, riverGap } from '../src/world/cityPlan';
import { pointInSolid } from '../src/world/collision';
import { LevelDef } from '../src/world/level';
import { Terrain } from '../src/world/Terrain';
import { Traffic } from '../src/world/Traffic';
import { World } from '../src/world/World';

const DT = 0.1;

const casualty = (id: string, x: number, over: Partial<CasualtyDef> = {}): CasualtyDef => ({
  id,
  label: id,
  severity: 'critical',
  care: 'trauma',
  hospital: 'trauma',
  x,
  z: 0,
  radius: 10,
  callAt: 0,
  timer: 100,
  golden: 60,
  ...over,
});

const AIR: MedevacAircraft = { x: 500, z: 500, landed: false };
const at = (x: number, z = 0, padId?: string): MedevacAircraft => ({ x, z, landed: true, padId });

/** Runs the queue for `seconds` with the aircraft held in one state. */
const hold = (m: Medevac, seconds: number, heli: MedevacAircraft): MedevacEvent[] => {
  const events: MedevacEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) events.push(...m.update(DT, heli));
  return events;
};

describe('casualty queue', () => {
  it('takes calls on schedule, or early once the crew has nothing to do', () => {
    const m = new Medevac([casualty('a', 0), casualty('b', 100, { callAt: 60 })]);
    expect(hold(m, DT, AIR)).toEqual([{ type: 'call', id: 'a' }]);
    hold(m, 30, AIR);
    expect(m.status('b').state).toBe('pending');
    // Pick up and hand over the first casualty, then wait with nothing to do.
    hold(m, LOAD_SECONDS + 0.2, at(0));
    hold(m, HANDOVER_SECONDS + 0.2, at(900, 900, 'trauma'));
    expect(m.status('a').state).toBe('delivered');
    const events = hold(m, IDLE_CALL_DELAY + 0.2, AIR);
    expect(events).toContainEqual({ type: 'call', id: 'b' });
    expect(m.clock).toBeLessThan(60);
  });

  it('loads a casualty only while landed inside the cordon, starting again after a lift-off', () => {
    const m = new Medevac([casualty('a', 0)]);
    hold(m, LOAD_SECONDS + 1, { x: 0, z: 0, landed: false });
    expect(m.status('a').state).toBe('waiting');
    hold(m, LOAD_SECONDS + 1, at(15));
    expect(m.status('a').state).toBe('waiting');
    hold(m, LOAD_SECONDS * 0.6, at(5));
    expect(m.status('a').state).toBe('loading');
    expect(m.hint).toBe('loading');
    hold(m, DT, AIR);
    expect(m.status('a').progress).toBe(0);
    const events = hold(m, LOAD_SECONDS + 0.2, at(5));
    expect(events).toContainEqual({ type: 'loaded', id: 'a' });
    expect(m.aboard?.def.id).toBe('a');
  });

  it('carries one casualty at a time', () => {
    const m = new Medevac([casualty('a', 0), casualty('b', 40)]);
    hold(m, IDLE_CALL_DELAY + 0.2, AIR);
    hold(m, LOAD_SECONDS + 0.2, at(0));
    hold(m, 0.2, AIR);
    hold(m, IDLE_CALL_DELAY + 0.5, AIR);
    hold(m, LOAD_SECONDS + 1, at(40));
    expect(m.status('b').state).toBe('waiting');
    expect(m.hint).toBe('occupied');
  });

  it('only hands over at the right hospital, warning once per landing at the wrong one', () => {
    const m = new Medevac([casualty('a', 0, { care: 'burns', hospital: 'burns' }), casualty('b', 50)]);
    hold(m, LOAD_SECONDS + 0.2, at(0));
    const wrong = hold(m, 5, at(900, 0, 'trauma'));
    expect(wrong.filter((e) => e.type === 'wrongHospital')).toHaveLength(1);
    expect(m.hint).toBe('wrongHospital');
    hold(m, DT, AIR);
    expect(hold(m, 1, at(900, 0, 'trauma')).filter((e) => e.type === 'wrongHospital')).toHaveLength(1);
    // A pad that is not a hospital is just a pad.
    expect(hold(m, 1, at(900, 0, 'base')).some((e) => e.type === 'wrongHospital')).toBe(false);
    const events = hold(m, HANDOVER_SECONDS + 0.2, at(-900, 0, 'burns'));
    expect(events.find((e) => e.type === 'delivered')).toMatchObject({ id: 'a' });
  });

  it('loses a casualty whose timer runs out before the handover begins', () => {
    const m = new Medevac([casualty('a', 0, { timer: 30 })]);
    hold(m, LOAD_SECONDS + 0.2, at(0));
    const events = hold(m, 30, AIR);
    expect(events).toContainEqual({ type: 'lost', id: 'a' });
    expect(m.lost?.def.id).toBe('a');
  });

  it('stops the clock during the handover and starts it again if the aircraft lifts off', () => {
    const m = new Medevac([casualty('a', 0, { timer: 20 })]);
    hold(m, LOAD_SECONDS + 0.2, at(0));
    hold(m, 1, at(900, 0, 'trauma'));
    const left = m.timeLeft(m.status('a'));
    hold(m, 0.5, at(900, 0, 'trauma'));
    expect(m.timeLeft(m.status('a'))).toBeCloseTo(left, 5);
    hold(m, 2, AIR);
    expect(m.status('a').state).toBe('aboard');
    expect(m.timeLeft(m.status('a'))).toBeCloseTo(left - 2, 0);
  });

  it('counts handovers inside the golden hour', () => {
    const m = new Medevac([casualty('a', 0, { golden: 10 }), casualty('b', 50, { golden: 10, callAt: 1 })]);
    hold(m, LOAD_SECONDS + 0.2, at(0));
    const quick = hold(m, HANDOVER_SECONDS + 0.2, at(900, 0, 'trauma'));
    expect(quick.find((e) => e.type === 'delivered')).toMatchObject({ golden: true });
    hold(m, 15, AIR);
    hold(m, LOAD_SECONDS + 0.2, at(50));
    const slow = hold(m, HANDOVER_SECONDS + 0.2, at(900, 0, 'trauma'));
    expect(slow.find((e) => e.type === 'delivered')).toMatchObject({ golden: false });
    expect(m.golden).toBe(1);
    expect(m.done).toBe(true);
  });
});

const snap = (over: Partial<MissionSnapshot> = {}): MissionSnapshot => ({
  x: 500,
  y: 0,
  z: 500,
  agl: 20,
  groundSpeed: 0,
  landed: false,
  destroyed: false,
  groundY: 0,
  ...over,
});

const medevacMission = (casualties: CasualtyDef[]): MissionDef => ({
  id: 't',
  title: 'Test',
  summary: '',
  skill: '',
  briefing: [],
  objectives: [{ kind: 'casualties', text: 'Answer every call', casualties: casualties.map((c) => c.id) }],
  medals: { gold: 60, silver: 120 },
  casualties,
});

describe('casualties objective', () => {
  const step = (r: MissionRunner, seconds: number, s: Partial<MissionSnapshot>) => {
    const events = [];
    for (let t = 0; t < seconds - 1e-9; t += DT) events.push(...r.update(DT, snap(s)));
    return events;
  };

  it('points at the right hospital while a casualty is aboard and completes once all are delivered', () => {
    const r = new MissionRunner(medevacMission([casualty('a', 0, { hospital: 'burns' })]));
    step(r, 1, {});
    expect(r.targetPad).toBeUndefined();
    const loaded = step(r, LOAD_SECONDS + 0.2, { x: 0, z: 0, landed: true });
    expect(loaded).toContainEqual({ type: 'casualty', event: { type: 'loaded', id: 'a' } });
    expect(r.targetPad).toBe('burns');
    const done = step(r, HANDOVER_SECONDS + 0.3, { landed: true, padId: 'burns' });
    expect(done.some((e) => e.type === 'complete')).toBe(true);
    expect(r.progress).toBe(1);
  });

  it('fails the mission when a casualty is lost', () => {
    const r = new MissionRunner(medevacMission([casualty('a', 0, { timer: 20, label: 'Motorway collision' })]));
    const events = step(r, 25, {});
    expect(r.status).toBe('failed');
    expect(events).toContainEqual({ type: 'failed', reason: 'Casualty lost: Motorway collision' });
  });
});

describe('traffic', () => {
  const road: [number, number][] = [
    [0, 0],
    [400, 0],
  ];

  it('keeps left and keeps its distance', () => {
    const t = new Traffic([road], [], 3, 20);
    for (let i = 0; i < 600; i++) t.update(0.1);
    const loop = t.loops[0];
    const s = t.cars.map((c) => c.s).sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThan(5);
    // Driving towards +x, the left of the road is -z.
    const out = t.poseAt(loop, 100);
    expect(out.z).toBeLessThan(0);
    const back = t.poseAt(loop, loop.length * 2 - 100);
    expect(back.z).toBeGreaterThan(0);
  });

  it('queues behind a closed stretch of road and moves off when it reopens', () => {
    const t = new Traffic([road], [], 3, 20);
    const i = t.addClosure(200, 0, 15);
    t.closures[i].active = true;
    for (let k = 0; k < 900; k++) t.update(0.1);
    for (const car of t.cars) {
      const p = t.pose(car);
      expect(Math.abs(p.x - 200)).toBeGreaterThan(15 + 4);
    }
    expect(t.cars.every((c) => c.v < 0.5)).toBe(true);
    t.closures[i].active = false;
    for (let k = 0; k < 50; k++) t.update(0.1);
    expect(t.cars.some((c) => c.v > 5)).toBe(true);
  });
});

/** A flat city world with the given buildings and wind. */
const flatCity = (extra: Partial<LevelDef>): World => {
  const terrain = new Terrain(400, 4, 'city');
  terrain.heights.fill(3);
  const level = {
    ...NIGHT_MEDEVAC,
    wind: { direction: 0, speed: 8, gust: 0, channel: 0.8 },
    buildings: [],
    pads: [],
    roads: [],
    motorways: [],
    crowds: [],
    scatter: {},
    clearings: [],
    cableways: undefined,
    ...extra,
  } as LevelDef;
  return new World(level, terrain);
};

describe('wind between towers', () => {
  // Wind blowing towards +z, along a street between two towers either side of x = 0.
  const tower = (x: number, z: number) => ({ kind: 'tower' as const, x, z, w: 20, d: 40, h: 60 });

  it('speeds up and gusts in a street between towers', () => {
    const w = flatCity({ buildings: [tower(-22, 0), tower(22, 0)] });
    const open = flatCity({});
    const between = w.windAt(0, 0, 20);
    expect(Math.hypot(between.x, between.z)).toBeGreaterThan(Math.hypot(open.windAt(0, 0, 20).z, 0) * 1.25);
    expect(between.turbulence).toBeGreaterThan(0.3);
    // Above the rooftops the wind is the open wind.
    const high = w.windAt(0, 0, 80);
    expect(high.z).toBeCloseTo(open.windAt(0, 0, 80).z, 5);
  });

  it('drops in the lee of a tower', () => {
    const w = flatCity({ buildings: [tower(0, 0)] });
    const lee = w.windAt(0, 35, 20);
    expect(Math.hypot(lee.x, lee.z)).toBeLessThan(w.wind!.speed * 0.8);
    expect(lee.turbulence).toBeGreaterThan(0.2);
  });
});

describe('power lines and crane jibs', () => {
  const w = flatCity({
    buildings: [
      { kind: 'powerPylon', x: 0, z: 0, w: 6, d: 6, h: 30 },
      { kind: 'powerPylon', x: 0, z: 200, w: 6, d: 6, h: 30 },
    ],
    cableways: [
      { kind: 'power', points: [{ x: 0, z: 0 }, { x: 0, z: 200 }] },
      { kind: 'jib', points: [{ x: 100, z: 0, y: 60 }, { x: 150, z: 0, y: 60 }] },
    ],
  });

  it('strikes the rotor on any of the three conductors, sagging between the pylons', () => {
    // Pylon tops at 33 m, less 0.6, sagging 5 m at mid-span.
    expect(w.wireStrike(0, 27.4, 100, 5)?.kind).toBe('power');
    expect(w.wireStrike(8, 27.4, 100, 5)?.kind).toBe('power');
    expect(w.wireStrike(12, 27.4, 100, 5)).toBeUndefined();
    expect(w.wireStrike(0, 32.4, 100, 5)).toBeUndefined();
  });

  it('strikes a rotor that reaches a crane jib, which does not sag', () => {
    expect(w.wireStrike(125, 60, 4, 5)?.kind).toBe('jib');
    expect(w.wireStrike(125, 63, 4, 5)).toBeUndefined();
  });

  it('warns of a wire ahead at rotor height', () => {
    const near = w.nearestWire(20, 27.4, 100, 5, 30);
    expect(near?.distance).toBeCloseTo(20 - 5 - 4.5, 0);
    expect(near?.dirX).toBeLessThan(-0.9);
    expect(w.nearestWire(20, 60, 100, 5, 30)).toBeUndefined();
  });
});

describe('city plan', () => {
  const world = new World(NIGHT_MEDEVAC);
  const t = NIGHT_MEDEVAC.terrain;
  if (t.kind !== 'city') throw new Error('Varrow should be a city');
  const plan = planCity({
    seed: 606,
    ground: 3,
    lines: [-405, -315, -225, -135, -45, 45, 135, 225, 315, 405],
    reach: 40,
    streetHalf: 6,
    river: t.river,
    riverClearance: 8,
    bridges: [-45],
    motorwayZ: 380,
    motorwayHalf: 12,
    centre: { x: 0, z: -200 },
    peak: 70,
    spread: 200,
    reserved: [{ minX: 100, maxX: 200, minZ: -300, maxZ: -200 }],
    keepClear: [{ x: -300, z: -300, radius: 30 }],
  });

  it('builds nothing in the river, on reserved ground or in kept-clear circles', () => {
    for (const b of plan.buildings) {
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) expect(riverGap(t.river, b.x + (dx * b.w) / 2, b.z + (dz * b.d) / 2)).toBeGreaterThan(7);
      expect(b.x + b.w / 2 <= 100 || b.x - b.w / 2 >= 200 || b.z + b.d / 2 <= -300 || b.z - b.d / 2 >= -200).toBe(true);
      expect(Math.hypot(Math.max(Math.abs(b.x + 300) - b.w / 2, 0), Math.max(Math.abs(b.z + 300) - b.d / 2, 0))).toBeGreaterThan(29);
    }
  });

  it('keeps streets out of the water except on the bridges, which span the river', () => {
    for (const road of plan.roads) {
      const [[ax, az], [bx, bz]] = road;
      for (let k = 0; k <= 1; k += 0.02) {
        const x = ax + (bx - ax) * k;
        const z = az + (bz - az) * k;
        if (riverGap(t.river, x, z) < 0) expect(plan.bridges.some((b) => Math.abs(b.x - x) < 1)).toBe(true);
      }
    }
    expect(plan.bridges).toHaveLength(1);
    const deck = plan.bridges[0];
    expect(riverGap(t.river, deck.x, deck.z - deck.d / 2)).toBeGreaterThan(0);
    expect(riverGap(t.river, deck.x, deck.z + deck.d / 2)).toBeGreaterThan(0);
  });

  it('builds towers downtown and houses on the edges', () => {
    const near = plan.buildings.filter((b) => Math.hypot(b.x, b.z + 200) < 150);
    const far = plan.buildings.filter((b) => Math.hypot(b.x, b.z + 200) > 450);
    expect(near.filter((b) => b.kind === 'tower').length).toBeGreaterThan(near.length / 2);
    expect(far.every((b) => b.kind !== 'tower')).toBe(true);
  });

  it('lets traffic drive across the bridges in Varrow', () => {
    const decks = world.buildings.filter((b) => b.kind === 'bridge');
    expect(decks.length).toBe(4);
    for (const d of decks) expect(world.groundHeightAt(d.x, d.z)).toBeGreaterThan(3);
  });
});

describe('Varrow balance', () => {
  const world = new World(NIGHT_MEDEVAC);
  const calls = NIGHT_MEDEVAC.mission.casualties!;
  const spec = LIFELINE;

  it('puts every scene on flat dry ground, or a roof, with room for the rotor', () => {
    for (const c of calls) {
      const y = world.groundHeightAt(c.x, c.z);
      // Anywhere in the zone the aircraft could land, the rotor clears every obstacle.
      for (let a = 0; a < 16; a++) {
        for (const r of [0, c.radius * 0.5, c.radius]) {
          const x = c.x + Math.sin((a / 16) * Math.PI * 2) * r;
          const z = c.z + Math.cos((a / 16) * Math.PI * 2) * r;
          expect(world.isWater(x, z)).toBe(false);
          expect(world.slopeAt(x, z), c.id).toBeLessThan(0.12);
          expect(Math.abs(world.groundHeightAt(x, z) - y), c.id).toBeLessThan(0.5);
          for (const s of world.solids) {
            if (s.top <= y + 0.5) continue;
            const dx = Math.max(s.minX - x, 0, x - s.maxX);
            const dz = Math.max(s.minZ - z, 0, z - s.maxZ);
            expect(Math.hypot(dx, dz), `${c.id} rotor vs obstacle`).toBeGreaterThan(spec.rotorRadius);
          }
          expect(world.nearestWire(x, y + spec.rotorHeight, z, spec.rotorRadius, 0, 40), c.id).toBeUndefined();
        }
      }
    }
  });

  it('sends casualties to both hospitals', () => {
    expect(new Set(calls.map((c) => c.hospital))).toEqual(new Set(['trauma', 'burns']));
    for (const c of calls) expect(world.pad(c.hospital).onBuilding).toBeDefined();
  });

  it('keeps the dark scene away from street lights and the scenes on the ground near lit roads', () => {
    const dark = calls.filter((c) => c.dark);
    expect(dark.length).toBeGreaterThan(0);
    const lamps = lampPositions(world, dark.map((c) => ({ x: c.x, z: c.z, radius: 80 })));
    const nearest = (c: CasualtyDef) => Math.min(...lamps.map((l) => Math.hypot(l.x - c.x, l.z - c.z)));
    for (const c of dark) expect(nearest(c)).toBeGreaterThan(60);
    for (const c of calls.filter((q) => !q.dark && world.groundHeightAt(q.x, q.z) < 10)) expect(nearest(c), c.id).toBeLessThan(90);
  });

  it('can be finished in time by a crew answering the calls in order', () => {
    // Cruise at 80% of top speed, 20 s to slow down and land at each stop.
    const cruise = spec.maxSpeed * 0.8;
    const land = 20;
    let x = world.pad('base').x;
    let z = world.pad('base').z;
    let t = 8;
    let lastDone = 0;
    let golden = 0;
    for (const c of [...calls].sort((a, b) => a.callAt - b.callAt)) {
      const called = Math.min(c.callAt, lastDone + IDLE_CALL_DELAY);
      t = Math.max(t, called);
      t += Math.hypot(c.x - x, c.z - z) / cruise + land + LOAD_SECONDS;
      const pad = world.pad(c.hospital);
      t += Math.hypot(pad.x - c.x, pad.z - c.z) / cruise + land;
      const used = t - called;
      expect(used, c.id).toBeLessThan(c.timer * 0.85);
      if (used <= c.golden) golden++;
      t += HANDOVER_SECONDS;
      lastDone = t;
      x = pad.x;
      z = pad.z;
    }
    expect(t).toBeLessThan(NIGHT_MEDEVAC.mission.medals.silver);
    expect(golden).toBeGreaterThanOrEqual(3);
  });

  it('overlaps the calls so routes have to be chosen', () => {
    const sorted = [...calls].sort((a, b) => a.callAt - b.callAt);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].callAt - sorted[i - 1].callAt).toBeLessThan(70);
  });

  it('marks the tallest obstacles near the routes with wires a pilot can be warned of', () => {
    expect(world.cables.filter((c) => c.kind === 'power').length).toBeGreaterThan(0);
    expect(world.cables.filter((c) => c.kind === 'jib').length).toBe(2);
    for (const pylon of world.buildings.filter((b) => b.kind === 'powerPylon')) {
      expect(world.solids.some((s) => pointInSolid(pylon.x, pylon.z, s) && s.top >= pylon.base + pylon.h - 0.01)).toBe(true);
    }
  });
});
