// P3-H H3a: main's connector broker (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24, 80 and
// 83; the P3 interface ledger's X9 amendment and X23 grant rows; P3-E's XE8). An artifact page calls and watches a
// connector's MCP tool through a page lease main holds for a trusted owner (a window) and one artifact; the owner
// grants and revokes per artifact and per tool. Everything here is main's, so it all ends with the app: nothing runs
// while the app is closed, and no timer here can acquire an engine, because a route (./route.ts) only finds what is
// already live.
//
// The rules, each enforced here rather than trusted to a caller:
// - A lease starts hidden; only its owner shows or hides it, and a hidden or closed lease calls nothing, its calls and
//   its watches alike. Only the owner that opened a lease may use it. P3-H H4 (P3 Decision Log 89): a lease is visible
//   only while its surface is (the renderer's report, `setVisible`) and its owner window is shown and not minimized
//   (main's native report, `setWindowShown`). The two are held apart: the renderer's report never overrides a hidden
//   window, and a window shown again never revives a hidden surface. An owner whose window main has not reported is
//   hidden, and main is asked to re-read the window as work starts, again at the backend's door (after the route and
//   the grant answered, with no await before the call) and again as an outcome is published, while the work is still
//   registered: a hide no event announced then aborts it, so nothing is dispatched or published after the window hid.
// - A page calls only the server and tool pairs it declared, and a declaration grants nothing.
// - Every call, a watch's refresh included, asks the routes for an already-live target, then checks the owner's grant
//   against the fingerprint that target reports (a non-consuming check); the route's annotations, never the page, say
//   whether a tool is read-only. A read grant admits a read-only tool; a tool that may write runs only under an Allow
//   once (which the route's own last check consumes) and is never watched.
// - Work in flight belongs to its lease and its tool: hiding or closing the lease, the owner's revoke and the store's
//   committed revoke or delete abort it, answer it at once and drop whatever it later returns. A refresh stays
//   abortable until its outcome is published, so a listener that hides the page or revokes the tool while another
//   refresh's outcome waits to be published stops that one too. The artifact's deletion stops every tool's work for
//   it, whether or not a grant row was left to announce (P3 Decision Log 91). The owner's revoke aborts before it
//   awaits the store, and refuses new calls of the tool until the store has answered; an Allow once being consumed is
//   the call it admitted going ahead, not a revoke. P3-F F-connectors 1: the owner's grant gesture is fenced the same
//   way: its route resolution is work of the tool (a revoke, the deletion and main's stop abort it), and its write
//   follows a synchronous recheck that no revoke began since the gesture did, so an older gesture never restores a
//   grant, an Allow once included, that the owner's newer decision withdrew.
// - Watches: 30 s to 24 h, at most 64 across the whole app, one refresh at a time, the next an interval after the last
//   ended; hidden, none run, and shown, a due one catches up once. A watch with no route reads paused and asks again at
//   its interval; one with no grant waits, timerless, for a grant (a denial computed before a grant that arrived while
//   it ran is obsolete: the watch asks again rather than wait); one of a tool that is not read-only ends.
// - What a page reads of a failure is a state and a reason from a closed list (P3 Decision Log 84); the words of an
//   error, the route's or main's own, go to main's log only.
// - E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the owner's surface may put a dataset sink beside
//   a page's call or watch (`options.dataset`, never the page's request), which the route's backend publishes the
//   result to; it needs a read grant of a read-only tool, and the route asks its `publishable` (the window re-read now,
//   the work not aborted, the lease visible) before each step that would let the backend publish. An agent's one
//   refresh (`refreshForSession`) needs no lease: the asking session's own engine (`sessionRoute`) or a direct route
//   serves it, never another session's, under the same read grant; the owner's revoke, the store's revoke or delete and
//   main's stop end it as they end a page's work. E3 M2 fix: a dataset work, a page's or an agent's, runs on one
//   budget (CONNECTOR_OPERATION_DEADLINE_MS) from its admission here through the route, the grant, the call and the
//   host's publication; at its end the work is aborted (`paused: unavailable`) and may no longer publish (P3-F
//   F-connectors 2: a watch's refresh so ended is a refresh that ran: published, the next due an interval later). E3 M2
//   residual (the architect's terminal-ownership ruling): an aborted dataset call is not answered "nothing published"
//   while its commit may land. Once dispatched, its route settles it through the host's cancel: the abort's refusal
//   when the cancel won, else the publication's durable end, which stands as the outcome (`settledBy`). E3 M3 fix (the
//   architect's watch priority ruling): at the 64-watch cap a visible surface's request ends the oldest dormant dataset
//   watch (hidden, nothing running), never one of H's generic watches or a visible one; its dashboard finds the handle
//   gone (`refreshWatch` false) when shown and registers it again. A dataset watch whose refresh runs answers
//   `refreshWatch` true, so a running handle never reads as an evicted one; H's generic answers are unchanged. E3 panel
//   (Decision Log 17): the owner asks that through the non-forcing probe (`{probe: true}`), its dataset watch's liveness
//   alone, so its recovery never adds a refresh to the catch-up a showing already ran.
import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import {
  CONNECTOR_ARGS_MAX_BYTES,
  CONNECTOR_DECLARE_LIMIT,
  CONNECTOR_OPERATION_DEADLINE_MS, // E3
  CONNECTOR_WATCH_LIMIT,
  ConnectorCallOptionsSchema, // E3
  ConnectorCallRequestSchema,
  ConnectorGrantGestureSchema,
  ConnectorToolRefSchema,
  ConnectorWatchRequestSchema,
  clampWatchInterval,
  connectorToolKey,
  type ConnectorCallOptions, // E3
  type ConnectorCallOutcome,
  type ConnectorDatasetSink, // E3
  type ConnectorDeclareOutcome,
  type ConnectorGrant,
  type ConnectorGrantChange,
  type ConnectorGrantMode,
  type ConnectorGrantOutcome,
  type ConnectorInvalid,
  type ConnectorRefusal,
  type ConnectorRefusalState,
  type ConnectorRouteName,
  type ConnectorToolRef,
  type ConnectorWatchStart,
} from '@shared/artifacts/connectors';
import { ARTIFACT_ID } from '@shared/maws/tools';
import { boundedMessage, jsonBytes, readAnswer, readTarget, type ConnectorGrantAuthority, type ConnectorRoute, type ConnectorRouteAnswer, type ConnectorRouteTarget } from './route';

export interface ConnectorBrokerOptions {
  // In preference order: the first that already has the tool serves. Production gives route E first and route D after
  // it, so D serves only when no eligible live engine has the server (P3-H's brief, deliverable 4).
  routes: readonly ConnectorRoute[];
  grants: ConnectorGrantAuthority;
  log?: (line: string) => void;
  // P3-H H4: main re-reads `owner`'s window, reporting any change through `setWindowShown` before it returns.
  recheckWindow?: (owner: string) => void;
  // E3: route E's target in the asking session alone (an agent's refresh); absent, only the other routes serve one.
  sessionRoute?: (appSessionId: string, artifactId: string, tool: ConnectorToolRef, signal: AbortSignal) => Promise<ConnectorRouteTarget | null>;
}

// E3: an agent's one refresh, as main read it from the host's request.
export interface ConnectorAgentRefresh extends ConnectorToolRef {
  appSessionId: string;
  artifactId: string;
  args: Record<string, unknown>;
  dataset: { id: string; baseRevision: number; requestId: string };
}

export type ConnectorWatchListener = (update: ConnectorCallOutcome) => void;

type Use = 'call' | 'watch';

interface Lease {
  readonly id: string;
  readonly owner: string;
  readonly artifactId: string;
  surfaceVisible: boolean; // the renderer's report; the lease is visible only while its window is shown too (P3-H H4)
  readonly declared: Map<string, ConnectorToolRef>;
  readonly work: Set<Work>;
  readonly watches: Set<Watch>;
}

// One call or refresh in flight: aborting it answers it with the abort's reason (a refusal).
interface Work {
  readonly key: string; // the artifact and the tool
  readonly controller: AbortController;
  expired?: boolean; // P3-F F-connectors 2: aborted by its dataset budget's end, not by a hide, close, unwatch or revoke
}

interface Watch {
  readonly id: string;
  readonly lease: Lease;
  readonly tool: ConnectorToolRef;
  readonly key: string;
  readonly args: Record<string, unknown>;
  readonly intervalMs: number;
  readonly listener: ConnectorWatchListener;
  readonly dataset?: ConnectorDatasetSink; // E3: the owner's sink, without a base (each refresh takes the host's)
  waitingForGrant: boolean; // no grant admits it: no timer until the owner grants
  waitingSince: number; // the tool's grant generation when it began to wait: a grant since makes the wait obsolete
  rechecking?: boolean; // P3-H H3b: its grant being re-read from the store
  endedAt?: number; // when its last refresh that ran ended; the next is due an interval later
  timer?: ReturnType<typeof setTimeout>;
  running?: Work;
}

const FAILURE_WORDS = { unavailable: 'found the server unavailable', failed: 'failed', tooLarge: 'answered too large a result', refused: 'was refused at the write' } as const; // P3-H H3b: the last two

const refusal = <S extends ConnectorRefusalState>(state: S, reason: Extract<ConnectorRefusal, { state: S }>['reason']): ConnectorRefusal => ({ ok: false, state, reason }) as ConnectorRefusal;
const invalid = (reason: ConnectorInvalid['reason']): ConnectorInvalid => ({ ok: false, state: 'invalid', reason });

// The artifact and the tool, unambiguously.
const workKey = (artifactId: string, tool: ConnectorToolRef): string => JSON.stringify([artifactId, connectorToolKey(tool)]);

const ABORTED = Symbol('aborted');
// `work`, or ABORTED as soon as `signal` aborts (whatever `work` does after that is dropped).
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.resolve(ABORTED);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const DeclareSchema = z.array(ConnectorToolRefSchema).max(CONNECTOR_DECLARE_LIMIT);

// A page's arguments as JSON of a practical size, or null.
function argsOf(args: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (args === undefined) return {};
  const bytes = jsonBytes(args);
  return bytes !== null && bytes <= CONNECTOR_ARGS_MAX_BYTES ? args : null;
}

export class ConnectorBroker {
  private readonly routes: readonly ConnectorRoute[];
  private readonly authority: ConnectorGrantAuthority;
  private readonly log: (line: string) => void;
  private readonly recheckWindow: (owner: string) => void;
  private readonly windowShown = new Map<string, boolean>(); // P3-H H4: per owner, main's native report
  private readonly leases = new Map<string, Lease>();
  private readonly watches = new Map<string, Watch>();
  private readonly revoking = new Map<string, number>(); // keys whose owner's revoke the store has not answered yet
  private readonly grantGenerations = new Map<string, number>(); // per key, the grants announced so far
  private readonly revocations = new Map<string, number>(); // P3-H H3b: per key, the revokes heard so far
  private readonly agentWork = new Map<Work, string>(); // E3: agents' refreshes in flight, by their artifact
  private readonly gestures = new Map<Work, string>(); // P3-F F-connectors 1: grant gestures resolving their target, by artifact
  private readonly sessionRoute: ConnectorBrokerOptions['sessionRoute']; // E3
  private stopped = false;

  constructor(options: ConnectorBrokerOptions) {
    this.routes = options.routes;
    this.authority = options.grants;
    this.log = options.log ?? ((line) => console.error(line));
    this.recheckWindow = options.recheckWindow ?? (() => {});
    this.sessionRoute = options.sessionRoute;
  }

  // ── the page's lease (relayed by the owner) ──

  // A hidden lease for `owner` on `artifactId`; the owner's own input, so a malformed one throws.
  open(owner: string, artifactId: string): string {
    if (this.stopped) throw new Error('the connector broker has stopped');
    if (typeof owner !== 'string' || owner.length === 0) throw new TypeError('a connector lease needs an owner');
    if (typeof artifactId !== 'string' || !ARTIFACT_ID.test(artifactId)) throw new TypeError('not an artifact id');
    const lease: Lease = { id: randomUUID(), owner, artifactId, surfaceVisible: false, declared: new Map(), work: new Set(), watches: new Set() };
    this.leases.set(lease.id, lease);
    return lease.id;
  }

  // Adds `tools` to what the lease may call; answers everything it has declared.
  declareTools(owner: string, leaseId: string, tools: unknown): ConnectorDeclareOutcome {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease) return invalid('lease');
    const parsed = DeclareSchema.safeParse(tools);
    if (!parsed.success) return invalid('request');
    const added = parsed.data.filter((tool) => !lease.declared.has(connectorToolKey(tool)));
    if (lease.declared.size + new Set(added.map(connectorToolKey)).size > CONNECTOR_DECLARE_LIMIT) return invalid('request');
    for (const tool of added) lease.declared.set(connectorToolKey(tool), { server: tool.server, tool: tool.tool });
    return { ok: true, declared: [...lease.declared.values()] };
  }

  // E3: `options`, the owner's dataset sink beside the page's request.
  async callTool(owner: string, leaseId: string, request: unknown, options?: ConnectorCallOptions): Promise<ConnectorCallOutcome> {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease) return invalid('lease');
    const parsed = ConnectorCallRequestSchema.safeParse(request);
    const args = parsed.success ? argsOf(parsed.data.args) : null;
    if (!parsed.success || args === null) return invalid('request');
    const sink = sinkOf(options);
    if (sink === false) return invalid('request'); // E3
    const tool = { server: parsed.data.server, tool: parsed.data.tool };
    if (!lease.declared.has(connectorToolKey(tool))) return invalid('undeclared');
    const work = this.work(lease, tool);
    try {
      const outcome = await this.run(lease, tool, args, 'call', work, sink ?? undefined);
      this.recheckWindow(lease.owner); // P3-H H4: at publication, a hide no event announced aborts it still
      return settledBy(work, outcome, sink); // E3: an admitted publication's durable end stands
    } finally {
      lease.work.delete(work);
    }
  }

  // Starts a watch whose refreshes reach `listener` (never one dropped by a hide, close or revoke).
  // E3: `options`, the owner's dataset sink, which names no base (each refresh takes the host's at its start).
  watchTool(owner: string, leaseId: string, request: unknown, listener: ConnectorWatchListener, options?: ConnectorCallOptions): ConnectorWatchStart {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease) return invalid('lease');
    const parsed = ConnectorWatchRequestSchema.safeParse(request);
    const args = parsed.success ? argsOf(parsed.data.args) : null;
    if (!parsed.success || args === null || typeof listener !== 'function') return invalid('request');
    const sink = sinkOf(options);
    if (sink === false || sink?.baseRevision !== undefined) return invalid('request'); // E3
    const tool = { server: parsed.data.server, tool: parsed.data.tool };
    if (!lease.declared.has(connectorToolKey(tool))) return invalid('undeclared');
    if (this.watches.size >= CONNECTOR_WATCH_LIMIT && !(this.visible(lease) && this.yieldDormantDataset())) return invalid('watchLimit'); // E3 M3 fix
    const watch: Watch = { id: randomUUID(), lease, tool, key: workKey(lease.artifactId, tool), args, intervalMs: clampWatchInterval(parsed.data.intervalMs), listener, ...(sink && { dataset: sink }) /* E3 */, waitingForGrant: false, waitingSince: 0 };
    this.watches.set(watch.id, watch);
    lease.watches.add(watch);
    this.schedule(watch);
    return { ok: true, watchId: watch.id, intervalMs: watch.intervalMs };
  }

  unwatch(owner: string, leaseId: string, watchId: string): boolean {
    const watch = this.watchOf(owner, leaseId, watchId);
    if (!watch) return false;
    this.end(watch);
    return true;
  }

  // The page's Refresh (after the owner's Start, say): a refresh now, when the lease is visible and the watch neither
  // waits for a grant nor has one in flight. P3-H H3b: a visible watch waiting for a grant has its grant re-read from the
  // store instead (a grant whose announcement was lost wakes it); true when either was started.
  // E3 panel (Decision Log 17): `options.probe`, the owner's non-forcing check: whether its dataset watch lives, read
  // and answered alone (no wake, grant read or check, call or schedule change), so a dashboard's recovery never starts a
  // second refresh after the catch-up its showing already ran. H's generic watches answer false to it.
  refreshWatch(owner: string, leaseId: string, watchId: string, options?: { probe?: boolean }): boolean {
    const watch = this.watchOf(owner, leaseId, watchId);
    if (options?.probe) return watch?.dataset !== undefined; // E3 panel
    if (watch) this.wakeIfGranted(watch);
    if (watch?.waitingForGrant && this.visible(watch.lease)) {
      void this.recheck(watch);
      return true;
    }
    // E3 M3 fix: a dataset watch's refresh in flight is the one asked, so its handle answers true (false is an evicted one)
    if (watch?.dataset && watch.running && this.visible(watch.lease)) return true;
    if (!watch || !this.visible(watch.lease) || watch.waitingForGrant || watch.running) return false;
    clearTimeout(watch.timer);
    void this.refresh(watch);
    return true;
  }

  // ── the owner's controls ──

  // The renderer's report of the lease's surface (the editor's and its document's visibility).
  setVisible(owner: string, leaseId: string, visible: boolean): boolean {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease || typeof visible !== 'boolean') return false;
    if (lease.surfaceVisible === visible) return true;
    const was = this.visible(lease);
    lease.surfaceVisible = visible;
    this.changed(lease, was);
    return true;
  }

  // P3-H H4: main's report of `owner`'s native window: shown (and not minimized) or not.
  setWindowShown(owner: string, shown: boolean): void {
    if (this.windowShown.get(owner) === shown) return;
    const leases = [...this.leases.values()].filter((lease) => lease.owner === owner);
    const was = leases.map((lease) => this.visible(lease));
    this.windowShown.set(owner, shown);
    leases.forEach((lease, i) => this.changed(lease, was[i]!));
  }

  close(owner: string, leaseId: string): boolean {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease) return false;
    this.dispose(lease);
    return true;
  }

  // The owner's page went (navigated, or its renderer replaced): every lease it held closes. Its window's state stays.
  closeOwner(owner: string): void {
    for (const lease of [...this.leases.values()]) if (lease.owner === owner) this.dispose(lease);
  }

  // P3-H H4: the owner is gone for good (its webContents destroyed): its leases close and its window's state is
  // forgotten, so a lease opened for it after all stays hidden.
  forgetOwner(owner: string): void {
    this.closeOwner(owner);
    this.windowShown.delete(owner);
  }

  // The app is quitting: everything closes, and nothing opens again.
  stop(): void {
    this.stopped = true;
    for (const lease of [...this.leases.values()]) this.dispose(lease);
    this.abort(this.agentWork.keys(), refusal('paused', 'closed')); // E3
    this.abort(this.gestures.keys(), refusal('paused', 'closed')); // P3-F F-connectors 1
    this.windowShown.clear();
  }

  // E3: an agent's one refresh of a dataset's query: no lease, no watch and no timer; the asking session's own engine
  // or a direct route, the owner's read grant of a read-only tool, the host's sink publishing the result.
  async refreshForSession(request: ConnectorAgentRefresh): Promise<ConnectorCallOutcome> {
    if (this.stopped) return refusal('paused', 'closed');
    const tool = { server: request.server, tool: request.tool };
    const args = argsOf(request.args);
    if (args === null) return invalid('request');
    const work: Work = { key: workKey(request.artifactId, tool), controller: new AbortController() };
    if (this.revoking.has(work.key)) return refusal('revoked', 'revoked');
    this.agentWork.set(work, request.artifactId);
    const { signal } = work.controller;
    const unbound = bounded(work);
    try {
      const found = await this.agentTarget(request, tool, signal);
      if ('ok' in found) return signal.aborted ? (signal.reason as ConnectorRefusal) : found;
      const publishable = () => !signal.aborted && this.agentWork.has(work);
      const outcome = await this.callTarget(request.artifactId, found.route, found.target, tool, args, 'call', signal, null, { sink: request.dataset, publishable, appSessionId: request.appSessionId });
      return settledBy(work, outcome, request.dataset); // E3 M2 residual
    } finally {
      unbound();
      this.agentWork.delete(work);
    }
  }

  grants(artifactId: string): Promise<ConnectorGrant[]> {
    return this.authority.list(artifactId);
  }

  // The owner's grant of one tool to one artifact, under the fingerprint the route reports now (the header's gesture
  // carries none). A read grant needs a tool the route marks read-only. A malformed gesture is a caller's bug: it throws.
  async grantTool(artifactId: string, gesture: unknown): Promise<ConnectorGrantOutcome> {
    const { server, tool, mode } = ConnectorGrantGestureSchema.parse(gesture);
    const ref = { server, tool };
    if (this.stopped) return refusal('paused', 'closed');
    // P3-F F-connectors 1: the revokes heard before the gesture began are older than it; any heard since are newer
    const work: Work = { key: workKey(artifactId, ref), controller: new AbortController() };
    const revocations = this.revocations.get(work.key) ?? 0;
    this.gestures.set(work, artifactId);
    let found;
    try {
      found = await this.target(artifactId, ref, work.controller.signal);
    } finally {
      this.gestures.delete(work);
    }
    if ('ok' in found) return found;
    // P3-HD M3b (Decision Log 18): no grant of either mode from grant-backed metadata alone; the owner's discovery first
    if (found.target.grantBacked) return refusal('paused', 'noRoute');
    if (mode === 'read' && !found.target.readOnly) return invalid('notReadOnly');
    // P3-F F-connectors 1: in the same turn as the write, a newer revoke (begun, or still unanswered by the store) wins
    if (this.stopped) return refusal('paused', 'closed');
    if (this.revoking.has(work.key) || (this.revocations.get(work.key) ?? 0) !== revocations) return refusal('revoked', 'revoked');
    const grant = await this.authority.grant(artifactId, { server, tool, fingerprint: found.target.fingerprint, mode });
    this.granted(artifactId, ref);
    return { ok: true, grant };
  }

  // The owner's revoke: every call and refresh of the tool in flight for the artifact stops before the store is even
  // asked, and none starts until it has answered. Answers whether there was a grant to revoke.
  async revokeTool(artifactId: string, tool: unknown): Promise<boolean> {
    const parsed = ConnectorToolRefSchema.parse(tool);
    const ref = { server: parsed.server, tool: parsed.tool };
    const key = workKey(artifactId, ref);
    this.revoking.set(key, (this.revoking.get(key) ?? 0) + 1);
    this.revoked(artifactId, ref);
    try {
      return await this.authority.revoke(artifactId, ref);
    } finally {
      const left = (this.revoking.get(key) ?? 1) - 1;
      if (left === 0) this.revoking.delete(key);
      else this.revoking.set(key, left);
    }
  }

  // P3-H H3b: the store's grant announcements may have been lost (the host's connection was not streaming, or a grant
  // gesture's answer never came back): every watch waiting for a grant has it re-read. Main calls this whenever the
  // engine host's connection starts streaming.
  recheckGrants(): void {
    for (const watch of [...this.watches.values()]) if (watch.waitingForGrant) void this.recheck(watch);
  }

  // The store's committed grant changes (H2's `onConnectorGrantChange`), wherever they came from: a revoke (the owner's
  // in another window, or the artifact's deletion) stops the tool's work, a grant wakes its waiting watches, and an
  // Allow once consumed is the call it admitted, so it stops nothing.
  onGrantChange(change: ConnectorGrantChange): void {
    if (this.stopped) return;
    const ref = { server: change.server, tool: change.tool };
    if (change.change === 'revoked') this.revoked(change.artifactId, ref);
    else if (change.change === 'granted') this.granted(change.artifactId, ref);
  }

  // P3 Decision Log 91: the artifact's deletion, heard on the store's change feed apart from its grant announcements (an
  // Allow once its call consumed has no row left for the deletion to announce revoked): every tool its pages declared
  // stops as a revoke stops it, its work in flight answered revoked (its route withdrawing it, an outcome not yet taken
  // included) and its watches waiting, timerless, for a grant.
  onArtifactDeleted(artifactId: string): void {
    if (this.stopped) return;
    const tools = new Map<string, ConnectorToolRef>();
    for (const lease of this.leases.values()) if (lease.artifactId === artifactId) for (const [key, tool] of lease.declared) tools.set(key, tool);
    for (const tool of tools.values()) this.revoked(artifactId, tool);
    this.abort([...this.agentWork].filter(([, of]) => of === artifactId).map(([work]) => work), refusal('revoked', 'revoked')); // E3
    this.abort([...this.gestures].filter(([, of]) => of === artifactId).map(([work]) => work), refusal('revoked', 'revoked')); // P3-F F-connectors 1
  }

  // ── the work ──

  // A call or refresh of `tool` on `lease`, registered with the lease until its caller releases it: the caller keeps it
  // registered until its outcome is delivered, so a hide, close or revoke up to that moment still aborts it.
  private work(lease: Lease, tool: ConnectorToolRef): Work {
    return { key: workKey(lease.artifactId, tool), controller: new AbortController() };
  }

  // One run of `work`; when it was aborted, the abort's reason (a refusal) is the outcome.
  private async run(lease: Lease, tool: ConnectorToolRef, args: Record<string, unknown>, use: Use, work: Work, sink?: ConnectorDatasetSink): Promise<ConnectorCallOutcome> {
    this.recheckWindow(lease.owner); // P3-H H4: a hide no event announced is heard now, before anything is asked
    if (!this.visible(lease)) return refusal('paused', 'hidden');
    if (this.revoking.has(work.key)) return refusal('revoked', 'revoked');
    lease.work.add(work);
    const unbound = sink ? bounded(work) : null; // E3
    try {
      const outcome = await this.attempt(lease, tool, args, use, work.controller.signal, sink);
      return settledBy(work, outcome, sink); // E3 M2 residual
    } finally {
      unbound?.();
    }
  }

  private async attempt(lease: Lease, tool: ConnectorToolRef, args: Record<string, unknown>, use: Use, signal: AbortSignal, sink?: ConnectorDatasetSink): Promise<ConnectorCallOutcome> {
    const found = await this.target(lease.artifactId, tool, signal);
    if ('ok' in found) return found;
    // E3: a page's sink publishes only while the work runs and the lease is visible, its window re-read now
    const publishable = () => {
      this.recheckWindow(lease.owner);
      return !signal.aborted && this.visible(lease);
    };
    return this.callTarget(lease.artifactId, found.route, found.target, tool, args, use, signal, lease.owner, sink && { sink, publishable });
  }

  // E3: the asking session's own engine first, then a route other than the engine (route D), never another session's.
  private async agentTarget(request: ConnectorAgentRefresh, tool: ConnectorToolRef, signal: AbortSignal): Promise<{ route: ConnectorRouteName; target: ConnectorRouteTarget } | ConnectorRefusal> {
    if (this.sessionRoute) {
      let value;
      try {
        value = await unlessAborted(this.sessionRoute(request.appSessionId, request.artifactId, { ...tool }, signal), signal);
      } catch (error) {
        return this.failed('routeFailed', `the engine route could not be asked for ${request.appSessionId}'s refresh of ${request.artifactId}'s ${tool.server} · ${tool.tool}: ${boundedMessage(error)}`);
      }
      if (value === ABORTED || signal.aborted) return signal.reason as ConnectorRefusal;
      if (value !== null) {
        const target = readTarget(value);
        return target ? { route: 'engine', target } : this.failed('malformed', `the engine route answered a malformed target for ${request.artifactId}'s ${tool.server} · ${tool.tool}`);
      }
    }
    return this.target(request.artifactId, tool, signal, this.routes.filter((route) => route.route !== 'engine'));
  }

  // The target's grant checked and its call made, the outcome read. `owner`: the page's window, re-read at the
  // backend's door (null for an agent's refresh). E3: `dataset`, the sink and its recheck, which only a read grant of a
  // read-only tool feeds.
  private async callTarget(artifactId: string, route: ConnectorRouteName, target: ConnectorRouteTarget, tool: ConnectorToolRef, args: Record<string, unknown>, use: Use, signal: AbortSignal, owner: string | null, dataset?: { sink: ConnectorDatasetSink & { requestId?: string }; publishable: () => boolean; appSessionId?: string }): Promise<ConnectorCallOutcome> {
    const named = `${artifactId}'s ${tool.server} · ${tool.tool}`;
    if ((use === 'watch' || dataset) && !target.readOnly && !target.grantBacked) return invalid('notReadOnly'); // P3-HD M3b: the grant decides below
    let authorization;
    try {
      authorization = await unlessAborted(this.authority.check(artifactId, { ...tool, fingerprint: target.fingerprint }), signal);
    } catch (error) {
      return this.failed('routeFailed', `the grant check of ${named} failed: ${boundedMessage(error)}`);
    }
    if (authorization === ABORTED || signal.aborted) return signal.reason as ConnectorRefusal;
    if (!authorization.granted) return refusal('revoked', authorization.refusal);
    if (!admits(authorization.mode, target, dataset ? 'watch' : use)) return refusal('revoked', 'wrongMode'); // E3: a dataset, as a watch
    let answer;
    try {
      // The backend's door (P3-H H4): the window re-read in the same turn as the call, so a hide no event announced while
      // the route or the grant answered aborts the work here and nothing is dispatched. P3-F F-connectors 6: the same
      // recheck goes to the route (`admit`), for its own door after awaits of its own (route D's credential preparation).
      const admitted = authorization;
      const admit = () => {
        if (owner !== null) this.recheckWindow(owner);
        return !signal.aborted;
      };
      const dispatched = Promise.resolve().then<ConnectorRouteAnswer | typeof ABORTED>(() =>
        admit() ? target.call(args, { signal, fingerprint: target.fingerprint, mode: admitted.mode, admit, ...(dataset && { dataset: dataset.sink, publishable: dataset.publishable, ...(dataset.appSessionId && { appSessionId: dataset.appSessionId }) }) /* E3 */ }) : ABORTED,
      );
      // E3 M2 residual: a dataset call, once dispatched, is settled by its route even when aborted (never raced)
      answer = await (dataset ? dispatched : unlessAborted(dispatched, signal));
    } catch (error) {
      return this.failed('toolError', `the ${route} call of ${named} threw: ${boundedMessage(error)}`);
    }
    if (answer === ABORTED || (signal.aborted && !dataset)) return signal.reason as ConnectorRefusal;
    const read = readAnswer(answer);
    if (signal.aborted && (typeof read === 'string' || !read.ok)) return signal.reason as ConnectorRefusal; // E3: nothing published
    if (read === 'malformed' || read === 'tooLarge') return this.failed(read, `the ${route} call of ${named} answered ${read === 'malformed' ? 'malformed' : 'too large a result'}`);
    if (!read.ok) {
      this.log(`connectors: the ${route} call of ${named} ${FAILURE_WORDS[read.failure]}: ${read.message}`);
      if (read.failure === 'refused') return refusal('revoked', read.refusal); // P3-H H3b: the route's own last check
      if (read.failure === 'tooLarge') return refusal('failed', 'tooLarge'); // P3-H H3b
      return read.failure === 'unavailable' ? refusal('paused', 'unavailable') : refusal('failed', 'toolError');
    }
    return { ok: true, result: read.result, fetchedAt: Date.now(), via: { route, ...(route === 'engine' && target.sessionId !== undefined ? { sessionId: target.sessionId } : {}) } };
  }

  // The first route's already-live target for `tool`, or the refusal: `noRoute` when none has it, `routeFailed` when
  // none has it and one of them failed to say, `malformed` when the route answered a malformed target.
  private async target(artifactId: string, tool: ConnectorToolRef, signal: AbortSignal, routes: readonly ConnectorRoute[] = this.routes /* E3 */): Promise<{ route: ConnectorRouteName; target: ConnectorRouteTarget } | ConnectorRefusal> {
    let broke: unknown = null;
    for (const route of routes) {
      let value;
      try {
        value = await unlessAborted(Promise.resolve().then(() => route.resolve(artifactId, { ...tool }, signal)), signal);
      } catch (error) {
        broke = error;
        continue;
      }
      if (value === ABORTED || signal.aborted) return signal.reason as ConnectorRefusal;
      if (value === null) continue;
      const target = readTarget(value);
      return target ? { route: route.route, target } : this.failed('malformed', `the ${route.route} route answered a malformed target for ${artifactId}'s ${tool.server} · ${tool.tool}`);
    }
    return broke === null ? refusal('paused', 'noRoute') : this.failed('routeFailed', `no route could be asked for ${artifactId}'s ${tool.server} · ${tool.tool}: ${boundedMessage(broke)}`);
  }

  private abort(work: Iterable<Work>, reason: ConnectorRefusal): void {
    for (const item of [...work]) item.controller.abort(reason);
  }

  private generation(key: string): number {
    return this.grantGenerations.get(key) ?? 0;
  }

  private revoked(artifactId: string, tool: ConnectorToolRef): void {
    const key = workKey(artifactId, tool);
    this.revocations.set(key, (this.revocations.get(key) ?? 0) + 1); // P3-H H3b
    const stop = refusal('revoked', 'revoked');
    this.abort([...this.agentWork.keys()].filter((work) => work.key === key), stop); // E3: an agent's refresh of it
    this.abort([...this.gestures.keys()].filter((work) => work.key === key), stop); // P3-F F-connectors 1: a grant gesture of it
    for (const lease of this.leases.values()) {
      if (lease.artifactId !== artifactId) continue;
      this.abort([...lease.work].filter((work) => work.key === key), stop);
      for (const watch of lease.watches) {
        if (watch.key !== key || watch.waitingForGrant) continue;
        this.park(watch, this.generation(key));
        this.publish(watch, stop);
      }
    }
  }

  // A grant of the tool: its waiting watches wake now, and a refresh of it in flight that comes back denied asks again.
  private granted(artifactId: string, tool: ConnectorToolRef): void {
    const key = workKey(artifactId, tool);
    this.grantGenerations.set(key, this.generation(key) + 1);
    for (const watch of this.watches.values()) if (watch.key === key && watch.waitingForGrant) this.schedule(watch);
  }

  // P3-H H3b: a waiting watch's grant re-read from the store's committed grants: a read grant of its tool there is a
  // grant (announced, as if its event had come), so the watch and its siblings wake and refresh through the full check;
  // none leaves it waiting. A read only: no route resolved, no grant checked or consumed, no engine reached. A revoke
  // heard while it read, or a grant announced meanwhile, makes the read moot.
  private async recheck(watch: Watch): Promise<void> {
    if (watch.rechecking || this.stopped) return;
    watch.rechecking = true;
    const { key, tool } = watch;
    const { artifactId } = watch.lease;
    const revocations = this.revocations.get(key) ?? 0;
    const generation = this.generation(key);
    let held: ConnectorGrant[];
    try {
      held = await this.authority.list(artifactId);
    } catch (error) {
      this.log(`connectors: the grants of ${artifactId} could not be re-read: ${boundedMessage(error)}`);
      return;
    } finally {
      watch.rechecking = false;
    }
    if (this.stopped || !this.watches.has(watch.id) || !watch.waitingForGrant || this.revoking.has(key)) return;
    if ((this.revocations.get(key) ?? 0) !== revocations || this.generation(key) !== generation) return;
    if (held.some((grant) => grant.server === tool.server && grant.tool === tool.tool && grant.mode === 'read')) this.granted(artifactId, tool);
  }

  // E3 M3 fix (the architect's watch priority ruling): at the cap, the oldest dormant E3 dataset watch (its surface hidden,
  // nothing running) ends, so a visible request is served; H's generic watches and visible ones never yield. Its owner
  // finds it gone (`refreshWatch` false) when shown and registers it again. True when one ended.
  private yieldDormantDataset(): boolean {
    for (const watch of this.watches.values()) {
      if (!watch.dataset || watch.running || this.visible(watch.lease)) continue;
      this.end(watch);
      return true;
    }
    return false;
  }

  // The watch waits, timerless, for a grant after `generation`.
  private park(watch: Watch, generation: number): void {
    watch.waitingForGrant = true;
    watch.waitingSince = generation;
    clearTimeout(watch.timer);
    delete watch.timer;
  }

  // A wait a grant has since answered is over: the watch is due at once.
  private wakeIfGranted(watch: Watch): void {
    if (!watch.waitingForGrant || this.generation(watch.key) === watch.waitingSince) return;
    watch.waitingForGrant = false;
    delete watch.endedAt;
  }

  // Arms the watch's next refresh: at once when it has not run or is overdue, else when it falls due; nothing while
  // hidden, waiting for a grant or running.
  private schedule(watch: Watch): void {
    clearTimeout(watch.timer);
    delete watch.timer;
    this.wakeIfGranted(watch);
    if (!this.visible(watch.lease) || watch.waitingForGrant || watch.running || !this.watches.has(watch.id)) return;
    const delay = watch.endedAt === undefined ? 0 : Math.max(0, watch.endedAt + watch.intervalMs - Date.now());
    watch.timer = setTimeout(() => void this.refresh(watch), delay);
  }

  private async refresh(watch: Watch): Promise<void> {
    delete watch.timer;
    if (watch.running || watch.waitingForGrant || !this.visible(watch.lease) || !this.watches.has(watch.id)) return;
    const { lease } = watch;
    const work = this.work(lease, watch.tool);
    const generation = this.generation(watch.key);
    watch.running = work;
    const outcome = await this.run(lease, watch.tool, watch.args, 'watch', work, watch.dataset);
    delete watch.running;
    this.recheckWindow(lease.owner); // P3-H H4: at publication, a hide no event announced aborts it still
    // The publication fence, checked now rather than when the run ended: a hide, close, unwatch or revoke since then
    // (another watch's listener, say) has aborted the work, which is still registered, or changed what it would check.
    // P3-F F-connectors 2: the budget's end alone is no such abort: the refresh ended, and its outcome is published.
    const cancelled = work.controller.signal.aborted && !work.expired;
    if (cancelled || !this.watches.has(watch.id) || !this.visible(lease) || watch.waitingForGrant) {
      lease.work.delete(work);
      this.schedule(watch); // a hide's watch is due again once shown; a revoke's waits; a closed one is gone
      return;
    }
    const denied = !outcome.ok && outcome.state === 'revoked';
    if (denied && this.generation(watch.key) !== generation) {
      // the denial read the grant from before a grant that has since arrived: obsolete, so unpublished, and asked again
      lease.work.delete(work);
      delete watch.endedAt;
      this.schedule(watch);
      return;
    }
    this.publish(watch, outcome);
    lease.work.delete(work);
    if (!outcome.ok && outcome.state === 'invalid') {
      this.end(watch);
      return;
    }
    if (denied) {
      if (!watch.waitingForGrant) this.park(watch, generation);
      this.schedule(watch); // wakes it if the listener's own gesture granted meanwhile
      return;
    }
    watch.endedAt = Date.now();
    this.schedule(watch);
  }

  // Main's own words for a failure go to its log; the page reads the reason alone.
  private failed(reason: Extract<ConnectorRefusal, { state: 'failed' }>['reason'], detail: string): ConnectorRefusal {
    this.log(`connectors: ${detail}`);
    return refusal('failed', reason);
  }

  private publish(watch: Watch, update: ConnectorCallOutcome): void {
    try {
      watch.listener(update);
    } catch (error) {
      this.log(`a connector watch's listener threw: ${boundedMessage(error)}`);
    }
  }

  private end(watch: Watch): void {
    clearTimeout(watch.timer);
    delete watch.timer;
    watch.running?.controller.abort(refusal('paused', 'closed'));
    this.watches.delete(watch.id);
    watch.lease.watches.delete(watch);
  }

  private dispose(lease: Lease): void {
    this.leases.delete(lease.id);
    for (const watch of [...lease.watches]) this.end(watch);
    this.abort(lease.work, refusal('paused', 'closed'));
  }

  // P3-H H4: visible while its surface is and its window is shown; an owner whose window main never reported is hidden.
  private visible(lease: Lease): boolean {
    return lease.surfaceVisible && this.windowShown.get(lease.owner) === true;
  }

  // A lease's visibility as it is now, against `was`: shown, its watches fall due (a due one catches up once) and those
  // waiting for a grant re-read it; hidden, its timers stop and its work in flight answers paused.
  private changed(lease: Lease, was: boolean): void {
    const now = this.visible(lease);
    if (now === was) return;
    if (now) {
      for (const watch of lease.watches) this.schedule(watch);
      for (const watch of lease.watches) if (watch.waitingForGrant) void this.recheck(watch); // P3-H H3b
    } else {
      for (const watch of lease.watches) clearTimeout(watch.timer);
      this.abort(lease.work, refusal('paused', 'hidden'));
    }
  }

  private leaseOf(owner: string, leaseId: string): Lease | undefined {
    const lease = typeof leaseId === 'string' ? this.leases.get(leaseId) : undefined;
    return lease !== undefined && lease.owner === owner ? lease : undefined;
  }

  private watchOf(owner: string, leaseId: string, watchId: string): Watch | undefined {
    const lease = this.leaseOf(owner, leaseId);
    const watch = typeof watchId === 'string' ? this.watches.get(watchId) : undefined;
    return lease !== undefined && watch?.lease === lease ? watch : undefined;
  }
}

// A run's outcome once its work ended: an aborted work's is its abort's refusal, except (E3 M2 residual) the durable
// end of a dataset publication its host had admitted before the abort, which stands.
function settledBy(work: Work, outcome: ConnectorCallOutcome, sink: ConnectorDatasetSink | null | undefined): ConnectorCallOutcome {
  const { signal } = work.controller;
  return signal.aborted && !(sink && outcome.ok) ? (signal.reason as ConnectorRefusal) : outcome;
}

// E3 M2 fix: a dataset work's one budget, from now: at its end the work is aborted (and so no longer publishable).
// Answers what lets the timer go.
function bounded(work: Work): () => void {
  const timer = setTimeout(() => {
    if (work.controller.signal.aborted) return; // stopped otherwise first: that abort stands
    work.expired = true; // P3-F F-connectors 2
    work.controller.abort(refusal('paused', 'unavailable'));
  }, CONNECTOR_OPERATION_DEADLINE_MS);
  return () => clearTimeout(timer);
}

// E3: the owner's sink from a call's options: none, the sink, or false for options that are not one.
function sinkOf(options: unknown): ConnectorDatasetSink | null | false {
  if (options === undefined) return null;
  const parsed = ConnectorCallOptionsSchema.safeParse(options);
  return parsed.success ? parsed.data.dataset : false;
}

// Whether a grant in `mode` admits this use of a tool: a watch only a read grant of a read-only tool; a call of a
// read-only tool either grant; a call of a tool that may write only an Allow once. P3-HD M3b: a grant-backed target's
// tool is of unknown annotation, so the existing grant's mode decides (a watch a read grant, a call either), the route
// proving the live tool against that mode before the write.
function admits(mode: ConnectorGrantMode, target: Pick<ConnectorRouteTarget, 'readOnly' | 'grantBacked'>, use: Use): boolean {
  const readOnly = target.readOnly || target.grantBacked === true;
  if (use === 'watch') return readOnly && mode === 'read';
  return readOnly || mode === 'once';
}
