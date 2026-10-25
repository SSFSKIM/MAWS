// P4-AGG's Discover group, the connectors half (`pnpm e2e:discover`, MAWS_DISCOVER_E2E=1; the spec skips itself
// otherwise): docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md.
//   oauth fixture, engine mode: M1's proof that the toy OAuth fixture can serve the engine's own sign-in (acceptance 9).
//            Started in engine mode, it is in its OAuth phase with no engine-PID gate; a plain HTTP client registers the
//            engine's `http://localhost:<port>/callback`, is redirected there with a code and the state, exchanges it
//            and reads the MCP resource with the token. Around it, the Keychain custody of a scratch configuration
//            directory: its exact item (fact 2) absent before and claimed, then released after (no engine ran), the
//            Keychain left as it was found.
//   spike:   M4's sign-in spike (spikes/p4-aggregator/m4-signin-spike.mjs), run on the Mac lane only (Decision Log 6):
//            the engine under the runner's HOME and a scratch CLAUDE_CONFIG_DIR, the fixture in engine mode, the one
//            Keychain item that directory names claimed before and released after every engine the probe started has
//            exited. The test records the answers; the verdict is read from them (it passes whatever they are, once the
//            Keychain is left as found).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { engineKeychainCustody, readOAuthLog, startOAuthFixture, summarizeOAuthLog, type OAuthFixture } from './support/connector-oauth';
import { isAlive } from './support/processes';
import { realEngine } from './support/real-engine';

test.skip(process.env.MAWS_DISCOVER_E2E !== '1', 'the Discover e2e runs under pnpm e2e:discover (MAWS_DISCOVER_E2E=1)');

let root: string;
let fixture: OAuthFixture | null = null;
test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-discover-oauth-'));
});
test.afterEach(async () => {
  await fixture?.close();
  fixture = null;
  rmSync(root, { recursive: true, force: true });
});

test('oauth fixture, engine mode: a localhost-redirect token exchange from a plain client, the Keychain left as found', async () => {
  const custody = engineKeychainCustody(join(root, 'claude-config'));
  custody.claim();
  fixture = await startOAuthFixture({ root, id: 'engine', mode: 'engine' });
  const { origin, resourceUrl } = fixture;
  const post = (path: string, body: string, headers: Record<string, string>) => fetch(`${origin}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  const rpc = (method: string) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} });

  const unauthorized = await post('/mcp', rpc('tools/list'), { 'content-type': 'application/json' });
  expect(unauthorized.status).toBe(401); // the OAuth phase from the start: no engine-PID gate
  expect(unauthorized.headers.get('www-authenticate')).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);

  const callback = 'http://localhost:53682/callback'; // the engine's own listener's shape; nothing needs to listen
  const registered = await post('/register', JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'Claude Code (engine)' }), { 'content-type': 'application/json' });
  expect(registered.status).toBe(201);
  const clientId = ((await registered.json()) as { client_id: string }).client_id;

  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: callback, state, resource: resourceUrl });
  const authorized = await fetch(`${origin}/authorize?${query}`, { redirect: 'manual' });
  expect(authorized.status).toBe(302);
  const location = new URL(authorized.headers.get('location')!);
  expect(`${location.origin}${location.pathname}`).toBe(callback);
  expect(location.searchParams.get('state')).toBe(state);

  const exchanged = await post('/token', new URLSearchParams({ grant_type: 'authorization_code', code: location.searchParams.get('code')!, code_verifier: verifier, redirect_uri: callback, resource: resourceUrl, client_id: clientId }).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
  expect(exchanged.status).toBe(200);
  const token = ((await exchanged.json()) as { access_token: string }).access_token;
  const listed = await post('/mcp', rpc('tools/list'), { 'content-type': 'application/json', authorization: `Bearer ${token}` });
  expect(listed.status).toBe(200);

  const summary = summarizeOAuthLog(readOAuthLog(fixture)).oauth;
  expect({ registrations: summary.registrations, authorizations: summary.authorizations, codeExchanges: summary.codeExchanges, unauthorized: summary.unauthorized }).toEqual({ registrations: 1, authorizations: 1, codeExchanges: 1, unauthorized: 1 });

  await fixture.close();
  expect(custody.release({ enginePids: [] })).toEqual({ service: custody.service, found: false, deleted: false });
});

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test('spike: the engine\'s own MCP sign-in over the control protocol, against the engine-mode fixture', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'the sign-in spike runs on the Mac lane alone (Decision Log 6)');
  test.setTimeout(600_000);
  const { bin } = realEngine();
  const configDir = join(root, 'claude-config'); // the string the engine is given, so the item's name derives from it as written
  const project = join(root, 'project');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(configDir, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, projects: { [project]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  const outDir = join(root, 'spike');
  const custody = engineKeychainCustody(configDir);
  custody.claim();
  const pids = () => (existsSync(join(outDir, 'pids.txt')) ? readFileSync(join(outDir, 'pids.txt'), 'utf8').split('\n').filter(Boolean).map(Number) : []);
  let released: ReturnType<typeof custody.release> | null;
  try {
    fixture = await startOAuthFixture({ root, id: 'spike', mode: 'engine' });
    const inputFile = join(root, 'spike-input.json');
    writeFileSync(inputFile, JSON.stringify({ bin, configDir, project, resourceUrl: fixture.resourceUrl, outDir }));
    const probe = spawnSync(process.execPath, [resolve(__dirname, '../spikes/p4-aggregator/m4-signin-spike.mjs'), inputFile], { encoding: 'utf8', timeout: 540_000 });
    console.log(`spike probe exit ${probe.status} ${probe.signal ?? ''}\n${probe.stderr.slice(-4000)}`);
  } finally {
    for (const pid of pids()) if (isAlive(pid)) process.kill(pid, 'SIGKILL');
    const until = Date.now() + 15_000;
    while (pids().some(isAlive) && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    const log = fixture === null ? [] : readOAuthLog(fixture);
    await fixture?.close();
    fixture = null;
    released = custody.release({ enginePids: pids() });
    const oauth = summarizeOAuthLog(log).oauth;
    const fixtureSide = { registrations: oauth.registrations, authorizations: oauth.authorizations, codeExchanges: oauth.codeExchanges, refreshes: oauth.refreshes, unauthorized: oauth.unauthorized, refusals: oauth.refusals, byRoute: oauth.byRoute, mcp: oauth.mcp };
    const result = existsSync(join(outDir, 'result.json')) ? (JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8')) as Record<string, unknown>) : null;
    const debugLines = existsSync(outDir)
      ? Object.fromEntries(readdirSync(outDir).filter((f) => f.startsWith('debug-')).map((f) => [f, readFileSync(join(outDir, f), 'utf8').split('\n').filter((l) => /fx-|oauth|keychain|credential|secure storage|redirect|persist|security/i.test(l)).map((l) => l.replace(/[A-Za-z0-9_\-.]{32,}/g, '[REDACTED]').slice(0, 300)).slice(0, 200)]))
      : {};
    const verdictInput = { custody: released, fixture: fixtureSide, result };
    console.log(`spike result ${JSON.stringify(verdictInput)}`);
    await testInfo.attach('spike-result.json', { body: JSON.stringify(verdictInput, null, 2), contentType: 'application/json' });
    if (existsSync(join(outDir, 'frames.jsonl'))) await testInfo.attach('spike-frames.jsonl', { path: join(outDir, 'frames.jsonl'), contentType: 'application/x-ndjson' });
    await testInfo.attach('spike-debug-lines.json', { body: JSON.stringify(debugLines, null, 2), contentType: 'application/json' });
  }
  expect(released).toMatchObject({ service: custody.service });
});
