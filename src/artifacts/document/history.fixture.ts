// History's test world (P3-0's S3 `s3-history.mjs` and `s1/lib/link.mjs`, typed): a host doc (gc on, as the store
// keeps it) and replicas of it, each standing for one actor, synced synchronously; every update landing on the host is
// one log row with its actor, a time on a fake clock one minute apart (A floors provenance to the minute) and its
// attribution map as A's store writes it (`attributionMap`, a move's `carryAttribution`); versions are the host's V2
// state at a seq. S3's mid-sized seed, on this child's schema.
import type { JSONContent } from '@tiptap/core';
import { applyV1, attributionMap, carryAttribution, contentIdsOf, diffV1, mergeMaps, newDoc, onUpdate, stateV2, transact, type Carry, type ContentMap, type Doc, type Node } from '../yjs';
import { pmnodeToDelta } from '../yjs/prosemirror';
import { YNode } from '../yjs/document';
import { schemaFor } from './schema';
import { createDocument, tabBody } from './tabs';

export const TAB = 't1';
export const T0 = Date.UTC(2026, 9, 12, 9, 0, 0);
export const HUMAN = 'human';
export const AGENT_1 = 'session:00000000-0000-4000-8000-0000000000a1';
export const AGENT_2 = 'session:00000000-0000-4000-8000-0000000000a2';

export interface Row {
  seq: number;
  actor: string;
  at: number;
  update: Uint8Array;
  map: ContentMap;
}
export interface Version {
  name: string;
  seq: number;
  at: number;
  actor: string;
  state: Uint8Array;
}

const RELAY = Symbol('relay');

export class HistoryHub {
  readonly host: Doc = newDoc();
  readonly log: Row[] = [];
  readonly versions = new Map<string, Version>();
  private readonly replicas = new Map<Doc, string>();
  private writer = HUMAN;
  private minute = 0;

  constructor() {
    onUpdate(this.host, (update, origin) => {
      const actor = origin instanceof Object && this.replicas.has(origin as Doc) ? this.replicas.get(origin as Doc)! : this.writer;
      const at = T0 + ++this.minute * 60_000;
      this.log.push({ seq: this.log.length + 1, actor, at, update, map: attributionMap(contentIdsOf(update), { insertActor: actor, deleteActor: actor, at }) });
      for (const replica of this.replicas.keys()) if (replica !== origin) applyV1(replica, update, RELAY);
    });
  }

  /** A replica writing as `actor`. */
  connect(actor: string): Doc {
    const doc = newDoc();
    applyV1(doc, diffV1(this.host), RELAY);
    this.replicas.set(doc, actor);
    onUpdate(doc, (update, origin) => {
      if (origin !== RELAY) applyV1(this.host, update, doc);
    });
    return doc;
  }

  /** A write on the host itself as `actor` (the seed). */
  write(actor: string, edit: (doc: Doc) => void): void {
    this.writer = actor;
    transact(this.host, () => edit(this.host));
    this.writer = HUMAN;
  }

  get seq(): number {
    return this.log.length;
  }
  get lastAt(): number {
    return this.log[this.log.length - 1]?.at ?? T0;
  }

  version(name: string, actor: string): Version {
    const version = { name, seq: this.seq, at: this.lastAt, actor, state: stateV2(this.host) };
    this.versions.set(name, version);
    return version;
  }

  /** The merged attribution of the rows in (fromSeq, toSeq], as A's `artifacts.attributions` answers (a superset is fine). */
  attributions(fromSeq = 0, toSeq = Infinity): ContentMap {
    return mergeMaps(this.log.filter((row) => row.seq > fromSeq && row.seq <= toSeq).map((row) => row.map));
  }

  /** The last row's attribution with the writer's carries applied, as A's attribution step does after `afterUpdate`. */
  carryLast(carries: Carry[]): void {
    const row = this.log[this.log.length - 1];
    row.map = carryAttribution(row.map, this.attributions(0, row.seq - 1), carries);
  }
}

// ── the seed: S3's mid-sized document (about 12 top-level blocks per section), every block with an id ──
const WORDS = 'the plan ships quarterly with design review notes owners budget risks timeline metrics agents draft final table code callout launch beta scope users latency memory store version history restore compare editor comment thread'.split(' ');
const prng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
export function midDocJSON(sections: number, seed = 7): JSONContent {
  const r = prng(seed);
  const sentence = (n = 8 + Math.floor(r() * 10)) => {
    const words = Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
    return `${words[0].toUpperCase()}${words.slice(1)}.`;
  };
  const t = (text: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text });
  const p = (id: string, content: JSONContent[]): JSONContent => ({ type: 'paragraph', attrs: { id }, content });
  const blocks: JSONContent[] = [];
  for (let s = 0; s < sections; s++) {
    const k = `s${s}`;
    blocks.push({ type: 'heading', attrs: { level: 2, id: `${k}h` }, content: [t(`Section ${s} ${sentence(3).slice(0, -1)}`)] });
    blocks.push(p(`${k}p1`, [t(`${sentence()} `), t('bold words', [{ type: 'bold' }]), t(' and '), t('italic', [{ type: 'italic' }]), t('. ' + sentence())]));
    blocks.push(p(`${k}p2`, [t(`${sentence()} ${sentence()}`)]));
    blocks.push({
      type: 'bulletList',
      attrs: { id: `${k}ul` },
      content: [
        { type: 'listItem', attrs: { id: `${k}li1` }, content: [p(`${k}li1p`, [t(sentence(6))])] },
        { type: 'listItem', attrs: { id: `${k}li2` }, content: [p(`${k}li2p`, [t(sentence(6))])] },
      ],
    });
    blocks.push({
      type: 'taskList',
      attrs: { id: `${k}tl` },
      content: [
        { type: 'taskItem', attrs: { id: `${k}ti1`, checked: false }, content: [p(`${k}ti1p`, [t(`Task ${sentence(4)}`)])] },
        { type: 'taskItem', attrs: { id: `${k}ti2`, checked: true }, content: [p(`${k}ti2p`, [t(`Done ${sentence(4)}`)])] },
      ],
    });
    blocks.push({ type: 'blockquote', attrs: { id: `${k}q` }, content: [p(`${k}qp`, [t(sentence())])] });
    blocks.push({ type: 'codeBlock', attrs: { id: `${k}c`, language: 'js' }, content: [t(`const v${s} = ${s}\nconsole.log(v${s})`)] });
    blocks.push({
      type: 'table',
      attrs: { id: `${k}t` },
      content: [0, 1, 2].map((ri) => ({
        type: 'tableRow',
        attrs: { id: `${k}r${ri}` },
        content: [0, 1, 2].map((ci) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', attrs: { id: `${k}r${ri}c${ci}` }, content: [p(`${k}r${ri}c${ci}p`, [t(ri === 0 ? `Head ${ci}` : `v${ri}${ci}`)])] })),
      })),
    });
    blocks.push({ type: 'callout', attrs: { id: `${k}co`, tone: 'note' }, content: [p(`${k}cop`, [t(sentence(6))])] });
    blocks.push(p(`${k}p3`, [t('Figure '), { type: 'image', attrs: { src: `maws-artifact:img${s}/figure.png`, alt: `figure ${s}`, assetId: `img${s}` } }, t(` ${sentence(5)}`)]));
    blocks.push(p(`${k}p4`, [t(sentence())]));
  }
  return { type: 'doc', content: blocks };
}

/** A host seeded with S3's document in tab `t1`, credited to the human. */
export function seededHub(sections: number): HistoryHub {
  const hub = new HistoryHub();
  hub.write(HUMAN, (doc) => createDocument(doc, { title: 'Main', id: TAB, body: schemaFor().nodeFromJSON(midDocJSON(sections)) }));
  return hub;
}

// ── readers and writers over a replica's Y nodes ──
export const body = (doc: Doc): Node => tabBody(doc, TAB)!;
export function block(doc: Doc, id: string): Node {
  const find = (node: Node): Node | null => {
    for (const child of node.toArray()) {
      if (!(child instanceof YNode)) continue;
      if (child.getAttr('id') === id) return child;
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const found = find(body(doc));
  if (!found) throw new Error(`no block ${id}`);
  return found;
}
export const textOf = (node: Node): string =>
  node
    .toArray()
    .filter((part): part is string => typeof part === 'string')
    .join('');
/** A new block for a Y write, built through the schema as the binding stores it. */
export const yblock = (json: JSONContent): Node => YNode.from(pmnodeToDelta(schemaFor().nodeFromJSON(json))) as Node;
/** A mark's Yjs format (an overlapping mark is stored under a hashed key: format through the binding's own mapping). */
export function markFormat(json: { type: string; attrs?: Record<string, unknown> }): Record<string, unknown> {
  const schema = schemaFor();
  const delta = pmnodeToDelta(schema.nodes.paragraph.create(null, schema.text('x', [schema.markFromJSON(json)])));
  for (const op of delta.children) if ('format' in op && op.format) return op.format as Record<string, unknown>;
  return {};
}
