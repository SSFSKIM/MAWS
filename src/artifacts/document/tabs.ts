// The tabs map (D1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4; S3's `s3/lib/artifact.mjs`): a document
// is the root `tabs`, whose attributes are `tabId → Node('tab') {title, order, body}`, `body` the `Node('doc')` an editor
// binds and the writer edits. Tabs sort by a fractional `order` key, so a reorder writes one attribute and two
// replicas reordering concurrently converge without renumbering.
import type { Node as PMNode } from '@tiptap/pm/model';
import { transact, type Doc, type Node } from '../yjs';
import { YNode } from '../yjs/document';
import { pmnodeToDelta } from '../yjs/prosemirror';
import { nanoid8, schemaFor } from './schema';

export const TABS = 'tabs';

export interface TabInfo {
  id: string;
  title: string;
  order: string;
}

const tabsRoot = (doc: Doc): Node => doc.get(TABS);
const tabNode = (doc: Doc, tabId: string): Node | undefined => {
  const tab: unknown = tabsRoot(doc).getAttr(tabId);
  return tab instanceof YNode ? tab : undefined;
};

/** The tabs in display order (by `order`, then id, so equal keys from two replicas still sort the same everywhere). */
export function listTabs(doc: Doc): TabInfo[] {
  const tabs: TabInfo[] = [];
  for (const [id, tab] of tabsRoot(doc).attrEntries()) {
    if (!(tab instanceof YNode)) continue;
    tabs.push({ id: String(id), title: String(tab.getAttr('title') ?? ''), order: String(tab.getAttr('order') ?? '') });
  }
  return tabs.sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1));
}

/** The tab's body, the node an editor binds (`configureYProsemirror({ytype})`) and the writer edits. */
export const tabBody = (doc: Doc, tabId: string): Node | undefined => {
  const body: unknown = tabNode(doc, tabId)?.getAttr('body');
  return body instanceof YNode ? body : undefined;
};

interface NewTab {
  title: string;
  /** The tab's content as a ProseMirror doc of the schema; one empty paragraph when absent (a body is `block+`). */
  body?: PMNode;
  id?: string;
  generateID?: () => string;
}

function writeTab(doc: Doc, id: string, title: string, order: string, body: PMNode): void {
  const tab = new YNode('tab');
  tabsRoot(doc).setAttr(id, tab);
  tab.setAttr('title', title);
  tab.setAttr('order', order);
  const content = new YNode('doc');
  tab.setAttr('body', content);
  content.applyDelta(pmnodeToDelta(body));
}

const emptyBody = (generateID: () => string): PMNode => {
  const schema = schemaFor();
  return schema.nodes.doc.create(null, schema.nodes.paragraph.create({ id: generateID() }));
};

/** Creates the document's first tab (once per document). Returns its id. */
export function createDocument(doc: Doc, { title, body, id, generateID = nanoid8 }: NewTab, origin?: unknown): string {
  if (listTabs(doc).length > 0) throw new Error('createDocument: the document already has tabs');
  const tabId = id ?? generateID();
  transact(doc, () => writeTab(doc, tabId, title, keyBetween(null, null), body ?? emptyBody(generateID)), origin);
  return tabId;
}

/** Adds a tab after `after` (default: last). Returns its id. */
export function addTab(doc: Doc, { title, body, id, generateID = nanoid8, after }: NewTab & { after?: string }, origin?: unknown): string {
  const tabs = listTabs(doc);
  const at = after == null ? tabs.length - 1 : tabs.findIndex((tab) => tab.id === after);
  if (after != null && at < 0) throw new Error(`addTab: no tab ${after}`);
  const tabId = id ?? generateID();
  transact(
    doc,
    () => {
      const [order, rekeyed] = place(tabs, at + 1);
      writeTab(doc, tabId, title, order, body ?? emptyBody(generateID));
      rekey(doc, rekeyed);
    },
    origin,
  );
  return tabId;
}

export function renameTab(doc: Doc, tabId: string, title: string, origin?: unknown): void {
  const tab = tabNode(doc, tabId);
  if (!tab) throw new Error(`renameTab: no tab ${tabId}`);
  transact(doc, () => tab.setAttr('title', title), origin);
}

/** Moves a tab before or after another by giving it an order key between its new neighbours. */
export function moveTab(doc: Doc, tabId: string, to: { before: string } | { after: string }, origin?: unknown): void {
  const tab = tabNode(doc, tabId);
  if (!tab) throw new Error(`moveTab: no tab ${tabId}`);
  const others = listTabs(doc).filter((other) => other.id !== tabId);
  const anchor = 'before' in to ? to.before : to.after;
  const at = others.findIndex((other) => other.id === anchor);
  if (at < 0) throw new Error(`moveTab: no tab ${anchor}`);
  transact(
    doc,
    () => {
      const [order, rekeyed] = place(others, 'before' in to ? at : at + 1);
      tab.setAttr('order', order);
      rekey(doc, rekeyed);
    },
    origin,
  );
}

/**
 * The order key for a tab placed at `index` of `tabs` (in display order, the placed tab not among them), and the tabs
 * after it that need new keys. Two replicas adding after the same tab mint the same key, and listTabs breaks the tie
 * by id, so the neighbours can share a key; the run of tabs after the gap that shares the key before it is re-keyed
 * with the placed tab, between the key before the gap and the first key above it, keeping the run's display order.
 */
function place(tabs: TabInfo[], index: number): [string, Array<{ id: string; order: string }>] {
  const lo = tabs[index - 1]?.order ?? null;
  let end = index;
  while (lo != null && end < tabs.length && tabs[end].order <= lo) end++;
  const hi = tabs[end]?.order ?? null;
  const order = keyBetween(lo, hi);
  const rekeyed: Array<{ id: string; order: string }> = [];
  let previous = order;
  for (const tab of tabs.slice(index, end)) {
    previous = keyBetween(previous, hi);
    rekeyed.push({ id: tab.id, order: previous });
  }
  return [order, rekeyed];
}

function rekey(doc: Doc, rekeyed: Array<{ id: string; order: string }>): void {
  for (const { id, order } of rekeyed) tabNode(doc, id)?.setAttr('order', order);
}

/** Deletes a tab and its body. A document keeps at least one tab. */
export function deleteTab(doc: Doc, tabId: string, origin?: unknown): void {
  if (!tabNode(doc, tabId)) throw new Error(`deleteTab: no tab ${tabId}`);
  if (listTabs(doc).length === 1) throw new Error('deleteTab: a document keeps its last tab');
  transact(doc, () => tabsRoot(doc).deleteAttr(tabId), origin);
}

// ── fractional order keys ──
// Strings over [0-9a-z] compared as strings; a key never ends in '0', so there is always a key between two keys (the
// midpoint construction of rocicorp's fractional-indexing, without its integer part).
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A key strictly between `a` and `b` (`null` is the open end). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a != null && b != null && a >= b) throw new Error(`keyBetween: ${a} is not before ${b}`);
  return midpoint(a ?? '', b);
}

function midpoint(a: string, b: string | null): string {
  if (b != null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const lo = a ? DIGITS.indexOf(a[0]) : 0;
  const hi = b != null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (hi - lo > 1) return DIGITS[Math.round((lo + hi) / 2)];
  if (b != null && b.length > 1) return b[0];
  return DIGITS[lo] + midpoint(a.slice(1), null);
}
