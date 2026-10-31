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
  | { kind: 'deliver'; text: string; pad: string };

export type SurvivorPlacement = 'water' | 'boat' | 'rocks';

export interface SurvivorDef {
  id: string;
  x: number;
  z: number;
  placement: SurvivorPlacement;
  /** Height of the surface the survivor is on (0 for water). */
  y: number;
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
}
