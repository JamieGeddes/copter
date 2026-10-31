import { CargoDef } from '../missions/Cargo';
import { MissionDef } from '../missions/types';
import { BuildingDef, LevelDef } from '../world/level';
import { FloodRiver, floodRiverZ } from '../world/Terrain';

const RIVER: FloodRiver = {
  amplitude: 60,
  wavelength: 230,
  amplitude2: 25,
  wavelength2: 97,
  halfWidth: 24,
  depth: 3.5,
  narrows: { x: 0, halfWidth: 14, span: 70 },
};

/** The washed-out crossing: abutments either bank, one surviving pier mid-river. */
const RIVER_Z = floodRiverZ(RIVER, 0);
const DECK = 5;
const SPAN_OFFSET = 11.5;

const STAGING = { x: -30, z: 215 };
const VILLAGE = { x: 40, z: -190 };
const SQUARE = { x: 40, z: -186 };
const SCHOOL = { x: 130, z: -178 };
const SCHOOL_FIELD = { x: 130, z: -142 };
const FARMS = [
  { x: -250, z: 115 },
  { x: 235, z: 140 },
  { x: -215, z: -215 },
  { x: 265, z: -275 },
];

const CARGO: CargoDef[] = [
  { id: 'g1', kind: 'girder', label: 'Bridge section', x: -55, z: 250, heading: Math.PI / 2, mass: 4200, w: 3.6, h: 1.8, d: 24 },
  { id: 'g2', kind: 'girder', label: 'Bridge section', x: -55, z: 268, heading: Math.PI / 2, mass: 4200, w: 3.6, h: 1.8, d: 24 },
  { id: 'gen', kind: 'generator', label: 'Generator', x: -15, z: 262, heading: 0, mass: 3000, w: 2.6, h: 2.6, d: 5 },
  { id: 'p1', kind: 'pallet', label: 'Supply pallet', x: -35, z: 282, heading: 0, mass: 1200, w: 2, h: 1.6, d: 2 },
  { id: 'p2', kind: 'pallet', label: 'Supply pallet', x: -26, z: 282, heading: 0, mass: 1200, w: 2, h: 1.6, d: 2 },
];

const MISSION: MissionDef = {
  id: 'heavy-lift',
  title: 'Heavy Lift',
  summary: 'Carry bridge sections to a village cut off by floods.',
  skill: 'Swinging underslung loads',
  briefing: [
    'The Brook has burst its banks and swept away the only bridge into Brookmere. The village is cut off.',
    'Hover low and steady over a load and the ground crew will hook it on. Press E to release it.',
    'Loads swing. Start and stop gently, and let the swing settle before you lower anything into place. Bridge sections must be lined up with the road.',
    'Drop a load from height, drag it along the ground or lose it in the river and the mission is over.',
  ],
  objectives: [
    { kind: 'takeoff', text: 'Lift off from the staging area' },
    { kind: 'hook', text: 'Hook the first bridge section', cargo: 'g1' },
    {
      kind: 'place',
      text: 'Lower it onto the south span',
      cargo: ['g1'],
      label: 'South span',
      x: 0,
      z: RIVER_Z + SPAN_OFFSET,
      radius: 2.5,
      heading: 0,
      headingTolerance: 0.26,
    },
    {
      kind: 'place',
      text: 'Bring the second section to the north span',
      cargo: ['g2'],
      label: 'North span',
      x: 0,
      z: RIVER_Z - SPAN_OFFSET,
      radius: 2.5,
      heading: 0,
      headingTolerance: 0.26,
    },
    { kind: 'place', text: 'Deliver the generator to the village square', cargo: ['gen'], label: 'Village square', ...SQUARE, radius: 9 },
    { kind: 'place', text: 'Deliver both supply pallets to the school field', cargo: ['p1', 'p2'], label: 'School field', ...SCHOOL_FIELD, radius: 14 },
    { kind: 'land', text: 'Return to the staging area and land', pad: 'staging' },
  ],
  medals: { gold: 480, silver: 660 },
  timeLimit: 900,
  cargo: CARGO,
};

const cottages = (cx: number, cz: number, spots: [number, number][], seed: number): BuildingDef[] => {
  const colours = [0xece2cc, 0xd9c7a8, 0xe6d8c0, 0xcdb89a, 0xf1ead8];
  return spots.map(([dx, dz], i) => ({
    kind: 'cottage' as const,
    x: cx + dx,
    z: cz + dz,
    w: 9 + ((i + seed) % 3),
    d: 7,
    h: 4,
    turns: (i + seed) % 2,
    colour: colours[(i + seed) % colours.length],
    landable: false,
  }));
};

const buildings: BuildingDef[] = [
  // The bridge: abutments either bank and the surviving pier.
  { kind: 'quay', x: 0, z: RIVER_Z + 24, w: 10, d: 8, h: 2, top: DECK, colour: 0xa8a49c },
  { kind: 'quay', x: 0, z: RIVER_Z - 24, w: 10, d: 8, h: 2, top: DECK, colour: 0xa8a49c },
  { kind: 'quay', x: 0, z: RIVER_Z, w: 8, d: 3, h: 2, top: DECK, colour: 0xa8a49c },
  // A collapsed span downstream.
  { kind: 'brokenDeck', x: 34, z: RIVER_Z + 3, w: 3.6, d: 20, h: 1, top: 1, colour: 0x8f8a80, landable: false },
  // Staging area.
  { kind: 'shop', x: -2, z: 248, w: 10, d: 4, h: 3, colour: 0xf4f0e8, landable: false },
  { kind: 'tank', x: 30, z: 242, w: 6, d: 6, h: 5, colour: 0xd8d2c4, landable: false },
  { kind: 'tank', x: 38, z: 242, w: 6, d: 6, h: 5, colour: 0xd8d2c4, landable: false },
  // Village and school.
  { kind: 'hall', x: VILLAGE.x, z: VILLAGE.z - 30, w: 18, d: 12, h: 6, colour: 0xd8cdb6 },
  { kind: 'hall', x: SCHOOL.x, z: SCHOOL.z, w: 22, d: 12, h: 6, colour: 0xe6dccb },
  ...cottages(VILLAGE.x, VILLAGE.z, [
    [-35, -20],
    [-38, 5],
    [-30, 28],
    [-8, 32],
    [18, 30],
    [36, 20],
    [38, -6],
    [30, -48],
    [-20, -52],
    [-52, -30],
  ], 0),
  // Farms.
  ...FARMS.flatMap((f, i): BuildingDef[] => [
    { kind: 'barn', x: f.x, z: f.z, w: 14, d: 22, h: 7, turns: i % 2, colour: 0xa8432f, landable: false },
    ...cottages(f.x, f.z, [[22, -14]], i),
    { kind: 'tank', x: f.x - 16, z: f.z - 14, w: 5, d: 5, h: 11, colour: 0xb8bcc0, landable: false },
  ]),
];

export const HEAVY_LIFT: LevelDef = {
  id: 'heavy-lift',
  name: 'Brookmere Vale',
  aircraft: 'hauler',
  mission: MISSION,
  seaLevel: 0,
  waterStyle: 'river',
  wind: { direction: Math.PI / 2, speed: 2.5, gust: 2 },
  viewHeight: 135,
  terrain: {
    kind: 'floodplain',
    seed: 77,
    size: 1280,
    cellSize: 4,
    edgeStart: 470,
    river: RIVER,
    fieldSize: 70,
    fieldAngle: 0.3,
    flatten: [
      { ...STAGING, radius: 75, falloff: 30, height: 3.4 },
      { ...VILLAGE, radius: 80, falloff: 30, height: 4.6 },
      { x: SCHOOL.x, z: SCHOOL.z + 20, radius: 42, falloff: 25, height: 4.6 },
      // Embankments up to the bridge deck.
      { x: 0, z: RIVER_Z + 34, radius: 6, falloff: 18, height: DECK },
      { x: 0, z: RIVER_Z - 34, radius: 6, falloff: 18, height: DECK },
      ...FARMS.map((f) => ({ ...f, radius: 30, falloff: 20, height: 3.5 })),
    ],
    plateaus: [],
  },
  bounds: { minX: -490, maxX: 490, minZ: -490, maxZ: 490 },
  spawnPad: 'staging',
  spawnHeading: Math.PI * 0.75,
  buildings,
  pads: [{ id: 'staging', label: 'Staging area', x: 12, z: 205, size: 22, service: true }],
  roads: [
    [
      [12, 205],
      [6, 150],
      [0, RIVER_Z + 60],
      [0, RIVER_Z + 28],
    ],
    [
      [0, RIVER_Z - 28],
      [0, RIVER_Z - 70],
      [20, -120],
      [VILLAGE.x, VILLAGE.z + 12],
    ],
    [
      [VILLAGE.x - 120, VILLAGE.z],
      [VILLAGE.x, VILLAGE.z],
      [SCHOOL.x, SCHOOL.z + 12],
      [330, -205],
    ],
    [
      [-30, 215],
      [-150, 175],
      [FARMS[0].x + 10, FARMS[0].z + 18],
    ],
  ],
  crowds: [
    { x: -10, z: 232, radius: 18, count: 14 },
    { ...VILLAGE, radius: 50, count: 45 },
    { x: SCHOOL.x + 28, z: SCHOOL.z + 22, radius: 12, count: 18 },
  ],
  scatter: { trees: 260, bushes: 260, rocks: 60, hedges: { spacing: 70, angle: 0.3, extent: 470 } },
  clearings: [
    { ...STAGING, radius: 85 },
    { ...VILLAGE, radius: 90 },
    { x: SCHOOL.x, z: SCHOOL.z + 20, radius: 45 },
    { x: 0, z: RIVER_Z, radius: 45 },
    ...FARMS.map((f) => ({ ...f, radius: 32 })),
  ],
};
