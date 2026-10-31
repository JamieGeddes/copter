import { createAlbatrossModel } from './AlbatrossModel';
import { createKestrelModel } from './KestrelModel';
import { HeliVisualParts } from './rotor';

const BUILDERS: Record<string, () => HeliVisualParts> = {
  kestrel: createKestrelModel,
  albatross: createAlbatrossModel,
};

export const createHeliModel = (id: string): HeliVisualParts => {
  const build = BUILDERS[id];
  if (!build) throw new Error(`No model for aircraft: ${id}`);
  return build();
};
