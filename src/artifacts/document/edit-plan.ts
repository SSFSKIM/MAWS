// The patch writer's first half (D6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; parent Decision Log 20d, 34
// and 35): the batch planned and validated in ProseMirror space before anything is written to Yjs. A Yjs transaction
// cannot roll back and the provider ships every local update, so all-or-none is settled here: each op is applied, in
// order, to an overlay of the top-level blocks it touches (read from the block index, never by walking the document),
// every touched parent is rebuilt with `createChecked` (and only those: Decision Log 35's touched-parent validation),
// quotes are matched for exactness and uniqueness, a table's shape and a block's staleness are checked against the
// agent's read, and the move rule is decided against the humans' carets. The result is the plan the Yjs half
// (patch-writer.ts) executes in one transaction: each touched block's final node and the top-level inserts, deletions
// and re-inserts in order.
//
// Marks follow S4's writer with S5's rule folded in (parent Decision Log 33): on unchanged words the marks the agent's
// markdown expresses follow its markdown and every other mark (a comment) is kept; deleted words lose theirs; inserted
// words carry a comment when it covers both neighbours or covered every word the hunk replaces; a type change re-maps
// the kept marks onto the new text through the same diff. Orphaned threads are derived and reported, never written.
import { Mark, type ContentMatch, type MarkType, type Node as PMNode, type NodeType } from '@tiptap/pm/model';
import type { Doc } from '../yjs';
import { YNode } from '../yjs/document';
import { DocIndex, type TopBlock } from './block-index';
import { EditError, type ApplyOptions, type EditRefusal, type Op, type OpResult } from './edit-ops';
import { diffCells, EMBED, equalMap, type DiffCell, type Hunk } from './inline-diff';
import { docMarkdown, stripMilestones } from './markdown';
import { nanoid8, schemaFor } from './schema';
import { getThread } from './threads';

// ── cells of ProseMirror textblocks ──
export interface PMCell extends DiffCell {
  marks: readonly Mark[];
  node?: PMNode; // an inline node (a chip, a formula, an image)
}

const embedKey = (node: PMNode): string => JSON.stringify([node.type.name, node.attrs]);

/** A textblock's cells: one per UTF-16 unit of text, one per inline node. */
export function pmCells(textblock: PMNode): PMCell[] {
  const out: PMCell[] = [];
  textblock.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      for (let i = 0; i < text.length; i++) out.push({ ch: text[i], marks: child.marks });
    } else out.push({ ch: EMBED, key: embedKey(child), marks: child.marks, node: child });
  });
  return out;
}

const SEPARATOR: PMCell = { ch: '\n', marks: Mark.none };

/** The textblocks under a node in document order (the node itself if it is one). */
export function textblocksOf(node: PMNode): PMNode[] {
  if (node.isTextblock) return [node];
  const out: PMNode[] = [];
  node.descendants((child) => {
    if (!child.isTextblock) return true;
    out.push(child);
    return false;
  });
  return out;
}

/** The cells of several textblocks joined by a newline cell (a type change diffs them as one text). */
export const joinedCells = (textblocks: readonly PMNode[]): PMCell[] => textblocks.flatMap((tb, k) => (k < textblocks.length - 1 ? [...pmCells(tb), SEPARATOR] : pmCells(tb)));

const childrenOf = (node: PMNode): PMNode[] => {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
};

const idsIn = (node: PMNode): Set<string> => {
  const out = new Set<string>();
  if (typeof node.attrs.id === 'string') out.add(node.attrs.id);
  node.descendants((child) => void (typeof child.attrs.id === 'string' && out.add(child.attrs.id)));
  return out;
};

const threadsIn = (node: PMNode, into: Set<string>): void => {
  node.descendants((child) => {
    for (const mark of child.marks) if (mark.type.name === 'comment') into.add(String(mark.attrs.threadId));
  });
};

// ── the agent's marks ──
let agentMarkNames: ReadonlySet<string> | null = null;
/**
 * The marks the agent's markdown expresses (S4's probe: a mark is the agent's if serialize → parse keeps it). With the
 * lossless dialect that is every mark but `comment`, which the writer carries rather than reads from the agent.
 */
export function agentMarks(): ReadonlySet<string> {
  if (agentMarkNames) return agentMarkNames;
  const schema = schemaFor();
  const md = docMarkdown();
  const out = new Set<string>();
  for (const [name, type] of Object.entries(schema.marks)) {
    if (name.startsWith('y-attributed-')) continue;
    try {
      const attrs = name === 'link' ? { href: 'https://example.com' } : name === 'comment' ? { threadId: 'probe' } : null;
      const probe = schema.nodes.paragraph.create({ id: 'probe0' }, [schema.text('a '), schema.text('w', [type.create(attrs)]), schema.text(' b')]);
      let kept = false;
      md.parse(md.block(probe))[0]?.descendants((node) => void (node.marks.some((mark) => mark.type === type) && (kept = true)));
      if (kept) out.add(name);
    } catch {
      // not expressible
    }
  }
  return (agentMarkNames = out);
}

/**
 * The marks of each new cell: its own agent marks, plus the carried marks of the old text (S5's rule) where the
 * textblock type allows them and no agent mark excludes them (`code` excludes every other mark).
 */
function mergeMarks(old: readonly PMCell[], neu: readonly PMCell[], hunks: readonly Hunk[], allows: (n: number, type: MarkType) => boolean): Array<readonly Mark[]> {
  const agent = agentMarks();
  const carried = (mark: Mark) => !agent.has(mark.type.name);
  const out = new Array<readonly Mark[]>(neu.length);
  const build = (n: number, kept: readonly Mark[]): readonly Mark[] => {
    let set: readonly Mark[] = Mark.none;
    for (const mark of neu[n].marks) if (!carried(mark)) set = mark.addToSet(set);
    // marks of one type may overlap (comments) and a set keeps them in the order added: add them in one order
    for (const mark of [...kept].sort(byJSON)) if (allows(n, mark.type)) set = mark.addToSet(set);
    return set;
  };
  equalMap(old.length, hunks).forEach((n, o) => {
    if (n !== undefined) out[n] = build(n, old[o].marks.filter(carried));
  });
  for (const hunk of hunks) {
    const left = old[hunk.from - 1]?.marks ?? Mark.none;
    const right = old[hunk.to]?.marks ?? Mark.none;
    // inside a comment (it covers both neighbours), or an in-place rewording of every word it covered
    const inherit = left.filter((mark) => carried(mark) && mark.isInSet(right));
    if (hunk.to > hunk.from && hunk.nTo > hunk.nFrom) {
      for (const mark of old[hunk.from].marks) {
        if (!carried(mark) || mark.isInSet(inherit)) continue;
        let all = true;
        for (let o = hunk.from; o < hunk.to && all; o++) all = mark.isInSet(old[o].marks);
        if (all) inherit.push(mark);
      }
    }
    for (let n = hunk.nFrom; n < hunk.nTo; n++) out[n] = build(n, inherit);
  }
  return out;
}

const markKey = (mark: Mark): string => JSON.stringify(mark.toJSON());
const byJSON = (a: Mark, b: Mark): number => (markKey(a) < markKey(b) ? -1 : markKey(a) > markKey(b) ? 1 : 0);

/**
 * A node as JSON with every textblock's text regrouped by its marks in one order: two nodes equal in content compare
 * equal however their overlapping marks were ordered or their text split (the plan against Yjs's read-back).
 */
export function canonicalJSON(node: PMNode): unknown {
  const marks = (list: readonly Mark[]) => (list.length ? [...list].sort((a, b) => a.type.rank - b.type.rank || byJSON(a, b)).map((mark) => mark.toJSON()) : undefined);
  if (node.isTextblock) {
    const runs: Array<{ text?: string; node?: unknown; marks?: unknown }> = [];
    node.forEach((child) => {
      const key = marks(child.marks);
      const last = runs.at(-1);
      if (child.isText && last?.text !== undefined && JSON.stringify(last.marks) === JSON.stringify(key)) last.text += child.text ?? '';
      else runs.push(child.isText ? { text: child.text ?? '', marks: key } : { node: { type: child.type.name, attrs: child.attrs }, marks: key });
    });
    return { type: node.type.name, attrs: node.attrs, content: runs };
  }
  const content: unknown[] = [];
  node.forEach((child) => content.push(canonicalJSON(child)));
  return { type: node.type.name, attrs: node.attrs, marks: marks(node.marks), content };
}

/** Inline content from cells and their marks: text runs of one mark set, inline nodes with theirs. */
function inlineOf(cells: readonly PMCell[], marks: ReadonlyArray<readonly Mark[]>): PMNode[] {
  const schema = schemaFor();
  const out: PMNode[] = [];
  let run = '';
  let runMarks: readonly Mark[] | null = null;
  const flush = () => {
    if (run) out.push(schema.text(run, runMarks));
    run = '';
    runMarks = null;
  };
  cells.forEach((cell, i) => {
    if (cell.node) {
      flush();
      out.push(cell.node.mark(marks[i]));
    } else if (runMarks && Mark.sameSet(runMarks, marks[i])) run += cell.ch;
    else {
      flush();
      run = cell.ch;
      runMarks = marks[i];
    }
  });
  flush();
  return out;
}

// ── the plan ──
interface TopState {
  tabId: string;
  base: TopBlock | null; // null: a block the batch inserts
  pm: PMNode | null; // null: deleted
}

export type RootAction =
  | { kind: 'insert'; tabId: string; after: string | null; keys: string[]; snapshot: PMNode[] }
  | { kind: 'delete'; tabId: string; key: string }
  | { kind: 'move'; tabId: string; key: string; after: string | null };

export interface Plan {
  index: DocIndex;
  /** Every top-level block the batch touches, by key (its id), with its final node. */
  tops: Map<string, TopState>;
  /** The top-level inserts, deletions and re-inserts, in op order. */
  actions: RootAction[];
  /** The tabs whose top-level order the batch changes, with the final order. */
  orders: Map<string, string[]>;
  /** A patched node → the node it patches (so the Yjs half pairs a container's children with what they were). */
  origins: WeakMap<PMNode, PMNode>;
  /** The key of an existing top-level block. */
  keyOf(top: TopBlock): string;
  results: OpResult[];
  orphaned: string[];
  answer: { threadId: string; body: string } | null;
  mergeWhitespace: boolean;
}

interface Located {
  key: string;
  tabId: string;
  path: number[]; // child indices from the top-level block down to the node; empty for the block itself
}

const refuse = (refusal: EditRefusal, message: string): never => {
  throw new EditError(refusal, message);
};

// A quote's plain-text needle: the longest run of letters or digits once the dialect's own syntax is removed, which
// the block's text holds wherever its markdown holds the quote (block-index.ts's `text`). A filter only: a quote with
// no needle, or a refusal for not finding one, falls back to reading every block's markdown.
function needleOf(quote: string): string | null {
  const plain = quote
    .replace(/\^[0-9a-z]{2,32}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#?\w+;/g, ' ')
    .replace(/:{3,}\w*/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\]\([^)]*\)/g, ' ');
  let best: string | null = null;
  for (const run of plain.match(/[\p{L}\p{N}]+/gu) ?? []) if (!best || run.length > best.length) best = run;
  return best;
}

const occurrences = (text: string, quote: string): number => {
  let n = 0;
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + quote.length)) n++;
  return n;
};

const LIST_ITEMS = new Set(['listItem', 'taskItem']);

class Planner {
  readonly index: DocIndex;
  readonly tops = new Map<string, TopState>();
  readonly orders = new Map<string, string[]>();
  readonly actions: RootAction[] = [];
  readonly origins = new WeakMap<PMNode, PMNode>();
  readonly results: OpResult[] = [];
  private readonly used = new Set<string>();
  private readonly keys = new WeakMap<TopBlock, string>();
  private readonly byKey = new Map<string, TopBlock>();
  private readonly orderOp = new Map<string, number>(); // tab → the last op that changed its order
  private readonly md = docMarkdown();
  private readonly schema = schemaFor();
  private readonly generateID: () => string;
  private readonly mergeWhitespace: boolean;
  private opIndex = -1;

  constructor(
    readonly doc: Doc,
    private readonly options: ApplyOptions,
  ) {
    this.index = DocIndex.of(doc);
    this.generateID = options.generateID ?? nanoid8;
    this.mergeWhitespace = options.mergeWhitespace ?? true;
  }

  // ── keys and the overlay ──
  keyOf(top: TopBlock): string {
    let key = this.keys.get(top);
    if (key === undefined) {
      key = top.id ?? `\u0000${top.tabId}:${this.index.position(top)}`;
      this.keys.set(top, key);
      this.byKey.set(key, top);
    }
    return key;
  }

  private order(tabId: string): string[] {
    return this.orders.get(tabId) ?? this.index.tops(tabId).map((top) => this.keyOf(top));
  }

  private mutableOrder(tabId: string): string[] {
    let order = this.orders.get(tabId);
    if (!order) this.orders.set(tabId, (order = this.order(tabId)));
    this.orderOp.set(tabId, this.opIndex);
    return order;
  }

  private current(key: string): PMNode | null {
    const state = this.tops.get(key);
    if (state) return state.pm;
    const top = this.byKey.get(key);
    return top ? this.index.pm(top) : null;
  }

  private setTop(key: string, tabId: string, pm: PMNode | null): void {
    const state = this.tops.get(key);
    if (state) state.pm = pm;
    else this.tops.set(key, { tabId, base: this.byKey.get(key) ?? null, pm });
  }

  private pathTo(node: PMNode, id: string): number[] | null {
    let i = 0;
    for (const child of childrenOf(node)) {
      if (child.attrs.id === id) return [i];
      const below = child.isTextblock || child.isLeaf ? null : this.pathTo(child, id);
      if (below) return [i, ...below];
      i++;
    }
    return null;
  }

  private nodeAt(located: Located): PMNode {
    let node = this.current(located.key)!;
    for (const i of located.path) node = node.child(i);
    return node;
  }

  /** Where `id` is in the overlay: its top-level block and the path to it; null when the batch removed it or it never was. */
  locate(id: string): Located | null {
    const state = this.tops.get(id);
    if (state?.pm) return { key: id, tabId: state.tabId, path: [] };
    const found = this.index.find(id);
    if (found && !state) {
      const key = this.keyOf(found.top);
      const top = this.tops.get(key);
      if (top && !top.pm) return null;
      if (found.node === found.top.node && key === id) return { key, tabId: found.top.tabId, path: [] };
      const path = this.pathTo(top?.pm ?? this.index.pm(found.top), id);
      if (path) return { key, tabId: found.top.tabId, path };
    }
    for (const [key, top] of this.tops) {
      if (!top.pm) continue;
      const path = this.pathTo(top.pm, id);
      if (path) return { key, tabId: top.tabId, path };
    }
    return null;
  }

  private located(id: string): Located {
    return this.locate(id) ?? refuse({ reason: 'notFound', opIndex: this.opIndex, target: id, candidates: [] }, `op ${this.opIndex}: no block ^${id}`);
  }

  private invalid(message: string): never {
    return refuse({ reason: 'invalid', opIndex: this.opIndex, message }, `op ${this.opIndex}: ${message}`);
  }

  // ── ids ──
  private taken(id: string): boolean {
    return this.used.has(id) || this.index.find(id) !== null;
  }

  /** `node` with every id that is already in the document (or the batch) replaced by a fresh one, unless `own`. */
  private withFreshIds(node: PMNode, own: ReadonlySet<string> = new Set()): PMNode {
    const id = node.attrs.id as unknown;
    let attrs = node.attrs;
    if ('id' in node.attrs && (typeof id !== 'string' || (!own.has(id) && this.taken(id)))) attrs = { ...node.attrs, id: this.mint() };
    if (typeof attrs.id === 'string') this.used.add(attrs.id);
    if (node.isTextblock || node.isLeaf) return attrs === node.attrs ? node : node.type.create(attrs, node.content, node.marks);
    const kids = childrenOf(node).map((child) => this.withFreshIds(child, own));
    const same = attrs === node.attrs && kids.every((child, i) => child === node.child(i));
    return same ? node : node.type.create(attrs, kids, node.marks);
  }

  private mint(): string {
    let id = this.generateID();
    while (this.taken(id)) id = this.generateID();
    this.used.add(id);
    return id;
  }

  private parse(markdown: string): PMNode[] {
    try {
      return this.md.parse(stripMilestones(markdown), { generateID: this.generateID });
    } catch (error) {
      return this.invalid(`the markdown does not parse: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── patches in ProseMirror space ──
  /** `old` as `neu` says, keeping `old`'s id and the marks the agent cannot express (S4's `patchNode`). */
  patch(old: PMNode, neu: PMNode): PMNode {
    if (old.type !== neu.type) return this.retype(old, neu);
    const attrs = 'id' in neu.attrs ? { ...neu.attrs, id: old.attrs.id ?? neu.attrs.id } : neu.attrs;
    let node: PMNode;
    if (neu.isTextblock) {
      const oldCells = pmCells(old);
      const newCells = pmCells(neu);
      const hunks = diffCells(oldCells, newCells, { mergeWhitespace: this.mergeWhitespace });
      const marks = mergeMarks(oldCells, newCells, hunks, (_n, type) => neu.type.allowsMarkType(type));
      node = neu.type.createChecked(attrs, inlineOf(newCells, marks), neu.marks);
      node.check();
    } else if (neu.isLeaf) node = neu.type.createChecked(attrs, null, neu.marks);
    else node = neu.type.createChecked(attrs, this.alignChildren(childrenOf(old), childrenOf(neu), idsIn(old)), neu.marks);
    if (node.eq(old)) return old;
    this.origins.set(node, old);
    return node;
  }

  /**
   * A container's new children paired with its old ones (S4's `patchChildren`): equal runs by type and text, then in
   * order by type inside a changed run; paired children are patched, the rest are new (ids fresh unless their own).
   */
  private alignChildren(old: PMNode[], neu: PMNode[], own: ReadonlySet<string>): PMNode[] {
    const sig = (node: PMNode): DiffCell => ({ ch: EMBED, key: `${node.type.name}\u0000${node.textContent}` });
    const hunks = diffCells(old.map(sig), neu.map(sig), { mergeWhitespace: false });
    const pairs = new Map<number, number>();
    equalMap(old.length, hunks).forEach((n, o) => n !== undefined && pairs.set(n, o));
    for (const hunk of hunks) {
      for (let o = hunk.from, n = hunk.nFrom; o < hunk.to && n < hunk.nTo && old[o].type === neu[n].type; o++, n++) pairs.set(n, o);
    }
    return neu.map((child, n) => (pairs.has(n) ? this.patch(old[pairs.get(n)!], child) : this.withFreshIds(child, own)));
  }

  /** A type change: `neu` under `old`'s id, the kept marks re-mapped through the diff of their texts (S4's `retype`). */
  private retype(old: PMNode, neu: PMNode): PMNode {
    const own = idsIn(old);
    const newBlocks = textblocksOf(neu);
    const oldCells = joinedCells(textblocksOf(old));
    const newCells = joinedCells(newBlocks);
    const hunks = diffCells(oldCells, newCells, { mergeWhitespace: this.mergeWhitespace });
    const typeAt: NodeType[] = [];
    newBlocks.forEach((tb, k) => {
      for (let i = 0; i < tb.content.size; i++) typeAt.push(tb.type);
      if (k < newBlocks.length - 1) typeAt.push(tb.type);
    });
    const marks = mergeMarks(oldCells, newCells, hunks, (n, type) => typeAt[n]?.allowsMarkType(type) ?? false);
    let at = 0;
    const rebuild = (node: PMNode, top: boolean): PMNode => {
      const id = node.attrs.id as unknown;
      const attrs = !('id' in node.attrs) ? node.attrs : top ? { ...node.attrs, id: old.attrs.id } : typeof id === 'string' && (own.has(id) || !this.taken(id)) ? node.attrs : { ...node.attrs, id: this.mint() };
      if (!top && typeof attrs.id === 'string') this.used.add(attrs.id);
      if (node.isTextblock) {
        const cells = pmCells(node);
        const built = node.type.createChecked(attrs, inlineOf(cells, marks.slice(at, at + cells.length)), node.marks);
        built.check();
        at += cells.length + 1;
        return built;
      }
      if (node.isLeaf) return node.type.createChecked(attrs, null, node.marks);
      return node.type.createChecked(
        attrs,
        childrenOf(node).map((child) => rebuild(child, false)),
        node.marks,
      );
    };
    return rebuild(neu, true);
  }

  /** The top-level block at `located.key` with the node at `located.path` replaced by `replace(node)`'s nodes. */
  private rebuild(located: Located, replace: (node: PMNode, parent: PMNode) => PMNode[]): void {
    const go = (node: PMNode, depth: number): PMNode => {
      const i = located.path[depth];
      const kids = childrenOf(node);
      const replaced = depth === located.path.length - 1 ? replace(kids[i], node) : [go(kids[i], depth + 1)];
      const built = node.type.createChecked(node.attrs, [...kids.slice(0, i), ...replaced, ...kids.slice(i + 1)], node.marks);
      this.origins.set(built, node);
      return built;
    };
    this.setTop(located.key, located.tabId, go(this.current(located.key)!, 0));
  }

  private insertTops(tabId: string, at: number, nodes: PMNode[]): string[] {
    const order = this.mutableOrder(tabId);
    const keys = nodes.map((node) => String(node.attrs.id));
    order.splice(at, 0, ...keys);
    nodes.forEach((node, n) => this.tops.set(keys[n], { tabId, base: null, pm: node }));
    this.actions.push({ kind: 'insert', tabId, after: at === 0 ? null : order[at - 1], keys, snapshot: nodes });
    return keys;
  }

  // ── the ops ──
  run(ops: readonly Op[]): void {
    ops.forEach((op, i) => {
      this.opIndex = i;
      try {
        this.results.push(this.apply(op));
      } catch (error) {
        if (error instanceof EditError) throw error;
        this.invalid(error instanceof Error ? error.message : String(error));
      }
    });
    this.opIndex = -1;
    for (const [tabId, order] of this.orders) {
      let match: ContentMatch | null = this.schema.topNodeType.contentMatch;
      for (const key of order) match = match?.matchType(this.current(key)!.type) ?? null;
      if (!match?.validEnd) {
        this.opIndex = this.orderOp.get(tabId) ?? -1;
        this.invalid(`tab ${tabId} would be invalid: ${order.length === 0 ? 'a tab holds at least one block' : 'its blocks do not fit the document'}`);
      }
    }
  }

  private apply(op: Op): OpResult {
    switch (op.op) {
      case 'replace_text':
        return this.replaceText(op);
      case 'replace_block': {
        const located = this.located(op.id);
        const blocks = this.parse(op.markdown);
        if (blocks.length === 0) this.invalid('empty markdown (use delete)');
        const extras = blocks.slice(1).map((block) => this.withFreshIds(block));
        let newIds: string[];
        if (located.path.length === 0) {
          this.setTop(located.key, located.tabId, this.patch(this.current(located.key)!, blocks[0]));
          const at = this.order(located.tabId).indexOf(located.key) + 1;
          newIds = extras.length > 0 ? this.insertTops(located.tabId, at, extras).flatMap((key) => [...idsIn(this.current(key)!)]) : [];
        } else {
          this.rebuild(located, (node) => [this.patch(node, blocks[0]), ...extras]);
          newIds = extras.flatMap((node) => [...idsIn(node)]);
        }
        return { line: `replaced ^${op.id}${extras.length ? ` (+${extras.length} blocks)` : ''}`, target: op.id, newIds };
      }
      case 'insert': {
        const anchor = op.after ?? op.before;
        if (anchor == null) return this.invalid('insert needs after or before');
        const located = this.located(anchor);
        let blocks = this.parse(op.markdown).map((block) => this.withFreshIds(block));
        if (blocks.length === 0) this.invalid('empty markdown');
        const after = op.after != null;
        if (located.path.length === 0) {
          const at = this.order(located.tabId).indexOf(located.key) + (after ? 1 : 0);
          this.insertTops(located.tabId, at, blocks);
        } else {
          this.rebuild(located, (node, parent) => {
            // a list written next to a list item adds its items to the item's list
            if (LIST_ITEMS.has(node.type.name) && blocks.length === 1 && blocks[0].type === parent.type) blocks = childrenOf(blocks[0]);
            return after ? [node, ...blocks] : [...blocks, node];
          });
        }
        const newIds = blocks.flatMap((node) => [...idsIn(node)]);
        return { line: `inserted ${blocks.length} block(s) ${after ? 'after' : 'before'} ^${anchor}: ${blocks.map((node) => `^${String(node.attrs.id)}`).join(' ')}`, target: anchor, newIds };
      }
      case 'delete': {
        const located = this.located(op.id);
        if (located.path.length === 0) {
          const order = this.mutableOrder(located.tabId);
          order.splice(order.indexOf(located.key), 1);
          this.setTop(located.key, located.tabId, null);
          this.actions.push({ kind: 'delete', tabId: located.tabId, key: located.key });
        } else this.rebuild(located, () => []);
        return { line: `deleted ^${op.id}`, target: op.id, newIds: [] };
      }
      case 'move':
        return this.move(op);
      case 'set_cell':
        return this.setCell(op);
    }
  }

  private replaceText(op: Extract<Op, { op: 'replace_text' }>): OpResult {
    const quote = stripMilestones(op.old);
    const replacement = stripMilestones(op.new);
    if (!quote) this.invalid('old is empty');
    const pool: Array<{ key: string; tabId: string }> = op.block != null ? [this.located(op.block)] : this.index.tabIds().flatMap((tabId) => this.order(tabId).map((key) => ({ key, tabId })));
    const live = pool.filter(({ key }) => this.current(key) !== null);
    const markdownOf = (key: string): string => {
      const top = !this.tops.has(key) ? this.byKey.get(key) : undefined;
      return top ? this.index.md(top) : this.md.block(this.current(key)!);
    };
    const textOf = (key: string): string => {
      const top = !this.tops.has(key) ? this.byKey.get(key) : undefined;
      return top ? this.index.text(top) : this.current(key)!.textBetween(0, this.current(key)!.content.size, '\n');
    };
    const search = (needle: string | null) =>
      live
        .filter(({ key }) => !needle || textOf(key).includes(needle))
        .map(({ key, tabId }) => {
          const markdown = markdownOf(key);
          return { key, tabId, markdown, n: occurrences(markdown, quote) };
        })
        .filter((hit) => hit.n > 0);
    const needle = needleOf(quote);
    let hits = search(needle);
    if (hits.length === 0 && needle) hits = search(null);
    const total = hits.reduce((sum, hit) => sum + hit.n, 0);
    const idOf = (key: string) => (key.startsWith('\u0000') ? '?' : key);
    if (total === 0) {
      const words = quote
        .replace(/[*_`~[\]()#>+-]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 3);
      const near = live
        .filter(({ key }) => words.some((word) => textOf(key).includes(word)))
        .slice(0, 10)
        .map(({ key }) => ({ id: idOf(key), text: textOf(key) }));
      refuse({ reason: 'notFound', opIndex: this.opIndex, target: op.old, candidates: near }, `op ${this.opIndex}: "${op.old}" not found${op.block ? ` in ^${op.block}` : ''}`);
    }
    if (total > 1 && !op.all) {
      refuse(
        { reason: 'notUnique', opIndex: this.opIndex, candidates: hits.map((hit) => ({ id: idOf(hit.key), text: textOf(hit.key), matches: hit.n })) },
        `op ${this.opIndex}: "${op.old}" matches ${total} times; quote more context or pass all`,
      );
    }
    for (const hit of hits) {
      const next = op.all ? hit.markdown.split(quote).join(replacement) : hit.markdown.replace(quote, () => replacement);
      const blocks = this.parse(next);
      if (blocks.length !== 1) this.invalid(`the replacement turns ^${idOf(hit.key)} into ${blocks.length} blocks (use replace_block)`);
      this.setTop(hit.key, hit.tabId, this.patch(this.current(hit.key)!, blocks[0]));
    }
    const targets = hits.map((hit) => idOf(hit.key));
    return { line: `replaced ${total} occurrence(s) in ${targets.map((id) => `^${id}`).join(', ')}`, target: targets.join(','), newIds: [] };
  }

  /** S4's move rule: never re-insert a block holding a human caret; re-insert what it jumps over, or refuse to retry. */
  private move(op: Extract<Op, { op: 'move' }>): OpResult {
    const located = this.located(op.id);
    if (located.path.length > 0) this.invalid(`^${op.id} is not a top-level block`);
    let afterKey: string | null = null;
    if (op.after != null) {
      const anchor = this.located(op.after);
      if (anchor.path.length > 0) this.invalid(`^${op.after} is not a top-level block`);
      if (anchor.tabId !== located.tabId) this.invalid(`^${op.after} is in another tab`);
      afterKey = anchor.key;
    }
    const order = this.order(located.tabId);
    const x = order.indexOf(located.key);
    const a = afterKey === null ? -1 : order.indexOf(afterKey);
    const where = op.after == null ? 'the start' : `^${op.after}`;
    if (a === x || a === x - 1) return { line: `^${op.id} already after ${where}`, target: op.id, newIds: [] };
    const down = a > x;
    const span = down ? order.slice(x + 1, a + 1) : order.slice(a + 1, x);
    const live = new Set<string>();
    for (const caret of this.options.carets ?? []) {
      const found = this.index.find(caret.blockId);
      if (found) live.add(this.keyOf(found.top));
    }
    const spanLive = span.filter((key) => live.has(key));
    if (live.has(located.key) && spanLive.length > 0) {
      refuse(
        { reason: 'retry', opIndex: this.opIndex, blocks: [op.id, ...spanLive] },
        `op ${this.opIndex}: a human is typing in ^${op.id} and in a block it would pass (${spanLive.map((key) => `^${key}`).join(' ')}); retry shortly`,
      );
    }
    const reinsert = (key: string, after: string | null) => {
      const list = this.mutableOrder(located.tabId);
      list.splice(list.indexOf(key), 1);
      list.splice(after === null ? 0 : list.indexOf(after) + 1, 0, key);
      this.actions.push({ kind: 'move', tabId: located.tabId, key, after });
    };
    if (!live.has(located.key)) {
      reinsert(located.key, afterKey);
      return { line: `moved ^${op.id} after ${where}`, target: op.id, newIds: [] };
    }
    // the block holds a caret: the span moves to its other side instead (the same resulting order)
    let previous = down ? (x === 0 ? null : order[x - 1]) : located.key;
    for (const key of span) {
      reinsert(key, previous);
      previous = key;
    }
    return { line: `moved ^${op.id} after ${where} (by moving ${span.map((key) => `^${key}`).join(' ')}; a human is typing in ^${op.id})`, target: op.id, newIds: [] };
  }

  private setCell(op: Extract<Op, { op: 'set_cell' }>): OpResult {
    const located = this.located(op.table);
    const table = this.nodeAt(located);
    if (table.type.name !== 'table') this.invalid(`^${op.table} is a ${table.type.name}, not a table`);
    const row = op.row >= 0 && op.row < table.childCount ? table.child(op.row) : null;
    const cell = row && op.col >= 0 && op.col < row.childCount ? row.child(op.col) : null;
    if (!row || !cell) return this.invalid(`table ^${op.table} has no cell (${op.row}, ${op.col})`);
    let blocks = this.parse(op.markdown);
    if (blocks.length === 0) blocks = [this.schema.nodes.paragraph.create({ id: this.mint() })];
    const next = cell.type.createChecked(cell.attrs, this.alignChildren(childrenOf(cell), blocks, idsIn(cell)), cell.marks);
    const patched = next.eq(cell) ? cell : next;
    if (patched !== cell) this.origins.set(patched, cell);
    this.rebuild({ ...located, path: [...located.path, op.row, op.col] }, () => [patched]);
    return { line: `set cell (${op.row}, ${op.col}) of ^${op.table}`, target: String(cell.attrs.id ?? op.table), newIds: [] };
  }

  // ── checks before any op ──
  /** Targets a restore removed, and targets changed since the agent's read (target-only validation). */
  precheck(ops: readonly Op[]): void {
    const away = this.options.restoredAway;
    if (away && away.size > 0) {
      const removed = new Set<string>();
      for (const op of ops) for (const id of targetsOf(op)) if (away.has(id) && !this.index.find(id)) removed.add(id);
      if (removed.size > 0) refuse({ reason: 'removedByRestore', blocks: [...removed] }, `removed by restore: ${[...removed].map((id) => `^${id}`).join(' ')}`);
    }
    const since = this.options.since;
    if (since === undefined) return;
    const stale = new Map<string, string>();
    const note = (id: string, top: TopBlock) => stale.has(id) || stale.set(id, this.index.md(top));
    for (const op of ops) {
      if (op.op === 'replace_block' || op.op === 'delete') {
        const found = this.index.find(op.id);
        if (found && this.index.changedSince(op.id, since)) note(op.id, found.top);
      } else if (op.op === 'set_cell') {
        const found = this.index.find(op.table);
        if (!found) continue;
        if (this.index.structureChangedSince(op.table, since)) note(op.table, found.top);
        const row = found.node.toArray()[op.row];
        if (!(row instanceof YNode)) continue;
        const rowId = row.getAttr('id');
        if (typeof rowId !== 'string') continue;
        if (this.index.structureChangedSince(rowId, since)) note(rowId, found.top);
        const cell = row.toArray()[op.col];
        const cellId = cell instanceof YNode ? cell.getAttr('id') : null;
        if (typeof cellId === 'string' && this.index.changedSince(cellId, since)) note(cellId, found.top);
      }
    }
    if (stale.size > 0) {
      refuse(
        { reason: 'staleTargets', blocks: [...stale].map(([id, text]) => ({ id, text })) },
        `changed since the read: ${[...stale.keys()].map((id) => `^${id}`).join(' ')} (read again, or quote with replace_text)`,
      );
    }
  }

  /** Open threads whose last text the batch removed (derived; checked against the blocks the batch did not touch). */
  orphans(): string[] {
    const before = new Set<string>();
    const after = new Set<string>();
    for (const state of this.tops.values()) {
      if (state.base) for (const id of this.index.threads(state.base)) before.add(id);
      if (state.pm) threadsIn(state.pm, after);
    }
    const vanished = new Set([...before].filter((id) => !after.has(id)));
    if (vanished.size === 0) return [];
    for (const tabId of this.index.tabIds()) {
      for (const top of this.index.tops(tabId)) {
        if (this.tops.has(this.keyOf(top))) continue;
        for (const id of this.index.threads(top)) vanished.delete(id);
        if (vanished.size === 0) return [];
      }
    }
    return [...vanished].filter((id) => getThread(this.doc, id)?.status === 'open');
  }

  plan(ops: readonly Op[]): Plan {
    if (this.options.answering !== undefined && !getThread(this.doc, this.options.answering)) {
      refuse({ reason: 'notFound', opIndex: -1, target: this.options.answering, candidates: [] }, `no thread ${this.options.answering} to answer`);
    }
    this.precheck(ops);
    this.run(ops);
    const orphaned = this.orphans();
    const answering = this.options.answering;
    return {
      index: this.index,
      tops: this.tops,
      actions: this.actions,
      orders: this.orders,
      origins: this.origins,
      keyOf: (top) => this.keyOf(top),
      results: this.results,
      orphaned,
      answer: answering === undefined ? null : { threadId: answering, body: this.results.map((result) => result.line).join('\n') },
      mergeWhitespace: this.mergeWhitespace,
    };
  }
}

/** The ids an op names (its targets and anchors). */
function targetsOf(op: Op): string[] {
  switch (op.op) {
    case 'replace_text':
      return op.block != null ? [op.block] : [];
    case 'replace_block':
    case 'delete':
      return [op.id];
    case 'insert':
      return [op.after ?? op.before].filter((id): id is string => id != null);
    case 'move':
      return [op.id, op.after].filter((id): id is string => id != null);
    case 'set_cell':
      return [op.table];
  }
}

/** Plans and validates a batch against `doc` (nothing is written); throws `EditError` when any op fails. */
export const planEdit = (doc: Doc, ops: readonly Op[], options: ApplyOptions = {}): Plan => new Planner(doc, options).plan(ops);
