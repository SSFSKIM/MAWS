// The host's id repair (D8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4 [binding]; P3-0's
// `s4/src/host.ts` `repair` and `carryCopyEdits`): every block keeps a unique id. A block without one gets one; a
// duplicate made by two concurrent moves (or a move racing a drag, or a retype) keeps the later copy, by host arrival,
// after carrying into it the edits made in the other copy, which is then tombstoned; any other duplicate (a concurrent
// split, a writer that copied an id) keeps the id on the earlier node and re-ids the rest. Text is never deleted but
// in a losing copy whose edits were carried. Scoped to the nodes an update inserted or re-id'd (all of them after a
// restore); planned first, then written, so a hook never throws after a partial write of its own.
import type { Doc, Node } from '../yjs';
import { YNode } from '../yjs/document';
import { DocIndex } from './block-index';
import type { CarryRegistry } from './carries';
import type { Slot } from './edit-ops';
import { BLOCK_TYPES } from './schema';
import { charSlots, deepSlotIds, formatAt, itemOf, locateSlot, parseSlot, slotKey, textblocksY } from './structs';
import { isCommentKey } from './threads';

const BLOCKS = new Set<string>(BLOCK_TYPES);

export interface RepairPlan {
  missing: Node[];
  keepLater: Array<{ winner: Node; losers: Node[] }>;
  reid: Node[];
}

const isLive = (node: Node): boolean => {
  for (let at: Node | null = node; at; at = at.parent as Node | null) if (at._item?.deleted) return false;
  return true;
};

/** Every block node under the tabs, depth first (a full pass: after a restore). */
export function allBlocks(doc: Doc): Node[] {
  const index = DocIndex.of(doc);
  const out: Node[] = [];
  const walk = (node: Node) => {
    out.push(node);
    for (const child of node.toArray()) if (child instanceof YNode) walk(child);
  };
  for (const tabId of index.tabIds()) for (const top of index.tops(tabId)) walk(top.node);
  return out;
}

/** What to repair among `candidates`; `insertedNow` tells a node the update being repaired inserted. */
export function planRepair(doc: Doc, candidates: Iterable<Node>, registry: CarryRegistry, insertedNow: (node: Node) => boolean): RepairPlan {
  const index = DocIndex.of(doc);
  const plan: RepairPlan = { missing: [], keepLater: [], reid: [] };
  const ids = new Set<string>();
  for (const node of candidates) {
    if (!BLOCKS.has(node.name) || !isLive(node) || !index.topOf(node)) continue;
    const id: unknown = node.getAttr('id');
    if (typeof id === 'string') ids.add(id);
    else if (!plan.missing.includes(node)) plan.missing.push(node);
  }
  for (const id of ids) {
    const group = index.nodesWithId(id).filter((node) => isLive(node) && index.topOf(node));
    if (group.length < 2) continue;
    const copies = group.filter((node) => registry.copy(itemOf(node)));
    let losers: Node[] = [];
    if (copies.length >= 2) {
      copies.sort((a, b) => registry.copy(itemOf(a))!.arrival - registry.copy(itemOf(b))!.arrival);
      losers = copies.slice(0, -1);
      plan.keepLater.push({ winner: copies[copies.length - 1], losers });
    }
    const rest = group.filter((node) => !losers.includes(node));
    if (rest.length > 1) {
      const keeper = rest.find((node) => !insertedNow(node)) ?? rest[0];
      plan.reid.push(...rest.filter((node) => node !== keeper));
    }
  }
  return plan;
}

export const repairNeeded = (plan: RepairPlan): boolean => plan.missing.length > 0 || plan.keepLater.length > 0 || plan.reid.length > 0;

/** Writes a repair plan (inside the caller's transaction). Returns one line per repair, for the log. */
export function applyRepair(doc: Doc, plan: RepairPlan, registry: CarryRegistry, generateID: () => string): string[] {
  const index = DocIndex.of(doc);
  const used = new Set<string>();
  const mint = (): string => {
    let id = generateID();
    while (used.has(id) || index.find(id)) id = generateID();
    used.add(id);
    return id;
  };
  const lines: string[] = [];
  for (const node of plan.missing) {
    const id = mint();
    node.setAttr('id', id);
    lines.push(`repair: ${node.name} without id → ^${id}`);
  }
  for (const { winner, losers } of plan.keepLater) {
    for (const loser of losers) {
      const carried = carryCopyEdits(doc, registry, loser, winner);
      const parent = loser.parent as Node;
      parent.delete(parent.toArray().indexOf(loser), 1);
      lines.push(`repair: ^${String(winner.getAttr('id'))} duplicated by concurrent moves → kept the later copy${carried ? `, carried ${carried} edit(s) into it` : ''}`);
    }
  }
  for (const node of plan.reid) {
    const was = String(node.getAttr('id'));
    const id = mint();
    node.setAttr('id', id);
    lines.push(`repair: ^${was} duplicated (${node.name}) → the later one re-id'd ^${id}`);
  }
  return lines;
}

/**
 * Before a losing copy is tombstoned: every character in it that is not one it was created with (an edit made in it
 * after the move) is inserted into the winner after the winner's counterpart of its left neighbour, and creation
 * characters deleted in the loser are deleted from the winner. Returns the number of runs carried.
 */
function carryCopyEdits(doc: Doc, registry: CarryRegistry, loser: Node, winner: Node): number {
  const recL = registry.copy(itemOf(loser));
  const recW = registry.copy(itemOf(winner));
  if (!recL || !recW) return 0;
  const sourceToWinner = new Map<string, Slot>();
  for (const [won, source] of recW.base) sourceToWinner.set(slotKey(source), parseSlot(won));
  const visible = new Set(deepSlotIds(loser).map(slotKey));
  const loserBlocks = textblocksY(loser);
  const winnerBlocks = textblocksY(winner);
  let runs = 0;
  loserBlocks.forEach((block, b) => {
    const target = winnerBlocks[b];
    if (!target) return;
    let anchor: { node: Node; index: number } = { node: target, index: -1 };
    let pending = '';
    let pendingSlots: Slot[] = [];
    const flush = () => {
      if (!pending) return;
      const at = anchor.index + 1;
      anchor.node.insert(at, pending, formatAt(anchor.node, at, isCommentKey));
      const slots = deepSlotIds(anchor.node).slice(at, at + pending.length);
      pendingSlots.forEach((slot, k) => registry.noteForward(slot, slots[k]));
      anchor = { node: anchor.node, index: anchor.index + pending.length };
      runs++;
      pending = '';
      pendingSlots = [];
    };
    for (const { slot, ch } of charSlots(block)) {
      const source = recL.base.get(slotKey(slot));
      const won = source && sourceToWinner.get(slotKey(source));
      if (won) {
        flush();
        const at = locateSlot(doc, won);
        if (at) anchor = at;
        registry.noteForward(slot, won);
      } else {
        pending += ch;
        pendingSlots.push(slot);
      }
    }
    flush();
  });
  for (const [lost, source] of recL.base) {
    if (visible.has(lost)) continue;
    const won = sourceToWinner.get(slotKey(source));
    const at = won && locateSlot(doc, won);
    if (at) {
      at.node.delete(at.index, 1);
      runs++;
    }
  }
  return runs;
}
