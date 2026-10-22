// The hub on the local runtime behind its stand-in for Access, as DC4 and DC5 meet it: the bundled Worker in Miniflare
// (configured from wrangler.jsonc, its assets and their routing included), listening on a port with its storage on
// disk, and the stand-in's proxy in front. Clients speak HTTP, SSE, and WebSockets to the proxy's URL with service
// tokens or test identities, never to the Worker directly. The Worker's own fetches to the certificate endpoint and
// the service-token API reach the stand-in in-process, through a hook a suite uses to make the API fail.
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { convertV4MiniflareOptions, Miniflare, Response as MiniflareResponse, type V4WorkerOptions } from 'miniflare';
import { inject } from 'vitest';
import { codeHelpers } from '../../local/helpers.ts';
import { startProxy, type Proxy } from '../../local/proxy.ts';
import { AccessStandin, IDENTITY_HEADER } from '../../local/standin.ts';
import type { OrgFrame } from '../../src/protocol/machine';
import { generateVapidKey } from '../../src/push/web-push';
import {
  ABORT_REASON,
  ALARM_PATH,
  BACKDATE_PATH,
  DIRECTORY_FAULT_PATH,
  LEAVE_HELD_PATH,
  LEAVE_HOLD_PATH,
  LEAVE_RELEASE_PATH,
  OFFLINE_RETRY_PATH,
  MACHINE_ABORT_PATH,
  MACHINE_FETCH_FAULT_PATH,
  MACHINE_PROBE_PATH,
  MACHINE_REPLACE_PATH,
  MEMBER_PATH,
  ORG_ROW_PATH,
  PROJECT_ARCHIVE_HOLD_PATH,
  PROJECT_BACKLOG_PATH,
  PROJECT_CALLS_PATH,
  PROJECT_FORGET_FAULT_PATH,
  PROJECT_HOLD_PATH,
  PROJECT_LEASE_PATH,
  PROJECT_LIFE_PATH,
  PROJECT_QUEUES_PATH,
  PROJECT_SEND_PATH,
  PROJECT_VISIBLE_PATH,
  PROJECT_RECEIPTS_PATH,
  PROJECTS_PATH,
  SEND_FAULT_PATH,
  REVOKE_FAULT_PATH,
  REVOKE_HELD_PATH,
  REVOKE_RELEASE_PATH,
  SEND_HOLD_PATH,
  SEND_RELEASE_PATH,
  REPORT_PATH,
  REPORT_RETRY_PATH,
  RETRY_BASE_PATH,
  SUMMARIES_BEFORE_LIVE_PATH,
  SUMMARY_AS_PREVIOUS_PATH,
  SUMMARY_FAULT_PATH,
  TIMING_PATH,
  UNREGISTER_PATH,
  WRITE_STALL_PATH,
  PROJECT_MACHINES_PATH,
} from './send-fault';

const require = createRequire(import.meta.url);
const { unstable_getMiniflareWorkerOptions } = require('wrangler') as typeof import('wrangler');

export const ORG = 'org-local';
export const ADMIN = 'owner@example.com';
const STANDIN = 'http://standin.test';

/**
 * What the Worker's fetch to the stand-in does instead of reaching it: a `Response` answered in its place, `'fail'`
 * for a fetch that never reaches it, `'lost'` for one the stand-in handled whose answer never came back (the fetch
 * fails either way), or null to proceed.
 */
type Effect = Response | 'lost' | 'fail' | null;
export type Fault = (request: Request) => Effect | Promise<Effect>;
export type Push = { endpoint: string; headers: Record<string, string>; body: Uint8Array };

export type LocalHub = Awaited<ReturnType<typeof startLocalHub>>;

export async function startLocalHub() {
  const standin = await AccessStandin.create({ issuer: `${STANDIN}/standin`, audience: 'aud-desk-local', account: 'acct-local' });
  const persist = mkdtempSync(join(tmpdir(), 'desk-hub-state-'));
  const vars = {
    ORG_ID: ORG,
    ORG_NAME: 'Local org',
    ORG_ADMIN_EMAIL: ADMIN,
    ACCESS_ISSUER: standin.issuer,
    ACCESS_AUD: standin.audience,
    ACCESS_CERTS_URL: `${STANDIN}/standin/certs`,
    CF_API_URL: `${STANDIN}/standin/client/v4`,
    CF_ACCOUNT_ID: standin.account,
    CF_API_TOKEN: standin.apiToken,
    // Generated for this run, never committed (the deployed key is a Worker secret).
    VAPID_KEY: await generateVapidKey(),
  };
  const faults: Fault[] = [];
  /** Pushes the Worker sent to a push service at `https://push.test/…`, which answers 201 unless told otherwise. */
  const pushes: Push[] = [];
  const pushAnswers = new Map<string, number>();
  const outbound = async (request: Request): Promise<Response> => {
    if (new URL(request.url).hostname === 'push.test') {
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => (headers[name] = value));
      pushes.push({ endpoint: request.url, headers, body: new Uint8Array(await request.arrayBuffer()) });
      return new Response(null, { status: pushAnswers.get(request.url) ?? 201 });
    }
    let effect: Effect = null;
    for (const fault of faults) if ((effect = await fault(request)) !== null) break;
    if (effect instanceof Response) return effect;
    if (effect === 'fail') throw new Error('the stand-in is unreachable (a fault the suite set)');
    const response = (await standin.handle(request)) ?? new Response('no outbound fetch beyond the stand-in', { status: 502 });
    if (effect === 'lost') throw new Error('the answer was lost on its way back (a fault the suite set)');
    return response;
  };

  // workerd's own log lines. A line a suite said it expects (`expectRuntimeLog`) is kept for it to assert and not
  // printed, as is the hub's own record of a machine's stream and of a project's failed frame or send
  // (`{"desk":"machine-stream",…}`, `{"desk":"project",…}`, a few per test, many where a suite injects failures); every
  // other goes out as Miniflare's default handler would print it, so an unexpected error stays visible. The Registry's
  // record of a failed push of the directory (`{"desk":"registry",…}`) is kept the same way.
  const runtimeLogs: Array<{ level: string; message: string }> = [];
  const expectedLogs: RegExp[] = [/^\{"desk":"(machine-stream|project|registry)"/];
  const handleStructuredLogs = ({ level, message }: { level: string; message: string }) => {
    if (expectedLogs.some((pattern) => pattern.test(message))) return void runtimeLogs.push({ level, message });
    if (level === 'error' || level === 'warn') console.error(message);
    else console.log(message);
  };

  const { workerOptions } = unstable_getMiniflareWorkerOptions(resolve(import.meta.dirname, '../../wrangler.jsonc'));
  const picked = workerOptions as Pick<V4WorkerOptions, 'durableObjects' | 'compatibilityDate' | 'compatibilityFlags' | 'bindings' | 'assets'>;
  let port = 0;
  const start = async () => {
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        host: '127.0.0.1',
        port,
        handleStructuredLogs,
        resourcePersistencePath: persist,
        workers: [
          {
            name: 'desk-hub',
            durableObjects: picked.durableObjects,
            compatibilityDate: picked.compatibilityDate,
            compatibilityFlags: picked.compatibilityFlags,
            assets: picked.assets,
            modules: true,
            scriptPath: inject('hubScript'),
            modulesRoot: dirname(inject('hubScript')),
            bindings: { ...picked.bindings, ...vars },
            outboundService: async (request) => {
              const response = await outbound(request as unknown as Request);
              const headers: Record<string, string> = {};
              response.headers.forEach((value, name) => (headers[name] = value));
              return new MiniflareResponse(await response.arrayBuffer(), { status: response.status, headers });
            },
          },
        ],
      }),
    );
    const url = await mf.ready;
    port = Number(url.port);
    return mf;
  };
  let mf = await start();
  const proxy: Proxy = await startProxy({
    standin,
    upstream: () => `http://127.0.0.1:${port}`,
    extra: codeHelpers({ origin: () => proxy.url, org: ORG, standin, admin: ADMIN }),
  });

  /** A request to an object's own fetch, which only Miniflare reaches: the suites' seams. */
  const seam = async (binding: 'MACHINE' | 'PROJECT' | 'REGISTRY', name: string, path: string, body?: unknown): Promise<string> => {
    const namespace = await mf.getDurableObjectNamespace(binding);
    const response = await namespace
      .get(namespace.idFromName(binding === 'REGISTRY' ? ORG : `${ORG}:${name}`))
      .fetch(`http://seam${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`seam ${path}: ${response.status} ${text}`);
    return text;
  };

  /** A request through the stand-in, as `who` (a person's email, a service token's credentials, or nobody). */
  const fetchAs = (who: Who, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${proxy.url}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...credentials(who), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
      body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
    });

  return {
    standin,
    url: proxy.url,
    /** The Worker's fetches to the stand-in, for a fault to apply; remove what you push. */
    faults,
    fetchAs,
    mf: () => mf,
    /** Makes the machine's next send of a `kind` frame throw, as a failed RPC from a project would (the suites' Worker
     * only: test/support/worker-under-test.ts). */
    async failNextSend(machine: string, kind: string) {
      await seam('MACHINE', machine, `${SEND_FAULT_PATH}?kind=${kind}`);
    },
    pushes,
    /** A push service's answer per endpoint (201 when unset): 404 or 410 says the subscription is gone. */
    pushAnswers,
    /**
     * A request straight to a machine's object (`/stream` or `/frames`) with the identity headers the Worker sets once it
     * has verified a request: how a request the Worker admitted reaches the object late, after a revocation, say.
     */
    async machineRequest(machine: string, path: '/stream' | '/frames', headers: Record<string, string>, body?: string) {
      const namespace = await mf.getDurableObjectNamespace('MACHINE');
      const response = await namespace
        .get(namespace.idFromName(`${ORG}:${machine}`))
        .fetch(`https://machine${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Desk-Org': ORG, 'X-Desk-Machine': machine, ...headers }, body });
      const status = response.status;
      await response.body?.cancel();
      return status;
    },
    /** Shortens a machine's heartbeat and lease (and its grace, the heartbeat's unless given, and its probe); set before
     * its stream opens (the suites' Worker only). */
    async timing(machine: string, timing: { heartbeatMs: number; leaseMs: number; graceMs?: number; probeMs?: number; writeTimeoutMs?: number }) {
      const query = new URLSearchParams(Object.entries(timing).map(([name, value]) => [name, String(value)]));
      await seam('MACHINE', machine, `${TIMING_PATH}?${query}`);
    },
    /** Arms a machine's object to find itself replaced at its next probe, as one Cloudflare replaced under its stream. */
    async replace(machine: string) {
      await seam('MACHINE', machine, MACHINE_REPLACE_PATH);
    },
    /** Arms a machine's object to throw from its next request to `path` (`/frames` or `/stream`). */
    async failFetch(machine: string, path: '/frames' | '/stream') {
      await seam('MACHINE', machine, `${MACHINE_FETCH_FAULT_PATH}?path=${path}`);
    },
    /** Probes a machine's object once: its own instance, and the one its probe reached. */
    async probe(machine: string): Promise<{ life: string; current: string | null }> {
      return JSON.parse(await seam('MACHINE', machine, MACHINE_PROBE_PATH)) as { life: string; current: string | null };
    },
    /** Adds a member to the org (the suites' Worker only: the hub has no such endpoint before the org phase). */
    async addMember(email: string, role: 'admin' | 'member') {
      await seam('REGISTRY', ORG, MEMBER_PATH, { email, role });
    },
    /** Which instance of a project's object answers; a different one after an eviction or a hibernation. */
    async projectLife(project: string): Promise<string> {
      return seam('PROJECT', project, PROJECT_LIFE_PATH);
    },
    /** Rewrites the org's stored record, as an object still on a deploy's previous version would have made it. */
    async rewriteOrgRow(row: { id: string; name: string }) {
      await seam('REGISTRY', ORG, ORG_ROW_PATH, row);
    },
    /** Consume an alarm as workerd does, optionally ageing receipts to model time passing; inspect SQL directly. */
    async receiptAlarm(project: string, ageByMs = 0): Promise<{ before: number; rows: Array<{ rpc: string; updated: number }>; alarm: number | null }> {
      return JSON.parse(await seam('PROJECT', project, PROJECT_RECEIPTS_PATH, { ageByMs }));
    },
    /** How many calls machines made to a project's object, and how many frames they carried. */
    async projectCalls(project: string): Promise<{ calls: number; frames: number }> {
      return JSON.parse(await seam('PROJECT', project, PROJECT_CALLS_PATH)) as { calls: number; frames: number };
    },
    /** Hands a project a lease's renewal or close for any generation, as a late one from an older stream would come. */
    async lease(project: string, change: { op: 'renew' | 'closed'; machine: string; generation: number; leaseMs?: number }) {
      await seam('PROJECT', project, PROJECT_LEASE_PATH, { org: ORG, project, client: '', leaseMs: 0, ...change });
    },
    /**
     * Evicts an object, as Cloudflare does to an idle one: its memory is gone and the next request constructs it again.
     * With `hibernate`, its WebSockets stay open and wake it (a real hibernation); the default closes them.
     */
    async evict(className: 'Project' | 'Machine' | 'Registry', name: string, webSockets: 'close' | 'hibernate' = 'close') {
      await mf.unsafeEvictDurableObject('desk-hub', className, { name, webSockets });
    },
    /** Terminates a machine's object (`ctx.abort()`): its memory and its stream end, and nothing tells its projects.
     * `evict` cannot do this to a `Machine` with an open stream, which workerd holds as an active reference. The seam's
     * request fails with the abort's own reason, and only that failure is taken for a termination. */
    async terminate(machine: string) {
      let failure: unknown;
      try {
        await seam('MACHINE', machine, MACHINE_ABORT_PATH);
      } catch (error) {
        failure = error;
      }
      if (!(failure instanceof Error && failure.message.includes(ABORT_REASON))) {
        throw new Error(`the Machine was not terminated: ${failure === undefined ? 'its seam answered' : String(failure)}`);
      }
    },
    /** Holds the machine's next send of a `kind` frame until `releaseSend` (the suites' Worker only). */
    async holdSend(machine: string, kind: string) {
      await seam('MACHINE', machine, `${SEND_HOLD_PATH}?kind=${kind}`);
    },
    /** Stalls the machine's next write of a `kind` frame for good, as a stream whose client stopped reading never takes
     * it (the suites' Worker only); the write bound ends the stream. */
    async stallNextWrite(machine: string, kind: string) {
      await seam('MACHINE', machine, `${WRITE_STALL_PATH}?kind=${kind}`);
    },
    /** The machine streams a project fans out to: its `machines` rows. */
    async projectMachines(project: string): Promise<Array<{ name: string; generation: number }>> {
      return JSON.parse(await seam('PROJECT', project, PROJECT_MACHINES_PATH)) as Array<{ name: string; generation: number }>;
    },
    /** Releases the machine's held send, once it is held (waiting for it to be). */
    async releaseSend(machine: string) {
      const deadline = Date.now() + 10_000;
      while ((await seam('MACHINE', machine, SEND_RELEASE_PATH)) !== 'released') {
        if (Date.now() > deadline) throw new Error(`no send of ${machine} was held`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    /** Holds the answer to the machine's next revocation until `releaseRevoke`, or loses it once the revocation is
     * stored (`lose`), as a slow or a lost RPC answer would (the suites' Worker only). */
    async faultNextRevoke(machine: string, mode: 'hold' | 'lose') {
      await seam('MACHINE', machine, `${REVOKE_FAULT_PATH}?mode=${mode}`);
    },
    /** Whether the answer to a revocation of the machine is held. */
    async revokeHeld(machine: string): Promise<boolean> {
      return (await seam('MACHINE', machine, REVOKE_HELD_PATH)) === 'held';
    },
    /** Releases the held answer to the machine's revocation, once it is held (waiting for it to be). */
    async releaseRevoke(machine: string) {
      const deadline = Date.now() + 10_000;
      while ((await seam('MACHINE', machine, REVOKE_RELEASE_PATH)) !== 'released') {
        if (Date.now() > deadline) throw new Error(`no revocation of ${machine} was held`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    /** Moves a machine's `seen` or `confirmed`, a provisioning key's expiry, or a machine's pending enrollment's expiry
     * back, as the time having passed would leave them; the Registry schedules its alarm after, and the alarm is
     * answered (ms, or null). */
    async backdate(change: { machines?: Array<{ name: string; seen?: string; confirmed?: string }>; key?: { id: string; expires: string }; enrollment?: { machine: string; expires: string } }): Promise<number | null> {
      return (JSON.parse(await seam('REGISTRY', ORG, BACKDATE_PATH, change)) as { alarm: number | null }).alarm;
    },
    /** The Registry's alarm (ms, or null); with `clear`, deleted first. */
    async registryAlarm(clear = false): Promise<number | null> {
      return (JSON.parse(await seam('REGISTRY', ORG, ALARM_PATH, clear ? { clear } : undefined)) as { alarm: number | null }).alarm;
    },
    /** Sets how long an unfinished offline revocation waits before it is tried again (null: the deployed minute), and
     * wakes the Registry's alarm. */
    async offlineRetry(ms: number | null) {
      await seam('REGISTRY', ORG, OFFLINE_RETRY_PATH, { ms });
    },
    /** Holds the Registry's next `leave` (a machine's `DELETE /machine/enrollment`, once the Worker resolved it) until
     * `releaseLeave`. */
    async holdNextLeave() {
      await seam('REGISTRY', ORG, LEAVE_HOLD_PATH);
    },
    /** Whether a `leave` is held. */
    async leaveHeld(): Promise<boolean> {
      return (await seam('REGISTRY', ORG, LEAVE_HELD_PATH)) === 'held';
    },
    /** Releases the held `leave`, once it is held (waiting for it to be). */
    async releaseLeave() {
      const deadline = Date.now() + 10_000;
      while ((await seam('REGISTRY', ORG, LEAVE_RELEASE_PATH)) !== 'released') {
        if (Date.now() > deadline) throw new Error('no leave was held');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    /** Holds, or releases, a project's lookups of its archive machine (an upload of a legacy/ feed makes one). */
    async holdArchiveLookups(project: string, hold: boolean) {
      await seam('PROJECT', project, PROJECT_ARCHIVE_HOLD_PATH, { hold });
    },
    /** A project's send queues, `<machine>#<generation>#<lane>`. */
    async projectQueues(project: string): Promise<string[]> {
      return JSON.parse(await seam('PROJECT', project, PROJECT_QUEUES_PATH)) as string[];
    },
    /** Has a project queue a frame for a machine's stream of `generation`, as a reply on a retired stream is queued. */
    async projectSend(project: string, machine: string, generation: number, frame: unknown) {
      await seam('PROJECT', project, PROJECT_SEND_PATH, { machine, generation, frame });
    },
    /** Makes the machine's object throw from its next `times` calls of `directory` (0 disarms), as the Registry's push to
     * an object a code update reset fails; without `times`, arms nothing. Answers the throws still armed and the calls
     * taken since it was armed (the suites' Worker only). */
    async directoryFault(machine: string, times?: number): Promise<{ remaining: number; calls: number }> {
      return JSON.parse(await seam('MACHINE', machine, DIRECTORY_FAULT_PATH, { times })) as { remaining: number; calls: number };
    },
    /** Makes the Registry throw from the project's next `times` summary reports (0 disarms), as a report to a Registry a
     * code update reset fails; without `times`, arms nothing. Answers the throws still armed and the reports taken since
     * it was armed (the suites' Worker only). */
    async summaryFault(project: string, times?: number): Promise<{ remaining: number; calls: number }> {
      return JSON.parse(await seam('REGISTRY', ORG, SUMMARY_FAULT_PATH, { project, times })) as { remaining: number; calls: number };
    },
    /** How long the first retry of the Registry's failed pushes of the directory waits, or of a project's failed summary
     * reports (the deployed second; each retry after waits twice the one before). */
    async retryBase(of: 'registry' | { project: string }, ms: number) {
      if (of === 'registry') await seam('REGISTRY', ORG, RETRY_BASE_PATH, { ms });
      else await seam('PROJECT', of.project, RETRY_BASE_PATH, { ms });
    },
    /** Whether a retry of the project's failed summary report waits for its time (the suites' Worker only). */
    async reportRetryWaits(project: string): Promise<boolean> {
      return (JSON.parse(await seam('PROJECT', project, REPORT_RETRY_PATH)) as { waiting: boolean }).waiting;
    },
    /** Makes a project's next `forget` throw, as a failed RPC from the Registry would (the suites' Worker only). */
    async failNextForget(project: string) {
      await seam('PROJECT', project, PROJECT_FORGET_FAULT_PATH);
    },
    /** How many pages of `hello` backlogs a project has read. */
    async backlogPages(project: string): Promise<number> {
      return JSON.parse(await seam('PROJECT', project, PROJECT_BACKLOG_PATH)) as number;
    },
    /** Holds, or releases, a project's `hello`s at their registration. */
    async holdHellos(project: string, hold: boolean) {
      await seam('PROJECT', project, PROJECT_HOLD_PATH, { hold });
    },
    /** Shortens how long a socket's `visibility` holds a project's pushes back (90 s deployed). */
    async visibleWindow(project: string, ms: number) {
      await seam('PROJECT', project, PROJECT_VISIBLE_PATH, { ms });
    },
    /** Drops a project's row from the Registry, as a hub from before machine projects never held one. */
    async unregister(id: string) {
      await seam('REGISTRY', ORG, UNREGISTER_PATH, { id });
    },
    /** Hands the Registry a project's summary report, as one delivered late would arrive; the org's directory after. */
    async report(project: string, report: unknown): Promise<OrgFrame> {
      return JSON.parse(await seam('REGISTRY', ORG, REPORT_PATH, { project, report })) as OrgFrame;
    },
    /** Drops `live` from the Registry's `summaries`, as a registry stored before it; evict the Registry next, and its
     * construction adds the column again. */
    async summariesBeforeLive() {
      await seam('REGISTRY', ORG, SUMMARIES_BEFORE_LIVE_PATH);
    },
    /** Has the Registry take its next summary report as the version before `live` did: stored without it, answered with
     * nothing. */
    async nextSummaryAsPrevious() {
      await seam('REGISTRY', ORG, SUMMARY_AS_PREVIOUS_PATH);
    },
    /** Puts `count` projects straight into the Registry, with long names. */
    async addProjects(count: number, prefix: string) {
      await seam('REGISTRY', ORG, PROJECTS_PATH, { count, prefix });
    },
    /** Takes workerd's log lines matching `pattern` out of the output, kept in `runtimeLogs` for the suite to assert. */
    expectRuntimeLog(pattern: RegExp) {
      expectedLogs.push(pattern);
    },
    runtimeLogs,
    /** Stops the runtime and starts it again on its stored state, as a redeploy does: every object restarts and every
     * connection drops. */
    async restart() {
      await mf.dispose();
      mf = await start();
    },
    async close() {
      await proxy.close();
      await mf.dispose();
      rmSync(persist, { recursive: true, force: true });
    },
  };
}

export type Who = string | { clientId: string; clientSecret: string } | null;

export function credentials(who: Who): Record<string, string> {
  if (who === null) return {};
  if (typeof who === 'string') return { [IDENTITY_HEADER]: who };
  return { 'CF-Access-Client-Id': who.clientId, 'CF-Access-Client-Secret': who.clientSecret };
}
