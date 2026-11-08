import { createRng } from '../core/math';

/**
 * A traffic loop: a road driven out along one lane and back along the other, so cars turn round
 * at the ends rather than vanishing. Traffic keeps to the left.
 */
export interface TrafficLoop {
  points: [number, number][];
  /** Cumulative distance to each point along the road. */
  cum: number[];
  /** Length of the road; the loop is twice this. */
  length: number;
  /** Distance from the centre line to the lane. */
  lane: number;
  speed: number;
}

export interface Car {
  loop: number;
  /** Distance round the loop, 0..2 * length. */
  s: number;
  v: number;
  colour: number;
}

export interface CarPose {
  x: number;
  z: number;
  heading: number;
}

/** Cars stop this far behind the car in front, or before a closed stretch of road. */
const GAP = 9;
const BRAKE = 1.4;

const CAR_COLOURS = [0xb8bcc2, 0x2a2c30, 0x8a1e1e, 0x1e3a6a, 0xe8e6e0, 0x4a5a3a, 0x6a6e74, 0xc8a038, 0x3a2a4a];

/**
 * Cars driving round road loops at night. Each loop keeps its cars in order and spaced; a closed
 * stretch of road (an accident) stops the traffic behind it until it reopens.
 */
export class Traffic {
  readonly loops: TrafficLoop[] = [];
  readonly cars: Car[] = [];
  /** Closed stretches: cars queue before reaching any point within `radius`. */
  readonly closures: { x: number; z: number; radius: number; active: boolean }[] = [];
  /** Per loop and closure, the distances round the loop where the closure begins. */
  private stops: number[][][] = [];

  constructor(roads: [number, number][][], motorways: [number, number][][], seed = 1, spacing = 60) {
    const rng = createRng(seed);
    const add = (points: [number, number][], lane: number, speed: number, gap: number) => {
      const cum = [0];
      for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
      const length = cum[cum.length - 1];
      if (length < 30) return;
      const index = this.loops.length;
      this.loops.push({ points, cum, length, lane, speed });
      const n = Math.floor((length * 2) / gap);
      for (let i = 0; i < n; i++) {
        if (rng() < 0.3) continue;
        this.cars.push({ loop: index, s: ((i + rng() * 0.4) * length * 2) / n, v: speed, colour: CAR_COLOURS[Math.floor(rng() * CAR_COLOURS.length)] });
      }
    };
    for (const r of roads) add(r, 2.3, 11 + rng() * 3, spacing);
    for (const m of motorways) {
      add(m, 3, 26, spacing * 0.7);
      add(m, 8, 31, spacing * 0.9);
    }
  }

  /** Adds a closure, initially open. Returns its index. */
  addClosure(x: number, z: number, radius: number): number {
    this.closures.push({ x, z, radius, active: false });
    this.stops = [];
    return this.closures.length - 1;
  }

  /** Position and heading of a point `s` round a loop. */
  poseAt(loop: TrafficLoop, s: number, out: CarPose = { x: 0, z: 0, heading: 0 }): CarPose {
    const L = loop.length;
    const back = s >= L;
    const d = back ? 2 * L - s : s;
    let i = 1;
    while (i < loop.cum.length - 1 && loop.cum[i] < d) i++;
    const [ax, az] = loop.points[i - 1];
    const [bx, bz] = loop.points[i];
    const seg = loop.cum[i] - loop.cum[i - 1] || 1;
    const t = (d - loop.cum[i - 1]) / seg;
    let dx = (bx - ax) / seg;
    let dz = (bz - az) / seg;
    if (back) {
      dx = -dx;
      dz = -dz;
    }
    // Keep left: the left of travel direction (dx, dz) with y up is (dz, -dx).
    out.x = ax + (bx - ax) * t + dz * loop.lane;
    out.z = az + (bz - az) * t - dx * loop.lane;
    out.heading = Math.atan2(dx, dz);
    return out;
  }

  pose(car: Car, out?: CarPose): CarPose {
    return this.poseAt(this.loops[car.loop], car.s, out);
  }

  /** Where round each loop each closure starts, found by walking the loop. */
  private closureStops(): number[][][] {
    if (this.stops.length) return this.stops;
    const p: CarPose = { x: 0, z: 0, heading: 0 };
    this.stops = this.loops.map((loop) =>
      this.closures.map((c) => {
        const out: number[] = [];
        let inside = false;
        for (let s = 0; s < loop.length * 2; s += 2) {
          this.poseAt(loop, s, p);
          const now = Math.hypot(p.x - c.x, p.z - c.z) < c.radius;
          if (now && !inside) out.push(s);
          inside = now;
        }
        return out;
      }),
    );
    return this.stops;
  }

  update(dt: number): void {
    const stops = this.closureStops();
    const byLoop: Car[][] = this.loops.map(() => []);
    for (const c of this.cars) byLoop[c.loop].push(c);
    byLoop.forEach((cars, li) => {
      const loop = this.loops[li];
      const total = loop.length * 2;
      cars.sort((a, b) => a.s - b.s);
      const closed: number[] = [];
      this.closures.forEach((c, ci) => {
        if (c.active) closed.push(...stops[li][ci]);
      });
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        let gap = Infinity;
        if (cars.length > 1) {
          const ahead = cars[(i + 1) % cars.length];
          gap = (ahead.s - car.s + total) % total;
        }
        for (const s of closed) gap = Math.min(gap, (s - car.s + total) % total);
        const target = Math.max(0, Math.min(loop.speed, (gap - GAP) * BRAKE));
        car.v = target < car.v ? target : car.v + Math.min(target - car.v, 4 * dt);
      }
      for (const car of cars) car.s = (car.s + car.v * dt) % total;
    });
  }
}
