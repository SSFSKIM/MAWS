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
  };
  const faults: Fault[] = [];
  const outbound = async (request: Request): Promise<Response> => {
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
