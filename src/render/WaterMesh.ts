import { DataTexture, LinearFilter, Mesh, MeshPhongMaterial, PlaneGeometry, RedFormat, UnsignedByteType } from 'three';
import { Terrain } from '../world/Terrain';
import { WAVE_GLSL } from '../world/waves';

const H_MIN = -30;
const H_MAX = 10;

/** Encodes terrain heights into an 8-bit texture so the water shader knows the depth. */
const heightTexture = (terrain: Terrain): DataTexture => {
  const n = terrain.verts;
  const data = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const t = (terrain.heights[i] - H_MIN) / (H_MAX - H_MIN);
    data[i] = Math.max(0, Math.min(255, Math.round(t * 255)));
  }
  const tex = new DataTexture(data, n, n, RedFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
};

export interface Water {
  mesh: Mesh;
  update(time: number): void;
}

/** Animated sea with depth-based colour, transparency over shallows and shoreline foam. */
export const createWater = (terrain: Terrain, seaLevel: number): Water => {
  const size = terrain.size * 3;
  const geometry = new PlaneGeometry(size, size, 300, 300);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshPhongMaterial({
    color: 0xffffff,
    specular: 0x6a7a80,
    shininess: 70,
    transparent: true,
  });
  const uniforms = {
    uTime: { value: 0 },
    uHeights: { value: heightTexture(terrain) },
    uTerrainSize: { value: terrain.size },
    uSeaLevel: { value: seaLevel },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
varying vec3 vWorldPos;
${WAVE_GLSL}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec2 slope = waveSlope(position.xz, uTime);
vec3 objectNormal = normalize(vec3(-slope.x, 1.0, -slope.y));`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
transformed.y += waveHeight(position.xz, uTime);
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform sampler2D uHeights;
uniform float uTerrainSize;
uniform float uSeaLevel;
varying vec3 vWorldPos;
float whash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(whash(i), whash(i + vec2(1.0, 0.0)), u.x), mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 uv = (vWorldPos.xz + uTerrainSize * 0.5) / uTerrainSize;
  float h = mix(${H_MIN.toFixed(1)}, ${H_MAX.toFixed(1)}, texture2D(uHeights, clamp(uv, 0.0, 1.0)).r);
  float depth = uSeaLevel - h;
  vec3 shallow = vec3(0.30, 0.66, 0.66);
  vec3 mid = vec3(0.10, 0.42, 0.52);
  vec3 deep = vec3(0.05, 0.24, 0.36);
  vec3 col = mix(shallow, mid, smoothstep(0.5, 6.0, depth));
  col = mix(col, deep, smoothstep(6.0, 22.0, depth));
  float n = wnoise(vWorldPos.xz * 0.08 + vec2(uTime * 0.05, uTime * 0.03));
  col *= 0.92 + n * 0.16;
  // Foam along the shore, pulsing with the surf.
  float surf = 0.55 + 0.45 * sin(uTime * 1.6 - depth * 5.0 + n * 4.0);
  float foam = (1.0 - smoothstep(0.0, 1.4, depth + (n - 0.5) * 0.8)) * surf;
  // Small, sparse whitecap streaks drifting with the swell.
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * vWorldPos.xz;
  float streak = wnoise(q * vec2(0.45, 0.13) + vec2(uTime * 0.4, 0.0));
  float sparse = smoothstep(0.58, 0.8, wnoise(vWorldPos.xz * 0.015 + uTime * 0.02));
  float caps = smoothstep(0.86, 0.93, streak) * sparse * smoothstep(3.0, 10.0, depth) * 0.55;
  col = mix(col, vec3(0.95, 0.97, 0.96), clamp(foam + caps, 0.0, 1.0));
  diffuseColor.rgb = col;
  diffuseColor.a = clamp(mix(0.45, 1.0, smoothstep(0.0, 9.0, depth)) + foam * 0.5, 0.0, 1.0);
}`,
      );
  };
  const mesh = new Mesh(geometry, material);
  mesh.position.y = seaLevel;
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  return {
    mesh,
    update(time: number) {
      uniforms.uTime.value = time;
    },
  };
};
