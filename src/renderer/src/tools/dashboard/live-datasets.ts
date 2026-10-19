// E3 M3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3, R4; the M3 entry): a dashboard tab's live
// datasets, the editor's `LiveDatasets` over H's connector family (`ArtifactHost.openConnectors` and the owner's grant
// commands; X16's Start). The tab owns it, so it outlives a body unmounted by an inactive tab and ends with the tab.
//
// - It follows the live document (never a displayed version): every query dataset's source, read afresh. One surface
//   for the tab, opened at its first showing that has a query (a tab never shown opens nothing, reads no grant), the
//   queries' tools declared before any call. One H watch per scheduled query, its request the live source's server,
//   tool and arguments, its interval the schedule, its sink the dataset with no base (each refresh takes the host's).
//   A watch is recreated only when the query's identity or schedule changes, never when a refresh writes the
//   snapshot, the state or the metadata (a new watch refreshes at once, so that would loop); it ends when the dataset
//   goes or stops being a scheduled query. A manual query is called only by the owner's Refresh, while shown.
// - The trusted visibility (`setShown`: the body on screen, its window's document visible, no history preview) shows
//   or hides the surface: H runs no watch and aborts its calls while hidden, and a due one catches up once when shown.
//   The tab's end closes the surface, which ends its watches and calls; nothing answered after is heard.
// - What the bridge answers is a transient pause per query (no live session, permission, the tool may write, the
//   watch limit, a refresh that failed before the host): the host's published dataset, its typed failure (validation,
//   toolError, timeout: the error state it recorded) or a stale completion end it, and the descriptor stays the data.
//   The surface's own hide or close is no pause.
// - The owner's grants are read from H (at the first showing, at each committed change announced for the artifact,
//   after each gesture). Grant asks for a read grant (H checks the tool is read-only); Revoke stops its calls at once.
//   Start, the owner's alone, starts or resumes the artifact's session through `startArtifactSession`'s policy and its
//   empty-message guard; once ready, the queries paused for want of a session refresh. Nothing here starts a session
//   from a mount, a pause or a timer.
// - The stale label's clock: while shown, one timer at the nearest stale boundary of the live queries tells the views
//   to relabel; it calls nothing.
// - E3 panel wave (Decision Log 16 and 17): a watch shown again, or whose start answers after a hide and a showing, is
//   recovered by H's non-forcing probe (whether its handle lives), never by a forced refresh, so the catch-up H runs on
//   showing is never followed by a second; a watch H ends (its outcome invalid) is unwatched before it is forgotten, so
//   its listener goes too; a lease whose cumulative declarations reach H's cap while some name no current query is
//   recycled; each query's status carries its live descriptor's committed error in its source label's words.
import type { ArtifactHost, ConnectorSurface } from '@artifacts/host';
import { listDatasets, type DatasetState, type QuerySource } from '@artifacts/dashboard/datasets';
import { queryIdentity } from '@artifacts/dashboard/query'; // E3 M3 fix: the shared identity
import { datasetErrorOf } from '@artifacts/dashboard/states'; // E3 panel
import { type LiveDatasets, type LivePause, type LiveQueryStatus, type LiveSnapshot, type LiveStart } from '@artifacts/dashboard/editor/live';
import { onUpdate, type Doc } from '@artifacts/yjs';
import { CONNECTOR_DECLARE_LIMIT, connectorToolKey, type ConnectorCallOutcome, type ConnectorGrant, type ConnectorGrantOutcome, type ConnectorToolRef } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactSessionEnd, ArtifactSessionStart } from '../../artifacts/session-context';

export interface LiveDatasetsDeps {
  artifactId: string;
  host: Pick<ArtifactHost, 'openConnectors' | 'connectorGrants' | 'grantConnectorTool' | 'revokeConnectorTool'>;
  /** Committed grant changes announced for an artifact (`connectors.grantChanged`); answers the unsubscribe. */
  onGrantChanged(listener: (artifactId: string) => void): () => void;
  /** The owner's Start for the artifact's session context; `previous`, the session an earlier Start named. */
  startSession(previous: AppSessionId | null): Promise<ArtifactSessionStart>;
  openSession?(appSessionId: string): void;
  now?(): number;
  log?(line: string): void;
}

interface Query {
  id: string;
  source: QuerySource;
  state: DatasetState; // E3 panel: the live descriptor's committed state (its error the sheet says)
  identity: string;
  settings: string; // the identity and the schedule: what a watch is made of
  watch: { token: object; id: string | null } | null;
  pause: LivePause | null;
  busy: LiveQueryStatus['busy'];
  heardAt?: number; // E3 M3 fix: when its watch's last refresh was heard
  probe?: ReturnType<typeof setTimeout>; // E3 M3 fix: asks its handle at its due time, while shown
  probes: number; // E3 M3 residual: advanced whenever a pending or in-flight ask of its handle becomes obsolete
}

// E3 M3 fix: the longest delay a timer takes (a longer one fires at once); a later boundary is reached by re-arming.
const MAX_TIMER_MS = 2 ** 31 - 1;

// E3 panel: H's non-forcing probe of a dataset watch's handle (Decision Log 17)
const PROBE = { probe: true } as const;

const INITIAL: LiveSnapshot = { shown: false, queries: new Map(), needsStart: false, start: { phase: 'idle' } };

// An outcome's pause: undefined when it changes nothing (the surface's own hide or close, an answer that is no dataset
// phase), null when it ends the pause (the host published, recorded its error state, or found the dataset changed).
function pauseOf(outcome: ConnectorCallOutcome | ConnectorGrantOutcome): LivePause | null | undefined {
  if (outcome.ok) {
    if (!('result' in outcome)) return null; // a grant
    const result = outcome.result as { status?: unknown } | null;
    return result !== null && typeof result === 'object' && (result.status === 'dataset' || result.status === 'failed') ? null : undefined;
  }
  switch (outcome.state) {
    case 'paused':
      return outcome.reason === 'noRoute' || outcome.reason === 'unavailable' ? 'noRoute' : undefined;
    case 'revoked':
      return outcome.reason === 'fingerprintChanged' ? 'allowChanged' : outcome.reason === 'wrongMode' ? 'mayWrite' : 'notAllowed';
    case 'invalid':
      return outcome.reason === 'notReadOnly' ? 'mayWrite' : outcome.reason === 'watchLimit' ? 'watchLimit' : outcome.reason === 'lease' ? undefined : 'failed';
    case 'failed':
      return 'failed';
  }
}

export class LiveDatasetsController implements LiveDatasets {
  private current: LiveSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly queries = new Map<string, Query>();
  private doc: Doc | null = null;
  private stopDoc = () => {};
  private surface: ConnectorSurface | null = null;
  private stopGrants: (() => void) | null = null;
  private declared = new Map<string, Promise<ConnectorSurface | null>>(); // by tool key: the surface it is declared on
  private grants: ConnectorGrant[] | null = null;
  private shown = false;
  private showings = 0; // E3 panel: how many times it has been shown
  private start_: LiveStart = { phase: 'idle' };
  private started: AppSessionId | null = null; // the session the last Start named
  private waiting: (() => void) | null = null; // stops listening for a Start's setup
  private readonly afterStart = new Set<string>(); // P3-F: manual queries a Start's readiness found paused while hidden
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly deps: LiveDatasetsDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): LiveSnapshot => this.current;
  now = (): number => (this.deps.now ?? Date.now)();

  /** The live document whose query datasets this follows (once its replica is open). */
  follow(doc: Doc): void {
    if (this.disposed || doc === this.doc) return;
    this.stopDoc();
    this.doc = doc;
    this.stopDoc = onUpdate(doc, () => this.sync());
    this.sync();
  }

  /** The trusted visibility: the body on screen, its window's document visible, and no history preview. */
  setShown(shown: boolean): void {
    if (this.disposed || shown === this.shown) return;
    this.shown = shown;
    if (shown) this.showings += 1; // E3 panel
    if (shown && !this.surface) this.ensureSurface(); // opened visible
    else {
      this.surface?.setVisible(shown);
      if (shown) this.recover();
      else for (const query of this.queries.values()) this.stopProbe(query);
    }
    this.armStale();
    this.publish();
  }

  async refresh(id: string): Promise<void> {
    const query = this.queries.get(id);
    if (!query || !this.shown || this.disposed || query.busy) return;
    if (!this.ensureSurface()) return;
    if (query.source.schedule !== undefined) {
      if (query.watch?.id) return this.ask(query); // E3 M3 fix: the owner's, forced; an evicted handle is registered again
      if (query.watch) return; // its start is in flight; it refreshes at once
      query.pause = null;
      this.startWatch(query);
      this.publish();
      return;
    }
    const { settings } = query;
    this.patch(query, { busy: 'refresh' });
    let outcome: ConnectorCallOutcome | null = null;
    try {
      // E3 panel: on the surface it was declared on, while that is still the tab's (a recycled one calls nothing)
      const on = await this.declare(query.source);
      if (on && on === this.surface) outcome = await on.callTool({ server: query.source.server, tool: query.source.tool, args: query.source.args }, { dataset: { id } });
    } catch (error) {
      this.log(`the refresh of dataset "${id}" failed: ${messageOf(error)}`);
      outcome = { ok: false, state: 'failed', reason: 'routeFailed' };
    }
    const now = this.queries.get(id);
    if (this.disposed || now !== query || query.settings !== settings) return; // the query changed or went meanwhile
    const pause = outcome ? pauseOf(outcome) : undefined;
    this.patch(query, { busy: null, ...(pause !== undefined && { pause }) });
  }

  async grant(id: string): Promise<void> {
    await this.gesture(id, 'grant', async ({ server, tool }) => {
      const outcome = await this.deps.host.grantConnectorTool(this.deps.artifactId, { server, tool, mode: 'read' });
      return pauseOf(outcome);
    });
  }

  async revoke(id: string): Promise<void> {
    await this.gesture(id, 'revoke', async ({ server, tool }) => {
      await this.deps.host.revokeConnectorTool(this.deps.artifactId, { server, tool });
      return undefined;
    });
  }

  // The owner's Start: one at a time; a setup that fails, meets a card or is held ends it with its words, and the next
  // Start retries the session it named (H's connector sheet's rule).
  async start(): Promise<void> {
    const { phase } = this.start_;
    if (phase === 'asking' || phase === 'starting' || this.disposed) return;
    this.setStart({ phase: 'asking' });
    let answer: ArtifactSessionStart;
    try {
      answer = await this.deps.startSession(this.started);
    } catch (error) {
      answer = { status: 'refused', appSessionId: this.started, words: messageOf(error) };
    }
    if (this.disposed) {
      if (answer.status === 'starting') answer.cancel();
      return;
    }
    if (answer.appSessionId !== null) this.started = answer.appSessionId;
    if (answer.status !== 'starting') return this.settle(answer);
    this.setStart({ phase: 'starting', appSessionId: answer.appSessionId });
    const { cancel } = answer;
    this.waiting = cancel;
    const end = await answer.settled;
    if (this.waiting !== cancel) return; // the tab went meanwhile
    this.waiting = null;
    this.settle(end);
  }

  openSession(appSessionId: string): void {
    this.deps.openSession?.(appSessionId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopDoc();
    this.waiting?.();
    this.waiting = null;
    if (this.staleTimer !== null) clearTimeout(this.staleTimer);
    this.stopGrants?.();
    for (const query of this.queries.values()) {
      this.stopProbe(query); // E3 M3 fix
      query.watch = null;
    }
    this.queries.clear();
    if (this.surface) {
      this.surface.setVisible(false);
      this.surface.close(); // its watches end with its lease
    }
    this.surface = null;
    this.listeners.clear();
  }

  // ── following the live document ──

  private sync(): void {
    if (this.disposed || !this.doc) return;
    const seen = new Set<string>();
    for (const { id, descriptor } of listDatasets(this.doc)) {
      if (descriptor.source.kind !== 'query') continue;
      seen.add(id);
      const source = descriptor.source;
      const identity = queryIdentity(source);
      const settings = JSON.stringify([identity, source.schedule ?? null]);
      const known = this.queries.get(id);
      if (known && known.settings === settings) {
        known.source = source; // its snapshot and policy, for the sheet and the stale clock
        known.state = descriptor.state; // E3 panel
        continue;
      }
      if (known) this.endWatch(known);
      const query: Query = { id, source, state: descriptor.state, identity, settings, watch: null, pause: known && known.identity === identity ? known.pause : null, busy: null, probes: 0 };
      this.queries.set(id, query);
      if (this.surface && source.schedule !== undefined) this.startWatch(query);
    }
    for (const [id, query] of this.queries) {
      if (seen.has(id)) continue;
      this.endWatch(query);
      this.queries.delete(id);
    }
    if (this.shown) this.ensureSurface();
    this.armStale();
    this.publish();
  }

  // The tab's one surface, opened at the first showing with a query (with its grants read and followed, and every
  // scheduled query's watch started); null before.
  private ensureSurface(): ConnectorSurface | null {
    if (this.surface || this.disposed) return this.surface;
    if (!this.shown || this.queries.size === 0) return null;
    const surface = this.openSurface();
    this.stopGrants = this.deps.onGrantChanged((artifactId) => {
      if (artifactId === this.deps.artifactId) void this.readGrants();
    });
    void this.readGrants();
    return surface;
  }

  // The tab's surface opened (visible as the tab is), every scheduled query's watch started on it.
  private openSurface(): ConnectorSurface {
    const surface = this.deps.host.openConnectors(this.deps.artifactId);
    this.surface = surface;
    surface.setVisible(this.shown);
    for (const query of this.queries.values()) if (query.source.schedule !== undefined) this.startWatch(query);
    return surface;
  }

  // The query's tool declared on the surface (once), before any call or watch of it: the surface it was declared on, or
  // null if it was refused. E3 panel: H's lease keeps every tool declared on it, CONNECTOR_DECLARE_LIMIT at most and
  // none withdrawn, so a new tool that would pass that cap while a declared one names no current query first recycles
  // the surface.
  private declare(source: QuerySource): Promise<ConnectorSurface | null> {
    const tool: ConnectorToolRef = { server: source.server, tool: source.tool };
    const key = connectorToolKey(tool);
    if (!this.declared.has(key) && this.declared.size >= CONNECTOR_DECLARE_LIMIT && this.declaresObsolete()) this.recycle(); // E3 panel
    let declared = this.declared.get(key);
    if (!declared) {
      const surface = this.surface;
      const table = this.declared;
      declared = (
        surface
          ? surface.declareTools([tool]).then(
              (outcome) => outcome.ok,
              (error: unknown) => (this.log(`the declaration of ${source.server} · ${source.tool} failed: ${messageOf(error)}`), false),
            )
          : Promise.resolve(false)
      ).then((ok) => (ok ? surface : null));
      table.set(key, declared);
      const asked = declared;
      void asked.then((on) => on || (table.get(key) === asked && table.delete(key))); // a refused one is asked again next time
    }
    return declared;
  }

  // E3 panel: whether the surface declares a tool no current query names
  private declaresObsolete(): boolean {
    const current = new Set([...this.queries.values()].map(({ source }) => connectorToolKey({ server: source.server, tool: source.tool })));
    return [...this.declared.keys()].some((key) => !current.has(key));
  }

  // E3 panel: a fresh lease for the current queries alone. The old surface closes with its watches and calls (nothing it
  // answers after is heard; a manual refresh it ran reads no pause) and each scheduled query's watch starts on the new.
  private recycle(): void {
    const old = this.surface;
    for (const query of this.queries.values()) {
      this.stopProbe(query);
      query.watch = null;
    }
    this.declared = new Map();
    this.surface = null;
    if (old) {
      old.setVisible(false);
      old.close();
    }
    this.openSurface();
  }

  private startWatch(query: Query): void {
    const schedule = query.source.schedule;
    if (!this.surface || schedule === undefined) return;
    const token = {};
    query.watch = { token, id: null };
    const mine = () => !this.disposed && this.queries.get(query.id) === query && query.watch?.token === token;
    const { server, tool, args } = query.source;
    const showing = this.showings; // E3 panel
    void (async () => {
      const surface = await this.declare(query.source);
      if (!surface || !mine()) {
        if (mine()) query.watch = null;
        return;
      }
      const start = await surface.watchTool({ server, tool, args, intervalMs: schedule * 1000 }, (update) => mine() && this.heard(query, update), { dataset: { id: query.id } });
      if (!mine()) {
        if (start.ok && !this.disposed) void surface.unwatchTool(start.watchId).catch(() => {});
        return;
      }
      if (start.ok) {
        query.watch = { token, id: start.watchId };
        // E3 panel: hidden since it began, the watch may have yielded its slot before this answer; shown again meanwhile
        // (whose recovery found no handle to ask), it is asked now; hidden now, its next showing asks it
        if (this.shown && this.showings !== showing) this.recoverWatch(query, schedule);
        return;
      }
      query.watch = null;
      const pause = pauseOf(start);
      if (pause !== undefined) this.patch(query, { pause });
    })().catch((error: unknown) => {
      this.log(`the watch of dataset "${query.id}" could not start: ${messageOf(error)}`);
      if (mine()) query.watch = null;
    });
  }

  private endWatch(query: Query): void {
    this.stopProbe(query); // E3 M3 fix
    const id = query.watch?.id;
    query.watch = null;
    if (id && this.surface) void this.surface.unwatchTool(id).catch(() => {});
  }

  private heard(query: Query, update: ConnectorCallOutcome): void {
    query.heardAt = this.now(); // E3 M3 fix
    this.stopProbe(query); // E3 M3 residual: a refresh heard proves its handle; an armed or in-flight ask is obsolete
    if (!update.ok && update.state === 'invalid') this.endWatch(query); // H ended the watch; E3 panel: its listener goes too
    const pause = pauseOf(update);
    if (pause !== undefined) this.patch(query, { pause });
  }

  // ── E3 M3 fix: a watch that yielded its slot at the cap while hidden (Decision Log 11, 12) ──

  // Shown again: each watch's handle asked once it is due, and a query paused at the cap tries its watch again. A watch
  // cannot yield while shown, so one answer per showing suffices; a start still in flight is asked when it answers.
  // P3-F: a manual query a Start's readiness found paused for want of a session while hidden refreshes once, now.
  private recover(): void {
    const now = this.now();
    const afterStart = [...this.afterStart];
    this.afterStart.clear();
    for (const id of afterStart) {
      const query = this.queries.get(id);
      if (query && query.pause === 'noRoute' && query.source.schedule === undefined) void this.refresh(id);
    }
    for (const query of this.queries.values()) {
      const schedule = query.source.schedule;
      if (schedule === undefined) continue;
      if (!query.watch) {
        if (query.pause === 'watchLimit') {
          query.pause = null;
          this.startWatch(query);
        }
        continue;
      }
      if (query.watch.id) this.recoverWatch(query, schedule, now);
    }
  }

  // The watch's handle asked once it is due: at once if it is, else at its due time while shown. E3 panel: by the
  // non-forcing probe (Decision Log 17), so a catch-up H already ran on showing is never followed by a second refresh.
  private recoverWatch(query: Query, schedule: number, now = this.now()): void {
    const wait = query.heardAt === undefined ? 0 : query.heardAt + schedule * 1000 - now;
    this.stopProbe(query);
    if (wait <= 0) void this.ask(query, PROBE);
    else
      query.probe = setTimeout(() => {
        delete query.probe;
        void this.ask(query, PROBE);
      }, Math.min(wait, MAX_TIMER_MS));
  }

  // Asks the watch's handle: the owner's Refresh forces a refresh (a running dataset watch answers true), the recovery
  // only probes it (E3 panel); false is a handle the broker no longer has, so it is unwatched and registered again,
  // which refreshes at once. Never two watches for one query.
  // E3 M3 residual: an ask is withdrawn when a refresh of the watch is heard, the dashboard hides or shows again, or another
  // ask finds the handle (`probes` advanced), so its late answer registers nothing and no refresh runs early.
  private async ask(query: Query, probe?: typeof PROBE): Promise<void> {
    const surface = this.surface;
    const watch = query.watch;
    if (!surface || !watch?.id || !this.shown) return;
    const asked = query.probes;
    let kept: boolean;
    try {
      kept = await (probe ? surface.refreshWatch(watch.id, probe) : surface.refreshWatch(watch.id));
    } catch (error) {
      this.log(`a watch refresh failed: ${messageOf(error)}`);
      return;
    }
    if (query.probes !== asked) return; // made obsolete meanwhile
    if (kept) return this.stopProbe(query); // the handle exists: an armed ask is withdrawn
    if (this.disposed || !this.shown || this.queries.get(query.id) !== query || query.watch !== watch) return;
    this.endWatch(query);
    this.startWatch(query);
  }

  private stopProbe(query: Query): void {
    if (query.probe !== undefined) clearTimeout(query.probe);
    delete query.probe;
    query.probes += 1; // E3 M3 residual: any ask in flight is obsolete
  }

  // ── grants and gestures ──

  private async readGrants(): Promise<void> {
    try {
      const grants = await this.deps.host.connectorGrants(this.deps.artifactId);
      if (this.disposed) return;
      this.grants = grants;
      this.publish();
    } catch (error) {
      this.log(`the connector grants of ${this.deps.artifactId} could not be read: ${messageOf(error)}`);
    }
  }

  private async gesture(id: string, busy: 'grant' | 'revoke', run: (source: QuerySource) => Promise<LivePause | null | undefined>): Promise<void> {
    const query = this.queries.get(id);
    if (!query || query.busy || this.disposed) return;
    this.patch(query, { busy });
    let pause: LivePause | null | undefined;
    try {
      pause = await run(query.source);
    } catch (error) {
      this.log(`a connector gesture on ${query.source.server} · ${query.source.tool} failed: ${messageOf(error)}`);
      pause = 'failed';
    }
    if (this.disposed) return;
    await this.readGrants();
    if (this.disposed) return;
    this.patch(query, { busy: null, ...(pause !== undefined && { pause }) });
  }

  private settle(end: ArtifactSessionEnd): void {
    if (end.status !== 'ready') return this.setStart({ phase: end.status, appSessionId: end.appSessionId, words: end.words });
    this.setStart({ phase: 'ready', appSessionId: end.appSessionId });
    for (const query of [...this.queries.values()]) {
      if (query.pause !== 'noRoute') continue;
      // P3-F: nothing is called while hidden; a manual query waits for the next showing's recovery (a watch has its own)
      if (!this.shown && query.source.schedule === undefined) this.afterStart.add(query.id);
      void this.refresh(query.id);
    }
  }

  private setStart(start: LiveStart): void {
    this.start_ = start;
    this.publish();
  }

  // ── the stale label's clock ──

  private armStale(): void {
    if (this.staleTimer !== null) clearTimeout(this.staleTimer);
    this.staleTimer = null;
    if (!this.shown || this.disposed) return;
    const now = this.now();
    let next = Infinity;
    for (const { source } of this.queries.values()) {
      if (source.snapshot === null || source.staleAfter === undefined) continue;
      const since = source.snapshot.at + source.staleAfter * 1000;
      if (since > now) next = Math.min(next, since);
    }
    if (next === Infinity) return;
    // E3 M3 fix: a boundary past the longest timer is reached by re-arming; the views are told once it has passed
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null;
      const passed = this.now() >= next;
      this.armStale();
      if (passed) this.publish();
    }, Math.min(next - now, MAX_TIMER_MS));
  }

  // ── publication ──

  private patch(query: Query, patch: Partial<Pick<Query, 'pause' | 'busy'>>): void {
    if (this.queries.get(query.id) !== query) return;
    Object.assign(query, patch);
    this.publish();
  }

  private publish(): void {
    if (this.disposed) return;
    const queries = new Map<string, LiveQueryStatus>();
    for (const query of this.queries.values()) {
      const { server, tool, schedule, snapshot } = query.source;
      const held = this.grants === null ? null : this.grants.some((grant) => grant.server === server && grant.tool === tool && grant.mode === 'read');
      queries.set(query.id, { identity: query.identity, server, tool, ...(schedule !== undefined && { schedule }), snapshot, error: datasetErrorOf(query.state) /* E3 panel */, permission: held === null ? 'unknown' : held ? 'read' : 'none', pause: query.pause, busy: query.busy });
    }
    const needsStart = [...queries.values()].some((status) => status.pause === 'noRoute'); // a grant refused for want of a session too
    this.current = { shown: this.shown, queries, needsStart, start: this.start_ };
    for (const listener of [...this.listeners]) listener();
  }

  private log(line: string): void {
    (this.deps.log ?? ((text: string) => console.warn(`[dashboard live] ${text}`)))(line);
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
