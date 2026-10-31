/**
 * Sea surface displacement. Kept in step with the GLSL in WaterMesh so floating
 * objects bob with the visible waves.
 */
export const WAVE_GLSL = /* glsl */ `
float waveHeight(vec2 p, float t) {
  return 0.22 * sin(0.12 * p.x + 0.07 * p.y + 1.3 * t)
       + 0.14 * sin(-0.09 * p.x + 0.16 * p.y + 1.7 * t)
       + 0.08 * sin(0.25 * p.x - 0.21 * p.y + 2.3 * t);
}
vec2 waveSlope(vec2 p, float t) {
  float a = 0.22 * cos(0.12 * p.x + 0.07 * p.y + 1.3 * t);
  float b = 0.14 * cos(-0.09 * p.x + 0.16 * p.y + 1.7 * t);
  float c = 0.08 * cos(0.25 * p.x - 0.21 * p.y + 2.3 * t);
  return vec2(a * 0.12 - b * 0.09 + c * 0.25, a * 0.07 + b * 0.16 - c * 0.21);
}
`;

export const waveHeight = (x: number, z: number, t: number): number =>
  0.22 * Math.sin(0.12 * x + 0.07 * z + 1.3 * t) +
  0.14 * Math.sin(-0.09 * x + 0.16 * z + 1.7 * t) +
  0.08 * Math.sin(0.25 * x - 0.21 * z + 2.3 * t);
