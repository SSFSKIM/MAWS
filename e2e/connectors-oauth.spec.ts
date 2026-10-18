// P3-HD's own-OAuth group (`pnpm e2e:connectors-oauth`, MAWS_CONNECTORS_OAUTH_E2E=1; the spec skips itself otherwise, so
// `pnpm e2e` is unchanged): route D's OAuth acceptance on the built app (support/connector-scene.ts, H's page and
// Connectors sheet, the owner's Start, no message, no model turn), docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md
// acceptance 4 and 6, split from the connectors-direct group (e2e/connectors-direct.spec.ts) so each group's run stays
// within the gate's bounds. The toy OAuth fixture (support/connector-oauth.ts) is observed by an engine only in its open
// phase; that engine stopped and confirmed dead, the same URL demands OAuth of MAWS alone (Decision Log 23).
//   oauth connect: a refusal with no MAWS grant parks D without a tool call or a browser; the owner's Connect binds
//          127.0.0.1, completes DCR/PKCE/state/resource through the fake browser and closes its listener; each later
//          refresh reads through D on a rotated token (saved before the next refresh) over a new connection, with no
//          other browser or registration; the record is ciphertext, 0600 in a 0700 directory; an open HTTP server beside
//          it is read through D with no bearer, and neither server is ever presented the other's.
//   oauth relaunch: after an ordinary quit and relaunch nothing reaches the fixture until an open-phase engine has
//          observed it again; then D reads on the sealed grant (mock keychain) with no browser. Disconnect revokes and
//          forgets, the revocation endpoint up or down, and leaves D blocked; a Connect's listener pending at shutdown is
//          closed with the app.
//   oauth trust binding (P3-HD Decision Log 45 and 46): a query-bearing request URL whose protected-resource metadata
//          names another query's resource, and an authorization server whose discovery would leave its origin (a `//`
//          path, its own candidates answering 404, another loopback origin serving a document naming that issuer), each
//          end the owner's Connect before any listener, registration, consent or browser; the other origin is never
//          asked anything and nothing is minted or sealed.
import { existsSync } from 'node:fs';
import { test, expect, type Locator, type TestInfo } from '@playwright/test';
import { CONNECTORS_COPY as C, SERVERS_COPY as S } from '../src/renderer/src/tools/artifacts/viewers/connectors/copy';
import { PAGE_HTML, PAGE_TITLE, SERVER, TOOL, TOOL_NAME, wait, WATCH_MS, withScene, type ConnectorScene } from './support/connector-scene';
import { createPageIn, expectQuietJournals, Refreshes, serverConnected, serverRow, sessionJournals } from './support/connector-direct-scene';
import { addedListeners, bearerCrossings, pageVariant, plaintextHits, scanScratchTree } from './support/connector-direct-checks';
import { allow, evidence, stopEngine } from './support/connector-direct-acceptance';
import { tcpListeners } from './support/processes';
import { browserOpens, cleanShot, connectionWords, connectThroughBrowser, documentTexts, expectScratchCustody, httpEntry, listenersOnPort, MainOutput, mcpRequestsSince, openLogOf, sealedRecords, toolCallAttempts } from './support/connector-direct-oauth';
import { assertOpenPhase, enterOAuthPhase, enterOpenPhase, readOAuthLog, scanForSecrets, startOAuthFixture, summarizeOAuthLog, updateOAuthControl, type OAuthFixture, type OAuthFixturePaths } from './support/connector-oauth';

test.skip(process.env.MAWS_CONNECTORS_OAUTH_E2E !== '1', 'the own-OAuth e2e runs under pnpm e2e:connectors-oauth (MAWS_CONNECTORS_OAUTH_E2E=1)');
test.describe.configure({ timeout: 180_000 });

const OTHER = 'other';
const OTHER_TITLE = 'Signups, other';
const OTHER_TOOL_NAME = C.toolName(OTHER, TOOL);
const OAUTH_TTL_SECONDS = 30; // within main's 60 s refresh margin (oauth-provider.ts): every delivery refreshes, so every read rotates

// A body retained only after it scanned clean against each fixture that minted secrets.
async function retain(info: TestInfo, label: string, value: unknown, fixtures: readonly OAuthFixturePaths[]): Promise<string> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  for (const fixture of fixtures) if (existsSync(fixture.secrets)) expect(scanForSecrets(fixture, [body]), `${label} carries no ${fixture.id} secret`).toEqual({ clean: true, found: {} });
  await evidence(info, label, value);
  return body;
}

// What a fixture's log says, all windows, in safe counts.
const summaryOf = (fixture: OAuthFixturePaths) => summarizeOAuthLog(readOAuthLog(fixture));
const issuedAccess = (fixture: OAuthFixturePaths) => summaryOf(fixture).windows.flatMap((window) => window.issued.map((issued) => issued.access));
const presented = (fixture: OAuthFixturePaths) => [...new Set(summaryOf(fixture).windows.flatMap((window) => window.presentedBearers))];
// The token family and generation of each tools/call answered in the OAuth phase (MAWS's alone), in order.
const answeredTokens = (fixture: OAuthFixturePaths) =>
  readOAuthLog(fixture).filter((entry) => entry.phase === 'oauth' && entry.route === 'mcp' && entry.method === 'tools/call' && entry.status === 200).map((entry) => (entry.token ? `${entry.token.family}.${entry.token.generation}` : 'none'));
const phasesOf = (fixture: OAuthFixturePaths) =>
  summaryOf(fixture).windows.map(({ seq, phase, requests, advertised, unauthorized, authRoutes, authorizationHeaders, toolCallAttempts: attempts, toolCalls, registrations, authorizations, codeExchanges, refreshes, revocations, revocationsUnavailable, refusals }) => ({
    seq, phase, requests, advertised, unauthorized, authRoutes, authorizationHeaders, toolCallAttempts: attempts, toolCalls, registrations, authorizations, codeExchanges, refreshes, revocations, revocationsUnavailable, refusals,
  }));

// Disconnect's observable result on a source row: withdrawn, and the retirement finished. The reviewed owner source row
// carries `last` only for Connect/Reconnect (a Disconnect's result lives on the saved/retiring rows, which are gone once
// retirement completes), and a previous Connect's `last` may remain, so `last` is not asserted either way. Nothing in the
// list is still being disconnected or unconfirmed (one connection exists in this scene), and no retiring row remains.
async function expectDisconnected(sheet: Locator, row: Locator): Promise<void> {
  await expect(row.locator('[data-connector-server-state]')).toContainText(connectionWords('withdrawn'), { timeout: 20_000 });
  const servers = sheet.locator('[data-connectors-servers]');
  await expect(servers.locator('[data-connector-server][data-kind="retiring"]'), 'no retirement row remains').toHaveCount(0, { timeout: 20_000 });
  for (const text of [S.disconnecting, S.unconfirmed]) await expect(servers.locator('[data-connector-server-state]').filter({ hasText: text }), `no row is still “${text}”`).toHaveCount(0, { timeout: 20_000 });
}

// Disconnect forgets locally first and revokes asynchronously (oauth-provider.ts), so the withdrawn row does not yet
// show the server's revocation or the record's removal: wait, within the provider's 30 s revoke budget, for the fixture's
// own counter to pass its value from before the click and for the sealed store to be empty, then assert both.
async function expectRevocationSettled(scene: ConnectorScene, fixture: OAuthFixture, counter: 'revocations' | 'revocationsUnavailable', baseline: number): Promise<void> {
  await expect.poll(() => summaryOf(fixture).oauth[counter], { timeout: 30_000, message: `the fixture counted the ${counter === 'revocations' ? 'revocation' : 'unavailable revocation'}` }).toBeGreaterThan(baseline);
  await expect.poll(() => sealedRecords(scene).records.length, { timeout: 10_000, message: 'the sealed record was removed' }).toBe(0);
  expectSealed(scene, fixture, 0);
}

// The sealed store holds `count` records: ciphertext, 0600 in a 0700 directory, nothing of the identity or tokens readable.
function expectSealed(scene: ConnectorScene, fixture: OAuthFixture, count: number): unknown {
  const store = sealedRecords(scene);
  expect(store.records, `${count} sealed record(s)`).toHaveLength(count);
  if (count === 0) return { records: 0 };
  expect(store.dirMode, 'connectors/oauth is 0700').toBe(0o700);
  expect((store.parentMode ?? 0o777) & 0o077, 'connectors is owner-only').toBe(0);
  const needles = [fixture.resourceUrl, fixture.origin, new URL(fixture.origin).host, '"accessToken"', '"refreshToken"', '"tokens"', 'series:read', 'Bearer', 'client_id'];
  for (const record of store.records) {
    expect(record.mode, 'a sealed record is 0600').toBe(0o600);
    expect(record.ciphertext, 'the sealed format line and one base64 body').not.toBeNull();
    expect(plaintextHits(record.ciphertext!, needles), 'nothing of the identity or tokens is readable in the ciphertext').toEqual([]);
    expect(scanForSecrets(fixture, [record.text, record.ciphertext!.toString('latin1')]), 'no fixture secret in the sealed file').toEqual({ clean: true, found: {} });
  }
  return { records: store.records.length, dirMode: store.dirMode?.toString(8), parentMode: store.parentMode?.toString(8), modes: store.records.map((record) => record.mode.toString(8)), ciphertextBytes: store.records.map((record) => record.ciphertext!.length) };
}

// The secret scan over everything retainable: the scratch files, main's output, the app's documents and the evidence.
async function expectNothingRetained(info: TestInfo, label: string, scene: ConnectorScene, fixtures: readonly OAuthFixturePaths[], texts: readonly string[]): Promise<void> {
  const minted = fixtures.filter((fixture) => existsSync(fixture.secrets));
  expect(minted.length, 'the scan has secrets to look for').toBeGreaterThan(0);
  const clean = (text: string) => minted.every((fixture) => scanForSecrets(fixture, [text]).clean);
  const scratch = scanScratchTree(scene.root, clean);
  const dirtyTexts = texts.filter((text) => !clean(text)).length;
  await evidence(info, `${label}-secret-scan`, { scratchFiles: scratch.files, bytes: scratch.bytes, gone: scratch.gone, failures: scratch.failures, dirty: scratch.dirty, texts: texts.length, dirtyTexts });
  expect(scratch.files, 'the scan read the scratch').toBeGreaterThan(0);
  expect(scratch.failures, 'every retainable scratch file was read whole: no coverage gap').toEqual([]);
  expect(scratch.dirty, 'no scratch file holds a fixture secret').toEqual([]);
  expect(dirtyTexts, 'neither main’s output, the app’s documents nor the evidence holds one').toBe(0);
}

test('oauth connect: a refusal parks D, the owner’s Connect signs MAWS in on 127.0.0.1, every read rotates on a new connection; an open server beside it never sees a bearer', async () => {
  test.setTimeout(900_000);
  const info = test.info();
  let series: OAuthFixture | undefined;
  let other: OAuthFixture | undefined;
  await withScene(
    'oauth',
    info,
    async (scene) => {
      const retained: string[] = [];
      try {
        series = await startOAuthFixture({ root: scene.root, id: 'series' });
        other = await startOAuthFixture({ root: scene.root, id: OTHER });
        const fixtures = [series, other];
        const openLog = openLogOf(scene);
        const output = new MainOutput();
        const run = await output.launch(scene);
        await expectScratchCustody(run, scene);
        const page1 = await createPageIn(run.page, scene, { html: PAGE_HTML, title: PAGE_TITLE });
        const page2 = await createPageIn(run.page, scene, { html: pageVariant(PAGE_HTML, { server: OTHER, title: OTHER_TITLE }), title: OTHER_TITLE, spaceId: page1.spaceId });

        // the engine observes both URLs in their open phase and reads each once
        let { frame } = await scene.openPage(run.page, page1.artifactId);
        await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
        for (const fixture of fixtures) assertOpenPhase(fixture);
        const engine = await scene.ownerStart(run.page);
        await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
        await allow(scene, run.page, TOOL_NAME);
        await expect(frame.locator('#last')).toHaveText(/^ok n=\d+ via=engine$/, { timeout: 20_000 });
        await serverConnected(run.page, engine.appSessionId, OTHER);
        let frame2 = (await scene.openPage(run.page, page2.artifactId, OTHER_TITLE)).frame;
        await expect(frame2.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
        await allow(scene, run.page, OTHER_TOOL_NAME);
        await expect(frame2.locator('#last')).toHaveText(/^ok n=\d+ via=engine$/, { timeout: 20_000 });

        // the engine stopped and confirmed dead; only then does series demand OAuth, of MAWS alone
        await stopEngine(scene, run, engine);
        const stoppedAt = Date.now();
        enterOAuthPhase(series, { enginePids: [engine.pid] }, { accessTtlSeconds: OAUTH_TTL_SECONDS });

        // open HTTP through D: the other page reads with no bearer
        const otherRefreshes = new Refreshes(frame2, () => toolCallAttempts(other!));
        await otherRefreshes.mark();
        const otherDirect = await otherRefreshes.until('direct', WATCH_MS + 30_000);
        const otherSince = mcpRequestsSince(other, stoppedAt);
        expect(otherSince.map((entry) => entry.httpMethod), 'MAWS’s HTTP connection posts only').toEqual(otherSince.map(() => 'POST'));
        expect(otherSince.filter((entry) => entry.bearer !== 'none'), 'and presents no bearer').toEqual([]);

        // series with no MAWS grant: the refusal parks D: no tool call, nothing asked of the authorization server, no browser
        let before = toolCallAttempts(series);
        ({ frame } = await scene.openPage(run.page, page1.artifactId));
        const refreshes = new Refreshes(frame, () => toolCallAttempts(series!));
        refreshes.remounted(frame, before);
        const parked = await refreshes.next(20_000);
        expect(parked.last, 'not read').not.toMatch(/^ok/);
        expect(parked.submitted, 'no tools/call was sent').toBe(0);
        const refused = summaryOf(series).oauth;
        expect(refused, 'refused, and nothing asked of the authorization server').toMatchObject({ toolCallAttempts: 0, authRoutes: 0, registrations: 0 });
        expect(refused.unauthorized, 'the resource refused MAWS without a grant').toBeGreaterThan(0);
        expect(browserOpens(openLog), 'no browser opened by a refresh').toBe(0);
        let sheet = await scene.openSheet(run.page);
        let row = serverRow(sheet, SERVER, 'source');
        await expect(row.locator('[data-connector-server-state]')).toContainText(connectionWords('needsConnect'));
        await expect(row).toContainText(S.transport('http'));
        await cleanShot(info, 'oauth-needs-connect.png', sheet.locator('[data-connectors-servers]'), run.page, fixtures);

        // the owner's Connect: 127.0.0.1, DCR/PKCE/state/resource through the fake browser, the listener closed after
        const bound = await connectThroughBrowser({ run, row, server: SERVER, openLog, origin: series.origin });
        await expect(row.locator('[data-connector-server-state]')).toContainText(connectionWords('connected'), { timeout: 20_000 });
        await expect(row.locator('[data-connector-server-last]')).toHaveText(` · ${S.last({ action: 'connect', ok: true, tools: 1, credential: 'maws' })}`);
        await cleanShot(info, 'oauth-connected.png', sheet.locator('[data-connectors-servers]'), run.page, fixtures);
        await scene.closeSheet(run.page);
        expect(summaryOf(series).oauth, 'one registration, one consent, one code exchange').toMatchObject({ registrations: 1, authorizations: 1, codeExchanges: 1 });

        // two reads through D, each on a new connection and a rotated token, no browser or registration again
        const reads = [await refreshes.until('direct', WATCH_MS + 30_000), await refreshes.until('direct', WATCH_MS + 30_000)];
        const rotated = summaryOf(series).oauth;
        const tokens = answeredTokens(series);
        expect(tokens, 'each read presented a live token of the one grant').toHaveLength(2);
        expect(tokens.every((token) => token.startsWith('1.')), 'family 1').toBe(true);
        expect(new Set(tokens).size, 'a rotated token each time').toBe(2);
        expect(rotated.refreshes, 'a refresh per read').toBeGreaterThanOrEqual(2);
        expect(rotated.refusals, 'no rotated refresh token was ever replayed, no code reused').toEqual({});
        expect(rotated, 'still one registration, consent and code exchange').toMatchObject({ registrations: 1, authorizations: 1, codeExchanges: 1, toolCallAttempts: 2, toolCalls: 2 });
        expect(rotated.mcp.initialize ?? 0, 'the discovery and each read on a connection of its own').toBeGreaterThanOrEqual(3);
        expect(browserOpens(openLog), 'one browser open in all').toBe(1);
        const sealed = expectSealed(scene, series, 1);

        // the open server read again through D while MAWS holds series's grant: neither was presented the other's bearer
        before = toolCallAttempts(other);
        frame2 = (await scene.openPage(run.page, page2.artifactId, OTHER_TITLE)).frame;
        otherRefreshes.remounted(frame2, before);
        const otherAgain = await otherRefreshes.until('direct', 20_000);
        const crossings = bearerCrossings([
          { name: 'series', issued: issuedAccess(series), presented: presented(series) },
          { name: OTHER, issued: issuedAccess(other), presented: presented(other) },
        ]);
        expect(crossings, 'every bearer reached only the server that issued it').toEqual([]);
        expect(presented(series).length, 'series was presented its own bearers').toBeGreaterThan(0);
        expect(presented(other), 'the open server was never presented a bearer').toEqual([]);
        expect(existsSync(other.secrets), 'the open server minted nothing').toBe(false);

        // the window at its narrowest: the row's controls stay reachable
        ({ frame } = await scene.openPage(run.page, page1.artifactId));
        await run.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 900));
        sheet = await scene.openSheet(run.page);
        row = serverRow(sheet, SERVER, 'source');
        for (const name of [S.reconnectLabel(SERVER), S.disconnectLabel(SERVER)]) await expect(row.getByRole('button', { name }), `${name} is reachable`).toBeInViewport();
        await cleanShot(info, 'oauth-connected-narrow.png', sheet, run.page, fixtures);
        await scene.closeSheet(run.page);
        await run.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));

        const documents = await documentTexts(run.page);
        retained.push(
          await retain(info, 'oauth-connect', {
            series: phasesOf(series), other: phasesOf(other), otherDirect, otherAgain, parked,
            bind: { exact: bound.address === `127.0.0.1:${bound.port}`, followed: bound.followed }, reads, tokens, sealed, crossings, opens: browserOpens(openLog), refreshes: refreshes.seen,
          }, fixtures),
        );
        await scene.quit(run);
        expect(listenersOnPort(bound.port), 'nothing listens on the callback port').toEqual([]);
        const journals = sessionJournals(scene);
        expectQuietJournals(journals);
        await expectNothingRetained(info, 'oauth-connect', scene, fixtures, [output.text(), ...documents, ...retained]);
      } finally {
        await series?.close();
        await other?.close();
      }
    },
    { server: () => httpEntry(series!.resourceUrl), servers: () => ({ [OTHER]: httpEntry(other!.resourceUrl) }), env: (scene) => ({ MAWS_E2E_OPEN_LOG: openLogOf(scene) }) },
  );
});

test('oauth relaunch: after a quit nothing reaches the server until an open-phase engine observes it again, then D reads on the sealed grant; Disconnect forgets, revoked or not; a pending listener closes with the app', async () => {
  test.setTimeout(900_000);
  const info = test.info();
  let series: OAuthFixture | undefined;
  await withScene(
    'oauthrelaunch',
    info,
    async (scene) => {
      const retained: string[] = [];
      try {
        series = await startOAuthFixture({ root: scene.root, id: 'series' });
        const fixtures = [series];
        const openLog = openLogOf(scene);
        const output = new MainOutput();
        let run = await output.launch(scene);
        await expectScratchCustody(run, scene);
        const { artifactId } = await createPageIn(run.page, scene, { html: PAGE_HTML, title: PAGE_TITLE });
        let { frame } = await scene.openPage(run.page, artifactId);
        await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
        assertOpenPhase(series);
        const first = await scene.ownerStart(run.page);
        await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
        await allow(scene, run.page, TOOL_NAME);
        await expect(frame.locator('#last')).toHaveText(/^ok n=\d+ via=engine$/, { timeout: 20_000 });
        const refreshes = new Refreshes(frame, () => toolCallAttempts(series!));
        await refreshes.mark();
        await stopEngine(scene, run, first);
        enterOAuthPhase(series, { enginePids: [first.pid] }, { accessTtlSeconds: OAUTH_TTL_SECONDS });

        // signed in, one read through D
        let sheet = await scene.openSheet(run.page);
        let row = serverRow(sheet, SERVER, 'source');
        const firstBind = await connectThroughBrowser({ run, row, server: SERVER, openLog, origin: series.origin });
        await expect(row.locator('[data-connector-server-state]')).toContainText(connectionWords('connected'), { timeout: 20_000 });
        await scene.closeSheet(run.page);
        await refreshes.until('direct', WATCH_MS + 30_000);
        const beforeQuit = answeredTokens(series).filter((token) => token.startsWith('1.'));
        expect(beforeQuit.length, 'read on the grant before the quit').toBeGreaterThan(0);
        const sealedBefore = expectSealed(scene, series, 1);

        // an ordinary quit and a relaunch: nothing reaches the server; the saved grant is listed but is no source. The
        // fixture is open again before the relaunch, so no engine could ever observe its OAuth phase
        const supervisor = await scene.supervisor(run.page);
        await scene.quit(run);
        const quitAt = Date.now();
        enterOpenPhase(series);
        run = await output.launch(scene);
        await expectScratchCustody(run, scene);
        const relaunchedSupervisor = await scene.supervisor(run.page);
        ({ frame } = await scene.openPage(run.page, artifactId));
        refreshes.remounted(frame, toolCallAttempts(series));
        await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
        expect(answeredTokens(series), 'the relaunched page read nothing').toEqual(beforeQuit);
        sheet = await scene.openSheet(run.page);
        await expect(serverRow(sheet, SERVER, 'saved'), 'the saved connection is listed, not usable').toContainText(S.savedRow);
        await expect(serverRow(sheet, SERVER, 'source'), 'and is no verified source').toHaveCount(0);
        await cleanShot(info, 'oauth-relaunched-saved.png', sheet.locator('[data-connectors-servers]'), run.page, fixtures);
        await scene.closeSheet(run.page);
        await wait(WATCH_MS + 5_000);
        expect(mcpRequestsSince(series, quitAt), 'nothing reached the server before a fresh observation').toEqual([]);
        await refreshes.mark(); // the relaunched page's own refreshes so far (it may have been restored, not reopened)

        // a fresh observation in the open phase by an engine that then stops; then D reads on the sealed grant
        assertOpenPhase(series);
        const second = await scene.ownerStart(run.page);
        await refreshes.until('engine', WATCH_MS + 30_000);
        await stopEngine(scene, run, second);
        enterOAuthPhase(series, { enginePids: [first.pid, second.pid] }, { accessTtlSeconds: OAUTH_TTL_SECONDS });
        const reused = await refreshes.until('direct', WATCH_MS + 30_000);
        const afterRelaunch = answeredTokens(series).filter((token) => token !== 'none');
        const last = afterRelaunch.at(-1)!.split('.').map(Number);
        expect(last[0], 'the same grant').toBe(1);
        expect(last[1], 'on a token rotated past every one used before the quit').toBeGreaterThan(Math.max(...beforeQuit.map((token) => Number(token.split('.')[1]))));
        const relaunched = summaryOf(series).oauth;
        expect(relaunched.refusals, 'the saved refresh token was the rotated one: no replay').toEqual({});
        expect(relaunched, 'no other registration, consent or code exchange').toMatchObject({ registrations: 1, authorizations: 1, codeExchanges: 1 });
        expect(browserOpens(openLog), 'no browser after the relaunch').toBe(1);

        // Disconnect with revocation available: revoked, forgotten, and D blocked without a request
        sheet = await scene.openSheet(run.page);
        row = serverRow(sheet, SERVER, 'source');
        const revokedBefore = summaryOf(series).oauth.revocations;
        await row.getByRole('button', { name: S.disconnectLabel(SERVER) }).click();
        await expectDisconnected(sheet, row);
        await scene.closeSheet(run.page);
        let disconnectedAt = Date.now(); // the host has retired the connection: nothing reaches the server from here on
        await expectRevocationSettled(scene, series, 'revocations', revokedBefore);
        const blocked = await refreshes.next(WATCH_MS + 30_000);
        expect(blocked.last).not.toMatch(/^ok/);
        expect(mcpRequestsSince(series, disconnectedAt), 'D sent nothing after the Disconnect').toEqual([]);
        expect(browserOpens(openLog), 'and opened no browser').toBe(1);

        // Connect again: a new registration and grant, read through D
        sheet = await scene.openSheet(run.page);
        row = serverRow(sheet, SERVER, 'source');
        await connectThroughBrowser({ run, row, server: SERVER, openLog, origin: series.origin });
        await expect(row.locator('[data-connector-server-state]')).toContainText(connectionWords('connected'), { timeout: 20_000 });
        await scene.closeSheet(run.page);
        expect(summaryOf(series).oauth, 'a second registration and code exchange').toMatchObject({ registrations: 2, codeExchanges: 2 });
        await refreshes.until('direct', WATCH_MS + 30_000);
        expect(answeredTokens(series).at(-1)!.startsWith('2.'), 'read on the new grant').toBe(true);

        // Disconnect with the revocation endpoint down: forgotten all the same, D blocked
        updateOAuthControl(series, { revocation: 'unavailable' });
        sheet = await scene.openSheet(run.page);
        row = serverRow(sheet, SERVER, 'source');
        const unavailableBefore = summaryOf(series).oauth.revocationsUnavailable;
        await row.getByRole('button', { name: S.disconnectLabel(SERVER) }).click();
        await expectDisconnected(sheet, row);
        await scene.closeSheet(run.page);
        disconnectedAt = Date.now();
        await expectRevocationSettled(scene, series, 'revocationsUnavailable', unavailableBefore);
        const blockedAgain = await refreshes.next(WATCH_MS + 30_000);
        expect(blockedAgain.last).not.toMatch(/^ok/);
        expect(mcpRequestsSince(series, disconnectedAt), 'D sent nothing after the Disconnect').toEqual([]);

        // a Connect waiting in the browser when the app quits: its listener closes with the app, nothing is saved
        sheet = await scene.openSheet(run.page);
        row = serverRow(sheet, SERVER, 'source');
        const pending = await connectThroughBrowser({ run, row, server: SERVER, openLog, origin: series.origin, follow: false });
        const exchanges = summaryOf(series).oauth.codeExchanges;
        const documents = await documentTexts(run.page);
        await scene.quit(run);
        expect(listenersOnPort(pending.port), 'the pending listener closed with the app').toEqual([]);
        expect(summaryOf(series).oauth.codeExchanges, 'no code was exchanged for it').toBe(exchanges);
        expectSealed(scene, series, 0);

        retained.push(
          await retain(info, 'oauth-relaunch', {
            series: phasesOf(series),
            binds: [firstBind, pending].map((bound) => ({ exact: bound.address === `127.0.0.1:${bound.port}`, followed: bound.followed ?? null })),
            beforeQuit, afterRelaunch, reused, blocked, blockedAgain, sealedBefore, hostRestarted: relaunchedSupervisor !== supervisor, opens: browserOpens(openLog), refreshes: refreshes.seen,
          }, fixtures),
        );
        const journals = sessionJournals(scene);
        expectQuietJournals(journals);
        await expectNothingRetained(info, 'oauth-relaunch', scene, fixtures, [output.text(), ...documents, ...retained]);
      } finally {
        await series?.close();
      }
    },
    { server: () => httpEntry(series!.resourceUrl), env: (scene) => ({ MAWS_E2E_OPEN_LOG: openLogOf(scene) }) },
  );
});

// P3-HD panel correction (Decision Log 45 and 46): the trust bindings of MAWS's own sign-in, on the built app.
const PEER = 'peer';
const PEER_TITLE = 'Signups, peer';
const PEER_TOOL_NAME = C.toolName(PEER, TOOL);

test('oauth trust binding: another query’s resource and discovery off the issuer’s origin each end Connect before any registration, consent or browser', async () => {
  test.setTimeout(600_000);
  const info = test.info();
  let tenant: OAuthFixture | undefined;
  let peer: OAuthFixture | undefined;
  let elsewhere: OAuthFixture | undefined;
  await withScene(
    'oauthtrust',
    info,
    async (scene) => {
      try {
        elsewhere = await startOAuthFixture({ root: scene.root, id: 'elsewhere' }); // configured nowhere
        tenant = await startOAuthFixture({ root: scene.root, id: 'tenant' });
        peer = await startOAuthFixture({ root: scene.root, id: PEER });
        const fixtures = [tenant, peer, elsewhere];
        const openLog = openLogOf(scene);
        const output = new MainOutput();
        const run = await output.launch(scene);
        await expectScratchCustody(run, scene);
        const page1 = await createPageIn(run.page, scene, { html: PAGE_HTML, title: PAGE_TITLE });
        const page2 = await createPageIn(run.page, scene, { html: pageVariant(PAGE_HTML, { server: PEER, title: PEER_TITLE }), title: PEER_TITLE, spaceId: page1.spaceId });

        // the engine observes both configured servers in their open phase and reads each once
        let { frame } = await scene.openPage(run.page, page1.artifactId);
        await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
        for (const fixture of fixtures) assertOpenPhase(fixture);
        const engine = await scene.ownerStart(run.page);
        await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
        await allow(scene, run.page, TOOL_NAME);
        await expect(frame.locator('#last')).toHaveText(/^ok n=\d+ via=engine$/, { timeout: 20_000 });
        await serverConnected(run.page, engine.appSessionId, PEER);
        const frame2 = (await scene.openPage(run.page, page2.artifactId, PEER_TITLE)).frame;
        await expect(frame2.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
        await allow(scene, run.page, PEER_TOOL_NAME);
        await expect(frame2.locator('#last')).toHaveText(/^ok n=\d+ via=engine$/, { timeout: 20_000 });

        // the engine stopped and confirmed dead; only then do the servers advertise, to MAWS alone
        await stopEngine(scene, run, engine);
        const issuer = `${peer.origin}//${new URL(elsewhere.origin).host}`; // its last OpenID candidate is the other origin
        enterOAuthPhase(tenant, { enginePids: [engine.pid] }, { advertise: { resource: `${tenant.resourceUrl}?tenant=beta` } });
        enterOAuthPhase(peer, { enginePids: [engine.pid] }, { advertise: { authorizationServer: issuer } });
        enterOAuthPhase(elsewhere, { enginePids: [engine.pid] }, { advertise: { issuer } });

        const pid = run.child.pid!;
        const ended: Record<string, unknown> = {};
        for (const [artifactId, title, server, why] of [[page1.artifactId, PAGE_TITLE, SERVER, 'resource'], [page2.artifactId, PEER_TITLE, PEER, 'issuer']] as const) {
          ({ frame } = await scene.openPage(run.page, artifactId, title));
          const sheet = await scene.openSheet(run.page);
          const row = serverRow(sheet, server, 'source');
          const before = tcpListeners(pid);
          await row.getByRole('button', { name: S.connectLabel(server) }).click();
          await expect(row.locator('[data-connector-server-last]')).toHaveText(` · ${S.last({ action: 'connect', ok: false, why })}`, { timeout: 30_000 });
          expect(addedListeners(before, tcpListeners(pid)), `${server}: no callback listener was bound`).toEqual([]);
          await cleanShot(info, `oauth-trust-${why}.png`, sheet.locator('[data-connectors-servers]'), run.page, fixtures);
          await scene.closeSheet(run.page);
          ended[server] = why;
        }

        const tenantAsked = summaryOf(tenant).oauth;
        expect(tenantAsked.byRoute.resourceMetadata ?? 0, 'the tenant’s resource metadata was read').toBeGreaterThan(0);
        expect(tenantAsked.byRoute.serverMetadata ?? 0, 'and no authorization server was asked after it').toBe(0);
        const ownCandidates = readOAuthLog(peer).filter((entry) => entry.phase === 'oauth' && entry.route === 'other' && entry.path.startsWith('/.well-known/'));
        expect(ownCandidates.length, 'the issuer origin’s own discovery candidates were asked').toBeGreaterThan(0);
        expect(readOAuthLog(elsewhere), 'the other origin was asked nothing').toEqual([]);
        for (const fixture of fixtures) {
          expect(summaryOf(fixture).oauth, `${fixture.id}: nothing registered, consented or exchanged`).toMatchObject({ registrations: 0, authorizations: 0, codeExchanges: 0, refreshes: 0 });
          expect(existsSync(fixture.secrets), `${fixture.id} minted nothing`).toBe(false);
        }
        expect(browserOpens(openLog), 'no browser opened').toBe(0);
        expect(sealedRecords(scene).records, 'nothing sealed').toEqual([]);
        await evidence(info, 'oauth-trust', { ended, tenant: phasesOf(tenant), peer: phasesOf(peer), elsewhere: phasesOf(elsewhere), ownCandidates: ownCandidates.map((entry) => entry.status), opens: browserOpens(openLog) });
        await scene.quit(run);
        expectQuietJournals(sessionJournals(scene));
      } finally {
        await tenant?.close();
        await peer?.close();
        await elsewhere?.close();
      }
    },
    { server: () => httpEntry(`${tenant!.resourceUrl}?tenant=alpha`), servers: () => ({ [PEER]: httpEntry(peer!.resourceUrl) }), env: (scene) => ({ MAWS_E2E_OPEN_LOG: openLogOf(scene) }) },
  );
});
