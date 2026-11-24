// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; M8): the deck history's words. The rail's are B's
// (HistoryRail); the bar's follow B's preview bar where the action is the same, so a document and a deck read alike.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): the bar's buttons read short words, the
// full ones their names and tooltips (G490); stepping reads "2 / 5" (G489); a change is named in a person's words (G494).
export const HISTORY_COPY = {
  bar: 'Version preview',
  showChanges: 'Show changes',
  count: (n: number) => (n === 1 ? '1 change' : `${n} changes`),
  step: (at: number, of: number) => `${at} / ${of}`, // G489
  stepName: (at: number, of: number) => `Change ${at} of ${of}`,
  previous: 'Previous change',
  next: 'Next change',
  restore: 'Restore this version', // G490: the full names, each button's name and tooltip
  restoreWord: 'Restore',
  restoreAsk: 'Restore this version?',
  restoreBody: 'The presentation goes back to it as a new version: its slides and its deck settings. Everything since stays in history, and comment conversations are kept.',
  restoreConfirm: 'Restore',
  cancel: 'Cancel',
  copy: 'Make a copy',
  copied: 'A copy of this version was made.', // G500: a copy lands outside the list, so this line confirms it
  name: 'Name this version',
  nameWord: 'Name',
  nameField: 'Version name',
  namePlaceholder: 'Version name', // G492
  save: 'Save',
  back: 'Back to presentation',
  backWord: 'Done',
  filmstrip: 'Slides in this version',
  slideLabel: (n: number, kind: string | null) => `Slide ${n}${kind === 'added' ? ', new' : kind === 'removed' ? ', deleted' : kind === 'changed' ? ', changed' : ''}`,
  newBadge: 'New',
  deletedBadge: 'Deleted',
  deletedSlide: 'This slide was deleted in this version.',
  addedSlide: 'This slide is new in this version.',
  deckChanged: (keys: string) => `Deck settings changed: ${keys}`,
  notes: 'Speaker notes in this version',
  noNotes: 'No speaker notes.',
  stage: 'Slide in this version',
  pill: (count: number | null) => (count === null ? 'New changes' : `${count} new ${count === 1 ? 'change' : 'changes'}`), // NEWROW, as the document's G347
  pillRetry: 'Count the new changes again', // G498: the ↻'s name and tooltip
  pillDismiss: 'Dismiss new changes',
  dismiss: 'Dismiss',
  restoredBanner: 'Restored',
  by: (name: string, when: string) => `${name} · ${when}`,
};

// P4 W1-B (sitting candidate 54): deck.json's own keys as the preview's banner names them, in this order; the keys
// that record the file's format (`v`, `createdOnFiles`, `lists`) as one, last; any other key by `keyLabel`.
const DECK_KEY_LABELS = new Map([
  ['title', 'title'],
  ['cover', 'cover slide'],
  ['sections', 'sections'],
  ['faces', 'fonts'],
  ['dsOverrides', 'theme overrides'],
  ['designSystems', 'design systems'],
]);
const FORMAT_KEYS = new Set(['v', 'createdOnFiles', 'lists']);

/** The deck's own changed keys as the banner lists them ("title, cover slide, sections, file format"). */
export function deckKeysLabel(keys: readonly string[]): string {
  const known = [...DECK_KEY_LABELS].filter(([key]) => keys.includes(key)).map(([, label]) => label);
  const other = keys.filter((key) => !DECK_KEY_LABELS.has(key) && !FORMAT_KEYS.has(key)).map(keyLabel);
  return [...new Set([...known, ...other, ...(keys.some((key) => FORMAT_KEYS.has(key)) ? ['file format'] : [])])].join(', ');
}

// G494: an element's changed keys as a person knows them; a property no word covers reads as written
const CHANGE_WORDS: Record<string, string> = {
  'style:background': 'fill',
  'style:border': 'border',
  'style:border-width': 'border',
  'style:border-style': 'border',
  'style:border-color': 'border',
  'style:border-radius': 'corners',
  'style:box-shadow': 'shadow',
  'style:opacity': 'opacity',
  'style:transform': 'rotation',
  'style:left': 'position',
  'style:top': 'position',
  'style:right': 'position',
  'style:bottom': 'position',
  'style:width': 'size',
  'style:height': 'size',
  'style:color': 'text colour',
  'style:font-family': 'font',
  'style:font-size': 'text size',
  'style:font-weight': 'weight',
  'style:font-style': 'italic',
  'style:text-align': 'alignment',
  'style:line-height': 'line height',
  'style:letter-spacing': 'letter spacing',
  'style:object-fit': 'image fit',
  'attr:src': 'picture',
  'attr:alt': 'alt text',
  'attr:data-crop': 'crop',
  'attr:data-fit': 'text fit',
  'attr:kind': 'shape',
  'attr:name': 'icon',
  'attr:route': 'route',
  'attr:head': 'arrowheads',
  'attr:head-start': 'arrowheads',
  'attr:head-end': 'arrowheads',
};

/** The keys an element's change touched, in a person's words, each once, the first capitalised ("Fill, corners"). */
export function changedWords(keys: readonly string[]): string {
  const words = [...new Set(keys.map((key) => CHANGE_WORDS[key] ?? keyLabel(key)))].join(', ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A deck key as the owner reads it. */
export function keyLabel(key: string): string {
  if (key.startsWith('style:')) return key.slice('style:'.length);
  if (key.startsWith('attr:')) return key.slice('attr:'.length);
  return ({ dsOverrides: 'theme overrides', designSystems: 'design systems', order: 'slide order', z: 'stacking', parent: 'group', text: 'text', raw: 'content', tag: 'kind' } as Record<string, string>)[key] ?? key;
}
