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
import { startProxy, type Proxy } from '../../local/proxy.ts';
import { AccessStandin, IDENTITY_HEADER } from '../../local/standin.ts';
import { generateVapidKey } from '../../src/push/web-push';
import { MACHINE_ABORT_PATH, MEMBER_PATH, PROJECT_LEASE_PATH, PROJECT_LIFE_PATH, SEND_FAULT_PATH, TIMING_PATH } from './send-fault';

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

  const { workerOptions } = unstable_getMiniflareWorkerOptions(resolve(import.meta.dirname, '../../wrangler.jsonc'));
  const picked = workerOptions as Pick<V4WorkerOptions, 'durableObjects' | 'compatibilityDate' | 'compatibilityFlags' | 'bindings' | 'assets'>;
  let port = 0;
  const start = async () => {
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        host: '127.0.0.1',
        port,
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
  const proxy: Proxy = await startProxy({ standin, upstream: () => `http://127.0.0.1:${port}` });

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
    /** Shortens a machine's heartbeat and lease; set before its stream opens (the suites' Worker only). */
    async timing(machine: string, timing: { heartbeatMs: number; leaseMs: number }) {
      await seam('MACHINE', machine, `${TIMING_PATH}?heartbeatMs=${timing.heartbeatMs}&leaseMs=${timing.leaseMs}`);
    },
    /** Adds a member to the org (the suites' Worker only: the hub has no such endpoint before the org phase). */
    async addMember(email: string, role: 'admin' | 'member') {
      await seam('REGISTRY', ORG, MEMBER_PATH, { email, role });
    },
    /** Which instance of a project's object answers; a different one after an eviction or a hibernation. */
    async projectLife(project: string): Promise<string> {
      return seam('PROJECT', project, PROJECT_LIFE_PATH);
    },
    /** Hands a project a lease's renewal or close for any generation, as a late one from an older stream would come. */
    async lease(project: string, change: { op: 'renew' | 'closed'; machine: string; generation: number; leaseMs?: number }) {
      await seam('PROJECT', project, PROJECT_LEASE_PATH, { org: ORG, project, leaseMs: 0, ...change });
    },
    /**
     * Evicts an object, as Cloudflare does to an idle one: its memory is gone and the next request constructs it again.
     * With `hibernate`, its WebSockets stay open and wake it (a real hibernation); the default closes them.
     */
    async evict(className: 'Project' | 'Machine' | 'Registry', name: string, webSockets: 'close' | 'hibernate' = 'close') {
      await mf.unsafeEvictDurableObject('desk-hub', className, { name, webSockets });
    },
    /** Terminates a machine's object (`ctx.abort()`): its memory and its stream end, and nothing tells its projects.
     * `evict` cannot do this to a `Machine` with an open stream, which workerd holds as an active reference. */
    async terminate(machine: string) {
      await seam('MACHINE', machine, MACHINE_ABORT_PATH).then(
        () => {
          throw new Error('the Machine object outlived its abort');
        },
        (error: unknown) => {
          if (String(error).includes('outlived')) throw error;
        },
      );
    },
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
