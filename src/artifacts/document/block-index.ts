// The block index (D6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; parent Decision Log 35 and 37's route to a
// 50 ms batch): one per Y.Doc, shared by the patch writer on an agent's replica and the document adapter on the host's
// replicas. It maps block ids to their nodes at any depth across every tab, keeps each top-level block's ProseMirror
// node, markdown, plain text and comment threads until a transaction changes that block, and counts change epochs: a
// block's last change, and a container's last change to its own list of children, so the writer can tell what changed
// since the agent's read without the host's log (S4's `changedAt`/`structAt`, kept here per replica). It follows the
// doc's transactions (what `tr.changed` names), so a lookup never walks the document and a keystroke costs a parent
// walk; what changed is re-read lazily, on the next lookup.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Doc, Node } from '../yjs';
import { YNode } from '../yjs/document';
import { ynodeToPmnode } from '../yjs/prosemirror';
import { docMarkdown } from './markdown';
import { schemaFor } from './schema';
import { TABS } from './tabs';
import { isCommentKey } from './threads';

/** A top-level block of a tab body, with what the index caches about it. */
export class TopBlock {
  /** Ids in the block's subtree (the block's own first), with the node that carries each. */
  pairs: Array<[string, Node]> = [];
  pmCache: PMNode | null = null;
  mdCache: string | null = null;
  textCache: string | null = null;
  rawTextCache: string | null = null;
  threadsCache: ReadonlySet<string> | null = null;

  constructor(
    readonly node: Node,
    readonly tabId: string,
    public id: string | null,
  ) {}
}

interface TabState {
  id: string;
  order: string;
  body: Node;
  tops: TopBlock[] | null; // null: rescan the body's children
  position: Map<TopBlock, number> | null;
}

interface Transaction {
  changed: Map<unknown, Set<string | null>>;
  insertSet: { has(client: number, clock: number): boolean };
}

const indexes = new WeakMap<Doc, DocIndex>();

const idOf = (node: Node): string | null => {
  const id: unknown = node.getAttr('id');
  return typeof id === 'string' ? id : null;
};
const childNodes = (node: Node): Node[] => node.toArray().filter((child): child is Node => child instanceof YNode);

// What a block's search text holds besides its text: the string attributes of its nodes (a chip's label, a formula's
// LaTeX, an image's alt), so a quote naming them is found (the writer then matches the quote against the markdown).
const attributeText = (node: PMNode): string =>
  Object.entries(node.attrs)
    .filter(([key, value]) => key !== 'id' && typeof value === 'string' && value !== '')
    .map(([, value]) => value as string)
    .join(' ');

export class DocIndex {
  /** The doc's index, created on first use. */
  static of(doc: Doc): DocIndex {
    let index = indexes.get(doc);
    if (!index) {
      index = new DocIndex(doc);
      indexes.set(doc, index);
    }
    return index;
  }

  /** Advances once per transaction that changed the doc; a writer's read records it (`ApplyOptions.since`). */
  epoch = 0;
  private readonly tabsRoot: Node;
  private tabsDirty = true;
  private tabs: TabState[] = [];
  private readonly bodies = new Map<Node, TabState>();
  private readonly topByNode = new Map<Node, TopBlock>();
  private readonly byId = new Map<string, Set<Node>>();
  private readonly dirty = new Set<TopBlock>();
  private readonly changedAt = new Map<string, number>();
  private readonly structAt = new Map<string, number>();

  private constructor(readonly doc: Doc) {
    this.tabsRoot = doc.get(TABS);
    doc.on('afterTransaction', (tr: unknown) => this.onTransaction(tr as Transaction));
  }

  /** The tab ids in display order. */
  tabIds(): string[] {
    this.refresh();
    return this.tabs.map((tab) => tab.id);
  }

  /** A tab's top-level blocks in order (an unknown tab has none). */
  tops(tabId: string): readonly TopBlock[] {
    this.refresh();
    return this.tabs.find((tab) => tab.id === tabId)?.tops ?? [];
  }

  /** The node carrying `id` (the first one, if a concurrent write duplicated it) and its top-level block. */
  find(id: string): { node: Node; top: TopBlock } | null {
    this.refresh();
    for (const node of this.byId.get(id) ?? []) {
      const top = this.topOf(node);
      if (top) return { node, top };
    }
    return null;
  }

  /** Every node carrying `id` (more than one only between a concurrent write and the host's repair). */
  nodesWithId(id: string): Node[] {
    this.refresh();
    return [...(this.byId.get(id) ?? [])];
  }

  /** The top-level block holding `node` (itself, if it is one); null for a body or a node outside the tabs. */
  topOf(node: Node): TopBlock | null {
    this.refresh();
    for (let at: Node | null = node; at; at = at.parent as Node | null) {
      const top = this.topByNode.get(at);
      if (top) return top;
    }
    return null;
  }

  /** The block's index among its tab's top-level blocks. */
  position(top: TopBlock): number {
    this.refresh();
    const tab = this.tabs.find((state) => state.id === top.tabId);
    if (!tab?.tops) return -1;
    tab.position ??= new Map(tab.tops.map((entry, i) => [entry, i]));
    return tab.position.get(top) ?? -1;
  }

  pm(top: TopBlock): PMNode {
    this.refresh();
    return (top.pmCache ??= ynodeToPmnode(top.node, schemaFor()));
  }

  /** The block as the agent's markdown (ids on, comments off): what `replace_text` matches its quote against. */
  md(top: TopBlock): string {
    return (top.mdCache ??= docMarkdown().block(this.pm(top)));
  }

  /** The block's text and its nodes' string attributes, for finding the blocks a quote may be in. */
  text(top: TopBlock): string {
    if (top.textCache === null) {
      const pm = this.pm(top);
      const parts = [pm.isLeaf ? '' : pm.textBetween(0, pm.content.size, '\n', attributeText)];
      pm.descendants((node) => {
        if (!node.isText && !node.isInline) parts.push(attributeText(node));
      });
      parts.push(attributeText(pm));
      top.textCache = parts.filter(Boolean).join('\n');
    }
    return top.textCache;
  }

  /**
   * The block's text strings joined as Yjs holds them, read without a ProseMirror conversion (M9: the first unscoped quote
   * after a read, on a replica whose blocks were never converted, otherwise converted every block of the tab), with every
   * node's type name and attribute values (but its id) beside them: whatever of the block the markdown can spell from
   * its nodes (a pending block's intent, a diagram's source and fence, a formula, a chart's spec, an image's alt, a
   * chip's label, a list's start), so a quote's words found in the markdown are found here too (fix wave 2: the
   * prefilter must keep every block whose markdown could hold the quote). A prefilter only: strings run together, so a
   * word found here may not be in the block (`text` is the exact one).
   */
  rawText(top: TopBlock): string {
    this.refresh();
    if (top.rawTextCache === null) {
      const parts: string[] = [];
      const walk = (node: Node): void => {
        parts.push(' ', node.name);
        for (const [key, value] of node.attrEntries()) {
          if (String(key) === 'id' || value === null || value === undefined || value instanceof YNode) continue;
          parts.push(' ', typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value), ' ');
        }
        for (const part of node.toArray()) {
          if (typeof part === 'string') parts.push(part);
          else if (part instanceof YNode) walk(part);
        }
      };
      walk(top.node);
      top.rawTextCache = parts.join('');
    }
    return top.rawTextCache;
  }

  /**
   * Builds what the writer's first batch reads of every top-level block, in every tab (its ProseMirror node and its
   * search text), until `stop()` answers true; true once every block is warm. Called in slices after a read, so the
   * read pays the cold cost once without holding the host's loop (Decision Log 20); a block a later transaction
   * changes is rebuilt lazily as ever.
   */
  warm(stop: () => boolean = () => false): boolean {
    this.refresh();
    // first every block's Yjs text (cheap: what an unscoped quote's prefilter reads), then the converted text
    for (const pass of [(top: TopBlock) => top.rawTextCache === null && this.rawText(top), (top: TopBlock) => top.textCache === null && this.text(top)]) {
      for (const tab of this.tabs) {
        for (const top of tab.tops ?? []) {
          if (stop()) return false;
          pass(top);
        }
      }
    }
    return true;
  }

  /** The comment threads whose mark the block's text carries (read from Yjs, no ProseMirror conversion). */
  threads(top: TopBlock): ReadonlySet<string> {
    this.refresh();
    if (top.threadsCache === null) {
      const out = new Set<string>();
      const walk = (node: Node): void => {
        for (const op of (node.toDelta() as unknown as { children: Iterable<{ insert?: unknown; format?: Record<string, unknown> | null }> }).children) {
          if (typeof op.insert === 'string') {
            for (const [key, value] of Object.entries(op.format ?? {})) {
              const threadId = isCommentKey(key) ? (value as { threadId?: unknown } | null)?.threadId : null;
              if (typeof threadId === 'string') out.add(threadId);
            }
          } else if (Array.isArray(op.insert)) for (const child of op.insert) if (child instanceof YNode) walk(child);
        }
      };
      walk(top.node);
      top.threadsCache = out;
    }
    return top.threadsCache;
  }

  /** The block, or anything inside it, changed after epoch `since`. */
  changedSince(id: string, since: number): boolean {
    return (this.changedAt.get(id) ?? 0) > since;
  }

  /** The container's own list of children (a table's rows, a row's cells) changed after epoch `since`. */
  structureChangedSince(id: string, since: number): boolean {
    return (this.structAt.get(id) ?? 0) > since;
  }

  // ── following the doc ──
  private onTransaction(tr: Transaction): void {
    if (tr.changed.size === 0) return;
    this.epoch++;
    if (this.tabsDirty) this.rebuildTabs(); // the bodies, so a change is placed in its tab from the index's first epoch
    for (const [type, keys] of tr.changed) if (type instanceof YNode) this.note(type, keys, tr);
  }

  private note(type: Node, keys: Set<string | null>, tr: Transaction): void {
    if (type === this.tabsRoot) {
      this.tabsDirty = true;
      return;
    }
    const chain: Node[] = [];
    let tab: TabState | undefined;
    for (let at: Node | null = type; at; at = at.parent as Node | null) {
      tab = this.bodies.get(at);
      if (tab) break;
      chain.push(at);
    }
    if (!tab) {
      // A tab's own attributes (title, order, body), or a tab not indexed yet; anything else (threads, meta) is not ours.
      if (chain.some((node) => node.parent === this.tabsRoot)) this.tabsDirty = true;
      return;
    }
    const children = keys.has(null);
    if (children) {
      const id = idOf(type);
      if (id !== null) this.structAt.set(id, this.epoch);
      for (const child of childNodes(type)) {
        const item = child._item;
        if (item && tr.insertSet.has(item.id.client, item.id.clock)) this.markDeep(child);
      }
    }
    if (chain.length === 0) {
      if (children) tab.tops = null;
      return;
    }
    for (const node of chain) {
      const id = idOf(node);
      if (id !== null) this.changedAt.set(id, this.epoch);
    }
    const top = this.topByNode.get(chain[chain.length - 1]);
    if (top) this.dirty.add(top);
    else tab.tops = null;
  }

  private markDeep(node: Node): void {
    const id = idOf(node);
    if (id !== null) this.changedAt.set(id, this.epoch);
    for (const child of childNodes(node)) this.markDeep(child);
  }

  private refresh(): void {
    if (this.tabsDirty) this.rebuildTabs();
    for (const tab of this.tabs) if (!tab.tops) this.rescan(tab);
    if (this.dirty.size > 0) {
      for (const top of this.dirty) if (this.topByNode.get(top.node) === top) this.reindex(top);
      this.dirty.clear();
    }
  }

  private rebuildTabs(): void {
    this.tabsDirty = false;
    const previous = new Map([...this.bodies].map(([body, tab]) => [body, tab]));
    const next: TabState[] = [];
    for (const [id, tab] of this.tabsRoot.attrEntries()) {
      if (!(tab instanceof YNode)) continue;
      const body: unknown = tab.getAttr('body');
      if (!(body instanceof YNode)) continue;
      const kept = previous.get(body);
      previous.delete(body);
      const order = String(tab.getAttr('order') ?? '');
      next.push(kept && kept.id === String(id) ? Object.assign(kept, { order }) : { id: String(id), order, body, tops: null, position: null });
      if (kept && kept.id !== String(id)) this.dropTops(kept);
    }
    for (const gone of previous.values()) this.dropTops(gone);
    next.sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1));
    this.tabs = next;
    this.bodies.clear();
    for (const tab of next) this.bodies.set(tab.body, tab);
  }

  private dropTops(tab: TabState): void {
    for (const top of tab.tops ?? []) this.forget(top);
    tab.tops = null;
  }

  private rescan(tab: TabState): void {
    const before = new Set(tab.tops ?? this.topsOfTab(tab.id));
    const tops: TopBlock[] = [];
    for (const node of childNodes(tab.body)) {
      let top = this.topByNode.get(node);
      if (!top || top.tabId !== tab.id) {
        top = new TopBlock(node, tab.id, idOf(node));
        this.topByNode.set(node, top);
        this.reindex(top);
      }
      before.delete(top);
      tops.push(top);
    }
    for (const gone of before) this.forget(gone);
    tab.tops = tops;
    tab.position = null;
  }

  // The entries of a tab whose list was dropped for a rescan (they are still in `topByNode`).
  private topsOfTab(tabId: string): TopBlock[] {
    return [...this.topByNode.values()].filter((top) => top.tabId === tabId);
  }

  private reindex(top: TopBlock): void {
    this.unpair(top);
    top.id = idOf(top.node);
    const walk = (node: Node): void => {
      const id = idOf(node);
      if (id !== null) {
        top.pairs.push([id, node]);
        let nodes = this.byId.get(id);
        if (!nodes) this.byId.set(id, (nodes = new Set()));
        nodes.add(node);
      }
      for (const child of childNodes(node)) walk(child);
    };
    walk(top.node);
    top.pmCache = null;
    top.mdCache = null;
    top.textCache = null;
    top.rawTextCache = null;
    top.threadsCache = null;
  }

  private unpair(top: TopBlock): void {
    for (const [id, node] of top.pairs) {
      const nodes = this.byId.get(id);
      nodes?.delete(node);
      if (nodes?.size === 0) this.byId.delete(id);
    }
    top.pairs = [];
  }

  private forget(top: TopBlock): void {
    this.unpair(top);
    if (this.topByNode.get(top.node) === top) this.topByNode.delete(top.node);
    this.dirty.delete(top);
  }
}
