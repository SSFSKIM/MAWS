// An agent session's own replica of a host doc (parent §4.2's replica rule; P3-0's S2
// `spikes/p3-store/s2/v14/host/agent-replica.ts`; the P3-A document's Decision Log 9). It is synced in-process over a
// Node MessageChannel by the same provider a renderer uses, so its updates reach the host doc as a connection whose actor
// is the session, and the host's ack is what a tool call waits for before it answers. Its `base` is the state and
// revision of the session's last read, which a publish diffs against (in memory only: after a host restart a publish
// without a fresh read is refused by the publish's first layer, M6). Its presence (Decision Log 23d) travels as the
// provider's awareness, which the host relays to every other replica.
import { PortProvider, type PortLike, type SaveState } from '@artifacts/provider/port';
import { newDoc, stateV2, transact, type Doc } from '@artifacts/yjs';

export interface Base {
  revision: number;
  state: Uint8Array; // V2
}

// What other replicas show of the agent while it works: its cursor and the blocks it is editing (B's shapes), its name
// and author colour.
export interface Presence {
  cursor?: unknown;
  editing?: { blocks: string[] };
  name: string;
  color: string;
}

export class AgentReplica {
  base: Base | null = null;
  lastUsed: number;
  private current: { doc: Doc; provider: PortProvider };
  private destroyed = false;

  // `connectPort` attaches a fresh connection to the host doc and answers the replica's end of it.
  constructor(
    private readonly connectPort: () => PortLike,
    now: number,
    private readonly log: (line: string) => void,
  ) {
    this.lastUsed = now;
    this.current = this.connectNew();
  }

  get doc(): Doc {
    return this.current.doc;
  }

  get provider(): PortProvider {
    return this.current.provider;
  }

  get closed(): boolean {
    return this.destroyed;
  }

  // The host closed this replica's connection (an eviction, a rejected frame): a new one re-syncs, and the provider's
  // step 2 re-sends whatever it held unacknowledged.
  reconnectIfClosed(): void {
    if (!this.destroyed && this.provider.state.phase === 'off') this.provider.connect(this.connectPort());
  }

  // One edit as one outbound update (Decision Log 25i): `fn` runs inside one transaction, so the provider ships a single
  // update when it returns. If `fn` throws, nothing it did is sent: the provider is detached before the transaction
  // ends, this replica's doc (holding the half-made edit) is discarded, and a fresh one re-syncs from the host. Call it
  // with nothing unsaved (a tool waits for `whenSaved` after each write): a discard also drops unacked earlier updates.
  edit(fn: (doc: Doc) => void): void {
    const { doc } = this.current;
    let failure: { error: unknown } | null = null;
    transact(doc, () => {
      try {
        fn(doc);
      } catch (error) {
        failure = { error };
        this.discard();
      }
    });
    if (failure) {
      doc.destroy();
      if (!this.destroyed) this.current = this.connectNew();
      throw (failure as { error: unknown }).error;
    }
  }

  // The agent's presence, or null to clear it (the turn ended, Decision Log 23d).
  setPresence(presence: Presence | null): void {
    if (this.destroyed) return;
    this.provider.awareness.setLocalState(presence);
  }

  // Resolves once the host's state has been applied on the current connection; rejects if the connection closes first.
  whenSynced(): Promise<void> {
    return this.until((state) => state.synced);
  }

  // Resolves with the live revision once every local update is durable in the host's log (what a write answers after);
  // rejects if the connection closes first.
  whenSaved(): Promise<number> {
    return this.until((state) => state.phase === 'live' && state.unsaved === 0).then(() => this.provider.state.revision);
  }

  // The session's read (Decision Log 9): the state it saw and the revision the host last acknowledged.
  captureBase(): Base {
    this.base = { revision: this.provider.state.revision, state: stateV2(this.doc) };
    return this.base;
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.provider.destroy();
  }

  private connectNew(): { doc: Doc; provider: PortProvider } {
    const doc = newDoc();
    const provider = new PortProvider(doc, { log: this.log });
    provider.connect(this.connectPort());
    return { doc, provider };
  }

  private discard(): void {
    this.current.provider.destroy();
    this.log('an edit threw; its replica was discarded and is re-synced from the host');
  }

  private until(test: (state: SaveState) => boolean): Promise<void> {
    const provider = this.provider;
    return new Promise((resolve, reject) => {
      const check = (state: SaveState): boolean => {
        if (test(state)) resolve();
        else if (state.phase === 'off') reject(new Error('the replica’s connection to the host closed'));
        else return false;
        return true;
      };
      if (check(provider.state)) return;
      const off = provider.subscribe((state) => {
        if (check(state)) off();
      });
    });
  }
}
