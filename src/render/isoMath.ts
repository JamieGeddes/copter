/** Ground-plane basis vectors for an isometric camera at the given yaw (radians). */
export interface GroundBasis {
  rightX: number;
  rightZ: number;
  upX: number;
  upZ: number;
}

/**
 * The camera sits at (sin yaw, cos yaw) from its target on the ground plane, looking back
 * towards it. "Up the screen" is therefore the direction away from the camera.
 */
export const groundBasis = (yaw: number): GroundBasis => ({
  rightX: Math.cos(yaw),
  rightZ: -Math.sin(yaw),
  upX: -Math.sin(yaw),
  upZ: -Math.cos(yaw),
});

/** Maps a screen-relative stick (x right, y up) to a world-space direction on the ground. */
export const screenToWorld = (basis: GroundBasis, sx: number, sy: number): { x: number; z: number } => ({
  x: basis.rightX * sx + basis.upX * sy,
  z: basis.rightZ * sx + basis.upZ * sy,
});
