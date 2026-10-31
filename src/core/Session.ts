import { Vector3 } from 'three';
import { RotorAudio } from '../audio/RotorAudio';
import { Sfx } from '../audio/Sfx';
import { Particles } from '../fx/Particles';
import { FlightEvent, FlightInput } from '../heli/FlightModel';
import { Helicopter } from '../heli/Helicopter';
import { AIRCRAFT } from '../heli/HeliSpec';
import { createHeliModel } from '../heli/models';
import { ControlAxes } from '../input/bindings';
import { CargoEvent, CargoHint, CargoSystem } from '../missions/Cargo';
import { medalFor, Medal } from '../missions/medals';
import { MissionEvent, MissionRunner, MissionSnapshot } from '../missions/MissionRunner';
import { SurvivorDef } from '../missions/types';
import { Winch, WinchHint } from '../missions/Winch';
import { CargoVisuals } from '../render/CargoVisuals';
import { CrowdMesh } from '../render/CrowdMesh';
import { screenToWorld } from '../render/isoMath';
import { MissionVisuals } from '../render/MissionVisuals';
import { createProps } from '../render/props';
import { Stage } from '../render/Stage';
import { createTerrainMesh } from '../render/TerrainMesh';
import { createWater, Water } from '../render/WaterMesh';
import { Hud, Waypoint } from '../ui/Hud';
import { CrowdSim } from '../world/CrowdSim';
import { LevelDef } from '../world/level';
import { World } from '../world/World';

const PHYSICS_DT = 1 / 120;
const MS_TO_KNOTS = 1.944;
const WASH_HEIGHT = 16;

const WINCH_TEXT: Record<WinchHint, string> = {
  none: '',
  tooHigh: 'Winch: descend',
  tooLow: 'Winch: climb',
  tooFast: 'Winch: hold steady',
  closer: 'Winch: move closer',
  full: 'Cabin full',
  working: 'Winching…',
};

const HOOK_TEXT: Record<Exclude<CargoHint, 'carrying'>, string> = {
  none: '',
  tooHigh: 'Hook: descend',
  tooLow: 'Hook: climb',
  closer: 'Hook: move over the load',
  tooFast: 'Hook: hold steady',
  hooking: 'Hooking up…',
};

export interface SessionOutcome {
  success: boolean;
  reason?: string;
  time: number;
  damage: number;
  medal?: Medal;
  stats: [string, string][];
}

/** One run of a level: world, aircraft, mission, effects and HUD. */
export class Session {
  readonly level: LevelDef;
  readonly world: World;
  readonly heli: Helicopter;
  readonly runner: MissionRunner;
  readonly winch?: Winch;
  readonly cargo?: CargoSystem;
  private readonly cargoVisuals?: CargoVisuals;
  private readonly hookWorld = new Vector3();
  readonly hud: Hud;
  /** Set once the mission ends; the app shows the debrief after a short pause. */
  outcome?: SessionOutcome;
  private readonly stage: Stage;
  private readonly sfx: Sfx;
  private readonly audio: RotorAudio;
  private readonly crowd: CrowdSim;
  private readonly crowdMesh: CrowdMesh;
  private readonly water?: Water;
  private readonly visuals: MissionVisuals;
  private readonly dust: Particles;
  private readonly spray: Particles;
  private readonly smoke: Particles;
  private readonly fire: Particles;
  private readonly flare: Particles;
  private readonly spotted = new Set<string>();
  private readonly tmp = new Vector3();
  private readonly anchor = new Vector3();
  private accumulator = 0;
  private time = 0;
  private washBudget = 0;
  private smokeBudget = 0;
  private flareBudget = 0;
  private gatesFlown = 0;
  private landings = 0;
  private demoAngle = 0;

  constructor(stage: Stage, container: HTMLElement, level: LevelDef, audio: RotorAudio, sfx: Sfx) {
    this.stage = stage;
    this.level = level;
    this.audio = audio;
    this.sfx = sfx;
    this.world = new World(level);
    const scene = stage.newScene(level.terrain.kind);

    scene.add(createTerrainMesh(this.world.terrain));
    scene.add(createProps(this.world));
    if (level.seaLevel !== undefined) {
      this.water = createWater(this.world.terrain, level.seaLevel, level.waterStyle);
      scene.add(this.water.mesh);
    }

    this.crowd = new CrowdSim(this.world, level.crowds);
    this.crowdMesh = new CrowdMesh(this.crowd, this.world.terrain);
    for (const m of this.crowdMesh.meshes) scene.add(m);

    const spec = AIRCRAFT[level.aircraft];
    this.heli = new Helicopter(spec, createHeliModel(level.aircraft), scene);

    this.runner = new MissionRunner(level.mission);
    if (level.mission.survivors?.length) this.winch = new Winch();
    if (level.mission.cargo?.length) {
      this.cargo = new CargoSystem(level.mission.cargo, this.world, spec.slingLength ?? 14);
      this.cargoVisuals = new CargoVisuals(scene, this.world, this.cargo);
    }
    this.visuals = new MissionVisuals(scene, this.world, this.runner, this.heli.visual, this.winch);

    const dustColour = { desert: 0xd9ad74, coast: 0xb8ab88, floodplain: 0xa89a74 }[level.terrain.kind];
    this.dust = new Particles({ capacity: 900, colour: dustColour, opacity: 0.55, drag: 1.6, gravity: 0.4 });
    this.spray = new Particles({ capacity: 900, colour: 0xe4eef0, opacity: 0.32, drag: 1.8, gravity: -1.5 });
    this.smoke = new Particles({ capacity: 500, colour: 0x3a342f, opacity: 0.6, drag: 0.6, gravity: 2.2 });
    this.fire = new Particles({ capacity: 200, colour: 0xff8a2a, opacity: 0.9, additive: true, drag: 2, gravity: 3 });
    this.flare = new Particles({ capacity: 300, colour: 0xff6a1a, opacity: 0.5, drag: 0.4, gravity: 1.6 });
    scene.add(this.dust.points, this.spray.points, this.smoke.points, this.fire.points, this.flare.points);

    this.hud = new Hud(container, spec, level.name);
    this.hud.setVisible(false);

    const pad = this.world.pad(level.spawnPad);
    const f = this.heli.flight;
    f.place(pad.x, pad.top, pad.z, level.spawnHeading);
    f.spool = 0.15;
    stage.iso.setViewHeight(level.viewHeight ?? 90);
    stage.iso.snapTo(pad.x, pad.top, pad.z);
    this.sync(0);
  }

  dispose(): void {
    this.hud.destroy();
    this.sfx.setWinch(0);
  }

  /** Runs the simulation for one frame. `axes` is null when controls are locked. */
  update(dt: number, axes: ControlAxes | null): void {
    const f = this.heli.flight;
    const input: FlightInput = { moveX: 0, moveZ: 0, climb: 0 };
    if (axes && !this.outcome) {
      const w = screenToWorld(this.stage.iso.basis, axes.x, axes.y);
      input.moveX = w.x;
      input.moveZ = w.z;
      input.climb = axes.climb;
    }
    // Lowering a slung load: ease the descent as it nears the ground so it isn't smashed.
    const held = this.cargo?.hooked;
    if (held && !held.resting && input.climb < 0) {
      const clear = held.y - this.cargo!.support(held, this.world).h;
      if (clear < 5) input.climb = Math.max(input.climb, -(0.2 + Math.max(0, clear) * 0.12));
    }
    this.accumulator += dt;
    while (this.accumulator >= PHYSICS_DT) {
      this.accumulator -= PHYSICS_DT;
      this.world.wind?.update(PHYSICS_DT);
      for (const e of f.step(PHYSICS_DT, input, this.world)) this.onFlightEvent(e);
      if (f.landed && !f.destroyed) {
        const pad = this.world.padAt(f.x, f.z);
        if (pad?.service) f.service(PHYSICS_DT, 0.12, 0.06);
      }
      this.stepCargo();
    }
    this.visuals.setVisible(true);
    this.cargoVisuals?.setVisible(true);
    this.sync(dt);
    this.updateMission(dt);
    const load = axes ? Math.max(0, axes.climb) * 0.7 + Math.hypot(f.tiltX, f.tiltZ) * 0.4 : 0;
    this.audio.update(f.spool, load, f.spec.bladeRate, f.spec.twinRotor);
    this.updateHud(dt);
  }

  private stepCargo(): void {
    if (!this.cargo) return;
    const f = this.heli.flight;
    const hook = f.destroyed
      ? null
      : {
          x: f.x,
          y: f.y + (f.spec.hookHeight ?? 0.5),
          z: f.z,
          vx: f.vx,
          vy: f.vy,
          vz: f.vz,
          heading: f.heading,
          groundSpeed: f.groundSpeed,
          landed: f.landed,
          mass: f.spec.mass,
        };
    const r = this.cargo.update(PHYSICS_DT, hook, this.world);
    f.applyImpulse(r.dvx, r.dvz);
    f.payload = this.cargo.liftedMass;
    for (const e of r.events) this.onCargoEvent(e);
  }

  /** The action key: release the slung load. */
  action(): void {
    const e = this.cargo?.release();
    if (e) this.onCargoEvent(e);
  }

  private onCargoEvent(e: CargoEvent): void {
    const label = this.cargo?.item(e.id).def.label ?? 'Load';
    switch (e.type) {
      case 'hooked':
        this.sfx.play('attach');
        this.hud.message(`Hooked: ${label}`, 2);
        break;
      case 'released':
        this.sfx.play('unload');
        break;
      case 'impact':
        if (e.damage > 0.03) {
          this.hud.message('Load damaged!', 1.5);
          this.stage.iso.shake(Math.min(1, 0.2 + e.damage));
        }
        break;
      case 'lost':
      case 'destroyed':
        this.stage.iso.shake(0.8);
        break;
    }
  }

  /** Heaviest damage to any load, which counts against the medal. */
  private get cargoDamage(): number {
    return this.cargo ? Math.max(0, ...this.cargo.items.map((i) => i.damage)) : 0;
  }

  /** Idle backdrop for menus: the camera drifts slowly around the main settlement. */
  demo(dt: number): void {
    this.demoAngle += dt * 0.04;
    this.visuals.setVisible(false);
    this.cargoVisuals?.setVisible(false);
    const b = this.world.buildings;
    const cx = b.reduce((a, q) => a + q.x, 0) / Math.max(1, b.length);
    const cz = b.reduce((a, q) => a + q.z, 0) / Math.max(1, b.length);
    const r = 60;
    const x = cx + Math.cos(this.demoAngle) * r;
    const z = cz + Math.sin(this.demoAngle) * r;
    this.stage.iso.follow(dt, x, this.world.groundHeightAt(x, z), z, 0, 0, 0, this.cameraLimits());
    this.sync(dt, false);
    this.audio.update(0, 0);
  }

  private cameraLimits() {
    const limit = this.world.terrain.half - 170;
    return { minX: -limit, maxX: limit, minZ: -limit, maxZ: limit };
  }

  /** Updates visuals, crowd, particles and the camera. */
  private sync(dt: number, follow = true): void {
    this.time += dt;
    const f = this.heli.flight;
    const groundY = this.world.groundHeightAt(f.x, f.z);
    this.heli.sync(dt, groundY);
    this.water?.update(this.time);
    this.crowd.update(dt, f.destroyed ? undefined : { x: f.x, z: f.z, agl: f.y - groundY });
    this.crowdMesh.update();
    this.spawnEffects(dt, groundY);
    for (const p of [this.dust, this.spray, this.smoke, this.fire, this.flare]) {
      p.update(dt);
      p.setScale(this.stage.pixelsPerMetre);
    }
    this.visuals.update(this.time);
    if (this.cargo && this.cargoVisuals) {
      this.heli.visual.hook?.getWorldPosition(this.hookWorld);
      this.cargoVisuals.update(this.time, this.cargo, this.runner, this.hookWorld);
    }
    if (follow) {
      this.stage.iso.follow(dt, f.x, groundY + (f.y - groundY) * 0.75, f.z, f.vx, f.vz, f.groundSpeed / f.spec.maxSpeed, this.cameraLimits());
    }
  }

  private updateMission(dt: number): void {
    const f = this.heli.flight;
    const groundY = this.world.groundHeightAt(f.x, f.z);
    const snap: MissionSnapshot = {
      x: f.x,
      y: f.y,
      z: f.z,
      agl: f.y - groundY,
      groundSpeed: f.groundSpeed,
      landed: f.landed,
      destroyed: f.destroyed,
      padId: f.landed ? this.world.padAt(f.x, f.z)?.id : undefined,
      groundY: this.runner.activeGate ? this.world.groundHeightAt(this.runner.activeGate.x, this.runner.activeGate.z) : groundY,
      cargo: this.cargo?.items.map((it) => ({
        id: it.def.id,
        x: it.x,
        z: it.z,
        heading: it.heading,
        resting: it.resting,
        hooked: this.cargo!.hooked === it,
        lost: it.lost && it.damage < 1,
        destroyed: it.damage >= 1,
      })),
    };

    // Stranded without fuel away from a service pad.
    if (f.landed && f.fuel <= 0 && !this.world.padAt(f.x, f.z)?.service && this.runner.status === 'running') {
      this.runner.abort('Out of fuel');
      this.sfx.play('fail');
      this.finish(false, 'Out of fuel');
    }

    if (this.winch && this.runner.status === 'running') {
      this.heli.visual.winch?.getWorldPosition(this.anchor);
      const before = this.winch.state;
      const events = this.winch.update(
        dt,
        { x: this.anchor.x, y: this.anchor.y, z: this.anchor.z, groundSpeed: f.groundSpeed, landed: f.landed || f.destroyed },
        this.level.mission.survivors ?? [],
        this.runner.rescued,
        this.runner.capacityLeft,
      );
      for (const e of events) {
        if (e.type === 'attached') {
          this.sfx.play('attach');
          this.hud.message('Survivor on the hook', 1.6);
        } else {
          this.runner.notifyRescued(e.id);
          this.sfx.play('rescued');
          this.hud.message('Survivor aboard!', 2);
        }
      }
      const s = this.winch.state;
      this.sfx.setWinch(s === 'lowering' ? (before === 'lowering' ? 1 : 0.5) : s === 'raising' ? -1 : 0);
    }

    for (const e of this.runner.update(dt, snap)) this.onMissionEvent(e);
    // Delivered loads are fixed in place.
    if (this.cargo) for (const id of this.runner.placed) this.cargo.item(id).fixed = true;
    this.spotSurvivors();
  }

  private spotSurvivors(): void {
    const range = this.level.mission.spotRange;
    if (!range) return;
    const f = this.heli.flight;
    for (const s of this.level.mission.survivors ?? []) {
      if (this.spotted.has(s.id) || this.runner.rescued.has(s.id)) continue;
      if (Math.hypot(s.x - f.x, s.z - f.z) < range) {
        this.spotted.add(s.id);
        this.hud.message('Survivor spotted!', 2);
        this.sfx.play('gate');
      }
    }
  }

  private onMissionEvent(e: MissionEvent): void {
    switch (e.type) {
      case 'gatePassed':
        this.gatesFlown++;
        this.sfx.play('gate');
        this.hud.message(e.index === e.total ? 'All gates cleared' : `Gate ${e.index} of ${e.total}`, 1.4);
        break;
      case 'objectiveComplete':
        if (this.runner.objective || this.runner.index < this.level.mission.objectives.length) {
          this.sfx.play('objective');
          const next = this.level.mission.objectives[e.index + 1];
          if (next) this.hud.message(next.text, 3);
        }
        break;
      case 'passengerUnloaded':
        this.sfx.play('unload');
        this.hud.message(e.remaining > 0 ? `Unloading… ${e.remaining} to go` : 'All survivors delivered', 1.6);
        break;
      case 'complete':
        this.sfx.play('complete');
        this.finish(true);
        break;
      case 'failed':
        this.sfx.play('fail');
        this.finish(false, e.reason);
        break;
    }
  }

  private finish(success: boolean, reason?: string): void {
    if (this.outcome) return;
    const f = this.heli.flight;
    const time = this.runner.elapsed;
    const stats: [string, string][] = [];
    if (this.gatesFlown) stats.push(['Gates', String(this.gatesFlown)]);
    if (this.level.mission.survivors) stats.push(['Rescued', `${this.runner.rescued.size} of ${this.level.mission.survivors.length}`]);
    if (this.cargo) stats.push(['Cargo damage', `${Math.round(this.cargoDamage * 100)}%`]);
    stats.push(['Landings', String(this.landings)]);
    this.outcome = {
      success,
      reason,
      time,
      damage: Math.max(f.damage, this.cargoDamage),
      medal: success ? medalFor(time, Math.max(f.damage, this.cargoDamage), this.level.mission.medals) : undefined,
      stats,
    };
  }

  private onFlightEvent(e: FlightEvent): void {
    const iso = this.stage.iso;
    switch (e.type) {
      case 'landed': {
        this.landings++;
        const pad = this.world.padAt(e.x, e.z);
        if (pad) this.hud.message(`Landed: ${pad.label}`, 2);
        break;
      }
      case 'hardLanding':
        this.hud.message(e.severity > 1 ? 'Heavy landing!' : 'Hard landing', 2);
        iso.shake(0.4 + e.severity * 0.4);
        break;
      case 'collision':
        this.hud.message('Collision!', 1.5);
        iso.shake(Math.min(1.5, e.impact * 0.25));
        break;
      case 'lowFuel':
        this.hud.message('Low fuel: return to base', 3);
        this.sfx.play('warning');
        break;
      case 'fuelEmpty':
        this.hud.message('Out of fuel!', 3);
        break;
      case 'crashed':
        this.explode();
        iso.shake(2.5);
        this.hud.message(e.reason, 3);
        break;
      case 'takeoff':
        break;
    }
  }

  private updateHud(dt: number): void {
    const f = this.heli.flight;
    const groundY = this.world.groundHeightAt(f.x, f.z);
    const pad = f.landed ? this.world.padAt(f.x, f.z) : undefined;
    this.hud.update({
      altitude: f.y - groundY,
      speedKnots: f.groundSpeed * MS_TO_KNOTS,
      verticalSpeed: f.vy,
      fuel: f.fuel,
      damage: f.damage,
      landed: f.landed && !f.destroyed,
      servicing: !!pad?.service && (f.fuel < 1 || f.damage > 0) && !f.destroyed,
    });
    const r = this.runner;
    const m = this.level.mission;
    this.hud.updateMission({
      title: m.title,
      elapsed: r.elapsed,
      timeLimit: m.timeLimit,
      objectives: m.objectives.map((o, i) => ({ text: o.text, state: i < r.index ? 'done' : i === r.index ? 'current' : 'todo' })),
      detail: r.detail,
      progress: r.progress,
      passengers: m.capacity ? { aboard: r.onboard, capacity: m.capacity } : undefined,
    });
    const wind = this.world.wind;
    if (wind) {
      const b = this.stage.iso.basis;
      const sx = wind.x * b.rightX + wind.z * b.rightZ;
      const sy = wind.x * b.upX + wind.z * b.upZ;
      this.hud.updateWind(Math.atan2(sx, sy), wind.speed * MS_TO_KNOTS);
    } else {
      this.hud.updateWind(undefined, 0);
    }
    if (this.winch) {
      const w = this.winch;
      this.hud.updateAssist(WINCH_TEXT[w.hint], w.hint === 'working', w.state === 'raising' ? 1 : w.state === 'attaching' ? w.attachProgress : 0);
    } else if (this.cargo) {
      this.hud.updateAssist(...this.cargoAssist());
    } else {
      this.hud.updateAssist('', false, 0);
    }
    const held = this.cargo?.hooked;
    this.hud.updateLoad(held ? { mass: held.def.mass, damage: held.damage } : undefined);
    this.hud.setWaypoints(this.waypoints());
    this.hud.tick(dt);
  }

  /** Guidance for the cargo hook: how to hook up, and how far off the placement is. */
  private cargoAssist(): [string, boolean, number] {
    const c = this.cargo!;
    if (c.hint !== 'carrying') return [HOOK_TEXT[c.hint], c.hint === 'hooking', c.hookProgress];
    const load = c.hooked!;
    const target = this.runner.placeTarget;
    if (!target || !target.cargo.includes(load.def.id)) return [`${load.def.label} · E to release`, false, 0];
    const dist = Math.hypot(load.x - target.x, load.z - target.z);
    if (dist > target.radius * 4) return [`${load.def.label} · E to release`, false, 0];
    const off: string[] = [];
    if (dist > target.radius) off.push(`${dist.toFixed(1)} m`);
    if (target.heading !== undefined) {
      const diff = (Math.abs(Math.atan2(Math.sin(2 * (load.heading - target.heading)), Math.cos(2 * (load.heading - target.heading)))) / 2) * (180 / Math.PI);
      const tol = ((target.headingTolerance ?? 0.26) * 180) / Math.PI;
      if (diff > tol) off.push(`${Math.round(diff)}° off`);
    }
    if (off.length) return [`Align: ${off.join(' · ')}`, false, 0];
    return load.resting ? ['In position: E to release', true, 1] : ['On target: lower gently', true, 0.5];
  }

  private project(x: number, y: number, z: number, label: string, kind: Waypoint['kind']): Waypoint {
    const cam = this.stage.iso.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Edge markers stay inside a safe area clear of the HUD panels.
    const left = 70;
    const right = w - 70;
    const top = 190;
    const bottom = h - 230;
    this.tmp.set(x, y, z).project(cam);
    let sx = ((this.tmp.x + 1) / 2) * w;
    let sy = ((1 - this.tmp.y) / 2) * h;
    const onScreen = sx > 40 && sx < w - 40 && sy > 40 && sy < h - 40;
    if (!onScreen) {
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const s = Math.min((right - cx) / Math.abs(dx || 1), (bottom - cy) / Math.abs(dy || 1));
      sx = cx + dx * s;
      sy = cy + dy * s;
      const f = this.heli.flight;
      label = `${label}\n${Math.round(Math.hypot(x - f.x, z - f.z))} m`;
    }
    return { label, x: sx, y: sy, onScreen, kind };
  }

  private waypoints(): Waypoint[] {
    const out: Waypoint[] = [];
    const r = this.runner;
    if (r.status !== 'running') return out;
    const gate = r.activeGate;
    if (gate) out.push(this.project(gate.x, this.world.groundHeightAt(gate.x, gate.z) + gate.alt + gate.radius + 2, gate.z, 'Gate', 'gate'));
    const o = r.objective;
    if (o?.kind === 'hover') out.push(this.project(o.x, this.world.groundHeightAt(o.x, o.z) + o.maxAlt, o.z, 'Hover here', 'gate'));
    if (r.targetPad) {
      const pad = this.world.pad(r.targetPad);
      out.push(this.project(pad.x, pad.top + 3, pad.z, pad.label, 'pad'));
    }
    const f = this.heli.flight;
    if (f.fuel < 0.3) {
      for (const pad of this.world.pads.filter((p) => p.service)) out.push(this.project(pad.x, pad.top + 3, pad.z, 'Fuel', 'fuel'));
    }
    if (this.cargo) {
      const placed = this.runner.placeTarget;
      const next = this.runner.activeCargo.map((id) => this.cargo!.item(id)).find((it) => !it.lost && this.cargo!.hooked !== it && !it.fixed);
      if (next && !this.cargo.hooked) out.push(this.project(next.x, next.y + next.def.h + 3, next.z, next.def.label, 'cargo'));
      if (placed && this.cargo.hooked) out.push(this.project(placed.x, this.world.groundHeightAt(placed.x, placed.z) + 6, placed.z, placed.label, 'pad'));
    }
    if (o?.kind === 'rescue') {
      const waiting = this.visuals.waitingSurvivors().filter((s: SurvivorDef) => this.spotted.has(s.id));
      // Group survivors close together (e.g. on the same boat) under one marker.
      const groups: { x: number; y: number; z: number; n: number }[] = [];
      for (const s of waiting) {
        const g = groups.find((q) => Math.hypot(q.x - s.x, q.z - s.z) < 10);
        if (g) g.n++;
        else groups.push({ x: s.x, y: s.y, z: s.z, n: 1 });
      }
      for (const g of groups) out.push(this.project(g.x, g.y + 2, g.z, g.n > 1 ? `Survivors ×${g.n}` : 'Survivor', 'survivor'));
      const area = this.level.mission.searchArea;
      const unspotted = (this.level.mission.survivors ?? []).some((s) => !this.spotted.has(s.id) && !r.rescued.has(s.id));
      if (area && unspotted && Math.hypot(area.x - f.x, area.z - f.z) > area.radius * 0.6) {
        out.push(this.project(area.x, 0, area.z, area.label, 'area'));
      }
    }
    return out;
  }

  private spawnEffects(dt: number, groundY: number): void {
    const f = this.heli.flight;
    const agl = f.y - groundY;
    const rotorScale = f.spec.rotorRadius / 6.2;

    // Rotor downwash: spray over water, dust over sand, little from concrete.
    if (!f.destroyed && f.spool > 0.5 && agl < WASH_HEIGHT * rotorScale) {
      const overWater = this.world.isWater(f.x, f.z);
      const hard = !overWater && groundY > this.world.terrain.heightAt(f.x, f.z) + 0.05;
      const intensity = Math.pow(1 - agl / (WASH_HEIGHT * rotorScale), 1.3) * f.spool * (hard ? 0.12 : 1);
      this.washBudget += dt * 170 * intensity * rotorScale;
      const target = overWater ? this.spray : this.dust;
      while (this.washBudget >= 1) {
        this.washBudget -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = (3 + Math.random() * 4) * rotorScale;
        const out = (7 + Math.random() * 7) * Math.sqrt(rotorScale);
        const x = f.x + Math.cos(a) * r;
        const z = f.z + Math.sin(a) * r;
        target.spawn({
          x,
          y: this.world.groundHeightAt(x, z) + 0.3,
          z,
          vx: Math.cos(a) * out + f.vx * 0.3,
          vy: overWater ? 1.5 + Math.random() * 2 : 0.6 + Math.random() * 1.6,
          vz: Math.sin(a) * out + f.vz * 0.3,
          life: 1.2 + Math.random() * 1.4,
          size0: 1.5 + Math.random(),
          size1: (overWater ? 4 : 5) + Math.random() * 4,
          shade: 0.85 + Math.random() * 0.25,
        });
      }
    }

    // Orange distress smoke from the capsized yacht while anyone is still aboard.
    const boat = (this.level.mission.survivors ?? []).filter((s) => s.placement === 'boat' && !this.runner.rescued.has(s.id));
    if (boat.length) {
      this.flareBudget += dt * 9;
      const wind = this.world.wind;
      while (this.flareBudget >= 1) {
        this.flareBudget -= 1;
        const s = boat[0];
        this.flare.spawn({
          x: s.x + (Math.random() - 0.5),
          y: s.y + 1.5,
          z: s.z + (Math.random() - 0.5),
          vx: (wind?.x ?? 0) * 0.8,
          vy: 2 + Math.random(),
          vz: (wind?.z ?? 0) * 0.8,
          life: 5 + Math.random() * 2,
          size0: 1.2,
          size1: 9 + Math.random() * 4,
          shade: 0.9 + Math.random() * 0.2,
        });
      }
    }

    // Smoke from a damaged or wrecked airframe.
    const smokeRate = f.destroyed ? 30 : f.damage > 0.45 ? (f.damage - 0.45) * 40 : 0;
    this.smokeBudget += dt * smokeRate;
    while (this.smokeBudget >= 1) {
      this.smokeBudget -= 1;
      this.smoke.spawn({
        x: f.x + (Math.random() - 0.5),
        y: f.y + 2.5,
        z: f.z + (Math.random() - 0.5),
        vx: f.vx * 0.5 + 1.2,
        vy: 1.5 + Math.random(),
        vz: f.vz * 0.5 + 0.6,
        life: 3 + Math.random() * 2,
        size0: 1,
        size1: 5 + Math.random() * 3,
        shade: 0.7 + Math.random() * 0.5,
      });
      if (f.destroyed && Math.random() < 0.6) {
        this.fire.spawn({
          x: f.x + (Math.random() - 0.5) * 2,
          y: f.y + 0.8,
          z: f.z + (Math.random() - 0.5) * 2,
          vx: 0,
          vy: 1 + Math.random() * 2,
          vz: 0,
          life: 0.5 + Math.random() * 0.4,
          size0: 2.5,
          size1: 0.8,
        });
      }
    }
  }

  private explode(): void {
    const f = this.heli.flight;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = 4 + Math.random() * 10;
      this.fire.spawn({
        x: f.x,
        y: f.y + 1.5,
        z: f.z,
        vx: Math.cos(a) * sp * (1 - up * 0.5),
        vy: up * sp,
        vz: Math.sin(a) * sp * (1 - up * 0.5),
        life: 0.4 + Math.random() * 0.6,
        size0: 3 + Math.random() * 2,
        size1: 1,
      });
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn({
        x: f.x,
        y: f.y + 1.5,
        z: f.z,
        vx: Math.cos(a) * 5,
        vy: 2 + Math.random() * 3,
        vz: Math.sin(a) * 5,
        life: 2.5 + Math.random() * 2,
        size0: 3,
        size1: 9,
      });
    }
  }

  // Frame-level helpers used by the app.
  toggleHeightLine(): void {
    this.heli.showHeightLine = !this.heli.showHeightLine;
  }
}
