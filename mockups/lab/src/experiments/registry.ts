import type { Experiment } from '../lab/types';

// One entry per experiment, in the order the lab shows them. Each experiment owns its folder and exports `experiment`
// from its meta.ts; nothing is shared between experiments but src/content and src/lab.
import { experiment as smoke } from './smoke/meta';

export const experiments: Experiment[] = [smoke];
