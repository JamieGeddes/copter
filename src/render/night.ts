import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SRGBColorSpace,
} from 'three';
import { CasualtyDef } from '../missions/types';
import { pointInSolid } from '../world/collision';
import { World } from '../world/World';
import { merge, part, propMaterial } from './geom';

let poolTexture: CanvasTexture | undefined;

/** Soft round light pool, bright in the middle and fading to nothing at the edge. */
export const getPoolTexture = (): CanvasTexture => {
  if (poolTexture) return poolTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  poolTexture = new CanvasTexture(canvas);
  poolTexture.colorSpace = SRGBColorSpace;
  return poolTexture;
};

/** Additive material for light falling on the ground. */
export const poolMaterial = (colour: number, opacity: number): MeshBasicMaterial =>
  new MeshBasicMaterial({
    map: getPoolTexture(),
    color: colour,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

/**
 * Glowing points of light sized in metres: lamps, warning lights, strobes. Each light can burn
 * steadily or flash with its own phase and pattern.
 */
export class Glows {
  readonly points: Points;
  private readonly material: ShaderMaterial;
  private readonly pos: number[] = [];
  private readonly size: number[] = [];
  private readonly colour: number[] = [];
  private readonly blink: number[] = [];
  private readonly c = new Color();

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 10 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec3 aColour;
        attribute vec2 aBlink;
        uniform float uScale;
        uniform float uTime;
        varying vec3 vColour;
        varying float vAlpha;
        void main() {
          vColour = aColour;
          // aBlink.x: 0 steady, 1 slow pulse (obstruction lights), 2 double flash (strobes),
          // 3 alternating flash (emergency vehicles), 4 flicker (fire).
          float a = 1.0;
          float t = uTime + aBlink.y;
          if (aBlink.x > 0.5 && aBlink.x < 1.5) a = 0.25 + 0.75 * smoothstep(0.2, 0.0, abs(fract(t * 0.6) - 0.2));
          else if (aBlink.x < 2.5 && aBlink.x > 1.5) { float f = fract(t * 0.8); a = step(f, 0.05) + step(0.14, f) * step(f, 0.19); }
          else if (aBlink.x < 3.5 && aBlink.x > 2.5) { float f = fract(t * 2.2); a = step(f, 0.18) + step(0.3, f) * step(f, 0.42); }
          else if (aBlink.x > 3.5) a = 0.55 + 0.45 * sin(t * 23.0) * sin(t * 7.3);
          vAlpha = a;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale * (0.6 + 0.4 * a);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColour;
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float core = smoothstep(0.35, 0.0, r);
          float halo = smoothstep(1.0, 0.0, r);
          float a = (core + halo * halo * 0.6) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColour * a + core * vAlpha * 0.35, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(new BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** `blink`: 0 steady, 1 slow pulse, 2 double flash, 3 alternating, 4 flicker. */
  add(x: number, y: number, z: number, size: number, colour: number, blink = 0, phase = 0): void {
    this.pos.push(x, y, z);
    this.size.push(size);
    this.c.setHex(colour);
    this.colour.push(this.c.r, this.c.g, this.c.b);
    this.blink.push(blink, phase);
  }

  get count(): number {
    return this.size.length;
  }

  /** Uploads the lights added so far. */
  build(): this {
    const g = this.points.geometry;
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new Float32BufferAttribute(this.size, 1));
    g.setAttribute('aColour', new Float32BufferAttribute(this.colour, 3));
    g.setAttribute('aBlink', new Float32BufferAttribute(this.blink, 2));
    return this;
  }

  /** Moves light `i` (for lights on moving things). */
  move(i: number, x: number, y: number, z: number): void {
    const p = this.points.geometry.getAttribute('position');
    p.setXYZ(i, x, y, z);
    p.needsUpdate = true;
  }

  update(time: number, pixelsPerMetre: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uScale.value = pixelsPerMetre;
  }
}

const SODIUM = 0xffb25a;
const WARNING_RED = 0xff2a1a;
const LAMP_HEIGHT = 8;

/** Street lamps along roads and motorways, kept out of buildings, water and dark sites. */
export const lampPositions = (world: World, dark: { x: number; z: number; radius: number }[]): { x: number; z: number; ax: number; az: number }[] => {
  const out: { x: number; z: number; ax: number; az: number }[] = [];
  const ok = (x: number, z: number) =>
    !world.isWater(x, z) &&
    !world.solids.some((s) => !s.landable && pointInSolid(x, z, s)) &&
    !dark.some((d) => Math.hypot(x - d.x, z - d.z) < d.radius) &&
    !out.some((q) => Math.abs(q.x - x) < 9 && Math.abs(q.z - z) < 9);
  for (const road of world.level.roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i];
      const [bx, bz] = road[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      let side = 1;
      for (let s = 12; s < len - 6; s += 30) {
        // Alternate sides; the arm reaches back over the road.
        const nx = -dz * side;
        const nz = dx * side;
        const x = ax + dx * s + nx * 6.8;
        const z = az + dz * s + nz * 6.8;
        if (ok(x, z)) out.push({ x, z, ax: -nx, az: -nz });
        side = -side;
      }
    }
  }
  for (const road of world.level.motorways ?? []) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i];
      const [bx, bz] = road[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      for (let s = 10; s < len - 10; s += 40) {
        const x = ax + dx * s;
        const z = az + dz * s;
        if (!ok(x, z)) continue;
        out.push({ x, z, ax: -dz, az: dx });
        out.push({ x, z, ax: dz, az: -dx });
      }
    }
  }
  return out;
};

export interface NightLights {
  group: Group;
  update(time: number, pixelsPerMetre: number): void;
}

/**
 * City lights: sodium street lamps with pools of light on the road, floodlights over the stadium,
 * lit hospital pads with edge lights, and red obstruction lights on cranes, masts, pylons and
 * the tallest towers.
 */
export const createNightLights = (world: World, casualties: readonly CasualtyDef[]): NightLights => {
  const group = new Group();
  const glows = new Glows();
  const dark = casualties.filter((c) => c.dark).map((c) => ({ x: c.x, z: c.z, radius: 80 }));

  // Street lamps: poles, glowing heads and pools of orange light.
  const lamps = lampPositions(world, dark);
  if (lamps.length) {
    const pole = merge([
      part(new CylinderGeometry(0.12, 0.16, LAMP_HEIGHT, 6), 0x3a3d42, { y: LAMP_HEIGHT / 2 }),
      part(new BoxGeometry(0.12, 0.12, 2.2), 0x3a3d42, { y: LAMP_HEIGHT, z: 1.1 }),
      part(new BoxGeometry(0.5, 0.18, 0.9), 0x2a2c30, { y: LAMP_HEIGHT - 0.1, z: 2.1 }),
    ]);
    const poles = new InstancedMesh(pole, propMaterial, lamps.length);
    const pools = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMaterial(SODIUM, 0.42), lamps.length);
    const dummy = new Object3D();
    lamps.forEach((l, i) => {
      const y = world.groundHeightAt(l.x, l.z);
      dummy.position.set(l.x, y, l.z);
      dummy.rotation.set(0, Math.atan2(l.ax, l.az), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      const hx = l.x + l.ax * 2.1;
      const hz = l.z + l.az * 2.1;
      glows.add(hx, y + LAMP_HEIGHT - 0.3, hz, 2.6, SODIUM);
      dummy.position.set(hx, world.groundHeightAt(hx, hz) + 0.3, hz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(22, 1, 22);
      dummy.updateMatrix();
      pools.setMatrixAt(i, dummy.matrix);
    });
    poles.castShadow = false;
    pools.renderOrder = 1;
    group.add(poles, pools);
  }

  for (const b of world.buildings) {
    const top = b.base + b.h;
    switch (b.kind) {
      case 'floodlight':
        glows.add(b.x, top + 1.5, b.z, 9, 0xf4f6ff);
        break;
      case 'crane':
      case 'mast':
      case 'powerPylon':
        glows.add(b.x, top + (b.kind === 'crane' ? 3.2 : b.kind === 'powerPylon' ? 3 : 0.3), b.z, 2.4, WARNING_RED, 1, b.x * 0.01);
        break;
      case 'tower':
        if (b.h > 45) glows.add(b.x, top + 1.5, b.z, 2.2, WARNING_RED, 1, b.z * 0.01);
        break;
    }
  }
  // The far end of each crane jib.
  for (const c of world.cables) if (c.kind === 'jib') glows.add(c.bx, c.by + 0.4, c.bz, 2, WARNING_RED, 1, 0.4);

  // Floodlit pitch.
  const stands = world.buildings.filter((b) => b.kind === 'stand');
  if (stands.length) {
    const cx = stands.reduce((a, b) => a + b.x, 0) / stands.length;
    const cz = stands.reduce((a, b) => a + b.z, 0) / stands.length;
    const pitch = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMaterial(0xe8f4ff, 0.5));
    pitch.position.set(cx, world.groundHeightAt(cx, cz) + 0.3, cz);
    pitch.scale.set(190, 1, 150);
    group.add(pitch);
    const grass = new Mesh(new PlaneGeometry(104, 66).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x2f6a34, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    grass.position.set(cx, world.groundHeightAt(cx, cz) + 0.18, cz);
    group.add(grass);
  }

  // Pads: edge lights round the rim and a wash of light over the surface.
  for (const p of world.pads) {
    const half = p.size / 2 + 0.4;
    const colour = p.service ? 0xffd25a : 0x6aff8a;
    for (let t = -half; t <= half + 0.01; t += p.size / 6) {
      for (const [x, z] of [[p.x + t, p.z - half], [p.x + t, p.z + half], [p.x - half, p.z + t], [p.x + half, p.z + t]]) {
        glows.add(x, p.top + 0.25, z, 1.1, colour);
      }
    }
    const wash = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMaterial(0xfff4e0, 0.32));
    wash.position.set(p.x, p.top + 0.08, p.z);
    wash.scale.set(p.size * 1.8, 1, p.size * 1.8);
    group.add(wash);
  }

  group.add(glows.build().points);
  return { group, update: (time, ppm) => glows.update(time, ppm) };
};
