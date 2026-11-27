// The word cut's M5 rig (e2e/words-shots.rig.ts, launch 15): a small document's state, seeded over a document's tabs
// through the scale gate's host seam (src/engine-host/documents/kinds/document-perf.ts, `seed`, MAWS_DOCUMENT_PERF=1),
// so the editor draws its comment cards, its table and its callout from one write. Rig-only, as words-channel.ts is: a
// spec importing it would register nothing, and no spec does. Built as e2e/support/document-seed.ts builds its seed (the
// schema module, the tabs map, the threads' own writer); every id, time and client is fixed, so the before and the
// after build draw the same page. The content is invented.
import type { JSONContent } from '@tiptap/core';
import { adoptClientId, newDoc, stateV2, transact } from '@artifacts/yjs';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument, tabBody } from '@artifacts/document/tabs';
import { addThread, anchorOfMark, resolve } from '@artifacts/document/threads';
import type { Actor } from '@shared/artifacts/actor';

export const WORDS_DOC_TAB = 'notes';
// The four threads: two open on live passages, one resolved, and one whose passage was removed (an orphan, the
// comments panel's "deleted text")
export const WORDS_THREADS = { open: 'thopen', second: 'thsecond', done: 'thdone', gone: 'thgone' } as const;
// Words the scenes find the page by: the first line, and a plain paragraph no comment marks (Show editors' selection)
export const WORDS_DOC_TEXT = { first: 'The survey starts on', plain: 'Each evening the leads compare their counts.' } as const;

const AT = Date.UTC(2026, 8, 20, 9, 0); // FIXED_DATE's morning
const OWNER: Actor = { kind: 'human' };

type J = JSONContent;
const t = (text: string, thread?: string): J => (thread ? { type: 'text', text, marks: [{ type: 'comment', attrs: { threadId: thread } }] } : { type: 'text', text });
const p = (id: string, content: J[]): J => ({ type: 'paragraph', attrs: { id }, content });
const cell = (kind: 'tableHeader' | 'tableCell', id: string, text: string): J => ({ type: kind, attrs: { id }, content: [p(`${id}p`, [t(text)])] });

/** The document's V2 state: one tab, its blocks and its threads, as the human wrote them. */
export function wordsDocState(): Uint8Array {
  const doc = newDoc();
  adoptClientId(doc, 41_241);
  const { open, second, done, gone } = WORDS_THREADS;
  const rows = [
    ['Site', 'Lead', 'Days'],
    ['North ridge', 'Ana', '6'],
    ['River bend', 'Leo', '4'],
  ];
  const body: J = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, id: 'h1' }, content: [t('Field notes')] },
      p('p1', [t(`${WORDS_DOC_TEXT.first} `), t('the first Monday', open), t(' and runs for three weeks. Each team keeps '), t('its own log', second), t('.')]),
      { type: 'table', attrs: { id: 'tb' }, content: rows.map((row, r) => ({ type: 'tableRow', attrs: { id: `tb${r}` }, content: row.map((text, c) => cell(r === 0 ? 'tableHeader' : 'tableCell', `tb${r}c${c}`, text)) })) },
      { type: 'callout', attrs: { id: 'co', tone: 'note' }, content: [p('cop', [t('Bring the spare batteries.')])] },
      p('p2', [t('Results go to the shared folder by '), t('the last Friday', done), t('.')]),
      p('p3', [t(WORDS_DOC_TEXT.plain)]),
      p('gone', [t('The old route through the quarry', gone), t(' is closed.')]),
    ],
  };
  createDocument(doc, { title: 'Main', id: WORDS_DOC_TAB, body: schemaFor().nodeFromJSON(body) });
  const root = tabBody(doc, WORDS_DOC_TAB)!;
  const threads: [string, string, string, string][] = [
    [open, 'p1', 'the first Monday', 'Is this the first Monday of the month?'],
    [second, 'p1', 'its own log', 'Should the logs be shared at the end?'],
    [done, 'p2', 'the last Friday', 'Moved to Friday, as agreed.'],
    [gone, 'gone', 'The old route through the quarry', 'Is the quarry route still open?'],
  ];
  threads.forEach(([threadId, blockId, quote, message], i) => {
    const anchor = anchorOfMark(root, threadId);
    if (!anchor) throw new Error(`no mark for ${threadId}`);
    addThread(doc, { threadId, tabId: WORDS_DOC_TAB, blockId, quote, anchor, by: OWNER, at: AT + i * 60_000, body: message });
  });
  resolve(doc, done, OWNER, AT + 10 * 60_000);
  // the commented passage removed with its block: the thread stays, open, with no live mark
  transact(doc, () => root.delete(root.length - 1, 1));
  return stateV2(doc);
}

/** A state with no tab at all: seeded over a document, an old document with no first page (or a held dashboard's base). */
export function noTabsState(): Uint8Array {
  const doc = newDoc();
  adoptClientId(doc, 41_242);
  return stateV2(doc);
}
