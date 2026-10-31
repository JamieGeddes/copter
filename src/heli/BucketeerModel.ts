import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshPhongMaterial, Object3D, SphereGeometry } from 'three';
import { merge, part, propMaterial, rod } from '../render/geom';
import { createRotor, HeliVisualParts } from './rotor';

const RED = 0xc8281f;
const WHITE = 0xf2f0ea;
const GREY = 0x4a4e54;
const DARK = 0x26282c;
const METAL = 0x8a8f96;

/**
 * Fire service medium helicopter: single two-blade main rotor, slim tail boom, skids, red and
 * white livery. Nose points +z.
 */
export const createBucketeerModel = (): HeliVisualParts => {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const p: BufferGeometry[] = [];

  // Skids on cross tubes.
  for (const side of [-1, 1]) {
    p.push(part(new CylinderGeometry(0.08, 0.08, 5.2, 8), METAL, { x: side * 1.45, y: 0.1, z: 0.3, rx: Math.PI / 2 }));
    p.push(part(new CylinderGeometry(0.08, 0.08, 0.7, 8), METAL, { x: side * 1.45, y: 0.3, z: 2.95, rx: Math.PI / 2 + 0.7 }));
    for (const z of [-0.9, 1.5]) p.push(rod([side * 1.45, 0.12, z], [side * 1.0, 1.15, z], 0.07, METAL));
  }

  // Cabin: red belly, white upper body, red stripe.
  p.push(part(new BoxGeometry(2.3, 0.8, 4.2), RED, { y: 1.25, z: -0.2 }));
  p.push(part(new BoxGeometry(2.3, 1.5, 4.2), WHITE, { y: 2.4, z: -0.2 }));
  p.push(part(new BoxGeometry(2.32, 0.28, 4.22), RED, { y: 2.05, z: -0.2 }));
  // Nose: tapering cockpit with wraparound windscreen.
  p.push(part(new BoxGeometry(2.1, 1.4, 1.6), WHITE, { y: 2.2, z: 2.6 }));
  p.push(part(new BoxGeometry(1.9, 0.7, 1.2), RED, { y: 1.35, z: 2.7 }));
  p.push(part(new BoxGeometry(1.9, 0.95, 0.12), DARK, { y: 2.55, z: 3.42, rx: -0.5 }));
  for (const side of [-1, 1]) {
    p.push(part(new BoxGeometry(0.1, 0.8, 1.2), DARK, { x: side * 1.07, y: 2.55, z: 2.7 }));
    // Sliding cabin door and window.
    p.push(part(new BoxGeometry(0.1, 0.9, 1.6), DARK, { x: side * 1.17, y: 2.55, z: -0.4 }));
    p.push(part(new BoxGeometry(0.1, 1.1, 0.05), METAL, { x: side * 1.18, y: 2.35, z: -1.4 }));
  }
  // Engine deck, intake and mast.
  p.push(part(new BoxGeometry(1.6, 0.7, 2.2), WHITE, { y: 3.4, z: -0.6 }));
  p.push(part(new BoxGeometry(1.4, 0.45, 0.6), DARK, { y: 3.55, z: 0.7 }));
  p.push(part(new CylinderGeometry(0.14, 0.18, 0.7, 8), METAL, { y: 3.95, z: -0.4 }));
  p.push(part(new CylinderGeometry(0.38, 0.5, 0.5, 10), GREY, { y: 3.55, z: -1.8, rx: Math.PI / 2 }));

  // Slim tail boom, tapering, with red fin and stabiliser.
  p.push(part(new BoxGeometry(0.7, 0.75, 3.4), WHITE, { y: 2.95, z: -3.6 }));
  p.push(part(new BoxGeometry(0.45, 0.5, 3.4), WHITE, { y: 3.05, z: -6.8 }));
  p.push(part(new BoxGeometry(0.72, 0.16, 3.42), RED, { y: 2.75, z: -3.6 }));
  p.push(part(new BoxGeometry(0.08, 1.7, 1.2), RED, { y: 3.85, z: -8.1, rx: -0.25 }));
  p.push(part(new BoxGeometry(1.9, 0.07, 0.6), WHITE, { y: 3.1, z: -7.4 }));
  p.push(part(new CylinderGeometry(0.12, 0.12, 0.35, 8), GREY, { x: 0.12, y: 4.0, z: -8.35, rz: Math.PI / 2 }));

  // Cargo hook and its tow frame under the belly.
  p.push(rod([0, 0.85, 0.2], [0, 0.5, 0.2], 0.07, DARK));
  p.push(part(new BoxGeometry(0.3, 0.2, 0.3), RED, { y: 0.45, z: 0.2 }));

  const hull = new Mesh(merge(p), propMaterial);
  hull.castShadow = true;
  body.add(hull);

  // Windscreen glass over the cockpit.
  const glass = new Mesh(
    new SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new MeshPhongMaterial({ color: 0x9fd0ea, transparent: true, opacity: 0.4, shininess: 90, specular: 0xffffff, depthWrite: false }),
  );
  glass.scale.set(1.0, 0.75, 1.1);
  glass.position.set(0, 2.4, 2.7);
  body.add(glass);

  const main = createRotor({ blades: 2, radius: 7.2, chord: 0.55, colour: 0x2c2e33, discOpacity: 0.26 });
  main.group.position.set(0, 4.3, -0.4);
  body.add(main.group);

  const tail = createRotor({ blades: 2, radius: 1.1, chord: 0.16, colour: 0xf2f0ea, discOpacity: 0.4 });
  tail.group.rotation.z = Math.PI / 2;
  tail.group.position.set(0.28, 4.0, -8.35);
  body.add(tail.group);

  const hook = new Object3D();
  hook.position.set(0, 0.4, 0.2);
  body.add(hook);

  return { root, body, rotors: [{ rotor: main, speed: 1 }, { rotor: tail, speed: 4.4 }], hook };
};
