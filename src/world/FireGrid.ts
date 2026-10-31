import { clamp } from '../core/math';

/** Burn state of a cell. */
export const Cell = { Unburnt: 0, Burning: 1, Burnt: 2 } as const;
export type CellState = (typeof Cell)[keyof typeof Cell];

export interface FireGridConfig {
  /** Cells along each side (the grid is square). */
  size: number;
  /** Cell edge length in metres. */
  cellSize: number;
  /** World position of the centre of cell (0, 0). */
  originX: number;
  originZ: number;
  /** Ground height per cell. */
  heights: ArrayLike<number>;
  /** Fuel load per cell: 0 cannot burn (water, rock, road); about 1 is ordinary woodland. */
  fuel: ArrayLike<number>;
}

export interface FireTuning {
  /** Ignition progress per second a full-strength burning neighbour adds on level ground in still air. */
  spread: number;
  /** Wind effect: spread is multiplied by exp(windGain * windAlongDirection). */
  windGain: number;
  /** Slope effect: spread is multiplied by exp(slopeGain * rise/run). */
  slopeGain: number;
  /** Seconds a cell with a fuel load of 1 burns at full strength. */
  burnSeconds: number;
  /** Unburnt cells lose this much ignition progress per second. */
  cooling: number;
  /** Burning cells regain this much intensity per second after being doused. */
  recovery: number;
}

export const DEFAULT_TUNING: FireTuning = {
  spread: 0.07,
  windGain: 0.14,
  slopeGain: 2.5,
  burnSeconds: 40,
  cooling: 0.05,
  recovery: 0.04,
};

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Per-cell hash in 0..1 so fire edges are ragged but deterministic. */
const jitter = (i: number): number => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/**
 * Grid fire model. Pure and deterministic: no rendering and no randomness beyond a fixed
 * per-cell hash. Burning cells heat their neighbours, which ignite once enough heat has
 * built up; spread is faster uphill and downwind. Water wets cells, which stops them
 * igniting for a while, and knocks burning cells back until they go out.
 */
export class FireGrid {
  readonly size: number;
  readonly cellSize: number;
  readonly originX: number;
  readonly originZ: number;
  readonly heights: ArrayLike<number>;
  readonly fuel: Float32Array;
  readonly state: Uint8Array;
  /** Ignition progress (0..1) for unburnt cells; intensity (0..1) for burning ones. */
  readonly heat: Float32Array;
  /** Seconds of wetness remaining. */
  readonly wet: Float32Array;
  readonly tuning: FireTuning;
  /** Elapsed simulated seconds. */
  time = 0;
  private burning: number[] = [];
  private readonly warm = new Set<number>();
  private readonly changes = new Set<number>();
  /** Cells with wetness remaining, so only they need updating. */
  private readonly wetCells = new Set<number>();
  private burntCount = 0;
  private everBurned = 0;

  constructor(cfg: FireGridConfig, tuning: Partial<FireTuning> = {}) {
    this.size = cfg.size;
    this.cellSize = cfg.cellSize;
    this.originX = cfg.originX;
    this.originZ = cfg.originZ;
    this.heights = cfg.heights;
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    const n = cfg.size * cfg.size;
    this.fuel = new Float32Array(n);
    for (let i = 0; i < n; i++) this.fuel[i] = Math.max(0, cfg.fuel[i]);
    this.state = new Uint8Array(n);
    this.heat = new Float32Array(n);
    this.wet = new Float32Array(n);
  }

  index(cx: number, cz: number): number {
    return cz * this.size + cx;
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.size && cz < this.size;
  }

  cellX(x: number): number {
    return Math.round((x - this.originX) / this.cellSize);
  }

  cellZ(z: number): number {
    return Math.round((z - this.originZ) / this.cellSize);
  }

  /** Cell index at a world position, or -1 outside the grid. */
  cellAt(x: number, z: number): number {
    const cx = this.cellX(x);
    const cz = this.cellZ(z);
    return this.inBounds(cx, cz) ? this.index(cx, cz) : -1;
  }

  centreX(i: number): number {
    return this.originX + (i % this.size) * this.cellSize;
  }

  centreZ(i: number): number {
    return this.originZ + Math.floor(i / this.size) * this.cellSize;
  }

  /** Number of cells currently on fire. */
  get burningCount(): number {
    return this.burning.length;
  }

  /** Number of cells burnt out. */
  get burntOut(): number {
    return this.burntCount;
  }

  /** Ground area on fire, in square metres. */
  get burningArea(): number {
    return this.burning.length * this.cellSize * this.cellSize;
  }

  /** Ground area burning or burnt, in square metres. */
  get burnedArea(): number {
    return (this.burning.length + this.burntCount) * this.cellSize * this.cellSize;
  }

  /** Total cells that have ever caught fire (a cell put out and re-lit counts once per ignition). */
  get ignitions(): number {
    return this.everBurned;
  }

  /** Indices of burning cells. Valid until the next step. */
  burningCells(): readonly number[] {
    return this.burning;
  }

  /** Cells whose state changed since the last call, then forgets them. */
  drainChanges(): number[] {
    const out = [...this.changes];
    this.changes.clear();
    return out;
  }

  isBurning(i: number): boolean {
    return this.state[i] === Cell.Burning;
  }

  /** Burning cells with centres inside a circle. */
  burningWithin(x: number, z: number, radius: number): number {
    let count = 0;
    this.forEachInCircle(x, z, radius, (i) => {
      if (this.state[i] === Cell.Burning) count++;
    });
    return count;
  }

  /** True if no cell inside the circle is burning. */
  isClear(x: number, z: number, radius: number): boolean {
    return this.burningWithin(x, z, radius) === 0;
  }

  /** Cells inside the circle that are burning or burnt out. */
  burnedWithin(x: number, z: number, radius: number): number {
    let count = 0;
    this.forEachInCircle(x, z, radius, (i) => {
      if (this.state[i] !== Cell.Unburnt) count++;
    });
    return count;
  }

  /** Sets fire to every flammable cell inside the circle. Returns the number ignited. */
  ignite(x: number, z: number, radius = 0): number {
    let count = 0;
    const centre = this.cellAt(x, z);
    if (radius <= 0 && centre >= 0) {
      if (this.light(centre)) count++;
      return count;
    }
    this.forEachInCircle(x, z, radius, (i) => {
      if (this.light(i)) count++;
    });
    return count;
  }

  /**
   * Drops water on a circle. `amount` (0..1) is the water per cell at the centre and falls off
   * to the edge. Every cell it touches is wetted, so it resists ignition: each unit of water buys
   * `wetSeconds` of wetness, up to three times that.
   * A burning cell loses intensity and goes out when that reaches zero. Returns how many burning
   * cells the water landed on.
   */
  douse(x: number, z: number, radius: number, amount: number, wetSeconds = 100): number {
    let out = false;
    let hit = 0;
    this.forEachInCircle(x, z, radius, (i, dist) => {
      const k = amount * (1 - 0.5 * (dist / Math.max(radius, 1e-6)));
      if (k <= 0) return;
      this.wet[i] = Math.min(wetSeconds * 3, this.wet[i] + k * wetSeconds);
      this.wetCells.add(i);
      if (this.state[i] === Cell.Burning) {
        hit++;
        this.heat[i] -= k * 2;
        if (this.heat[i] <= 0) {
          this.extinguish(i);
          out = true;
        }
      } else if (this.state[i] === Cell.Unburnt) {
        this.heat[i] = 0;
        this.warm.delete(i);
      }
    });
    if (out) this.burning = this.burning.filter((i) => this.state[i] === Cell.Burning);
    return hit;
  }

  /** Sum over burning cells within `radius` of how close each is (1 at the point, 0 at the edge). */
  heatNear(x: number, z: number, radius: number): number {
    let total = 0;
    for (const i of this.burning) {
      const d = Math.hypot(this.centreX(i) - x, this.centreZ(i) - z);
      if (d < radius) total += (1 - d / radius) * this.heat[i];
    }
    return total;
  }

  /** Distance from a point to the nearest burning cell, or Infinity if nothing burns. */
  nearestBurning(x: number, z: number): number {
    let best = Infinity;
    for (const i of this.burning) best = Math.min(best, Math.hypot(this.centreX(i) - x, this.centreZ(i) - z));
    return best;
  }

  /** Advances the fire by `dt` seconds with the wind blowing towards (windX, windZ) in m/s. */
  step(dt: number, windX = 0, windZ = 0): void {
    if (dt <= 0) return;
    this.time += dt;
    const t = this.tuning;
    const size = this.size;
    const cell = this.cellSize;
    const next: number[] = [];
    const ignite: number[] = [];

    for (const i of this.burning) {
      const cx = i % size;
      const cz = (i - cx) / size;

      // Burn down, and recover strength after a soaking.
      const fuelLeft = this.fuel[i] - dt / t.burnSeconds;
      this.fuel[i] = Math.max(0, fuelLeft);
      if (fuelLeft <= 0) {
        this.state[i] = Cell.Burnt;
        this.heat[i] = 0;
        this.burntCount++;
        this.changes.add(i);
        continue;
      }
      const target = Math.min(1, 0.3 + this.fuel[i] * 2);
      this.heat[i] = Math.min(target, this.heat[i] + t.recovery * dt);
      if (this.wet[i] > 0) this.heat[i] -= 0.05 * dt;
      if (this.heat[i] <= 0) {
        this.extinguish(i);
        continue;
      }
      next.push(i);

      const strength = this.heat[i];
      const h0 = this.heights[i];
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.inBounds(nx, nz)) continue;
        const j = nz * size + nx;
        if (this.state[j] !== Cell.Unburnt || this.fuel[j] <= 0 || this.wet[j] > 0) continue;
        const run = cell * (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        const rise = (this.heights[j] - h0) / run;
        const along = (windX * dx + windZ * dz) / (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        const rate =
          t.spread *
          strength *
          Math.min(this.fuel[j] * 2, 1.5) *
          (0.8 + 0.4 * jitter(j)) *
          Math.exp(clamp(t.windGain * along, -1.5, 1.8)) *
          Math.exp(clamp(t.slopeGain * rise, -1.5, 1.5)) *
          (dx !== 0 && dz !== 0 ? 0.7 : 1);
        this.heat[j] += rate * dt;
        this.warm.add(j);
        if (this.heat[j] >= 1) ignite.push(j);
      }
    }

    // Unburnt cells cool when nothing is feeding them heat.
    for (const j of this.warm) {
      if (this.state[j] !== Cell.Unburnt) {
        this.warm.delete(j);
        continue;
      }
      if (this.heat[j] >= 1) continue;
      this.heat[j] = Math.max(0, this.heat[j] - t.cooling * dt);
      if (this.heat[j] === 0) this.warm.delete(j);
    }

    this.burning = next;
    for (const j of ignite) this.light(j);
    for (const j of this.wetCells) {
      this.wet[j] = Math.max(0, this.wet[j] - dt);
      if (this.wet[j] === 0) this.wetCells.delete(j);
    }
  }

  private light(i: number): boolean {
    if (this.state[i] !== Cell.Unburnt || this.fuel[i] <= 0) return false;
    this.state[i] = Cell.Burning;
    this.heat[i] = 1;
    this.wet[i] = 0;
    this.warm.delete(i);
    this.burning.push(i);
    this.everBurned++;
    this.changes.add(i);
    return true;
  }

  private extinguish(i: number): void {
    this.state[i] = Cell.Unburnt;
    this.heat[i] = 0;
    this.wet[i] = Math.max(this.wet[i], 20);
    this.wetCells.add(i);
    this.changes.add(i);
  }

  private forEachInCircle(x: number, z: number, radius: number, fn: (i: number, dist: number) => void): void {
    const r = Math.ceil(radius / this.cellSize);
    const c0x = this.cellX(x);
    const c0z = this.cellZ(z);
    for (let cz = Math.max(0, c0z - r); cz <= Math.min(this.size - 1, c0z + r); cz++) {
      for (let cx = Math.max(0, c0x - r); cx <= Math.min(this.size - 1, c0x + r); cx++) {
        const dist = Math.hypot(this.originX + cx * this.cellSize - x, this.originZ + cz * this.cellSize - z);
        if (dist <= radius) fn(this.index(cx, cz), dist);
      }
    }
  }
}
