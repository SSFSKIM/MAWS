// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; M8): the deck history's words. The rail's are B's
// (HistoryRail); the bar's follow B's preview bar where the action is the same, so a document and a deck read alike.
export const HISTORY_COPY = {
  bar: 'Version preview',
  showChanges: 'Show changes',
  count: (n: number) => (n === 1 ? '1 change' : `${n} changes`),
  previous: 'Previous change',
  next: 'Next change',
  restore: 'Restore this version',
  restoreAsk: 'Restore this version?',
  restoreBody: 'The presentation goes back to it as a new version: its slides and its deck settings. Everything since stays in history, and comment conversations are kept.',
  restoreConfirm: 'Restore',
  cancel: 'Cancel',
  copy: 'Make a copy',
  name: 'Name this version',
  nameField: 'Version name',
  namePlaceholder: 'Name, e.g. Before the review',
  save: 'Save',
  back: 'Back to presentation',
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
  pill: (count: number | null) => (count === null ? 'See new changes' : `See ${count} new ${count === 1 ? 'change' : 'changes'}`),
  pillRetry: 'Count the new changes again',
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

/** A deck key as the owner reads it. */
export function keyLabel(key: string): string {
  if (key.startsWith('style:')) return key.slice('style:'.length);
  if (key.startsWith('attr:')) return key.slice('attr:'.length);
  return ({ dsOverrides: 'theme overrides', designSystems: 'design systems', order: 'slide order', z: 'stacking', parent: 'group', text: 'text', raw: 'content', tag: 'kind' } as Record<string, string>)[key] ?? key;
}
