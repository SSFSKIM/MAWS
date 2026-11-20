import { all } from 'virtual:experiments';
import type { Experiment } from '../lab/types';

/** Every experiment folder that has a meta.ts, in the order of their `order` field. */
export const experiments: Experiment[] = [...all].sort((a, b) => a.order - b.order);
