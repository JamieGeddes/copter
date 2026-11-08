import { BoxGeometry, Color, Group, InstancedMesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry } from 'three';
import { CarPose, Traffic } from '../world/Traffic';
import { World } from '../world/World';
import { merge, part } from './geom';
import { poolMaterial } from './night';

/** Instanced cars with headlights, tail lights and a pool of headlight on the road ahead. */
export class TrafficVisuals {
  readonly group = new Group();
  private readonly traffic: Traffic;
  private readonly world: World;
  private readonly bodies: InstancedMesh;
  private readonly lamps: InstancedMesh;
  private readonly beams: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly pose: CarPose = { x: 0, z: 0, heading: 0 };

  constructor(traffic: Traffic, world: World) {
    this.traffic = traffic;
    this.world = world;
    const n = traffic.cars.length;
    const body = merge([
      part(new BoxGeometry(1.8, 0.8, 4.2), 0xffffff, { y: 0.6 }),
      part(new BoxGeometry(1.6, 0.6, 2.2), 0x9aa0a8, { y: 1.3, z: -0.2 }),
      part(new BoxGeometry(1.7, 0.3, 4.3), 0x303034, { y: 0.25 }),
    ]);
    this.bodies = new InstancedMesh(body, new MeshLambertMaterial({ vertexColors: true, flatShading: true }), n);
    const lights = merge([
      part(new BoxGeometry(0.4, 0.22, 0.08), 0xfff4d8, { x: -0.6, y: 0.7, z: 2.12 }),
      part(new BoxGeometry(0.4, 0.22, 0.08), 0xfff4d8, { x: 0.6, y: 0.7, z: 2.12 }),
      part(new BoxGeometry(0.4, 0.2, 0.08), 0xff2a1a, { x: -0.6, y: 0.75, z: -2.12 }),
      part(new BoxGeometry(0.4, 0.2, 0.08), 0xff2a1a, { x: 0.6, y: 0.75, z: -2.12 }),
    ]);
    this.lamps = new InstancedMesh(lights, new MeshBasicMaterial({ vertexColors: true }), n);
    const beam = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.beams = new InstancedMesh(beam, poolMaterial(0xfff0d0, 0.45), n);
    this.beams.renderOrder = 1;
    const c = new Color();
    traffic.cars.forEach((car, i) => this.bodies.setColorAt(i, c.setHex(car.colour)));
    this.bodies.castShadow = true;
    this.bodies.receiveShadow = true;
    for (const m of [this.bodies, this.lamps, this.beams]) m.frustumCulled = false;
    this.group.add(this.bodies, this.lamps, this.beams);
  }

  update(): void {
    const d = this.dummy;
    const p = this.pose;
    this.traffic.cars.forEach((car, i) => {
      this.traffic.pose(car, p);
      // Terrain is enough except on bridges, where the deck stands over the water.
      const t = this.world.terrain.heightAt(p.x, p.z);
      const y = (t < 1 ? this.world.groundHeightAt(p.x, p.z) : t) + 0.15;
      d.position.set(p.x, y, p.z);
      d.rotation.set(0, p.heading, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.bodies.setMatrixAt(i, d.matrix);
      this.lamps.setMatrixAt(i, d.matrix);
      d.position.set(p.x + Math.sin(p.heading) * 2, y + 0.15, p.z + Math.cos(p.heading) * 2);
      d.scale.set(5, 1, 13);
      d.updateMatrix();
      this.beams.setMatrixAt(i, d.matrix);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }
}
