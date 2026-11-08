import { Color, Material } from 'three';

/** No cloud: the base is far above anything in the scene. */
export const CLEAR_SKY = 1e6;

/**
 * Shared uniforms for the cloud layer. Anything drawn above the cloud base fades into the cloud
 * colour, so slopes, buildings and the aircraft disappear as the cloud comes down over them.
 */
export const cloudUniforms = {
  cloudBase: { value: CLEAR_SKY },
  cloudColour: { value: new Color(0xdfe4e8) },
};

const patched = new WeakSet<Material>();

/**
 * Adds the cloud fade to a material, keeping any shader changes it already has. Call after
 * setting the material's own `onBeforeCompile`. Safe to call more than once.
 */
export const addCloud = (material: Material): void => {
  if (patched.has(material)) return;
  patched.add(material);
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.cloudBase = cloudUniforms.cloudBase;
    shader.uniforms.cloudColour = cloudUniforms.cloudColour;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCloudY;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
vCloudY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
#else
vCloudY = (modelMatrix * vec4(transformed, 1.0)).y;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCloudY;\nuniform float cloudBase;\nuniform vec3 cloudColour;')
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, cloudColour, smoothstep(cloudBase - 8.0, cloudBase + 22.0, vCloudY) * 0.94);`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey()}|cloud`;
};
