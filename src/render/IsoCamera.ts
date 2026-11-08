import { OrthographicCamera, Vector3 } from 'three';
import { clamp, damp } from '../core/math';
import { Bounds } from '../world/collision';
import { groundBasis, GroundBasis } from './isoMath';

export interface IsoCameraOptions {
  yaw: number;
  elevation: number;
  /** Visible world height in metres at zoom 1. */
  viewHeight: number;
  minViewHeight: number;
  maxViewHeight: number;
}

const DEFAULTS: IsoCameraOptions = {
  yaw: Math.PI / 4,
  elevation: (48 * Math.PI) / 180,
  viewHeight: 90,
  minViewHeight: 45,
  maxViewHeight: 170,
};

/** Orthographic follow camera at a fixed isometric angle, with look-ahead and zoom. */
export class IsoCamera {
  readonly camera: OrthographicCamera;
  readonly opts: IsoCameraOptions;
  readonly basis: GroundBasis;
  /** Point on the ground the camera looks at. */
  readonly focus = new Vector3();
  private aspect = 16 / 9;
  private viewHeight: number;
  private targetViewHeight: number;
  private speedZoom = 0;
  private reliefZoom = 0;
  private targetReliefZoom = 0;
  private readonly offset = new Vector3();
  private shakeAmount = 0;
  private readonly shakeOffset = new Vector3();

  constructor(opts: Partial<IsoCameraOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.viewHeight = this.targetViewHeight = this.opts.viewHeight;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 1, 2000);
    this.basis = groundBasis(this.opts.yaw);
    const { yaw, elevation } = this.opts;
    this.offset.set(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(600);
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  /** Sets the default zoom for a level. */
  setViewHeight(h: number): void {
    this.viewHeight = this.targetViewHeight = h;
  }

  /** Multiplies the zoom level; values > 1 zoom out. */
  zoom(factor: number): void {
    this.targetViewHeight = clamp(this.targetViewHeight * factor, this.opts.minViewHeight, this.opts.maxViewHeight);
  }

  /** Adds camera shake, in metres of displacement. */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  /**
   * Widens the view over steep ground so the slopes around the aircraft stay in shot. `relief` is
   * the spread of ground heights nearby in metres.
   */
  setRelief(relief: number): void {
    this.targetReliefZoom = clamp((relief - 30) / 260, 0, 0.35);
  }

  /** Current visible world height in metres. */
  get visibleHeight(): number {
    return this.viewHeight * (1 + this.speedZoom + this.reliefZoom);
  }

  /** Moves the focus straight to a point (used on spawn). */
  snapTo(x: number, y: number, z: number): void {
    this.focus.set(x, y, z);
    this.apply();
  }

  /**
   * Follows a target, leading in the direction of travel. `speedFraction` (0..1) widens
   * the view at speed. The focus is kept inside `limits` so the level edge stays off-screen.
   */
  follow(dt: number, x: number, y: number, z: number, vx: number, vz: number, speedFraction: number, limits: Bounds): void {
    const lead = 1.1;
    const tx = clamp(x + vx * lead, limits.minX, limits.maxX);
    const tz = clamp(z + vz * lead, limits.minZ, limits.maxZ);
    this.focus.x = damp(this.focus.x, tx, 2.2, dt);
    this.focus.z = damp(this.focus.z, tz, 2.2, dt);
    this.focus.y = damp(this.focus.y, y, 1.5, dt);
    this.viewHeight = damp(this.viewHeight, this.targetViewHeight, 5, dt);
    this.speedZoom = damp(this.speedZoom, speedFraction * 0.22, 1.2, dt);
    this.reliefZoom = damp(this.reliefZoom, this.targetReliefZoom, 0.6, dt);
    this.shakeAmount = damp(this.shakeAmount, 0, 5, dt);
    this.apply();
  }

  private apply(): void {
    const h = this.visibleHeight / 2;
    const w = h * this.aspect;
    this.camera.left = -w;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = -h;
    const s = this.shakeAmount;
    this.shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5, (Math.random() - 0.5) * s);
    this.camera.position.copy(this.focus).add(this.offset).add(this.shakeOffset);
    this.camera.lookAt(this.shakeOffset.add(this.focus));
    this.camera.updateProjectionMatrix();
  }
}
