import { describe, expect, it } from 'vitest';
import { HAULER, MANTIS } from '../src/heli/HeliSpec';
import { axesFromKeys } from '../src/input/bindings';
import { SKY_CRANE } from '../src/levels/skyCrane';
import { AssembleObjective, assemblyFit, headingError, loadHitsPerson, seatHeight, SEAT_TOLERANCE } from '../src/missions/Assembly';
import { CargoDef, CargoEnv, CargoSystem, HookState, LOAD_YAW_RATE, SLING_APEX } from '../src/missions/Cargo';
import { CargoSnapshot, MissionEvent, MissionRunner, MissionSnapshot } from '../src/missions/MissionRunner';
import { MissionDef } from '../src/missions/types';
import { Solid } from '../src/world/collision';
import { CrowdSim } from '../src/world/CrowdSim';
import { World } from '../src/world/World';

const DT = 1 / 120;
const deg = (d: number) => (d * Math.PI) / 180;

const SECTION: CargoDef = { id: 's1', kind: 'mastSection', label: 'Section', x: 0, z: 0, heading: 0, mass: 3200, w: 2.6, h: 7, d: 2.6, windage: 0.06 };
const defs: CargoDef[] = [SECTION, { ...SECTION, id: 's2' }, { ...SECTION, id: 'top', kind: 'antenna', h: 5 }];

const MAST: AssembleObjective = {
  kind: 'assemble',
  text: 'Build the mast',
  label: 'Footing',
  x: 0,
  z: 0,
  y: 10,
  heading: 0,
  parts: [
    { cargo: 's1', radius: 0.6, headingTolerance: deg(6), seconds: 3 },
    { cargo: 's2', radius: 0.6, headingTolerance: deg(6), seconds: 3 },
  ],
};
const TOP: AssembleObjective = { ...MAST, text: 'Fit the top', y: 24, parts: [{ cargo: 'top', radius: 0.4, headingTolerance: deg(4), seconds: 4 }] };

const mission = (objectives = [MAST, TOP]): MissionDef => ({
  id: 't',
  title: 'T',
  summary: '',
  skill: '',
  briefing: [],
  objectives,
  medals: { gold: 100, silver: 200 },
  cargo: defs,
});

const load = (over: Partial<CargoSnapshot> = {}): CargoSnapshot => ({
  id: 's1',
  x: 0,
  y: 10,
  z: 0,
  heading: 0,
  resting: true,
  hooked: true,
  lost: false,
  destroyed: false,
  ...over,
});

const snap = (cargo: CargoSnapshot[]): MissionSnapshot => ({ x: 0, y: 40, z: 0, agl: 30, groundSpeed: 0, landed: false, destroyed: false, groundY: 10, cargo });

/** Runs the mission for `seconds` with the same snapshot, collecting events. */
const hold = (m: MissionRunner, seconds: number, cargo: CargoSnapshot[]): MissionEvent[] => {
  const events: MissionEvent[] = [];
  for (let t = 0; t < seconds; t += 0.1) events.push(...m.update(0.1, snap(cargo)));
  return events;
};

describe('assembly geometry', () => {
  it('measures heading error with the sign of the turn that fixes it, allowing for symmetry', () => {
    expect(headingError(0.2, 0)).toBeCloseTo(0.2);
    expect(headingError(-0.2, 0)).toBeCloseTo(-0.2);
    expect(headingError(Math.PI * 2 - 0.1, 0)).toBeCloseTo(-0.1);
    // A load facing the wrong way round is half a turn out, unless it is symmetric.
    expect(Math.abs(headingError(Math.PI, 0))).toBeCloseTo(Math.PI);
    expect(headingError(Math.PI / 2 + 0.05, 0, 4)).toBeCloseTo(0.05);
  });

  it('raises the seat by the height of each part in place', () => {
    expect(seatHeight(MAST, [], defs)).toBe(10);
    expect(seatHeight(MAST, ['s1'], defs)).toBe(17);
    expect(seatHeight(MAST, ['s1', 's2'], defs)).toBe(24);
  });

  it('only passes a part that is seated, in position and lined up', () => {
    const part = MAST.parts[0];
    const ok = { x: 0.3, y: 10, z: -0.3, heading: deg(4), resting: true };
    expect(assemblyFit(ok, part, MAST, 10).ok).toBe(true);
    const hanging = assemblyFit({ ...ok, y: 13, resting: false }, part, MAST, 10);
    expect(hanging).toMatchObject({ ok: false, seated: false, lateralOk: true, headingOk: true });
    expect(hanging.height).toBeCloseTo(3);
    expect(assemblyFit({ ...ok, x: 1 }, part, MAST, 10)).toMatchObject({ ok: false, lateralOk: false, seated: true });
    expect(assemblyFit({ ...ok, heading: deg(8) }, part, MAST, 10)).toMatchObject({ ok: false, headingOk: false });
    // Resting on something else just below the seat (a misaligned part caught on an edge) is not seated.
    expect(assemblyFit({ ...ok, y: 10 - SEAT_TOLERANCE * 2 }, part, MAST, 10).seated).toBe(false);
  });

  it('gives the offset from the load towards the seat', () => {
    const f = assemblyFit({ x: 2, y: 10, z: -1, heading: 0, resting: true }, MAST.parts[0], MAST, 10);
    expect(f.dx).toBeCloseTo(-2);
    expect(f.dz).toBeCloseTo(1);
  });
});

describe('assemble objective', () => {
  it('bolts a part on only after it has been held in tolerance for the full time', () => {
    const m = new MissionRunner(mission());
    expect(hold(m, 2.5, [load()])).toEqual([]);
    expect(m.progress).toBeGreaterThan(0.35);
    const events = hold(m, 0.8, [load()]);
    expect(events).toContainEqual({ type: 'partFixed', id: 's1', index: 1, total: 2, x: 0, y: 10, z: 0, heading: 0 });
    expect(m.assembled).toEqual(['s1']);
    expect(m.placed.has('s1')).toBe(true);
    expect(m.detail).toBe('In place: 1 of 2');
  });

  it('starts the bolting again if the part slips out of tolerance', () => {
    const m = new MissionRunner(mission());
    hold(m, 2.5, [load()]);
    hold(m, 0.1, [load({ x: 0.9 })]);
    expect(m.boltTimer).toBe(0);
    expect(hold(m, 2.5, [load()])).toEqual([]);
    expect(hold(m, 0.6, [load()]).some((e) => e.type === 'partFixed')).toBe(true);
  });

  it('will not bolt a part nobody is holding, or one still hanging', () => {
    const m = new MissionRunner(mission());
    expect(hold(m, 5, [load({ hooked: false })])).toEqual([]);
    expect(hold(m, 5, [load({ resting: false, y: 10.5 })])).toEqual([]);
    expect(m.assembled).toEqual([]);
  });

  it('stacks parts in any order, each on top of the last, then moves on to the next objective', () => {
    const m = new MissionRunner(mission());
    hold(m, 3.2, [load({ id: 's2' })]);
    expect(m.assembled).toEqual(['s2']);
    expect(m.seatY).toBe(17);
    expect(m.activeCargo).toEqual(['s1']);
    // Seated on the footing instead of on the first part: too low.
    expect(hold(m, 5, [load({ id: 's1', y: 10 })])).toEqual([]);
    const events = hold(m, 3.2, [load({ id: 's1', y: 17 })]);
    expect(events.find((e) => e.type === 'partFixed')).toMatchObject({ id: 's1', y: 17, index: 2 });
    expect(events.some((e) => e.type === 'objectiveComplete')).toBe(true);
    expect(m.objective).toBe(TOP);
    expect(m.assembled).toEqual([]);
    expect(m.seatY).toBe(24);
    expect(m.activeCargo).toEqual(['top']);
  });

  it('squares a part up to the nearest heading that fits', () => {
    const quarter: AssembleObjective = { ...MAST, parts: [{ ...MAST.parts[0], symmetry: 4 }] };
    const m = new MissionRunner(mission([quarter]));
    const events = hold(m, 3.2, [load({ heading: Math.PI / 2 + 0.05 })]);
    const fixed = events.find((e) => e.type === 'partFixed');
    expect(fixed && fixed.type === 'partFixed' ? fixed.heading : NaN).toBeCloseTo(Math.PI / 2);
  });

  it('completes the mission once the last part is on', () => {
    const m = new MissionRunner(mission([TOP]));
    const events = hold(m, 4.2, [load({ id: 'top', y: 24 })]);
    expect(events.some((e) => e.type === 'complete')).toBe(true);
  });
});

describe('load rotation', () => {
  const env: CargoEnv = { groundHeightAt: () => 0, isWater: () => false, solids: [] };
  const hook = (over: Partial<HookState> = {}): HookState => ({ x: 0, y: 40, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, groundSpeed: 0, landed: false, mass: 13000, ...over });
  const hanging = () => {
    const sys = new CargoSystem([SECTION], env, 20);
    const item = sys.items[0];
    item.y = 40 - 20 - SECTION.h - SLING_APEX;
    item.resting = false;
    sys.hooked = item;
    return { sys, item };
  };

  it('binds [ ] and , . to turning the load, clear of climb and the action key', () => {
    expect(axesFromKeys(new Set(['BracketLeft'])).rotate).toBe(1);
    expect(axesFromKeys(new Set(['BracketRight'])).rotate).toBe(-1);
    expect(axesFromKeys(new Set(['Comma'])).rotate).toBe(1);
    expect(axesFromKeys(new Set(['Period'])).rotate).toBe(-1);
    expect(axesFromKeys(new Set(['KeyQ', 'KeyE'])).rotate).toBe(0);
  });

  it('turns a hanging load steadily anticlockwise or clockwise', () => {
    const { sys, item } = hanging();
    sys.rotateInput = 1;
    for (let t = 0; t < 2; t += DT) sys.update(DT, hook(), env);
    expect(item.yawRate).toBeGreaterThan(LOAD_YAW_RATE * 0.95);
    expect(item.heading).toBeGreaterThan(0.6);
    sys.rotateInput = -1;
    for (let t = 0; t < 6; t += DT) sys.update(DT, hook(), env);
    expect(item.heading).toBeLessThan(0);
  });

  it('coasts only a few degrees after the key is released, so a tap makes a small correction', () => {
    const { sys, item } = hanging();
    sys.rotateInput = 1;
    for (let t = 0; t < 0.2; t += DT) sys.update(DT, hook(), env);
    sys.rotateInput = 0;
    for (let t = 0; t < 3; t += DT) sys.update(DT, hook(), env);
    expect(Math.abs(item.yawRate)).toBeLessThan(0.001);
    expect(item.heading).toBeGreaterThan(deg(1.5));
    expect(item.heading).toBeLessThan(deg(5));
  });

  it('does not turn a load sitting on a support', () => {
    const sys = new CargoSystem([SECTION], env, 20);
    const item = sys.items[0];
    sys.hooked = item;
    sys.rotateInput = 1;
    for (let t = 0; t < 2; t += DT) sys.update(DT, hook({ y: SECTION.h + SLING_APEX + 10 }), env);
    expect(item.heading).toBe(0);
  });
});

describe('wind on slung loads', () => {
  const windy: CargoEnv = { groundHeightAt: () => 0, isWater: () => false, solids: [], windAt: () => ({ x: 10, z: 0 }) };
  const hang = (def: CargoDef) => {
    const sys = new CargoSystem([def], windy, 20);
    const item = sys.items[0];
    item.y = 40 - 20 - def.h - SLING_APEX;
    item.resting = false;
    sys.hooked = item;
    const hook: HookState = { x: 0, y: 40, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, groundSpeed: 0, landed: false, mass: 13000 };
    for (let t = 0; t < 60; t += DT) sys.update(DT, hook, windy);
    return item;
  };

  it('blows a hanging load downwind in proportion to its windage', () => {
    const lattice = hang(SECTION);
    const compact = hang({ ...SECTION, windage: 0 });
    expect(lattice.x).toBeGreaterThan(0.5);
    expect(Math.abs(compact.x)).toBeLessThan(0.01);
  });

  it('leaves a seated load where it is', () => {
    const sys = new CargoSystem([SECTION], windy, 20);
    const item = sys.items[0];
    sys.hooked = item;
    const hook: HookState = { x: 0, y: SECTION.h + SLING_APEX + 15, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, groundSpeed: 0, landed: false, mass: 13000 };
    for (let t = 0; t < 10; t += DT) sys.update(DT, hook, windy);
    expect(item.resting).toBe(true);
    expect(Math.abs(item.x)).toBeLessThan(0.01);
  });
});

describe('stacking', () => {
  it('seats a part on the landable top of the one below', () => {
    const below: Solid = { minX: -1.3, maxX: 1.3, minZ: -1.3, maxZ: 1.3, top: 7, landable: true };
    const env: CargoEnv = {
      groundHeightAt: (x, z) => (x >= below.minX && x <= below.maxX && z >= below.minZ && z <= below.maxZ ? below.top : 0),
      isWater: () => false,
      solids: [below],
    };
    const sys = new CargoSystem([{ ...SECTION, x: 0.2, z: -0.2 }], env, 20);
    expect(sys.items[0].y).toBe(7);
    // Well off the side it misses and stands on the ground.
    const off = new CargoSystem([{ ...SECTION, x: 6 }], env, 20);
    expect(off.items[0].y).toBe(0);
  });
});

describe('ground crew', () => {
  const part = { x: 0, y: 0.5, z: 0, heading: Math.PI / 4, def: { w: 2.6, h: 7, d: 2.6 } };

  it('counts a load low over someone, allowing for its heading, as a hit', () => {
    expect(loadHitsPerson(part, { x: 0.5, z: 0.5 }, 0)).toBe(true);
    // Turned 45 degrees, the square's corner reaches further along the axes than its side.
    expect(loadHitsPerson(part, { x: 1.9, z: 0 }, 0)).toBe(true);
    expect(loadHitsPerson(part, { x: 1.4, z: 1.4 }, 0)).toBe(false);
    expect(loadHitsPerson({ ...part, y: 2.5 }, { x: 0, z: 0 }, 0)).toBe(false);
  });

  it('scatters from a load swinging low near them', () => {
    const world = new World(SKY_CRANE);
    const crew = SKY_CRANE.crowds[0];
    const sim = new CrowdSim(world, [crew]);
    const start = sim.people.map((p) => Math.hypot(p.x - crew.x, p.z - crew.z));
    for (let t = 0; t < 2; t += 0.05) sim.update(0.05, [{ x: crew.x, z: crew.z, agl: 3, reach: 14 }]);
    const after = sim.people.map((p) => Math.hypot(p.x - crew.x, p.z - crew.z));
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(sim.people.every((p) => p.fear > 0)).toBe(true);
    expect(mean(after)).toBeGreaterThan(mean(start) + 3);
  });
});

describe('Kesselkopf', () => {
  const world = new World(SKY_CRANE);
  const m = SKY_CRANE.mission;
  const assemblies = m.objectives.filter((o): o is AssembleObjective => o.kind === 'assemble');
  const cargo = m.cargo!;

  it('stacks four sections and then the antenna on the summit footing', () => {
    expect(assemblies).toHaveLength(2);
    const [mast, antenna] = assemblies;
    expect(mast.parts).toHaveLength(4);
    expect(antenna.parts.map((p) => p.cargo)).toEqual(['ant']);
    expect(world.groundHeightAt(mast.x, mast.z)).toBeCloseTo(mast.y, 5);
    // The antenna's seat is the top of the finished mast.
    expect(seatHeight(mast, mast.parts.map((p) => p.cargo), cargo)).toBeCloseTo(antenna.y, 5);
    expect([antenna.x, antenna.z, antenna.heading]).toEqual([mast.x, mast.z, mast.heading]);
    // The antenna is the most exacting part.
    for (const p of mast.parts) {
      expect(antenna.parts[0].radius).toBeLessThan(p.radius);
      expect(antenna.parts[0].headingTolerance).toBeLessThan(p.headingTolerance);
    }
  });

  it('seats every part on the footing or the stack, with the summit above the tree line', () => {
    const [mast] = assemblies;
    const def = cargo.find((c) => c.id === mast.parts[0].cargo)!;
    const sys = new CargoSystem([{ ...def, x: mast.x, z: mast.z, heading: mast.heading }], world, MANTIS.slingLength!);
    expect(sys.items[0].y).toBeCloseTo(mast.y, 5);
    expect(mast.y).toBeGreaterThan(SKY_CRANE.terrain.kind === 'alpine' ? SKY_CRANE.terrain.treeLine : 0);
  });

  it('keeps the summit crew off the footing', () => {
    const sim = new CrowdSim(world, [SKY_CRANE.crowds[0]]);
    const [mast] = assemblies;
    expect(sim.people.length).toBeGreaterThan(3);
    for (const p of sim.people) expect(Math.hypot(p.x - mast.x, p.z - mast.z)).toBeGreaterThan(2);
  });

  it('flies a crane much stronger than the Hauler, on a long line', () => {
    const heaviest = Math.max(...cargo.map((c) => c.mass));
    const perf = MANTIS.mass / (MANTIS.mass + heaviest);
    expect(perf).toBeGreaterThan(0.75);
    expect(MANTIS.mass).toBeGreaterThan(HAULER.mass);
    expect(MANTIS.slingLength!).toBeGreaterThan(HAULER.slingLength!);
    expect(MANTIS.brakeAssist).toBeGreaterThan(HAULER.brakeAssist);
  });

  it('blows harder at the summit than in the yard', () => {
    const [mast] = assemblies;
    const yard = world.pad('yard');
    let top = 0;
    let low = 0;
    for (let t = 0; t < 60; t += 0.5) {
      world.wind!.update(0.5);
      const a = world.windAt(mast.x, mast.z, mast.y + 30);
      const b = world.windAt(yard.x, yard.z, yard.top + 30);
      top += Math.hypot(a.x, a.z);
      low += Math.hypot(b.x, b.z);
    }
    expect(top).toBeGreaterThan(low * 1.5);
  });

  /**
   * Holds the hook dead still over a seat and lets the summit wind work on the hanging part.
   * Returns how far the wind sets it off downwind, its swing about that point, and the share of the
   * time it spends inside the part's tolerance of where it swings about.
   */
  const swing = (id: string, seatY: number) => {
    const w = new World(SKY_CRANE);
    const [mast] = assemblies;
    const def = cargo.find((c) => c.id === id)!;
    const tolerance = assemblies.flatMap((a) => a.parts).find((p) => p.cargo === id)!.radius;
    const rope = MANTIS.slingLength!;
    const hookY = seatY + 4 + def.h + SLING_APEX + rope;
    const sys = new CargoSystem([{ ...def, x: mast.x, z: mast.z, heading: 0 }], w, rope);
    const item = sys.items[0];
    item.y = hookY - rope - def.h - SLING_APEX;
    item.resting = false;
    sys.hooked = item;
    const hook: HookState = { x: mast.x, y: hookY, z: mast.z, vx: 0, vy: 0, vz: 0, heading: 0, groundSpeed: 0, landed: false, mass: MANTIS.mass };
    const xs: number[] = [];
    const zs: number[] = [];
    const step = 1 / 60;
    for (let t = 0; t < 180; t += step) {
      w.wind!.update(step);
      sys.update(step, hook, w);
      if (t > 30) {
        xs.push(item.x);
        zs.push(item.z);
      }
    }
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const mz = zs.reduce((a, b) => a + b) / zs.length;
    const dev = xs.map((x, i) => Math.hypot(x - mx, zs[i] - mz));
    return { drift: Math.hypot(mx - mast.x, mz - mast.z), swing: Math.max(...dev), within: dev.filter((d) => d <= tolerance).length / dev.length };
  };

  it('blows a hanging section off its mark, but within reach of a steady hand', () => {
    const [mast] = assemblies;
    const s = swing('s1', mast.y);
    // The pilot has to hold upwind of the seat to bring it over the mark...
    expect(s.drift).toBeGreaterThan(cargo.find((c) => c.id === 's1')!.w * 0.2);
    // ...and gusts swing it about, but not beyond twice its tolerance.
    expect(s.swing).toBeGreaterThan(0.2);
    expect(s.swing).toBeLessThan(1.2);
  }, 20000);

  it('makes the antenna the hardest part to hold, without making it impossible', () => {
    const [, antenna] = assemblies;
    const s = swing('ant', antenna.y);
    expect(s.within).toBeGreaterThan(0.4);
    expect(s.within).toBeLessThan(0.95);
  }, 20000);
});
