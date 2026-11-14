import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'open',
  order: 2,
  name: 'Open',
  thesis:
    'No sheet: one plain ground, with the colour field as light that gathers only where glass stands (the left pane, the right pane, the composer) and the transcript running on the ground between them, under the floating glass tabs and composer.',
  notes: [
    'Parts: Field\'s left pane with Quiet\'s rows inside it; Instrument\'s tab capsule; a glass composer; Quiet\'s transcript without the serif; a right pane that is one piece of glass.',
    'Scroll the transcript: it passes under the tabs and under the composer. That is where the glass shows. Flip Field strength to see how much light each control needs under it, in light and in dark.',
    'The right pane grows out of the round button at the top right and goes back into it. The left pane slides away from the button beside the traffic lights.',
    'Three sessions wait: the orange capsule at the top right holds their three glyphs and opens the list; hovering the waiting row in the sidebar opens the card with the command and Approve.',
    'Open "Read 6 files, searched 3 times", then flip Tool blocks to Glass: the same card, the diff and the running command become glass standing on their own light.',
    'Cost: with no sheet, nothing but spacing parts the transcript from the panes, and in light the glass over the reading ground is faint until something passes under it.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
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
        { value: 'figtree', label: 'Figtree (Field)' },
        { value: 'geist', label: 'Geist (Instrument)' },
        { value: 'system', label: 'System' },
      ],
    },
    {
      id: 'tools',
      label: 'Tool blocks',
      default: 'quiet',
      options: [
        { value: 'quiet', label: 'Quiet (rings)' },
        { value: 'glass', label: 'Glass' },
      ],
    },
  ],
  Component: lazy(() => import('./Open')),
};
