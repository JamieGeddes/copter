import type { CargoDef } from './Cargo';

export type { CargoDef };

export interface GateDef {
  x: number;
  z: number;
  /** Altitude of the gate centre above the ground. */
  alt: number;
  radius: number;
  /** Facing angle of the hoop (radians). */
  facing: number;
}

export type ObjectiveDef =
  | { kind: 'takeoff'; text: string }
  | { kind: 'hover'; text: string; x: number; z: number; radius: number; minAlt: number; maxAlt: number; seconds: number }
  | { kind: 'gates'; text: string; gates: GateDef[] }
  | { kind: 'land'; text: string; pad: string }
  | { kind: 'rescue'; text: string; survivors: string[] }
  | { kind: 'deliver'; text: string; pad: string }
  | { kind: 'hook'; text: string; cargo: string }
  /** Fill the water bucket. */
  | { kind: 'fill'; text: string }
  /**
   * Keep every cell of a zone fire-free for `seconds`. Any fire inside the zone fails the mission,
   * from the start of the mission until this objective completes. With `orExtinguished`, putting the
   * whole fire out also completes it.
   */
  | { kind: 'protect'; text: string; label: string; x: number; z: number; radius: number; seconds: number; orExtinguished?: boolean }
  /** Put out every burning cell. */
  | { kind: 'extinguish'; text: string }
  /**
   * Answer a series of emergency calls: collect each casualty from its scene and land them on the
   * roof of the hospital that treats them before their timer runs out.
   */
  | { kind: 'casualties'; text: string; casualties: string[] }
  | {
      kind: 'place';
      text: string;
      /** Loads that must all be set down and released inside the zone. */
      cargo: string[];
      label: string;
      x: number;
      z: number;
      radius: number;
      /** Required load heading, if any. Loads are treated as end-for-end symmetric. */
      heading?: number;
      headingTolerance?: number;
    };

export type SurvivorPlacement = 'water' | 'boat' | 'rocks' | 'ledge' | 'snow';

export interface SurvivorDef {
  id: string;
  x: number;
  z: number;
  placement: SurvivorPlacement;
  /** Height of the surface the survivor is on (0 for water). */
  y: number;
  /** Winched up from a hover (default), or walks to the aircraft once it lands nearby. */
  pickup?: 'winch' | 'landing';
  /** Name of the place, for messages such as cloud warnings. */
  site?: string;
}

/** A cloud layer whose base lowers through the mission, closing off the highest sites first. */
export interface WeatherDef {
  /** Cloud base height above sea level at the start and the end of the descent. */
  cloudStart: number;
  cloudEnd: number;
  /** Seconds the cloud base takes to come down. */
  duration: number;
  /** Seconds the aircraft can spend in cloud before the pilot is fatally disoriented. */
  maxExposure: number;
}

/** Which hospital a casualty needs. */
export type CasualtyCare = 'trauma' | 'burns';

/** An emergency call: a casualty at a scene who must reach the right hospital in time. */
export interface CasualtyDef {
  id: string;
  /** Name of the incident, such as "Motorway collision". */
  label: string;
  severity: 'critical' | 'serious';
  care: CasualtyCare;
  /** Pad of the hospital that treats this casualty. */
  hospital: string;
  /** Centre of the cordoned landing zone, and its radius. */
  x: number;
  z: number;
  radius: number;
  /**
   * Seconds after the calls begin when this call comes in. A call may come in sooner when the
   * crew has nothing else to do.
   */
  callAt: number;
  /** Seconds from the call until the casualty is lost if not handed over at the hospital. */
  timer: number;
  /** Handed over within this many seconds of the call counts as inside the golden hour. */
  golden: number;
  /** Where the fire is burning at the scene, if there is one: flames, smoke and a glow. */
  fire?: { x: number; z: number };
  /** No street lighting: the searchlight is needed to find the zone. */
  dark?: boolean;
}

export interface MedalTimes {
  /** Finishing times in seconds. */
  gold: number;
  silver: number;
}

export interface MissionDef {
  id: string;
  title: string;
  /** Short line for the mission select screen. */
  summary: string;
  /** Skill the mission teaches. */
  skill: string;
  briefing: string[];
  objectives: ObjectiveDef[];
  medals: MedalTimes;
  timeLimit?: number;
  /** Passenger capacity for rescue missions. */
  capacity?: number;
  survivors?: SurvivorDef[];
  /** A circle to point the player at while searching. */
  searchArea?: { x: number; z: number; radius: number; label: string };
  /** Distance at which survivors become visible on the HUD. */
  spotRange?: number;
  /** Underslung loads for heavy-lift missions. */
  cargo?: CargoDef[];
  /** A lowering cloud layer. */
  weather?: WeatherDef;
  /** Emergency calls for a `casualties` objective. */
  casualties?: CasualtyDef[];
}
