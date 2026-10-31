import { describe, expect, it } from 'vitest';
import { HEAVY_LIFT } from '../src/levels/heavyLift';
import { CargoSystem, SLING_APEX } from '../src/missions/Cargo';
import { isPlaced } from '../src/missions/MissionRunner';
import { World } from '../src/world/World';

describe('Heavy Lift bridge', () => {
  const world = new World(HEAVY_LIFT);
  const spans = HEAVY_LIFT.mission.objectives.filter((o) => o.kind === 'place' && o.heading !== undefined);

  it('has two spans over open water', () => {
    expect(spans).toHaveLength(2);
    for (const s of spans) expect(world.isWater(s.kind === 'place' ? s.x : 0, s.kind === 'place' ? s.z : 0)).toBe(true);
  });

  it('rests a correctly placed girder on the pier and abutment at deck height', () => {
    const girder = HEAVY_LIFT.mission.cargo!.find((c) => c.kind === 'girder')!;
    for (const s of spans) {
      if (s.kind !== 'place') continue;
      const sys = new CargoSystem([{ ...girder, x: s.x, z: s.z, heading: s.heading! }], world, 14);
      const sup = sys.support(sys.items[0], world);
      expect(sup.wet).toBe(false);
      expect(sup.h).toBeCloseTo(5, 1);
    }
  });

  it('drops a badly aligned girder into the river', () => {
    const girder = HEAVY_LIFT.mission.cargo!.find((c) => c.kind === 'girder')!;
    const s = spans[0];
    if (s.kind !== 'place') return;
    // Turned across the river, the girder misses both supports.
    const sys = new CargoSystem([{ ...girder, x: s.x, z: s.z, heading: Math.PI / 2 }], world, 14);
    expect(sys.support(sys.items[0], world).wet).toBe(true);
  });
});

describe('Heavy Lift placement', () => {
  it('sets a girder down on the south span without damage when lowered steadily', () => {
    const world = new World(HEAVY_LIFT);
    const target = HEAVY_LIFT.mission.objectives.find((o) => o.kind === 'place' && o.heading !== undefined)!;
    if (target.kind !== 'place') return;
    const girder = HEAVY_LIFT.mission.cargo!.find((c) => c.id === target.cargo[0])!;
    // Start already hanging, aligned, above the span.
    const sys = new CargoSystem([{ ...girder, x: target.x, z: target.z, heading: target.heading! }], world, 14);
    const item = sys.items[0];
    let hookY = 40;
    item.y = hookY - 14 - girder.h - SLING_APEX;
    item.resting = false;
    sys.hooked = item;
    const hook = () => ({ x: target.x, y: hookY, z: target.z, vx: 0, vy: -1.3, vz: 0, heading: target.heading!, groundSpeed: 0, landed: false, mass: 11000 });
    for (let t = 0; t < 30 && !item.resting; t += 1 / 120) {
      hookY -= 1.3 / 120;
      sys.update(1 / 120, hook(), world);
    }
    expect(item.resting).toBe(true);
    expect(item.y).toBeCloseTo(5, 1);
    expect(item.damage).toBe(0);
    sys.release();
    const snap = { id: item.def.id, x: item.x, z: item.z, heading: item.heading, resting: item.resting, hooked: false, lost: false, destroyed: false };
    expect(isPlaced(snap, target)).toBe(true);
  });
});
