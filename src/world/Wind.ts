import { Noise2D } from './noise';

export interface WindDef {
  /** Direction the wind blows towards, in radians (0 = +z). */
  direction: number;
  /** Mean speed in m/s. */
  speed: number;
  /** Gust amplitude in m/s. */
  gust: number;
  /**
   * Strength of terrain-driven air (mountain levels): updrafts where the wind blows up a slope,
   * downdrafts where it blows down one, and turbulence in the lee of higher ground. 0 or unset
   * leaves the wind the same everywhere.
   */
  orographic?: number;
}

/** Wind at a point: horizontal vector and rising air, all in m/s, with a 0..1 turbulence level. */
export interface LocalWind {
  x: number;
  z: number;
  up: number;
  turbulence: number;
}

/** Gusty wind: a mean vector modulated by slow noise in strength and direction. */
export class Wind {
  readonly def: WindDef;
  x = 0;
  z = 0;
  private t = 0;
  private readonly noise: Noise2D;

  constructor(def: WindDef, seed = 5) {
    this.def = def;
    this.noise = new Noise2D(seed);
    this.update(0);
  }

  /** Seconds of simulated wind so far. */
  get time(): number {
    return this.t;
  }

  get speed(): number {
    return Math.hypot(this.x, this.z);
  }

  /** Direction the wind is blowing towards. */
  get heading(): number {
    return Math.atan2(this.x, this.z);
  }

  update(dt: number): void {
    this.t += dt;
    const strength = Math.max(0, this.def.speed + this.def.gust * this.noise.fbm(this.t / 6, 0.5, 2));
    const dir = this.def.direction + this.noise.noise(this.t / 15, 7.3) * 0.35;
    this.x = Math.sin(dir) * strength;
    this.z = Math.cos(dir) * strength;
  }
}
