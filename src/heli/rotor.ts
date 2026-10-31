import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SRGBColorSpace,
} from 'three';
import { smoothstep } from '../core/math';

export interface RotorOptions {
  blades: number;
  radius: number;
  chord: number;
  colour: number;
  discOpacity: number;
}

export interface Rotor {
  group: Group;
  hub: Group;
  disc: Mesh;
  bladeMaterial: MeshLambertMaterial;
  discMaterial: MeshBasicMaterial;
}

export interface HeliVisualParts {
  /** Positioned at the skids; yaw is applied here. */
  root: Object3D;
  /** Child of root; pitch and roll are applied here. */
  body: Object3D;
  /** Rotors with relative spin speeds. */
  rotors: { rotor: Rotor; speed: number }[];
  /** Attachment point for the rescue winch cable, if fitted. */
  winch?: Object3D;
  /** Belly cargo hook, if fitted. */
  hook?: Object3D;
}

let discTexture: CanvasTexture | undefined;

const getDiscTexture = (): CanvasTexture => {
  if (discTexture) return discTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  const grad = g.createRadialGradient(c, c, size * 0.05, c, c, c);
  grad.addColorStop(0, 'rgba(40,40,44,0.0)');
  grad.addColorStop(0.15, 'rgba(40,40,44,0.5)');
  grad.addColorStop(0.85, 'rgba(40,40,44,0.75)');
  grad.addColorStop(0.97, 'rgba(40,40,44,0.95)');
  grad.addColorStop(1, 'rgba(40,40,44,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
  // Faint blade streaks.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, c, (i / 6) * Math.PI * 2, (i / 6) * Math.PI * 2 + 0.6);
    g.closePath();
    g.fill();
  }
  discTexture = new CanvasTexture(canvas);
  discTexture.colorSpace = SRGBColorSpace;
  return discTexture;
};

/** A rotor whose blades fade into a translucent blurred disc as it spins up. Spins about local +y. */
export const createRotor = (opts: RotorOptions): Rotor => {
  const group = new Group();
  const hub = new Group();
  group.add(hub);
  const bladeMaterial = new MeshLambertMaterial({ color: opts.colour, transparent: true });
  for (let i = 0; i < opts.blades; i++) {
    const blade = new Mesh(new BoxGeometry(opts.radius, 0.05, opts.chord), bladeMaterial);
    blade.position.x = opts.radius / 2;
    const arm = new Group();
    arm.rotation.y = (i / opts.blades) * Math.PI * 2;
    arm.add(blade);
    blade.castShadow = true;
    hub.add(arm);
  }
  const cap = new Mesh(new CylinderGeometry(0.16, 0.2, 0.18, 8), new MeshLambertMaterial({ color: 0x55585e }));
  hub.add(cap);

  const discMaterial = new MeshBasicMaterial({
    map: getDiscTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: DoubleSide,
  });
  const disc = new Mesh(new CircleGeometry(opts.radius, 40), discMaterial);
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = 2;
  group.add(disc);
  group.userData.discOpacity = opts.discOpacity;
  return { group, hub, disc, bladeMaterial, discMaterial };
};

/** Advances rotor animation. `spool` is 0..1 rotor speed. */
export const animateRotor = (r: Rotor, spool: number, speed: number, dt: number): void => {
  const revsPerSecond = 5.2 * spool * speed;
  r.hub.rotation.y += revsPerSecond * Math.PI * 2 * dt;
  const blur = smoothstep(0.35, 0.9, spool);
  r.bladeMaterial.opacity = 1 - blur * 0.8;
  r.discMaterial.opacity = blur * (r.group.userData.discOpacity as number);
  r.disc.rotation.z += dt * 2.5 * spool;
  r.disc.visible = blur > 0.01;
};
