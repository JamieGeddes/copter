import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshPhongMaterial, Object3D, SphereGeometry } from 'three';
import { merge, part, propMaterial, rod } from '../render/geom';
import { createRotor, HeliVisualParts } from './rotor';

export const ALBATROSS_SCALE = 1.15;

const YELLOW = 0xf2c12e;
const GREY = 0x5a5f66;
const WHITE = 0xf1ede4;
const DARK = 0x26282c;
const RED = 0xc8392b;

/** Large twin-engine rescue helicopter with a boat hull, sponsons and a side winch. Nose points +z. */
export const createAlbatrossModel = (): HeliVisualParts => {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const p: BufferGeometry[] = [];

  // Fuselage and boat hull.
  p.push(part(new BoxGeometry(2.5, 2.5, 9.2), YELLOW, { y: 2.25, z: 2.2 }));
  p.push(part(new BoxGeometry(2.0, 0.7, 9.0), GREY, { y: 0.75, z: 2.2 }));
  p.push(part(new BoxGeometry(2.52, 0.18, 9.22), WHITE, { y: 1.55, z: 2.2 }));
  // Cockpit and nose.
  p.push(part(new BoxGeometry(2.3, 2.0, 1.8), YELLOW, { y: 2.0, z: 7.6 }));
  p.push(part(new SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), YELLOW, { y: 1.4, z: 8.4, rx: Math.PI / 2, sz: 0.8 }));
  p.push(part(new BoxGeometry(2.2, 0.9, 0.1), DARK, { y: 2.65, z: 8.35, rx: -0.55 }));
  for (const side of [-1, 1]) {
    p.push(part(new BoxGeometry(0.1, 0.8, 1.4), DARK, { x: side * 1.16, y: 2.55, z: 7.7 }));
    // Cabin windows.
    for (const z of [1.2, 3.0]) p.push(part(new BoxGeometry(0.1, 0.6, 0.7), DARK, { x: side * 1.27, y: 2.7, z }));
    // Sponsons with wheels.
    p.push(part(new BoxGeometry(0.9, 0.85, 2.4), YELLOW, { x: side * 1.65, y: 1.35, z: 1.4 }));
    p.push(part(new CylinderGeometry(0.42, 0.42, 0.35, 10), DARK, { x: side * 1.65, y: 0.42, z: 1.4, rz: Math.PI / 2 }));
    p.push(rod([side * 1.65, 0.45, 1.4], [side * 1.65, 1.0, 1.4], 0.08, GREY));
  }
  // Nose wheel.
  p.push(part(new CylinderGeometry(0.3, 0.3, 0.3, 8), DARK, { y: 0.3, z: 6.6, rz: Math.PI / 2 }));
  p.push(rod([0, 0.3, 6.6], [0, 0.9, 6.6], 0.07, GREY));
  // Side door (right side is -x) with winch arm above it.
  p.push(part(new BoxGeometry(0.1, 1.7, 1.5), DARK, { x: -1.27, y: 2.1, z: 4.6 }));
  p.push(part(new BoxGeometry(1.1, 0.25, 0.3), GREY, { x: -1.6, y: 3.45, z: 4.6 }));
  // Engine housing and exhausts.
  p.push(part(new BoxGeometry(1.7, 0.9, 4.6), YELLOW, { y: 3.9, z: 2.6 }));
  p.push(part(new BoxGeometry(1.2, 0.5, 1.6), GREY, { y: 4.5, z: 2.0 }));
  for (const side of [-1, 1]) {
    p.push(part(new CylinderGeometry(0.22, 0.25, 0.7, 8), DARK, { x: side * 0.7, y: 3.95, z: 0.1, rx: Math.PI / 2 }));
  }
  p.push(part(new CylinderGeometry(0.16, 0.2, 0.7, 8), GREY, { y: 4.95, z: 2.0 }));
  // Tail boom tapering up to the pylon.
  p.push(part(new BoxGeometry(1.8, 1.9, 3.0), YELLOW, { y: 2.6, z: -3.7 }));
  p.push(part(new BoxGeometry(1.2, 1.3, 3.0), YELLOW, { y: 2.9, z: -6.6 }));
  p.push(part(new BoxGeometry(0.8, 0.9, 2.2), YELLOW, { y: 3.1, z: -9.0 }));
  p.push(part(new BoxGeometry(0.5, 2.8, 1.4), YELLOW, { y: 4.4, z: -10.1, rx: -0.25 }));
  p.push(part(new BoxGeometry(0.52, 0.5, 1.42), RED, { y: 5.6, z: -10.4, rx: -0.25 }));
  p.push(part(new BoxGeometry(2.6, 0.12, 0.8), YELLOW, { x: -1.1, y: 3.4, z: -9.6 }));
  p.push(part(new BoxGeometry(2.54, 0.2, 9.0), RED, { y: 3.42, z: 2.2 }));

  const hull = new Mesh(merge(p), propMaterial);
  hull.castShadow = true;
  body.add(hull);

  const glass = new Mesh(
    new BoxGeometry(2.0, 0.7, 0.9),
    new MeshPhongMaterial({ color: 0x6fa0b8, transparent: true, opacity: 0.6, shininess: 90, specular: 0xffffff }),
  );
  glass.position.set(0, 2.85, 8.0);
  glass.rotation.x = -0.5;
  body.add(glass);

  const main = createRotor({ blades: 5, radius: 8.2, chord: 0.45, colour: 0x2c2e33, discOpacity: 0.3 });
  main.group.position.set(0, 5.35, 2.0);
  body.add(main.group);

  const tail = createRotor({ blades: 5, radius: 1.3, chord: 0.2, colour: 0xe8e2d4, discOpacity: 0.4 });
  tail.group.rotation.z = Math.PI / 2;
  tail.group.position.set(0.32, 5.0, -10.3);
  body.add(tail.group);

  const winch = new Object3D();
  winch.position.set(-2.1, 3.3, 4.6);
  body.add(winch);

  root.scale.setScalar(ALBATROSS_SCALE);
  return { root, body, rotors: [{ rotor: main, speed: 0.8 }, { rotor: tail, speed: 4 }], winch };
};
