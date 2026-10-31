import { Vector3 } from 'three';
import { RotorAudio } from '../audio/RotorAudio';
import { Particles } from '../fx/Particles';
import { FlightEvent, FlightInput } from '../heli/FlightModel';
import { Helicopter } from '../heli/Helicopter';
import { KESTREL } from '../heli/HeliSpec';
import { createKestrelModel } from '../heli/KestrelModel';
import { axesFromKeys } from '../input/bindings';
import { Keyboard } from '../input/Keyboard';
import { CrowdMesh } from '../render/CrowdMesh';
import { screenToWorld } from '../render/isoMath';
import { createProps } from '../render/props';
import { Stage } from '../render/Stage';
import { createTerrainMesh } from '../render/TerrainMesh';
import { Hud, Waypoint } from '../ui/Hud';
import { CrowdSim } from '../world/CrowdSim';
import { DESERT_LEVEL } from '../world/level';
import { World } from '../world/World';

type Mode = 'title' | 'playing' | 'paused' | 'crashed';

const PHYSICS_DT = 1 / 120;
const MS_TO_KNOTS = 1.944;
const DUST_HEIGHT = 14;

/** Owns the level, the aircraft and the main loop. */
export class Game {
  readonly stage: Stage;
  readonly world: World;
  readonly heli: Helicopter;
  private readonly keyboard = new Keyboard();
  private readonly audio = new RotorAudio();
  private readonly hud: Hud;
  private readonly crowd: CrowdSim;
  private readonly crowdMesh: CrowdMesh;
  private readonly dust: Particles;
  private readonly smoke: Particles;
  private readonly fire: Particles;
  private mode: Mode = 'title';
  private accumulator = 0;
  private last = performance.now();
  private dustBudget = 0;
  private smokeBudget = 0;
  private readonly visited = new Set<string>();
  private readonly tmp = new Vector3();

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.world = new World(DESERT_LEVEL);
    const scene = this.stage.scene;

    scene.add(createTerrainMesh(this.world.terrain));
    scene.add(createProps(this.world));

    this.crowd = new CrowdSim(this.world, DESERT_LEVEL.crowds);
    this.crowdMesh = new CrowdMesh(this.crowd, this.world.terrain);
    for (const m of this.crowdMesh.meshes) scene.add(m);

    this.heli = new Helicopter(KESTREL, createKestrelModel(), scene);

    this.dust = new Particles({ capacity: 900, colour: 0xd9ad74, opacity: 0.55, drag: 1.6, gravity: 0.4 });
    this.smoke = new Particles({ capacity: 500, colour: 0x3a342f, opacity: 0.6, drag: 0.6, gravity: 2.2 });
    this.fire = new Particles({ capacity: 200, colour: 0xff8a2a, opacity: 0.9, additive: true, drag: 2, gravity: 3 });
    scene.add(this.dust.points, this.smoke.points, this.fire.points);

    this.hud = new Hud(container, KESTREL, DESERT_LEVEL.name);
    this.respawn();
    this.updateObjectives();
    this.hud.showOverlay(
      'COPTER',
      ['Phase 1 flight test', 'Get a feel for the Kestrel, then land on every helipad on the map.'],
      'Press Enter to fly',
    );

    if (import.meta.env.DEV) (window as unknown as { __copter: Game }).__copter = this;
  }

  start(): void {
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private respawn(): void {
    const pad = this.world.pad(DESERT_LEVEL.spawnPad);
    const f = this.heli.flight;
    f.place(pad.x, pad.top, pad.z, DESERT_LEVEL.spawnHeading);
    f.destroyed = false;
    f.damage = 0;
    f.fuel = 1;
    f.engineOn = true;
    f.spool = this.mode === 'title' ? 0.15 : 0.5;
    this.stage.iso.snapTo(pad.x, pad.top, pad.z);
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const kb = this.keyboard;

    this.handleMenus();
    if (kb.wasPressed('zoomIn')) this.stage.iso.zoom(0.85);
    if (kb.wasPressed('zoomOut')) this.stage.iso.zoom(1 / 0.85);
    if (kb.wheelSteps() !== 0) this.stage.iso.zoom(Math.pow(1.1, kb.wheelSteps()));
    if (kb.wasPressed('help')) this.hud.toggleHelp();
    if (kb.wasPressed('heightLine')) this.heli.showHeightLine = !this.heli.showHeightLine;
    if (kb.wasPressed('mute')) this.audio.setMuted(!this.audio.isMuted);

    const f = this.heli.flight;
    const simulating = this.mode === 'playing' || this.mode === 'crashed';
    if (simulating) {
      const axes = axesFromKeys(kb.held);
      const world = screenToWorld(this.stage.iso.basis, axes.x, axes.y);
      const input: FlightInput =
        this.mode === 'playing' ? { moveX: world.x, moveZ: world.z, climb: axes.climb } : { moveX: 0, moveZ: 0, climb: 0 };
      this.accumulator += dt;
      while (this.accumulator >= PHYSICS_DT) {
        this.accumulator -= PHYSICS_DT;
        for (const e of f.step(PHYSICS_DT, input, this.world)) this.onFlightEvent(e);
        this.service(PHYSICS_DT);
      }
      this.audio.update(f.spool, Math.max(0, axes.climb) * 0.7 + Math.hypot(f.tiltX, f.tiltZ) * 0.4);
    } else {
      this.audio.update(this.mode === 'paused' ? 0 : f.spool * 0.6, 0);
    }

    if (this.mode !== 'paused') {
      const groundY = this.world.groundHeightAt(f.x, f.z);
      this.heli.sync(dt, groundY);
      this.crowd.update(dt, f.destroyed ? undefined : { x: f.x, z: f.z, agl: f.y - groundY });
      this.crowdMesh.update();
      this.spawnEffects(dt, groundY);
      this.dust.update(dt);
      this.smoke.update(dt);
      this.fire.update(dt);
      const limit = this.world.terrain.half - 170;
      this.stage.iso.follow(dt, f.x, groundY + (f.y - groundY) * 0.75, f.z, f.vx, f.vz, f.groundSpeed / f.spec.maxSpeed, {
        minX: -limit,
        maxX: limit,
        minZ: -limit,
        maxZ: limit,
      });
    }

    const ppm = this.stage.pixelsPerMetre;
    this.dust.setScale(ppm);
    this.smoke.setScale(ppm);
    this.fire.setScale(ppm);

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
    this.hud.setWaypoints(this.waypoints());
    this.hud.tick(dt);
    this.stage.render();
    kb.endFrame();
  }

  private handleMenus(): void {
    const kb = this.keyboard;
    if (this.mode === 'title' && kb.wasPressed('action')) {
      this.audio.start();
      this.mode = 'playing';
      this.hud.hideOverlay();
      this.hud.message('Hold Space to lift off', 3);
    } else if (this.mode === 'playing' && kb.wasPressed('pause')) {
      this.mode = 'paused';
      this.hud.showOverlay('PAUSED', [], 'Press P to resume');
    } else if (this.mode === 'paused' && kb.wasPressed('pause')) {
      this.mode = 'playing';
      this.hud.hideOverlay();
    } else if (this.mode === 'crashed' && kb.wasPressed('action')) {
      this.mode = 'playing';
      this.hud.hideOverlay();
      this.respawn();
    }
  }

  private service(dt: number): void {
    const f = this.heli.flight;
    if (!f.landed || f.destroyed) return;
    const pad = this.world.padAt(f.x, f.z);
    if (pad?.service) f.service(dt, 0.12, 0.06);
  }

  private onFlightEvent(e: FlightEvent): void {
    switch (e.type) {
      case 'landed': {
        const pad = this.world.padAt(e.x, e.z);
        if (pad) {
          const first = !this.visited.has(pad.id);
          this.visited.add(pad.id);
          this.hud.message(first ? `Landed: ${pad.label}` : pad.label, 2.5);
          if (first) this.updateObjectives();
          if (first && this.visited.size === this.world.pads.length) {
            this.hud.message('All pads visited. Nice flying!', 4);
          }
        }
        break;
      }
      case 'hardLanding':
        this.hud.message(e.severity > 1 ? 'Heavy landing!' : 'Hard landing', 2);
        this.stage.iso.shake(0.4 + e.severity * 0.4);
        break;
      case 'collision':
        this.hud.message('Collision!', 1.5);
        this.stage.iso.shake(Math.min(1.5, e.impact * 0.25));
        break;
      case 'lowFuel':
        this.hud.message('Low fuel: return to base', 3);
        break;
      case 'fuelEmpty':
        this.hud.message('Out of fuel!', 3);
        break;
      case 'crashed':
        this.mode = 'crashed';
        this.explode();
        this.stage.iso.shake(2.5);
        this.hud.showOverlay('CRASHED', [e.reason], 'Press Enter to try again');
        break;
      case 'takeoff':
        break;
    }
  }

  private updateObjectives(): void {
    this.hud.setObjectives(
      'Land on every pad',
      this.world.pads.map((p) => ({ label: p.label, done: this.visited.has(p.id) })),
    );
  }

  private waypoints(): Waypoint[] {
    const cam = this.stage.iso.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const margin = 60;
    return this.world.pads.map((p) => {
      this.tmp.set(p.x, p.top + 3, p.z).project(cam);
      let x = ((this.tmp.x + 1) / 2) * w;
      let y = ((1 - this.tmp.y) / 2) * h;
      const onScreen = x > margin && x < w - margin && y > margin && y < h - margin;
      if (!onScreen) {
        // Pin to the screen edge along the line from the centre.
        const cx = w / 2;
        const cy = h / 2;
        const dx = x - cx;
        const dy = y - cy;
        const s = Math.min((w / 2 - margin) / Math.abs(dx || 1), (h / 2 - margin) / Math.abs(dy || 1));
        x = cx + dx * s;
        y = cy + dy * s;
      }
      const f = this.heli.flight;
      const dist = Math.hypot(p.x - f.x, p.z - f.z);
      return {
        label: onScreen ? p.label : `${p.label}\n${Math.round(dist)} m`,
        x,
        y,
        onScreen,
        done: this.visited.has(p.id),
      };
    });
  }

  private spawnEffects(dt: number, groundY: number): void {
    const f = this.heli.flight;
    const agl = f.y - groundY;

    // Rotor downwash kicks up sand; much less from concrete and rooftops.
    if (!f.destroyed && f.spool > 0.5 && agl < DUST_HEIGHT) {
      const hard = groundY > this.world.terrain.heightAt(f.x, f.z) + 0.05;
      const intensity = Math.pow(1 - agl / DUST_HEIGHT, 1.3) * f.spool * (hard ? 0.12 : 1);
      this.dustBudget += dt * 160 * intensity;
      while (this.dustBudget >= 1) {
        this.dustBudget -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 4;
        const out = 7 + Math.random() * 7;
        const x = f.x + Math.cos(a) * r;
        const z = f.z + Math.sin(a) * r;
        this.dust.spawn({
          x,
          y: this.world.groundHeightAt(x, z) + 0.3,
          z,
          vx: Math.cos(a) * out + f.vx * 0.3,
          vy: 0.6 + Math.random() * 1.6,
          vz: Math.sin(a) * out + f.vz * 0.3,
          life: 1.4 + Math.random() * 1.4,
          size0: 1.5 + Math.random(),
          size1: 5 + Math.random() * 4,
          shade: 0.85 + Math.random() * 0.25,
        });
      }
    }

    // Smoke from a damaged or wrecked airframe.
    const smokeRate = f.destroyed ? 30 : f.damage > 0.45 ? (f.damage - 0.45) * 40 : 0;
    this.smokeBudget += dt * smokeRate;
    while (this.smokeBudget >= 1) {
      this.smokeBudget -= 1;
      const s = Math.sin(f.heading);
      const c = Math.cos(f.heading);
      this.smoke.spawn({
        x: f.x - s * 1 + (Math.random() - 0.5),
        y: f.y + 2.2,
        z: f.z - c * 1 + (Math.random() - 0.5),
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
}
