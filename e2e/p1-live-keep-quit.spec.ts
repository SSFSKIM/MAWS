// E11's S5 (docs/doperpowers/plans/2026-10-06-e11-finish.md, Design §5 S5, §2 item 9; Task 6.5): a keep-quit with a real
// turn in flight, on the packaged build. The packaged app (MAWS_E2E_EXECUTABLE) launched as e2e/supervisor-packaged.spec.ts
// launches it, with the engine host detached (MAWS_HOST_MODE=detached), the installed Claude Code (unmodified, D-1) through
// ClaudeUsage's relay (GET /api/hello, one retry two minutes later, else `blocked: relay`), on Haiku in default permission
// mode, under a scratch config home. One session runs `sleep 45; echo DONE_<nonce>` through Bash (its permission allowed
// once); while the sleep runs the app quits and the quit question is answered keep (MAWS_E2E_QUIT_ANSWER=keep); the app
// is relaunched within 10 s over the same profile. Asserted: the quit kept one mid-turn session and the supervisor and
// the engine outlived the app; the relaunch connects to the same supervisor, which lists the session live with its turn
// open and no DONE yet; DONE_<nonce> then arrives (the host's stream, the relaunched window's live batches and the
// transcript), the turn ends, and nothing is doubled (one record, one sidebar row, no event or rendered row twice).
// Then Settings' Stop all: the session's engine and the supervisor exit and a fresh one starts; the app quits; no process
// of the profile survives (the supervisors included).
// The cap: MAWS_S5_MAX_USD (default US$0.10, the part of S5's US$0.25 left over from E10's two probes, which S5 re-runs
// beside this case) is the session's `--max-budget-usd`; the spend is read from the session's journals.
// Scratch: /private/tmp/maws-e11-s5-<stamp> (MAWS_S5_STAMP, else the time) holding `claude-config/` (`settings.json`
// `{}`, a `.claude.json` trusting `repo/`), `repo/` (a git repository with one seeded transcript) and `user-data/` (the
// app's profile: the supervisor's files, the journals); left in place for the sitting to read and remove. The owner's
// ~/.claude.json is only read: the A-15 reading before, after the keep-quit and after the app closed (a key under the
// scratch root appearing or vanishing is a breach, test/support/owner-file.ts). The engine's `system/init` plugin list
// is recorded and must hold none of the owner's (Decision Log 22 and 30). The log goes to `live-s5.txt` under
// MAWS_P1_LIVE_OUT (default /tmp/maws-e11-p1-live), line by line. It spends money; run on purpose only:
//   pnpm build:app && MAWS_P1_LIVE=1 MAWS_E2E_EXECUTABLE=dist/mac-arm64/MAWS.app/Contents/MacOS/MAWS \
//     pnpm exec playwright test e2e/p1-live-keep-quit.spec.ts
import { execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { HostStatus } from '@shared/ipc/schema/host';
import type { JournalRow } from '@shared/wire/journal';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { ownerPlugins } from '../test/support/claude-env';
import { isolatedGitEnv } from '../test/support/git-env';
import { compareA15 } from '../test/support/owner-file';
import { relaySkipReason } from '../test/support/relay-health';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { journalSpend } from './support/c12-prerun';
import { menu } from './support/code-product';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { seedTranscripts } from './support/maws-tools';
import { a15Line, a15Reading, initPluginsOf, installedEngine, liveOutDir, sittingLog } from './support/p1-live';
import { isAlive, killScratchProcesses, ps } from './support/processes';
import { sidebarOf, sidebarRow } from './support/sidebar';
import { tmpSocketDirOf } from './support/supervisor-socket';

const EXECUTABLE = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
test.skip(process.env.MAWS_P1_LIVE !== '1' || EXECUTABLE === null, 'S5 runs only under MAWS_P1_LIVE=1 over a packaged MAWS_E2E_EXECUTABLE');

const CAP_USD = Number(process.env.MAWS_S5_MAX_USD ?? '0.10');
const SLEEP_S = 45;
const RELAUNCH_WITHIN_MS = 10_000;

const statusOf = async (page: Page, id: AppSessionId) => value(await invoke(page, 'session.status', { appSessionId: id }));
const hostEvents = async (page: Page, id: AppSessionId): Promise<SessionEvent[]> => value(await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null })).events;
const mainTurnsEnded = (events: SessionEvent[]) => events.filter((e) => e.kind === 'turn.ended' && e.parentToolUseId === null && !e.isEchoReceipt);
const holds = (thing: unknown, text: string) => JSON.stringify(thing).includes(text);

function sessionRows(userData: string, id: string): JournalRow[] {
  const dir = join(userData, 'engine-host', 'journal', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().flatMap((n) => journal(join(dir, n)));
}

async function bounded<T>(promise: Promise<T>, ms: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message())), ms)));
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

interface Run {
  maws: MawsLaunch;
  page: Page;
  child: ChildProcess;
  quitLines(): string[];
  exited: Promise<void>;
}

test('S5: a keep-quit mid-turn on the packaged build; the relaunch lists the session live, DONE arrives once; Stop all; no survivor', async () => {
  test.setTimeout(600_000);
  const note = sittingLog(liveOutDir(), 's5');
  const relayFirst = relaySkipReason(RELAY_URL);
  let relay = relayFirst;
  if (relay !== null) {
    note(`S5: relay not ready (${relay}); waiting two minutes and retrying once`);
    await new Promise((r) => setTimeout(r, 120_000));
    relay = relaySkipReason(RELAY_URL);
  }
  if (relay !== null) {
    note(`S5: blocked: relay (${relay}) at ${new Date().toISOString()}`);
    test.skip(true, `blocked: relay: ${relay}`);
  }
  const engine = installedEngine();
  const nonce = randomBytes(4).toString('hex');
  const DONE = `DONE_${nonce}`;
  const PROMPT = `Run the Bash command \`sleep ${SLEEP_S}; echo ${DONE}\` yourself, in the foreground (never in the background, never through an agent, and with no timeout of your own), then reply with its output.`;

  const root = `/private/tmp/maws-e11-s5-${process.env.MAWS_S5_STAMP ?? new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  mkdirSync(root, { recursive: true });
  const config = join(realpathSync(root), 'claude-config');
  const repo = join(realpathSync(root), 'repo');
  const userData = join(realpathSync(root), 'user-data');
  for (const dir of [config, repo, userData]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'README.md'), 'E11 S5\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=E11', '-c', 'user.email=e11@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['E11 S5: the kept session']);

  const a15First = a15Reading();
  const breaches: string[] = [];
  const readA15 = (label: string) => {
    const now = a15Reading();
    note(`  ${a15Line(label, a15First, now, [root])}`);
    const { breach } = compareA15(a15First.keys, now.keys, [root]);
    if (breach.length > 0) breaches.push(`${label}: ${JSON.stringify(breach)}`);
  };
  note(`==== S5, ${new Date().toISOString()}; scratch ${root}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL}, Haiku, default permission mode; cap US$${CAP_USD.toFixed(4)} as the session's --max-budget-usd`);
  note(`app: ${EXECUTABLE} (packaged), MAWS_HOST_MODE=detached, MAWS_HARNESS=0, every CLAUDE* variable of the runner dropped (launchEnvironment); scratch claude-config/ (settings.json {}, .claude.json trusting repo/), user-data/ the profile`);
  note(a15Line('before the case', a15First, a15First, [root]));

  const runs: Run[] = [];
  const supervisors = new Set<number>();
  const engines = new Set<number>();
  const sockets = new Set<string>();
  const launch = async (extra: Record<string, string> = {}): Promise<Run> => {
    const maws = await launchMaws({ userData, env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', MAWS_HOST_MODE: 'detached', CLAUDE_CONFIG_DIR: config, ...extra } });
    const child = maws.app.process(); // Playwright drops app.process() once the app closes; the cleanup still needs it
    let text = '';
    child.stdout?.on('data', (chunk) => (text += String(chunk)));
    child.stderr?.on('data', (chunk) => (text += String(chunk)));
    const exited = new Promise<void>((done) => (child.exitCode !== null || child.signalCode !== null ? done() : child.once('exit', () => done())));
    const run: Run = { maws, page: maws.page, child, quitLines: () => text.split('\n').filter((l) => l.startsWith('quit-guard:')), exited };
    runs.push(run);
    return run;
  };
  const ready = async (page: Page, match: (s: HostStatus) => boolean = () => true): Promise<HostStatus> => {
    let status: HostStatus | null = null;
    await expect
      .poll(async () => {
        const answer = await invoke(page, 'host.status', undefined);
        status = answer.ok ? answer.value : null;
        return status !== null && status.state === 'ready' && status.supervisor !== null && match(status);
      }, { timeout: 30_000, message: 'main is connected to a supervisor' })
      .toBe(true);
    const s = status as unknown as HostStatus;
    supervisors.add(s.supervisor!.pid);
    if (s.supervisor!.socketPath !== null) sockets.add(s.supervisor!.socketPath);
    return s;
  };
  const recordOf = async (page: Page): Promise<AppSessionId> => {
    let id = '';
    await expect
      .poll(async () => (id = value(await invoke(page, 'session.list', { includeArchived: true })).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? ''), { timeout: 30_000, message: 'the seeded session has a record' })
      .not.toBe('');
    return id as AppSessionId;
  };
  const showSession = async (page: Page, id: AppSessionId) => {
    await expect(async () => {
      const row = await sidebarRow(page, { appSessionId: id });
      await expect(row).toBeVisible({ timeout: 2_000 });
      await row.click();
      await expect(page.locator(`[data-region="main"] [data-composer="${id}"]`)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  };

  let failed = false;
  try {
    // ---- the first app: the session launched, its Bash sleep allowed and running ---------------------------------------
    const first = await launch({ MAWS_E2E_QUIT_ANSWER: 'keep' });
    const host = await ready(first.page);
    expect(host.transport).toBe('detached');
    const supervisor = host.supervisor!.pid;
    note(`first app pid ${first.child.pid}; supervisor pid ${supervisor} (${ps(supervisor, 'command').slice(0, 160)})`);
    const id = await recordOf(first.page);
    await showSession(first.page, id);
    const spec = { ...launchDefaults(id, repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD, resume: { sessionId: engineId as SessionId, fork: false } };
    expect(value(await invoke(first.page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    await expect.poll(async () => (await statusOf(first.page, id)).process, { timeout: 120_000 }).toBe('ready');
    const enginePid = (await statusOf(first.page, id)).pid!;
    engines.add(enginePid);
    note(`session ${id} (engine session ${engineId}) launched on Haiku, default mode, maxBudgetUsd ${CAP_USD.toFixed(4)}, resuming its seeded transcript in place; engine pid ${enginePid}`);
    value(await invoke(first.page, 'session.send', { appSessionId: id, content: PROMPT }));
    note(`prompt sent at ${new Date().toISOString()}: ${PROMPT}`);

    let requested: Extract<SessionEvent, { kind: 'permission.requested' }> | undefined;
    await expect
      .poll(async () => (requested = (await hostEvents(first.page, id)).find((e): e is Extract<SessionEvent, { kind: 'permission.requested' }> => e.kind === 'permission.requested')) !== undefined, { timeout: 120_000, message: 'the Bash call asks its permission' })
      .toBe(true);
    note(`permission requested: ${requested!.toolName} ${JSON.stringify(requested!.input).slice(0, 200)}`);
    expect(requested!.toolName).toBe('Bash');
    expect(holds(requested!.input, DONE), 'the request is the prompt’s command').toBe(true);
    value(await invoke(first.page, 'session.answer', { appSessionId: id, requestId: requested!.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
    const allowedAt = Date.now();
    await expect.poll(async () => (await hostEvents(first.page, id)).some((e) => e.kind === 'permission.resolved' && e.requestId === requested!.requestId), { timeout: 30_000 }).toBe(true);
    // a few seconds into the sleep: the command runs, its result is 40 s away
    await first.page.waitForTimeout(4_000);
    const toolUseId = requested!.toolUseId;
    const resultOf = (events: SessionEvent[]) => events.find((e): e is Extract<SessionEvent, { kind: 'tool.result' }> => e.kind === 'tool.result' && e.toolUseId === toolUseId);
    const beforeQuit = await statusOf(first.page, id);
    expect(beforeQuit.turn, 'the turn is open before the quit').not.toBeNull();
    const eventsBeforeQuit = await hostEvents(first.page, id);
    expect(resultOf(eventsBeforeQuit), 'the command has not answered before the quit').toBeUndefined();
    const turnsBeforeQuit = mainTurnsEnded(eventsBeforeQuit).length;
    note(`allowed once at ${new Date(allowedAt).toISOString()}; ${eventsBeforeQuit.length} events before the quit, no result for the Bash call ${toolUseId}; the turn open`);

    // ---- keep-quit --------------------------------------------------------------------------------------------------------
    await first.maws.app.evaluate(({ app }) => app.quit());
    await bounded(first.exited, 20_000, () => `MAWS did not quit; the guard said ${JSON.stringify(first.quitLines())}`);
    const exitedAt = Date.now();
    const keepLine = first.quitLines().find((l) => l.includes('auto-answered keep'));
    note(`quit at ${new Date(exitedAt).toISOString()} (${exitedAt - allowedAt} ms after the allow): ${keepLine ?? JSON.stringify(first.quitLines())}`);
    expect(keepLine).toBe('quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
    expect(isAlive(supervisor), 'the supervisor outlives the app').toBe(true);
    expect(isAlive(enginePid), 'the engine outlives the app').toBe(true);
    readA15('after the keep-quit');

    // ---- the relaunch -----------------------------------------------------------------------------------------------------
    const second = await launch();
    const relaunchMs = second.maws.launchedAt - exitedAt;
    note(`relaunched ${relaunchMs} ms after the first app exited (bound ${RELAUNCH_WITHIN_MS} ms); app pid ${second.child.pid}`);
    expect(relaunchMs, 'relaunched within 10 s').toBeLessThan(RELAUNCH_WITHIN_MS);
    const host2 = await ready(second.page);
    expect(host2.supervisor!.pid, 'the relaunch connects to the same supervisor').toBe(supervisor);
    await second.page.evaluate(() => {
      const seen: { appSessionId: string; events: unknown[] }[] = [];
      (window as unknown as { __s5: typeof seen }).__s5 = seen;
      window.maws.on('session.eventBatch', (batch) => seen.push(batch as { appSessionId: string; events: unknown[] }));
    });
    const live = await statusOf(second.page, id);
    const atConnect = await hostEvents(second.page, id);
    const connectedAt = Date.now();
    note(`at the connect (${connectedAt - exitedAt} ms after the exit): session.status process ${live.process}, turn ${live.turn === null ? 'none' : 'open'}, pid ${live.pid}; ${atConnect.length} events (${atConnect.length - eventsBeforeQuit.length} since the last read before the quit); the Bash call's result in them: ${resultOf(atConnect) !== undefined}`);
    expect(live, 'the session listed live with its turn open').toMatchObject({ process: 'ready', turn: expect.anything() });
    expect(live.pid, 'the same engine').toBe(enginePid);
    expect(resultOf(atConnect), 'the command still running at the connect').toBeUndefined();
    expect(mainTurnsEnded(atConnect).length, 'no turn ended since the quit').toBe(turnsBeforeQuit);
    const listed = value(await invoke(second.page, 'engine.sessions', undefined)).filter((st) => st.appSessionId === id && st.process !== 'exited');
    expect(listed, 'the supervisor lists the session once, live').toHaveLength(1);
    await showSession(second.page, id);

    // ---- DONE arrives -----------------------------------------------------------------------------------------------------
    await expect.poll(async () => resultOf(await hostEvents(second.page, id)) !== undefined, { timeout: (SLEEP_S + 60) * 1000, message: 'the Bash call answers' }).toBe(true);
    const doneAt = Date.now();
    const result = resultOf(await hostEvents(second.page, id))!;
    expect(holds(result.content, DONE), `the command's output is ${DONE}`).toBe(true);
    let ended: Extract<SessionEvent, { kind: 'turn.ended' }> | undefined;
    await expect
      .poll(async () => {
        ended = mainTurnsEnded(await hostEvents(second.page, id))[turnsBeforeQuit] as Extract<SessionEvent, { kind: 'turn.ended' }> | undefined;
        return ended !== undefined && (await statusOf(second.page, id)).turn === null;
      }, { timeout: 120_000, message: 'the turn ends' })
      .toBe(true);
    const batches = await second.page.evaluate((sid) => (window as unknown as { __s5: { appSessionId: string; events: { id: string }[] }[] }).__s5.filter((b) => b.appSessionId === sid), id);
    const liveIds = batches.flatMap((b) => b.events.map((e) => e.id));
    expect(liveIds, 'the result reached the relaunched window live').toContain(result.id);
    expect(new Set(liveIds).size, 'no event reached the window twice in its live batches').toBe(liveIds.length);
    const pane = second.page.locator('[data-region="main"] [data-pane="0"]');
    await expect(pane.getByText(DONE).first(), `${DONE} in the transcript`).toBeVisible({ timeout: 30_000 });
    note(`the Bash call's result ${JSON.stringify(result.content).slice(0, 120)} in the host's stream at ${new Date(doneAt).toISOString()} (${doneAt - exitedAt} ms after the exit, ${doneAt - allowedAt} ms after the allow), and in the window's live batches; the turn ended (${ended!.result}, US$${ended!.costUsd.toFixed(4)}, reply ${JSON.stringify(ended!.resultText)}); ${liveIds.length} events reached the window live, none twice; ${DONE} shown in the transcript`);

    // ---- no duplicate -----------------------------------------------------------------------------------------------------
    const all = await hostEvents(second.page, id);
    const eventIds = all.map((e) => e.id);
    expect(new Set(eventIds).size, 'no event id twice in the host’s stream').toBe(eventIds.length);
    const records = value(await invoke(second.page, 'session.list', { includeArchived: true })).sessions.filter((s) => s.engineSessionId === engineId);
    expect(records, 'one record of the session').toHaveLength(1);
    const sidebarRows = await sidebarOf(second.page).locator(`[role="treeitem"][data-menu="session:${id}"]`).count();
    const rendered = await pane.locator('[data-row-id]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-row-id') ?? ''));
    expect(new Set(rendered).size, 'no transcript row rendered twice').toBe(rendered.length);
    const doneRows = await pane.locator('[data-row-id]').filter({ hasText: DONE }).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-row-id') ?? ''));
    note(`no duplicate: ${eventIds.length} event ids unique; ${records.length} record; sidebar rows naming the session ${sidebarRows}; ${rendered.length} rendered rows unique; rows holding ${DONE}: ${JSON.stringify(doneRows)}`);
    expect(sidebarRows, 'one sidebar row').toBe(1);

    // ---- Stop all, then the quit ------------------------------------------------------------------------------------------
    await menu(second.maws, 'settings.open');
    const group = second.page.getByRole('group', { name: 'Background supervisor' });
    note(`Settings › Background supervisor before Stop all: "${await group.getByRole('status').textContent()}"`);
    await group.getByRole('button', { name: 'Stop all sessions and the supervisor…' }).click();
    note(`the confirmation: "${(await group.textContent())?.replace(/\s+/g, ' ').slice(0, 200)}"`);
    await group.getByRole('button', { name: 'Stop all', exact: true }).click();
    await expect.poll(() => isAlive(supervisor), { timeout: 15_000, message: 'the supervisor exits on Stop all' }).toBe(false);
    await expect.poll(() => isAlive(enginePid), { timeout: 15_000, message: 'the engine exits on Stop all' }).toBe(false);
    const fresh = (await ready(second.page, (st) => st.supervisor!.pid !== supervisor)).supervisor!.pid;
    expect(value(await invoke(second.page, 'engine.sessions', undefined)).filter((st) => st.process !== 'exited'), 'no live session after Stop all').toEqual([]);
    note(`Stop all: supervisor ${supervisor} and engine ${enginePid} exited; a fresh supervisor ${fresh} serves with no session`);
    await second.maws.app.evaluate(({ app }) => app.quit());
    await bounded(second.exited, 20_000, () => `MAWS did not quit after Stop all; the guard said ${JSON.stringify(second.quitLines())}`);
    await expect.poll(() => isAlive(fresh), { timeout: 10_000, message: 'the fresh supervisor exits with an unbusy quit' }).toBe(false);
    note(`the app quit (${second.quitLines().join(' | ') || 'no question: nothing mid-turn'}); the fresh supervisor ${fresh} exited with it`);

    // ---- the record: spend, plugins, A-15 ---------------------------------------------------------------------------------
    const rows = sessionRows(userData, id);
    const plugins = initPluginsOf(rows) ?? [];
    const owners = ownerPlugins(plugins, [root]);
    note(`init plugins: ${JSON.stringify(plugins.map((p) => `${p.name} (${p.source})`))}${owners.length > 0 ? ` OWNER'S: ${JSON.stringify(owners)}` : ' (none of the owner’s)'}`);
    const models = [...new Set(rows.filter((r) => r.direction === 'in' && (r.frame as { type?: string }).type === 'assistant').map((r) => (r.frame as { message?: { model?: string } }).message?.model))];
    note(`assistant models: ${JSON.stringify(models)}; spend (the journals' main results) US$${journalSpend(userData).usd.toFixed(4)} of US$${CAP_USD.toFixed(4)}`);
    expect(owners, 'the engine loaded none of the owner’s plugins').toEqual([]);
    expect(second.maws.consoleErrors(), 'no console error in the relaunched window').toEqual([]);
  } catch (error) {
    failed = true;
    note(`FAILED: ${error instanceof Error ? error.message.split('\n').slice(0, 6).join(' / ') : String(error)}`);
    throw error;
  } finally {
    for (const run of runs) {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
      await bounded(run.exited, 10_000, () => `app pid ${run.child.pid} did not exit after SIGKILL`).catch((error: unknown) => note(String(error)));
      await run.maws.cleanup().catch(() => {}); // the app is gone; the profile is the scratch's
    }
    let leftover: unknown = null;
    const survivorsBefore = [...supervisors, ...engines].filter(isAlive);
    await killScratchProcesses(root, [...supervisors, ...engines]).catch((error: unknown) => (leftover = error));
    for (const socket of sockets) {
      const dir = tmpSocketDirOf(userData, socket);
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    }
    readA15('after the app closed');
    const pgrep = execFileSync('/bin/sh', ['-c', 'pgrep -fl maws-supervisor || true'], { encoding: 'utf8' }).trim();
    note(`survivor check: recorded supervisors ${JSON.stringify([...supervisors])}, engines ${JSON.stringify([...engines])}; alive at the cleanup ${JSON.stringify(survivorsBefore)}${failed ? ' (after a failure: killed)' : ''}; processes naming the scratch after it: ${leftover === null ? 'none' : String(leftover)}; pgrep -fl maws-supervisor: ${pgrep || 'none'}`);
    if (!failed) {
      expect(survivorsBefore, 'no supervisor or engine outlived the quit').toEqual([]);
      expect(leftover, 'no process names the scratch').toBeNull();
      expect(breaches, 'no project of the scratch appeared in or vanished from the owner file (A-15)').toEqual([]);
    }
  }
});
