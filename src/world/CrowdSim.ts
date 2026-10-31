import { approachAngle, createRng } from '../core/math';
import { pointInSolid, Solid } from './collision';
import { CrowdDef } from './level';
import { World } from './World';

export interface Person {
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Seconds until the next change of mind. */
  timer: number;
  /** Walk cycle phase. */
  phase: number;
  /** 0..1 panic level from nearby rotor wash. */
  fear: number;
  homeX: number;
  homeZ: number;
  radius: number;
}

export interface Threat {
  x: number;
  z: number;
  /** Height above the ground; low aircraft are scarier. */
  agl: number;
}

const WALK = 1.3;
const RUN = 5.2;

/** Ambient crowd behaviour: amble about, stop to chat, and run from low-flying aircraft. */
export class CrowdSim {
  readonly people: Person[] = [];
  private readonly world: World;
  private readonly rng: () => number;
  /** Solids near any crowd, so per-step checks stay cheap. */
  private readonly nearbySolids: Solid[];

  constructor(world: World, crowds: CrowdDef[], seed = 11) {
    this.world = world;
    this.rng = createRng(seed);
    const reach = 60;
    this.nearbySolids = world.solids.filter((s) =>
      crowds.some((c) => {
        const cx = Math.min(Math.max(c.x, s.minX), s.maxX);
        const cz = Math.min(Math.max(c.z, s.minZ), s.maxZ);
        return Math.hypot(c.x - cx, c.z - cz) < c.radius + reach;
      }),
    );
    for (const c of crowds) {
      let placed = 0;
      let attempts = 0;
      while (placed < c.count && attempts < c.count * 20) {
        attempts++;
        const a = this.rng() * Math.PI * 2;
        const r = Math.sqrt(this.rng()) * c.radius;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (this.blocked(x, z)) continue;
        this.people.push({
          x,
          z,
          heading: this.rng() * Math.PI * 2,
          speed: 0,
          timer: this.rng() * 4,
          phase: this.rng() * Math.PI * 2,
          fear: 0,
          homeX: c.x,
          homeZ: c.z,
          radius: c.radius,
        });
        placed++;
      }
    }
  }

  private blocked(x: number, z: number): boolean {
    for (const s of this.nearbySolids) {
      if (pointInSolid(x, z, s)) return true;
    }
    return this.world.terrain.slopeAt(x, z) > 0.3;
  }

  update(dt: number, threat?: Threat): void {
    for (const p of this.people) {
      let targetHeading = p.heading;
      let targetSpeed = p.speed;

      const dx = threat ? p.x - threat.x : 0;
      const dz = threat ? p.z - threat.z : 0;
      const dist = Math.hypot(dx, dz);
      const scare = threat && threat.agl < 25 ? Math.max(0, 1 - dist / (14 + (25 - threat.agl) * 0.6)) : 0;
      p.fear = Math.max(scare, p.fear - dt * 0.25);

      if (p.fear > 0.05) {
        if (scare > 0) targetHeading = Math.atan2(dx, dz);
        targetSpeed = RUN * Math.min(1, p.fear * 2);
      } else {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.timer = 2 + this.rng() * 6;
          const fromHome = Math.hypot(p.x - p.homeX, p.z - p.homeZ);
          if (fromHome > p.radius) {
            targetHeading = Math.atan2(p.homeX - p.x, p.homeZ - p.z);
            targetSpeed = WALK;
          } else if (this.rng() < 0.35) {
            targetSpeed = 0;
          } else {
            targetHeading = p.heading + (this.rng() - 0.5) * 2.5;
            targetSpeed = WALK * (0.7 + this.rng() * 0.6);
          }
          p.heading = targetHeading;
        }
      }

      p.heading = approachAngle(p.heading, targetHeading, 6 * dt);
      p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 4);
      const nx = p.x + Math.sin(p.heading) * p.speed * dt;
      const nz = p.z + Math.cos(p.heading) * p.speed * dt;
      if (this.blocked(nx, nz)) {
        p.heading += Math.PI * (0.5 + this.rng());
        p.timer = 1;
      } else {
        p.x = nx;
        p.z = nz;
      }
      p.phase += p.speed * dt * 4.5;
    }
  }
}
