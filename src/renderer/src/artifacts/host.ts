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
import type { ArtifactDocOption, ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { PortProvider, type PortLike, type Restored, type SaveState } from '@artifacts/provider/port';
import { newDoc, newSuggestionDoc, type Doc } from '@artifacts/yjs';
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import type { ArtifactProvisional } from '@shared/artifacts/provisional'; // P4-A2
import { artifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandName, CommandOutput, MawsBridge } from '@shared/ipc/schema';
import { artifactRefusalOf } from '@shared/ipc/schema/artifacts';
import { ArtifactCommandError } from './command-error';
import { createConnectorHost } from './connectors';

export const RECONNECT_BACKOFF_MS = [250, 1_000, 3_000] as const;
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
  ipc: Pick<MawsBridge, 'invoke' | 'on'>;
  ports: DocPorts;
  log?: (line: string) => void;
}

const HUMAN: Actor = { kind: 'human' };

export function createArtifactHost({ ipc, ports, log = (line) => console.warn(`[artifacts] ${line}`) }: ArtifactHostDeps): ArtifactHost {
  const replicas = new Set<Replica>();
  let hostRevision = -1; // the engine host's state revision last heard; a consumer keeps the higher (HostState)
  let hostIsReady = false; // what that state said

  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const result = await ipc.invoke(name, input);
    if (!result.ok) throw new ArtifactCommandError(result.error);
    return result.value;
  };

  // E3: the window's dataset holds the host's restart takes away (holdDatasets below)
  let resyncs = 0;
  const lostOnResync = new Set<() => void>();
  ipc.on('artifacts.resync', () => {
    resyncs += 1;
    for (const invalidate of [...lostOnResync]) invalidate();
    lostOnResync.clear();
  });

  ipc.on('engine.hostState', (state) => {
    if (state.revision <= hostRevision) return;
    hostRevision = state.revision;
    hostIsReady = state.state === 'ready';
    for (const replica of replicas) {
      if (state.state === 'ready') replica.hostReady();
      else replica.hostGone();
    }
  });

  class Replica implements DocumentHandle {
    readonly doc: Doc;
    readonly provider: PortProvider;
    private readOnly = false;
    private closed = false;
    private connecting = false; // an open is in flight
    private generation = 0; // bumped when the host leaves `ready`: an open begun before belongs to a dead host
    private attempt = 0; // reconnects since the last live connection
    private timer: ReturnType<typeof setTimeout> | null = null;
    private waitingForHost = false; // the backoff ran out: the next `ready` re-opens
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
    state(): DocumentState {
      return { ...this.provider.state, readOnly: this.readOnly };
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
      replicas.delete(this);
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
        const { channel } = await call('artifacts.open', { artifactId: this.artifactId, ...(this.which && { doc: this.which }) });
        if (stale()) return; // a port that still comes is closed by the window's route when nobody takes it
        const port = await ports.take(channel);
        if (stale()) return port.close();
        this.provider.connect(port);
        void this.readStatus();
      } catch (error) {
        const refusal = error instanceof ArtifactCommandError ? artifactRefusalOf(error.error) : null;
        if (refusal && (refusal.reason === 'notFound' || refusal.reason === 'invalid')) return this.fail(error);
        log(`could not open ${this.artifactId}: ${error instanceof Error ? error.message : String(error)}`);
        if (!stale()) this.retry();
      } finally {
        this.connecting = false;
        if (!this.closed && generation !== this.generation) this.resume();
      }
    }

    hostReady(): void {
      if (this.closed || this.connecting || this.provider.state.phase !== 'off') return;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.attempt = 0;
      void this.connect();
    }

    hostGone(): void {
      this.generation += 1;
      if (this.provider.state.phase !== 'off') this.provider.disconnect(); // the change listener schedules the reopen
    }

    // An open the host's loss interrupted has settled: open afresh on the host that is ready now, else at its next ready
    // (a `ready` heard while the attempt was in flight found it connecting and did nothing).
    private resume(): void {
      if (hostIsReady) this.hostReady();
      else this.waitingForHost = true;
    }

    private changed(state: SaveState): void {
      if (state.synced) {
        this.attempt = 0;
        this.settleFirst?.resolve();
        this.settleFirst = null;
      }
      if (state.phase === 'off' && !this.connecting) this.retry();
      const full = { ...state, readOnly: this.readOnly };
      for (const listener of [...this.listeners]) listener(full);
    }

    private retry(): void {
      if (this.closed || this.timer !== null || this.waitingForHost) return;
      const wait = RECONNECT_BACKOFF_MS[this.attempt];
      if (wait === undefined) {
        this.waitingForHost = true;
        return;
      }
      this.attempt += 1;
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.connect();
      }, wait);
    }

    private fail(error: unknown): void {
      log(`${this.artifactId} cannot be opened: ${error instanceof Error ? error.message : String(error)}`);
      this.settleFirst?.reject(error);
      this.settleFirst = null;
      this.close();
    }

    private async readStatus(): Promise<void> {
      try {
        const { status } = await call('artifacts.status', undefined);
        const readOnly = status === 'readOnly';
        if (readOnly === this.readOnly || this.closed) return;
        this.readOnly = readOnly;
        this.changed(this.provider.state);
      } catch (error) {
        log(`the store's status is unknown: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return {
    async open(artifactId, options) {
      const replica = new Replica(artifactId, options?.doc);
      replicas.add(replica);
      void replica.connect();
      await replica.first;
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
      const asked = resyncs;
      const { holdId } = await call('artifacts.holdDatasets', { artifactId, refs: [...refs] });
      let invalidate!: () => void;
      const invalidated = new Promise<void>((resolve) => (invalidate = resolve));
      if (resyncs !== asked) invalidate();
      else lostOnResync.add(invalidate);
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
