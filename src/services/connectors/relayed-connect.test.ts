// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and the client port"; A15): the owner's
// Connect for a remote asker, through the relayed receiver, composed as mawsd composes it (./connect-outlives-asker.test.ts's
// composition: the owner over the production OAuth root, ./root.ts, with the key-file custody and the sealed store in a
// scratch directory), and `connectors.callback` answered by the service's own registration. The asker is a remote
// channel's ClientRef; its `callback.port` is its device's listener. This machine's loopback is never bound: the root's
// `listen` throws.
//
// What it proves: the connect acknowledges before any callback and completes on a relayed request arriving later,
// sealing the grant; a second Connect or Reconnect naming a port this client has armed is `busy`, and the first's late
// callback reaches only the first, and after it ended never its successor on the same port; two channels arming one port
// number each complete by their own callback alone, the other's answering 404 and settling nothing; an asker's end before its callback ends the flow, freeing the row.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientPort } from '@shared/client/port';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import { oauthIdentityOf } from '@shared/connectors/oauth-types';
import type { ConnectorServers, DirectDiscoverAnswer, DirectSource } from '@shared/ipc/schema/connectors';
import { validateCommandOutput } from '@shared/ipc/validate';
import { fileKeyCustody } from './custody';
import type { ConnectorOAuthProvider } from './oauth-provider';
import { createConnectorOwner, type ConnectorOwner } from './owner';
import { createRelayedCallbacks, type RelayedCallbacks } from './relayed-callback';
import { productionConnectorOAuth } from './root';

const ART = '11111111-1111-4111-8111-111111111111';
const AS = 'https://auth.example.com';
const sourceOf = (server: string, origin: string, sourceId: string): DirectSource => ({
  directory: '/repo', sourceId, generation: 1, server, scope: 'user', transport: 'http', path: '/Users/me/.claude.json', entryPath: ['mcpServers', server], observedAt: '2026-10-31T00:00:00.000Z', resourceUrl: `${origin}/mcp`,
});
const NOTES = sourceOf('notes', 'https://notes.example.com', '22222222-2222-4222-8222-222222222222');
const DOCS = sourceOf('docs', 'https://docs.example.com', '44444444-4444-4444-8444-444444444444');
const SOURCES = [NOTES, DOCS];
const TOOLS = [{ server: 'notes', tool: 'search' }, { server: 'docs', tool: 'search' }];
const DEVICE_PORT = 61_234;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
// both protected servers share one authorization server, as the flow's own tests script it (./oauth-flow.test.ts)
async function servers(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (SOURCES.some((source) => new URL(source.resourceUrl!).origin === url.origin) && url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: url.origin, authorization_servers: [AS] });
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

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await turn();
  expect(check()).toBe(true);
}

let root: string;
let directory: string;
let relayed: RelayedCallbacks;
let provider: ConnectorOAuthProvider;
let owner: ConnectorOwner;
let opened: { url: URL; client: ClientRef | null }[];
let actions: Promise<unknown>[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-relayed-connect-'));
  directory = join(root, 'connectors', 'oauth');
  opened = [];
  actions = [];
  vi.stubGlobal('fetch', vi.fn(servers));
  relayed = createRelayedCallbacks();
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
    listen: async () => {
      throw new Error('a remote asker’s Connect bound this machine’s loopback');
    },
  });
  owner = createConnectorOwner({
    direct: {
      resolveSource: async (_artifactId, server) => {
        const source = SOURCES.find((candidate) => candidate.server === server);
        return source ? { ok: true, source, tool: { fingerprint: 'f'.repeat(64), readOnly: true } } : { ok: false, why: 'unobserved' };
      },
      // a server refuses until its MAWS sign-in is saved, then lists its tools
      discover: async (source): Promise<DirectDiscoverAnswer> => ((await provider.state(oauthIdentityOf(source)!)).state === 'connected'
        ? { ok: true, tools: [{ name: 'search', readOnly: true }] }
        : { ok: false, failure: 'unavailable', reason: 'unauthorized' }),
    },
    oauth: provider,
    relayed,
    grants: async () => [],
    serversChanged: () => {},
    actionEnded: () => {},
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
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

async function rowsOf(client: ClientRef) {
  const answer: ConnectorServers = await owner.servers(ART, TOOLS, client);
  expect(validateCommandOutput('connectors.servers', answer).ok, JSON.stringify(answer)).toBe(true);
  const row = (server: string) => {
    const found = answer.servers.find((candidate) => candidate.kind === 'source' && candidate.server === server);
    if (!found || found.kind !== 'source') throw new Error(`no source row for ${server}`);
    return found;
  };
  return { notes: row('notes'), docs: row('docs') };
}
const sealed = () => { try { return readdirSync(directory).filter((name) => name.endsWith('.sealed')); } catch { return []; } };
// the device's listener received the browser's redirect for the flow whose consent opened `at`, and relays it
const callbackFor = (at: number, extra = '') => {
  const { searchParams } = opened[at]!.url;
  return `${new URL(searchParams.get('redirect_uri')!).pathname}?code=c-${at}&state=${searchParams.get('state')}${extra}`;
};
const relay = (client: ClientRef, url: string, port = DEVICE_PORT) => relayed.answer(client, { port, method: 'GET', url });

describe('a remote asker’s Connect through the relayed callback', () => {
  it('acknowledges before any callback, registers the device’s port, and completes on a relayed request arriving later', async () => {
    const device = endableClientRef('remote:a');
    const { notes } = await rowsOf(device);
    expect(owner.connect(ART, notes.handle, device, { port: DEVICE_PORT })).toEqual({ accepted: true });
    await until(() => opened.length === 1);
    expect(opened[0]!.client).toBe(device);
    expect(opened[0]!.url.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${DEVICE_PORT}/callback`);
    expect((await rowsOf(device)).notes).toMatchObject({ action: 'connecting' });
    expect(sealed()).toEqual([]);

    expect(relay(device, '/favicon.ico')).toMatchObject({ status: 404 }); // the flow's own 404: the wait goes on
    expect(relay(device, callbackFor(0))).toMatchObject({ status: 200, body: 'MAWS is connected. You can close this window.' });
    await Promise.all(actions);
    expect(sealed()).toHaveLength(1);
    expect((await rowsOf(device)).notes).toMatchObject({ connection: { state: 'connected' }, last: { action: 'connect', ok: true, credential: 'maws' } });
    expect(relayed.armed()).toBe(0);
  });

  it('refuses a second Connect or a Reconnect whose port this client has armed, and the first’s late callback reaches only the first', async () => {
    const device = endableClientRef('remote:a');
    const { notes, docs } = await rowsOf(device);
    expect(owner.connect(ART, notes.handle, device, { port: DEVICE_PORT })).toEqual({ accepted: true });
    await until(() => opened.length === 1);
    expect(owner.connect(ART, docs.handle, device, { port: DEVICE_PORT })).toEqual({ accepted: false, why: 'busy' });
    expect(owner.reconnect(ART, docs.handle, device, { port: DEVICE_PORT })).toEqual({ accepted: false, why: 'busy' });
    expect((await rowsOf(device)).docs.action).toBeUndefined(); // the refusal started nothing
    expect(relay(device, callbackFor(0))).toMatchObject({ status: 200 });
    await Promise.all(actions);
    const rows = await rowsOf(device);
    expect(rows.notes).toMatchObject({ connection: { state: 'connected' } });
    expect(rows.docs.last).toBeUndefined();
    expect(opened).toHaveLength(1);

    // once the first ended, the port is the device's to name again (its OS may hand the same port to a later listener):
    // the first's late redirect, an old tab's success or its denial, never reaches the second, which stays pending and
    // completes with its own
    expect(owner.connect(ART, docs.handle, device, { port: DEVICE_PORT })).toEqual({ accepted: true });
    await until(() => opened.length === 2);
    expect(relay(device, callbackFor(0))).toEqual({ status: 404, body: '' });
    const { searchParams: old } = opened[0]!.url;
    expect(relay(device, `/callback?error=access_denied&state=${old.get('state')}`)).toEqual({ status: 404, body: '' });
    expect(relay(device, '/callback?code=c')).toEqual({ status: 404, body: '' }); // no state at all
    await turn();
    expect((await rowsOf(device)).docs).toMatchObject({ action: 'connecting' });
    expect(relay(device, callbackFor(1))).toMatchObject({ status: 200 });
    await Promise.all(actions);
    expect((await rowsOf(device)).docs).toMatchObject({ connection: { state: 'connected' }, last: { action: 'connect', ok: true } });
  });

  it('keeps two channels that arm one port number apart: each completes by its own callback alone', async () => {
    const a = endableClientRef('remote:a');
    const b = endableClientRef('remote:b');
    const rows = await rowsOf(a);
    expect(owner.connect(ART, rows.notes.handle, a, { port: DEVICE_PORT })).toEqual({ accepted: true });
    expect(owner.connect(ART, rows.docs.handle, b, { port: DEVICE_PORT })).toEqual({ accepted: true });
    await until(() => opened.length === 2);
    const at = (client: ClientRef) => opened.findIndex((entry) => entry.client === client);
    // a guessed port from another channel reaches nothing: its own flow is a different one
    const forA = callbackFor(at(a));
    expect(relay(endableClientRef('remote:c'), forA)).toEqual({ status: 404, body: '' });
    expect(relay(b, forA)).toEqual({ status: 404, body: '' }); // a's answer on b's channel: not b's flow's, which stays pending
    expect(relay(a, forA)).toMatchObject({ status: 200 });
    expect(relay(b, callbackFor(at(b)))).toMatchObject({ status: 200 });
    await Promise.all(actions);
    const after = await rowsOf(a);
    expect(after.notes).toMatchObject({ connection: { state: 'connected' } });
    expect(after.docs).toMatchObject({ connection: { state: 'connected' } });
  });

  it('ends a flow whose asker’s channel ended before its callback, freeing the row and its port', async () => {
    const device = endableClientRef('remote:a');
    const { notes } = await rowsOf(device);
    expect(owner.connect(ART, notes.handle, device, { port: DEVICE_PORT })).toEqual({ accepted: true });
    await until(() => opened.length === 1);
    device.end();
    await Promise.all(actions);
    const returned = endableClientRef('remote:a2'); // the device again, on its next channel
    const row = (await rowsOf(returned)).notes;
    expect(row.action).toBeUndefined();
    expect(row).toMatchObject({ last: { action: 'connect', ok: false, why: 'cancelled' } });
    expect(sealed()).toEqual([]);
    expect(relayed.armed()).toBe(0);
    expect(owner.connect(ART, row.handle, returned, { port: DEVICE_PORT })).toEqual({ accepted: true }); // pressed again
  });
});
