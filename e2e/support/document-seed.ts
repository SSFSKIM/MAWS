// The 200-page document (P3-0's S7b `spikes/p3-store/s7/electron/seed.ts` and `doc.ts`, copied onto the schema module
// and the tabs map): 160 page-sized sections (about 100,000 words) in §4.4's block mix, written section by section by
// two writers as an agent's create batches would be, then roughened by a third typing 6,000 words a keystroke per
// transaction at random places, deleting about 400 words and bolding about 300 runs, the three replicas synced as they
// go (S2's seed method), so the item structure is a typed-and-edited document rather than one import. Every third
// section holds a commented passage, its thread written first. Used by the patch writer's bench (M2,
// test/artifacts/document-writer-bench.test.ts) and the scale gate (M9). Deterministic: one PRNG, fixed ids.
import type { JSONContent } from '@tiptap/core';
import { applyV1, diffV1, newDoc, stateV2, stateVector, transact, type Doc, type Node } from '@artifacts/yjs';
import { YNode } from '@artifacts/yjs/document';
import { pmnodeToDelta } from '@artifacts/yjs/prosemirror';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument, tabBody } from '@artifacts/document/tabs';
import { addThread, anchorOfMark } from '@artifacts/document/threads';
import type { Actor } from '@shared/artifacts/actor';

export const SEED_TAB = 't1';

export const prng = (seed = 7) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const WORDS =
  'the plan ships quarterly with design review notes owners budget risks timeline metrics agents draft final table code callout launch beta scope users latency memory store version history restore compare editor comment thread slide deck element because which their across between during market customer revenue support research hiring onboarding retention pipeline forecast'.split(
    ' ',
  );
export const sentence = (r: () => number, n = 8 + Math.floor(r() * 14)): string => {
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(WORDS[Math.floor(r() * WORDS.length)]);
  const text = words.join(' ');
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
};
const prose = (r: () => number, count: number): string => {
  const out: string[] = [];
  let n = 0;
  while (n < count) {
    const s = sentence(r);
    out.push(s);
    n += s.split(' ').length;
  }
  return out.join(' ');
};

type J = JSONContent;
type M = NonNullable<J['marks']>[number];
const t = (text: string, marks?: M[]): J => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (id: string, content: J[]): J => ({ type: 'paragraph', attrs: { id }, content });

/** One page-sized section (about 450 to 500 words); every block carries an id. */
export function sectionJSON(s: number, r: () => number): J[] {
  const k = `s${s}`;
  const blocks: J[] = [];
  blocks.push({ type: 'heading', attrs: { level: 2, id: `${k}h` }, content: [t(`${s + 1}. ${sentence(r, 4).slice(0, -1)}`)] });
  const comment: M[] | undefined = s % 3 === 0 ? [{ type: 'comment', attrs: { threadId: `th${s}` } }] : undefined;
  blocks.push(p(`${k}p1`, [t(`${prose(r, 40)} `), t('bold words', [{ type: 'bold' }]), t(' and '), t('a commented passage', comment), t(' with a '), t('link', [{ type: 'link', attrs: { href: `https://example.com/${s}` } }]), t(`. ${prose(r, 40)}`)]));
  blocks.push(p(`${k}p2`, [t(prose(r, 90))]));
  blocks.push({ type: 'heading', attrs: { level: 3, id: `${k}h3` }, content: [t(`Details ${s + 1}`)] });
  blocks.push(p(`${k}p3`, [t(`${prose(r, 60)} `), t('italic aside', [{ type: 'italic' }]), t(` ${prose(r, 30)}`)]));
  blocks.push({ type: 'bulletList', attrs: { id: `${k}ul` }, content: [0, 1, 2, 3].map((i) => ({ type: 'listItem', attrs: { id: `${k}li${i}` }, content: [p(`${k}li${i}p`, [t(prose(r, 12))])] })) });
  blocks.push(p(`${k}p4`, [t(prose(r, 80))]));
  if (s % 3 === 1) {
    blocks.push({
      type: 'table',
      attrs: { id: `${k}t` },
      content: [0, 1, 2, 3].map((ri) => ({
        type: 'tableRow',
        attrs: { id: `${k}r${ri}` },
        content: [0, 1, 2].map((ci) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', attrs: { id: `${k}r${ri}c${ci}` }, content: [p(`${k}r${ri}c${ci}p`, [t(ri === 0 ? `Head ${ci}` : prose(r, 4))])] })),
      })),
    });
  }
  if (s % 4 === 2) blocks.push({ type: 'codeBlock', attrs: { id: `${k}c`, language: 'ts' }, content: [t(Array.from({ length: 8 }, (_, i) => `const v${s}_${i} = compute(${i}, '${WORDS[i]}')`).join('\n'))] });
  if (s % 5 === 3) blocks.push({ type: 'blockquote', attrs: { id: `${k}q` }, content: [p(`${k}qp`, [t(prose(r, 30))])] });
  if (s % 6 === 4) blocks.push({ type: 'taskList', attrs: { id: `${k}tl` }, content: [0, 1].map((i) => ({ type: 'taskItem', attrs: { id: `${k}ti${i}`, checked: i === 1 }, content: [p(`${k}ti${i}p`, [t(prose(r, 8))])] })) });
  if (s % 7 === 5) blocks.push({ type: 'callout', attrs: { id: `${k}co`, tone: 'note' }, content: [p(`${k}cop`, [t(prose(r, 25))])] });
  blocks.push(p(`${k}p5`, [t(prose(r, 70))]));
  return blocks;
}

const textOf = (node: Node): string => node.toArray().filter((x): x is string => typeof x === 'string').join('');
const paragraphs = (root: Node, out: Node[] = []): Node[] => {
  for (const child of root.toArray()) {
    if (!(child instanceof YNode)) continue;
    if (child.name === 'paragraph') out.push(child);
    else if (child.name !== 'heading') paragraphs(child, out);
  }
  return out;
};

export interface SeedStats {
  sections: number;
  topBlocks: number;
  paragraphs: number;
  words: number;
  typed: number;
  deleted: number;
  formatted: number;
  v2Bytes: number;
  ms: number;
}

/** The seeded document as a V2 state (load it with `applyV2` into a fresh doc), and what it holds. */
export function seedDocument(sections = 160, seed = 11): { state: Uint8Array; stats: SeedStats } {
  const started = performance.now();
  const schema = schemaFor();
  const r = prng(seed);
  const owner: Actor = { kind: 'human' };
  const clients: Doc[] = [newDoc(), newDoc(), newDoc()];
  const sync = () => {
    for (const a of clients) for (const b of clients) if (a !== b) applyV1(b, diffV1(a, stateVector(b)));
  };
  createDocument(clients[0], { title: 'Main', id: SEED_TAB, body: schema.nodeFromJSON({ type: 'doc', content: [p('s0first', [t('Start.')])] }) });
  sync();
  for (let s = 0; s < sections; s++) {
    const writer = clients[s % 2]; // two writers, as two agents' create batches
    const body = tabBody(writer, SEED_TAB)!;
    const blocks = sectionJSON(s, r);
    transact(writer, () => body.insert(body.length, blocks.map((json) => pmnodeToDelta(schema.nodeFromJSON(json)))));
    if (s % 3 === 0) {
      const anchor = anchorOfMark(body, `th${s}`);
      if (anchor) addThread(writer, { threadId: `th${s}`, tabId: SEED_TAB, blockId: `s${s}p1`, quote: 'a commented passage', anchor, by: owner, at: 1_760_000_000_000 + s, body: 'Is this right?' });
    }
    if (s % 5 === 4) sync();
  }
  sync();
  const human = clients[2];
  const body = tabBody(human, SEED_TAB)!;
  let typed = 0;
  let deleted = 0;
  let formatted = 0;
  for (let round = 0; round < Math.max(3, Math.round((sections * 60) / 160)); round++) {
    const blocks = paragraphs(body);
    for (let k = 0; k < 100; k++) {
      // a typed word, one character per transaction (a keystroke each)
      const block = blocks[Math.floor(r() * blocks.length)];
      const text = textOf(block);
      let at = text.indexOf(' ', Math.floor(r() * Math.max(1, text.length - 1)));
      if (at < 0) at = text.length;
      for (const ch of ' edited') {
        transact(human, () => block.insert(at, ch));
        at += 1;
        typed += 1;
      }
    }
    for (let k = 0; k < 7; k++) {
      const block = blocks[Math.floor(r() * blocks.length)];
      const text = textOf(block);
      const i = text.indexOf(' ', Math.floor(r() * Math.max(1, text.length - 20))) + 1;
      const j = text.indexOf(' ', i);
      if (i > 0 && j > i) {
        transact(human, () => block.delete(i, j - i));
        deleted += 1;
      }
    }
    for (let k = 0; k < 5; k++) {
      const block = blocks[Math.floor(r() * blocks.length)];
      if (block.length > 30) {
        transact(human, () => block.format(10, 8, { bold: {} }));
        formatted += 1;
      }
    }
    sync();
  }
  sync();
  const main = clients[0];
  const root = tabBody(main, SEED_TAB)!;
  const all = paragraphs(root);
  const state = stateV2(main);
  return {
    state,
    stats: {
      sections,
      topBlocks: root.toArray().length,
      paragraphs: all.length,
      words: all.reduce((n, block) => n + textOf(block).split(/\s+/).filter(Boolean).length, 0),
      typed,
      deleted,
      formatted,
      v2Bytes: state.length,
      ms: Math.round(performance.now() - started),
    },
  };
}
