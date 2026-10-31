import { createAlbatrossModel } from './AlbatrossModel';
import { createHaulerModel } from './HaulerModel';
import { createKestrelModel } from './KestrelModel';
import { HeliVisualParts } from './rotor';

const BUILDERS: Record<string, () => HeliVisualParts> = {
  kestrel: createKestrelModel,
  albatross: createAlbatrossModel,
  hauler: createHaulerModel,
};

export const createHeliModel = (id: string): HeliVisualParts => {
  const build = BUILDERS[id];
  if (!build) throw new Error(`No model for aircraft: ${id}`);
  return build();
};
