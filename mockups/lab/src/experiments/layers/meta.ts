import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'layers',
  order: 0,
  name: 'Layers',
  thesis:
    'Glass taken into the transcript: the colour field runs under the whole window, prose is read directly on it, and what the agent made that can be opened (a tool run, an edit, a running command) is a piece of glass standing over it.',
  notes: [
    'Newest: the last two places in the sidebar, Artifacts and Customize (keys 6 and 7). Both are said the way the transcript speaks: a thing is one line; press it and it opens into a sheet of glass with everything else about it and what can be done; the round + at the top right grows into what the page makes or adds. Rest on a line for what it is. On Customize a mark means something is wrong or yours to do: press Sign in on Pagewise. DESIGN.md 21.5 lists every word and row these pages no longer show at rest, each with its reason, for you to confirm or refuse.',
    'Newest: code is coloured. Three quiet hues and the ink: the language\'s words in a plum, values in a bronze, type names in a slate; comments in the quiet ink; nothing green, red or orange, which the page already spends. Look at the bucket.ts tab, then keys.ts and index.ts in the side column, and at an edit in the session. "Code: colour" switches back to plain ink to compare.',
    'Newest: more tabs than fit. Set "Tabs open" to 6, 9 and 14 and narrow the window. The tab you are on keeps its whole name; the others shorten together, then give their names up together and stand as their marks (the orange disc is never lost; rest on a mark for its name), then leave for a menu beside the plus. Tabs close now: rest on a tab\'s mark for the cross.',
    'New, and first: the two pages that were missing. Press "Overview" in the pane (key 4) and the bucket.ts tab (key 5). Both are meant to be this same design at the product\'s other scale; say where they are not.',
    'Overview: twenty sessions, and one piece of glass. A session that is the agents\' business is one line on the field (unread first, then working, then at rest, told apart by the dot alone). The three that wait stand on glass at the top right: it is the orange capsule\'s list standing open, so Approve, the question\'s chips and the plan are answered there, one item open at a time. Answer one and watch it join the working lines; answer all three and the glass is gone. Rest on a line for where it runs.',
    'A file, corrected: you said it was only floating text and to put it on glass so it is clearly a file card. It is one now (the bucket.ts tab, key 5): a card of glass with all four edges in view, the file\'s name as its top, numbered lines, and the code scrolling inside it. In the side column press keys.ts or index.ts for a file with lines taken out and the marks at the card\'s right edge that show where its changes are. Press a line and the composer names it. The look you saw before is still on the switch ("File: code", On the field).',
    'Five switches for the two pages, the form at rest first: sessions as lines or as cards; grouped by state or by project; a file as a card of glass or on the field; line numbers in a gutter or on the pointed line only; changes in the file or side by side.',
    'This is the design as you have answered it so far: Warm paper, the orange disc for "waiting on you", the drawing blurred behind text, everything lined up on the reading column, the right column as a button that opens, the system face. Every earlier position is still one chip away below.',
    'New, and first: the suggested set from the Choices board is in. Your own message is a wash, not glass; thinking is the first row of the run it led to; an edit is a caption and a sheet of code; what runs is a capsule; agents are chips; the queued message waits above the composer; the model appears as you approach the composer; stop and send are two things; usage is one drop. Tell me what looks wrong.',
    'The three sessions that wait can be opened now. Press "Fix flaky upload test", "Billing webhook audit" or "Offline sync design" in the pane (or their tabs, or the arrow in the list the orange capsule opens). Each is answered in its own composer: Approve or Deny, the question\'s chips one question at a time, Approve for the plan. Typing is always the other answer.',
    'The same answers from elsewhere: open the capsule (one item opens at a time), or rest on a waiting row for its card. Answer in either place and watch the other: the session goes back to work, its orange disc leaves the pane, the tab and the capsule, and the transcript keeps a record on your side of the column (your choices under each question; one mark and a word for a decision; an approved command starts running; an approved plan becomes the To do list).',
    'Look at the joins: a short transcript stands on the composer, so what a session waits on is beside the words that led to it; the queued message is outside the composer and the transcript thins out before it. Orange is spent on the disc only: Approve and Send are ink.',
    'Colour: Warm paper is the default now. Paper, the three other warm Papers and the earlier comparison set (Peach to Orange) are still on the switch. Painted form: the blurred drawing is the default; Everywhere shows the whole drawing, None is Open\'s plain ground.',
    'Still true: scroll the transcript and the field stays still while the blocks travel over it; Blocks quiets them (Veil, Opaque); Field strength is how far the field departs from its ground. Reasons, costs and readings: DESIGN.md sections 13 to 18.',
    'Cost: content on glass breaks the glass guideline on purpose; a second glass root runs inside the transcript; legibility depends on the field staying graded.',
  ],
  scenes: ['session', 'settings', 'home', 'overview', 'file', 'artifacts', 'customize'],
  knobs: [
    {
      id: 'shelf',
      label: 'Artifacts: grouped',
      default: 'date',
      options: [
        { value: 'date', label: 'By date' },
        { value: 'space', label: 'By Space' },
      ],
    },
    {
      id: 'skills',
      label: 'Customize: a plugin\'s skills',
      default: 'inside',
      options: [
        { value: 'inside', label: 'Inside their plugin' },
        { value: 'listed', label: 'Listed under Skills too' },
      ],
    },
    {
      id: 'add',
      label: 'Artifacts, Customize: the + card',
      default: 'button',
      options: [
        { value: 'button', label: 'A button until pressed' },
        { value: 'open', label: 'Open at rest' },
      ],
    },
    {
      id: 'tabs',
      label: 'Tabs open',
      default: '4',
      options: [
        { value: '4', label: '4' },
        { value: '6', label: '6' },
        { value: '9', label: '9' },
        { value: '14', label: '14' },
      ],
    },
    {
      id: 'sessions',
      label: 'Overview: sessions',
      default: 'rows',
      options: [
        { value: 'rows', label: 'Lines, and one glass for what waits' },
        { value: 'cards', label: 'Cards' },
      ],
    },
    {
      id: 'by',
      label: 'Overview: grouped',
      default: 'state',
      options: [
        { value: 'state', label: 'By state' },
        { value: 'project', label: 'By project' },
      ],
    },
    {
      id: 'code',
      label: 'File: code',
      default: 'card',
      options: [
        { value: 'card', label: 'A card of glass' },
        { value: 'field', label: 'On the field' },
      ],
    },
    {
      id: 'syntax',
      label: 'Code: colour',
      default: 'colour',
      options: [
        { value: 'colour', label: 'Coloured' },
        { value: 'ink', label: 'Plain ink' },
      ],
    },
    {
      id: 'numbers',
      label: 'File: line numbers',
      default: 'gutter',
      options: [
        { value: 'gutter', label: 'In a gutter' },
        { value: 'pointed', label: 'On the pointed line' },
      ],
    },
    {
      id: 'diff',
      label: 'File: changes',
      default: 'inline',
      options: [
        { value: 'inline', label: 'In the file' },
        { value: 'sides', label: 'Side by side' },
      ],
    },
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
