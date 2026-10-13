// The document `KindAdapter` (D8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4 [binding]; parent
// Decision Log 31, 32 and 34; P3-0's `s4/src/host.ts` `receive`/`forward`/`repair` and `s5/lib/restore.mjs`), on the
// hook points of A's `src/artifacts/host.ts` as A's service calls them:
//
//   beforeApply(live, incoming, {step2})  reads the incoming bytes before they are applied (an edit landing in a
//       tombstoned block is collected on arrival) and returns the forwarding edit: each text insertion whose block a
//       carry re-inserted is replayed into the new copy, and, only for an incremental update, each deletion (a step 2
//       restates its sender's whole delete set, the move's own deletion included). The update that performs a carry
//       also brings along the edits that reached the old copy before it (a keystroke racing the agent's update over
//       the port). A delete and an insert of one block id in one update is a move (a human drag) or a retype, installed
//       as a carry like the writer's (its copy, its character and textblock forwards).
//   afterUpdate(replica, {update})  returns the carries the update performed as `provenance` (A re-credits each moved
//       or retyped character to its author before writing the update's attribution row), repairs the ids the update
//       inserted (repair.ts), strips comment marks whose thread is absent and refreshes the anchors of the threads
//       whose marks the update touched, all scoped to the blocks the update changed, and returns the threads mirror
//       rows of the threads it changed.
//   revertScope(live, old)  keeps a restore from taking back a conversation: a thread created since the version stays
//       with its messages, a reply posted since stays on its thread; text, marks and thread statuses revert (the
//       owner's Decision Log 32).
//   afterRestore(replica)  a full pass: ids, markless comments, anchors, and every thread's mirror row.
//
// The forwarding edit and `afterUpdate` write into the actor's host replica (never the live doc), which A's service
// lands as that actor's update. Every hook reads the carry registry of the doc's own artifact (`artifactOf`, D8).
import type { Actor } from '@shared/artifacts/actor';
import type { KindAdapter, RevertScope, ThreadChange, ThreadRow } from '../host';
import { contentIdsOf, type ContentIds, type Doc, type Node } from '../yjs';
import { ContentString, ContentType, Item, YNode, createContentIds, createIdSet, decodeUpdate, findIndexSS } from '../yjs/document';
import { DocIndex, type TopBlock } from './block-index';
import { CarryRegistry } from './carries';
import type { Carry, Slot } from './edit-ops';
import { allBlocks, applyRepair, planRepair, repairNeeded } from './repair';
import { nanoid8 } from './schema';
import { deepSlotIds, formatAt, itemAt, itemOf, locateSlot, nodeAt, slotKey, textblocksY, charSlots } from './structs';
import { THREADS, getThread, isCommentKey, listThreads, refreshAnchors, stripMarklessComments, type Thread } from './threads';

export interface DocumentAdapter extends KindAdapter {
  /** The carries of a batch the tool handler just applied on the agent's replica (S4's `registerCarry`). */
  registerCarries(artifactId: string, carries: readonly Carry[]): void;
  /** Drops an artifact's carries (its document closed for good, or the artifact deleted). */
  forgetArtifact(artifactId: string): void;
  /** The carries held across artifacts, and how many of them still wait for the update performing them. */
  stats(): { carries: number; pending: number };
}

export interface DocumentAdapterOptions {
  /**
   * The artifact a doc the hooks receive belongs to: the live doc (`beforeApply`) and every per-actor host replica
   * (`afterUpdate`, the forwarding edit, `afterRestore`). The carry registry is per artifact (D8), since two artifacts
   * copied from one version share their item ids. M7 supplies it (A's hooks pass no artifact id).
   */
  artifactOf: (doc: Doc) => string;
  generateID?: () => string;
}

interface DecodedItem {
  id: { client: number; clock: number };
  origin: { client: number; clock: number } | null;
  rightOrigin: { client: number; clock: number } | null;
  parent: unknown;
  parentSub: string | null;
  content: unknown;
  length: number;
}

/** A move a human made (a block's node deleted and re-inserted under its id in one update), seen before the apply. */
interface Drag {
  blockId: string;
  source: Slot;
  sourceSlots: Slot[];
  sourceBlocks: Slot[]; // the source's textblocks, paired in order with the copy's for the block forwards
  node: Slot;
  name: string; // the source node's type: a re-insert as another type is a retype
}

/** Edits that reached a carried block's old copy before the update performing the carry (seen before the apply). */
interface Late {
  carry: Carry;
  inserts: Array<{ text: string; slots: Slot[]; after: Slot | null; before: Slot | null; block: Slot }>;
  deletes: Slot[];
}

const isIdLike = (value: unknown): value is { client: number; clock: number } => typeof value === 'object' && value !== null && 'client' in value && 'clock' in value;
const asSlot = (id: { client: number; clock: number }): Slot => [id.client, id.clock];

/** Items of `doc` (structs only) in the ranges of an id set. */
function itemsIn(doc: Doc, set: ContentIds['inserts'], visit: (item: Item) => void): void {
  set.forEach((range, client) => {
    const structs = doc.store.clients.get(client);
    if (!structs) return;
    for (let i = findIndexSS(structs, range.clock); i < structs.length && structs[i].id.clock < range.clock + range.len; i++) {
      const struct = structs[i];
      if (struct instanceof Item) visit(struct);
    }
  });
}

const carriesAny = (have: ReadonlySet<string>, wanted: ReadonlySet<string>): boolean => {
  for (const id of have) if (wanted.has(id)) return true;
  return false;
};

const threadRow = (thread: Thread): ThreadRow => ({
  threadId: thread.id,
  status: thread.status,
  quote: thread.quote,
  createdAt: thread.createdAt,
  updatedAt: Math.max(thread.createdAt, thread.resolvedAt ?? 0, thread.reopenedAt ?? 0, ...thread.messages.map((message) => message.at)),
  ...(thread.status === 'resolved' && thread.resolvedAt != null ? { resolvedAt: thread.resolvedAt } : {}),
  ...(thread.createdBy.kind === 'session' ? { appSessionId: (thread.createdBy as Extract<Actor, { kind: 'session' }>).appSessionId } : {}),
});

export function documentAdapter({ artifactOf, generateID = nanoid8 }: DocumentAdapterOptions): DocumentAdapter {
  const registries = new Map<string, CarryRegistry>();
  const registryFor = (artifactId: string): CarryRegistry => {
    let registry = registries.get(artifactId);
    if (!registry) registries.set(artifactId, (registry = new CarryRegistry()));
    return registry;
  };
  const registryOf = (doc: Doc): CarryRegistry => registryFor(artifactOf(doc));
  // What a forwarding edit learnt for the `afterUpdate` that follows it on the same replica (A calls both in one frame).
  const stash = new WeakMap<Doc, Carry[]>();

  /** The blocks an update touched, the nodes it inserted, and the threads it changed. */
  function scan(doc: Doc, ids: ContentIds): { tops: Set<TopBlock>; inserted: Set<Node>; threads: Set<string> } {
    const index = DocIndex.of(doc);
    const threadsRoot = doc.get(THREADS);
    const tops = new Set<TopBlock>();
    const inserted = new Set<Node>();
    const threads = new Set<string>();
    const visit = (isInsert: boolean) => (item: Item) => {
      if (isInsert && item.content instanceof ContentType) inserted.add(item.content.type as Node);
      const parent = item.parent;
      if (!(parent instanceof YNode)) return;
      if (isInsert && item.parentSub === 'id') inserted.add(parent);
      if (parent === threadsRoot) {
        if (item.parentSub) threads.add(item.parentSub);
        return;
      }
      if (parent.parent === threadsRoot && parent._item?.parentSub) {
        threads.add(parent._item.parentSub);
        return;
      }
      const top = index.topOf(item.content instanceof ContentType ? (item.content.type as Node) : parent) ?? index.topOf(parent);
      if (top) tops.add(top);
    };
    itemsIn(doc, ids.inserts, visit(true));
    itemsIn(doc, ids.deletes, visit(false));
    return { tops, inserted, threads };
  }

  /** The thread scope of a set of changed blocks: their threads, and per tab the blocks carrying any of them. */
  function threadScope(doc: Doc, changed: Set<TopBlock>) {
    const index = DocIndex.of(doc);
    const threads = new Set<string>();
    for (const top of changed) for (const id of index.threads(top)) threads.add(id);
    return {
      threads,
      blocks: (tabId: string) => (threads.size === 0 ? [] : index.tops(tabId).filter((top) => carriesAny(index.threads(top), threads)).map((top) => top.node)),
    };
  }

  function mirrorRows(doc: Doc, threadIds: Iterable<string>): ThreadChange | undefined {
    const upsert: ThreadRow[] = [];
    const remove: string[] = [];
    for (const id of threadIds) {
      const thread = getThread(doc, id);
      if (thread) upsert.push(threadRow(thread));
      else remove.push(id);
    }
    if (upsert.length === 0 && remove.length === 0) return undefined;
    return { ...(upsert.length ? { upsert } : {}), ...(remove.length ? { remove } : {}) };
  }

  /** The block ids the incoming update writes on nodes it creates, with each node's item. */
  function insertedBlocks(items: DecodedItem[]): Map<string, Slot> {
    const out = new Map<string, Slot>();
    const nodes = new Set(items.filter((item) => item.content instanceof ContentType).map((item) => slotKey(item.id)));
    for (const item of items) {
      if (item.parentSub !== 'id' || !isIdLike(item.parent) || !nodes.has(slotKey(item.parent))) continue;
      const value = (item.content as { getContent?(): unknown[] }).getContent?.()[0];
      if (typeof value === 'string') out.set(value, asSlot(item.parent));
    }
    return out;
  }

  /** Blocks of `live` the incoming update deletes and re-inserts under the same id (seen before the apply). */
  function drags(live: Doc, inserted: Map<string, Slot>, deletes: ContentIds['deletes'], carried: Set<string>): Drag[] {
    if (inserted.size === 0) return [];
    const out: Drag[] = [];
    itemsIn(live, deletes, (item) => {
      if (item.deleted || !(item.content instanceof ContentType)) return;
      const node = item.content.type as Node;
      const id: unknown = node.getAttr('id');
      const now = typeof id === 'string' ? inserted.get(id) : undefined;
      if (now && !carried.has(slotKey(now))) out.push({ blockId: id as string, source: itemOf(node), sourceSlots: deepSlotIds(node), sourceBlocks: textblocksY(node).map(itemOf), node: now, name: node.name });
    });
    return out;
  }

  /**
   * What reached a carried block's old copy after the agent's replica took it (seen before the apply): characters the
   * carry did not take along and the performing update does not delete (the agent's own replaced words it deletes),
   * and carried characters deleted since.
   */
  function lateEdits(live: Doc, carry: Carry, deletes: ContentIds['deletes']): Late | null {
    const source = carry.source && nodeAt(live, carry.source);
    if (!source) return null;
    const from = new Set(carry.from.map(slotKey));
    const late: Late = { carry, inserts: [], deletes: carry.from.filter((slot) => !itemAt(live, slot) || itemAt(live, slot)!.deleted) };
    for (const block of textblocksY(source)) {
      // a run of late characters sits right after the carried character it follows; one that follows words the agent
      // replaced sits before the next carried character, after the agent's new words
      let previous: Slot | null = null;
      let run: Late['inserts'][number] | null = null;
      const open: Array<Late['inserts'][number]> = [];
      for (const { slot, ch } of charSlots(block)) {
        if (from.has(slotKey(slot))) {
          for (const waiting of open.splice(0)) waiting.before = slot;
          previous = slot;
          run = null;
        } else if (deletes.has(slot[0], slot[1])) {
          previous = null;
          run = null;
        }
        else if (run) {
          run.text += ch;
          run.slots.push(slot);
        } else {
          late.inserts.push((run = { text: ch, slots: [slot], after: previous, before: null, block: itemOf(block) }));
          open.push(run);
        }
      }
    }
    return late.inserts.length || late.deletes.length ? late : null;
  }

  /** Inserts `text` where the forwards say its left (or right) neighbour, or its textblock, lives now. */
  function replay(registry: CarryRegistry, doc: Doc, text: string, slots: Slot[], left: Slot | null, right: Slot | null, block: Slot | null): boolean {
    const after = left && registry.resolve(left);
    const before = !after && right ? registry.resolve(right) : null;
    const into = !after && !before && block ? registry.resolveBlock(block) : null;
    const at = after ? locateSlot(doc, after) : before ? locateSlot(doc, before) : into ? { node: nodeAt(doc, into)!, index: -1 } : null;
    if (!at || !at.node) return false;
    const index = after ? at.index + 1 : before ? at.index : 0;
    at.node.insert(index, text, formatAt(at.node, index, isCommentKey));
    const now = deepSlotIds(at.node).slice(index, index + text.length);
    slots.forEach((slot, k) => registry.noteForward(slot, now[k]));
    return true;
  }

  function forwardEdit(live: Doc, incoming: Uint8Array, step2: boolean): ((doc: Doc) => void) | null {
    const registry = registryOf(live);
    const ids = contentIdsOf(incoming);
    if (registry.empty && ids.deletes.isEmpty()) return null;
    const performing = registry.performedBy(ids.inserts);
    const { structs, ds } = decodeUpdate(incoming) as unknown as { structs: unknown[]; ds: ContentIds['deletes'] };
    const items = structs.filter((struct): struct is DecodedItem => struct instanceof Item) as unknown as DecodedItem[];
    const carriedNodes = new Set(performing.map((carry) => carry.node).filter((slot): slot is Slot => slot !== undefined).map(slotKey));
    const inserted = insertedBlocks(items);
    const moved = ids.deletes.isEmpty() ? [] : drags(live, inserted, ds, carriedNodes);
    const late = performing.map((carry) => lateEdits(live, carry, ds)).filter((entry): entry is Late => entry !== null);
    if (performing.length === 0 && moved.length === 0 && !registry.hasActive) return null;
    // Deletions that are part of a move are not edits: the moves this update performs (registered or a drag), and any
    // re-insert of a block an earlier carry moved (a stale replica moving the old copy again).
    const own = new Set([...performing.flatMap((carry) => carry.from.map(slotKey)), ...moved.flatMap((drag) => drag.sourceSlots.map(slotKey)), ...registry.carriedOf(new Set(inserted.keys()))]);
    return (doc) => {
      // the carries this update performs are live from here on; their own deletions are not edits to replay
      for (const carry of performing) registry.activate(carry);
      for (const { carry, inserts, deletes } of late) {
        for (const run of inserts) replay(registry, doc, run.text, run.slots, run.after, run.before, run.block);
        for (const slot of deletes) {
          const k = carry.from.findIndex((from) => slotKey(from) === slotKey(slot));
          const at = k >= 0 ? locateSlot(doc, carry.to[k] as Slot) : null;
          if (at) at.node.delete(at.index, 1);
        }
      }
      for (const item of items) {
        if (!(item.content instanceof ContentString)) continue;
        const live = itemAt(doc, asSlot(item.id));
        if (live && !live.deleted) continue; // it landed in a live block
        const text = item.content.str;
        const slots = Array.from({ length: text.length }, (_, k): Slot => [item.id.client, item.id.clock + k]); // UTF-16 units, as Yjs clocks count
        replay(registry, doc, text, slots, item.origin && asSlot(item.origin), item.rightOrigin && asSlot(item.rightOrigin), isIdLike(item.parent) ? asSlot(item.parent) : null);
      }
      if (!step2) {
        ds.forEach((range, client) => {
          for (let k = 0; k < range.len; k++) {
            const slot: Slot = [client, range.clock + k];
            if (own.has(slotKey(slot))) continue;
            const to = registry.resolve(slot);
            const at = to && locateSlot(doc, to);
            if (at) at.node.delete(at.index, 1);
          }
        });
      }
      // a drag or retype is a carry of its own from here on: its copy is recorded and the old copy's characters and
      // textblocks forward into it, so an edit still in flight into the old copy lands in the new one
      const carries: Carry[] = [];
      for (const drag of moved) {
        const node = nodeAt(doc, drag.node);
        if (!node) continue;
        const now = deepSlotIds(node);
        if (now.length !== drag.sourceSlots.length) continue;
        const blocks = textblocksY(node).map(itemOf);
        const carry: Carry = {
          kind: node.name === drag.name ? 'move' : 'retype',
          blockId: drag.blockId,
          from: drag.sourceSlots,
          to: now,
          source: drag.source,
          node: drag.node,
          blocks: drag.sourceBlocks.slice(0, blocks.length).map((old, k): [Slot, Slot] => [old, blocks[k]]),
        };
        registry.register([carry]);
        registry.activate(carry);
        registry.reported(carry);
        carries.push(carry);
      }
      if (carries.length) stash.set(doc, carries);
    };
  }

  function afterUpdate(doc: Doc, update: Uint8Array): { threads?: ThreadChange; provenance?: Carry[] } | void {
    const registry = registryOf(doc);
    const ids = contentIdsOf(update);
    const provenance = registry.performedBy(ids.inserts);
    for (const carry of provenance) {
      registry.activate(carry);
      registry.reported(carry);
    }
    provenance.push(...(stash.get(doc) ?? []));
    stash.delete(doc);
    const { tops, inserted, threads } = scan(doc, ids);
    const plan = planRepair(doc, inserted, registry, (node) => !!node._item && ids.inserts.has(node._item.id.client, node._item.id.clock));
    if (repairNeeded(plan)) applyRepair(doc, plan, registry, generateID);
    if (tops.size > 0) {
      const live = [...tops].filter((top) => DocIndex.of(doc).position(top) >= 0);
      const byTab = (tabId: string) => live.filter((top) => top.tabId === tabId).map((top) => top.node);
      stripMarklessComments(doc, undefined, byTab);
      const scope = threadScope(doc, new Set(live));
      if (scope.threads.size > 0) refreshAnchors(doc, undefined, scope);
    }
    registry.prune(doc);
    const mirror = mirrorRows(doc, threads);
    if (!mirror && provenance.length === 0) return;
    return { ...(mirror ? { threads: mirror } : {}), ...(provenance.length ? { provenance } : {}) };
  }

  return {
    kind: 'document',
    registerCarries: (artifactId, carries) => registryFor(artifactId).register(carries),
    forgetArtifact: (artifactId) => void registries.delete(artifactId),
    stats: () => {
      const total = { carries: 0, pending: 0 };
      for (const registry of registries.values()) {
        const { carries, pending } = registry.stats();
        total.carries += carries;
        total.pending += pending;
      }
      return total;
    },
    beforeApply: (live, incoming, { step2 }) => forwardEdit(live, incoming, step2),
    afterUpdate: (doc, { update }) => afterUpdate(doc, update),
    revertScope: (live, old) => revertScope(live, old),
    afterRestore(doc) {
      const registry = registryOf(doc);
      const plan = planRepair(doc, allBlocks(doc), registry, () => false);
      if (repairNeeded(plan)) applyRepair(doc, plan, registry, generateID);
      stripMarklessComments(doc);
      refreshAnchors(doc);
      const upsert = listThreads(doc).map(threadRow);
      return upsert.length ? { threads: { upsert } } : undefined;
    },
    summarizeTurn(results) {
      const lines = results.flatMap((result) => {
        const list = (result as { results?: unknown } | null)?.results;
        return Array.isArray(list) ? list.map((entry) => (entry as { line?: unknown } | null)?.line).filter((line): line is string => typeof line === 'string') : [];
      });
      return lines.length ? lines.join('\n') : `${results.length} edits`;
    },
  };
}

/**
 * What a restore leaves in place (parent Decision Log 32, S5's `restoreKeepingConversation` as a scope): a thread
 * created since the version, whole (its node, every attribute, its messages); on a thread the version had, its
 * messages. Each kept item is kept as inserted, and as deleted when it was deleted since, so the revert neither removes
 * nor resurrects it. Text, marks, tabs and the statuses and anchors of threads the version had revert.
 */
export function revertScope(live: Doc, old: Doc): RevertScope {
  const inserts = createIdSet();
  const deletes = createIdSet();
  const keep = (item: Item | null) => {
    if (!item) return;
    inserts.add(item.id.client, item.id.clock, item.length);
    if (item.deleted) deletes.add(item.id.client, item.id.clock, item.length);
  };
  const children = (node: Node) => {
    for (let item = node._start; item !== null; item = item.right) keep(item);
  };
  const oldThreads = old.get(THREADS);
  for (const [id, node] of live.get(THREADS).attrEntries()) {
    if (!(node instanceof YNode)) continue;
    if (oldThreads.getAttr(String(id)) instanceof YNode) {
      children(node);
      continue;
    }
    keep(node._item);
    for (const item of node._map.values()) for (let at: Item | null = item; at; at = at.left) keep(at);
    children(node);
  }
  return { keep: createContentIds(inserts, deletes) };
}
