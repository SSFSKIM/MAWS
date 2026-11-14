import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'layers',
  order: 0,
  name: 'Layers',
  thesis:
    'Glass taken all the way into the transcript: the colour field runs under the whole window, prose is read directly on it, and every block (a tool run, a diff, a running command, your own message) is a piece of glass standing over it.',
  notes: [
    'Your four answers are now the design at rest: the drawing out of focus behind text, everything lined up on the reading column, the right column as a button that opens, and Quiet\'s face (the system face) for the whole interface, the New chat line included. Each is still a switch below, so the earlier positions are one chip away.',
    'Colour, on your word that Paper should be warmer ("perhaps by mixing older orange"): four warmer Papers beside Paper. They put the warmth in different places. Warm paper: the paper itself (ground, shade, shadow) carries the orange at low strength, and the orange comes back once, as the mark. Orange light: the paper as it is, with the orange as light (inside the glass leaf, on the floor under the composer, the lamp at night). Orange underside: the sheet\'s reverse is the orange, a second material. Clay paper: Warm paper with the warmth from today\'s terracotta instead, in case that is the orange you meant.',
    'Look at each on New chat first (the drawing is whole there), then a session and Settings, in both schemes. Set Painted form to Everywhere to see the whole drawing on every page. Paper itself is unchanged and still the default.',
    'Painted form has a new last chip, None: plain ground. It is Open\'s ground inside Layers: no drawing on any page, and light and shade gather only under the glass. Flip between it and the default on a session, on Settings and on New chat to choose the ground; try it under the warm colourings too, where the gathered light is where the warmth sits.',
    '"Needs you" mark is the one call still open, and it waits for the colour: Ink badge, Soft disc, One gold under Paper, Orange light and Orange underside; Warm paper and Clay paper bring their own mark (the orange, the terracotta), so the switch does not apply to them.',
    'Corrected in Paper at night: one grey caption crossed the sheet\'s lit face when the transcript was scrolled half way and read under its contrast floor there, so the sheet\'s face and edge are a step dimmer at night, as in the warmer Papers. Paper is otherwise as you chose it.',
    'The other colourings (Peach to Orange) are the earlier comparison set; the switches marked Paper do nothing under them.',
    'Still true: scroll the transcript and the field stays still while the blocks travel over it; Blocks quiets them (Veil, Opaque); Field strength is how far the field departs from its ground. Reasons, costs and readings: DESIGN.md sections 13 to 16.',
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
