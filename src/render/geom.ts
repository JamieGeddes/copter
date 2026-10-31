import { BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface PartTransform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const tmpColour = new Color();
const matrix = new Matrix4();
const quat = new Quaternion();
const euler = new Euler();
const pos = new Vector3();
const scale = new Vector3();

/**
 * Converts a geometry to non-indexed form with a uniform vertex colour and the given
 * transform, ready to be merged with other parts into a single mesh.
 */
export const part = (geometry: BufferGeometry, colour: number | Color, t: PartTransform = {}): BufferGeometry => {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  euler.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  quat.setFromEuler(euler);
  pos.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  g.applyMatrix4(matrix.compose(pos, quat, scale));
  const c = colour instanceof Color ? colour : tmpColour.setHex(colour);
  const n = g.getAttribute('position').count;
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return g;
};

/** Merges painted parts into one geometry. */
export const merge = (parts: BufferGeometry[]): BufferGeometry => {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Failed to merge geometry parts');
  for (const p of parts) p.dispose();
  return merged;
};

/** Shared flat-shaded, vertex-coloured material used by most props. */
export const propMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Smooth-shaded variant for rounded shapes. */
export const smoothPropMaterial = new MeshLambertMaterial({ vertexColors: true });

/** Multiplies a hex colour's brightness; handy for shading variants. */
export const shade = (hex: number, factor: number): Color => new Color(hex).multiplyScalar(factor);

const UP = new Vector3(0, 1, 0);
const dir = new Vector3();

/** A cylinder running between two points. */
export const rod = (
  from: [number, number, number],
  to: [number, number, number],
  radius: number,
  colour: number | Color,
  segments = 5,
): BufferGeometry => {
  dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const length = dir.length();
  const g = part(new CylinderGeometry(radius, radius, length, segments), colour);
  quat.setFromUnitVectors(UP, dir.normalize());
  pos.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
  g.applyMatrix4(matrix.compose(pos, quat, scale.set(1, 1, 1)));
  return g;
};
