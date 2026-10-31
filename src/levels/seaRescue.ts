import { MissionDef, SurvivorDef } from '../missions/types';
import { BuildingDef, LevelDef } from '../world/level';

/**
 * Layout uses coast coordinates: `u` points out to sea (towards the bottom of the screen)
 * and `v` runs along the coast. The coastline sits roughly at u = -60.
 */
const at = (u: number, v: number): { x: number; z: number } => ({
  x: (u + v) * Math.SQRT1_2,
  z: (u - v) * Math.SQRT1_2,
});

const HARBOUR = at(-120, -250);
const STATION_PAD = at(-128, -228);
const HOSPITAL = at(-175, 150);
const VILLAGE = at(-215, -120);
const LIGHTHOUSE = at(-95, 30);
const STACK = at(30, 300);
const LEDGE = at(14, 288);
const YACHT = at(130, 110);

const SEA_LEVEL = 0;

const survivor = (id: string, p: { x: number; z: number }, placement: SurvivorDef['placement'], y: number): SurvivorDef => ({
  id,
  ...p,
  placement,
  y,
});

const SURVIVORS: SurvivorDef[] = [
  survivor('w1', at(35, -205), 'water', SEA_LEVEL),
  survivor('w2', at(205, -30), 'water', SEA_LEVEL),
  survivor('y1', { x: YACHT.x - 1.6, z: YACHT.z + 1 }, 'boat', 1.3),
  survivor('y2', { x: YACHT.x + 1.8, z: YACHT.z - 1.2 }, 'boat', 1.3),
  survivor('r1', LEDGE, 'rocks', 1.2),
];

const MISSION: MissionDef = {
  id: 'sea-rescue',
  title: 'Search and Rescue',
  summary: 'Winch five survivors from a stormy bay in the Albatross.',
  skill: 'Precise hovering in wind',
  briefing: [
    'A squall has swept through Gullhaven Bay. A yacht has capsized and people are in the water.',
    'Search the bay and hover steadily over each survivor. The winch lowers automatically when you are in position: 6-24 m up, within a few metres, and almost stationary.',
    'The wind blows onshore and gusts. The Albatross is heavy and slow to stop, so lean into the wind to hold station.',
    'Fly everyone to the hospital roof on the cliffs. Watch your rotor near the sea stack.',
  ],
  objectives: [
    { kind: 'takeoff', text: 'Lift off from the coastguard station' },
    { kind: 'rescue', text: 'Find and winch up all five survivors', survivors: SURVIVORS.map((s) => s.id) },
    { kind: 'deliver', text: 'Fly the survivors to the hospital roof', pad: 'hospital' },
  ],
  medals: { gold: 300, silver: 420 },
  timeLimit: 600,
  capacity: 6,
  survivors: SURVIVORS,
  searchArea: { ...at(90, 80), radius: 260, label: 'Search area' },
  spotRange: 150,
};

const cottages = (): BuildingDef[] => {
  const out: BuildingDef[] = [];
  const colours = [0xf2ede2, 0xe6dcc8, 0xd9e2e6, 0xf0e2c8, 0xe8d0c0];
  let i = 0;
  for (const [du, dv] of [
    [-30, -30],
    [-10, -38],
    [12, -26],
    [-34, 0],
    [-8, 4],
    [18, 10],
    [-28, 30],
    [0, 34],
    [24, 40],
  ]) {
    const p = at(-215 + du, -120 + dv);
    out.push({ kind: 'cottage', ...p, w: 9, d: 7, h: 4, turns: i % 2, colour: colours[i % colours.length], landable: false });
    i++;
  }
  return out;
};

const buildings: BuildingDef[] = [
  // Hospital with a rooftop pad (index 0).
  { kind: 'hospital', ...HOSPITAL, w: 34, d: 24, h: 11, colour: 0xf4f2ee },
  { kind: 'station', ...at(-140, -262), w: 18, d: 12, h: 7, colour: 0xd9dee2, landable: false },
  // Quay running out from the harbour towards open water.
  { kind: 'quay', x: HARBOUR.x + 52, z: HARBOUR.z + 10, w: 64, d: 10, h: 2, top: 2.2, colour: 0xa8a49c },
  { kind: 'lighthouse', ...LIGHTHOUSE, w: 6, d: 6, h: 24, landable: false },
  { kind: 'capsized', ...YACHT, w: 4.2, d: 11, h: 1, top: 1.1, turns: 0, colour: 0xf4f2ee, landable: false },
  ...cottages(),
];

const road = (points: [number, number][]): [number, number][] =>
  points.map(([u, v]) => {
    const p = at(u, v);
    return [p.x, p.z];
  });

export const SEA_RESCUE: LevelDef = {
  id: 'sea-rescue',
  name: 'Gullhaven Bay',
  aircraft: 'albatross',
  mission: MISSION,
  seaLevel: SEA_LEVEL,
  wind: { direction: -Math.PI * 0.75, speed: 3.5, gust: 3 },
  viewHeight: 115,
  terrain: {
    kind: 'coast',
    seed: 412,
    size: 1280,
    cellSize: 4,
    edgeStart: 470,
    coastOffset: -60,
    cliffHeight: 28,
    coves: [
      { along: -250, width: 110 },
      { along: -40, width: 60 },
    ],
    flatten: [
      { ...HARBOUR, radius: 48, falloff: 30, height: 2.4 },
      { ...HOSPITAL, radius: 34, falloff: 30 },
      { ...VILLAGE, radius: 60, falloff: 35 },
      { ...LIGHTHOUSE, radius: 12, falloff: 18 },
      { ...LEDGE, radius: 5, falloff: 4, height: 1.2 },
    ],
    plateaus: [{ ...STACK, radius: 11, height: 22, cliff: 5 }],
  },
  bounds: { minX: -490, maxX: 490, minZ: -490, maxZ: 490 },
  spawnPad: 'station',
  spawnHeading: Math.PI * 0.75,
  buildings,
  pads: [
    { id: 'station', label: 'Coastguard station', ...STATION_PAD, size: 18, service: true },
    { id: 'hospital', label: 'Hospital roof', ...HOSPITAL, size: 16, service: false, onBuilding: 0 },
  ],
  roads: [road([[-125, -235], [-180, -170], [-215, -120], [-215, -40], [-200, 60], [-178, 128]])],
  crowds: [
    { ...at(-135, -230), radius: 25, count: 35 },
    { ...VILLAGE, radius: 45, count: 30 },
  ],
  scatter: { trees: 240, bushes: 520, rocks: 260, boulders: 50 },
  clearings: [
    { ...HARBOUR, radius: 55 },
    { ...HOSPITAL, radius: 45 },
    { ...VILLAGE, radius: 60 },
    { ...LIGHTHOUSE, radius: 18 },
  ],
};
