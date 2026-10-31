import { Bounds } from './collision';
import { DesertConfig } from './Terrain';

export type BuildingKind = 'house' | 'hall' | 'shop' | 'hangar' | 'waterTower' | 'fuelCanopy' | 'billboard' | 'tank';

export interface BuildingDef {
  kind: BuildingKind;
  x: number;
  z: number;
  /** Footprint along x and z before rotation, and height. */
  w: number;
  d: number;
  h: number;
  /** Quarter turns (0-3). */
  turns?: number;
  colour?: number;
  /** Whether the roof is a safe landing surface. Defaults to true for flat roofs. */
  landable?: boolean;
}

export interface PadDef {
  id: string;
  label: string;
  x: number;
  z: number;
  size: number;
  /** Refuels and repairs the aircraft while landed. */
  service: boolean;
  /** Optional building the pad sits on (index into buildings). */
  onBuilding?: number;
}

export interface CrowdDef {
  x: number;
  z: number;
  radius: number;
  count: number;
}

export interface ScatterDef {
  cacti: number;
  boulders: number;
  rocks: number;
  bushes: number;
}

export interface LevelDef {
  id: string;
  name: string;
  terrain: DesertConfig;
  bounds: Bounds;
  spawnPad: string;
  spawnHeading: number;
  buildings: BuildingDef[];
  pads: PadDef[];
  roads: [number, number][][];
  crowds: CrowdDef[];
  scatter: ScatterDef;
  /** Keep-clear circles for scattered props (in addition to buildings, pads and roads). */
  clearings: { x: number; z: number; radius: number }[];
}

const BASE = { x: -215, z: 95 };
const TOWN = { x: 85, z: -30 };
const MESA = { x: 285, z: -255 };

const houses = (): BuildingDef[] => {
  const out: BuildingDef[] = [];
  const palette = [0xe9d2b0, 0xd9a77c, 0xf0e4cf, 0xc98d64, 0xe3c29a, 0xb98a6a];
  let i = 0;
  for (let x = TOWN.x - 70; x <= TOWN.x + 70; x += 19) {
    for (const row of [-24, 22, -52, 48]) {
      if (Math.abs(row) > 30 && (x + row) % 3 === 0) continue;
      if (row === 22 && Math.abs(x - (TOWN.x - 25)) < 14) continue;
      const w = 9 + ((i * 7) % 5);
      const d = 8 + ((i * 3) % 4);
      out.push({
        kind: 'house',
        x: x + ((i * 5) % 4) - 2,
        z: TOWN.z + row,
        w,
        d,
        h: 3.6 + ((i * 11) % 3) * 1.1,
        colour: palette[i % palette.length],
      });
      i++;
    }
  }
  return out;
};

const buildings: BuildingDef[] = [
  // Home base.
  { kind: 'hangar', x: BASE.x - 30, z: BASE.z - 12, w: 22, d: 30, h: 9, colour: 0xa9b0b4, landable: false },
  { kind: 'tank', x: BASE.x - 32, z: BASE.z + 18, w: 6, d: 6, h: 5, colour: 0xd8d2c4, landable: false },
  { kind: 'tank', x: BASE.x - 24, z: BASE.z + 22, w: 6, d: 6, h: 5, colour: 0xd8d2c4, landable: false },
  // Town hall with rooftop pad (index 3).
  { kind: 'hall', x: TOWN.x - 25, z: TOWN.z + 24, w: 22, d: 16, h: 8, colour: 0xf2e6d0 },
  { kind: 'waterTower', x: TOWN.x + 82, z: TOWN.z + 30, w: 7, d: 7, h: 16, landable: false },
  // Fuel station on the main road.
  { kind: 'shop', x: -60, z: -66, w: 12, d: 8, h: 4.2, colour: 0xf4f0e8 },
  { kind: 'fuelCanopy', x: -60, z: -50, w: 16, d: 9, h: 5.5, colour: 0xd23b2b, landable: false },
  { kind: 'billboard', x: -150, z: -62, w: 10, d: 1, h: 7, landable: false },
  { kind: 'billboard', x: 250, z: -6, w: 10, d: 1, h: 7, turns: 1, landable: false },
  ...houses(),
];

export const DESERT_LEVEL: LevelDef = {
  id: 'desert-test',
  name: 'Saltbush Flats',
  terrain: {
    seed: 1987,
    size: 1280,
    cellSize: 4,
    edgeStart: 470,
    flatten: [
      { x: BASE.x, z: BASE.z, radius: 55, falloff: 35 },
      { x: TOWN.x, z: TOWN.z, radius: 115, falloff: 45 },
      { x: -60, z: -55, radius: 26, falloff: 25 },
    ],
    plateaus: [{ x: MESA.x, z: MESA.z, radius: 48, height: 34, cliff: 14 }],
    riverbed: { offset: 280, amplitude: 70, wavelength: 150, width: 28, depth: 3.2 },
  },
  bounds: { minX: -490, maxX: 490, minZ: -490, maxZ: 490 },
  spawnPad: 'base',
  spawnHeading: Math.PI * 0.75,
  buildings,
  pads: [
    { id: 'base', label: 'Home base', x: BASE.x, z: BASE.z, size: 14, service: true },
    { id: 'base2', label: 'Home base 2', x: BASE.x + 2, z: BASE.z + 30, size: 14, service: true },
    { id: 'hall', label: 'Town hall roof', x: TOWN.x - 25, z: TOWN.z + 24, size: 12, service: false, onBuilding: 3 },
    { id: 'mesa', label: 'Mesa Point', x: MESA.x, z: MESA.z, size: 14, service: false },
  ],
  roads: [
    [
      [-640, -70],
      [-380, -58],
      [-200, -46],
      [-60, -40],
      [TOWN.x - 80, TOWN.z],
      [TOWN.x + 80, TOWN.z],
      [330, 25],
      [460, 45],
      [640, 50],
    ],
    [
      [-200, -46],
      [-205, 20],
      [BASE.x + 15, BASE.z - 25],
    ],
  ],
  crowds: [
    { x: TOWN.x, z: TOWN.z, radius: 80, count: 240 },
    { x: -60, z: -50, radius: 18, count: 18 },
  ],
  scatter: { cacti: 170, boulders: 70, rocks: 360, bushes: 650 },
  clearings: [
    { x: BASE.x, z: BASE.z, radius: 70 },
    { x: TOWN.x, z: TOWN.z, radius: 120 },
    { x: -60, z: -55, radius: 30 },
    { x: MESA.x, z: MESA.z, radius: 25 },
  ],
};
