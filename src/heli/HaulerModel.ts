import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, Object3D } from 'three';
import { merge, part, propMaterial, rod } from '../render/geom';
import { createRotor, HeliVisualParts } from './rotor';

const WHITE = 0xeeeae0;
const ORANGE = 0xe0662a;
const GREY = 0x5a5f66;
const DARK = 0x26282c;

/** Tandem-rotor heavy lifter: long boxy fuselage, two pylons, four wheels. Nose points +z. */
export const createHaulerModel = (): HeliVisualParts => {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const p: BufferGeometry[] = [];

  // Fuselage, belly and livery stripe.
  p.push(part(new BoxGeometry(3.4, 2.6, 15), WHITE, { y: 3.0, z: 0 }));
  p.push(part(new BoxGeometry(3.2, 0.9, 15), GREY, { y: 1.25, z: 0 }));
  p.push(part(new BoxGeometry(3.42, 0.45, 15.02), ORANGE, { y: 2.2, z: 0 }));
  // Cockpit with sloping windscreen.
  p.push(part(new BoxGeometry(3.2, 2.6, 2.2), WHITE, { y: 2.7, z: 8.6 }));
  p.push(part(new BoxGeometry(3.0, 1.1, 0.12), DARK, { y: 3.3, z: 9.6, rx: -0.45 }));
  p.push(part(new BoxGeometry(2.6, 0.6, 0.12), DARK, { y: 1.9, z: 9.72, rx: 0.4 }));
  for (const side of [-1, 1]) {
    p.push(part(new BoxGeometry(0.1, 0.9, 1.4), DARK, { x: side * 1.62, y: 3.3, z: 8.7 }));
    // Cabin windows.
    for (let z = -5; z <= 5; z += 2.2) p.push(part(new BoxGeometry(0.1, 0.55, 0.55), DARK, { x: side * 1.72, y: 3.3, z }));
    // Fuel pods along the lower sides.
    p.push(part(new BoxGeometry(0.8, 1.5, 9), WHITE, { x: side * 2.05, y: 1.75, z: -0.6 }));
    p.push(part(new BoxGeometry(0.82, 0.3, 9.02), ORANGE, { x: side * 2.05, y: 2.2, z: -0.6 }));
    // Wheels: front pair under the cockpit, rear pair under the pods.
    for (const [z, x] of [
      [5.4, 1.2],
      [-4.4, 2.1],
    ]) {
      p.push(part(new CylinderGeometry(0.5, 0.5, 0.4, 10), DARK, { x: side * x, y: 0.5, z, rz: Math.PI / 2 }));
      p.push(rod([side * x, 0.5, z], [side * x * 0.8, 1.2, z], 0.08, GREY));
    }
    // Engines either side of the aft pylon.
    p.push(part(new CylinderGeometry(0.55, 0.6, 3.4, 12), GREY, { x: side * 1.5, y: 5.0, z: -5.4, rx: Math.PI / 2 }));
    p.push(part(new CylinderGeometry(0.4, 0.4, 0.3, 10), DARK, { x: side * 1.5, y: 5.0, z: -7.15, rx: Math.PI / 2 }));
  }
  // Front pylon hump and tall aft pylon.
  p.push(part(new BoxGeometry(1.8, 1.2, 3.4), WHITE, { y: 4.85, z: 6.2 }));
  p.push(part(new BoxGeometry(1.9, 2.6, 4.2), WHITE, { y: 5.4, z: -6.3 }));
  p.push(part(new BoxGeometry(1.92, 0.4, 4.22), ORANGE, { y: 6.3, z: -6.3 }));
  p.push(part(new CylinderGeometry(0.22, 0.28, 0.6, 8), GREY, { y: 5.75, z: 6.2 }));
  p.push(part(new CylinderGeometry(0.22, 0.28, 0.6, 8), GREY, { y: 6.95, z: -6.3 }));
  // Rear loading ramp.
  p.push(part(new BoxGeometry(3.0, 2.0, 0.12), DARK, { y: 2.4, z: -7.55 }));
  // Cargo hook under the belly.
  p.push(rod([0, 0.8, 0], [0, 0.35, 0], 0.07, DARK));
  p.push(part(new BoxGeometry(0.4, 0.25, 0.4), ORANGE, { y: 0.3 }));

  const hull = new Mesh(merge(p), propMaterial);
  hull.castShadow = true;
  body.add(hull);

  const front = createRotor({ blades: 3, radius: 7.6, chord: 0.6, colour: 0x2c2e33, discOpacity: 0.28 });
  front.group.position.set(0, 6.1, 6.2);
  body.add(front.group);
  const rear = createRotor({ blades: 3, radius: 7.6, chord: 0.6, colour: 0x2c2e33, discOpacity: 0.28 });
  rear.group.position.set(0, 7.3, -6.3);
  body.add(rear.group);

  const hook = new Object3D();
  hook.position.set(0, 0.3, 0);
  body.add(hook);

  // The rotors turn in opposite directions, cancelling torque instead of using a tail rotor.
  return { root, body, rotors: [{ rotor: front, speed: 0.75 }, { rotor: rear, speed: -0.75 }], hook };
};
