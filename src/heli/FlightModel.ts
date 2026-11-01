import { approachAngle, clamp, damp, smoothstep } from '../core/math';
import { Bounds, circleVsSolid, Solid } from '../world/collision';
import { HeliSpec } from './HeliSpec';

export interface FlightInput {
  /** Desired horizontal direction in world space (x, z); magnitude 0..1. */
  moveX: number;
  moveZ: number;
  /** Collective: +1 climb, -1 descend, 0 hold altitude. */
  climb: number;
}

export interface FlightEnvironment {
  /** Terrain height including landable rooftops. */
  groundHeightAt(x: number, z: number): number;
  /** Ground slope (0 flat, 1 vertical) at a point. */
  slopeAt(x: number, z: number): number;
  solids: readonly Solid[];
  bounds: Bounds;
  /** True where the surface below is open water (touching it is a ditching). */
  isWater?(x: number, z: number): boolean;
  /** Current wind vector in m/s. */
  wind?: { x: number; z: number };
  /** Rising air in m/s, such as the heat updraft over a fire or wind up a slope. */
  updraft?: number;
  /** Rotor blades strike terrain that rises into the disc (mountain levels). */
  rotorStrike?: boolean;
}

export type FlightEvent =
  | { type: 'takeoff' }
  | { type: 'landed'; x: number; z: number }
  | { type: 'hardLanding'; severity: number }
  | { type: 'collision'; impact: number }
  | { type: 'rotorStrike'; impact: number }
  | { type: 'crashed'; reason: string }
  | { type: 'lowFuel' }
  | { type: 'fuelEmpty' };

const LOW_FUEL = 0.2;
const MAX_SLOPE = 0.12;
/** Extra thrust in ground effect (rotor close to the ground) and in translational lift (moving air). */
const GROUND_EFFECT = 0.12;
const TRANSLATIONAL_LIFT = 0.15;
/** Sink rate in m/s per unit of thrust shortfall when too heavy to hover. */
const SINK_PER_DEFICIT = 30;
const ROTOR_SAMPLES = 16;

/**
 * Fraction of sea-level rotor thrust available at an altitude above sea level. Falls linearly so
 * that the empty aircraft can only just hover at its service ceiling. Always 1 for aircraft
 * without a service ceiling.
 */
export const liftAtAltitude = (spec: HeliSpec, altitude: number): number => {
  if (!spec.serviceCeiling || !spec.hoverThrust) return 1;
  const atCeiling = 1 / spec.hoverThrust;
  return clamp(1 - ((1 - atCeiling) * Math.max(0, altitude)) / spec.serviceCeiling, 0.2, 1);
};

/**
 * Thrust over weight for an aircraft with a service ceiling (1 = can just hold a hover).
 * Ground effect helps within about a rotor diameter of the ground, and translational lift
 * helps once air flows through the disc at more than a few metres per second.
 */
export const thrustRatio = (spec: HeliSpec, altitude: number, payload: number, agl: number, airspeed: number): number => {
  const base = (spec.hoverThrust ?? 1) * liftAtAltitude(spec, altitude) * (spec.mass / (spec.mass + payload));
  const ground = GROUND_EFFECT * clamp(1 - agl / (spec.rotorRadius * 1.6), 0, 1);
  const translational = TRANSLATIONAL_LIFT * smoothstep(3, 14, airspeed);
  return base * (1 + ground + translational);
};

export interface RotorProximity {
  /** Horizontal gap between the blade tips and terrain at rotor height, in metres. */
  distance: number;
  /** Unit direction from the aircraft towards the terrain. */
  dirX: number;
  dirZ: number;
}

/**
 * Nearest terrain at rotor height within `range` metres of the blade tips, for the terrain
 * warning. Returns undefined when everything around the disc is clear.
 */
export const rotorProximity = (
  spec: HeliSpec,
  x: number,
  y: number,
  z: number,
  groundHeightAt: (x: number, z: number) => number,
  range = 14,
): RotorProximity | undefined => {
  const disc = y + spec.rotorHeight - 0.5;
  for (let d = 0; d <= range; d += 1.5) {
    const r = spec.rotorRadius + d;
    let best: RotorProximity | undefined;
    let worst = 0;
    for (let i = 0; i < ROTOR_SAMPLES; i++) {
      const a = (i / ROTOR_SAMPLES) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const over = groundHeightAt(x + dx * r, z + dz * r) - disc;
      if (over > worst || (over >= 0 && !best)) {
        worst = over;
        best = { distance: d, dirX: dx, dirZ: dz };
      }
    }
    if (best) return best;
  }
  return undefined;
};

/**
 * Arcade flight model. The stick tilts the rotor disc towards a world-space direction,
 * the tilt produces acceleration, and linear drag caps the top speed. The collective
 * sets a target vertical speed; releasing it holds altitude.
 */
export class FlightModel {
  readonly spec: HeliSpec;
  x = 0;
  /** Altitude of the skids above sea level. */
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  heading = 0;
  /** Rotor disc tilt as a world-space vector (|tilt| <= 1). */
  tiltX = 0;
  tiltZ = 0;
  /** Rotor speed 0..1. */
  spool = 0;
  engineOn = true;
  landed = true;
  destroyed = false;
  /** 0..1 fraction remaining. */
  fuel = 1;
  /** 0..1, destroyed at 1. */
  damage = 0;
  /** Mass of any slung load or passengers in kg. */
  payload = 0;
  /**
   * Spare thrust as a fraction of weight (0 = can only just hover, negative = sinking). Only
   * meaningful for aircraft with a service ceiling; always positive for the others.
   */
  thrustMargin = 1;
  private lowFuelWarned = false;
  private strikeCooldown = 0;

  constructor(spec: HeliSpec) {
    this.spec = spec;
  }

  place(x: number, y: number, z: number, heading = 0): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.heading = heading;
    this.vx = this.vy = this.vz = 0;
    this.tiltX = this.tiltZ = 0;
    this.landed = true;
  }

  get groundSpeed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** Performance left after carrying the payload (1 = empty). */
  get performance(): number {
    return this.spec.mass / (this.spec.mass + this.payload);
  }

  /** Velocity change from an external pull, such as a swinging sling load. */
  applyImpulse(dvx: number, dvz: number): void {
    if (this.landed || this.destroyed) return;
    this.vx += dvx;
    this.vz += dvz;
  }

  /** True if the aircraft's performance falls with altitude. */
  get thinAir(): boolean {
    return !!this.spec.serviceCeiling;
  }

  /** Fraction of full lift currently available from the rotor. */
  get liftAvailable(): number {
    return smoothstep(0.82, 1, this.spool);
  }

  step(dt: number, input: FlightInput, env: FlightEnvironment): FlightEvent[] {
    const events: FlightEvent[] = [];
    if (this.destroyed) {
      this.spool = damp(this.spool, 0, 0.6, dt);
      return events;
    }
    const s = this.spec;

    // Rotor spool and fuel.
    const powered = this.engineOn && this.fuel > 0;
    this.spool = powered
      ? Math.min(1, this.spool + s.spoolRate * dt)
      : Math.max(0, this.spool - 0.08 * dt);
    if (powered) {
      const effort = this.landed ? 0.25 : 0.7 + 0.2 * Math.hypot(this.tiltX, this.tiltZ) + 0.25 * Math.max(0, input.climb);
      this.fuel = Math.max(0, this.fuel - (effort * dt) / s.fuelEndurance);
      if (!this.lowFuelWarned && this.fuel < LOW_FUEL) {
        this.lowFuelWarned = true;
        events.push({ type: 'lowFuel' });
      }
      if (this.fuel === 0) events.push({ type: 'fuelEmpty' });
    }
    if (this.fuel >= LOW_FUEL) this.lowFuelWarned = false;

    const lift = this.liftAvailable;
    this.strikeCooldown = Math.max(0, this.strikeCooldown - dt);
    const windX = env.wind?.x ?? 0;
    const windZ = env.wind?.z ?? 0;
    if (this.thinAir) {
      const agl = Math.max(0, this.y - env.groundHeightAt(this.x, this.z));
      const airspeed = Math.hypot(this.vx - windX, this.vz - windZ);
      this.thrustMargin = thrustRatio(s, this.y, this.payload, this.landed ? 0 : agl, airspeed) - 1;
    }
    let mx = input.moveX;
    let mz = input.moveZ;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
    }

    if (this.landed) {
      this.tiltX = damp(this.tiltX, 0, 6, dt);
      this.tiltZ = damp(this.tiltZ, 0, 6, dt);
      this.vx = this.vz = this.vy = 0;
      // Too heavy for the thin air: the skids stay on the ground.
      if (input.climb > 0.1 && lift > 0.95 && this.thrustMargin > 0) {
        this.landed = false;
        this.y += 0.05;
        events.push({ type: 'takeoff' });
      } else {
        this.y = env.groundHeightAt(this.x, this.z);
        return events;
      }
    }

    // Cyclic: disc tilt chases the stick. With the stick centred, the brake assist
    // tilts the disc against the direction of travel (a flare) to come to a hover.
    let targetX = mx;
    let targetZ = mz;
    if (Math.hypot(mx, mz) < 0.05) {
      targetX = -(this.vx / s.maxSpeed) * s.brakeAssist;
      targetZ = -(this.vz / s.maxSpeed) * s.brakeAssist;
      const t = Math.hypot(targetX, targetZ);
      if (t > 1) {
        targetX /= t;
        targetZ /= t;
      }
    }
    this.tiltX = damp(this.tiltX, targetX, s.cyclicResponse, dt);
    this.tiltZ = damp(this.tiltZ, targetZ, s.cyclicResponse, dt);
    const perf = this.performance * liftAtAltitude(s, this.y);
    const authority = (0.3 + 0.7 * lift) * perf;
    // Drag acts on airspeed, so wind pushes the aircraft unless the pilot compensates.
    const drag = s.acceleration / s.maxSpeed;
    const wx = (env.wind?.x ?? 0) * s.windFactor;
    const wz = (env.wind?.z ?? 0) * s.windFactor;
    this.vx += (this.tiltX * s.acceleration * authority - (this.vx - wx) * drag) * dt;
    this.vz += (this.tiltZ * s.acceleration * authority - (this.vz - wz) * drag) * dt;

    // Collective: target vertical speed, falling when the rotor lacks power.
    const ground = env.groundHeightAt(this.x, this.z);
    const climb = clamp(input.climb, -1, 1);
    let targetVy = climb * s.climbRate * (climb > 0 ? perf : 1);
    if (this.thinAir) {
      // Climb rate follows spare thrust; with none to spare the aircraft sinks however hard
      // the collective is pulled.
      const e = this.thrustMargin;
      const reserve = ((s.hoverThrust ?? 1) - 1) * 0.5;
      const maxVy = e >= 0 ? s.climbRate * Math.min(1, e / reserve) : e * SINK_PER_DEFICIT;
      targetVy = Math.min(climb * s.climbRate, maxVy);
    }
    if (this.y - ground >= s.maxAltitude) targetVy = Math.min(targetVy, 0);
    targetVy += env.updraft ?? 0;
    // Landing cushion: limit the sink rate near the ground and flare harder to meet it.
    let response = s.collectiveResponse;
    const cushion = -(s.cushionSink + Math.max(0, this.y - ground) * s.cushionGain);
    if (targetVy < cushion) {
      targetVy = cushion;
      if (this.vy < cushion) response *= 2.5;
    }
    const sink = -s.climbRate * 1.1;
    targetVy = targetVy * lift + sink * (1 - lift);
    this.vy = damp(this.vy, targetVy, response, dt);

    // Integrate.
    const prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    // Nose follows the direction of travel.
    const speed = this.groundSpeed;
    if (speed > 2.5) {
      const target = Math.atan2(this.vx, this.vz);
      const rate = s.yawRate * smoothstep(2.5, 8, speed);
      this.heading = approachAngle(this.heading, target, rate * dt);
    } else if (env.wind && Math.hypot(env.wind.x, env.wind.z) > 1) {
      // In a hover the aircraft weathervanes slowly to face into the wind.
      const into = Math.atan2(-env.wind.x, -env.wind.z);
      this.heading = approachAngle(this.heading, into, s.yawRate * 0.25 * dt);
    }

    this.resolveSolids(env.solids, prevY, events);
    if (this.destroyed) return events;
    if (env.rotorStrike) this.resolveRotorTerrain(env, events);
    if (this.destroyed) return events;
    this.resolveBounds(env.bounds);
    this.resolveGround(env, events);
    return events;
  }

  private resolveSolids(solids: readonly Solid[], prevY: number, events: FlightEvent[]): void {
    const s = this.spec;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const discs = s.rotorDiscs ?? [{ offset: 0, radius: s.rotorRadius }];
    const checks = [
      { r: s.bodyRadius, offset: 0, bottom: this.y, top: this.y + s.bodyHeight },
      ...discs.map((d) => ({ r: d.radius, offset: d.offset, bottom: this.y + s.rotorHeight - 0.15, top: this.y + s.rotorHeight + 0.15 })),
    ];
    for (const solid of solids) {
      // Descending onto a landable roof is a landing, handled by ground resolution.
      if (solid.landable && prevY >= solid.top - 0.01) continue;
      for (const c of checks) {
        if (c.bottom >= solid.top) continue;
        const hit = circleVsSolid(this.x + fx * c.offset, this.z + fz * c.offset, c.r, solid);
        if (!hit) continue;
        this.x += hit.nx * hit.penetration;
        this.z += hit.nz * hit.penetration;
        const vn = this.vx * hit.nx + this.vz * hit.nz;
        if (vn < 0) {
          this.vx -= vn * hit.nx * 1.4;
          this.vz -= vn * hit.nz * 1.4;
        }
        const impact = Math.max(0, -vn);
        if (impact > this.spec.crashSpeed) {
          this.crash('Struck an obstacle', events);
          return;
        }
        if (impact > 1) {
          this.addDamage(impact * 0.05, events);
          events.push({ type: 'collision', impact });
          if (this.destroyed) return;
        }
      }
    }
  }

  /** Blades striking terrain that rises into the disc: knocked back and damaged, or destroyed. */
  private resolveRotorTerrain(env: FlightEnvironment, events: FlightEvent[]): void {
    const s = this.spec;
    const disc = this.y + s.rotorHeight;
    let worst = 0;
    let dirX = 0;
    let dirZ = 0;
    for (const r of [s.rotorRadius, s.rotorRadius * 0.6]) {
      for (let i = 0; i < ROTOR_SAMPLES; i++) {
        const a = (i / ROTOR_SAMPLES) * Math.PI * 2;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        const over = env.groundHeightAt(this.x + dx * r, this.z + dz * r) - disc;
        if (over > worst) {
          worst = over;
          dirX = dx;
          dirZ = dz;
        }
      }
    }
    if (worst <= 0) return;
    // Bounce away from the slope.
    this.x -= dirX * Math.min(1, 0.2 + worst * 0.3);
    this.z -= dirZ * Math.min(1, 0.2 + worst * 0.3);
    const vn = this.vx * dirX + this.vz * dirZ;
    if (vn > 0) {
      this.vx -= dirX * vn * 1.6;
      this.vz -= dirZ * vn * 1.6;
    }
    const impact = Math.max(0, vn) + Math.max(0, -this.vy) * 0.5;
    if (this.vy < 0) this.vy *= 0.3;
    if (impact > s.crashSpeed * 0.5) {
      this.crash('Rotor struck the mountainside', events);
      return;
    }
    if (this.strikeCooldown > 0) return;
    this.strikeCooldown = 0.6;
    events.push({ type: 'rotorStrike', impact });
    this.addDamage(0.15 + impact * 0.08, events);
  }

  private resolveBounds(b: Bounds): void {
    if (this.x < b.minX) {
      this.x = b.minX;
      this.vx = Math.max(0, this.vx);
    } else if (this.x > b.maxX) {
      this.x = b.maxX;
      this.vx = Math.min(0, this.vx);
    }
    if (this.z < b.minZ) {
      this.z = b.minZ;
      this.vz = Math.max(0, this.vz);
    } else if (this.z > b.maxZ) {
      this.z = b.maxZ;
      this.vz = Math.min(0, this.vz);
    }
  }

  private resolveGround(env: FlightEnvironment, events: FlightEvent[]): void {
    const ground = env.groundHeightAt(this.x, this.z);
    if (this.y > ground) return;
    const sink = Math.max(0, -this.vy);
    const slide = this.groundSpeed;
    const slope = env.slopeAt(this.x, this.z);
    this.y = ground;

    if (env.isWater?.(this.x, this.z)) {
      this.crash('Ditched in the sea', events);
      return;
    }
    if (sink > this.spec.crashSpeed || slide > this.spec.crashSpeed * 1.5) {
      this.crash('Hit the ground too hard', events);
      return;
    }
    if (slope > MAX_SLOPE * 2.5) {
      this.crash('Rolled over on steep ground', events);
      return;
    }

    const hard =
      Math.max(0, sink - this.spec.safeSinkRate) / this.spec.safeSinkRate +
      Math.max(0, slide - this.spec.safeGroundSpeed) / this.spec.safeGroundSpeed +
      Math.max(0, slope - MAX_SLOPE) / MAX_SLOPE;
    this.vx = this.vy = this.vz = 0;
    this.landed = true;
    if (hard > 0) {
      events.push({ type: 'hardLanding', severity: hard });
      this.addDamage(Math.min(0.9, hard * 0.18), events);
      if (this.destroyed) return;
    }
    events.push({ type: 'landed', x: this.x, z: this.z });
  }

  private addDamage(amount: number, events: FlightEvent[]): void {
    this.damage = Math.min(1, this.damage + amount);
    if (this.damage >= 1) this.crash('Airframe failure', events);
  }

  private crash(reason: string, events: FlightEvent[]): void {
    this.destroyed = true;
    this.damage = 1;
    this.vx = this.vy = this.vz = 0;
    events.push({ type: 'crashed', reason });
  }

  /** Destroys the aircraft from outside the flight model, such as on a wire strike. */
  wreck(reason: string): FlightEvent[] {
    const events: FlightEvent[] = [];
    if (!this.destroyed) this.crash(reason, events);
    return events;
  }

  /** Refuels and repairs at the given rates per second; used on service pads. */
  service(dt: number, refuelRate: number, repairRate: number): void {
    this.fuel = Math.min(1, this.fuel + refuelRate * dt);
    this.damage = Math.max(0, this.damage - repairRate * dt);
  }
}
