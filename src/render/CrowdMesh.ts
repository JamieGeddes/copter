import { BoxGeometry, Color, InstancedMesh, MeshLambertMaterial, Object3D, SphereGeometry } from 'three';
import { createRng } from '../core/math';
import { CrowdSim } from '../world/CrowdSim';
import { Terrain } from '../world/Terrain';
import { merge, part } from './geom';

const CLOTHES = [0x3d4a5c, 0x6b3a2e, 0x2f3a2a, 0x8a6a3a, 0x554a66, 0x2b2b30, 0x9a4b3a, 0x46606e, 0xb5a58a, 0x5c5048];
const SKIN = [0xe0b48f, 0xc68c64, 0x9a6440, 0x6e4528, 0xf0cba8];

/** Instanced low-poly people driven by a CrowdSim. */
export class CrowdMesh {
  private readonly bodies: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly sim: CrowdSim;
  private readonly terrain: Terrain;
  private readonly dummy = new Object3D();

  constructor(sim: CrowdSim, terrain: Terrain) {
    this.sim = sim;
    this.terrain = terrain;
    const n = sim.people.length;
    const bodyGeometry = merge([
      part(new BoxGeometry(0.17, 0.85, 0.2), 0x6a6a6a, { x: -0.1, y: 0.425 }),
      part(new BoxGeometry(0.17, 0.85, 0.2), 0x6a6a6a, { x: 0.1, y: 0.425 }),
      part(new BoxGeometry(0.46, 0.62, 0.26), 0xffffff, { y: 1.15 }),
      part(new BoxGeometry(0.11, 0.6, 0.13), 0xf0f0f0, { x: -0.3, y: 1.12 }),
      part(new BoxGeometry(0.11, 0.6, 0.13), 0xf0f0f0, { x: 0.3, y: 1.12 }),
    ]);
    const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.bodies = new InstancedMesh(bodyGeometry, material, n);
    this.heads = new InstancedMesh(new SphereGeometry(0.15, 8, 6), new MeshLambertMaterial(), n);
    const rng = createRng(3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      this.bodies.setColorAt(i, c.setHex(CLOTHES[Math.floor(rng() * CLOTHES.length)]));
      this.heads.setColorAt(i, c.setHex(SKIN[Math.floor(rng() * SKIN.length)]));
    }
    for (const m of [this.bodies, this.heads]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  }

  get meshes(): InstancedMesh[] {
    return [this.bodies, this.heads];
  }

  update(): void {
    const d = this.dummy;
    this.sim.people.forEach((p, i) => {
      const y = this.terrain.heightAt(p.x, p.z);
      const bob = Math.abs(Math.sin(p.phase)) * 0.07 * Math.min(1, p.speed);
      const lean = Math.min(0.35, p.speed * 0.05);
      d.position.set(p.x, y + bob, p.z);
      d.rotation.set(lean, p.heading, Math.sin(p.phase) * 0.06 * Math.min(1, p.speed), 'YXZ');
      d.scale.setScalar(1);
      d.updateMatrix();
      this.bodies.setMatrixAt(i, d.matrix);
      d.position.y += 1.62;
      d.position.x += Math.sin(p.heading) * lean * 1.5;
      d.position.z += Math.cos(p.heading) * lean * 1.5;
      d.updateMatrix();
      this.heads.setMatrixAt(i, d.matrix);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
