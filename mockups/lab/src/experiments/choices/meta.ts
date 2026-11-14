import { lazy } from 'react';
import type { Experiment } from '../../lab/types';
import { GROUNDS, PARTS } from './parts';

export const experiment: Experiment = {
  id: 'choices',
  order: 0.5,
  name: 'Choices',
  thesis:
    'Not a design: a board. Each smaller part of the Layers session view that nobody has judged yet stands here in two to four variants that differ in kind, at true size on the real glass over the Paper field, so each can be answered with a letter.',
  notes: [
    'The pane on the left is the index. Pick a part there, or step with the up and down arrow keys. D flips the scheme, as everywhere in the lab.',
    'The owner took the suggested set (2026-11-14) and it is in Layers now; this board stays as the record of the alternatives. A is each part as Layers had it before; the tag "in Layers now" marks the form that was taken. The other letters each drop something A treats as necessary.',
    'Click a letter to mark your pick. The picks collect in the pane and the button at its foot copies them as one line ("message B, diff A").',
    'Parts with something behind a click have a switch at the top right, At rest and Opened, that opens every variant at once (key O). Motion parts have Replay (key R).',
    'Dark ground: the Ground page shows Paper\'s own against the four candidates in one window; the knob below repaints the whole board on any one of them.',
    'Together, last in the pane, sets one transcript and its composer in the letters picked so far; its switch compares them with Layers as it was (Before) and with the set that was taken (In Layers).',
    'Needs you: a question and a plan, the two waiting states no round had drawn. Each page shows, above, what the waiting capsule\'s list would hold and, below, what the session would hold; choose where each is answered.',
    'Not judged here: anything the owner already chose (pane, tabs, the composer as a whole, the tool-run summary, the approval, settings).',
  ],
  scenes: ['session'],
  knobs: [
    { id: 'part', label: 'Part', default: PARTS[0]!.id, options: PARTS.map((p) => ({ value: p.id, label: p.name })) },
    { id: 'ground', label: 'Dark ground', default: 'own', options: GROUNDS.dark.map((g) => ({ value: g.id, label: g.id === 'own' ? `${g.hex} (Paper)` : g.hex })) },
  ],
  Component: lazy(() => import('./Choices')),
};
