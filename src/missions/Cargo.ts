import { approachAngle, smoothstep } from '../core/math';
import { pointInSolid, Solid } from '../world/collision';

export type CargoKind = 'girder' | 'generator' | 'pallet';

export interface CargoDef {
  id: string;
  kind: CargoKind;
  label: string;
  x: number;
  z: number;
  heading: number;
  /** Mass in kg. */
  mass: number;
  /** Width (local x), height and length (local z, along the heading). */
  w: number;
  h: number;
  d: number;
}

export interface CargoEnv {
  groundHeightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  solids: readonly Solid[];
  seaLevel?: number;
}

/** The aircraft's cargo hook. */
export interface HookState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  groundSpeed: number;
  landed: boolean;
  /** Aircraft empty mass, for sharing the rope tension. */
  mass: number;
}

export type CargoHint = 'none' | 'tooHigh' | 'tooLow' | 'closer' | 'tooFast' | 'hooking' | 'carrying';

export type CargoEvent =
  | { type: 'hooked'; id: string }
  | { type: 'released'; id: string }
  | { type: 'impact'; id: string; damage: number }
  | { type: 'lost'; id: string }
  | { type: 'destroyed'; id: string };

const G = 9.81;
/** Height of the sling apex above the top of the load. */
export const SLING_APEX = 1.6;
const HOOK_RADIUS = 3;
const HOOK_MIN_HEIGHT = 2;
const HOOK_MAX_SPEED = 2;
const HOOK_SECONDS = 1;
const SAFE_DROP = 2.5;
const SWING_DAMPING = 0.3;
const COUPLING = 0.6;

export class CargoItem {
  readonly def: CargoDef;
  /** Bottom centre of the load. */
  x: number;
  y = 0;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  heading: number;
  damage = 0;
  resting = true;
  /** Fell in the water or was destroyed. */
  lost = false;
  /** Delivered and fixed in place; can no longer be hooked. */
  fixed = false;

  constructor(def: CargoDef, y: number) {
    this.def = def;
    this.x = def.x;
    this.z = def.z;
    this.y = y;
    this.heading = def.heading;
  }

  /** Where the sling meets the rope. */
  get liftY(): number {
    return this.y + this.def.h + SLING_APEX;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy, this.vz);
  }

  /** Support sample points: centre and four corners, in world space. */
  samples(x = this.x, z = this.z): [number, number][] {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    const hw = this.def.w * 0.45;
    const hd = this.def.d * 0.45;
    const out: [number, number][] = [[x, z]];
    for (const [lx, lz] of [
      [-hw, -hd],
      [hw, -hd],
      [-hw, hd],
      [hw, hd],
    ]) {
      out.push([x + lx * c + lz * s, z - lx * s + lz * c]);
    }
    return out;
  }
}

/** Slung cargo: hooking up, rope physics, landing on supports, damage and loss. */
export class CargoSystem {
  readonly items: CargoItem[];
  readonly ropeLength: number;
  hooked?: CargoItem;
  hint: CargoHint = 'none';
  /** Id of the load the hint refers to. */
  nearestId?: string;
  private hookTimer = 0;

  constructor(defs: CargoDef[], env: CargoEnv, ropeLength: number) {
    this.ropeLength = ropeLength;
    this.items = defs.map((d) => {
      const item = new CargoItem(d, 0);
      item.y = this.support(item, env).h;
      return item;
    });
  }

  get hookProgress(): number {
    return Math.min(1, this.hookTimer / HOOK_SECONDS);
  }

  item(id: string): CargoItem {
    const it = this.items.find((i) => i.def.id === id);
    if (!it) throw new Error(`Unknown cargo: ${id}`);
    return it;
  }

  /** Mass the aircraft is currently lifting (none while the load rests on the ground). */
  get liftedMass(): number {
    return this.hooked && !this.hooked.resting ? this.hooked.def.mass : 0;
  }

  release(): CargoEvent | undefined {
    if (!this.hooked) return undefined;
    const id = this.hooked.def.id;
    this.hooked = undefined;
    this.hookTimer = 0;
    return { type: 'released', id };
  }

  /**
   * Advances all loads. Returns events and the velocity change the rope applies to the
   * aircraft this step (horizontal only; weight is handled as payload).
   */
  update(dt: number, hook: HookState | null, env: CargoEnv): { events: CargoEvent[]; dvx: number; dvz: number } {
    const events: CargoEvent[] = [];
    let dvx = 0;
    let dvz = 0;
    if (!hook && this.hooked) {
      const e = this.release();
      if (e) events.push(e);
    }

    for (const item of this.items) {
      if (item.lost) continue;
      const isHooked = item === this.hooked && !!hook;
      if (item.resting && !isHooked) continue;
      const pull = this.stepItem(item, dt, isHooked ? hook : null, env, events);
      dvx += pull.dvx;
      dvz += pull.dvz;
      if (item.damage >= 1 && !item.lost) {
        item.lost = true;
        events.push({ type: 'destroyed', id: item.def.id });
        if (this.hooked === item) this.hooked = undefined;
      }
    }

    this.updateHooking(dt, hook, events);
    return { events, dvx, dvz };
  }

  private stepItem(item: CargoItem, dt: number, hook: HookState | null, env: CargoEnv, events: CargoEvent[]) {
    let dvx = 0;
    let dvz = 0;
    item.vy -= G * dt;
    const air = Math.exp(-0.1 * dt);
    item.vx *= air;
    item.vy *= air;
    item.vz *= air;
    if (hook) {
      // Damp the swing relative to the hook so loads settle after a few oscillations.
      const k = 1 - Math.exp(-SWING_DAMPING * dt);
      item.vx -= (item.vx - hook.vx) * k;
      item.vz -= (item.vz - hook.vz) * k;
    }
    const px = item.x;
    const py = item.y;
    const pz = item.z;
    item.x += item.vx * dt;
    item.y += item.vy * dt;
    item.z += item.vz * dt;

    if (hook) {
      const dx = item.x - hook.x;
      const dy = item.liftY - hook.y;
      const dz = item.z - hook.z;
      const len = Math.hypot(dx, dy, dz);
      if (len > this.ropeLength) {
        const nx = dx / len;
        const ny = dy / len;
        const nz = dz / len;
        const corr = len - this.ropeLength;
        item.x -= nx * corr;
        item.y -= ny * corr;
        item.z -= nz * corr;
        const vr = (item.vx - hook.vx) * nx + (item.vy - hook.vy) * ny + (item.vz - hook.vz) * nz;
        if (vr > 0) {
          item.vx -= nx * vr;
          item.vy -= ny * vr;
          item.vz -= nz * vr;
        }
        // Equal and opposite pull on the aircraft, horizontal part only. For a steady
        // swing this works out at g * sin(angle) scaled by the mass ratio.
        const tension = Math.max(0, vr) + corr / dt;
        const share = (item.def.mass / (item.def.mass + hook.mass)) * COUPLING;
        dvx += nx * tension * share;
        dvz += nz * tension * share;
      }
      item.heading = approachAngle(item.heading, hook.heading, 1.2 * smoothstep(2, 6, hook.groundSpeed) * dt);
    }

    this.resolveSolids(item, px, py, pz, env.solids, events);

    const sup = this.support(item, env);
    item.resting = false;
    if (sup.wet) {
      if (item.y <= (env.seaLevel ?? -Infinity)) {
        item.lost = true;
        events.push({ type: 'lost', id: item.def.id });
        if (this.hooked === item) this.hooked = undefined;
      }
      return { dvx, dvz };
    }
    if (item.y <= sup.h) {
      const impact = -item.vy;
      if (impact > SAFE_DROP) {
        const dmg = (impact - SAFE_DROP) * 0.12;
        item.damage = Math.min(1, item.damage + dmg);
        events.push({ type: 'impact', id: item.def.id, damage: dmg });
      }
      item.y = sup.h;
      item.vy = Math.max(0, item.vy);
      const friction = Math.exp(-6 * dt);
      item.vx *= friction;
      item.vz *= friction;
      const hs = Math.hypot(item.vx, item.vz);
      if (hook && hs > 3) item.damage = Math.min(1, item.damage + (hs - 3) * 0.08 * dt);
      if (item.speed < 0.25) {
        item.resting = true;
        if (!hook) item.vx = item.vy = item.vz = 0;
      }
    }
    return { dvx, dvz };
  }

  private resolveSolids(item: CargoItem, px: number, py: number, pz: number, solids: readonly Solid[], events: CargoEvent[]): void {
    for (const [sx, sz] of item.samples()) {
      for (const s of solids) {
        if (!pointInSolid(sx, sz, s) || item.y >= s.top - 0.3) continue;
        // Coming down onto a landable top is support, not a collision.
        if (s.landable && py >= s.top - 0.3) continue;
        const hs = Math.hypot(item.vx, item.vz);
        item.x = px;
        item.z = pz;
        item.vx *= -0.3;
        item.vz *= -0.3;
        if (hs > 1.5) {
          const dmg = hs * 0.05;
          item.damage = Math.min(1, item.damage + dmg);
          events.push({ type: 'impact', id: item.def.id, damage: dmg });
        }
        return;
      }
    }
  }

  /** Highest dry support under the load's sample points. */
  support(item: CargoItem, env: CargoEnv): { h: number; wet: boolean } {
    let h = -Infinity;
    for (const [sx, sz] of item.samples()) {
      if (env.isWater(sx, sz)) continue;
      h = Math.max(h, env.groundHeightAt(sx, sz));
    }
    return h === -Infinity ? { h: env.seaLevel ?? 0, wet: true } : { h, wet: false };
  }

  private updateHooking(dt: number, hook: HookState | null, events: CargoEvent[]): void {
    if (this.hooked) {
      this.hint = 'carrying';
      this.nearestId = this.hooked.def.id;
      return;
    }
    this.hint = 'none';
    this.nearestId = undefined;
    if (!hook || hook.landed) {
      this.hookTimer = 0;
      return;
    }
    let nearest: CargoItem | undefined;
    let best = 25;
    for (const it of this.items) {
      if (it.lost || it.fixed) continue;
      const d = Math.hypot(it.x - hook.x, it.z - hook.z);
      if (d < best) {
        best = d;
        nearest = it;
      }
    }
    if (!nearest) {
      this.hookTimer = 0;
      return;
    }
    this.nearestId = nearest.def.id;
    const height = hook.y - nearest.liftY;
    if (height > this.ropeLength - 0.5) this.hint = 'tooHigh';
    else if (height < HOOK_MIN_HEIGHT) this.hint = 'tooLow';
    else if (best > HOOK_RADIUS) this.hint = 'closer';
    else if (hook.groundSpeed > HOOK_MAX_SPEED) this.hint = 'tooFast';
    else this.hint = 'hooking';

    if (this.hint === 'hooking') {
      this.hookTimer += dt;
      if (this.hookTimer >= HOOK_SECONDS) {
        this.hooked = nearest;
        this.hookTimer = 0;
        this.hint = 'carrying';
        events.push({ type: 'hooked', id: nearest.def.id });
      }
    } else {
      this.hookTimer = Math.max(0, this.hookTimer - dt * 2);
    }
  }
}
