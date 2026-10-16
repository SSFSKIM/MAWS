// P3-H H3a: main's connector broker (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24, 80 and
// 83; the P3 interface ledger's X9 amendment and X23 grant rows; P3-E's XE8). An artifact page calls and watches a
// connector's MCP tool through a page lease main holds for a trusted owner (a window) and one artifact; the owner
// grants and revokes per artifact and per tool. Everything here is main's, so it all ends with the app: nothing runs
// while the app is closed, and no timer here can acquire an engine, because a route (./route.ts) only finds what is
// already live.
//
// The rules, each enforced here rather than trusted to a caller:
// - A lease starts hidden; only its owner shows or hides it, and a hidden or closed lease calls nothing, its calls and
//   its watches alike. Only the owner that opened a lease may use it.
// - A page calls only the server and tool pairs it declared, and a declaration grants nothing.
// - Every call, a watch's refresh included, asks the routes for an already-live target, then checks the owner's grant
//   against the fingerprint that target reports (a non-consuming check); the route's annotations, never the page, say
//   whether a tool is read-only. A read grant admits a read-only tool; a tool that may write runs only under an Allow
//   once (which the route's own last check consumes) and is never watched.
// - Work in flight belongs to its lease and its tool: hiding or closing the lease, the owner's revoke and the store's
//   committed revoke or delete abort it, answer it at once and drop whatever it later returns. The owner's revoke
//   aborts before it awaits the store, and refuses new calls of the tool until the store has answered; an Allow once
//   being consumed is the call it admitted going ahead, not a revoke.
// - Watches: 30 s to 24 h, at most 64 across the whole app, one refresh at a time, the next an interval after the last
//   ended; hidden, none run, and shown, a due one catches up once. A watch with no route reads paused and asks again at
//   its interval; one with no grant waits, timerless, for a grant; one of a tool that is not read-only ends.
import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import {
  CONNECTOR_ARGS_MAX_BYTES,
  CONNECTOR_DECLARE_LIMIT,
  CONNECTOR_WATCH_LIMIT,
  ConnectorCallRequestSchema,
  ConnectorGrantGestureSchema,
  ConnectorToolRefSchema,
  ConnectorWatchRequestSchema,
  clampWatchInterval,
  connectorToolKey,
  type ConnectorCallOutcome,
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
import { boundedMessage, jsonBytes, readAnswer, readTarget, type ConnectorGrantAuthority, type ConnectorRoute, type ConnectorRouteTarget } from './route';

export interface ConnectorBrokerOptions {
  routes: readonly ConnectorRoute[]; // in preference order (Decision Log 24: route D where direct-capable, else E)
  grants: ConnectorGrantAuthority;
  log?: (line: string) => void;
}

export type ConnectorWatchListener = (update: ConnectorCallOutcome) => void;

type Use = 'call' | 'watch';

interface Lease {
  readonly id: string;
  readonly owner: string;
  readonly artifactId: string;
  visible: boolean;
  readonly declared: Map<string, ConnectorToolRef>;
  readonly work: Set<Work>;
  readonly watches: Set<Watch>;
}

// One call or refresh in flight: aborting it answers it with the abort's reason (a refusal).
interface Work {
  readonly key: string; // the artifact and the tool
  readonly controller: AbortController;
}

interface Watch {
  readonly id: string;
  readonly lease: Lease;
  readonly tool: ConnectorToolRef;
  readonly key: string;
  readonly args: Record<string, unknown>;
  readonly intervalMs: number;
  readonly listener: ConnectorWatchListener;
  waitingForGrant: boolean; // no grant admits it: no timer until the owner grants
  endedAt?: number; // when its last refresh that ran ended; the next is due an interval later
  timer?: ReturnType<typeof setTimeout>;
  running?: Work;
}

const refusal = <S extends ConnectorRefusalState>(state: S, reason: Extract<ConnectorRefusal, { state: S }>['reason'], message?: string): ConnectorRefusal =>
  ({ ok: false, state, reason, ...(message === undefined ? {} : { message }) }) as ConnectorRefusal;
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
  private readonly leases = new Map<string, Lease>();
  private readonly watches = new Map<string, Watch>();
  private readonly revoking = new Map<string, number>(); // keys whose owner's revoke the store has not answered yet
  private stopped = false;

  constructor(options: ConnectorBrokerOptions) {
    this.routes = options.routes;
    this.authority = options.grants;
    this.log = options.log ?? ((line) => console.error(line));
  }

  // ── the page's lease (relayed by the owner) ──

  // A hidden lease for `owner` on `artifactId`; the owner's own input, so a malformed one throws.
  open(owner: string, artifactId: string): string {
    if (this.stopped) throw new Error('the connector broker has stopped');
    if (typeof owner !== 'string' || owner.length === 0) throw new TypeError('a connector lease needs an owner');
    if (typeof artifactId !== 'string' || !ARTIFACT_ID.test(artifactId)) throw new TypeError('not an artifact id');
    const lease: Lease = { id: randomUUID(), owner, artifactId, visible: false, declared: new Map(), work: new Set(), watches: new Set() };
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

  async callTool(owner: string, leaseId: string, request: unknown): Promise<ConnectorCallOutcome> {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease) return invalid('lease');
    const parsed = ConnectorCallRequestSchema.safeParse(request);
    const args = parsed.success ? argsOf(parsed.data.args) : null;
    if (!parsed.success || args === null) return invalid('request');
    const tool = { server: parsed.data.server, tool: parsed.data.tool };
    if (!lease.declared.has(connectorToolKey(tool))) return invalid('undeclared');
    return (await this.run(lease, tool, args, 'call', new AbortController())).outcome;
  }

  // Starts a watch whose refreshes reach `listener` (never one dropped by a hide, close or revoke).
  watchTool(owner: string, leaseId: string, request: unknown, listener: ConnectorWatchListener): ConnectorWatchStart {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease) return invalid('lease');
    const parsed = ConnectorWatchRequestSchema.safeParse(request);
    const args = parsed.success ? argsOf(parsed.data.args) : null;
    if (!parsed.success || args === null || typeof listener !== 'function') return invalid('request');
    const tool = { server: parsed.data.server, tool: parsed.data.tool };
    if (!lease.declared.has(connectorToolKey(tool))) return invalid('undeclared');
    if (this.watches.size >= CONNECTOR_WATCH_LIMIT) return invalid('watchLimit');
    const watch: Watch = { id: randomUUID(), lease, tool, key: workKey(lease.artifactId, tool), args, intervalMs: clampWatchInterval(parsed.data.intervalMs), listener, waitingForGrant: false };
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
  // waits for a grant nor has one in flight.
  refreshWatch(owner: string, leaseId: string, watchId: string): boolean {
    const watch = this.watchOf(owner, leaseId, watchId);
    if (!watch || !watch.lease.visible || watch.waitingForGrant || watch.running) return false;
    clearTimeout(watch.timer);
    void this.refresh(watch);
    return true;
  }

  // ── the owner's controls ──

  setVisible(owner: string, leaseId: string, visible: boolean): boolean {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease || typeof visible !== 'boolean') return false;
    if (lease.visible === visible) return true;
    lease.visible = visible;
    if (visible) {
      for (const watch of lease.watches) this.schedule(watch);
    } else {
      for (const watch of lease.watches) clearTimeout(watch.timer);
      this.abort(lease.work, refusal('paused', 'hidden'));
    }
    return true;
  }

  close(owner: string, leaseId: string): boolean {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease) return false;
    this.dispose(lease);
    return true;
  }

  // The owner's window went (closed, or its renderer replaced): every lease it held closes.
  closeOwner(owner: string): void {
    for (const lease of [...this.leases.values()]) if (lease.owner === owner) this.dispose(lease);
  }

  // The app is quitting: everything closes, and nothing opens again.
  stop(): void {
    this.stopped = true;
    for (const lease of [...this.leases.values()]) this.dispose(lease);
  }

  grants(artifactId: string): Promise<ConnectorGrant[]> {
    return this.authority.list(artifactId);
  }

  // The owner's grant of one tool to one artifact, under the fingerprint the route reports now (the header's gesture
  // carries none). A read grant needs a tool the route marks read-only. A malformed gesture is a caller's bug: it throws.
  async grantTool(artifactId: string, gesture: unknown): Promise<ConnectorGrantOutcome> {
    const { server, tool, mode } = ConnectorGrantGestureSchema.parse(gesture);
    const ref = { server, tool };
    const found = await this.target(artifactId, ref, new AbortController().signal);
    if ('ok' in found) return found;
    if (mode === 'read' && !found.target.readOnly) return invalid('notReadOnly');
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

  // The store's committed grant changes (H2's `onConnectorGrantChange`), wherever they came from: a revoke (the owner's
  // in another window, or the artifact's deletion) stops the tool's work, a grant wakes its waiting watches, and an
  // Allow once consumed is the call it admitted, so it stops nothing.
  onGrantChange(change: ConnectorGrantChange): void {
    if (this.stopped) return;
    const ref = { server: change.server, tool: change.tool };
    if (change.change === 'revoked') this.revoked(change.artifactId, ref);
    else if (change.change === 'granted') this.granted(change.artifactId, ref);
  }

  // ── the work ──

  // One call of `tool` under `controller`, which the lease's hide or close or the tool's revoke aborts. `aborted` says
  // the outcome is the abort's: whoever aborted it has already dealt with what it stopped.
  private async run(lease: Lease, tool: ConnectorToolRef, args: Record<string, unknown>, use: Use, controller: AbortController): Promise<{ outcome: ConnectorCallOutcome; aborted: boolean }> {
    if (!lease.visible) return { outcome: refusal('paused', 'hidden'), aborted: false };
    const work: Work = { key: workKey(lease.artifactId, tool), controller };
    if (this.revoking.has(work.key)) return { outcome: refusal('revoked', 'revoked'), aborted: false };
    lease.work.add(work);
    try {
      const outcome = await this.attempt(lease.artifactId, tool, args, use, controller.signal);
      return controller.signal.aborted ? { outcome: controller.signal.reason as ConnectorRefusal, aborted: true } : { outcome, aborted: false };
    } finally {
      lease.work.delete(work);
    }
  }

  private async attempt(artifactId: string, tool: ConnectorToolRef, args: Record<string, unknown>, use: Use, signal: AbortSignal): Promise<ConnectorCallOutcome> {
    const found = await this.target(artifactId, tool, signal);
    if ('ok' in found) return found;
    const { route, target } = found;
    if (use === 'watch' && !target.readOnly) return invalid('notReadOnly');
    let authorization;
    try {
      authorization = await unlessAborted(this.authority.check(artifactId, { ...tool, fingerprint: target.fingerprint }), signal);
    } catch (error) {
      return this.failed('grantCheck', `the grant check of ${artifactId}'s ${tool.server} · ${tool.tool} failed`, error);
    }
    if (authorization === ABORTED || signal.aborted) return signal.reason as ConnectorRefusal;
    if (!authorization.granted) return refusal('revoked', authorization.refusal);
    if (!admits(authorization.mode, target.readOnly, use)) return refusal('revoked', 'wrongMode');
    let answer;
    try {
      answer = await unlessAborted(Promise.resolve().then(() => target.call(args, { signal, fingerprint: target.fingerprint, mode: authorization.mode })), signal);
    } catch (error) {
      return this.failed('tool', `a ${route} call of ${tool.server} · ${tool.tool} threw`, error);
    }
    if (answer === ABORTED || signal.aborted) return signal.reason as ConnectorRefusal;
    const read = readAnswer(answer);
    if (!read) return refusal('failed', 'answer');
    if (!read.ok) return read.failure === 'unavailable' ? refusal('paused', 'unavailable', read.message) : refusal('failed', 'tool', read.message);
    return { ok: true, result: read.result, fetchedAt: Date.now(), via: { route, ...(route === 'engine' && target.sessionId !== undefined ? { sessionId: target.sessionId } : {}) } };
  }

  // The first route's already-live target for `tool`, or the refusal: `noRoute` when none has it, `route` when none has
  // it and one of them failed to say, `answer` when the route answered a malformed target.
  private async target(artifactId: string, tool: ConnectorToolRef, signal: AbortSignal): Promise<{ route: ConnectorRouteName; target: ConnectorRouteTarget } | ConnectorRefusal> {
    let broke: unknown = null;
    for (const route of this.routes) {
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
      return target ? { route: route.route, target } : refusal('failed', 'answer');
    }
    return broke === null ? refusal('paused', 'noRoute') : this.failed('route', `no route could be asked for ${tool.server} · ${tool.tool}`, broke);
  }

  private abort(work: Iterable<Work>, reason: ConnectorRefusal): void {
    for (const item of [...work]) item.controller.abort(reason);
  }

  private revoked(artifactId: string, tool: ConnectorToolRef): void {
    const key = workKey(artifactId, tool);
    const stop = refusal('revoked', 'revoked');
    for (const lease of this.leases.values()) {
      if (lease.artifactId !== artifactId) continue;
      this.abort([...lease.work].filter((work) => work.key === key), stop);
      for (const watch of lease.watches) {
        if (watch.key !== key || watch.waitingForGrant) continue;
        watch.waitingForGrant = true;
        clearTimeout(watch.timer);
        this.publish(watch, stop);
      }
    }
  }

  private granted(artifactId: string, tool: ConnectorToolRef): void {
    const key = workKey(artifactId, tool);
    for (const watch of this.watches.values()) {
      if (watch.key !== key || !watch.waitingForGrant) continue;
      watch.waitingForGrant = false;
      delete watch.endedAt;
      this.schedule(watch);
    }
  }

  // Arms the watch's next refresh: at once when it has not run or is overdue, else when it falls due; nothing while
  // hidden, waiting for a grant or running.
  private schedule(watch: Watch): void {
    clearTimeout(watch.timer);
    delete watch.timer;
    if (!watch.lease.visible || watch.waitingForGrant || watch.running || !this.watches.has(watch.id)) return;
    const delay = watch.endedAt === undefined ? 0 : Math.max(0, watch.endedAt + watch.intervalMs - Date.now());
    watch.timer = setTimeout(() => void this.refresh(watch), delay);
  }

  private async refresh(watch: Watch): Promise<void> {
    delete watch.timer;
    if (watch.running || watch.waitingForGrant || !watch.lease.visible || !this.watches.has(watch.id)) return;
    const work = { key: watch.key, controller: new AbortController() };
    watch.running = work;
    const { outcome, aborted } = await this.run(watch.lease, watch.tool, watch.args, 'watch', work.controller);
    delete watch.running;
    if (!this.watches.has(watch.id)) return;
    if (aborted) {
      this.schedule(watch); // a hide dropped it: due again once shown (a revoke's watch waits; a close's is gone)
      return;
    }
    this.publish(watch, outcome);
    if (!outcome.ok && outcome.state === 'invalid') {
      this.end(watch);
      return;
    }
    if (!outcome.ok && outcome.state === 'revoked') {
      watch.waitingForGrant = true;
      return;
    }
    watch.endedAt = Date.now();
    this.schedule(watch);
  }

  // Main's own failure: logged with its error, answered to the page by its reason alone (an error's words may carry a
  // path or a store's detail that the page has no business reading).
  private failed(reason: 'tool' | 'grantCheck' | 'route', what: string, error: unknown): ConnectorRefusal {
    this.log(`connectors: ${what}: ${boundedMessage(error)}`);
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

// Whether a grant in `mode` admits this use of a tool: a watch only a read grant of a read-only tool; a call of a
// read-only tool either grant; a call of a tool that may write only an Allow once.
function admits(mode: ConnectorGrantMode, readOnly: boolean, use: Use): boolean {
  if (use === 'watch') return readOnly && mode === 'read';
  return readOnly || mode === 'once';
}
