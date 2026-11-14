import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'layers',
  order: 3,
  name: 'Layers',
  thesis:
    'Glass taken all the way into the transcript: the colour field runs under the whole window, prose is read directly on it, and every block (a tool run, a diff, a running command, your own message) is a piece of glass standing over it.',
  notes: [
    'Five calls are yours, and each is a switch below Colour. The first chip of each is the design as it stands. Flip them in this order.',
    '1. Right column, on a session: Four modules, One card, Grows from a button (click the round button at the top right to close it and open it again). Which has the floating feeling you meant?',
    '2. Alignment, on a session and on Settings: On the reading column puts the tabs, the waiting capsule and the composer on the column\'s two edges (Open\'s rule). It pairs well with Grows from a button.',
    '3. "Needs you" mark: Ink badge (today), Soft disc (lighter, no hue), One gold (a single small accent; Approve stays ink). Look in the pane, the tabs and the capsule, in both schemes.',
    '4. Painted form, on Settings and on a session: Everywhere (today), Out of focus where you work (no line behind a word; go to New chat and back to see it come into focus), New chat only.',
    '5. New chat line, on New chat: the serif against the same line in the sans.',
    'What I would choose: Grows from a button, On the reading column, One gold, Out of focus, Serif. Reasons, costs and readings: DESIGN.md section 13.',
    'Colour: Paper is the default (no hue: a painted still life of paper lifting into clear glass, ink for the mark). The other colourings are the comparison set; the three switches marked Paper do nothing under them.',
    'Still true: scroll the transcript and the field stays still while the blocks travel over it; Blocks quiets them (Veil, Opaque); Field strength is how far the field departs from its ground.',
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
      id: 'form',
      label: 'Painted form (Paper)',
      default: 'everywhere',
      options: [
        { value: 'everywhere', label: 'Everywhere' },
        { value: 'recede', label: 'Out of focus where you work' },
        { value: 'home', label: 'New chat only' },
      ],
    },
    {
      id: 'line',
      label: 'New chat line (Paper)',
      default: 'serif',
      options: [
        { value: 'serif', label: 'Serif' },
        { value: 'sans', label: 'Sans' },
      ],
    },
    {
      id: 'mark',
      label: '"Needs you" mark (Paper)',
      default: 'ink',
      options: [
        { value: 'ink', label: 'Ink badge' },
        { value: 'soft', label: 'Soft disc' },
        { value: 'accent', label: 'One gold' },
      ],
    },
    {
      id: 'align',
      label: 'Alignment',
      default: 'layers',
      options: [
        { value: 'layers', label: 'As it is' },
        { value: 'column', label: 'On the reading column' },
      ],
    },
    {
      id: 'side',
      label: 'Right column',
      default: 'modules',
      options: [
        { value: 'modules', label: 'Four modules' },
        { value: 'card', label: 'One card' },
        { value: 'button', label: 'Grows from a button' },
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
