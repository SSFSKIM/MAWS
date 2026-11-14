import { lazy } from 'react';
import type { Experiment } from '../../lab/types';
import { COLOURINGS, DEFAULT_COLOUR } from '../layers/colour';
import { experiment as layers } from '../layers/meta';

// The Colour switch is Layers' list of colourings, read where it is kept, so a colouring added there appears here
// with no change to this file. Layers' own switch supplies the names; one it has not named is shown by its id.
const named = new Map((layers.knobs?.find((k) => k.id === 'colour')?.options ?? []).map((o) => [o.value, o.label]));
const title = (id: string) => id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const colours = Object.keys(COLOURINGS).map((id) => ({ value: id, label: named.get(id) ?? title(id) }));

export const experiment: Experiment = {
  id: 'open',
  order: 2,
  name: 'Open',
  thesis:
    'No sheet and no drawing: one plain ground, with light that gathers only where glass stands (the left pane, the right pane, the composer) and the transcript read on the bare ground between them, under the floating glass tabs and composer.',
  notes: [
    'Colour is the same switch as Layers\', reading the same colourings, so the two can be compared in one colour. Open takes a colouring\'s ground, ink, mark and the colours of its light, and leaves its painted form out: Paper here is ivory, glass and a warm lamp under the glass.',
    'Under Paper look at the light: amber under the two panes and around the composer, plain ivory everywhere a word is read. Field strength turns it down to almost hueless (Whisper) or up (Vivid); the dark scheme shows it most.',
    'Scroll the transcript: it passes under the tabs and under the composer, on the ground and not on glass. Tool runs, diffs and commands are quiet rings; Layers answers the same content with every block as glass over a drawing.',
    'The right pane grows out of the round button at the top right and goes back into it. The left pane slides away from the button beside the traffic lights and takes its light with it.',
    'Three sessions wait: the capsule at the top right holds their three glyphs in the colouring\'s mark (ink under Paper) and opens the list; hovering the waiting row in the sidebar opens the card with the command and Approve.',
    'Typeface is now the system face (Quiet\'s); Figtree and Geist are still on the knob.',
    'Cost: with no sheet, no drawing and no glass blocks, nothing but spacing and a hairline parts one thing from the next, and New chat is an empty ground with one pool of light.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    { id: 'colour', label: 'Colour', default: DEFAULT_COLOUR, options: colours },
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
      // The owner's ruling: Quiet's face, which is the system face. The other two stay reachable.
      default: 'system',
      options: [
        { value: 'system', label: 'System (Quiet)' },
        { value: 'figtree', label: 'Figtree (Field, Layers)' },
        { value: 'geist', label: 'Geist (Instrument)' },
      ],
    },
  ],
  Component: lazy(() => import('./Open')),
};
