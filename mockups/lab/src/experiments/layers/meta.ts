import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'layers',
  order: 3,
  name: 'Layers',
  thesis:
    'Glass taken all the way into the transcript: the colour field runs under the whole window, prose is read directly on it, and every block (a tool run, a diff, a running command, your own message) is a piece of glass standing over it.',
  notes: [
    'Scroll the transcript: the field stays still and the blocks travel over it. Everything thins out before it reaches the tabs or the composer, so glass never passes under glass.',
    'Flip Blocks to Veil and to Opaque: the same layout with the blocks quieted. In light a glass block is nearly white, so look at this in both schemes.',
    'Open a grey caption ("Read 6 files, searched 3 times"): its card grows as glass. Hover a sidebar row for its card; the row that waits is approved from it, or from the orange capsule at the top right.',
    'Hide the side column (top right): the four modules leave one after another, each dematerialising, and only then does the main space take their room.',
    'Flip Field strength: it is how much colour the prose and the glass stand on. Every text line was measured across that range (DESIGN.md).',
    'Cost: content on glass breaks the glass guideline on purpose; a second glass root runs inside the transcript; legibility depends on the field staying graded.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    {
      id: 'blocks',
      label: 'Blocks',
      default: 'glass',
      options: [
        { value: 'glass', label: 'Glass' },
        { value: 'veil', label: 'Veil' },
        { value: 'opaque', label: 'Opaque' },
      ],
    },
    {
      id: 'field',
      label: 'Field strength',
      default: 'warm',
      options: [
        { value: 'whisper', label: 'Whisper' },
        { value: 'soft', label: 'Soft' },
        { value: 'warm', label: 'Warm' },
        { value: 'vivid', label: 'Vivid' },
      ],
    },
    {
      id: 'ground',
      label: 'Ground (light · dark)',
      default: 'warm',
      options: [
        { value: 'warm', label: '#faf9f5 · #191919' },
        { value: 'green', label: '#faf9f5 · #191c19' },
        { value: 'lifted', label: '#ffffff · #1f1f1f' },
        { value: 'pure', label: '#ffffff · #000000' },
      ],
    },
    {
      id: 'face',
      label: 'Typeface',
      default: 'figtree',
      options: [
        { value: 'figtree', label: 'Figtree' },
        { value: 'geist', label: 'Geist' },
        { value: 'system', label: 'System' },
      ],
    },
  ],
  Component: lazy(() => import('./Layers')),
};
