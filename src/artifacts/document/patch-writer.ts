// The patch writer (D1, D5, D6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4 [binding]; parent Decision
// Log 20e, 33 to 37): the agent's `artifact_edit` batch applied to a Y.Doc (the agent's replica) as minimal Yjs
// operations, never as a whole-fragment rewrite. Copied and typed from P3-0's `s4/src/patch-writer.ts`, with three
// changes the spec makes: (1) no whole-document clone dry run: the batch is planned and validated first in ProseMirror
// space (edit-plan.ts), touched parents only, and only a batch whose every op validated opens a transaction; (2) the
// sentence rule (sentence.ts) coarsens the word hunks of a heavily rewritten sentence; (3) carries are composed, so a
// block moved and retyped in one batch reports the characters as they were before it.
//
// In the one transaction: each touched block is written from its planned node: same type → attributes set one by one,
// a textblock's text as one delta of retains (format fixes), deletes and inserts with explicit formats, a container's
// children paired with what they were (the plan's patch origins, else the same id) and patched in place; a type change
// re-inserts the node under its id (a v14 node's name is immutable) and reports a `retype` carry for the characters
// the diff kept; then the top-level inserts, deletions and re-inserts in op order, each re-insert a `move` carry. Last,
// the written blocks are read back and compared with the plan; a difference is a bug, thrown inside the transaction,
// which the caller's replica (A's `AgentReplica.edit`) discards rather than sends.
import type { Node as PMNode } from '@tiptap/pm/model';
import * as delta from 'lib0/delta';
import { transact, type Doc, type Node } from '../yjs';
import { ContentString, ContentType, Item, YNode, findIndexSS } from '../yjs/document';
import { pmnodeToDelta, ynodeToPmnode } from '../yjs/prosemirror';
import type { Applied, ApplyOptions, Carry, Op, Slot } from './edit-ops';
import { canonicalJSON, joinedCells, pmCells, planEdit, textblocksOf, type Plan, type RootAction } from './edit-plan';
import { diffCells, equalMap, textOf } from './inline-diff';
import { schemaFor } from './schema';
import { sentenceHunks } from './sentence';

export { EditError } from './edit-ops';
export type { Applied, ApplyOptions, Carry, EditRefusal, Op, OpResult } from './edit-ops';

type Fmt = Record<string, unknown>;
interface DeltaCell {
  fmt: Fmt;
  ch?: string; // a UTF-16 unit of text
  embed?: unknown;
}
interface DeltaOp {
  insert?: string | unknown[];
  format?: Fmt | null;
}

/** A Y delta's cells (S4's `cellsOf`): one per UTF-16 unit of text, one per embed, each with its format record. */
function deltaCells(d: unknown): DeltaCell[] {
  const out: DeltaCell[] = [];
  for (const op of (d as { children: Iterable<DeltaOp> }).children) {
    const fmt = op.format ? { ...op.format } : {};
    if (typeof op.insert === 'string') for (let i = 0; i < op.insert.length; i++) out.push({ fmt, ch: op.insert[i] });
    else if (Array.isArray(op.insert)) for (const embed of op.insert) out.push({ fmt, embed });
  }
  return out;
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The keys to change on `old` to make it `want`: changed values, and an explicit null for each key `want` lacks. */
function fmtPatch(old: Fmt, want: Fmt): Fmt | null {
  const patch: Fmt = {};
  let any = false;
  for (const [key, value] of Object.entries(want)) {
    if (!same(old[key], value)) {
      patch[key] = value;
      any = true;
    }
  }
  for (const key of Object.keys(old)) {
    if (!(key in want)) {
      patch[key] = null;
      any = true;
    }
  }
  return any ? patch : null;
}

const itemOf = (node: Node): Slot => [node._item!.id.client, node._item!.id.clock];
const slotKey = (slot: Slot): string => `${slot[0]}:${slot[1]}`;

/** Every visible slot's item id in document order, descending into child nodes (each node's own item first). */
export function deepSlotIds(node: Node, out: Slot[] = []): Slot[] {
  for (let item = node._start; item !== null; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const content = item.content;
    if (content instanceof ContentString) for (let k = 0; k < content.str.length; k++) out.push([item.id.client, item.id.clock + k]);
    else if (content instanceof ContentType) {
      out.push([item.id.client, item.id.clock]);
      deepSlotIds(content.type as Node, out);
    } else for (let k = 0; k < item.length; k++) out.push([item.id.client, item.id.clock + k]);
  }
  return out;
}

/** The textblock nodes under a Y node (the node itself if it is one). */
export function textblocksY(node: Node): Node[] {
  const schema = schemaFor();
  const out: Node[] = [];
  const walk = (at: Node): void => {
    if (schema.nodes[at.name]?.isTextblock) out.push(at);
    else for (const child of at.toArray()) if (child instanceof YNode) walk(child);
  };
  walk(node);
  return out;
}

/** The slots of several textblocks as one sequence, a null between blocks (the joined cells' separator). */
const joinedSlots = (blocks: Node[]): Array<Slot | null> => blocks.flatMap((block, k) => (k < blocks.length - 1 ? [...deepSlotIds(block), null] : deepSlotIds(block)));

/** The item holding `slot` in `doc`, or null when the doc has no such struct. */
export function itemAt(doc: Doc, slot: Slot): Item | null {
  const structs = doc.store.clients.get(slot[0]);
  if (!structs || slot[1] >= doc.store.getClock(slot[0])) return null;
  const struct = structs[findIndexSS(structs, slot[1])];
  return struct instanceof Item ? struct : null;
}

class YWriter {
  private readonly carries: Carry[] = [];
  private readonly orders = new Map<string, string[]>();
  private readonly nodes = new Map<string, Node>(); // a touched top-level block's key → its Y node now
  private readonly schema = schemaFor();

  constructor(
    private readonly doc: Doc,
    private readonly plan: Plan,
  ) {}

  write(): Carry[] {
    const { index } = this.plan;
    for (const [key, state] of this.plan.tops) {
      if (!state.base || !state.pm) continue;
      const base = index.pm(state.base);
      const body = state.base.node.parent as Node;
      this.nodes.set(key, this.writeNode(body, index.position(state.base), state.base.node, base, state.pm));
    }
    for (const action of this.plan.actions) this.root(action);
    this.verify();
    return this.composed();
  }

  // ── a block ──
  private writeNode(parent: Node, i: number, y: Node, base: PMNode, target: PMNode): Node {
    if (target === base) return y;
    if (y.name !== target.type.name) return this.retype(parent, i, y, base, target);
    for (const [key, value] of Object.entries(target.attrs)) {
      if (same(y.getAttr(key) ?? null, value ?? null)) continue;
      if (value == null) y.deleteAttr(key);
      else y.setAttr(key, value);
    }
    if (target.isTextblock) this.patchInline(y, base, target);
    else if (!target.isLeaf) this.patchChildren(y, base, target);
    return y;
  }

  /** A container's children against what they were: paired by the plan's patch origins, else by id, in order. */
  private patchChildren(y: Node, base: PMNode, target: PMNode): void {
    const baseKids: PMNode[] = [];
    base.forEach((child) => baseKids.push(child));
    if (y.toArray().length !== baseKids.length) throw new Error(`the patch writer read ^${String(base.attrs.id)} with ${baseKids.length} children, Yjs holds ${y.toArray().length}`);
    const byNode = new Map(baseKids.map((child, k) => [child, k]));
    const byId = new Map<unknown, number>();
    baseKids.forEach((child, k) => (byId.has(child.attrs.id) ? byId.set(child.attrs.id, -1) : byId.set(child.attrs.id, k)));
    const origin = (node: PMNode): number | undefined => {
      for (let at: PMNode | undefined = node; at; at = this.plan.origins.get(at)) if (byNode.has(at)) return byNode.get(at);
      return undefined;
    };
    const targets: PMNode[] = [];
    target.forEach((child) => targets.push(child));
    // origins first, then same ids, keeping the paired old indices increasing
    const pair = targets.map(origin);
    const claimed = new Set(pair.filter((k): k is number => k !== undefined));
    targets.forEach((child, n) => {
      if (pair[n] !== undefined) return;
      const k = byId.get(child.attrs.id);
      if (k === undefined || k < 0 || claimed.has(k)) return;
      const before = pair.slice(0, n).filter((p): p is number => p !== undefined);
      const after = pair.slice(n + 1).filter((p): p is number => p !== undefined);
      if (before.every((p) => p < k) && after.every((p) => p > k)) {
        pair[n] = k;
        claimed.add(k);
      }
    });
    let last = -1;
    pair.forEach((k, n) => {
      if (k === undefined) return;
      if (k <= last) pair[n] = undefined; // out of order: written as new, the old child deleted
      else last = k;
    });
    let yi = 0;
    let bi = 0;
    targets.forEach((child, n) => {
      const k = pair[n];
      if (k === undefined) {
        y.insert(yi++, [pmnodeToDelta(child)]);
        return;
      }
      for (; bi < k; bi++) y.delete(yi, 1);
      this.writeNode(y, yi, y.get(yi) as Node, baseKids[k], child);
      yi++;
      bi = k + 1;
    });
    for (; bi < baseKids.length; bi++) y.delete(yi, 1);
  }

  /** A textblock's text as one delta: retains with format fixes, the hunks' deletes and explicit-format inserts. */
  private patchInline(y: Node, base: PMNode, target: PMNode): void {
    const oldCells = pmCells(base);
    const newCells = pmCells(target);
    const hunks = sentenceHunks(textOf(oldCells), textOf(newCells), diffCells(oldCells, newCells, { mergeWhitespace: this.plan.mergeWhitespace }));
    const have = deltaCells(y.toDelta());
    const want = deltaCells(pmnodeToDelta(target));
    if (have.length !== oldCells.length || want.length !== newCells.length) throw new Error(`the patch writer's cells of ^${String(base.attrs.id)} disagree with Yjs (${have.length}/${oldCells.length}, ${want.length}/${newCells.length})`);
    const d = delta.create();
    let i = 0;
    let j = 0;
    const retainUntil = (until: number) => {
      while (i < until) {
        const patch = fmtPatch(have[i].fmt, want[j].fmt);
        let n = 1;
        while (i + n < until && same(fmtPatch(have[i + n].fmt, want[j + n].fmt), patch)) n++;
        d.retain(n, patch ?? undefined);
        i += n;
        j += n;
      }
    };
    for (const hunk of hunks) {
      retainUntil(hunk.from);
      if (hunk.to > hunk.from) d.delete(hunk.to - hunk.from);
      insertRuns(d, want.slice(hunk.nFrom, hunk.nTo), have[hunk.from - 1]?.fmt ?? {});
      i = hunk.to;
      j = hunk.nTo;
    }
    retainUntil(have.length);
    y.applyDelta(d.done());
  }

  /** A type change: the node re-inserted under its id; the characters the diff kept are carried (provenance). */
  private retype(parent: Node, i: number, y: Node, base: PMNode, target: PMNode): Node {
    const oldBlocks = textblocksY(y);
    const oldSlots = joinedSlots(oldBlocks);
    const source = itemOf(y);
    parent.delete(i, 1);
    parent.insert(i, [pmnodeToDelta(target)]);
    const fresh = parent.get(i) as Node;
    const newBlocks = textblocksY(fresh);
    const newSlots = joinedSlots(newBlocks);
    const oldCells = joinedCells(textblocksOf(base));
    const newCells = joinedCells(textblocksOf(target));
    if (oldSlots.length !== oldCells.length || newSlots.length !== newCells.length) throw new Error(`the patch writer's cells of ^${String(base.attrs.id)} disagree with Yjs on a type change`);
    const hunks = sentenceHunks(textOf(oldCells), textOf(newCells), diffCells(oldCells, newCells, { mergeWhitespace: this.plan.mergeWhitespace }));
    const carry: Carry = {
      kind: 'retype',
      blockId: String(target.attrs.id),
      from: [],
      to: [],
      source,
      node: itemOf(fresh),
      blocks: oldBlocks.slice(0, newBlocks.length).map((block, k) => [itemOf(block), itemOf(newBlocks[k])]),
    };
    equalMap(oldCells.length, hunks).forEach((n, o) => {
      const from = oldSlots[o];
      const to = n === undefined ? null : newSlots[n];
      if (from && to) {
        carry.from.push(from);
        carry.to.push(to);
      }
    });
    this.carries.push(carry);
    return fresh;
  }

  // ── the top level ──
  private order(tabId: string): string[] {
    let order = this.orders.get(tabId);
    if (!order) this.orders.set(tabId, (order = this.plan.index.tops(tabId).map((top) => this.plan.keyOf(top))));
    return order;
  }

  private body(tabId: string): Node {
    const top = this.plan.index.tops(tabId)[0];
    if (top) return top.node.parent as Node;
    throw new Error(`the patch writer found no body for tab ${tabId}`);
  }

  private root(action: RootAction): void {
    const body = this.body(action.tabId);
    const order = this.order(action.tabId);
    if (action.kind === 'insert') {
      const at = action.after === null ? 0 : order.indexOf(action.after) + 1;
      const nodes = action.keys.map((key, n) => this.plan.tops.get(key)?.pm ?? action.snapshot[n]);
      body.insert(at, nodes.map((node) => pmnodeToDelta(node)));
      action.keys.forEach((key, n) => {
        order.splice(at + n, 0, key);
        this.nodes.set(key, body.get(at + n) as Node);
      });
    } else if (action.kind === 'delete') {
      const at = order.indexOf(action.key);
      body.delete(at, 1);
      order.splice(at, 1);
      this.nodes.delete(action.key);
    } else {
      const from = order.indexOf(action.key);
      const node = body.get(from) as Node;
      const copy = node.toDeltaDeep();
      const fromSlots = deepSlotIds(node);
      const fromBlocks = textblocksY(node).map(itemOf);
      const source = itemOf(node);
      body.delete(from, 1);
      order.splice(from, 1);
      const to = action.after === null ? 0 : order.indexOf(action.after) + 1;
      body.insert(to, [copy]);
      order.splice(to, 0, action.key);
      const fresh = body.get(to) as Node;
      this.nodes.set(action.key, fresh);
      const toBlocks = textblocksY(fresh).map(itemOf);
      this.carries.push({
        kind: 'move',
        blockId: String(fresh.getAttr('id')),
        from: fromSlots,
        to: deepSlotIds(fresh),
        source,
        node: itemOf(fresh),
        blocks: fromBlocks.map((block, k) => [block, toBlocks[k]]),
      });
    }
  }

  // ── after ──
  /** The written blocks read back against the plan: a difference is a bug, never a validation failure. */
  private verify(): void {
    for (const [tabId, keys] of this.plan.orders) {
      const ids = this.body(tabId)
        .toArray()
        .map((node) => (node as Node).getAttr('id'));
      const want = keys.map((key) => (key.startsWith('\u0000') ? undefined : key));
      if (ids.length !== want.length || want.some((id, k) => id !== undefined && id !== ids[k])) throw new Error(`the patch writer's top-level order in tab ${tabId} diverged from its plan`);
    }
    for (const [key, state] of this.plan.tops) {
      if (!state.pm) continue;
      const node = this.nodes.get(key) ?? state.base?.node;
      if (!node || JSON.stringify(canonicalJSON(ynodeToPmnode(node, this.schema))) !== JSON.stringify(canonicalJSON(state.pm))) throw new Error(`the patch writer's write of ^${key} diverged from its plan`);
    }
  }

  /**
   * The carries with every `from` traced back to the characters as they were before the batch (a block retyped then
   * moved reports its original characters), pairs whose `to` did not survive the batch dropped, and pairs whose `from`
   * the batch itself wrote dropped (the agent's own new words, credited to it anyway).
   */
  private composed(): Carry[] {
    const back = new Map<string, Slot>();
    const fresh = (slot: Slot) => slot[0] === this.doc.clientID && slot[1] >= this.startClock;
    const out: Carry[] = [];
    for (const carry of this.carries) {
      const trace = (slot: Slot): Slot => back.get(slotKey(slot)) ?? slot;
      const from = carry.from.map(trace);
      const source = carry.source && trace(carry.source);
      const blocks = carry.blocks?.map(([old, now]): [Slot, Slot] => [trace(old), now]);
      carry.to.forEach((to, k) => back.set(slotKey(to), from[k]));
      if (carry.node && source) back.set(slotKey(carry.node), source);
      for (const [old, now] of blocks ?? []) back.set(slotKey(now), old);
      out.push({ ...carry, from, source, blocks });
    }
    const alive = (slot: Slot) => {
      const item = itemAt(this.doc, slot);
      return item !== null && !item.deleted;
    };
    return out
      .map((carry) => {
        const keep = carry.to.map((to, k) => alive(to) && !fresh(carry.from[k]));
        return { ...carry, from: carry.from.filter((_, k) => keep[k]), to: carry.to.filter((_, k) => keep[k]) };
      })
      .filter((carry) => carry.to.length > 0 || (carry.node !== undefined && alive(carry.node)));
  }

  /** The doc's own clock before the batch: what the batch writes is at or after it. */
  startClock = 0;
}

/** Inserts `cells` with explicit formats: every key active on the left that a run lacks is an explicit null (A5). */
function insertRuns(d: ReturnType<typeof delta.create>, cells: DeltaCell[], leftFmt: Fmt): void {
  let active = leftFmt;
  const explicit = (fmt: Fmt): Fmt => {
    const out: Fmt = { ...fmt };
    for (const key of Object.keys(active)) if (!(key in out)) out[key] = null;
    active = fmt;
    return out;
  };
  let k = 0;
  while (k < cells.length) {
    if (cells[k].embed !== undefined) {
      d.insert([cells[k].embed], explicit(cells[k].fmt));
      k++;
      continue;
    }
    let text = cells[k].ch ?? '';
    let n = 1;
    while (k + n < cells.length && cells[k + n].embed === undefined && same(cells[k + n].fmt, cells[k].fmt)) text += cells[k + n++].ch ?? '';
    d.insert(text, explicit(cells[k].fmt));
    k += n;
  }
}

/**
 * Applies `ops` to `doc` as one transaction, or throws `EditError` having written nothing. The caller owns the sandbox
 * rule: on the host it runs inside the agent's replica's `edit(fn)`, which sends the update only when this returns.
 */
export function applyEdit(doc: Doc, ops: readonly Op[], options: ApplyOptions = {}): Applied {
  const plan = planEdit(doc, ops, options);
  let carries: Carry[] = [];
  if (plan.tops.size > 0 || plan.actions.length > 0) {
    const writer = new YWriter(doc, plan);
    writer.startClock = doc.store.getClock(doc.clientID);
    transact(doc, () => (carries = writer.write()), options.origin);
  }
  return { results: plan.results, carries, orphaned: plan.orphaned, answer: plan.answer };
}
