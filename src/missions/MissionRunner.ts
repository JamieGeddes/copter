import { GateDef, MissionDef, ObjectiveDef } from './types';

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
