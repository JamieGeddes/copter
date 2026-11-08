import { CasualtyDef } from './types';

/** Seconds on the ground at the scene while the paramedics load the stretcher. */
export const LOAD_SECONDS = 4;
/** Seconds on the hospital roof while the casualty is handed over. */
export const HANDOVER_SECONDS = 2.5;
/** With nothing to do, the next call comes in after this many seconds. */
export const IDLE_CALL_DELAY = 4;

export type CasualtyState = 'pending' | 'waiting' | 'loading' | 'aboard' | 'handover' | 'delivered' | 'lost';

export interface CasualtyStatus {
  readonly def: CasualtyDef;
  state: CasualtyState;
  /** Queue clock time the call came in. */
  calledAt: number;
  /** Queue clock time the handover began. */
  handedAt: number;
  /** 0..1 through loading or handover. */
  progress: number;
}

export interface MedevacAircraft {
  x: number;
  z: number;
  landed: boolean;
  /** Pad the aircraft is resting on, if any. */
  padId?: string;
}

export type MedevacEvent =
  | { type: 'call'; id: string }
  | { type: 'loaded'; id: string }
  | { type: 'wrongHospital'; id: string }
  | { type: 'delivered'; id: string; golden: boolean }
  | { type: 'lost'; id: string };

/** What the crew should do next, for the HUD. */
export type MedevacHint = 'none' | 'loading' | 'handover' | 'wrongHospital' | 'occupied';

/**
 * The casualty queue for a night of emergency calls. Calls come in on a schedule, or sooner when
 * the crew is idle. One casualty fits in the cabin: land in their cordoned zone to load them,
 * then land on the roof of the hospital that treats them. A casualty whose timer runs out before
 * the handover begins is lost.
 */
export class Medevac {
  readonly casualties: CasualtyStatus[];
  /** Seconds since the calls began. */
  clock = 0;
  hint: MedevacHint = 'none';
  private idle = 0;
  /** Set on landing at the wrong hospital so the warning fires once per landing. */
  private wrongWarned = false;

  constructor(defs: readonly CasualtyDef[]) {
    this.casualties = [...defs]
      .sort((a, b) => a.callAt - b.callAt)
      .map((def) => ({ def, state: 'pending', calledAt: 0, handedAt: 0, progress: 0 }));
  }

  status(id: string): CasualtyStatus {
    const c = this.casualties.find((q) => q.def.id === id);
    if (!c) throw new Error(`Unknown casualty: ${id}`);
    return c;
  }

  /** Casualty in the cabin (including one being loaded or handed over). */
  get aboard(): CasualtyStatus | undefined {
    return this.casualties.find((c) => c.state === 'aboard' || c.state === 'handover');
  }

  /** Calls in progress: waiting at the scene, loading, aboard or being handed over. */
  get active(): CasualtyStatus[] {
    return this.casualties.filter((c) => c.state === 'waiting' || c.state === 'loading' || c.state === 'aboard' || c.state === 'handover');
  }

  get delivered(): number {
    return this.casualties.filter((c) => c.state === 'delivered').length;
  }

  /** Casualties handed over inside their golden hour. */
  get golden(): number {
    return this.casualties.filter((c) => c.state === 'delivered' && this.isGolden(c)).length;
  }

  get done(): boolean {
    return this.casualties.every((c) => c.state === 'delivered');
  }

  get lost(): CasualtyStatus | undefined {
    return this.casualties.find((c) => c.state === 'lost');
  }

  /** Seconds left before the casualty is lost; the clock stops once the handover begins. */
  timeLeft(c: CasualtyStatus): number {
    if (c.state === 'pending') return c.def.timer;
    const now = c.state === 'handover' || c.state === 'delivered' ? c.handedAt : this.clock;
    return c.def.timer - (now - c.calledAt);
  }

  /** True while (or if) the casualty reaches hospital inside the golden hour. */
  isGolden(c: CasualtyStatus): boolean {
    return c.def.timer - this.timeLeft(c) <= c.def.golden;
  }

  update(dt: number, heli: MedevacAircraft): MedevacEvent[] {
    const events: MedevacEvent[] = [];
    this.clock += dt;

    // Calls come in on schedule, or early when nothing is going on.
    this.idle = this.active.length === 0 ? this.idle + dt : 0;
    const next = this.casualties.find((c) => c.state === 'pending');
    if (next && (this.clock >= next.def.callAt || this.idle >= IDLE_CALL_DELAY)) {
      next.state = 'waiting';
      next.calledAt = this.clock;
      this.idle = 0;
      events.push({ type: 'call', id: next.def.id });
    }

    for (const c of this.active) {
      if (c.state !== 'handover' && this.timeLeft(c) <= 0) {
        c.state = 'lost';
        events.push({ type: 'lost', id: c.def.id });
        return events;
      }
    }

    if (!heli.landed) this.wrongWarned = false;
    this.hint = 'none';
    const aboard = this.aboard;
    if (aboard) {
      this.updateDelivery(dt, heli, aboard, events);
    } else {
      this.updatePickup(dt, heli, events);
    }
    return events;
  }

  private updatePickup(dt: number, heli: MedevacAircraft, events: MedevacEvent[]): void {
    for (const c of this.casualties) {
      if (c.state !== 'waiting' && c.state !== 'loading') continue;
      const inZone = heli.landed && Math.hypot(heli.x - c.def.x, heli.z - c.def.z) <= c.def.radius;
      if (!inZone) {
        c.state = 'waiting';
        c.progress = 0;
        continue;
      }
      c.state = 'loading';
      c.progress += dt / LOAD_SECONDS;
      this.hint = 'loading';
      if (c.progress >= 1) {
        c.state = 'aboard';
        c.progress = 0;
        events.push({ type: 'loaded', id: c.def.id });
      }
      return;
    }
  }

  private updateDelivery(dt: number, heli: MedevacAircraft, c: CasualtyStatus, events: MedevacEvent[]): void {
    const onPad = heli.landed ? heli.padId : undefined;
    if (onPad === c.def.hospital) {
      if (c.state === 'aboard') {
        c.state = 'handover';
        c.handedAt = this.clock;
        c.progress = 0;
      }
      c.progress += dt / HANDOVER_SECONDS;
      this.hint = 'handover';
      if (c.progress >= 1) {
        c.state = 'delivered';
        c.progress = 1;
        events.push({ type: 'delivered', id: c.def.id, golden: this.isGolden(c) });
      }
      return;
    }
    if (c.state === 'handover') {
      // Lifted off before the handover finished: the clock runs again.
      c.state = 'aboard';
      c.calledAt += this.clock - c.handedAt;
      c.progress = 0;
    }
    if (onPad && this.isHospital(onPad)) {
      this.hint = 'wrongHospital';
      if (!this.wrongWarned) {
        this.wrongWarned = true;
        events.push({ type: 'wrongHospital', id: c.def.id });
      }
    } else if (heli.landed && this.casualties.some((q) => q.state === 'waiting' && Math.hypot(heli.x - q.def.x, heli.z - q.def.z) <= q.def.radius)) {
      this.hint = 'occupied';
    }
  }

  private isHospital(pad: string): boolean {
    return this.casualties.some((c) => c.def.hospital === pad);
  }
}
