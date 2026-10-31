import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import { clamp, smoothstep } from '../core/math';
import { Noise2D } from '../world/noise';
import { Terrain } from '../world/Terrain';

const SAND = new Color(0xe4bb80);
const SAND_LIGHT = new Color(0xf0d2a0);
const SAND_DARK = new Color(0xd1a368);
const PACKED = new Color(0xd6ae7e);
const RIVER = new Color(0xeddcb6);
const ROCK = [new Color(0xb4623f), new Color(0xc87c4f), new Color(0x9c5236), new Color(0xd39463)];
const MESA_TOP = new Color(0xc28a58);

/** Builds the terrain mesh with vertex colours and a world-space grain shader. */
export const createTerrainMesh = (terrain: Terrain): Mesh => {
  const v = terrain.verts;
  const positions = new Float32Array(v * v * 3);
  const colours = new Float32Array(v * v * 3);
  const noise = new Noise2D(4242);
  const c = new Color();

  for (let iz = 0; iz < v; iz++) {
    for (let ix = 0; ix < v; ix++) {
      const i = terrain.index(ix, iz);
      const x = terrain.vertexX(ix);
      const z = terrain.vertexZ(iz);
      const h = terrain.heights[i];
      positions[i * 3] = x;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = z;

      const slope = terrain.slopeAt(x, z);
      const dune = terrain.dune[i];
      const macro = noise.fbm(x / 90, z / 90, 3);

      // Sand: lighter on dune crests, darker in hollows, with broad patches.
      c.copy(SAND).lerp(SAND_DARK, clamp(0.5 - dune * 0.8 + macro * 0.6, 0, 1) * 0.7);
      c.lerp(SAND_LIGHT, clamp(dune * 1.1 - 0.35, 0, 1));
      c.lerp(PACKED, terrain.packed[i] * 0.55);
      c.lerp(RIVER, terrain.river[i] * 0.85);

      // High flat ground (mesa tops) is darker and stonier.
      c.lerp(MESA_TOP, smoothstep(14, 22, h) * (1 - smoothstep(0.05, 0.2, slope)) * 0.7);

      // Cliffs show banded strata.
      const rockMix = smoothstep(0.18, 0.4, slope);
      if (rockMix > 0) {
        const band = Math.floor(h / 2.6 + noise.noise(x / 40, z / 40) * 1.5);
        const rock = ROCK[((band % ROCK.length) + ROCK.length) % ROCK.length];
        c.lerp(rock, rockMix);
      }
      colours[i * 3] = c.r;
      colours[i * 3 + 1] = c.g;
      colours[i * 3 + 2] = c.b;
    }
  }

  // Same triangulation as Terrain.heightAt: (a, b, d) and (b, c, d) per cell.
  const cells = terrain.cells;
  const indices = new Uint32Array(cells * cells * 6);
  let k = 0;
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const a = terrain.index(ix, iz);
      const b = terrain.index(ix, iz + 1);
      const cc = terrain.index(ix + 1, iz + 1);
      const d = terrain.index(ix + 1, iz);
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = b;
      indices[k++] = cc;
      indices[k++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vWorldPos.xz;
  float grain = (vnoise(p * 4.0) - 0.5) * 0.06 + (vnoise(p * 1.3) - 0.5) * 0.08;
  vec2 cell = floor(p * 0.9);
  vec2 local = fract(p * 0.9);
  vec2 centre = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) * 0.7 + 0.15;
  float radius = 0.05 + hash12(cell + 1.3) * 0.08;
  float isPebble = step(0.72, hash12(cell + 17.0));
  float pebble = isPebble * smoothstep(radius, radius * 0.6, length(local - centre)) * 0.32;
  float ripple = sin(dot(p, vec2(0.83, 0.55)) * 2.4 + vnoise(p * 0.15) * 6.0) * 0.025;
  float patches = (vnoise(p * 0.035) - 0.5) * 0.12;
  diffuseColor.rgb *= (1.0 + grain + ripple + patches) * (1.0 - pebble);
}`,
      );
  };

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
};
