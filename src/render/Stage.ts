import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { IsoCamera } from './IsoCamera';

const SHADOW_MAP = 4096;

/** Renderer, scene and lighting. The sun's shadow camera follows the view. */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly iso = new IsoCamera();
  readonly sun: DirectionalLight;
  private readonly sunDir: Vector3;
  private readonly lightRight = new Vector3();
  private readonly lightUp = new Vector3();
  private shadowExtent = 0;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0xd8b07a);

    const hemi = new HemisphereLight(0xfff8ec, 0xc9a47c, 1.25);
    this.scene.add(hemi);

    // Late-afternoon sun from the upper right of the screen; shadows fall down-left.
    this.sunDir = new Vector3(0.25, 0.62, -0.75).normalize();
    this.sun = new DirectionalLight(0xfff0d8, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.lightRight.crossVectors(new Vector3(0, 1, 0), this.sunDir).normalize();
    this.lightUp.crossVectors(this.sunDir, this.lightRight).normalize();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Pixels per metre on screen, for sizing particles. */
  get pixelsPerMetre(): number {
    return (this.renderer.domElement.height / this.iso.visibleHeight);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.iso.setAspect(w / h);
  }

  render(): void {
    this.updateShadowFrustum();
    this.renderer.render(this.scene, this.iso.camera);
  }

  /** Centres the shadow camera on the view, snapped to shadow texels to stop shimmering. */
  private updateShadowFrustum(): void {
    // Size the shadow area to the view, in coarse steps to avoid constant re-fitting.
    const width = this.iso.visibleHeight * (this.renderer.domElement.width / this.renderer.domElement.height);
    const extent = Math.max(80, Math.ceil((width * 0.62) / 20) * 20);
    if (extent !== this.shadowExtent) {
      this.shadowExtent = extent;
      const cam = this.sun.shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.updateProjectionMatrix();
    }
    const f = this.iso.focus;
    const texel = (extent * 2) / SHADOW_MAP;
    const a = Math.round(f.dot(this.lightRight) / texel) * texel;
    const b = Math.round(f.dot(this.lightUp) / texel) * texel;
    const c = f.dot(this.sunDir);
    const centre = new Vector3()
      .addScaledVector(this.lightRight, a)
      .addScaledVector(this.lightUp, b)
      .addScaledVector(this.sunDir, c);
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(this.sunDir, 350);
    this.sun.target.updateMatrixWorld();
  }
}
