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
//   hidden, and main is asked to re-read the window before any work starts, so a hide no event announced calls nothing.
// - A page calls only the server and tool pairs it declared, and a declaration grants nothing.
// - Every call, a watch's refresh included, asks the routes for an already-live target, then checks the owner's grant
//   against the fingerprint that target reports (a non-consuming check); the route's annotations, never the page, say
//   whether a tool is read-only. A read grant admits a read-only tool; a tool that may write runs only under an Allow
//   once (which the route's own last check consumes) and is never watched.
// - Work in flight belongs to its lease and its tool: hiding or closing the lease, the owner's revoke and the store's
//   committed revoke or delete abort it, answer it at once and drop whatever it later returns. A refresh stays
//   abortable until its outcome is published, so a listener that hides the page or revokes the tool while another
//   refresh's outcome waits to be published stops that one too. The owner's revoke aborts before it awaits the store,
//   and refuses new calls of the tool until the store has answered; an Allow once being consumed is the call it
//   admitted going ahead, not a revoke.
// - Watches: 30 s to 24 h, at most 64 across the whole app, one refresh at a time, the next an interval after the last
//   ended; hidden, none run, and shown, a due one catches up once. A watch with no route reads paused and asks again at
//   its interval; one with no grant waits, timerless, for a grant (a denial computed before a grant that arrived while
//   it ran is obsolete: the watch asks again rather than wait); one of a tool that is not read-only ends.
// - What a page reads of a failure is a state and a reason from a closed list (P3 Decision Log 84); the words of an
//   error, the route's or main's own, go to main's log only.
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
  // In preference order: the first that already has the tool serves. Production gives route E first and route D after
  // it, so D serves only when no eligible live engine has the server (P3-H's brief, deliverable 4).
  routes: readonly ConnectorRoute[];
  grants: ConnectorGrantAuthority;
  log?: (line: string) => void;
  // P3-H H4: main re-reads `owner`'s window, reporting any change through `setWindowShown` before it returns.
  recheckWindow?: (owner: string) => void;
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
  private stopped = false;

  constructor(options: ConnectorBrokerOptions) {
    this.routes = options.routes;
    this.authority = options.grants;
    this.log = options.log ?? ((line) => console.error(line));
    this.recheckWindow = options.recheckWindow ?? (() => {});
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

  async callTool(owner: string, leaseId: string, request: unknown): Promise<ConnectorCallOutcome> {
    const lease = this.leaseOf(owner, leaseId);
    if (!lease) return invalid('lease');
    const parsed = ConnectorCallRequestSchema.safeParse(request);
    const args = parsed.success ? argsOf(parsed.data.args) : null;
    if (!parsed.success || args === null) return invalid('request');
    const tool = { server: parsed.data.server, tool: parsed.data.tool };
    if (!lease.declared.has(connectorToolKey(tool))) return invalid('undeclared');
    const work = this.work(lease, tool);
    try {
      const outcome = await this.run(lease, tool, args, 'call', work);
      return work.controller.signal.aborted ? (work.controller.signal.reason as ConnectorRefusal) : outcome;
    } finally {
      lease.work.delete(work);
    }
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
    const watch: Watch = { id: randomUUID(), lease, tool, key: workKey(lease.artifactId, tool), args, intervalMs: clampWatchInterval(parsed.data.intervalMs), listener, waitingForGrant: false, waitingSince: 0 };
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
  refreshWatch(owner: string, leaseId: string, watchId: string): boolean {
    const watch = this.watchOf(owner, leaseId, watchId);
    if (watch) this.wakeIfGranted(watch);
    if (watch?.waitingForGrant && this.visible(watch.lease)) {
      void this.recheck(watch);
      return true;
    }
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
    this.windowShown.clear();
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

  // ── the work ──

  // A call or refresh of `tool` on `lease`, registered with the lease until its caller releases it: the caller keeps it
  // registered until its outcome is delivered, so a hide, close or revoke up to that moment still aborts it.
  private work(lease: Lease, tool: ConnectorToolRef): Work {
    return { key: workKey(lease.artifactId, tool), controller: new AbortController() };
  }

  // One run of `work`; when it was aborted, the abort's reason (a refusal) is the outcome.
  private async run(lease: Lease, tool: ConnectorToolRef, args: Record<string, unknown>, use: Use, work: Work): Promise<ConnectorCallOutcome> {
    this.recheckWindow(lease.owner); // P3-H H4: a hide no event announced is heard now, before anything is asked
    if (!this.visible(lease)) return refusal('paused', 'hidden');
    if (this.revoking.has(work.key)) return refusal('revoked', 'revoked');
    lease.work.add(work);
    const outcome = await this.attempt(lease.artifactId, tool, args, use, work.controller.signal);
    return work.controller.signal.aborted ? (work.controller.signal.reason as ConnectorRefusal) : outcome;
  }

  private async attempt(artifactId: string, tool: ConnectorToolRef, args: Record<string, unknown>, use: Use, signal: AbortSignal): Promise<ConnectorCallOutcome> {
    const named = `${artifactId}'s ${tool.server} · ${tool.tool}`;
    const found = await this.target(artifactId, tool, signal);
    if ('ok' in found) return found;
    const { route, target } = found;
    if (use === 'watch' && !target.readOnly) return invalid('notReadOnly');
    let authorization;
    try {
      authorization = await unlessAborted(this.authority.check(artifactId, { ...tool, fingerprint: target.fingerprint }), signal);
    } catch (error) {
      return this.failed('routeFailed', `the grant check of ${named} failed: ${boundedMessage(error)}`);
    }
    if (authorization === ABORTED || signal.aborted) return signal.reason as ConnectorRefusal;
    if (!authorization.granted) return refusal('revoked', authorization.refusal);
    if (!admits(authorization.mode, target.readOnly, use)) return refusal('revoked', 'wrongMode');
    let answer;
    try {
      answer = await unlessAborted(Promise.resolve().then(() => target.call(args, { signal, fingerprint: target.fingerprint, mode: authorization.mode })), signal);
    } catch (error) {
      return this.failed('toolError', `the ${route} call of ${named} threw: ${boundedMessage(error)}`);
    }
    if (answer === ABORTED || signal.aborted) return signal.reason as ConnectorRefusal;
    const read = readAnswer(answer);
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
    const outcome = await this.run(lease, watch.tool, watch.args, 'watch', work);
    delete watch.running;
    // The publication fence, checked now rather than when the run ended: a hide, close, unwatch or revoke since then
    // (another watch's listener, say) has aborted the work, which is still registered, or changed what it would check.
    if (work.controller.signal.aborted || !this.watches.has(watch.id) || !this.visible(lease) || watch.waitingForGrant) {
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

// Whether a grant in `mode` admits this use of a tool: a watch only a read grant of a read-only tool; a call of a
// read-only tool either grant; a call of a tool that may write only an Allow once.
function admits(mode: ConnectorGrantMode, readOnly: boolean, use: Use): boolean {
  if (use === 'watch') return readOnly && mode === 'read';
  return readOnly || mode === 'once';
}
