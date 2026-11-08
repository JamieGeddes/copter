import { BoxGeometry, BufferGeometry, ConeGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Scene, SphereGeometry } from 'three';
import { HeliVisualParts } from '../heli/rotor';
import { CasualtyStatus, Medevac } from '../missions/Medevac';
import { CasualtyDef } from '../missions/types';
import { World } from '../world/World';
import { merge, part, propMaterial } from './geom';
import { Glows, poolMaterial } from './night';

const AMBER = 0xffc04a;
const GREEN = 0x6fe08a;
const BLUE = 0x3a7aff;

const person = (jacket: number, x: number, z: number, ry = 0): BufferGeometry[] => [
  part(new BoxGeometry(0.17, 0.85, 0.2), 0x2c3440, { x: x - 0.1, y: 0.425, z }),
  part(new BoxGeometry(0.17, 0.85, 0.2), 0x2c3440, { x: x + 0.1, y: 0.425, z }),
  part(new BoxGeometry(0.5, 0.62, 0.32), jacket, { x, y: 1.15, z, ry }),
  part(new SphereGeometry(0.15, 8, 6), 0xe0b48f, { x, y: 1.62, z }),
];

/** Ambulance in green and yellow chequers, with light bars front and back. */
const ambulance = (): BufferGeometry =>
  merge([
    part(new BoxGeometry(2.2, 2.6, 6), 0xf2d21a, { y: 1.6 }),
    part(new BoxGeometry(2.24, 0.5, 6.04), 0x1f8a3a, { y: 1.2 }),
    part(new BoxGeometry(2.1, 1.1, 1.4), 0xf2d21a, { y: 1.0, z: 3.6 }),
    part(new BoxGeometry(2.0, 0.6, 0.1), 0x2a3440, { y: 1.9, z: 2.98 }),
    part(new BoxGeometry(2.3, 0.4, 6.2), 0x303034, { y: 0.3 }),
  ]);

const policeCar = (): BufferGeometry =>
  merge([
    part(new BoxGeometry(1.8, 0.8, 4.4), 0xf4f2ec, { y: 0.65 }),
    part(new BoxGeometry(1.84, 0.3, 4.44), 0x2a5caa, { y: 0.6 }),
    part(new BoxGeometry(1.6, 0.6, 2.2), 0x9aa0a8, { y: 1.35, z: -0.2 }),
    part(new BoxGeometry(1.7, 0.3, 4.5), 0x303034, { y: 0.25 }),
  ]);

const fireEngine = (): BufferGeometry =>
  merge([
    part(new BoxGeometry(2.5, 2.8, 8), 0xc8261c, { y: 1.7 }),
    part(new BoxGeometry(2.5, 0.25, 6), 0xd8d4cc, { y: 3.2, z: -0.8 }),
    part(new BoxGeometry(2.54, 0.3, 8.04), 0xf2f0e8, { y: 1.1 }),
    part(new BoxGeometry(2.6, 0.5, 8.2), 0x303034, { y: 0.35 }),
  ]);

interface IncidentScene {
  def: CasualtyDef;
  group: Group;
  ring: Mesh;
  ringMaterial: MeshBasicMaterial;
  stretcher: Group;
  /** Where the stretcher waits, relative to the zone centre. */
  wait: { x: number; z: number };
  y: number;
  glowStart: number;
  glowCount: number;
}

/**
 * Emergency scenes: a cordon of cones, emergency vehicles with blue lights, crews and a casualty
 * on a stretcher who is wheeled to the aircraft while loading. Each scene appears when its call
 * comes in and is cleared once the casualty has been flown away.
 */
export class MedevacVisuals {
  private readonly root = new Group();
  private readonly scenes: IncidentScene[] = [];
  private readonly glows = new Glows();
  private readonly medevac: Medevac;
  private readonly heli: HeliVisualParts;

  constructor(scene: Scene, world: World, medevac: Medevac, heli: HeliVisualParts) {
    this.medevac = medevac;
    this.heli = heli;
    scene.add(this.root);
    for (const c of medevac.casualties) this.scenes.push(this.createScene(world, c.def));
    this.root.add(this.glows.build().points);
  }

  private createScene(world: World, def: CasualtyDef): IncidentScene {
    const group = new Group();
    const y = world.groundHeightAt(def.x, def.z);
    const roof = y > world.terrain.heightAt(def.x, def.z) + 3;
    group.position.set(def.x, y, def.z);
    const parts: BufferGeometry[] = [];

    // Cones round the cordon, except on a rooftop.
    if (!roof) {
      const n = Math.round((def.radius * Math.PI * 2) / 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = def.radius + 1.5;
        parts.push(part(new ConeGeometry(0.25, 0.7, 6), 0xff6a1a, { x: Math.sin(a) * r, y: 0.35, z: Math.cos(a) * r }));
        parts.push(part(new BoxGeometry(0.4, 0.06, 0.4), 0x2a2a2a, { x: Math.sin(a) * r, y: 0.03, z: Math.cos(a) * r }));
      }
    }

    // Vehicles drawn up outside the cordon, with blue lights on their roofs.
    const glowStart = this.glows.count;
    const vehicles: { geometry: BufferGeometry; a: number; bar: number }[] = [];
    if (!roof && !def.dark) {
      vehicles.push({ geometry: ambulance(), a: 0.6, bar: 3 });
      vehicles.push({ geometry: def.fire ? fireEngine() : policeCar(), a: 2.2, bar: def.fire ? 3.4 : 1.7 });
      if (def.fire) vehicles.push({ geometry: fireEngine(), a: 3.6, bar: 3.4 });
      else vehicles.push({ geometry: policeCar(), a: 4.2, bar: 1.7 });
    } else if (!roof) {
      // A single police car on the dark embankment, lights off, its crew holding torches.
      vehicles.push({ geometry: policeCar(), a: 1.2, bar: -1 });
    }
    for (const v of vehicles) {
      const r = def.radius + 6;
      const vx = Math.sin(v.a) * r;
      const vz = Math.cos(v.a) * r;
      const m = new Mesh(v.geometry, propMaterial);
      m.position.set(vx, 0, vz);
      m.rotation.y = v.a + Math.PI / 2;
      m.castShadow = true;
      group.add(m);
      if (v.bar > 0) {
        for (const side of [-0.6, 0.6]) {
          // Either side of the light bar, across the roof.
          this.glows.add(def.x + vx - Math.sin(v.a) * side, y + v.bar + 0.2, def.z + vz - Math.cos(v.a) * side, 2.2, BLUE, 3, side > 0 ? 0.23 : 0);
        }
      }
    }
    if (def.dark && !roof) {
      this.glows.add(def.x + 2.5, y + 1.2, def.z + def.radius * 0.6, 0.9, 0xfff4d0, 4, 0.3);
      this.glows.add(def.x - 1.5, y + 1.2, def.z + def.radius * 0.7, 0.9, 0xfff4d0, 4, 0.8);
    }
    const fire = def.fire;
    if (fire) {
      // Firelight flickering where it burns, and its glow on the ground round the scene.
      const fy = world.groundHeightAt(fire.x, fire.z);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        this.glows.add(fire.x + Math.sin(a) * 3, fy + 1 + (i % 3), fire.z + Math.cos(a) * 3, 4 + (i % 3) * 1.5, 0xff7a20, 4, i * 0.37);
      }
      const pool = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMaterial(0xff7a2a, 0.6));
      pool.position.set((fire.x + def.x) / 2 - def.x, 0.32, (fire.z + def.z) / 2 - def.z);
      pool.scale.set(44, 1, 44);
      group.add(pool);
    }

    // Crew waiting with the casualty.
    const wa = roof ? 2.4 : 3.0;
    const wait = { x: Math.sin(wa) * def.radius * (roof ? 0.9 : 0.75), z: Math.cos(wa) * def.radius * (roof ? 0.9 : 0.75) };
    parts.push(...person(0x2e7a3a, wait.x + 1.6, wait.z + 0.8), ...person(0x2e7a3a, wait.x - 1.4, wait.z - 0.6));
    if (parts.length) {
      const static_ = new Mesh(merge(parts), propMaterial);
      static_.castShadow = true;
      group.add(static_);
    }
    const stretcher = new Group();
    const bed = new Mesh(
      merge([
        part(new BoxGeometry(0.7, 0.12, 2.1), 0xf4f2ec, { y: 0.7 }),
        part(new BoxGeometry(0.5, 0.3, 1.5), 0xc84030, { y: 0.88, z: -0.2 }),
        part(new SphereGeometry(0.16, 8, 6), 0xe0b48f, { y: 0.92, z: 0.8 }),
        part(new BoxGeometry(0.06, 0.7, 0.06), 0x8a8f96, { x: 0.3, y: 0.35, z: 0.9 }),
        part(new BoxGeometry(0.06, 0.7, 0.06), 0x8a8f96, { x: -0.3, y: 0.35, z: -0.9 }),
      ]),
      propMaterial,
    );
    stretcher.add(bed);
    group.add(stretcher);

    // Zone marker: amber while waiting, green while loading.
    const ringMaterial = new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.8, depthWrite: false });
    const ring = new Mesh(new RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), ringMaterial);
    ring.scale.setScalar(def.radius);
    ring.position.y = 0.35;
    ring.renderOrder = 4;
    group.add(ring);
    group.visible = false;
    this.root.add(group);
    return { def, group, ring, ringMaterial, stretcher, wait, y, glowStart, glowCount: this.glows.count - glowStart };
  }

  update(time: number, pixelsPerMetre: number): void {
    this.glows.update(time, pixelsPerMetre);
    const hx = this.heli.root.position.x;
    const hz = this.heli.root.position.z;
    for (const s of this.scenes) {
      const c: CasualtyStatus = this.medevac.status(s.def.id);
      const shown = c.state === 'waiting' || c.state === 'loading' || c.state === 'aboard' || c.state === 'handover';
      // Vehicles stay a while after the pickup; the scene clears once the casualty is at hospital.
      s.group.visible = shown;
      this.setGlows(s, shown);
      if (!shown) continue;
      const waiting = c.state === 'waiting' || c.state === 'loading';
      s.ring.visible = waiting;
      s.stretcher.visible = waiting;
      if (waiting) {
        const pulse = 1 + Math.sin(time * 4) * 0.03;
        s.ring.scale.setScalar(s.def.radius * pulse);
        s.ringMaterial.color.set(c.state === 'loading' ? GREEN : AMBER);
        // Wheeled across to the aircraft while loading.
        const k = c.state === 'loading' ? Math.min(1, c.progress * 1.2) : 0;
        const tx = hx - s.def.x;
        const tz = hz - s.def.z;
        s.stretcher.position.set(s.wait.x + (tx - s.wait.x) * k, 0, s.wait.z + (tz - s.wait.z) * k);
        s.stretcher.rotation.y = Math.atan2(tx - s.wait.x, tz - s.wait.z);
      }
    }
  }

  /** Hides a scene's lights by moving them out of sight. */
  private setGlows(s: IncidentScene, on: boolean): void {
    if (s.glowCount === 0 || s.group.userData.glowsOn === on) return;
    s.group.userData.glowsOn = on;
    const pos = this.glows.points.geometry.getAttribute('position');
    for (let i = 0; i < s.glowCount; i++) {
      const j = s.glowStart + i;
      if (!s.group.userData.home) s.group.userData.home = [];
      const home = s.group.userData.home as number[][];
      if (!home[i]) home[i] = [pos.getX(j), pos.getY(j), pos.getZ(j)];
      const [x, y, z] = home[i];
      pos.setXYZ(j, x, on ? y : -1000, z);
    }
    pos.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }
}
