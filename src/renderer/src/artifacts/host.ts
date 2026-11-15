// The renderer's ArtifactHost (X24, `src/artifacts/host.ts`; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4 and
// Decision Log 13): the one adapter an editor reaches the store through. `open` makes a replica (a Y.Doc and the port
// provider) and connects it over the port main posts for `artifacts.open`; the other methods are the store's commands.
//
// The one reopen path (M4's decision, shared with M5). A replica whose port goes — the host exited or restarted, a
// detached host reset the channel, or the host evicted the document and closed it — is re-opened by itself: a fresh
// `artifacts.open` after 250 ms, 1 s and 3 s, then at the engine host's next `ready`; the same provider reconnects, so
// its step 2 re-sends exactly what the host lacks (unacked updates moved to carried at the disconnect). A dead utility
// host's port may never report its close, so the host leaving `ready` (`engine.hostState`) drops every live port too,
// and invalidates an open in flight: a port it brings later belongs to the dead host and is closed, and the replica
// opens afresh once that attempt settles (at once if the host is ready again, else at its next `ready`).
// A refusal that names the document (not found, not a document) ends the attempts: the first open rejects with it.
//
// What an editor shows (P3-G's header maps it): the provider's SaveState, and `readOnly` when the store is (a newer app
// wrote it), asked at each connect. A renderer replica throttles its cursor awareness to one frame per 50 ms.
//
// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5): one host serves every machine's artifacts,
// each command going to its artifact's machine (the client asks the page's table, ./machines.ts). A dataset hold is its
// artifact's machine's, invalidated by that machine's `artifacts.resync` alone (another machine's feed says it at each of
// its openings).
//
// P5 O7 M5b (M5's "The `document` stream", its "On this Mac" half): a document on another machine opens the same way,
// its port bridged by main to a `document` stream (src/main/artifacts/remote-open.ts), which closes the port whenever
// the stream ends; the provider is unchanged. Its liveness is its machine's link as `remote.session` says it, the one
// reading of that link here, never this Mac's `engine.hostState`: the link leaving `up` drops the port (a stream lost
// with its channel may close it late), and the backoff waits for it; its `up` reopens. While the link isn't known down
// the backoff keeps its last step, since no host state will say when to try again. An open main answers `readOnly` (the
// member holds `view` alone) makes the replica read-only until an open that doesn't; the editor reads it as it reads a
// read-only store. A refusal for good (not found or not viewable, not a document, a malformed open) ends the attempts:
// the first open rejects with it, and a replica that had synced says it as `refused`, which the editor shows.
//
// UX wave U10b (M5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.5): a replica that had synced, of an
// artifact the host says an agent deleted and Undo can bring back (`artifacts.get`'s `deleted.undoable`), waits for the
// restore instead of ending. It learns it at the artifact's `deleted` announcement, and again when its reopen is refused
// `notFound` (the host's fence closes a connection at its next content frame, and main refuses a deleted artifact's
// open). While it waits it keeps what the host never acknowledged and reads as read-only (the state an editor has for a
// reader who may only view, so it takes no edit under the deletion's notice); at its artifact's `created` (the
// undelete's announcement, from whichever machine) it is writable again and opens again if its port went, sending what
// it kept in the reconnect's first exchange.
// Fix wave 1 (review items 2 and 3): each read of that standing takes a ticket, which every later read and every
// `created` takes over, so an answer a change overtook decides nothing (a reopen it held is tried again). A read that
// fails is no answer: the replica keeps what it holds, read-only, and asks again on the reconnect's backoff (then at the
// host's next `ready` or its machine's link `up`), until the host answers, the artifact is restored, or a reopen opens.
// ./deleted-replicas.ts tells the notice whether a waiting replica holds such an edit.
import type { ArtifactDocOption, ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { PortProvider, type PortLike, type Restored, type SaveState } from '@artifacts/provider/port';
import { newDoc, newSuggestionDoc, type Doc } from '@artifacts/yjs';
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import type { ArtifactProvisional } from '@shared/artifacts/provisional'; // P4-A2
import { artifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandName, CommandOutput, InvokeRest, MawsBridge } from '@shared/ipc/schema';
import { artifactRefusalOf } from '@shared/ipc/schema/artifacts';
import type { MachineRef } from '@shared/machine/ref';
import { ArtifactCommandError } from './command-error';
import { createConnectorHost } from './connectors';
import { noteDeletedReplica } from './deleted-replicas'; // UX wave U10b
import { artifactMachineOf } from './machines';

export const RECONNECT_BACKOFF_MS = [250, 1_000, 3_000] as const;
// Fix wave 2: the store's refusals of a standing read that say the artifact is not there for this window (`notFound`
// is also main's word for one the member may not view; `invalid`, an id or kind it cannot name). The others (`unavailable`,
// `storeTooNew`, and those no read gives: `tooLarge`, `handleTaken`, `designSystemInUse`, the two exports') are no answer.
const ARTIFACT_GONE: ReadonlySet<string> = new Set(['notFound', 'invalid']);
/**
 * P5 O7 M5b review fix 1: a connection whose first frame (the host's step 1, sent at attach) hasn't come by then is
 * dropped into the reopen path: its port closed before the replica listened (a close said early is never said again).
 */
export const FIRST_FRAME_MS = 10_000;
export const AWARENESS_THROTTLE_MS = 50; // Decision Log 31c (parent 37's advisory)

// A command the store refused (P3-H H4: defined in ./command-error.ts, shared with the connector family).
export { ArtifactCommandError };

// The ports the preload posts to the page, awaited by channel. A port can arrive before or after the open's answer.
// The window's own are `windowDocPorts` (window-ports.ts); this module touches no DOM type, so a Node test can drive the
// ArtifactHost over another route (P3-A M5's detached-channel test).
export interface DocPorts {
  take(channel: number, timeoutMs?: number): Promise<PortLike>;
}

export interface ArtifactHostDeps {
  ipc: Pick<MawsBridge, 'invoke' | 'on' | 'localMachine'>;
  ports: DocPorts;
  log?: (line: string) => void;
}

const HUMAN: Actor = { kind: 'human' };

export function createArtifactHost({ ipc, ports, log = (line) => console.warn(`[artifacts] ${line}`) }: ArtifactHostDeps): ArtifactHost {
  const replicas = new Set<Replica>();
  let hostRevision = -1; // the engine host's state revision last heard; a consumer keeps the higher (HostState)
  let hostIsReady = false; // what that state said
  // P5 O7 M5b: each other machine's link, up or not, as its latest `remote.session` said it (absent: not heard yet)
  const linkUp = new Map<MachineRef, boolean>();

  const call = async <N extends CommandName>(name: N, input: CommandInput<N>, ...opts: InvokeRest<N>): Promise<CommandOutput<N>> => {
    const result = await ipc.invoke(name, input, ...opts);
    if (!result.ok) throw new ArtifactCommandError(result.error);
    return result.value;
  };

  // E3: the window's dataset holds the host's restart takes away (holdDatasets below); P5 O7 M5a: per machine
  const resyncs = new Map<MachineRef, number>();
  const lostOnResync = new Map<() => void, MachineRef>(); // each hold's invalidation, by its artifact's machine
  const machineOf = (artifactId: string): MachineRef => artifactMachineOf(artifactId) ?? ipc.localMachine;
  ipc.on('artifacts.resync', (_resync, from) => {
    resyncs.set(from.machine, (resyncs.get(from.machine) ?? 0) + 1);
    for (const [invalidate, machine] of [...lostOnResync]) {
      if (machine !== from.machine) continue;
      lostOnResync.delete(invalidate);
      invalidate();
    }
  });

  // P5 O6: the documents are this machine's (O7 spans artifacts across machines), and `engine.hostState` crosses machine
  // links, so only this machine's engine host speaks for their ports, and only its revisions count.
  ipc.on('engine.hostState', (state, from) => {
    if (from.machine !== ipc.localMachine) return;
    if (state.revision <= hostRevision) return;
    hostRevision = state.revision;
    hostIsReady = state.state === 'ready';
    for (const replica of replicas) {
      if (replica.machine() !== null) continue; // P5 O7 M5b: another machine's document follows its link
      if (state.state === 'ready') replica.hostReady();
      else replica.hostGone();
    }
  });

  // P5 O7 M5b: another machine's documents live and die with its link (any of its sessions' `remote.session` says it).
  ipc.on('remote.session', (state, from) => {
    const up = state.link.state === 'up';
    if (linkUp.get(from.machine) === up) return;
    linkUp.set(from.machine, up);
    for (const replica of replicas) {
      if (replica.machine() !== from.machine) continue;
      if (up) replica.hostReady();
      else replica.hostGone();
    }
  });

  // UX wave U10b (M5): a delete announces `deleted`, which a replica of the artifact asks the host about; an undelete
  // announces `created`, which ends a replica's wait.
  ipc.on('artifacts.changed', (change) => {
    if (change.change !== 'created' && change.change !== 'deleted') return;
    for (const replica of replicas) {
      if (replica.artifactId !== change.artifactId) continue;
      if (change.change === 'created') replica.restored();
      else void replica.deleted();
    }
  });

  class Replica implements DocumentHandle {
    readonly doc: Doc;
    readonly provider: PortProvider;
    private storeReadOnly = false; // the store is (a newer app wrote it)
    private openedReadOnly = false; // P5 O7 M5b: main opened the port `view` (another machine's, held at `view` alone)
    private refusal: string | null = null; // P5 O7 M5b: a refusal for good after a sync, said to the editor
    private closed = false;
    private connecting = false; // an open is in flight
    private generation = 0; // bumped when the host leaves `ready`: an open begun before belongs to a dead host
    private attempt = 0; // reconnects since the last live connection
    private timer: ReturnType<typeof setTimeout> | null = null;
    private firstFrame: ReturnType<typeof setTimeout> | null = null; // review fix 1: the connection's first frame awaited
    private waitingForHost = false; // the backoff ran out: the next `ready` re-opens
    private deletedByAgent = false; // UX wave U10b: an agent deleted the artifact; waits for its restore, read-only
    private standingUnknown = false; // fix wave 1: refused or deleted, and the host's word on why not read; read-only meanwhile
    private standingTicket = 0; // fix wave 1: the latest read of the standing, or the latest `created`; an older answer is stale
    private synced = false; // UX wave U10b: the last state's sync, so a wait ends at a new sync and not at the one it began in
    private readonly listeners = new Set<(state: DocumentState) => void>();
    private settleFirst: { resolve: () => void; reject: (error: unknown) => void } | null = null;
    readonly first: Promise<void>;

    constructor(
      readonly artifactId: string,
      private readonly which: ArtifactDocOption['doc'],
    ) {
      this.doc = which === 'suggestions' ? newSuggestionDoc() : newDoc();
      this.provider = new PortProvider(this.doc, { log, awarenessThrottleMs: AWARENESS_THROTTLE_MS });
      this.first = new Promise((resolve, reject) => (this.settleFirst = { resolve, reject }));
      this.provider.subscribe((state) => this.changed(state));
    }

    get awareness() {
      return this.provider.awareness;
    }
    /** P5 O7 M5b: the machine the document is on when it is another's (the page's table), else null. */
    machine(): MachineRef | null {
      return artifactMachineOf(this.artifactId);
    }
    /** Whether what this replica's port stands on is there: this Mac's engine host, or another machine's link. */
    private live(): boolean {
      const machine = this.machine();
      return machine === null ? hostIsReady : linkUp.get(machine) !== false;
    }
    private get readOnly(): boolean {
      return this.storeReadOnly || this.openedReadOnly || this.deletedByAgent || this.standingUnknown;
    }
    private full(state: SaveState): DocumentState {
      return { ...state, readOnly: this.readOnly, ...(this.refusal !== null && { refused: this.refusal }) };
    }
    state(): DocumentState {
      return this.full(this.provider.state);
    }
    subscribe(listener: (state: DocumentState) => void): () => void {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    onRestored(listener: (restored: Restored) => void): () => void {
      return this.provider.onRestored(listener);
    }
    onProvisional(listener: (frame: ArtifactProvisional) => void): () => void {
      return this.provider.onProvisional(listener); // P4-A2 (X35)
    }
    holdRemote(on: boolean): void {
      this.provider.holdRemote(on);
    }
    close(): void {
      if (this.closed) return;
      this.closed = true;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.stopFirstFrame();
      replicas.delete(this);
      noteDeletedReplica(this, this.artifactId, null); // UX wave U10b
      this.provider.destroy();
      this.listeners.clear();
      this.settleFirst?.reject(new Error('closed before it synced'));
      this.settleFirst = null;
    }

    async connect(): Promise<void> {
      if (this.closed || this.connecting) return;
      this.connecting = true;
      this.waitingForHost = false;
      const generation = this.generation;
      const stale = () => this.closed || generation !== this.generation;
      try {
        const { channel, readOnly } = await call('artifacts.open', { artifactId: this.artifactId, ...(this.which && { doc: this.which }) });
        if (stale()) return; // a port that still comes is closed by the window's route when nobody takes it
        const port = await ports.take(channel);
        if (stale()) return port.close();
        this.openedReadOnly = readOnly === true; // P5 O7 M5b: before the connect, so its first state says it
        this.provider.connect(port);
        this.awaitFirstFrame();
        if (this.machine() === null) void this.readStatus(); // this Mac's store; another machine's read-only is its open's
      } catch (error) {
        const refusal = error instanceof ArtifactCommandError ? artifactRefusalOf(error.error) : null;
        // UX wave U10b: a synced replica's reopen refused notFound asks the host why: an agent's delete waits for its
        // restore; an artifact live again (restored while the open was refused) is opened again. Fix wave 1: an answer
        // a later change overtook opens again, one the host could not give waits read-only and asks again, and nothing
        // ends the replica once the host it asked has gone (the reopen resumes on the next)
        if (refusal?.reason === 'notFound' && this.settleFirst === null) {
          const { now, current } = await this.standing();
          if (stale()) return;
          if (!current || now === 'live') return this.retry();
          if (now === 'deletedByAgent') return this.waitForRestore();
          if (now === 'unknown') return this.awaitStanding();
          return this.fail(error);
        }
        if (refusal && (refusal.reason === 'notFound' || refusal.reason === 'invalid')) return this.fail(error);
        log(`could not open ${this.artifactId}: ${error instanceof Error ? error.message : String(error)}`);
        if (!stale()) this.retry();
      } finally {
        this.connecting = false;
        if (!this.closed && generation !== this.generation) this.resume();
      }
    }

    // UX wave U10b (M5): what the host says of the artifact: live, deleted by an agent with Undo able to bring it back,
    // gone (deleted for good, not there, or refused to this window), or unknown (the host did not answer). Fix wave 1: `current` is false when a
    // later read or a `created` came while it was asked.
    private async standing(): Promise<{ now: 'live' | 'deletedByAgent' | 'gone' | 'unknown'; current: boolean }> {
      const ticket = ++this.standingTicket;
      let now: 'live' | 'deletedByAgent' | 'gone' | 'unknown';
      try {
        const answer = await call('artifacts.get', { artifactId: this.artifactId });
        now = answer.artifact ? 'live' : answer.deleted?.undoable === true ? 'deletedByAgent' : 'gone';
      } catch (error) {
        // a refusal of the read itself that the artifact is not there for this window (not found, not viewable, not one
        // it can name) is the host's answer; anything else (its store not open, too new, a host not answering) is none
        const refusal = error instanceof ArtifactCommandError ? artifactRefusalOf(error.error) : null;
        now = refusal !== null && ARTIFACT_GONE.has(refusal.reason) ? 'gone' : 'unknown';
        if (now === 'unknown') log(`${this.artifactId}: the host did not say why it was refused: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { now, current: !this.closed && ticket === this.standingTicket };
    }

    // Its artifact was deleted: a replica that had synced asks the host whether an agent's delete Undo can take back.
    // Fix wave 1: also each step of the backoff while that is unknown and its port stands.
    async deleted(): Promise<void> {
      if (this.closed || this.deletedByAgent || this.settleFirst !== null) return;
      const { now, current } = await this.standing();
      if (!current) return;
      if (now === 'deletedByAgent') this.waitForRestore();
      else if (now === 'unknown') this.awaitStanding();
      else this.knownAgain(); // live again, or deleted for good: the port's own course decides
    }

    private waitForRestore(): void {
      if (this.deletedByAgent) return;
      log(`${this.artifactId} was deleted by an agent; waiting for it to be restored`);
      this.deletedByAgent = true;
      this.standingUnknown = false;
      this.stopTimer();
      this.changed(this.provider.state);
    }

    // Fix wave 1: the host's word not read: read-only with what it holds, asked again on the backoff.
    private awaitStanding(): void {
      if (!this.standingUnknown) {
        this.standingUnknown = true;
        this.changed(this.provider.state);
      }
      this.retry();
    }

    private knownAgain(): void {
      if (!this.standingUnknown) return;
      this.standingUnknown = false;
      this.stopTimer();
      this.changed(this.provider.state);
    }

    private stopTimer(): void {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }

    // Its artifact was restored (`created`): open again, out of the read-only wait. Fix wave 1: a read in flight is stale.
    restored(): void {
      this.standingTicket += 1;
      if ((!this.deletedByAgent && !this.standingUnknown) || this.closed) return;
      this.deletedByAgent = false;
      this.standingUnknown = false;
      noteDeletedReplica(this, this.artifactId, null);
      this.stopTimer();
      this.attempt = 0;
      this.waitingForHost = false;
      const full = this.state(); // writable again in the editor's eyes; the open below sends what was kept
      for (const listener of [...this.listeners]) listener(full);
      if (!this.connecting && this.provider.state.phase === 'off') void this.connect();
    }

    hostReady(): void {
      if (this.closed || this.connecting) return;
      if (this.provider.state.phase !== 'off') {
        if (!this.standingUnknown || this.timer !== null) return;
        this.attempt = 0; // fix wave 1: ask the host that is back, its backoff afresh
        this.waitingForHost = false;
        void this.deleted();
        return;
      }
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.attempt = 0;
      void this.connect();
    }

    hostGone(): void {
      this.generation += 1;
      this.standingTicket += 1; // fix wave 2: what the host that went said of the artifact decides nothing
      if (this.provider.state.phase !== 'off') this.provider.disconnect(); // the change listener schedules the reopen
    }

    // An open the host's loss interrupted has settled: open afresh on the host that is ready now, else at its next ready
    // (a `ready` heard while the attempt was in flight found it connecting and did nothing).
    private resume(): void {
      if (this.live()) this.hostReady();
      else this.waitingForHost = true;
    }

    private awaitFirstFrame(): void {
      this.stopFirstFrame();
      if (this.provider.state.phase !== 'handshake') return;
      this.firstFrame = setTimeout(() => {
        this.firstFrame = null;
        if (this.closed || this.provider.state.phase !== 'handshake') return;
        log(`${this.artifactId}: no frame on its port within ${FIRST_FRAME_MS / 1000} s; opening it again`);
        this.provider.disconnect(); // the change listener schedules the reopen
      }, FIRST_FRAME_MS);
    }

    private stopFirstFrame(): void {
      if (this.firstFrame !== null) clearTimeout(this.firstFrame);
      this.firstFrame = null;
    }

    private changed(state: SaveState): void {
      // UX wave U10b: a waiting replica says what it keeps; one the host synced anew (a restore it did not hear) is done waiting
      const wasSynced = this.synced;
      if ((this.deletedByAgent || this.standingUnknown) && state.synced && !wasSynced) this.deletedByAgent = this.standingUnknown = false;
      this.synced = state.synced;
      noteDeletedReplica(this, this.artifactId, this.deletedByAgent || this.standingUnknown ? state.unsaved : null);
      if (state.phase !== 'handshake') this.stopFirstFrame();
      if (state.synced) {
        if (!wasSynced) this.standingTicket += 1; // fix wave 2: a read asked before this sync is older than it
        this.attempt = 0;
        this.settleFirst?.resolve();
        this.settleFirst = null;
      }
      if (state.phase === 'off' && !this.connecting) this.retry();
      const full = this.full(state);
      for (const listener of [...this.listeners]) listener(full);
    }

    private retry(): void {
      if (this.closed || this.timer !== null || this.waitingForHost || this.deletedByAgent) return;
      // P5 O7 M5b: another machine's document waits for its link's `up` while the link is down, and while it isn't known
      // down keeps the backoff's last step (no host state will say when)
      const remote = this.machine() !== null;
      if (remote && !this.live()) {
        this.waitingForHost = true;
        return;
      }
      const wait = RECONNECT_BACKOFF_MS[this.attempt] ?? (remote ? RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1] : undefined);
      if (wait === undefined) {
        this.waitingForHost = true;
        return;
      }
      this.attempt += 1;
      this.timer = setTimeout(() => {
        this.timer = null;
        // fix wave 1: a standing not read while the port stands is asked again; a port gone is reopened (which asks)
        void (this.provider.state.phase !== 'off' && this.standingUnknown ? this.deleted() : this.connect());
      }, wait);
    }

    private fail(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      log(`${this.artifactId} cannot be opened: ${message}`);
      if (this.settleFirst !== null) {
        this.settleFirst.reject(error);
        this.settleFirst = null;
      } else {
        // P5 O7 M5b: a replica the editor holds is told why it ends (a member who lost `view`, a document gone)
        this.refusal = message;
        const full = this.state();
        for (const listener of [...this.listeners]) listener(full);
      }
      this.close();
    }

    private async readStatus(): Promise<void> {
      try {
        const { status } = await call('artifacts.status', undefined);
        const readOnly = status === 'readOnly';
        if (readOnly === this.storeReadOnly || this.closed) return;
        this.storeReadOnly = readOnly;
        this.changed(this.provider.state);
      } catch (error) {
        log(`the store's status is unknown: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return {
    async open(artifactId, options) {
      const signal = options?.signal;
      if (signal?.aborted) throw new Error(`the open of ${artifactId} was cancelled`);
      const replica = new Replica(artifactId, options?.doc);
      replicas.add(replica);
      // review fix 2: an owner gone before the first sync ends the attempts (`close` rejects the open)
      const cancel = () => replica.close();
      signal?.addEventListener('abort', cancel, { once: true });
      void replica.connect();
      try {
        await replica.first;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
      return replica;
    },
    assetUrl: (artifactId, ref, revision) => artifactUrl(artifactId, revision ?? 'live', ref), // P3-D: `revision` (Decision Log 59)
    // Main's export service (M7, X31): the file's path under the store's directory. A format the IPC does not know, or a
    // kind and format no exporter serves, rejects (`exportUnavailable` for the latter).
    export: async (artifactId, format, version, options) => {
      const { path } = await call('artifacts.export', {
        artifactId, format: format as CommandInput<'artifacts.export'>['format'], ...(version !== undefined && { versionId: version }), ...(options?.pageSize !== undefined && { pageSize: options.pageSize }), ...(options?.fonts !== undefined && { fonts: options.fonts }) /* P3-C */,
        ...(options?.board !== undefined && { board: options.board }), ...(options?.boards !== undefined && { boards: options.boards }), ...(options?.scale !== undefined && { scale: options.scale }), // P3-E (E1 M5)
      });
      return { path };
    },
    versionState: async (artifactId, version) => (await call('artifacts.versionState', typeof version === 'number' ? { artifactId, versionId: version } : { artifactId, seq: version.seq })).bytes,
    attributions: async (artifactId, fromSeq, toSeq, options) => (await call('artifacts.attributions', { artifactId, fromSeq, toSeq, ...(options?.doc && { doc: options.doc }) })).bytes,
    acceptSuggestion: (artifactId, ranges) => call('artifacts.acceptSuggestion', { artifactId, ranges }),
    rejectSuggestion: (artifactId, ranges) => call('artifacts.rejectSuggestion', { artifactId, ranges }),
    uploadAsset: (artifactId, bytes, { name, mime }) => call('artifacts.uploadAsset', { artifactId, bytes, name, mime }),
    copyAsset: (from, ref, to) => call('artifacts.copyAsset', { from, ref, to }), // P3-C (Decision Log 25)
    // P3-E (E2 M2): a page of a dataset snapshot, read by the host
    readDataset: (artifactId, ref, { format, offset, limit }) => call('artifacts.readDataset', { artifactId, ref, format, ...(offset !== undefined && { offset }), ...(limit !== undefined && { limit }) }),
    // P3-E (E2 M3): the source sheet's Download, main's Save dialog over the artifact's own asset
    downloadAsset: (artifactId, ref, options) => call('artifacts.downloadAsset', { artifactId, ref, ...(options?.name !== undefined && { name: options.name }) }),
    // E3: main's window-bound hold over snapshot bytes, its release sent once. `invalidated`: the host's hold behind it is
    // gone (main's `artifacts.resync`, each time the host's connection streams again); a resync while it was being asked
    // for invalidates it as soon as it is answered (the generation is read before asking), and a release stops listening.
    holdDatasets: async (artifactId, refs) => {
      const machine = machineOf(artifactId);
      const asked = resyncs.get(machine) ?? 0;
      const { holdId } = await call('artifacts.holdDatasets', { artifactId, refs: [...refs] });
      let invalidate!: () => void;
      const invalidated = new Promise<void>((resolve) => (invalidate = resolve));
      if ((resyncs.get(machine) ?? 0) !== asked) invalidate();
      else lostOnResync.set(invalidate, machine);
      let released = false;
      return {
        invalidated,
        release: () => {
          if (released) return;
          released = true;
          lostOnResync.delete(invalidate);
          call('artifacts.releaseDatasets', { holdId }).catch((error: unknown) => log(`a dataset hold was not released: ${error instanceof Error ? error.message : String(error)}`));
        },
      };
    },
    identity: () => ({ actor: HUMAN, ...actorDisplay(HUMAN) }),
    // P3-F (F1): an editor's link, through main's one scheme-checked opener (src/main/open-external.ts); a URL it refuses
    // is logged here, never thrown into the editor
    openExternal: (url) => void call('layout.openExternal', { url }).catch((error: unknown) => log(`a link was not opened: ${error instanceof Error ? error.message : String(error)}`)),
    ...createConnectorHost(ipc), // P3-H H4: a page's connector surface and the owner's grants
  };
}
