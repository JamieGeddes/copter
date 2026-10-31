import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/heli/HeliSpec';
import { CAMPAIGN } from '../src/levels';
import { pointInSolid } from '../src/world/collision';
import { World } from '../src/world/World';

const playable = CAMPAIGN.filter((c) => c.level);

describe('campaign', () => {
  it('has unique mission ids and at least two playable levels', () => {
    expect(new Set(CAMPAIGN.map((c) => c.id)).size).toBe(CAMPAIGN.length);
    expect(playable.length).toBeGreaterThanOrEqual(2);
  });

  it('includes a combat mission on the roadmap', () => {
    expect(CAMPAIGN.some((c) => /combat/i.test(c.skill))).toBe(true);
  });
});

describe.each(playable.map((c) => [c.id, c.level!] as const))('level %s', (_id, level) => {
  const world = new World(level);
  const mission = level.mission;

  it('uses a known aircraft', () => {
    expect(AIRCRAFT[level.aircraft]).toBeDefined();
  });

  it('spawns on a service pad', () => {
    expect(world.pad(level.spawnPad).service).toBe(true);
  });

  it('only references pads that exist', () => {
    for (const o of mission.objectives) {
      if (o.kind === 'land' || o.kind === 'deliver') expect(() => world.pad(o.pad)).not.toThrow();
    }
  });

  it('places gates clear of buildings with room beneath', () => {
    for (const o of mission.objectives) {
      if (o.kind !== 'gates') continue;
      for (const g of o.gates) {
        expect(g.alt).toBeGreaterThan(g.radius);
        const top = world.groundHeightAt(g.x, g.z) + g.alt - g.radius;
        for (const s of world.solids) {
          if (pointInSolid(g.x, g.z, s)) expect(s.top).toBeLessThan(top);
        }
      }
    }
  });

  it('lists every survivor in a rescue objective, with room for them all', () => {
    const ids = (mission.survivors ?? []).map((s) => s.id);
    const rescue = mission.objectives.find((o) => o.kind === 'rescue');
    if (!ids.length) return;
    expect(rescue && rescue.kind === 'rescue' ? [...rescue.survivors].sort() : []).toEqual([...ids].sort());
    expect(mission.capacity ?? 0).toBeGreaterThanOrEqual(ids.length);
  });

  it('puts survivors on their surface and out of obstacles', () => {
    for (const s of mission.survivors ?? []) {
      for (const solid of world.solids) {
        if (s.placement !== 'boat') expect(pointInSolid(s.x, s.z, solid)).toBe(false);
      }
      if (s.placement === 'water') expect(world.isWater(s.x, s.z)).toBe(true);
    }
  });

  it('sets medal times inside any time limit', () => {
    expect(mission.medals.gold).toBeLessThan(mission.medals.silver);
    if (mission.timeLimit) expect(mission.medals.silver).toBeLessThan(mission.timeLimit);
  });
});
