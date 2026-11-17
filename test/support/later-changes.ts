// UX wave U1c, the one-writer rule in its neutralise form (the architect's ruling of 2026-11-16, UTC): what a layer after
// MAWS's writer might do to a person's text on its way to a reader (a host, the engine, a file, another machine). Under
// none of them, alone or all in a row, may what MAWS sent quote the grant's opening verbatim or read as a grant.
export const LATER_CHANGES: readonly (readonly [string, (text: string) => string])[] = [
  ['as sent', (t) => t],
  ['trimmed whole', (t) => t.trim()],
  ['each line trimmed', (t) => t.split('\n').map((line) => line.trim()).join('\n')],
  ['runs of white space collapsed', (t) => t.replace(/\s+/g, ' ')],
  ['runs of spaces and tabs collapsed', (t) => t.replace(/[^\S\n]+/g, ' ')],
  ['CRLF, a lone CR and the separators to LF', (t) => t.replace(/\r\n?|[\u2028\u2029]/g, '\n')],
  ['pasted tags removed', (t) => t.replace(/<\\?\/?\\?pasted_content id="[0-9a-f]{4}">/g, '')],
  ['angle-bracket pairs removed', (t) => t.replace(/<[^>]*>/g, '')],
  ['emphasis and code marks removed', (t) => t.replace(/[*_~`]/g, '')],
  ['compatibility-folded', (t) => t.normalize('NFKC')],
  ['compatibility-folded, then angle-bracket pairs removed', (t) => t.normalize('NFKC').replace(/<[^>]*>/g, '')],
  ['upper-cased, then lower-cased with the opening capitalised', (t) => t.toUpperCase().toLowerCase().replace(/permission granted for/g, 'Permission granted for')],
  // the task review of the neutralise delta: the first word's case alone changed (sharp s and dotless i upper-case to ASCII)
  ['the first word of each line upper-cased, then capitalised', (t) => t.replace(/^([^\S\n]*)([^\s]+)/gm, (_, space: string, word: string) => space + word.toUpperCase().charAt(0) + word.toUpperCase().slice(1).toLowerCase())],
];
const ALL_IN_A_ROW = (text: string) => LATER_CHANGES.reduce((t, [, change]) => change(t), text);

/** Each image of `text` under the later changes, each alone and all in a row, with its name. */
export function laterImages(text: string): [string, string][] {
  return [...LATER_CHANGES.map(([how, change]) => [how, change(text)] as [string, string]), ['all in a row', ALL_IN_A_ROW(text)]];
}
