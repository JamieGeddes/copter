import { createRng } from '../core/math';
import { Bounds, pointInSolid, Solid } from './collision';
import { BuildingDef, LevelDef, PadDef } from './level';
import { Terrain } from './Terrain';

export const PAD_HEIGHT = 0.3;

export interface PlacedBuilding extends BuildingDef {
  /** Ground height the building stands on. */
  base: number;
  /** Footprint half-sizes after rotation. */
  hx: number;
  hz: number;
}

export interface PlacedPad extends PadDef {
  /** Height of the pad surface. */
  top: number;
  solid: Solid;
}

export type ScatterKind = 'cactus' | 'boulder' | 'rock' | 'bush';

export interface ScatterItem {
  kind: ScatterKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  variant: number;
}

/** Static level state shared by gameplay and rendering. */
export class World {
  readonly level: LevelDef;
  readonly terrain: Terrain;
  readonly bounds: Bounds;
  readonly buildings: PlacedBuilding[];
  readonly pads: PlacedPad[];
  readonly scatter: ScatterItem[];
  readonly solids: Solid[] = [];
  private readonly landables: Solid[] = [];

  constructor(level: LevelDef, terrain: Terrain = Terrain.generateDesert(level.terrain)) {
    this.level = level;
    this.terrain = terrain;
    this.bounds = level.bounds;

    this.buildings = level.buildings.map((b) => {
      const quarter = (b.turns ?? 0) % 2 === 1;
      const hx = (quarter ? b.d : b.w) / 2;
      const hz = (quarter ? b.w : b.d) / 2;
      // Stand on the lowest corner so no part of the building floats.
      const base = Math.min(
        terrain.heightAt(b.x - hx, b.z - hz),
        terrain.heightAt(b.x + hx, b.z - hz),
        terrain.heightAt(b.x - hx, b.z + hz),
        terrain.heightAt(b.x + hx, b.z + hz),
      );
      return { ...b, base, hx, hz };
    });

    for (const b of this.buildings) {
      const solid: Solid = {
        minX: b.x - b.hx,
        maxX: b.x + b.hx,
        minZ: b.z - b.hz,
        maxZ: b.z + b.hz,
        top: b.base + b.h,
        landable: b.landable ?? true,
      };
      this.solids.push(solid);
      if (solid.landable) this.landables.push(solid);
    }

    this.pads = level.pads.map((p) => {
      const half = p.size / 2;
      const building = p.onBuilding !== undefined ? this.buildings[p.onBuilding] : undefined;
      const groundTop = building ? building.base + building.h : terrain.heightAt(p.x, p.z);
      const top = groundTop + PAD_HEIGHT;
      const solid: Solid = { minX: p.x - half, maxX: p.x + half, minZ: p.z - half, maxZ: p.z + half, top, landable: true };
      this.landables.push(solid);
      return { ...p, top, solid };
    });

    this.scatter = this.placeScatter();
    for (const item of this.scatter) {
      if (item.kind === 'cactus') {
        const r = 0.9 * item.scale;
        this.solids.push({ minX: item.x - r, maxX: item.x + r, minZ: item.z - r, maxZ: item.z + r, top: item.y + 5.5 * item.scale, landable: false });
      } else if (item.kind === 'boulder') {
        const r = 1.6 * item.scale;
        this.solids.push({ minX: item.x - r, maxX: item.x + r, minZ: item.z - r, maxZ: item.z + r, top: item.y + 2.2 * item.scale, landable: false });
      }
    }
  }

  /** Height of whatever the aircraft would rest on: terrain, a rooftop or a pad. */
  groundHeightAt(x: number, z: number): number {
    let h = this.terrain.heightAt(x, z);
    for (const s of this.landables) {
      if (s.top > h && pointInSolid(x, z, s)) h = s.top;
    }
    return h;
  }

  /** Slope of the landing surface; rooftops and pads are flat. */
  slopeAt(x: number, z: number): number {
    const terrainH = this.terrain.heightAt(x, z);
    for (const s of this.landables) {
      if (s.top > terrainH && pointInSolid(x, z, s)) return 0;
    }
    return this.terrain.slopeAt(x, z);
  }

  /** The pad whose surface contains the point, if any. */
  padAt(x: number, z: number): PlacedPad | undefined {
    return this.pads.find((p) => pointInSolid(x, z, p.solid));
  }

  pad(id: string): PlacedPad {
    const p = this.pads.find((pad) => pad.id === id);
    if (!p) throw new Error(`Unknown pad: ${id}`);
    return p;
  }

  /** True if a point is clear of buildings, pads, roads and designated clearings. */
  isClear(x: number, z: number, margin: number): boolean {
    for (const c of this.level.clearings) {
      if (Math.hypot(x - c.x, z - c.z) < c.radius + margin) return false;
    }
    for (const s of this.solids) {
      if (x > s.minX - margin && x < s.maxX + margin && z > s.minZ - margin && z < s.maxZ + margin) return false;
    }
    return this.distanceToRoad(x, z) > 7 + margin;
  }

  distanceToRoad(x: number, z: number): number {
    let best = Infinity;
    for (const road of this.level.roads) {
      for (let i = 0; i < road.length - 1; i++) {
        const [ax, az] = road[i];
        const [bx, bz] = road[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
      }
    }
    return best;
  }

  private placeScatter(): ScatterItem[] {
    const rng = createRng(this.level.terrain.seed * 31 + 7);
    const out: ScatterItem[] = [];
    const extent = this.terrain.half - 20;
    const { cacti, boulders, rocks, bushes } = this.level.scatter;
    const plan: [ScatterKind, number, number][] = [
      ['cactus', cacti, 6],
      ['boulder', boulders, 4],
      ['rock', rocks, 1],
      ['bush', bushes, 1],
    ];
    for (const [kind, count, margin] of plan) {
      let placed = 0;
      let attempts = 0;
      while (placed < count && attempts < count * 30) {
        attempts++;
        const x = (rng() * 2 - 1) * extent;
        const z = (rng() * 2 - 1) * extent;
        const slope = this.terrain.slopeAt(x, z);
        if (kind === 'cactus' && (slope > 0.08 || Math.abs(x) > 470 || Math.abs(z) > 470)) continue;
        if (kind === 'bush' && slope > 0.2) continue;
        if (kind !== 'boulder' && kind !== 'rock' && this.riverAt(x, z) > 0.5) continue;
        if (!this.isClear(x, z, margin)) continue;
        out.push({
          kind,
          x,
          y: this.terrain.heightAt(x, z),
          z,
          scale: 0.75 + rng() * 0.6,
          rotation: rng() * Math.PI * 2,
          variant: Math.floor(rng() * 4),
        });
        placed++;
      }
    }
    return out;
  }

  private riverAt(x: number, z: number): number {
    const t = this.terrain;
    const ix = Math.round((x + t.half) / t.cellSize);
    const iz = Math.round((z + t.half) / t.cellSize);
    return t.river[t.index(Math.min(t.cells, Math.max(0, ix)), Math.min(t.cells, Math.max(0, iz)))];
  }
}
