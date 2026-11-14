import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'quiet',
  order: 60,
  name: 'Quiet',
  thesis:
    'No material at all: one flat ground, hairlines of ink, round continuous corners, one floating composer, and words kept off the screen until asked for.',
  notes: [
    'The control: nothing here is glass. If this already feels like what was asked for, the wish was roundness, space and subtraction.',
    'Orange appears only where it is your move: the three waiting sessions, the capsule at the top right, Approve, and Send.',
    'Hover a sidebar row: the state glyph steps aside for actions and a card brings the second line. Approve from it.',
    'Open a grey caption in the transcript, collapse both columns, open the model and usage popovers: every overlay moves.',
    'Settings: hover a row for its sentence in the margin, then flip Help text. Flip Prose to see the serif earn or lose its place.',
    'Cost: with no surface steps the page leans entirely on type and spacing; on white or black the sidebar has only its hairline.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
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
      id: 'round',
      label: 'Roundness',
      default: 'rounder',
      options: [
        { value: 'today', label: "Today's radii" },
        { value: 'rounder', label: 'Rounder' },
        { value: 'roundest', label: 'Roundest' },
      ],
    },
    {
      id: 'help',
      label: 'Help text (settings)',
      default: 'hover',
      options: [
        { value: 'sentence', label: 'One sentence' },
        { value: 'hover', label: 'On hover' },
        { value: 'expander', label: 'Expander' },
      ],
    },
    {
      id: 'prose',
      label: 'Assistant prose',
      default: 'serif',
      options: [
        { value: 'serif', label: 'Serif' },
        { value: 'sans', label: 'Sans' },
      ],
    },
  ],
  Component: lazy(() => import('./Quiet')),
};
