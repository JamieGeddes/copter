import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial } from 'three';

export interface ParticleOptions {
  capacity: number;
  colour: number;
  /** Opacity at peak. */
  opacity: number;
  additive?: boolean;
  /** Linear drag (1/s). */
  drag: number;
  /** Vertical acceleration (negative falls). */
  gravity: number;
}

export interface SpawnParams {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  /** Diameter in metres at birth and death. */
  size0: number;
  size1: number;
  /** Optional brightness multiplier (0..2). */
  shade?: number;
}

/**
 * Pool of soft round particles drawn as points. Point sizes are given in metres and
 * converted to pixels with the orthographic camera's scale.
 */
export class Particles {
  readonly points: Points;
  private readonly opts: ParticleOptions;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alpha: Float32Array;
  private readonly shade: Float32Array;
  private readonly material: ShaderMaterial;
  private next = 0;

  constructor(opts: ParticleOptions) {
    this.opts = opts;
    const n = opts.capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n * 2);
    this.sizes = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.shade = new Float32Array(n).fill(1);

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new BufferAttribute(this.sizes, 1));
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    g.setAttribute('aShade', new BufferAttribute(this.shade, 1));

    this.material = new ShaderMaterial({
      uniforms: {
        uScale: { value: 10 },
        uColour: { value: new Color(opts.colour) },
        uOpacity: { value: opts.opacity },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aShade;
        uniform float uScale;
        varying float vAlpha;
        varying float vShade;
        void main() {
          vAlpha = aAlpha;
          vShade = aShade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColour;
        uniform float uOpacity;
        varying float vAlpha;
        varying float vShade;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          float a = smoothstep(1.0, 0.35, r) * vAlpha * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColour * vShade, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** Pixels per metre for the current camera and viewport. */
  setScale(pixelsPerMetre: number): void {
    this.material.uniforms.uScale.value = pixelsPerMetre;
  }

  spawn(p: SpawnParams): void {
    const i = this.next;
    this.next = (this.next + 1) % this.opts.capacity;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx;
    this.vel[i * 3 + 1] = p.vy;
    this.vel[i * 3 + 2] = p.vz;
    this.age[i] = 0;
    this.life[i] = p.life;
    this.size[i * 2] = p.size0;
    this.size[i * 2 + 1] = p.size1;
    this.shade[i] = p.shade ?? 1;
  }

  update(dt: number): void {
    const { drag, gravity } = this.opts;
    const k = Math.exp(-drag * dt);
    for (let i = 0; i < this.opts.capacity; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + gravity * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.sizes[i] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
      // Quick fade in, slow fade out.
      this.alpha[i] = Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aShade.needsUpdate = true;
  }
}
