// S7b (P3-0): the 200-page document and the agents' edits on Yjs v14, in S3's artifact layout
// (spikes/p3-store/s3/lib/artifact.mjs: `tabs` → tab `t1` → `body` bound to Tiptap, beside a `threads` node).
// The document is built from §4.4-shaped PM JSON through the v14 writer path (`pmnodeToDelta` with the editor's exact
// schema, S1's writer mapping), section by section, then roughened by keystroke-sized edits from three writers so its
// item structure looks like a document that was typed and edited, not one import. Throwaway spike code.
import * as Y from '@y/y';
import { pmnodeToDelta } from '@y/prosemirror';
import type { Schema, Node as PMNode } from 'prosemirror-model';

export const TAB = 't1';
export const body = (doc: Y.Doc): Y.Node => (doc.get('tabs').getAttr(TAB) as Y.Node).getAttr('body') as Y.Node;
export const hasBody = (doc: Y.Doc): boolean => doc.get('tabs').getAttr(TAB) instanceof Y.Node;

export const prng = (seed = 7) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const WORDS = 'the plan ships quarterly with design review notes owners budget risks timeline metrics agents draft final table code callout launch beta scope users latency memory store version history restore compare editor comment thread slide deck element because which their across between during market customer revenue support research hiring onboarding retention pipeline forecast'.split(' ');
export const sentence = (r: () => number, n = 8 + Math.floor(r() * 14)): string => {
  const w: string[] = [];
  for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(r() * WORDS.length)]);
  const s = w.join(' ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
};
const prose = (r: () => number, words: number): string => {
  const out: string[] = [];
  let n = 0;
  while (n < words) {
    const s = sentence(r);
    out.push(s);
    n += s.split(' ').length;
  }
  return out.join(' ');
};

type J = Record<string, unknown>;
const t = (text: string, marks?: J[]): J => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (id: string, content: J[]): J => ({ type: 'paragraph', attrs: { id }, content });

/** One "page-sized" section (about 450 to 500 words) in §4.4's block mix; every block carries an id. */
export function sectionJSON(s: number, r: () => number): J[] {
  const k = `s${s}`;
  const blocks: J[] = [];
  blocks.push({ type: 'heading', attrs: { level: 2, id: `${k}h` }, content: [t(`${s + 1}. ${sentence(r, 4).slice(0, -1)}`)] });
  const comment = s % 3 === 0 ? [{ type: 'comment', attrs: { threadId: `th${s}`, orphan: false } }] : undefined;
  blocks.push(p(`${k}p1`, [t(`${prose(r, 40)} `), t('bold words', [{ type: 'bold' }]), t(' and '), t('a commented passage', comment), t(' with a '), t('link', [{ type: 'link', attrs: { href: `https://example.com/${s}` } }]), t(`. ${prose(r, 40)}`)]));
  blocks.push(p(`${k}p2`, [t(prose(r, 90))]));
  blocks.push({ type: 'heading', attrs: { level: 3, id: `${k}h3` }, content: [t(`Details ${s + 1}`)] });
  blocks.push(p(`${k}p3`, [t(`${prose(r, 60)} `), t('italic aside', [{ type: 'italic' }]), t(` ${prose(r, 30)}`)]));
  blocks.push({
    type: 'bulletList',
    attrs: { id: `${k}ul` },
    content: [0, 1, 2, 3].map((i) => ({ type: 'listItem', attrs: { id: `${k}li${i}` }, content: [p(`${k}li${i}p`, [t(prose(r, 12))])] })),
  });
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
  if (s % 6 === 4) {
    blocks.push({
      type: 'taskList',
      attrs: { id: `${k}tl` },
      content: [0, 1].map((i) => ({ type: 'taskItem', attrs: { id: `${k}ti${i}`, checked: i === 1 }, content: [p(`${k}ti${i}p`, [t(prose(r, 8))])] })),
    });
  }
  if (s % 7 === 5) blocks.push({ type: 'callout', attrs: { id: `${k}co`, tone: 'info' }, content: [p(`${k}cop`, [t(prose(r, 25))])] });
  blocks.push(p(`${k}p5`, [t(prose(r, 70))]));
  return blocks;
}

export const blockDelta = (schema: Schema, json: J) => pmnodeToDelta(schema.nodeFromJSON(json) as PMNode);

/** The empty artifact: tab t1 with an empty body, an empty threads node. */
export function createArtifact(doc: Y.Doc): void {
  doc.transact(() => {
    const tab = new Y.Node('tab');
    doc.get('tabs').setAttr(TAB, tab);
    tab.setAttr('title', 'Main');
    tab.setAttr('order', 'a0');
    tab.setAttr('body', new Y.Node('doc'));
  });
}

export const textOf = (n: Y.Node): string => (n.toArray() as unknown[]).filter((x) => typeof x === 'string').join('');
export const idOf = (n: unknown): string | null => (n instanceof Y.Node ? ((n.getAttr('id') as string | undefined) ?? null) : null);

/** Every paragraph-like text block under `root` with its id (depth-first): what agents pick targets from. */
export function textBlocks(root: Y.Node, out: Y.Node[] = []): Y.Node[] {
  for (const c of root.toArray() as unknown[]) {
    if (!(c instanceof Y.Node)) continue;
    if (c.name === 'paragraph' || c.name === 'heading') out.push(c);
    else textBlocks(c, out);
  }
  return out;
}

export function findBlock(root: Y.Node, id: string): Y.Node | null {
  for (const c of root.toArray() as unknown[]) {
    if (!(c instanceof Y.Node)) continue;
    if (c.getAttr('id') === id) return c;
    const inner = findBlock(c, id);
    if (inner) return inner;
  }
  return null;
}

/** Words and characters of the body (plain text of every text block). */
export function measure(root: Y.Node): { topBlocks: number; textBlocks: number; words: number; chars: number } {
  const blocks = textBlocks(root);
  let words = 0;
  let chars = 0;
  for (const b of blocks) {
    const s = textOf(b);
    chars += s.length;
    words += s.split(/\s+/).filter(Boolean).length;
  }
  return { topBlocks: (root.toArray() as unknown[]).length, textBlocks: blocks.length, words, chars };
}

export interface AgentOpts {
  /** block ids the agent must not touch (the human's neighbourhood), unless `target` names one */
  avoid?: Set<string>;
  /** a block id every batch also edits (the same-block IME case) */
  target?: string | null;
  opsMin?: number;
  opsMax?: number;
}

/**
 * One agent batch (one tool call → one transaction on the agent's replica): 3 to 6 ops mixing a word replacement,
 * a whole-paragraph rewrite (text replaced, node and id kept), a new paragraph after a heading, a table cell, and the
 * deletion of a paragraph this agent inserted earlier (so the document stays the same size). Returns the ids touched.
 */
export function agentBatch(doc: Y.Doc, schema: Schema, r: () => number, tag: string, seq: { n: number; mine: string[] }, opts: AgentOpts = {}): { ids: string[]; ops: string[] } {
  const ids: string[] = [];
  const ops: string[] = [];
  const root = body(doc);
  const blocks = textBlocks(root).filter((b) => !opts.avoid?.has(idOf(b) ?? ''));
  const pick = () => blocks[Math.floor(r() * blocks.length)];
  const count = (opts.opsMin ?? 3) + Math.floor(r() * ((opts.opsMax ?? 6) - (opts.opsMin ?? 3) + 1));
  doc.transact(() => {
    if (opts.target) {
      const b = findBlock(root, opts.target);
      if (b) {
        // a word replacement early in the human's block (S4's replace_text in the same paragraph)
        const s = textOf(b);
        const i = s.indexOf(' ') + 1;
        const j = s.indexOf(' ', i);
        if (i > 0 && j > i) {
          b.delete(i, j - i);
          b.insert(i, `${tag}${seq.n}`);
        }
        ids.push(opts.target);
        ops.push('replace_text(target)');
      }
    }
    for (let k = 0; k < count; k++) {
      const roll = r();
      if (roll < 0.35) {
        const b = pick();
        const s = textOf(b);
        const i = s.indexOf(' ', Math.floor(r() * Math.max(1, s.length - 20))) + 1;
        const j = s.indexOf(' ', i);
        if (i > 0 && j > i) {
          b.delete(i, j - i);
          b.insert(i, `${tag.toLowerCase()}word${seq.n}`);
        }
        ids.push(idOf(b)!);
        ops.push('replace_text');
      } else if (roll < 0.6) {
        const b = pick();
        const len = b.length;
        b.delete(0, len);
        b.insert(0, `${tag} rewrote this block (${seq.n}). ${prose(r, 50)}`);
        ids.push(idOf(b)!);
        ops.push('replace_block');
      } else if (roll < 0.8 || seq.mine.length === 0) {
        const children = root.toArray() as unknown[];
        let i = Math.floor(r() * children.length);
        while (i < children.length && !(children[i] instanceof Y.Node && (children[i] as Y.Node).name === 'heading')) i++;
        if (i >= children.length) i = children.length - 1;
        if (opts.avoid?.has(idOf(children[i]) ?? '') || opts.avoid?.has(idOf(children[i + 1]) ?? '')) i = 0;
        const id = `${tag}${seq.n}x${k}`;
        root.insert(i + 1, [blockDelta(schema, p(id, [t(`${tag} inserted this paragraph. ${prose(r, 40)}`)]))]);
        seq.mine.push(id);
        ids.push(id);
        ops.push('insert');
      } else if (roll < 0.9) {
        const cells = blocks.filter((b) => /r[1-3]c[0-2]p$/.test(idOf(b) ?? ''));
        const c = cells[Math.floor(r() * cells.length)];
        if (c) {
          c.delete(0, c.length);
          c.insert(0, `${Math.floor(r() * 10000)}`);
          ids.push(idOf(c)!);
          ops.push('set_cell');
        }
      } else {
        const id = seq.mine.shift();
        const children = root.toArray() as unknown[];
        const i = children.findIndex((c) => idOf(c) === id);
        if (i >= 0) {
          root.delete(i, 1);
          ids.push(id!);
          ops.push('delete');
        }
      }
    }
  });
  seq.n += 1;
  return { ids, ops };
}
