import { createAlbatrossModel } from './AlbatrossModel';
import { createBucketeerModel } from './BucketeerModel';
import { createHaulerModel } from './HaulerModel';
import { createKestrelModel } from './KestrelModel';
import { HeliVisualParts } from './rotor';

const BUILDERS: Record<string, () => HeliVisualParts> = {
  kestrel: createKestrelModel,
  albatross: createAlbatrossModel,
  hauler: createHaulerModel,
  bucketeer: createBucketeerModel,
};

export const createHeliModel = (id: string): HeliVisualParts => {
  const build = BUILDERS[id];
  if (!build) throw new Error(`No model for aircraft: ${id}`);
  return build();
};
