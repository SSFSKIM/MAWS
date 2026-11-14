import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'smoke',
  name: 'Smoke test',
  thesis: 'Not a design: proves the glass library draws real refraction in this lab.',
  notes: ['The readout in the corner says which renderer drew.'],
  scenes: ['session'],
  Component: lazy(() => import('./Smoke')),
};
