// P3-HD M4a: the OAuth fixture's scene-side support (e2e/support/connector-oauth.ts) on scratch files only: the phase
// control a scene writes (OAuth only on proof that no engine is alive, P3-HD Decision Log 23), the per-window counts
// it asserts from the safe log, and the secret scan it runs over evidence before retaining it. No fixture process is
// started; log lines are produced by the fixture's own request logic.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOAuthFixtureCore, OPEN_CONTROL, tokenHash, type OAuthControl } from '../../e2e/support/connector-oauth-core.mjs';
import {
  assertOpenPhase, enterOAuthPhase, enterOpenPhase, oauthFixturePaths, readControl, readOAuthLog, scanForSecrets, summarizeOAuthLog, updateOAuthControl,
  type OAuthFixturePaths,
} from '../../e2e/support/connector-oauth';

let scratch: string;
let paths: OAuthFixturePaths;
const dead = () => false;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-oauth-support-')));
  paths = oauthFixturePaths(scratch, 'series');
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('the phase control', () => {
  it('names files under the scene root per fixture id', () => {
    expect(paths).toEqual({ id: 'series', log: join(scratch, 'oauth-series.jsonl'), control: join(scratch, 'oauth-series-control.json'), secrets: join(scratch, 'oauth-series-secrets.jsonl') });
  });

  it('is open until a scene enters the OAuth phase', () => {
    expect(readControl(paths)).toEqual(OPEN_CONTROL);
    expect(() => assertOpenPhase(paths)).not.toThrow();
  });

  it('enters the OAuth phase only with proof that every named engine is gone', () => {
    expect(() => enterOAuthPhase(paths, { enginePids: [] }, { alive: dead })).toThrow(/no engine was named/);
    expect(() => enterOAuthPhase(paths, { enginePids: [101, 102] }, { alive: (pid) => pid === 102 })).toThrow(/engine 102 is still alive/);
    expect(readControl(paths)).toEqual(OPEN_CONTROL); // a refusal writes nothing
    const control = enterOAuthPhase(paths, { enginePids: [101, 102] }, { alive: dead });
    expect(control).toEqual({ seq: 1, phase: 'oauth', accessTtlSeconds: 3600, revocation: 'available' });
    expect(readControl(paths)).toEqual(control);
    expect(() => assertOpenPhase(paths)).toThrow(/OAuth phase/);
  });

  it('checks liveness with the real process table by default', () => {
    expect(() => enterOAuthPhase(paths, { enginePids: [process.pid] })).toThrow(/still alive/);
  });

  it('returns to the open phase, bumping the window, and keeps the other settings', () => {
    enterOAuthPhase(paths, { enginePids: [101] }, { alive: dead, accessTtlSeconds: 5 });
    expect(enterOpenPhase(paths)).toEqual({ seq: 2, phase: 'open', accessTtlSeconds: 5, revocation: 'available' });
    expect(() => assertOpenPhase(paths)).not.toThrow();
  });

  it('updates the token lifetime and revocation without changing the phase', () => {
    expect(updateOAuthControl(paths, { revocation: 'unavailable' })).toEqual({ seq: 1, phase: 'open', accessTtlSeconds: 3600, revocation: 'unavailable' });
    enterOAuthPhase(paths, { enginePids: [101] }, { alive: dead });
    expect(updateOAuthControl(paths, { accessTtlSeconds: 2 })).toEqual({ seq: 3, phase: 'oauth', accessTtlSeconds: 2, revocation: 'unavailable' });
  });

  it('replaces the control file whole, leaving no temporary file beside it', () => {
    enterOAuthPhase(paths, { enginePids: [101] }, { alive: dead });
    enterOpenPhase(paths);
    expect(readdirSync(scratch)).toEqual(['oauth-series-control.json']);
    expect(JSON.parse(readFileSync(paths.control, 'utf8'))).toEqual(readControl(paths));
  });
});

// Log lines as the server writes them: the core's entries with a time and pid, beside lines of other servers.
function scene() {
  let clock = 0;
  let minted = 0;
  const core = createOAuthFixtureCore({ id: 'series', origin: 'http://127.0.0.1:41000', now: () => clock, randomToken: () => `tok${String(++minted).padStart(4, '0')}${'y'.repeat(40)}` });
  const lines: string[] = [JSON.stringify({ at: 't', pid: 9, server: 'series', event: 'start', port: 41000 }), JSON.stringify({ at: 't', pid: 8, server: 'other', method: 'tools/call', tool: 'read_series' })];
  const secrets: string[] = [];
  const send = (control: OAuthControl, method: string, url: string, body = '', headers: Record<string, string> = {}) => {
    const out = core.handle({ method, url, headers, body }, control);
    lines.push(JSON.stringify({ at: 't', pid: 9, ...out.entry }));
    secrets.push(...out.secrets.map((secret) => JSON.stringify(secret)));
    return out;
  };
  const flush = () => {
    writeFileSync(paths.log, `${lines.join('\n')}\n`);
    writeFileSync(paths.secrets, `${secrets.join('\n')}\n`);
  };
  return { send, flush, advance: (ms: number) => { clock += ms; } };
}
const rpc = (method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
const call = rpc('tools/call', { name: 'read_series', arguments: { series: 'signups' } });
const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

function oauthRun() {
  const s = scene();
  const open = OPEN_CONTROL;
  const oauth: OAuthControl = { seq: 1, phase: 'oauth', accessTtlSeconds: 60, revocation: 'available' };
  const reopened: OAuthControl = { ...oauth, seq: 2, phase: 'open' };
  s.send(open, 'POST', '/mcp', rpc('initialize'));
  s.send(open, 'POST', '/mcp', call);
  s.send(oauth, 'POST', '/mcp', rpc('initialize'));
  s.send(oauth, 'GET', '/.well-known/oauth-protected-resource/mcp');
  s.send(oauth, 'GET', '/.well-known/oauth-authorization-server');
  const registered = JSON.parse(s.send(oauth, 'POST', '/register', JSON.stringify({ redirect_uris: ['http://127.0.0.1:52000/callback'], token_endpoint_auth_method: 'none' })).response.body) as { client_id: string };
  const verifier = 'z'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: 'http://127.0.0.1:52000/callback', state: 'the-state-value-0123456789', resource: 'http://127.0.0.1:41000/mcp' });
  const code = new URL(s.send(oauth, 'GET', `/authorize?${query.toString()}`).response.headers.location!).searchParams.get('code')!;
  const first = JSON.parse(s.send(oauth, 'POST', '/token', new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'http://127.0.0.1:52000/callback', resource: 'http://127.0.0.1:41000/mcp', client_id: registered.client_id }).toString(), formHeaders).response.body) as { access_token: string; refresh_token: string };
  s.send(oauth, 'POST', '/mcp', call, bearer(first.access_token));
  s.advance(60_000);
  s.send(oauth, 'POST', '/mcp', call, bearer(first.access_token)); // expired: refused, not answered
  const second = JSON.parse(s.send(oauth, 'POST', '/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: first.refresh_token, resource: 'http://127.0.0.1:41000/mcp', client_id: registered.client_id }).toString(), formHeaders).response.body) as { access_token: string; refresh_token: string };
  s.send(oauth, 'POST', '/mcp', call, bearer(second.access_token));
  s.send(oauth, 'POST', '/revoke', new URLSearchParams({ token: second.refresh_token, client_id: registered.client_id }).toString(), formHeaders);
  s.send(reopened, 'POST', '/mcp', rpc('tools/list'));
  s.flush();
  return { first, second, code, verifier, challenge };
}

describe('the safe log', () => {
  it('reads only this fixture’s request lines', () => {
    oauthRun();
    const entries = readOAuthLog(paths);
    expect(entries.length).toBe(14);
    expect(entries.every((entry) => entry.server === 'series' && entry.event === 'http')).toBe(true);
  });

  it('is empty before the fixture has logged', () => {
    expect(readOAuthLog(paths)).toEqual([]);
  });

  it('counts each phase window: requests, advertising, submissions per token generation, grants', () => {
    const { first, second } = oauthRun();
    const summary = summarizeOAuthLog(readOAuthLog(paths));
    expect(summary.windows.map((w) => [w.seq, w.phase, w.requests])).toEqual([[0, 'open', 2], [1, 'oauth', 11], [2, 'open', 1]]);
    const [open, oauth, reopened] = summary.windows;
    expect(open).toMatchObject({ advertised: 0, unauthorized: 0, authRoutes: 0, authorizationHeaders: 0, toolCallAttempts: 1, toolCalls: 1, rejectedBearers: {}, presentedBearers: [], mcp: { initialize: 1, 'tools/call': 1 } });
    expect(oauth).toMatchObject({
      advertised: 4, unauthorized: 2, authRoutes: 7, authorizationHeaders: 3,
      registrations: 1, authorizations: 1, codeExchanges: 1, refreshes: 1, revocations: 1, revocationsUnavailable: 0,
      toolCallAttempts: 3, toolCalls: 2, rejectedBearers: { none: 1, expired: 1 },
      toolCallsByToken: { [tokenHash(first.access_token)]: 1, [tokenHash(second.access_token)]: 1 },
      toolCallsByGeneration: { '1.1': 1, '1.2': 1 },
      presentedBearers: [tokenHash(first.access_token), tokenHash(second.access_token)], // each once, in order
      issued: [{ family: 1, generation: 1, access: tokenHash(first.access_token), refresh: tokenHash(first.refresh_token) }, { family: 1, generation: 2, access: tokenHash(second.access_token), refresh: tokenHash(second.refresh_token) }],
    });
    expect(reopened).toMatchObject({ requests: 1, advertised: 0, mcp: { 'tools/list': 1 } });
    expect(summary.open).toMatchObject({ requests: 3, advertised: 0, unauthorized: 0, authRoutes: 0 });
    expect(summary.oauth).toMatchObject({ requests: 11, toolCalls: 2 });
  });

  it('counts refusals by the fixture’s reason', () => {
    const s = scene();
    s.send({ seq: 1, phase: 'oauth', accessTtlSeconds: 60, revocation: 'unavailable' }, 'POST', '/revoke', 'token=x&client_id=y', formHeaders);
    s.send({ seq: 1, phase: 'oauth', accessTtlSeconds: 60, revocation: 'unavailable' }, 'POST', '/token', 'grant_type=refresh_token&refresh_token=nope&client_id=nobody', formHeaders);
    s.flush();
    expect(summarizeOAuthLog(readOAuthLog(paths)).windows[0]).toMatchObject({ revocations: 0, revocationsUnavailable: 1, refusals: { unavailable: 1, unknown_client: 1 } });
  });
});

describe('the secret scan', () => {
  it('names the kinds of secret a text carries, never the values', () => {
    const { first, code, verifier } = oauthRun();
    const report = scanForSecrets(paths, ['nothing here', `a page with ${first.access_token}`, `log ${code} and ${encodeURIComponent('the-state-value-0123456789')}`, verifier]);
    expect(report).toEqual({ clean: false, found: { accessToken: 1, code: 1, state: 1, codeVerifier: 1 } });
    expect(JSON.stringify(report)).not.toContain(first.access_token);
  });

  it('counts a diagnostic carrying only the PKCE challenge, raw or encoded', () => {
    const { challenge } = oauthRun();
    expect(scanForSecrets(paths, [`challenge ${challenge}`, `url ?code_challenge=${encodeURIComponent(challenge)}`, 'unrelated'])).toEqual({ clean: false, found: { codeChallenge: 2 } });
  });

  it('is clean for the safe log itself', () => {
    oauthRun();
    expect(scanForSecrets(paths, [readFileSync(paths.log, 'utf8')])).toEqual({ clean: true, found: {} });
  });

  it('refuses to call a scan clean when the fixture recorded no secrets file', () => {
    expect(() => scanForSecrets(paths, ['anything'])).toThrow(/no secrets/);
  });
});

