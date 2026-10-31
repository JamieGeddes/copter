import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  SphereGeometry,
} from 'three';
import { merge, part, propMaterial, rod } from '../render/geom';
import { createRotor, HeliVisualParts } from './rotor';

/** Aircraft are drawn larger than life, as in classic isometric games. */
export const KESTREL_SCALE = 1.5;

const RED = 0xc8392b;
const CREAM = 0xf1e8d6;
const GREY = 0x4a4e54;
const DARK = 0x2c2e33;
const METAL = 0x8a8f96;

/** Light two-seat trainer with a bubble canopy and open lattice tail. Nose points +z. */
export const createKestrelModel = (): HeliVisualParts => {
  const root = new Group();
  const body = new Group();
  root.add(body);

  const parts: BufferGeometry[] = [];
  // Skids and cross tubes.
  for (const side of [-1, 1]) {
    parts.push(part(new CylinderGeometry(0.06, 0.06, 3.4, 6), METAL, { x: side * 1.0, y: 0.08, z: 0.1, rx: Math.PI / 2 }));
    parts.push(part(new CylinderGeometry(0.06, 0.06, 0.4, 6), METAL, { x: side * 1.0, y: 0.15, z: 1.85, rx: Math.PI / 2 + 0.6 }));
    for (const z of [-0.7, 0.8]) {
      parts.push(rod([side * 1.0, 0.1, z], [side * 0.6, 0.95, z], 0.05, METAL));
    }
  }
  parts.push(part(new CylinderGeometry(0.05, 0.05, 1.7, 5), METAL, { y: 0.95, z: -0.7, rz: Math.PI / 2 }));
  parts.push(part(new CylinderGeometry(0.05, 0.05, 1.7, 5), METAL, { y: 0.95, z: 0.8, rz: Math.PI / 2 }));

  // Cabin floor, seat, engine deck.
  parts.push(part(new BoxGeometry(1.7, 0.35, 2.0), RED, { y: 1.05, z: 0.35 }));
  parts.push(part(new BoxGeometry(1.72, 0.12, 2.02), CREAM, { y: 1.27, z: 0.35 }));
  parts.push(part(new BoxGeometry(1.3, 0.5, 0.5), DARK, { y: 1.5, z: -0.1 }));
  parts.push(part(new BoxGeometry(1.1, 0.95, 1.3), GREY, { y: 1.65, z: -1.0 }));
  // Saddle fuel tanks.
  for (const side of [-1, 1]) {
    parts.push(part(new CylinderGeometry(0.28, 0.28, 1.1, 10), RED, { x: side * 0.72, y: 2.05, z: -0.95, rx: Math.PI / 2 }));
  }
  // Mast.
  parts.push(part(new CylinderGeometry(0.1, 0.13, 0.8, 8), METAL, { y: 2.45, z: -0.45 }));

  // Open lattice tail boom: three tapering longerons with cross bracing.
  const tailStart = -1.5;
  const tailEnd = -5.9;
  const boom = (z: number, corner: 0 | 1 | 2): [number, number, number] => {
    const t = (tailStart - z) / (tailStart - tailEnd);
    const spread = 1 - t * 0.6;
    const cy = 1.75;
    const corners: [number, number][] = [
      [0, 0.22],
      [-0.24, -0.18],
      [0.24, -0.18],
    ];
    const [cx, oy] = corners[corner];
    return [cx * spread, cy + oy * spread, z];
  };
  for (const c of [0, 1, 2] as const) parts.push(rod(boom(tailStart, c), boom(tailEnd, c), 0.035, RED, 4));
  const bays = 7;
  for (let i = 0; i < bays; i++) {
    const z0 = tailStart - ((tailStart - tailEnd) * i) / bays;
    const z1 = tailStart - ((tailStart - tailEnd) * (i + 1)) / bays;
    parts.push(rod(boom(z0, 1), boom(z0, 2), 0.022, RED, 3));
    parts.push(rod(boom(z0, i % 2 ? 1 : 2), boom(z1, 0), 0.022, RED, 3));
  }
  // Tail fin and stabiliser.
  parts.push(part(new BoxGeometry(0.06, 0.9, 0.6), RED, { y: 1.95, z: tailEnd + 0.1, rx: -0.3 }));
  parts.push(part(new BoxGeometry(0.06, 0.45, 0.45), CREAM, { y: 1.45, z: tailEnd + 0.15, rx: 0.4 }));
  parts.push(part(new BoxGeometry(1.1, 0.05, 0.35), RED, { y: 1.72, z: tailEnd + 0.9 }));
  // Tail rotor gearbox.
  parts.push(part(new CylinderGeometry(0.09, 0.09, 0.3, 6), GREY, { x: 0.12, y: 1.8, z: tailEnd + 0.05, rz: Math.PI / 2 }));

  const solid = new Mesh(merge(parts), propMaterial);
  solid.castShadow = true;
  body.add(solid);

  // Bubble canopy.
  const glass = new Mesh(
    new SphereGeometry(0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new MeshPhongMaterial({ color: 0x9fd0ea, transparent: true, opacity: 0.45, shininess: 90, specular: 0xffffff, depthWrite: false }),
  );
  glass.scale.set(0.92, 1.05, 1.12);
  glass.position.set(0, 1.3, 0.55);
  body.add(glass);
  const pilot = new Mesh(new SphereGeometry(0.17, 8, 6), new MeshLambertMaterial({ color: 0xf1e8d6 }));
  pilot.position.set(0.3, 1.95, 0.25);
  body.add(pilot);

  const main = createRotor({ blades: 2, radius: 4.45, chord: 0.26, colour: 0x3a3c40, discOpacity: 0.32 });
  main.group.position.set(0, 2.85, -0.45);
  body.add(main.group);

  const tail = createRotor({ blades: 2, radius: 0.72, chord: 0.12, colour: 0xf1e8d6, discOpacity: 0.4 });
  tail.group.rotation.z = Math.PI / 2;
  tail.group.position.set(0.26, 1.8, tailEnd + 0.05);
  body.add(tail.group);

  root.scale.setScalar(KESTREL_SCALE);
  return { root, body, rotors: [{ rotor: main, speed: 1 }, { rotor: tail, speed: 4.2 }] };
};
