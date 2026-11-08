import { describe, expect, it } from 'vitest';
import { FlightEnvironment, FlightInput, FlightModel, liftAtAltitude, rotorProximity, thrustRatio } from '../src/heli/FlightModel';
import { CHAMOIS, KESTREL, PASSENGER_MASS } from '../src/heli/HeliSpec';
import { MOUNTAIN_RESCUE } from '../src/levels/mountainRescue';
import { Boarding } from '../src/missions/Boarding';
import { MissionRunner, MissionSnapshot } from '../src/missions/MissionRunner';
import { MissionDef, SurvivorDef } from '../src/missions/types';
import { LevelDef } from '../src/world/level';
import { Terrain } from '../src/world/Terrain';
import { World } from '../src/world/World';

const DT = 1 / 120;
const IDLE: FlightInput = { moveX: 0, moveZ: 0, climb: 0 };
const FULL = 3 * PASSENGER_MASS;

const groundEnv = (height: (x: number, z: number) => number, rotorStrike = false): FlightEnvironment => ({
  groundHeightAt: height,
  slopeAt: () => 0,
  solids: [],
  bounds: { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 },
  rotorStrike,
});

const run = (m: FlightModel, seconds: number, input: FlightInput, env: FlightEnvironment) => {
  const events = [];
  for (let t = 0; t < seconds; t += DT) events.push(...m.step(DT, input, env));
  return events;
};

/** A Chamois in the air at `y`, rotor at full speed. */
const flying = (y: number, payload = 0): FlightModel => {
  const m = new FlightModel(CHAMOIS);
  m.place(0, y, 0);
  m.landed = false;
  m.spool = 1;
  m.payload = payload;
  return m;
};

describe('thin air', () => {
  it('leaves aircraft without a service ceiling unaffected by altitude', () => {
    expect(liftAtAltitude(KESTREL, 0)).toBe(1);
    expect(liftAtAltitude(KESTREL, 2000)).toBe(1);
  });

  it('falls with altitude so the empty aircraft can only just hover at its ceiling', () => {
    expect(liftAtAltitude(CHAMOIS, 0)).toBe(1);
    expect(liftAtAltitude(CHAMOIS, 200)).toBeLessThan(liftAtAltitude(CHAMOIS, 100));
    expect(thrustRatio(CHAMOIS, CHAMOIS.serviceCeiling!, 0, 100, 0)).toBeCloseTo(1, 5);
  });

  it('gets extra lift close to the ground and from moving air', () => {
    const still = thrustRatio(CHAMOIS, 300, FULL, 50, 0);
    expect(thrustRatio(CHAMOIS, 300, FULL, 0, 0)).toBeGreaterThan(still * 1.1);
    expect(thrustRatio(CHAMOIS, 300, FULL, 50, 20)).toBeGreaterThan(still * 1.1);
  });

  it('holds a hover with a full cabin at sea level', () => {
    const m = flying(40, FULL);
    run(m, 5, IDLE, groundEnv(() => 0));
    expect(m.thrustMargin).toBeGreaterThan(0);
    expect(Math.abs(m.y - 40)).toBeLessThan(0.1);
  });

  it('sinks with a full cabin near the summit however hard the collective is pulled', () => {
    const m = flying(380, FULL);
    run(m, 4, { ...IDLE, climb: 1 }, groundEnv(() => 330));
    expect(m.thrustMargin).toBeLessThan(0);
    expect(m.y).toBeLessThan(375);
  });

  it('hovers empty near the summit, but climbs more slowly than low down', () => {
    const high = flying(380);
    run(high, 4, IDLE, groundEnv(() => 330));
    expect(Math.abs(high.y - 380)).toBeLessThan(0.1);
    run(high, 3, { ...IDLE, climb: 1 }, groundEnv(() => 330));
    const low = flying(40);
    run(low, 3, { ...IDLE, climb: 1 }, groundEnv(() => 0));
    expect(high.y - 380).toBeGreaterThan(1);
    expect(high.y - 380).toBeLessThan((low.y - 40) * 0.6);
  });

  it('lifts off in ground effect where it cannot climb away, and not at all when overloaded', () => {
    const env = groundEnv(() => 340);
    const two = new FlightModel(CHAMOIS);
    two.place(0, 340, 0);
    two.spool = 1;
    two.payload = 2 * PASSENGER_MASS;
    run(two, 8, { ...IDLE, climb: 1 }, env);
    expect(two.landed).toBe(false);
    expect(two.y - 340).toBeLessThan(CHAMOIS.rotorRadius * 1.6);

    const three = new FlightModel(CHAMOIS);
    three.place(0, 340, 0);
    three.spool = 1;
    three.payload = FULL;
    run(three, 4, { ...IDLE, climb: 1 }, env);
    expect(three.landed).toBe(true);
  });
});

describe('rotor strike', () => {
  const wall = (x: number) => (x > 10 ? 100 : 0);

  it('knocks the aircraft back from rock that rises into the disc', () => {
    const m = flying(20);
    const events = run(m, 3, { ...IDLE, moveX: 0.25 }, groundEnv((x) => wall(x), true));
    expect(events.some((e) => e.type === 'rotorStrike')).toBe(true);
    expect(m.destroyed).toBe(false);
    expect(m.x).toBeLessThan(10 - CHAMOIS.rotorRadius + 1);
    expect(m.damage).toBeGreaterThan(0);
  });

  it('destroys the aircraft when it flies into the rock at speed', () => {
    const m = flying(20);
    m.x = -40;
    m.vx = 25;
    const events = run(m, 3, { ...IDLE, moveX: 1 }, groundEnv((x) => wall(x), true));
    expect(events.some((e) => e.type === 'crashed' && /Rotor/.test(e.reason))).toBe(true);
  });

  it('only applies where the level asks for it', () => {
    const m = flying(20);
    const events = run(m, 2, { ...IDLE, moveX: 0.25 }, groundEnv((x) => wall(x), false));
    expect(events.some((e) => e.type === 'rotorStrike')).toBe(false);
  });

  it('reports the gap and direction to the nearest rock at rotor height', () => {
    const p = rotorProximity(CHAMOIS, 0, 20, 0, (x) => (x > 15 ? 100 : 0));
    expect(p).toBeDefined();
    expect(p!.distance).toBeGreaterThan(8);
    expect(p!.distance).toBeLessThan(11);
    expect(p!.dirX).toBeGreaterThan(0.9);
    expect(rotorProximity(CHAMOIS, 0, 20, 0, () => 0)).toBeUndefined();
  });
});

const climber = (id: string, x: number, pickup: SurvivorDef['pickup'] = 'landing'): SurvivorDef => ({ id, x, z: 0, y: 0, placement: 'snow', pickup });

describe('Boarding', () => {
  it('waits for the aircraft to land nearby, then walks the climbers over one at a time', () => {
    const b = new Boarding();
    const list = [climber('a', 10), climber('b', 12)];
    const rescued = new Set<string>();
    expect(b.update(0.1, { x: 0, z: 0, landed: false }, list, rescued, 3)).toEqual([]);
    expect(b.hint).toBe('land');
    const boarded: string[] = [];
    const step = (seconds: number) => {
      for (let t = 0; t < seconds; t += 0.1) {
        for (const e of b.update(0.1, { x: 0, z: 0, landed: true }, list, rescued, 3 - rescued.size)) {
          boarded.push(e.id);
          rescued.add(e.id);
        }
      }
    };
    step(2.7);
    expect(boarded).toEqual(['a']);
    step(2.7);
    expect(boarded).toEqual(['a', 'b']);
  });

  it('sends a climber back if the aircraft takes off', () => {
    const b = new Boarding();
    const list = [climber('a', 10)];
    b.update(1, { x: 0, z: 0, landed: true }, list, new Set(), 3);
    expect(b.walkingId).toBe('a');
    b.update(0.1, { x: 0, z: 0, landed: false }, list, new Set(), 3);
    expect(b.walkingId).toBeUndefined();
    expect(b.progress).toBe(0);
  });

  it('boards nobody into a full cabin, nor survivors who need the winch, nor from too far away', () => {
    const b = new Boarding();
    b.update(1, { x: 0, z: 0, landed: true }, [climber('a', 10)], new Set(), 0);
    expect(b.walkingId).toBeUndefined();
    expect(b.hint).toBe('full');
    b.update(1, { x: 0, z: 0, landed: true }, [climber('w', 5, 'winch')], new Set(), 3);
    expect(b.walkingId).toBeUndefined();
    b.update(1, { x: 0, z: 0, landed: true }, [climber('a', 80)], new Set(), 3);
    expect(b.walkingId).toBeUndefined();
    expect(b.hint).toBe('closer');
  });
});

const snap = (over: Partial<MissionSnapshot> = {}): MissionSnapshot => ({
  x: 0,
  y: 0,
  z: 0,
  agl: 0,
  groundSpeed: 0,
  landed: false,
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

describe('several delivery trips', () => {
  const mission = () =>
    new MissionRunner(
      def({
        capacity: 2,
        objectives: [
          { kind: 'rescue', text: 'Rescue', survivors: ['a', 'b', 'c'] },
          { kind: 'deliver', text: 'Deliver', pad: 'hospital' },
        ],
      }),
    );

  it('drops off a full cabin part way through the rescue and goes back for the rest', () => {
    const m = mission();
    m.notifyRescued('a');
    m.notifyRescued('b');
    expect(m.capacityLeft).toBe(0);
    expect(m.targetPad).toBe('hospital');
    const unloaded = [];
    for (let i = 0; i < 40; i++) unloaded.push(...m.update(0.1, snap({ landed: true, padId: 'hospital' })));
    expect(unloaded.filter((e) => e.type === 'passengerUnloaded')).toHaveLength(2);
    expect(m.objective?.kind).toBe('rescue');
    expect(m.onboard).toBe(0);
    expect(m.delivered).toBe(2);
    expect(m.targetPad).toBeUndefined();

    m.notifyRescued('c');
    m.update(0.1, snap());
    expect(m.objective?.kind).toBe('deliver');
    for (let i = 0; i < 30; i++) m.update(0.1, snap({ landed: true, padId: 'hospital' }));
    expect(m.status).toBe('complete');
    expect(m.delivered).toBe(3);
  });

  it('only unloads on the delivery pad', () => {
    const m = mission();
    m.notifyRescued('a');
    for (let i = 0; i < 40; i++) m.update(0.1, snap({ landed: true, padId: 'base' }));
    expect(m.onboard).toBe(1);
    expect(m.delivered).toBe(0);
  });

  it('keeps passengers aboard during a rescue with no delivery to follow', () => {
    const m = new MissionRunner(
      def({ capacity: 4, objectives: [{ kind: 'rescue', text: 'Rescue', survivors: ['a', 'b'] }, { kind: 'land', text: 'Land', pad: 'hospital' }] }),
    );
    m.notifyRescued('a');
    for (let i = 0; i < 40; i++) m.update(0.1, snap({ landed: true, padId: 'hospital' }));
    expect(m.onboard).toBe(1);
  });
});

describe('lowering cloud', () => {
  const survivors: SurvivorDef[] = [
    { id: 'hut', x: 0, z: 0, y: 300, placement: 'snow', pickup: 'landing', site: 'the hut' },
    { id: 'ledge', x: 0, z: 0, y: 150, placement: 'ledge', site: 'the ledge' },
  ];
  const mission = () =>
    new MissionRunner(
      def({
        capacity: 3,
        survivors,
        objectives: [{ kind: 'rescue', text: 'Rescue', survivors: ['hut', 'ledge'] }],
        weather: { cloudStart: 400, cloudEnd: 100, duration: 300, maxExposure: 5 },
      }),
    );

  it('lowers the cloud base steadily, then holds it', () => {
    const m = mission();
    expect(m.cloudBase).toBe(400);
    m.elapsed = 150;
    expect(m.cloudBase).toBe(250);
    m.elapsed = 900;
    expect(m.cloudBase).toBe(100);
    expect(new MissionRunner(def({})).cloudBase).toBe(Infinity);
  });

  it('warns once as the cloud nears a waiting site, then fails if it swallows the site', () => {
    const m = mission();
    m.notifyRescued('ledge');
    const events = [];
    for (let i = 0; i < 1000 && m.status === 'running'; i++) events.push(...m.update(0.1, snap({ y: 20 })));
    expect(events.filter((e) => e.type === 'cloudWarning')).toEqual([{ type: 'cloudWarning', site: 'the hut' }]);
    expect(m.status).toBe('failed');
    expect(m.failReason).toBe('Cloud closed in over the hut');
    // Base 400 falls 1 m/s; it reaches the hut's cabin height at about 98 s.
    expect(m.elapsed).toBeGreaterThan(95);
    expect(m.elapsed).toBeLessThan(100);
  });

  it('spares a survivor who is already on the way aboard', () => {
    const m = mission();
    m.notifyRescued('ledge');
    for (let i = 0; i < 1100; i++) m.update(0.1, snap({ y: 20, boardingId: 'hut' }));
    expect(m.status).toBe('running');
  });

  it('disorients the pilot who stays in cloud too long, but recovers in clear air', () => {
    const n = new MissionRunner({ ...mission().def, objectives: [{ kind: 'land', text: 'Land', pad: 'x' }], survivors: [] });
    for (let i = 0; i < 30; i++) n.update(0.1, snap({ y: 450 }));
    expect(n.cloudExposure).toBeCloseTo(3, 5);
    for (let i = 0; i < 20; i++) n.update(0.1, snap({ y: 20 }));
    expect(n.cloudExposure).toBeCloseTo(2, 5);
    for (let i = 0; i < 40 && n.status === 'running'; i++) n.update(0.1, snap({ y: 450 }));
    expect(n.status).toBe('failed');
    expect(n.failReason).toBe('Lost in cloud');
  });
});

/** A small test world: a slope rising towards +x at `grade`, with optional wind. */
const slopeWorld = (grade: number, direction: number, extra: Partial<LevelDef> = {}): World => {
  const terrain = new Terrain(400, 4, 'alpine');
  for (let iz = 0; iz < terrain.verts; iz++) {
    for (let ix = 0; ix < terrain.verts; ix++) terrain.heights[terrain.index(ix, iz)] = (terrain.vertexX(ix) + 200) * grade;
  }
  const level = {
    ...MOUNTAIN_RESCUE,
    wind: { direction, speed: 6, gust: 0, orographic: 1 },
    buildings: [],
    pads: [],
    roads: [],
    crowds: [],
    scatter: {},
    clearings: [],
    cableways: undefined,
    ...extra,
  } as LevelDef;
  return new World(level, terrain);
};

describe('mountain wind', () => {
  it('rises where it blows up a slope and sinks and churns where it blows down one', () => {
    const up = slopeWorld(0.5, Math.PI / 2);
    const g = up.terrain.heightAt(0, 0);
    const windward = up.windAt(0, 0, g + 5);
    expect(windward.up).toBeGreaterThan(2);
    expect(windward.turbulence).toBe(0);

    const down = slopeWorld(0.5, -Math.PI / 2);
    const lee = down.windAt(0, 0, g + 5);
    expect(lee.up).toBeLessThan(-1.5);
    expect(lee.turbulence).toBeGreaterThan(0.5);
  });

  it('fades with height above the slope', () => {
    const w = slopeWorld(0.5, Math.PI / 2);
    const g = w.terrain.heightAt(0, 0);
    expect(w.windAt(0, 0, g + 150).up).toBeLessThan(w.windAt(0, 0, g + 5).up * 0.2);
  });

  it('is the plain level wind on flat ground', () => {
    const w = slopeWorld(0, Math.PI / 2);
    const a = w.windAt(0, 0, 30);
    expect(a.up).toBeCloseTo(0, 5);
    expect(a.x).toBeCloseTo(w.wind!.x, 5);
    expect(a.z).toBeCloseTo(w.wind!.z, 5);
  });
});

describe('cable car wires', () => {
  it('strikes a rotor disc only where the wire crosses it', () => {
    const w = slopeWorld(0, 0, { cableways: [{ points: [{ x: 0, z: 0 }, { x: 100, z: 0 }] }] });
    // Strung 20 m above flat ground with 3 m of sag at mid-span.
    expect(w.cableStrike(50, 17, 3, 5)).toBe(true);
    expect(w.cableStrike(50, 25, 0, 5)).toBe(false);
    expect(w.cableStrike(50, 17, 10, 5)).toBe(false);
  });
});

describe('Grauhorn balance', () => {
  const m = MOUNTAIN_RESCUE.mission;
  const site = (name: string) => (m.survivors ?? []).filter((s) => s.site === name);
  const hut = site('the summit hut');
  const glacier = site('the glacier');
  const ledges = site('the north face');

  it('makes a fully loaded hover at the summit hut impossible, even in ground effect', () => {
    const y = hut[0].y;
    expect(thrustRatio(CHAMOIS, y + 20, FULL, 20, 0)).toBeLessThan(1);
    expect(thrustRatio(CHAMOIS, y, FULL, 0, 0)).toBeLessThan(1);
    // Two climbers can be lifted off in ground effect and flown away.
    expect(thrustRatio(CHAMOIS, y, 2 * PASSENGER_MASS, 0, 0)).toBeGreaterThan(1);
    expect(thrustRatio(CHAMOIS, y + 15, 2 * PASSENGER_MASS, 15, 20)).toBeGreaterThan(1);
  });

  it('lets the winch work at the ledges with two aboard, and a full cabin hover in the valley', () => {
    for (const s of ledges) expect(thrustRatio(CHAMOIS, s.y + 15, 2 * PASSENGER_MASS, 15, 0)).toBeGreaterThan(1);
    expect(thrustRatio(CHAMOIS, 40, FULL, 20, 0)).toBeGreaterThan(1.05);
  });

  it('closes the highest sites first, leaving time to reach the hut', () => {
    const r = new MissionRunner(m);
    const closes = (y: number) => {
      const w = m.weather!;
      return ((w.cloudStart - (y + 1.8)) / (w.cloudStart - w.cloudEnd)) * w.duration;
    };
    expect(r.cloudBase).toBe(m.weather!.cloudStart);
    const hutT = closes(hut[0].y);
    const glacierT = closes(Math.max(...glacier.map((s) => s.y)));
    const ledgeT = closes(Math.max(...ledges.map((s) => s.y)));
    expect(hutT).toBeGreaterThan(120);
    expect(glacierT).toBeGreaterThan(hutT + 60);
    expect(ledgeT).toBeGreaterThan(glacierT);
    expect(ledgeT).toBeLessThan(m.timeLimit!);
  });

  it('has updrafts and downdrafts on the slopes', () => {
    const world = new World(MOUNTAIN_RESCUE);
    let rising = 0;
    let sinking = 0;
    for (let x = -400; x <= 400; x += 40) {
      for (let z = -400; z <= 400; z += 40) {
        const a = world.windAt(x, z, world.terrain.heightAt(x, z) + 20);
        if (a.up > 1.5) rising++;
        if (a.up < -1.5) sinking++;
      }
    }
    expect(rising).toBeGreaterThan(20);
    expect(sinking).toBeGreaterThan(20);
  });
});
