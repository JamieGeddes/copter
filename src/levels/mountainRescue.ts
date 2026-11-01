import { MissionDef, SurvivorDef } from '../missions/types';
import { BuildingDef, LevelDef } from '../world/level';

/**
 * Layout uses mountain coordinates: `u` points down the screen towards the valley and `v` runs
 * across it. The range rises from the valley floor (u > 250) to the main ridge near u = -400.
 */
const at = (u: number, v: number): { x: number; z: number } => ({
  x: (u + v) * Math.SQRT1_2,
  z: (u - v) * Math.SQRT1_2,
});

const VALLEY = 20;
const BASE = at(330, -230);
const VILLAGE = at(300, 10);
const HOSPITAL = at(350, 95);
const HOSPITAL_PAD = at(330, 120);
const CABLE_LOW = at(285, 150);
const CABLE_HIGH = at(-10, 330);
const HUT = at(-300, 52);
const HUT_PAD = at(-302, 24);
const GLACIER = at(-205, -238);
const LEDGE_A = at(-24, 160);
const LEDGE_B = at(-26, 192);

/** Heights of the flat sites, set to sit close to the natural ground. */
const HUT_Y = 342;
const GLACIER_Y = 226;
const LEDGE_A_Y = 175;
const LEDGE_B_Y = 186;

/** The face of the cliff with the ledges looks down the valley, towards the camera. */
const FACING_VALLEY = Math.PI / 4;

const survivor = (
  id: string,
  p: { x: number; z: number },
  placement: SurvivorDef['placement'],
  y: number,
  pickup: SurvivorDef['pickup'],
  site: string,
): SurvivorDef => ({ id, ...p, placement, y, pickup, site });

const SURVIVORS: SurvivorDef[] = [
  survivor('h1', at(-301, 40), 'snow', HUT_Y, 'landing', 'the summit hut'),
  survivor('h2', at(-298, 38), 'snow', HUT_Y, 'landing', 'the summit hut'),
  survivor('g1', { x: GLACIER.x + 7, z: GLACIER.z - 3 }, 'snow', GLACIER_Y, 'landing', 'the glacier'),
  survivor('g2', { x: GLACIER.x + 9, z: GLACIER.z + 1 }, 'snow', GLACIER_Y, 'landing', 'the glacier'),
  survivor('l1', LEDGE_A, 'ledge', LEDGE_A_Y, 'winch', 'the north face'),
  survivor('l2', LEDGE_B, 'ledge', LEDGE_B_Y, 'winch', 'the north face'),
];

const MISSION: MissionDef = {
  id: 'mountain',
  title: 'Mountain Rescue',
  summary: 'Pluck stranded climbers from ledges, a glacier and a summit hut before the cloud comes down.',
  skill: 'Terrain flying in thin air',
  briefing: [
    'A storm is coming in over the Grauhorn. Six climbers are stranded: two at the summit hut, two on the glacier and two on ledges on the north face.',
    'Land beside the hut and on the glacier and the climbers will walk over. The ledges are too steep to land on: hover 6-24 m above them and the winch does the rest.',
    'The Chamois is powerful, but the air is thin up high. With a full cabin you cannot hover near the summit, and the power gauge shows what you have left. Ground effect and forward speed help; plan who you pick up first.',
    'The cabin takes three, so it will take more than one trip to the hospital pad in the valley. The cloud is lowering and closes off the highest sites first. Wind rising up the slopes lifts you; on the lee side it sinks and churns. Keep your rotor clear of the rock.',
  ],
  objectives: [
    { kind: 'takeoff', text: 'Lift off from the rescue base' },
    { kind: 'rescue', text: 'Rescue all six climbers', survivors: SURVIVORS.map((s) => s.id) },
    { kind: 'deliver', text: 'Fly the last climbers to the hospital', pad: 'hospital' },
  ],
  medals: { gold: 330, silver: 420 },
  timeLimit: 600,
  capacity: 3,
  survivors: SURVIVORS,
  spotRange: 220,
  weather: { cloudStart: 430, cloudEnd: 140, duration: 560, maxExposure: 7 },
};

const houseColours = [0xf2ede2, 0xe6dcc8, 0xd9e2e6, 0xf0e2c8, 0xe8d0c0, 0xd8c8b0];

const chalets = (): BuildingDef[] => {
  const spots: [number, number][] = [
    [-40, -30], [-18, -42], [8, -36], [34, -28], [-46, 0], [-20, 6],
    [30, 4], [-38, 30], [-10, 34], [18, 30], [44, 26], [4, 58],
  ];
  return spots.map(([du, dv], i) => ({
    kind: 'cottage' as const,
    ...at(300 + du, 10 + dv),
    w: 9 + (i % 3),
    d: 7,
    h: 4.5,
    turns: i % 2,
    colour: houseColours[i % houseColours.length],
    landable: false,
  }));
};

/** Pylons between the cable car stations, standing on the slope. */
const PYLONS = [0.3, 0.55, 0.8].map((t) => ({
  x: CABLE_LOW.x + (CABLE_HIGH.x - CABLE_LOW.x) * t,
  z: CABLE_LOW.z + (CABLE_HIGH.z - CABLE_LOW.z) * t,
}));

const buildings: BuildingDef[] = [
  { kind: 'hospital', ...HOSPITAL, w: 30, d: 22, h: 10, colour: 0xf4f2ee, landable: false },
  { kind: 'hangar', ...at(345, -262), w: 16, d: 14, h: 8, colour: 0xc8392b, landable: false },
  { kind: 'station', ...at(305, -265), w: 14, d: 10, h: 6, colour: 0xe0ddd6, landable: false },
  { kind: 'fuelCanopy', ...at(355, -205), w: 10, d: 8, h: 4.5, landable: false },
  { kind: 'hall', ...VILLAGE, w: 14, d: 10, h: 6, colour: 0xe8dcc4, landable: false },
  ...chalets(),
  // Summit hut: stone walls and a steep roof.
  { kind: 'cabin', ...HUT, w: 10, d: 7, h: 3.6, turns: 1, colour: 0x8f8a80, landable: false },
  // Cable car stations and pylons.
  { kind: 'cableStation', ...CABLE_LOW, w: 12, d: 8, h: 7, colour: 0xd8d2c4, landable: false },
  { kind: 'cableStation', ...CABLE_HIGH, w: 12, d: 8, h: 7, colour: 0xd8d2c4, landable: false },
  ...PYLONS.map((p) => ({ kind: 'pylon' as const, ...p, w: 3, d: 3, h: 22, landable: false })),
];

export const MOUNTAIN_RESCUE: LevelDef = {
  id: 'mountain',
  name: 'Grauhorn',
  aircraft: 'chamois',
  mission: MISSION,
  wind: { direction: 2.74, speed: 6, gust: 3, orographic: 0.9 },
  viewHeight: 140,
  terrain: {
    kind: 'alpine',
    seed: 517,
    size: 1280,
    cellSize: 4,
    edgeStart: 480,
    valleyHeight: VALLEY,
    footU: 250,
    ridgeU: -400,
    ridgeHeight: 300,
    treeLine: 120,
    spurs: [
      { v: -110, width: 70, height: 55 },
      { v: 175, width: 80, height: 60 },
      { v: 380, width: 90, height: 40 },
    ],
    peaks: [
      { ...at(-440, 20), radius: 120, height: 75 },
      { ...at(-390, -340), radius: 90, height: 50 },
      { ...at(-300, 340), radius: 90, height: 45 },
    ],
    cliffs: [{ ...at(-26, 176), radius: 40, height: 45, facing: FACING_VALLEY }],
    glacier: {
      points: [
        [at(-430, -240).x, at(-430, -240).z],
        [at(-250, -236).x, at(-250, -236).z],
        [at(-90, -262).x, at(-90, -262).z],
      ],
      width: 62,
    },
    flatten: [
      { ...BASE, radius: 55, falloff: 30, height: VALLEY },
      { ...VILLAGE, radius: 75, falloff: 35, height: VALLEY },
      { ...HOSPITAL, radius: 40, falloff: 25, height: VALLEY },
      { ...CABLE_LOW, radius: 14, falloff: 12 },
      { ...CABLE_HIGH, radius: 12, falloff: 14 },
      ...PYLONS.map((p) => ({ ...p, radius: 3, falloff: 4 })),
      { ...HUT, radius: 14, falloff: 14, height: HUT_Y },
      { ...HUT_PAD, radius: 14, falloff: 16, height: HUT_Y },
      { ...GLACIER, radius: 22, falloff: 22, height: GLACIER_Y },
      { ...LEDGE_A, radius: 2.5, falloff: 3, height: LEDGE_A_Y },
      { ...LEDGE_B, radius: 2.5, falloff: 3, height: LEDGE_B_Y },
    ],
    plateaus: [],
  },
  bounds: { minX: -490, maxX: 490, minZ: -490, maxZ: 490 },
  spawnPad: 'base',
  spawnHeading: Math.PI * 1.25,
  buildings,
  pads: [
    { id: 'base', label: 'Rescue base', ...BASE, size: 18, service: true },
    { id: 'hospital', label: 'Hospital pad', ...HOSPITAL_PAD, size: 18, service: false },
  ],
  roads: [
    [
      [BASE.x, BASE.z],
      [at(320, -120).x, at(320, -120).z],
      [VILLAGE.x, VILLAGE.z],
      [at(320, 80).x, at(320, 80).z],
      [HOSPITAL_PAD.x, HOSPITAL_PAD.z],
    ],
  ],
  cableways: [{ points: [CABLE_LOW, ...PYLONS, CABLE_HIGH] }],
  crowds: [
    { ...VILLAGE, radius: 50, count: 30 },
    { ...BASE, radius: 22, count: 10 },
  ],
  scatter: { trees: 2600, bushes: 400, rocks: 900, boulders: 160 },
  clearings: [
    { ...BASE, radius: 55 },
    { ...VILLAGE, radius: 70 },
    { ...HOSPITAL, radius: 45 },
    { ...HOSPITAL_PAD, radius: 18 },
    { ...CABLE_LOW, radius: 14 },
    { ...CABLE_HIGH, radius: 14 },
    { ...HUT, radius: 26 },
    { ...HUT_PAD, radius: 20 },
    { ...GLACIER, radius: 30 },
    { ...LEDGE_A, radius: 10 },
    { ...LEDGE_B, radius: 10 },
  ],
};
