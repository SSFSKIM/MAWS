// Version history's pure half (D1 and D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent,
// Decision Log 29 and 34): two stored V2 states rendered through v14's DiffRenderer with authors and times from
// provenance, the change list behind "N changes" and ↑ ↓, "Show editors" for a selection of the live document, and the
// blocks a move or a retype re-inserted. Copied and typed from P3-0's S3 (`spikes/p3-store/s3/lib/history.mjs`), with
// S3's refinements folded in: touching runs merge into one change, comment marks are not changes, and attribute marks
// on a node the diff inserts are not attribute changes. No DOM; the editor draws what this computes (editor/history).
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { applyV2, type Carry, type ContentMap, type Doc, type Node as YType } from '../yjs';
import { YNode, createDiffRenderer, newDocGcOff, type DiffRenderer } from '../yjs/document';
import { ynodeToPmnode } from '../yjs/prosemirror';
import { attributedNodes, schemaFor } from './schema';
import { isCommentKey } from './threads';

/** Two throwaway gc-off docs (the earlier state and the later one) and the renderer that draws their difference. */
export interface Diff {
  prevDoc: Doc;
  nextDoc: Doc;
  renderer: DiffRenderer;
  destroy(): void;
}

/**
 * Loads two states into throwaway gc-off docs and builds the renderer; `prevState` null compares with nothing (the
 * oldest version: everything in it reads as inserted). The caller picks the fragment to show from `nextDoc` and
 * destroys the diff when the preview closes; the live doc is never touched.
 */
export function openDiff({ prevState, nextState, attributions }: { prevState: Uint8Array | null; nextState: Uint8Array; attributions: ContentMap }): Diff {
  const prevDoc = newDocGcOff();
  if (prevState) applyV2(prevDoc, prevState);
  const nextDoc = newDocGcOff();
  applyV2(nextDoc, nextState);
  const renderer = createDiffRenderer(prevDoc, nextDoc, { attributions });
  return {
    prevDoc,
    nextDoc,
    renderer,
    destroy: () => {
      renderer.destroy();
      prevDoc.destroy();
      nextDoc.destroy();
    },
  };
}

/** A fragment of a diff's `nextDoc` rendered headless, as the preview draws it (what a test or the agent reads). */
export const renderDiff = (ytype: YType, renderer: DiffRenderer, schema: Schema = schemaFor()): PMNode => ynodeToPmnode(ytype, schema, { renderer, attributedNodes });

export type RunKind = 'ins' | 'del' | 'fmt' | 'attrs';

/** One attribution mark of a rendered node: who (an actor key, X29's `actorKey`) did what, and when (epoch ms). */
export interface Mark {
  kind: RunKind;
  who: string | null;
  at: number | null;
  /** `attrs`: the node attribute that changed. */
  attr?: string;
  /** `fmt`: the format keys that changed (Yjs storage keys) with who changed each. */
  byAttr?: Record<string, string[]>;
}

const first = (ids: unknown): string | null => (Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : null);
const time = (at: unknown): number | null => (typeof at === 'number' ? at : null);

/** The attribution marks of one rendered node. */
export function readMarks(node: PMNode): Mark[] {
  const out: Mark[] = [];
  for (const mark of node.marks) {
    const attrs = mark.attrs as Record<string, unknown>;
    switch (mark.type.name) {
      case 'y-attributed-insert':
        out.push({ kind: 'ins', who: first(attrs.userIds), at: time(attrs.timestamp) });
        break;
      case 'y-attributed-delete':
        out.push({ kind: 'del', who: first(attrs.userIds), at: time(attrs.timestamp) });
        break;
      case 'y-attributed-format':
        out.push({ kind: 'fmt', who: first(attrs.userIds), at: time(attrs.timestamp), byAttr: (attrs.userIdsByAttr as Record<string, string[]> | null) ?? {} });
        break;
      case 'y-attributed-attrs':
        for (const [attr, change] of Object.entries((attrs.changes as Record<string, { userIds?: unknown; timestamp?: unknown } | null> | null) ?? {})) {
          out.push({ kind: 'attrs', attr, who: first(change?.userIds), at: time(change?.timestamp) });
        }
        break;
    }
  }
  return out;
}

/** An attributed run of a rendered document: a text run, a whole node inserted or deleted, or a node's attribute. */
export interface Run extends Mark {
  from: number;
  /** A node attribute change is a point at the node's start (`from + 1`). */
  to: number;
  /** The nearest block as `type#id`. */
  where: string;
  text: string;
  node: boolean;
}

// What "N changes" leaves out (parent Decision Log 29): a format run whose every key is a comment (a comment is not an
// edit of the document), and an attribute mark on a node the diff inserts (its attributes came with it).
const counted = (mark: Mark, marks: readonly Mark[]): boolean => {
  if (mark.kind === 'fmt') return Object.keys(mark.byAttr ?? {}).some((key) => !isCommentKey(key));
  if (mark.kind === 'attrs') return !marks.some((other) => other.kind === 'ins');
  return true;
};

/** Every attributed run that is a change of the document, in document order. */
export function attributedRuns(doc: PMNode): Run[] {
  const runs: Run[] = [];
  doc.descendants((node, pos, parent) => {
    const block = node.isText ? parent : node;
    const where = `${block?.type.name ?? '?'}#${(block?.attrs.id as string | null | undefined) ?? '?'}`;
    const marks = readMarks(node);
    for (const mark of marks) {
      if (!counted(mark, marks)) continue;
      const point = mark.kind === 'attrs';
      runs.push({ ...mark, from: pos, to: point ? pos + 1 : pos + node.nodeSize, where, text: node.isText ? (node.text ?? '') : node.textContent, node: !node.isText });
    }
    return true;
  });
  return runs.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** One change of "N changes": runs that overlap or touch, with their authors and the latest time. */
export interface Change {
  from: number;
  to: number;
  kinds: RunKind[];
  who: string[];
  at: number | null;
  where: string;
  runs: number;
}

/** The changes of a rendered diff (a replace is one change; a new block with its text is one change). */
export function changeList(doc: PMNode): Change[] {
  const changes: Array<Omit<Change, 'kinds' | 'who'> & { kinds: Set<RunKind>; who: Set<string> }> = [];
  for (const run of attributedRuns(doc)) {
    const last = changes[changes.length - 1];
    if (last && run.from <= last.to) {
      last.to = Math.max(last.to, run.to);
      last.kinds.add(run.kind);
      if (run.who !== null) last.who.add(run.who);
      last.at = Math.max(last.at ?? 0, run.at ?? 0) || null;
      last.runs += 1;
    } else {
      changes.push({ from: run.from, to: run.to, kinds: new Set([run.kind]), who: new Set(run.who === null ? [] : [run.who]), at: run.at, where: run.where, runs: 1 });
    }
  }
  return changes.map((change) => ({ ...change, kinds: [...change.kinds], who: [...change.who] }));
}

/** ↓: the change after `pos`, wrapping to the first. */
export const nextChange = (changes: readonly Change[], pos: number): Change | null => changes.find((change) => change.from > pos) ?? changes[0] ?? null;
/** ↑: the change before `pos`, wrapping to the last. */
export const prevChange = (changes: readonly Change[], pos: number): Change | null => [...changes].reverse().find((change) => change.from < pos) ?? changes[changes.length - 1] ?? null;

/** Every block under `root` by its id (the host keeps ids unique, §4.4). */
export function indexById(root: YType): Map<string, YType> {
  const byId = new Map<string, YType>();
  const walk = (node: YType): void => {
    for (const child of node.toArray()) {
      if (!(child instanceof YNode)) continue;
      const id: unknown = child.getAttr('id');
      if (typeof id === 'string') byId.set(id, child);
      walk(child);
    }
  };
  walk(root);
  return byId;
}

/** One editor of a selection: an actor key, the latest time it touched the range, and how. */
export interface Editor {
  who: string;
  at: number;
  /** `ins`, `del`, `fmt`, or `attrs:<name>` for a block attribute. */
  kinds: string[];
}

type Ranges = ReturnType<ContentMap['inserts']['slice']>;
const authorOf = (ranges: Ranges, who: 'insert' | 'delete'): Array<{ who: string; at: number }> => {
  const out: Array<{ who: string; at: number }> = [];
  for (const range of ranges) {
    const attrs = range.attrs ?? [];
    const actor = attrs.find((attr) => attr.name === who)?.val;
    const at = attrs.find((attr) => attr.name === `${who}At`)?.val;
    if (typeof actor === 'string') out.push({ who: actor, at: typeof at === 'number' ? at : 0 });
  }
  return out;
};

/**
 * "Show editors" for the selection [from, to) of the live editor's document: who inserted the visible content in the
 * range, who formatted it, who deleted content inside it, who last set its blocks' attributes, each with their latest
 * time, newest first. Read from provenance alone, so it is the same before and after a compaction of the log; maps
 * ProseMirror to Yjs through the blocks' ids in `liveRoot` (the live tab body).
 */
export function showEditors({ doc, from, to, liveRoot, provenance }: { doc: PMNode; from: number; to: number; liveRoot: YType; provenance: ContentMap }): Editor[] {
  const byId = indexById(liveRoot);
  const hits: Array<{ who: string; at: number; kind: string }> = [];
  const add = (ranges: Ranges, who: 'insert' | 'delete', kind: string) => {
    for (const hit of authorOf(ranges, who)) hits.push({ ...hit, kind });
  };
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const ynode = byId.get(node.attrs.id as string);
    if (!ynode) return false;
    const a = Math.max(from, pos + 1) - (pos + 1);
    const b = Math.min(to, pos + 1 + node.content.size) - (pos + 1);
    let index = 0;
    for (let item = ynode._start; item !== null; item = item.right) {
      const visible = item.countable && !item.deleted ? item.length : 0;
      const start = index;
      const end = index + visible;
      const { client, clock } = item.id;
      if (item.deleted) {
        if (start > a && start < b) add(provenance.deletes.slice(client, clock, item.length), 'delete', 'del');
      } else if (!item.countable) {
        if (start >= a && start <= b) add(provenance.inserts.slice(client, clock, item.length), 'insert', 'fmt');
      } else if (end > a && start < b) {
        const s = Math.max(a, start) - start;
        const e = Math.min(b, end) - start;
        add(provenance.inserts.slice(client, clock + s, e - s), 'insert', 'ins');
      }
      index = end;
    }
    for (const [key, item] of ynode._map) {
      if (!item.deleted && key !== 'id') add(provenance.inserts.slice(item.id.client, item.id.clock, item.length), 'insert', `attrs:${key}`);
    }
    return false;
  });
  const byWho = new Map<string, { who: string; at: number; kinds: Set<string> }>();
  for (const hit of hits) {
    const entry = byWho.get(hit.who) ?? { who: hit.who, at: 0, kinds: new Set<string>() };
    entry.at = Math.max(entry.at, hit.at);
    entry.kinds.add(hit.kind);
    byWho.set(hit.who, entry);
  }
  return [...byWho.values()].map(({ who, at, kinds }) => ({ who, at, kinds: [...kinds].sort() })).sort((x, y) => y.at - x.at);
}

/**
 * The blocks under `root` that a move or a type change re-inserted (parent Decision Log 34; D8b), by block id: a block
 * whose own content carries a `carry` kind in provenance (A's `carryAttribution` marks every carried character and
 * child element of the re-inserted copy). The diff draws that copy as inserted by the original author and the old one
 * as deleted; these are what the preview labels Moved or Retyped. A carried block's children are not listed again.
 */
export function carriedBlocks(root: YType, attributions: ContentMap): Map<string, Carry['kind']> {
  const carried = new Map<string, Carry['kind']>();
  const carryOf = (node: YType): Carry['kind'] | null => {
    for (let item = node._start; item !== null; item = item.right) {
      if (item.deleted || !item.countable) continue;
      for (const range of attributions.inserts.slice(item.id.client, item.id.clock, item.length)) {
        const kind = range.attrs?.find((attr) => attr.name === 'carry')?.val;
        if (kind === 'move' || kind === 'retype') return kind;
      }
    }
    return null;
  };
  const walk = (node: YType): void => {
    for (const child of node.toArray()) {
      if (!(child instanceof YNode)) continue;
      const id: unknown = child.getAttr('id');
      const kind = typeof id === 'string' ? carryOf(child) : null;
      if (kind && typeof id === 'string') carried.set(id, kind);
      else walk(child);
    }
  };
  walk(root);
  return carried;
}
