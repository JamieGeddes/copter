import { BufferGeometry, Float32BufferAttribute, MeshLambertMaterial } from 'three';

export type WindowStyle = 'office' | 'flats' | 'houses';

const STYLE_CODE: Record<WindowStyle, number> = { office: 1, flats: 2, houses: 3 };

/**
 * Marks a wall geometry for the window shader: a style, the height of the roof (no windows above
 * it) and a random seed so each building has its own pattern of lit rooms.
 */
export const windowed = (g: BufferGeometry, style: WindowStyle, top: number, seed: number): BufferGeometry => {
  const n = g.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    data[i * 3] = STYLE_CODE[style];
    data[i * 3 + 1] = top;
    data[i * 3 + 2] = seed * 97;
  }
  g.setAttribute('win', new Float32BufferAttribute(data, 3));
  return g;
};

/**
 * Walls with windows drawn procedurally from world position: a grid of panes on every vertical
 * face, dark glass by day and a scatter of warm or cool lit rooms that glow at night. Office
 * towers have wide glazed bays, flats and houses smaller windows.
 */
export const windowMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

windowMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec3 win;
varying vec3 vWin;
varying vec3 vWinPos;
varying vec3 vWinNormal;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vWin = win;
vWinPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWinNormal = normal;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vWin;
varying vec3 vWinPos;
varying vec3 vWinNormal;
float winHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
float winPane = 0.0;
vec3 winGlow = vec3(0.0);
if (abs(vWinNormal.y) < 0.5) {
  float style = vWin.x;
  float along = abs(vWinNormal.x) > 0.5 ? vWinPos.z : vWinPos.x;
  vec2 bay = style < 1.5 ? vec2(3.0, 3.6) : style < 2.5 ? vec2(3.4, 3.0) : vec2(4.2, 2.9);
  vec2 pane = style < 1.5 ? vec2(0.88, 0.66) : style < 2.5 ? vec2(0.42, 0.5) : vec2(0.36, 0.46);
  vec2 g = vec2(along / bay.x, (vWinPos.y - 4.2) / bay.y);
  vec2 cell = floor(g);
  vec2 f = abs(fract(g) - 0.5);
  float inside = step(f.x, pane.x * 0.5) * step(f.y, pane.y * 0.5);
  // Not below the first floor nor above the roof line.
  inside *= step(0.0, g.y) * step(vWinPos.y + bay.y * 0.4, vWin.y);
  winPane = inside;
  float h = winHash(cell + vec2(vWin.z, dot(vWinNormal.xz, vec2(13.1, 71.7))));
  float lit = step(style < 1.5 ? 0.56 : 0.58, h);
  vec3 warm = mix(vec3(1.0, 0.74, 0.42), vec3(1.0, 0.86, 0.6), fract(h * 7.3));
  vec3 cool = vec3(0.72, 0.84, 1.0);
  vec3 tint = fract(h * 11.0) < (style < 1.5 ? 0.45 : 0.12) ? cool : warm;
  winGlow = inside * lit * tint * (0.55 + 0.45 * fract(h * 17.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.15, 0.2), inside * 0.8);
}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
totalEmissiveRadiance += winGlow * 1.15;`,
    );
};
windowMaterial.customProgramCacheKey = () => 'windows';
