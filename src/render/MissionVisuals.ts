import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { HeliVisualParts } from '../heli/rotor';
import { MissionRunner } from '../missions/MissionRunner';
import { SurvivorDef } from '../missions/types';
import { Winch } from '../missions/Winch';
import { waveHeight } from '../world/waves';
import { World } from '../world/World';
import { merge, part } from './geom';

const AMBER = 0xffc04a;
const CAMERA_YAW = Math.PI / 4;
const GREEN = 0x6fe08a;

interface GateVisual {
  group: Group;
  ring: Mesh;
  material: MeshBasicMaterial;
}

interface SurvivorVisual {
  def: SurvivorDef;
  group: Group;
  arm: Object3D;
  dye?: Mesh;
}

const personGeometry = (jacket: number): BufferGeometry =>
  merge([
    part(new BoxGeometry(0.17, 0.85, 0.2), 0x2c3440, { x: -0.1, y: 0.425 }),
    part(new BoxGeometry(0.17, 0.85, 0.2), 0x2c3440, { x: 0.1, y: 0.425 }),
    part(new BoxGeometry(0.5, 0.62, 0.32), jacket, { y: 1.15 }),
    part(new BoxGeometry(0.11, 0.6, 0.13), jacket, { x: -0.3, y: 1.12 }),
    part(new SphereGeometry(0.15, 8, 6), 0xe0b48f, { y: 1.62 }),
  ]);

/** Gates, landing beacons, hover boxes, survivors and the rescue winch. */
export class MissionVisuals {
  private readonly root = new Group();
  private readonly world: World;
  private readonly runner: MissionRunner;
  private readonly winch?: Winch;
  private readonly heli: HeliVisualParts;
  private readonly gates: GateVisual[] = [];
  private readonly survivors: SurvivorVisual[] = [];
  private readonly beacon: Group;
  private readonly beaconRing: Mesh;
  private readonly hoverBox: Group;
  private readonly targetRing: Mesh;
  private readonly targetMaterial: MeshBasicMaterial;
  private readonly cable: Line;
  private readonly winchman: Group;
  private readonly anchor = new Vector3();
  private readonly personMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

  constructor(scene: Scene, world: World, runner: MissionRunner, heli: HeliVisualParts, winch?: Winch) {
    this.world = world;
    this.runner = runner;
    this.heli = heli;
    this.winch = winch;
    scene.add(this.root);

    for (const o of runner.def.objectives) {
      if (o.kind !== 'gates') continue;
      for (const g of o.gates) this.gates.push(this.createGate(g.x, g.z, g.alt, g.radius));
    }

    // Light column marking the pad to land on.
    this.beacon = new Group();
    const column = new Mesh(
      new CylinderGeometry(1, 1, 1, 24, 1, true),
      new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    column.position.y = 0.5;
    column.scale.set(6, 40, 6);
    this.beacon.add(column);
    this.beaconRing = new Mesh(
      new RingGeometry(0.85, 1, 40),
      new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.beaconRing.rotation.x = -Math.PI / 2;
    this.beacon.add(this.beaconRing);
    this.root.add(this.beacon);

    // Translucent cylinder showing the hover box.
    this.hoverBox = new Group();
    const shell = new Mesh(
      new CylinderGeometry(1, 1, 1, 32, 1, true),
      new MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.12, depthWrite: false, side: DoubleSide }),
    );
    shell.position.y = 0.5;
    this.hoverBox.add(shell);
    for (const y of [0, 1]) {
      const rim = new Mesh(new TorusGeometry(1, 0.012, 4, 48), new MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.7 }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      this.hoverBox.add(rim);
    }
    this.root.add(this.hoverBox);

    // Ring around the survivor being approached.
    this.targetMaterial = new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.85, depthWrite: false });
    this.targetRing = new Mesh(new RingGeometry(0.9, 1, 40), this.targetMaterial);
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.renderOrder = 4;
    this.root.add(this.targetRing);

    for (const s of runner.def.survivors ?? []) this.survivors.push(this.createSurvivor(s));

    const cableGeometry = new BufferGeometry();
    cableGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, -1, 0], 3));
    this.cable = new Line(cableGeometry, new LineBasicMaterial({ color: 0x1c1c1c }));
    this.cable.frustumCulled = false;
    this.root.add(this.cable);
    this.winchman = new Group();
    const wm = new Mesh(personGeometry(0x2a3a5a), this.personMaterial);
    wm.position.y = -1.7;
    wm.castShadow = true;
    this.winchman.add(wm);
    this.winchman.add(new Mesh(new SphereGeometry(0.12, 6, 4), new MeshBasicMaterial({ color: 0x222222 })));
    this.root.add(this.winchman);
  }

  private createGate(x: number, z: number, alt: number, radius: number): GateVisual {
    const ground = this.world.groundHeightAt(x, z);
    const group = new Group();
    group.position.set(x, ground, z);
    const material = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    const ring = new Mesh(new TorusGeometry(radius, 0.35, 8, 40), material);
    ring.position.y = alt;
    // Rings face the isometric camera so they read as hoops; the pass check is a volume.
    ring.rotation.y = CAMERA_YAW;
    ring.castShadow = true;
    group.add(ring);
    const pole = new Mesh(new CylinderGeometry(0.15, 0.15, alt - radius, 6), new MeshLambertMaterial({ color: 0xf1ede4 }));
    pole.position.y = (alt - radius) / 2;
    pole.castShadow = true;
    group.add(pole);
    const base = new Mesh(new CircleGeometry(1.2, 16), new MeshBasicMaterial({ color: 0x3a2a1a, transparent: true, opacity: 0.3, depthWrite: false }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.1;
    group.add(base);
    this.root.add(group);
    return { group, ring, material };
  }

  private createSurvivor(def: SurvivorDef): SurvivorVisual {
    const group = new Group();
    const body = new Mesh(personGeometry(0xff7a1a), this.personMaterial);
    body.castShadow = true;
    group.add(body);
    // Waving arm pivots at the shoulder.
    const arm = new Group();
    arm.position.set(0.3, 1.42, 0);
    const armMesh = new Mesh(new BoxGeometry(0.11, 0.62, 0.13), new MeshLambertMaterial({ color: 0xff7a1a }));
    armMesh.position.y = 0.3;
    arm.add(armMesh);
    group.add(arm);
    let dye: Mesh | undefined;
    if (def.placement === 'water') {
      // Fluorescent dye spreading on the water makes survivors easier to spot.
      dye = new Mesh(
        new CircleGeometry(1, 24),
        new MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      dye.rotation.x = -Math.PI / 2;
      dye.renderOrder = 2;
      this.root.add(dye);
    }
    group.position.set(def.x, def.y, def.z);
    this.root.add(group);
    return { def, group, arm, dye };
  }

  update(time: number): void {
    const r = this.runner;

    // Gates: highlight the next one, hide the ones already flown.
    const active = r.activeGate;
    let activeIndex = -1;
    if (active) {
      const o = r.objective;
      if (o?.kind === 'gates') activeIndex = o.gates.indexOf(active);
    }
    const onGates = r.objective?.kind === 'gates';
    this.gates.forEach((g, i) => {
      g.group.visible = onGates && i >= activeIndex;
      const isActive = i === activeIndex;
      g.material.color.set(isActive ? AMBER : 0xffffff);
      g.material.opacity = isActive ? 0.95 : 0.4;
      g.ring.scale.setScalar(isActive ? 1 + Math.sin(time * 4) * 0.03 : 1);
    });

    // Landing beacon.
    const padId = r.targetPad;
    this.beacon.visible = !!padId && r.status === 'running';
    if (padId) {
      const pad = this.world.pad(padId);
      this.beacon.position.set(pad.x, pad.top + 0.05, pad.z);
      const pulse = (time * 0.8) % 1;
      this.beaconRing.scale.setScalar(pad.size * (0.4 + pulse * 0.5));
      (this.beaconRing.material as MeshBasicMaterial).opacity = 0.9 * (1 - pulse);
    }

    // Hover box.
    const o = r.objective;
    this.hoverBox.visible = o?.kind === 'hover';
    if (o?.kind === 'hover') {
      const ground = this.world.groundHeightAt(o.x, o.z);
      this.hoverBox.position.set(o.x, ground + o.minAlt, o.z);
      this.hoverBox.scale.set(o.radius, o.maxAlt - o.minAlt, o.radius);
    }

    this.updateSurvivors(time);
  }

  private updateSurvivors(time: number): void {
    const winch = this.winch;
    const anchor = this.anchor;
    if (this.heli.winch) this.heli.winch.getWorldPosition(anchor);
    const hookY = anchor.y - (winch?.cable ?? 0);

    for (const s of this.survivors) {
      const rescued = this.runner.rescued.has(s.def.id);
      const onHook = winch?.carryingId === s.def.id;
      s.group.visible = !rescued || onHook;
      if (s.dye) s.dye.visible = !rescued && !onHook;
      if (onHook) {
        s.group.position.set(anchor.x, hookY - 1.75, anchor.z);
        s.group.rotation.set(0, time * 0.8, 0);
        s.arm.rotation.z = 0.3;
        continue;
      }
      if (rescued) continue;
      const t = time + s.def.x * 0.13;
      if (s.def.placement === 'water') {
        // Only head and shoulders above the surface.
        const y = s.def.y + waveHeight(s.def.x, s.def.z, time) - 1.25;
        s.group.position.set(s.def.x, y, s.def.z);
        s.group.rotation.set(Math.sin(t * 1.3) * 0.12, t * 0.2, Math.cos(t * 1.1) * 0.12);
        if (s.dye) {
          s.dye.position.set(s.def.x, s.def.y + 0.06, s.def.z);
          s.dye.scale.setScalar(3.5 + Math.sin(t * 0.4) * 0.4);
        }
      }
      s.arm.rotation.z = Math.PI * 0.85 + Math.sin(t * 6) * 0.45;
    }

    // Target ring: green when the winch can work, amber otherwise.
    const nearest = this.survivors.find((s) => s.def.id === (winch?.targetId ?? winch?.nearestId));
    this.targetRing.visible = !!nearest && !!winch && winch.hint !== 'none';
    if (nearest && winch) {
      const ok = winch.hint === 'working';
      this.targetMaterial.color.set(ok ? GREEN : AMBER);
      this.targetRing.position.set(nearest.def.x, nearest.def.y + 0.15, nearest.def.z);
      this.targetRing.scale.setScalar(winch.config.radius);
    }

    // Cable and winchman.
    const out = !!winch && winch.cable > 0.05;
    this.cable.visible = out;
    this.winchman.visible = out;
    if (out) {
      const pos = this.cable.geometry.getAttribute('position');
      pos.setXYZ(0, anchor.x, anchor.y, anchor.z);
      pos.setXYZ(1, anchor.x, hookY, anchor.z);
      pos.needsUpdate = true;
      this.winchman.position.set(anchor.x, hookY, anchor.z);
      this.winchman.rotation.y = time * 0.5;
    }
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** World positions of survivors still waiting, for HUD markers. */
  waitingSurvivors(): SurvivorDef[] {
    return this.survivors.filter((s) => !this.runner.rescued.has(s.def.id) && this.winch?.carryingId !== s.def.id).map((s) => s.def);
  }
}
