import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
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
  Vector3,
} from 'three';
import { CargoDef, CargoItem, CargoSystem, SLING_APEX } from '../missions/Cargo';
import { isPlaced, MissionRunner } from '../missions/MissionRunner';
import { World } from '../world/World';
import { merge, part, propMaterial, rod } from './geom';

const AMBER = 0xffc04a;
const GREEN = 0x6fe08a;
const UP = new Vector3(0, 1, 0);

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
