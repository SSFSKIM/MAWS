// P3-L's live run (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M7 Proves, "Live"; the P3 composite's §2 item 1
// and the brief's acceptance: "a live run on the installed engine where an agent creates artifacts of two kinds through
// the tools and the library shows them with their session links"). The product app (a plain build, as MAWS ships it)
// with the installed Claude Code (unmodified, D-1) under a scratch CLAUDE_CONFIG_DIR under /tmp (`settings.json` `{}`, a
// `.claude.json` trusting the scratch repository), through ClaudeUsage's relay (GET /api/hello, one retry two minutes
// later, else the run is `blocked: relay`), on Haiku in default permission mode, every permission allowed once through
// the request card docked in the composer. One session, one prompt: the agent makes an `html` artifact with
// `artifact_create` from a page the test wrote and a `file` artifact with `send_file`. Then, without any stand-in:
// main's library (`library.get`) holds both linked `created` to the session with the session as last editor; the
// panel's Artifacts tool lists both under This session; the Artifacts main tab shows both with the session's chip and
// "by <the session's title>"; and its search finds a word only the HTML page's text holds.
// Not here: the HTML page opening with its comment card, which needs M5b's viewers (gated on P3-A's M7).
// The owner's ~/.claude.json is only read, for the A-15 delta before the launch and after the app closed. The run's
// lines go to stdout and to `live-run.txt` under the scratch root, which is kept for inspection (journals included).
// It spends money, within MAWS_LIBRARY_LIVE_MAX_USD (US$0.30 when unset), the session's `--max-budget-usd`; run on
// purpose only (the script builds, the flag runs):
//   MAWS_LIBRARY_LIVE=1 pnpm e2e:library-live
// (`pnpm e2e:library-live` alone builds and reports the case skipped.)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { ArtifactCreateResult, SendFileResult } from '@shared/maws/tools';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { ownerPlugins } from '../test/support/claude-env';
import { isolatedGitEnv } from '../test/support/git-env';
import { compareA15 } from '../test/support/owner-file';
import { relaySkipReason } from '../test/support/relay-health';
import { journal, mainResults } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { ownTitles } from './support/library';
import { eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts } from './support/maws-tools';
import { a15Line, a15Reading, chargeOf, initPluginsOf, installedEngine } from './support/p1-live';
import { isAlive, ps } from './support/processes';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_LIBRARY_LIVE !== '1', 'the P3-L live run runs only under MAWS_LIBRARY_LIVE=1');
test.describe.configure({ timeout: 900_000 });

const CAP_USD = Number(process.env.MAWS_LIBRARY_LIVE_MAX_USD ?? '0.3');
const TURN_MS = 300_000;

// The page the agent makes an artifact of: one word in its body (`axolotl`) that no title, file name or prompt holds,
// so a search hit can only come from the page's extracted text.
const PAGE_TITLE = 'P3-L live page';
const PAGE_WORD = 'axolotl';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Tide table</title><style>.tide{color:#123}</style></head><body><h1 class="tide">Tide table</h1><p>The ${PAGE_WORD} survey starts at dawn.</p></body></html>`;
const FILE_NAME = 'p3l-notes.txt';
const PROMPT =
  'Do these steps yourself, one after another, never through an agent, and do not read, list or inspect any file. ' +
  `First call mcp__maws__artifact_create with kind "html", title "${PAGE_TITLE}" and path "page.html". ` +
  `Then call mcp__maws__send_file with files ["${FILE_NAME}"]. ` +
  'Then reply with exactly one word: DONE.';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

test('an agent makes an html artifact and a file artifact through the tools; the library and the panel show them with the session', async () => {
  // the run's scratch: the config home, the trusted repository with the page and the file, the app's profile, the log
  const root = realpathSync(mkdtempSync('/tmp/maws-p3l-live-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data');
  for (const dir of [config, repo, userData]) mkdirSync(dir, { recursive: true });
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

  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'page.html'), PAGE);
  writeFileSync(join(repo, FILE_NAME), 'Notes from the live run.\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=P3-L', '-c', 'user.email=p3l@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['P3-L live: the library']);

  const a15First = a15Reading();
  const ours = [root];
  note(`==== P3-L live run (M7), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200), Haiku, default permission mode, --max-budget-usd ${CAP_USD} (MAWS_LIBRARY_LIVE_MAX_USD)`);
  note(`scratch: ${root} (claude-config/ settings.json {} and .claude.json trusting repo/; user-data/ the app's profile, show: false); the app: the product build (out/main/index.js), every CLAUDE* variable of the runner dropped (launchEnvironment)`);
  note(a15Line('before the launch', a15First, a15First, ours));

  let maws: MawsLaunch | null = null;
  let id = '' as AppSessionId;
  let journalPath: string | null = null;
  let enginePid: number | null = null;
  let prompted = false; // a paid turn was asked for: from here an absent receipt is spend at the whole cap
  const allowed: string[] = [];
  let failure: unknown = null;
  try {
    maws = await launchMaws({ userData, env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: config } });
    const { page } = maws;
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    const panel = page.locator('[data-region="panel"]');
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
    const mainTurnsEnded = (all: SessionEvent[]) => ofKind(all, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);

    // the session shown, launched fresh as the app launches (Haiku, default mode, the run's cap), the prompt sent from
    // the real composer
    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(700, 20);
    await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();
    const spec = { ...launchDefaults(id, repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    journalPath = (await statusOf()).journalPath;
    await expect.poll(async () => (await statusOf()).process, { timeout: 120_000 }).toBe('ready');
    enginePid = (await statusOf()).pid;
    const message = pane.getByRole('textbox', { name: 'Message', exact: true });
    await message.click();
    await page.keyboard.insertText(PROMPT);
    prompted = true;
    await page.keyboard.press('Enter');

    // the turn, every permission it asks allowed once through the card docked in the composer
    const idleNow = async () => {
      const status = await statusOf();
      return status.turn === null && status.pendingRequests === 0;
    };
    const deadline = Date.now() + TURN_MS;
    for (;;) {
      if (mainTurnsEnded(await events()).length > 0 && (await idleNow())) break;
      if (Date.now() > deadline) throw new Error('timed out waiting for the turn to end');
      const all = await events();
      const resolved = new Set(ofKind(all, 'permission.resolved').map((e) => e.requestId));
      const open = ofKind(all, 'permission.requested').filter((e) => !resolved.has(e.requestId));
      if (open.length > 0) {
        const frame = pane.getByRole('group', { name: 'Approval needed' });
        const allow = frame.getByRole('button', { name: 'Allow', exact: true });
        if ((await allow.isVisible().catch(() => false)) && (await allow.isEnabled().catch(() => false))) {
          const once = frame.getByRole('radio', { name: 'Allow once' });
          if ((await once.count()) > 0) await once.click();
          await allow.click();
          allowed.push(open[0]!.toolName);
          await expect.poll(async () => ofKind(await events(), 'permission.resolved').some((e) => e.requestId === open[0]!.requestId), { timeout: 30_000 }).toBe(true);
          continue;
        }
      }
      await page.waitForTimeout(400);
    }

    // the two calls and their answers, from the journal
    const rows = journal(journalPath);
    const calls = mcpCalls(rows);
    const reply = mainTurnsEnded(await events()).at(-1)?.resultText ?? '';
    note(`the turn: maws calls ${JSON.stringify(calls.map((c) => [c.name, c.args]))}; permissions allowed once through the card ${JSON.stringify(allowed)}; reply ${JSON.stringify(reply)}`);
    const [init] = ofKind(await events(), 'session.init');
    expect(ownerPlugins(init?.plugins ?? [], [root]), 'none of the owner plugins').toEqual([]);
    note(`init plugins ${JSON.stringify(initPluginsOf(rows))} (none of the owner's)`);
    const create = calls.find((c) => c.name === 'artifact_create');
    const send = calls.find((c) => c.name === 'send_file');
    expect(create, 'the agent called artifact_create').toBeDefined();
    expect(send, 'the agent called send_file').toBeDefined();
    const createAnswer = mcpResultOf(rows, create!.requestId);
    const sendAnswer = mcpResultOf(rows, send!.requestId);
    expect(createAnswer?.isError, `artifact_create answered ${createAnswer ? resultText(createAnswer) : 'nothing'}`).toBeUndefined();
    expect(sendAnswer?.isError, `send_file answered ${sendAnswer ? resultText(sendAnswer) : 'nothing'}`).toBeUndefined();
    const created = JSON.parse(resultText(createAnswer!)) as ArtifactCreateResult;
    const sent = JSON.parse(resultText(sendAnswer!)) as SendFileResult;
    expect(created).toMatchObject({ status: 'created', kind: 'html', title: PAGE_TITLE });
    expect(sent.deliverables).toEqual([{ id: expect.any(String), path: join(repo, FILE_NAME), name: FILE_NAME }]);
    const pageId = created.artifactId;
    const fileId = sent.deliverables[0]!.id;
    note(`artifact_create: ${JSON.stringify({ status: created.status, artifactId: pageId, kind: created.kind, title: created.title, revision: created.revision })}; send_file: ${JSON.stringify(sent)}`);

    // main's library: both rows, linked `created` to the session, the session their last editor and named by its title
    const libraryRow = async (artifactId: string): Promise<LibraryRow | null> => {
      const result = (await page.evaluate((a) => window.maws.invoke('library.get', { artifactId: a }), artifactId)) as Result<{ row: LibraryRow | null }>;
      if (!result.ok) throw new Error(`library.get failed: ${result.error.code} ${result.error.message}`);
      return result.value.row;
    };
    const sessionTitle = (value(await invoke(page, 'session.list', {})).sessions.find((r) => r.appId === id)?.title.text ?? '').trim();
    expect(sessionTitle, 'the session has a title').not.toBe('');
    const linked = async (artifactId: string) => {
      const row = await libraryRow(artifactId);
      const link = row?.sessions.find((s) => s.appSessionId === id);
      return row !== null && link?.roles.includes('created') === true && link.title === sessionTitle;
    };
    await expect.poll(() => linked(pageId), { timeout: 15_000, message: 'the page’s row carries the session’s created link' }).toBe(true);
    await expect.poll(() => linked(fileId), { timeout: 15_000, message: 'the file’s row carries the session’s created link' }).toBe(true);
    const pageRow = (await libraryRow(pageId))!;
    const fileRow = (await libraryRow(fileId))!;
    for (const row of [pageRow, fileRow]) {
      expect(row.lastEditor, `${row.title}: the session is its last editor`).toEqual({ kind: 'session', appSessionId: id });
      expect(row.lastEditorTitle).toBe(sessionTitle);
    }
    expect([pageRow.kind, pageRow.title, fileRow.kind, fileRow.title]).toEqual(['html', PAGE_TITLE, 'file', FILE_NAME]);
    note(`library.get: ${JSON.stringify([pageRow, fileRow].map((r) => ({ id: r.id, kind: r.kind, title: r.title, revision: r.revision, lastEditor: r.lastEditor, lastEditorTitle: r.lastEditorTitle, sessions: r.sessions.map((s) => ({ appSessionId: s.appSessionId, title: s.title, roles: s.roles })) })))}`);

    // the panel's Artifacts tool, This session: both rows
    await panel.getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Artifacts', exact: true }).click();
    const list = panel.locator('[data-artifacts-list]');
    await expect(list).toBeVisible();
    await expect(list.getByRole('group', { name: 'Show artifacts of' }).getByRole('button', { name: 'This session' })).toHaveAttribute('aria-pressed', 'true');
    const toolRow = (artifactId: string) => list.locator(`[data-artifact-row][data-artifact-id="${artifactId}"]`);
    await expect(toolRow(pageId)).toBeVisible({ timeout: 15_000 });
    await expect(toolRow(fileId)).toBeVisible();
    await expect(toolRow(pageId).locator('[data-part="title"]')).toHaveText(PAGE_TITLE);
    await expect(toolRow(fileId).locator('[data-part="title"]')).toHaveText(FILE_NAME);
    await expect(toolRow(pageId).locator('[data-part="line"]')).toContainText(`by ${sessionTitle}`);
    await expect(toolRow(fileId).locator('[data-part="line"]')).toContainText(`by ${sessionTitle}`);
    const toolRows = await list.locator('[data-artifact-row]').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-kind')}: ${el.textContent}`));
    note(`the panel's Artifacts tool (This session): ${JSON.stringify(toolRows)}`);

    // the Artifacts main tab: both rows with the session's chip and "by <title>"; search finds the page's word
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    const library = page.locator('[data-library]');
    const row = (title: string) => library.getByRole('article', { name: title, exact: true });
    for (const title of [PAGE_TITLE, FILE_NAME]) {
      await expect(row(title)).toBeVisible({ timeout: 15_000 });
      await expect(row(title).locator('[data-part="sessions"]').getByRole('button', { name: sessionTitle, exact: true })).toBeVisible();
      await expect(row(title)).toContainText(`by ${sessionTitle}`);
    }
    const chipTooltip = await row(PAGE_TITLE).locator('[data-part="sessions"]').getByRole('button').first().getAttribute('title');
    const shown = await Promise.all([PAGE_TITLE, FILE_NAME].map(async (title) => `${title}: ${(await row(title).textContent())?.replace(/\s+/g, ' ')}`));
    note(`the Artifacts tab: ${JSON.stringify(shown)}; the page's chip tooltip ${JSON.stringify(chipTooltip)}`);
    const search = library.getByRole('searchbox', { name: 'Search artifacts' });
    await search.fill(PAGE_WORD);
    await expect.poll(() => ownTitles(page, library), { timeout: 15_000, message: 'the page’s text is searchable' }).toEqual([PAGE_TITLE]);
    const snippet = await row(PAGE_TITLE).locator('[data-part="snippet"]').textContent().catch(() => null);
    note(`search "${PAGE_WORD}": ${JSON.stringify(await ownTitles(page, library))}; snippet ${JSON.stringify(snippet)}`);
    await search.fill('');

    const errors = maws.consoleErrors();
    note(`the window's console errors: ${JSON.stringify(errors)}`);
    expect.soft(errors).toEqual([]);
    note('PASS: an html artifact through artifact_create and a file artifact through send_file, each linked created to the session with the session as last editor; the panel tool lists both for the session; the library shows both with the session chip; search finds the page’s word');
  } catch (error) {
    failure = error;
    note(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // The session stopped, the app closed, the engine process gone (a detached host can outlive the app, so the app's
    // close proves nothing about the engine), the spend from the journal's receipts, the owner file read again. Every
    // step runs whatever an earlier one threw; the first error fails the test after the bookkeeping.
    const failed = (what: string) => (error: unknown) => {
      note(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      failure ??= error;
    };
    if (maws !== null && id !== '') {
      const page = maws.page;
      await (async () => {
        const status = value(await invoke(page, 'session.status', { appSessionId: id }));
        enginePid ??= status.pid;
        if (status.process !== 'exited') {
          value(await invoke(page, 'session.stop', { appSessionId: id, reason: 'stop' }));
          await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id })).process, { timeout: 30_000 }).toBe('exited');
        }
      })().catch(failed('the session could not be stopped'));
    }
    await maws?.cleanup().catch(failed('the app’s cleanup failed'));
    if (enginePid !== null && isAlive(enginePid)) {
      const command = ps(enginePid, 'command');
      if (/claude/.test(command)) {
        failed('the engine outlived the app')(new Error(`pid ${enginePid} (${command}) still runs after the app closed; killed`));
        try {
          process.kill(enginePid, 'SIGKILL');
        } catch {
          // gone since the check
        }
      }
    }
    note(`engine process: ${enginePid === null ? 'none recorded (no launch reached ready)' : `pid ${enginePid} ${isAlive(enginePid) ? 'STILL ALIVE' : 'gone'}`}`);
    // The receipt is the engine's own `total_cost_usd`; a prompt with no receipt after it (a failed, stopped or
    // unjournalled turn) is accounted at the whole cap, the session's --max-budget-usd (p1-live.ts's chargeOf), since
    // an absent receipt must never read as no spend.
    const rows = journalPath !== null && existsSync(journalPath) ? journal(journalPath) : [];
    const charge = chargeOf(rows, CAP_USD);
    const receipts = mainResults(rows).map((r) => r.frame.total_cost_usd).filter((usd): usd is number => typeof usd === 'number' && Number.isFinite(usd));
    const accounted = prompted && rows.length === 0 ? CAP_USD : charge.usd;
    note(`spend: receipt ${receipts.length > 0 ? `total_cost_usd ${charge.receipted.toFixed(4)}` : 'none'}; accounted exposure US$${accounted.toFixed(4)} (${!prompted ? 'no prompt sent' : rows.length === 0 ? 'no journal: the whole cap' : charge.settled ? 'settled by its receipt' : 'unreceipted turn: the whole cap'}); cap US$${CAP_USD}; journal ${journalPath ?? 'none (no launch)'}`);
    const a15After = a15Reading();
    note(a15Line('after the app closed', a15First, a15After, ours));
    note(`scratch kept for inspection: ${root}`);
    expect(compareA15(a15First.keys, a15After.keys, ours).breach, 'no project of the run’s scratch in the owner file (A-15)').toEqual([]);
    expect(accounted, 'within the cap').toBeLessThanOrEqual(CAP_USD);
    if (failure === null) {
      expect(receipts.length, 'a passing run has the engine’s receipt for its turn').toBeGreaterThan(0);
      expect(charge.settled, 'the receipt came after the prompt').toBe(true);
    }
  }
  if (failure !== null) throw failure;
});
