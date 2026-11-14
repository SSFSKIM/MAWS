import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'layers',
  order: 0,
  name: 'Layers',
  thesis:
    'Glass taken into the transcript: the colour field runs under the whole window, prose is read directly on it, and what the agent made that can be opened (a tool run, an edit, a running command) is a piece of glass standing over it.',
  notes: [
    'This is the design as you have answered it so far: Warm paper, the orange disc for "waiting on you", the drawing blurred behind text, everything lined up on the reading column, the right column as a button that opens, the system face. Every earlier position is still one chip away below.',
    'New, and first: the suggested set from the Choices board is in. Your own message is a wash, not glass; thinking is the first row of the run it led to; an edit is a caption and a sheet of code; what runs is a capsule; agents are chips; the queued message waits above the composer; the model appears as you approach the composer; stop and send are two things; usage is one drop. Tell me what looks wrong.',
    'The three sessions that wait can be opened now. Press "Fix flaky upload test", "Billing webhook audit" or "Offline sync design" in the pane (or their tabs, or the arrow in the list the orange capsule opens). Each is answered in its own composer: Approve or Deny, the question\'s chips one question at a time, Approve for the plan. Typing is always the other answer.',
    'The same answers from elsewhere: open the capsule (one item opens at a time), or rest on a waiting row for its card. Answer in either place and watch the other: the session goes back to work, its orange disc leaves the pane, the tab and the capsule, and the transcript keeps a record on your side of the column (your choices under each question; one mark and a word for a decision; an approved command starts running; an approved plan becomes the To do list).',
    'Look at the joins: a short transcript stands on the composer, so what a session waits on is beside the words that led to it; the queued message is outside the composer and the transcript thins out before it. Orange is spent on the disc only: Approve and Send are ink.',
    'Colour: Warm paper is the default now. Paper, the three other warm Papers and the earlier comparison set (Peach to Orange) are still on the switch. Painted form: the blurred drawing is the default; Everywhere shows the whole drawing, None is Open\'s plain ground.',
    'Still true: scroll the transcript and the field stays still while the blocks travel over it; Blocks quiets them (Veil, Opaque); Field strength is how far the field departs from its ground. Reasons, costs and readings: DESIGN.md sections 13 to 17.',
    'Cost: content on glass breaks the glass guideline on purpose; a second glass root runs inside the transcript; legibility depends on the field staying graded.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    {
      id: 'colour',
      label: 'Colour',
      default: 'warmpaper',
      options: [
        { value: 'paper', label: 'Paper' },
        { value: 'warmpaper', label: 'Warm paper' },
        { value: 'orangelight', label: 'Orange light' },
        { value: 'underside', label: 'Orange underside' },
        { value: 'claypaper', label: 'Clay paper' },
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
      default: 'recede',
      options: [
        { value: 'everywhere', label: 'Everywhere' },
        { value: 'recede', label: 'Out of focus where you work' },
        { value: 'home', label: 'New chat only' },
        { value: 'plain', label: 'None: plain ground' },
      ],
    },
    {
      id: 'line',
      label: 'New chat line (Paper)',
      default: 'sans',
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
      default: 'column',
      options: [
        { value: 'layers', label: 'As it was' },
        { value: 'column', label: 'On the reading column' },
      ],
    },
    {
      id: 'side',
      label: 'Right column',
      default: 'button',
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
      default: 'system',
      options: [
        { value: 'figtree', label: 'Figtree' },
        { value: 'geist', label: 'Geist' },
        { value: 'system', label: 'System' },
      ],
    },
  ],
  Component: lazy(() => import('./Layers')),
};
