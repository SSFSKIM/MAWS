// The patch writer's test world (P3-0's `s4/src/fixture.ts` and `s4/test/setup.ts`, typed onto the schema module):
// S4's seed document (overlapping comments, bold and a link, a list, a table, code) in a tab, its threads written as
// the threads model writes them, replicas synced by exchanging diffs, and compact readers of marks and ids.
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Actor } from '@shared/artifacts/actor';
import { applyV1, diffV1, newDoc, stateVector, type Doc, type Node } from '../yjs';

import { ynodeToPmnode } from '../yjs/prosemirror';
import { DocIndex } from './block-index';
import { schemaFor } from './schema';
import { createDocument, listTabs, tabBody } from './tabs';
import { addThread, anchorOfMark, liveThreadIds } from './threads';

export const TAB = 'tab1';
const owner: Actor = { kind: 'human' };
const schema = schemaFor();

type J = JSONContent;
type M = NonNullable<J['marks']>[number];
const t = (text: string, ...marks: M[]): J => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const bold: M = { type: 'bold' };
const link: M = { type: 'link', attrs: { href: 'https://example.com' } };
const c = (threadId: string): M => ({ type: 'comment', attrs: { threadId } });
const para = (id: string, ...content: J[]): J => ({ type: 'paragraph', attrs: { id }, content });
const cell = (id: string, text: string, header = false): J => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { id }, content: [para(`${id}p`, ...(text ? [t(text)] : []))] });

/** S4's seed: one section of the document the writer suites edit. */
export const seedJSON = (): J => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [t('Section 1 plan')] },
    // "The quick brown fox jumps over the lazy dog." t1 over "quick brown", t2 over "brown fox", bold "lazy", link "dog"
    para('p1', t('The '), t('quick ', c('t1')), t('brown', c('t1'), c('t2')), t(' fox', c('t2')), t(' jumps over the '), t('lazy', bold), t(' '), t('dog', link), t('. It has two sentences.')),
    para('p2', t('The review is '), t('scheduled for Friday', c('t3')), t(' and the owner signs off after it.')),
    para('p3', t('A plain paragraph the human types into. '), t('Words', c('t4')), t(' to keep.')),
    {
      type: 'bulletList',
      attrs: { id: 'l1' },
      content: [
        { type: 'listItem', attrs: { id: 'li1' }, content: [para('lp1', t('first item'))] },
        { type: 'listItem', attrs: { id: 'li2' }, content: [para('lp2', t('second item with '), t('bold', bold))] },
      ],
    },
    {
      type: 'table',
      attrs: { id: 'tb1' },
      content: [
        { type: 'tableRow', attrs: { id: 'tr0' }, content: [cell('tha', 'Name', true), cell('thb', 'Value', true)] },
        { type: 'tableRow', attrs: { id: 'tr1' }, content: [cell('td1a', 'alpha'), cell('td1b', '1')] },
        { type: 'tableRow', attrs: { id: 'tr2' }, content: [cell('td2a', 'beta'), cell('td2b', '2')] },
      ],
    },
    { type: 'codeBlock', attrs: { id: 'c1', language: 'ts' }, content: [t('const x = 1')] },
    para('p4', t('Closing paragraph of this section, with enough words to look like prose that a person wrote.')),
  ],
});

export const QUOTES: Record<string, string> = { t1: 'quick brown', t2: 'brown fox', t3: 'scheduled for Friday', t4: 'Words' };

let clock = 1_760_000_000_000;
export const now = (): number => (clock += 1000);

/** A doc holding `body` (S4's seed by default) in tab `tab1`, every commented passage's thread written first. */
export function seedDoc(body: J = seedJSON(), quotes: Record<string, string> = QUOTES): Doc {
  const doc = newDoc();
  createDocument(doc, { title: 'Plan', id: TAB, body: schema.nodeFromJSON(body) });
  const root = tabBody(doc, TAB)!;
  for (const [threadId, quote] of Object.entries(quotes)) {
    const anchor = anchorOfMark(root, threadId);
    if (anchor) addThread(doc, { threadId, tabId: TAB, blockId: null, quote, anchor, by: owner, at: now(), body: `About "${quote}"` });
  }
  return doc;
}

/** A replica of `doc` (a fresh client, synced to it). */
export function replica(doc: Doc): Doc {
  const copy = newDoc();
  applyV1(copy, diffV1(doc));
  return copy;
}

/** Brings every doc up to every other one's state. */
export function sync(...docs: Doc[]): void {
  for (const a of docs) for (const b of docs) if (a !== b) applyV1(b, diffV1(a, stateVector(b)));
}

export const body = (doc: Doc, tabId = TAB): Node => tabBody(doc, tabId)!;

/** The node carrying `id` (any depth, any tab). */
export function nodeOf(doc: Doc, id: string): Node {
  const found = DocIndex.of(doc).find(id);
  if (!found) throw new Error(`no node ^${id}`);
  return found.node;
}

export const pmOf = (doc: Doc, id: string): PMNode => ynodeToPmnode(nodeOf(doc, id), schema);

/** The top-level ids of a tab in order. */
export const order = (doc: Doc, tabId = TAB): string[] => body(doc, tabId).toArray().map((node) => String((node as Node).getAttr('id')));

/** Every id in the document, depth first, tabs in order (duplicates kept). */
export function ids(doc: Doc): string[] {
  const out: string[] = [];
  for (const tab of listTabs(doc)) ynodeToPmnode(body(doc, tab.id), schema).descendants((node) => void (node.attrs.id && out.push(String(node.attrs.id))));
  return out;
}
export const dupes = (list: string[]): string[] => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];

/** A block's text runs as `text[mark,mark]`, comments as `c:ID`, joined by `|` (S4's `marksOf`). */
export function marksOf(doc: Doc, id: string): string {
  const out: string[] = [];
  pmOf(doc, id).descendants((node) => {
    if (!node.isText) return;
    const marks = node.marks.map((mark) => (mark.type.name === 'comment' ? `c:${String(mark.attrs.threadId)}` : mark.type.name)).sort();
    out.push(marks.length ? `${node.text}[${marks.join(',')}]` : String(node.text));
  });
  return out.join('|');
}

/** threadId → the text its mark covers in a block, contiguous runs joined by `|` (S5's `covered`). */
export function coveredIn(doc: Doc, id: string): Record<string, string> {
  const runs: Record<string, string[]> = {};
  const open: Record<string, boolean> = {};
  pmOf(doc, id).descendants((node) => {
    if (!node.isText) return;
    const here = new Set(node.marks.filter((mark) => mark.type.name === 'comment').map((mark) => String(mark.attrs.threadId)));
    for (const thread of Object.keys(open)) if (!here.has(thread)) open[thread] = false;
    for (const thread of here) {
      runs[thread] ??= [];
      if (open[thread]) runs[thread][runs[thread].length - 1] += node.text ?? '';
      else runs[thread].push(node.text ?? '');
      open[thread] = true;
    }
  });
  return Object.fromEntries(Object.entries(runs).map(([thread, parts]) => [thread, parts.join('|')]));
}

export const liveThreads = liveThreadIds;
export const textOf = (doc: Doc, id: string): string => pmOf(doc, id).textContent;

/** Every document converged: the same ProseMirror JSON for every tab. */
export function converged(...docs: Doc[]): boolean {
  const json = docs.map((doc) => JSON.stringify(listTabs(doc).map((tab) => ynodeToPmnode(body(doc, tab.id), schema).toJSON())));
  return json.every((value) => value === json[0]);
}

/** A sequential id generator for tests (`n1`, `n2`, …). */
export function sequence(prefix = 'n'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

