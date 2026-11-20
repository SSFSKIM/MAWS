import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'signal',
  order: 50,
  name: 'Signal',
  thesis:
    'The colour under the sidebar’s glass is the state of each session: warm where one needs you, moving where one runs, nothing where one rests, so the status words can go.',
  notes: [
    'Squint at the sidebar: the three warm pools are the approval, the question and the plan; the travelling cool one is the running session; the small ember is the unread one.',
    'Open “Fix flaky upload test” (the row with the pause bead) and approve or deny: the light changing is the only motion at rest. Option-click any session to step it through every state.',
    'Collapse the sidebar: the rail keeps only the beads and their light. Fold atlas-api: its light moves up into the project name.',
    'Hover a row for its sentence; flip Sentences to compare with the words printed. Flip Lens to see the same field with no glass over it.',
    'Costs: hue carries meaning here, which the glass library’s own guidance warns against; with transparency reduced or on the CSS tier only the beads remain.',
  ],
  scenes: ['session', 'settings'],
  knobs: [
    {
      id: 'words',
      label: 'Sentences',
      options: [
        { value: 'hover', label: 'On hover' },
        { value: 'shown', label: 'Printed' },
      ],
      default: 'hover',
    },
    {
      id: 'field',
      label: 'Field strength',
      options: [
        { value: 'soft', label: 'Soft' },
        { value: 'full', label: 'Full' },
        { value: 'vivid', label: 'Vivid' },
      ],
      default: 'full',
    },
    {
      id: 'ground',
      label: 'Ground',
      options: [
        { value: 'paper', label: '#faf9f5 · #191919' },
        { value: 'pure', label: '#ffffff · #000000' },
        { value: 'moss', label: '#faf9f5 · #191c19' },
        { value: 'lift', label: '#ffffff · #1f1f1f' },
      ],
      default: 'paper',
    },
    {
      id: 'lens',
      label: 'Lens',
      options: [
        { value: 'glass', label: 'Glass' },
        { value: 'bare', label: 'No glass' },
      ],
      default: 'glass',
    },
  ],
  Component: lazy(() => import('./Signal')),
};
