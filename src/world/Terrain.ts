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

interface BaseTerrainConfig {
  seed: number;
  size: number;
  cellSize: number;
  /** Distance from centre at which the boundary ridges begin to rise. */
  edgeStart: number;
  flatten: FlattenZone[];
  plateaus: Plateau[];
}

export interface DesertConfig extends BaseTerrainConfig {
  kind: 'desert';
  riverbed?: Riverbed;
}

/**
 * Coastline running diagonally across the map: land towards the top of the screen
 * (-x, -z) and open sea towards the bottom (+x, +z).
 */
export interface CoastConfig extends BaseTerrainConfig {
  kind: 'coast';
  /** Distance of the coastline from the centre along the seaward axis. */
  coastOffset: number;
  cliffHeight: number;
  /** Sandy coves, by position along the coast and half-width. */
  coves: { along: number; width: number }[];
}

export interface FloodRiver {
  amplitude: number;
  wavelength: number;
  amplitude2: number;
  wavelength2: number;
  halfWidth: number;
  depth: number;
  /** Where the river narrows (for a bridge crossing). */
  narrows?: { x: number; halfWidth: number; span: number };
}

/** Flat farmland in a grid of fields, crossed by a wide river in flood. */
export interface FloodplainConfig extends BaseTerrainConfig {
  kind: 'floodplain';
  river: FloodRiver;
  fieldSize: number;
  /** Rotation of the field grid in radians. */
  fieldAngle: number;
}

export type TerrainConfig = DesertConfig | CoastConfig | FloodplainConfig;

/** Centre line of a floodplain river (z for a given x). */
export const floodRiverZ = (r: FloodRiver, x: number): number =>
  r.amplitude * Math.sin(x / r.wavelength) + r.amplitude2 * Math.sin(x / r.wavelength2 + 1.3);

/** Half-width of a floodplain river at x, including any narrows. */
export const floodRiverHalfWidth = (r: FloodRiver, x: number): number =>
  r.narrows ? lerp(r.halfWidth, r.narrows.halfWidth, smoothstep(r.narrows.span, 0, Math.abs(x - r.narrows.x))) : r.halfWidth;
export type TerrainKind = TerrainConfig['kind'];

const DIAG = Math.SQRT1_2;
const fract = (v: number): number => v - Math.floor(v);

/** Seaward (u) and along-coast (v) coordinates for the diagonal coastline. */
export const coastAxes = (x: number, z: number): { u: number; v: number } => ({
  u: (x + z) * DIAG,
  v: (x - z) * DIAG,
});

/**
 * Square heightfield centred on the origin. Heights are sampled on a regular grid and
 * interpolated with the same triangulation as the rendered mesh, so ground contact
 * matches what the player sees.
 */
export class Terrain {
  readonly kind: TerrainKind;
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
  /** 0..1 beach sand mask (coast only). */
  readonly beach: Float32Array;
  /** Field grid rotation (floodplain only), used for crop rows. */
  fieldAngle = 0;

  constructor(size: number, cellSize: number, kind: TerrainKind = 'desert') {
    this.kind = kind;
    this.size = size;
    this.cellSize = cellSize;
    this.cells = Math.round(size / cellSize);
    this.verts = this.cells + 1;
    const n = this.verts * this.verts;
    this.heights = new Float32Array(n);
    this.dune = new Float32Array(n);
    this.river = new Float32Array(n);
    this.packed = new Float32Array(n);
    this.beach = new Float32Array(n);
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

  static generate(cfg: TerrainConfig): Terrain {
    if (cfg.kind === 'coast') return Terrain.generateCoast(cfg);
    if (cfg.kind === 'floodplain') return Terrain.generateFloodplain(cfg);
    return Terrain.generateDesert(cfg);
  }

  /** Builds a desert landscape: dunes, rolling ground, mesas, a dry riverbed and boundary ridges. */
  static generateDesert(cfg: DesertConfig): Terrain {
    const noise = new Noise2D(cfg.seed);

    const natural = (x: number, z: number): { h: number; dune: number; river: number; beach: number } => {
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
      return { h, dune: dune * (duneAmp / 1.6), river, beach: 0 };
    };
    return Terrain.build(cfg, natural, noise);
  }

  /** Builds a coastline with cliffs, sandy coves, rolling grassland and a shelving seabed. */
  static generateCoast(cfg: CoastConfig): Terrain {
    const noise = new Noise2D(cfg.seed);
    const natural = (x: number, z: number) => {
      const { u, v } = coastAxes(x, z);
      const coastU = cfg.coastOffset + 45 * Math.sin(v / 170) + noise.fbm(v / 120, 3.1, 3) * 35;
      const d = coastU - u;
      let cove = 0;
      for (const c of cfg.coves) cove = Math.max(cove, smoothstep(c.width, c.width * 0.4, Math.abs(v - c.along)));
      const variation = noise.fbm(x / 70, z / 70, 3);
      let h: number;
      if (d >= 0) {
        const cliffH = cfg.cliffHeight + noise.fbm(x / 150, z / 150, 3) * 8;
        const cliff = cliffH * smoothstep(0, 12 + noise.fbm(x / 25, z / 25, 2) * 6, d);
        const beach = Math.min(d * 0.07, 2.5) + smoothstep(35, 140, d) * cliffH * 0.8;
        h = lerp(cliff, beach, cove);
        h += noise.fbm(x / 260, z / 260, 3) * 10 * smoothstep(40, 220, d) + noise.fbm(x / 35, z / 35, 2) * 0.5;
      } else {
        h = Math.max(-24, d * 0.16 - 0.8) + noise.fbm(x / 50, z / 50, 3) * 1.5;
        // Rocky shelves at the foot of the cliffs.
        const rocks = Math.max(0, noise.fbm(x / 11, z / 11, 2) + 0.05) * 6 * (1 - cove) * smoothstep(-28, 0, d);
        h = Math.max(h, h + rocks);
      }
      // Hills along the inland edges of the map.
      const edgeDist = Math.max(Math.abs(x), Math.abs(z));
      const edge = smoothstep(cfg.edgeStart, cfg.edgeStart + 120, edgeDist + noise.fbm(x / 60, z / 60, 3) * 30);
      if (d > 30) h = Math.max(h, edge * (cfg.cliffHeight + 30 + variation * 12));
      const beachMask = cove * smoothstep(-8, 1, d) * (1 - smoothstep(25, 70, d));
      return { h, dune: variation * 0.5 + 0.5, river: 0, beach: beachMask };
    };
    return Terrain.build(cfg, natural, noise, 'coast');
  }

  /** Builds farmland with a field grid, flooded hollows and a river channel. */
  static generateFloodplain(cfg: FloodplainConfig): Terrain {
    const noise = new Noise2D(cfg.seed);
    const ca = Math.cos(cfg.fieldAngle);
    const sa = Math.sin(cfg.fieldAngle);
    const natural = (x: number, z: number) => {
      const r = cfg.river;
      const dRiver = Math.abs(z - floodRiverZ(r, x));
      let h = 3 + noise.fbm(x / 220, z / 220, 3) * 1.6 + noise.fbm(x / 45, z / 45, 2) * 0.3;
      // Low-lying fields near the river are under water.
      const hollow = smoothstep(0.08, 0.4, noise.fbm(x / 150 + 20, z / 150 - 4, 3)) * smoothstep(200, 50, dRiver);
      h -= hollow * 3.8;
      // Gentle hills frame the valley.
      const edgeDist = Math.max(Math.abs(x), Math.abs(z));
      const edge = smoothstep(cfg.edgeStart, cfg.edgeStart + 130, edgeDist + noise.fbm(x / 70, z / 70, 3) * 30);
      h = Math.max(h, edge * (22 + noise.fbm(x / 90, z / 90, 3) * 8));
      // River channel with sloping banks.
      const hw = floodRiverHalfWidth(r, x);
      const channel = smoothstep(hw + 12, hw, dRiver);
      h = lerp(h, -r.depth, channel);
      // Field id from a rotated grid, used for crop colours.
      const u = (x * ca + z * sa) / cfg.fieldSize;
      const v = (-x * sa + z * ca) / cfg.fieldSize;
      const field = fract(Math.sin(Math.floor(u) * 127.1 + Math.floor(v) * 311.7) * 43758.5453);
      return { h, dune: field, river: channel, beach: 0 };
    };
    const t = Terrain.build(cfg, natural, noise, 'floodplain');
    t.fieldAngle = cfg.fieldAngle;
    return t;
  }

  private static build(
    cfg: BaseTerrainConfig,
    natural: (x: number, z: number) => { h: number; dune: number; river: number; beach: number },
    noise: Noise2D,
    kind: TerrainKind = 'desert',
  ): Terrain {
    const t = new Terrain(cfg.size, cfg.cellSize, kind);
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
        let beach = n.beach;

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
            beach *= 1 - k;
          }
        }

        const i = t.index(ix, iz);
        t.heights[i] = h;
        t.dune[i] = dune;
        t.river[i] = river;
        t.packed[i] = packed;
        t.beach[i] = beach;
      }
    }
    return t;
  }
}
