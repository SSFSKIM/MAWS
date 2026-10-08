// E4d's live proof (docs/doperpowers/plans/2026-10-06-e4d-comment-mode.md, M5, Acceptance G2's live half): the product
// app (MAWS_HARNESS=0 per launch over a harness build, as `e2e:browser-comment`) with the installed Claude Code
// (unmodified, D-1) under a scratch CLAUDE_CONFIG_DIR under /tmp (`settings.json` `{}`, a `.claude.json` trusting the
// scratch repository), through ClaudeUsage's relay, on Haiku in default permission mode. The person comments on the
// Increment button of the e2e server's `/comment-counter.html` (`/comment.html` with E0b's counter) and sends it as a
// Side thread; the thread's agent must click that element through E4c's `browser_act {target: {css}}` **on the
// commented tab** (P-24: a side thread reaches its parent's tabs). The tab is asserted by id and its page read by `webContents.id`, never by URL: an agent that opens its own
// tab at the anchor's `pageUrl` and clicks there is a finding (Task 5.2), not a pass. Every permission is allowed once
// through the request card docked in the thread's Side pane. The owner's ~/.claude.json is read only, for the A-15
// delta before the launch and after the app closed. Writes `live-proof.txt` into the directory MAWS_E4D_LIVE_OUT names
// (E11, scale review E scalpel-1#2: a re-run records into its own directory, E4d's committed proof untouched),
// docs/doperpowers/evidence/p1-e4d/ when it is unset; a run skipped for the relay writes nothing.
// It spends money; run on purpose only, after a harness build:
//   MAWS_HARNESS=1 electron-vite build && MAWS_HARNESS=1 MAWS_E4D_LIVE=1 pnpm exec playwright test e2e/browser-comment-live.spec.ts
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { isolatedGitEnv } from '../test/support/git-env';
import { relaySkipReason } from '../test/support/relay-health';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { address, openBrowser, pageAt, tabAt, tabsOf, type BrowserScene } from './support/browser-scene';
import { startBrowserServer } from './support/browser-server';
import { journal, processCost } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { mcpCalls, mcpResultOf, ofKind, show } from './support/maws-tools';
import { launchMaws, REPO_ROOT } from './support/launch';

test.skip(process.env.MAWS_E4D_LIVE !== '1', 'the E4d live proof runs only under MAWS_E4D_LIVE=1');
test.describe.configure({ timeout: 900_000 });

const EVIDENCE = process.env.MAWS_E4D_LIVE_OUT ? resolve(process.env.MAWS_E4D_LIVE_OUT) : join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e4d'); // E11
const EVIDENCE_FILE = join(EVIDENCE, 'live-proof.txt');
const THREAD_MS = 300_000;
const INCREMENT_LABEL = 'button “Increment”';
// Acceptance G2's comment, verbatim
const COMMENT =
  'Click this element once with the maws browser tools (mcp__maws__browser_tabs with action list to find the tab showing this page, then mcp__maws__browser_act with action click and the target {css} from the anchor), then reply DONE';

// ---- the owner file (A-15), the engine, the evidence ------------------------------------------------------------------

// The standing rule's check, verbatim: the owner's ~/.claude.json `projects` keys under /tmp, read only; its sha1 is
// what `| shasum` prints.
function a15(): { keys: number; digest: string } {
  const script = `import json;d=json.load(open('${homedir()}/.claude.json'));print(sorted(k for k in d.get('projects',{}) if k.startswith('/tmp') or k.startswith('/private/tmp')))`;
  const out = execFileSync('/usr/bin/python3', ['-c', script], { encoding: 'utf8' });
  const keys = out.trim() === '[]' ? 0 : out.split("', '").length;
  return { keys, digest: createHash('sha1').update(out).digest('hex') };
}

// The installed engine (the installer's link, resolved), as a fresh install of MAWS finds it.
function installedEngine(): { bin: string; version: string } {
  const bin = realpathSync(join(homedir(), '.local/bin/claude'));
  const version = /\d+\.\d+\.\d+/.exec(execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000 }))?.[0] ?? '';
  return { bin, version };
}

// The runner may itself run inside a Claude Code session (an architect's or an executor's), whose variables would reach
// the scratch engine through the app's inheritance: a child-session marker, the session's id, its plugin directories.
// Every `CLAUDE*` key is removed from this worker's environment before the launch (launchMaws copies it); the spec sets
// CLAUDE_CONFIG_DIR itself. Answers the names removed (never their values).
function withoutInheritedClaude(): string[] {
  const removed = Object.keys(process.env).filter((key) => key.startsWith('CLAUDE')).sort();
  for (const key of removed) delete process.env[key];
  return removed;
}

const lines: string[] = [];
function note(line: string): void {
  lines.push(line);
  writeFileSync(EVIDENCE_FILE, `${lines.join('\n')}\n`);
}

// One root under /tmp (a leak would show in the A-15 delta): the config home, the trusted repository, the app's profile
// (kept, so the journals stay for the review) and one seeded transcript, so C4 lists the parent in the sidebar.
function scratch(): { root: string; config: string; repo: string; userData: string; engineId: string; seedBytes: number } {
  const root = realpathSync(mkdtempSync('/tmp/maws-e4d-live-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data');
  mkdirSync(config);
  mkdirSync(repo);
  mkdirSync(userData);
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'README.md'), 'E4d live proof\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=E4d', '-c', 'user.email=e4d@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const engineId = randomUUID();
  const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'E4d live: the parent' }, uuid: randomUUID(), timestamp: '2026-10-07T00:00:00.000Z', cwd: repo, sessionId: engineId, version: '2.1.291' };
  const seed = `${JSON.stringify(first)}\n`;
  writeFileSync(join(project, `${engineId}.jsonl`), seed);
  return { root, config, repo, userData, engineId, seedBytes: Buffer.byteLength(seed) };
}

// ---- reading the run ------------------------------------------------------------------------------------------------

type Frame = Record<string, unknown> & { type?: string; subtype?: string };
const initOf = (rows: JournalRow[]): Frame | undefined =>
  rows.filter((r) => r.direction === 'in').map((r) => r.frame as Frame).find((f) => f.type === 'system' && f.subtype === 'init');
const pluginsOf = (init: Frame | undefined) => JSON.stringify((init?.plugins as unknown[] | undefined) ?? null);
const firstJson = (rows: JournalRow[], requestId: string): Record<string, unknown> | null => {
  const result = mcpResultOf(rows, requestId);
  const text = result?.content.find((block) => block.type === 'text');
  if (text === undefined || text.type !== 'text') return null;
  try {
    return { ...(JSON.parse(text.text) as Record<string, unknown>), ...(result?.isError ? { isError: true } : {}) };
  } catch {
    return { text: text.text, ...(result?.isError ? { isError: true } : {}) };
  }
};
const seqOfCall = (rows: JournalRow[], requestId: string) =>
  rows.find((r) => r.direction === 'in' && (r.frame as { request_id?: string }).request_id === requestId)?.seq ?? null;

// ---- the proof -------------------------------------------------------------------------------------------------------

test('G2 live: a Side thread’s agent clicks the commented element through browser_act {target: {css}} on the commented tab', async () => {
  const relay = relaySkipReason(RELAY_URL);
  test.skip(relay !== null, `${relay}; G2's live half stays open`); // E11: before the first note, so a skip leaves the record as it was
  mkdirSync(EVIDENCE, { recursive: true });
  note(`E4d live proof (M5, Acceptance G2's live half), ${new Date().toISOString()}`);
  const engine = installedEngine();
  expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/);
  const removed = withoutInheritedClaude();
  const before = a15();
  const sc = scratch();
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200), Haiku, default permission mode`);
  note(`app: the harness build run as the product app (MAWS_HARNESS=0 per launch) over a scratch CLAUDE_CONFIG_DIR ${sc.config} (settings.json {}, .claude.json trusting ${sc.repo}); profile ${sc.userData}`);
  note(`environment: removed from the runner before the launch (names only): ${removed.join(', ') || 'none'}`);
  note(`A-15 before the launch: ${before.keys} keys, sha1 ${before.digest}`);

  const server = await startBrowserServer();
  const maws = await launchMaws({ userData: sc.userData, env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: sc.config } });
  const started: { label: string; id: string }[] = [];
  const costs: { label: string; costUsd: number }[] = [];
  let afterRun: { keys: number; digest: string } | undefined;
  try {
    const { page } = maws;
    // the window's record of session events and of the browser tools' acting notices
    await page.evaluate(() => {
      const w = window as unknown as { __e4dLive?: { batches: { appSessionId: string; events: unknown[] }[]; acting: unknown[] } };
      if (w.__e4dLive) return;
      const log = { batches: [] as { appSessionId: string; events: unknown[] }[], acting: [] as unknown[] };
      w.__e4dLive = log;
      window.maws.on('session.eventBatch', (payload) => log.batches.push(payload as { appSessionId: string; events: unknown[] }));
      window.maws.on('browser.agent.acting', (payload) => log.acting.push(payload));
    });
    const eventsOf = (id: string) =>
      page.evaluate((appSessionId) => (window as unknown as { __e4dLive: { batches: { appSessionId: string; events: SessionEvent[] }[] } }).__e4dLive.batches.filter((b) => b.appSessionId === appSessionId).flatMap((b) => b.events), id);
    const actingNotices = () => page.evaluate(() => (window as unknown as { __e4dLive: { acting: unknown[] } }).__e4dLive.acting);
    const statusOf = async (id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
    // E4a's scene helpers read only the window, its main pane and panel, the app and the server
    const s = { maws, page, server, pane: page.locator('[data-region="main"] [data-pane="0"]'), panel: page.locator('[data-region="panel"]') } as unknown as BrowserScene;

    let parent = '' as AppSessionId;
    await expect
      .poll(async () => (parent = (value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sc.engineId)?.appId ?? '') as AppSessionId), { timeout: 30_000 })
      .not.toBe('');

    // ---- the parent, live on Haiku (the thread's fork takes its model, mode and route from the record), resuming its
    // seeded conversation in place as the app's own resume does (`resumeLaunchSpec`), so the record stays bound to it
    await show(s, parent);
    const resume = { sessionId: sc.engineId as SessionId, fork: false };
    const spec = { ...launchDefaults(parent, sc.repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: 0.5, resume };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    started.push({ label: 'parent', id: parent });
    await expect.poll(async () => (await statusOf(parent)).process, { timeout: 120_000 }).toBe('ready');
    const recordOf = async () => value(await invoke(page, 'session.list', {})).sessions.find((r) => r.appId === parent)!;
    await expect.poll(async () => (await recordOf()).model.requested, { timeout: 30_000 }).toBe('haiku');
    const parentRecord = await recordOf();
    expect(parentRecord.model.requested, 'the fork will run on Haiku').toBe('haiku');
    expect(parentRecord.permissionMode.requested).toBe('default');
    expect(parentRecord.engineSessionId, 'bound to the seeded conversation the thread forks').toBe(sc.engineId);

    // ---- the commented tab: the Browser tool, the page, its id and webContents id (read before the pick)
    const panel = await openBrowser(s);
    const url = server.url('/comment-counter.html'); // `/comment.html` with E0b's counter (Decision Log 38)
    await address(panel, url);
    const tabId = await tabAt(s, parent, url);
    const view = await pageAt(s, url);
    await expect(view.locator('#increment')).toBeVisible();
    const webContentsId = await maws.app.evaluate((_electron, id) => (globalThis as unknown as { __maws_browser_comment: { state(tabId: string): { webContentsId: number | null } | null } }).__maws_browser_comment.state(id)?.webContentsId ?? null, tabId);
    expect(webContentsId, 'the commented tab has a page').not.toBeNull();
    // the commented tab's page, read by its webContents.id (never by URL: a second tab at the URL would be read instead)
    const inTab = (expression: string) =>
      maws.app.evaluate(({ webContents }, [id, js]) => webContents.fromId(id as number)!.executeJavaScript(js as string) as Promise<unknown>, [webContentsId!, expression] as const);
    expect(await inTab(`document.getElementById('count').textContent`)).toBe('0');
    note(`parent ${parent}: Haiku (record model.requested ${parentRecord.model.requested}), default mode, resuming its seeded conversation ${sc.engineId} (one user record, ${sc.seedBytes} bytes); the commented tab ${tabId} at ${url} (the served page: /comment.html's markup plus E0b's counter script), webContents.id ${webContentsId}; #count 0`);

    // ---- the comment: the toggle, the pick of #increment, Acceptance G2's text, sent as a Side thread (the default)
    const toggle = panel.locator('[data-browser-comment]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const box = await view.locator('#increment').boundingBox();
    await view.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await view.mouse.down();
    await view.mouse.up();
    const sheet = page.getByRole('dialog', { name: `Comment on ${INCREMENT_LABEL}` });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-anchor-locator', '#increment');
    await expect(sheet.locator('[data-comment-screenshot]')).toBeVisible();
    await expect(sheet.getByRole('radio', { name: /Side thread/ })).toBeChecked();
    expect(await inTab(`document.getElementById('count').textContent`), 'the pick reached nothing in the page').toBe('0');
    await sheet.getByRole('textbox', { name: 'Comment' }).fill(COMMENT);
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet).toHaveCount(0);

    let child = '' as AppSessionId;
    await expect
      .poll(async () => (child = (value(await invoke(page, 'session.list', {})).sessions.find((r) => r.lineage?.kind === 'side-thread' && r.lineage.parentAppSessionId === parent)?.appId ?? '') as AppSessionId), { timeout: 60_000 })
      .not.toBe('');
    started.push({ label: 'side thread', id: child });
    const childTabsBefore = (await tabsOf(s, child)).tabs;
    note(`side thread ${child} opened from the comment (Side thread, the sheet's default); its own tabs at open: ${JSON.stringify(childTabsBefore.map((t) => t.tabId))}`);
    expect(childTabsBefore, 'the thread’s session has no tab of its own at open').toEqual([]);

    // ---- the thread runs; every permission it asks is allowed once through the card in its Side pane
    const pane = page.locator(`[data-region="panel"] [data-side-thread-view="${child}"]`);
    await expect(pane, 'the Side pane opens on the thread').toBeVisible({ timeout: 60_000 });
    const row = page.locator(`[data-region="main"] section.transcript-side-thread[data-side-thread="${child}"]`);
    const allowed: string[] = [];
    const deadline = Date.now() + THREAD_MS;
    for (;;) {
      const state = await row.getAttribute('data-state', { timeout: 1_000 }).catch(() => null);
      if (state === 'finished' || state === 'failed') break;
      const events = await eventsOf(child);
      // the thread's own record says its turn ended (the row is the parent's mirror of it)
      const status = await statusOf(child).catch(() => null);
      if (ofKind(events, 'turn.ended').some((e) => e.parentToolUseId === null) && status?.turn === null && status.pendingRequests === 0) break;
      if (Date.now() > deadline) throw new Error(`the side thread did not finish within ${THREAD_MS / 1000} s (row state ${state})`);
      const resolved = new Set(ofKind(events, 'permission.resolved').map((e) => e.requestId));
      const open = ofKind(events, 'permission.requested').filter((e) => !resolved.has(e.requestId));
      if (open.length > 0) {
        const frame: Locator = pane.getByRole('group', { name: 'Approval needed' });
        const allow = frame.getByRole('button', { name: 'Allow', exact: true });
        if ((await allow.isVisible().catch(() => false)) && (await allow.isEnabled().catch(() => false))) {
          const once = frame.getByRole('radio', { name: 'Allow once' });
          if ((await once.count()) > 0) await once.click();
          await allow.click();
          allowed.push(open[0]!.toolName);
          await expect.poll(async () => ofKind(await eventsOf(child), 'permission.resolved').some((e) => e.requestId === open[0]!.requestId), { timeout: 30_000 }).toBe(true);
          continue;
        }
      }
      await page.waitForTimeout(500);
    }
    await expect.poll(() => row.getAttribute('data-state', { timeout: 1_000 }).catch(() => null), { timeout: 30_000 }).toMatch(/^(finished|failed)$/);
    const rowState = await row.getAttribute('data-state');
    note(`the thread's row in the parent's transcript reads ${rowState}: ${JSON.stringify((await row.textContent())?.trim() ?? null)}; permissions allowed once through the Side pane's card: ${JSON.stringify(allowed)}`);

    // ---- what the thread's agent did, from its journal
    const childJournal = (await statusOf(child)).journalPath;
    const parentJournal = (await statusOf(parent)).journalPath;
    const rows = journal(childJournal);
    const parentRows = journal(parentJournal);
    const childInit = initOf(rows);
    note(`init: the thread's model ${JSON.stringify(childInit?.model ?? null)}, plugins ${pluginsOf(childInit)}; the parent's plugins ${pluginsOf(initOf(parentRows))}`);
    note(`journals: thread ${childJournal}; parent ${parentJournal}`);
    const calls = mcpCalls(rows).filter((c) => c.name.startsWith('browser_'));
    for (const call of calls) note(`  seq ${seqOfCall(rows, call.requestId)} ${call.name} ${JSON.stringify(call.args)} → ${JSON.stringify(firstJson(rows, call.requestId))}`);
    const acts = calls.filter((c) => c.name === 'browser_act');
    const listed = calls.filter((c) => c.name === 'browser_tabs' && (c.args as { action?: string }).action === 'list');
    const opened = calls.filter((c) => c.name === 'browser_tabs' && (c.args as { action?: string }).action === 'open');
    const onTheTab = acts.filter((c) => {
      const args = c.args as { tabId?: string; action?: string; target?: { css?: string } | string };
      const result = firstJson(rows, c.requestId);
      return args.action === 'click' && args.tabId === tabId && typeof args.target === 'object' && args.target.css === '#increment' && result?.status === 'ok';
    });
    const count = await inTab(`document.getElementById('count').textContent`);
    const parentTabs = (await tabsOf(s, parent)).tabs;
    const childTabsAfter = (await tabsOf(s, child)).tabs;
    note(`after: the commented tab's page (by webContents.id ${webContentsId}) shows #count ${JSON.stringify(count)}; the parent's tabs ${JSON.stringify(parentTabs.map((t) => ({ tabId: t.tabId, url: t.url, control: t.control })))}; the thread's own tabs ${JSON.stringify(childTabsAfter.map((t) => ({ tabId: t.tabId, url: t.url })))}`);
    note(`browser.agent.acting notices the window received: ${JSON.stringify(await actingNotices())}`);

    // the transcript's browser_action row in the thread's pane
    const actionRows = pane.locator('section.transcript-browser-action[data-tool="browser_act"]');
    const headings = await actionRows.locator('[data-browser-heading]').allTextContents();
    note(`the thread's browser_act rows: ${JSON.stringify(headings)} (states ${JSON.stringify(await actionRows.evaluateAll((els) => els.map((el) => el.getAttribute('data-state'))))})`);
    const replies = ofKind(await eventsOf(child), 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt).map((e) => e.resultText ?? '');
    note(`the thread's replies: ${JSON.stringify(replies)}`);

    const verdict =
      onTheTab.length === 1 && count === '1' && childTabsAfter.length === 0 && opened.length === 0
        ? 'YES: G2 live half met (one browser_act click with target.css "#increment" and the commented tab\'s tabId, answered ok; #count 1 in that tab; the thread opened no tab)'
        : `NO: finding (browser_act on the commented tab: ${onTheTab.length}; browser_tabs list calls: ${listed.length}; tabs the thread opened: ${opened.length}; #count ${JSON.stringify(count)}; the thread's own tabs: ${childTabsAfter.length})`;
    note(`verdict: ${verdict}`);
    expect(onTheTab, 'one browser_act click on the commented tab by css, answered ok').toHaveLength(1);
    expect(opened, 'the thread opened no tab of its own').toEqual([]);
    expect(childTabsAfter, 'the thread’s session has no tab').toEqual([]);
    expect(count, 'the commented tab’s page was clicked once').toBe('1');
    expect(parentTabs.map((t) => t.tabId), 'the parent still has the one commented tab').toEqual([tabId]);
    // E4c's row names the element as the call and its result carry it (`elementOf`, transcript/model/copy.ts): role and
    // name when given ("Clicked button "Increment""), else the css; G2's `{css}` target alone reads "Clicked #increment"
    const target = onTheTab[0]!.args.target as { css: string; role?: string; name?: string };
    const named = [target.role ?? null, target.name !== undefined ? `"${target.name}"` : null].filter((part) => part !== null).join(' ');
    const heading = `Clicked ${named === '' ? target.css : named}`;
    await expect(actionRows.filter({ hasText: heading }).and(pane.locator('[data-state="done"]')), `E4c’s row for the click: ${heading}`).toHaveCount(1);
  } finally {
    for (const { label, id } of started.reverse()) {
      try {
        const status = value(await invoke(maws.page, 'session.status', { appSessionId: id as AppSessionId }));
        if (status.process !== 'exited') {
          value(await invoke(maws.page, 'session.stop', { appSessionId: id as AppSessionId, reason: 'stop' }));
          await expect.poll(async () => value(await invoke(maws.page, 'session.status', { appSessionId: id as AppSessionId })).process, { timeout: 30_000 }).toBe('exited');
        }
        costs.push({ label, costUsd: processCost(journal(status.journalPath)) });
      } catch (error) {
        note(`  ${label} ${id}: could not be stopped or booked: ${String(error)}`);
      }
    }
    note(`spend: ${costs.map((c) => `${c.label} ${c.costUsd.toFixed(4)}`).join('; ')}; total US$${costs.reduce((sum, c) => sum + c.costUsd, 0).toFixed(4)}`);
    await maws.cleanup();
    await server.close();
    afterRun = a15();
    note(`the app closed (its engine processes stopped first); A-15 after the run: ${afterRun.keys} keys, sha1 ${afterRun.digest} (${afterRun.digest === before.digest ? 'identical' : 'CHANGED'})`);
    note(`scratch kept for the review: ${sc.root} (journals under user-data/engine-host/journal/)`);
  }
  expect(afterRun!.digest, 'the A-15 delta after the run: no scratch project in the owner file').toBe(before.digest);
});
