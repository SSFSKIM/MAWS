// P5 O4 D42 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md): a Connect whose asking client ended after the
// authorization URL opened is the machine's to its deadline. Composed as mawsd composes it: the owner over the
// production OAuth root (./root.ts: the key-file custody and sealed store in a scratch directory, the flow, the
// provider), with an injected loopback listener, client port and fetch standing in for the socket, the browser
// hand-off and the protected server with its authorization server. Nothing is bound or sent.
//
// (a) The consent completed after the asker left seals the grant and announces the row `connected`, never a stuck
//     `connecting`; (b) the loopback listener is closed after completion, and a flow never called back closes it at the
//     flow's deadline.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientPort } from '@shared/client/port';
import { SEALED_FORMAT_V2 } from '@shared/connectors/sealer';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import { oauthIdentityOf } from '@shared/connectors/oauth-types';
import type { ConnectorServers, DirectDiscoverAnswer, DirectSource } from '@shared/ipc/schema/connectors';
import { validateCommandOutput } from '@shared/ipc/validate';
import { fileKeyCustody } from './custody';
import type { LoopbackReply, LoopbackRequest } from './oauth-callback';
import { CONNECT_CALLBACK_TIMEOUT_MS } from './oauth-flow';
import type { ConnectorOAuthProvider } from './oauth-provider';
import { productionConnectorOAuth } from './root';
import { createConnectorOwner, type ConnectorOwner } from './owner';

const ART = '11111111-1111-4111-8111-111111111111';
const MCP = 'https://mcp.example.com';
const AS = 'https://auth.example.com';
const SOURCE: DirectSource = {
  directory: '/repo', sourceId: '22222222-2222-4222-8222-222222222222', generation: 1, server: 'notes', scope: 'user', transport: 'http',
  path: '/Users/me/.claude.json', entryPath: ['mcpServers', 'notes'], observedAt: '2026-10-31T00:00:00.000Z', resourceUrl: `${MCP}/mcp`,
};
const IDENTITY = oauthIdentityOf(SOURCE)!;
const TOOLS = [{ server: 'notes', tool: 'search' }];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
// the protected server and its authorization server, as the flow's own tests script them (./oauth-flow.test.ts)
async function servers(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.origin === MCP && url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: MCP, authorization_servers: [AS] });
  if (url.origin === AS && url.pathname === '/.well-known/oauth-authorization-server') {
    return json({
      issuer: AS, authorization_endpoint: `${AS}/authorize`, token_endpoint: `${AS}/token`, registration_endpoint: `${AS}/register`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  }
  if (url.origin === AS && url.pathname === '/register') {
    const sent = JSON.parse(String(init?.body)) as { redirect_uris: string[] };
    return json({ client_id: 'client-1', redirect_uris: sent.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'MAWS' });
  }
  if (url.origin === AS && url.pathname === '/token') return json({ access_token: 'at-1', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-1' });
  return new Response('not found', { status: 404 });
}

// A real turn of the event loop (the store and the custody do file I/O), whichever timers are faked.
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 1_000 && !check(); i++) await turn();
  expect(check()).toBe(true);
}

let root: string;
let directory: string;
let provider: ConnectorOAuthProvider;
let owner: ConnectorOwner;
let handle: ((request: LoopbackRequest) => LoopbackReply) | null;
let listening: number; // listeners bound and not yet closed
let opened: { url: URL; client: ClientRef | null }[];
let actions: Promise<unknown>[]; // the owner's actions, tracked until they end
let sent: string[]; // the owner's `connectors.serversChanged`, by artifact id

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-connect-outlives-asker-'));
  directory = join(root, 'connectors', 'oauth');
  handle = null;
  listening = 0;
  opened = [];
  actions = [];
  sent = [];
  vi.stubGlobal('fetch', vi.fn(servers));
  const openExternal: ClientPort['openExternal'] = async (client, target) => {
    if (!('url' in target)) throw new Error('not a URL');
    opened.push({ url: new URL(target.url), client });
    return { opened: true };
  };
  provider = productionConnectorOAuth({
    closeHost: async () => true,
    log: () => {},
    port: { openExternal },
    custody: fileKeyCustody(directory, { excludeFromBackup: async () => true }),
    directory,
    listen: async (handler) => {
      handle = handler;
      listening += 1;
      return { port: 53_100, close: async () => { listening -= 1; handle = null; } };
    },
  });
  owner = createConnectorOwner({
    direct: {
      resolveSource: async (_artifactId, server) => (server === SOURCE.server ? { ok: true, source: SOURCE, tool: { fingerprint: 'f'.repeat(64), readOnly: true } } : { ok: false, why: 'unobserved' }),
      // the server refuses until MAWS's own sign-in is saved, then lists its tools
      discover: async (): Promise<DirectDiscoverAnswer> => ((await provider.state(IDENTITY)).state === 'connected'
        ? { ok: true, tools: [{ name: 'search', readOnly: true }] }
        : { ok: false, failure: 'unavailable', reason: 'unauthorized' }),
    },
    oauth: provider,
    grants: async () => [],
    serversChanged: (artifactId) => void sent.push(artifactId),
    track: (action) => {
      actions.push(action);
      return action;
    },
    log: () => {},
  });
});
afterEach(() => {
  owner.stop();
  provider.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

async function rowOf(client: ClientRef) {
  const answer: ConnectorServers = await owner.servers(ART, TOOLS, client);
  expect(validateCommandOutput('connectors.servers', answer).ok, JSON.stringify(answer)).toBe(true);
  const row = answer.servers[0];
  if (!row || row.kind !== 'source') throw new Error('no source row');
  return row;
}
const sealedRecords = () => { try { return readdirSync(directory).filter((name) => name.endsWith('.sealed')); } catch { return []; } };

// The asker reads its row and asks Connect; another window has the same artifact's rows open. The asker ends once the
// authorization URL was handed to it, as an app quit after the browser opened.
async function connectThenAskerEnds(): Promise<void> {
  const asker = endableClientRef('page:1');
  const other = endableClientRef('page:2');
  await rowOf(other);
  expect(owner.connect(ART, (await rowOf(asker)).handle, asker)).toEqual({ accepted: true });
  await until(() => opened.length === 1);
  expect(opened[0]!.client).toBe(asker);
  asker.end();
}

describe('a Connect whose asker ended after the URL opened (D42)', () => {
  it('completes on the callback, seals the grant, announces the row connected and closes its listener', async () => {
    await connectThenAskerEnds();
    await turn();
    const returning = endableClientRef('page:3'); // the asker's app, back
    expect(await rowOf(returning)).toMatchObject({ action: 'connecting' }); // still the machine's: not cancelled by the asker's end
    expect(listening).toBe(1);

    sent = [];
    const { searchParams } = opened[0]!.url;
    const reply = handle!({ method: 'GET', url: `${new URL(searchParams.get('redirect_uri')!).pathname}?code=c-1&state=${searchParams.get('state')}` });
    expect(reply.status).toBe(200);
    await Promise.all(actions);

    const [record] = sealedRecords();
    expect(sealedRecords()).toHaveLength(1);
    expect(readFileSync(join(directory, record!), 'utf8').split('\n')[0]).toBe(SEALED_FORMAT_V2);
    expect(sent).toContain(ART); // the window still open hears it
    const row = await rowOf(returning);
    expect(row.action).toBeUndefined();
    expect(row).toMatchObject({ connection: { state: 'connected', connectionId: record!.replace('.sealed', '') }, last: { action: 'connect', ok: true, credential: 'maws' } });
    expect(listening).toBe(0);
    expect(handle).toBeNull();
  });

  it('a flow never called back closes its listener at the flow’s deadline, sealing nothing, and the row is freed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // the file I/O keeps its real turns
    await connectThenAskerEnds();
    await vi.advanceTimersByTimeAsync(CONNECT_CALLBACK_TIMEOUT_MS - 1);
    expect(listening).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => listening === 0);
    await Promise.all(actions);
    expect(handle).toBeNull();
    expect(sealedRecords()).toEqual([]);
    const row = await rowOf(endableClientRef('page:3'));
    expect(row.action).toBeUndefined();
    expect(row).toMatchObject({ last: { action: 'connect', ok: false, why: 'timeout' } });
  });
});
