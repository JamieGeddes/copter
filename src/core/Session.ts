import { Vector3 } from 'three';
import { RotorAudio } from '../audio/RotorAudio';
import { Sfx } from '../audio/Sfx';
import { Particles } from '../fx/Particles';
import { FlightEnvironment, FlightEvent, FlightInput, rotorProximity, RotorProximity } from '../heli/FlightModel';
import { Helicopter } from '../heli/Helicopter';
import { AIRCRAFT, PASSENGER_MASS } from '../heli/HeliSpec';
import { createHeliModel } from '../heli/models';
import { ControlAxes } from '../input/bindings';
import { Boarding, BoardingHint } from '../missions/Boarding';
import { Bucket, BucketEnv, BucketHint, Spray } from '../missions/Bucket';
import { CargoEvent, CargoHint, CargoSystem } from '../missions/Cargo';
import { medalFor, Medal } from '../missions/medals';
import { MissionEvent, MissionRunner, MissionSnapshot } from '../missions/MissionRunner';
import { SurvivorDef } from '../missions/types';
import { Winch, WinchHint } from '../missions/Winch';
import { BucketVisuals } from '../render/BucketVisuals';
import { CargoVisuals } from '../render/CargoVisuals';
import { CLEAR_SKY, cloudUniforms } from '../render/cloud';
import { FireVisuals } from '../render/FireVisuals';
import { CrowdMesh } from '../render/CrowdMesh';
import { screenToWorld } from '../render/isoMath';
import { MissionVisuals } from '../render/MissionVisuals';
import { createProps } from '../render/props';
import { Stage } from '../render/Stage';
import { createTerrainMesh } from '../render/TerrainMesh';
import { createWater, Water } from '../render/WaterMesh';
import { Hud, Waypoint } from '../ui/Hud';
import { clamp, damp } from './math';
import { CrowdSim } from '../world/CrowdSim';
import { FireGrid } from '../world/FireGrid';
import { createFireGrid } from '../world/fuel';
import { LevelDef } from '../world/level';
import { LocalWind } from '../world/Wind';
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

const BOARDING_TEXT: Record<BoardingHint, string> = {
  none: '',
  land: 'Land near the climbers',
  closer: 'Land closer to the climbers',
  full: 'Cabin full',
  boarding: 'Climber boarding…',
};

/** Terrain warning starts beeping within this gap at the blade tips. */
const PROXIMITY_RANGE = 12;

const BUCKET_TEXT: Record<BucketHint, string> = {
  empty: 'Bucket empty: dip it in the lake',
  dipping: 'Filling…',
  tooFast: 'Too fast to fill: slow down',
  full: 'Bucket full · E to drop',
  dropping: 'Releasing water',
  part: 'Part full · E to drop',
};

/** Heat updraft and turbulence are felt within this distance of the fire. */
const HEAT_RADIUS = 45;
const FIRE_STEP = 0.1;

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
  /** Landing pickups, where survivors walk to the aircraft. */
  readonly boarding?: Boarding;
  readonly cargo?: CargoSystem;
  private readonly flightEnv: FlightEnvironment;
  /** Wind where the aircraft is, refreshed every physics step. */
  private air: LocalWind = { x: 0, z: 0, up: 0, turbulence: 0 };
  private proximity?: RotorProximity;
  private beepTimer = 0;
  private reliefTimer = 0;
  private driftAngle = 0;
  private cloudBudget = 0;
  /** Collective input this frame, for the lift-off hint. */
  private climbInput = 0;
  private rotorStrikes = 0;
  private readonly cloud: Particles;
  private readonly cargoVisuals?: CargoVisuals;
  private readonly hookWorld = new Vector3();
  /** Fire grid and water bucket, on wildfire levels. */
  readonly blaze?: FireGrid;
  readonly bucket?: Bucket;
  private readonly bucketEnv: BucketEnv;
  private fireClock = 0;
  private threat = 0;
  private smokeDensity = 0;
  private frontX = 0;
  private frontZ = 0;
  private gustX = 0;
  private gustZ = 0;
  private gustY = 0;
  private gustTimer = 0;
  private heat = 0;
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
  private splash?: { x: number; z: number; y: number; radius: number; height: number; hits: number };
  private fireVisuals?: FireVisuals;
  private bucketVisuals?: BucketVisuals;
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
    cloudUniforms.cloudBase.value = CLEAR_SKY;
    const scene = stage.newScene(level.terrain.kind);

    const terrainMesh = createTerrainMesh(this.world.terrain);
    const props = createProps(this.world);
    scene.add(terrainMesh);
    scene.add(props);
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
    const survivors = level.mission.survivors ?? [];
    if (survivors.some((s) => s.pickup !== 'landing')) this.winch = new Winch();
    if (survivors.some((s) => s.pickup === 'landing')) this.boarding = new Boarding();
    const world = this.world;
    this.flightEnv = {
      groundHeightAt: (x, z) => world.groundHeightAt(x, z),
      slopeAt: (x, z) => world.slopeAt(x, z),
      isWater: (x, z) => world.isWater(x, z),
      solids: world.solids,
      bounds: world.bounds,
      wind: this.air,
      updraft: 0,
      rotorStrike: level.terrain.kind === 'alpine',
    };
    if (level.mission.cargo?.length) {
      this.cargo = new CargoSystem(level.mission.cargo, this.world, spec.slingLength ?? 14);
      this.cargoVisuals = new CargoVisuals(scene, this.world, this.cargo);
    }
    this.bucketEnv = {
      groundHeightAt: (x, z) => this.world.groundHeightAt(x, z),
      isWater: (x, z) => this.world.isWater(x, z),
      waterLevel: this.world.seaLevel,
    };
    if (level.fire) {
      this.blaze = createFireGrid(this.world);
      this.bucket = new Bucket(spec.slingLength ?? 12);
    }
    if (this.blaze) {
      this.fireVisuals = new FireVisuals(scene, this.world, this.blaze, props, terrainMesh);
      this.bucketVisuals = new BucketVisuals(scene);
    }
    this.visuals = new MissionVisuals(scene, this.world, this.runner, this.heli.visual, this.winch, this.boarding);

    const dustColour = { desert: 0xd9ad74, coast: 0xb8ab88, floodplain: 0xa89a74, forest: 0x9a8f6a, alpine: 0xa49c8c }[level.terrain.kind];
    this.dust = new Particles({ capacity: 900, colour: dustColour, opacity: 0.55, drag: 1.6, gravity: 0.4 });
    this.spray = new Particles({ capacity: 900, colour: 0xe4eef0, opacity: 0.32, drag: 1.8, gravity: -1.5 });
    this.smoke = new Particles({ capacity: 500, colour: 0x3a342f, opacity: 0.6, drag: 0.6, gravity: 2.2 });
    this.fire = new Particles({ capacity: 200, colour: 0xff8a2a, opacity: 0.9, additive: true, drag: 2, gravity: 3 });
    this.flare = new Particles({ capacity: 300, colour: 0xff6a1a, opacity: 0.5, drag: 0.4, gravity: 1.6 });
    this.cloud = new Particles({ capacity: 500, colour: 0xeef2f5, opacity: 0.45, drag: 0.2, gravity: 0 });
    scene.add(this.dust.points, this.spray.points, this.smoke.points, this.fire.points, this.flare.points, this.cloud.points);

    this.hud = new Hud(container, spec, level.name);
    this.hud.setVisible(false);

    const pad = this.world.pad(level.spawnPad);
    const f = this.heli.flight;
    f.place(pad.x, pad.top, pad.z, level.spawnHeading);
    f.spool = 0.15;
    const hook = this.hookState();
    if (hook) this.bucket?.attach(hook, this.bucketEnv);
    stage.iso.setViewHeight(level.viewHeight ?? 90);
    stage.iso.snapTo(pad.x, pad.top, pad.z);
    this.sync(0);
  }

  dispose(): void {
    cloudUniforms.cloudBase.value = CLEAR_SKY;
    this.hud.destroy();
    this.sfx.setWinch(0);
  }

  /** Runs the simulation for one frame. `axes` is null when controls are locked. */
  update(dt: number, axes: ControlAxes | null): void {
    const f = this.heli.flight;
    const input: FlightInput = { moveX: 0, moveZ: 0, climb: 0 };
    this.climbInput = axes && !this.outcome ? axes.climb : 0;
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
      this.stepAir();
      for (const e of f.step(PHYSICS_DT, input, this.flightEnv)) this.onFlightEvent(e);
      if (f.landed && !f.destroyed) {
        const pad = this.world.padAt(f.x, f.z);
        if (pad?.service) f.service(PHYSICS_DT, 0.12, 0.06);
      }
      this.stepCargo();
      this.stepBucket();
    }
    if (this.blaze) this.stepFire(dt);
    this.checkCables();
    this.visuals.setVisible(true);
    this.cargoVisuals?.setVisible(true);
    this.bucketVisuals?.setVisible(true);
    this.sync(dt);
    this.updateMission(dt);
    const load = axes ? Math.max(0, axes.climb) * 0.7 + Math.hypot(f.tiltX, f.tiltZ) * 0.4 : 0;
    this.audio.update(f.spool, load, f.spec.bladeRate, f.spec.twinRotor);
    this.updateHud(dt);
  }

  /**
   * Local air for the next physics step: mountain wind, any heat updraft, passengers aboard,
   * and the drift that sets in when the pilot loses the horizon in cloud.
   */
  private stepAir(): void {
    const f = this.heli.flight;
    const env = this.flightEnv;
    const a = this.world.windAt(f.x, f.z, f.y);
    this.air.x = a.x;
    this.air.z = a.z;
    this.air.up = a.up;
    this.air.turbulence = a.turbulence;
    env.updraft = this.world.updraft + a.up;
    if (f.thinAir) f.payload = (this.runner.onboard + (this.winch?.carryingId ? 1 : 0)) * PASSENGER_MASS;
    const w = this.level.mission.weather;
    if (w && !f.landed && this.runner.cloudExposure > 0) {
      const k = Math.min(1, this.runner.cloudExposure / w.maxExposure);
      this.driftAngle += (Math.random() - 0.5) * 6 * PHYSICS_DT;
      f.applyImpulse(Math.sin(this.driftAngle) * 3 * k * PHYSICS_DT, Math.cos(this.driftAngle) * 3 * k * PHYSICS_DT);
      env.updraft += Math.sin(this.driftAngle * 1.7) * 1.5 * k;
    }
  }

  /** Flying the rotor into a cable car wire is fatal. */
  private checkCables(): void {
    const f = this.heli.flight;
    if (!this.world.cables.length || f.destroyed || f.landed) return;
    if (this.world.cableStrike(f.x, f.y + f.spec.rotorHeight, f.z, f.spec.rotorRadius)) {
      for (const e of f.wreck('Wire strike on the cable car')) this.onFlightEvent(e);
    }
  }

  private hookState() {
    const f = this.heli.flight;
    return f.destroyed
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
  }

  private stepCargo(): void {
    if (!this.cargo) return;
    const f = this.heli.flight;
    const hook = this.hookState();
    const r = this.cargo.update(PHYSICS_DT, hook, this.world);
    f.applyImpulse(r.dvx, r.dvz);
    f.payload = this.cargo.liftedMass;
    for (const e of r.events) this.onCargoEvent(e);
  }

  private stepBucket(): void {
    const b = this.bucket;
    if (!b) return;
    const f = this.heli.flight;
    const hook = this.hookState();
    if (!hook) {
      f.payload = 0;
      return;
    }
    const r = b.update(PHYSICS_DT, hook, this.bucketEnv);
    f.applyImpulse(r.dvx, r.dvz);
    f.payload = b.liftedMass;
    for (const e of r.events) {
      if (e.type === 'filled') {
        this.sfx.play('attach');
        this.hud.message('Bucket full', 1.6);
      }
    }
    if (r.spray) this.dropWater(r.spray);

    // Heat over the fire shakes the aircraft about.
    if (this.heat > 1 && !f.landed) {
      this.gustTimer -= PHYSICS_DT;
      if (this.gustTimer <= 0) {
        this.gustTimer = 0.25 + Math.random() * 0.3;
        this.gustX = (Math.random() - 0.5) * 2;
        this.gustZ = (Math.random() - 0.5) * 2;
        this.gustY = (Math.random() - 0.3) * 2;
      }
      const turb = Math.min(1, this.heat / 40) * Math.max(0, 1 - (f.y - this.world.groundHeightAt(f.x, f.z)) / 90);
      f.applyImpulse(this.gustX * turb * 4 * PHYSICS_DT, this.gustZ * turb * 4 * PHYSICS_DT);
      this.world.updraft = Math.min(3.5, this.heat * 0.08) * Math.max(0, 1 - (f.y - this.world.groundHeightAt(f.x, f.z)) / 90) + this.gustY * turb * 1.5;
    } else {
      this.world.updraft = 0;
    }
  }

  /** Water from the bucket lands a little downwind and ahead of where it was released. */
  private dropWater(spray: Spray): void {
    const b = this.bucket!;
    const fall = Math.sqrt((2 * Math.max(0, spray.y - spray.groundY)) / 9.81);
    const w = this.world.wind;
    const x = spray.x + (b.vx * 0.6 + (w?.x ?? 0) * 0.5) * fall;
    const z = spray.z + (b.vz * 0.6 + (w?.z ?? 0) * 0.5) * fall;
    const hit = this.blaze!.douse(x, z, spray.radius, spray.strength * PHYSICS_DT);
    this.splash = { x, z, y: this.world.groundHeightAt(x, z), radius: spray.radius, height: spray.y - spray.groundY, hits: (this.splash?.hits ?? 0) + hit };
  }

  /** Advances the fire and the things that depend on it: heat, smoke and the town threat. */
  private stepFire(dt: number): void {
    const grid = this.blaze!;
    const f = this.heli.flight;
    this.fireClock += dt;
    let stepped = false;
    while (this.fireClock >= FIRE_STEP) {
      this.fireClock -= FIRE_STEP;
      const w = this.world.wind;
      grid.step(FIRE_STEP, w?.x ?? 0, w?.z ?? 0);
      stepped = true;
    }
    if (!stepped) return;
    this.heat = f.destroyed ? 0 : grid.heatNear(f.x, f.z, HEAT_RADIUS);

    // Smoke drifts downwind of the burning cells.
    const w = this.world.wind;
    const wl = Math.max(0.1, w?.speed ?? 0.1);
    const ox = ((w?.x ?? 0) / wl) * 50;
    const oz = ((w?.z ?? 0) / wl) * 50;
    let smoke = 0;
    for (const i of grid.burningCells()) {
      const d = Math.hypot(grid.centreX(i) + ox - f.x, grid.centreZ(i) + oz - f.z);
      if (d < 110) smoke += 1 - d / 110;
    }
    this.smokeDensity = damp(this.smokeDensity, clamp(smoke / 70, 0, 1), 1.5, FIRE_STEP * 2);

    const zone = this.protectZone;
    if (zone) {
      const nearest = grid.nearestBurning(zone.x, zone.z);
      this.threat = Number.isFinite(nearest) ? 1 - clamp((nearest - zone.radius) / 280, 0, 1) : 0;
      this.frontNearest(zone);
    }
  }

  private frontNearest(zone: { x: number; z: number }): void {
    const grid = this.blaze!;
    let best = Infinity;
    for (const i of grid.burningCells()) {
      const d = Math.hypot(grid.centreX(i) - zone.x, grid.centreZ(i) - zone.z);
      if (d < best) {
        best = d;
        this.frontX = grid.centreX(i);
        this.frontZ = grid.centreZ(i);
      }
    }
  }

  /** The zone the mission asks the player to protect, if any. */
  private get protectZone() {
    const o = this.level.mission.objectives.find((q) => q.kind === 'protect');
    return o?.kind === 'protect' ? o : undefined;
  }

  /** The action key: drop water, or release the slung load. */
  action(): void {
    if (this.bucket) {
      if (this.bucket.drop()) {
        this.sfx.play('unload');
        this.hud.message('Dropping water', 1.2);
      } else if (!this.bucket.dropping) {
        this.hud.message('Bucket is empty', 1.2);
      }
      return;
    }
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
    this.bucketVisuals?.setVisible(false);
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
    for (const p of [this.dust, this.spray, this.smoke, this.fire, this.flare, this.cloud]) {
      p.update(dt);
      p.setScale(this.stage.pixelsPerMetre);
    }
    this.visuals.update(this.time);
    if (this.blaze && this.fireVisuals && this.bucketVisuals && this.bucket) {
      this.heli.visual.hook?.getWorldPosition(this.hookWorld);
      this.bucketVisuals.update(this.bucket, this.hookWorld);
      this.fireVisuals.update(dt, this.stage.pixelsPerMetre, this.world.wind, this.bucket, this.splash);
      if (this.splash) this.splash.hits = 0;
    }
    if (this.cargo && this.cargoVisuals) {
      this.heli.visual.hook?.getWorldPosition(this.hookWorld);
      this.cargoVisuals.update(this.time, this.cargo, this.runner, this.hookWorld);
    }
    this.updateCloud(dt);
    if (follow) {
      this.reliefTimer -= dt;
      if (this.reliefTimer <= 0) {
        this.reliefTimer = 0.3;
        this.stage.iso.setRelief(this.relief(f.x, f.z));
      }
      this.stage.iso.follow(dt, f.x, groundY + (f.y - groundY) * 0.75, f.z, f.vx, f.vz, f.groundSpeed / f.spec.maxSpeed, this.cameraLimits());
    }
  }

  /** Spread of ground heights around a point, for widening the view over steep ground. */
  private relief(x: number, z: number): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const r of [0, 50, 100]) {
        const h = this.world.terrain.heightAt(x + Math.sin(a) * r, z + Math.cos(a) * r);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    return hi - lo;
  }

  /** Moves the cloud base in the shaders, and drifts wisps along it against the mountain. */
  private updateCloud(dt: number): void {
    const base = this.runner.cloudBase;
    if (!Number.isFinite(base)) return;
    cloudUniforms.cloudBase.value = base;
    const focus = this.stage.iso.focus;
    const w = this.world.wind;
    this.cloudBudget += dt * 40;
    for (let tries = 0; this.cloudBudget >= 1 && tries < 80; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * this.stage.iso.visibleHeight * 0.9;
      const x = focus.x + Math.sin(a) * r;
      const z = focus.z + Math.cos(a) * r;
      const ground = this.world.terrain.heightAt(x, z);
      if (ground < base - 25) continue;
      this.cloudBudget -= 1;
      this.cloud.spawn({
        x,
        y: Math.max(ground, base) + Math.random() * 12,
        z,
        vx: (w?.x ?? 0) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        vz: (w?.z ?? 0) * 0.6,
        life: 4 + Math.random() * 3,
        size0: 10 + Math.random() * 8,
        size1: 22 + Math.random() * 14,
        shade: 0.95 + Math.random() * 0.1,
      });
    }
    this.cloudBudget = Math.min(this.cloudBudget, 5);
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
      bucket: this.bucket ? { fill: this.bucket.fill } : undefined,
      fire: this.blaze
        ? { burning: this.blaze.burningCount, burningIn: (x: number, z: number, r: number) => this.blaze!.burningWithin(x, z, r) }
        : undefined,
      boardingId: this.winch?.carryingId ?? this.boarding?.walkingId,
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
        (this.level.mission.survivors ?? []).filter((s) => s.pickup !== 'landing'),
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

    if (this.boarding && this.runner.status === 'running') {
      const events = this.boarding.update(
        dt,
        { x: f.x, z: f.z, landed: f.landed && !f.destroyed },
        this.level.mission.survivors ?? [],
        this.runner.rescued,
        this.runner.capacityLeft,
      );
      for (const e of events) {
        this.runner.notifyRescued(e.id);
        this.sfx.play('rescued');
        this.hud.message(this.runner.capacityLeft > 0 ? 'Climber aboard!' : 'Climber aboard: cabin full', 2);
      }
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
      case 'cloudWarning':
        this.sfx.play('warning');
        this.hud.message(`Cloud coming down over ${e.site}`, 3);
        break;
      case 'passengerUnloaded':
        this.sfx.play('unload');
        this.hud.message(
          e.remaining > 0 ? `Unloading… ${e.remaining} to go` : this.runner.objective?.kind === 'rescue' ? 'Cabin clear: back up the mountain' : 'All survivors delivered',
          1.6,
        );
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
    if (this.rotorStrikes) stats.push(['Rotor strikes', String(this.rotorStrikes)]);
    if (this.cargo) stats.push(['Cargo damage', `${Math.round(this.cargoDamage * 100)}%`]);
    if (this.blaze && this.bucket) {
      stats.push(['Fire area', `${(this.blaze.burnedArea / 10000).toFixed(1)} ha`]);
      stats.push(['Water dropped', `${this.bucket.delivered.toFixed(1)} loads`]);
      const assets = this.level.fire?.assets ?? [];
      if (assets.length) {
        const saved = assets.filter((a) => this.blaze!.burnedWithin(a.x, a.z, a.radius) === 0).length;
        stats.push(['Saved (bonus)', `${saved} of ${assets.length}`]);
      }
    }
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
      case 'rotorStrike':
        this.rotorStrikes++;
        this.hud.message('Rotor strike!', 1.8);
        this.sfx.play('warning');
        iso.shake(0.9 + e.impact * 0.2);
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
      // Show the wind where the aircraft is, which differs from place to place in the mountains.
      const b = this.stage.iso.basis;
      const a = this.air;
      const sx = a.x * b.rightX + a.z * b.rightZ;
      const sy = a.x * b.upX + a.z * b.upZ;
      this.hud.updateWind(Math.atan2(sx, sy), Math.hypot(a.x, a.z) * MS_TO_KNOTS, a.up, a.turbulence);
    } else {
      this.hud.updateWind(undefined, 0);
    }
    this.updateMountainHud(dt);
    if (this.powerHint) {
      this.hud.updateAssist(this.powerHint, false, 0);
    } else if (this.boarding && this.boarding.hint !== 'none' && (!this.winch || this.winch.hint === 'none')) {
      const b = this.boarding;
      this.hud.updateAssist(BOARDING_TEXT[b.hint], b.hint === 'boarding', b.walkingId ? b.progress : 0);
    } else if (this.winch) {
      const w = this.winch;
      this.hud.updateAssist(WINCH_TEXT[w.hint], w.hint === 'working', w.state === 'raising' ? 1 : w.state === 'attaching' ? w.attachProgress : 0);
    } else if (this.cargo) {
      this.hud.updateAssist(...this.cargoAssist());
    } else if (this.bucket) {
      this.hud.updateAssist(...this.bucketAssist());
    } else {
      this.hud.updateAssist('', false, 0);
    }
    const held = this.cargo?.hooked;
    this.hud.updateLoad(held ? { mass: held.def.mass, damage: held.damage } : undefined);
    if (this.blaze && this.bucket) {
      this.hud.updateFire({
        threat: this.threat,
        areaHa: this.blaze.burningArea / 10000,
        bucketFill: this.bucket.fill,
        bucketText: BUCKET_TEXT[this.bucket.hint],
      });
      this.hud.setHaze(this.smokeDensity * 0.85);
    }
    this.hud.setWaypoints(this.waypoints());
    this.hud.tick(dt);
  }

  /** Guidance about the thin air, which takes priority over the winch and boarding hints. */
  private powerHint = '';

  /** Power, cloud and terrain warnings on mountain levels. */
  private updateMountainHud(dt: number): void {
    const f = this.heli.flight;
    const weather = this.level.mission.weather;
    this.powerHint = '';
    if (f.thinAir && !f.destroyed && this.runner.status === 'running') {
      if (f.landed && f.thrustMargin <= 0 && this.climbInput > 0.1 && f.liftAvailable > 0.95) this.powerHint = 'Too heavy to lift off in this thin air';
      else if (!f.landed && f.thrustMargin < 0) this.powerHint = 'No power to hover: descend or gain speed';
    }
    if (f.thinAir || weather) {
      const base = this.runner.cloudBase;
      this.hud.updateMountain({
        thrustMargin: f.thinAir ? f.thrustMargin : 1,
        cloudGap: weather ? base - (f.y + 1.8) : undefined,
        exposure: weather ? this.runner.cloudExposure / weather.maxExposure : 0,
      });
      const near = weather ? 1 - Math.min(1, Math.max(0, (base - f.y) / 25)) : 0;
      this.hud.setFog(f.destroyed ? 0 : Math.max(near * 0.55, weather ? (this.runner.cloudExposure / weather.maxExposure) * 0.95 : 0));
    }

    // Terrain proximity: a direction marker and a beep that speeds up as the gap closes.
    this.proximity = undefined;
    if (this.flightEnv.rotorStrike && !f.landed && !f.destroyed) {
      this.proximity = rotorProximity(f.spec, f.x, f.y, f.z, (x, z) => this.world.groundHeightAt(x, z), PROXIMITY_RANGE);
    }
    const p = this.proximity;
    if (p) {
      const b = this.stage.iso.basis;
      const angle = Math.atan2(p.dirX * b.rightX + p.dirZ * b.rightZ, p.dirX * b.upX + p.dirZ * b.upZ);
      this.hud.updateTerrain({ angle, distance: p.distance });
      this.beepTimer -= dt;
      if (this.beepTimer <= 0) {
        this.sfx.play('proximity');
        this.beepTimer = 0.1 + (p.distance / PROXIMITY_RANGE) * 0.7;
      }
    } else {
      this.hud.updateTerrain(undefined);
      this.beepTimer = 0;
    }
  }

  /** Guidance for the water bucket. */
  private bucketAssist(): [string, boolean, number] {
    const b = this.bucket!;
    switch (b.hint) {
      case 'dipping':
        return ['Filling bucket…', true, b.fill];
      case 'tooFast':
        return ['Bucket: slow down to fill', false, 0];
      case 'full':
        return ['Bucket full · E to drop', true, 1];
      case 'dropping':
        return ['Dropping water', true, b.fill];
      default:
        return ['', false, 0];
    }
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
    if (this.blaze && this.bucket) {
      const t = this.level.terrain;
      if (t.kind === 'forest' && this.bucket.fill < 0.2 && o && o.kind !== 'takeoff' && o.kind !== 'land') {
        out.push(this.project(t.lake.x, this.world.seaLevel ?? 0, t.lake.z, 'Lake', 'water'));
      }
      const zone = this.protectZone;
      if (o?.kind === 'protect' && zone) {
        out.push(this.project(zone.x, this.world.groundHeightAt(zone.x, zone.z) + 6, zone.z, 'Town', 'town'));
        if (this.blaze.burningCount > 0) {
          out.push(this.project(this.frontX, this.world.groundHeightAt(this.frontX, this.frontZ) + 4, this.frontZ, 'Fire front', 'fire'));
        }
      }
    }
    if (this.cargo) {
      const placed = this.runner.placeTarget;
      const next = this.runner.activeCargo.map((id) => this.cargo!.item(id)).find((it) => !it.lost && this.cargo!.hooked !== it && !it.fixed);
      if (next && !this.cargo.hooked) out.push(this.project(next.x, next.y + next.def.h + 3, next.z, next.def.label, 'cargo'));
      if (placed && this.cargo.hooked) out.push(this.project(placed.x, this.world.groundHeightAt(placed.x, placed.z) + 6, placed.z, placed.label, 'pad'));
    }
    if (o?.kind === 'rescue' && r.capacityLeft > 0) {
      const waiting = this.visuals.waitingSurvivors().filter((s: SurvivorDef) => this.spotted.has(s.id));
      // Group survivors close together (e.g. on the same boat) under one marker.
      const groups: { x: number; y: number; z: number; n: number }[] = [];
      for (const s of waiting) {
        const g = groups.find((q) => Math.hypot(q.x - s.x, q.z - s.z) < 10);
        if (g) g.n++;
        else groups.push({ x: s.x, y: s.y, z: s.z, n: 1 });
      }
      for (const g of groups) out.push(this.project(g.x, g.y + 2, g.z, g.n > 1 ? `Survivors ×${g.n}` : 'Survivor', 'survivor'));
    }
    if (o?.kind === 'rescue') {
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
      const snowy = this.level.terrain.kind === 'alpine' && groundY > 195;
      const hard = !overWater && groundY > this.world.terrain.heightAt(f.x, f.z) + 0.05;
      const intensity = Math.pow(1 - agl / (WASH_HEIGHT * rotorScale), 1.3) * f.spool * (hard ? 0.12 : 1);
      this.washBudget += dt * 170 * intensity * rotorScale;
      const target = overWater || snowy ? this.spray : this.dust;
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
