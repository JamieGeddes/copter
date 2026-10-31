/** Axis-aligned solid block standing on the ground (buildings, rocks, cacti). */
export interface Solid {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  /** Whether the roof is a safe landing surface. */
  landable: boolean;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CircleHit {
  /** Push-out normal on the ground plane. */
  nx: number;
  nz: number;
  penetration: number;
}

/** Circle (on the XZ plane) against an AABB footprint. Returns null if they do not overlap. */
export const circleVsSolid = (x: number, z: number, r: number, s: Solid): CircleHit | null => {
  const cx = Math.min(Math.max(x, s.minX), s.maxX);
  const cz = Math.min(Math.max(z, s.minZ), s.maxZ);
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, penetration: r - d };
  }
  // Centre is inside the footprint: push out along the shallowest axis.
  const left = x - s.minX;
  const right = s.maxX - x;
  const back = z - s.minZ;
  const front = s.maxZ - z;
  const m = Math.min(left, right, back, front);
  if (m === left) return { nx: -1, nz: 0, penetration: left + r };
  if (m === right) return { nx: 1, nz: 0, penetration: right + r };
  if (m === back) return { nx: 0, nz: -1, penetration: back + r };
  return { nx: 0, nz: 1, penetration: front + r };
};

export const pointInSolid = (x: number, z: number, s: Solid): boolean =>
  x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ;
