// The host's record of the patch writer's carries (D8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; P3-0's
// `s4/src/host.ts` `registerCarry`, `fwd`, `fwdBlock`, `copies`). The tool handler registers a batch's carries right
// after the agent's replica applied it; a carry stays pending until the update performing it reaches the host (its own
// deletion of the old copy is then not an edit to forward), and is active from then on:
//   - `forward`: where a carried character lives now, so an edit a replica made in the old copy before it saw the move
//     is replayed into the new one (a tombstoned block's new content is collected on arrival);
//   - `forwardBlock`: the same for a textblock, for an edit that arrives naming only its parent;
//   - `copies`: the node a move or retype made, with its arrival order and its characters' origins, so the id repair
//     keeps the later of two copies of one block and carries the other's edits into it.
// One registry per artifact (D8): two artifacts copied from one version share their item ids, so a forward keyed by slot
// is only meaningful within its artifact; the adapter keeps a registry per artifact id and drops it with the artifact.
// A carry is pruned once its copy is gone (deleted, and not itself the source of a later carry).
import type { Doc } from '../yjs';
import type { Carry, Slot } from './edit-ops';
import { hasSlot, itemAt, parseSlot, slotKey } from './structs';

interface Entry {
  carry: Carry;
  active: boolean;
  reported: boolean;
}

export interface CopyRecord {
  blockId: string;
  arrival: number;
  /** The copy's slot (key) → the source slot it was made from. */
  base: Map<string, Slot>;
}

const MAX_CHAIN = 64;

export class CarryRegistry {
  private entries: Entry[] = [];
  private readonly forward = new Map<string, Slot>();
  private readonly forwardBlock = new Map<string, Slot>();
  private readonly copies = new Map<string, CopyRecord>();
  /** Forwards added while replaying an edit (its new characters), so a chain of keystrokes keeps following. */
  private readonly extra = new Map<string, Slot>();
  private arrivals = 0;

  register(carries: readonly Carry[]): void {
    for (const carry of carries) this.entries.push({ carry, active: false, reported: false });
  }

  get empty(): boolean {
    return this.entries.length === 0 && this.copies.size === 0;
  }

  get hasActive(): boolean {
    return this.entries.some((entry) => entry.active) || this.extra.size > 0;
  }

  stats(): { carries: number; pending: number } {
    return { carries: this.entries.length, pending: this.entries.filter((entry) => !entry.active).length };
  }

  /** The carries not yet reported whose new node (or first new character) `inserts` holds: the update performs them. */
  performedBy(inserts: { has(client: number, clock: number): boolean }): Carry[] {
    return this.entries
      .filter((entry) => {
        if (entry.reported) return false;
        const probe = entry.carry.node ?? entry.carry.to[0];
        return probe !== undefined && inserts.has(probe[0], probe[1]);
      })
      .map((entry) => entry.carry);
  }

  /** The carried characters (keys) of active carries of these blocks: an update re-inserting one of the blocks deletes them as part of a move. */
  carriedOf(blockIds: ReadonlySet<string>): Set<string> {
    const out = new Set<string>();
    for (const entry of this.entries) if (entry.active && blockIds.has(entry.carry.blockId)) for (const from of entry.carry.from) out.add(slotKey(from));
    return out;
  }

  /** Makes a carry's forwards and copy live (idempotent). */
  activate(carry: Carry): void {
    const entry = this.entries.find((candidate) => candidate.carry === carry);
    if (!entry || entry.active) return;
    entry.active = true;
    carry.from.forEach((from, k) => this.forward.set(slotKey(from), carry.to[k] as Slot));
    for (const [old, now] of carry.blocks ?? []) this.forwardBlock.set(slotKey(old), now);
    if (carry.node) this.addCopy(carry.node, carry.blockId, new Map(carry.to.map((to, k) => [slotKey(to), carry.from[k] as Slot])));
  }

  /** Marks a carry reported (its provenance went out with the update that performed it). */
  reported(carry: Carry): void {
    const entry = this.entries.find((candidate) => candidate.carry === carry);
    if (entry) entry.reported = true;
  }

  private addCopy(node: Slot, blockId: string, base: Map<string, Slot>): void {
    this.copies.set(slotKey(node), { blockId, arrival: ++this.arrivals, base });
  }

  copy(node: Slot): CopyRecord | undefined {
    return this.copies.get(slotKey(node));
  }

  /** Where a carried slot lives now (following re-inserts of re-inserts), or null when it was never carried. */
  resolve(slot: Slot): Slot | null {
    let last: Slot | null = null;
    let at: Slot | undefined = this.forward.get(slotKey(slot)) ?? this.extra.get(slotKey(slot));
    for (let n = 0; at && n < MAX_CHAIN; n++) {
      last = at;
      at = this.forward.get(slotKey(at)) ?? this.extra.get(slotKey(at));
    }
    return last;
  }

  resolveBlock(textblock: Slot): Slot | null {
    return this.forwardBlock.get(slotKey(textblock)) ?? null;
  }

  /** A replayed character's new slot, so the next keystroke typed after it follows. */
  noteForward(from: Slot, to: Slot): void {
    this.extra.set(slotKey(from), to);
  }

  /** Drops the carries (and replayed forwards) whose copy `doc` (a replica of this registry's artifact) shows deleted. */
  prune(doc: Doc): void {
    const deleted = (slot: Slot) => hasSlot(doc, slot) && !(itemAt(doc, slot) && !itemAt(doc, slot)!.deleted);
    const sources = new Set(this.entries.map((entry) => entry.carry.source).filter((slot): slot is Slot => slot !== undefined).map(slotKey));
    this.entries = this.entries.filter((entry) => {
      const node = entry.carry.node;
      if (!entry.active || !node || !deleted(node) || sources.has(slotKey(node))) return true;
      entry.carry.from.forEach((from, k) => {
        const now = this.forward.get(slotKey(from));
        if (now && slotKey(now) === slotKey(entry.carry.to[k] as Slot)) this.forward.delete(slotKey(from));
      });
      for (const [old, now] of entry.carry.blocks ?? []) if (slotKey(this.forwardBlock.get(slotKey(old)) ?? [0, -1]) === slotKey(now)) this.forwardBlock.delete(slotKey(old));
      this.copies.delete(slotKey(node));
      return false;
    });
    for (const key of this.copies.keys()) if (!this.entries.some((entry) => entry.carry.node && slotKey(entry.carry.node) === key) && deleted(parseSlot(key))) this.copies.delete(key);
    for (const [key, to] of this.extra) if (deleted(to)) this.extra.delete(key);
  }
}
