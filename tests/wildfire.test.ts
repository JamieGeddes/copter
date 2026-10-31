import { describe, expect, it } from 'vitest';
import { WILDFIRE } from '../src/levels/wildfire';
import { sprayRadius, sprayStrength } from '../src/missions/Bucket';
import { FireGrid } from '../src/world/FireGrid';
import { buildFuel, createFireGrid } from '../src/world/fuel';
import { World } from '../src/world/World';

const world = new World(WILDFIRE);
const protect = WILDFIRE.mission.objectives.find((o) => o.kind === 'protect');
if (!protect || protect.kind !== 'protect') throw new Error('Wildfire has no protect objective');
const wind = { x: world.wind!.x, z: world.wind!.z };

const DT = 0.1;
const DROP_SECONDS = 2.5;
const SWATH = 40;

/**
 * Plays a firefighter: every `period` seconds, drops a bucket across the burning cell nearest the
 * town, sweeping a 40 m swath. Returns the second the fire reached the town, or Infinity.
 */
const fight = (grid: FireGrid, seconds: number, period: number, first = 25): number => {
  const radius = sprayRadius(10);
  const strength = sprayStrength(radius);
  let next = first;
  let dropEnd = 0;
  let px = 0;
  let pz = 0;
  let dx = 0;
  let dz = 0;
  for (let t = 0; t < seconds; t += DT) {
    if (period > 0 && t >= next && t >= dropEnd) {
      next += period;
      let best = Infinity;
      let at = -1;
      for (const i of grid.burningCells()) {
        const d = Math.hypot(grid.centreX(i) - protect.x, grid.centreZ(i) - protect.z);
        if (d < best) {
          best = d;
          at = i;
        }
      }
      if (at >= 0) {
        dx = (protect.x - grid.centreX(at)) / best;
        dz = (protect.z - grid.centreZ(at)) / best;
        px = grid.centreX(at) + dx * 6;
        pz = grid.centreZ(at) + dz * 6;
        dropEnd = t + DROP_SECONDS;
      }
    }
    if (t < dropEnd) {
      const off = ((t - (dropEnd - DROP_SECONDS)) / DROP_SECONDS - 0.5) * SWATH;
      grid.douse(px - dz * off, pz + dx * off, radius, strength * DT);
    }
    grid.step(DT, wind.x, wind.z);
    if (grid.burningWithin(protect.x, protect.z, protect.radius) > 0) return t;
  }
  return Infinity;
};

describe('wildfire level', () => {
  it('starts with a fire in the hills, well away from the town, the cabins and the ranger station', () => {
    const grid = createFireGrid(world);
    expect(grid.burningCount).toBeGreaterThan(20);
    expect(grid.isClear(protect.x, protect.z, protect.radius + 40)).toBe(true);
    const pad = world.pad('ranger');
    expect(grid.isClear(pad.x, pad.z, 60)).toBe(true);
    for (const a of WILDFIRE.fire!.assets) expect(grid.burnedWithin(a.x, a.z, a.radius)).toBe(0);
  });

  it('burns trees and buildings but not water, roads, pads or firebreaks', () => {
    const fuel = buildFuel(world);
    const t = world.terrain;
    const at = (x: number, z: number) => fuel[t.index(t.cellIndex(x), t.cellIndex(z))];
    expect(at(-10, 275)).toBe(0);
    const pad = world.pad('ranger');
    expect(at(pad.x, pad.z)).toBe(0);
    const [rx, rz] = WILDFIRE.roads[0][2];
    expect(at(rx, rz)).toBe(0);
    const b = WILDFIRE.fire!.firebreaks[0].points[1];
    expect(at(b[0], b[1])).toBe(0);
    const house = world.buildings.find((x) => x.kind === 'cottage')!;
    expect(at(house.x, house.z)).toBeGreaterThan(0.5);
    let woodland = 0;
    for (const s of world.scatter) if (s.kind === 'tree' && at(s.x, s.z) > 0.3) woodland++;
    expect(woodland).toBeGreaterThan(world.scatter.filter((s) => s.kind === 'tree').length * 0.9);
  });

  it('puts the fire into the town within minutes if left alone', () => {
    const reached = fight(createFireGrid(world), 600, 0);
    expect(reached).toBeGreaterThan(120);
    expect(reached).toBeLessThan(300);
  });

  it('can be held off by good drops, which clearly knock the fire back', () => {
    const left = createFireGrid(world);
    const fought = createFireGrid(world);
    const untended = fight(left, 240, 0);
    const held = fight(fought, 240, 30);
    expect(untended).toBe(Infinity);
    expect(held).toBe(Infinity);
    const nearest = (g: FireGrid) => Math.min(...g.burningCells().map((i) => Math.hypot(g.centreX(i) - protect.x, g.centreZ(i) - protect.z)));
    expect(nearest(fought)).toBeGreaterThan(nearest(left) + 40);
  });

  it('is held back for the protect time with a drop every half minute', () => {
    expect(fight(createFireGrid(world), protect.seconds + 20, 30)).toBe(Infinity);
  });

  it('keeps the cell count the fire has to track bounded', () => {
    const grid = createFireGrid(world);
    fight(grid, 400, 0);
    expect(grid.burningCount).toBeLessThan(6000);
  });
});
