import { wrapAngle } from '../core/math';
import { AssembleObjective, assemblyFit, AssemblyFit, seatHeight } from './Assembly';
import { Medevac, MedevacEvent } from './Medevac';
import { AssemblyPart, GateDef, MissionDef, ObjectiveDef } from './types';

export interface CargoSnapshot {
  id: string;
  x: number;
  /** Height of the load's base (needed for assembly). */
  y?: number;
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

export interface BucketSnapshot {
  /** 0..1 */
  fill: number;
}

export interface FireSnapshot {
  /** Cells currently burning. */
  burning: number;
  /** Burning cells inside a circle. */
  burningIn(x: number, z: number, radius: number): number;
}

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
  bucket?: BucketSnapshot;
  fire?: FireSnapshot;
  /** Survivor being reeled in or walking to the aircraft, safe from the cloud. */
  boardingId?: string;
}

export type MissionEvent =
  | { type: 'objectiveComplete'; index: number; text: string }
  | { type: 'gatePassed'; index: number; total: number }
  | { type: 'passengerUnloaded'; remaining: number }
  /** The cloud base is closing in on a site where survivors are still waiting. */
  | { type: 'cloudWarning'; site: string }
  /** Something happened to a casualty on a medevac mission. */
  | { type: 'casualty'; event: MedevacEvent }
  /** An assembly part has been bolted on: fix it in place at the seat. */
  | { type: 'partFixed'; id: string; index: number; total: number; x: number; y: number; z: number; heading: number }
  | { type: 'complete'; time: number }
  | { type: 'failed'; reason: string };

export type MissionStatus = 'running' | 'complete' | 'failed';

const HOVER_SPEED_LIMIT = 3;
const UNLOAD_SECONDS = 1.5;
/** Warn when the cloud base is this far above a waiting survivor. */
const CLOUD_WARNING = 45;
/** Height of the aircraft's cabin above its skids, for deciding when it is in cloud. */
const CABIN_HEIGHT = 1.8;

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
  private protectHeld = 0;
  /** Seconds spent in cloud, recovering slowly once clear. */
  cloudExposure = 0;
  private readonly cloudWarned = new Set<string>();
  /** Casualty queue, on missions with emergency calls. */
  readonly medevac?: Medevac;
  /** Parts of the current assembly already bolted on, bottom first. */
  readonly assembled: string[] = [];
  /** Seconds the hooked part has been held in tolerance. */
  boltTimer = 0;
  /** How the hooked part sits against its seat, while assembling. */
  fit?: AssemblyFit & { part: AssemblyPart; id: string };

  constructor(def: MissionDef) {
    this.def = def;
    if (def.casualties?.length) this.medevac = new Medevac(def.casualties);
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
      case 'protect':
        return Math.min(1, this.protectHeld / o.seconds);
      case 'casualties':
        return (this.medevac?.delivered ?? 0) / o.casualties.length;
      case 'assemble': {
        const hold = this.fit ? Math.min(1, this.boltTimer / this.fit.part.seconds) : 0;
        return (this.assembled.length + hold) / o.parts.length;
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
      case 'rescue': {
        const line = `Rescued ${o.survivors.filter((id) => this.rescued.has(id)).length} of ${o.survivors.length} · aboard ${this.onboard}/${this.def.capacity ?? '∞'}`;
        return this.tripPad && this.delivered > 0 ? `${line} · safe ${this.delivered}` : line;
      }
      case 'deliver':
        return `Aboard: ${this.onboard}`;
      case 'place':
        return o.cargo.length > 1 ? `Delivered ${this.placedNow} of ${o.cargo.length}` : '';
      case 'protect':
        return `Hold the line: ${Math.min(o.seconds, this.protectHeld).toFixed(0)} / ${o.seconds} s`;
      case 'casualties': {
        const m = this.medevac;
        return m ? `Delivered ${m.delivered} of ${o.casualties.length} · golden hour ${m.golden}` : '';
      }
      case 'assemble':
        return o.parts.length > 1 ? `In place: ${this.assembled.length} of ${o.parts.length}` : '';
      default:
        return '';
    }
  }

  /** The next gate to fly through, if the current objective is a gate run. */
  get activeGate(): GateDef | undefined {
    const o = this.objective;
    return o?.kind === 'gates' ? o.gates[this.gateIndex] : undefined;
  }

  /** Pad the player should land on now, if any. A full cabin heads for the delivery pad. */
  get targetPad(): string | undefined {
    const o = this.objective;
    if (o?.kind === 'casualties') return this.medevac?.aboard?.def.hospital;
    if (o?.kind === 'rescue' && this.onboard > 0 && this.capacityLeft <= 0) return this.tripPad;
    return o?.kind === 'land' || o?.kind === 'deliver' ? o.pad : undefined;
  }

  /**
   * Pad of the delivery that follows the current rescue, where passengers can be dropped off
   * part way through when the cabin is too small to carry everyone at once.
   */
  get tripPad(): string | undefined {
    if (this.objective?.kind !== 'rescue') return undefined;
    const next = this.def.objectives.slice(this.index + 1).find((o) => o.kind === 'deliver');
    return next?.kind === 'deliver' ? next.pad : undefined;
  }

  /** Height above sea level of the cloud base, or Infinity in clear weather. */
  get cloudBase(): number {
    const w = this.def.weather;
    if (!w) return Infinity;
    const t = Math.min(1, this.elapsed / w.duration);
    return w.cloudStart + (w.cloudEnd - w.cloudStart) * t;
  }

  /** The active placement zone, if any. */
  get placeTarget(): PlaceObjective | undefined {
    const o = this.objective;
    return o?.kind === 'place' ? o : undefined;
  }

  /** The active assembly, if any. */
  get assembleTarget(): AssembleObjective | undefined {
    const o = this.objective;
    return o?.kind === 'assemble' ? o : undefined;
  }

  /** Height of the top of the stack the next part sits on. */
  get seatY(): number | undefined {
    const o = this.assembleTarget;
    return o ? seatHeight(o, this.assembled, this.def.cargo ?? []) : undefined;
  }

  /** Loads the player should be working with now. */
  get activeCargo(): string[] {
    const o = this.objective;
    if (o?.kind === 'hook') return [o.cargo];
    if (o?.kind === 'place') return o.cargo;
    if (o?.kind === 'assemble') return o.parts.map((p) => p.cargo).filter((id) => !this.assembled.includes(id));
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

    // Fire in a zone that still has to be protected loses the mission straight away.
    if (s.fire) {
      for (let i = this.index; i < this.def.objectives.length; i++) {
        const o = this.def.objectives[i];
        if (o.kind === 'protect' && s.fire.burningIn(o.x, o.z, o.radius) > 0) {
          return this.fail(`The fire reached ${o.label}`, events);
        }
      }
    }

    if (this.def.weather && this.checkWeather(dt, s, events)) return events;

    // Allow several objectives to complete in one tick (e.g. landing completes two).
    for (let guard = 0; guard < 4 && this.objective; guard++) {
      if (!this.check(dt, s, events, this.objective)) break;
      if (this.status !== 'running') return events;
      events.push({ type: 'objectiveComplete', index: this.index, text: this.objective.text });
      this.index++;
      this.hoverHeld = 0;
      this.gateIndex = 0;
      this.unloadTimer = 0;
      this.protectHeld = 0;
      this.assembled.length = 0;
      this.boltTimer = 0;
      this.fit = undefined;
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
      case 'rescue': {
        const pad = this.tripPad;
        if (pad) this.unload(dt, s, pad, events);
        return o.survivors.every((id) => this.rescued.has(id));
      }
      case 'hook':
        return !!s.cargo?.find((c) => c.id === o.cargo)?.hooked;
      case 'fill':
        return (s.bucket?.fill ?? 0) >= 0.99;
      case 'protect':
        this.protectHeld += dt;
        return this.protectHeld >= o.seconds || (!!o.orExtinguished && !!s.fire && s.fire.burning === 0);
      case 'extinguish':
        return !!s.fire && s.fire.burning === 0;
      case 'place': {
        const loads = (s.cargo ?? []).filter((c) => o.cargo.includes(c.id));
        this.placedNow = loads.filter((c) => isPlaced(c, o)).length;
        if (this.placedNow < o.cargo.length) return false;
        for (const id of o.cargo) this.placed.add(id);
        this.placedNow = 0;
        return true;
      }
      case 'deliver':
        return this.unload(dt, s, o.pad, events) && this.onboard === 0;
      case 'assemble':
        return this.assemble(dt, s, o, events);
      case 'casualties': {
        const m = this.medevac;
        if (!m) return true;
        for (const event of m.update(dt, s)) {
          events.push({ type: 'casualty', event });
          if (event.type === 'lost') {
            this.fail(`Casualty lost: ${m.status(event.id).def.label}`, events);
            return false;
          }
        }
        return o.casualties.every((id) => m.status(id).state === 'delivered');
      }
    }
  }

  /**
   * The hooked part, once seated on the stack in position and lined up, must be held there while
   * the crew bolt it on. Any slip out of tolerance starts the bolting again.
   */
  private assemble(dt: number, s: MissionSnapshot, o: AssembleObjective, events: MissionEvent[]): boolean {
    const remaining = o.parts.filter((p) => !this.assembled.includes(p.cargo));
    const load = s.cargo?.find((c) => c.hooked && remaining.some((p) => p.cargo === c.id));
    const part = load && remaining.find((p) => p.cargo === load.id);
    if (!load || !part) {
      this.fit = undefined;
      this.boltTimer = 0;
      return remaining.length === 0;
    }
    const seatY = seatHeight(o, this.assembled, this.def.cargo ?? []);
    const fit = assemblyFit({ x: load.x, y: load.y ?? 0, z: load.z, heading: load.heading, resting: load.resting }, part, o, seatY);
    this.fit = { ...fit, part, id: load.id };
    this.boltTimer = fit.ok ? this.boltTimer + dt : 0;
    if (this.boltTimer < part.seconds) return false;
    this.assembled.push(load.id);
    this.placed.add(load.id);
    this.boltTimer = 0;
    this.fit = undefined;
    // Square the part up on its seat: the turn that fits nearest to how it was set down.
    const step = (Math.PI * 2) / (part.symmetry ?? 1);
    const heading = o.heading + Math.round(wrapAngle(load.heading - o.heading) / step) * step;
    events.push({ type: 'partFixed', id: load.id, index: this.assembled.length, total: o.parts.length, x: o.x, y: seatY, z: o.z, heading });
    return this.assembled.length === o.parts.length;
  }

  /** Lets passengers off one at a time while landed on the pad. Returns true while on the pad. */
  private unload(dt: number, s: MissionSnapshot, pad: string, events: MissionEvent[]): boolean {
    if (!(s.landed && s.padId === pad)) {
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
    return true;
  }

  /**
   * The lowering cloud: too long inside it disorients the pilot, and a site swallowed by it before
   * everyone there is rescued loses the mission. Returns true if the mission failed.
   */
  private checkWeather(dt: number, s: MissionSnapshot, events: MissionEvent[]): boolean {
    const w = this.def.weather!;
    const base = this.cloudBase;
    const inCloud = !s.destroyed && s.y + CABIN_HEIGHT > base;
    this.cloudExposure = inCloud ? this.cloudExposure + dt : Math.max(0, this.cloudExposure - dt * 0.5);
    if (this.cloudExposure >= w.maxExposure) {
      this.fail('Lost in cloud', events);
      return true;
    }
    for (const sv of this.def.survivors ?? []) {
      if (this.rescued.has(sv.id) || sv.id === s.boardingId) continue;
      const site = sv.site ?? 'a survivor';
      if (sv.y + CABIN_HEIGHT > base) {
        this.fail(`Cloud closed in over ${site}`, events);
        return true;
      }
      if (base - sv.y < CLOUD_WARNING && !this.cloudWarned.has(site)) {
        this.cloudWarned.add(site);
        events.push({ type: 'cloudWarning', site });
      }
    }
    return false;
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
