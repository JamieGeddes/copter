import { SurvivorDef } from './types';

export interface BoardingConfig {
  /** Survivors walk to an aircraft landed within this distance. */
  radius: number;
  /** Seconds each survivor takes to reach the aircraft and climb in. */
  seconds: number;
}

export const DEFAULT_BOARDING: BoardingConfig = { radius: 32, seconds: 2.5 };

/** Guidance for the HUD: how to pick up survivors who board on foot. */
export type BoardingHint = 'none' | 'land' | 'closer' | 'full' | 'boarding';

export interface BoardingAircraft {
  x: number;
  z: number;
  landed: boolean;
}

export type BoardingEvent = { type: 'boarded'; id: string };

/**
 * Landing pickups: once the aircraft is down near survivors who can walk (a hut, a glacier),
 * they come over one at a time and climb aboard while there is room. Taking off sends anyone
 * still on their way back to where they were.
 */
export class Boarding {
  readonly config: BoardingConfig;
  /** Survivor walking to the aircraft. */
  walkingId?: string;
  /** 0..1 progress of the survivor walking over. */
  progress = 0;
  hint: BoardingHint = 'none';
  /** Nearest waiting survivor, for guidance. */
  nearestId?: string;

  constructor(config: BoardingConfig = DEFAULT_BOARDING) {
    this.config = config;
  }

  update(dt: number, heli: BoardingAircraft, survivors: readonly SurvivorDef[], rescued: ReadonlySet<string>, capacityLeft: number): BoardingEvent[] {
    const events: BoardingEvent[] = [];
    const c = this.config;
    let nearest: SurvivorDef | undefined;
    let nearestDist = Infinity;
    for (const s of survivors) {
      if (s.pickup !== 'landing' || rescued.has(s.id)) continue;
      const d = Math.hypot(heli.x - s.x, heli.z - s.z);
      if (d < nearestDist) {
        nearest = s;
        nearestDist = d;
      }
    }
    this.nearestId = nearestDist < 150 ? nearest?.id : undefined;

    if (this.walkingId) {
      if (!heli.landed) {
        this.walkingId = undefined;
        this.progress = 0;
      } else {
        this.progress += dt / c.seconds;
        if (this.progress >= 1) {
          events.push({ type: 'boarded', id: this.walkingId });
          this.walkingId = undefined;
          this.progress = 0;
        }
      }
    } else if (heli.landed && capacityLeft > 0 && nearest && nearestDist <= c.radius) {
      this.walkingId = nearest.id;
      this.progress = 0;
    }

    if (this.walkingId) this.hint = 'boarding';
    else if (!nearest || nearestDist > 150) this.hint = 'none';
    else if (capacityLeft <= 0) this.hint = nearestDist <= c.radius ? 'full' : 'none';
    else if (nearestDist > c.radius) this.hint = heli.landed ? 'closer' : 'land';
    else this.hint = heli.landed ? 'boarding' : 'land';
    return events;
  }
}
