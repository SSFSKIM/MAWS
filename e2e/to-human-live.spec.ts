// The to-human trial (UX wave U2b; docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, "Proof that an executor
// does not run", the second list, item 2: acceptance A15, check 5 and check 7's live half): the built app, through
// Playwright, against the installed Claude Code behind ClaudeUsage's relay, in a scratch root under /tmp holding the
// config home the engine reads and writes (`CLAUDE_CONFIG_DIR`), a trusted scratch repository and the app's profile,
// kept across a relaunch. The scratch config home holds the doperpowers, to-human and sminos plugins, installed by the
// engine's own CLI from a copy of the mod's pull request's checkout (MAWS_U2B_MOD_CHECKOUT: a worktree of the plugin's
// repository at that pull request's head, whose to-human installation carries the declaration `maws-surface.json`),
// with the to-human style selected and the mod's route on through its e2e seam (board ticket 850 turned the route off for
// every other launch), so a session MAWS starts there advertises 9 and the mod draws its view. Sessions
// start through the app's own path (a new chat and the composer's first Send; `session.start` for a resume), never
// `session.launch`, since the to-human decision lives in main's launch path. This file replaces P2-C's live run, whose
// arms read contracts MAWS no longer appends (its record stays in docs/doperpowers/evidence/p2-c).
//
// The first case, in order (a failed step stops the steps after it; each step's reading is a line of `trial.txt`):
//   setup       the plugins installed from the checkout, the style selected; the owner's files read (A-15);
//   turn 1      a thought, five shell commands, then a final message: the spawn carries 9 and `drawnBy` is `mod`; the
//               messages, the record lines and the switch are the mod's, none is MAWS's, and nothing is drawn twice; the
//               closed record line reads a summary (its stretch opens with a thought, §M); the render asks MAWS sent
//               from the first call to the turn's end (check 5's third reading);
//   turn 2      a message mid-turn, two commands, a small artifact made from the repository's invented page, a message
//               carrying a path link and a mention of the artifact, then the turn's end as a plain-text must-read
//               (`<essential>`: MAWS makes its must-read only from a finished main-thread text block,
//               shared/owner/to-human-items.ts `finishedTextOf`; the mod draws that text as a message through its
//               parser; no check-1 recording holds an `<essential>` block, so the mod's drawing of it is not verified);
//   turn 3      a listing (ListAgents), a background task's notification and a subagent's message (check 7's live half:
//               a message from another session needs sminos's hub, which a scratch home has not; the subagent's
//               message is the arrival of a peer the scratch can make, and its row is read in the window);
//   full        a thought, a listing, a notice and a turn's line hidden in the mod's report, and all in sight in its
//               full transcript, the list walked from its top in a shortened window, so that rows unmount as it goes
//               (asserted: a row mounted at one stop has left the list at a later one);
//   jump        the must-read's Needs-you row lands on its text, in sight;
//   links       the path link and the artifact mention inside mod-drawn messages: what each opens;
//   second      a second window on the running session reads the same record lines, drawn by the mod or the mirror
//               (§M), the drawer recorded (MAWS has no gesture that opens a second window: the trial opens a further
//               app window through main's e2e seam, as e2e/artifacts-store does);
//   lane off    the session's lane off (its override), resumed with no prompt: no advertisement, drawn by the mod with
//               no turn fold of MAWS's;
//   at rest     the app quit and reopened, the session at rest: drawn by the mirror, the same messages and the same
//               record lines' words, read from the mod's file (fold states aside);
//   switch off  new summaries off, the session started again with one more turn: its launch carries the value, the new
//               stretch reads `working record`, the earlier lines keep their summaries.
// The second case is check 5: a seeded session of two hundred invented turns with a message in each, resumed with no
// prompt sent (no model call), scrolled from the end to the top and back; the mounted rows and MAWS's render asks are
// read at each stop and recorded, for the architect to read against the anchoring bound of 40. It installs the plugins
// itself when the first case did not.
// The record lines are read only once they settle (none reads `working record` or a call's own words, and the same
// words come back on consecutive reads), and always by walking the whole list, since the rows are virtual.
// Notes on what the readings do not prove:
// - hiddenWhileScrolling does not prove that the stop it reads has rendered: stops overlap by half a viewport, so the
//   list's last half-viewport is read once.
// - a SurfaceRow that remounts is concealed while its ask is pending, so an absence read can land before its answer.
// - drawerOf can read `mirror` on a switch shown for a moment, if the sessions snapshot arrives after the owner state.
//
// Safety (P1's harness rules): the scratch config home only (the engine's CLI under `env -i`); nothing written under
// ~/.claude or ~/.claude.json (the A-15 reading before and after, ~/.claude/settings.json's digest compared); the relay's
// gate; every inherited CLAUDE_* variable dropped (launchMaws); Haiku. The engine is reached through a one-line
// forwarding script that adds `--max-budget-usd <what the run's cap leaves>` to every session process and changes nothing
// else (the unmodified engine, D-1). Every prompt is invented. Run on purpose only; it spends usage:
//   MAWS_HARNESS=1 pnpm exec electron-vite build \
//     && MAWS_U2B_TRIAL=1 MAWS_U2B_MOD_CHECKOUT=<the checkout> MAWS_U2B_TRIAL_MAX_USD=0.6 pnpm exec playwright test e2e/to-human-live.spec.ts
// `trial.txt` (one line per step), `trial-log.txt` (the detail) and `observations.json` go to MAWS_U2B_TRIAL_OUT; the
// scratch root stays in /tmp and is named at the end.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { NATIVE_TO_HUMAN_ENV, TO_HUMAN_DECLARATION } from '@shared/owner/contract';
import { FOLD_SUMMARIES_ENV, FOLD_SUMMARIES_OFF } from '@shared/owner/folds';
import type { JournalRow } from '@shared/wire/journal';
import { binaryDeclares, SYSTEM_PROMPT_SNAPSHOT_FLAG } from '../src/engine-host/binary-info';
import { RELAY_URL } from '../src/engine-host/launch';
import { isolatedGitEnv } from '../test/support/git-env';
import { compareA15 } from '../test/support/owner-file';
import { relaySkipReason } from '../test/support/relay-health';
import { addressed } from './support/address';
import { invoke, value } from './support/c7-replay';
import { cleanupFailure, launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { forwardingScript, spentUnder } from './support/live-budget';
import { promptsEnded, sessionJournal, writtenPrompts } from './support/live-turns';
import { a15Line, a15Reading, installedEngine } from './support/p1-live';
import { mountedTabs, sideColumn } from './support/shell';
import { newChatIn, sidebarRow } from './support/sidebar';
import { expectNewChatInFront } from './support/screen-reader-only';

const TRIAL = process.env.MAWS_U2B_TRIAL === '1';
const CHECKOUT = process.env.MAWS_U2B_MOD_CHECKOUT ? resolve(process.env.MAWS_U2B_MOD_CHECKOUT) : '';
const INSTALLED = join(homedir(), '.local/bin/claude');
function skipReason(): string | null {
  if (!TRIAL) return 'the U2b trial runs only under MAWS_U2B_TRIAL=1';
  if (CHECKOUT === '' || !existsSync(join(CHECKOUT, 'to-human', TO_HUMAN_DECLARATION))) return `MAWS_U2B_MOD_CHECKOUT names no checkout of the mod's pull request (with to-human/${TO_HUMAN_DECLARATION})`;
  if (!existsSync(INSTALLED)) return `no installed Claude Code at ${INSTALLED}`;
  return relaySkipReason(RELAY_URL);
}
const skip = skipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 2_400_000 });

function capUsd(): number {
  const cap = Number(process.env.MAWS_U2B_TRIAL_MAX_USD ?? '0.6');
  if (!(cap > 0 && cap <= 1)) throw new Error(`MAWS_U2B_TRIAL_MAX_USD must be above 0 and at most 1, not ${process.env.MAWS_U2B_TRIAL_MAX_USD}`);
  return cap;
}
const OUT = resolve(REPO_ROOT, process.env.MAWS_U2B_TRIAL_OUT ?? 'test-results/u2b-trial');
const STYLE = 'doperpowers:to-human';
const PLUGINS = ['doperpowers', 'to-human', 'sminos'] as const;
const HAIKU = /^(Haiku|claude-haiku)/;
const REPO_NAME = 'u2b-trial-repo';
const MUST_READ = 'check the tree before the release';
const ARTIFACT = 'Trial page';
const PAGE_FILE = 'trial-page.html';
const NONE = '› working record';
const PROMPTS = {
  one: 'Think it through first. Then run these five shell commands, one at a time: `ls`, `git status --short`, `git log --oneline -1`, `echo one`, `echo two`. Then send me one short final message saying what you found. Do not create or edit any file.',
  // the path link is absolute: a relative one is a path the Files tab refuses (tools/code/files/tabs.ts). The plain-text
  // `<essential>` line is asked for only so that the jump step has an item to jump to: MAWS marks a must-read only from
  // plain assistant text, and a session that reports through the message tool has no other source for one (the
  // product question is board ticket 732)
  two: (readme: string) => `Send me one short message now saying you are starting. Then run \`echo three\` and \`echo four\`, one at a time. Then call mcp__maws__artifact_create once with kind "html", title "${ARTIFACT}" and path "${PAGE_FILE}". Then send me one more message, not your final one, that links the file README.md exactly as [README.md](${readme}) and links the artifact as [${ARTIFACT}](maws-artifact:<the id the call returned>). Then, only so that this test has a must-read to jump to, end your turn with this line as plain text, outside any tool call: <essential>${MUST_READ}</essential> Do not create or edit any file.`,
  three: 'Call the ListAgents tool once. Then run the shell command `sleep 3 && echo done` in the background and wait for its notification. Then use your agent tool to ask a subagent to reply with the one word ready, and wait for it. Then send me one short final message. Do not create or edit any file.',
  four: 'Run `echo five` and then `echo six`, one at a time. Then send me one short final message. Do not create or edit any file.',
} as const;

// ---- the scratch root ------------------------------------------------------------------------------------------------

// Made in the worker that runs the test (beforeAll, which a skipped test never reaches), not when the module loads.
let root = '';
let config = '';
let userData = '';
let repo = '';
let market = '';
let engineScript = '';
let budgetFile = '';
test.beforeAll(() => {
  root = realpathSync(mkdtempSync('/tmp/maws-u2b-trial-'));
  config = join(root, 'claude-config');
  userData = join(root, 'user-data');
  repo = join(root, REPO_NAME);
  market = join(root, 'plugin-market');
  engineScript = join(root, 'engine', 'claude');
  budgetFile = join(root, 'budget-usd');
});

const log = (text = '') => appendFileSync(join(OUT, 'trial-log.txt'), `${text}\n`);
const line = (text: string) => {
  appendFileSync(join(OUT, 'trial.txt'), `${text}\n`);
  log(`>> ${text}`);
};
function observe(key: string, data: unknown): void {
  const file = join(OUT, 'observations.json');
  const prior = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(file, `${JSON.stringify({ ...prior, [key]: data }, null, 2)}\n`);
}
const sha256 = (path: string): string => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent');

// The engine's CLI against the scratch home only.
function cli(args: string[]): string {
  return execFileSync('/usr/bin/env', ['-i', `HOME=${root}`, `CLAUDE_CONFIG_DIR=${config}`, 'PATH=/usr/bin:/bin', 'DISABLE_AUTOUPDATER=1', 'TERM=dumb', engineScript, 'plugin', ...args], { cwd: root, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

// The scratch home's user settings: Haiku with thinking on, the commands the prompts ask for allowed, plus what a step adds.
function writeSettings(extra: Record<string, unknown>): void {
  const file = join(config, 'settings.json');
  const prior = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  const allow = ['Bash(ls)', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(echo:*)', 'Bash(sleep:*)', 'ListAgents', 'Task', 'Agent', 'mcp__maws__artifact_create'];
  writeFileSync(file, `${JSON.stringify({ ...prior, model: 'haiku', alwaysThinkingEnabled: true, permissions: { defaultMode: 'default', allow }, ...extra }, null, 2)}\n`);
}

type Installed = Record<string, { version: string; installPath: string }[]>;
// The scratch home, the repository, the engine's forwarding script, and the three plugins from the checkout's copy.
async function prepare(real: string, cap: number): Promise<{ marketplace: string; installed: Installed }> {
  for (const dir of [config, userData, repo, join(root, 'engine')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# U2b trial\n\nAn invented repository for the trial.\n');
  writeFileSync(join(repo, PAGE_FILE), '<!doctype html><html><head><meta charset="utf-8"><title>Trial page</title></head><body><p>An invented page for the trial.</p></body></html>\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=Trial', '-c', 'user.email=trial@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  if (!existsSync(join(repo, '.git'))) {
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'seed');
  }
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2));
  writeSettings({});
  const declares = await binaryDeclares(real, SYSTEM_PROMPT_SNAPSHOT_FLAG);
  writeFileSync(engineScript, forwardingScript({ label: 'U2b trial', real, budgetFile, declares, cap }), { mode: 0o755 });
  // the checkout as a local marketplace, its history and dependencies left out (the checkout itself is only read)
  cpSync(CHECKOUT, market, { recursive: true, filter: (src) => !src.split('/').some((part) => part === '.git' || part === 'node_modules') });
  const marketplace = (JSON.parse(readFileSync(join(market, '.claude-plugin', 'marketplace.json'), 'utf8')) as { name: string }).name;
  log(`setup · marketplace add: ${cli(['marketplace', 'add', market]).trim().split('\n').at(-1)}`);
  for (const plugin of PLUGINS) log(`setup · install ${plugin}: ${cli(['install', `${plugin}@${marketplace}`, '--scope', 'user']).trim().split('\n').at(-1)}`);
  writeSettings({ outputStyle: STYLE, enabledPlugins: Object.fromEntries(PLUGINS.map((plugin) => [`${plugin}@${marketplace}`, true])) });
  const installed = (JSON.parse(readFileSync(join(config, 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins: Installed }).plugins;
  return { marketplace, installed };
}

// ---- journals --------------------------------------------------------------------------------------------------------

const journal = (id: string): JournalRow[] => sessionJournal(userData, id);
const spent = (): number => spentUnder(userData);
// Before every launch: the session process may spend what the run's cap leaves.
function budget(cap: number): number {
  const left = cap - spent();
  if (left < 0.05) throw new Error(`not run (budget): US$${left.toFixed(4)} left of US$${cap}`);
  writeFileSync(budgetFile, left.toFixed(4));
  return left;
}
type Block = { type: string; name?: string; input?: Record<string, unknown> };
type Frame = { type?: string; event?: string; launchId?: string; args?: string[]; request?: { subtype?: string }; message?: { content?: unknown }; parent_tool_use_id?: string | null };
const frameOf = (row: JournalRow) => row.frame as Frame;
function spawns(id: string): { at: string; launchId: string; env: Record<string, string> }[] {
  return journal(id)
    .filter((r) => r.direction === 'meta' && frameOf(r).event === 'spawn')
    .map((r) => {
      const args = frameOf(r).args ?? [];
      const settings = JSON.parse(args.includes('--settings') ? args[args.indexOf('--settings') + 1]! : '{}') as { env?: Record<string, string> };
      return { at: r.at, launchId: frameOf(r).launchId ?? '', env: settings.env ?? {} };
    });
}
// The engine's main-lane content blocks, in order
const mainBlocks = (id: string): Block[] =>
  journal(id).flatMap((r) => {
    const f = frameOf(r);
    return r.direction === 'in' && f.type === 'assistant' && (f.parent_tool_use_id ?? null) === null && Array.isArray(f.message?.content) ? (f.message!.content as Block[]) : [];
  });
const calls = (id: string, name: string) => mainBlocks(id).filter((b) => b.type === 'tool_use' && b.name === name);
// MAWS's render asks of the session's sites written from journal row `from` on
const renderAsks = (id: string, from = 0) => journal(id).slice(from).filter((r) => r.direction === 'out' && frameOf(r).request?.subtype === 'ui_render').length;
// What the person reads as messages, as the engine sent them: the mod's message tool's texts
const messageTexts = (id: string): string[] => mainBlocks(id).filter((b) => b.type === 'tool_use' && b.name?.endsWith('to-human__message') === true).map((b) => String(b.input?.text ?? '')).filter((text) => text.trim() !== '');
// A message's first run of plain words, cut before any Markdown or mark syntax, to find its drawing by (null when it has
// none long enough to be its own)
function opening(text: string): string | null {
  for (const raw of text.replace(/<\/?[a-z-]+>/g, '\n').split('\n')) {
    const run = /^[\p{L}\p{N} ,.;:'’!?()-]+/u.exec(raw.replace(/^[\s#>*+-]+|^\s*\d+\.\s+/, ''))?.[0]?.trim() ?? '';
    if (run.length >= 12) return run.slice(0, 40).trim();
  }
  return null;
}

// ---- the page --------------------------------------------------------------------------------------------------------

// Board ticket 850 (2026-11-23): launches advertise 8 again and MAWS's mirror draws every session; the mod's route stays
// built behind its switch, which this trial turns on through the e2e seam (MAWS_E2E_TO_HUMAN_MOD_ROUTE, read in
// src/services/spine-root.ts only under MAWS_E2E), so it still proves the route a later change may turn back on.
const launch = () => launchMaws({ defaultRoute: 'gateway', userData, env: { MAWS_E2E_ENGINE_BIN: engineScript, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: config, MAWS_E2E_TO_HUMAN_MOD_ROUTE: '1' } });
const paneOf = (page: Page) => page.locator('[data-region="main"] [data-pane="0"]');
const composer = (page: Page) => paneOf(page).getByRole('textbox', { name: 'Message' });
const status = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
const lane = async (page: Page, id: string) => value(await invoke(page, 'ownerChannel.state', { appSessionId: id as AppSessionId })).lane;
const written = (id: string) => writtenPrompts(journal(id)).length;
// The submitted turn's end: every prompt written after `before` ended at the engine, then no open turn and no request.
async function settle(page: Page, id: string, before: number, timeout = 300_000): Promise<void> {
  await expect.poll(() => promptsEnded(writtenPrompts(journal(id)), before), { timeout, intervals: [500] }).toBe(true);
  await expect.poll(async () => {
    const s = await status(page, id);
    return s.turn === null && s.pendingRequests === 0;
  }, { timeout, intervals: [500] }).toBe(true);
}
async function closeWidgets(page: Page): Promise<void> {
  if (await page.getByRole('dialog', { name: 'Model and effort' }).isVisible()) await page.keyboard.press('Escape');
  for (const w of await page.locator('[data-widget]').all()) await w.getByRole('button', { name: /^Close / }).first().click().catch(() => undefined);
}
async function send(page: Page, text: string): Promise<void> {
  await closeWidgets(page);
  await composer(page).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}
// A new chat in the scratch repository on Haiku; its first Send is the launch.
async function newSession(page: Page): Promise<string> {
  await newChatIn(page, REPO_NAME);
  await expectNewChatInFront(page, REPO_NAME); // the word cut (W86): a screen reader's heading
  const id = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
  await closeWidgets(page);
  await composer(page).click();
  await page.keyboard.type('/model');
  await expect(page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]')).toContainText('/model');
  await page.keyboard.press('Enter');
  await page.locator('[data-widget="model"]').getByRole('menuitemradio', { name: HAIKU }).click();
  await expect.poll(async () => value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => i.appSessionId === id)?.model ?? '').toMatch(/haiku/);
  await closeWidgets(page);
  return id;
}
async function stop(page: Page, id: string): Promise<void> {
  value(await invoke(page, 'session.stop', { appSessionId: id as AppSessionId, reason: 'stop' }));
  await expect.poll(async () => (await status(page, id)).process, { timeout: 60_000 }).toBe('exited');
}
async function resume(page: Page, id: string): Promise<void> {
  value(await invoke(page, 'session.start', { appSessionId: id as AppSessionId, message: null, options: { model: 'haiku' } }));
  // the host knows no session it has not loaded since the app started, so its status answers an error until the launch
  await expect.poll(async () => (await status(page, id).catch(() => null))?.process ?? null, { timeout: 120_000 }).toBe('ready');
}
async function open(page: Page, id: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: id })).click();
  await page.mouse.move(700, 450);
  await expect(paneOf(page).locator(`[data-composer="${await addressed(page, id)}"]`)).toBeVisible();
}
// What is in sight. Where the mod draws a row with its own tree, MAWS keeps its own drawing of that row in the DOM,
// concealed (`display: none`, `inert`, `aria-hidden`, `visibility: hidden`: engine-surface/SurfaceRow.tsx), so every
// reading here counts only what a person can see: an element, or one of its descendants, that is rendered with a box,
// visible, and under no `[inert]`. The same test is written into each page function below (a page function cannot call
// a function of this file), as `inSight`.
//
// The record lines as drawn: by the mod (its `to-human-toggle` button, whose accessible name is its label without the
// `› `: engine-surface/SurfaceTree.tsx's ButtonNode; check 1's recordings, u2b-mod-label.jsonl), by MAWS's mirror
const LINE = { mod: '[data-plugin-drawn] button[data-key="to-human-toggle"]', mirror: '[data-kind="record_fold"] button' } as const;
type Drawer = keyof typeof LINE;
// Every record line in sight, in order, the list walked from its top (rows are virtual: only those near the viewport
// are mounted), each line keyed by its row's index; the list is left at its end.
async function walkLines(page: Page, drawer: Drawer): Promise<string[]> {
  return paneOf(page).locator('[data-transcript-scroller]').evaluate(async (scroller, selector) => {
    const inSight = (el: Element) => !el.closest('[inert]') && [el, ...Array.from(el.querySelectorAll('*'))].some((c) => !c.closest('[inert]') && c.checkVisibility({ visibilityProperty: true }) && Array.from(c.getClientRects()).some((r) => r.width > 0 && r.height > 0));
    const seen = new Map<string, string>();
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
    scroller.scrollTop = 0;
    for (let guard = 0; guard < 400; guard += 1) {
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      for (const button of Array.from(scroller.querySelectorAll<HTMLElement>(selector))) {
        const words = (button.textContent ?? '').trim();
        if (!words.startsWith('› ') || !inSight(button)) continue;
        const row = button.closest<HTMLElement>('[data-index]');
        seen.set(`${String(row?.dataset.index ?? '?').padStart(6, '0')}|${words}`, words);
      }
      if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) break;
      scroller.scrollTop += Math.max(1, scroller.clientHeight / 2);
    }
    scroller.scrollTop = scroller.scrollHeight;
    return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, words]) => words);
  }, LINE[drawer]);
}
// The record lines once they settle: `done` holds for the walked lines, and the same lines come back on three reads in a
// row (a bounded poll on a count of agreeing reads, never a time)
async function settledLines(page: Page, drawer: Drawer, done: (lines: string[]) => boolean | Promise<boolean>, message: string): Promise<string[]> {
  let lines: string[] = [];
  let last = '';
  let agreeing = 0;
  await expect
    .poll(async () => {
      lines = await walkLines(page, drawer);
      const key = JSON.stringify(lines);
      const holds = await done(lines);
      agreeing = holds ? (key === last ? agreeing + 1 : 1) : 0;
      last = key;
      return agreeing;
    }, { timeout: 180_000, intervals: [3_000], message })
    .toBeGreaterThanOrEqual(3);
  return lines;
}
// Every closed line reads a summary: its words are one of the summaries the mod stored for the session, as MAWS's own
// reader gives them (`ownerChannel.folds`), so neither `working record` nor any call's own words, whatever the tool (the
// mod cuts a summary when it stores it and draws the stored label whole)
const summaryLine = (line: string, summary: string) => line === `› ${summary}`;
const summarised = (page: () => Page, id: string) => async (lines: string[]) => {
  const runs = value(await invoke(page(), 'ownerChannel.folds', { appSessionId: id as AppSessionId })).runs ?? [];
  return lines.length > 0 && lines.every((line) => runs.some((run) => summaryLine(line, run.summary)));
};
// Who draws the session's record lines in this window now (§M, "What a person sees"): the mirror when its switch is in
// sight in the window's pane; the mod when the lane says so and the mod's band is in sight there
async function drawerOf(page: Page, id: string): Promise<Drawer> {
  let drawer: Drawer | null = null;
  await expect.poll(async () => {
    if ((await paneOf(page).locator('[data-view-switch]:visible').count()) > 0) return (drawer = 'mirror');
    if ((await lane(page, id)).drawnBy === 'mod' && (await modBand(paneOf(page)).isVisible())) return (drawer = 'mod');
    return null;
  }, { timeout: 30_000, message: 'the mirror’s switch in sight in this window, or the lane says the mod draws and its band is in sight there' }).not.toBeNull();
  return drawer!;
}
// Each message drawn once: its opening words held, in sight, by exactly one innermost element at the stop where it is
// seen most, the list walked from its top (a message with no plain opening is left out, named in the log)
async function drawnOnce(page: Page, texts: string[]): Promise<void> {
  const phrases = texts.map(opening);
  const most = await paneOf(page).locator('[data-transcript-scroller]').evaluate(async (scroller, words) => {
    const inSight = (el: Element) => !el.closest('[inert]') && [el, ...Array.from(el.querySelectorAll('*'))].some((c) => !c.closest('[inert]') && c.checkVisibility({ visibilityProperty: true }) && Array.from(c.getClientRects()).some((r) => r.width > 0 && r.height > 0));
    const top = words.map(() => 0);
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
    scroller.scrollTop = 0;
    for (let guard = 0; guard < 400; guard += 1) {
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const all = Array.from(scroller.querySelectorAll<HTMLElement>('*'));
      words.forEach((phrase, k) => {
        if (phrase === null) return;
        const holders = all.filter((el) => (el.textContent ?? '').includes(phrase) && !Array.from(el.children).some((child) => (child.textContent ?? '').includes(phrase)) && !el.closest('[data-kind="user"]') && inSight(el));
        top[k] = Math.max(top[k]!, holders.length);
      });
      if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) break;
      scroller.scrollTop += Math.max(1, scroller.clientHeight / 2);
    }
    scroller.scrollTop = scroller.scrollHeight;
    return top;
  }, phrases);
  const read = phrases.map((phrase, k) => ({ phrase, most: most[k] }));
  log(`drawn once: ${JSON.stringify(read)}`);
  expect(read.filter((r) => r.phrase !== null), 'each message drawn exactly once, in sight').toEqual(read.filter((r) => r.phrase !== null).map((r) => ({ ...r, most: 1 })));
}
const modBand = (scope: Locator) => scope.locator('[data-plugin-band]').filter({ hasText: 'to-human view' });
// A row's own drawing, MAWS's, in its `[data-engine-native]` portal: concealed where the mod's report replaces it (a
// thought, listing or notice heading a stretch answers with the mod's toggle row: check 1's u2b-mod-lone-thought,
// -lone-listing, -lone-notice), in sight in the full transcript, where the mod answers with the engine slot
const ownDrawing = (kind: string) => `[data-kind="${kind}"] [data-engine-native]`;
// The rows the full transcript shows and the report hides, each judged by its own drawing in sight; a turn's line by
// its row's box (u2b-mod-lone-turn: an empty answer, so the row draws nothing, in the report; the engine slot, MAWS's
// line, in the full transcript)
const HIDDEN = {
  thought: `${ownDrawing('thinking')}, [data-cell-id^="cell:think:"]`,
  listing: ownDrawing('agent_list'),
  notice: ownDrawing('notice'),
  'turn line': '[data-kind="divider"]',
} as const;
const ARRIVAL = ownDrawing('agent_message'); // a subagent's or a peer's message, drawn as an arrival
// Whether anything `selector` matches is in sight and in the viewport anywhere in the list, the list walked from its top
// to its end as a reader scrolls (the rows are virtual: a row is in the DOM only near the viewport), and whether the
// walk unmounted a row: an index mounted at one stop and gone at a later one
async function seenWhileScrolling(page: Page, selector: string): Promise<{ shown: boolean; unmounted: boolean }> {
  return paneOf(page).locator('[data-transcript-scroller]').evaluate(async (scroller, sel) => {
    const view = () => scroller.getBoundingClientRect();
    const inSight = (el: Element) => !el.closest('[inert]') && [el, ...Array.from(el.querySelectorAll('*'))].some((c) => !c.closest('[inert]') && c.checkVisibility({ visibilityProperty: true }) && Array.from(c.getClientRects()).some((r) => r.width > 0 && r.height > 0 && r.bottom > view().top && r.top < view().bottom));
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); // a reader's scroll, so the list stops following the end
    scroller.scrollTop = 0;
    let shown = false;
    let unmounted = false;
    const mountedOnce = new Set<string>();
    for (let guard = 0; guard < 400; guard += 1) {
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const mounted = new Set(Array.from(scroller.querySelectorAll<HTMLElement>('[data-index]')).map((row) => row.dataset.index ?? ''));
      if ([...mountedOnce].some((index) => !mounted.has(index))) unmounted = true;
      for (const index of mounted) mountedOnce.add(index);
      shown ||= Array.from(scroller.querySelectorAll(sel)).some(inSight);
      if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) break;
      scroller.scrollTop += Math.max(1, scroller.clientHeight / 2);
    }
    return { shown, unmounted };
  }, selector);
}

// Nothing `selector` matches in sight anywhere in the list: the list walked from its top to its end, and at each stop a
// state-waiting assertion on that end state (expect.poll, the scene's own expect timeout), after one that a row of the
// list is in sight at that stop (so an empty view cannot pass), since a row the mod draws
// can show MAWS's own drawing until the mod's answer lands (a turn's line is MAWS's own while its ask is pending:
// SurfaceTurnLine, transcript/surface/Rows.tsx) and no mark on the page tells the two apart
async function hiddenWhileScrolling(page: Page, selector: string, message: string): Promise<void> {
  const scroller = paneOf(page).locator('[data-transcript-scroller]');
  await scroller.evaluate((el) => {
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); // a reader's scroll, so the list stops following the end
    el.scrollTop = 0;
  });
  for (let guard = 0; guard < 400; guard += 1) {
    const at = await scroller.evaluate((el) => Math.round(el.scrollTop));
    // first, that the stop draws something: a row of the list in sight in the viewport, so an empty view cannot pass
    await expect
      .poll(() => scroller.evaluate((el) => {
        const view = el.getBoundingClientRect();
        const inSight = (e: Element) => !e.closest('[inert]') && [e, ...Array.from(e.querySelectorAll('*'))].some((c) => !c.closest('[inert]') && c.checkVisibility({ visibilityProperty: true }) && Array.from(c.getClientRects()).some((r) => r.width > 0 && r.height > 0 && r.bottom > view.top && r.top < view.bottom));
        return Array.from(el.querySelectorAll('[data-index]')).some(inSight);
      }), { message: `a row in sight where the list stopped (${at} px), before reading what is hidden there` })
      .toBe(true);
    await expect
      .poll(() => scroller.evaluate((el, sel) => {
        const view = el.getBoundingClientRect();
        const inSight = (e: Element) => !e.closest('[inert]') && [e, ...Array.from(e.querySelectorAll('*'))].some((c) => !c.closest('[inert]') && c.checkVisibility({ visibilityProperty: true }) && Array.from(c.getClientRects()).some((r) => r.width > 0 && r.height > 0 && r.bottom > view.top && r.top < view.bottom));
        return Array.from(el.querySelectorAll(sel)).some(inSight);
      }, selector), { message: `${message} (the list scrolled to ${at} px)` })
      .toBe(false);
    const ended = await scroller.evaluate((el) => {
      if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) return true;
      el.scrollTop += Math.max(1, el.clientHeight / 2);
      return false;
    });
    if (ended) break;
  }
}

// ---- the first case: the trial ---------------------------------------------------------------------------------------

test('U2b trial: the mod draws the view of a session MAWS runs, nothing twice, and the mirror reads the same words at rest', async () => {
  const cap = capUsd();
  mkdirSync(OUT, { recursive: true });
  for (const file of ['trial.txt', 'trial-log.txt', 'observations.json']) writeFileSync(join(OUT, file), file.endsWith('.json') ? '{}\n' : '');
  const engine = installedEngine();
  const owner = { a15: a15Reading(), settings: sha256(join(homedir(), '.claude/settings.json')) };
  const failures: string[] = [];
  const consoleErrors: string[] = []; // both launches'
  let maws: MawsLaunch | null = null;
  let page!: Page;
  // Every step builds on the ones before it, so after a failure the rest are not run.
  const step = (name: string, title: string, body: () => Promise<void>) =>
    test.step(title, async () => {
      log('');
      log(`=== ${name} · ${title}`);
      if (failures.length > 0) {
        line(`${name}: not run (an earlier step failed)`);
        return;
      }
      try {
        await body();
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error);
        failures.push(`${name}: ${message}`);
        line(`${name}: FAILED: ${message}`);
        await page?.screenshot({ path: join(OUT, `trial-${name}-failed.jpg`), type: 'jpeg', quality: 50, scale: 'css' }).catch(() => undefined);
      }
    });

  let id = '';
  let labels: string[] = []; // the record lines' words where the mod draws, before the quit
  let messages: string[] = [];
  let artifactId: string | null = null; // the artifact turn two made, as its final message mentions it
  try {
    await step('setup', 'the plugins from the checkout, the to-human style selected', async () => {
      const { marketplace, installed } = await prepare(engine.bin, cap);
      const toHuman = installed[`to-human@${marketplace}`]?.[0];
      expect(toHuman, 'to-human installed for the scratch home’s user').toBeDefined();
      expect(existsSync(join(toHuman!.installPath, TO_HUMAN_DECLARATION)), 'the installation carries the declaration').toBe(true);
      line(`setup: engine ${engine.version} through ${engineScript} (cap US$${cap}); relay ${RELAY_URL}; marketplace ${marketplace} copied from the checkout; ${PLUGINS.map((p) => `${p} ${installed[`${p}@${marketplace}`]?.[0]?.version ?? 'NOT INSTALLED'}`).join(', ')}; to-human declares; scratch ${root}`);
      line(a15Line('before the run', owner.a15, owner.a15, [root]));
      maws = await launch();
      page = maws.page;
      await expect(page.locator('[data-region="main"]')).toBeVisible();
      await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
      const projects = value(await invoke(page, 'session.projects.list', undefined)).projects;
      if (!projects.some((p) => p.directory === repo)) value(await invoke(page, 'session.projects.add', { directory: repo }));
    });

    await step('turn-1', 'a thought and five calls, then a message: the mod draws, at 9, nothing twice; each closed line reads a summary', async () => {
      id = await newSession(page);
      budget(cap);
      await send(page, PROMPTS.one);
      await expect.poll(() => spawns(id).length, { timeout: 60_000 }).toBe(1);
      const launched = spawns(id)[0]!;
      expect([launched.env[NATIVE_TO_HUMAN_ENV], launched.env[FOLD_SUMMARIES_ENV] ?? null], 'the launch advertises 9, summaries on').toEqual(['9', null]);
      await settle(page, id, 0);
      await expect.poll(async () => (await lane(page, id)).drawnBy, { timeout: 30_000, message: 'the mod draws' }).toBe('mod');
      const bash = calls(id, 'Bash');
      const kinds = mainBlocks(id).map((b) => b.type);
      const thoughtFirst = kinds.includes('thinking') && kinds.indexOf('thinking') < kinds.indexOf('tool_use');
      const firstCall = journal(id).findIndex((r) => r.direction === 'in' && frameOf(r).type === 'assistant' && JSON.stringify(frameOf(r).message?.content ?? '').includes('"tool_use"'));
      const asks = renderAsks(id, Math.max(0, firstCall));
      const pane = paneOf(page);
      // the mod's drawing alone: no record line, no switch and no message drawing of MAWS's in sight (MAWS's own drawing
      // of a row the mod draws stays in the DOM, concealed: engine-surface/SurfaceRow.tsx)
      await hiddenWhileScrolling(page, '[data-kind="record_fold"]', 'no record line of MAWS’s in sight');
      await expect(pane.locator('[data-view-switch]:visible'), 'no switch of MAWS’s in sight').toHaveCount(0);
      await hiddenWhileScrolling(page, '.owner-message-ink', 'no message drawing of MAWS’s in sight');
      await expect(modBand(pane), 'the mod’s band with its switch').toBeVisible({ timeout: 30_000 });
      messages = messageTexts(id);
      expect(messages.length, 'at least one message').toBeGreaterThan(0);
      await drawnOnce(page, messages);
      // the summary comes after the stretch closed (one model call of the mod's): each line leaves its newest call's words
      labels = await settledLines(page, 'mod', summarised(() => page, id), 'each closed record line reads a summary where the mod draws');
      line(`turn 1: ${NATIVE_TO_HUMAN_ENV}=9, drawnBy mod; ${bash.length} calls, ${thoughtFirst ? 'a thought first' : 'NO thought before the first call'}; the mod's lines, settled ${JSON.stringify(labels)}; ${messages.length} message(s), each drawn once; no record line, switch or message drawing of MAWS's; render asks from the first call to the turn's end: ${asks}`);
      observe('turn1', { launched, calls: bash.length, thoughtFirst, labels, messages: messages.length, renderAsks: asks });
      expect(thoughtFirst, 'the stretch opens with a thought (it reads its summary on both routes)').toBe(true);
    });

    await step('turn-2', 'a message mid-turn, two calls and an artifact, then a message with a must-read, a path link and the artifact’s mention', async () => {
      budget(cap);
      const before = written(id);
      await send(page, PROMPTS.two(join(repo, 'README.md')));
      await settle(page, id, before);
      messages = messageTexts(id);
      await drawnOnce(page, messages);
      artifactId = /maws-artifact:([A-Za-z0-9_-]+)/.exec(messages.join('\n'))?.[1] ?? null;
      labels = await settledLines(page, 'mod', async (lines) => lines.length >= 2 && (await summarised(() => page, id)(lines)), 'two closed lines, each reading a summary');
      // the must-read stored as MAWS reads it: an essential mark whose head holds the words (a model that strays fails here)
      await expect.poll(async () => value(await invoke(page, 'ownerChannel.state', { appSessionId: id as AppSessionId })).marks.filter((m) => m.kind === 'essential').map((m) => m.head), { timeout: 30_000, message: 'an essential mark holding the must-read' }).toContainEqual(expect.stringContaining(MUST_READ));
      line(`turn 2: the mod's lines, settled ${JSON.stringify(labels)}; ${messages.length} message(s), each drawn once; artifact_create ${calls(id, 'mcp__maws__artifact_create').length} call(s), mentioned as ${artifactId ?? 'NOTHING'}`);
      expect(artifactId, 'the final message mentions the artifact it made').not.toBeNull();
    });

    await step('turn-3', 'a listing, a background task’s notification and a subagent’s message (check 7’s live half)', async () => {
      budget(cap);
      const before = written(id);
      await send(page, PROMPTS.three);
      await settle(page, id, before, 420_000);
      const listed = calls(id, 'ListAgents').length > 0;
      const notified = journal(id).some((r) => r.direction === 'in' && JSON.stringify(r.frame).includes('task-notification'));
      const agent = calls(id, 'Task').length + calls(id, 'Agent').length > 0;
      // the subagent's hand-back as an arrival row in the window: in the report, else in the full transcript
      const band = modBand(paneOf(page));
      let arrival = (await seenWhileScrolling(page, ARRIVAL)).shown ? 'the report' : null;
      if (arrival === null) {
        await band.getByRole('button', { name: /full transcript/ }).click();
        arrival = (await seenWhileScrolling(page, ARRIVAL)).shown ? 'the full transcript' : null;
        await band.getByRole('button', { name: /report only/ }).click();
      }
      messages = messageTexts(id);
      labels = await settledLines(page, 'mod', summarised(() => page, id), 'each closed record line reads a summary where the mod draws');
      line(`turn 3: ListAgents ${listed ? 'called' : 'NOT called'}; a task notification ${notified ? 'arrived' : 'NOT seen'}; a subagent ${agent ? 'ran' : 'NOT run'}, its arrival row ${arrival === null ? 'NOT seen' : `seen in ${arrival}`}; the mod's lines, settled ${JSON.stringify(labels)}`);
      expect([listed, notified, agent, arrival !== null]).toEqual([true, true, true, true]);
    });

    await step('full', 'hidden in the mod’s report, all in sight in its full transcript, also after scrolling', async () => {
      // a shorter window for the walk, so the list holds more than its viewport and rows unmount as it scrolls
      await maws!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 520));
      for (const [name, selector] of Object.entries(HIDDEN)) await hiddenWhileScrolling(page, selector, `the ${name} hidden in the mod’s report`);
      const band = modBand(paneOf(page));
      await band.getByRole('button', { name: /full transcript/ }).click();
      await expect(band.getByRole('button', { name: /report only/ })).toBeVisible({ timeout: 20_000 });
      const full: Record<string, boolean> = {};
      let unmounted = false;
      for (const [name, selector] of Object.entries(HIDDEN)) {
        const read = await seenWhileScrolling(page, selector);
        full[name] = read.shown;
        unmounted ||= read.unmounted;
      }
      line(`full: in the report each of ${JSON.stringify(Object.keys(HIDDEN))} hidden at every stop; in the full transcript, the list walked from its top ${JSON.stringify(full)}; a row unmounted during the walk: ${unmounted}`);
      expect(full, 'all in sight in the full transcript').toEqual(Object.fromEntries(Object.keys(HIDDEN).map((k) => [k, true])));
      expect(unmounted, 'the walk unmounted a row it had mounted, so what it found was found after scrolling').toBe(true);
      await band.getByRole('button', { name: /report only/ }).click();
      await maws!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
    });

    await step('jump', 'the must-read’s Needs-you row lands on its text, in sight', async () => {
      const item = value(await invoke(page, 'attention.list', undefined)).find((i) => i.appSessionId === id && i.kind === 'essential_unread' && i.state === 'pending');
      expect(item, 'a must-read item for the session').toBeDefined();
      await newSession(page); // away from the session, so the jump opens it
      await page.mouse.move(700, 450);
      const address = await addressed(page, id);
      await page.getByRole('list', { name: 'Needs you' }).locator(`[data-needs-you="${id}"], [data-needs-you="${address}"]`).first().click();
      // the must-read as the mod draws it, not the person's own prompt that asked for it
      await expect(paneOf(page).locator('[data-plugin-drawn]').getByText(MUST_READ, { exact: false }).first(), 'the jump’s target in sight').toBeInViewport({ timeout: 20_000 });
      line('jump: the Needs-you row opened the session and the must-read the mod draws is in the viewport');
    });

    await step('links', 'the path link and the artifact mention inside mod-drawn messages: what each opens', async () => {
      const pane = paneOf(page);
      const drawn = pane.locator('[data-plugin-drawn]');
      // a scheme-less link in a mod-drawn Markdown node is a path chip (markdown/sanitize.ts, `maws-path:`; markdown/
      // Link.tsx), and a plain click opens the file beside the chat, the main strip as it was (e2e/sessions.spec.ts)
      const strip = () => mountedTabs(page).evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id') ?? ''));
      const stripBefore = await strip();
      const path = drawn.locator(`[data-chip="path"][data-path="${join(repo, 'README.md')}"]`).first(); // as e2e/sessions.spec.ts selects a chip
      await expect(path, 'a path link inside a mod-drawn message').toBeVisible({ timeout: 20_000 });
      const pathTitle = await path.getAttribute('data-path'); // board ticket 815: the path its tip shows
      await path.click();
      const viewer = sideColumn(page).locator(`[data-file-viewer][data-path="${join(repo, 'README.md')}"]`);
      await expect(viewer, 'README.md beside the chat').toBeVisible({ timeout: 20_000 });
      expect(await strip(), 'the main strip as it was').toEqual(stripBefore);
      const pathOpened = { side: await viewer.getAttribute('data-path'), title: pathTitle };
      await open(page, id);
      const mention = drawn.locator(`[data-chip="artifact"][data-artifact-id="${artifactId}"]`).first();
      await expect(mention, 'the artifact mention inside a mod-drawn message').toBeVisible({ timeout: 20_000 });
      await expect(page.locator(`[data-artifact-viewer="${artifactId}"]`), 'no viewer of the artifact before the click').toHaveCount(0);
      await mention.click();
      // the transcript's rule (openArtifactMention): the main tab that already shows it, else the session's side column
      await expect.poll(() => page.locator(`[data-artifact-viewer="${artifactId}"]`).count(), { timeout: 20_000, message: 'the mention opened the artifact’s viewer' }).toBeGreaterThan(0);
      const mentionOpened = (await page.locator(`[data-artifact-tab="${artifactId}"]`).count()) > 0 ? 'its main tab' : 'the side column';
      line(`links: README.md opened beside the chat ${JSON.stringify(pathOpened)}, the main strip unchanged; the mention of ${artifactId} opened ${JSON.stringify(mentionOpened)}`);
      observe('links', { pathOpened, artifactId, mentionOpened });
      await open(page, id);
    });

    await step('second', 'a second window on the running session reads the same record lines, drawn by the mod or the mirror', async () => {
      labels = await settledLines(page, 'mod', summarised(() => page, id), 'the first window’s lines, settled');
      const app = maws!.app;
      const [second] = await Promise.all([
        app.waitForEvent('window'),
        app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow()), // main's e2e seam: a further app window (src/main/artifacts/index.ts)
      ]);
      await expect(second.locator('[data-region="main"]')).toBeVisible({ timeout: 30_000 });
      await (await sidebarRow(second, { appSessionId: id })).click();
      // §M: a second window draws the session's view by the mod or by the mirror; either reads the same words
      const drawer = await drawerOf(second, id);
      const there = await settledLines(second, drawer, (lines) => lines.length === labels.length, 'the second window’s lines, settled');
      line(`second window: drawn by ${drawer === 'mod' ? 'the mod' : 'the mirror'}, the lines ${JSON.stringify(there)}`);
      expect(there, 'the same words in the second window').toEqual(labels);
      await second.close();
    });

    await step('lane-off', 'the lane off for the session: no advertisement, the mod draws, no turn fold of MAWS’s', async () => {
      await stop(page, id);
      value(await invoke(page, 'mods.setSessionOverride', { appSessionId: id as AppSessionId, id: 'maws.to-human', value: 'off' }));
      await resume(page, id);
      expect(spawns(id).at(-1)!.env[NATIVE_TO_HUMAN_ENV], 'no advertisement').toBeUndefined();
      await expect.poll(async () => (await lane(page, id)).drawnBy, { timeout: 30_000 }).toBe('mod');
      const pane = paneOf(page);
      await expect.poll(async () => (await walkLines(page, 'mod')).length, { timeout: 30_000, message: 'the mod’s fold, in sight' }).toBeGreaterThan(0);
      await hiddenWhileScrolling(page, '.transcript-divider .transcript-disclosure', 'no turn fold of MAWS’s in sight');
      await hiddenWhileScrolling(page, '[data-kind="record_fold"]', 'no record line of MAWS’s in sight');
      await expect(pane.locator('[data-view-switch]:visible'), 'no switch of MAWS’s in sight').toHaveCount(0);
      line(`lane off: no ${NATIVE_TO_HUMAN_ENV}, drawnBy mod, the mod's lines ${JSON.stringify(await walkLines(page, 'mod'))}, no turn fold of MAWS's`);
      await stop(page, id);
      value(await invoke(page, 'mods.setSessionOverride', { appSessionId: id as AppSessionId, id: 'maws.to-human', value: 'inherit' }));
    });

    await step('at-rest', 'quit and reopen: the session at rest drawn by the mirror, the same messages and words', async () => {
      // the words just before the quit: the session is at rest since the lane-off step, so whoever draws it now reads
      // them, and they are the words the mod drew while it ran
      const running = labels;
      const drawerBefore = await drawerOf(page, id);
      labels = await settledLines(page, drawerBefore, (lines) => lines.length === running.length, 'the lines before the quit, settled');
      expect(labels, `the words before the quit, drawn by ${drawerBefore === 'mod' ? 'the mod' : 'the mirror'}, are the mod’s`).toEqual(running);
      consoleErrors.push(...maws!.consoleErrors());
      await maws!.cleanup();
      maws = await launch();
      page = maws.page;
      await expect(page.locator('[data-region="main"]')).toBeVisible();
      await open(page, id);
      await expect(paneOf(page).locator('[data-view-switch]'), 'the mirror’s switch').toBeVisible({ timeout: 30_000 });
      const mirrored = await settledLines(page, 'mirror', (lines) => lines.length === labels.length, 'the mirror reads the mod’s file');
      expect(mirrored, 'the same words, read by the mirror from the mod’s file').toEqual(labels);
      await drawnOnce(page, messages);
      line(`at rest: the mirror's lines ${JSON.stringify(mirrored)}, the same words; ${messages.length} message(s), each drawn once`);
    });

    await step('switch-off', 'new summaries off: the next launch carries it, a new stretch reads working record, the earlier keep theirs', async () => {
      value(await invoke(page, 'mods.setFoldSummaries', { on: false }));
      budget(cap);
      await resume(page, id);
      expect([spawns(id).at(-1)!.env[NATIVE_TO_HUMAN_ENV], spawns(id).at(-1)!.env[FOLD_SUMMARIES_ENV]], 'the launch carries the value').toEqual(['9', FOLD_SUMMARIES_OFF]);
      const before = written(id);
      await send(page, PROMPTS.four);
      await settle(page, id, before);
      // settled: one line more than before, the same on three reads in a row
      const now = await settledLines(page, 'mod', (lines) => lines.length === labels.length + 1, 'the new stretch closed and settled');
      line(`switch off: ${FOLD_SUMMARIES_ENV}=${FOLD_SUMMARIES_OFF}; the lines ${JSON.stringify(now)}`);
      expect(now.slice(0, labels.length), 'the earlier lines keep their summaries').toEqual(labels);
      expect(now.at(-1), 'the new stretch reads working record').toBe(NONE);
      await stop(page, id);
      value(await invoke(page, 'mods.setFoldSummaries', { on: true }));
    });
  } finally {
    if (maws) consoleErrors.push(...(maws as MawsLaunch).consoleErrors());
    const teardown = await cleanupFailure(maws);
    const after = { a15: a15Reading(), settings: sha256(join(homedir(), '.claude/settings.json')) };
    const total = spent();
    line(`spend: US$${total.toFixed(4)} across the run's journals (cap US$${cap}; the mod's summary calls are not in it: no result frame counts them); ~/.claude/settings.json ${after.settings === owner.settings ? 'unchanged' : 'CHANGED'}; teardown ${teardown ?? 'clean'}`);
    line(a15Line('after the run', owner.a15, after.a15, [root]));
    observe('after', { failures, consoleErrors, spentUsd: total, teardown });
    console.log(`U2b trial: scratch root ${root}`);
    expect(after.settings, '~/.claude/settings.json unchanged').toBe(owner.settings);
    expect(compareA15(owner.a15.keys, after.a15.keys, [root]).breach, 'A-15: no key outside the run’s scratch appeared or vanished in the owner file').toEqual([]);
    expect(total, `the run's spend within its cap of US$${cap}`).toBeLessThanOrEqual(cap);
  }
  expect(failures, failures.join('\n')).toEqual([]);
  expect(consoleErrors, 'no console error in either launch').toEqual([]);
});

// ---- the second case: check 5 ----------------------------------------------------------------------------------------

// Two hundred invented turns, each a prompt, one shell call and its result, and a message to the person, as the engine
// writes its transcript; resumed with no prompt, so no model call is made while the mod draws.
function seedLongSession(engineId: string, version: string): void {
  const dir = join(config, 'projects', realpathSync(repo).replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const records: Record<string, unknown>[] = [];
  let parent: string | null = null;
  const add = (type: string, fields: Record<string, unknown>) => {
    const uuid = randomUUID();
    records.push({ type, uuid, parentUuid: parent, isSidechain: false, cwd: repo, sessionId: engineId, version, timestamp: new Date(Date.UTC(2026, 10, 16, 6, 0, records.length)).toISOString(), ...fields });
    parent = uuid;
  };
  const assistant = (n: string, content: unknown[], stop: string) => ({ message: { id: `msg_u2bcheckfive${n}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content, stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } } });
  for (let n = 1; n <= 200; n += 1) {
    const call = `toolu_u2bcheckfive${String(n).padStart(4, '0')}`;
    add('user', { message: { role: 'user', content: `Invented request ${n}: count the fixtures.` } });
    add('assistant', assistant(`c${n}`, [{ type: 'tool_use', id: call, name: 'Bash', input: { command: 'ls fixtures', description: 'List the fixtures' } }], 'tool_use'));
    add('user', { toolUseResult: { stdout: 'alpha.json', stderr: '', interrupted: false }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: 'alpha.json', is_error: false }] } });
    add('assistant', assistant(`m${n}`, [{ type: 'text', text: `<message>\nInvented answer ${n}: one fixture.\n</message>` }], 'end_turn'));
  }
  writeFileSync(join(dir, `${engineId}.jsonl`), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

test('U2b check 5: a long seeded session the mod draws, resumed with no prompt and scrolled end to top and back: mounted rows and render asks at each stop', async () => {
  const cap = capUsd();
  const engine = installedEngine();
  mkdirSync(OUT, { recursive: true });
  // the owner's files read before anything of this case, as the first case reads them
  const owner = { a15: a15Reading(), settings: sha256(join(homedir(), '.claude/settings.json')) };
  let maws: MawsLaunch | null = null;
  try {
    // the scratch home as the first case leaves it; made here when that case stopped before its setup finished
    if (!existsSync(join(config, 'plugins', 'installed_plugins.json'))) await prepare(engine.bin, cap);
    const engineId = randomUUID();
    seedLongSession(engineId, engine.version);
    maws = await launch();
    const { page } = maws;
    const projects = value(await invoke(page, 'session.projects.list', undefined)).projects;
    if (!projects.some((p) => p.directory === repo)) value(await invoke(page, 'session.projects.add', { directory: repo }));
    // the resume sends no prompt and spends nothing, so no refusal on what is left; the forwarding script still reads a
    // cap, what is left (a floor of a cent, so a run whose first case spent its cap can still resume)
    writeFileSync(budgetFile, Math.max(cap - spent(), 0.01).toFixed(4));
    let id = '';
    await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? ''), { timeout: 30_000, message: 'the seeded session listed' }).not.toBe('');
    await open(page, id);
    await resume(page, id); // no prompt: no model call
    await expect.poll(async () => (await lane(page, id)).drawnBy, { timeout: 30_000 }).toBe('mod');
    const scroller = paneOf(page).locator('[data-transcript-scroller]');
    const stops: { at: string; mounted: number; renderAsks: number }[] = [];
    const read = async (at: string) => {
      await page.waitForTimeout(1_000); // the stop's rows drawn and their asks written
      stops.push({ at, mounted: await scroller.evaluate((el) => el.querySelectorAll('[data-index]').length), renderAsks: renderAsks(id) });
    };
    await read('end');
    for (const fraction of [0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75, 1]) {
      await scroller.evaluate((el, f) => {
        el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
        el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
      }, fraction);
      await read(String(fraction));
    }
    appendFileSync(join(OUT, 'trial.txt'), `check 5: ${JSON.stringify(stops)} (the most mounted: ${Math.max(...stops.map((s) => s.mounted))}, against the anchoring bound of 40)\n`);
    observe('check5', stops);
    await stop(page, id);
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    const teardown = await cleanupFailure(maws);
    if (teardown !== null) appendFileSync(join(OUT, 'trial.txt'), `check 5: teardown ${teardown}\n`);
    const after = { a15: a15Reading(), settings: sha256(join(homedir(), '.claude/settings.json')) };
    appendFileSync(join(OUT, 'trial.txt'), `check 5: ~/.claude/settings.json ${after.settings === owner.settings ? 'unchanged' : 'CHANGED'}; ${a15Line('after check 5', owner.a15, after.a15, [root])}\n`);
    expect(after.settings, '~/.claude/settings.json unchanged').toBe(owner.settings);
    expect(compareA15(owner.a15.keys, after.a15.keys, [root]).breach, 'A-15: no key outside the run’s scratch appeared or vanished in the owner file').toEqual([]);
  }
});
