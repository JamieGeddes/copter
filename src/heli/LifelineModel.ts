import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshPhongMaterial, Object3D, SphereGeometry, TorusGeometry } from 'three';
import { merge, part, propMaterial, rod } from '../render/geom';
import { createRotor, HeliVisualParts } from './rotor';

const YELLOW = 0xf2d21a;
const GREEN = 0x1f8a3a;
const WHITE = 0xf4f2ec;
const DARK = 0x26282c;
const METAL = 0x8a8f96;

/**
 * Twin-engine air ambulance: a rounded pod with big clamshell doors at the back, a slim boom
 * ending in a shrouded tail fan, skids and a high-visibility yellow and green chequered livery.
 * Navigation lights, strobes and a searchlight under the nose. Nose points +z.
 */
export const createLifelineModel = (): HeliVisualParts => {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const p: BufferGeometry[] = [];

  // Skids on curved cross tubes.
  for (const side of [-1, 1]) {
    p.push(part(new CylinderGeometry(0.08, 0.08, 4.4, 8), METAL, { x: side * 1.2, y: 0.1, z: 0.2, rx: Math.PI / 2 }));
    p.push(part(new CylinderGeometry(0.08, 0.08, 0.6, 8), METAL, { x: side * 1.2, y: 0.28, z: 2.55, rx: Math.PI / 2 + 0.7 }));
    for (const z of [-0.9, 1.2]) p.push(rod([side * 1.2, 0.12, z], [side * 0.75, 0.95, z], 0.07, METAL));
  }

  // Pod: rounded nose, cabin and the tapered rear with clamshell doors.
  p.push(part(new BoxGeometry(1.9, 1.5, 3.2), YELLOW, { y: 1.75, z: 0.2 }));
  p.push(part(new SphereGeometry(1, 14, 10), YELLOW, { y: 1.75, z: 1.8, sx: 0.95, sy: 0.78, sz: 1.0 }));
  p.push(part(new BoxGeometry(1.7, 1.3, 1.6), YELLOW, { y: 1.85, z: -1.9, rx: -0.12 }));
  p.push(part(new BoxGeometry(1.92, 0.25, 4.6), WHITE, { y: 0.95, z: 0.0 }));
  // Battenburg chequer band along both sides.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      for (let row = 0; row < 2; row++) {
        const colour = (i + row) % 2 ? GREEN : YELLOW;
        p.push(part(new BoxGeometry(0.04, 0.32, 0.5), colour, { x: side * 0.97, y: 1.3 + row * 0.32, z: -1.55 + i * 0.5 }));
      }
    }
  }
  // Engine deck, exhausts and mast.
  p.push(part(new BoxGeometry(1.5, 0.75, 2.4), WHITE, { y: 2.85, z: -0.7 }));
  for (const side of [-1, 1]) p.push(part(new CylinderGeometry(0.16, 0.2, 0.5, 8), DARK, { x: side * 0.45, y: 3.0, z: -2.0, rx: Math.PI / 2 }));
  p.push(part(new CylinderGeometry(0.14, 0.18, 0.6, 8), METAL, { y: 3.35, z: -0.4 }));

  // Slim tail boom, horizontal stabiliser with end plates, and the shrouded fan.
  p.push(part(new CylinderGeometry(0.22, 0.42, 4.8, 10), YELLOW, { y: 2.2, z: -4.8, rx: Math.PI / 2 }));
  p.push(part(new BoxGeometry(2.4, 0.08, 0.6), WHITE, { y: 2.25, z: -5.6 }));
  for (const side of [-1, 1]) p.push(part(new BoxGeometry(0.06, 0.6, 0.6), GREEN, { x: side * 1.2, y: 2.35, z: -5.6 }));
  p.push(part(new BoxGeometry(0.22, 1.5, 1.4), YELLOW, { y: 2.55, z: -7.45 }));
  p.push(part(new TorusGeometry(0.6, 0.16, 8, 20), GREEN, { y: 2.4, z: -7.45, ry: Math.PI / 2 }));
  p.push(part(new BoxGeometry(0.1, 0.9, 0.9), DARK, { y: 2.4, z: -7.45 }));
  p.push(part(new BoxGeometry(0.12, 1.0, 0.7), YELLOW, { y: 3.4, z: -7.65, rx: -0.35 }));

  // Searchlight housing under the nose.
  p.push(part(new CylinderGeometry(0.22, 0.26, 0.3, 10), DARK, { y: 0.78, z: 2.0 }));

  const hull = new Mesh(merge(p), propMaterial);
  hull.castShadow = true;
  body.add(hull);

  // Windscreen and cabin windows.
  const glass = new Mesh(
    new SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshPhongMaterial({ color: 0x5a7a90, transparent: true, opacity: 0.75, shininess: 100, specular: 0xffffff }),
  );
  glass.scale.set(0.92, 0.75, 1.0);
  glass.position.set(0, 2.0, 1.75);
  glass.rotation.x = 0.35;
  body.add(glass);

  const main = createRotor({ blades: 4, radius: 5.2, chord: 0.34, colour: 0x2c2e33, discOpacity: 0.24 });
  main.group.position.set(0, 3.6, -0.4);
  body.add(main.group);

  // The fan spins inside its shroud.
  const fan = createRotor({ blades: 8, radius: 0.5, chord: 0.12, colour: 0x3a3d42, discOpacity: 0.5 });
  fan.group.rotation.z = Math.PI / 2;
  fan.group.position.set(0.05, 2.4, -7.45);
  body.add(fan.group);

  // Lights: red to port (+x with the nose on +z), green to starboard, white at the tail, a red
  // beacon on the roof and white strobes on the stabiliser tips.
  const light = (x: number, y: number, z: number, colour: number, r = 0.1): Object3D => {
    const m = new Mesh(new SphereGeometry(r, 8, 6), new MeshBasicMaterial({ color: colour }));
    m.position.set(x, y, z);
    body.add(m);
    return m;
  };
  const lights: HeliVisualParts['lights'] = [
    { object: light(0.98, 1.95, 0.9, 0xff3020), colour: 0xff3020, size: 1.6, kind: 'steady' },
    { object: light(-0.98, 1.95, 0.9, 0x30ff60), colour: 0x30ff60, size: 1.6, kind: 'steady' },
    { object: light(0, 3.0, -8.1, 0xffffff), colour: 0xffffff, size: 1.3, kind: 'steady' },
    { object: light(0, 3.25, 0.4, 0xff2010, 0.14), colour: 0xff2010, size: 2.6, kind: 'beacon' },
    { object: light(0, 0.65, -0.4, 0xff2010, 0.14), colour: 0xff2010, size: 2.2, kind: 'beacon' },
    { object: light(1.22, 2.4, -5.6, 0xffffff, 0.08), colour: 0xffffff, size: 3, kind: 'strobe' },
    { object: light(-1.22, 2.4, -5.6, 0xffffff, 0.08), colour: 0xffffff, size: 3, kind: 'strobe' },
  ];

  const searchlight = new Object3D();
  searchlight.position.set(0, 0.6, 2.05);
  body.add(searchlight);

  return { root, body, rotors: [{ rotor: main, speed: 1.1 }, { rotor: fan, speed: 5.5 }], searchlight, lights };
};
