// E1's live sitting (docs/doperpowers/plans/2026-10-05-e1-tool-server.md, M5; P1 spec §9 E1): the product app, built
// as MAWS ships it, with the installed Claude Code (never patched, D-1) under a scratch CLAUDE_CONFIG_DIR under /tmp
// (`settings.json` `{}`, a `.claude.json` that trusts the scratch repository), through ClaudeUsage's relay, on Haiku in
// default permission mode. M2's prompts run in a session each, the async one asking for a foreground command so its
// answer folds into the running turn. Board ticket 848 retired `send_file`: its session and step are gone, G1's check of
// the init moved to the blocking ask's session, and the init lists no `send_file`. The tool-choice plan's M6 (board
// tickets 421 and 420, docs/doperpowers/plans/2026-11-23-tool-choice.md) adds two sessions, each in the permission mode a
// new chat has (auto): one with Question "Default", whose set lists no `ask`, so the engine's built-in AskUserQuestion
// asks and is answered in its call's row; one with MAWS's ask, told only of a question it can work past, which passes
// `blocking: false` of itself, keeps working and takes the answer as a message. The human's part is done through the
// real surfaces: every permission through the request card (since UX wave U1b at the transcript's end), every ask through
// its form in the capsule's row (the Question sheet's own sections; the folder through main's pick seam); the open seam
// stays set, so nothing opens on this Mac. The owner's ~/.claude.json is read
// only, for the A-15 delta before the first launch and after every session. Writes the plain-text evidence
// (`live-sitting.txt`) and the screenshots in both themes (`e1-<surface>-<theme>.png`) into the directory
// MAWS_E1_LIVE_OUT names (E11 W-E: a re-run records into its own directory, E1's committed evidence untouched),
// docs/doperpowers/evidence/p1-e1/ when it is unset.
// It spends money, within the sitting's cap MAWS_E1_LIVE_MAX_USD (US$0.20 when unset; each session launches with what
// is left of it); run on purpose only, after a build:
//   MAWS_HARNESS=1 electron-vite build && MAWS_E1_LIVE=1 pnpm exec playwright test e2e/maws-tools-live.spec.ts
// In the gate it is the live group e2e:tools-live (`ci-gate.sh --live`), its cap and its directory under test-results/
// in its script.
import { addressed } from './support/address';
import { surface } from './support/shell';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import type { AskQuestion } from '@shared/maws/tools';
import type { MawsToolSet } from '@shared/maws/tool-set';
import type { PermissionMode } from '@shared/graph/enums';
import { TOOL_ERRORS } from '../src/shared/maws/tools';
import { FULL_MAWS_TOOL_SET } from '../src/shared/maws/tool-set';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { isolatedGitEnv } from '../test/support/git-env';
import { relaySkipReason } from '../test/support/relay-health';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { ownerPlugins } from '../test/support/claude-env';
import { a15DeltaText, compareA15 } from '../test/support/owner-file';
import { journal, mainResults, processCost } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { clearToasts, eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts, shootThemes, type Frame } from './support/maws-tools';
import { sidebarOf, sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_E1_LIVE !== '1', 'the E1 live sitting runs only under MAWS_E1_LIVE=1');
test.describe.configure({ timeout: 1_500_000 });

const EVIDENCE = process.env.MAWS_E1_LIVE_OUT ? resolve(process.env.MAWS_E1_LIVE_OUT) : join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e1');
const EVIDENCE_FILE = join(EVIDENCE, 'live-sitting.txt');
const TURN_MS = 300_000;

const PROMPTS = {
  blocking:
    'Use the maws ask tool (blocking) to ask me five questions, with these ids and modalities: q1 choice single with options Red, Green, Blue ("Which colour?"); q2 choice multi with options Mon, Tue, Wed ("Which days?"); q3 text ("What should the title be?"); q4 folder ("Which folder holds the assets?"); q5 repository ("Which repository is this for?"). Then reply with one line per question: id, then the answer or SKIPPED or DECIDE.',
  // M2's async prompt, asking for the command in the foreground so the answer folds into the running turn (Surprises)
  async: 'Use the maws ask tool with blocking false to ask me one choice question with id q1 and options Yes, No ("Proceed?"). Then, without waiting, run the Bash command `sleep 15; echo WAITED` in the foreground, never in the background, and report its output. When my answer arrives, reply with ANSWER: followed by it.',
  showPane: 'Call the maws show_pane tool three times: first with pane "terminal", then with pane "artifact" and target "none", then with pane "nope". Reply with one line per call: the pane name and the result status or error text.', // P3-L M6b: E2's `deliverable` pane renamed
  // the tool-choice plan's M6: a session whose question tool is the engine's own (no `ask` listed)
  engineQuestion: 'Use your AskUserQuestion tool to ask me one question, "Proceed?", with the options Yes and No. When I have answered, reply with ANSWER: followed by my answer.',
  // ... and one with MAWS's ask, told of a question it can work past and nothing of `blocking`
  keepWorking: 'Use the maws ask tool to ask me one choice question with id q1 and options Tea and Coffee ("Which drink should the note name?"). You do not need my answer to start: meanwhile run the Bash command `sleep 15; echo WORKED` in the foreground, never in the background, and report its output. When my answer arrives, reply with ANSWER: followed by it.',
} as const;

// ---- the owner file (A-15), the engine, the evidence ------------------------------------------------------------------

// The standing rule's check: the owner's ~/.claude.json `projects` keys under /tmp, read only; the digest is the sha1
// `| shasum` prints for the rule's own command (its first line), the keys come back as JSON (the second).
interface A15Reading {
  keys: string[];
  digest: string;
}
function a15(): A15Reading {
  const script = `import json;d=json.load(open('${homedir()}/.claude.json'));k=sorted(k for k in d.get('projects',{}) if k.startswith('/tmp') or k.startswith('/private/tmp'));print(k);print(json.dumps(k))`;
  const [repr, keys] = execFileSync('/usr/bin/python3', ['-c', script], { encoding: 'utf8' }).split('\n');
  return { keys: JSON.parse(keys!) as string[], digest: createHash('sha1').update(`${repr}\n`).digest('hex') };
}

// One A-15 reading against the first (Decision Log 35): a key under the sitting's own scratch appearing or vanishing is a
// breach; another owner session's key is recorded and passes.
function checkA15(label: string, before: A15Reading, after: A15Reading, ours: readonly string[]): string {
  const delta = compareA15(before.keys, after.keys, ours);
  const line = `A-15 ${label}: ${after.keys.length} keys, sha1 ${after.digest} (${a15DeltaText(delta)})`;
  note(line);
  expect(delta.breach, `the A-15 delta ${label}: no project of the sitting's scratch in the owner file`).toEqual([]);
  return line;
}

// The sitting's cap (E11 Design §5): every session launches with what is left of it as its --max-budget-usd.
const CAP_USD = Number(process.env.MAWS_E1_LIVE_MAX_USD ?? '0.2');
const costs: { label: string; costUsd: number }[] = []; // booked per session at its end
const remainingUsd = () => CAP_USD - costs.reduce((sum, c) => sum + c.costUsd, 0);

// The installed engine (the installer's link, resolved), as a fresh install of MAWS finds it.
function installedEngine(): { bin: string; version: string } {
  const bin = realpathSync(join(homedir(), '.local/bin/claude'));
  const version = /\d+\.\d+\.\d+/.exec(execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000 }))?.[0] ?? '';
  return { bin, version };
}

const lines: string[] = [];
function note(line: string): void {
  lines.push(line);
  writeFileSync(EVIDENCE_FILE, `${lines.join('\n')}\n`);
}

// ---- the scratch -----------------------------------------------------------------------------------------------------

interface Scratch {
  root: string;
  config: string;
  repo: string;
}

// One root under /tmp (so a leak would show in the A-15 delta): the config home, the trusted repository with its
// `assets` folder, and one seeded transcript per session, so C4 indexes the repository as a project (the sheet's
// repository list) and the sidebar shows a row for each session to launch under.
function scratch(titles: string[]): Scratch & { engineIds: string[] } {
  const root = realpathSync(mkdtempSync('/tmp/maws-e1-sitting-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  mkdirSync(config);
  mkdirSync(join(repo, 'assets'), { recursive: true });
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'one.txt'), 'ONE\n');
  writeFileSync(join(repo, 'assets', '.keep'), '');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=E1', '-c', 'user.email=e1@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  return { root, config, repo, engineIds: seedTranscripts(config, repo, titles) };
}

// ---- the app ---------------------------------------------------------------------------------------------------------

interface Sitting {
  maws: MawsLaunch;
  page: Page;
  scratch: Scratch;
  openLog: string;
  pane: Locator;
  panel: Locator;
  events(id: string): Promise<SessionEvent[]>;
}

const statusOf = async (s: Sitting, id: string) => value(await invoke(s.page, 'session.status', { appSessionId: id as never }));

// What the sitting did in one session, for the evidence.
interface Session {
  label: string;
  id: string;
  journalPath: string;
  allowed: string[]; // the tools whose permission the card allowed
  ended: boolean;
}
const begun: Session[] = []; // every session the sitting launched, so a failed step's session is still stopped and booked

// The session shown (its sidebar row clicked), launched fresh as the app launches (C7's one list of X6 fields; Haiku,
// default permission mode unless `opts` names another, the gateway; the full set of MAWS's tools unless `opts` names a
// set), and the prompt sent from the real composer.
async function begin(s: Sitting, label: string, id: string, prompt: string, opts: { permissionMode?: PermissionMode; mawsTools?: MawsToolSet } = {}): Promise<Session> {
  await (await sidebarRow(s.page, { appSessionId: id })).click();
  await s.page.mouse.move(700, 20);
  await expect(s.pane.locator(`[data-composer="${await addressed(s.page, id)}"]`)).toBeVisible();
  const maxBudgetUsd = Number(remainingUsd().toFixed(4));
  expect(maxBudgetUsd, `${label}: the sitting's cap US$${CAP_USD} has room left`).toBeGreaterThan(0);
  const permissionMode = opts.permissionMode ?? 'default';
  const spec = { ...launchDefaults(id as AppSessionId, s.scratch.repo), model: 'haiku', permissionMode, subagentModel: 'haiku', maxBudgetUsd, ...(opts.mawsTools && { mawsTools: opts.mawsTools }) };
  note(`  ${label}: launched in ${permissionMode} mode${opts.mawsTools ? ` with the set of MAWS's tools ${JSON.stringify(opts.mawsTools)}` : ''}, with maxBudgetUsd ${maxBudgetUsd} (the cap less the sitting's spend so far)`);
  expect(value(await invoke(s.page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
  // booked as soon as the host holds it (its journal is named at the reservation), so a launch that fails before the
  // prompt is still stopped and booked by the sitting's `finally`
  const session: Session = { label, id, journalPath: (await statusOf(s, id)).journalPath, allowed: [], ended: false };
  begun.push(session);
  await expect.poll(async () => (await statusOf(s, id)).process, { timeout: 120_000 }).toBe('ready');
  const message = s.pane.getByRole('textbox', { name: 'Message', exact: true });
  await message.click();
  await s.page.keyboard.insertText(prompt);
  await s.page.keyboard.press('Enter');
  return session;
}

// Waits for `until`, allowing every permission the session asks meanwhile through its card at the transcript's end
// (once). Only a request not yet resolved is answered, so a card still showing its answered state is left alone.
async function drive(s: Sitting, session: Session, what: string, until: () => Promise<boolean>, timeout = TURN_MS): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await until()) return;
    if (Date.now() > deadline) throw new Error(`${session.label}: timed out waiting for ${what}`);
    const events = await s.events(session.id);
    const resolved = new Set(ofKind(events, 'permission.resolved').map((e) => e.requestId));
    const open = ofKind(events, 'permission.requested').filter((e) => !resolved.has(e.requestId));
    if (open.length > 0) {
      const frame = s.pane.getByRole('group', { name: 'Approval needed' });
      const allow = frame.getByRole('button', { name: 'Allow once', exact: true });
      if ((await allow.isVisible().catch(() => false)) && (await allow.isEnabled().catch(() => false))) {
        await allow.click();
        session.allowed.push(open[0]!.toolName);
        await expect.poll(async () => ofKind(await s.events(session.id), 'permission.resolved').some((e) => e.requestId === open[0]!.requestId), { timeout: 30_000 }).toBe(true);
        continue;
      }
    }
    await s.page.waitForTimeout(400);
  }
}

const idleNow = async (s: Sitting, id: string) => {
  const status = await statusOf(s, id);
  return status.turn === null && status.pendingRequests === 0;
};
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);

// The session stopped (the process exits), the A-15 delta checked, the journal kept under the scratch root and booked.
async function end(s: Sitting, session: Session, before: A15Reading): Promise<void> {
  session.ended = true;
  const stopped = value(await invoke(s.page, 'session.stop', { appSessionId: session.id as never, reason: 'stop' }));
  await expect.poll(async () => (await statusOf(s, session.id)).process, { timeout: 30_000 }).toBe('exited');
  const dir = join(s.maws.userData, 'engine-host', 'journal', session.id);
  const kept = join(s.scratch.root, 'journals', session.label);
  cpSync(dir, kept, { recursive: true });
  const rows = journal(session.journalPath);
  const costUsd = processCost(rows);
  costs.push({ label: session.label, costUsd });
  note(`  ${session.label}: appSessionId ${session.id}; journal ${join(kept, session.journalPath.split('/').at(-1)!)}; main results ${mainResults(rows).length}; total_cost_usd ${costUsd.toFixed(4)}; permissions allowed once through the card: ${JSON.stringify(session.allowed)}; stopped ${JSON.stringify(stopped)}`);
  checkA15(`after ${session.label}`, before, a15(), ours(s));
}

// The sitting's own scratch, for the A-15 delta: the root holding the config home and the repository, and the app's
// userData.
const ours = (s: Sitting) => [s.scratch.root, s.maws.userData];

// `e1-<surface>-<theme>.png` beside the evidence text, in both themes (a toast over the panel's bottom edge, where the
// sheet's Submit bar sits, is cleared first).
const shoot = (s: Sitting, surface: string) => shootThemes(s.page, (theme) => join(EVIDENCE, `e1-${surface}-${theme}.png`));

const sheetOf = (s: Sitting) => s.panel.locator('[data-ask-sheet]');
const capsuleOf = (s: Sitting) => s.pane.locator('section.transcript-ask').last();
// UX wave U1b (O-17): a waiting ask's form stands in its capsule's row; the sheet opens only when the person opens it
const formOf = (s: Sitting) => capsuleOf(s).locator('.transcript-ask-form [data-hover-ask]');
const sectionFor = (sheet: Locator, question: AskQuestion) => sheet.locator(`section[data-question-id="${question.id}"]`);

// ---- the sitting -----------------------------------------------------------------------------------------------------

test('the live sitting: a blocking ask, an async ask folded into its turn, show_pane, the engine’s question under Question Default, an ask that keeps working', async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  let relay = relaySkipReason(RELAY_URL);
  if (relay !== null) {
    await new Promise((resolve) => setTimeout(resolve, 120_000)); // a 503 is transient: wait two minutes, retry once
    relay = relaySkipReason(RELAY_URL);
  }
  expect(relay, 'the relay answers GET /api/hello').toBeNull();
  const engine = installedEngine();
  expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/);
  const before = a15();
  const sc = scratch(['E1 sitting: blocking ask', 'E1 sitting: async ask', 'E1 sitting: show_pane', 'E1 sitting: Question Default', 'E1 sitting: ask and keep working']);
  const openLog = join(sc.root, 'open.txt');
  note(`E1 live sitting (M5), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200), Haiku, default permission mode, the sitting's cap US$${CAP_USD} (MAWS_E1_LIVE_MAX_USD), each session launched with what is left of it as maxBudgetUsd`);
  note(`app: the product build (out/main/index.js, MAWS_HARNESS=0) over a scratch CLAUDE_CONFIG_DIR ${sc.config} (settings.json {}, .claude.json trusting ${sc.repo}); the MAWS_E2E_OPEN_LOG seam, so nothing opens on this Mac`);
  note(`A-15 before the first launch: ${before.keys.length} keys, sha1 ${before.digest}`);

  let sitting: Sitting | null = null;
  const maws = await launchMaws({ defaultRoute: 'gateway', env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: sc.config, MAWS_E2E_OPEN_LOG: openLog } });
  try {
    const { page } = maws;
    await recordEvents(page);
    const s: Sitting = (sitting = {
      maws, page, scratch: sc, openLog,
      pane: page.locator('[data-region="main"] [data-pane="0"]'),
      panel: page.locator('[data-region="panel"]'),
      events: (id) => eventsOf(page, id),
    });
    let ids: string[] = [];
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        ids = sc.engineIds.map((engineId) => sessions.find((r) => r.engineSessionId === engineId)?.appId ?? '');
        return ids.every((id) => id !== '');
      }, { timeout: 30_000 })
      .toBe(true);
    const [blockingId, asyncId, showPaneId, engineQuestionId, keepWorkingId] = ids as [string, string, string, string, string];

    await test.step('2 a blocking ask: the init lists the maws tools without send_file; the capsule with its form in its row, five modalities, no sheet opened, the attention item, Submit, the reply', async () => {
      const session = await begin(s, 'blocking ask', blockingId, PROMPTS.blocking);
      await drive(s, session, 'the ask', async () => ofKind(await s.events(session.id), 'maws.ask.opened').length > 0);
      // G1 (board ticket 848: moved here with send_file's step gone; the init lists no send_file)
      const [init] = ofKind(await s.events(session.id), 'session.init');
      expect(init!.tools).toEqual(expect.arrayContaining(['mcp__maws__ask', 'mcp__maws__show_pane']));
      expect(init!.tools).not.toContain('mcp__maws__send_file');
      expect(init!.mcpServers).toContainEqual({ name: 'maws', status: 'connected', source: 'sdk' });
      expect(ownerPlugins(init!.plugins, [sc.root]), 'none of the owner plugins (no inherited CLAUDE_CODE_PLUGIN_DIRS)').toEqual([]);
      note(`G1: session.init (the journal's system/init) lists ${init!.tools.length} tools, ${JSON.stringify(init!.tools.filter((t) => t.startsWith('mcp__')))}; mcp_servers ${JSON.stringify(init!.mcpServers)}; plugins ${JSON.stringify(init!.plugins)} (none of the owner's)`);
      const [opened] = ofKind(await s.events(session.id), 'maws.ask.opened');
      expect(opened!.blocking).toBe(true);
      const capsule = capsuleOf(s);
      await expect(capsule).toHaveAttribute('data-ask-state', 'pending');
      await expect(capsule.locator('[data-ask-chip]')).toHaveText('Waiting for you');
      const form = formOf(s);
      await expect(form).toHaveAttribute('data-hover-ask', opened!.askId);
      await expect(form.locator('section[data-question-id]')).toHaveCount(opened!.questions.length);
      await expect(sheetOf(s), 'no sheet opened by itself').toHaveCount(0);
      note(`G3: maws.ask.opened ${opened!.questions.length} questions ${JSON.stringify(opened!.questions.map((q) => [q.id, q.modality, q.multi ?? false]))}; the capsule reads "Waiting for you"; its form stands in its row, and no sheet opened`);
      await capsule.scrollIntoViewIfNeeded();
      await expect(capsule).toBeVisible();
      await shoot(s, 'capsule-pending');

      // the attention item: in Needs you and on the Overview card
      const needsYou = sidebarOf(page).getByRole('list', { name: 'Needs you' }).getByRole('button').filter({ hasText: 'Question' });
      await expect(needsYou).toHaveCount(1);
      await maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('tab.overview')?.click());
      const overview = page.locator('[data-region="main"]').getByRole('dialog', { name: 'Overview' });
      const card = overview.getByRole('article').filter({ has: page.getByRole('button', { name: 'Answer…', exact: true }) }); // the word cut (C108)
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(`${opened!.questions.length} questions`);
      await shoot(s, 'attention');
      await page.keyboard.press('Escape');
      await expect(overview).toHaveCount(0);

      // M2's answers, given in the row's form: Blue; Mon and Wed with Other "Fri"; the text skipped; the assets folder through
      // the native pick; the repository delegated
      const byModality = (modality: AskQuestion['modality'], multi?: boolean) => opened!.questions.find((q) => q.modality === modality && (multi === undefined || (q.multi ?? false) === multi))!;
      const single = byModality('choice', false);
      const multi = byModality('choice', true);
      await sectionFor(form, single).getByRole('radio', { name: 'Blue' }).click();
      await sectionFor(form, multi).getByRole('checkbox', { name: 'Mon' }).click();
      await sectionFor(form, multi).getByRole('checkbox', { name: 'Wed' }).click();
      await sectionFor(form, multi).getByRole('checkbox', { name: 'Other…' }).click();
      await sectionFor(form, multi).getByRole('textbox').fill('Fri');
      await sectionFor(form, byModality('text')).getByRole('button', { name: 'Skip' }).click();
      const assets = join(sc.repo, 'assets');
      await maws.app.evaluate((_electron, dir) => void (process.env.MAWS_E2E_PICK_PATHS = dir), assets);
      await sectionFor(form, byModality('folder')).getByRole('button', { name: 'Choose folder…' }).click();
      await expect(sectionFor(form, byModality('folder')).getByRole('list')).toHaveText(assets);
      await expect(sectionFor(form, byModality('repository')).getByRole('radio', { name: 'repo' })).toBeVisible();
      await sectionFor(form, byModality('repository')).getByRole('button', { name: 'Decide for me' }).click();
      await shoot(s, 'ask-form');
      await clearToasts(page);
      await form.getByRole('button', { name: /^Submit/ }).click();

      await drive(s, session, 'the answer and the reply', async () => ofKind(await s.events(session.id), 'maws.ask.answered').length > 0 && (await idleNow(s, session.id)));
      const [answered] = ofKind(await s.events(session.id), 'maws.ask.answered');
      expect(answered).toMatchObject({ askId: opened!.askId, delivery: 'result' });
      // what the form was given, written as the result's answers, one per question in the ask's order
      const given = (q: AskQuestion) =>
        q === single ? { status: 'answered', value: ['Blue'] }
        : q === multi ? { status: 'answered', value: ['Mon', 'Wed'], otherText: 'Fri' }
        : q.modality === 'text' ? { status: 'skipped' }
        : q.modality === 'folder' ? { status: 'answered', value: [assets] }
        : { status: 'decide_for_me' };
      expect(answered!.answers).toMatchObject(opened!.questions.map((q) => ({ ...(q.id === undefined ? {} : { id: q.id }), ...given(q) })));
      await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
      await expect(capsule.locator('[data-ask-chip]')).toHaveText('Answered');
      await expect(needsYou).toHaveCount(0);
      const reply = mainTurnsEnded(await s.events(session.id)).at(-1)?.resultText ?? '';
      await shoot(s, 'capsule-answered');
      await expect(capsule.locator('button.transcript-ask-top')).toHaveAccessibleDescription('View answers'); // the word cut (T98): the row is the press
      await capsule.locator('button.transcript-ask-top').click();
      await expect(sheetOf(s).locator('[data-ask-readonly]')).toBeVisible();
      note(`G3: Submit wrote ${JSON.stringify(answered!.answers.map((a) => [a.id, a.status, a.value ?? null, a.otherText ?? null]).map((a) => JSON.stringify(a).replace(sc.root, '<scratch>')))}; the attention item left Needs you; the capsule reads "Answered"; View answers reopened it read-only; reply ${JSON.stringify(reply.replace(sc.root, '<scratch>'))}`);
      expect(reply).toMatch(/Blue/);
      expect(reply).toMatch(/SKIPPED/i);
      await end(s, session, before);
    });

    await test.step('3 an async ask: acknowledged at once, answered while the foreground command runs, folded into the turn', async () => {
      const session = await begin(s, 'async ask', asyncId, PROMPTS.async);
      await drive(s, session, 'the async ask', async () => ofKind(await s.events(session.id), 'maws.ask.opened').length > 0);
      const [opened] = ofKind(await s.events(session.id), 'maws.ask.opened');
      expect(opened!.blocking).toBe(false);
      const capsule = capsuleOf(s);
      await expect(capsule).toHaveAttribute('data-ask-state', 'asked');
      await expect(capsule.locator('[data-ask-chip]')).toHaveText('Asked, answer when ready');
      // the model keeps working: its Bash call starts, then the answer goes from the row's form while it runs
      await drive(s, session, 'the Bash call', async () => ofKind(await s.events(session.id), 'tool.use').some((e) => e.toolName === 'Bash'));
      await page.waitForTimeout(2_000);
      const form = formOf(s);
      await expect(form).toHaveAttribute('data-hover-ask', opened!.askId);
      await form.getByRole('radio', { name: 'Yes' }).click();
      await clearToasts(page);
      await form.getByRole('button', { name: 'Submit', exact: true }).click();
      await drive(s, session, 'the reply', async () => ofKind(await s.events(session.id), 'maws.ask.answered').length > 0 && (await idleNow(s, session.id)));
      await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
      const rows = journal(session.journalPath);
      const steer = rows.find((r) => r.direction === 'out' && (r.frame as { type?: string; priority?: string }).type === 'user' && (r.frame as { priority?: string }).priority === 'next');
      expect(((steer!.frame as { message: { content: string } }).message.content)).toMatch(new RegExp(`^\\[MAWS ask ${opened!.askId}\\]`));
      const results = mainResults(rows);
      const firstResult = results[0]!;
      const folded = results.length === 1 && steer!.seq < firstResult.seq;
      const replies = mainTurnsEnded(await s.events(session.id)).map((t) => t.resultText ?? '');
      // the tool's acknowledgement, written before the answer's steer
      const askCall = mcpCalls(rows).find((c) => c.name === 'ask')!;
      expect(JSON.parse(resultText(mcpResultOf(rows, askCall.requestId)!))).toEqual({ status: 'asked', askId: opened!.askId });
      const ack = rows.find((r) => r.direction === 'out' && (r.frame as { type?: string; response?: { request_id?: string } }).type === 'control_response' && (r.frame as { response: { request_id: string } }).response.request_id === askCall.requestId)!;
      expect(ack.seq, 'the acknowledgement before the answer').toBeLessThan(steer!.seq);
      // the answer's steer written inside the Bash call's span: after its tool_use, before its tool_result
      const blocks = (r: (typeof rows)[number]) => (((r.frame as Frame).message as { content?: unknown } | undefined)?.content ?? []) as { type?: string; id?: string; name?: string; tool_use_id?: string }[];
      const bashUse = rows.find((r) => r.direction === 'in' && (r.frame as Frame).type === 'assistant' && Array.isArray(blocks(r)) && blocks(r).some((b) => b.type === 'tool_use' && b.name === 'Bash'));
      const bashId = bashUse && blocks(bashUse).find((b) => b.type === 'tool_use' && b.name === 'Bash')!.id;
      const bashResult = rows.find((r) => r.direction === 'in' && (r.frame as Frame).type === 'user' && Array.isArray(blocks(r)) && blocks(r).some((b) => b.type === 'tool_result' && b.tool_use_id === bashId));
      const duringBash = bashUse !== undefined && bashResult !== undefined && bashUse.seq < steer!.seq && steer!.seq < bashResult.seq;
      note(`G4: maws.ask.opened blocking false; the acknowledgement {status: "asked", askId} written at seq ${ack.seq}, before the answer's steer; the capsule read "Asked, answer when ready"; the steer (priority next, seq ${steer!.seq}) ${duringBash ? `went while Bash ran (its tool_use at seq ${bashUse!.seq}, its result at seq ${bashResult!.seq})` : `did not land inside Bash's span (tool_use seq ${bashUse?.seq ?? 'none'}, result seq ${bashResult?.seq ?? 'none'})`}, and ${folded ? `folded into the running turn (one main result, seq ${firstResult.seq})` : `did not fold: ${results.length} main results at seqs ${JSON.stringify(results.map((r) => r.seq))}`}; replies ${JSON.stringify(replies)}`);
      expect.soft(duringBash, 'the answer went from the row’s form while Bash ran').toBe(true);
      // the steer names a pick by its place, `option <k>`, never by its label (board ticket 711, `picksOf` in src/shared/maws/ask.ts):
      // the model may report the answer as the place it read or as the label it maps to
      expect(replies.some((r) => /ANSWER:\s*(?:"?Yes\b|option 1\b)/i.test(r)), `the answer reached the model\n${replies.join('\n---\n')}`).toBe(true);
      expect.soft(folded, 'the answer folded into the running turn').toBe(true);
      await end(s, session, before);
    });

    // E2 landed the Deliverables tool after E1's sitting, so the pane exists and target "none" names nothing (the replay
    // spec's expectation, maws-tools.spec.ts); E1's build answered "not available in this build". P3-L M6b: the
    // `artifact` pane and the Artifacts tool. UX wave U6d (O-44): the pane is retired; the engine still sends the call (a
    // pane outside the listed enum reaches the server, pass3/p1-maws-show-pane's `nope`), the host refuses it with the
    // sentence that teaches the link and asks no window
    await test.step('4 show_pane: the Terminal opens, the retired artifact pane and an unknown pane are error cells', async () => {
      const session = await begin(s, 'show_pane', showPaneId, PROMPTS.showPane);
      await drive(s, session, 'the turn end', async () => ofKind(await s.events(session.id), 'turn.ended').some((e) => e.parentToolUseId === null) && (await idleNow(s, session.id)));
      const shown = ofKind(await s.events(session.id), 'maws.pane.shown');
      expect(shown.map((e) => [e.pane, e.opened?.kind ?? null, e.error])).toEqual([
        ['terminal', 'panel-tool', null],
        ['artifact', null, TOOL_ERRORS.artifactPaneRetired],
      ]);
      await expect(surface(s.page, 'terminal')).toBeVisible();
      const divider = s.pane.locator('[data-kind="divider"]').last().locator('button[aria-expanded]').first();
      if ((await divider.getAttribute('aria-expanded')) === 'false') await divider.click();
      // the cells' own labels, since the model's reply may quote the same words (a live run's read "opened Terminal panel")
      const cell = (text: string | RegExp) => s.pane.locator('.transcript-cell-label').filter({ hasText: text });
      await expect(cell(/^Opened Terminal$/)).toBeVisible();
      await expect(cell(/^Could not open pane: MAWS no longer opens an artifact for the user\./)).toBeVisible();
      await expect(cell(/^Could not open pane: unknown pane "nope"/)).toBeVisible();
      await shoot(s, 'pane');
      const reply = mainTurnsEnded(await s.events(session.id)).at(-1)?.resultText ?? '';
      note(`G5: maws.pane.shown ${JSON.stringify(shown.map((e) => ({ pane: e.pane, opened: e.opened, error: e.error })))}; the Terminal tab opened in the panel; the cells read "Opened Terminal", "Could not open pane: MAWS no longer opens an artifact for the user. …", "Could not open pane: unknown pane "nope"…"; reply ${JSON.stringify(reply)}`);
      await end(s, session, before);
    });

    // The tool-choice plan's M6 (A2 on a real engine; P3, `uxwave-421-native-ask`, recorded it in default mode): Question
    // "Default" lists no `ask` and passes neither ask flag, so the engine offers its built-in AskUserQuestion, whose call
    // raises MAWS's question in the call's row; the answer given there is the tool's result.
    await test.step('5 Question Default, in auto mode: the built-in AskUserQuestion asks in its call’s row and the answer reaches the agent', async () => {
      const set: MawsToolSet = { ...FULL_MAWS_TOOL_SET, question: 'engine' };
      const session = await begin(s, 'Question Default', engineQuestionId, PROMPTS.engineQuestion, { permissionMode: 'auto', mawsTools: set });
      const spawn = journal(session.journalPath).find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'spawn')!.frame as { args: string[]; mawsTools?: unknown };
      expect(spawn.args, 'no --disallowedTools AskUserQuestion').not.toContain('--disallowedTools');
      expect(spawn.args, 'no --allowedTools mcp__maws__ask').not.toContain('--allowedTools');
      expect(spawn.mawsTools, 'the spawn row records the set').toEqual(set);
      await drive(s, session, 'the question', async () => ofKind(await s.events(session.id), 'question.requested').length > 0);
      const [init] = ofKind(await s.events(session.id), 'session.init');
      expect(init!.tools).toContain('AskUserQuestion');
      expect(init!.tools, 'no MAWS ask is listed').not.toContain('mcp__maws__ask');
      expect(init!.tools).toContain('mcp__maws__show_pane');
      expect((await statusOf(s, session.id)).permissionMode, 'the case runs in auto, the mode a new chat has').toMatchObject({ requested: 'auto', effective: 'auto' });
      const [requested] = ofKind(await s.events(session.id), 'question.requested');
      const form = s.pane.locator('.transcript-row[data-kind="question"]').getByRole('group', { name: 'Question' });
      await expect(form, 'the question’s form stands in the row of its call').toBeVisible();
      await form.getByRole('radio', { name: 'Yes' }).click();
      await clearToasts(page);
      await form.getByRole('button', { name: /^Submit/ }).click();
      await drive(s, session, 'the answer and the reply', async () => ofKind(await s.events(session.id), 'question.answered').length > 0 && (await idleNow(s, session.id)));
      const [answered] = ofKind(await s.events(session.id), 'question.answered');
      expect(answered!.requestId).toBe(requested!.requestId);
      expect(Object.values(answered!.answers)).toEqual(['Yes']);
      expect(ofKind(await s.events(session.id), 'maws.ask.opened'), 'no MAWS ask').toEqual([]);
      const reply = mainTurnsEnded(await s.events(session.id)).at(-1)?.resultText ?? '';
      note(`G6: Question Default (${JSON.stringify(set)}) in auto mode: the spawn row's args hold neither ask flag; session.init lists AskUserQuestion and no mcp__maws__ask; question.requested ${JSON.stringify(requested!.questions.map((q) => [q.question, q.options.map((o) => o.label)]))}; answered in the call's row ${JSON.stringify(answered!.answers)}; reply ${JSON.stringify(reply)}`);
      expect(reply).toMatch(/ANSWER:\s*"?Yes\b/i);
      await end(s, session, before);
    });

    // The tool-choice plan's M6 (A10 on a real engine): MAWS's ask, whose `blocking` is required and whose description
    // steers it to false unless the answer is needed before the next step; the prompt names a question the agent can work
    // past and says nothing of `blocking`.
    await test.step('6 an ask the agent can work past, in auto mode: it passes blocking false itself, keeps working, and takes the answer as a message', async () => {
      const session = await begin(s, 'ask and keep working', keepWorkingId, PROMPTS.keepWorking, { permissionMode: 'auto' });
      await drive(s, session, 'the ask', async () => ofKind(await s.events(session.id), 'maws.ask.opened').length > 0);
      expect((await statusOf(s, session.id)).permissionMode, 'the case runs in auto, the mode a new chat has').toMatchObject({ requested: 'auto', effective: 'auto' });
      const [opened] = ofKind(await s.events(session.id), 'maws.ask.opened');
      const askCall = mcpCalls(journal(session.journalPath)).find((c) => c.name === 'ask')!;
      note(`G7: the ask's arguments ${JSON.stringify(askCall.args)}`);
      expect(askCall.args.blocking, 'the agent passed blocking: false of itself').toBe(false);
      expect(opened!.blocking).toBe(false);
      // it keeps working: its Bash call starts while the ask waits, and the answer goes from the row's form meanwhile
      await drive(s, session, 'the Bash call', async () => ofKind(await s.events(session.id), 'tool.use').some((e) => e.toolName === 'Bash'));
      const form = formOf(s);
      await expect(form).toHaveAttribute('data-hover-ask', opened!.askId);
      // the steer names a pick by its place among the options the model wrote (board ticket 711), so Tea's place is read
      // from the ask itself
      const teaPlace = (opened!.questions[0]!.options ?? []).findIndex((option) => option.label === 'Tea') + 1;
      expect(teaPlace, `the ask offers Tea: ${JSON.stringify(opened!.questions[0])}`).toBeGreaterThan(0);
      await form.getByRole('radio', { name: 'Tea' }).click();
      await clearToasts(page);
      await form.getByRole('button', { name: 'Submit', exact: true }).click();
      // the answer's message, as the host wrote it to the engine: a user frame opening with the ask's id
      const steerOf = (all: JournalRow[]) => all.find((r) => r.direction === 'out' && (r.frame as Frame).type === 'user' && String(((r.frame as Frame).message as { content?: unknown } | undefined)?.content ?? '').startsWith(`[MAWS ask ${opened!.askId}]`));
      // the model's own text after that message, in the main conversation
      const textsAfter = (all: JournalRow[], seq: number) =>
        all.flatMap((r) => {
          const frame = r.frame as Frame & { parent_tool_use_id?: string | null };
          if (r.direction !== 'in' || frame.type !== 'assistant' || (frame.parent_tool_use_id ?? null) !== null || r.seq <= seq) return [];
          const content = (frame.message as { content?: unknown } | undefined)?.content;
          return Array.isArray(content) ? (content as { type?: string; text?: string }[]).flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [{ seq: r.seq, text: b.text }] : [])) : [];
        });
      const ANSWERED = new RegExp(`ANSWER:\\s*(?:"?Tea\\b|option ${teaPlace}\\b)`, 'i');
      await drive(s, session, 'a reply naming the answer after its message', async () => {
        const all = journal(session.journalPath);
        const steer = steerOf(all);
        return steer !== undefined && textsAfter(all, steer.seq).some((reply) => ANSWERED.test(reply.text)) && (await idleNow(s, session.id));
      });
      const rows = journal(session.journalPath);
      expect(JSON.parse(resultText(mcpResultOf(rows, askCall.requestId)!)), 'the call returned at once').toEqual({ status: 'asked', askId: opened!.askId });
      const ack = rows.find((r) => r.direction === 'out' && (r.frame as Frame).type === 'control_response' && ((r.frame as Frame).response as { request_id?: string } | undefined)?.request_id === askCall.requestId)!;
      const steer = steerOf(rows)!;
      const steerText = String(((steer.frame as Frame).message as { content?: unknown }).content);
      expect(steerText, 'the message carries the pick the person made, by its place').toContain(`\n1. option ${teaPlace}\n`); // `askSteerText`'s line for question 1 (src/shared/maws/ask.ts)
      expect(ofKind(await s.events(session.id), 'maws.ask.answered').find((e) => e.askId === opened!.askId)?.answers[0], 'the answer recorded is Tea').toMatchObject({ status: 'answered', value: ['Tea'] });
      // the work: the Bash call the model made after the ask returned, matched to its result, which succeeded
      type Block = { type?: string; id?: string; name?: string; tool_use_id?: string; is_error?: boolean; content?: unknown; input?: { command?: string } };
      const blocksOf = (r: JournalRow): Block[] => {
        const content = ((r.frame as Frame).message as { content?: unknown } | undefined)?.content;
        return Array.isArray(content) ? (content as Block[]) : [];
      };
      const bashUse = rows.find((r) => r.direction === 'in' && (r.frame as Frame).type === 'assistant' && r.seq > ack.seq && blocksOf(r).some((b) => b.type === 'tool_use' && b.name === 'Bash'));
      expect(bashUse, 'the agent called Bash after the ask returned').toBeDefined();
      const bashBlock = blocksOf(bashUse!).find((b) => b.type === 'tool_use' && b.name === 'Bash')!;
      const bashResultRow = rows.find((r) => r.direction === 'in' && (r.frame as Frame).type === 'user' && blocksOf(r).some((b) => b.type === 'tool_result' && b.tool_use_id === bashBlock.id));
      expect(bashResultRow, 'the Bash call has its result').toBeDefined();
      const bashResult = blocksOf(bashResultRow!).find((b) => b.type === 'tool_result' && b.tool_use_id === bashBlock.id)!;
      expect(bashResult.is_error ?? false, `the Bash call ran: ${JSON.stringify(bashResult.content)}`).toBe(false);
      expect(JSON.stringify(bashResult.content ?? ''), 'the command ran to its output').toContain('WORKED');
      const replies = textsAfter(rows, steer.seq).filter((reply) => ANSWERED.test(reply.text));
      note(`G7: maws.ask.opened blocking false, acknowledged {status: "asked"} at seq ${ack.seq}; Bash ${JSON.stringify(bashBlock.input?.command ?? null)} called at seq ${bashUse!.seq} and answered at seq ${bashResultRow!.seq} without error; the answer's message (option ${teaPlace}) at seq ${steer.seq}; the reply naming it at seq ${replies[0]!.seq}: ${JSON.stringify(replies[0]!.text)}`);
      await end(s, session, before);
    });
  } finally {
    for (const session of sitting === null ? [] : begun.filter((b) => !b.ended)) {
      note(`  ${session.label}: the step failed; the session is stopped and booked here`);
      await end(sitting!, session, before).catch((error: unknown) => note(`  ${session.label}: could not be stopped or booked: ${String(error)}`));
    }
    const total = costs.reduce((sum, c) => sum + c.costUsd, 0);
    note(`spend: ${costs.map((c) => `${c.label} ${c.costUsd.toFixed(4)}`).join('; ')}; total US$${total.toFixed(4)} (cap US$${CAP_USD})`);
    await maws.cleanup();
    note('the app closed (every engine process it launched was stopped first; cleanup closes the app or fails)');
    note(`scratch kept for inspection: ${sc.root} (journals under journals/)`);
  }
  // after the finally, so a failed step's own error is the one reported
  checkA15('after the run', before, a15(), [sc.root, maws.userData]);
  expect(readdirSync(join(sc.root, 'journals'))).toHaveLength(5); // a session each (board ticket 848: four before send_file's left; the tool-choice plan's M6: two more)
});
