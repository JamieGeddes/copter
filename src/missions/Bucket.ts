import { clamp } from '../core/math';

/** Where the bucket hangs from: the aircraft's cargo hook. */
export interface BucketHook {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  groundSpeed: number;
  /** Aircraft mass, for sharing the rope tension. */
  mass: number;
}

export interface BucketEnv {
  groundHeightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  /** Surface height of open water, if the level has any. */
  waterLevel?: number;
}

/** Water falling from the bucket this step. */
export interface Spray {
  x: number;
  y: number;
  z: number;
  /** Height of the surface below the bucket. */
  groundY: number;
  /** Radius of the wetted circle on the ground. */
  radius: number;
  /** Water per cell per second at the centre of the circle (see FireGrid.douse). */
  strength: number;
}

export type BucketEvent = { type: 'filled' } | { type: 'dropEnd' };

export type BucketHint = 'empty' | 'dipping' | 'tooFast' | 'full' | 'dropping' | 'part';

const G = 9.81;
/** Empty bucket mass in kg. */
export const BUCKET_EMPTY_MASS = 150;
/** Mass of a full load of water in kg. */
export const BUCKET_WATER_MASS = 1400;
/** Seconds to fill from empty while dipped. */
export const FILL_SECONDS = 2;
/** Seconds to empty a full bucket. */
export const DROP_SECONDS = 2.5;
/** Fastest the bucket can be pulled through the water and still fill. */
export const DIP_MAX_SPEED = 8;
const SWING_DAMPING = 0.35;
const COUPLING = 0.6;

/** Radius of the wetted circle for a drop from a given height. */
export const sprayRadius = (height: number): number => clamp(4 + 0.25 * height, 4, 14);

/** Water strength per cell per second; the same load spread over a wider circle is thinner. */
export const sprayStrength = (radius: number): number => 1.1 * Math.min(1, (5 / radius) ** 2);

/**
 * Water bucket on a long line. A point mass on a rope from the cargo hook, filled by dipping it
 * in water and emptied with the action key as a spray cone over whatever is beneath.
 */
export class Bucket {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** 0..1 */
  fill = 0;
  dropping = false;
  dipping = false;
  /** Sitting on the ground or floating on water. */
  resting = true;
  /** Total water delivered, as a fraction of a full load. */
  delivered = 0;
  hint: BucketHint = 'empty';
  private fast = false;

  constructor(readonly ropeLength: number) {}

  /** Total mass hanging from the hook once airborne, in kg. */
  get mass(): number {
    return BUCKET_EMPTY_MASS + this.fill * BUCKET_WATER_MASS;
  }

  /** Mass the aircraft is actually carrying (nothing while the bucket rests on the ground). */
  get liftedMass(): number {
    return this.resting ? 0 : this.mass;
  }

  /** Places the bucket hanging from the hook. */
  attach(hook: BucketHook, env: BucketEnv): void {
    this.x = hook.x;
    this.z = hook.z;
    this.y = Math.max(this.surface(this.x, this.z, env), hook.y - this.ropeLength);
    this.vx = this.vy = this.vz = 0;
  }

  /** Starts emptying the bucket. Returns false if there is nothing worth dropping. */
  drop(): boolean {
    if (this.dropping || this.fill < 0.04) return false;
    this.dropping = true;
    return true;
  }

  private surface(x: number, z: number, env: BucketEnv): number {
    const ground = env.groundHeightAt(x, z);
    return env.isWater(x, z) && env.waterLevel !== undefined ? Math.max(ground, env.waterLevel) : ground;
  }

  update(dt: number, hook: BucketHook, env: BucketEnv): { dvx: number; dvz: number; events: BucketEvent[]; spray?: Spray } {
    const events: BucketEvent[] = [];
    let dvx = 0;
    let dvz = 0;
    const mass = this.mass;

    this.vy -= G * dt;
    const air = Math.exp(-0.25 * dt);
    this.vx *= air;
    this.vy *= air;
    this.vz *= air;
    const k = 1 - Math.exp(-SWING_DAMPING * dt);
    this.vx -= (this.vx - hook.vx) * k;
    this.vz -= (this.vz - hook.vz) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    const dx = this.x - hook.x;
    const dy = this.y - hook.y;
    const dz = this.z - hook.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > this.ropeLength) {
      const nx = dx / len;
      const ny = dy / len;
      const nz = dz / len;
      const corr = len - this.ropeLength;
      this.x -= nx * corr;
      this.y -= ny * corr;
      this.z -= nz * corr;
      const vr = (this.vx - hook.vx) * nx + (this.vy - hook.vy) * ny + (this.vz - hook.vz) * nz;
      if (vr > 0) {
        this.vx -= nx * vr;
        this.vy -= ny * vr;
        this.vz -= nz * vr;
      }
      const tension = Math.max(0, vr) + corr / dt;
      const share = (mass / (mass + hook.mass)) * COUPLING;
      dvx += nx * tension * share;
      dvz += nz * tension * share;
    }

    // Ground or water surface: the bucket drags along it.
    const surface = this.surface(this.x, this.z, env);
    const onWater = env.waterLevel !== undefined && env.isWater(this.x, this.z);
    this.resting = false;
    this.dipping = false;
    if (this.y <= surface + 0.05) {
      this.y = surface;
      this.vy = Math.max(0, this.vy);
      const friction = Math.exp((onWater ? -1.5 : -5) * dt);
      this.vx *= friction;
      this.vz *= friction;
      this.resting = Math.hypot(this.vx, this.vz) < 0.5;
      if (onWater) {
        this.fast = hook.groundSpeed > DIP_MAX_SPEED;
        this.dipping = !this.fast && !this.dropping;
      }
    }
    if (!onWater) this.fast = false;

    let spray: Spray | undefined;
    if (this.dipping && this.fill < 1) {
      this.fill = Math.min(1, this.fill + dt / FILL_SECONDS);
      if (this.fill >= 1) events.push({ type: 'filled' });
    }
    if (this.dropping) {
      const flow = Math.min(this.fill, dt / DROP_SECONDS);
      const groundY = Math.max(env.groundHeightAt(this.x, this.z), onWater ? (env.waterLevel ?? -Infinity) : -Infinity);
      const radius = sprayRadius(Math.max(0, this.y - groundY));
      spray = { x: this.x, y: this.y, z: this.z, groundY, radius, strength: sprayStrength(radius) };
      this.fill -= flow;
      this.delivered += flow;
      if (this.fill <= 1e-4) {
        this.fill = 0;
        this.dropping = false;
        events.push({ type: 'dropEnd' });
      }
    }

    this.hint = this.dropping
      ? 'dropping'
      : this.dipping
        ? 'dipping'
        : this.fast && this.fill < 1
          ? 'tooFast'
          : this.fill >= 0.99
            ? 'full'
            : this.fill > 0
              ? 'part'
              : 'empty';
    return { dvx, dvz, events, spray };
  }
}
