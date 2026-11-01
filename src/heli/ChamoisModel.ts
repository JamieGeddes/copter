import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshPhongMaterial, Object3D, SphereGeometry } from 'three';
import { merge, part, propMaterial, rod } from '../render/geom';
import { createRotor, HeliVisualParts } from './rotor';

const RED = 0xd22a22;
const WHITE = 0xf4f2ec;
const GREY = 0x4a4e54;
const DARK = 0x26282c;
const METAL = 0x8a8f96;

/**
 * Light mountain rescue helicopter: a big glazed bubble cabin over a compact fuselage, an open
 * lattice tail boom, skids, a three-blade rotor and a rescue winch on the right. Red and white
 * livery. Nose points +z.
 */
export const createChamoisModel = (): HeliVisualParts => {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const p: BufferGeometry[] = [];

  // Skids on curved cross tubes.
  for (const side of [-1, 1]) {
    p.push(part(new CylinderGeometry(0.08, 0.08, 4.6, 8), METAL, { x: side * 1.25, y: 0.1, z: 0.3, rx: Math.PI / 2 }));
    p.push(part(new CylinderGeometry(0.08, 0.08, 0.6, 8), METAL, { x: side * 1.25, y: 0.28, z: 2.75, rx: Math.PI / 2 + 0.7 }));
    for (const z of [-0.8, 1.3]) p.push(rod([side * 1.25, 0.12, z], [side * 0.8, 1.0, z], 0.07, METAL));
  }

  // Cabin floor and belly in red, white engine deck behind the bubble.
  p.push(part(new BoxGeometry(1.9, 0.6, 3.4), RED, { y: 1.15, z: 0.4 }));
  p.push(part(new BoxGeometry(1.7, 1.4, 1.8), WHITE, { y: 2.1, z: -1.4 }));
  p.push(part(new BoxGeometry(1.72, 0.25, 1.82), RED, { y: 1.6, z: -1.4 }));
  // Engine, exhaust and mast.
  p.push(part(new BoxGeometry(1.2, 0.8, 1.8), GREY, { y: 3.1, z: -1.5 }));
  p.push(part(new CylinderGeometry(0.22, 0.26, 0.6, 8), DARK, { y: 3.2, z: -2.6, rx: Math.PI / 2 }));
  p.push(part(new CylinderGeometry(0.14, 0.18, 0.9, 8), METAL, { y: 3.4, z: -0.6 }));
  // Cabin frame posts.
  for (const side of [-1, 1]) {
    p.push(rod([side * 0.85, 1.4, 1.9], [side * 0.6, 3.0, 0.0], 0.05, WHITE));
    p.push(rod([side * 0.88, 1.4, -0.4], [side * 0.7, 3.0, -0.4], 0.05, WHITE));
  }

  // Open lattice tail boom: four longerons with cross bracing.
  const boom0 = -2.2;
  const boom1 = -7.4;
  const corners: [number, number][] = [[-0.3, 1.9], [0.3, 1.9], [-0.18, 2.5], [0.18, 2.5]];
  for (const [cx, cy] of corners) {
    p.push(rod([cx * 1.6, cy, boom0], [cx * 0.5, cy + (cy > 2 ? -0.15 : 0.35), boom1], 0.045, WHITE));
  }
  for (let i = 0; i < 6; i++) {
    const t0 = i / 6;
    const t1 = (i + 1) / 6;
    const z0 = boom0 + (boom1 - boom0) * t0;
    const z1 = boom0 + (boom1 - boom0) * t1;
    const w0 = 0.48 - 0.3 * t0;
    const w1 = 0.48 - 0.3 * t1;
    p.push(rod([-w0, 1.9 + 0.35 * t0, z0], [w1, 1.9 + 0.35 * t1, z1], 0.03, RED));
    p.push(rod([w0, 1.9 + 0.35 * t0, z0], [-w1, 1.9 + 0.35 * t1, z1], 0.03, RED));
  }
  // Tail fin, stabiliser and tail rotor gearbox.
  p.push(part(new BoxGeometry(0.08, 1.3, 0.9), RED, { y: 2.7, z: -7.7, rx: -0.3 }));
  p.push(part(new BoxGeometry(1.5, 0.06, 0.45), WHITE, { y: 2.3, z: -6.9 }));
  p.push(part(new CylinderGeometry(0.1, 0.1, 0.3, 8), GREY, { x: 0.1, y: 2.4, z: -7.8, rz: Math.PI / 2 }));

  // Rescue winch boom over the right-hand door.
  p.push(rod([-0.95, 3.0, 0.6], [-1.6, 3.0, 0.6], 0.07, GREY));
  p.push(part(new BoxGeometry(0.35, 0.3, 0.4), DARK, { x: -1.65, y: 2.95, z: 0.6 }));
  // Orange search light under the nose.
  p.push(part(new SphereGeometry(0.16, 8, 6), 0xffc04a, { y: 0.9, z: 1.9 }));

  const hull = new Mesh(merge(p), propMaterial);
  hull.castShadow = true;
  body.add(hull);

  // The big bubble canopy.
  const glass = new Mesh(
    new SphereGeometry(1.2, 18, 12),
    new MeshPhongMaterial({ color: 0x9fd0ea, transparent: true, opacity: 0.42, shininess: 100, specular: 0xffffff, depthWrite: false }),
  );
  glass.scale.set(0.85, 0.95, 1.25);
  glass.position.set(0, 2.2, 0.75);
  body.add(glass);
  // Seats and crew visible through it.
  const crew = new Mesh(
    merge([
      part(new BoxGeometry(0.5, 0.6, 0.5), 0x2a3a5a, { x: 0.35, y: 1.75, z: 1.0 }),
      part(new BoxGeometry(0.5, 0.6, 0.5), 0x2a3a5a, { x: -0.35, y: 1.75, z: 1.0 }),
      part(new SphereGeometry(0.17, 8, 6), 0xf4f2ec, { x: 0.35, y: 2.25, z: 1.0 }),
      part(new SphereGeometry(0.17, 8, 6), 0xd22a22, { x: -0.35, y: 2.25, z: 1.0 }),
    ]),
    propMaterial,
  );
  body.add(crew);

  const main = createRotor({ blades: 3, radius: 5.6, chord: 0.38, colour: 0x2c2e33, discOpacity: 0.26 });
  main.group.position.set(0, 3.75, -0.6);
  body.add(main.group);

  const tail = createRotor({ blades: 3, radius: 0.85, chord: 0.14, colour: 0xf4f2ec, discOpacity: 0.4 });
  tail.group.rotation.z = Math.PI / 2;
  tail.group.position.set(0.2, 2.4, -7.85);
  body.add(tail.group);

  const winch = new Object3D();
  winch.position.set(-1.65, 2.8, 0.6);
  body.add(winch);

  return { root, body, rotors: [{ rotor: main, speed: 1.1 }, { rotor: tail, speed: 4.8 }], winch };
};
