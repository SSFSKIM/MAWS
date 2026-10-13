// The library's sync (the P3-L document, M1's sync rules; Decision Log 2 and 6): keeps main's derived library
// (store.ts) right against the engine host's artifact store, read only through a `LibrarySource`.
//
// - At every host connection (and at start when the host is already streaming) one reconciliation replaces the whole
//   set from the host's snapshot, so a missed event, a host restart, a detached edit made while main was away or an
//   index just migrated converge there.
// - An `artifacts.changed` event refreshes that one artifact from the host's entry read; `deleted` removes the row with
//   no read. `spaces.changed` refreshes the Spaces.
// - Every step runs on one promise chain, so an event that comes while a reconciliation is out is applied after it (a
//   snapshot read before the change never undoes it) and a reconciliation waits for the entry reads already out. The
//   events waiting for the chain are coalesced per artifact, and one artifact is never read twice at once, so an
//   earlier answer never lands after a later one; an answer older than the indexed revision is dropped (store.ts).
// - Text is read for a row whose revision moved past its indexed text's, after the row lands, at most TEXT_IN_FLIGHT
//   at once, a row wanted again while its read is out read once more after it.
// - A host that is not streaming, or cannot answer, leaves the index as it is (logged): the library shows the last known
//   state, which the next connection's reconciliation makes right again.
import type { Space } from '@shared/artifacts/entity';
import type { ArtifactsChanged } from '@shared/ipc/schema/artifacts';
import type { LibraryEntryAnswer, LibrarySnapshot } from '@shared/ipc/schema/library';
import type { LibraryStore } from './store';

// What the sync reads the host's store through (source.ts adapts main's host supervisor to it). A read that the host
// refuses or cannot answer rejects with an Error naming the command and the reason.
export interface LibrarySource {
  snapshot(): Promise<LibrarySnapshot>;
  entry(artifactId: string): Promise<LibraryEntryAnswer>;
  text(artifactId: string): Promise<{ revision: number; text: string }>;
  spaces(): Promise<Space[]>;
  streaming(): boolean; // the host's events reach main
  onStreaming(listener: () => void): () => void; // once per connection, when its events start reaching main
  onArtifactChanged(listener: (change: ArtifactsChanged) => void): () => void;
  onSpacesChanged(listener: () => void): () => void;
}

export const TEXT_IN_FLIGHT = 2;
export const ENTRY_READS_IN_FLIGHT = 8; // per drain of the waiting events

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class LibrarySync {
  private chain: Promise<void> = Promise.resolve();
  private reconcileQueued = false;
  private drainQueued = false;
  private readonly waiting = new Map<string, 'refresh' | 'delete'>(); // artifact events not yet taken by a drain
  private spacesWaiting = false;
  private readonly textQueue = new Set<string>();
  private readonly textOut = new Set<string>();
  private readonly textAgain = new Set<string>(); // wanted again while its read was out
  private offs: (() => void)[] = [];
  private stopped = false;

  constructor(
    private readonly store: LibraryStore,
    private readonly source: LibrarySource,
  ) {}

  start(): void {
    this.offs = [
      this.source.onStreaming(() => this.reconcile()),
      this.source.onArtifactChanged(({ artifactId, change }) => {
        this.waiting.set(artifactId, change === 'deleted' ? 'delete' : 'refresh');
        this.drain();
      }),
      this.source.onSpacesChanged(() => {
        this.spacesWaiting = true;
        this.drain();
      }),
    ];
    if (this.source.streaming()) this.reconcile();
  }

  stop(): void {
    this.stopped = true;
    for (const off of this.offs) off();
    this.offs = [];
    this.waiting.clear();
    this.textQueue.clear();
  }

  private enqueue(step: () => Promise<void>): void {
    this.chain = this.chain.then(step).catch((error: unknown) => console.warn('[library] a sync step failed:', reasonOf(error)));
  }

  private reconcile(): void {
    if (this.stopped || this.reconcileQueued) return;
    this.reconcileQueued = true;
    this.enqueue(async () => {
      this.reconcileQueued = false;
      if (this.stopped) return;
      let snapshot: LibrarySnapshot;
      try {
        snapshot = await this.source.snapshot();
      } catch (error) {
        console.warn('[library] the engine host’s snapshot could not be read; the library keeps its last known state:', reasonOf(error));
        return;
      }
      if (this.stopped) return;
      this.store.reconcile(snapshot);
      this.wantText(this.store.needingText());
    });
  }

  private drain(): void {
    if (this.stopped || this.drainQueued) return;
    this.drainQueued = true;
    this.enqueue(async () => {
      this.drainQueued = false;
      if (this.stopped) return;
      const events = [...this.waiting];
      this.waiting.clear();
      const spaces = this.spacesWaiting;
      this.spacesWaiting = false;
      const failures: string[] = [];
      for (const [artifactId, op] of events) if (op === 'delete') this.store.remove(artifactId);
      const refreshes = events.filter(([, op]) => op === 'refresh').map(([artifactId]) => artifactId);
      await Promise.all([
        inBatches(refreshes, ENTRY_READS_IN_FLIGHT, async (artifactId) => {
          try {
            const answer = await this.source.entry(artifactId);
            if (this.stopped) return;
            if (this.store.apply(artifactId, answer) === 'applied' && this.store.needsText(artifactId)) this.wantText([artifactId]);
          } catch (error) {
            failures.push(`${artifactId}: ${reasonOf(error)}`);
          }
        }),
        spaces ? this.refreshSpaces(failures) : undefined,
      ]);
      if (failures.length > 0) console.warn(`[library] ${failures.length} change(s) could not be read from the engine host; the next connection reconciles them:`, failures.join('; '));
    });
  }

  private async refreshSpaces(failures: string[]): Promise<void> {
    try {
      const spaces = await this.source.spaces();
      if (!this.stopped) this.store.replaceSpaces(spaces);
    } catch (error) {
      failures.push(`spaces: ${reasonOf(error)}`);
    }
  }

  private wantText(artifactIds: readonly string[]): void {
    for (const artifactId of artifactIds) {
      if (this.textOut.has(artifactId)) this.textAgain.add(artifactId);
      else this.textQueue.add(artifactId);
    }
    this.pumpText();
  }

  private pumpText(): void {
    while (!this.stopped && this.textOut.size < TEXT_IN_FLIGHT && this.textQueue.size > 0) {
      const [artifactId] = this.textQueue;
      this.textQueue.delete(artifactId);
      if (!this.source.streaming() || !this.store.needsText(artifactId)) continue;
      this.textOut.add(artifactId);
      void this.readText(artifactId);
    }
  }

  private async readText(artifactId: string): Promise<void> {
    try {
      const { revision, text } = await this.source.text(artifactId);
      // Read again only when this answer moved the indexed text on and the row's revision is still past it.
      if (!this.stopped && this.store.setText(artifactId, revision, text) && this.store.needsText(artifactId)) this.textAgain.add(artifactId);
    } catch (error) {
      if (!this.stopped) console.warn(`[library] the text of ${artifactId} could not be read from the engine host:`, reasonOf(error));
    } finally {
      this.textOut.delete(artifactId);
      if (this.textAgain.delete(artifactId)) this.textQueue.add(artifactId);
      this.pumpText();
    }
  }
}

// Runs `fn` over the items, at most `limit` at once.
async function inBatches<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
