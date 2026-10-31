import { describe, expect, it } from 'vitest';
import { FLIGHT_SCHOOL as DESERT_LEVEL } from '../src/levels/flightSchool';
import { SEA_RESCUE } from '../src/levels/seaRescue';
import { Terrain } from '../src/world/Terrain';
import { World } from '../src/world/World';

describe('Terrain', () => {
  it('is deterministic for a seed', () => {
    const cfg = { ...DESERT_LEVEL.terrain, size: 200, flatten: [], plateaus: [] };
    const a = Terrain.generate(cfg);
    const b = Terrain.generate(cfg);
    expect(a.heights).toEqual(b.heights);
  });

  it('interpolates exactly through grid vertices', () => {
    const t = Terrain.generate({ ...DESERT_LEVEL.terrain, size: 200 });
    const ix = 10;
    const iz = 17;
    expect(t.heightAt(t.vertexX(ix), t.vertexZ(iz))).toBeCloseTo(t.heights[t.index(ix, iz)], 4);
  });
});

describe('World', () => {
  const world = new World(DESERT_LEVEL);

  it('flattens the ground around flatten zones', () => {
    const zone = DESERT_LEVEL.terrain.flatten[0];
    const h0 = world.terrain.heightAt(zone.x, zone.z);
    for (const [dx, dz] of [[10, 0], [-20, 15], [0, -30]]) {
      expect(Math.abs(world.terrain.heightAt(zone.x + dx, zone.z + dz) - h0)).toBeLessThan(0.05);
    }
  });

  it('puts the mesa pad on top of the plateau', () => {
    const mesa = world.pad('mesa');
    expect(mesa.top).toBeGreaterThan(30);
  });

  it('reports rooftop pads as ground', () => {
    const hall = world.pad('hall');
    expect(world.groundHeightAt(hall.x, hall.z)).toBeCloseTo(hall.top);
    expect(world.slopeAt(hall.x, hall.z)).toBe(0);
    expect(world.padAt(hall.x, hall.z)?.id).toBe('hall');
  });

  it('keeps scattered props off roads and out of town', () => {
    for (const item of world.scatter) {
      expect(world.distanceToRoad(item.x, item.z)).toBeGreaterThan(7);
    }
    expect(world.scatter.filter((s) => s.kind === 'cactus').length).toBeGreaterThan(100);
  });

  it('spawns on a flat service pad', () => {
    const pad = world.pad(DESERT_LEVEL.spawnPad);
    expect(pad.service).toBe(true);
    expect(world.slopeAt(pad.x, pad.z)).toBe(0);
  });
});

describe('Sea rescue level', () => {
  const world = new World(SEA_RESCUE);
  const survivors = SEA_RESCUE.mission.survivors!;

  it('puts water survivors over open water', () => {
    for (const s of survivors.filter((s) => s.placement === 'water')) {
      expect(world.isWater(s.x, s.z)).toBe(true);
      expect(world.groundHeightAt(s.x, s.z)).toBe(0);
    }
  });

  it('puts the ledge survivor on dry rock just above the sea', () => {
    const r = survivors.find((s) => s.placement === 'rocks')!;
    expect(world.isWater(r.x, r.z)).toBe(false);
    expect(world.terrain.heightAt(r.x, r.z)).toBeCloseTo(r.y, 0);
  });

  it('keeps the capsized yacht in the water', () => {
    const y = survivors.find((s) => s.placement === 'boat')!;
    expect(world.terrain.heightAt(y.x, y.z)).toBeLessThan(-1);
  });

  it('starts on a service pad on land and delivers to a raised hospital roof', () => {
    const station = world.pad('station');
    expect(station.service).toBe(true);
    expect(world.isWater(station.x, station.z)).toBe(false);
    expect(world.pad('hospital').top).toBeGreaterThan(20);
  });

  it('has cliffs: high ground inland and deep water offshore', () => {
    expect(world.terrain.heightAt(-350, -350)).toBeGreaterThan(15);
    expect(world.terrain.heightAt(300, 300)).toBeLessThan(-10);
  });

  it('keeps scenery out of the sea', () => {
    for (const item of world.scatter.filter((s) => s.kind !== 'rock')) {
      expect(world.isWater(item.x, item.z)).toBe(false);
    }
  });
});
