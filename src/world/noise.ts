import { createRng } from '../core/math';

/** Seeded 2D gradient (Perlin) noise with fractal Brownian motion helper. */
export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly gradX = new Float32Array(256);
  private readonly gradY = new Float32Array(256);

  constructor(seed: number) {
    const rng = createRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
      const a = rng() * Math.PI * 2;
      this.gradX[i] = Math.cos(a);
      this.gradY[i] = Math.sin(a);
    }
  }

  /** Returns noise in roughly [-1, 1]. */
  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const g = (ix: number, iy: number, dx: number, dy: number): number => {
      const h = this.perm[ix + this.perm[iy]];
      return this.gradX[h] * dx + this.gradY[h] * dy;
    };
    const n00 = g(X, Y, xf, yf);
    const n10 = g(X + 1, Y, xf - 1, yf);
    const n01 = g(X, Y + 1, xf, yf - 1);
    const n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * 1.414;
  }

  /** Fractal Brownian motion; result roughly in [-1, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
