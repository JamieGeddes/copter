import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { CargoDef, CargoItem, CargoSystem, SLING_APEX } from '../missions/Cargo';
import { isPlaced, MissionRunner } from '../missions/MissionRunner';
import { World } from '../world/World';
import { merge, part, propMaterial, rod } from './geom';

const AMBER = 0xffc04a;
const GREEN = 0x6fe08a;
const UP = new Vector3(0, 1, 0);
const MAST_RED = 0xc8392b;
const MAST_WHITE = 0xeeebe4;
const LADDER = 0xe0b020;

/**
 * Square lattice mast section: four legs with flanges at each end, cross bracing on every face,
 * and a ladder with a cable tray on the front face (+z), which has to line up with the one below.
 */
const mastSectionGeometry = (w: number, h: number, d: number): BufferGeometry[] => {
  const p: BufferGeometry[] = [];
  const hx = w / 2 - 0.1;
  const hz = d / 2 - 0.1;
  const corners: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  const bays = Math.max(2, Math.round(h / 1.75));
  for (let i = 0; i < bays; i++) {
    // Aviation red and white, alternating bay by bay.
    const colour = i % 2 ? MAST_WHITE : MAST_RED;
    const y0 = (h * i) / bays;
    const y1 = (h * (i + 1)) / bays;
    for (const [x, z] of corners) p.push(rod([x, y0, z], [x, y1, z], 0.1, colour, 6));
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c];
      const [bx, bz] = corners[(c + 1) % 4];
      p.push(rod([ax, y0, az], [bx, y1, bz], 0.05, colour, 4));
      p.push(rod([bx, y0, bz], [ax, y1, az], 0.05, colour, 4));
      p.push(rod([ax, y1, az], [bx, y1, bz], 0.06, colour, 4));
    }
  }
  // Flanges at the foot and head of each leg, and the bottom frame.
  for (const [x, z] of corners) {
    for (const y of [0.06, h - 0.06]) p.push(part(new BoxGeometry(0.38, 0.12, 0.38), 0x3b3d42, { x, y, z }));
  }
  for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c];
    const [bx, bz] = corners[(c + 1) % 4];
    p.push(rod([ax, 0.12, az], [bx, 0.12, bz], 0.07, MAST_RED, 4));
  }
  // Ladder and cable tray on the front face.
  const fz = d / 2 + 0.12;
  for (const x of [-0.25, 0.25]) p.push(part(new BoxGeometry(0.06, h, 0.06), LADDER, { x, y: h / 2, z: fz }));
  for (let y = 0.3; y < h; y += 0.45) p.push(part(new BoxGeometry(0.5, 0.04, 0.04), LADDER, { y, z: fz }));
  p.push(part(new BoxGeometry(0.3, h, 0.08), 0x8a8f96, { x: 0.65, y: h / 2, z: fz }));
  return p;
};

/**
 * Antenna top: a base frame that bolts to the mast head, a tall radome pole with panel aerials on
 * three sides and a microwave dish on the front (+z), and a beacon on top.
 */
const antennaGeometry = (w: number, h: number, d: number): BufferGeometry[] => {
  const p: BufferGeometry[] = [];
  p.push(part(new BoxGeometry(w, 0.3, d), 0x7a7e84, { y: 0.15 }));
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    p.push(part(new BoxGeometry(0.38, 0.12, 0.38), 0x3b3d42, { x: x * (w / 2 - 0.1), y: 0.06, z: z * (d / 2 - 0.1) }));
  }
  p.push(part(new CylinderGeometry(0.32, 0.42, h - 0.6, 10), MAST_WHITE, { y: 0.3 + (h - 0.6) / 2 }));
  for (const y of [h * 0.35, h * 0.7]) p.push(part(new CylinderGeometry(0.44, 0.44, 0.35, 10), MAST_RED, { y }));
  // Panel aerials facing back and to each side.
  for (const a of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
    p.push(part(new BoxGeometry(0.5, 1.8, 0.14), 0xdedad2, { x: Math.sin(a) * 0.55, y: h * 0.55, z: Math.cos(a) * 0.55, ry: a }));
  }
  // Microwave dish on the front face, pointing along the heading.
  p.push(part(new CylinderGeometry(0.75, 0.6, 0.3, 16), MAST_WHITE, { y: h * 0.42, z: 0.75, rx: Math.PI / 2 }));
  p.push(part(new CylinderGeometry(0.5, 0.5, 0.05, 16), 0x9aa0a6, { y: h * 0.42, z: 0.92, rx: Math.PI / 2 }));
  p.push(part(new SphereGeometry(0.18, 8, 6), 0xff3a2a, { y: h - 0.2 }));
  return p;
};

/** Low-poly model of a load, with its origin at the bottom centre. */
const cargoGeometry = (def: CargoDef): BufferGeometry => {
  const { w, h, d } = def;
  const p: BufferGeometry[] = [];
  switch (def.kind) {
    case 'girder': {
      const steel = 0x9c4a32;
      // Deck plate with a truss either side.
      p.push(part(new BoxGeometry(w, 0.35, d), 0x7a7670, { y: 0.18 }));
      for (const side of [-1, 1]) {
        const x = side * (w / 2 - 0.15);
        p.push(part(new BoxGeometry(0.3, 0.3, d), steel, { x, y: 0.5 }));
        p.push(part(new BoxGeometry(0.3, 0.3, d * 0.92), steel, { x, y: h - 0.15 }));
        const bays = 8;
        for (let i = 0; i <= bays; i++) {
          const z = -d / 2 + (d * i) / bays;
          p.push(rod([x, 0.5, z], [x, h - 0.15, z], 0.09, steel, 4));
          if (i < bays) {
            const z2 = -d / 2 + (d * (i + 1)) / bays;
            p.push(rod(i % 2 ? [x, 0.5, z] : [x, h - 0.15, z], i % 2 ? [x, h - 0.15, z2] : [x, 0.5, z2], 0.08, steel, 4));
          }
        }
      }
      break;
    }
    case 'generator': {
      p.push(part(new BoxGeometry(w, h * 0.9, d), 0xe8b02a, { y: h * 0.45 }));
      p.push(part(new BoxGeometry(w + 0.1, 0.18, d + 0.1), 0x3a3c40, { y: 0.09 }));
      for (let z = -d / 3; z <= d / 3; z += d / 6) {
        p.push(part(new BoxGeometry(w + 0.04, h * 0.45, 0.12), 0x3a3c40, { y: h * 0.5, z }));
      }
      p.push(part(new CylinderGeometry(0.15, 0.15, h * 0.35, 8), 0x55585e, { y: h * 1.05, z: -d / 3 }));
      break;
    }
    case 'mastSection':
      p.push(...mastSectionGeometry(w, h, d));
      break;
    case 'antenna':
      p.push(...antennaGeometry(w, h, d));
      break;
    case 'pallet': {
      p.push(part(new BoxGeometry(w, 0.18, d), 0x9a7a52, { y: 0.09 }));
      p.push(part(new BoxGeometry(w * 0.92, h - 0.2, d * 0.92), 0x2f5f9a, { y: 0.18 + (h - 0.2) / 2 }));
      for (const z of [-d / 4, d / 4]) p.push(part(new BoxGeometry(w * 0.95, h - 0.15, 0.08), 0x1c1c1c, { y: 0.18 + (h - 0.2) / 2, z }));
      break;
    }
  }
  return merge(p);
};

interface CargoVisual {
  item: CargoItem;
  group: Group;
}

/** Loads, the rope and slings, the dangling hook, and pick-up and placement markers. */
export class CargoVisuals {
  private readonly root = new Group();
  private readonly loads: CargoVisual[] = [];
  private readonly rope: Line;
  private readonly slings: LineSegments;
  private readonly hookBlock: Mesh;
  private readonly beacon: Group;
  private readonly ghost: Mesh;
  private readonly ghostMaterial: MeshBasicMaterial;
  private readonly zoneRing: Mesh;
  /** Assembly guide: an outline of the seat, an arrow for the front face, and a plumb line. */
  private readonly outline: LineSegments;
  private readonly outlineMaterial: LineBasicMaterial;
  private readonly facing: Mesh;
  private readonly plumb: Line;
  private readonly seatCross: LineSegments;
  private readonly world: World;
  private readonly q = new Quaternion();
  private readonly yaw = new Quaternion();
  private readonly v = new Vector3();
  private ghostFor?: string;

  constructor(scene: Scene, world: World, cargo: CargoSystem) {
    this.world = world;
    scene.add(this.root);
    for (const item of cargo.items) {
      const group = new Group();
      const mesh = new Mesh(cargoGeometry(item.def), propMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      this.root.add(group);
      this.loads.push({ item, group });
    }

    const line = (n: number) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
      return g;
    };
    const ropeMaterial = new LineBasicMaterial({ color: 0x1c1c1c });
    this.rope = new Line(line(2), ropeMaterial);
    this.rope.frustumCulled = false;
    this.slings = new LineSegments(line(8), ropeMaterial);
    this.slings.frustumCulled = false;
    this.hookBlock = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial({ color: 0xe0662a }));
    this.root.add(this.rope, this.slings, this.hookBlock);

    // Amber light column over the load to pick up.
    this.beacon = new Group();
    const column = new Mesh(
      new CylinderGeometry(1, 1, 1, 24, 1, true),
      new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.14, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    column.position.y = 0.5;
    column.scale.set(3, 30, 3);
    this.beacon.add(column);
    this.root.add(this.beacon);

    this.ghostMaterial = new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.3, depthWrite: false });
    this.ghost = new Mesh(new BoxGeometry(1, 1, 1), this.ghostMaterial);
    this.root.add(this.ghost);
    this.zoneRing = new Mesh(new RingGeometry(0.93, 1, 48), new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.8, depthWrite: false }));
    this.zoneRing.rotation.x = -Math.PI / 2;
    this.zoneRing.renderOrder = 4;
    this.root.add(this.zoneRing);

    this.outlineMaterial = new LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, depthTest: false });
    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.outline = new LineSegments(new EdgesGeometry(box), this.outlineMaterial);
    this.outline.renderOrder = 5;
    // A flat arrow on the seat pointing the way the front face must look.
    const arrow = new BufferGeometry();
    arrow.setAttribute('position', new Float32BufferAttribute([-0.35, 0, 0.55, 0.35, 0, 0.55, 0, 0, 1.15], 3));
    arrow.computeVertexNormals();
    this.facing = new Mesh(arrow, new MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, depthTest: false, side: DoubleSide }));
    this.facing.renderOrder = 5;
    this.plumb = new Line(line(2), new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false }));
    this.plumb.frustumCulled = false;
    this.plumb.renderOrder = 5;
    this.seatCross = new LineSegments(line(4), this.outlineMaterial);
    this.seatCross.frustumCulled = false;
    this.seatCross.renderOrder = 5;
    this.root.add(this.outline, this.facing, this.plumb, this.seatCross);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** `hook` is the world position of the aircraft's cargo hook. */
  update(time: number, cargo: CargoSystem, runner: MissionRunner, hook: Vector3): void {
    for (const { item, group } of this.loads) {
      group.visible = !item.lost || item.y > (this.world.seaLevel ?? -Infinity) - item.def.h;
      this.yaw.setFromAxisAngle(UP, item.heading);
      const swinging = cargo.hooked === item && !item.resting;
      if (swinging) {
        // Hang from the sling apex, tilted along the rope.
        const apex = this.v.set(item.x, item.liftY, item.z);
        const dir = hook.clone().sub(apex).normalize();
        this.q.setFromUnitVectors(UP, dir).multiply(this.yaw);
        group.quaternion.copy(this.q);
        const offset = new Vector3(0, -(item.def.h + SLING_APEX), 0).applyQuaternion(this.q);
        group.position.copy(apex).add(offset);
      } else {
        group.quaternion.copy(this.yaw);
        group.position.set(item.x, item.y, item.z);
      }
    }

    // Rope and slings, or a short dangling hook when nothing is attached.
    const ropePos = this.rope.geometry.getAttribute('position');
    const hooked = cargo.hooked;
    const end = hooked ? new Vector3(hooked.x, hooked.liftY, hooked.z) : new Vector3(hook.x, hook.y - 3, hook.z);
    if (hooked && !hooked.resting) {
      // Keep the rope attached to the swung apex.
      const lv = this.loads.find((l) => l.item === hooked)!;
      end.set(0, hooked.def.h + SLING_APEX, 0).applyQuaternion(lv.group.quaternion).add(lv.group.position);
    }
    ropePos.setXYZ(0, hook.x, hook.y, hook.z);
    ropePos.setXYZ(1, end.x, end.y, end.z);
    ropePos.needsUpdate = true;
    this.hookBlock.position.copy(end);
    this.slings.visible = !!hooked;
    if (hooked) {
      const lv = this.loads.find((l) => l.item === hooked)!;
      const s = this.slings.geometry.getAttribute('position');
      const { w, h, d } = hooked.def;
      let i = 0;
      for (const [cx, cz] of [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [-w / 2, d / 2],
        [w / 2, d / 2],
      ]) {
        const corner = new Vector3(cx * 0.9, h, cz * 0.9).applyQuaternion(lv.group.quaternion).add(lv.group.position);
        s.setXYZ(i++, end.x, end.y, end.z);
        s.setXYZ(i++, corner.x, corner.y, corner.z);
      }
      s.needsUpdate = true;
    }

    // Beacon on the next load to pick up.
    const target0 = runner.placeTarget;
    const inZone = (it: CargoItem) =>
      !!target0 && isPlaced({ id: it.def.id, x: it.x, z: it.z, heading: it.heading, resting: it.resting, hooked: false, lost: it.lost, destroyed: false }, target0);
    const toHook = runner.activeCargo.map((id) => cargo.item(id)).find((it) => !it.lost && cargo.hooked !== it && !isResolved(it, runner) && !inZone(it));
    this.beacon.visible = !!toHook && !cargo.hooked;
    if (toHook) this.beacon.position.set(toHook.x, toHook.y, toHook.z);

    this.updateAssembly(time, cargo, runner);

    // Placement target: a ghost of the load (for aligned placements) or a ring.
    const target = runner.placeTarget;
    this.ghost.visible = false;
    this.zoneRing.visible = false;
    if (target) {
      const y = this.world.groundHeightAt(target.x, target.z);
      const load = cargo.items.find((it) => target.cargo.includes(it.def.id) && cargo.hooked === it) ?? cargo.item(target.cargo[0]);
      const ready = load && isPlaced({ id: load.def.id, x: load.x, z: load.z, heading: load.heading, resting: true, hooked: false, lost: false, destroyed: false }, target);
      const colour = ready ? GREEN : AMBER;
      if (target.heading !== undefined && load) {
        if (this.ghostFor !== load.def.id) {
          this.ghost.scale.set(load.def.w, load.def.h, load.def.d);
          this.ghostFor = load.def.id;
        }
        this.ghost.visible = true;
        this.ghost.position.set(target.x, this.supportY(target.x, target.z, load) + load.def.h / 2, target.z);
        this.ghost.rotation.set(0, target.heading, 0);
        this.ghostMaterial.color.set(colour);
        this.ghostMaterial.opacity = 0.22 + Math.sin(time * 4) * 0.06;
      } else {
        this.zoneRing.visible = true;
        this.zoneRing.position.set(target.x, y + 0.2, target.z);
        this.zoneRing.scale.setScalar(target.radius);
        (this.zoneRing.material as MeshBasicMaterial).color.set(colour);
      }
    }
  }

  /**
   * Guide for the next part of an assembly: an outline of where it goes on top of the stack, an
   * arrow for its front face, and a plumb line from the load down to the seat height with a cross
   * at the seat. Green once it is in tolerance.
   */
  private updateAssembly(time: number, cargo: CargoSystem, runner: MissionRunner): void {
    const o = runner.assembleTarget;
    const seatY = runner.seatY;
    const load = cargo.hooked && runner.activeCargo.includes(cargo.hooked.def.id) ? cargo.hooked : undefined;
    const show = !!o && seatY !== undefined;
    this.outline.visible = this.facing.visible = this.seatCross.visible = show;
    this.plumb.visible = show && !!load;
    if (!o || seatY === undefined) return;
    const def = (load ?? runner.activeCargo.map((id) => cargo.item(id))[0])?.def;
    if (!def) return;
    const fit = runner.fit;
    const colour = fit?.ok ? GREEN : fit && fit.lateralOk && fit.headingOk ? 0xc8f07a : AMBER;
    this.outlineMaterial.color.set(colour);
    this.outlineMaterial.opacity = 0.75 + Math.sin(time * 5) * 0.2;
    (this.facing.material as MeshBasicMaterial).color.set(colour);
    this.outline.position.set(o.x, seatY, o.z);
    this.outline.rotation.set(0, o.heading, 0);
    this.outline.scale.set(def.w, def.h, def.d);
    this.facing.position.set(o.x, seatY + 0.05, o.z);
    this.facing.rotation.set(0, o.heading, 0);
    this.facing.scale.setScalar(Math.max(def.w, def.d));
    const c = this.seatCross.geometry.getAttribute('position');
    const r = 0.8;
    c.setXYZ(0, o.x - r, seatY + 0.05, o.z);
    c.setXYZ(1, o.x + r, seatY + 0.05, o.z);
    c.setXYZ(2, o.x, seatY + 0.05, o.z - r);
    c.setXYZ(3, o.x, seatY + 0.05, o.z + r);
    c.needsUpdate = true;
    if (load) {
      const lv = this.loads.find((l) => l.item === load)!;
      const base = lv.group.position;
      const pl = this.plumb.geometry.getAttribute('position');
      pl.setXYZ(0, base.x, base.y, base.z);
      pl.setXYZ(1, base.x, Math.min(base.y, seatY), base.z);
      pl.needsUpdate = true;
    }
  }

  /** Support height for a load centred at x, z (highest of its ends and centre). */
  private supportY(x: number, z: number, load: CargoItem): number {
    let h = -Infinity;
    for (const [sx, sz] of load.samples(x, z)) {
      if (!this.world.isWater(sx, sz)) h = Math.max(h, this.world.groundHeightAt(sx, sz));
    }
    return h === -Infinity ? this.world.groundHeightAt(x, z) : h;
  }
}

const isResolved = (item: CargoItem, runner: MissionRunner): boolean => runner.placed.has(item.def.id) || item.fixed;
