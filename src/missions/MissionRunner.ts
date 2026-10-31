import { wrapAngle } from '../core/math';
import { GateDef, MissionDef, ObjectiveDef } from './types';

export interface CargoSnapshot {
  id: string;
  x: number;
  z: number;
  heading: number;
  resting: boolean;
  hooked: boolean;
  lost: boolean;
  destroyed: boolean;
}

type PlaceObjective = Extract<ObjectiveDef, { kind: 'place' }>;

/** True if a load satisfies a placement objective's position and heading. */
export const isPlaced = (c: CargoSnapshot, o: PlaceObjective): boolean => {
  if (c.hooked || !c.resting || c.lost) return false;
  if (Math.hypot(c.x - o.x, c.z - o.z) > o.radius) return false;
  if (o.heading === undefined) return true;
  // End-for-end symmetric: compare headings modulo half a turn.
  const diff = Math.abs(wrapAngle(2 * (c.heading - o.heading))) / 2;
  return diff <= (o.headingTolerance ?? 0.26);
};

/** What the mission needs to know about the aircraft each tick. */
export interface MissionSnapshot {
  x: number;
  y: number;
  z: number;
  /** Height above the surface below. */
  agl: number;
  groundSpeed: number;
  landed: boolean;
  destroyed: boolean;
  /** Id of the pad the aircraft is resting on, if any. */
  padId?: string;
  /** Ground height beneath the active gate, against which gate altitude is measured. */
  groundY: number;
  cargo?: CargoSnapshot[];
}

export type MissionEvent =
  | { type: 'objectiveComplete'; index: number; text: string }
  | { type: 'gatePassed'; index: number; total: number }
  | { type: 'passengerUnloaded'; remaining: number }
  | { type: 'complete'; time: number }
  | { type: 'failed'; reason: string };

export type MissionStatus = 'running' | 'complete' | 'failed';

const HOVER_SPEED_LIMIT = 3;
const UNLOAD_SECONDS = 1.5;

/** Steps a mission's objectives in order and reports progress. */
export class MissionRunner {
  readonly def: MissionDef;
  status: MissionStatus = 'running';
  failReason = '';
  elapsed = 0;
  index = 0;
  /** Survivors winched aboard and not yet delivered. */
  onboard = 0;
  readonly rescued = new Set<string>();
  /** Loads delivered by completed placement objectives. */
  readonly placed = new Set<string>();
  /** Loads currently inside the active placement zone and correctly set down. */
  placedNow = 0;
  delivered = 0;
  private hoverHeld = 0;
  private gateIndex = 0;
  private unloadTimer = 0;

  constructor(def: MissionDef) {
    this.def = def;
  }

  get objective(): ObjectiveDef | undefined {
    return this.def.objectives[this.index];
  }

  /** 0..1 progress through the current objective. */
  get progress(): number {
    const o = this.objective;
    if (!o) return 1;
    switch (o.kind) {
      case 'hover':
        return Math.min(1, this.hoverHeld / o.seconds);
      case 'gates':
        return this.gateIndex / o.gates.length;
      case 'rescue':
        return o.survivors.filter((id) => this.rescued.has(id)).length / o.survivors.length;
      case 'deliver': {
        const total = this.delivered + this.onboard;
        return total === 0 ? 0 : this.delivered / total;
      }
      case 'place':
        return this.placedNow / o.cargo.length;
      default:
        return 0;
    }
  }

  /** Detail line for the current objective, e.g. "Gate 2 of 5". */
  get detail(): string {
    const o = this.objective;
    if (!o) return '';
    switch (o.kind) {
      case 'hover':
        return `Hold ${o.minAlt}-${o.maxAlt} m: ${Math.min(o.seconds, this.hoverHeld).toFixed(1)} / ${o.seconds} s`;
      case 'gates':
        return `Gate ${Math.min(this.gateIndex + 1, o.gates.length)} of ${o.gates.length}`;
      case 'rescue':
        return `Rescued ${o.survivors.filter((id) => this.rescued.has(id)).length} of ${o.survivors.length} · aboard ${this.onboard}/${this.def.capacity ?? '∞'}`;
      case 'deliver':
        return `Aboard: ${this.onboard}`;
      case 'place':
        return o.cargo.length > 1 ? `Delivered ${this.placedNow} of ${o.cargo.length}` : '';
      default:
        return '';
    }
  }

  /** The next gate to fly through, if the current objective is a gate run. */
  get activeGate(): GateDef | undefined {
    const o = this.objective;
    return o?.kind === 'gates' ? o.gates[this.gateIndex] : undefined;
  }

  /** Pad the player should land on now, if any. */
  get targetPad(): string | undefined {
    const o = this.objective;
    return o?.kind === 'land' || o?.kind === 'deliver' ? o.pad : undefined;
  }

  /** The active placement zone, if any. */
  get placeTarget(): PlaceObjective | undefined {
    const o = this.objective;
    return o?.kind === 'place' ? o : undefined;
  }

  /** Loads the player should be working with now. */
  get activeCargo(): string[] {
    const o = this.objective;
    if (o?.kind === 'hook') return [o.cargo];
    if (o?.kind === 'place') return o.cargo;
    return [];
  }

  get capacityLeft(): number {
    return (this.def.capacity ?? Infinity) - this.onboard;
  }

  /** Called by the winch when a survivor is safely aboard. */
  notifyRescued(id: string): void {
    if (this.rescued.has(id)) return;
    this.rescued.add(id);
    this.onboard++;
  }

  update(dt: number, s: MissionSnapshot): MissionEvent[] {
    const events: MissionEvent[] = [];
    if (this.status !== 'running') return events;
    this.elapsed += dt;

    if (s.destroyed) return this.fail('The aircraft was lost', events);
    for (const c of s.cargo ?? []) {
      if (c.destroyed) return this.fail(`${this.cargoLabel(c.id)} was destroyed`, events);
      if (c.lost) return this.fail(`${this.cargoLabel(c.id)} was lost in the water`, events);
    }
    if (this.def.timeLimit !== undefined && this.elapsed > this.def.timeLimit) return this.fail('Out of time', events);

    // Allow several objectives to complete in one tick (e.g. landing completes two).
    for (let guard = 0; guard < 4 && this.objective; guard++) {
      if (!this.check(dt, s, events, this.objective)) break;
      events.push({ type: 'objectiveComplete', index: this.index, text: this.objective.text });
      this.index++;
      this.hoverHeld = 0;
      this.gateIndex = 0;
      this.unloadTimer = 0;
      dt = 0;
    }
    if (!this.objective) {
      this.status = 'complete';
      events.push({ type: 'complete', time: this.elapsed });
    }
    return events;
  }

  private check(dt: number, s: MissionSnapshot, events: MissionEvent[], o: ObjectiveDef): boolean {
    switch (o.kind) {
      case 'takeoff':
        return !s.landed && s.agl > 3;
      case 'hover': {
        const inside =
          Math.hypot(s.x - o.x, s.z - o.z) <= o.radius &&
          s.agl >= o.minAlt &&
          s.agl <= o.maxAlt &&
          s.groundSpeed <= HOVER_SPEED_LIMIT &&
          !s.landed;
        this.hoverHeld = inside ? this.hoverHeld + dt : Math.max(0, this.hoverHeld - dt * 2);
        return this.hoverHeld >= o.seconds;
      }
      case 'gates': {
        const g = o.gates[this.gateIndex];
        const altitude = s.y - s.groundY;
        if (g && Math.hypot(s.x - g.x, s.z - g.z) <= g.radius && Math.abs(altitude - g.alt) <= g.radius) {
          this.gateIndex++;
          events.push({ type: 'gatePassed', index: this.gateIndex, total: o.gates.length });
        }
        return this.gateIndex >= o.gates.length;
      }
      case 'land':
        return s.landed && s.padId === o.pad;
      case 'rescue':
        return o.survivors.every((id) => this.rescued.has(id));
      case 'hook':
        return !!s.cargo?.find((c) => c.id === o.cargo)?.hooked;
      case 'place': {
        const loads = (s.cargo ?? []).filter((c) => o.cargo.includes(c.id));
        this.placedNow = loads.filter((c) => isPlaced(c, o)).length;
        if (this.placedNow < o.cargo.length) return false;
        for (const id of o.cargo) this.placed.add(id);
        this.placedNow = 0;
        return true;
      }
      case 'deliver': {
        if (!(s.landed && s.padId === o.pad)) {
          this.unloadTimer = 0;
          return false;
        }
        if (this.onboard > 0) {
          this.unloadTimer += dt;
          if (this.unloadTimer >= UNLOAD_SECONDS) {
            this.unloadTimer = 0;
            this.onboard--;
            this.delivered++;
            events.push({ type: 'passengerUnloaded', remaining: this.onboard });
          }
        }
        return this.onboard === 0;
      }
    }
  }

  private cargoLabel(id: string): string {
    return this.def.cargo?.find((c) => c.id === id)?.label ?? 'Cargo';
  }

  /** Ends the mission early, e.g. when stranded without fuel. */
  abort(reason: string): void {
    if (this.status !== 'running') return;
    this.status = 'failed';
    this.failReason = reason;
  }

  private fail(reason: string, events: MissionEvent[]): MissionEvent[] {
    this.status = 'failed';
    this.failReason = reason;
    events.push({ type: 'failed', reason });
    return events;
  }
}
