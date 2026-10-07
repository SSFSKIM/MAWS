// E1's live sitting (docs/doperpowers/plans/2026-10-05-e1-tool-server.md, M5; P1 spec §9 E1): the product app, built
// as MAWS ships it, with the installed Claude Code (never patched, D-1) under a scratch CLAUDE_CONFIG_DIR under /tmp
// (`settings.json` `{}`, a `.claude.json` that trusts the scratch repository), through ClaudeUsage's relay, on Haiku in
// default permission mode. M2's four prompts run in four sessions, the async one asking for a foreground command so its
// answer folds into the running turn. The human's part is done through the real surfaces: every permission through the
// request card docked in the composer, every ask through the Question sheet (the folder through main's pick seam),
// the delivery row's two buttons through the open seam (nothing opens on this Mac). The owner's ~/.claude.json is read
// only, for the A-15 delta before the first launch and after every session. Writes the plain-text evidence
// (docs/doperpowers/evidence/p1-e1/live-sitting.txt) and the screenshots in both themes (`e1-<surface>-<theme>.png`).
// It spends money; run on purpose only, after a build:
//   MAWS_HARNESS=1 electron-vite build && MAWS_E1_LIVE=1 pnpm exec playwright test e2e/maws-tools-live.spec.ts
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { AskQuestion } from '@shared/maws/tools';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { isolatedGitEnv } from '../test/support/git-env';
import { relaySkipReason } from '../test/support/relay-health';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { journal, mainResults, processCost } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { clearToasts, eventsOf, ofKind, recordEvents, seedTranscripts, shootThemes } from './support/maws-tools';
import { sidebarOf, sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_E1_LIVE !== '1', 'the E1 live sitting runs only under MAWS_E1_LIVE=1');
test.describe.configure({ timeout: 1_500_000 });

const EVIDENCE = join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e1');
const EVIDENCE_FILE = join(EVIDENCE, 'live-sitting.txt');
const TURN_MS = 300_000;

const PROMPTS = {
  sendFile: 'Write a file named hello.txt containing exactly HELLO_E1 in the working directory, then deliver it to me with the maws send_file tool with the caption "the greeting". Reply DELIVERED when done.',
  blocking:
    'Use the maws ask tool (blocking) to ask me five questions, with these ids and modalities: q1 choice single with options Red, Green, Blue ("Which colour?"); q2 choice multi with options Mon, Tue, Wed ("Which days?"); q3 text ("What should the title be?"); q4 folder ("Which folder holds the assets?"); q5 repository ("Which repository is this for?"). Then reply with one line per question: id, then the answer or SKIPPED or DECIDE.',
  // M2's async prompt, asking for the command in the foreground so the answer folds into the running turn (Surprises)
  async: 'Use the maws ask tool with blocking false to ask me one choice question with id q1 and options Yes, No ("Proceed?"). Then, without waiting, run the Bash command `sleep 15; echo WAITED` in the foreground, never in the background, and report its output. When my answer arrives, reply with ANSWER: followed by it.',
  showPane: 'Call the maws show_pane tool three times: first with pane "terminal", then with pane "deliverable" and target "none", then with pane "nope". Reply with one line per call: the pane name and the result status or error text.',
} as const;

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
// default permission mode, the gateway), and the prompt sent from the real composer.
async function begin(s: Sitting, label: string, id: string, prompt: string): Promise<Session> {
  await (await sidebarRow(s.page, { appSessionId: id })).click();
  await s.page.mouse.move(700, 20);
  await expect(s.pane.locator(`[data-composer="${id}"]`)).toBeVisible();
  const spec = { ...launchDefaults(id as AppSessionId, s.scratch.repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: 0.5 };
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

// Waits for `until`, allowing every permission the session asks meanwhile through the card docked in the composer
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
      const allow = frame.getByRole('button', { name: 'Allow', exact: true });
      if ((await allow.isVisible().catch(() => false)) && (await allow.isEnabled().catch(() => false))) {
        const once = frame.getByRole('radio', { name: 'Allow once' });
        if ((await once.count()) > 0) await once.click();
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
async function end(s: Sitting, session: Session, before: { digest: string }, costs: { label: string; costUsd: number }[]): Promise<void> {
  session.ended = true;
  const stopped = value(await invoke(s.page, 'session.stop', { appSessionId: session.id as never, reason: 'stop' }));
  await expect.poll(async () => (await statusOf(s, session.id)).process, { timeout: 30_000 }).toBe('exited');
  const dir = join(s.maws.userData, 'engine-host', 'journal', session.id);
  const kept = join(s.scratch.root, 'journals', session.label);
  cpSync(dir, kept, { recursive: true });
  const rows = journal(session.journalPath);
  const costUsd = processCost(rows);
  costs.push({ label: session.label, costUsd });
  const after = a15();
  note(`  ${session.label}: appSessionId ${session.id}; journal ${join(kept, session.journalPath.split('/').at(-1)!)}; main results ${mainResults(rows).length}; total_cost_usd ${costUsd.toFixed(4)}; permissions allowed once through the card: ${JSON.stringify(session.allowed)}; stopped ${JSON.stringify(stopped)}; A-15 after: ${after.keys} keys, sha1 ${after.digest} (${after.digest === before.digest ? 'identical' : 'CHANGED'})`);
  expect(after.digest, 'the A-15 delta: no scratch project in the owner file').toBe(before.digest);
}

// `e1-<surface>-<theme>.png` beside the evidence text, in both themes (a toast over the panel's bottom edge, where the
// sheet's Submit bar sits, is cleared first).
const shoot = (s: Sitting, surface: string) => shootThemes(s.page, (theme) => join(EVIDENCE, `e1-${surface}-${theme}.png`));

const sheetOf = (s: Sitting) => s.panel.locator('[data-ask-sheet]');
const capsuleOf = (s: Sitting) => s.pane.locator('section.transcript-ask').last();
const sectionFor = (sheet: Locator, question: AskQuestion) => sheet.locator(`section[data-question-id="${question.id}"]`);

// ---- the sitting -----------------------------------------------------------------------------------------------------

test('the live sitting: send_file, a blocking ask, an async ask folded into its turn, show_pane', async () => {
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
  const sc = scratch(['E1 sitting: send_file', 'E1 sitting: blocking ask', 'E1 sitting: async ask', 'E1 sitting: show_pane']);
  const openLog = join(sc.root, 'open.txt');
  note(`E1 live sitting (M5), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200), Haiku, default permission mode, maxBudgetUsd 0.5 per session`);
  note(`app: the product build (out/main/index.js, MAWS_HARNESS=0) over a scratch CLAUDE_CONFIG_DIR ${sc.config} (settings.json {}, .claude.json trusting ${sc.repo}); MAWS_E2E_OPEN_LOG seam for the delivery row's buttons`);
  note(`A-15 before the first launch: ${before.keys} keys, sha1 ${before.digest}`);
  const costs: { label: string; costUsd: number }[] = [];

  let sitting: Sitting | null = null;
  let afterRun: { keys: number; digest: string }; // the A-15 read once the app closed
  const maws = await launchMaws({ env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: sc.config, MAWS_E2E_OPEN_LOG: openLog } });
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
    const [sendFileId, blockingId, asyncId, showPaneId] = ids as [string, string, string, string];

    await test.step('1 send_file: the delivery row, its two buttons, the record; the init lists the maws tools', async () => {
      const session = await begin(s, 'send_file', sendFileId, PROMPTS.sendFile);
      await drive(s, session, 'the delivery and the turn end', async () => ofKind(await s.events(session.id), 'maws.delivery.file').length > 0 && (await idleNow(s, session.id)));
      const events = await s.events(session.id);
      const [init] = ofKind(events, 'session.init');
      expect(init!.tools).toEqual(expect.arrayContaining(['mcp__maws__send_file', 'mcp__maws__ask', 'mcp__maws__show_pane']));
      expect(init!.mcpServers).toContainEqual({ name: 'maws', status: 'connected', source: 'sdk' });
      note(`G1: session.init (the journal's system/init) lists ${init!.tools.length} tools, ${JSON.stringify(init!.tools.filter((t) => t.startsWith('mcp__')))}; mcp_servers ${JSON.stringify(init!.mcpServers)}`);
      const [delivered] = ofKind(events, 'maws.delivery.file');
      const path = join(sc.repo, 'hello.txt');
      expect(delivered).toMatchObject({ caption: 'the greeting', deliverables: [{ path, name: 'hello.txt' }] });
      const record = JSON.parse(readFileSync(join(maws.userData, 'deliverables', session.id, `${delivered!.deliverables[0]!.id}.json`), 'utf8')) as Record<string, unknown>;
      expect(record).toMatchObject({ kind: 'file', path, title: 'hello.txt', caption: 'the greeting' });
      const delivery = s.pane.locator('[data-delivery]').last();
      await expect(delivery.locator('[data-delivery-heading]')).toHaveText('Delivered hello.txt · the greeting');
      const file = delivery.locator(`[data-path="${path}"]`);
      await file.getByRole('button', { name: 'Open externally' }).click();
      await file.getByRole('button', { name: 'Reveal in Finder' }).click();
      await expect.poll(() => (existsSync(openLog) ? readFileSync(openLog, 'utf8').trim().split('\n') : [])).toEqual([path, `reveal ${path}`]);
      await shoot(s, 'delivery');
      const reply = mainTurnsEnded(events).at(-1)?.resultText ?? null;
      note(`G2: maws.delivery.file ${JSON.stringify(delivered!.deliverables.map((d) => ({ id: d.id, name: d.name })))} caption "the greeting"; record ${record.id as string}.json kind file; the row reads "Delivered hello.txt · the greeting"; Open externally and Reveal in Finder logged ${JSON.stringify(readFileSync(openLog, 'utf8').trim().split('\n').map((l) => l.replace(sc.root, '<scratch>')))}; reply ${JSON.stringify(reply)}`);
      await end(s, session, before, costs);
    });

    await test.step('2 a blocking ask: the capsule, the sheet with five modalities, the attention item, Submit, the reply', async () => {
      const session = await begin(s, 'blocking ask', blockingId, PROMPTS.blocking);
      await drive(s, session, 'the ask', async () => ofKind(await s.events(session.id), 'maws.ask.opened').length > 0);
      const [opened] = ofKind(await s.events(session.id), 'maws.ask.opened');
      expect(opened!.blocking).toBe(true);
      const capsule = capsuleOf(s);
      await expect(capsule).toHaveAttribute('data-ask-state', 'pending');
      await expect(capsule.locator('[data-ask-chip]')).toHaveText('Waiting for you');
      const sheet = sheetOf(s);
      await expect(sheet).toHaveAttribute('data-ask-id', opened!.askId);
      await expect(sheet.locator('section[data-question-id]')).toHaveCount(opened!.questions.length);
      note(`G3: maws.ask.opened ${opened!.questions.length} questions ${JSON.stringify(opened!.questions.map((q) => [q.id, q.modality, q.multi ?? false]))}; the capsule reads "Waiting for you"; the sheet opened by itself on the shown session`);
      await capsule.scrollIntoViewIfNeeded();
      await expect(capsule).toBeVisible();
      await shoot(s, 'capsule-pending');

      // the attention item: in Needs you and on the Overview card
      const needsYou = sidebarOf(page).getByRole('list', { name: 'Needs you' }).getByRole('button').filter({ hasText: 'Question' });
      await expect(needsYou).toHaveCount(1);
      await maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('tab.overview')?.click());
      const overview = page.locator('[data-region="main"]').getByRole('dialog', { name: 'Overview' });
      const card = overview.getByRole('article').filter({ has: page.getByRole('button', { name: 'Open the Question sheet' }) });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(`${opened!.questions.length} questions`);
      await shoot(s, 'attention');
      await page.keyboard.press('Escape');
      await expect(overview).toHaveCount(0);

      // M2's answers, given in the sheet: Blue; Mon and Wed with Other "Fri"; the text skipped; the assets folder through
      // the native pick; the repository delegated
      const byModality = (modality: AskQuestion['modality'], multi?: boolean) => opened!.questions.find((q) => q.modality === modality && (multi === undefined || (q.multi ?? false) === multi))!;
      const single = byModality('choice', false);
      const multi = byModality('choice', true);
      await sectionFor(sheet, single).getByRole('radio', { name: 'Blue' }).click();
      await sectionFor(sheet, multi).getByRole('checkbox', { name: 'Mon' }).click();
      await sectionFor(sheet, multi).getByRole('checkbox', { name: 'Wed' }).click();
      await sectionFor(sheet, multi).getByRole('checkbox', { name: 'Other…' }).click();
      await sectionFor(sheet, multi).getByRole('textbox').fill('Fri');
      await sectionFor(sheet, byModality('text')).getByRole('button', { name: 'Skip' }).click();
      const assets = join(sc.repo, 'assets');
      await maws.app.evaluate((_electron, dir) => void (process.env.MAWS_E2E_PICK_PATHS = dir), assets);
      await sectionFor(sheet, byModality('folder')).getByRole('button', { name: 'Choose folder…' }).click();
      await expect(sectionFor(sheet, byModality('folder')).getByRole('list')).toHaveText(assets);
      await expect(sectionFor(sheet, byModality('repository')).getByRole('radio', { name: 'repo' })).toBeVisible();
      await sectionFor(sheet, byModality('repository')).getByRole('button', { name: 'Decide for me' }).click();
      await shoot(s, 'sheet');
      await clearToasts(page);
      await sheet.getByRole('button', { name: /^Submit/ }).click();

      await drive(s, session, 'the answer and the reply', async () => ofKind(await s.events(session.id), 'maws.ask.answered').length > 0 && (await idleNow(s, session.id)));
      const [answered] = ofKind(await s.events(session.id), 'maws.ask.answered');
      expect(answered).toMatchObject({ askId: opened!.askId, delivery: 'result' });
      await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
      await expect(needsYou).toHaveCount(0);
      const reply = mainTurnsEnded(await s.events(session.id)).at(-1)?.resultText ?? '';
      await shoot(s, 'capsule-answered');
      await capsule.getByRole('button', { name: 'View answers' }).click();
      await expect(sheet.locator('[data-ask-readonly]')).toBeVisible();
      note(`G3: Submit wrote ${JSON.stringify(answered!.answers.map((a) => [a.id, a.status, a.value ?? null, a.otherText ?? null]).map((a) => JSON.stringify(a).replace(sc.root, '<scratch>')))}; the attention item left Needs you; the capsule reads "Answered"; View answers reopened it read-only; reply ${JSON.stringify(reply.replace(sc.root, '<scratch>'))}`);
      expect(reply).toMatch(/Blue/);
      expect(reply).toMatch(/SKIPPED/i);
      await end(s, session, before, costs);
    });

    await test.step('3 an async ask: acknowledged at once, answered while the foreground command runs, folded into the turn', async () => {
      const session = await begin(s, 'async ask', asyncId, PROMPTS.async);
      await drive(s, session, 'the async ask', async () => ofKind(await s.events(session.id), 'maws.ask.opened').length > 0);
      const [opened] = ofKind(await s.events(session.id), 'maws.ask.opened');
      expect(opened!.blocking).toBe(false);
      const capsule = capsuleOf(s);
      await expect(capsule).toHaveAttribute('data-ask-state', 'asked');
      // the model keeps working: its Bash call starts, then the answer goes from the sheet while it runs
      await drive(s, session, 'the Bash call', async () => ofKind(await s.events(session.id), 'tool.use').some((e) => e.toolName === 'Bash'));
      await page.waitForTimeout(2_000);
      const sheet = sheetOf(s);
      await expect(sheet).toHaveAttribute('data-ask-id', opened!.askId);
      await sheet.getByRole('radio', { name: 'Yes' }).click();
      await clearToasts(page);
      await sheet.getByRole('button', { name: 'Submit', exact: true }).click();
      await drive(s, session, 'the reply', async () => ofKind(await s.events(session.id), 'maws.ask.answered').length > 0 && (await idleNow(s, session.id)));
      await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
      const rows = journal(session.journalPath);
      const steer = rows.find((r) => r.direction === 'out' && (r.frame as { type?: string; priority?: string }).type === 'user' && (r.frame as { priority?: string }).priority === 'next');
      expect(((steer!.frame as { message: { content: string } }).message.content)).toMatch(new RegExp(`^\\[MAWS ask ${opened!.askId}\\]`));
      const results = mainResults(rows);
      const firstResult = results[0]!;
      const folded = results.length === 1 && steer!.seq < firstResult.seq;
      const replies = mainTurnsEnded(await s.events(session.id)).map((t) => t.resultText ?? '');
      note(`G4: maws.ask.opened blocking false; the acknowledgement {status: "asked"} at once; the capsule read "Asked, answer when ready"; the answer went from the sheet while Bash ran; the steer (priority next, seq ${steer!.seq}) ${folded ? `folded into the running turn (one main result, seq ${firstResult.seq})` : `did not fold: ${results.length} main results at seqs ${JSON.stringify(results.map((r) => r.seq))}`}; replies ${JSON.stringify(replies)}`);
      expect(replies.some((r) => /ANSWER:\s*Yes/i.test(r))).toBe(true);
      expect.soft(folded, 'the answer folded into the running turn').toBe(true);
      await end(s, session, before, costs);
    });

    await test.step('4 show_pane: the Terminal opens, a pane this build lacks and an unknown pane are error cells', async () => {
      const session = await begin(s, 'show_pane', showPaneId, PROMPTS.showPane);
      await drive(s, session, 'the turn end', async () => ofKind(await s.events(session.id), 'turn.ended').some((e) => e.parentToolUseId === null) && (await idleNow(s, session.id)));
      const shown = ofKind(await s.events(session.id), 'maws.pane.shown');
      expect(shown.map((e) => [e.pane, e.opened?.kind ?? null, e.error])).toEqual([
        ['terminal', 'panel-tool', null],
        ['deliverable', null, 'show_pane: the deliverable pane is not available in this build of MAWS'],
      ]);
      await expect(s.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Terminal/ })).toHaveAttribute('aria-selected', 'true');
      const divider = s.pane.locator('[data-kind="divider"]').last().locator('button[aria-expanded]').first();
      if ((await divider.getAttribute('aria-expanded')) === 'false') await divider.click();
      await expect(s.pane.getByText('Opened Terminal')).toBeVisible();
      await expect(s.pane.getByText('Could not open pane: the deliverable pane is not available in this build of MAWS')).toBeVisible();
      await expect(s.pane.getByText(/Could not open pane: unknown pane "nope"/)).toBeVisible();
      await shoot(s, 'pane');
      const reply = mainTurnsEnded(await s.events(session.id)).at(-1)?.resultText ?? '';
      note(`G5: maws.pane.shown ${JSON.stringify(shown.map((e) => ({ pane: e.pane, opened: e.opened, error: e.error })))}; the Terminal tab opened in the panel; the cells read "Opened Terminal", "Could not open pane: the deliverable pane is not available…", "Could not open pane: unknown pane "nope"…"; reply ${JSON.stringify(reply)}`);
      await end(s, session, before, costs);
    });
  } finally {
    for (const session of sitting === null ? [] : begun.filter((b) => !b.ended)) {
      note(`  ${session.label}: the step failed; the session is stopped and booked here`);
      await end(sitting!, session, before, costs).catch((error: unknown) => note(`  ${session.label}: could not be stopped or booked: ${String(error)}`));
    }
    const total = costs.reduce((sum, c) => sum + c.costUsd, 0);
    note(`spend: ${costs.map((c) => `${c.label} ${c.costUsd.toFixed(4)}`).join('; ')}; total US$${total.toFixed(4)}`);
    await maws.cleanup();
    afterRun = a15();
    note(`the app closed (every engine process it launched was stopped first; cleanup closes the app or fails); A-15 after the run: ${afterRun.keys} keys, sha1 ${afterRun.digest} (${afterRun.digest === before.digest ? 'identical' : 'CHANGED'})`);
    note(`scratch kept for inspection: ${sc.root} (journals under journals/)`);
  }
  expect(afterRun.digest, 'the A-15 delta after the run: no scratch project in the owner file').toBe(before.digest);
  expect(readdirSync(join(sc.root, 'journals'))).toHaveLength(4);
});
