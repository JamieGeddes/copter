/** Mass of one rescued passenger, in kg. */
export const PASSENGER_MASS = 85;

/** Handling characteristics for a helicopter type. All units SI (metres, seconds, radians). */
export interface HeliSpec {
  id: string;
  name: string;
  role: string;
  /** Top horizontal speed in m/s. */
  maxSpeed: number;
  /** Horizontal acceleration at full cyclic, m/s². */
  acceleration: number;
  /** How quickly the disc tilt follows the stick (1/s). Lower feels heavier. */
  cyclicResponse: number;
  /**
   * Automatic braking when the stick is released, as a multiple of natural drag.
   * High values make precise hovering easy; heavy machines drift more.
   */
  brakeAssist: number;
  /**
   * Landing cushion: near the ground the descent rate is limited to this many m/s plus
   * `cushionGain` per metre of height, so holding "descend" settles rather than slams.
   */
  cushionSink: number;
  cushionGain: number;
  /** How strongly wind pushes the aircraft (1 = fully, 0 = immune). */
  windFactor: number;
  /** Visual body tilt at full cyclic. */
  maxTilt: number;
  /** Maximum climb or descent rate, m/s. */
  climbRate: number;
  /** How quickly vertical speed follows the collective (1/s). */
  collectiveResponse: number;
  /** Maximum turn rate, rad/s. */
  yawRate: number;
  /** Rotor spool-up rate (fraction per second). */
  spoolRate: number;
  /** Fuel endurance in seconds at hover. */
  fuelEndurance: number;
  /** Vertical/horizontal touchdown speeds above which the landing is hard (m/s). */
  safeSinkRate: number;
  safeGroundSpeed: number;
  /** Impact speed above which the aircraft is destroyed (m/s). */
  crashSpeed: number;
  /** Empty mass in kg; payload reduces performance in proportion. */
  mass: number;
  /** Collision radius of the fuselage and the main rotor. */
  bodyRadius: number;
  bodyHeight: number;
  rotorRadius: number;
  rotorHeight: number;
  /**
   * Rotor discs for collision, as offsets along the fuselage (+ forward). Defaults to a
   * single disc of `rotorRadius` over the centre. Tandem-rotor aircraft list two.
   */
  rotorDiscs?: { offset: number; radius: number }[];
  /** Blade passes per second at full rotor speed, for the rotor sound. */
  bladeRate: number;
  /** Two rotors produce an interleaved, beating chop. */
  twinRotor?: boolean;
  /** Length of the cargo sling, if the aircraft has a cargo hook. */
  slingLength?: number;
  /** Height of the cargo hook above the wheels or skids. */
  hookHeight?: number;
  /** Ceiling above the ground in metres. */
  maxAltitude: number;
  /**
   * Thin air: the height above sea level at which the empty aircraft can only just hover out of
   * ground effect. Rotor thrust falls linearly with altitude to reach it. Leave unset for aircraft
   * whose performance does not depend on altitude.
   */
  serviceCeiling?: number;
  /** Thrust-to-weight ratio when empty at sea level; used with `serviceCeiling`. */
  hoverThrust?: number;
}

export const KESTREL: HeliSpec = {
  id: 'kestrel',
  name: 'Kestrel K-1',
  role: 'Light training helicopter',
  maxSpeed: 38,
  acceleration: 11,
  cyclicResponse: 3.5,
  brakeAssist: 1.6,
  cushionSink: 1.2,
  cushionGain: 0.9,
  windFactor: 1,
  maxTilt: 0.32,
  climbRate: 7,
  collectiveResponse: 2.5,
  yawRate: 2.2,
  spoolRate: 0.35,
  fuelEndurance: 360,
  safeSinkRate: 2.5,
  safeGroundSpeed: 4,
  crashSpeed: 9,
  mass: 1100,
  bladeRate: 10.5,
  // Collision sizes match the model drawn at 1.5x scale.
  bodyRadius: 1.9,
  bodyHeight: 3.3,
  rotorRadius: 6.2,
  rotorHeight: 4.2,
  maxAltitude: 120,
};

/** Twin-engine search and rescue helicopter: stable and long-legged, but heavy to stop. */
export const ALBATROSS: HeliSpec = {
  id: 'albatross',
  name: 'Albatross HAR-3',
  role: 'Search and rescue helicopter',
  maxSpeed: 52,
  acceleration: 8.5,
  cyclicResponse: 2.2,
  brakeAssist: 0.9,
  cushionSink: 1.4,
  cushionGain: 0.7,
  windFactor: 0.85,
  maxTilt: 0.2,
  climbRate: 6,
  collectiveResponse: 1.8,
  yawRate: 1.3,
  spoolRate: 0.22,
  fuelEndurance: 900,
  safeSinkRate: 2.5,
  safeGroundSpeed: 3.5,
  crashSpeed: 9,
  mass: 9500,
  bladeRate: 13,
  bodyRadius: 2.8,
  bodyHeight: 5,
  rotorRadius: 9.4,
  rotorHeight: 6.1,
  maxAltitude: 150,
};

/** Tandem-rotor heavy lifter: slow to start and stop, rock steady in the hover. */
export const HAULER: HeliSpec = {
  id: 'hauler',
  name: 'Hauler CH-4',
  role: 'Tandem-rotor heavy-lift helicopter',
  maxSpeed: 56,
  acceleration: 6.5,
  cyclicResponse: 1.8,
  brakeAssist: 0.6,
  cushionSink: 1.5,
  cushionGain: 0.7,
  windFactor: 0.6,
  maxTilt: 0.15,
  climbRate: 6.5,
  collectiveResponse: 1.6,
  yawRate: 1.0,
  spoolRate: 0.2,
  fuelEndurance: 1000,
  safeSinkRate: 2.5,
  safeGroundSpeed: 3.5,
  crashSpeed: 9,
  mass: 11000,
  bladeRate: 9,
  twinRotor: true,
  slingLength: 14,
  hookHeight: 0.3,
  bodyRadius: 3,
  bodyHeight: 5.6,
  rotorRadius: 7.6,
  rotorHeight: 6.6,
  rotorDiscs: [
    { offset: 6.2, radius: 7.6 },
    { offset: -6.2, radius: 7.6 },
  ],
  maxAltitude: 150,
};

/** Fire service medium helicopter: nimble, but a full bucket takes the edge off its climb and acceleration. */
export const BUCKETEER: HeliSpec = {
  id: 'bucketeer',
  name: 'Bucketeer FH-2',
  role: 'Firefighting helicopter',
  maxSpeed: 46,
  acceleration: 9.5,
  cyclicResponse: 2.8,
  brakeAssist: 1.2,
  cushionSink: 1.3,
  cushionGain: 0.8,
  windFactor: 0.9,
  maxTilt: 0.26,
  climbRate: 6.5,
  collectiveResponse: 2.1,
  yawRate: 1.7,
  spoolRate: 0.28,
  fuelEndurance: 600,
  safeSinkRate: 2.5,
  safeGroundSpeed: 3.8,
  crashSpeed: 9,
  mass: 2600,
  bladeRate: 11,
  slingLength: 12,
  hookHeight: 0.4,
  bodyRadius: 2.1,
  bodyHeight: 4,
  rotorRadius: 7.2,
  rotorHeight: 4.5,
  maxAltitude: 140,
};

/**
 * Light high-altitude rescue helicopter: very responsive with plenty of power low down, but the
 * thin air near the summits takes it away. Carries three passengers and a rescue winch.
 */
export const CHAMOIS: HeliSpec = {
  id: 'chamois',
  name: 'Chamois AS-5',
  role: 'Mountain rescue helicopter',
  maxSpeed: 50,
  acceleration: 12,
  cyclicResponse: 3.6,
  brakeAssist: 1.5,
  cushionSink: 1.2,
  cushionGain: 0.9,
  windFactor: 1,
  maxTilt: 0.3,
  climbRate: 8,
  collectiveResponse: 2.6,
  yawRate: 2.1,
  spoolRate: 0.32,
  fuelEndurance: 720,
  safeSinkRate: 2.5,
  safeGroundSpeed: 4,
  crashSpeed: 9,
  mass: 1100,
  bladeRate: 15,
  bodyRadius: 1.9,
  bodyHeight: 3.4,
  rotorRadius: 5.6,
  rotorHeight: 3.7,
  maxAltitude: 140,
  serviceCeiling: 420,
  hoverThrust: 1.34,
};

export const AIRCRAFT: Record<string, HeliSpec> = {
  [KESTREL.id]: KESTREL,
  [ALBATROSS.id]: ALBATROSS,
  [HAULER.id]: HAULER,
  [BUCKETEER.id]: BUCKETEER,
  [CHAMOIS.id]: CHAMOIS,
};
