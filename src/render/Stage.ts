import {
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Material,
  Mesh,
  PCFShadowMap,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { TerrainKind } from '../world/Terrain';
import { IsoCamera } from './IsoCamera';

interface Lighting {
  background: number;
  sky: number;
  ground: number;
  hemi: number;
  sun: number;
  sunIntensity: number;
}

const LIGHTING: Record<TerrainKind, Lighting> = {
  desert: { background: 0xd8b07a, sky: 0xfff8ec, ground: 0xc9a47c, hemi: 1.25, sun: 0xfff0d8, sunIntensity: 2.3 },
  coast: { background: 0x1d4a5e, sky: 0xe6eef2, ground: 0x7d8f74, hemi: 1.15, sun: 0xfff4e4, sunIntensity: 2.1 },
  floodplain: { background: 0x7a8a5c, sky: 0xeef2ee, ground: 0x8a9a6a, hemi: 1.2, sun: 0xfff2dc, sunIntensity: 2.2 },
  forest: { background: 0x4f6a3c, sky: 0xeaf0e4, ground: 0x6f7f4c, hemi: 1.1, sun: 0xffe8c4, sunIntensity: 2.0 },
};

/** Frees GPU resources held by a scene. Shared materials are left alone. */
const disposeScene = (scene: Scene): void => {
  const textures = new Set<Texture>();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry instanceof BufferGeometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats as Material[]) {
      for (const v of Object.values(m)) if (v instanceof Texture) textures.add(v);
    }
  });
  for (const t of textures) t.dispose();
};

const SHADOW_MAP = 4096;

/** Renderer, scene and lighting. The sun's shadow camera follows the view. */
export class Stage {
  readonly renderer: WebGLRenderer;
  scene = new Scene();
  readonly iso = new IsoCamera();
  sun!: DirectionalLight;
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

    this.sunDir = new Vector3(0.25, 0.62, -0.75).normalize();
    this.newScene('desert');

    this.lightRight.crossVectors(new Vector3(0, 1, 0), this.sunDir).normalize();
    this.lightUp.crossVectors(this.sunDir, this.lightRight).normalize();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Replaces the scene with an empty, lit one and frees the old scene's resources. */
  newScene(kind: TerrainKind): Scene {
    disposeScene(this.scene);
    this.sun?.dispose();
    const l = LIGHTING[kind];
    const scene = new Scene();
    scene.background = new Color(l.background);
    scene.add(new HemisphereLight(l.sky, l.ground, l.hemi));
    // Late-afternoon sun from the upper right of the screen; shadows fall down-left.
    const sun = new DirectionalLight(l.sun, l.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;
    scene.add(sun, sun.target);
    this.scene = scene;
    this.sun = sun;
    this.shadowExtent = 0;
    return scene;
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
