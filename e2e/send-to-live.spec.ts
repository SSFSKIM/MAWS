// P3-H's Send to live run (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H; Decision Log 81, 87, 88; the ledger
// docs/doperpowers/ledgers/2026-10-16-P3-H.md). The owner's gesture in the product, one real model turn, the session's
// ordinary approval, and a delivery through a declared connector, under a hard cap:
//   - the product app (a plain build) with the installed Claude Code (unmodified, D-1) through ClaudeUsage's relay (GET
//     /api/hello, one retry two minutes later, else `blocked: relay`), Haiku in default permission mode;
//   - everything scratch under /tmp: HOME, the engine's config home (onboarding done, the project trusted, and one
//     user-scope MCP server: the Drive-shaped fixture e2e/support/send-to-mcp-server.mjs, whose `send_document(local_path)`
//     reads only files under the profile's artifact store and records the bytes and SHA-256 it read), the project, the
//     app's user data. No owner configuration, credential or user-data is read or written;
//   - the HTML artifact is the seeded session's (an X12 delivery record imported as the host imports it,
//     `library.testImport`), so that session is the artifact's own; it is launched through `session.launch` with
//     `maxBudgetUsd` (the engine's `--max-budget-usd`), the run's cap, before the owner's gesture, so the turn runs in
//     that capped process (Decision Log 87 picks the artifact's own session; a live one is used as it is);
//   - the owner: Artifacts › the row's "…" › Export › Send to Google Drive…, the sheet's default format for an HTML page
//     (PDF) and its session line, Send; the app opens the session; each approval is answered on the card of its own
//     request: Allow only for the connector's upload of, or a Read of, the export the request names (by canonical path
//     under the scratch store, e2e/support/send-to-approval.ts), Deny for anything else.
// It passes when the fixture received exactly the export the sheet's Send wrote (the file the prompt names: same path,
// bytes and SHA-256), the turn ended with its receipt in the same engine process, no other session or engine started,
// and the accounted spend is within the cap. The run's lines go to stdout and `live-run.txt` under the scratch root,
// which is kept for inspection (journal, delivery log, export copy).
//
// It spends money, within MAWS_LIVE_MAX_USD (US$0.50 when unset, at most US$1); run on purpose only, against a built
// out/ (the architect's CI bundle, gate-offload Decision Log 50), with no build prefix:
//   MAWS_LIVE=1 MAWS_LIVE_MAX_USD=1 pnpm exec playwright test e2e/send-to-live.spec.ts
// (without MAWS_LIVE=1 it reports the case skipped.)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { isolatedGitEnv } from '../test/support/git-env';
import { relaySkipReason } from '../test/support/relay-health';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { liveMaxUsd } from './support/live-budget';
import { approvesExport, requestCardSelector } from './support/send-to-approval';
import { endLiveRun, liveSpend } from './support/live-lifecycle';
import { eventsOf, importSeeded, ofKind, recordEvents, seedArtifact, seedTranscripts } from './support/maws-tools';
import { chargeOf, installedEngine } from './support/p1-live';

test.skip(process.env.MAWS_LIVE !== '1', 'the P3-H Send to live run runs only under MAWS_LIVE=1');
test.describe.configure({ timeout: 1_200_000 });

const CAP_USD = liveMaxUsd() ?? 0.5;
const TURN_MS = 600_000;
const SERVER = 'google-drive'; // the connector as the session lists it: mcp__google-drive__send_document
const TOOL = `mcp__${SERVER}__send_document`;
const TITLE = 'Harbor Tutoring — fall flyer';
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>${TITLE}</title></head>
<body style="font-family: Georgia, serif; margin: 48px">
<h1>Harbor Tutoring</h1>
<p>After-school tutoring for high-school students in Portland, Maine, September to December.</p>
<ul><li>Algebra and chemistry, Monday to Thursday, 3:30 to 6 pm</li><li>Essay writing, Saturday mornings</li></ul>
<p>Sign up on the website by September 1, or ask at the front desk.</p>
</body></html>
`;

interface Delivery {
  at: string;
  tool?: string;
  local_path?: string | null;
  path?: string;
  bytes?: number;
  sha256?: string;
  refused?: string;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// The text of the prompts MAWS wrote to the engine (the `user` frames out).
const promptsOf = (rows: readonly JournalRow[]): string[] =>
  rows
    .filter((row) => row.direction === 'out' && (row.frame as { type?: string }).type === 'user')
    .map((row) => {
      const content = (row.frame as { message?: { content?: unknown } }).message?.content;
      if (typeof content === 'string') return content;
      return Array.isArray(content) ? content.map((block: { text?: string }) => block.text ?? '').join('\n') : '';
    });

test('Send to Google Drive from the library: the owner’s gesture, one capped model turn, the connector’s ordinary approval, and the exported file delivered byte for byte', async () => {
  const root = realpathSync(mkdtempSync('/tmp/maws-p3h-send-live-'));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data');
  for (const dir of [home, repo, userData]) mkdirSync(dir, { recursive: true });
  const deliveries = join(root, 'deliveries.jsonl');
  const store = join(userData, 'artifacts'); // where artifacts.export writes; the fixture reads only under it
  const logFile = join(root, 'live-run.txt');
  const note = (line: string) => {
    appendFileSync(logFile, `${line}\n`);
    console.log(line);
  };

  let relay = relaySkipReason(RELAY_URL);
  if (relay !== null) {
    note(`relay not ready (${relay}); waiting two minutes and retrying once`);
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    relay = relaySkipReason(RELAY_URL);
  }
  if (relay !== null) {
    note(`blocked: relay (${relay}) at ${new Date().toISOString()}`);
    test.skip(true, `blocked: relay: ${relay}`);
  }
  let engine: { bin: string; version: string };
  try {
    engine = installedEngine();
    if (!/^\d+\.\d+\.\d+$/.test(engine.version)) throw new Error(`no version from ${engine.bin} --version`);
  } catch (error) {
    note(`blocked: engine (${String(error)})`);
    test.skip(true, `blocked: engine: ${String(error)}`);
    return;
  }

  writeFileSync(join(repo, 'README.md'), '# Harbor Tutoring\n\nAn after-school tutoring centre in Portland, Maine.\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  let engineId = '';
  const mcpServers = { [SERVER]: { type: 'stdio', command: process.execPath, args: [join(__dirname, 'support', 'send-to-mcp-server.mjs'), '--service', 'Google Drive', '--log', deliveries, '--allow', store] } };

  note(`==== P3-H Send to live run, ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200); Haiku, default permission mode; the session launched with maxBudgetUsd ${CAP_USD} (MAWS_LIVE_MAX_USD)`);
  note(`scratch: ${root} (home/ HOME; user-data/ the app's profile, its claude-config/ the engine's config home with the fixture connector "${SERVER}"; repo/ the project; deliveries.jsonl the fixture's log)`);

  let maws: MawsLaunch | null = null;
  let id = '' as AppSessionId;
  let journalPath: string | null = null;
  let enginePid: number | null = null;
  let prompted = false; // the owner's Send was given: from here an absent receipt is spend at the whole cap
  let failure: unknown = null;
  try {
    maws = await launchMaws({
      userData,
      env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', HOME: home, DISABLE_AUTOUPDATER: '1' },
      prepare: ({ claudeConfigDir }) => {
        writeFileSync(join(claudeConfigDir, 'settings.json'), '{}\n');
        writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', mcpServers, projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
        assertConfigHomeSafe({ configHome: claudeConfigDir, controls: [] });
        [engineId] = seedTranscripts(claudeConfigDir, repo, ['P3-H live: the flyer']) as [string];
      },
    });
    const { page } = maws;
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
    await recordEvents(page);
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        id = (sessions.find((r) => r.engineSessionId === engineId)?.appId ?? '') as AppSessionId;
        return id !== '';
      }, { timeout: 30_000 })
      .toBe(true);
    const statusOf = async () => value(await invoke(page, 'session.status', { appSessionId: id }));
    const events = (): Promise<SessionEvent[]> => eventsOf(page, id);
    const rows = (): JournalRow[] => (journalPath !== null && existsSync(journalPath) ? journal(journalPath) : []);
    const sessionCount = async () => value(await invoke(page, 'session.list', {})).sessions.length + value(await invoke(page, 'session.intent.list', undefined)).intents.length;
    const readDeliveries = (): Delivery[] => (existsSync(deliveries) ? readFileSync(deliveries, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Delivery) : []).filter((d) => d.tool === 'send_document');

    // ---- the artifact: the seeded session's HTML page (an X12 record, imported as at a host start) -------------------
    const record = seedArtifact(userData, id, 'flyer', TITLE, [PAGE], new Date(Date.now() - 3_600_000).toISOString());
    await importSeeded(page);
    const row = value(await invoke(page, 'library.get', { artifactId: record.id })).row;
    expect(row?.createdBy, 'the page is the seeded session’s').toEqual({ kind: 'session', appSessionId: id });
    note(`artifact ${record.id} "${TITLE}" (html, revision ${row?.revision}), created by ${id}`);

    // ---- the artifact's own session, launched with the run's cap before the owner's gesture --------------------------
    const spec = { ...launchDefaults(id, repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    journalPath = (await statusOf()).journalPath;
    await expect.poll(async () => (await statusOf()).process, { timeout: 120_000 }).toBe('ready');
    enginePid = (await statusOf()).pid;
    await expect
      .poll(async () => value(await invoke(page, 'session.mcpStatus', { appSessionId: id })).mcpServers.find((s) => s.name === SERVER)?.status, { timeout: 60_000, message: `the session has the ${SERVER} connector` })
      .toBe('connected');
    const sessionsBefore = await sessionCount();
    note(`session ${id} ready (engine pid ${enginePid}, journal ${journalPath}); ${SERVER} connected`);

    // ---- the owner: Artifacts › the row's … › Export › Send to Google Drive… ------------------------------------------
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    const article = page.locator('[data-library]').getByRole('article', { name: TITLE, exact: true });
    await expect(article).toBeVisible({ timeout: 30_000 });
    await article.getByRole('button', { name: `Actions for ${TITLE}` }).click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Send to Google Drive…', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Send to Google Drive' });
    await expect(sheet.getByRole('combobox', { name: 'Format' })).toHaveValue('pdf');
    await expect(sheet.locator('[data-send-to-session]')).toHaveText(/^Claude sends it from “/);
    note('G1: the sheet names Google Drive, PDF (an HTML page’s default) and the artifact’s live session');
    const mainEnded = (all: SessionEvent[]) => ofKind(all, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
    const endedBefore = mainEnded(await events()).length;
    prompted = true;
    await sheet.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 60_000 });
    await expect(page.locator(`[data-region="main"] [data-composer="${id}"]`).first()).toBeVisible({ timeout: 30_000 });
    note('G2: Send closed the sheet and the app shows the session');

    // ---- the export the Send wrote, named by its request (the one prompt written) ------------------------------------
    await expect.poll(() => promptsOf(rows()).length, { timeout: 30_000, message: 'the Send to request reached the engine' }).toBeGreaterThan(0);
    const prompts = promptsOf(rows());
    expect(prompts, 'one prompt, the owner’s Send to request').toHaveLength(1);
    const exportPath = /`([^`]+)`/.exec(prompts[0]!)?.[1] ?? '';
    // the export is a file of its own (P3 Decision Log 91): `<revision>-pdf-<exportId>.pdf`, which no later export replaces
    expect(exportPath.startsWith(`${store}/${record.id}/exports/`) && /\/\d+-pdf-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/.test(exportPath), `the request names the artifact's own PDF export under the store: ${exportPath}`).toBe(true);
    expect(prompts[0], 'the artifact’s title is shown, never sent (Decision Log 91)').not.toContain(TITLE);
    note(`G2b: the request names ${exportPath}`);

    // ---- the turn: each request answered on its own card; only the connector's upload or a Read of that export allowed
    const allowed: string[] = [];
    const denied: string[] = [];
    const allowedIds = new Set<string>();
    const deadline = Date.now() + TURN_MS;
    for (;;) {
      const status = await statusOf();
      const all = await events();
      if (mainEnded(all).length > endedBefore && status.turn === null && status.pendingRequests === 0) break;
      if (status.process === 'exited') throw new Error('the engine exited during the Send to turn');
      if (Date.now() > deadline) throw new Error('timed out waiting for the Send to turn to end');
      const resolved = new Set(ofKind(all, 'permission.resolved').map((e) => e.requestId));
      const request = ofKind(all, 'permission.requested').find((e) => !resolved.has(e.requestId));
      const card = request === undefined ? null : page.locator(`[data-region="main"] ${requestCardSelector(id, request.requestId)}`).first();
      if (request !== undefined && card !== null && (await card.isVisible().catch(() => false))) {
        const allow = approvesExport(request, { tool: TOOL, exported: exportPath, store });
        const button = card.getByRole('button', { name: allow ? 'Allow' : 'Deny', exact: true });
        if (await button.isEnabled().catch(() => false)) {
          await button.click();
          (allow ? allowed : denied).push(`${request.toolName} ${JSON.stringify(request.input)}`);
          if (allow) allowedIds.add(request.requestId);
          await expect.poll(async () => ofKind(await events(), 'permission.resolved').some((e) => e.requestId === request.requestId), { timeout: 30_000 }).toBe(true);
          continue;
        }
      }
      await page.waitForTimeout(400);
    }
    const all = await events();
    const reply = mainEnded(all).at(-1)?.resultText ?? '';
    const tools = ofKind(all, 'tool.use').filter((e) => e.parentToolUseId === null).map((e) => e.toolName);
    note(`G3: the turn ended: reply ${JSON.stringify(reply.slice(0, 400))}; tools ${JSON.stringify(tools)}; allowed ${JSON.stringify(allowed)}, denied ${JSON.stringify(denied)}; receipts so far US$${chargeOf(rows(), CAP_USD).receipted.toFixed(4)}`);
    const uploads = ofKind(all, 'permission.requested').filter((e) => e.toolName === TOOL);
    expect(uploads.length, 'the connector asked the owner, as any tool does').toBeGreaterThan(0);
    expect(uploads.some((e) => allowedIds.has(e.requestId) && approvesExport(e, { tool: TOOL, exported: exportPath, store })), 'the owner allowed the connector’s upload of exactly the export, on its own card').toBe(true);
    expect(promptsOf(rows()), 'still the one prompt').toHaveLength(1);

    // ---- the delivery: exactly the export the Send wrote ------------------------------------------------------------
    const exported = readFileSync(exportPath);
    cpSync(exportPath, join(root, 'exported.pdf'));
    const delivered = readDeliveries();
    note(`G4: the export ${exportPath} (${exported.length} bytes, sha256 ${sha256(exported)}); deliveries ${JSON.stringify(delivered)}`);
    expect(delivered.filter((d) => d.refused !== undefined), 'no refused delivery').toEqual([]);
    expect(delivered, 'one delivery').toHaveLength(1);
    expect(delivered[0]).toMatchObject({ path: realpathSync(exportPath), bytes: exported.length, sha256: sha256(exported) });
    expect(exported.subarray(0, 5).toString('latin1'), 'the export is a PDF').toBe('%PDF-');

    // ---- one capped engine, one session --------------------------------------------------------------------------
    expect((await statusOf()).pid, 'the turn ran in the capped engine launched before the gesture').toBe(enginePid);
    expect(await sessionCount(), 'the Send started no other session').toBe(sessionsBefore);
    const errors = maws.consoleErrors();
    note(`the window's console errors: ${JSON.stringify(errors)}`);
    expect.soft(errors).toEqual([]);
    note('PASS: Send to Google Drive delivered the exported PDF byte for byte through the connector after the owner’s approval, in one capped turn');
  } catch (error) {
    failure = error;
    note(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // The session stopped, the app closed, the engine process gone, the spend from the journal's receipts
    // (e2e/support/live-lifecycle.ts); the first error fails the test after the bookkeeping.
    const page = maws?.page;
    const ended = await endLiveRun({
      session: page && id !== '' ? { status: async () => value(await invoke(page, 'session.status', { appSessionId: id })), stop: async () => void value(await invoke(page, 'session.stop', { appSessionId: id, reason: 'stop' })) } : null,
      enginePid,
      beforeCleanup: () => {
        if (journalPath !== null && existsSync(journalPath)) cpSync(journalPath, join(root, 'journal.jsonl'));
      },
      cleanup: maws === null ? null : () => maws!.cleanup(),
      note,
    });
    failure ??= ended.errors[0] ?? null;
    const spend = liveSpend(existsSync(join(root, 'journal.jsonl')) ? journal(join(root, 'journal.jsonl')) : [], CAP_USD, prompted);
    note(`spend: receipts ${spend.receipts.length > 0 ? `${JSON.stringify(spend.receipts)}, total_cost_usd ${spend.receipted.toFixed(4)}` : 'none'}; accounted exposure US$${spend.accounted.toFixed(4)} (${spend.basis}); cap US$${CAP_USD}`);
    note(`scratch kept for inspection: ${root}`);
    expect(spend.accounted, 'within the cap').toBeLessThanOrEqual(CAP_USD);
    if (failure === null) {
      expect(spend.receipts.length, 'a passing run has the engine’s receipt for its turn').toBeGreaterThanOrEqual(1);
      expect(spend.settled, 'the last receipt came after the prompt').toBe(true);
    }
  }
  if (failure !== null) throw failure;
});
