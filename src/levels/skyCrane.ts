import { CargoDef } from '../missions/Cargo';
import { AssemblyPart, MissionDef } from '../missions/types';
import { BuildingDef, LevelDef } from '../world/level';

/**
 * Layout uses mountain coordinates, as on the Grauhorn: `u` points down the screen towards the
 * valley and `v` runs across it. The construction yard is on the valley floor; the transmitter
 * site is on a bare summit at the end of a spur, above where the road up the spur gives out.
 */
const at = (u: number, v: number): { x: number; z: number } => ({
  x: (u + v) * Math.SQRT1_2,
  z: (u - v) * Math.SQRT1_2,
});
const xz = (u: number, v: number): [number, number] => {
  const p = at(u, v);
  return [p.x, p.z];
};

const VALLEY = 20;
const YARD = at(300, -60);
const VILLAGE = at(330, 120);
const SUMMIT = at(30, 80);
/** Height of the levelled summit, and of the top of the mast footing. */
const SUMMIT_Y = 196;
const FOOTING_TOP = SUMMIT_Y + 1.2;
/** The ladder up the mast faces +z, towards the camera and the site hut. */
const MAST_HEADING = 0;

const SECTION = { kind: 'mastSection' as const, label: 'Mast section', w: 2.6, h: 7, d: 2.6, mass: 3200, windage: 0.06 };
const ANTENNA = { kind: 'antenna' as const, label: 'Antenna', w: 2.6, h: 6, d: 2.6, mass: 1400, windage: 0.09 };
const SECTIONS = ['s1', 's2', 's3', 's4'];

/** Parts stand upright in a row beside the yard, ladders facing the road. */
const CARGO: CargoDef[] = [
  ...SECTIONS.map((id, i) => ({ id, ...SECTION, ...at(326, -104 + i * 9), heading: Math.PI / 4 })),
  { id: 'ant', ...ANTENNA, ...at(326, -104 + SECTIONS.length * 9 + 2), heading: Math.PI / 4 },
];

const sectionPart = (cargo: string): AssemblyPart => ({ cargo, radius: 0.6, headingTolerance: (6 * Math.PI) / 180, seconds: 3 });

const MAST_TOP = FOOTING_TOP + SECTIONS.length * SECTION.h;

const MISSION: MissionDef = {
  id: 'sky-crane',
  title: 'Sky Crane',
  summary: 'Build a transmitter mast on a windy summit, one section at a time.',
  skill: 'Precise placement',
  briefing: [
    'The Kesselkopf needs a new transmitter. The mast comes in four lattice sections and an antenna, waiting in the yard. The road gives out halfway up the spur, so the Mantis will build it.',
    'Hook a section, fly it up to the summit and lower it onto the footing, then stack the rest on top. Line each one up with the outline: the ladder has to face the arrow. Turn the load with [ and ] (or , and .), and C switches the precision camera.',
    'Once a part is seated and lined up, hold it there while the crew bolt it on; they unhook it when it is done. Slip out of line and they start again. Do not let go: they will not bolt a part nobody is holding.',
    'The wind is stronger at the top and gusts swing the load on its long line. Move gently and wait for the swing to settle. Hit the mast hard and the part is damaged; swing it into the crew and the job is over.',
  ],
  objectives: [
    { kind: 'takeoff', text: 'Lift off from the yard' },
    {
      kind: 'assemble',
      text: 'Stack the four mast sections on the summit footing',
      label: 'Mast footing',
      ...SUMMIT,
      y: FOOTING_TOP,
      heading: MAST_HEADING,
      parts: SECTIONS.map(sectionPart),
    },
    {
      kind: 'assemble',
      text: 'Fit the antenna on top',
      label: 'Mast head',
      ...SUMMIT,
      y: MAST_TOP,
      heading: MAST_HEADING,
      parts: [{ cargo: 'ant', radius: 0.4, headingTolerance: (4 * Math.PI) / 180, seconds: 4 }],
    },
    { kind: 'land', text: 'Return to the yard and land', pad: 'yard' },
  ],
  medals: { gold: 750, silver: 960 },
  timeLimit: 1320,
  cargo: CARGO,
};

const houseColours = [0xf2ede2, 0xe6dcc8, 0xd9e2e6, 0xf0e2c8, 0xe8d0c0];

const chalets = (): BuildingDef[] => {
  const spots: [number, number][] = [
    [-30, -24], [-6, -34], [20, -26], [-36, 6], [28, 8], [-20, 30], [8, 34], [34, 30],
  ];
  return spots.map(([du, dv], i) => ({
    kind: 'cottage' as const,
    ...at(330 + du, 120 + dv),
    w: 9 + (i % 3),
    d: 7,
    h: 4.5,
    turns: i % 2,
    colour: houseColours[i % houseColours.length],
    landable: false,
  }));
};

/** The access road, hairpinning up the foot of the spur until the ground gets too steep. */
const ROAD: [number, number][] = [
  xz(300, -60),
  xz(255, -30),
  xz(215, 20),
  xz(185, -10),
  xz(150, 50),
  xz(120, 15),
];

const buildings: BuildingDef[] = [
  // Yard: site offices, a store and a parked mobile crane's counterweights.
  { kind: 'shop', ...at(282, -40), w: 12, d: 5, h: 3, turns: 1, colour: 0xf4f0e8, landable: false },
  { kind: 'warehouse', ...at(286, -128), w: 18, d: 12, h: 7, colour: 0xc8c2b4, landable: false },
  { kind: 'fuelCanopy', ...at(318, -20), w: 10, d: 8, h: 4.5, landable: false },
  { kind: 'hall', ...VILLAGE, w: 14, d: 10, h: 6, colour: 0xe8dcc4, landable: false },
  ...chalets(),
  // Summit: the mast footing and the site hut.
  { kind: 'footing', ...SUMMIT, w: 4.4, d: 4.4, h: 1.2, top: FOOTING_TOP, colour: 0xb4b0a6, landable: true },
  { kind: 'cabin', ...at(42, 94), w: 8, d: 5, h: 3.2, turns: 1, colour: 0x8f8a80, landable: false },
];

export const SKY_CRANE: LevelDef = {
  id: 'sky-crane',
  name: 'Kesselkopf',
  aircraft: 'mantis',
  mission: MISSION,
  wind: { direction: 3.6, speed: 4.5, gust: 3.5, orographic: 0.6, aloft: { from: 40, to: 200, gain: 1.8 } },
  viewHeight: 130,
  terrain: {
    kind: 'alpine',
    seed: 733,
    size: 1280,
    cellSize: 4,
    edgeStart: 480,
    valleyHeight: VALLEY,
    footU: 250,
    ridgeU: -400,
    ridgeHeight: 300,
    treeLine: 120,
    spurs: [
      { v: 80, width: 70, height: 45 },
      { v: -220, width: 90, height: 55 },
      { v: 330, width: 90, height: 40 },
    ],
    peaks: [
      { ...SUMMIT, radius: 70, height: 105 },
      { ...at(-430, 40), radius: 120, height: 80 },
      { ...at(-380, -300), radius: 90, height: 50 },
    ],
    cliffs: [],
    glacier: { points: [xz(-440, -180), xz(-320, -170), xz(-230, -200)], width: 50 },
    flatten: [
      { ...YARD, radius: 70, falloff: 30, height: VALLEY },
      { ...at(326, -86), radius: 34, falloff: 20, height: VALLEY },
      { ...VILLAGE, radius: 60, falloff: 30, height: VALLEY },
      { ...SUMMIT, radius: 26, falloff: 30, height: SUMMIT_Y },
    ],
    plateaus: [],
  },
  bounds: { minX: -490, maxX: 490, minZ: -490, maxZ: 490 },
  spawnPad: 'yard',
  spawnHeading: Math.PI * 1.25,
  buildings,
  pads: [{ id: 'yard', label: 'Yard', ...YARD, size: 24, service: true }],
  roads: [ROAD, [xz(300, -60), xz(330, 40), [VILLAGE.x, VILLAGE.z]]],
  crowds: [
    // The summit crew, kept back from the footing, and a few hands in the yard.
    { ...at(36, 92), radius: 9, count: 6 },
    { ...at(284, -66), radius: 10, count: 6 },
    { ...VILLAGE, radius: 45, count: 22 },
  ],
  scatter: { trees: 2400, bushes: 380, rocks: 900, boulders: 140 },
  clearings: [
    { ...YARD, radius: 60 },
    { ...at(326, -86), radius: 34 },
    { ...VILLAGE, radius: 55 },
    { ...SUMMIT, radius: 30 },
  ],
};
