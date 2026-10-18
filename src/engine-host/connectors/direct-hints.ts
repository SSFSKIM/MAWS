// P3-HD M3b: route D's host-only tool hints (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, Decision Log 15,
// 18 and 21). What a live tools/list on MAWS's own connection said of a verified source's tools: eligibility metadata
// for a resolution (./direct-calls.ts), never authority. The call itself always proves the live tool again.
//
// - A slot belongs to one source, matched exactly by its id, generation and entry digest; it carries the credential
//   (connection and epoch) the listing ran under, if any. At most `DIRECT_HINT_BOUNDS.sources` slots, the oldest
//   evicted, each of at most `toolsPerSource` tools (a longer listing is refused whole).
// - Publication is ordered by admission (`admit`, taken as the operation is admitted): a listing admitted earlier never
//   replaces one admitted later, a credential-less listing never replaces a credentialed one, and a lower epoch of the
//   same connection never a higher. Only the caller's synchronous post-list validity step publishes (its source, its
//   credential and main's attachment still standing), so a withdrawn credential's pending listing never reaches here.
// - Lifetimes: `clear` (main's going, a global close) forgets every slot; `withdraw` a credential's slots at or below its
//   floor (a rotation included: the next epoch's demanded listing repopulates them). Neither a clear, a withdrawal nor an
//   eviction can be undone by a publisher admitted before it, and each reaches only what it invalidated (P3-F L269): a
//   clear every publisher admitted before it; a withdrawal those publishing the sources it removed or under the withdrawn
//   credential; an eviction those publishing the evicted source. Another source's pending first listing still lands.
//   At most `sources` fences of each kind are kept; one forgotten past that bound refuses every publisher admitted
//   before it, so the bound fails closed (a listing arrives late, never a withdrawn one).
// Host memory only: never persisted, serialized or sent.

export const DIRECT_HINT_BOUNDS = { sources: 256, toolsPerSource: 1_024 } as const;

export interface DirectHintPublisher {
  readonly admittedAt: number; // `admit`'s order of the publishing operation
  readonly credential?: { readonly connectionId: string; readonly credentialEpoch: number };
}

type SourceIdentity = { readonly sourceId: string; readonly generation: number; readonly entryDigest: string };

interface Slot {
  readonly generation: number;
  readonly entryDigest: string;
  readonly publisher: DirectHintPublisher;
  readonly tools: ReadonlyMap<string, boolean>; // name → readOnly
  readonly taskRequired: ReadonlySet<string>; // P3-HD panel correction: names whose listing required task execution
}

interface Fence {
  readonly at: number; // the admissions count when it was raised: it refuses publishers admitted at or before
}

interface CredentialFence extends Fence {
  readonly floor: number; // the connection's epochs at or below this were withdrawn
}

export class DirectToolHints {
  private admissions = 0;
  private createdAfter = 0; // a publisher admitted at or before this may create no slot: a clear, or a fence forgotten past its bound
  private readonly slots = new Map<string, Slot>(); // by source id, oldest first
  private readonly sourceFences = new Map<string, Fence>(); // by source id: its slot's last withdrawal or eviction, oldest first
  private readonly credentialFences = new Map<string, CredentialFence>(); // by connection id: its last withdrawal, oldest first

  constructor(private readonly bounds: { readonly sources: number; readonly toolsPerSource: number } = DIRECT_HINT_BOUNDS) {}

  admit(): number {
    return ++this.admissions;
  }

  // Whether the listing was kept.
  publish(source: SourceIdentity, tools: readonly { readonly name: string; readonly readOnly: boolean; readonly taskRequired?: boolean }[], publisher: DirectHintPublisher): boolean {
    if (tools.length > this.bounds.toolsPerSource) return false;
    if (this.fenced(source, publisher)) return false;
    const held = this.slots.get(source.sourceId);
    if (held && !supersedes(publisher, held.publisher)) return false;
    if (held) this.slots.delete(source.sourceId);
    else if (this.slots.size >= this.bounds.sources) this.evictOldest();
    this.sourceFences.delete(source.sourceId); // the new slot's own order supersedes it from here
    this.slots.set(source.sourceId, { generation: source.generation, entryDigest: source.entryDigest, publisher, tools: new Map(tools.map((tool) => [tool.name, tool.readOnly])), taskRequired: new Set(tools.filter((tool) => tool.taskRequired === true).map((tool) => tool.name)) });
    return true;
  }

  // The tool's readOnly as the source's current listing said, or null with no listing of exactly this source naming it.
  readOnly(source: SourceIdentity, tool: string): boolean | null {
    return this.slotOf(source)?.tools.get(tool) ?? null;
  }

  // P3-HD panel correction: whether the source's current listing said the tool requires task execution (route D
  // cannot run it); false with no listing of exactly this source.
  taskRequired(source: SourceIdentity, tool: string): boolean {
    return this.slotOf(source)?.taskRequired.has(tool) ?? false;
  }

  private slotOf(source: SourceIdentity): Slot | null {
    const slot = this.slots.get(source.sourceId);
    return !slot || slot.generation !== source.generation || slot.entryDigest !== source.entryDigest ? null : slot;
  }

  // The credential's epochs at or below `floor` were withdrawn: their slots go.
  withdraw(connectionId: string, floor: number): void {
    const at = this.admissions;
    for (const [sourceId, slot] of this.slots) {
      const { credential } = slot.publisher;
      if (credential?.connectionId !== connectionId || credential.credentialEpoch > floor) continue;
      this.slots.delete(sourceId);
      this.fence(this.sourceFences, sourceId, { at });
    }
    this.fence(this.credentialFences, connectionId, { at, floor: Math.max(floor, this.credentialFences.get(connectionId)?.floor ?? floor) });
  }

  clear(): void {
    this.createdAfter = this.admissions;
    this.slots.clear();
    this.sourceFences.clear();
    this.credentialFences.clear();
  }

  // Whether a clear, or an invalidation of this source or of the publisher's credential, came after its admission.
  private fenced(source: SourceIdentity, publisher: DirectHintPublisher): boolean {
    const { admittedAt, credential } = publisher;
    if (admittedAt <= this.createdAfter || admittedAt <= (this.sourceFences.get(source.sourceId)?.at ?? 0)) return true;
    if (!credential) return false;
    const withdrawn = this.credentialFences.get(credential.connectionId);
    return withdrawn !== undefined && admittedAt <= withdrawn.at && credential.credentialEpoch <= withdrawn.floor;
  }

  private fence<T extends Fence>(fences: Map<string, T>, key: string, fence: T): void {
    fences.delete(key);
    fences.set(key, fence);
    for (const [oldest, forgotten] of fences) {
      if (fences.size <= this.bounds.sources) break;
      fences.delete(oldest);
      this.createdAfter = Math.max(this.createdAfter, forgotten.at);
    }
  }

  private evictOldest(): void {
    const oldest = this.slots.keys().next();
    if (oldest.done) return;
    this.slots.delete(oldest.value);
    this.fence(this.sourceFences, oldest.value, { at: this.admissions });
  }
}

function supersedes(next: DirectHintPublisher, held: DirectHintPublisher): boolean {
  if (next.admittedAt <= held.admittedAt) return false;
  if (!held.credential) return true;
  if (!next.credential) return false;
  return next.credential.connectionId !== held.credential.connectionId || next.credential.credentialEpoch >= held.credential.credentialEpoch;
}
