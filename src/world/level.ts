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
  | 'brokenDeck';

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

export interface LevelDef {
  id: string;
  name: string;
  /** Aircraft id from AIRCRAFT. */
  aircraft: string;
  mission: MissionDef;
  terrain: TerrainConfig;
  /** Sea surface height, if the level has open water. */
  seaLevel?: number;
  /** Look of the water: open sea (default) a muddy river in flood, or a still forest lake. */
  waterStyle?: 'sea' | 'river' | 'lake';
  wind?: WindDef;
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
  /** Keep-clear circles for scattered props (in addition to buildings, pads and roads). */
  clearings: { x: number; z: number; radius: number }[];
}

