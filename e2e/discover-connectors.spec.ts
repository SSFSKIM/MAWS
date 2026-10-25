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
//            Keychain is left as found). Its verdict is in (spikes/p4-aggregator/findings-m4.txt, gate run 40175924834),
//            so it runs again only on request: MAWS_SIGNIN_SPIKE=1 beside the group's flag.
//   add:     Connectors › Discover lists Linear (Partner, its rank, its URL); + opens the connector sheet with the name,
//            user scope and the exact command; the real CLI adds it (the scratch configuration has it, type http); My
//            items lists it with "Sign in needed"; the url_regex server asks an instance URL and refuses one off its
//            pattern; the authless server reads "No sign-in needed"; a name configured already is refused with the
//            existing entry; Remove removes it (acceptance 8). Without the directory, its words and Retry are acceptance
//            11's Connectors side, in discover.spec.ts's offline case.
//   sign-in: acceptance 9, on the Mac lane alone (Decision Log 13), under the runner's HOME (its login keychain) and a
//            scratch CLAUDE_CONFIG_DIR, against the engine-mode fixture: (a) S1 running, a server added, signed in from
//            S1 (its line as S1's own status reads it), then S2 reads it connected; (b) in S2, started after the add: a consent
//            delayed by 15 s completes "connected here"; Cancel then a retry; a second press; S2 stopped mid-flow; with
//            no ready session, the "Open a session" words. The scratch directory's exact Keychain item is claimed before
//            any engine runs and released after the app and both sessions have exited.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { openAppDestination } from './support/shell';
import { engineKeychainCustody, readOAuthLog, startOAuthFixture, summarizeOAuthLog, type OAuthFixture } from './support/connector-oauth';
import { assertEngineProcessKeychainEnv, guardKeychain, killTree } from './support/keychain-guard';
import { isAlive } from './support/processes';
import { realEngine } from './support/real-engine';

test.skip(process.env.MAWS_DISCOVER_E2E !== '1', 'the Discover e2e runs under pnpm e2e:discover (MAWS_DISCOVER_E2E=1)');

let root: string;
let fixture: OAuthFixture | null = null;
let maws: MawsLaunch | null = null;
test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-discover-oauth-'));
});
test.afterEach(async () => {
  await maws?.cleanup();
  maws = null;
  await fixture?.close();
  fixture = null;
  rmSync(root, { recursive: true, force: true });
});

test('oauth fixture, engine mode: a localhost-redirect token exchange from a plain client, the Keychain left as found', async () => {
  const configDir = join(root, 'claude-config');
  const custody = engineKeychainCustody(configDir, { scratchRoot: root, engineEnv: { CLAUDE_CONFIG_DIR: configDir } }); // fixB (a)(b)(c): no engine runs here
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
  test.skip(process.env.MAWS_SIGNIN_SPIKE !== '1', 'the sign-in spike reruns only on request (MAWS_SIGNIN_SPIKE=1)');
  test.setTimeout(600_000);
  const { bin } = realEngine();
  const configDir = join(root, 'claude-config'); // the string the engine is given, so the item's name derives from it as written
  const project = join(root, 'project');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(configDir, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, projects: { [project]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  const outDir = join(root, 'spike');
  // fixB: the spike's engines run with CLAUDE_CONFIG_DIR=configDir and without the two variables that rename their items
  // (m4-signin-spike.mjs, engineEnv), under the runner's HOME: custody of both items, and the prompt guard around it all
  const custody = engineKeychainCustody(configDir, { scratchRoot: root, engineEnv: { CLAUDE_CONFIG_DIR: configDir } });
  custody.claim();
  const pids = () => (existsSync(join(outDir, 'pids.txt')) ? readFileSync(join(outDir, 'pids.txt'), 'utf8').split('\n').filter(Boolean).map(Number) : []);
  let released: ReturnType<typeof custody.release> | null;
  try {
    fixture = await startOAuthFixture({ root, id: 'spike', mode: 'engine' });
    const inputFile = join(root, 'spike-input.json');
    writeFileSync(inputFile, JSON.stringify({ bin, configDir, project, resourceUrl: fixture.resourceUrl, outDir }));
    const child = spawn(process.execPath, [resolve(__dirname, '../spikes/p4-aggregator/m4-signin-spike.mjs'), inputFile], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 540_000 });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4000)));
    const stopAll = () => {
      if (child.pid !== undefined) killTree(child.pid); // the probe, its engines and their `security` children
      for (const pid of pids()) if (isAlive(pid)) killTree(pid);
    };
    const exit = await guardKeychain('the sign-in spike', () => new Promise<{ code: number | null; signal: string | null }>((done) => child.on('exit', (code, signal) => done({ code, signal }))), { onPrompt: stopAll });
    console.log(`spike probe exit ${exit.code} ${exit.signal ?? ''}\n${stderr}`);
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

// ---- Connectors: add and remove (acceptance 8), sign in (acceptance 9) ----------------------------------------------

const CLI_MS = 120_000; // one CLI action, the engine's own start included, on a loaded runner
const LINEAR = 'fa50c30c-9f62-4f94-b851-217868185db6';

// The engine's own CLI against the launch's scratch configuration (and its scratch HOME, or the runner's). fixB (c):
// bounded, and run under the keychain prompt guard, which stops it at once should a prompt appear.
async function engineCli(launch: MawsLaunch, args: string[]): Promise<string> {
  const engine = launch.realEngine!;
  const home = engine.scratch.home ?? process.env.HOME!;
  let child: ReturnType<typeof execFile> | null = null;
  return guardKeychain(`claude ${args.join(' ')}`, () => new Promise<string>((done, failed) => {
    child = execFile('/usr/bin/env', ['-i', `HOME=${home}`, `CLAUDE_CONFIG_DIR=${engine.scratch.configDir}`, 'PATH=/usr/bin:/bin', 'DISABLE_AUTOUPDATER=1', 'TERM=dumb', engine.bin, ...args], { cwd: engine.scratch.projects[0], encoding: 'utf8', timeout: CLI_MS }, (error, stdout) => (error ? failed(error) : done(stdout)));
  }), { onPrompt: () => child?.pid !== undefined && killTree(child.pid) });
}

const userServers = (launch: MawsLaunch) => (JSON.parse(readFileSync(join(launch.realEngine!.scratch.configDir, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, { type?: string; url?: string }> }).mcpServers ?? {};
const panel = (page: Page) => page.getByRole('tabpanel', { name: 'Connectors' });
const pane = (page: Page) => page.locator('[data-discover="connectors"]');
const row = (page: Page, name: string) => panel(page).locator(`[data-connector="${name}"]`);
const addSheet = (page: Page) => page.locator('[data-plugins-sheet="mcp-add"]');

async function openConnectors(page: Page, view: 'My items' | 'Discover'): Promise<void> {
  await openAppDestination(page, 'Customize');
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click();
  await panel(page).getByRole('radio', { name: view }).click();
}

async function searchFor(page: Page, text: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search all sources' }).fill(text);
}

async function sheetFor(page: Page, name: string): Promise<Locator> {
  await pane(page).getByRole('button', { name: `Add ${name}`, exact: true }).first().click();
  await expect(addSheet(page)).toBeVisible();
  return addSheet(page);
}

// A sheet's Details: the exact command and the file it changes (the owner's ruling, 2026-10-25), closed at every opening.
const details = (sheet: Locator) => sheet.getByRole('button', { name: 'Details', exact: true });
async function openDetails(sheet: Locator): Promise<void> {
  await expect(details(sheet)).toBeVisible({ timeout: 30_000 }); // once plugins.env answered
  if ((await details(sheet).getAttribute('aria-expanded')) === 'false') await details(sheet).click();
  await expect(details(sheet)).toHaveAttribute('aria-expanded', 'true');
}

async function cancel(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toBeHidden();
}

test('add: Linear from Discover through the connector sheet and the real CLI; the instance URL, authless and duplicate rows; Remove', async () => {
  test.setTimeout(360_000);
  maws = await launchMaws({ realEngine: { projects: 1 } });
  const { page, app } = maws;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 820));
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1280, 820]);
  const configFile = join(maws.realEngine!.scratch.configDir, '.claude.json');
  await openConnectors(page, 'Discover');
  await expect(pane(page)).toBeVisible();

  await test.step('Linear is listed: Partner, its rank, its URL', async () => {
    await searchFor(page, 'Linear');
    const card = pane(page).locator(`[data-catalog-card="${LINEAR}"]`).first();
    await expect(card.locator('[data-trust]')).toHaveAttribute('data-trust', 'Partner');
    await expect(card.locator('[data-catalog-metric]')).toHaveText('#14 most popular');
    await expect(card.locator('[data-catalog-components]')).toHaveText('https://mcp.linear.app/mcp');
  });

  await test.step('+ opens the sheet: the name linear, its URL and transport; behind Details, closed, the exact command at user scope and the file; Add runs it and the configuration has it', async () => {
    const sheet = await sheetFor(page, 'Linear');
    await expect(sheet.getByRole('textbox', { name: 'Name' })).toHaveValue('linear');
    await expect(sheet.locator('[data-connector-url]')).toHaveText('https://mcp.linear.app/mcp');
    await expect(sheet.locator('[data-plugins-sheet-body]')).toContainText('Transport: HTTP (streamable)');
    await expect(details(sheet)).toBeVisible({ timeout: 30_000 });
    await expect(details(sheet)).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet.locator('[data-plugins-argv]')).toHaveCount(0);
    await expect(sheet.locator('[data-connector-writes]')).toHaveCount(0);
    await test.info().attach('discover-connector-sheet-1280x820.png', { body: await page.screenshot(), contentType: 'image/png' }); // M5: beside the owner's references, as it opens
    await openDetails(sheet);
    await expect(sheet.locator('[data-plugins-argv]')).toHaveAttribute('data-plugins-argv', JSON.stringify(['mcp', 'add', '--transport', 'http', 'linear', 'https://mcp.linear.app/mcp', '--scope', 'user']));
    await expect(sheet.locator('[data-connector-writes]')).toHaveText(configFile);
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(pane(page).locator(`[data-catalog-card="${LINEAR}"]`).first()).toHaveAttribute('data-installed', 'here', { timeout: CLI_MS });
    expect(userServers(maws!).linear).toEqual({ type: 'http', url: 'https://mcp.linear.app/mcp' });
  });

  await test.step('the url_regex server asks an instance URL and refuses one off its pattern', async () => {
    await searchFor(page, 'Salesforce');
    const sheet = await sheetFor(page, 'Salesforce - Beta');
    const add = sheet.getByRole('button', { name: 'Add', exact: true });
    await expect(sheet.locator('[data-connector-pattern]')).toContainText('salesforce');
    await expect(add).toBeDisabled();
    const field = sheet.getByRole('textbox', { name: 'Your instance’s URL' });
    await field.fill('https://example.com/platform/headless-360');
    await expect(sheet.locator('[data-connector-problem]')).toContainText('The URL must match');
    await expect(add).toBeDisabled();
    await field.fill('https://api.salesforce.com/platform/mcp/v1/platform/headless-360');
    await expect(sheet.locator('[data-connector-problem]')).toHaveCount(0);
    await expect(add).toBeEnabled();
    await cancel(sheet);
  });

  await test.step('the authless server reads No sign-in needed', async () => {
    await searchFor(page, 'Microsoft Learn');
    const sheet = await sheetFor(page, 'Microsoft Learn');
    await expect(sheet.locator('[data-connector-auth]')).toHaveText('No sign-in needed');
    await cancel(sheet);
  });

  await test.step('Linear reads Installed, and the name linear is refused with the existing entry shown', async () => {
    await searchFor(page, 'Linear');
    await expect(pane(page).getByRole('button', { name: 'Add Linear', exact: true })).toHaveCount(0);
    await searchFor(page, 'Canva');
    const sheet = await sheetFor(page, 'Canva');
    await sheet.getByRole('textbox', { name: 'Name' }).fill('linear');
    await expect(sheet.locator('[data-connector-problem]')).toHaveText(`This name is already configured here (user scope, ${configFile}).`);
    await expect(sheet.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
    await cancel(sheet);
  });

  await test.step('My items lists it under Configured on disk with Sign in needed; Remove removes it', async () => {
    await panel(page).getByRole('radio', { name: 'My items' }).click();
    await expect(row(page, 'linear').locator('[data-sign-in-state]')).toHaveText('Sign in needed');
    await row(page, 'linear').getByRole('button', { name: 'Remove linear' }).click();
    const sheet = page.locator('[data-plugins-sheet="mcp-remove"]');
    await expect(sheet.locator('[data-plugins-scope]')).toHaveText('Scope: User'); // in view with Details closed
    await openDetails(sheet);
    await expect(sheet.locator('[data-plugins-argv]')).toHaveAttribute('data-plugins-argv', JSON.stringify(['mcp', 'remove', 'linear', '--scope', 'user']));
    await sheet.getByRole('checkbox').check();
    await sheet.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(row(page, 'linear')).toHaveCount(0, { timeout: CLI_MS });
    expect(userServers(maws!).linear).toBeUndefined();
    expect(await engineCli(maws!, ['mcp', 'list'])).not.toContain('linear');
  });
});

test('sign-in: S1 then S2, connected here after a delayed consent, Cancel and a retry, a second press, a session that exits, no session', async () => {
  test.skip(process.platform !== 'darwin', 'engine sign-in runs on the Mac lane alone (Decision Log 13)');
  test.setTimeout(900_000);
  const openLog = join(root, 'open.log');
  writeFileSync(openLog, '');
  maws = await launchMaws({ realEngine: { projects: 1, home: 'runner' }, env: { MAWS_E2E_OPEN_LOG: openLog } });
  const { page } = maws;
  const engine = maws.realEngine!;
  const [directory] = engine.scratch.projects;
  // The item the engine names from its CLAUDE_CONFIG_DIR as given (fact 2); the realpath's too, should the host resolve it.
  // fixB (a)(b): custody of both items each name derives, inside the launch's own scratch profile; the engine's own
  // environment is checked by launchMaws (the login shell it is built from) and after each session starts (ps -E)
  const scratchRoot = dirname(engine.scratch.configDir);
  const custodies = [...new Set([engine.scratch.configDir, realpathSync(engine.scratch.configDir)])].map((dir) => engineKeychainCustody(dir, { scratchRoot: dir === engine.scratch.configDir ? scratchRoot : realpathSync(scratchRoot), engineEnv: { CLAUDE_CONFIG_DIR: dir } }));
  for (const custody of custodies) custody.claim();
  const pids = new Set<number>();
  let released: unknown[];
  let closing: unknown = null; // a cleanup that failed: thrown once the items are released
  try {
    fixture = await startOAuthFixture({ root, id: 'signin', mode: 'engine' });
    const { resourceUrl } = fixture;
    const project = value(await invoke(page, 'session.projects.add', { directory }));
    const addServer = (name: string) => engineCli(maws!, ['mcp', 'add', '--transport', 'http', name, resourceUrl, '--scope', 'user']);
    const startSession = async (): Promise<string> => {
      const created = value(await invoke(page, 'session.create', { projectId: project.id, location: { kind: 'directory', path: directory } }));
      let start = value(await invoke(page, 'session.start', { appSessionId: created.appSessionId, message: null, options: { requireEmptyMessage: true } }));
      if (start.status === 'needs_trust') start = value(await invoke(page, 'session.start', { appSessionId: created.appSessionId, message: null, options: { requireEmptyMessage: true, trust: 'accepted' } }));
      expect(start, 'the session starts with no message').toMatchObject({ status: 'starting' });
      await expect.poll(async () => value(await invoke(page, 'engine.sessions', undefined)).find((s) => s.appSessionId === created.appSessionId)?.process, { timeout: 90_000 }).toBe('ready');
      const pid = value(await invoke(page, 'engine.sessions', undefined)).find((s) => s.appSessionId === created.appSessionId)?.pid;
      if (pid) {
        pids.add(pid);
        assertEngineProcessKeychainEnv(pid, engine.scratch.configDir); // fixB (b): the engine names its scratch items alone
      }
      return created.appSessionId;
    };
    const stopSession = async (appSessionId: string) => {
      value(await invoke(page, 'session.stop', { appSessionId: appSessionId as never, reason: 'stop' }));
      await expect.poll(async () => value(await invoke(page, 'engine.sessions', undefined)).find((s) => s.appSessionId === appSessionId)?.process ?? 'exited', { timeout: 60_000 }).toBe('exited');
    };
    const statusIn = async (appSessionId: string, name: string) => value(await invoke(page, 'session.mcpStatus', { appSessionId: appSessionId as never })).mcpServers.find((s) => s.name === name)?.status ?? null;
    const opened = () => readFileSync(openLog, 'utf8').split('\n').filter((line) => line.startsWith('openExternal ')).map((line) => line.slice('openExternal '.length));
    // the browser step: the fixture approves at once and redirects to the redirect URI MAWS gave the engine
    const consent = async (authUrl: string) => {
      const authorized = await fetch(authUrl, { redirect: 'manual' });
      expect(authorized.status).toBe(302);
      const back = await fetch(authorized.headers.get('location')!);
      expect(back.status).toBe(200);
    };
    const state = (name: string) => row(page, name).locator('[data-sign-in-state]');
    const signIn = async (name: string): Promise<string> => {
      const before = opened().length;
      await row(page, name).getByRole('button', { name: `Sign in to ${name}` }).click();
      // the browser step, or the sign-in's end in its own words (a failure says why, which the assertion then shows)
      await expect.poll(async () => opened().length > before || /didn’t finish|Signed in/.test(await row(page, name).innerText()), { timeout: 30_000 }).toBe(true);
      expect(opened().length, `the browser step for ${name}; the row reads: ${await row(page, name).innerText()}`).toBeGreaterThan(before);
      await expect(state(name)).toHaveText('Finish signing in in your browser…');
      return opened().at(-1)!;
    };
    const refresh = async (names: string[]) => {
      await panel(page).getByRole('button', { name: 'Refresh', exact: true }).click();
      for (const name of names) await expect(row(page, name)).toBeVisible();
    };

    await openAppDestination(page, 'Customize');
    const select = page.getByRole('combobox', { name: 'Project', exact: true });
    await select.selectOption((await select.locator('option', { hasText: 'project-a' }).getAttribute('value'))!);
    await openConnectors(page, 'My items');

    const s1 = await startSession();
    await test.step('(a) with S1 running, a server added and signed in from S1; S2 reads it connected', async () => {
      await addServer('fx-a');
      await refresh(['fx-a']);
      await consent(await signIn('fx-a'));
      // The result line follows S1's own mcp_status (Decision Log 14). Measured on 2.1.309 (gate run 40180917266): once
      // the engine's config poll has read the server, the reconnect after the callback loads it into S1 as well, so S1
      // reads it connected, not only the sessions started after.
      await expect(state('fx-a')).toHaveText(/^Signed in · (connected here|available in new sessions)$/, { timeout: 60_000 });
      const here = (await state('fx-a').innerText()) === 'Signed in · connected here';
      if (here) expect(await statusIn(s1, 'fx-a'), 'connected here: S1 reads it connected').toBe('connected');
      else expect(await statusIn(s1, 'fx-a'), 'available in new sessions: S1 does not read it connected').not.toBe('connected');
      await test.info().attach('acceptance-9a-s1.json', { body: JSON.stringify({ line: await state('fx-a').innerText(), s1: await statusIn(s1, 'fx-a') }), contentType: 'application/json' });
    });

    for (const name of ['fx-b', 'fx-c', 'fx-d', 'fx-e']) await addServer(name);
    const s2 = await startSession();
    await test.step('(a) S2, started after the sign-in, reads the server connected', async () => {
      await expect.poll(() => statusIn(s2, 'fx-a'), { timeout: 60_000 }).toBe('connected');
      await stopSession(s1); // S2 is the page's one session from here
      await refresh(['fx-b', 'fx-c', 'fx-d', 'fx-e']);
    });

    await test.step('(b) in S2, started after the add: a consent delayed by 15 s completes, connected here', async () => {
      const authUrl = await signIn('fx-b');
      await page.waitForTimeout(15_000);
      await consent(authUrl);
      await expect(state('fx-b')).toHaveText('Signed in · connected here', { timeout: 60_000 });
      expect(await statusIn(s2, 'fx-b')).toBe('connected');
    });

    await test.step('Cancel ends the sign-in; a retry completes', async () => {
      await signIn('fx-c');
      await row(page, 'fx-c').getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(state('fx-c')).toHaveText('Sign-in didn’t finish: cancelled');
      await consent(await signIn('fx-c'));
      await expect(state('fx-c')).toHaveText('Signed in · connected here', { timeout: 60_000 });
    });

    await test.step('a second press cancels the first sign-in and completes', async () => {
      const first = await signIn('fx-d');
      const second = await signIn('fx-d');
      expect(second).not.toBe(first);
      await consent(second);
      await expect(state('fx-d')).toHaveText('Signed in · connected here', { timeout: 60_000 });
    });

    await test.step('the session stopping mid-flow ends the sign-in: the session ended; then no session, the Open a session words', async () => {
      await signIn('fx-e');
      await stopSession(s2);
      await expect(state('fx-e')).toHaveText('Sign-in didn’t finish: the session ended', { timeout: 30_000 });
      await expect(row(page, 'fx-e').locator('[data-sign-in-needs-session]')).toHaveText('Open a session, then sign in');
      await expect(row(page, 'fx-e').getByRole('button', { name: 'Sign in to fx-e' })).toHaveCount(0);
    });
  } finally {
    // the app and every engine it ran have exited before the Keychain items are touched; a cleanup that fails (a keychain
    // prompt the launch's watch stopped the app on) still releases them, then fails the test
    await maws?.cleanup().catch((error: unknown) => (closing = error));
    maws = null;
    await fixture?.close();
    fixture = null;
    released = custodies.map((custody) => custody.release({ enginePids: [...pids] }));
  }
  if (closing) throw closing;
  expect(released.some((r) => (r as { found: boolean }).found), 'the sign-in stored the one item its scratch configuration names').toBe(true);
});
