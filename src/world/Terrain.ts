import { clamp, lerp, smoothstep } from '../core/math';
import { Noise2D } from './noise';

/** Flattens the ground in a circle, blending back to natural terrain over `falloff` metres. */
export interface FlattenZone {
  x: number;
  z: number;
  radius: number;
  falloff: number;
  /** Target height. If omitted, the natural height at the centre is used. */
  height?: number;
}

/** A forced flat-topped mesa with steep, slightly ragged cliffs. */
export interface Plateau {
  x: number;
  z: number;
  radius: number;
  height: number;
  cliff: number;
}

/** A dry riverbed following z = offset + amplitude * sin(x / wavelength). */
export interface Riverbed {
  offset: number;
  amplitude: number;
  wavelength: number;
  width: number;
  depth: number;
}

export interface DesertConfig {
  seed: number;
  size: number;
  cellSize: number;
  /** Distance from centre at which the boundary ridges begin to rise. */
  edgeStart: number;
  flatten: FlattenZone[];
  plateaus: Plateau[];
  riverbed?: Riverbed;
}

/**
 * Square heightfield centred on the origin. Heights are sampled on a regular grid and
 * interpolated with the same triangulation as the rendered mesh, so ground contact
 * matches what the player sees.
 */
export class Terrain {
  readonly size: number;
  readonly cellSize: number;
  /** Number of cells along each side. */
  readonly cells: number;
  /** Vertices along each side (cells + 1). */
  readonly verts: number;
  readonly heights: Float32Array;
  /** 0..1 dune crest value per vertex, used for colouring. */
  readonly dune: Float32Array;
  /** 0..1 riverbed mask per vertex. */
  readonly river: Float32Array;
  /** 0..1 compacted ground mask (towns, pads). */
  readonly packed: Float32Array;

  constructor(size: number, cellSize: number) {
    this.size = size;
    this.cellSize = cellSize;
    this.cells = Math.round(size / cellSize);
    this.verts = this.cells + 1;
    const n = this.verts * this.verts;
    this.heights = new Float32Array(n);
    this.dune = new Float32Array(n);
    this.river = new Float32Array(n);
    this.packed = new Float32Array(n);
  }

  get half(): number {
    return this.size / 2;
  }

  index(ix: number, iz: number): number {
    return iz * this.verts + ix;
  }

  vertexX(ix: number): number {
    return ix * this.cellSize - this.half;
  }

  vertexZ(iz: number): number {
    return iz * this.cellSize - this.half;
  }

  /** Height at a world position, matching the mesh triangulation. Clamped at the edges. */
  heightAt(x: number, z: number): number {
    const fx = clamp((x + this.half) / this.cellSize, 0, this.cells - 1e-6);
    const fz = clamp((z + this.half) / this.cellSize, 0, this.cells - 1e-6);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fz - iz;
    const h00 = this.heights[this.index(ix, iz)];
    const h10 = this.heights[this.index(ix + 1, iz)];
    const h01 = this.heights[this.index(ix, iz + 1)];
    const h11 = this.heights[this.index(ix + 1, iz + 1)];
    if (u + v <= 1) {
      return h00 + (h10 - h00) * u + (h01 - h00) * v;
    }
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  /** Approximate slope (0 = flat, 1 = vertical) from the surface normal. */
  slopeAt(x: number, z: number): number {
    const e = this.cellSize * 0.5;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const ny = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    return 1 - ny;
  }

  /** Builds a desert landscape: dunes, rolling ground, mesas, a dry riverbed and boundary ridges. */
  static generateDesert(cfg: DesertConfig): Terrain {
    const t = new Terrain(cfg.size, cfg.cellSize);
    const noise = new Noise2D(cfg.seed);

    const natural = (x: number, z: number): { h: number; dune: number; river: number } => {
      const rolling = noise.fbm(x / 320, z / 320, 4) * 7;
      const warp = noise.fbm(x / 140 + 31, z / 140 - 17, 3) * 3.2;
      const duneWave = Math.sin((x * 0.55 + z * 0.83) / 16 + warp);
      // Asymmetric dune profile: gentle windward side, sharper crest.
      const dune = Math.pow((duneWave + 1) / 2, 2.2);
      const duneAmp = 1.6 * smoothstep(-0.3, 0.4, noise.fbm(x / 200 - 50, z / 200 + 80, 2));
      let h = rolling + dune * duneAmp + noise.fbm(x / 25, z / 25, 2) * 0.35;

      // Random mesas with a terrace.
      const m = noise.fbm(x / 240 + 10, z / 240 - 7, 4);
      const ragged = noise.fbm(x / 18, z / 18, 2) * 0.03;
      h += smoothstep(0.3, 0.34, m + ragged) * 22 + smoothstep(0.42, 0.45, m + ragged) * 12;

      // Boundary ridges frame the playable area.
      const edgeDist = Math.max(Math.abs(x), Math.abs(z));
      const edge = smoothstep(cfg.edgeStart, cfg.edgeStart + 110, edgeDist + noise.fbm(x / 60, z / 60, 3) * 30);
      h = Math.max(h, edge * (48 + noise.fbm(x / 90 + 5, z / 90, 3) * 14));

      let river = 0;
      if (cfg.riverbed) {
        const r = cfg.riverbed;
        const centre = r.offset + r.amplitude * Math.sin(x / r.wavelength) + noise.noise(x / 90, 3.3) * 12;
        river = smoothstep(r.width, r.width * 0.4, Math.abs(z - centre)) * (1 - edge);
        h -= river * r.depth;
        h = lerp(h, Math.min(h, rolling - r.depth), river * 0.6);
      }
      return { h, dune: dune * (duneAmp / 1.6), river };
    };

    // Resolve flatten zone heights from the natural terrain at their centres.
    const zones = cfg.flatten.map((zone) => ({
      ...zone,
      height: zone.height ?? natural(zone.x, zone.z).h,
    }));

    for (let iz = 0; iz < t.verts; iz++) {
      for (let ix = 0; ix < t.verts; ix++) {
        const x = t.vertexX(ix);
        const z = t.vertexZ(iz);
        const n = natural(x, z);
        let h = n.h;
        let packed = 0;
        let dune = n.dune;
        let river = n.river;

        for (const p of cfg.plateaus) {
          const d = Math.hypot(x - p.x, z - p.z) + noise.fbm(x / 14, z / 14, 2) * p.cliff * 0.5;
          const k = smoothstep(p.radius + p.cliff, p.radius, d);
          h = Math.max(h, lerp(h, p.height, k));
        }

        for (const zone of zones) {
          const d = Math.hypot(x - zone.x, z - zone.z);
          const k = smoothstep(zone.radius + zone.falloff, zone.radius, d);
          if (k > 0) {
            h = lerp(h, zone.height, k);
            packed = Math.max(packed, k);
            dune *= 1 - k;
            river *= 1 - k;
          }
        }

        const i = t.index(ix, iz);
        t.heights[i] = h;
        t.dune[i] = dune;
        t.river[i] = river;
        t.packed[i] = packed;
      }
    }
    return t;
  }
}
