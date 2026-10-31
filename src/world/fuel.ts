import { FireGrid, FireTuning } from './FireGrid';
import { World } from './World';

/** Fuel load of open grass, village greens and so on. */
const GRASS = 0.3;
/** Extra fuel at full woodland density. */
const WOODLAND = 0.9;
const BUILDING = 0.9;

const distToSegment = (x: number, z: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
};

/**
 * Fuel per terrain vertex. Woodland and grass burn, buildings burn well; water, rock, roads, pads
 * and firebreaks do not.
 */
export const buildFuel = (world: World): Float32Array => {
  const t = world.terrain;
  const fuel = new Float32Array(t.verts * t.verts);
  const sea = world.seaLevel;
  for (let iz = 0; iz < t.verts; iz++) {
    for (let ix = 0; ix < t.verts; ix++) {
      const i = t.index(ix, iz);
      const x = t.vertexX(ix);
      const z = t.vertexZ(iz);
      const h = t.heights[i];
      if (sea !== undefined && h < sea + 0.4) continue;
      if (t.slopeAt(x, z) > 0.38) continue;
      if (world.distanceToRoad(x, z) < 5) continue;
      fuel[i] = GRASS + WOODLAND * t.dune[i];
    }
  }

  const fire = world.level.fire;
  for (const b of fire?.firebreaks ?? []) {
    for (let i = 0; i < b.points.length - 1; i++) {
      const [ax, az] = b.points[i];
      const [bx, bz] = b.points[i + 1];
      const r = b.width / 2;
      for (let iz = Math.max(0, t.cellIndex(Math.min(az, bz) - r) - 1); iz <= Math.min(t.cells, t.cellIndex(Math.max(az, bz) + r) + 1); iz++) {
        for (let ix = Math.max(0, t.cellIndex(Math.min(ax, bx) - r) - 1); ix <= Math.min(t.cells, t.cellIndex(Math.max(ax, bx) + r) + 1); ix++) {
          if (distToSegment(t.vertexX(ix), t.vertexZ(iz), ax, az, bx, bz) <= r) fuel[t.index(ix, iz)] = 0;
        }
      }
    }
  }

  for (const p of world.pads) {
    const s = p.solid;
    paint(world, fuel, s.minX - 2, s.maxX + 2, s.minZ - 2, s.maxZ + 2, 0);
  }
  for (const b of world.buildings) {
    // Buildings standing in water or on a pad's concrete still burn; those are rare, so ignore them.
    paint(world, fuel, b.x - b.hx - 1.5, b.x + b.hx + 1.5, b.z - b.hz - 1.5, b.z + b.hz + 1.5, b.kind === 'tank' ? 0 : BUILDING);
  }
  return fuel;
};

const paint = (world: World, fuel: Float32Array, x0: number, x1: number, z0: number, z1: number, value: number): void => {
  const t = world.terrain;
  for (let iz = Math.max(0, t.cellIndex(z0)); iz <= Math.min(t.cells, t.cellIndex(z1)); iz++) {
    for (let ix = Math.max(0, t.cellIndex(x0)); ix <= Math.min(t.cells, t.cellIndex(x1)); ix++) {
      const x = t.vertexX(ix);
      const z = t.vertexZ(iz);
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) fuel[t.index(ix, iz)] = value;
    }
  }
};

/** Builds the level's fire grid, lights the fire and lets it burn for its head start. */
export const createFireGrid = (world: World, tuning: Partial<FireTuning> = {}): FireGrid => {
  const t = world.terrain;
  const def = world.level.fire;
  const grid = new FireGrid(
    { size: t.verts, cellSize: t.cellSize, originX: -t.half, originZ: -t.half, heights: t.heights, fuel: buildFuel(world) },
    tuning,
  );
  if (!def) return grid;
  for (const f of def.ignite) grid.ignite(f.x, f.z, f.radius);
  const wind = world.wind;
  const step = 0.5;
  for (let s = 0; s < def.headStart; s += step) grid.step(step, wind?.x ?? 0, wind?.z ?? 0);
  grid.drainChanges();
  return grid;
};
