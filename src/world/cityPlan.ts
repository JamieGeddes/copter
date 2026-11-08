import { clamp, createRng } from '../core/math';
import { BuildingDef } from './level';
import { CityRiver, cityRiverZ } from './Terrain';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CityPlanConfig {
  seed: number;
  /** Street height, for the bridge decks. */
  ground: number;
  /** Street centre lines, used for both axes. */
  lines: number[];
  /** How far streets run beyond the outer lines. */
  reach: number;
  /** Half-width of a street, kerb to kerb plus pavement. */
  streetHalf: number;
  river: CityRiver;
  /** Gap between the water and anything built on the banks. */
  riverClearance: number;
  /** Streets running across the river (along z) at these x positions cross it on bridges. */
  bridges: number[];
  /** A motorway along x at this z: streets end at it and blocks stop short of it. */
  motorwayZ: number;
  motorwayHalf: number;
  /** Downtown: buildings are tallest here, falling away over `spread` metres. */
  centre: { x: number; z: number };
  peak: number;
  spread: number;
  /** No streets or generated buildings: hospitals, the stadium, parks and other special sites. */
  reserved: Rect[];
  /** No generated buildings: landing zones and their approaches. */
  keepClear: { x: number; z: number; radius: number }[];
}

export interface CityPlan {
  roads: [number, number][][];
  buildings: BuildingDef[];
  /** Bridge decks, one per crossing. */
  bridges: BuildingDef[];
}

const GLASS = [0x5a6a7a, 0x66727e, 0x4e5c6a, 0x708090, 0x5c6470];
const BRICK = [0x8a5a48, 0x9a6a50, 0x7a6a5a, 0x8c7466, 0xa07a5c];
const HOUSE = [0xa89a88, 0x8c7e70, 0xb0a08a, 0x9a8c7c];

const inRect = (x: number, z: number, r: Rect, margin = 0): boolean =>
  x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin;

const rectsOverlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Distance from a point to a rectangle (0 inside). */
const rectDistance = (x: number, z: number, r: Rect): number =>
  Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));

/** Distance from a point to the water's edge (negative in the water). */
export const riverGap = (river: CityRiver, x: number, z: number): number => Math.abs(z - cityRiverZ(river, x)) - river.halfWidth;

/** Splits a straight street into the runs that are clear of water and reserved ground. */
const runs = (fixed: number, from: number, to: number, alongX: boolean, ok: (x: number, z: number) => boolean): [number, number][][] => {
  const out: [number, number][][] = [];
  let start: number | undefined;
  const step = 2;
  for (let t = from; t <= to + 1e-6; t += step) {
    const x = alongX ? t : fixed;
    const z = alongX ? fixed : t;
    const good = ok(x, z);
    if (good && start === undefined) start = t;
    const end = !good || t + step > to + 1e-6;
    if (end && start !== undefined) {
      const stop = good ? t : t - step;
      if (stop - start >= 24) out.push(alongX ? [[start, fixed], [stop, fixed]] : [[fixed, start], [fixed, stop]]);
      start = undefined;
    }
  }
  return out;
};

/**
 * Lays out a city: a grid of streets split by the river (with bridges on some), and blocks
 * subdivided into lots with buildings whose height falls away from downtown: office towers in
 * the centre, flats around them and terraced houses at the edges.
 */
export const planCity = (cfg: CityPlanConfig): CityPlan => {
  const rng = createRng(cfg.seed);
  const lines = cfg.lines;
  const lo = lines[0] - cfg.reach;
  const hi = lines[lines.length - 1] + cfg.reach;
  const clearOfRiver = (x: number, z: number, margin: number) => riverGap(cfg.river, x, z) > margin;
  const reserved = (x: number, z: number, margin: number) => cfg.reserved.some((r) => inRect(x, z, r, margin));
  const streetEndZ = cfg.motorwayZ;

  const roads: [number, number][][] = [];
  const bridges: BuildingDef[] = [];
  const streetOk = (x: number, z: number, bridged: boolean) =>
    !reserved(x, z, -cfg.streetHalf) && (bridged || clearOfRiver(x, z, cfg.riverClearance));
  // Streets along z (crossing the river), ending at the motorway.
  for (const x of lines) {
    const bridged = cfg.bridges.includes(x);
    roads.push(...runs(x, lo, streetEndZ, false, (px, pz) => streetOk(px, pz, bridged)));
    if (bridged) {
      const zc = cityRiverZ(cfg.river, x);
      const slope = Math.abs((cfg.river.amplitude / cfg.river.wavelength) * Math.cos(x / cfg.river.wavelength));
      const span = cfg.river.halfWidth * 2 * Math.sqrt(1 + slope * slope) + cfg.riverClearance * 2 + 6;
      bridges.push({ kind: 'bridge', x, z: zc, w: cfg.streetHalf * 2 + 1, d: span, h: 0, top: cfg.ground + 0.35, colour: 0x6c6862, landable: true });
    }
  }
  // Streets along x, stopping short of the motorway.
  for (const z of lines) {
    if (z > streetEndZ - cfg.motorwayHalf - cfg.streetHalf) continue;
    roads.push(...runs(z, lo, hi, true, (px, pz) => streetOk(px, pz, false)));
  }

  // Blocks between the streets, including the strip in front of the motorway.
  const zLines = [...lines.filter((z) => z < streetEndZ - cfg.motorwayHalf - cfg.streetHalf), streetEndZ];
  const buildings: BuildingDef[] = [];
  const kerb = cfg.streetHalf + 2;
  for (let i = 0; i < lines.length - 1; i++) {
    for (let j = 0; j < zLines.length - 1; j++) {
      const block: Rect = {
        minX: lines[i] + kerb,
        maxX: lines[i + 1] - kerb,
        minZ: zLines[j] + kerb,
        maxZ: zLines[j + 1] - (zLines[j + 1] === streetEndZ ? cfg.motorwayHalf + 2 : kerb),
      };
      buildings.push(...fillBlock(block, cfg, rng));
    }
  }
  // Keep the lots clear of the bridge approaches.
  const clear = buildings.filter((b) => !bridges.some((q) => rectsOverlap(footprint(b, 2), footprint(q, 0))));
  return { roads, buildings: clear, bridges };
};

const footprint = (b: BuildingDef, margin: number): Rect => ({
  minX: b.x - b.w / 2 - margin,
  maxX: b.x + b.w / 2 + margin,
  minZ: b.z - b.d / 2 - margin,
  maxZ: b.z + b.d / 2 + margin,
});

/** Subdivides a block into lots and puts a building on each that is clear of the river and reserved ground. */
const fillBlock = (block: Rect, cfg: CityPlanConfig, rng: () => number): BuildingDef[] => {
  const out: BuildingDef[] = [];
  const w = block.maxX - block.minX;
  const d = block.maxZ - block.minZ;
  if (w < 14 || d < 14) return out;
  const cx = (block.minX + block.maxX) / 2;
  const cz = (block.minZ + block.maxZ) / 2;
  const dist = Math.hypot(cx - cfg.centre.x, cz - cfg.centre.z);
  const downtown = Math.exp(-((dist / cfg.spread) ** 2));
  // Downtown blocks hold one or two big towers; outer blocks are cut into smaller lots.
  const nx = downtown > 0.5 ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2);
  const nz = downtown > 0.5 ? 1 + Math.floor(rng() * 2) : 2;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const lot: Rect = {
        minX: block.minX + (w * a) / nx,
        maxX: block.minX + (w * (a + 1)) / nx,
        minZ: block.minZ + (d * b) / nz,
        maxZ: block.minZ + (d * (b + 1)) / nz,
      };
      // Some lots are left as yards and car parks.
      if (rng() < 0.12 * (1 - downtown)) continue;
      const inset = 1.5 + rng() * 2.5;
      const fp: Rect = { minX: lot.minX + inset, maxX: lot.maxX - inset, minZ: lot.minZ + inset, maxZ: lot.maxZ - inset };
      const bw = fp.maxX - fp.minX;
      const bd = fp.maxZ - fp.minZ;
      if (bw < 8 || bd < 8) continue;
      const x = (fp.minX + fp.maxX) / 2;
      const z = (fp.minZ + fp.maxZ) / 2;
      if (cfg.reserved.some((r) => rectsOverlap(fp, r))) continue;
      if (cfg.keepClear.some((c) => rectDistance(c.x, c.z, fp) < c.radius)) continue;
      const corners: [number, number][] = [[fp.minX, fp.minZ], [fp.maxX, fp.minZ], [fp.minX, fp.maxZ], [fp.maxX, fp.maxZ], [x, fp.minZ], [x, fp.maxZ]];
      if (corners.some(([px, pz]) => riverGap(cfg.river, px, pz) < cfg.riverClearance)) continue;

      const ld = Math.hypot(x - cfg.centre.x, z - cfg.centre.z);
      const k = Math.exp(-((ld / cfg.spread) ** 2));
      const h = clamp(cfg.peak * k * (0.6 + rng() * 0.6) + 5 + rng() * 6, 6, cfg.peak * 1.1);
      const kind: BuildingDef['kind'] = h >= 28 ? 'tower' : h >= 12 ? 'flats' : 'terrace';
      const palette = kind === 'tower' ? GLASS : kind === 'flats' ? BRICK : HOUSE;
      const height = kind === 'terrace' ? Math.min(h, 9) : Math.round(h);
      // Towers taper to a slimmer footprint so the streets between them read as canyons.
      const shrink = kind === 'tower' ? 0.75 + rng() * 0.2 : 1;
      out.push({
        kind,
        x,
        z,
        w: Math.round(bw * shrink),
        d: Math.round(bd * shrink),
        h: height,
        colour: palette[Math.floor(rng() * palette.length)],
      });
    }
  }
  return out;
};
