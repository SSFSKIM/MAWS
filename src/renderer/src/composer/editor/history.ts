// ArrowUp history (C7 execution document, "History"): the navigation state machine and its two sources. ArrowUp from an
// empty editor, or while navigating, moves to the previous entry; ArrowDown moves forward and, past the newest, puts
// back the draft the navigation started from; any edit ends navigation, the edited text becoming the draft. The
// sources, newest first: this session's own human prompts from the transcript (a `peer` turn's opening message is not
// the owner's), consecutive duplicates collapsed, then `session.history.list` entries not already among them (the same
// display and the same bodies). UX wave U4a M6 (l3-input-12): the line under the text while recalling or searching, and
// the search's matching and keys. Pure.
import type { HistoryEntry } from '@shared/composer/history-entry';
import type { Prefill } from '../../stores/composer';
import type { Row, TurnActivity } from '../../transcript';
import type { ComposerDoc } from './doc';
import { historyEntryToDoc, prefillToDoc, typedFromRowText } from './recall';

export interface HistoryNav {
  index: number | null; // the entry shown, into the list oldest first; null while not navigating
  draft: ComposerDoc | null; // what the editor held when navigation began
}

export type NavShow = { kind: 'entry'; index: number } | { kind: 'draft'; doc: ComposerDoc } | null;

export function historyNavigation(nav: HistoryNav, action: 'up' | 'down' | 'edit', count: number, current: ComposerDoc): { nav: HistoryNav; show: NavShow } {
  if (action === 'edit') return { nav: { index: null, draft: null }, show: null };
  if (action === 'up') {
    if (count === 0) return { nav, show: null };
    if (nav.index === null) return { nav: { index: count - 1, draft: current }, show: { kind: 'entry', index: count - 1 } };
    const index = Math.max(0, nav.index - 1);
    return { nav: { ...nav, index }, show: { kind: 'entry', index } };
  }
  if (nav.index === null) return { nav, show: null };
  if (nav.index < count - 1) return { nav: { ...nav, index: nav.index + 1 }, show: { kind: 'entry', index: nav.index + 1 } };
  return { nav: { index: null, draft: null }, show: nav.draft ? { kind: 'draft', doc: nav.draft } : null };
}

export type Recall = { source: 'session'; prefill: Prefill } | { source: 'history'; entry: HistoryEntry };

type UserRow = Extract<Row, { kind: 'user' }>;

// The comparison key: the display without attachment placeholders (a row does not carry them) and without the whitespace
// around pasted placeholders (the transcript's rows put newlines there), with the bodies in placeholder order.
const PLACEHOLDER_SPACE = /\s*(\[Pasted text #\d+ \+\d+ lines\])\s*/g;
const ATTACHMENT_PLACEHOLDER = /\s*\[(?:Image|PDF) #\d+\]/g;
const keyOf = (display: string, bodies: (string | null)[]) => `${display.replace(ATTACHMENT_PLACEHOLDER, '').replace(PLACEHOLDER_SPACE, '$1').trim()}\u0000${JSON.stringify(bodies)}`;

function rowPrefill(row: UserRow): Prefill {
  const dataUrl = (url: string) => /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return {
    text: typedFromRowText(row.text),
    pasted: row.attachments.filter((a) => a.kind === 'text' && a.text !== null).map((a) => ({ name: a.name, text: a.text! })),
    images: row.attachments.flatMap((a) => {
      const parts = a.kind === 'image' && a.dataUrl !== null ? dataUrl(a.dataUrl) : null;
      return parts ? [{ name: a.name, mediaType: a.mediaType ?? parts[1], data: parts[2] }] : [];
    }),
  };
}

const prefillKey = (p: Prefill) => keyOf(p.text, (p.pasted ?? []).map((b) => b.text));
const entryKey = (e: HistoryEntry) =>
  keyOf(
    e.display,
    Object.entries(e.pastedContents)
      .filter(([, c]) => c.type === 'text')
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, c]) => c.content),
  );

// The recallable entries, oldest first (navigation starts from the end): earlier history, then this session's prompts.
export function recallEntries(rows: readonly Row[], activity: readonly TurnActivity[], listed: readonly HistoryEntry[]): Recall[] {
  const human = new Set(activity.filter((turn) => turn.origin === 'human').map((turn) => turn.turnId));
  const session: Recall[] = [];
  const keys = new Set<string>();
  let last: string | null = null;
  for (const row of rows) {
    if (row.kind !== 'user' || row.messageUuid === null || row.turnId === null || !human.has(row.turnId)) continue;
    const prefill = rowPrefill(row);
    const key = prefillKey(prefill);
    if (key === last) continue;
    last = key;
    keys.add(key);
    session.push({ source: 'session', prefill });
  }
  const earlier = [...listed].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).filter((e) => !keys.has(entryKey(e)));
  return [...earlier.map((entry): Recall => ({ source: 'history', entry })), ...session];
}

export const recallDoc = (recall: Recall): ComposerDoc => (recall.source === 'session' ? prefillToDoc(recall.prefill) : historyEntryToDoc(recall.entry));

// ---- UX wave U4a M6 (l3-input-12; decision 22): the line under the text, and the search ----------------------------

// While recalling, the entry's place in the list ↑ walks (`index` into it oldest first), 1 the most recent.
export const recallLine = (index: number, count: number): string => `History ${count - index}/${count} · ↓ to restore your draft`;

// The text a search reads in a recall: what the box shows for it, its placeholders included.
export const recallText = (recall: Recall): string => (recall.source === 'session' ? recall.prefill.text : recall.entry.display);

const holds = (text: string, query: string) => text.toLowerCase().includes(query.toLowerCase());

// The first prompt from `from` in the direction `step` (+1 older, -1 newer, over `texts` newest first) that holds `query`
// anywhere, case ignored; an empty query is held by every prompt.
export function findMatch(texts: readonly string[], query: string, from: number, step: 1 | -1): number | null {
  for (let i = from; i >= 0 && i < texts.length; i += step) if (holds(texts[i], query)) return i;
  return null;
}

// How many prompts hold `query` and the place among them of the one shown (`at`), newest first; null when the one shown
// does not hold it, or none is shown.
export function matchPlace(texts: readonly string[], query: string, at: number | null): { place: number; total: number } | null {
  if (at === null || !holds(texts[at] ?? '', query)) return null;
  let place = 0;
  let total = 0;
  texts.forEach((text, i) => {
    if (!holds(text, query)) return;
    total += 1;
    if (i <= at) place += 1;
  });
  return { place, total };
}

export const searchLine = (query: string, match: { place: number; total: number } | null): string =>
  query === '' ? 'Search history:' : `Search history: ${query} — ${match ? `match ${match.place} of ${match.total}` : 'no match'}`;

// What a key does while searching, as Claude Desktop's handler reads it (web/app/v1/c82492f2c-B1kvcJEb.js:16080-16210):
// ↑ (and Ctrl+R, the dispatched chord) older, ↓ newer; Esc puts the draft back, as Backspace does on an empty search;
// Enter, Tab, ←, →, Home and End take the match; a key of an input-method composition, a dead key, a paste and a cut
// end the search with the match in the box and are the box's (`yield`); a printable key narrows; any other is held.
export type SearchKey = { kind: 'older' | 'newer' | 'restore' | 'erase' | 'take' | 'yield' | 'ignore' } | { kind: 'type'; char: string };
const TAKES = new Set(['Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
export function searchKeyOf(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>): SearchKey {
  const { key } = event;
  if (event.isComposing || key === 'Dead' || key === 'Process' || ((event.ctrlKey || event.metaKey) && !event.altKey && /^[vx]$/i.test(key))) return { kind: 'yield' };
  if (key === 'ArrowUp') return { kind: 'older' };
  if (key === 'ArrowDown') return { kind: 'newer' };
  if (key === 'Escape') return { kind: 'restore' };
  if (key === 'Backspace') return { kind: 'erase' };
  if (TAKES.has(key)) return { kind: 'take' };
  if (key.length === 1 && !event.metaKey && (!event.ctrlKey || event.altKey)) return { kind: 'type', char: key };
  return { kind: 'ignore' };
}
