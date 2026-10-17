// P3-HD M3c1 fix wave: the provider's credential withdrawal against the engine host's real direct operation table
// (src/engine-host/connectors/direct-calls.ts), not a scripted close. A credential main prepared but the host has not
// yet seen (its directStart still on its way) must be refused once Disconnect or Reconnect has had the host's
// acknowledgment: the floor `connectors.directClose` carries covers every epoch main issued, not only those the host
// saw. The host side is the same harness as its own tests (real artifact store, observation cache, scripted pool whose
// wire log is the evidence); the provider runs over a scratch sealed store with a reversible stand-in sealer.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectCredential, DirectOperationOutcome, DirectSource } from '@shared/ipc/schema/connectors';
import { openDocuments, type Documents } from '../../engine-host/documents';
import { DirectCalls, type DirectStartInput } from '../../engine-host/connectors/direct-calls';
import { ScriptedPool } from '../../engine-host/connectors/direct-pool.fixture';
import { ConnectorStatusCache, connectorLaunchContext } from '../../engine-host/connectors/provenance';
import type { ConnectorOAuthFlow } from './oauth-flow';
import { createConnectorOAuthProvider, type ConnectorOAuthProvider } from './oauth-provider';
import { createConnectorOAuthStore, type ConnectorOAuthSealer } from './oauth-store';
import { oauthIdentityOf, type ConnectorOAuthGrant } from './oauth-types';

const SAVED = '11111111-1111-4111-8111-111111111111';
const FRESH = '33333333-3333-4333-8333-333333333333';
const NOW = 1_700_000_000_000;

const httpSource: DirectSource = {
  directory: '/repo', sourceId: '44444444-4444-4444-8444-444444444444', generation: 3, server: 'metrics', scope: 'user', transport: 'http',
  path: '/home/o/.claude.json', entryPath: ['mcpServers', 'metrics'], observedAt: '2026-10-17T00:00:00.000Z', resourceUrl: 'https://mcp.example.com/mcp',
};
const grant = (accessToken: string): ConnectorOAuthGrant => ({
  issuer: 'https://auth.example.com', resource: 'https://mcp.example.com', redirectUri: 'http://127.0.0.1:53100/callback',
  authorizationServer: {
    issuer: 'https://auth.example.com', authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token',
    registration_endpoint: 'https://auth.example.com/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
  },
  client: { client_id: 'client-1', redirect_uris: ['http://127.0.0.1:53100/callback'], token_endpoint_auth_method: 'none' },
  tokens: { accessToken, refreshToken: `rt-${accessToken}`, tokenType: 'Bearer', expiresAt: NOW + 3_600_000, obtainedAt: NOW },
});
const sealer: ConnectorOAuthSealer = {
  available: async () => true,
  seal: async (text) => Buffer.from(Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a)),
  open: async (sealed) => ({ text: Buffer.from(sealed.map((byte) => byte ^ 0x5a)).toString('utf8'), reseal: false }),
};

let dir: string;
let project: string;
let documents: Documents;
let pool: ScriptedPool;
let completed: string[];
let calls: DirectCalls;
let artifactId: string;
let provider: ConnectorOAuthProvider;
let connects: ((value: ConnectorOAuthGrant) => void)[];
let ids = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-hd-provider-host-'));
  project = join(dir, 'project');
  const config = join(dir, 'config');
  for (const path of [join(dir, 'home'), config, project, join(dir, 'bin'), join(dir, 'data')]) mkdirSync(path);
  writeFileSync(join(dir, 'bin', 'toy'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'bin', 'toy'), 0o755);
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ mcpServers: { usertoy: { type: 'stdio', command: 'toy', args: ['toy-server.mjs'] } } }));
  documents = openDocuments(join(dir, 'data'), () => {})!;
  const cache = new ConnectorStatusCache();
  const context = connectorLaunchContext({ appSessionId: 'app-1', launchId: 'L1', cwd: project, environment: { HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: config, PATH: join(dir, 'bin'), USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TERM: 'dumb' }, localKey: { kind: 'directory', key: project } });
  cache.observe(cache.begin(context), { mcpServers: [{ name: 'usertoy', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args: ['toy-server.mjs'] }, tools: [{ name: 'rows', annotations: { readOnly: true } }] }] });
  pool = new ScriptedPool();
  completed = [];
  calls = new DirectCalls({ cache, pool: pool as never, store: () => documents.store, completed: (id) => void completed.push(id) });
  artifactId = (await documents.store.create({ kind: 'html', title: 'Live page', content: { bytes: new TextEncoder().encode('<p>a</p>') } }, { kind: 'human' })).id;

  const store = createConnectorOAuthStore({ directory: join(dir, 'oauth'), sealer, now: () => NOW });
  await store.save(store.claim(SAVED), oauthIdentityOf(httpSource)!, grant('at-1'));
  connects = [];
  const flow: ConnectorOAuthFlow = {
    connect: () => new Promise((resolve) => void connects.push(resolve)),
    refresh: async () => ({ accessToken: 'at-rotated', refreshToken: 'rt-rotated', tokenType: 'Bearer', expiresAt: NOW + 3_600_000, obtainedAt: NOW }),
    revoke: async () => 'revoked',
  };
  // main's `connectors.directClose`, answered by the host's own withdrawal
  provider = createConnectorOAuthProvider({ store, flow, closeHost: async ({ connectionId, credentialEpoch }) => (calls.withdraw(connectionId, credentialEpoch), true), now: () => NOW, newConnectionId: () => FRESH, log: () => {} });
});
afterEach(() => {
  provider.stop();
  void calls.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

async function taken(operationId: string): Promise<DirectOperationOutcome> {
  await vi.waitFor(() => expect(completed).toContain(operationId), { interval: 1 });
  return calls.take(operationId)!;
}
// a granted read of the observed tool, started with `credential`
async function startWith(credential: DirectCredential) {
  const resolveId = nextId();
  calls.resolve({ operationId: resolveId, artifactId, directories: [project], server: 'usertoy', tool: 'rows' });
  const resolved = await taken(resolveId);
  if (resolved.kind !== 'resolve' || !resolved.answer.ready || !resolved.answer.tool) throw new Error('unresolved');
  const { source, tool } = resolved.answer;
  await documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool: 'rows', fingerprint: tool.fingerprint, mode: 'read' });
  const input: DirectStartInput = { operationId: nextId(), artifactId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy', tool: 'rows', arguments: {}, fingerprint: tool.fingerprint, mode: 'read', credential };
  calls.start(input);
  return taken(input.operationId);
}
const prepared = async () => {
  const answer = await provider.prepare({ source: httpSource, purpose: 'call', signal: new AbortController().signal });
  if (!answer.ok || !answer.credential) throw new Error('no credential');
  return answer.credential;
};

describe('a credential prepared before an acknowledged withdrawal, seen by the host only after it', () => {
  it('Disconnect: the late start is refused at the host; nothing reaches the server', async () => {
    const credential = await prepared(); // its directStart is still on its way
    expect(await provider.disconnect(SAVED)).toMatchObject({ host: 'confirmed' });
    expect(await startWith(credential)).toEqual({ kind: 'call', outcome: { ok: false, failure: 'unavailable', reason: 'credential' } });
    expect(pool.wire.filter((entry) => entry.kind === 'tools/call')).toEqual([]);
  });

  it('a rotation’s newer epoch, prepared and not yet seen, is under the floor too', async () => {
    const first = await prepared();
    provider.unauthorized({ source: httpSource, purpose: 'call', credential: { connectionId: first.connectionId, credentialEpoch: first.credentialEpoch } });
    const rotated = await prepared(); // the host confirmed the first epoch closed; this one it has not seen
    expect(rotated).toMatchObject({ connectionId: SAVED, accessToken: 'at-rotated' });
    expect(rotated.credentialEpoch).toBeGreaterThan(first.credentialEpoch);
    expect(await provider.disconnect(SAVED)).toMatchObject({ host: 'confirmed' });
    expect(await startWith(rotated)).toEqual({ kind: 'call', outcome: { ok: false, failure: 'unavailable', reason: 'credential' } });
    expect(pool.wire.filter((entry) => entry.kind === 'tools/call')).toEqual([]);
  });

  it('Reconnect: the late start under the old connection is refused once the replacement is delivered', async () => {
    const credential = await prepared();
    const replacing = provider.reconnect(httpSource);
    await vi.waitFor(() => expect(connects).toHaveLength(1));
    connects[0]!(grant('at-2'));
    expect(await replacing).toMatchObject({ ok: true, connectionId: FRESH });
    expect(await prepared()).toMatchObject({ connectionId: FRESH, accessToken: 'at-2' });
    expect(await startWith(credential)).toEqual({ kind: 'call', outcome: { ok: false, failure: 'unavailable', reason: 'credential' } });
    expect(pool.wire.filter((entry) => entry.kind === 'tools/call')).toEqual([]);
  });
});
