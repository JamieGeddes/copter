import { MissionDef } from '../missions/types';
import { BuildingDef, LevelDef } from '../world/level';

const SEA_LEVEL = 0;

const RANGER = { x: -150, z: 310 };
const LAKE = { x: -10, z: 275, radius: 60, depth: 6 };
const TOWN = { x: 285, z: 95 };
/** Fire in the town boundary fails the mission. */
const TOWN_RADIUS = 85;
const START = { x: -100, z: -190 };
const LOOKOUT = { x: 40, z: -290 };
const CABINS = [
  { x: 5, z: -110 },
  { x: 95, z: -20 },
  { x: -70, z: -30 },
];

/** Wind blows from the fire towards the town. */
const WIND_DIR = Math.atan2(TOWN.x - START.x, TOWN.z - START.z);

const MISSION: MissionDef = {
  id: 'wildfire',
  title: 'Wildfire',
  summary: 'Scoop water from the lake and stop the fire reaching the town.',
  skill: 'Route planning and timing',
  briefing: [
    'A wildfire is sweeping through the forested hills of Pine Ridge towards the town of Emberton. The wind is driving it your way.',
    'Hover low and slow over the lake to dip the bucket: it fills in about two seconds. Press E to drop the water in a spray cone over whatever is beneath you.',
    'Fire runs faster uphill and downwind. A soaking stops the fire from catching for a while, so a drop ahead of the front can hold it as well as one on top of it. Firebreaks, roads and water will not burn.',
    'A full bucket is heavy and slows you down. Keep the fire out of the town boundary until it is under control, or put it out completely. The lookout tower and the cabins in the woods are worth saving too.',
  ],
  objectives: [
    { kind: 'takeoff', text: 'Lift off from the ranger station' },
    { kind: 'fill', text: 'Fill the bucket at the lake' },
    {
      kind: 'protect',
      text: 'Stop the fire reaching Emberton',
      label: 'the town',
      x: TOWN.x,
      z: TOWN.z,
      radius: TOWN_RADIUS,
      seconds: 300,
      orExtinguished: true,
    },
    { kind: 'land', text: 'Return to the ranger station and land', pad: 'ranger' },
  ],
  medals: { gold: 400, silver: 520 },
  timeLimit: 900,
};

const cabin = (x: number, z: number, turns: number): BuildingDef => ({
  kind: 'cabin',
  x,
  z,
  w: 8,
  d: 6,
  h: 3.2,
  turns,
  colour: 0x8a6240,
  landable: false,
});

const houseColours = [0xece2cc, 0xd9c7a8, 0xe6d8c0, 0xcdb89a, 0xf1ead8, 0xc9d4c0];

const townHouses = (): BuildingDef[] => {
  const spots: [number, number][] = [
    [-50, -34], [-46, -6], [-52, 24], [-24, 44], [8, 46], [38, 40],
    [50, 14], [46, -18], [38, -46], [8, -52], [-22, -48], [-26, 22],
    [24, 20], [22, -24], [-24, -22],
  ];
  return spots.map(([dx, dz], i) => ({
    kind: 'cottage' as const,
    x: TOWN.x + dx,
    z: TOWN.z + dz,
    w: 9 + (i % 3),
    d: 7,
    h: 4,
    turns: i % 2,
    colour: houseColours[i % houseColours.length],
    landable: false,
  }));
};

const buildings: BuildingDef[] = [
  // Ranger station.
  { kind: 'hall', x: RANGER.x - 26, z: RANGER.z - 6, w: 14, d: 9, h: 4, colour: 0xb88a5a, landable: false },
  { kind: 'fuelCanopy', x: RANGER.x + 28, z: RANGER.z - 10, w: 12, d: 8, h: 4.5, landable: false },
  { kind: 'tank', x: RANGER.x + 28, z: RANGER.z + 14, w: 5, d: 5, h: 4, colour: 0xc9ccd0, landable: false },
  // Lookout tower.
  { kind: 'lookout', x: LOOKOUT.x, z: LOOKOUT.z, w: 7, d: 7, h: 18, landable: false },
  // Cabins in the woods.
  ...CABINS.map((c, i) => cabin(c.x, c.z, i % 2)),
  // Emberton.
  { kind: 'hall', x: TOWN.x, z: TOWN.z, w: 16, d: 11, h: 6, colour: 0xd8cdb6, landable: false },
  { kind: 'shop', x: TOWN.x + 20, z: TOWN.z - 4, w: 10, d: 7, h: 4, colour: 0xe2d6b8, landable: false },
  ...townHouses(),
];

const BREAKS: { points: [number, number][]; width: number }[] = [
  // A cleared strip across the valley with the north end left open.
  { points: [[185, 30], [175, 120], [150, 200]], width: 14 },
  { points: [[20, -180], [60, -150], [100, -120]], width: 12 },
];

/** Circles along the firebreaks, so no trees are planted on them. */
const breakClearings = BREAKS.flatMap((b) =>
  b.points.slice(0, -1).flatMap(([ax, az], i) => {
    const [bx, bz] = b.points[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 10);
    return Array.from({ length: n + 1 }, (_, k) => ({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n, radius: b.width / 2 + 1 }));
  }),
);

export const WILDFIRE: LevelDef = {
  id: 'wildfire',
  name: 'Pine Ridge',
  aircraft: 'bucketeer',
  mission: MISSION,
  seaLevel: SEA_LEVEL,
  waterStyle: 'lake',
  wind: { direction: WIND_DIR, speed: 4.5, gust: 2.5 },
  viewHeight: 130,
  terrain: {
    kind: 'forest',
    seed: 404,
    size: 1280,
    cellSize: 4,
    edgeStart: 470,
    lake: LAKE,
    river: { offset: 300, amplitude: 24, wavelength: 150, width: 9, depth: 3, xMin: 30, xMax: 520 },
    flatten: [
      { ...RANGER, radius: 40, falloff: 25 },
      { ...TOWN, radius: 62, falloff: 30 },
      { ...LOOKOUT, radius: 12, falloff: 14 },
      ...CABINS.map((c) => ({ ...c, radius: 9, falloff: 8 })),
    ],
    plateaus: [],
  },
  bounds: { minX: -490, maxX: 490, minZ: -490, maxZ: 490 },
  spawnPad: 'ranger',
  spawnHeading: Math.PI * 0.75,
  buildings,
  pads: [{ id: 'ranger', label: 'Ranger station', x: RANGER.x, z: RANGER.z, size: 22, service: true }],
  roads: [
    [
      [RANGER.x, RANGER.z],
      [-60, 220],
      [60, 160],
      [180, 130],
      [TOWN.x - 40, TOWN.z + 20],
    ],
    [
      [TOWN.x + 40, TOWN.z],
      [380, 40],
      [440, -60],
    ],
  ],
  crowds: [{ x: TOWN.x, z: TOWN.z + 8, radius: 40, count: 24 }],
  scatter: { trees: 4200, bushes: 500, rocks: 80, boulders: 50 },
  clearings: [
    { ...RANGER, radius: 50 },
    { ...TOWN, radius: 70 },
    { ...LOOKOUT, radius: 14 },
    ...CABINS.map((c) => ({ ...c, radius: 11 })),
    ...breakClearings,
  ],
  fire: {
    ignite: [{ ...START, radius: 12 }],
    headStart: 60,
    firebreaks: BREAKS,
    assets: [
      { id: 'lookout', label: 'Lookout tower', ...LOOKOUT, radius: 12 },
      ...CABINS.map((c, i) => ({ id: `cabin${i + 1}`, label: 'Cabin', ...c, radius: 8 })),
    ],
  },
};
