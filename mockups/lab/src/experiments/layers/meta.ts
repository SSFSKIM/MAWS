import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'layers',
  order: 3,
  name: 'Layers',
  thesis:
    'Glass taken all the way into the transcript: the colour field runs under the whole window, prose is read directly on it, and every block (a tool run, a diff, a running command, your own message) is a piece of glass standing over it.',
  notes: [
    'Colour first. Paper is the default: no hue at all, a painted still life of paper lifting into clear glass under the window, ink for the mark, and one serif line on New chat. Look at New chat, then a session, in both schemes.',
    'The other colourings are the comparison set: Peach and Honey (softer warm), Rose and Blue hour (another hue), Opal (several soft hues), Cobalt (full white and full black with one colour), and the orange that was dropped, last. Each brings its own field, shadow tint and "needs you" mark.',
    'Scroll the transcript: the field stays still and the blocks travel over it. Everything thins out before it reaches the tabs or the composer, so glass never passes under glass.',
    'Flip Blocks to Veil and to Opaque: the same layout with the blocks quieted. In light a glass block is nearly white, so look at this in both schemes.',
    'Open a grey caption ("Read 6 files, searched 3 times"): its card grows as glass. Hover a sidebar row for its card; the row that waits is approved from it, or from the capsule at the top right.',
    'Field strength is how far the field departs from its ground: the depth of the shading under Paper, the amount of colour under the others. Every text line was measured across that range (DESIGN.md). Paper and Cobalt bring their own ground; the Ground knob speaks for the rest.',
    'Cost: content on glass breaks the glass guideline on purpose; a second glass root runs inside the transcript; legibility depends on the field staying graded.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    {
      id: 'colour',
      label: 'Colour',
      default: 'paper',
      options: [
        { value: 'paper', label: 'Paper' },
        { value: 'peach', label: 'Peach' },
        { value: 'honey', label: 'Honey' },
        { value: 'rose', label: 'Rose' },
        { value: 'bluehour', label: 'Blue hour' },
        { value: 'opal', label: 'Opal' },
        { value: 'cobalt', label: 'Cobalt' },
        { value: 'orange', label: 'Orange (was)' },
      ],
    },
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
        { value: 'warm', label: 'Full' },
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
