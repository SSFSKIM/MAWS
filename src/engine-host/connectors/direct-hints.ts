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
//   eviction can be undone by a publisher admitted before it: such a publisher may no longer create a slot.
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
}

export class DirectToolHints {
  private admissions = 0;
  private createdAfter = 0; // a publisher admitted at or before this may create no slot (a clear, withdrawal or eviction since)
  private readonly slots = new Map<string, Slot>(); // by source id, oldest first

  constructor(private readonly bounds: { readonly sources: number; readonly toolsPerSource: number } = DIRECT_HINT_BOUNDS) {}

  admit(): number {
    return ++this.admissions;
  }

  // Whether the listing was kept.
  publish(source: SourceIdentity, tools: readonly { readonly name: string; readonly readOnly: boolean }[], publisher: DirectHintPublisher): boolean {
    if (tools.length > this.bounds.toolsPerSource) return false;
    const held = this.slots.get(source.sourceId);
    if (held ? !supersedes(publisher, held.publisher) : publisher.admittedAt <= this.createdAfter) return false;
    if (held) this.slots.delete(source.sourceId);
    else if (this.slots.size >= this.bounds.sources) this.evictOldest();
    this.slots.set(source.sourceId, { generation: source.generation, entryDigest: source.entryDigest, publisher, tools: new Map(tools.map((tool) => [tool.name, tool.readOnly])) });
    return true;
  }

  // The tool's readOnly as the source's current listing said, or null with no listing of exactly this source naming it.
  readOnly(source: SourceIdentity, tool: string): boolean | null {
    const slot = this.slots.get(source.sourceId);
    if (!slot || slot.generation !== source.generation || slot.entryDigest !== source.entryDigest) return null;
    return slot.tools.get(tool) ?? null;
  }

  // The credential's epochs at or below `floor` were withdrawn: their slots go.
  withdraw(connectionId: string, floor: number): void {
    this.createdAfter = this.admissions;
    for (const [sourceId, slot] of this.slots) {
      const { credential } = slot.publisher;
      if (credential?.connectionId === connectionId && credential.credentialEpoch <= floor) this.slots.delete(sourceId);
    }
  }

  clear(): void {
    this.createdAfter = this.admissions;
    this.slots.clear();
  }

  private evictOldest(): void {
    const oldest = this.slots.keys().next();
    if (!oldest.done) this.slots.delete(oldest.value);
    this.createdAfter = this.admissions;
  }
}

function supersedes(next: DirectHintPublisher, held: DirectHintPublisher): boolean {
  if (next.admittedAt <= held.admittedAt) return false;
  if (!held.credential) return true;
  if (!next.credential) return false;
  return next.credential.connectionId !== held.credential.connectionId || next.credential.credentialEpoch >= held.credential.credentialEpoch;
}
