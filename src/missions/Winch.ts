import { SurvivorDef } from './types';

export interface WinchConfig {
  /** Horizontal distance from the survivor within which the winch will work. */
  radius: number;
  /** Allowed height band above the survivor. */
  minHeight: number;
  maxHeight: number;
  /** Maximum ground speed while lowering or attaching. */
  maxSpeed: number;
  lowerRate: number;
  raiseRate: number;
  attachSeconds: number;
}

export const DEFAULT_WINCH: WinchConfig = {
  radius: 4.5,
  minHeight: 6,
  maxHeight: 24,
  maxSpeed: 2.5,
  lowerRate: 5,
  raiseRate: 4,
  attachSeconds: 1.2,
};

export type WinchState = 'idle' | 'lowering' | 'attaching' | 'raising';

/** Guidance for the HUD about why the winch isn't working yet. */
export type WinchHint = 'none' | 'tooHigh' | 'tooLow' | 'tooFast' | 'closer' | 'full' | 'working';

export interface WinchAircraft {
  x: number;
  y: number;
  z: number;
  groundSpeed: number;
  landed: boolean;
}

export type WinchEvent = { type: 'attached'; id: string } | { type: 'rescued'; id: string };

/**
 * Automatic rescue winch. Hold a steady hover over a survivor and the hook goes down;
 * drift out of position and it comes back up. Once attached, the survivor is reeled in.
 */
export class Winch {
  readonly config: WinchConfig;
  state: WinchState = 'idle';
  /** Paid-out cable length in metres. */
  cable = 0;
  targetId?: string;
  /** Id of the survivor on the hook while raising. */
  carryingId?: string;
  hint: WinchHint = 'none';
  /** Nearest survivor considered for guidance. */
  nearestId?: string;
  private attachTimer = 0;

  constructor(config: WinchConfig = DEFAULT_WINCH) {
    this.config = config;
  }

  /** 0..1 progress of the attach step. */
  get attachProgress(): number {
    return this.attachTimer / this.config.attachSeconds;
  }

  update(
    dt: number,
    heli: WinchAircraft,
    survivors: readonly SurvivorDef[],
    rescued: ReadonlySet<string>,
    capacityLeft: number,
  ): WinchEvent[] {
    const events: WinchEvent[] = [];
    const c = this.config;

    // Guidance and target selection use the nearest waiting survivor.
    let nearest: SurvivorDef | undefined;
    let nearestDist = Infinity;
    for (const s of survivors) {
      if (rescued.has(s.id) || s.id === this.carryingId) continue;
      const d = Math.hypot(heli.x - s.x, heli.z - s.z);
      if (d < nearestDist) {
        nearest = s;
        nearestDist = d;
      }
    }
    this.nearestId = nearestDist < 40 ? nearest?.id : undefined;

    const inPosition = (s: SurvivorDef | undefined): boolean => {
      if (!s || heli.landed) return false;
      const h = heli.y - s.y;
      return Math.hypot(heli.x - s.x, heli.z - s.z) <= c.radius && h >= c.minHeight && h <= c.maxHeight && heli.groundSpeed <= c.maxSpeed;
    };

    const target = survivors.find((s) => s.id === this.targetId);

    switch (this.state) {
      case 'idle':
        if (capacityLeft > 0 && inPosition(nearest)) {
          this.targetId = nearest!.id;
          this.state = 'lowering';
        }
        break;
      case 'lowering':
        if (!inPosition(target)) {
          this.cable = Math.max(0, this.cable - c.raiseRate * dt);
          if (this.cable === 0) {
            this.state = 'idle';
            this.targetId = undefined;
          }
        } else {
          this.cable += c.lowerRate * dt;
          const drop = heli.y - target!.y;
          if (this.cable >= drop) {
            this.cable = drop;
            this.state = 'attaching';
            this.attachTimer = 0;
          }
        }
        break;
      case 'attaching':
        if (!inPosition(target)) {
          this.state = 'lowering';
          this.attachTimer = 0;
        } else {
          this.cable = heli.y - target!.y;
          this.attachTimer += dt;
          if (this.attachTimer >= c.attachSeconds) {
            this.state = 'raising';
            this.carryingId = this.targetId;
            events.push({ type: 'attached', id: this.targetId! });
          }
        }
        break;
      case 'raising':
        this.cable = Math.max(0, this.cable - c.raiseRate * dt);
        if (this.cable === 0) {
          events.push({ type: 'rescued', id: this.carryingId! });
          this.state = 'idle';
          this.carryingId = undefined;
          this.targetId = undefined;
        }
        break;
    }

    this.hint = this.computeHint(heli, this.state === 'idle' ? nearest : target ?? nearest, capacityLeft);
    return events;
  }

  private computeHint(heli: WinchAircraft, s: SurvivorDef | undefined, capacityLeft: number): WinchHint {
    if (this.state === 'raising') return 'working';
    if (!s || Math.hypot(heli.x - s.x, heli.z - s.z) > 40 || heli.landed) return 'none';
    if (capacityLeft <= 0 && this.state === 'idle') return 'full';
    const c = this.config;
    const h = heli.y - s.y;
    if (h > c.maxHeight) return 'tooHigh';
    if (h < c.minHeight) return 'tooLow';
    if (Math.hypot(heli.x - s.x, heli.z - s.z) > c.radius) return 'closer';
    if (heli.groundSpeed > c.maxSpeed) return 'tooFast';
    return 'working';
  }
}
