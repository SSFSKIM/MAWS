// P3-E2's live run (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, M6 and acceptance 8: item 1 on the installed
// engine; P3-E's E2 acceptance (1)). Its cap and scratch layout are P3-C's live run's (e2e/presentations-live.spec.ts):
// the product app (a plain build, as MAWS ships it) with the installed Claude Code (unmodified, D-1) under a scratch
// CLAUDE_CONFIG_DIR under /tmp (`settings.json` `{}`, a `.claude.json` trusting the scratch project), through
// ClaudeUsage's relay (GET /api/hello, one retry two minutes later, else the run is `blocked: relay`), on Haiku in default
// permission mode with the session's `--max-budget-usd`, every permission allowed for the session through the request card
// docked in the composer. The window is never shown (`launchMaws`'s quiet window).
// One session, three prompts through the real composer:
//   1. the agent reads the dashboard guide, writes sales.csv under its working directory, creates a dashboard from markdown
//      whose chart and table blocks name `sales`, binds the file with one artifact_dataset call (answered its columns and
//      row count at the live revision) and reads the dashboard once, which lists the dataset;
//   2. it binds a TSV and a JSON array the same way (the files written by the run into its directory), tries a ragged CSV
//      (refused naming its line, nothing written) and a 16 MiB + 1 file (refused by its size), then reads once more;
//   3. meanwhile a second session (the host's acceptance seam, src/engine-host/dashboards/e2e-seam.ts: the real tools as
//      session B) replaces `sales` and edits the prose; the agent, from its last read, replaces `sales` (refused
//      `conflict` naming it, nothing landed) and replaces `costs` (merged across B's prose edit and replacement).
// Then the dashboard opens in a main tab: both views draw the bound data under their source labels. The tool-use replay
// is the engine's to make, so it is proved at the product seam (e2e/dashboard.spec.ts), never claimed here.
// The owner's ~/.claude.json is only read, for the A-15 delta before the launch and after the app closed. The run's lines
// go to stdout and to `live-run.txt` under the scratch root, which is kept for inspection (journals included).
// It spends money, within MAWS_LIVE_MAX_USD (US$0.75 when unset, at most US$1), the session's `--max-budget-usd`; run on
// purpose only (the script builds, the flag runs; the architect's one run takes the final bundle's out/ instead):
//   MAWS_LIVE=1 pnpm e2e:dashboard-live
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { guardToolTime } from '../test/live/support/tool-time'; // P4-A2 (X34)
import { ownerPlugins } from '../test/support/claude-env';
import { isolatedGitEnv } from '../test/support/git-env';
import { compareA15 } from '../test/support/owner-file';
import { relaySkipReason } from '../test/support/relay-health';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { AgentSeam } from './support/dashboards';
import { launchMaws, type MawsLaunch } from './support/launch';
import { liveMaxUsd } from './support/live-budget';
import { endLiveRun, liveSpend } from './support/live-lifecycle';
import { eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts, type McpResult } from './support/maws-tools';
import { a15Line, a15Reading, chargeOf, initPluginsOf, installedEngine } from './support/p1-live';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_LIVE !== '1', 'the P3-E2 live run runs only under MAWS_LIVE=1');
test.describe.configure({ timeout: 1_800_000 });

const CAP_USD = liveMaxUsd() ?? 0.75;
const TURN_MS = 600_000;
const TITLE = 'Harbor Tutoring enrolment';
const SALES_CSV = 'course,enrolled\nAlgebra,42\nChemistry,31\nEssay writing,27\n';

const PROMPTS = {
  build:
    'Build a MAWS dashboard of course enrolment. Do every step yourself, one after another, never through an agent:\n' +
    '1. Call mcp__maws__artifact_describe_type with kind "dashboard" and read its guide and format reference.\n' +
    `2. With your Write tool, write the file sales.csv in your working directory with exactly these lines:\n${SALES_CSV}` +
    `3. Make ONE mcp__maws__artifact_create call with kind "dashboard", title "${TITLE}" and markdown content holding: a heading, one paragraph of prose, ` +
    'a chart block that draws a bar chart of enrolled by course from dataset id "sales" titled "Enrolment by course", and a table block over dataset "sales" titled "Enrolment table" (write the blocks as the format reference shows).\n' +
    '4. Make ONE mcp__maws__artifact_dataset call binding sales.csv as dataset id "sales" with title "Enrolment", baseRevision the revision the create returned.\n' +
    '5. Call mcp__maws__artifact_read on the dashboard once, last.\n' +
    'Then reply with exactly: READY <columns> <row count> as the artifact_dataset call answered them.',
  formats:
    'Your working directory now also holds costs.tsv, people.json, ragged.csv and big.csv. Bind each with its own mcp__maws__artifact_dataset call on the same dashboard, in this order, ' +
    'each with baseRevision the revision your previous successful call answered: costs.tsv as id "costs", people.json as id "people", ragged.csv as id "ragged", big.csv as id "big". ' +
    'Some may be refused: do not fix, retry or read the files; go on to the next. Then call mcp__maws__artifact_read on the dashboard once, last. ' +
    'Reply with one line per file: its id, then BOUND or REFUSED and the refusal’s reason.',
  stale:
    'Do NOT read the dashboard again. Make exactly two mcp__maws__artifact_dataset calls on it, both with baseRevision the revision your last mcp__maws__artifact_read returned: ' +
    'first sales-v2.csv as id "sales", then costs-v2.tsv as id "costs". Make no other call. Reply with one line per call: its id, then BOUND or REFUSED and the refusal’s reason.',
} as const;

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
type Refusal = { reason: string; line?: number; size?: number; dataset?: string; detail?: string };
const refusalIn = (text: string): Refusal | null => {
  const at = text.indexOf(' {"reason":');
  return at < 0 ? null : (JSON.parse(text.slice(at + 1)) as Refusal);
};

test('the agent creates a dashboard from markdown, binds the CSV it wrote in one call and reads it listed; a TSV and a JSON array bind, a ragged and an oversize file are refused naming why; from a stale read its replacement of a dataset another session replaced is refused `conflict`, another merges across that session’s prose', async () => {
  const root = realpathSync(mkdtempSync('/tmp/maws-p3e2-live-'));
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
  writeFileSync(join(repo, 'README.md'), '# Harbor Tutoring\n\nAn after-school tutoring centre for high-school students in Portland, Maine.\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=P3-E2', '-c', 'user.email=p3e2@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['P3-E2 live: a dashboard over files']);

  const a15First = a15Reading();
  const ours = [root];
  note(`==== P3-E2 live run (M6, acceptance 8: item 1 on the installed engine), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200), Haiku, default permission mode, --max-budget-usd ${CAP_USD} (MAWS_LIVE_MAX_USD)`);
  note(`scratch: ${root} (claude-config/ settings.json {} and .claude.json trusting repo/; repo/ a one-file project; user-data/ the app's profile, show: false); the app: the product build (out/main/index.js), every CLAUDE* variable of the runner dropped (launchEnvironment); the second session through the host's acceptance seam (MAWS_DASHBOARD_E2E=1)`);
  note(a15Line('before the launch', a15First, a15First, ours));

  let maws: MawsLaunch | null = null;
  let id = '' as AppSessionId;
  let journalPath: string | null = null;
  let enginePid: number | null = null;
  let prompted = false;
  const allowed: string[] = [];
  let failure: unknown = null;
  try {
    maws = await launchMaws({ userData, env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: config, MAWS_DASHBOARD_E2E: '1' } });
    const { page } = maws;
    const other = new AgentSeam(join(userData, 'dashboard-e2e'));
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
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
    const mainTurnsEnded = (all: SessionEvent[]) => ofKind(all, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
    const ipc = async <T,>(name: string, input: unknown): Promise<T> => {
      const result = (await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const)) as Result<T>;
      if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
      return result.value;
    };
    const revisionOf = async (artifactId: string) => (await ipc<{ artifact: { revision: number } | null }>('artifacts.get', { artifactId })).artifact?.revision ?? -1;
    const calls = () => mcpCalls(rows()).map((c) => ({ ...c, result: mcpResultOf(rows(), c.requestId) }));
    const json = <T,>(result: McpResult) => JSON.parse(resultText(result)) as T;
    const logCalls = (from: number) => {
      for (const c of calls().slice(from)) note(`  maws ${c.name} ${JSON.stringify(c.args).slice(0, 600)} -> ${c.result ? `${c.result.isError ? 'ERROR ' : ''}${resultText(c.result).slice(0, 900)}` : 'no answer'}`);
    };
    const allowPending = async (): Promise<boolean> => {
      const all = await events();
      const resolved = new Set(ofKind(all, 'permission.resolved').map((e) => e.requestId));
      const open = ofKind(all, 'permission.requested').filter((e) => !resolved.has(e.requestId));
      if (open.length === 0) return false;
      const frame = pane.getByRole('group', { name: 'Approval needed' });
      const allow = frame.getByRole('button', { name: 'Allow', exact: true });
      if (!(await allow.isVisible().catch(() => false)) || !(await allow.isEnabled().catch(() => false))) return false;
      const forSession = frame.getByRole('radio', { name: 'Allow for this session' });
      if ((await forSession.count()) > 0) await forSession.click();
      await allow.click();
      allowed.push(open[0]!.toolName);
      await expect.poll(async () => ofKind(await events(), 'permission.resolved').some((e) => e.requestId === open[0]!.requestId), { timeout: 30_000 }).toBe(true);
      return true;
    };
    const turn = async (label: string, prompt: string): Promise<{ reply: string; made: ReturnType<typeof calls> }> => {
      const ended = mainTurnsEnded(await events()).length;
      const before = calls().length;
      const message = pane.getByRole('textbox', { name: 'Message', exact: true });
      await message.click();
      await page.keyboard.insertText(prompt);
      prompted = true;
      await page.keyboard.press('Meta+Enter');
      const deadline = Date.now() + TURN_MS;
      for (;;) {
        const status = await statusOf();
        if (mainTurnsEnded(await events()).length > ended && status.turn === null && status.pendingRequests === 0) break;
        if (status.process === 'exited') throw new Error(`the engine exited during ${label}`);
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} to end`);
        if (await allowPending()) continue;
        await page.waitForTimeout(400);
      }
      const reply = mainTurnsEnded(await events()).at(-1)?.resultText ?? '';
      const tools = ofKind(await events(), 'tool.use').filter((e) => e.parentToolUseId === null).map((e) => e.toolName);
      note(`${label}: reply ${JSON.stringify(reply.slice(0, 400))}; tools so far ${JSON.stringify(tools)}; permissions allowed for the session ${JSON.stringify(allowed)}; receipts so far US$${chargeOf(rows(), CAP_USD).receipted.toFixed(4)}`);
      logCalls(before);
      return { reply, made: calls().slice(before) };
    };
    const binds = (made: ReturnType<typeof calls>, dataset: string) => made.filter((c) => c.name === 'artifact_dataset' && c.args.id === dataset);

    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(700, 20);
    await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();
    const spec = { ...launchDefaults(id, repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    journalPath = (await statusOf()).journalPath;
    await expect.poll(async () => (await statusOf()).process, { timeout: 120_000 }).toBe('ready');
    enginePid = (await statusOf()).pid;

    // ---- 1: the file written, the dashboard made from markdown, the file bound in one call, then one read ------------
    const built = await turn('turn 1 (build and bind)', PROMPTS.build);
    const [init] = ofKind(await events(), 'session.init');
    expect(ownerPlugins(init?.plugins ?? [], [root]), 'none of the owner plugins').toEqual([]);
    note(`init plugins ${JSON.stringify(initPluginsOf(rows()))} (none of the owner's)`);
    expect(existsSync(join(repo, 'sales.csv')), 'the agent wrote sales.csv in its working directory').toBe(true);
    const creates = built.made.filter((c) => c.name === 'artifact_create' && c.args.kind === 'dashboard' && c.result && !c.result.isError);
    expect(creates.length, 'a dashboard artifact_create succeeded').toBeGreaterThan(0);
    const artifactId = json<{ artifactId: string }>(creates.at(-1)!.result!).artifactId;
    const content = String(creates.at(-1)!.args.content ?? '');
    expect(content.match(/^:::chart /gm)?.length ?? 0, 'the markdown holds a chart and a table block').toBeGreaterThanOrEqual(2);
    const salesBinds = binds(built.made, 'sales');
    expect(salesBinds, 'one artifact_dataset call bound sales').toHaveLength(1);
    expect(salesBinds[0]!.result?.isError, salesBinds[0]!.result ? resultText(salesBinds[0]!.result) : 'no answer').toBeUndefined();
    const bound = json<{ revision: number; rows: number; columns: { name: string; type: string }[] }>(salesBinds[0]!.result!);
    expect(bound.rows).toBe(3);
    expect(bound.columns).toEqual([{ name: 'course', type: 'string' }, { name: 'enrolled', type: 'number' }]);
    const reads = built.made.filter((c) => c.name === 'artifact_read' && c.result && !c.result.isError);
    expect(reads.length, 'the agent read the dashboard').toBeGreaterThan(0);
    const listed = json<{ revision: number; datasets: { id: string; rows: number }[] }>(reads.at(-1)!.result!);
    expect(listed.datasets).toEqual([expect.objectContaining({ id: 'sales', rows: 3 })]);
    expect(listed.revision).toBe(await revisionOf(artifactId));
    note(`G1: ${artifactId} created from markdown (${content.length} chars); sales bound at revision ${bound.revision} (${bound.rows} rows, columns ${JSON.stringify(bound.columns)}); the read lists ${JSON.stringify(listed.datasets)}; the reply ${JSON.stringify(built.reply.slice(0, 200))}`);

    // ---- 2: a TSV and a JSON array bind; a ragged and an oversize file are refused ---------------------------------
    writeFileSync(join(repo, 'costs.tsv'), 'course\tcost\nAlgebra\t120\nChemistry\t95.5\n');
    writeFileSync(join(repo, 'people.json'), JSON.stringify([{ name: 'Ana', course: 'Algebra' }, { name: 'Ben', course: 'Chemistry', grade: 11 }]));
    writeFileSync(join(repo, 'ragged.csv'), 'course,enrolled\nAlgebra,42\nChemistry\nEssay writing,27\n');
    writeFileSync(join(repo, 'big.csv'), new Uint8Array(16 * 1024 * 1024 + 1));
    const beforeRefusals = { datasets: ['sales'] };
    const formats = await turn('turn 2 (formats and refusals)', PROMPTS.formats);
    const answerOf = (dataset: string) => {
      const [call] = binds(formats.made, dataset);
      expect(call, `a call bound ${dataset}`).toBeDefined();
      return call!.result!;
    };
    expect(answerOf('costs').isError, resultText(answerOf('costs'))).toBeUndefined();
    expect(json<{ rows: number; columns: { type: string }[] }>(answerOf('costs'))).toMatchObject({ rows: 2, columns: [{ type: 'string' }, { type: 'number' }] });
    expect(answerOf('people').isError, resultText(answerOf('people'))).toBeUndefined();
    expect(json<{ rows: number }>(answerOf('people')).rows).toBe(2);
    expect(answerOf('ragged').isError).toBe(true);
    expect(refusalIn(resultText(answerOf('ragged')))).toMatchObject({ reason: 'invalid', line: 3 });
    expect(answerOf('big').isError).toBe(true);
    expect(refusalIn(resultText(answerOf('big')))).toMatchObject({ reason: 'tooLarge', size: 16 * 1024 * 1024 + 1 });
    const secondReads = formats.made.filter((c) => c.name === 'artifact_read' && c.result && !c.result.isError);
    expect(secondReads.length, 'the agent read again, last').toBeGreaterThan(0);
    const seen = json<{ revision: number; datasets: { id: string }[] }>(secondReads.at(-1)!.result!);
    expect(seen.datasets.map((d) => d.id), 'nothing of the refused files was written').toEqual([...beforeRefusals.datasets, 'costs', 'people'].sort());
    note(`G2: costs and people bound; ragged refused ${JSON.stringify(refusalIn(resultText(answerOf('ragged'))))}; big refused ${JSON.stringify(refusalIn(resultText(answerOf('big'))))}; read at revision ${seen.revision} lists ${JSON.stringify(seen.datasets.map((d) => d.id))}`);

    // ---- 3: another session replaces `sales` and edits the prose; the agent's two replacements from its stale read ----
    const otherRead = await other.ok<{ revision: number; markdown: string }>('B', 'artifact_read', { artifact: artifactId });
    await other.ok('B', 'artifact_dataset', { artifact: artifactId, baseRevision: otherRead.revision, id: 'sales', path: await other.write('B', 'sales.csv', 'course,enrolled\nAlgebra,50\nChemistry,35\n') });
    const paragraph = /^([^#:^\n|*-][^\n]*?) \^([A-Za-z0-9_-]+)$/m.exec(otherRead.markdown);
    expect(paragraph, `a prose block in the agent's markdown: ${otherRead.markdown.slice(0, 400)}`).not.toBeNull();
    const word = paragraph![1]!.split(/\s+/).find((w) => /^[A-Za-z]{4,}$/.test(w) && paragraph![1]!.split(w).length === 2)!; // once in its block, as replace_text needs
    const afterB = await other.ok<{ revision: number }>('B', 'artifact_read', { artifact: artifactId });
    await other.ok('B', 'artifact_edit', { artifact: artifactId, baseRevision: afterB.revision, ops: [{ op: 'replace_text', block: paragraph![2], old: word, new: `${word} (edited by B)` }] });
    const beforeStale = await revisionOf(artifactId);
    expect(beforeStale).toBeGreaterThan(seen.revision);
    writeFileSync(join(repo, 'sales-v2.csv'), 'course,enrolled\nAlgebra,44\nChemistry,30\nEssay writing,29\n');
    writeFileSync(join(repo, 'costs-v2.tsv'), 'course\tcost\nAlgebra\t125\nChemistry\t99\n');
    note(`G3a: session B replaced sales and edited ${paragraph![2]} ("${word}") at revision ${beforeStale}, after the agent's read at ${seen.revision}`);
    const stale = await turn('turn 3 (the stale replacements)', PROMPTS.stale);
    expect(stale.made.filter((c) => c.name === 'artifact_read'), 'no read before the stale calls').toEqual([]);
    const [salesCall] = binds(stale.made, 'sales');
    const [costsCall] = binds(stale.made, 'costs');
    expect(salesCall?.args.baseRevision, 'sales from its stale read').toBe(seen.revision);
    expect(costsCall?.args.baseRevision, 'costs from its stale read').toBe(seen.revision);
    expect(salesCall!.result?.isError, 'the replacement of sales B replaced is refused').toBe(true);
    expect(refusalIn(resultText(salesCall!.result!))).toMatchObject({ reason: 'conflict', dataset: 'sales' });
    expect(costsCall!.result?.isError, costsCall!.result ? resultText(costsCall!.result) : 'no answer').toBeUndefined();
    const merged = json<{ revision: number }>(costsCall!.result!);
    expect(merged.revision, 'the merged replacement answers the live revision').toBe(await revisionOf(artifactId));
    const finalRead = await other.ok<{ markdown: string; datasets: { id: string; file: string; rows: number }[] }>('B', 'artifact_read', { artifact: artifactId });
    expect(finalRead.markdown, 'B’s prose edit kept').toContain(`${word} (edited by B)`);
    expect(finalRead.datasets.find((d) => d.id === 'sales'), 'B’s sales kept, the agent’s refused one never landed').toMatchObject({ rows: 2 });
    expect(finalRead.datasets.find((d) => d.id === 'costs')).toMatchObject({ file: 'costs-v2.tsv' });
    note(`G3b: sales refused ${JSON.stringify(refusalIn(resultText(salesCall!.result!)))}; costs merged at revision ${merged.revision}; the agent replied ${JSON.stringify(stale.reply.slice(0, 300))}`);

    // ---- the dashboard as the owner opens it: both views drawn under their source labels -----------------------------
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    await page.locator(`[data-library] article[data-artifact-row="${artifactId}"]`).click({ timeout: 15_000 });
    const tab = page.locator(`[data-artifact-tab="${artifactId}"]`);
    const views = tab.locator('.ds-doc figure.dash-view');
    await expect(views.first().locator('.dash-figure > svg, .dash-figure > table')).toBeVisible({ timeout: 30_000 });
    const labels = await views.locator('.dash-source-label').allTextContents();
    note(`G4: the dashboard opens in a main tab with ${await views.count()} views; labels ${JSON.stringify(labels)}`);
    expect(await views.count()).toBeGreaterThanOrEqual(2);
    for (const label of labels) expect(label).toMatch(/ · from sales\.csv · updated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC by /);
    await tab.screenshot({ path: join(root, 'dashboard.png') });
    await other.release('B');

    const errors = maws.consoleErrors();
    note(`the window's console errors: ${JSON.stringify(errors)}`);
    expect.soft(errors).toEqual([]);
    note(`tool time (P4-A2, X34): ${guardToolTime(journalPath).line}`); // after the last turn; throws over the bound
    note('PASS: the agent wrote a CSV, made the dashboard from markdown and bound the file in one call, the read listing it; a TSV and a JSON array bound, a ragged and an oversize file refused naming why with nothing written; from its stale read its replacement of the dataset B replaced was refused `conflict` and another merged across B’s prose edit');
  } catch (error) {
    failure = error;
    note(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
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
    const spend = liveSpend(journalPath !== null && existsSync(journalPath) ? journal(journalPath) : [], CAP_USD, prompted);
    note(`spend: receipts ${spend.receipts.length > 0 ? `${JSON.stringify(spend.receipts)}, total_cost_usd ${spend.receipted.toFixed(4)}` : 'none'}; accounted exposure US$${spend.accounted.toFixed(4)} (${spend.basis}); cap US$${CAP_USD}; journal ${journalPath ?? 'none (no launch)'}`);
    const a15After = a15Reading();
    note(a15Line('after the app closed', a15First, a15After, ours));
    note(`scratch kept for inspection: ${root}`);
    expect(compareA15(a15First.keys, a15After.keys, ours).breach, 'no project of the run’s scratch in the owner file (A-15)').toEqual([]);
    expect(spend.accounted, 'within the cap').toBeLessThanOrEqual(CAP_USD);
    if (failure === null) {
      expect(spend.receipts.length, 'a passing run has the engine’s receipt for each turn').toBeGreaterThanOrEqual(3);
      expect(spend.settled, 'the last receipt came after the last prompt').toBe(true);
    }
  }
  if (failure !== null) throw failure;
});
