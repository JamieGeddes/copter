import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
  SpotLight,
  Vector3,
} from 'three';
import { damp } from '../core/math';

export type SearchlightMode = 'auto' | 'ahead' | 'off';

export const SEARCHLIGHT_MODES: SearchlightMode[] = ['auto', 'ahead', 'off'];

/** The light swings onto a target within this distance in auto mode. */
const TRACK_RANGE = 240;
const ANGLE = 0.3;
const INTENSITY = 260;

export interface SearchlightAim {
  /** World position of the lamp. */
  origin: Vector3;
  heading: number;
  vx: number;
  vz: number;
  landed: boolean;
  /** Where to point in auto mode, if anywhere. */
  target?: { x: number; y: number; z: number };
  groundHeightAt(x: number, z: number): number;
}

/**
 * Steerable searchlight under the nose: a shadow-casting spot light and a faint visible beam.
 * In auto mode it swings onto the scene or hospital being flown to once in range, otherwise it
 * lights the ground ahead; it can be locked ahead or switched off.
 */
export class Searchlight {
  mode: SearchlightMode = 'auto';
  readonly light: SpotLight;
  private readonly beam: Mesh;
  private readonly aim = new Vector3();
  private readonly dir = new Vector3();
  private readonly down = new Vector3(0, -1, 0);
  private level = 1;
  private started = false;

  constructor(scene: Scene) {
    this.light = new SpotLight(0xfff2dc, INTENSITY, 0, ANGLE, 0.45, 1);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 1;
    this.light.shadow.camera.far = 420;
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.05;
    const target = new Object3D();
    this.light.target = target;
    scene.add(this.light, target);

    // Visible beam: bright at the lamp, fading towards the ground.
    const g = new CylinderGeometry(0.15, 1, 1, 28, 1, true).translate(0, -0.5, 0);
    const pos = g.getAttribute('position');
    const colours = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = 0.15 + 0.85 * (1 + pos.getY(i));
      colours.set([k, k * 0.96, k * 0.9], i * 3);
    }
    g.setAttribute('color', new Float32BufferAttribute(colours, 3));
    this.beam = new Mesh(
      g,
      new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.09, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    this.beam.renderOrder = 6;
    this.beam.frustumCulled = false;
    scene.add(this.beam);
  }

  /** Moves to the next mode and returns it. */
  cycle(): SearchlightMode {
    this.mode = SEARCHLIGHT_MODES[(SEARCHLIGHT_MODES.indexOf(this.mode) + 1) % SEARCHLIGHT_MODES.length];
    return this.mode;
  }

  /** True when the light is pointing at its auto-mode target. */
  tracking = false;

  update(dt: number, a: SearchlightAim): void {
    const o = a.origin;
    // Keep the light in the scene and dim it rather than removing it, so materials are not rebuilt.
    this.level = damp(this.level, this.mode === 'off' ? 0 : 1, 8, dt);
    this.light.intensity = INTENSITY * this.level;
    this.beam.visible = this.level > 0.02;

    let tx: number;
    let ty: number;
    let tz: number;
    const t = a.target;
    this.tracking = this.mode === 'auto' && !!t && Math.hypot(t.x - o.x, t.z - o.z) < TRACK_RANGE;
    if (this.tracking && t) {
      tx = t.x;
      ty = t.y;
      tz = t.z;
    } else {
      const speed = Math.hypot(a.vx, a.vz);
      const fx = speed > 3 ? a.vx / speed : Math.sin(a.heading);
      const fz = speed > 3 ? a.vz / speed : Math.cos(a.heading);
      const reach = a.landed ? 14 : Math.min(90, 22 + speed * 1.1);
      tx = o.x + fx * reach;
      tz = o.z + fz * reach;
      ty = a.groundHeightAt(tx, tz);
    }
    if (!this.started) {
      this.aim.set(tx, ty, tz);
      this.started = true;
    }
    this.aim.set(damp(this.aim.x, tx, 4, dt), damp(this.aim.y, ty, 4, dt), damp(this.aim.z, tz, 4, dt));

    this.light.position.copy(o);
    this.light.target.position.copy(this.aim);
    this.light.target.updateMatrixWorld();

    this.dir.subVectors(this.aim, o);
    const len = Math.max(1, this.dir.length());
    this.dir.divideScalar(len);
    this.beam.position.copy(o);
    this.beam.quaternion.setFromUnitVectors(this.down, this.dir);
    const r = len * Math.tan(ANGLE * 0.8);
    this.beam.scale.set(r, len, r);
    (this.beam.material as MeshBasicMaterial).opacity = 0.09 * this.level;
  }
}
