import { MissionDef } from '../missions/types';
import { Bounds } from './collision';
import { TerrainConfig } from './Terrain';
import { WindDef } from './Wind';

export type BuildingKind =
  | 'house'
  | 'hall'
  | 'shop'
  | 'hangar'
  | 'waterTower'
  | 'fuelCanopy'
  | 'billboard'
  | 'tank'
  | 'cottage'
  | 'lighthouse'
  | 'hospital'
  | 'station'
  | 'quay'
  | 'capsized'
  | 'barn'
  | 'brokenDeck'
  | 'cabin'
  | 'lookout'
  | 'pylon'
  | 'cableStation'
  /** City: glass office tower with lit windows. */
  | 'tower'
  /** City: brick block of flats with lit windows. */
  | 'flats'
  /** City: low terraced houses with lit windows. */
  | 'terrace'
  | 'warehouse'
  /** A stadium stand facing the pitch on its +z side. */
  | 'stand'
  /** Floodlight mast with a lamp bank at the top. */
  | 'floodlight'
  /** Bridge deck over the river, on piers. */
  | 'bridge'
  /** Tower crane mast; its jib is a wire hazard (see `LevelDef.cableways`). */
  | 'crane'
  /** Thin lattice radio mast with warning lights. */
  | 'mast'
  /** Steel lattice electricity pylon. */
  | 'powerPylon'
  /** Concrete plinth with anchor plates, for a mast to stand on. */
  | 'footing';

export interface BuildingDef {
  kind: BuildingKind;
  x: number;
  z: number;
  /** Footprint along x and z before rotation, and height above its base. */
  w: number;
  d: number;
  h: number;
  /** Absolute roof height; overrides `h` (used for quays standing in water). */
  top?: number;
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
  cacti?: number;
  boulders?: number;
  rocks?: number;
  bushes?: number;
  trees?: number;
  /** Hedgerows along a rotated grid of field boundaries. */
  hedges?: { spacing: number; angle: number; extent: number };
}

/** A wildfire: where it starts, and where nothing can burn. */
export interface FireDef {
  /** Circles that are alight when the mission starts. */
  ignite: { x: number; z: number; radius: number }[];
  /** Seconds the fire has already been burning when the mission starts. */
  headStart: number;
  /** Cleared strips where nothing burns, as polylines with a width in metres. */
  firebreaks: { points: [number, number][]; width: number }[];
  /** Places worth saving (bonus): lost if any cell within `radius` has burned. */
  assets: { id: string; label: string; x: number; z: number; radius: number }[];
}

/** A cable car haul rope, overhead power lines, or the rigid jib of a tower crane. */
export type WireKind = 'cable' | 'power' | 'jib';

export interface LevelDef {
  id: string;
  name: string;
  /** Aircraft id from AIRCRAFT. */
  aircraft: string;
  mission: MissionDef;
  terrain: TerrainConfig;
  /** Sea surface height, if the level has open water. */
  seaLevel?: number;
  /** Look of the water: open sea (default), a muddy river in flood, a still forest lake or a city river at night. */
  waterStyle?: 'sea' | 'river' | 'lake' | 'city';
  wind?: WindDef;
  /** A wildfire burning on a fire grid over the terrain. */
  fire?: FireDef;
  /** Default visible height for the camera in metres. */
  viewHeight?: number;
  bounds: Bounds;
  spawnPad: string;
  spawnHeading: number;
  buildings: BuildingDef[];
  pads: PadDef[];
  roads: [number, number][][];
  crowds: CrowdDef[];
  scatter: ScatterDef;
  /**
   * Wires strung across the tops of the buildings at each point, in order: cable cars, power
   * lines and crane jibs. They are a hazard to the rotor. A point with `y` sets the height there.
   */
  cableways?: { kind?: WireKind; points: { x: number; z: number; y?: number }[] }[];
  /** Dual carriageways, drawn wider than ordinary roads. */
  motorways?: [number, number][][];
  /** Keep-clear circles for scattered props (in addition to buildings, pads and roads). */
  clearings: { x: number; z: number; radius: number }[];
}

