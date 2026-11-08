import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshPhongMaterial, Object3D, SphereGeometry } from 'three';
import { merge, part, propMaterial, rod } from '../render/geom';
import { createRotor, HeliVisualParts } from './rotor';

const ORANGE = 0xe0662a;
const GREY = 0x5e646c;
const LIGHT = 0xd8d6d0;
const DARK = 0x26282c;
const METAL = 0x8a8f96;

/** Height of the spine above the wheels: long legs leave room for bulky loads beneath. */
const SPINE_Y = 4.4;

/**
 * Flying crane: a slim spine with nothing behind the cockpit but open air, long splayed legs, a
 * six-blade rotor, and a glazed station at the back of the cockpit where a second pilot faces aft
 * to watch the load. Orange and grey. Nose points +z.
 */
export const createMantisModel = (): HeliVisualParts => {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const p: BufferGeometry[] = [];

  // Spine: a slim beam from the cockpit back to the tail, with the gearbox and engines on top.
  p.push(part(new BoxGeometry(1.3, 1.5, 9), GREY, { y: SPINE_Y + 0.75, z: 0.3 }));
  p.push(part(new BoxGeometry(1.32, 0.35, 9.02), ORANGE, { y: SPINE_Y + 0.2, z: 0.3 }));
  p.push(part(new BoxGeometry(1.6, 1.1, 3.2), LIGHT, { y: SPINE_Y + 2, z: 0.5 }));
  for (const side of [-1, 1]) {
    p.push(part(new CylinderGeometry(0.5, 0.55, 3.6, 12), LIGHT, { x: side * 1.15, y: SPINE_Y + 1.9, z: 1.8, rx: Math.PI / 2 }));
    p.push(part(new CylinderGeometry(0.36, 0.36, 0.3, 10), DARK, { x: side * 1.15, y: SPINE_Y + 1.9, z: -0.05, rx: Math.PI / 2 }));
    p.push(part(new BoxGeometry(0.5, 0.2, 3.4), ORANGE, { x: side * 1.15, y: SPINE_Y + 2.35, z: 1.8 }));
  }
  p.push(part(new CylinderGeometry(0.22, 0.3, 0.8, 8), METAL, { y: SPINE_Y + 2.9, z: 0.5 }));

  // Cockpit: a narrow glazed nose hanging below the front of the spine.
  p.push(part(new BoxGeometry(2.2, 2.3, 2.6), ORANGE, { y: SPINE_Y - 0.2, z: 5.6 }));
  p.push(part(new BoxGeometry(2.0, 1.2, 0.12), DARK, { y: SPINE_Y + 0.3, z: 6.95, rx: -0.4 }));
  p.push(part(new BoxGeometry(1.7, 0.7, 0.12), DARK, { y: SPINE_Y - 0.9, z: 6.85, rx: 0.35 }));
  for (const side of [-1, 1]) p.push(part(new BoxGeometry(0.1, 1.0, 1.6), DARK, { x: side * 1.11, y: SPINE_Y + 0.1, z: 5.8 }));
  // The aft-facing station: a glazed bay under the back of the cockpit looking down at the load.
  p.push(part(new BoxGeometry(1.8, 1.4, 1.2), ORANGE, { y: SPINE_Y - 1.5, z: 4.2 }));
  p.push(part(new BoxGeometry(1.6, 1.1, 0.12), DARK, { y: SPINE_Y - 1.5, z: 3.58, rx: 0.3 }));
  p.push(part(new BoxGeometry(1.4, 0.12, 0.9), DARK, { y: SPINE_Y - 2.21, z: 4.2 }));

  // Tail boom tapering to a tall fin, with a stabiliser and the tail rotor on the left.
  p.push(part(new BoxGeometry(0.9, 1.0, 6.4), GREY, { y: SPINE_Y + 0.9, z: -7.2, rx: -0.06 }));
  p.push(part(new BoxGeometry(0.12, 3.0, 1.6), ORANGE, { y: SPINE_Y + 2.4, z: -10.4, rx: -0.25 }));
  p.push(part(new BoxGeometry(3.2, 0.1, 0.8), GREY, { y: SPINE_Y + 1.3, z: -9.6 }));
  p.push(part(new CylinderGeometry(0.14, 0.14, 0.4, 8), DARK, { x: 0.25, y: SPINE_Y + 3.0, z: -10.6, rz: Math.PI / 2 }));

  // Long splayed legs: main pair either side of the hook, a narrower pair under the cockpit.
  for (const side of [-1, 1]) {
    for (const [z, x] of [
      [-1.6, 3.1],
      [4.6, 1.9],
    ]) {
      p.push(rod([side * 0.6, SPINE_Y + 0.2, z + 0.4], [side * x, 0.6, z], 0.13, GREY));
      p.push(rod([side * 0.6, SPINE_Y + 0.2, z - 0.8], [side * x, 0.6, z], 0.08, METAL));
      p.push(part(new CylinderGeometry(0.55, 0.55, 0.45, 12), DARK, { x: side * x, y: 0.55, z, rz: Math.PI / 2 }));
    }
  }

  // Hoist and hook under the spine, over the centre of lift.
  p.push(part(new BoxGeometry(0.9, 0.5, 0.9), DARK, { y: SPINE_Y - 0.25, z: 0.5 }));
  p.push(rod([0, SPINE_Y - 0.5, 0.5], [0, 2.6, 0.5], 0.07, DARK));
  p.push(part(new BoxGeometry(0.45, 0.3, 0.45), ORANGE, { y: 2.45, z: 0.5 }));

  const hull = new Mesh(merge(p), propMaterial);
  hull.castShadow = true;
  body.add(hull);

  // Crew through the glazing: one facing forward, one facing the load.
  const glass = new Mesh(
    new SphereGeometry(0.9, 14, 10),
    new MeshPhongMaterial({ color: 0x9fd0ea, transparent: true, opacity: 0.4, shininess: 100, specular: 0xffffff, depthWrite: false }),
  );
  glass.scale.set(1.1, 0.8, 0.9);
  glass.position.set(0, SPINE_Y + 0.5, 6.4);
  body.add(glass);
  const crew = new Mesh(
    merge([
      part(new SphereGeometry(0.18, 8, 6), 0xf4f2ec, { x: 0.4, y: SPINE_Y + 0.4, z: 6.0 }),
      part(new SphereGeometry(0.18, 8, 6), 0xf4f2ec, { y: SPINE_Y - 1.3, z: 4.4 }),
    ]),
    propMaterial,
  );
  body.add(crew);

  const main = createRotor({ blades: 6, radius: 11, chord: 0.6, colour: 0x2c2e33, discOpacity: 0.26 });
  main.group.position.set(0, SPINE_Y + 3.3, 0.5);
  body.add(main.group);

  const tail = createRotor({ blades: 4, radius: 1.9, chord: 0.24, colour: 0x2c2e33, discOpacity: 0.35 });
  tail.group.rotation.z = Math.PI / 2;
  tail.group.position.set(0.45, SPINE_Y + 3.0, -10.6);
  body.add(tail.group);

  const hook = new Object3D();
  hook.position.set(0, 2.4, 0.5);
  body.add(hook);

  return { root, body, rotors: [{ rotor: main, speed: 0.8 }, { rotor: tail, speed: 4 }], hook };
};
