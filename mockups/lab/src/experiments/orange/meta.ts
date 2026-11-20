import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'orange',
  order: 4,
  name: 'Orange',
  thesis:
    'The window is the owner’s orange itself, #FD780F, and everything stands on it as a floating pane of glass: the sidebar, the tab capsule, the transcript, the side column, the composer.',
  notes: [
    'Flip Orange first: Full is the brief, Deepened and As light are what a working day might ask for instead. Then flip the scheme: dark here means dark glass over the same orange.',
    'The transcript is read on glass. Read a paragraph and the diff, then flip Reading to Veil and Opaque: that difference is what the idea costs or buys.',
    'No mark is orange, because the world is. What waits for you is the one opaque thing among glass: a solid disc in the sidebar and the tabs, the solid capsule at the top right, Approve, and Send once you type.',
    'Collapse both side panes (their toggles stay put on a puck of glass), open the capsule and approve, hover a sidebar row, open a grey caption, the model menu, the rings.',
    'New chat is the ground with one sheet of glass on it. Settings is Quiet’s page with Instrument’s pills and springs; hover a row for its sentence.',
    'Every surface is drawn with CSS, not the glass library: over this orange the library’s body comes back salmon (hue 14 against 26.5). DESIGN.md has the readings.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    {
      id: 'orange',
      label: 'Orange',
      default: 'full',
      options: [
        { value: 'full', label: 'Full #FD780F' },
        { value: 'deep', label: 'Deepened' },
        { value: 'light', label: 'As light on a ground' },
      ],
    },
    {
      id: 'reading',
      label: 'Reading surface',
      default: 'glass',
      options: [
        { value: 'glass', label: 'Glass' },
        { value: 'veil', label: 'Veil' },
        { value: 'opaque', label: 'Opaque' },
      ],
    },
    {
      id: 'type',
      label: 'Typeface',
      default: 'figtree',
      options: [
        { value: 'figtree', label: 'Figtree' },
        { value: 'geist', label: 'Geist' },
        { value: 'system', label: 'System' },
      ],
    },
    {
      id: 'ground',
      label: 'Plain ground (light · dark)',
      default: 'a',
      options: [
        { value: 'a', label: '#faf9f5 · #191919' },
        { value: 'b', label: '#faf9f5 · #191c19' },
        { value: 'c', label: '#ffffff · #1f1f1f' },
        { value: 'd', label: '#ffffff · #000000' },
      ],
    },
  ],
  Component: lazy(() => import('./Orange')),
};
