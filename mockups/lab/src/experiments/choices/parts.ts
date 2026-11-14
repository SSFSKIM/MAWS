// The board's index: every part of the session view that is put up for a choice, and the plain name of each of its
// variants. A is always the part as Layers has it today. What each variant argues and costs: DESIGN.md.

export interface PartDef {
  id: string;
  /** The name in the index and at the head of its page. */
  name: string;
  group: 'Transcript' | 'Composer' | 'Needs you' | 'Pane' | 'Window' | 'Sum';
  /** Variant names in order; the letter is the position. */
  variants: string[];
  /** A few words under a name, where a variant shows nothing of itself at rest. A's note is always "today". */
  notes?: (string | null)[];
  /** How its page is laid out: full-width things stacked in the reading column, or smaller things side by side. */
  layout: 'stack' | 'grid' | 'ask' | 'row' | 'bands' | 'column';
  /** A motion part plays, and can be replayed. */
  motion?: boolean;
  /** Parts with something behind a click or a hover can be shown opened, all at once. */
  opens?: boolean;
}

export const PARTS: PartDef[] = [
  { id: 'message', name: 'Your message', group: 'Transcript', layout: 'stack', variants: ['Glass', 'Tint', 'Heading'] },
  { id: 'thought', name: 'Thinking', group: 'Transcript', layout: 'stack', opens: true, variants: ['Timer', 'What it thought', 'Folded in'], notes: [null, null, 'a row of the next run'] },
  { id: 'diff', name: 'Diff', group: 'Transcript', layout: 'stack', opens: true, variants: ['Card', 'One line', 'Code only'] },
  { id: 'command', name: 'Running command', group: 'Transcript', layout: 'stack', opens: true, variants: ['Card', 'One line', 'Capsule'] },
  { id: 'agents', name: 'Agents started', group: 'Transcript', layout: 'stack', opens: true, variants: ['Sentence', 'Live chips', 'A count'] },
  { id: 'queued', name: 'Queued message', group: 'Composer', layout: 'grid', variants: ['Chip inside', 'Waiting above', 'In the field', 'A mark'], notes: [null, null, null, 'the words on hover'] },
  { id: 'model', name: 'Model picker', group: 'Composer', layout: 'grid', opens: true, variants: ['Chip', 'On approach', 'Spelled out', 'Behind the plus'], notes: [null, 'there on hover or focus', null, null] },
  { id: 'context', name: 'Context mark', group: 'Composer', layout: 'grid', opens: true, variants: ['Ring', 'Away', 'On the chip', 'Number'], notes: [null, 'in the menu until nearly full', null, null] },
  { id: 'send', name: 'Send and stop', group: 'Composer', layout: 'grid', variants: ['One solid button', 'Hollow stop', 'Two buttons'] },
  {
    id: 'question', name: 'A question', group: 'Needs you', layout: 'ask', opens: true,
    variants: ['A line in the list', 'In the card', 'In the composer', 'A form in the transcript'],
    notes: [null, 'answered from the capsule, as the approval is', 'one at a time; typing is the other answer', 'every sentence in sight'],
  },
  {
    id: 'plan', name: 'A plan', group: 'Needs you', layout: 'ask', opens: true,
    variants: ['A line in the list', 'In the card', 'Prose, and the composer', 'A document in the transcript'],
    notes: [null, 'its steps, approved from the capsule', 'the composer holds the decision', 'on glass, with its own buttons'],
  },
  { id: 'usage', name: 'Usage mark', group: 'Pane', layout: 'row', opens: true, variants: ['Two rings', 'One drop', 'Time left'], notes: [null, 'the nearer limit', 'until the five-hour reset'] },
  { id: 'pane', name: 'Pane collapse', group: 'Pane', layout: 'row', motion: true, variants: ['Slides away', 'Folds to a rail', 'Melts into its button'] },
  { id: 'menu', name: 'Menu motion', group: 'Window', layout: 'row', motion: true, variants: ['Grows from its corner', 'Unrolls', 'Becomes the menu', 'Glass'], notes: [null, null, null, "the library's platter"] },
  { id: 'ground', name: 'Ground', group: 'Window', layout: 'bands', variants: [] },
  { id: 'together', name: 'Together', group: 'Sum', layout: 'column', variants: [] },
];

/** The parts that take a letter. */
export const JUDGED = PARTS.filter((p) => p.id !== 'together');

/** The builder's own letters (DESIGN.md §2), shown only on the Together page, beside today's and the owner's. */
export const SUGGESTED: Record<string, string> = {
  message: 'B', thought: 'C', diff: 'C', command: 'C', agents: 'B', queued: 'B', model: 'B', context: 'B', send: 'C', question: 'C', plan: 'C', usage: 'B', pane: 'A', menu: 'A', ground: 'A',
};

export const partOf = (id: string | undefined): PartDef => PARTS.find((p) => p.id === id) ?? PARTS[0]!;
export const LETTERS = 'ABCDE';

/** The dark ground: the colouring's own (the hex here is Paper's; `groundsOf` in ground.tsx puts the default colouring's in its place), then the owner's four candidates. The light scheme has its own three. */
export const GROUNDS = {
  dark: [
    { id: 'own', hex: '#181614', name: "The colouring's own" },
    { id: '191919', hex: '#191919', name: 'Neutral' },
    { id: '191c19', hex: '#191c19', name: 'Green cast' },
    { id: '1f1f1f', hex: '#1f1f1f', name: 'Lifted' },
    { id: '000000', hex: '#000000', name: 'Black' },
  ],
  light: [
    { id: 'own', hex: '#e8e1db', name: "The colouring's own" },
    { id: 'faf9f5', hex: '#faf9f5', name: 'Warm white' },
    { id: 'ffffff', hex: '#ffffff', name: 'White' },
  ],
} as const;
