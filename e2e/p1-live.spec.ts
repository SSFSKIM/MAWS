// E11's app-level live sittings (docs/doperpowers/plans/2026-10-06-e11-finish.md, Task 6.1; Design §5 S3, S4, S6 and
// Decision Log 23's A-47 case): what no P1 child ran live end to end, run through the product app (MAWS_HARNESS=0 per
// launch over a harness build, as E1's and E4d's live specs do) with the installed Claude Code (unmodified, D-1), through
// ClaudeUsage's relay (GET /api/hello, one retry two minutes later, else the case is `blocked: relay`), on Haiku in
// default permission mode, every permission allowed once through the request card where the person would see it.
//
//   S3 (items 5, 6, 10)  1 artifact_create, artifact_screenshot (main's real capture: the PNG's dominant colour is the
//                          page's) and artifact_update; the row, the Deliverables tool, v2 with its version switch, the
//                          record. 2 a comment picked through the pick overlay goes to a Side thread, which answers in the
//                          Side pane and sums itself up in the parent. 3 Send to main steers the parent mid-turn.
//                          4 `/btw` answers in the Side pane. One app and one parent across the four (serial).
//   S4 (item 7)          5 E4c's recording prompt against the real browser on E4c's server. 6 skipped: E4d's M5 proved
//                          the live anchor resolution (A-49; Decision Log 9 and 20). 7 no engine turn: the OOPIF page of
//                          the owner's step F (e2e/support/oopif-page.ts) snapshotted through `__maws_browser.agent.run`.
//   S6 (the C3 stall row) 8 ten row Resumes, each in a fresh app launch, each bounded 30 s to first output.
//   A-47                 a permission request on a session not in front: C5's fallback toast with no window focused,
//                          retracted once the request is answered. The fallback is forced whatever the desktop allows:
//                          the app's Notification.show() fails in its main process, as the unsigned build's does.
//
// The caps: each sitting its own (Design §5: S3 US$0.50, S4 US$0.40 with the A-47 case inside it, S6 US$0.30) and the
// run MAWS_P1_LIVE_MAX_USD (default US$1.20, the three summed). A sitting's spend is its cases' journal receipts (every
// journal under their scratch directories, read before each case and each launch) plus the charges no receipt shows
// (`charges.jsonl` under the run's root, below); the next paid call may spend the smaller of the sitting's and the run's
// remainders, a case does not start once either is spent (`not run (budget)`), and every session the spec launches
// carries that amount, less what the case holds back, as its `--max-budget-usd` (a row Resume takes none, and S6's run
// no turn).
// A paid call no receipt shows is charged, never left free: case 4's `/btw` side question is answered by a control
// response with no result frame, so it is charged BTW_RESERVATION_USD before it is sent. US$0.05: the side question of
// the recorded fixture (spikes/protocol-probe/fixtures/pass3/p1-side-question-session.jsonl) carried a context of about
// 22,700 tokens (the cache reads of the main calls beside it); S3's parent at case 4 holds more (case 1's artifact turn
// with its screenshot, case 3's Bash turn, the maws tools), about 30,000 to 35,000 tokens, which at Haiku 4.5's
// cache-write rate (US$1.25 per million) costs US$0.038 to 0.044 even with no cache hit, plus a short answer.
// Scratch: one root per run, /private/tmp/maws-e11-p1live-<stamp> (the runner's pid, or MAWS_P1_LIVE_STAMP), one
// directory per case under it holding `claude-config/` (`settings.json` `{}`, a `.claude.json` trusting the case's
// repository), `repo/` (a git repository) and `user-data/` (the app's profile; journals under engine-host/journal/),
// kept for the review and removed by the sitting. The owner's ~/.claude.json is only read: the A-15 reading before a
// case, after each session and after the app closed; a key under the run's root appearing or vanishing is a breach,
// a key another owner session added or removed meanwhile is recorded (test/support/owner-file.ts). Every engine's `system/init` plugin list is recorded and must hold none of the
// owner's (Decision Log 22 and 30). After the app closed, no process it or its engines ran survives (pids recorded).
// Logs: `live-s3.txt`, `live-s4.txt`, `live-s6.txt`, `live-a47.txt` under MAWS_P1_LIVE_OUT (default
// /tmp/maws-e11-p1-live), appended line by line. Shots `prerun-<item>-<surface>-<theme>.png` into
// docs/doperpowers/evidence/p1-e11/ only under MAWS_E11_SHOTS=1.
// It spends money; run on purpose only (the script builds, the flag runs):
//   MAWS_P1_LIVE=1 pnpm e2e:p1-live
// (`pnpm e2e:p1-live` alone builds and reports every case skipped.)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { deliverableUrl } from '../src/shared/maws/deliverable';
import { RELAY_URL } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { ownerPlugins } from '../test/support/claude-env';
import { compareA15 } from '../test/support/owner-file';
import { isolatedGitEnv } from '../test/support/git-env';
import { relaySkipReason } from '../test/support/relay-health';
import { browserIn, openBrowser, pageAt, type BrowserScene } from './support/browser-scene';
import { agentOk, cursorMessages, refIn } from './support/browser-tools-scene';
import { ORDER_REFERENCE, startBrowserToolsServer } from './support/browser-tools-server';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { journalSpend } from './support/c12-prerun';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { clearToasts, eventsOf, frameAt, listOf, mcpCalls, mcpResultOf, ofKind, openDeliverables, recordEvents, rowOf, seedTranscripts, show, viewerOf, type Scene } from './support/maws-tools';
import { OOPIF_FIELD, startOopifPage } from './support/oopif-page';
import { a15Line, a15Reading, budgetOf, budgetRefusal, capUsd, CASE_SITTING, colourDistance, DEFAULT_CAP_USD, dominantColour, initPluginsOf, installedEngine, liveOutDir, runRoot, siteOf, sittingLog, SITTING_CAP_USD, spentBySitting, type A15Reading, type Budget, type CaseName, type Charge, type Sitting } from './support/p1-live';
import { isAlive, processesNaming, ps } from './support/processes';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_P1_LIVE !== '1', 'the P1 live sittings run only under MAWS_P1_LIVE=1');
test.describe.configure({ timeout: 1_200_000 });

const LIVE = process.env.MAWS_P1_LIVE === '1';
const CAP = LIVE ? capUsd() : DEFAULT_CAP_USD; // read only when live: a bad value stops the run, never a listing
const OUT = liveOutDir();
const ROOT = runRoot();
const SHOTS = process.env.MAWS_E11_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e11') : null;
const TURN_MS = 300_000;
const FIRST_OUTPUT_MS = 30_000; // the engine host's bound (src/engine-host/session.ts, `no_output`)
const BTW_RESERVATION_USD = 0.05; // case 4's side question, charged since no receipt shows it (the header)

// The pages of case 1, in two colours the prompt never names (E2's recording proved its capture the same way).
const V1 = { rgb: [211, 47, 47], word: /red|crimson|scarlet/i } as const;
const V2 = { rgb: [21, 101, 192] } as const;
const artifactPage = (rgb: readonly number[], version: number) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>P1 page</title></head><body style="margin:0;min-height:100vh;background:rgb(${rgb.join(',')});color:#ffffff;font:24px system-ui"><h1 id="title" style="margin:0;padding:24px">P1 live page, version ${version}</h1></body></html>`;

// Prompts on E2's rules (the tools by their full names, the work done by the model itself, no investigation).
const PROMPTS = {
  artifact:
    'Do these steps yourself, one after another, never through an agent, and do not read, list or inspect any file first. ' +
    'First call mcp__maws__artifact_create with id "p1-page", title "P1 page" and html_path "page-v1.html". ' +
    'Then call mcp__maws__artifact_screenshot with id "p1-page" and look at the image it returns. ' +
    'Then call mcp__maws__artifact_update with id "p1-page" and html_path "page-v2.html". ' +
    'Then reply with one line: COLOUR: followed by the one-word name of the background colour you saw in the screenshot.',
  thread: 'Reply with exactly one word, ANCHORED, and use no tool.',
  slow: 'Run the Bash command `sleep 25; echo SLEPT` yourself, in the foreground (never in the background, never through an agent), then reply with its output.',
  steer: 'When you reply, add the word STEER_SEEN at the end.',
  btw: 'In one word: what was the background colour of the artifact’s first version?',
  // E4c's recording prompt (E4c execution document, Design §13; test/live/maws-browser.live.test.ts), verbatim
  browser:
    'Use the MAWS browser tools, calling each tool yourself, one after another, never through an agent. ' +
    'First call mcp__maws__browser_tabs with action "open" and url "http://127.0.0.1:17391/form.html" and note the tabId it returns. ' +
    'Then call mcp__maws__browser_snapshot on that tab and find the refs of the Name field, the Email field and the Submit button. ' +
    'Then call mcp__maws__browser_act with action "fill" on the Name field with value "Ada Lovelace", then mcp__maws__browser_act with action "fill" on the Email field with value "ada@example.test", then mcp__maws__browser_act with action "click" on the Submit button. ' +
    'The snapshot shows the Submit button as disabled, but the page enables it by itself once both fields are filled, so click it right after the second fill without taking another snapshot first. ' +
    'Then call mcp__maws__browser_snapshot again and read the reference number the page shows. ' +
    'Then call mcp__maws__browser_screenshot on the tab with no target. ' +
    'Reply with one line: the reference number exactly as shown, and the word "image" if you received a picture.',
  resumeSeed: 'Reply with exactly: OK',
  a47: 'Run the Bash command `touch a47-marker.txt` yourself, never through an agent, then reply DONE.',
} as const;

// ---- the run: spend, relay, engine ------------------------------------------------------------------------------------

// The charges no receipt shows, appended as they are made (support/p1-live.ts, Charge).
const CHARGES = join(ROOT, 'charges.jsonl');
const charges = (): Charge[] => (existsSync(CHARGES) ? readFileSync(CHARGES, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Charge) : []);
function charge(note: (line: string) => void, c: Charge): void {
  mkdirSync(ROOT, { recursive: true });
  appendFileSync(CHARGES, `${JSON.stringify(c)}\n`);
  note(`  charged US$${c.usd.toFixed(4)} to ${CASE_SITTING[c.case].toUpperCase()} for ${c.label} [${c.key}]; ${spendLine(CASE_SITTING[c.case])}`);
}

// What each sitting and the run have spent: every journal of every case's profile under the run's root (a resumed or
// forked process may restore its session's cost, so summing journals can only over-count, the safe side of a cap),
// plus the charges.
function spent() {
  const receipts: Partial<Record<CaseName, number>> = {};
  for (const name of Object.keys(CASE_SITTING) as CaseName[]) {
    const dir = join(ROOT, name, 'user-data');
    if (existsSync(dir)) receipts[name] = journalSpend(dir).usd;
  }
  return spentBySitting(receipts, charges());
}
const budgetFor = (sitting: Sitting): Budget => budgetOf(sitting, spent(), CAP);
const spendLine = (sitting: Sitting): string => {
  const now = spent();
  return `${sitting.toUpperCase()} US$${now.sittings[sitting].toFixed(4)} of US$${SITTING_CAP_USD[sitting].toFixed(2)}, the run US$${now.run.toFixed(4)} of US$${CAP.toFixed(2)}`;
};

// The case refused (skipped, the reason in its log) once its sitting or the run has spent its cap, or when what is left
// does not cover `need`.
function refuseOverCap(note: (line: string) => void, what: string, sitting: Sitting, need?: { usd: number; for: string }): void {
  const refusal = budgetRefusal(budgetFor(sitting), CAP, need);
  if (refusal === null) return;
  note(`${what}: ${refusal}`);
  test.skip(true, refusal);
}

let relay: string | null | undefined; // the worker's relay verdict (null: up), checked once with one retry
async function relayGate(note: (line: string) => void, what: string): Promise<void> {
  if (relay === undefined) {
    relay = relaySkipReason(RELAY_URL);
    if (relay !== null) {
      note(`${what}: relay not ready (${relay}); waiting two minutes and retrying once`);
      await new Promise((resolve) => setTimeout(resolve, 120_000));
      relay = relaySkipReason(RELAY_URL);
    }
  }
  if (relay === null) return;
  note(`${what}: blocked: relay (${relay}) at ${new Date().toISOString()}`);
  test.skip(true, `blocked: relay: ${relay}`);
}

let engine: { bin: string; version: string } | null = null;
const theEngine = () => (engine ??= installedEngine());

// ---- a case's scratch and its app ---------------------------------------------------------------------------------------

interface CaseScratch {
  sitting: Sitting; // the sitting whose cap the case spends
  root: string;
  config: string;
  repo: string;
  userData: string;
  engineIds: string[]; // the seeded transcripts' engine session ids, one per title
}

// `ROOT/<name>`: the config home, a trusted git repository (`seed` writes into it before the commit), the profile, and
// one seeded transcript per title, so the sidebar lists a session to launch under for each (E1's and E4d's recipe).
function caseScratch(name: CaseName, titles: string[], seed: (repo: string) => void = () => {}): CaseScratch {
  mkdirSync(ROOT, { recursive: true });
  const root = join(realpathSync(ROOT), name);
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data');
  for (const dir of [config, repo, userData]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'README.md'), `E11 ${name}\n`);
  seed(repo);
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=E11', '-c', 'user.email=e11@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  return { sitting: CASE_SITTING[name], root, config, repo, userData, engineIds: seedTranscripts(config, repo, titles) };
}

interface Live {
  note: (line: string) => void;
  sc: CaseScratch;
  maws: MawsLaunch;
  page: Page;
  pane: Locator; // the main region's first pane
  panel: Locator;
  ids: AppSessionId[]; // the seeded sessions' app ids, in the order of their titles
  a15First: A15Reading; // the owner file before the case
  pids: Set<number>; // the app's and every engine's, for the survivor check
  started: { label: string; id: AppSessionId }[];
  ownerPluginsSeen: string[];
}
const sceneOf = (live: Live) => ({ maws: live.maws, page: live.page, pane: live.pane, panel: live.panel }) as unknown as Scene;

// The product app over the case's profile with the installed engine, its window's event log recording, once the seeded
// sessions are listed. `a15First` is the case's first reading (taken before the first launch when not given).
async function openLive(sc: CaseScratch, note: (line: string) => void, a15First: A15Reading = a15Reading()): Promise<Live> {
  const maws = await launchMaws({ userData: sc.userData, env: { MAWS_E2E_ENGINE_BIN: theEngine().bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: sc.config, MAWS_E2E_OPEN_LOG: join(sc.root, 'open.txt') } });
  const live: Live = {
    note, sc, maws, page: maws.page, a15First,
    pane: maws.page.locator('[data-region="main"] [data-pane="0"]'),
    panel: maws.page.locator('[data-region="panel"]'),
    ids: [], pids: new Set([maws.app.process().pid!]), started: [], ownerPluginsSeen: [],
  };
  try {
    await recordEvents(maws.page);
    await maws.page.evaluate(() => {
      const w = window as unknown as { __e11Notified?: unknown[] };
      if (w.__e11Notified) return;
      const log: unknown[] = [];
      w.__e11Notified = log;
      window.maws.on('attention.notified', (payload) => log.push({ ...payload, receivedAt: Date.now() }));
    });
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(maws.page, 'session.list', { includeArchived: true }));
        live.ids = sc.engineIds.map((engineId) => (sessions.find((r) => r.engineSessionId === engineId)?.appId ?? '') as AppSessionId);
        return live.ids.every((id) => id !== '');
      }, { timeout: 30_000 })
      .toBe(true);
    return live;
  } catch (error) {
    await maws.cleanup();
    throw error;
  }
}

const statusOf = async (live: Live, id: string) => value(await invoke(live.page, 'session.status', { appSessionId: id as AppSessionId }));
const idleNow = async (live: Live, id: string) => {
  const status = await statusOf(live, id);
  return status.turn === null && status.pendingRequests === 0;
};
const events = (live: Live, id: string) => eventsOf(live.page, id);
const mainTurnsEnded = (all: SessionEvent[]) => ofKind(all, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);

// Every row of every launch of the session (one journal file per launch), in launch order.
function sessionRows(live: Live, id: string): JournalRow[] {
  const dir = join(live.sc.userData, 'engine-host', 'journal', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort().flatMap((name) => journal(join(dir, name)));
}
const outUsers = (rows: JournalRow[]) => rows.filter((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user');

// A session launched under the record `id` as the app launches (C7's X6 fields; Haiku, default mode, the gateway),
// fresh or resuming `resume` in place, with what its sitting and the run leave (the smaller) as its budget; waits for
// `ready`.
async function launchSession(live: Live, label: string, id: AppSessionId, opts: { resume?: string } = {}): Promise<void> {
  const budget = budgetFor(live.sc.sitting);
  const refusal = budgetRefusal(budget, CAP);
  if (refusal !== null) {
    live.note(`${label}: ${refusal}`);
    test.skip(true, refusal);
  }
  const remaining = budget.usd;
  const spec = { ...launchDefaults(id, live.sc.repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: remaining, ...(opts.resume ? { resume: { sessionId: opts.resume as SessionId, fork: false } } : {}) };
  expect(value(await invoke(live.page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
  live.started.push({ label, id });
  await expect.poll(async () => (await statusOf(live, id)).process, { timeout: 120_000 }).toBe('ready');
  const status = await statusOf(live, id);
  if (status.pid !== null) live.pids.add(status.pid);
  live.note(`${label} ${id}: launched on Haiku, default mode, maxBudgetUsd ${remaining.toFixed(4)} (the smaller of what ${live.sc.sitting.toUpperCase()} and the run leave)${opts.resume ? `, resuming ${opts.resume} in place` : ''}; pid ${status.pid}`);
}

// The prompt put into the shown session's composer and sent; `typed` keys it in as a person would (a slash command
// opens the composer's palette on the way, as E3's `/btw` case types it).
async function sendFromComposer(live: Live, id: AppSessionId, prompt: string, opts: { typed?: boolean } = {}): Promise<void> {
  await show(sceneOf(live), id);
  await live.pane.getByRole('textbox', { name: 'Message', exact: true }).click();
  if (opts.typed) await live.page.keyboard.type(prompt);
  else await live.page.keyboard.insertText(prompt);
  await live.page.keyboard.press('Enter');
}

// Waits for `until`, allowing every permission the session asks meanwhile through the card docked in `scope` (the main
// pane, or the Side pane for a thread), once. A request already resolved is left alone.
async function drive(live: Live, scope: Locator, id: string, what: string, until: () => Promise<boolean>, allowed: string[] = [], timeout = TURN_MS): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await until()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    const all = await events(live, id);
    const resolved = new Set(ofKind(all, 'permission.resolved').map((e) => e.requestId));
    const open = ofKind(all, 'permission.requested').filter((e) => !resolved.has(e.requestId));
    if (open.length > 0) {
      const frame = scope.getByRole('group', { name: 'Approval needed' });
      const allow = frame.getByRole('button', { name: 'Allow', exact: true });
      if ((await allow.isVisible().catch(() => false)) && (await allow.isEnabled().catch(() => false))) {
        const once = frame.getByRole('radio', { name: 'Allow once' });
        if ((await once.count()) > 0) await once.click();
        await allow.click();
        allowed.push(open[0]!.toolName);
        await expect.poll(async () => ofKind(await events(live, id), 'permission.resolved').some((e) => e.requestId === open[0]!.requestId), { timeout: 30_000 }).toBe(true);
        continue;
      }
    }
    await live.page.waitForTimeout(400);
  }
}

// The session's engine plugin lists, launch by launch (each journal once), recorded; any of the owner's is kept for the
// case's assertion.
const pluginsChecked = new Set<string>();
function checkPlugins(live: Live, label: string, id: string): void {
  const dir = join(live.sc.userData, 'engine-host', 'journal', id);
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.jsonl') && !pluginsChecked.has(join(dir, name))).sort() : [];
  for (const file of files) {
    pluginsChecked.add(join(dir, file));
    const plugins = initPluginsOf(journal(join(dir, file)));
    const owners = ownerPlugins(plugins ?? [], [ROOT]);
    live.ownerPluginsSeen.push(...owners);
    live.note(`  ${label} init plugins (${file}): ${plugins === null ? 'no system/init (no turn in this launch)' : `${JSON.stringify(plugins)}${owners.length > 0 ? ` OWNER'S: ${JSON.stringify(owners)}` : ' (none of the owner’s)'}`}`);
  }
}

// The session stopped (its process exits), its spend, init plugins and the A-15 reading after it recorded.
async function stopSession(live: Live, label: string, id: AppSessionId): Promise<void> {
  const status = await statusOf(live, id);
  if (status.pid !== null) live.pids.add(status.pid);
  if (status.process !== 'exited') {
    value(await invoke(live.page, 'session.stop', { appSessionId: id, reason: 'stop' }));
    await expect.poll(async () => (await statusOf(live, id)).process, { timeout: 30_000 }).toBe('exited');
  }
  live.started = live.started.filter((s) => s.id !== id);
  const dir = join(live.sc.userData, 'engine-host', 'journal', id);
  live.note(`  ${label} ${id} stopped; spend ${journalSpend(live.sc.userData).usd.toFixed(4)} for the case's profile so far; journals ${dir}`);
  checkPlugins(live, label, id);
  live.note(`  ${a15Line(`after ${label}`, live.a15First, a15Reading(), [ROOT])}`);
}

// Every process under `pid`, its children's children included.
function descendants(pid: number): number[] {
  const table = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite)) as [number, number][];
  const found: number[] = [];
  for (let frontier = [pid]; frontier.length > 0; ) {
    const next = table.filter(([, parent]) => frontier.includes(parent)).map(([child]) => child);
    found.push(...next);
    frontier = next;
  }
  return found;
}

// The case's end: every session still running stopped, the app closed, the A-15 reading after it (no key of the run's
// own), the owner plugins none, and no process of the app or its engines left.
async function closeLive(live: Live): Promise<void> {
  try {
    for (const { label, id } of [...live.started].reverse()) await stopSession(live, label, id).catch((error: unknown) => live.note(`  ${label} ${id}: could not be stopped: ${String(error)}`));
    live.note(`spend: the case's profile ${journalSpend(live.sc.userData).usd.toFixed(4)}; ${spendLine(live.sc.sitting)}`);
    for (const pid of descendants(live.maws.app.process().pid!)) live.pids.add(pid); // the app's helpers and hosts
  } finally {
    await live.maws.cleanup();
  }
  const after = a15Reading();
  live.note(a15Line('after the app closed', live.a15First, after, [ROOT]));
  const survivors = [...live.pids].filter((pid) => isAlive(pid) && /claude|Electron|MAWS/.test(ps(pid, 'command')));
  const naming = processesNaming(live.sc.root);
  live.note(`survivor check: ${survivors.length === 0 && naming.length === 0 ? `none of ${live.pids.size} recorded pids (${[...live.pids].join(', ')}) and no process naming ${live.sc.root}` : `SURVIVORS ${JSON.stringify(survivors.map((pid) => `${pid} ${ps(pid, 'command')}`))} ${JSON.stringify(naming)}`}; maws-supervisor processes: ${execFileSync('/bin/sh', ['-c', 'pgrep -fl maws-supervisor || true'], { encoding: 'utf8' }).trim() || 'none'}`);
  for (const pid of survivors) process.kill(pid, 'SIGKILL');
  expect(compareA15(live.a15First.keys, after.keys, [ROOT]).breach, 'no project of the run’s scratch in the owner file (A-15)').toEqual([]);
  expect(live.ownerPluginsSeen, 'the engines loaded none of the owner’s plugins (Decision Log 22, 30)').toEqual([]);
  expect(survivors, 'no process of the app or its engines outlives the case').toEqual([]);
  expect(naming, 'no process names the case’s scratch').toEqual([]);
}

// `prerun-<item>-<surface>-<theme>.png` in both themes under MAWS_E11_SHOTS=1, toasts cleared first unless the shot is
// of one; back to light after.
async function shoot(live: Live, item: string, surface: string, opts: { keepToasts?: boolean } = {}): Promise<void> {
  if (SHOTS === null) return;
  mkdirSync(SHOTS, { recursive: true });
  if (!opts.keepToasts) await clearToasts(live.page);
  for (const theme of ['light', 'dark'] as const) {
    value(await invoke(live.page, 'settings.set', { theme }));
    await expect(live.page.locator('html')).toHaveAttribute('data-theme', theme);
    await live.page.waitForTimeout(250);
    await live.page.screenshot({ path: join(SHOTS, `prerun-${item}-${surface}-${theme}.png`) });
  }
  value(await invoke(live.page, 'settings.set', { theme: 'light' }));
}

// The case's opening lines: what runs, how, and the owner file before.
function opening(note: (line: string) => void, what: string, sc: CaseScratch, a15: A15Reading): void {
  const { bin, version } = theEngine();
  note(`==== ${what}, ${new Date().toISOString()}; run root ${ROOT}`);
  note(`engine: ${bin.replace(homedir(), '~')} (${version}), unmodified, through ClaudeUsage's relay ${RELAY_URL}, Haiku, default permission mode; spent so far ${spendLine(sc.sitting)}`);
  note(`scratch: ${sc.root} (claude-config/ settings.json {} and .claude.json trusting repo/; user-data/ the app's profile); the app: the harness build as the product (MAWS_HARNESS=0), every CLAUDE* variable of the runner dropped (launchEnvironment)`);
  note(a15Line('before the case', a15, a15, [ROOT]));
}

// ---- S3: deliverables, side threads and /btw ------------------------------------------------------------------------------

test.describe.serial('S3: deliverables, a side thread, Send to main and /btw through the app (items 5, 6, 10)', () => {
  const note = sittingLog(OUT, 's3');
  let live: Live | null = null;
  let parent = '' as AppSessionId;
  let artifact: { deliverableId: string } | null = null;

  test.beforeAll(async () => {
    await relayGate(note, 'S3');
    refuseOverCap(note, 'S3', 's3');
    const sc = caseScratch('s3', ['E11 S3: the parent'], (repo) => {
      writeFileSync(join(repo, 'page-v1.html'), artifactPage(V1.rgb, 1));
      writeFileSync(join(repo, 'page-v2.html'), artifactPage(V2.rgb, 2));
    });
    const a15 = a15Reading();
    opening(note, 'S3', sc, a15);
    live = await openLive(sc, note, a15);
    parent = live.ids[0]!;
    await show(sceneOf(live), parent);
    // resuming its seeded conversation in place (E4d's recipe), so the record stays bound to what the thread forks
    await launchSession(live, 'parent', parent, { resume: sc.engineIds[0] });
  });

  test.afterAll(async () => {
    if (live !== null) await closeLive(live);
  });

  test('1 artifacts: create, main’s real capture whose PNG shows the page’s colour, update; the row, the Deliverables tool, v2 and its switch, the record', async () => {
    const l = live!;
    refuseOverCap(note, 'S3 case 1', 's3');
    const allowed: string[] = [];
    const turnsBefore = mainTurnsEnded(await events(l, parent)).length;
    await sendFromComposer(l, parent, PROMPTS.artifact);
    await drive(l, l.pane, parent, 'the artifact turn', async () => mainTurnsEnded(await events(l, parent)).length > turnsBefore && (await idleNow(l, parent)), allowed);
    const rows = sessionRows(l, parent);
    const calls = mcpCalls(rows).filter((c) => c.name.startsWith('artifact_'));
    note(`case 1: maws artifact calls ${JSON.stringify(calls.map((c) => [c.name, c.args]))}; permissions allowed once through the card ${JSON.stringify(allowed)}`);
    const created = calls.find((c) => c.name === 'artifact_create');
    const shot = calls.find((c) => c.name === 'artifact_screenshot');
    const updated = calls.find((c) => c.name === 'artifact_update');
    expect([created, shot, updated].map((c) => c?.args.id), 'create, screenshot and update of "p1-page"').toEqual(['p1-page', 'p1-page', 'p1-page']);
    expect(calls.indexOf(created!) < calls.indexOf(shot!) && calls.indexOf(shot!) < calls.indexOf(updated!), 'in that order').toBe(true);

    // main's capture answered the engine: the image block decodes to a PNG of the page's colour
    const answer = mcpResultOf(rows, shot!.requestId);
    expect(answer?.isError).toBeUndefined();
    const image = answer!.content.find((b) => b.type === 'image') as { type: 'image'; data: string; mimeType: string } | undefined;
    expect(image?.mimeType).toBe('image/png');
    const png = Buffer.from(image!.data, 'base64');
    const seen = dominantColour(png);
    const text = JSON.parse((answer!.content.find((b) => b.type === 'text') as { text: string }).text) as Record<string, unknown>;
    const reply = mainTurnsEnded(await events(l, parent)).at(-1)?.resultText ?? '';
    note(`case 1: the screenshot's PNG ${png.readUInt32BE(16)} × ${png.readUInt32BE(20)}, ${png.length} bytes, dominant rgb(${seen.rgb.join(', ')}) over ${(seen.share * 100).toFixed(1)}% (the page's v1 background rgb(${V1.rgb.join(', ')}), distance ${colourDistance(seen.rgb, V1.rgb)}); the result ${JSON.stringify(text)}; reply ${JSON.stringify(reply)}`);
    expect(colourDistance(seen.rgb, V1.rgb), 'the capture shows the page’s own colour').toBeLessThanOrEqual(24);
    expect(seen.share).toBeGreaterThan(0.5);
    expect.soft(reply, 'the model names the colour it saw').toMatch(V1.word);

    // the record: one artifact, two copied versions, the sources left where the test wrote them
    const deliverableId = (JSON.parse((mcpResultOf(rows, created!.requestId)!.content.find((b) => b.type === 'text') as { text: string }).text) as { deliverableId: string }).deliverableId;
    const record = JSON.parse(readFileSync(join(l.sc.userData, 'deliverables', parent, `${deliverableId}.json`), 'utf8')) as { kind: string; artifactId: string; title: string; versions: { path: string }[] };
    expect(record).toMatchObject({ kind: 'artifact', artifactId: 'p1-page', title: 'P1 page' });
    expect(record.versions.map((v) => readFileSync(v.path, 'utf8'))).toEqual([artifactPage(V1.rgb, 1), artifactPage(V2.rgb, 2)]);

    // the rows, the Deliverables tool listing it, the viewer on v2 with the switch, v2 drawn in its own colour
    await expect(l.pane.locator('section.transcript-artifact [data-artifact-heading]')).toHaveText(['Artifact P1 page · v1', 'Updated artifact P1 page · v2']);
    await shoot(l, '5', 'artifact-row');
    await openDeliverables(sceneOf(l));
    await rowOf(listOf(sceneOf(l)), { id: deliverableId }).click();
    const viewer = viewerOf(l.panel);
    await expect(viewer).toHaveAttribute('data-version', '2');
    await expect(viewer.getByRole('combobox', { name: 'Version' }).locator('option')).toHaveText(['v1', 'v2 · latest']);
    const frame = await frameAt(l.page, deliverableUrl(parent, deliverableId, 2));
    await expect(frame.locator('#title')).toHaveText('P1 live page, version 2');
    expect(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(`rgb(${V2.rgb.join(', ')})`);
    await shoot(l, '5', 'viewer');
    artifact = { deliverableId };
    note(`case 1: PASS: record ${deliverableId} (${record.versions.length} versions under ${join(l.sc.userData, 'deliverables', parent)}); rows "Artifact P1 page · v1", "Updated artifact P1 page · v2"; the Deliverables tool lists it; the viewer opens v2 with the switch [v1, v2 · latest] and draws v2's colour`);
  });

  // A pick in the viewer through the pick overlay, the comment composer on the element's `artifact-element` anchor.
  async function pickTitle(l: Live): Promise<Locator> {
    const viewer = viewerOf(l.panel);
    await l.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Deliverables/ }).click();
    await expect(viewer).toHaveAttribute('data-deliverable-id', artifact!.deliverableId);
    const frame = await frameAt(l.page, deliverableUrl(parent, artifact!.deliverableId, Number(await viewer.getAttribute('data-version'))));
    await viewer.getByRole('button', { name: 'Comment', exact: true }).click();
    const box = (await viewer.locator('[data-deliverable-frame="html"]').boundingBox())!;
    await l.page.mouse.move(box.x + 60, box.y + 30);
    await expect(frame.locator('[data-maws-pick-overlay]')).toHaveCount(1);
    await l.page.mouse.click(box.x + 60, box.y + 30);
    const sheet = l.page.locator('[data-comment-composer]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-anchor-kind', 'artifact-element');
    await expect(sheet).toHaveAttribute('data-anchor-locator', '#title');
    return sheet;
  }

  test('2 a comment picked on the artifact goes to a Side thread, which answers in the Side pane and sums itself up in the parent; the parent’s turns unchanged', async () => {
    const l = live!;
    refuseOverCap(note, 'S3 case 2', 's3');
    test.skip(artifact === null, 'case 1 recorded no artifact');
    const turnsBefore = mainTurnsEnded(await events(l, parent)).length;
    const usersBefore = outUsers(sessionRows(l, parent)).length;
    const sheet = await pickTitle(l);
    await expect(sheet.getByRole('radio', { name: /Side thread/ })).toBeChecked();
    await sheet.getByRole('textbox', { name: 'Comment' }).fill(PROMPTS.thread);
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet).toHaveCount(0);

    let child = '' as AppSessionId;
    await expect
      .poll(async () => (child = (value(await invoke(l.page, 'session.list', {})).sessions.find((r) => r.lineage?.kind === 'side-thread' && r.lineage.parentAppSessionId === parent)?.appId ?? '') as AppSessionId), { timeout: 60_000 })
      .not.toBe('');
    l.started.push({ label: 'side thread', id: child });
    const record = value(await invoke(l.page, 'session.get', { appSessionId: child }));
    const anchor = record?.lineage?.anchor;
    expect(record?.lineage).toMatchObject({ kind: 'side-thread', parentAppSessionId: parent, openedBy: 'comment', anchor: { kind: 'artifact-element', locator: '#title' } });
    const pane = l.panel.locator(`[data-side-thread-view="${child}"]`);
    await expect(pane, 'the Side pane opens on the thread').toBeVisible({ timeout: 60_000 });
    await expect(pane.locator('header').first(), 'the anchor at the thread’s head').toContainText(anchor!.label);
    await expect(pane.locator('[data-chip="anchor"]').first()).toHaveAttribute('data-anchor-kind', 'artifact-element');

    const row = l.page.locator(`[data-region="main"] [data-side-thread="${child}"]`);
    const allowed: string[] = [];
    await drive(l, pane, child, 'the thread’s turn', async () => mainTurnsEnded(await events(l, child)).length > 0 && (await idleNow(l, child)), allowed);
    const status = await statusOf(l, child);
    if (status.pid !== null) l.pids.add(status.pid);
    const reply = mainTurnsEnded(await events(l, child)).at(-1)?.resultText ?? '';
    await expect(row).toHaveAttribute('data-state', 'finished', { timeout: 30_000 });
    const summary = (await row.textContent())?.trim() ?? '';
    const turnsAfter = mainTurnsEnded(await events(l, parent)).length;
    const usersAfter = outUsers(sessionRows(l, parent)).length;
    note(`case 2: thread ${child} (lineage ${JSON.stringify({ kind: record?.lineage?.kind, openedBy: record?.lineage?.openedBy, anchor: { kind: anchor?.kind, locator: anchor?.locator, label: anchor?.label } })}); its reply ${JSON.stringify(reply)}; permissions allowed in the Side pane ${JSON.stringify(allowed)}; the parent's row ${JSON.stringify(summary)}; the parent's turns ${turnsBefore} → ${turnsAfter}, its written prompts ${usersBefore} → ${usersAfter}; no --max-budget-usd on the fork (Q12)`);
    expect(reply).toContain('ANCHORED');
    await expect(pane.locator('[data-kind="assistant_text"]').filter({ hasText: 'ANCHORED' }), 'the thread’s reply in the Side pane').not.toHaveCount(0);
    expect(summary).toContain('ANCHORED');
    expect(turnsAfter, 'the parent ran no turn').toBe(turnsBefore);
    expect(usersAfter, 'the main conversation received nothing').toBe(usersBefore);
    await shoot(l, '6', 'side-thread');
    note('case 2: PASS');
  });

  test('3 Send to main: a comment sent mid-turn steers the parent at its next tool boundary, drawn as the anchored prompt row', async () => {
    const l = live!;
    refuseOverCap(note, 'S3 case 3', 's3');
    test.skip(artifact === null, 'case 1 recorded no artifact');
    const turnsBefore = mainTurnsEnded(await events(l, parent)).length;
    const allowed: string[] = [];
    await sendFromComposer(l, parent, PROMPTS.slow);
    // the Bash call running: its tool use seen and its permission answered
    await drive(l, l.pane, parent, 'the Bash call to run', async () => {
      const all = await events(l, parent);
      const bash = ofKind(all, 'tool.use').find((e) => e.toolName === 'Bash' && JSON.stringify(e.input).includes('SLEPT'));
      const resolved = new Set(ofKind(all, 'permission.resolved').map((e) => e.requestId));
      return bash !== undefined && ofKind(all, 'permission.requested').every((e) => resolved.has(e.requestId));
    }, allowed);
    const sheet = await pickTitle(l);
    await sheet.locator('[data-destination="main"]').click();
    await expect(sheet.getByRole('radio', { name: /Send to main/ })).toBeChecked();
    const caption = (await sheet.locator('[data-destination="main"]').textContent())?.trim() ?? '';
    await sheet.getByRole('textbox', { name: 'Comment' }).fill(PROMPTS.steer);
    const sentAt = Date.now();
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet).toHaveCount(0);
    await drive(l, l.pane, parent, 'the steered turn’s end', async () => mainTurnsEnded(await events(l, parent)).length > turnsBefore && (await idleNow(l, parent)), allowed);

    const written = outUsers(sessionRows(l, parent)).map((r) => r.frame as { priority?: string; message?: { content?: unknown } });
    const steer = written.find((f) => JSON.stringify(f.message?.content ?? '').includes(PROMPTS.steer));
    const reply = mainTurnsEnded(await events(l, parent)).at(-1)?.resultText ?? '';
    note(`case 3: the sheet's Send to main caption ${JSON.stringify(caption)}; sent ${Math.round((Date.now() - sentAt) / 1000)} s before the turn ended; the written prompt ${steer ? `priority ${JSON.stringify(steer.priority ?? null)}` : 'MISSING'}; permissions allowed ${JSON.stringify(allowed)}; reply ${JSON.stringify(reply)}`);
    expect(steer, 'the comment went to the main conversation').toBeDefined();
    expect.soft(steer?.priority, 'a `next` steer, the parent mid-turn').toBe('next');
    const bubble = l.pane.locator('[data-bubble]').filter({ hasText: PROMPTS.steer });
    await expect(bubble.locator('[data-chip="anchor"]'), 'the anchored prompt row in the parent’s transcript').toBeVisible();
    expect.soft(reply).toContain('STEER_SEEN');
    await shoot(l, '6', 'send-to-main');
    note('case 3: PASS');
  });

  test('4 /btw in the parent’s composer answers in the Side pane; the parent’s transcript unchanged', async () => {
    const l = live!;
    refuseOverCap(note, 'S3 case 4', 's3', { usd: BTW_RESERVATION_USD, for: 'the side question’s reservation' });
    const turnsBefore = mainTurnsEnded(await events(l, parent)).length;
    const usersBefore = outUsers(sessionRows(l, parent)).length;
    // charged before it is asked: its answer comes as a control response, with no result frame to receipt it
    charge(note, { key: 's3-btw', case: 's3', label: 'the /btw side question (reserved: answered with no result frame)', usd: BTW_RESERVATION_USD });
    await sendFromComposer(l, parent, `/btw ${PROMPTS.btw}`, { typed: true });
    const view = l.panel.locator(`[data-side-btw-view="${parent}"]`);
    await expect(view).toBeVisible({ timeout: 30_000 });
    const answered = view.locator('[data-side-exchange="answered"]').first();
    await expect(answered).toBeVisible({ timeout: 120_000 });
    const answer = (await answered.textContent())?.trim() ?? '';
    const asked = sessionRows(l, parent).filter((r) => r.direction === 'out' && (r.frame as { request?: { subtype?: string } }).request?.subtype === 'side_question');
    const turnsAfter = mainTurnsEnded(await events(l, parent)).length;
    const usersAfter = outUsers(sessionRows(l, parent)).length;
    note(`case 4: side_question controls written ${asked.length}; the Side pane's exchange ${JSON.stringify(answer)}; the parent's turns ${turnsBefore} → ${turnsAfter}, written prompts ${usersBefore} → ${usersAfter}`);
    expect(asked.map((r) => (r.frame as { request: { question: string } }).request.question)).toEqual([PROMPTS.btw]);
    expect(turnsAfter, 'no turn in the main conversation').toBe(turnsBefore);
    expect(usersAfter, 'nothing written to the main conversation').toBe(usersBefore);
    expect.soft(answer).toMatch(V1.word);
    await shoot(l, '10', 'btw');
    note('case 4: PASS');
  });
});

// ---- S4: the browser under a live engine ----------------------------------------------------------------------------------

test.describe('S4: the browser (item 7)', () => {
  const note = sittingLog(OUT, 's4');

  test('5 E4c’s recording prompt against the real browser: the seven rows, the reference, the screenshot record, the agent’s cursor, the Browser tool opened once', async () => {
    await relayGate(note, 'S4 case 5');
    refuseOverCap(note, 'S4 case 5', 's4');
    const sc = caseScratch('s4-browser', ['E11 S4: the browser']);
    const a15 = a15Reading();
    opening(note, 'S4 case 5', sc, a15);
    const server = await startBrowserToolsServer();
    const live = await openLive(sc, note, a15);
    try {
      const [id] = live.ids as [AppSessionId];
      await show(sceneOf(live), id);
      await launchSession(live, 'browser', id);
      const acting: unknown[] = [];
      await live.page.evaluate(() => {
        const w = window as unknown as { __e11Acting?: unknown[] };
        w.__e11Acting = [];
        window.maws.on('browser.agent.acting', (payload) => w.__e11Acting!.push(payload));
      });
      // the agent's cursor in the form's page, looked for while the turn runs (the click loads a page without it)
      let cursorSeen = false;
      const formUrl = server.url('/form.html');
      const lookForCursor = async () => {
        if (cursorSeen) return;
        const form = live.maws.app.windows().find((p) => p !== live.page && !p.isClosed() && p.url() === formUrl);
        if (form) cursorSeen = await form.evaluate(() => document.querySelector('maws-agent-cursor') !== null).catch(() => false);
      };
      const allowed: string[] = [];
      await sendFromComposer(live, id, PROMPTS.browser);
      await drive(live, live.pane, id, 'the browser turn', async () => {
        await lookForCursor();
        return mainTurnsEnded(await events(live, id)).length > 0 && (await idleNow(live, id));
      }, allowed);
      acting.push(...(await live.page.evaluate(() => (window as unknown as { __e11Acting: unknown[] }).__e11Acting)));

      const actions = ofKind(await events(live, id), 'maws.browser.action');
      const reply = mainTurnsEnded(await events(live, id)).at(-1)?.resultText ?? '';
      const tabId = actions[0]?.tabId ?? null;
      const cursor = tabId === null ? 0 : await cursorMessages(live as unknown as BrowserScene, tabId);
      const browserTabs = live.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Browser/ });
      const shotEvent = actions.find((e) => e.tool === 'browser_screenshot');
      const recordFile = shotEvent?.deliverableId ? join(live.sc.userData, 'deliverables', id, `${shotEvent.deliverableId}.json`) : null;
      const screenshotRecord = recordFile && existsSync(recordFile) ? (JSON.parse(readFileSync(recordFile, 'utf8')) as { kind: string; sourceUrl?: string }) : null;
      note(`case 5: maws.browser.action ${JSON.stringify(actions.map((e) => [e.tool, e.action, e.tabId, e.error]))}; permissions allowed once ${JSON.stringify(allowed)}; reply ${JSON.stringify(reply)}; the screenshot's record ${JSON.stringify(screenshotRecord)}; maws-agent-cursor seen in the form's page: ${cursorSeen}, cursor messages to the tab ${cursor}; browser.agent.acting notices ${acting.length}; Browser tools in the panel ${await browserTabs.count()}`);
      expect(actions.map((e) => [e.tool, e.action])).toEqual([
        ['browser_tabs', 'open'],
        ['browser_snapshot', 'snapshot'],
        ['browser_act', 'fill'],
        ['browser_act', 'fill'],
        ['browser_act', 'click'],
        ['browser_snapshot', 'snapshot'],
        ['browser_screenshot', 'screenshot'],
      ]);
      expect(actions.every((e) => e.error === null && e.tabId === tabId), 'every call on the one tab, none failed').toBe(true);
      await expect(live.pane.locator('section.transcript-browser-action')).toHaveCount(7);
      expect(reply).toContain(ORDER_REFERENCE);
      expect(screenshotRecord?.kind).toBe('screenshot');
      expect(screenshotRecord?.sourceUrl?.startsWith(server.url('/done.html')), 'the screenshot is of the order’s confirmation').toBe(true);
      expect(cursorSeen, 'the agent’s cursor drew in the page (maws-agent-cursor)').toBe(true);
      await expect(browserTabs, 'the Browser tool opened once').toHaveCount(1);
      await expect(browserIn(sceneOf(live), 'panel')).toBeVisible();
      await shoot(live, '7', 'browser-rows');
      note('case 5: PASS');
    } finally {
      await closeLive(live).finally(() => server.close());
    }
  });

  test('6 the live anchor resolution: E4d’s own live proof stands', () => {
    note('case 6: skipped: E4d M5 proved the live anchor resolution in the app (A-49; docs/doperpowers/evidence/p1-e4d/live-proof.txt), Decision Log 9 and 20');
    test.skip(true, 'E4d’s M5 proved the live anchor resolution in the app (A-49): Decision Log 9 and 20');
  });

  test('7 the OOPIF page of the owner’s step F: a browser_snapshot through the seam shows a text field inside a cross-site frame (no engine turn)', async () => {
    const sc = caseScratch('s4-oopif', ['E11 S4: the OOPIF page']);
    const a15 = a15Reading();
    opening(note, 'S4 case 7 (no engine turn, no spend)', sc, a15);
    const served = await startOopifPage();
    const live = await openLive(sc, note, a15);
    try {
      const [id] = live.ids as [AppSessionId];
      const s = live as unknown as BrowserScene;
      await show(sceneOf(live), id);
      await openBrowser(sceneOf(live));
      const tabId = (await agentOk(s, id, 'browser_tabs', { action: 'open', url: served.page })).result.tabId as string;
      const snapshot = (await agentOk(s, id, 'browser_snapshot', { tabId })).text!;
      const ref = refIn(snapshot, 'textbox', OOPIF_FIELD.label);
      const lines = snapshot.split('\n');
      const fieldLine = lines.findIndex((line) => line.includes(`textbox "${OOPIF_FIELD.label}" [ref=${ref}]`));
      const frameLine = lines.slice(0, fieldLine).findLastIndex((line) => /- iframe \[ref=e\d+\]/.test(line));
      const indent = (line: string) => /^ */.exec(line)![0].length;
      // the page and the frame as Chromium holds them: the frame's URL, site and process
      const page = await pageAt(s, served.page);
      const fieldFrame = page.frames().find((f) => f.url() === served.frame);
      const webContentsId = await live.maws.app.evaluate((_electron, tab) => (globalThis as unknown as { __maws_browser_comment: { state(tabId: string): { webContentsId: number | null } | null } }).__maws_browser_comment.state(tab)?.webContentsId ?? null, tabId);
      const frames = webContentsId === null ? [] : await live.maws.app.evaluate(({ webContents }, wc) => webContents.fromId(wc)!.mainFrame.framesInSubtree.map((f) => ({ url: f.url, processId: f.processId })), webContentsId);
      const main = frames.find((f) => f.url === served.page);
      const field = frames.find((f) => f.url === served.frame);
      note(`case 7: page ${served.page} (site ${siteOf(served.page)}) frames ${served.frame} (site ${siteOf(served.frame)}); the field: textbox "${OOPIF_FIELD.label}" (name="${OOPIF_FIELD.name}") at ref ${ref}, under the snapshot's iframe line ${frameLine >= 0 ? JSON.stringify(lines[frameLine]!.trim()) : 'NONE'}; Chromium's frames ${JSON.stringify(frames)}; out of process: ${main && field ? main.processId !== field.processId : 'unknown'}`);
      note(`case 7: the snapshot:\n${snapshot}`);
      expect(ref, 'the field’s ref names a frame (f<n>e<m>)').toMatch(/^f\d+e\d+$/);
      expect(frameLine, 'the field sits under an iframe line').toBeGreaterThanOrEqual(0);
      expect(indent(lines[fieldLine]!)).toBeGreaterThan(indent(lines[frameLine]!));
      expect(siteOf(served.frame), 'the frame’s site differs from the page’s').not.toBe(siteOf(served.page));
      expect(fieldFrame, 'Chromium holds the frame at its URL').toBeDefined();
      await expect(fieldFrame!.getByRole('textbox', { name: OOPIF_FIELD.label })).toBeVisible();
      expect.soft(main && field && main.processId !== field.processId, 'the frame is out of process').toBe(true);
      note(`case 7: PASS: the owner's step F page is ${served.page}, the field "${OOPIF_FIELD.label}" in the frame from ${served.frame}; served by \`node --experimental-strip-types --no-warnings e2e/support/oopif-page.ts\``);
    } finally {
      await closeLive(live).finally(() => served.close());
    }
  });
});

// ---- S6: ten row Resumes ---------------------------------------------------------------------------------------------------

// The engine's view during a stall, as the C3 row's "Closes when" asks (e2e/c3-stall.spec.ts's capture): its process and
// children (a `security` child is the Keychain lookup the row suspects), open files and a `sample`.
function captureStall(dir: string, pid: number): void {
  mkdirSync(dir, { recursive: true });
  const sh = (cmd: string, args: string[], timeout = 20_000) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      return `ERR ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  writeFileSync(join(dir, 'ps.txt'), `${sh('/bin/ps', ['-o', 'pid,ppid,stat,wchan,etime,rss,command', '-p', String(pid)])}\n${sh('/usr/bin/pgrep', ['-lP', String(pid)])}`);
  writeFileSync(join(dir, 'lsof.txt'), sh('/usr/sbin/lsof', ['-p', String(pid)]));
  writeFileSync(join(dir, 'sample.txt'), sh('/usr/bin/sample', [String(pid), '3'], 40_000));
}

test('S6 8: ten row Resumes in the app, each in a fresh launch, each bounded 30 s to first output; a stall recorded with its capture', async () => {
  const note = sittingLog(OUT, 's6');
  await relayGate(note, 'S6 case 8');
  refuseOverCap(note, 'S6 case 8', 's6');
  const sc = caseScratch('s6', ['E11 S6: the resumed session']);
  const a15 = a15Reading();
  opening(note, 'S6 case 8', sc, a15);
  // the session: its seeded conversation resumed once with one turn, so the ten resumes reopen a real conversation
  let live = await openLive(sc, note, a15);
  const id = live.ids[0]!;
  try {
    await show(sceneOf(live), id);
    await launchSession(live, 'the first turn', id, { resume: sc.engineIds[0] });
    await sendFromComposer(live, id, PROMPTS.resumeSeed);
    await drive(live, live.pane, id, 'the first turn', async () => mainTurnsEnded(await events(live, id)).length > 0 && (await idleNow(live, id)));
    await stopSession(live, 'the first turn', id);
  } finally {
    await closeLive(live);
  }
  note(`S6: engine session ${sc.engineIds[0]} in ${sc.repo} under CLAUDE_CONFIG_DIR ${sc.config} (the sitting's ten terminal resumes take the same id)`);

  const results: { i: number; ok: boolean; readyMs: number | null; firstOutputMs: number | null; noOutput: boolean; launches: number; process: string | null }[] = [];
  for (let i = 1; i <= 10; i++) {
    const refusal = budgetRefusal(budgetFor('s6'), CAP);
    if (refusal !== null) {
      note(`resume ${i}: ${refusal}`);
      break;
    }
    live = await openLive(sc, note, a15);
    try {
      const journals = () => (existsSync(join(sc.userData, 'engine-host', 'journal', id)) ? readdirSync(join(sc.userData, 'engine-host', 'journal', id)).filter((n) => n.endsWith('.jsonl')).length : 0);
      const before = journals();
      const row = await sidebarRow(live.page, { appSessionId: id });
      await row.click({ button: 'right' });
      const t0 = Date.now();
      await live.page.getByRole('menuitem', { name: 'Resume', exact: true }).click();
      const trust = live.page.getByRole('group', { name: 'Trust this folder?' });
      let status = await statusOf(live, id).catch(() => null);
      let captured = false;
      for (;;) {
        if (await trust.isVisible().catch(() => false)) await trust.getByRole('button', { name: 'Trust and start' }).click();
        status = await statusOf(live, id).catch(() => null);
        if (status?.process === 'ready') break;
        if (status?.pid) live.pids.add(status.pid);
        if (!captured && status?.pid && status.process !== 'exited' && Date.now() - t0 > 10_000) {
          captureStall(join(sc.root, 'stalls', `resume-${i}-${status.pid}`), status.pid);
          captured = true;
        }
        if (Date.now() - t0 > FIRST_OUTPUT_MS * 2 + 15_000) break; // the bound, its one visible retry, and a margin
        await live.page.waitForTimeout(100);
      }
      const readyMs = status?.process === 'ready' ? Date.now() - t0 : null;
      if (status?.pid) live.pids.add(status.pid);
      const rows = status ? journal(status.journalPath) : [];
      const all = sessionRows(live, id);
      const spawned = rows.find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'spawn');
      const first = rows.find((r) => r.direction === 'in' || r.direction === 'stderr');
      const firstOutputMs = spawned && first ? Date.parse(first.at) - Date.parse(spawned.at) : null;
      const noOutput = all.some((r) => r.direction === 'meta' && (r.frame as { event?: string; code?: string }).event === 'init_failed' && (r.frame as { code?: string }).code === 'no_output');
      const launches = journals() - before;
      const ok = readyMs !== null && firstOutputMs !== null && firstOutputMs <= FIRST_OUTPUT_MS && !noOutput && launches === 1;
      results.push({ i, ok, readyMs, firstOutputMs, noOutput, launches, process: status?.process ?? null });
      note(`resume ${i}: ${ok ? 'ok' : 'STALL'}: ready in ${readyMs ?? '—'} ms, first output ${firstOutputMs ?? '—'} ms after spawn, no_output ${noOutput}, launches ${launches}, process ${status?.process ?? 'none'}, pid ${status?.pid ?? '—'}${captured ? `; captured under ${join(sc.root, 'stalls')}` : ''}`);
      if (status !== null && status.process !== 'exited') await stopSession(live, `resume ${i}`, id);
    } finally {
      await closeLive(live);
    }
  }
  const stalls = results.filter((r) => !r.ok);
  note(`S6 case 8: ${results.length} resumes, ${stalls.length} stalls${stalls.length > 0 ? ` (${stalls.map((r) => r.i).join(', ')})` : ''}; spend ${spendLine('s6')}`);
  for (const r of results) expect.soft(r.ok, `resume ${r.i} reached first output within ${FIRST_OUTPUT_MS / 1000} s with no no_output`).toBe(true);
  expect(results).toHaveLength(10);
});

// ---- A-47: the fallback permission toast retracts ---------------------------------------------------------------------------

// What the app's Notification.show() answers in the A-47 case: macOS's refusal, as the unsigned build gets it.
const FORCED_REFUSAL = 'refused by e2e/p1-live.spec.ts (A-47): the fallback forced';

test('A-47: a permission request on a session not in front raises the fallback toast with no window focused; answering it retracts the toast', async () => {
  const note = sittingLog(OUT, 'a47');
  await relayGate(note, 'A-47');
  refuseOverCap(note, 'A-47', 's4');
  const sc = caseScratch('a47', ['E11 A-47: in front', 'E11 A-47: in the back']);
  const a15 = a15Reading();
  opening(note, 'A-47 (Decision Log 23)', sc, a15);
  const live = await openLive(sc, note, a15);
  try {
    const [front, back] = live.ids as [AppSessionId, AppSessionId];
    await show(sceneOf(live), front);
    value(await invoke(live.page, 'settings.set', { notifications: { enabled: true, kinds: { approvals: true } } }));
    // C5's notifier (src/main/attention/notifier.ts) falls back to the dock bounce and the page's toast when macOS has no
    // notification support or refuses one (`failed`, as it does for the unsigned build), and stays there; a build macOS
    // lets post delivers `os` and shows no toast, so the desktop's notification state would decide the case. No setting
    // or MAWS_E2E seam chooses the fallback, so the case makes macOS's refusal itself, in the app's own main process
    // through Playwright's handle (no production change; nothing reaches the desktop): every Notification's show()
    // fails at once, and the notifier's real `failed` path takes over.
    await live.maws.app.evaluate(({ Notification }, reason) => {
      Notification.prototype.show = function (this: InstanceType<typeof Notification>) {
        this.emit('failed', {}, reason);
      };
    }, FORCED_REFUSAL);
    note(`A-47: the OS notification refused in the app's main process (${FORCED_REFUSAL}), so the notifier takes its fallback`);
    const focus = () => live.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null);
    let focused = await focus();
    if (focused !== null) {
      // MAWS's own windows, through Playwright's handle on the app (no desktop input): the notifier posts only unfocused
      await live.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.blur()));
      focused = await focus();
    }
    await launchSession(live, 'in the back', back);
    value(await invoke(live.page, 'session.send', { appSessionId: back, content: PROMPTS.a47 }));
    let requested: Extract<SessionEvent, { kind: 'permission.requested' }> | undefined;
    await expect.poll(async () => (requested = ofKind(await events(live, back), 'permission.requested')[0]) !== undefined, { timeout: TURN_MS }).toBe(true);
    const notifiedOf = async () => (await live.page.evaluate(() => (window as unknown as { __e11Notified: { appSessionId: string; delivery: string; at: string; receivedAt: number }[] }).__e11Notified)).filter((n) => n.appSessionId === back);
    let notified: { delivery: string; at: string; receivedAt: number } | undefined;
    await expect.poll(async () => (notified = (await notifiedOf())[0]) !== undefined, { timeout: 30_000, message: `attention.notified for the back session (a focused window ${focused} would post none)` }).toBe(true);
    const shownTab = await live.page.locator('[data-region="main"] [role="tab"][aria-selected="true"]').first().getAttribute('data-tab-id').catch(() => null);
    const toast = live.page.locator('[data-toast-viewport] li').filter({ hasText: ' needs you' }); // the one session asking
    await expect(toast, 'the fallback toast').toBeVisible({ timeout: 10_000 });
    const toastText = (await toast.textContent())?.trim() ?? '';
    await shoot(live, 'a47', 'toast', { keepToasts: true });
    await expect(toast, 'still shown while the request is open').toBeVisible();
    const answer = value(await invoke(live.page, 'session.answer', { appSessionId: back, requestId: requested!.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
    const answeredAt = Date.now();
    await expect(toast, 'retracted once the request is answered').toHaveCount(0, { timeout: 4_000 });
    const goneAt = Date.now();
    const notifiedAt = Date.parse(notified!.at);
    note(`A-47: window focused at the request: ${focused === null ? 'none' : `window ${focused}`}; the main view's tab ${JSON.stringify(shownTab)} (the back session not in front); permission.requested ${requested!.toolName} ${requested!.requestId}; attention.notified delivery ${notified!.delivery} at ${notified!.at}; the toast ${JSON.stringify(toastText)}; session.answer ${JSON.stringify(answer)} ${answeredAt - notifiedAt} ms after the notice; the toast gone ${goneAt - answeredAt} ms after the answer (${goneAt - notifiedAt} ms after the notice; the toast's own timeout is 6 s)`);
    expect(focused, 'no MAWS window focused').toBeNull();
    expect(notified!.delivery, 'the notifier’s fallback (the OS notification refused)').toBe('fallback');
    expect(shownTab).not.toBe(`session:${back}`);
    expect(answer).toEqual({ outcome: 'delivered' });
    // retracted, not timed out: gone inside the toast's own 6 s (TOAST_DURATION_MS), or still shown past it until the answer
    expect(goneAt - notifiedAt < 6_000 || answeredAt - notifiedAt >= 6_000, 'gone by the answer, not by the toast’s own timeout').toBe(true);
    // to its end, any further permission it asks answered the same way (nobody sees its card)
    const answered = new Set([requested!.requestId]);
    await expect
      .poll(async () => {
        for (const ask of ofKind(await events(live, back), 'permission.requested').filter((e) => !answered.has(e.requestId))) {
          answered.add(ask.requestId);
          value(await invoke(live.page, 'session.answer', { appSessionId: back, requestId: ask.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
        }
        return idleNow(live, back);
      }, { timeout: TURN_MS })
      .toBe(true);
    note(`A-47: PASS (${answered.size} permission request(s) answered)`);
  } finally {
    await closeLive(live);
  }
});
