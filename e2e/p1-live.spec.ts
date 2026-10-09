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
//   S4 (item 7)          retired on 2026-10-08 with the browser tools it drove (P1 A-54; the cases ran green in E11,
//                          evidence/p1-e11/live-s4.txt); cua_repl's route is proven by the in-app browser spec's M5.
//                          Its budget still carries the A-47 case.
//   S6 (the C3 stall row) 8 ten row Resumes, each in a fresh app launch, each bounded 30 s to first output. 8t ten
//                          `claude -p --resume` of the same session from a terminal under its scratch home, the same bound.
//   S2 (b, c, d)         the listing's Message between two sessions, a peer message into a terminal session and the teammate
//                          attempt (Task 6.4; their own block and caps at the end of this file).
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
// no turn). That budget is reserved in `charges.jsonl` before the launch, against the session's own receipts (the
// session counts as spent at the larger of the two), and settled at the case's end once its process is gone: to its
// receipts, or kept whole when a prompt went unreceipted (a timeout or a crash before its result). So the next case,
// or a fresh Playwright worker reading the run root, never sees a remainder a running session may still spend.
// Case 2's side thread is a fork of the parent and takes no `--max-budget-usd` (src/main/sessions/launch-mapping.ts;
// whether it should is owner question Q12), so the test bounds it: the parent launches with FORK_ALLOCATION_USD and
// BTW_RESERVATION_USD held back from its budget, case 2 starts only when what is left covers the allocation, charges it
// before the comment is sent, stops the thread through the app once its journal's receipts reach it, and after the
// thread stops settles the charge to its receipts (or keeps the whole allocation when a prompt went unreceipted); the
// parent's own launch budget stays reserved through the four cases, so case 3 needs no allowance of its own. US$0.08
// is about two and a half times a recorded fork turn (spikes/protocol-probe/fixtures/resume-fork-*.jsonl: US$0.027 to
// 0.032). The residual: the test sees the thread's spend only at a receipt, so its first turn is bounded by its prompt
// (one word, no tools asked) and the timeout, not by a dollar cap; receipts past the allocation once it settled are
// logged as the finding `fork overspend: <cost> > 0.08 (uncapped fork, Q12)` and fail case 2's spend assertion.
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
import { execFileSync, spawn } from 'node:child_process';
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
import { assertConfigHomeSafe, journalCost, redactJournal } from '../test/live/support/live';
import { ENGINE_BIN } from '../test/support/engine-pin';
import { relayText } from '../src/renderer/src/tools/agents/model/relay';
import { ownerPlugins } from '../test/support/claude-env';
import { compareA15 } from '../test/support/owner-file';
import { isolatedGitEnv } from '../test/support/git-env';
import { relaySkipReason } from '../test/support/relay-health';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { journalSpend, ptyEngine, terminalEnv, transcriptFile, type PtyEngine } from './support/c12-prerun';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { clearToasts, eventsOf, frameAt, listOf, mcpCalls, mcpResultOf, ofKind, openDeliverables, recordEvents, rowOf, seedTranscripts, show, unfoldWork, viewerOf, type Scene } from './support/maws-tools';
import { a15Line, a15Reading, budgetOf, budgetRefusal, capUsd, CASE_SITTING, chargeOf, colourDistance, costRecorded, costShown, DEFAULT_CAP_USD, dominantColour, forkOverspend, initPluginsOf, installedEngine, launchReservation, liveOutDir, resumeNoOutput, runRoot, settleAll, settledReservation, sittingLog, SITTING_CAP_USD, spentBySitting, terminalUsdBound, type A15Reading, type Budget, type CaseName, type Charge, type Sitting } from './support/p1-live';
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
const FORK_ALLOCATION_USD = 0.08; // case 2's side thread, which takes no --max-budget-usd (the header)

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
  // P2-E1 (M5): the thread edits the page it comments on and updates the parent's artifact, then answers
  thread:
    'Do these steps yourself, one after another, never through an agent, and do not read, list or inspect any file first. ' +
    'First run the Bash command `sed -i \'\' \'s/version 2/commented/\' page-v2.html` in the foreground. ' +
    'Then call mcp__maws__artifact_update with id "p1-page" and html_path "page-v2.html". ' +
    'Then reply with exactly one word: ANCHORED.',
  slow: 'Run the Bash command `sleep 25; echo SLEPT` yourself, in the foreground (never in the background, never through an agent), then reply with its output.',
  steer: 'When you reply, add the word STEER_SEEN at the end.',
  btw: 'In one word: what was the background colour of the artifact’s first version?',
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
  note(`  charged US$${c.usd.toFixed(4)} to ${CASE_SITTING[c.case].toUpperCase()} for ${c.label}${c.against ? ` (counted beyond ${c.against}'s receipts)` : ''} [${c.key}]; ${spendLine(CASE_SITTING[c.case])}`);
}

// One session's receipts, each of its launch journals summed as journalSpend sums them.
function sessionReceipts(name: CaseName, id: string): number {
  const dir = join(ROOT, name, 'user-data', 'engine-host', 'journal', id);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((file) => file.endsWith('.jsonl')).reduce((usd, file) => usd + journalCost(journal(join(dir, file))).costUsd, 0);
}

// What each sitting and the run have spent: every journal of every case's profile under the run's root (a resumed or
// forked process may restore its session's cost, so summing journals can only over-count, the safe side of a cap),
// plus the charges, a launch reservation counted beyond its session's receipts.
function spent() {
  const receipts: Partial<Record<CaseName, number>> = {};
  for (const name of Object.keys(CASE_SITTING) as CaseName[]) {
    const dir = join(ROOT, name, 'user-data');
    if (existsSync(dir)) receipts[name] = journalSpend(dir).usd;
  }
  const all = charges();
  const reservedFor = Object.fromEntries(all.filter((c) => c.against !== undefined).map((c) => [c.against!, sessionReceipts(c.case, c.against!)]));
  return spentBySitting(receipts, all, reservedFor);
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
  name: CaseName; // its directory under the run's root
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
  return { name, sitting: CASE_SITTING[name], root, config, repo, userData, engineIds: seedTranscripts(config, repo, titles) };
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
  reservations: Map<string, Charge>; // each launched session's `--max-budget-usd`, reserved until closeLive settles it
  ownerPluginsSeen: string[];
  a15Breaches: string[]; // every A-15 reading's breach (a key of the run's own appearing or vanishing), asserted at the end
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
    ids: [], pids: new Set([maws.app.process().pid!]), started: [], reservations: new Map(), ownerPluginsSeen: [], a15Breaches: [],
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
// fresh or resuming `resume` in place, with what its sitting and the run leave (the smaller) as its budget, less
// `reserve`, what the case holds back for paid calls the session's own budget does not bound; the budget reserved
// before the launch (closeLive settles it); waits for `ready`.
async function launchSession(live: Live, label: string, id: AppSessionId, opts: { resume?: string; reserve?: { usd: number; for: string } } = {}): Promise<void> {
  const budget = budgetFor(live.sc.sitting);
  const reserved = opts.reserve?.usd ?? 0;
  const remaining = Number((budget.usd - reserved).toFixed(4));
  const refusal = budgetRefusal(budget, CAP, opts.reserve ? { usd: reserved + 0.01, for: `${opts.reserve.for} and at least US$0.01 for ${label}` } : undefined);
  if (refusal !== null) {
    live.note(`${label}: ${refusal}`);
    test.skip(true, refusal);
  }
  const reservation = launchReservation(live.sc.name, id, label, remaining);
  charge(live.note, reservation);
  live.reservations.set(id, reservation);
  const spec = { ...launchDefaults(id, live.sc.repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: remaining, ...(opts.resume ? { resume: { sessionId: opts.resume as SessionId, fork: false } } : {}) };
  expect(value(await invoke(live.page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
  live.started.push({ label, id });
  await expect.poll(async () => (await statusOf(live, id)).process, { timeout: 120_000 }).toBe('ready');
  const status = await statusOf(live, id);
  if (status.pid !== null) live.pids.add(status.pid);
  live.note(`${label} ${id}: launched on Haiku, default mode, maxBudgetUsd ${remaining.toFixed(4)} (the smaller of what ${live.sc.sitting.toUpperCase()} and the run leave${opts.reserve ? `, less US$${reserved.toFixed(4)} held back for ${opts.reserve.for}` : ''})${opts.resume ? `, resuming ${opts.resume} in place` : ''}; pid ${status.pid}`);
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
// pane, or the Side pane for a thread), or C7's inline request card when `scope` is a comment card's thread (P2-E1: it
// has no `group` role), once. A request already resolved is left alone.
async function drive(live: Live, scope: Locator, id: string, what: string, until: () => Promise<boolean>, allowed: string[] = [], timeout = TURN_MS): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await until()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    const all = await events(live, id);
    const resolved = new Set(ofKind(all, 'permission.resolved').map((e) => e.requestId));
    const open = ofKind(all, 'permission.requested').filter((e) => !resolved.has(e.requestId));
    if (open.length > 0) {
      const frame = scope.getByRole('group', { name: 'Approval needed' }).or(scope.locator('[data-request-card]').filter({ hasText: 'Approval needed' })).first(); // P2-E1
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

// An A-15 reading against the case's first: its line logged and any breach kept for closeLive's assertion, so a
// breach seen after a session fails the case even when a later reading no longer shows it.
function readA15(live: Live, label: string): void {
  const now = a15Reading();
  live.note(`  ${a15Line(label, live.a15First, now, [ROOT])}`);
  const { breach } = compareA15(live.a15First.keys, now.keys, [ROOT]);
  if (breach.length > 0) live.a15Breaches.push(`${label}: ${JSON.stringify(breach)}`);
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
  readA15(live, `after ${label}`);
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

// The case's end: every session still running stopped, the app closed, the A-15 reading after it, every launch budget
// settled to its session's receipts once no process of the case is left (kept whole for a prompt gone unreceipted), no
// breach in any of the case's readings (no key of the run's own), the owner plugins none, and no process of the app or
// its engines left.
// Every step runs whatever an earlier one threw (a session that would not stop, the app's cleanup rejecting): the
// survivor scan, its SIGKILL fallback and the checks still run, and the errors are rethrown after them (settleAll).
async function closeLive(live: Live): Promise<void> {
  let survivors: number[] = [];
  let naming: ReturnType<typeof processesNaming> = [];
  const failed = (what: string) => (error: unknown) => {
    live.note(`  ${what}: ${String(error)}`);
    throw error;
  };
  await settleAll([
    ...[...live.started].reverse().map(({ label, id }) => () => stopSession(live, label, id).catch(failed(`${label} ${id} could not be stopped`))),
    () => {
      for (const pid of descendants(live.maws.app.process().pid!)) live.pids.add(pid); // the app's helpers and hosts
    },
    () => live.maws.cleanup().catch(failed('the app’s cleanup failed')),
    () => readA15(live, 'after the app closed'),
    () => {
      survivors = [...live.pids].filter((pid) => isAlive(pid) && /claude|Electron|MAWS/.test(ps(pid, 'command')));
      naming = processesNaming(live.sc.root);
      live.note(`survivor check: ${survivors.length === 0 && naming.length === 0 ? `none of ${live.pids.size} recorded pids (${[...live.pids].join(', ')}) and no process naming ${live.sc.root}` : `SURVIVORS ${JSON.stringify(survivors.map((pid) => `${pid} ${ps(pid, 'command')}`))} ${JSON.stringify(naming)}`}; maws-supervisor processes: ${execFileSync('/bin/sh', ['-c', 'pgrep -fl maws-supervisor || true'], { encoding: 'utf8' }).trim() || 'none'}`);
    },
    () => {
      for (const pid of survivors) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // gone since the scan
        }
      }
    },
    ...[...live.reservations].map(([id, reserved]) => () => {
      charge(live.note, settledReservation(reserved, sessionRows(live, id)));
      live.reservations.delete(id);
    }),
    () => live.note(`spend: the case's profile ${journalSpend(live.sc.userData).usd.toFixed(4)}; ${spendLine(live.sc.sitting)}`),
    () => expect(live.a15Breaches, 'no project of the run’s scratch appeared in or vanished from the owner file at any reading (A-15)').toEqual([]),
    () => expect(live.ownerPluginsSeen, 'the engines loaded none of the owner’s plugins (Decision Log 22, 30)').toEqual([]),
    () => expect(survivors, 'no process of the app or its engines outlives the case').toEqual([]),
    () => expect(naming, 'no process names the case’s scratch').toEqual([]),
  ]);
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
    await launchSession(live, 'parent', parent, { resume: sc.engineIds[0], reserve: { usd: FORK_ALLOCATION_USD + BTW_RESERVATION_USD, for: 'the side thread’s allocation and the side question’s reservation' } });
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

  // A pick in the viewer through the pick overlay: the comment card beside the element, on its `artifact-element` anchor
  // (P2-E1: the card keeps the sheet's accessible names, so the form's locators are the sheet's).
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
    const card = viewer.locator('[data-comment-card]');
    await expect(card).toHaveAttribute('data-card-phase', 'composing');
    await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-element');
    await expect(card).toHaveAttribute('data-anchor-locator', '#title');
    await expect(l.page.locator('[data-comment-composer]'), 'no sheet').toHaveCount(0);
    return card;
  }

  // The side thread of this sitting's parent, once the app lists it.
  const sideThreadOf = async (l: Live) => (value(await invoke(l.page, 'session.list', {})).sessions.find((r) => r.lineage?.kind === 'side-thread' && r.lineage.parentAppSessionId === parent)?.appId ?? '') as AppSessionId;
  const forkReceipted = (l: Live, child: string) => chargeOf(sessionRows(l, child), FORK_ALLOCATION_USD).receipted;

  test('2 a comment picked on the artifact goes to a Side thread that lives in the card: it edits the page and updates the parent’s artifact (its permissions answered in the card), answers there and sums itself up in the parent; the parent’s turns unchanged', async () => {
    const l = live!;
    refuseOverCap(note, 'S3 case 2', 's3', { usd: FORK_ALLOCATION_USD, for: 'the side thread’s allocation (a fork takes no --max-budget-usd: Q12)' });
    test.skip(artifact === null, 'case 1 recorded no artifact');
    const turnsBefore = mainTurnsEnded(await events(l, parent)).length;
    const usersBefore = outUsers(sessionRows(l, parent)).length;
    const card = await pickTitle(l);
    await expect(card.getByRole('radio', { name: /Side thread/ })).toBeChecked();
    await card.getByRole('textbox', { name: 'Comment' }).fill(PROMPTS.thread);
    const recordFile = join(l.sc.userData, 'deliverables', parent, `${artifact!.deliverableId}.json`);
    const versionsOf = () => (JSON.parse(readFileSync(recordFile, 'utf8')) as { versions: { path: string }[] }).versions;
    const versionsBefore = versionsOf().length;
    // the thread's allocation charged before it can spend, settled once it has stopped
    charge(note, { key: 's3-fork', case: 's3', label: 'the side thread’s allocation (reserved until its journal settles it)', usd: FORK_ALLOCATION_USD });
    await card.getByRole('button', { name: 'Send' }).click();

    let child = '' as AppSessionId;
    let passed = false; // its checks held; PASS is logged only once its spend has settled within the allocation
    let overspend: string | null = null;
    try {
      // the card stays and becomes the thread (P2-E1): no Side pane, the Deliverables tab still selected
      await expect(card).toHaveAttribute('data-card-phase', 'thread', { timeout: 60_000 });
      await expect.poll(async () => (child = await sideThreadOf(l)), { timeout: 60_000 }).not.toBe('');
      l.started.push({ label: 'side thread', id: child });
      const record = value(await invoke(l.page, 'session.get', { appSessionId: child }));
      const anchor = record?.lineage?.anchor;
      expect(record?.lineage).toMatchObject({ kind: 'side-thread', parentAppSessionId: parent, openedBy: 'comment', anchor: { kind: 'artifact-element', locator: '#title' } });
      await expect(card.locator(`[data-card-thread="${child}"]`), 'the card draws the thread').toBeVisible();
      await expect(card.locator('[data-chip="anchor"]').first(), 'the comment under its anchor chip').toHaveAttribute('data-anchor-kind', 'artifact-element');
      await expect(l.panel.locator(`[data-side-thread-view="${child}"]`), 'no Side pane on the thread').toHaveCount(0);
      await expect(l.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Deliverables/ })).toHaveAttribute('aria-selected', 'true');

      const row = l.page.locator(`[data-region="main"] [data-side-thread="${child}"]`);
      const allowed: string[] = [];
      // the thread's turn, or its receipts reaching its allocation, whichever comes first
      const done = async () => mainTurnsEnded(await events(l, child)).length > 0 && (await idleNow(l, child));
      await drive(l, card, child, 'the thread’s turn', async () => forkReceipted(l, child) >= FORK_ALLOCATION_USD || (await done()), allowed);
      if (!(await done())) throw new Error(`the side thread reached its US$${FORK_ALLOCATION_USD.toFixed(2)} allocation (receipted US$${forkReceipted(l, child).toFixed(4)}) before its turn ended; stopped`);
      const status = await statusOf(l, child);
      if (status.pid !== null) l.pids.add(status.pid);
      const reply = mainTurnsEnded(await events(l, child)).at(-1)?.resultText ?? '';
      await expect(row).toHaveAttribute('data-state', 'finished', { timeout: 30_000 });
      const summary = (await row.textContent())?.trim() ?? '';
      const turnsAfter = mainTurnsEnded(await events(l, parent)).length;
      const usersAfter = outUsers(sessionRows(l, parent)).length;
      // the thread's artifact_update wrote the parent's record's next version (P2-E1 G4), none under the thread
      const threadRows = sessionRows(l, child);
      const update = mcpCalls(threadRows).find((c) => c.name === 'artifact_update');
      const answer = update ? mcpResultOf(threadRows, update.requestId) : null;
      const updated = answer ? (JSON.parse((answer.content.find((b) => b.type === 'text') as { text: string }).text) as Record<string, unknown>) : null;
      const versions = versionsOf();
      const latest = versions.length > 0 ? readFileSync(versions.at(-1)!.path, 'utf8') : '';
      const viewer = viewerOf(l.panel);
      note(`case 2: thread ${child} (lineage ${JSON.stringify({ kind: record?.lineage?.kind, openedBy: record?.lineage?.openedBy, anchor: { kind: anchor?.kind, locator: anchor?.locator, label: anchor?.label } })}); its maws calls ${JSON.stringify(mcpCalls(threadRows).map((c) => [c.name, c.args]))}; artifact_update answered ${JSON.stringify(updated)}; the parent's record ${versionsBefore} → ${versions.length} versions, the latest's title ${JSON.stringify(/<h1[^>]*>([^<]*)</.exec(latest)?.[1] ?? null)}; deliverables under the thread: ${existsSync(join(l.sc.userData, 'deliverables', child)) ? 'SOME' : 'none'}; the viewer at v${await viewer.getAttribute('data-version')}; its reply ${JSON.stringify(reply)}; permissions allowed in the card ${JSON.stringify(allowed)}; the parent's row ${JSON.stringify(summary)}; the parent's turns ${turnsBefore} → ${turnsAfter}, its written prompts ${usersBefore} → ${usersAfter}; no --max-budget-usd on the fork (Q12): bounded by the test's US$${FORK_ALLOCATION_USD.toFixed(2)} allocation`);
      expect(reply).toContain('ANCHORED');
      await expect(card.locator('[data-kind="assistant_text"]').filter({ hasText: 'ANCHORED' }), 'the thread’s reply in the card').not.toHaveCount(0);
      expect(summary).toContain('ANCHORED');
      expect(updated, 'artifact_update wrote the parent’s artifact').toMatchObject({ status: 'updated', id: 'p1-page', deliverableId: artifact!.deliverableId, version: versionsBefore + 1, ownerAppSessionId: parent });
      expect(versions, 'the parent’s record one version longer').toHaveLength(versionsBefore + 1);
      expect(latest).toContain('P1 live page, commented');
      expect(existsSync(join(l.sc.userData, 'deliverables', child)), 'no deliverable under the thread').toBe(false);
      await expect(viewer, 'the viewer on the latest moved to the new version').toHaveAttribute('data-version', String(versionsBefore + 1));
      await expect(card, 'the card still open on its thread').toHaveAttribute('data-card-phase', 'thread');
      expect(turnsAfter, 'the parent ran no turn').toBe(turnsBefore);
      expect(usersAfter, 'the main conversation received nothing').toBe(usersBefore);
      await shoot(l, '6', 'side-thread-card');
      passed = true;
    } finally {
      // the thread stopped through the app, then charged what it spent: its receipts, or its whole allocation when a
      // prompt went unreceipted; a thread never listed keeps the whole allocation
      if (child === '') child = await sideThreadOf(l).catch(() => '' as AppSessionId);
      if (child === '') note('  the side thread was never listed: its whole allocation stays charged');
      else {
        try {
          await stopSession(l, 'side thread', child);
        } finally {
          const cost = chargeOf(sessionRows(l, child), FORK_ALLOCATION_USD);
          charge(note, {
            key: 's3-fork',
            case: 's3',
            label: cost.settled
              ? `the side thread beyond its receipts (its journal shows US$${cost.receipted.toFixed(4)}, counted there)`
              : `the side thread: a prompt went unreceipted, so its whole allocation (its journal shows US$${cost.receipted.toFixed(4)}, counted there; charged up to US$${cost.usd.toFixed(4)} in all)`,
            usd: Number((cost.usd - cost.receipted).toFixed(4)),
          });
          // the uncapped fork's turn may pass its allocation before a receipt shows it: named, and the case failed
          overspend = forkOverspend(cost.receipted, FORK_ALLOCATION_USD);
          if (overspend !== null) note(`case 2: finding: ${overspend}`);
          expect.soft(overspend, `the side thread's receipts within its US$${FORK_ALLOCATION_USD.toFixed(2)} allocation (spend)`).toBeNull();
        }
      }
      if (passed && overspend === null) note('case 2: PASS');
    }
  });

  test('3 Send to main: a comment sent mid-turn steers the parent at its next tool boundary, drawn as the anchored prompt row', async () => {
    const l = live!;
    test.skip(artifact === null, 'case 1 recorded no artifact');
    // the parent's process keeps the budget it launched with, reserved since its launch (counted beyond its receipts),
    // so what it may still spend is already in the sitting's spend: refused only once S3 or the run is spent (case 2's
    // thread overspending its allocation, say)
    refuseOverCap(note, 'S3 case 3', 's3');
    const launched = l.reservations.get(parent)?.usd ?? 0;
    note(`case 3: the parent may spend up to US$${Math.max(0, launched - chargeOf(sessionRows(l, parent), 0).receipted).toFixed(4)} more under its launch budget US$${launched.toFixed(4)} (reserved); ${spendLine('s3')}`);
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
    const sheet = await pickTitle(l); // the card's composer half (P2-E1), with the sheet's names
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
    note(`case 3: the card's Send to main caption ${JSON.stringify(caption)}; sent ${Math.round((Date.now() - sentAt) / 1000)} s before the turn ended; the written prompt ${steer ? `priority ${JSON.stringify(steer.priority ?? null)}` : 'MISSING'}; permissions allowed ${JSON.stringify(allowed)}; reply ${JSON.stringify(reply)}`);
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

const S6_TITLE = 'E11 S6: the resumed session';

test('S6 8: ten row Resumes in the app, each in a fresh launch, each bounded 30 s to first output; a stall recorded with its capture', async () => {
  const note = sittingLog(OUT, 's6');
  await relayGate(note, 'S6 case 8');
  refuseOverCap(note, 'S6 case 8', 's6');
  const sc = caseScratch('s6', [S6_TITLE]);
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
      // the session's journal files, one per launch; this resume's are those created since `before`
      const dir = join(sc.userData, 'engine-host', 'journal', id);
      const journals = () => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.jsonl')) : []);
      const before = journals();
      // the project's expansion retried: a click landing while a fresh launch's tree re-renders can be lost (S6's first
      // run, 2026-10-08; supervisor.spec.ts's rowOf retries the same way)
      let row: Locator | null = null;
      await expect(async () => {
        row = await sidebarRow(live.page, { appSessionId: id });
        await expect(row).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await row!.click({ button: 'right' });
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
      const since = Object.fromEntries(journals().filter((name) => !before.includes(name)).map((name) => [name, journal(join(dir, name))]));
      const spawned = rows.find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'spawn');
      const first = rows.find((r) => r.direction === 'in' || r.direction === 'stderr');
      const firstOutputMs = spawned && first ? Date.parse(first.at) - Date.parse(spawned.at) : null;
      const noOutput = resumeNoOutput(since, before);
      const launches = Object.keys(since).length;
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

// S6's terminal half: ten `claude -p --resume` of case 8's session from a terminal under its scratch home (scratch-env.ts's
// terminalEnvironment through terminalEnv: the runner's CLAUDE* variables dropped, the relay, the scratch config home),
// in its repository, each with what S6 and the run leave as its `--max-budget-usd`, reserved in `charges.jsonl` before
// the call and settled to the call's receipt (kept whole when no result came). First output (any byte on stdout) is
// bounded 30 s: a stall is captured (ps with the engine's children, `security` among them if it is the Keychain lookup
// the C3 row suspects; lsof; `sample`) and the call is given 90 s more before it is killed. Run after case 8 in the
// same run root (MAWS_P1_LIVE_STAMP), whose scratch it reuses.
const TERMINAL_RESUME_MS = 120_000;

test('S6 8t: ten terminal resumes of the same session, each bounded 30 s to first output; a stall recorded with its capture', async () => {
  const note = sittingLog(OUT, 's6');
  const root = join(ROOT, 's6');
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  const projects = join(config, 'projects', existsSync(repo) ? realpathSync(repo).replace(/[^a-zA-Z0-9]/g, '-') : '-');
  // case 8's session: the transcript seeded under its title (the file the engine resumes in place)
  const seeded = existsSync(projects) ? readdirSync(projects).filter((n) => n.endsWith('.jsonl') && readFileSync(join(projects, n), 'utf8').split('\n', 1)[0]!.includes(S6_TITLE)) : [];
  if (seeded.length !== 1) {
    note(`S6 8t: not run: case 8's scratch ${root} holds ${seeded.length} transcripts seeded as "${S6_TITLE}" (run case 8 first under the same MAWS_P1_LIVE_STAMP)`);
    test.skip(true, 'S6 8t needs case 8’s scratch');
  }
  await relayGate(note, 'S6 8t');
  refuseOverCap(note, 'S6 8t', 's6');
  const sessionId = seeded[0]!.replace(/\.jsonl$/, '');
  const { bin, version } = theEngine();
  const env = terminalEnv(config);
  const a15 = a15Reading();
  const breaches: string[] = [];
  const owners: string[] = [];
  note(`==== S6 8t, ${new Date().toISOString()}; ten terminal resumes of ${sessionId} in ${repo}; ${bin.replace(homedir(), '~')} (${version}) through the relay ${env.ANTHROPIC_BASE_URL}, Haiku; the environment's CLAUDE* variables ${JSON.stringify(Object.keys(env).filter((k) => k.startsWith('CLAUDE')).sort())}; spent so far ${spendLine('s6')}`);
  note(a15Line('before S6 8t', a15, a15, [ROOT]));

  const results: { i: number; ok: boolean; firstOutputMs: number | null; result: string | null; costUsd: number | null }[] = [];
  const pids: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const budget = budgetFor('s6');
    const refusal = budgetRefusal(budget, CAP);
    if (refusal !== null) {
      note(`terminal resume ${i}: ${refusal}`);
      break;
    }
    const key = `s6:terminal-resume:${i}`;
    const reserved = budget.usd;
    charge(note, { key, case: 's6', label: `terminal resume ${i}'s --max-budget-usd`, usd: reserved });
    const args = ['-p', '--resume', sessionId, '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--max-budget-usd', reserved.toFixed(4), 'Reply OK'];
    const t0 = Date.now();
    const child = spawn(bin, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    pids.push(child.pid!);
    let out = '';
    let firstOutputMs: number | null = null;
    child.stdout.on('data', (chunk: Buffer) => {
      firstOutputMs ??= Date.now() - t0;
      out += String(chunk);
    });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => (err += String(chunk)));
    const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
    let captured: string | null = null;
    const stallTimer = setTimeout(() => {
      if (firstOutputMs !== null || child.exitCode !== null) return;
      captured = join(root, 'stalls', `terminal-resume-${i}-${child.pid}`);
      captureStall(captured, child.pid!);
    }, FIRST_OUTPUT_MS);
    const killTimer = setTimeout(() => child.kill('SIGKILL'), TERMINAL_RESUME_MS);
    const code = await exited;
    clearTimeout(stallTimer);
    clearTimeout(killTimer);
    const frames = out.split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    const init = frames.find((f) => f.type === 'system' && f.subtype === 'init') as { session_id?: string; model?: string; plugins?: { name: string; source: string; path?: string }[] } | undefined;
    const result = frames.findLast((f) => f.type === 'result') as { subtype?: string; result?: string; total_cost_usd?: number; session_id?: string } | undefined;
    const costUsd = typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null;
    charge(note, costUsd === null
      ? { key, case: 's6', label: `terminal resume ${i}'s --max-budget-usd, kept whole: no result came`, usd: reserved }
      : { key, case: 's6', label: `terminal resume ${i}, settled to its receipt`, usd: costUsd });
    const plugins = init?.plugins ?? [];
    owners.push(...ownerPlugins(plugins, [ROOT]));
    const ok = firstOutputMs !== null && firstOutputMs <= FIRST_OUTPUT_MS && result?.subtype === 'success';
    results.push({ i, ok, firstOutputMs, result: result?.result ?? null, costUsd });
    note(`terminal resume ${i}: ${ok ? 'ok' : 'STALL'}: first output ${firstOutputMs ?? '—'} ms after spawn, exit ${code} after ${Date.now() - t0} ms, pid ${child.pid}; init session ${init?.session_id ?? '—'} model ${init?.model ?? '—'} plugins ${JSON.stringify(plugins.map((p) => p.source))}; result ${result?.subtype ?? 'none'} ${JSON.stringify(result?.result ?? null)} US$${costUsd?.toFixed(4) ?? '—'}${err.trim() ? `; stderr ${JSON.stringify(err.trim().slice(0, 300))}` : ''}${captured ? `; captured under ${captured}` : ''}`);
  }
  const a15After = a15Reading();
  note(a15Line('after S6 8t', a15, a15After, [ROOT]));
  const { breach } = compareA15(a15.keys, a15After.keys, [ROOT]);
  if (breach.length > 0) breaches.push(JSON.stringify(breach));
  const survivors = pids.filter(isAlive);
  note(`S6 8t: ${results.length} terminal resumes, ${results.filter((r) => !r.ok).length} stalls; survivor check: ${survivors.length === 0 ? `none of the ${pids.length} engine pids (${pids.join(', ')})` : `SURVIVORS ${JSON.stringify(survivors)}`}; spend ${spendLine('s6')}`);
  for (const pid of survivors) process.kill(pid, 'SIGKILL');
  for (const r of results) expect.soft(r.ok, `terminal resume ${r.i} reached first output within ${FIRST_OUTPUT_MS / 1000} s and a result`).toBe(true);
  expect(owners, 'the engines loaded none of the owner’s plugins').toEqual([]);
  expect(breaches, 'no project of the run’s scratch appeared in or vanished from the owner file (A-15)').toEqual([]);
  expect(survivors, 'no terminal engine outlives its call').toEqual([]);
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

// ---- S2: agents between sessions (E7's residue, A-32) ------------------------------------------------------------------------
//
// S2(b) the listing's Message (relay.ts's 'message' wording) from session A to session B, both MAWS sessions under one scratch
// home, sent from the composer under B's row of A's ListAgents listing; S2(c) a MAWS session's SendMessage into an
// interactive terminal `claude` (ptyEngine, Haiku) under the same home, the terminal's transcript exported redacted for the
// backfill's fixture and its peer record's form recorded; S2(d) one attempt at a team in an interactive terminal under
// CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (SPEC 39 forms one only there; Decision Log 6). A terminal session takes no budget
// flag: its allocation is charged before it starts, it is ended at three minutes or once the bound on its transcript's spend
// (terminalUsdBound, an upper bound) passes that allocation, and the charge settles to its transcript's own cost record (the
// `cost-state` the engine writes at exit; else what /cost printed, else the scratch home's `lastCost`; else the whole
// allocation). Its plugins: a terminal writes
// no `system/init`, so the list is read from the scratch home's own plugin state and the terminal's CLAUDE* variables
// (Decision Log 30). Run on their own:
//   MAWS_P1_LIVE=1 MAWS_P1_LIVE_MAX_USD=<what S2 has left> pnpm exec playwright test e2e/p1-live.spec.ts -g 'S2'

const S2_TEXT = { b: 'E11 S2b: hello from A through the listing. No reply needed.', c: 'E11 S2c: hello from a MAWS session. No reply needed.' } as const;
const S2_PROMPTS = {
  ready: 'Reply with exactly READY.',
  list: 'Call the ListAgents tool (load it with ToolSearch first if needed) and reply with its listing verbatim, nothing else.',
  toTerminal: `Call the ListAgents tool (load it with ToolSearch first if needed). Then use the SendMessage tool (load it the same way) to send the one session listed under "Peer sessions", by the name the listing gives it, exactly this message: "${S2_TEXT.c}". Then reply SENT.`,
  // E7's team prompt (spikes/protocol-probe/scenarios/pass3/e7-team.mjs), verbatim, and its second listing
  team: 'Spawn a general-purpose Agent named "scout" in the background, model haiku: read one.txt and reply. Then call ListAgents (find it with ToolSearch) and reply with the listing.',
  teamList: 'Call ListAgents again and reply with the listing verbatim.',
} as const;
const S2B_B_USD = 0.06; // B's launch budget in S2(b), held back from A's (A lists and sends; B answers READY and the message)
const S2C_TERMINAL_USD = 0.1; // the terminal's allocation in S2(c); the MAWS session launches with what is left
const TERMINAL_WALL_MS = 180_000;

type TranscriptRecord = Record<string, unknown> & {
  type?: string; timestamp?: string; isMeta?: boolean; promptSource?: unknown; turnOrigin?: unknown; origin?: { kind?: string };
  attachment?: { type?: string; origin?: { kind?: string }; isMeta?: boolean; prompt?: string };
  message?: { content?: unknown; stop_reason?: string };
};
type Block = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; text?: string };

const parseLines = (text: string): TranscriptRecord[] =>
  text.split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as TranscriptRecord];
    } catch {
      return []; // a line still being written
    }
  });
const readRecords = (file: string): TranscriptRecord[] => (existsSync(file) ? parseLines(readFileSync(file, 'utf8')) : []);
// Every record of every transcript under `dir` (the session's own and its agents' under `<id>/subagents/`).
const recordsUnder = (dir: string): TranscriptRecord[] =>
  existsSync(dir) ? (readdirSync(dir, { recursive: true }) as string[]).filter((name) => name.endsWith('.jsonl')).flatMap((name) => readRecords(join(dir, name))) : [];
const blocksOf = (r: TranscriptRecord): Block[] => (Array.isArray(r.message?.content) ? (r.message.content as Block[]) : []);
const contentText = (content: unknown): string => (typeof content === 'string' ? content : Array.isArray(content) ? (content as Block[]).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('\n') : '');
const turnEndedSince = (records: TranscriptRecord[], sinceMs: number) => records.some((r) => r.type === 'assistant' && Date.parse(r.timestamp ?? '') > sinceMs && r.message?.stop_reason === 'end_turn');

// A message from another session in a transcript: an idle one's `user` record of the peer origin, a mid-turn one's
// `queued_command` attachment of that origin.
const peerRecords = (records: TranscriptRecord[]) =>
  records.filter((r) => (r.type === 'user' && r.origin?.kind === 'peer') || (r.type === 'attachment' && r.attachment?.type === 'queued_command' && r.attachment.origin?.kind === 'peer'));
// A tool's uses in a transcript, each with its result's text once written.
function toolPairs(records: TranscriptRecord[], name: string): { input: unknown; result: string | null }[] {
  const uses = records.filter((r) => r.type === 'assistant').flatMap(blocksOf).filter((b) => b.type === 'tool_use' && b.name === name);
  const results = records.filter((r) => r.type === 'user').flatMap(blocksOf).filter((b) => b.type === 'tool_result');
  return uses.map((u) => {
    const res = results.find((b) => b.tool_use_id === u.id);
    return { input: u.input, result: res === undefined ? null : contentText(res.content) };
  });
}

interface Terminal {
  pty: PtyEngine;
  cwd: string;
  started: number;
  projectDir: string;
  allocation: number;
  chargeKey: string;
  pids: Set<number>;
  ended: string | null; // why the watchdog ended it, or null
  approvals: number; // the terminal's own permission prompts answered with their default (Yes)
  bound: number;
  watchdog: NodeJS.Timeout | null;
}

// An interactive `claude` on Haiku in `cwd` under the case's scratch home (W-E's ptyEngine: the runner's CLAUDE* variables
// dropped, the relay, `env` last), its allocation charged first; a watchdog every two seconds bounds its spend and its wall
// time, answers the terminal's own permission prompt with its default, and keeps the pids under it for the survivor check.
async function openTerminal(sc: CaseScratch, note: (line: string) => void, cwd: string, allocation: number, env: Record<string, string> = {}): Promise<Terminal> {
  const chargeKey = `${sc.name}:terminal`;
  charge(note, { key: chargeKey, case: sc.name, label: 'the terminal session’s allocation (it takes no --max-budget-usd)', usd: allocation });
  const started = Date.now();
  const pty = await ptyEngine(sc.config, cwd, [], join(sc.root, 'terminal-screen.txt'), { model: 'haiku', env });
  const projectDir = join(sc.config, 'projects', realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
  const t: Terminal = { pty, cwd, started, projectDir, allocation, chargeKey, pids: new Set([pty.pid]), ended: null, approvals: 0, bound: 0, watchdog: null };
  const vars = Object.keys(terminalEnv(sc.config, env)).filter((k) => k.startsWith('CLAUDE')).sort();
  note(`terminal: pid ${pty.pid}, ${ENGINE_BIN.replace(homedir(), '~')} --model haiku in ${cwd}; its CLAUDE* variables ${JSON.stringify(vars)}; allocation US$${allocation.toFixed(4)}, ended at ${TERMINAL_WALL_MS / 60_000} min or once its spend's bound passes the allocation`);
  t.watchdog = setInterval(() => {
    for (const pid of descendants(pty.pid)) t.pids.add(pid);
    t.bound = terminalUsdBound(recordsUnder(projectDir), started - 1_000);
    const prompts = (pty.screen().match(/Do you want to proceed\?/g) ?? []).length;
    if (prompts > t.approvals && isAlive(pty.pid)) {
      t.approvals = prompts;
      note(`terminal: its permission prompt ${prompts} answered with the default (Yes): ${JSON.stringify(pty.screen().slice(-600))}`);
      pty.say('').catch(() => {}); // Enter: the prompt's first option
    }
    const why = Date.now() - started > TERMINAL_WALL_MS ? 'three minutes passed' : t.bound > allocation ? `its spend's bound US$${t.bound.toFixed(4)} passed the allocation` : null;
    if (why !== null && t.ended === null && isAlive(pty.pid)) {
      t.ended = why;
      note(`terminal: ENDED by the watchdog: ${why}`);
      for (const pid of [...t.pids].reverse()) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // gone
        }
      }
    }
  }, 2_000);
  return t;
}

// The terminal's end: /cost read off its screen, /exit, every pid under it gone (SIGKILL for a survivor), its charge settled
// to the engine's own figure, and what it loaded read from the scratch home (a terminal writes no `system/init`).
async function closeTerminal(sc: CaseScratch, note: (line: string) => void, t: Terminal): Promise<{ costUsd: number | null; survivors: string[] }> {
  if (t.watchdog !== null) clearInterval(t.watchdog);
  for (const pid of descendants(t.pty.pid)) t.pids.add(pid);
  t.bound = terminalUsdBound(recordsUnder(t.projectDir), t.started - 1_000);
  let shown: number | null = null;
  if (isAlive(t.pty.pid) && t.ended === null) {
    await t.pty.say('/cost');
    for (const until = Date.now() + 10_000; Date.now() < until && costShown(t.pty.screen()) === null; ) await new Promise((r) => setTimeout(r, 250));
    shown = costShown(t.pty.screen());
  }
  await t.pty.exit();
  await new Promise((r) => setTimeout(r, 1_000));
  const state = JSON.parse(readFileSync(join(sc.config, '.claude.json'), 'utf8')) as { projects?: Record<string, { lastCost?: number }> };
  const lastCost = state.projects?.[realpathSync(t.cwd)]?.lastCost ?? state.projects?.[t.cwd]?.lastCost ?? null;
  let recorded: number | null = null;
  try {
    recorded = costRecorded(readRecords(transcriptFile(sc.config, t.cwd, t.pty.sessionId())));
  } catch {
    // no transcript: the terminal never took a prompt
  }
  const costUsd = recorded ?? shown ?? lastCost;
  const source = recorded !== null ? 'its transcript’s cost-state' : shown !== null ? '/cost’s figure' : 'the scratch home’s lastCost';
  charge(note, {
    key: t.chargeKey,
    case: sc.name,
    label: costUsd === null ? 'the terminal session’s allocation, kept whole: neither its transcript, /cost nor the home’s lastCost showed its spend' : `the terminal session, settled to ${source}`,
    usd: costUsd ?? t.allocation,
  });
  const survivors: string[] = [];
  for (const pid of t.pids) {
    if (!isAlive(pid)) continue;
    survivors.push(`${pid} ${ps(pid, 'command')}`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone since
    }
  }
  const plugins = join(sc.config, 'plugins');
  const settings = JSON.parse(readFileSync(join(sc.config, 'settings.json'), 'utf8')) as { enabledPlugins?: unknown };
  note(`terminal: its transcript's cost-state ${recorded === null ? 'none' : `US$${recorded.toFixed(4)}`}; /cost ${shown === null ? 'showed no total' : `US$${shown.toFixed(4)}`}; the scratch home's lastCost ${lastCost === null ? 'none' : `US$${lastCost.toFixed(4)}`}; the transcript's spend bound US$${t.bound.toFixed(4)} (Haiku 4.5 list rates, an upper bound); ${t.ended === null ? 'exited by /exit' : `ended by the watchdog (${t.ended})`}; ${Math.round((Date.now() - t.started) / 1000)} s; permission prompts answered ${t.approvals}`);
  note(`terminal plugins (no system/init in a terminal; Decision Log 30): the scratch home's plugins/ ${existsSync(plugins) ? JSON.stringify(readdirSync(plugins, { recursive: true })) : 'absent'}, settings.json enabledPlugins ${JSON.stringify(settings.enabledPlugins ?? null)}`);
  note(`terminal survivor check: ${survivors.length === 0 ? `none of ${t.pids.size} pids (${[...t.pids].join(', ')})` : `SURVIVORS ${JSON.stringify(survivors)}`}; ${spendLine(sc.sitting)}`);
  return { costUsd, survivors };
}

// A transcript copied redacted (the live harness's redaction) to `<case>/exports/<name>.jsonl` for the sitting to admit.
function exportRedacted(sc: CaseScratch, file: string, name: string): string {
  const dir = join(sc.root, 'exports');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${name}.jsonl`);
  writeFileSync(dest, redactJournal(readFileSync(file, 'utf8')));
  return dest;
}

// The owner file after a case without the app, against its first reading; a key of the run's own appearing or vanishing fails it.
function readA15Terminal(note: (line: string) => void, first: A15Reading): void {
  const now = a15Reading();
  note(a15Line('after the case', first, now, [ROOT]));
  expect(compareA15(first.keys, now.keys, [ROOT]).breach, 'no project of the run’s scratch in the owner file (A-15)').toEqual([]);
}

test.describe('S2: agents between sessions and a team (E7’s residue)', () => {
  test('S2(b) the listing’s Message: A’s composer under B’s row sends relay.ts’s wording; B shows the message from another session, A’s line reads sent', async () => {
    const note = sittingLog(OUT, 's2b');
    await relayGate(note, 'S2(b)');
    refuseOverCap(note, 'S2(b)', 's2b');
    const sc = caseScratch('s2b', ['E11 S2b: A', 'E11 S2b: B']);
    const a15 = a15Reading();
    opening(note, 'S2(b)', sc, a15);
    const live = await openLive(sc, note, a15);
    try {
      const [a, b] = live.ids as [AppSessionId, AppSessionId];
      // B first, so it is registered and idle when A lists; B launches with S2B_B_USD, A with the rest
      await show(sceneOf(live), b);
      await launchSession(live, 'B', b, { reserve: { usd: SITTING_CAP_USD.s2b - S2B_B_USD, for: 'session A' } });
      await sendFromComposer(live, b, S2_PROMPTS.ready);
      await drive(live, live.pane, b, 'B’s first turn', async () => mainTurnsEnded(await events(live, b)).length > 0 && (await idleNow(live, b)));
      await show(sceneOf(live), a);
      await launchSession(live, 'A', a);
      await sendFromComposer(live, a, S2_PROMPTS.list);
      await drive(live, live.pane, a, 'A’s listing', async () => mainTurnsEnded(await events(live, a)).length > 0 && (await idleNow(live, a)));
      await unfoldWork(live.pane); // the listing folds with its turn's work, as the owner opens it

      const listing = live.pane.locator('section.transcript-listing').last();
      await expect(listing).toBeVisible();
      const peers = listing.locator('.transcript-listing-section[data-section="Peer sessions"] li.transcript-listing-entry');
      const names = await peers.evaluateAll((lis) => lis.map((li) => li.getAttribute('data-name') ?? ''));
      note(`case S2(b): A's listing ${JSON.stringify((await listing.textContent())?.trim())}; peer rows ${JSON.stringify(names)}`);
      expect(names, 'one peer session listed: B').toHaveLength(1);
      const name = names[0]!;
      const row = peers.first();
      await row.getByRole('button', { name: `Message ${name}`, exact: true }).click();
      const composer = row.locator('[data-part="peer-composer"]');
      await composer.locator('textarea').fill(S2_TEXT.b);
      const promptsBefore = outUsers(sessionRows(live, a)).length;
      await composer.getByRole('button', { name: 'Send', exact: true }).click();
      const line = composer.locator('[data-part="peer-line"]');
      const lineNow = async () => {
        await row.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => {}); // the steer's turn below may scroll the column
        return ((await line.textContent({ timeout: 1_000 }).catch(() => null)) ?? '').trim();
      };
      await drive(live, live.pane, a, 'A’s line reading sent', async () => / sent it with SendMessage$/.test(await lineNow()));
      const lineText = await lineNow();
      const steer = outUsers(sessionRows(live, a)).slice(promptsBefore)[0]?.frame as { message?: { content?: unknown }; priority?: string } | undefined;
      const sends = ofKind(await events(live, a), 'tool.use').filter((e) => e.toolName === 'SendMessage' && e.agentId === null);
      note(`case S2(b): the steer A was sent ${JSON.stringify(steer)}; A's SendMessage inputs ${JSON.stringify(sends.map((e) => e.input))}; A's line ${JSON.stringify(lineText)}`);
      expect(contentText(steer?.message?.content), 'relay.ts’s message wording').toBe(relayText({ kind: 'peer', address: name, name, mode: 'message' }, S2_TEXT.b));
      expect(steer?.priority).toBe('next');
      expect(lineText).toMatch(/ sent it with SendMessage$/);

      // B: the message from another session arrives (its own peer turn) and draws as an inbound row
      let inbound: Extract<SessionEvent, { kind: 'peer.message' }> | undefined;
      await expect.poll(async () => (inbound = ofKind(await events(live, b), 'peer.message').find((e) => e.text.includes(S2_TEXT.b))) !== undefined, { timeout: 120_000, message: 'B’s peer.message' }).toBe(true);
      await show(sceneOf(live), b);
      await drive(live, live.pane, b, 'B’s peer turn', async () => idleNow(live, b));
      const shown = live.pane.locator('.transcript-peer[data-peer="inbound"]').filter({ hasText: 'E11 S2b' });
      await expect(shown, 'B’s transcript shows the message from another session').toBeVisible({ timeout: 15_000 });
      note(`case S2(b): B's peer.message ${JSON.stringify(inbound)}; B's row ${JSON.stringify((await shown.textContent())?.trim())}`);
      expect(inbound!.midTurn).toBe(false);
      note('case S2(b): PASS');
    } finally {
      await closeLive(live);
    }
  });

  test('S2(c) a MAWS session’s SendMessage into an interactive terminal session: the terminal’s transcript holds the peer record (its form recorded, the transcript exported)', async () => {
    const note = sittingLog(OUT, 's2c');
    await relayGate(note, 'S2(c)');
    refuseOverCap(note, 'S2(c)', 's2c', { usd: S2C_TERMINAL_USD + 0.01, for: 'the terminal’s allocation and at least US$0.01 for the MAWS session' });
    const sc = caseScratch('s2c', ['E11 S2c: the MAWS session']);
    const termDir = join(sc.root, 'terminal'); // its own directory: ptyEngine names its session by the newest transcript there
    mkdirSync(termDir, { recursive: true });
    writeFileSync(join(termDir, 'README.md'), 'E11 S2c terminal\n');
    const a15 = a15Reading();
    opening(note, 'S2(c)', sc, a15);
    const t = await openTerminal(sc, note, termDir, S2C_TERMINAL_USD);
    let live: Live | null = null;
    let closed: { costUsd: number | null; survivors: string[] } | null = null;
    try {
      await t.pty.say(S2_PROMPTS.ready);
      await t.pty.replied(/READY/, 120_000);
      const terminalId = t.pty.sessionId();
      const file = transcriptFile(sc.config, termDir, terminalId);
      note(`case S2(c): the terminal session ${terminalId} answered READY; its transcript ${file}`);

      live = await openLive(sc, note, a15);
      const l = live;
      const [m] = l.ids as [AppSessionId];
      await show(sceneOf(l), m);
      await launchSession(l, 'the MAWS session', m);
      await sendFromComposer(l, m, S2_PROMPTS.toTerminal);
      await drive(l, l.pane, m, 'the MAWS session’s send', async () => mainTurnsEnded(await events(l, m)).length > 0 && (await idleNow(l, m)));
      const all = await events(l, m);
      const sends = ofKind(all, 'tool.use').filter((e) => e.toolName === 'SendMessage' && e.agentId === null);
      const results = ofKind(all, 'tool.result').filter((e) => sends.some((s) => s.toolUseId === e.toolUseId));
      note(`case S2(c): the MAWS session's SendMessage ${JSON.stringify(sends.map((e) => e.input))} answered ${JSON.stringify(results)}`);
      expect(sends.some((e) => JSON.stringify(e.input).includes(S2_TEXT.c)), 'the MAWS session sent the text').toBe(true);

      // the terminal: the peer record in its transcript, then its own turn on it
      let peer: TranscriptRecord | undefined;
      await expect.poll(() => (peer = peerRecords(readRecords(file)).find((r) => JSON.stringify(r).includes('E11 S2c'))) !== undefined, { timeout: 120_000, message: 'the terminal’s transcript holds the message from another session' }).toBe(true);
      const at = Date.parse(peer!.timestamp ?? '');
      await expect.poll(() => turnEndedSince(readRecords(file), at), { timeout: 90_000 }).toBe(true).catch(() => note('case S2(c): the terminal’s turn on the message did not end within 90 s'));
      await new Promise((r) => setTimeout(r, 2_000));
      const p = peer!;
      const form = { type: p.type, isMeta: p.type === 'attachment' ? (p.attachment?.isMeta ?? null) : (p.isMeta ?? null), promptSource: p.promptSource ?? null, turnOrigin: p.turnOrigin ?? null, origin: p.origin ?? p.attachment?.origin ?? null, keys: Object.keys(p).sort() };
      note(`case S2(c): the terminal's peer record ${JSON.stringify(form)}; its content ${JSON.stringify(contentText(p.message?.content) || p.attachment?.prompt || '')}`);
      closed = await closeTerminal(sc, note, t);
      const exported = exportRedacted(sc, file, terminalId);
      note(`case S2(c): exported ${exported} (${readRecords(exported).length} records)`);
      note(`case S2(c): PASS (the peer record is ${form.isMeta === true ? 'isMeta' : 'NOT isMeta'})`);
    } finally {
      await settleAll([
        async () => {
          if (closed === null) closed = await closeTerminal(sc, note, t);
        },
        async () => {
          if (live !== null) await closeLive(live);
        },
        () => readA15Terminal(note, a15),
        () => expect(closed?.survivors ?? [], 'no process of the terminal outlives the case').toEqual([]),
      ]);
    }
  });

  test('S2(d) one teammate attempt in an interactive terminal under CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1: does ListAgents name a Teammates section', async () => {
    const note = sittingLog(OUT, 's2d');
    await relayGate(note, 'S2(d)');
    refuseOverCap(note, 'S2(d)', 's2d');
    const sc = caseScratch('s2d', [], (repo) => writeFileSync(join(repo, 'one.txt'), 'ONE\n'));
    const a15 = a15Reading();
    const { bin, version } = theEngine();
    note(`==== S2(d), ${new Date().toISOString()}; run root ${ROOT}`);
    note(`engine: ${bin.replace(homedir(), '~')} (${version}) as an interactive terminal (ptyEngine), unmodified, through ClaudeUsage's relay ${RELAY_URL}, Haiku; CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in its environment; spent so far ${spendLine('s2d')}`);
    note(`scratch: ${sc.root} (claude-config/ settings.json {} and .claude.json trusting repo/, which holds one.txt)`);
    note(a15Line('before the case', a15, a15, [ROOT]));
    const t = await openTerminal(sc, note, sc.repo, budgetFor('s2d').usd, { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' });
    let closed: { costUsd: number | null; survivors: string[] } | null = null;
    try {
      await t.pty.say(S2_PROMPTS.team);
      const answered = () => {
        try {
          return toolPairs(readRecords(transcriptFile(sc.config, sc.repo, t.pty.sessionId())), 'ListAgents').filter((p) => p.result !== null).length;
        } catch {
          return 0; // no transcript yet
        }
      };
      await expect.poll(answered, { timeout: 150_000, message: 'ListAgents answered' }).toBeGreaterThanOrEqual(1);
      const id = t.pty.sessionId();
      const file = transcriptFile(sc.config, sc.repo, id);
      const team = () => toolPairs(readRecords(file), 'ListAgents').find((p) => /^Teammates \(\d+\):/m.test(p.result ?? ''));
      if (team() === undefined && t.ended === null) {
        // E7's probe listed again once its agent had run; the same here, within the one attempt
        await expect.poll(() => turnEndedSince(readRecords(file), t.started), { timeout: 60_000 }).toBe(true).catch(() => {});
        await new Promise((r) => setTimeout(r, 15_000));
        await t.pty.say(S2_PROMPTS.teamList);
        await expect.poll(answered, { timeout: 90_000 }).toBeGreaterThanOrEqual(2).catch((error) => note(`case S2(d): the second listing: ${String(error).split('\n')[0]}`));
      }
      const pairs = toolPairs(readRecords(file), 'ListAgents');
      const agents = toolPairs(recordsUnder(t.projectDir), 'Agent');
      const formed = team();
      note(`case S2(d): session ${id}; Agent inputs ${JSON.stringify(agents.map((p) => p.input))}; ListAgents results ${JSON.stringify(pairs.map((p) => p.result))}; the scratch home's teams/ ${existsSync(join(sc.config, 'teams')) ? JSON.stringify(readdirSync(join(sc.config, 'teams'), { recursive: true })) : 'absent'}`);
      closed = await closeTerminal(sc, note, t);
      const exported = exportRedacted(sc, file, formed ? 'e7-team-terminal' : `e7-team-terminal-negative-${id}`);
      note(`case S2(d): exported ${exported}`);
      note(formed ? `case S2(d): TEAM FORMED: ${JSON.stringify(formed.result)}` : `case S2(d): NO Teammates section on ${version} (the one attempt; Decision Log 6)`);
    } finally {
      await settleAll([
        async () => {
          if (closed === null) closed = await closeTerminal(sc, note, t);
        },
        () => readA15Terminal(note, a15),
        () => expect(closed?.survivors ?? [], 'no process of the terminal outlives the case').toEqual([]),
      ]);
    }
  });
});
