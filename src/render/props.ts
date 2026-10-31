import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { createRng } from '../core/math';
import { TerrainKind } from '../world/Terrain';
import { PlacedBuilding, PlacedPad, ScatterItem, World } from '../world/World';
import { merge, part, propMaterial, rod, shade, smoothPropMaterial } from './geom';

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const DARK_WINDOW = 0x3b3a40;
const WOOD = 0x6b4a32;
const SINK = 2; // Buildings extend below their base so slopes never show a gap.

/** Adds a parapet (raised rim) around a flat roof. */
const parapet = (parts: BufferGeometry[], w: number, d: number, top: number, colour: Color | number) => {
  const t = 0.35;
  const h = 0.5;
  parts.push(part(box(w, h, t), colour, { y: top + h / 2, z: d / 2 - t / 2 }));
  parts.push(part(box(w, h, t), colour, { y: top + h / 2, z: -d / 2 + t / 2 }));
  parts.push(part(box(t, h, d - t * 2), colour, { y: top + h / 2, x: w / 2 - t / 2 }));
  parts.push(part(box(t, h, d - t * 2), colour, { y: top + h / 2, x: -w / 2 + t / 2 }));
};

/** Triangular prism for gable ends, ridge running along x. */
const gable = (span: number, rise: number, length: number): BufferGeometry => {
  const shape = new Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  g.translate(0, 0, -length / 2);
  g.rotateY(Math.PI / 2);
  return g;
};

const buildingParts = (b: PlacedBuilding, rng: () => number): BufferGeometry[] => {
  const parts: BufferGeometry[] = [];
  const colour = b.colour ?? 0xe0c8a8;
  const wall = shade(colour, 1);
  const roof = shade(colour, 0.88);
  const { w, d, h } = b;

  switch (b.kind) {
    case 'house':
    case 'hall': {
      parts.push(part(box(w, h + SINK, d), wall, { y: (h - SINK) / 2 }));
      parts.push(part(box(w - 0.7, 0.1, d - 0.7), roof, { y: h + 0.05 }));
      parapet(parts, w, d, h, shade(colour, 0.95));
      // Door and windows on the front (+z) face.
      parts.push(part(box(1.3, 2.2, 0.1), WOOD, { y: 1.1, z: d / 2 + 0.03, x: -w / 4 }));
      for (const wx of [w / 6, w / 2.6]) {
        parts.push(part(box(1.1, 1.0, 0.1), DARK_WINDOW, { y: h * 0.55, z: d / 2 + 0.03, x: wx }));
      }
      parts.push(part(box(0.1, 1.0, 1.1), DARK_WINDOW, { y: h * 0.55, x: w / 2 + 0.03 }));
      // Protruding roof beams (vigas).
      for (let vx = -w / 2 + 1; vx < w / 2 - 0.5; vx += 1.4) {
        parts.push(part(box(0.22, 0.22, 0.7), WOOD, { y: h - 0.5, z: d / 2 + 0.3, x: vx }));
      }
      if (b.kind === 'hall') {
        // Porch with columns and a flagpole.
        parts.push(part(box(w * 0.6, 0.35, 3), shade(colour, 0.9), { y: 3.6, z: d / 2 + 1.5 }));
        for (const px of [-w * 0.28, 0, w * 0.28]) {
          parts.push(part(box(0.45, 3.6, 0.45), shade(colour, 0.92), { y: 1.8, z: d / 2 + 2.8, x: px }));
        }
        parts.push(part(new CylinderGeometry(0.07, 0.07, 6, 5), 0xd8d8d8, { y: h + 3, x: w / 2 - 1, z: d / 2 - 1 }));
        parts.push(part(box(0.05, 1, 1.6), 0x2a5caa, { y: h + 5.4, x: w / 2 - 1, z: d / 2 - 0.15 }));
      } else if (rng() < 0.45) {
        // Rooftop water tank or air conditioner.
        if (rng() < 0.5) {
          parts.push(part(new CylinderGeometry(0.7, 0.7, 1.4, 8), 0xd6d2c8, { y: h + 0.8, x: w / 4, z: -d / 4 }));
        } else {
          parts.push(part(box(1.4, 0.9, 1.1), 0xb8b8b0, { y: h + 0.55, x: -w / 4, z: -d / 5 }));
        }
      }
      break;
    }
    case 'shop': {
      parts.push(part(box(w, h + SINK, d), wall, { y: (h - SINK) / 2 }));
      parts.push(part(box(w - 0.5, 0.1, d - 0.5), shade(0xc8c4bc, 1), { y: h + 0.05 }));
      parapet(parts, w, d, h, wall);
      parts.push(part(box(w * 0.8, 1.6, 0.1), 0x4a5a68, { y: 1.6, z: d / 2 + 0.03 }));
      parts.push(part(box(w, 0.7, 0.15), 0xd23b2b, { y: h - 0.4, z: d / 2 + 0.05 }));
      break;
    }
    case 'hangar': {
      const r = w / 2;
      const wallH = h - r * 0.55;
      parts.push(part(box(w, wallH + SINK, d), wall, { y: (wallH - SINK) / 2 }));
      parts.push(
        part(new CylinderGeometry(r, r, d, 16, 1, false, -Math.PI / 2, Math.PI), shade(colour, 0.92), {
          y: wallH,
          rx: -Math.PI / 2,
          sy: 1,
          sz: 0.55,
        }),
      );
      parts.push(part(box(w * 0.8, wallH * 0.9, 0.12), 0x5a6066, { y: (wallH * 0.9) / 2, z: d / 2 + 0.05 }));
      for (let i = -3; i <= 3; i++) {
        parts.push(part(box(0.1, wallH * 0.9, 0.14), 0x4a5056, { y: (wallH * 0.9) / 2, z: d / 2 + 0.07, x: (i * w * 0.8) / 7 }));
      }
      break;
    }
    case 'waterTower': {
      const legH = h - 5;
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        parts.push(part(box(0.3, legH + SINK, 0.3), 0x6d6a66, { x: lx * 2.2, z: lz * 2.2, y: (legH - SINK) / 2 }));
      }
      parts.push(part(box(4.8, 0.2, 0.2), 0x6d6a66, { y: legH * 0.5, z: 2.2 }));
      parts.push(part(box(0.2, 0.2, 4.8), 0x6d6a66, { y: legH * 0.5, x: 2.2 }));
      parts.push(part(new CylinderGeometry(3.3, 3.3, 4, 14), 0xc9c3b6, { y: legH + 2 }));
      parts.push(part(new ConeGeometry(3.5, 1.4, 14), 0x8e5a44, { y: legH + 4.7 }));
      break;
    }
    case 'fuelCanopy': {
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        parts.push(part(box(0.4, h + SINK, 0.4), 0xe8e4dc, { x: px * (w / 2 - 1.5), z: pz * (d / 2 - 1.5), y: (h - SINK) / 2 }));
      }
      parts.push(part(box(w, 0.9, d), 0xf2efe8, { y: h + 0.45 }));
      parts.push(part(box(w + 0.1, 0.45, d + 0.1), colour, { y: h + 0.6 }));
      for (const px of [-w / 4, w / 4]) {
        parts.push(part(box(0.9, 1.6, 0.6), 0xd23b2b, { x: px, y: 0.8 }));
        parts.push(part(box(0.92, 0.4, 0.62), 0xf2efe8, { x: px, y: 1.4 }));
      }
      parts.push(part(box(w * 0.7, 0.18, 1.2), 0xb8b2a6, { y: 0.09 }));
      break;
    }
    case 'billboard': {
      for (const px of [-w / 3, w / 3]) {
        parts.push(part(box(0.35, h + SINK, 0.35), 0x5c4a3a, { x: px, y: (h - SINK) / 2 }));
      }
      const top = h;
      parts.push(part(box(w, 3.4, 0.3), 0xf1e6cf, { y: top - 1.5 }));
      parts.push(part(box(w * 0.94, 1.1, 0.05), 0xd23b2b, { y: top - 0.7, z: 0.17 }));
      parts.push(part(box(w * 0.6, 0.6, 0.05), 0x2a5caa, { y: top - 2.1, z: 0.17, x: -w * 0.15 }));
      parts.push(part(box(w * 0.94, 1.1, 0.05), 0x2a5caa, { y: top - 0.7, z: -0.17 }));
      break;
    }
    case 'cottage':
    case 'cabin': {
      const roofH = d * 0.42;
      parts.push(part(box(w, h + SINK, d), wall, { y: (h - SINK) / 2 }));
      parts.push(part(gable(d, roofH, w), wall, { y: h }));
      const pitch = Math.atan2(roofH, d / 2);
      const slab = Math.hypot(roofH, d / 2) + 0.35;
      for (const side of [-1, 1]) {
        parts.push(
          part(box(w + 0.6, 0.22, slab), b.kind === 'cabin' ? 0x4a3a2c : 0x5d6168, {
            y: h + roofH / 2 + 0.1,
            z: (side * d) / 4 + side * 0.05,
            rx: side * pitch,
          }),
        );
      }
      parts.push(part(box(0.8, 1.6, 0.8), 0x8a7a6a, { x: w / 2 - 1.2, y: h + roofH * 0.8, z: -d / 6 }));
      parts.push(part(box(1.1, 2.0, 0.1), 0x3f5f7a, { y: 1, z: d / 2 + 0.03 }));
      for (const wx of [-w / 3, w / 3]) {
        parts.push(part(box(1.0, 0.9, 0.1), DARK_WINDOW, { x: wx, y: h * 0.55, z: d / 2 + 0.03 }));
      }
      break;
    }
    case 'lookout': {
      // Fire lookout: four splayed legs with cross bracing, a glazed cab and a hipped roof.
      const legH = h - 3.6;
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        parts.push(rod([lx * w * 0.5, -SINK, lz * d * 0.5], [lx * w * 0.3, legH, lz * d * 0.3], 0.18, WOOD));
      }
      for (const f of [0.35, 0.7]) {
        const k = 0.5 - 0.2 * f;
        parts.push(part(box(w * 2 * k, 0.15, 0.15), WOOD, { y: legH * f, z: d * k }));
        parts.push(part(box(w * 2 * k, 0.15, 0.15), WOOD, { y: legH * f, z: -d * k }));
        parts.push(part(box(0.15, 0.15, d * 2 * k), WOOD, { y: legH * f, x: w * k }));
        parts.push(part(box(0.15, 0.15, d * 2 * k), WOOD, { y: legH * f, x: -w * k }));
      }
      parts.push(part(box(w * 0.8, 0.3, d * 0.8), WOOD, { y: legH }));
      parts.push(part(box(w * 0.6, 2.2, d * 0.6), wall, { y: legH + 1.4 }));
      parts.push(part(box(w * 0.62, 0.9, d * 0.62), DARK_WINDOW, { y: legH + 1.7 }));
      parts.push(part(new ConeGeometry(w * 0.62, 1.2, 4), 0x7a2e22, { y: h - 0.2, ry: Math.PI / 4 }));
      break;
    }
    case 'lighthouse': {
      const towerH = h - 5;
      parts.push(part(new CylinderGeometry(2.2, 3, towerH + SINK, 16), 0xf4f2ee, { y: (towerH - SINK) / 2 }));
      for (const f of [0.25, 0.6]) {
        const r = 3 - (3 - 2.2) * f;
        parts.push(part(new CylinderGeometry(r - 0.06, r + 0.04, towerH * 0.14, 16), 0xc8392b, { y: towerH * f }));
      }
      parts.push(part(new CylinderGeometry(3, 3, 0.4, 16), 0x3b3d42, { y: towerH + 0.2 }));
      parts.push(part(new CylinderGeometry(1.6, 1.6, 2.6, 12), 0xffe6a0, { y: towerH + 1.7 }));
      parts.push(part(new ConeGeometry(2, 1.8, 12), 0xc8392b, { y: towerH + 3.9 }));
      parts.push(part(box(5, 3, 4), 0xf4f2ee, { x: 4, y: 1.5 - SINK / 2, sy: 1 }));
      break;
    }
    case 'hospital': {
      parts.push(part(box(w, h + SINK, d), wall, { y: (h - SINK) / 2 }));
      parts.push(part(box(w - 0.6, 0.1, d - 0.6), 0xc9c6c0, { y: h + 0.05 }));
      parapet(parts, w, d, h, wall);
      for (const fy of [0.3, 0.68]) {
        parts.push(part(box(w * 0.9, 1.1, 0.1), 0x4a6278, { y: h * fy, z: d / 2 + 0.03 }));
        parts.push(part(box(0.1, 1.1, d * 0.8), 0x4a6278, { y: h * fy, x: w / 2 + 0.03 }));
      }
      parts.push(part(box(w + 0.1, 0.6, d + 0.1), 0x2f6fb0, { y: h - 0.9 }));
      // Entrance canopy and sign.
      parts.push(part(box(8, 0.4, 3), 0x2f6fb0, { y: 3.2, z: d / 2 + 1.5 }));
      parts.push(part(box(2.6, 2.6, 0.2), 0x2f6fb0, { y: h - 3, x: w / 2 - 3, z: d / 2 + 0.1 }));
      parts.push(part(box(0.5, 1.8, 0.1), 0xffffff, { y: h - 3, x: w / 2 - 3.6, z: d / 2 + 0.22 }));
      parts.push(part(box(0.5, 1.8, 0.1), 0xffffff, { y: h - 3, x: w / 2 - 2.4, z: d / 2 + 0.22 }));
      parts.push(part(box(1.2, 0.4, 0.1), 0xffffff, { y: h - 3, x: w / 2 - 3, z: d / 2 + 0.22 }));
      break;
    }
    case 'station': {
      parts.push(part(box(w, h + SINK, d), wall, { y: (h - SINK) / 2 }));
      parts.push(part(box(w - 0.5, 0.1, d - 0.5), 0x9aa0a6, { y: h + 0.05 }));
      parapet(parts, w, d, h, wall);
      parts.push(part(box(w + 0.1, 0.8, d + 0.1), 0x2f4f8a, { y: h - 0.8 }));
      parts.push(part(box(w * 0.5, 2.6, 0.1), 0x3f5f7a, { y: 1.3, z: d / 2 + 0.03, x: -w / 5 }));
      // Lookout tower and radio mast.
      parts.push(part(box(5, 4, 5), wall, { x: w / 2 - 3, y: h + 2, z: -d / 2 + 3 }));
      parts.push(part(box(5.1, 1.2, 5.1), 0x3b4a5a, { x: w / 2 - 3, y: h + 2.8, z: -d / 2 + 3 }));
      parts.push(rod([w / 2 - 3, h + 4, -d / 2 + 3], [w / 2 - 3, h + 12, -d / 2 + 3], 0.08, 0xdedad2));
      break;
    }
    case 'quay': {
      parts.push(part(box(w, h + SINK, d), wall, { y: (h - SINK) / 2 }));
      parts.push(part(box(w, 0.15, d), shade(colour, 1.1), { y: h + 0.07 }));
      for (let x = -w / 2 + 2; x < w / 2; x += 6) {
        for (const side of [-1, 1]) {
          parts.push(part(new CylinderGeometry(0.22, 0.26, 0.6, 7), 0x3b3d42, { x, y: h + 0.3, z: side * (d / 2 - 0.5) }));
        }
      }
      break;
    }
    case 'capsized': {
      const sea = -b.base;
      parts.push(
        part(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xb33b2c, { y: sea - 0.15, sx: w / 2, sy: 1.25, sz: d / 2 }),
      );
      parts.push(part(box(w * 0.98, 0.25, d * 0.9), 0xf4f2ee, { y: sea + 0.05 }));
      parts.push(part(box(0.3, 1.6, 2.6), 0x2c2e33, { y: sea + 1.6 }));
      parts.push(part(box(0.18, 0.9, 0.9), 0x2c2e33, { y: sea + 1.1, z: -d / 2 + 1.2 }));
      break;
    }
    case 'barn': {
      const roofH = d * 0.38;
      parts.push(part(box(w, h + SINK, d), wall, { y: (h - SINK) / 2 }));
      parts.push(part(gable(d, roofH, w), wall, { y: h }));
      const pitch = Math.atan2(roofH, d / 2);
      const slab = Math.hypot(roofH, d / 2) + 0.4;
      for (const side of [-1, 1]) {
        parts.push(part(box(w + 0.8, 0.25, slab), 0x4a4e52, { y: h + roofH / 2 + 0.12, z: (side * d) / 4 + side * 0.05, rx: side * pitch }));
      }
      // Big doors on the gable end with a white cross brace.
      parts.push(part(box(0.1, h * 0.8, d * 0.45), 0x6b3324, { x: w / 2 + 0.03, y: h * 0.4 }));
      parts.push(part(box(0.12, 0.25, d * 0.45), 0xf1ede4, { x: w / 2 + 0.06, y: h * 0.4, rx: 0.9 }));
      parts.push(part(box(0.12, 0.25, d * 0.45), 0xf1ede4, { x: w / 2 + 0.06, y: h * 0.4, rx: -0.9 }));
      break;
    }
    case 'brokenDeck': {
      // A collapsed bridge span: one end on its pier, the other sunk in the river.
      const sea = -b.base;
      parts.push(part(box(w, 0.9, d), 0x8f8a80, { y: sea + 1.2, rx: 0.22 }));
      parts.push(part(box(w + 0.3, 0.6, 0.3), 0x6d6a66, { y: sea + 1.9, z: d / 2 - 0.4, rx: 0.22 }));
      break;
    }
    case 'tank': {
      parts.push(part(new CylinderGeometry(w / 2, w / 2, h + SINK, 14), wall, { y: (h - SINK) / 2 }));
      parts.push(part(new SphereGeometry(w / 2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), shade(colour, 0.9), { y: h, sy: 0.35 }));
      parts.push(part(box(w + 0.1, 0.3, 0.6), 0xd23b2b, { y: h * 0.6 }));
      break;
    }
  }
  return parts;
};

/** Merges all buildings into a single mesh. */
const createBuildings = (world: World): Mesh => {
  const rng = createRng(77);
  const all: BufferGeometry[] = [];
  const m = new Matrix4();
  for (const b of world.buildings) {
    const parts = buildingParts(b, rng);
    m.makeRotationY(((b.turns ?? 0) * Math.PI) / 2).setPosition(b.x, b.base, b.z);
    for (const p of parts) {
      p.applyMatrix4(m);
      all.push(p);
    }
  }
  const mesh = new Mesh(merge(all), propMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const padTexture = (ring: string): CanvasTexture => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#9d9a94';
  g.fillRect(0, 0, size, size);
  // Weathered concrete.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,55,50' : '230,225,215'},${Math.random() * 0.08})`;
    const s = 2 + Math.random() * 10;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  g.strokeStyle = '#e8e2d4';
  g.lineWidth = 8;
  g.strokeRect(10, 10, size - 20, size - 20);
  g.strokeStyle = ring;
  g.lineWidth = 16;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f4f0e6';
  const u = size / 16;
  g.fillRect(size / 2 - 3.5 * u, size / 2 - 4 * u, 1.6 * u, 8 * u);
  g.fillRect(size / 2 + 1.9 * u, size / 2 - 4 * u, 1.6 * u, 8 * u);
  g.fillRect(size / 2 - 2 * u, size / 2 - 0.8 * u, 4 * u, 1.6 * u);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
};

const createPads = (world: World): Group => {
  const group = new Group();
  const materials: Record<string, MeshLambertMaterial> = {
    service: new MeshLambertMaterial({ map: padTexture('#f2c230') }),
    roof: new MeshLambertMaterial({ map: padTexture('#d23b2b') }),
    remote: new MeshLambertMaterial({ map: padTexture('#f08a24') }),
  };
  const side = new MeshLambertMaterial({ color: 0x8f8b84 });
  for (const p of world.pads) {
    const kind = p.service ? 'service' : p.onBuilding !== undefined ? 'roof' : 'remote';
    const depth = p.onBuilding !== undefined ? 0.3 : 3;
    const slab = new Mesh(new BoxGeometry(p.size, depth, p.size), [side, side, materials[kind], side, side, side]);
    slab.position.set(p.x, p.top - depth / 2, p.z);
    slab.receiveShadow = true;
    slab.castShadow = p.onBuilding === undefined;
    group.add(slab);
  }
  return group;
};

const createWindsock = (pad: PlacedPad): Mesh => {
  const parts: BufferGeometry[] = [
    part(new CylinderGeometry(0.08, 0.1, 6, 6), 0xdedad2, { y: 3 }),
  ];
  const stripes = [0xf08a24, 0xf4f0e6, 0xf08a24];
  stripes.forEach((c, i) => {
    const r0 = 0.45 - i * 0.1;
    parts.push(part(new CylinderGeometry(r0 - 0.1, r0, 0.9, 8, 1, true), c, { y: 5.6, z: 0.45 + i * 0.9, rx: Math.PI / 2 }));
  });
  const mesh = new Mesh(merge(parts), propMaterial);
  mesh.position.set(pad.x + pad.size / 2 + 4, pad.top - 0.3, pad.z - pad.size / 2);
  mesh.castShadow = true;
  return mesh;
};

// ---- Scattered vegetation and rocks (instanced) ----

const cactusGeometry = (arms: number): BufferGeometry => {
  const green = 0x4f7a3a;
  const parts = [
    part(new CylinderGeometry(0.42, 0.48, 5, 9), green, { y: 2.5 }),
    part(new SphereGeometry(0.42, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), green, { y: 5 }),
  ];
  const armDefs = [
    { side: 1, at: 2.2, len: 0.9, up: 1.8 },
    { side: -1, at: 2.9, len: 0.8, up: 1.4 },
  ].slice(0, arms);
  for (const a of armDefs) {
    parts.push(part(new CylinderGeometry(0.28, 0.28, a.len, 7), green, { x: a.side * (a.len / 2 + 0.3), y: a.at, rz: Math.PI / 2 }));
    parts.push(part(new CylinderGeometry(0.28, 0.3, a.up, 7), green, { x: a.side * (a.len + 0.3), y: a.at + a.up / 2 }));
    parts.push(part(new SphereGeometry(0.28, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), green, { x: a.side * (a.len + 0.3), y: a.at + a.up }));
  }
  return merge(parts);
};

const jitter = (g: BufferGeometry, amount: number, seed: number): BufferGeometry => {
  const rng = createRng(seed);
  const pos = g.getAttribute('position');
  // Jitter shared vertices consistently by keying on rounded position.
  const offsets = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let o = offsets.get(key);
    if (!o) {
      o = [(rng() - 0.5) * amount, (rng() - 0.5) * amount, (rng() - 0.5) * amount];
      offsets.set(key, o);
    }
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  g.computeVertexNormals();
  return g;
};

const boulderGeometry = (colour: number): BufferGeometry =>
  jitter(part(new DodecahedronGeometry(1.3, 0), colour, { y: 0.7, sx: 1.3, sy: 0.9, sz: 1.1 }), 0.5, 3);

const rockGeometry = (colour: number): BufferGeometry =>
  jitter(part(new IcosahedronGeometry(0.45, 0), colour, { y: 0.15, sy: 0.6 }), 0.2, 9);

const bushGeometry = (c: [number, number, number]): BufferGeometry => {
  const parts = [
    part(new IcosahedronGeometry(0.7, 0), c[0], { y: 0.35, sy: 0.6 }),
    part(new IcosahedronGeometry(0.5, 0), c[1], { x: 0.55, y: 0.3, z: 0.2, sy: 0.6 }),
    part(new IcosahedronGeometry(0.45, 0), c[2], { x: -0.4, y: 0.25, z: -0.35, sy: 0.6 }),
  ];
  return merge(parts);
};

const roundTreeGeometry = (): BufferGeometry =>
  merge([
    part(new CylinderGeometry(0.22, 0.3, 3, 6), 0x6b4a32, { y: 1.5 }),
    part(new IcosahedronGeometry(2.1, 0), 0x5f8a3e, { y: 4.4, sy: 0.85 }),
    part(new IcosahedronGeometry(1.5, 0), 0x6f9a48, { x: 1.1, y: 5.3, z: 0.4 }),
    part(new IcosahedronGeometry(1.3, 0), 0x557f38, { x: -0.9, y: 5, z: -0.6 }),
  ]);

const pineGeometry = (): BufferGeometry =>
  merge([
    part(new CylinderGeometry(0.2, 0.28, 2.4, 6), 0x5e4330, { y: 1.2 }),
    part(new ConeGeometry(2.2, 3.4, 7), 0x3f6b3a, { y: 3.6 }),
    part(new ConeGeometry(1.7, 2.8, 7), 0x467542, { y: 5.2 }),
    part(new ConeGeometry(1.1, 2.2, 7), 0x4d7d48, { y: 6.6 }),
  ]);

const PALETTES = {
  desert: { boulder: 0xa65d3f, rock: 0x9a6a4c, bush: [0x8c8a4c, 0x7d7f44, 0x9a8c55] as [number, number, number] },
  coast: { boulder: 0x8c867a, rock: 0x9a958a, bush: [0x5d7a3a, 0x6b8a40, 0x8a8a3a] as [number, number, number] },
  floodplain: { boulder: 0x8c867a, rock: 0x9a958a, bush: [0x4f7232, 0x5f8238, 0x6d8a3c] as [number, number, number] },
  forest: { boulder: 0x7d786e, rock: 0x8a857a, bush: [0x3f5f2c, 0x4b6c30, 0x5c7a36] as [number, number, number] },
};

const createScatter = (items: ScatterItem[], kind: TerrainKind): Group => {
  const palette = PALETTES[kind];
  const group = new Group();
  const rng = createRng(5);
  const dummy = new Object3D();
  const tint = new Color();
  const kinds: { key: string; filter: (s: ScatterItem) => boolean; geometry: BufferGeometry; shadow: boolean; smooth: boolean }[] = [
    { key: 'cactus2', filter: (s) => s.kind === 'cactus' && s.variant < 2, geometry: cactusGeometry(2), shadow: true, smooth: false },
    { key: 'cactus1', filter: (s) => s.kind === 'cactus' && s.variant >= 2, geometry: cactusGeometry(1), shadow: true, smooth: false },
    { key: 'treeRound', filter: (s) => s.kind === 'tree' && s.variant < 2, geometry: roundTreeGeometry(), shadow: true, smooth: false },
    { key: 'treePine', filter: (s) => s.kind === 'tree' && s.variant >= 2, geometry: pineGeometry(), shadow: true, smooth: false },
    { key: 'boulder', filter: (s) => s.kind === 'boulder', geometry: boulderGeometry(palette.boulder), shadow: true, smooth: false },
    { key: 'rock', filter: (s) => s.kind === 'rock', geometry: rockGeometry(palette.rock), shadow: false, smooth: false },
    { key: 'bush', filter: (s) => s.kind === 'bush', geometry: bushGeometry(palette.bush), shadow: true, smooth: false },
  ];
  for (const k of kinds) {
    const list = items.filter(k.filter);
    if (list.length === 0) continue;
    const mesh = new InstancedMesh(k.geometry, k.smooth ? smoothPropMaterial : propMaterial, list.length);
    list.forEach((s, i) => {
      dummy.position.set(s.x, s.y - 0.1, s.z);
      dummy.rotation.set(0, s.rotation, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tint.setScalar(0.82 + rng() * 0.3);
      mesh.setColorAt(i, tint);
    });
    mesh.castShadow = k.shadow;
    mesh.receiveShadow = true;
    mesh.name = k.key;
    group.add(mesh);
  }
  return group;
};

// ---- Roads ----

const createRoads = (world: World): Mesh => {
  const positions: number[] = [];
  const colours: number[] = [];
  const shoulder = new Color(world.terrain.kind === 'desert' ? 0xb88c5e : 0x9a9478);
  const asphalt = new Color(0x75695d);
  const paint = new Color(0xe9dfc8);
  const t = world.terrain;

  const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number, half: number, lift: number, c: Color) => {
    const p = [
      [ax + nx * half, az + nz * half],
      [ax - nx * half, az - nz * half],
      [bx - nx * half, bz - nz * half],
      [bx + nx * half, bz + nz * half],
    ].map(([x, z]) => [x, world.groundHeightAt(x, z) + lift, z]);
    for (const idx of [0, 2, 1, 0, 3, 2]) {
      positions.push(...p[idx]);
      colours.push(c.r, c.g, c.b);
    }
  };

  for (const road of world.level.roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i];
      const [bx, bz] = road[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const nx = -dz;
      const nz = dx;
      const step = t.cellSize / 2;
      for (let s = 0; s < len; s += step) {
        const e = Math.min(len, s + step + 0.3);
        const x0 = ax + dx * s;
        const z0 = az + dz * s;
        const x1 = ax + dx * e;
        const z1 = az + dz * e;
        quad(x0, z0, x1, z1, nx, nz, 6, 0.1, shoulder);
        quad(x0, z0, x1, z1, nx, nz, 3.8, 0.16, asphalt);
        if (Math.floor(s / 6) % 2 === 0) quad(x0, z0, x1, z1, nx, nz, 0.15, 0.2, paint);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new Float32BufferAttribute(colours, 3));
  g.computeVertexNormals();
  const material = new MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
};

/** Builds every static prop in the level. */
export const createProps = (world: World): Group => {
  const group = new Group();
  group.add(createBuildings(world));
  group.add(createPads(world));
  group.add(createScatter(world.scatter, world.terrain.kind));
  group.add(createRoads(world));
  for (const p of world.pads.filter((pad) => pad.service).slice(0, 1)) group.add(createWindsock(p));
  return group;
};
