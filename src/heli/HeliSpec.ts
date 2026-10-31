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
  /** Collision radius of the fuselage and the main rotor. */
  bodyRadius: number;
  bodyHeight: number;
  rotorRadius: number;
  rotorHeight: number;
  /** Ceiling above the ground in metres. */
  maxAltitude: number;
}

export const KESTREL: HeliSpec = {
  id: 'kestrel',
  name: 'Kestrel K-1',
  role: 'Light training helicopter',
  maxSpeed: 38,
  acceleration: 11,
  cyclicResponse: 3.5,
  brakeAssist: 1.6,
  maxTilt: 0.32,
  climbRate: 7,
  collectiveResponse: 2.5,
  yawRate: 2.2,
  spoolRate: 0.35,
  fuelEndurance: 360,
  safeSinkRate: 2.5,
  safeGroundSpeed: 4,
  crashSpeed: 9,
  // Collision sizes match the model drawn at 1.5x scale.
  bodyRadius: 1.9,
  bodyHeight: 3.3,
  rotorRadius: 6.2,
  rotorHeight: 4.2,
  maxAltitude: 120,
};
