import { CasualtyDef, MissionDef } from '../missions/types';
import { planCity, Rect } from '../world/cityPlan';
import { BuildingDef, LevelDef } from '../world/level';
import { CityRiver } from '../world/Terrain';

const GROUND = 3;
const RIVER: CityRiver = { offset: 40, amplitude: 45, wavelength: 160, halfWidth: 26, depth: 5 };
const LINES = [-405, -315, -225, -135, -45, 45, 135, 225, 315, 405];
const MOTORWAY_Z = 380;

const BASE = { x: 352, z: -352 };
const TRAUMA = { x: -180, z: -270 };
const BURNS = { x: -270, z: 180 };
const STADIUM = { x: 225, z: 225 };
const TOWER_BLOCK = { x: 90, z: 180 };
const TOWER_BLOCK_H = 48;
const WAREHOUSE_YARD = { x: 362, z: -72 };
const RIVERSIDE = { x: -392, z: 58 };
const MOTORWAY_CRASH = { x: -150, z: MOTORWAY_Z };

/** Power line across the river beside the riverside park. */
const POWER = [
  { x: -345, z: -130 },
  { x: -345, z: -32 },
  { x: -345, z: 128 },
  { x: -345, z: 232 },
];
const POWER_H = 30;

/** Tower cranes: mast, height and where the jib reaches. */
const CRANES = [
  { x: -110, z: -112, h: 64, jib: { x: -58, z: -112 } },
  { x: -20, z: 202, h: 58, jib: { x: 32, z: 202 } },
];

const FLOODLIGHTS = [
  { x: 146, z: 155 },
  { x: 304, z: 155 },
  { x: 146, z: 295 },
  { x: 304, z: 295 },
];

const rect = (x: number, z: number, hw: number, hd: number): Rect => ({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });

const CASUALTIES: CasualtyDef[] = [
  {
    id: 'motorway',
    label: 'Motorway collision',
    severity: 'critical',
    care: 'trauma',
    hospital: 'trauma',
    ...MOTORWAY_CRASH,
    radius: 13,
    callAt: 0,
    timer: 150,
    golden: 90,
  },
  {
    id: 'warehouse',
    label: 'Warehouse fire',
    severity: 'critical',
    care: 'burns',
    hospital: 'burns',
    ...WAREHOUSE_YARD,
    radius: 11,
    callAt: 55,
    timer: 160,
    golden: 105,
    fire: { x: 372, z: -112 },
  },
  {
    id: 'stadium',
    label: 'Fall at the stadium',
    severity: 'serious',
    care: 'trauma',
    hospital: 'trauma',
    ...STADIUM,
    radius: 14,
    callAt: 115,
    timer: 200,
    golden: 120,
  },
  {
    id: 'riverside',
    label: 'Riverside: casualty on the embankment',
    severity: 'serious',
    care: 'trauma',
    hospital: 'trauma',
    ...RIVERSIDE,
    radius: 11,
    callAt: 175,
    timer: 190,
    golden: 120,
    dark: true,
  },
  {
    id: 'tower',
    label: 'Fire on the tower block roof',
    severity: 'critical',
    care: 'burns',
    hospital: 'burns',
    ...TOWER_BLOCK,
    radius: 4.5,
    callAt: 235,
    timer: 170,
    golden: 110,
    fire: { x: TOWER_BLOCK.x - 6, z: TOWER_BLOCK.z - 6 },
  },
];

const MISSION: MissionDef = {
  id: 'medevac',
  title: 'Night Medevac',
  summary: 'Race casualties across the city by searchlight.',
  skill: 'Speed and tight landings',
  briefing: [
    'A busy night over Varrow. Calls will come in one after another: fly to each scene, land in the cordon the crews have set up and the paramedics will load the casualty.',
    'Each casualty needs the right hospital: St Brannoc’s for trauma, the Kingsgate Burns Unit for burns. Land on the lit pad on its roof before their timer runs out. Reach hospital inside the golden hour for the best result.',
    'The Lifeline carries one casualty at a time. The next call can come in while you are flying the last one, so choose your route.',
    'Your searchlight (F) follows the scene or hospital you are heading for; press F to lock it ahead or switch it off. Cranes, masts and power lines are hard to see: watch for their red warning lights.',
  ],
  objectives: [
    { kind: 'takeoff', text: 'Lift off from the air ambulance base' },
    { kind: 'casualties', text: 'Answer every call', casualties: CASUALTIES.map((c) => c.id) },
  ],
  medals: { gold: 320, silver: 420 },
  timeLimit: 600,
  casualties: CASUALTIES,
};

/** Hospitals and the base come first so their pads can refer to them by index. */
const special: BuildingDef[] = [
  { kind: 'hospital', ...TRAUMA, w: 52, d: 44, h: 30, colour: 0xe8e6e0 },
  { kind: 'hospital', ...BURNS, w: 46, d: 38, h: 22, colour: 0xe2e4e8 },
  { kind: 'flats', ...TOWER_BLOCK, w: 20, d: 20, h: TOWER_BLOCK_H, colour: 0x8a7466 },
  // Aerial mast on a corner of the tower block's roof.
  { kind: 'mast', x: TOWER_BLOCK.x + 8, z: TOWER_BLOCK.z + 8, w: 1.4, d: 1.4, h: 0, top: GROUND + TOWER_BLOCK_H + 14, landable: false },
  { kind: 'hangar', x: 400, z: -352, w: 22, d: 28, h: 11, turns: 1, colour: 0x2c6a3a, landable: false },
  { kind: 'station', x: 352, z: -405, w: 24, d: 12, h: 7, colour: 0xd8d4cc, landable: false },
  // The warehouse on fire, and its neighbours round the yard.
  { kind: 'warehouse', x: 362, z: -110, w: 56, d: 22, h: 10, colour: 0x7a7e84 },
  { kind: 'warehouse', x: 330, z: -50, w: 22, d: 22, h: 8, colour: 0x8a7a68 },
  // Stadium stands round the pitch, and floodlights at the corners.
  { kind: 'stand', x: STADIUM.x, z: STADIUM.z - 48, w: 124, d: 20, h: 18, colour: 0x5a6068, landable: false },
  { kind: 'stand', x: STADIUM.x, z: STADIUM.z + 48, w: 124, d: 20, h: 18, turns: 2, colour: 0x5a6068, landable: false },
  { kind: 'stand', x: STADIUM.x - 66.5, z: STADIUM.z, w: 76, d: 20, h: 14, turns: 1, colour: 0x5a6068, landable: false },
  { kind: 'stand', x: STADIUM.x + 66.5, z: STADIUM.z, w: 76, d: 20, h: 14, turns: 3, colour: 0x5a6068, landable: false },
  ...FLOODLIGHTS.map((p) => ({ kind: 'floodlight' as const, ...p, w: 2, d: 2, h: 44, landable: false })),
  ...POWER.map((p) => ({ kind: 'powerPylon' as const, ...p, w: 6, d: 6, h: POWER_H, landable: false })),
  ...CRANES.map((c) => ({ kind: 'crane' as const, x: c.x, z: c.z, w: 2.4, d: 2.4, h: c.h, turns: 1, landable: false })),
];

const plan = planCity({
  seed: 606,
  ground: GROUND,
  lines: LINES,
  reach: 40,
  streetHalf: 6,
  river: RIVER,
  riverClearance: 8,
  bridges: [-225, -45, 135, 315],
  motorwayZ: MOTORWAY_Z,
  motorwayHalf: 12,
  centre: { x: -90, z: -180 },
  peak: 72,
  spread: 230,
  reserved: [
    rect(BASE.x + 30, BASE.z - 30, 82, 82),
    rect(TRAUMA.x, TRAUMA.z, 32, 28),
    rect(BURNS.x, BURNS.z, 29, 25),
    rect(STADIUM.x, STADIUM.z, 85, 75),
    rect(TOWER_BLOCK.x, TOWER_BLOCK.z, 28, 28),
    rect(WAREHOUSE_YARD.x, WAREHOUSE_YARD.z - 15, 40, 45),
    rect(RIVERSIDE.x + 25, 45, 78, 85),
    rect(-90, -90, 37, 37),
    rect(0, 180, 37, 37),
    rect(0, -270, 37, 37),
  ],
  keepClear: [
    ...POWER.map((p) => ({ ...p, radius: 10 })),
    { ...MOTORWAY_CRASH, radius: 24 },
  ],
});

const PARKS = [
  { x: RIVERSIDE.x + 25, z: 45, w: 150, d: 166 },
  { x: 0, z: -270, w: 70, d: 70 },
];

export const NIGHT_MEDEVAC: LevelDef = {
  id: 'medevac',
  name: 'Varrow',
  aircraft: 'lifeline',
  mission: MISSION,
  seaLevel: 0,
  waterStyle: 'city',
  wind: { direction: 0.9, speed: 7, gust: 3, channel: 0.8 },
  viewHeight: 115,
  terrain: {
    kind: 'city',
    seed: 606,
    size: 1200,
    cellSize: 4,
    edgeStart: 470,
    ground: GROUND,
    river: RIVER,
    parks: PARKS,
    flatten: [{ ...BASE, radius: 40, falloff: 20, height: GROUND }],
    plateaus: [],
  },
  bounds: { minX: -465, maxX: 465, minZ: -465, maxZ: 465 },
  spawnPad: 'base',
  spawnHeading: Math.PI * 1.25,
  buildings: [...special, ...plan.bridges, ...plan.buildings],
  pads: [
    { id: 'base', label: 'Air ambulance base', ...BASE, size: 20, service: true },
    { id: 'trauma', label: 'St Brannoc’s (trauma)', ...TRAUMA, size: 18, service: false, onBuilding: 0 },
    { id: 'burns', label: 'Kingsgate Burns Unit', ...BURNS, size: 18, service: false, onBuilding: 1 },
  ],
  roads: plan.roads,
  motorways: [
    [
      [-470, MOTORWAY_Z],
      [470, MOTORWAY_Z],
    ],
  ],
  cableways: [
    { kind: 'power', points: POWER },
    ...CRANES.map((c) => ({ kind: 'jib' as const, points: [{ x: c.x, z: c.z, y: GROUND + c.h - 1 }, { ...c.jib, y: GROUND + c.h - 1 }] })),
  ],
  crowds: [
    { x: STADIUM.x, z: STADIUM.z + 22, radius: 10, count: 18 },
    { x: MOTORWAY_CRASH.x + 30, z: MOTORWAY_Z - 20, radius: 8, count: 10 },
    { x: BASE.x, z: BASE.z + 25, radius: 6, count: 5 },
  ],
  scatter: { trees: 1400, bushes: 300 },
  clearings: [
    { ...BASE, radius: 30 },
    ...CASUALTIES.map((c) => ({ x: c.x, z: c.z, radius: c.radius + 8 })),
    ...POWER.map((p) => ({ ...p, radius: 8 })),
  ],
};
