import { wrapAngle } from '../core/math';
import type { CargoDef } from './Cargo';
import type { AssemblyPart, ObjectiveDef } from './types';

export type AssembleObjective = Extract<ObjectiveDef, { kind: 'assemble' }>;

/** A part counts as seated when its base is this close to the top of the stack. */
export const SEAT_TOLERANCE = 0.2;

/** What the assembly check needs to know about a load. */
export interface AssemblyLoad {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Sitting still on a support. */
  resting: boolean;
}

/** How far a load is from its seat on the stack, axis by axis. */
export interface AssemblyFit {
  /** Height of the top of the stack, where the load's base must sit. */
  seatY: number;
  /** Horizontal offset from the load to the seat, in world axes. */
  dx: number;
  dz: number;
  lateral: number;
  /** Height of the load's base above the seat. */
  height: number;
  /** Signed heading error in radians: positive means turn clockwise (seen from above) to fix it. */
  heading: number;
  lateralOk: boolean;
  headingOk: boolean;
  /** Resting on the stack, not hanging above it. */
  seated: boolean;
  /** Seated, in position and lined up: the crew can bolt it on. */
  ok: boolean;
}

/**
 * Signed heading error between a load and a target, for a part with `symmetry`-fold rotational
 * symmetry (a square section bolted at its four legs fits at any quarter turn).
 */
export const headingError = (heading: number, target: number, symmetry = 1): number => wrapAngle(symmetry * (heading - target)) / symmetry;

/** Height of the top of the stack once the given parts are in place. */
export const seatHeight = (o: AssembleObjective, fixed: readonly string[], cargo: readonly CargoDef[]): number =>
  fixed.reduce((y, id) => y + (cargo.find((c) => c.id === id)?.h ?? 0), o.y);

/** Measures a load against its seat on top of the stack. */
export const assemblyFit = (load: AssemblyLoad, part: AssemblyPart, o: AssembleObjective, seatY: number): AssemblyFit => {
  const dx = o.x - load.x;
  const dz = o.z - load.z;
  const lateral = Math.hypot(dx, dz);
  const height = load.y - seatY;
  const heading = headingError(load.heading, o.heading, part.symmetry);
  const lateralOk = lateral <= part.radius;
  const headingOk = Math.abs(heading) <= part.headingTolerance;
  const seated = load.resting && Math.abs(height) <= SEAT_TOLERANCE;
  return { seatY, dx, dz, lateral, height, heading, lateralOk, headingOk, seated, ok: seated && lateralOk && headingOk };
};

/** A person on the ground, for checking whether a load hits them. */
export interface Bystander {
  x: number;
  z: number;
}

/** Height of a standing person, and how far beyond a load's edge they still get hit. */
const PERSON_HEIGHT = 1.8;
const PERSON_RADIUS = 0.35;

/**
 * True if a moving load's footprint passes through someone standing on the ground: the load is
 * over them (allowing for its heading) and low enough to hit them.
 */
export const loadHitsPerson = (
  load: { x: number; y: number; z: number; heading: number; def: Pick<CargoDef, 'w' | 'h' | 'd'> },
  p: Bystander,
  groundY: number,
): boolean => {
  if (load.y > groundY + PERSON_HEIGHT || load.y + load.def.h < groundY) return false;
  const s = Math.sin(load.heading);
  const c = Math.cos(load.heading);
  const ox = p.x - load.x;
  const oz = p.z - load.z;
  // Into the load's own axes: local x across it, local z along its heading.
  const lx = ox * c - oz * s;
  const lz = ox * s + oz * c;
  return Math.abs(lx) <= load.def.w / 2 + PERSON_RADIUS && Math.abs(lz) <= load.def.d / 2 + PERSON_RADIUS;
};
