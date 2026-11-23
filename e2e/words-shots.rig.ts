// The words rig (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M0; its manifest is
// docs/doperpowers/specs/2026-11-16-word-cut/scenes.md): the same MAWS screens, in the same states, from any build, so
// that a before/after pair differs only in the app's words. Nothing here asserts a look: each scene drives the app to a
// state and photographs it. Only repository fixtures and scratch folders under /private/tmp/maws-words: HOME, the engine
// stores, ClaudeUsage, the projects' git repositories and the profiles are all scratch, and the machine is named
// "studio". No picture is committed.
//
// On demand only. This file is not a *.spec.ts: no e2e group, the bare `pnpm e2e` and default's derivation never
// collect it; its own config, playwright.words.config.ts, is the whole selection. On a Mac (it opens app windows), from
// a clean checkout of the branch under test:
//
//   pnpm install
//   WORDS_OUT=$HOME/maws-words/before pnpm shots:words
//
// which builds out/ (the harness variant: Settings › Org reads its seeded org through the harness build's main; every
// window here is the product's, MAWS_HARNESS=0) and runs the twelve launches, about 40 minutes (M1 added launches 6
// to 9 and the `m1-` scenes: the Settings and Org states the word cut's M1 changes; M2 added launch 10 and the `m2-`
// scenes: the conversation's and the message box's states its cut changes; M3 added launches 11 and 12 and the `m3-` scenes:
// the panels beside the conversation, and the project Channel's folds). The pictures are
// <WORDS_OUT>/<scene id>.png, with <WORDS_OUT>/_run.json listing each scene's meta and whether it was reached (and why
// not), and each run's build (its commit and a digest of out/). WORDS_ONLY=<id>,<prefix>* narrows the run to some scenes (a launch with none wanted still starts). The "after"
// pictures are the same command on the build's branch into another folder. A folder holds one build's pictures: a run of
// another build into it moves the earlier results it does not take again aside (`stale` in _run.json, their pictures
// under _stale/<build>/), and a scene taken again loses its old picture before it starts.
//
// Board ticket 850 (the report view repair) added launch 13 and the `rv-` scenes: the to-human view drawn by MAWS's
// mirror, from recorded transcripts under an installation that declares it draws from 9 (as the mod's 0.9.0 does). One
// launch alone, from either build:
//
//   WORDS_OUT=$HOME/maws-words/rv-after pnpm shots:words -g "report view repair"
//
// and on master, as below for the m scenes, into another folder (rv-before).
//
// The `m1-`, `m2-` and `m3-` scenes are each their milestone's, so their "before" is this rig run against master's build: in a
// clean checkout of master, `git checkout <this branch> -- e2e/words-shots.rig.ts e2e/support`, then the command above.
// Every launch's state is set from this file and e2e/support (fixtures, seams master's main already has). Each m1 and m2
// scene checks its named state right before its capture, on master's build in master's terms (`cutBuild` for M1's
// parts, `m2Build` for M2's, `m3Build` for M3's), and is not reached when it cannot.
//
// Locators avoid the app's words (data attributes, menu ids, IPC, positions), because the words are what the other
// build changes; where only a word reaches a target it comes from the app's own copy module, or is marked. A step that
// cannot find its target records the screen as not reached instead of failing the run; a scene whose surface the UX
// wave removed is recorded as having no target on master, with why.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { GrantsView, OrgStatus, OrgView } from '../src/shared/ipc/schema/org';
import { readOrMintMachineRef } from '../src/shared/machine/identity-file';
import { memberNames } from '../src/shared/org/member-name';
import { BROWSER, INDEX, KEYBOARD, NOTIFICATIONS, ORG, SUPERVISOR, VOICE } from '../src/renderer/src/settings-tab/copy';
import { BROWSER_COPY } from '../src/renderer/src/tools/browser/copy';
import { BACKGROUND_COPY, SUBAGENTS_COPY } from '../src/renderer/src/tools/agents/copy';
import { ACTIONS } from '../src/shared/keymap/actions';
import { benchDeckFiles } from '../src/artifacts/slides/fixtures/bench';
import { isolatedGitEnv } from '../test/support/git-env';
import { installToHumanPlugin } from '../test/support/to-human-plugin'; // board ticket 850's launch
import { ownerShapedState, writePluginCliStub } from '../test/support/plugin-cli-stub';
import { addressed } from './support/address';
import { invoke, launchReady, recordedBlockJournal, steerStopJournal, turnsJournal, value } from './support/c7-replay';
import { bindCsv, chart, insertBlocks } from './support/dashboards';
import { createDesign, DESIGN_FILES, editDesign } from './support/design';
import { closedPort, startBrowserServer } from './support/browser-server';
import { closeSettings, closeSheet, importThrough, openImportSheet, profilesFile, sheetOf } from './support/browser-import-scene';
import { buildChromeUserData } from '../test/support/chrome-profile';
import { CHANNEL_FIXTURE_ENV, WORDS_CHANNEL_COUNTS, WORDS_CHANNEL_PROJECT, WORDS_CHANNEL_PROJECT_ID, wordsChannel, wordsChannelScenario } from './support/words-channel';
import { CHANNEL } from '../src/renderer/src/channel/copy';
import { goToFile } from './support/go-to-file';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { menu } from './support/menu';
import { startModelStub } from './support/model-stub';
import { sidebarRow } from './support/sidebar';

const OUT = process.env.WORDS_OUT ?? '';
const ONLY = process.env.WORDS_ONLY ? new Set(process.env.WORDS_ONLY.split(',')) : null;
const SCRATCH = '/private/tmp/maws-words';
const W = 1440;
const H = 900;
test.skip(!OUT, 'WORDS_OUT names the folder the captures go to');

// ---- _run.json: what each capture shows, for a person and for matching a table row to it -----------------------------
// round: 1 and 2 are the owner's rounds at the pin; 'm0' a scene the word cut's M0 added on master; 'm1' one its M1
// added for the Settings and Org states the cut changes; 'm2' one its M2 added for the conversation's and the message
// box's; 'm3' one its M3 added for the panels beside the conversation. A folder is under src/renderer/src, or from the repository's root when it starts with src/.
type Meta = { id: string; title: string; how: string; state: string; folders: string[]; hover?: boolean; round?: 2 | 'm0' | 'm1' | 'm2' | 'm3' | 'rv' };
const META: Meta[] = [];
const results: { id: string; ok: boolean; error?: string; notes?: string[] }[] = [];
const wanted = (id: string) => !ONLY || ONLY.has(id) || [...ONLY].some((o) => o.endsWith('*') && id.startsWith(o.slice(0, -1)));
const r2 = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 2 });
const m0 = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 'm0' });
const m1 = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 'm1' });
const m2 = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 'm2' });
const m3 = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 'm3' });
const rv = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 'rv' }); // board ticket 850, the report view repair

// ---- scratch fixtures ------------------------------------------------------------------------------------------------
const FIXED_DATE = '2026-09-20T09:00:00+00:00';
const GIT_ENV = () => ({ ...isolatedGitEnv(), GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE });
function git(cwd: string, ...args: string[]) {
  return execFileSync('/usr/bin/git', args, { cwd, env: GIT_ENV(), encoding: 'utf8' }).trim();
}
// A repository with three commits on main, two pushed to a local bare origin, then one edited file, one new file and one
// staged file: Source control, Review and Files have something to draw, and every hash is the same on every run. The
// names are invented (the scenario's own project names come from its fixture). A variant adds one state on top:
//   behind     origin/main gains a commit main lacks (fetched): main is one ahead and one behind
//   conflict   a file in conflict, its three stages in the index (scm-scratch's way)
//   scheduled  the engine's durable scheduled jobs (a recorded scheduled_tasks.json) under .claude/, excluded from git
//   panels     (the word cut's M3) a tracked binary, a side branch merged with --no-ff and an empty commit after it, all
//              unpushed; then the binary changed, a symbolic link, two untracked folders (one holding a 5 MB log)
type RepoVariant = 'behind' | 'conflict' | 'scheduled' | 'panels';
function makeRepo(name: string, variant?: RepoVariant): string {
  const dir = join(SCRATCH, 'repos', name);
  if (existsSync(dir)) return dir;
  const origin = join(SCRATCH, 'origins', `${name}.git`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(SCRATCH, 'origins'), { recursive: true });
  git(join(SCRATCH, 'origins'), 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(dir, 'init', '--quiet', '-b', 'main');
  const commit = (file: string, text: string, message: string) => {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
    git(dir, 'add', file);
    git(dir, 'commit', '--quiet', '-m', message);
  };
  commit('README.md', `# ${name}\n\nA scratch project for the words rig.\n`, 'Start the project');
  commit('src/sidebar.ts', 'export function dragRow(from: number, to: number) {\n  return { from, to };\n}\n', 'Add sidebar drag');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '--quiet', 'origin', 'main');
  git(dir, 'branch', '--quiet', '-u', 'origin/main');
  git(dir, 'remote', 'set-head', 'origin', 'main'); // as a clone has it (scm-scratch.ts)
  commit('src/quota.ts', 'export const resetAfterMs = 5 * 60 * 60 * 1000;\n', 'Add quota reset');
  if (variant === 'panels') {
    commit('assets/sprite.dat', 'SPRT\0\u0001\u0002frame\0'.repeat(16), 'Add the sprite sheet');
    git(dir, 'checkout', '--quiet', '-b', 'side');
    commit('docs/side.md', 'A note made on a side branch.\n', 'Add the side note');
    git(dir, 'checkout', '--quiet', 'main');
    git(dir, 'merge', '--quiet', '--no-ff', '-m', 'Merge the side note', 'side');
    git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'Mark the release');
  }
  writeFileSync(join(dir, 'src/sidebar.ts'), 'export function dragRow(from: number, to: number) {\n  if (from === to) return null;\n  return { from, to };\n}\n');
  writeFileSync(join(dir, 'src/notes.md'), 'Drag keeps the row under the pointer.\n');
  writeFileSync(join(dir, 'README.md'), `# ${name}\n\nA scratch project for the words rig.\n\nSee src/ for the code.\n`);
  git(dir, 'add', 'README.md');
  if (variant === 'behind') {
    const up = git(dir, 'commit-tree', 'origin/main^{tree}', '-p', 'origin/main', '-m', 'An upstream change');
    git(dir, 'push', '--quiet', 'origin', `${up}:refs/heads/main`);
    git(dir, 'fetch', '--quiet', 'origin');
  }
  if (variant === 'conflict') {
    const blob = (text: string) => execFileSync('/usr/bin/git', ['hash-object', '-w', '--stdin'], { cwd: dir, env: GIT_ENV(), input: text, encoding: 'utf8' }).trim();
    const [base, ours, theirs] = ['the base text\n', 'our text\n', 'their text\n'].map(blob);
    execFileSync('/usr/bin/git', ['update-index', '--index-info'], { cwd: dir, env: GIT_ENV(), input: `100644 ${base} 1\tconflicted.txt\n100644 ${ours} 2\tconflicted.txt\n100644 ${theirs} 3\tconflicted.txt\n` });
    writeFileSync(join(dir, 'conflicted.txt'), 'our text\n');
  }
  if (variant === 'panels') {
    writeFileSync(join(dir, 'assets/sprite.dat'), 'SPRT\0\u0003\u0004frame\0'.repeat(20));
    symlinkSync('../README.md', join(dir, 'docs/readme-link.md'));
    mkdirSync(join(dir, 'notes'), { recursive: true });
    writeFileSync(join(dir, 'notes/ideas.md'), 'Keep the row under the pointer.\n');
    writeFileSync(join(dir, 'notes/later.md'), 'Measure the drag.\n');
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(join(dir, 'logs/build.log'), Array.from({ length: 80_000 }, (_, i) => `step ${String(i).padStart(6, '0')} · compiled one more module of the scratch project\n`).join(''));
  }
  if (variant === 'scheduled') {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    cpSync(join(REPO_ROOT, 'spikes/protocol-probe/fixtures/pass3/e7-cron-durable/scheduled_tasks.json'), join(dir, '.claude/scheduled_tasks.json'));
    appendFileSync(join(dir, '.git/info/exclude'), '.claude/\n');
  }
  return dir;
}

// A repository with one commit, nothing changed and no remote (the word cut's M3): Review's empty scope, and Source
// control with no base to count commits from.
function quietRepo(name: string): string {
  const dir = join(SCRATCH, 'repos', name);
  if (existsSync(dir)) return dir;
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--quiet', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), `# ${name}\n\nA quiet scratch project for the words rig.\n`);
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '--quiet', '-m', 'Start the quiet project');
  return dir;
}

// ClaudeUsage's committed fixture, its readings moved so the newest is two minutes old (c7-shots' way).
function usageFixture(name = 'claude-usage'): string {
  const usage = join(SCRATCH, name);
  if (existsSync(usage)) return usage;
  cpSync(join(REPO_ROOT, 'test/fixtures/claude-usage'), usage, { recursive: true });
  const history = join(usage, 'history');
  const files = readdirSync(history).map((name) => join(history, name));
  const rows = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  const newest = Math.max(...files.flatMap((file) => rows(file).map((row) => Date.parse(row.recordedAt as string))));
  const offset = Math.round((Date.now() - 2 * 60_000 - newest) / 60_000) * 60_000;
  const shift = (at: unknown) => new Date(Date.parse(at as string) + offset).toISOString().replace('.000Z', 'Z');
  for (const file of files) writeFileSync(file, rows(file).map((row) => JSON.stringify({ ...row, recordedAt: shift(row.recordedAt), resetsAt: shift(row.resetsAt) })).join('\n') + '\n');
  return usage;
}

// The relay's requests (ClaudeUsage's `gateway-requests.jsonl`, synthetic) moved so the newest ended 30 s ago, as
// accounts.spec's freshRequests moves them: what an account served counts the last ten minutes by the wall clock.
function freshRequests(usage: string) {
  const rows = readFileSync(join(REPO_ROOT, 'test/fixtures/claude-usage/gateway-requests.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { startedAt: string; totalSeconds: number });
  const newest = Math.max(...rows.map((row) => Date.parse(row.startedAt) + row.totalSeconds * 1000));
  const offset = Date.now() - 30_000 - newest;
  writeFileSync(join(usage, 'gateway-requests.jsonl'), rows.map((row) => JSON.stringify({ ...row, startedAt: new Date(Date.parse(row.startedAt) + offset).toISOString() })).join('\n') + '\n');
}

// nine-sessions.json (eleven sessions in three projects and one with none) with every directory moved onto the scratch
// repositories, the fixture's projects in order onto `repos` (a session's onto its project's), so no panel reads a real
// checkout of this machine.
function scenarioFile(repos: string[]): string {
  const raw = readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8');
  const data = JSON.parse(raw) as { projects: { id: string; directory: string }[]; sessions: { projectId: string | null; directory: string }[]; transcripts?: Record<string, string> };
  const moves: [string, string][] = [];
  const projectDir = new Map<string, string>();
  data.projects.forEach((project, i) => {
    const to = repos[i] ?? repos[0]!;
    moves.push([project.directory, to]);
    projectDir.set(project.id, to);
  });
  for (const session of data.sessions) moves.push([session.directory, session.projectId ? projectDir.get(session.projectId)! : repos[0]!]);
  let text = raw;
  for (const [from, to] of moves.sort((a, b) => b[0].length - a[0].length)) text = text.split(from).join(to);
  const moved = JSON.parse(text) as typeof data;
  for (const [id, path] of Object.entries(moved.transcripts ?? {})) if (!id.startsWith('_')) moved.transcripts![id] = join(REPO_ROOT, 'test/fixtures/shell', path);
  const path = join(SCRATCH, 'scenario.json');
  writeFileSync(path, JSON.stringify(moved, null, 2));
  return path;
}

// The engine store's trust for every scratch repository, keyed by its realpath: the everyday state. Git reads do not
// wait on it; it gates the pull request line's gh, the page's mutations and a session's start (services/sessions/trust.ts).
function trust(configDir: string) {
  mkdirSync(configDir, { recursive: true });
  const projects = Object.fromEntries(readdirSync(join(SCRATCH, 'repos')).map((name) => [join(SCRATCH, 'repos', name), { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }]));
  writeFileSync(join(configDir, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, projects }, null, 2)}\n`);
}

// A session the engine store lists: its first row only (the rig's way since the pin; c7-shots' too).
function seedSession(config: string, dir: string, engineId: string, title: string, at: string) {
  const project = join(config, 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const row = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: title }, uuid: `1${engineId.slice(1)}`, timestamp: at, cwd: dir, sessionId: engineId, version: '2.1.283' };
  writeFileSync(join(project, `${engineId}.jsonl`), `${JSON.stringify(row)}\n`);
}

// No gh on any PATH a launch's processes read (scm-scratch's `none` route): the pull request part and the card's PR row
// then say the same on every Mac, whatever gh this one has installed and signed in.
const EMPTY_BIN = join(SCRATCH, 'bin-empty');
const NO_GH_PATH = `${EMPTY_BIN}:/usr/bin:/bin:/usr/sbin:/sbin`;
function noGh({ shellHome }: { shellHome: string }) {
  for (const file of ['.zshrc', '.bash_profile']) appendFileSync(join(shellHome, file), `export PATH='${NO_GH_PATH}'\n`);
}

// A loopback port that refuses a connection, the same one on every run where it can be, so a before and an after draw one
// address. Not a low port such as 9: Chromium refuses those itself (ERR_UNSAFE_PORT, which draws the generic error page,
// never the refused one); a fixed high port checked to refuse, else one bound and closed (support/browser-server.ts).
const REFUSING_PORT = 47_913;
async function refusingPort(): Promise<number> {
  const refuses = await new Promise<boolean>((resolve) => {
    const socket = connect(REFUSING_PORT, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED'));
  });
  return refuses ? REFUSING_PORT : closedPort();
}

// ---- capture ---------------------------------------------------------------------------------------------------------
// The window at the rig's size, and every action bounded: `_electron.launch` makes its own context, which the words
// config's `use.actionTimeout` does not reach, so the context and the page are given the bound here (each launch calls
// this first), and a target that never matches fails its scene alone.
const ACTION_TIMEOUT = 15_000;
async function size(maws: MawsLaunch) {
  maws.app.context().setDefaultTimeout(ACTION_TIMEOUT);
  maws.page.setDefaultTimeout(ACTION_TIMEOUT);
  await maws.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())!.setContentSize(w, h), [W, H] as const);
  await expect.poll(() => maws.page.evaluate(() => [innerWidth, innerHeight])).toEqual([W, H]);
}
async function light(page: Page) {
  value(await invoke(page, 'settings.set', { theme: 'light' } as never));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}
async function dismissToasts(page: Page) {
  // the toast region's dismiss buttons: by their place, not their words
  for (let i = 0; i < 5; i++) {
    const buttons = page.locator('[data-toast-viewport] li > button:last-child:has(> span[aria-hidden])');
    if ((await buttons.count()) === 0) return;
    await buttons.first().click({ timeout: 2_000 }).catch(() => undefined);
  }
}
async function settle(page: Page, hover: boolean) {
  // a hover capture keeps the pointer where its step left it: toasts were dismissed before the step
  if (!hover) {
    await dismissToasts(page);
    await page.mouse.move(W - 2, H - 2);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => document.fonts.ready);
  // the screen's text unchanged across three reads 700 ms apart (at most 20 s): git reads, cards and lists have landed
  let last = '';
  let same = 0;
  for (let reads = 0; reads < 28 && same < 2; reads++) {
    await page.waitForTimeout(700);
    const text = await page.evaluate(() => document.body.innerText);
    same = text === last ? same + 1 : 0;
    last = text;
  }
  // finite animations finished, so a capture never lands mid-motion; spinners are frozen by the screenshot's own switch
  await page.evaluate(() => {
    for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
  });
  await page.waitForTimeout(700);
}

let notes: string[] = [];
// A wait whose target was read from master's source but never seen in a run: when it does not come, the capture is still
// taken and the scene's entry in _run.json carries the note, so a person checks that picture first.
async function soft(locator: Locator, what: string, timeout = 10_000) {
  if (!(await locator.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false))) notes.push(`not seen: ${what}`);
}

// One capture. `of` names another window's page (the presenter view's). `check` is what the capture is for (a tooltip,
// a note, a menu), required once the page has settled and right before the capture: a reveal that closed or never came
// leaves the scene not reached, never a picture of the row at rest under its name. `after` runs once the capture is taken.
// `last` is a step taken once the page has settled, right before the check: what lasts only a few seconds (a browser
// notice, a toast) is raised there, since the settling alone can outlast it.
type ShotOptions = { of?: () => Page; check?: () => Promise<void>; after?: () => Promise<void>; last?: () => Promise<void> };
async function shot(page: Page, meta: Meta, prepare: () => Promise<void>, { of, check, after, last }: ShotOptions = {}) {
  if (!wanted(meta.id)) return;
  META.push(meta);
  notes = [];
  clearPicture(meta.id); // a miss leaves no earlier run's picture under the scene's name
  try {
    if (meta.hover) await dismissToasts(page);
    // one more try after a failed step: a loaded Mac can take a press before its target has drawn
    await prepare().catch(async (first) => {
      console.log(`[words] ${meta.id}: retrying after ${whole(first)}`);
      await closeOverlays(page);
      await page.waitForTimeout(1500);
      notes = [];
      await prepare();
    });
    // M3's evidence, its own scenes and the carried ones, only from the checkout's own build (m3Build refuses another's)
    if (meta.round === 'm3' || M3_CARRIED.has(meta.id)) await m3Build(page);
    const target = of?.() ?? page;
    await settle(target, meta.hover === true);
    if (meta.round === 'm1') await expect(page.locator('[data-settings-dialog]'), 'Settings open').toBeVisible({ timeout: 3_000 });
    await last?.();
    await check?.();
    await target.screenshot({ path: join(OUT, `${meta.id}.png`), animations: 'disabled', caret: 'hide' });
    results.push({ id: meta.id, ok: true, ...(notes.length > 0 && { notes: [...notes] }) });
  } catch (error) {
    const message = notReached(error);
    results.push({ id: meta.id, ok: false, error: message });
    console.log(`[words] ${meta.id} not reached: ${message}\n${whole(error)}`);
  } finally {
    if (after) await after().catch((error: unknown) => console.log(`[words] ${meta.id} after:\n${whole(error)}`));
  }
}
// The whole of an error, its cause after it, for the console: a step that failed says all it knows, where _run.json
// keeps the short form.
function whole(error: unknown): string {
  const text = (e: unknown): string => stripVTControlCharacters(e instanceof Error ? (e.stack ?? e.message) : String(e));
  return error instanceof Error && error.cause !== undefined ? `${text(error)}\ncaused by: ${text(error.cause)}` : text(error);
}
// A step that stages a launch's state and failed: the whole error in the console, the scenes it was for not reached.
const setupFailed = (what: string, error: unknown) => console.log(`[words] ${what} failed:\n${whole(error)}`);
// Why a scene was not reached, as "<reason>: <what was found> · waiting for <locator>": a failed check's message (its
// first line), what Playwright received ("element(s) not found", a viewport ratio, an attribute), so a miss says which
// way it missed, and the locator it waited on (an assertion's `Locator:` line, else an action's first "waiting for"
// step), so a timed-out click says what it could not find.
function notReached(error: unknown): string {
  const lines = stripVTControlCharacters(error instanceof Error ? error.message : String(error)).split('\n');
  const reason = lines[0]!.trim();
  const log = lines.findIndex((line) => /^\s*Call log:/.test(line)); // Playwright's steps, past what it found
  const found = (log < 0 ? lines : lines.slice(0, log)).slice(1).map((line) => line.trim()).filter((line) => /^(Received|Error)\b/.test(line) || /failed$/.test(line));
  const named = lines.map((line) => line.trim()).find((line) => line.startsWith('Locator:'))?.slice('Locator:'.length).trim();
  const waited = lines.map((line) => /^\s*-\s*waiting for (.+)$/.exec(line)?.[1]?.trim()).find((locator) => locator !== undefined);
  const locator = named ?? waited;
  const said = found.length === 0 ? reason : `${reason}: ${found.join(' · ')}`;
  return (locator === undefined || said.includes(locator) ? said : `${said} · waiting for ${locator}`).slice(0, 800);
}
// ---- the word cut's M1: what waits for the pointer and the keyboard (ui/row-note.tsx, ui/tip.tsx) -------------------
// The m1 scenes' before is this rig, with its e2e support files, run against master's build (scenes.md). Master has no
// row notes, no tooltips on words, no "…" menus and no chevrons: what this branch keeps behind them is drawn at rest
// there. So each scene proves its named state on either build before its capture: on the cut's, the reveal itself (the
// owner's own tooltip, the row's own note, the row's own menu with its items, the chevron open); on master's, the words
// that reveal holds here, drawn at rest and in view. A scene that cannot prove it is not reached.
//
// Whether the build draws the cut's parts, read once, the first time Settings opens (settingsAt): a Settings row's note
// stays mounted at rest, so the open dialog holds one on this branch's build and none on master's. Every m1 capture
// requires Settings open (shot), so no check reads a lost dialog as master's.
let cut: boolean | null = null;
function cutBuild(): boolean {
  if (cut === null) throw new Error('the build is not known yet: Settings has not opened in this run');
  return cut;
}
async function learnBuild(page: Page) {
  await expect(page.locator('[data-settings-dialog] [data-settings-row]').first()).toBeAttached({ timeout: 10_000 });
  cut = (await page.locator('[data-settings-dialog] [data-row-note]').count()) > 0;
  console.log(`[words] this build ${cut ? 'draws' : 'does not draw'} the word cut's row notes`);
}
// Words of the Org page's copy that M1 added: absent from master's copy module, where the rig, run as the before, reads
// them as undefined (and a role query with no name would match any button). And two that M1 removed, which master's
// copy still has, read on master's build only.
const CUT_ORG: Partial<typeof ORG> = ORG;
const MASTER_ORG = ORG as typeof ORG & Partial<Record<'newDelegation' | 'enroll' | 'signs', string>>;
// Nothing pointed at and nothing focused, so what a scene opens opens from closed.
async function letGo(page: Page) {
  await page.mouse.move(W - 2, H - 2);
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.waitForTimeout(400);
}
// What a check requires on master's build: `rest`, the words drawn at rest, inside the viewport (its first drawn match:
// the same words can also stand in a hidden description).
const inView = (rest: Locator, what: string) => expect(rest.filter({ visible: true }).first(), what).toBeInViewport({ timeout: 3_000 });
// A copy template's words as a pattern, from the template called with HOLE for each text and COUNT for each number: what
// a run fills in (a time, a pid, a machine) is unknown here, the words around it are the build's own.
const HOLE = '\u0001';
const COUNT = 4_242_424;
const shaped = (...rendered: string[]) =>
  new RegExp(rendered.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(HOLE, '.+').replaceAll(String(COUNT), '\\d+')).join('|'));
// A word's or a glyph's tooltip, shown as the keyboard shows it: by focus. The owner is brought into view first and
// left to settle (a scroll closes an open tooltip). On master's build the words the tooltip holds here, `rest`, are
// brought into view instead. `cutOf` says whether the build has the cut the tooltip belongs to (M1's by default; the
// m2 scenes pass `m2Cut`).
async function focusTip(page: Page, owner: Locator, rest: Locator, cutOf: () => boolean = cutBuild) {
  if (!cutOf()) return rest.first().scrollIntoViewIfNeeded({ timeout: 10_000 });
  await owner.first().scrollIntoViewIfNeeded({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await owner.first().focus();
}
// The check that `trigger`'s own tooltip is open: the element the tip wraps (the focused word or control, or the label
// around a box) reads open to Radix, and a tooltip is drawn (one shows at a time). On master's, `rest` in view.
const tipShown = (page: Page, trigger: Locator, what: string, rest: Locator, cutOf: () => boolean = cutBuild) => async () => {
  if (!cutOf()) return inView(rest, `master’s words for the tooltip of ${what}`);
  await expect(trigger.first(), `the tooltip of ${what}`).toHaveAttribute('data-state', /^(delayed|instant)-open$/, { timeout: 3_000 });
  await expect(page.getByRole('tooltip').first(), `the tooltip of ${what}`).toBeVisible({ timeout: 3_000 });
};
// The check that the row `scope` names has its own note open; on master's, the row's line at rest (a declared row's
// `data-settings-note`, else the row, whose plain note master draws in it) in view.
const noteShown = (scope: Locator, what: string) => async () => {
  if (cutBuild()) return void (await expect(scope.locator('[data-row-note][data-open]').first(), `the note of ${what}`).toBeVisible({ timeout: 3_000 }));
  const line = scope.locator('[data-settings-note]');
  await inView((await line.count()) > 0 ? line : scope, `master’s line of ${what}`);
};
// The checks that the keyboard is inside `scope`, and that the pointer is on it (either build).
const focusIn = (scope: Locator, what: string) => () =>
  expect.poll(() => scope.first().evaluate((el) => el.contains(document.activeElement)), { message: `${what} holds the keyboard`, timeout: 3_000 }).toBe(true);
const pointedAt = (scope: Locator, what: string) => () => expect.poll(() => scope.first().evaluate((el) => el.matches(':hover')), { message: `the pointer on ${what}`, timeout: 3_000 }).toBe(true);
const checks =
  (...all: (() => Promise<unknown>)[]) =>
  async () => {
    for (const check of all) await check();
  };
// A row's "…" menu opened as a person opens it. Master's build has no menus: the same actions are buttons on the row,
// captured with the row in view.
async function openMenu(row: Locator, trigger: Locator) {
  await row.first().scrollIntoViewIfNeeded({ timeout: 10_000 });
  if (cutBuild()) await trigger.first().click();
}
// The check that the menu `trigger` opened is open (Radix names it by its trigger) and offers `items`; on master's, each
// item a button in `rest`, in view.
const menuShows = (page: Page, trigger: Locator, items: string[], rest: Locator) => async () => {
  if (!cutBuild()) {
    for (const item of items) await inView(rest.getByRole('button', { name: item, exact: true }), `${item} on master’s row`);
    return;
  }
  const opened = page.getByRole('menu', { name: (await trigger.first().getAttribute('aria-label'))!, exact: true });
  await expect(opened, 'the row’s menu').toBeVisible({ timeout: 3_000 });
  for (const item of items) await expect(opened.getByRole('menuitem', { name: item, exact: true })).toBeVisible({ timeout: 3_000 });
};
// A row's "…" menu closed with the one Esc that is its own (the Settings dialog under it stays).
async function closeMenu(page: Page) {
  if (await page.getByRole('menu').count()) await page.keyboard.press('Escape');
}

// ---- the word cut's M2: the conversation and the message box ---------------------------------------------------------
// The m2 scenes' before is this rig, with its e2e support files, run against master's build, as the m1 scenes' is
// (scenes.md). Each proves its named state on either build before its capture: on M2's build the reveal itself (the
// owner's own tooltip open, the fold open, the actions a pointer draws) and the state it is named for; on master's,
// the same state in master's terms, the words master draws at rest in that place, in view.
//
// Whether the build has M2's cut, read once, the first time a message box draws (m2Build): the box's microphone is
// named Dictate on both builds (composer/dictation/MicControl.tsx: master's literal, this branch's MIC), and only
// master's carries a system `title` (master's composer/dictation/copy.ts, micTitle: "Click to dictate · on this Mac"),
// never empty; M2 made it a named glyph whose word is a Tip (C32), with no `title`. Every session not held by a terminal
// draws a message box, so a scene that needs the build opens one before it reads.
//
// The rig's imports from src/ resolve to the checkout's own modules: in the before (master's checkout with only this
// file and e2e/support taken from this branch) they are master's, so a word M2 added or changed is absent or master's
// there. The m2 checks therefore find their targets by data attributes, roles and places; where one needs a word of a
// renderer module this rig cannot import (one that loads the renderer), the word is written below with its source, as
// each build has it, and read by the build.
//
// The build must be the checkout's (fix wave, scalpel-5#3): out/ restored from a cache keyed elsewhere could be the other
// side's. The checkout says which side it is by a module M2 added (composer/copy.ts, absent from master's tree), and a
// build that draws the other side is refused, every m2 scene then not reached with why.
let cut2: boolean | null = null;
let cut2Refused: string | null = null;
const MIC = '[data-composer] [role="toolbar"] button[aria-label="Dictate"]';
const M2_SOURCE = 'src/renderer/src/composer/copy.ts';
async function m2Build(page: Page): Promise<boolean> {
  if (cut2 === null && cut2Refused === null) {
    const mic = page.locator(MIC).first();
    await expect(mic, 'a message box’s microphone, which says the build').toBeAttached({ timeout: 15_000 });
    const drawn = (await mic.getAttribute('title')) === null;
    const source = existsSync(join(REPO_ROOT, M2_SOURCE));
    const head = headCommit();
    if (CACHE_KEY !== null && !head.startsWith(CACHE_KEY)) cut2Refused = `out/ came from the build cache under key ${CACHE_KEY}, not this checkout's commit ${head}`;
    else if (drawn === source) cut2 = drawn;
    else cut2Refused = `out/ is not this checkout's build: it ${drawn ? 'draws' : 'does not draw'} the word cut's M2, and the checkout ${source ? 'has' : 'lacks'} ${M2_SOURCE}`;
    console.log(`[words] ${cut2Refused ?? `this build ${drawn ? 'draws' : 'does not draw'} the word cut's M2 (the microphone ${drawn ? 'has no' : 'has its'} system title)`}`);
  }
  if (cut2Refused !== null) throw new Error(cut2Refused);
  return cut2!;
}
function m2Cut(): boolean {
  if (cut2 === null) throw new Error('the build is not known yet: no message box has drawn in this run');
  return cut2;
}
// Master's last line under a new chat's model list (master's widgets/copy.ts, MODEL.unstarted), which P555 cut
const MASTER_MODEL_UNSTARTED = 'Applies when the session starts';
// widgets/copy.ts's words the checks read (that module loads the renderer's statusline), each build's own: the agents
// dialog's empty line (AGENTS.none, the same on both), and the + menu's Connectors line for a session not running and
// for a running one reporting none (CONNECTOR_MENU.notRunning, .noneReported; P579, P578)
const AGENTS_NONE = 'No agents in the catalogue';
const CONNECTORS_LINE = {
  notRunning: { m2: 'Session not running', master: 'Live details are unavailable until this session is running' },
  noneReported: { m2: 'No connectors', master: 'No connectors reported by this session' },
};
const byBuild = (words: { m2: string; master: string }) => (m2Cut() ? words.m2 : words.master);
// The + submenus' two last items, each build's (C18): M2's composer/copy.ts PLUS_MENU (a module master lacks, so its
// words are written here), master's composer/plus-menu/PlusMenu.tsx literals
const SUBMENU_TAIL = (label: 'Connectors' | 'Plugins'): [string, string] => (m2Cut() ? ['In this chat…', 'Manage…'] : [`${label} in this chat…`, `Manage ${label.toLowerCase()}…`]);
// The + menu's Connectors or Plugins submenu opened, as a person opens it (composer/plus-menu/PlusMenu.tsx: each a
// submenu trigger named by its label, the same literal on both builds, whose menu Radix names by that trigger). Its
// scenes are hover captures: the pointer stays on the trigger. A pointer moved off a submenu's trigger other than
// toward the submenu hands the keyboard back to the parent menu, and that focus outside closes the submenu (Radix's
// MenuSubContent), which is how the capture's usual move to the window's corner lost it.
const PLUS = '[data-composer] [role="toolbar"] button[aria-haspopup="menu"]';
async function plusSubmenu(page: Page, label: 'Connectors' | 'Plugins') {
  await box(page).click();
  await pane(page).locator(PLUS).first().click();
  await expect(page.getByRole('menu').first()).toBeVisible({ timeout: 5_000 });
  await page.getByRole('menu').first().getByRole('menuitem', { name: label, exact: true }).click();
  await expect(page.getByRole('menu', { name: label, exact: true })).toBeVisible({ timeout: 5_000 });
}
// The check that the submenu named `label` is open and holds `rows` or, with none, the line `empty`, then its two last
// items in order, worded per build (SUBMENU_TAIL). On M2 a row is named by its
// name alone (C17: master's "Loaded" beside each plugin is cut), so a row still carrying it fails there; master's rows
// carry it and are found by their name within it.
const submenuHolds = (page: Page, label: 'Connectors' | 'Plugins', rows: readonly string[], empty: (() => string) | null) => async () => {
  const sub = page.getByRole('menu', { name: label, exact: true });
  const items = sub.getByRole('menuitem');
  await inView(sub, `the ${label} submenu`);
  await expect(items, `the ${label} submenu’s items`).toHaveCount(rows.length + 2, { timeout: 3_000 });
  for (const row of rows) await inView(m2Cut() ? sub.getByRole('menuitem', { name: row, exact: true }) : items.filter({ hasText: row }), `its row ${row}`);
  if (empty !== null) await inView(sub.getByText(empty(), { exact: true }), `its line ${empty()}`);
  const [inThisChat, manage] = SUBMENU_TAIL(label);
  await expect(items.nth(rows.length).locator('span').first(), `its next-to-last item ${inThisChat}`).toHaveText(inThisChat, { timeout: 3_000 });
  await expect(items.nth(rows.length + 1), `its last item ${manage}`).toHaveText(manage, { timeout: 3_000 });
};
// A row of the virtual transcript brought into view: the list mounts only the rows near its window, so it is read from
// the top down, most of a window at a time, until the row is mounted, then the row is scrolled to.
async function seek(page: Page, target: Locator) {
  await toTop(page);
  for (let step = 0; step < 60 && (await target.count()) === 0; step++) {
    const end = await scroller(page).evaluate((el) => {
      const before = el.scrollTop;
      el.scrollTop = before + el.clientHeight * 0.75;
      el.dispatchEvent(new Event('scroll'));
      return el.scrollTop === before;
    });
    await page.waitForTimeout(300);
    if (end) break;
  }
  await target.first().scrollIntoViewIfNeeded({ timeout: 5_000 });
  await page.waitForTimeout(500);
}
// The check that what a pointer or focus draws (an element at opacity 0 at rest on M2's build) is drawn; on master's
// build it is drawn at rest, so the same check holds there.
const drawn = (target: Locator, what: string) => () => expect(target.first(), what).toHaveCSS('opacity', '1', { timeout: 3_000 });

// ---- the word cut's M3: the panels beside the conversation -----------------------------------------------------------
// The m3 scenes' before is this rig, with its e2e support files, run against master's build, as the m1 and m2 scenes'
// is (scenes.md). Each proves its named state on either build before its capture: on M3's build the reveal (a tooltip
// of the control holding the keyboard, a menu, a notice) and the state it is named for; on master's, the same state in
// master's terms, what master draws there at rest, in view.
//
// Whether the build has M3's cut, read once, the first time a scene asks (m3Build), from what the window loaded: M3's
// touch rule (ui/touch-fact.tsx, task 1) put one unlayered `[data-touch-fact]` rule into the app's stylesheet
// (styles/app.css), which master's stylesheet has nowhere. The checkout says which side it is by that module, absent
// from master's tree, and a build that draws the other side is refused (the m2 check's rule), every m3 scene then not
// reached with why.
let cut3: boolean | null = null;
let cut3Refused: string | null = null;
const M3_SOURCE = 'src/renderer/src/ui/touch-fact.tsx';
async function m3Build(page: Page): Promise<boolean> {
  if (cut3 === null && cut3Refused === null) {
    const drawn = await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('[data-touch-fact]'));
        } catch {
          return false; // a sheet of another origin (none in the app) says nothing
        }
      }),
    );
    const source = existsSync(join(REPO_ROOT, M3_SOURCE));
    const head = headCommit();
    if (CACHE_KEY !== null && !head.startsWith(CACHE_KEY)) cut3Refused = `out/ came from the build cache under key ${CACHE_KEY}, not this checkout's commit ${head}`;
    else if (drawn === source) cut3 = drawn;
    else cut3Refused = `out/ is not this checkout's build: its stylesheet ${drawn ? 'has' : 'lacks'} the touch rule, and the checkout ${source ? 'has' : 'lacks'} ${M3_SOURCE}`;
    console.log(`[words] ${cut3Refused ?? `this build ${drawn ? 'draws' : 'does not draw'} the word cut's M3 (the touch rule's stylesheet rule ${drawn ? 'present' : 'absent'})`}`);
  }
  if (cut3Refused !== null) throw new Error(cut3Refused);
  return cut3!;
}
function m3Cut(): boolean {
  if (cut3 === null) throw new Error('the build is not known yet: no m3 scene has read it in this run');
  return cut3;
}
// Words of renderer modules the e2e project does not list (tsconfig.e2e.json), written here with their source, each as
// its build has it
const M3_WORDS = {
  artifacts: 'Artifacts', // tools/artifacts/copy.ts ARTIFACTS_TOOL_COPY.title, the same on both builds
  back: { m3: 'Back to list', master: 'Back' }, // ARTIFACTS_TOOL_COPY.back: M3's chevron's name (T556), master's word
  pinTab: { m3: 'Pin tab', master: 'Keep open for every session' }, // panel/copy.ts COPY.pinTab (P8); master's panel/SurfaceRow.tsx literal
  openSurface: 'Open surface', // master's panel/copy.ts COPY.openSurface, which M3 removed (P9)
  side: 'Side', // side/copy.ts SIDE_COPY.pane.title, the same on both builds
  binaryFile: 'Binary file', // tools/code/copy.ts REVIEW_COPY.binaryFile, the same on both builds
  source: 'Source', // tools/code/copy.ts VIEWER_COPY.source, a markdown file's Source view (the one that edits), the same on both builds
  engine: 'Engine', // tools/session-info/copy.ts INFO.sections.engine, the group holding the Browser tabs row; M3 folds it (T252)
  latest: '· latest', // tools/scm/copy.ts SCM_COPY.latest, the Commits heading with no base, the same on both builds
  save: 'Save', // tools/code/copy.ts EDITOR_COPY's save, compare and reload, the same on both builds
  compare: 'Compare',
  reload: 'Reload',
  // shared/keymap/actions.ts's titles of the two surfaces M3 renamed (N156, N157); the checkout's ACTIONS must match its build
  agentsTitle: { m3: 'Agents', master: 'Subagents' },
  backgroundTitle: { m3: 'Background', master: 'Background tasks' },
  // tools/browser/copy.ts's find count (T454, T455): M3's shown numbers (its words for a screen reader beside them)
  findCount: { m3: '1 / 3', master: '1 / 3 results' },
  findNone: { m3: '0', master: '0 results' },
  // tools/browser/chrome/Notices.tsx's lines for the page cap (T462, T463) and an agent's download (T467), as launch 11 sends them
  capClosed: { m3: 'Closed: too many pages open', master: 'At most 8 pages stay loaded at once, so a tab was left unloaded' },
  capOptions: { m3: 'Too many pages are loaded to open uBlock Origin’s options', master: 'At most 8 pages stay loaded at once, so the options of uBlock Origin could not open' },
  downloadRefused: { m3: 'Blocked a download the agent started', master: 'A download the agent started was refused; downloads are yours to start' },
  // tools/maws/ask/copy.ts SHEET (T292): the resting line, and master's line under it, which M3 cut
  questionsRest: 'No open questions',
  questionsDetail: 'When the agent asks you something, it shows here.',
  // side/copy.ts SIDE_COPY.pane.empty (P419)
  sideEmpty: { m3: 'Comment on a line to start a thread.', master: 'No side threads yet. Comment on a line, or type /btw in the composer.' },
  // channel/copy.ts (P447, P448): M3 names a fold's count "<n> messages"; master says "<n> messages between", "<n> messages from" and "to everyone"
  channelMessages: (n: number) => `${n} messages`,
  channelBetween: (n: number) => `${n} messages between`,
  channelFrom: (n: number) => `${n} messages from`,
  toEveryone: 'to everyone',
};
const byM3 = (words: { m3: string; master: string }) => (m3Cut() ? words.m3 : words.master);
// The check that `owner`'s own tooltip is open on M3's build (the owner holding the keyboard); on master's, `rest`, what
// master draws in its place, in view.
const tip3 = (page: Page, owner: Locator, what: string, rest: Locator) => checks(() => (m3Cut() ? focusIn(owner, what)() : Promise.resolve()), tipShown(page, owner, what, rest, m3Cut));
// A main-side event as main sends it to the window (main/ipc/events.ts: `maws:evt:<name>`, no machine argument, which
// the renderer reads as this Mac's), for a state only main's own limits produce: the browser's notices of a page cap.
async function emitToWindow(app: ElectronApplication, name: string, payload: unknown) {
  await app.evaluate(({ BrowserWindow }, [channel, value]) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel as string, value);
  }, [`maws:evt:${name}`, payload] as const);
}

// A scene of the pin's manifest whose surface the UX wave removed: kept in _run.json, never captured.
function gone(meta: Meta, why: string) {
  if (!wanted(meta.id)) return;
  META.push(meta);
  clearPicture(meta.id);
  results.push({ id: meta.id, ok: false, error: `no target on master: ${why}` });
}
// A scene whose state no launch of this rig reaches on the build (scenes.md says why): kept in _run.json, never captured.
function unreachable(meta: Meta, why: string) {
  if (!wanted(meta.id)) return;
  META.push(meta);
  clearPicture(meta.id);
  results.push({ id: meta.id, ok: false, error: `not reachable in this rig: ${why}` });
}
// An earlier run's picture of a scene this run takes again, gone before the scene starts (fix wave, scalpel-5#1)
const clearPicture = (id: string) => rmSync(join(OUT, `${id}.png`), { force: true });
// The scenes that existed before M3 and show its surfaces (scenes.md, "Existing scenes that show M3's surfaces"): M3's
// evidence as much as its own `m3-` scenes, so each is refused on a build that is not the checkout's (fix wave,
// scalpel-5#3), as an m3 scene is
const M3_CARRIED = new Set([
  'panel-session-info', 'session-terminal-held-info', 'session-running-cards', 'r2-cards-unfolded', 'r2-run-cards', 'panel-subagents-tools-session', 'r2-subagents-finished',
  'r2-subagent-page', 'r2-run-subagents', 'r2-run-subagent-page', 'panel-background', 'r2-run-background', 'r2-run-background-shell', 'm0-tasks', 'panel-source-control',
  'panel-review', 'm0-scm-commit-review', 'panel-files', 'm0-files-nomatch', 'm0-file-beside-chat', 'm0-file-outside', 'm0-tab-menu', 'r2-browser-blank', 'r2-browser-failed',
  'm0-browser-options', 'm0-browser-suggestions', 'r2-disk-tohuman', 'panel-subagents', 'm0-subagents-stopped', 'm0-background-stopped', 'm0-background-workflow',
  'm0-background-scheduled', 'm0-scm-behind', 'm0-scm-conflict', 'm0-review-staged', 'm0-files-goto', 'm0-browser-find', 'm0-browser-profile', 'm1-settings-browser-imported',
  'r2-palette', 'r2-shortcuts',
]);

// Escape only while an overlay is open. Since the UX wave's U1b, Escape on a waiting request's row (or on nothing while
// its pane holds the keyboard) denies the request (request-card/prompt-guard.ts), so a bare Escape could answer one.
// The pointer is moved aside first: what it holds open (a sidebar row's hover card, a tooltip) closes on its own once it
// leaves, and the wait lets it go before anything is counted as open.
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';
async function closeOverlays(page: Page) {
  await pointerAside(page);
  if ((await page.locator(OVERLAY).count()) > 0) await page.waitForTimeout(300);
  for (let i = 0; i < 4 && (await page.locator(OVERLAY).count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}
// The pointer at a neutral spot: inside the transcript pane by its right edge, away from the sidebar (the window's corner
// when no transcript is drawn). A click on a sidebar row leaves the pointer on the row, whose hover card
// (sidebar/HoverCard.tsx: open after 300 ms of hover, closed 150 ms after the pointer leaves) is drawn over the main
// area and takes the next click there; a click Playwright finds covered never moves the pointer, so the card stays.
async function pointerAside(page: Page) {
  const at = await scroller(page).boundingBox({ timeout: 1_000 }).catch(() => null);
  if (at) await page.mouse.move(at.x + at.width - 6, at.y + Math.min(at.height / 2, 240));
  else await page.mouse.move(W - 2, H - 2);
}
// back to a known place: no dialog, no menu, no page
async function reset(page: Page) {
  await closeOverlays(page);
  const back = page.locator('[data-toolbar] [data-page-title] button').first();
  if (await page.locator('[data-region="page"]').count()) await back.click({ timeout: 2_000 }).catch(() => undefined);
  await page.waitForTimeout(200);
}
const sidebar = (page: Page) => page.locator('[data-region="sidebar"]');
const pane = (page: Page) => page.locator('[data-region="main"] [data-pane="0"]');
const box = (page: Page) => pane(page).locator('[data-composer] [contenteditable="true"]').first();
const cards = (page: Page) => page.locator('[data-region="main"] [data-region="cards"]:not([inert])');
// The sidebar's destinations by place, never by name: the first nav's own buttons are New chat, Projects, Artifacts,
// Customize (sidebar/Sidebar.tsx). Artifacts also has a menu id (View › Artifacts), which the rig uses.
async function destination(page: Page, which: 'projects' | 'customize') {
  await sidebar(page).locator('nav').first().locator(':scope > button').nth(which === 'projects' ? 1 : 3).click();
  await expect(page.locator('[data-region="page"]')).toBeVisible();
}
async function library(app: ElectronApplication, page: Page) {
  if ((await page.locator('[data-library]').count()) === 0) await menu(app, 'artifacts.open');
  await expect(page.locator('[data-library]')).toBeVisible({ timeout: 15_000 });
}
async function openSession(page: Page, appId: string, away?: string) {
  await (await sidebarRow(page, { appSessionId: appId })).click();
  await pointerAside(page); // before the row's hover card opens over the transcript
  await expect(pane(page)).toBeAttached();
  await page.waitForTimeout(500);
  if (away) await gitLanded(page, appId, away);
}
// The Environment card's git read has a time budget (services/command-budgets.ts) that a loaded machine can miss, and
// the card then says git is unavailable. The change line appears once git answered; when it has not within 15 s, the
// session is left for another and opened again, which makes a new read (twice at most).
async function gitLanded(page: Page, appId: string, away: string) {
  const line = page.locator('[data-region="main"] [data-testid="change-line"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await line.first().isVisible({ timeout: 15_000 }).catch(() => false)) return;
    if (attempt === 2) return;
    await (await sidebarRow(page, { appSessionId: away })).click();
    await page.waitForTimeout(1500);
    await (await sidebarRow(page, { appSessionId: appId })).click();
    await pointerAside(page);
  }
}
// A side surface in view. The `surface.<id>` menu item toggles (panel/SurfaceRow.tsx), so it is pressed only when the
// surface is not already in front.
const surface = (page: Page, id: string) => page.locator(`[data-region="panel"]:not([inert]) [data-surface="${id}"]`);
async function sideSurface(app: ElectronApplication, page: Page, id: string) {
  if (!(await surface(page, id).isVisible().catch(() => false))) await menu(app, `surface.${id}`);
  await expect(surface(page, id)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
}
// The cards beside the conversation, each open (panel/summary/FloatingCard.tsx: section > h3 > button). The first folded
// card each time: the folded set shrinks with each press, so its matches listed once (`all()`, which indexes them) skip
// every other card.
async function unfoldCards(page: Page) {
  await expect(cards(page)).toBeVisible({ timeout: 10_000 });
  const folded = cards(page).locator('section > h3 > button[aria-expanded="false"]');
  for (let i = 0; i < 8 && (await folded.count()) > 0; i++) await folded.first().click();
  await page.waitForTimeout(600);
}
// The Files surface's tree: Go to file's field emptied, since a query left in it from an earlier scene (m0-files-goto,
// m0-files-nomatch) draws the finder's list in the tree's place (files/FinderView.tsx), and no tree row is mounted
const filesTree = async (page: Page) => {
  const filter = surface(page, 'files').locator('[data-files-filter]').first();
  if ((await filter.inputValue({ timeout: 2_000 }).catch(() => '')) !== '') await filter.fill('');
};
// A row of the Files tree by its path, never the Changed group's row of the same path (files/FilesTool.tsx's
// ChangedItem, `data-changed-row`), which is drawn above the tree, is never a folder to open, and holds an untracked
// folder's path too
const treeItem = (page: Page, path: string) => surface(page, 'files').locator(`[role="treeitem"][data-path="${path}"]:not([data-changed-row])`).first();
async function settingsAt(app: ElectronApplication, page: Page, section: string) {
  if ((await page.getByRole('dialog').locator(`#settings-${section}`).count()) === 0) {
    await reset(page);
    await menu(app, 'settings.open');
  }
  const heading = page.locator(`#settings-${section}`);
  await expect(heading).toBeAttached({ timeout: 10_000 });
  if (cut === null) await learnBuild(page);
  await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
}
// Customize (U11: one page, My items or Discover, a Show filter over plugins, skills and connectors; CustomizeHead.tsx).
// Its controls by place: the view switch's radios run My items, Discover; Show's run all, plugins, skills, connectors.
const custom = (page: Page) => page.locator('[data-region="page"] [data-customize-page]');
const VIEWS = ['mine', 'discover'] as const;
const SHOWS = ['all', 'plugins', 'skills', 'connectors'] as const;
async function customizeAt(page: Page, view: (typeof VIEWS)[number], show: (typeof SHOWS)[number]) {
  if ((await custom(page).count()) === 0) await destination(page, 'customize');
  const head = custom(page).locator('[data-customize-header]');
  await head.locator('[data-customize-row="view"] select').first().selectOption(''); // the place: User configuration
  await head.locator('[data-customize-row="view"] [role="radiogroup"]').first().locator('[role="radio"]').nth(VIEWS.indexOf(view)).click();
  await head.locator('[data-customize-row="show"] [role="radiogroup"]').first().locator('[role="radio"]').nth(SHOWS.indexOf(show)).click();
  await expect(custom(page)).toHaveAttribute('data-customize-view', view);
  await expect(custom(page)).toHaveAttribute('data-customize-show', show);
  await page.waitForTimeout(1500);
}
// A typed command: the palette's highlighted row is the command (its name, not the app's copy) before Enter, so a
// ranking difference cannot open another widget. `rest` is typed after the command (its arguments).
async function typed(page: Page, command: string, rest = '') {
  await box(page).click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(`/${command}`);
  await expect(page.locator('[role="listbox"] [role="option"][aria-selected="true"]').first()).toContainText(`/${command}`, { timeout: 10_000 });
  if (rest) await page.keyboard.type(` ${rest}`);
  await page.keyboard.press('Enter');
}
const dialogOf = (page: Page, command: string) => page.locator(command === 'model' ? '[data-widget="model"]' : `[data-widget-dialog="${command}"]`).first();
// The scenario's widget backend (MAWS_WIDGET_BACKEND=fixtures, main's globalThis.__maws_widget_backend) answers one
// read as given until the returned undo runs (test/support/widget-backend.ts, `script`).
type Backend = { script(command: string, answer: () => unknown): () => void; answer(command: string, input: unknown): Promise<unknown> };
async function scriptRead(app: ElectronApplication, command: string, answer: unknown) {
  await app.evaluate((_, [c, a]) => {
    const g = globalThis as unknown as { __maws_widget_backend: Backend; __words_undo?: (() => void)[] };
    (g.__words_undo ??= []).push(g.__maws_widget_backend.script(c as string, () => a));
  }, [command, answer] as const);
}
async function unscriptReads(app: ElectronApplication) {
  await app.evaluate(() => {
    const g = globalThis as unknown as { __words_undo?: (() => void)[] };
    for (const undo of g.__words_undo?.splice(0) ?? []) undo();
  });
}
const recorded = (fixture: string, seq: number) =>
  (readFileSync(join(REPO_ROOT, fixture), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { seq: number; frame: { response: { response: unknown } } }).find((row) => row.seq === seq)!).frame.response.response;

test.beforeAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(join(SCRATCH, 'home'), { recursive: true });
  mkdirSync(EMPTY_BIN, { recursive: true });
  mkdirSync(OUT, { recursive: true });
});
// One folder holds one build's pictures (fix wave, scalpel-5#1). Each result carries the build it was taken from (its
// commit and out/'s digest); a later run of the same build into the folder (a WORDS_ONLY rerun) keeps the scenes it did
// not take again, and a run of another build moves every earlier result it did not take again, and its picture, aside:
// the result under `stale` in _run.json, the picture under _stale/<build>/, so nothing another build drew reads as this
// one's.
type Result = (typeof results)[number] & { build?: string };
test.afterAll(() => {
  const all = JSON.parse(existsSync(join(OUT, '_run.json')) ? readFileSync(join(OUT, '_run.json'), 'utf8') : '{"results":[],"screens":[]}') as { results: Result[]; screens: Meta[]; runs?: Run[]; stale?: Result[] };
  const identity = buildIdentity();
  const build = `${identity.commit.slice(0, 12)}-${identity.out.slice(0, 12)}`;
  const fresh: Result[] = results.map((result) => ({ ...result, build }));
  const untaken = all.results.filter((old) => !fresh.some((f) => f.id === old.id));
  const stale = untaken.filter((old) => old.build !== build);
  for (const old of stale) {
    const picture = join(OUT, `${old.id}.png`);
    if (!existsSync(picture)) continue;
    const aside = join(OUT, '_stale', old.build ?? 'unknown');
    mkdirSync(aside, { recursive: true });
    renameSync(picture, join(aside, `${old.id}.png`));
  }
  const kept = [...untaken.filter((old) => old.build === build), ...fresh];
  const screens = [...all.screens.filter((o) => !META.some((f) => f.id === o.id)), ...META].filter((screen) => kept.some((result) => result.id === screen.id));
  const run: Run = { at: new Date().toISOString(), ...identity, m1: cut, m2: cut2, m3: cut3, scenes: results.map((result) => result.id) };
  writeFileSync(join(OUT, '_run.json'), JSON.stringify({ results: kept, screens, runs: [...(all.runs ?? []), run], stale: [...(all.stale ?? []), ...stale] }, null, 2));
});
// What each run into the folder photographed (fix wave, scalpel-5#3), so a before and an after taken from one out/ (a
// build restored twice from scripts/e2e-build.sh's cache) show as one build: the checkout's commit, the tracked files
// it changed (the before's rig and e2e/support, taken from the branch), a digest of out/'s files, the cache key out/
// came under, and which cut each build check read (null where no scene read it). An m2 scene refuses a cached out/
// whose key is not the checkout's commit (m2Build).
type Run = { at: string; commit: string; changed: string[]; out: string; cacheKey: string | null; m1: boolean | null; m2: boolean | null; m3: boolean | null; scenes: string[] };
// The key out/ was restored or stored under when scripts/e2e-build.sh's cache was on (the commit that built it), else
// null: out/ was built from this checkout
const CACHE_KEY = process.env.MAWS_E2E_BUILD_CACHE && process.env.MAWS_E2E_BUILD_KEY ? process.env.MAWS_E2E_BUILD_KEY : null;
const headCommit = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
function buildIdentity(): Pick<Run, 'commit' | 'changed' | 'out' | 'cacheKey'> {
  const inRepo = (...args: string[]) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const out = join(REPO_ROOT, 'out');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]));
  const digest = createHash('sha256');
  for (const file of files(out).sort()) digest.update(`${file.slice(out.length)}\0${createHash('sha256').update(readFileSync(file)).digest('hex')}\n`);
  const changed = inRepo('status', '--porcelain', '--untracked-files=no').split('\n').filter((line) => line !== '').map((line) => line.slice(3));
  return { commit: headCommit(), changed, out: digest.digest('hex'), cacheKey: CACHE_KEY };
}

const BASE_ENV = (extra: Record<string, string>) => ({
  MAWS_HARNESS: '0',
  MAWS_E2E_FOREGROUND: '0',
  MAWS_MACHINE_NAME: 'studio',
  HOME: join(SCRATCH, 'home'),
  ...extra,
});
const REPOS = ['MAWS', 'orbit', 'ledger', 'stages'] as const;

// ======================================================================================================================
// Launch 1: the scenario (eleven sessions, three waiting on the person), on a manual clock, with the plugin CLI stub as
// the engine, the widget backend's recorded reads, and the catalog's recorded sources (Discover with no network).
// ======================================================================================================================
test('scenario: sidebar, Overview, waiting sessions, pages, Customize, Settings, typed dialogs', async () => {
  test.setTimeout(1_200_000);
  const repos = REPOS.slice(0, 3).map((name) => makeRepo(name));
  const scenario = scenarioFile(repos);
  const usage = usageFixture();
  // the engine CLI's plugin commands answered by the repository's stub, in the owner-shaped state its fixture describes
  // (a scenario has no engine to ask, and the replay engine refuses a real invocation)
  mkdirSync(join(SCRATCH, 'elsewhere'), { recursive: true });
  mkdirSync(join(SCRATCH, 'profile-scenario'), { recursive: true });
  const cli = writePluginCliStub(join(SCRATCH, 'profile-scenario'), ownerShapedState(repos[0]!, join(SCRATCH, 'elsewhere')));
  // a fixed profile folder, so the paths Settings prints (the engine store) are the same on every run
  const maws = await launchMaws({
    userData: join(SCRATCH, 'profile-scenario'),
    prepare: ({ claudeConfigDir }) => trust(claudeConfigDir),
    env: BASE_ENV({ MAWS_SESSION_SOURCE: `stub:${scenario}`, MAWS_SCENARIO_CLOCK: 'manual', MAWS_CLAUDE_USAGE_DIR: usage, MAWS_WIDGET_BACKEND: 'fixtures', MAWS_E2E_ENGINE_BIN: cli.bin, MAWS_CATALOG_FIXTURES: join(REPO_ROOT, 'e2e/fixtures/catalog') }),
  });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    await expect(sidebar(page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await dismissToasts(page);

    // `unopened`: a session with an engine status the rig never opens before m0-dialog-agents-none (nine-sessions.json's
    // `engine` holds ready statuses for seven sessions only; the widget backend answers for those alone)
    const SID = { approval: 'app-3eb04b84', question: 'app-d095dc75', plan: 'app-bac6130b', running: 'app-9a1d4262', terminal: 'app-466b0d0d', idle: 'app-7412a115', unopened: 'app-3d334c38' };

    // before any session is opened: the empty main area, then New chat with no session in front (U13a)
    await shot(page, m0({ id: 'm0-empty-main', title: 'The main area with no tab open', how: 'Launch the app on a fresh profile', state: 'No session opened yet: the main area’s empty state with New chat', folders: ['main', 'shell', 'sidebar'] }), async () => {
      await expect(page.locator('[data-region="main"]')).toBeVisible();
    });
    await shot(page, m0({ id: 'm0-new-chat-unplaced', title: 'New chat with no session in front', how: 'File › New chat (⌘N) before any session is opened', state: 'An empty new chat that has not chosen its project yet', folders: ['composer', 'session', 'destination', 'shell'] }), async () => {
      await menu(app, 'session.new');
      await soft(box(page), 'the new chat’s message box');
    });
    await reset(page);

    await shot(page, { id: 'overview', title: 'Overview', how: 'View › Overview (⌘0), or the grid button at the left of the title bar', state: 'A panel floating over the main area: Needs you (an approval, a question, a plan), then each project’s sessions that do not wait: two working, one idle, one held by a terminal, and one with no project under this Mac’s name (studio)', folders: ['overview', 'request-card', 'attention', 'sidebar', 'shell'] }, async () => {
      await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('tab.overview')?.enabled ?? false)).toBe(true);
      if ((await page.locator('[data-region="main"] [data-overview-panel]').count()) === 0) await menu(app, 'tab.overview');
      await expect(page.locator('[data-region="main"] [data-overview-panel]').first()).toBeVisible();
    });
    await shot(page, { id: 'overview-scrolled', title: 'Overview, further down', how: 'Overview, scrolled to its end', state: 'The plan card and the sessions that do not wait', folders: ['overview', 'request-card', 'attention'] }, async () => {
      if ((await page.locator('[data-region="main"] [data-overview-panel]').count()) === 0) await menu(app, 'tab.overview');
      await page.locator('[data-region="main"] [data-overview-panel]').first().evaluate((panel) => {
        const scrollers = [panel, ...Array.from(panel.querySelectorAll('*'))].filter((el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible');
        for (const el of scrollers) el.scrollTop = el.scrollHeight;
      });
    });
    await reset(page);

    // the sidebar fully expanded: every project open
    const expandAll = async () => {
      for (const row of await sidebar(page).locator('[data-kind="project"]').all()) {
        if ((await row.getAttribute('aria-expanded')) === 'false') await row.locator('[data-project-line]').first().click().catch(() => undefined);
      }
      await page.waitForTimeout(500);
    };
    // U1b: a request stands at the end of the conversation, the message box under it
    const request = () => pane(page).locator('[data-request-end] [data-request-card]').first();

    await shot(page, { id: 'session-approval', title: 'A session waiting on an approval', how: 'Click a session marked as waiting in the sidebar', state: 'The session asks to run a command; the approval stands at the end of the empty conversation with the message box under it; the right column opens on Waiting for you; every project open in the sidebar', folders: ['request-card', 'composer', 'attention', 'session', 'transcript', 'sidebar', 'shell', 'panel'] }, async () => {
      await openSession(page, SID.approval, SID.idle);
      await expandAll();
      await expect(request()).toBeVisible({ timeout: 15_000 });
    });
    await shot(page, r2({ id: 'r2-deny-reason-scenario', title: 'An approval with the deny-with-reason field open', how: 'Click the deny-with-reason field of an approval card', state: 'The waiting approval, its reason field focused, nothing typed', folders: ['request-card'] }), async () => {
      await openSession(page, SID.approval, SID.idle);
      // the card's first control opens the reason box (drawn first in its controls row, request-card/variants/
      // Permission.tsx); once open it stays open for that request, so it is pressed only while closed
      const field = request().locator('textarea');
      if ((await field.count()) === 0) await request().locator('button.mr-auto').first().evaluate((el) => (el as HTMLButtonElement).click()); // a pointer click is taken by the card's own hit area
      await expect(field.first()).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(800);
    });
    await reset(page);
    await shot(page, { id: 'session-question', title: 'A session asking a question', how: 'Click the session waiting on a question', state: 'Two questions at the end of the conversation, the first shown (1 of 2) with its options; the message box under it', folders: ['request-card', 'composer', 'attention', 'session', 'panel'] }, async () => {
      await openSession(page, SID.question, SID.idle);
      await expect(request()).toBeVisible({ timeout: 15_000 });
    }, {
      // the pager between the arrows (request-card/variants/Question.tsx; the arrows' names are the same on both builds):
      // the first of two shown on both builds: no earlier question to go back to, then on M2's build two dots, the first
      // current (C103); on master's, its literal "1 of 2" between them
      check: async () => {
        await inView(request().getByRole('button', { name: 'Show next question', exact: true }), 'the question card’s pager');
        await expect(request().getByRole('button', { name: 'Show previous question', exact: true }), 'the first question shown').toBeDisabled({ timeout: 3_000 });
        if (await m2Build(page)) {
          const dots = request().locator('[data-question-position] [data-dot]');
          await expect(dots, 'a dot per question').toHaveCount(2);
          await expect(dots.first(), 'the first question’s dot current').toHaveAttribute('data-dot', 'current');
        } else await inView(request().locator('[aria-live="polite"]').filter({ hasText: /^1 of 2$/ }), 'master’s 1 of 2');
      },
    });
    await shot(page, { id: 'session-plan', title: 'A session waiting on a plan', how: 'Click the session waiting on a plan', state: 'Plan review at the end of the conversation: the plan and its buttons; the message box under it', folders: ['request-card', 'composer', 'attention', 'session', 'panel'] }, async () => {
      await openSession(page, SID.plan, SID.idle);
      await expect(request()).toBeVisible({ timeout: 15_000 });
    });
    await shot(page, { id: 'session-terminal-held', title: 'A session held by a terminal', how: 'Click a session another terminal runs', state: 'The notice in the message box’s place: live in a terminal, read-only', folders: ['session', 'composer', 'lane-a', 'resume', 'transcript'] }, async () => {
      await openSession(page, SID.terminal, SID.idle);
    }, { check: () => inView(pane(page).locator('[role="note"]'), 'the holder’s line in the message box’s place') });
    await shot(page, { id: 'session-terminal-held-info', title: 'Session info of a session held by a terminal', how: 'The terminal-held session, View › More surfaces › Session info', state: 'The rows a terminal-held session cannot use here; the side column shows its Session info tab', folders: ['tools/session-info', 'panel'] }, async () => {
      await openSession(page, SID.terminal);
      await sideSurface(app, page, 'session-info');
    });
    await shot(page, { id: 'session-running-cards', title: 'A running session with the right column’s cards', how: 'Click a running session', state: 'Working; the right column shows the session cards: Environment open, Context and Connectors folded', folders: ['panel', 'panel/summary', 'session', 'composer', 'statusline'] }, async () => {
      if (await surface(page, 'session-info').isVisible().catch(() => false)) await menu(app, 'surface.session-info'); // back to the cards
      await openSession(page, SID.running, SID.idle);
      await soft(cards(page), 'the card column');
    });
    await shot(page, { id: 'sidebar-hover', title: 'Sidebar, pointer on a session row', how: 'Hover a session row in the sidebar', state: 'The hover card of a waiting session', folders: ['sidebar', 'sessions', 'attention'], hover: true }, async () => {
      await sidebar(page).locator(`[role="treeitem"][data-menu$="${SID.question}"]`).first().hover();
      await soft(page.locator('[data-hover-card]'), 'the hover card');
      await page.waitForTimeout(800);
    }, { check: () => inView(page.locator('[data-hover-card]'), 'the waiting session’s hover card') });
    await shot(page, { id: 'sidebar-hover-project', title: 'Sidebar, pointer on a project row', how: 'Hover a project row in the sidebar', state: 'The first project row under the pointer: its own tools', folders: ['sidebar'], hover: true }, async () => {
      await page.mouse.move(W - 2, H - 2);
      await sidebar(page).locator('[data-kind="project"] [data-project-line]').first().hover();
      await page.waitForTimeout(1200);
    });
    await shot(page, m0({ id: 'm0-needs-you-hover', title: 'Sidebar, pointer on a Needs you row', how: 'Hover the question’s row under Needs you in the sidebar', state: 'The waiting question’s row with its quick reply', folders: ['sidebar', 'attention'], hover: true }), async () => {
      await page.mouse.move(W - 2, H - 2);
      await sidebar(page).locator(`[data-needs-you$="${SID.question}"]`).first().hover();
      await page.waitForTimeout(1200);
    });
    await shot(page, m0({ id: 'm0-sidebar-search', title: 'Sidebar, searching', how: 'Type in the sidebar’s search field', state: '“sidebar” typed: the matching sessions and the row that searches in conversations', folders: ['sidebar'] }), async () => {
      await sidebar(page).locator('nav input').first().fill('sidebar');
      await page.waitForTimeout(1200);
    }, { after: async () => void (await sidebar(page).locator('nav input').first().fill('')) });
    await reset(page);

    // ---- pages ----
    await shot(page, { id: 'new-chat', title: 'New chat', how: 'New chat in the sidebar, or File › New chat (⌘N)', state: 'An empty new chat in the project of the session in front, nothing typed', folders: ['composer', 'session', 'destination', 'shell'] }, async () => {
      await menu(app, 'session.new');
      await page.waitForTimeout(1500);
    });
    await reset(page);
    await shot(page, { id: 'projects', title: 'Projects', how: 'Projects in the sidebar', state: 'Three projects', folders: ['projects', 'destination'] }, async () => {
      await destination(page, 'projects');
    });
    await reset(page);

    // ---- Customize (U11: My items with a Show filter; the pin's Plugins, Skills and Connectors tabs are its filters) ----
    await shot(page, m0({ id: 'm0-customize-all', title: 'Customize, My items (All)', how: 'Customize in the sidebar', state: 'User configuration; the plugin CLI stub’s user-scope plugins, then the built-in mods, each row ending in its kind word; no skills, no connectors', folders: ['customize', 'widgets/plugins', 'destination'] }), async () => {
      await customizeAt(page, 'mine', 'all');
    });
    await shot(page, m0({ id: 'm0-customize-all-hover', title: 'Customize, My items, pointer on a row', how: 'Hover the first row of My items', state: 'The first plugin row under the pointer', folders: ['customize', 'widgets/plugins'], hover: true }), async () => {
      if ((await custom(page).count()) === 0) await customizeAt(page, 'mine', 'all');
      await custom(page).locator('[data-plugin-row]').first().hover();
      await page.waitForTimeout(1200);
    });
    await shot(page, { id: 'customize-plugins', title: 'Customize, My items, Show: Plugins', how: 'Customize in the sidebar, Show: Plugins', state: 'User configuration; the plugins’ groups and the built-in mods; no live session', folders: ['customize', 'widgets/plugins', 'destination'] }, async () => {
      await customizeAt(page, 'mine', 'plugins');
    });
    await shot(page, { id: 'customize-plugins-hover', title: 'Customize, Plugins, pointer on a plugin row', how: 'Hover a plugin row under Show: Plugins', state: 'The first plugin row under the pointer', folders: ['customize', 'widgets/plugins'], hover: true }, async () => {
      if ((await custom(page).locator('[data-customize-body="plugins"]').count()) === 0) await customizeAt(page, 'mine', 'plugins');
      await custom(page).locator('[data-plugin-row]').first().hover();
      await page.waitForTimeout(1200);
    });
    await shot(page, { id: 'customize-skills', title: 'Customize, My items, Show: Skills', how: 'Customize, Show: Skills', state: 'User configuration, no skills on disk', folders: ['customize', 'widgets/skills'] }, async () => {
      await customizeAt(page, 'mine', 'skills');
    });
    await shot(page, { id: 'customize-connectors', title: 'Customize, My items, Show: Connectors', how: 'Customize, Show: Connectors', state: 'User configuration, no connectors; no live session', folders: ['customize', 'customize/connectors'] }, async () => {
      await customizeAt(page, 'mine', 'connectors');
    });
    await shot(page, m0({ id: 'm0-customize-custom-connector', title: 'Customize, Add custom connector', how: 'Customize, Show: Connectors, Add custom connector; a local command filled in, Details open', state: 'The sheet with the local-command transport, a name, a command and its arguments; nothing added', folders: ['customize/connectors', 'widgets/plugins'] }), async () => {
      await customizeAt(page, 'mine', 'connectors');
      await custom(page).locator('[data-customize-tools] [data-connector-add-custom]').first().click();
      const sheet = page.locator('[data-plugins-sheet="mcp-add"][data-connector-custom]').first();
      await expect(sheet).toBeVisible({ timeout: 10_000 });
      await sheet.locator('[data-connector-name]').first().fill('notes-index');
      await sheet.locator('input[name="custom-connector-type"][value="stdio"]').check();
      await sheet.locator('[data-connector-command-field]').first().fill('node');
      await sheet.locator('[data-connector-args-field]').first().fill('server.js --port 4100');
      const details = sheet.locator('[data-plugins-details]').first();
      if (await details.isVisible().catch(() => false)) await details.click();
      else notes.push('not seen: the sheet’s Details (plugins.env may not answer under the stub)');
    });
    await closeOverlays(page);
    await shot(page, r2({ id: 'r2-plugin-detail', title: 'Customize, a plugin’s own page', how: 'Click a plugin row in Customize (My items)', state: 'The first user plugin’s page, from the plugin CLI stub', folders: ['customize', 'widgets/plugins'] }), async () => {
      await customizeAt(page, 'mine', 'plugins');
      await custom(page).locator('[data-plugin-row]:visible [data-row-open]').first().click();
      await expect(custom(page).locator('[data-plugin-detail]').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1500);
    });
    await closeOverlays(page);
    await shot(page, m0({ id: 'm0-discover', title: 'Customize, Discover', how: 'Customize, Discover', state: 'Discover’s home from the catalog’s recorded sources and the plugin CLI stub: featured and shelves of cards; no network', folders: ['customize', 'customize/discover', 'widgets/plugins'] }), async () => {
      await customizeAt(page, 'discover', 'all');
      await soft(custom(page).locator('[data-catalog-card], [data-featured]'), 'a catalog card', 20_000);
    });
    await shot(page, m0({ id: 'm0-discover-detail', title: 'Customize, Discover, a card opened', how: 'Click the first card in Discover', state: 'A catalog entry’s detail', folders: ['customize/discover'] }), async () => {
      if ((await custom(page).locator('[data-catalog-card]').count()) === 0) await customizeAt(page, 'discover', 'all');
      await custom(page).locator('[data-catalog-card] [data-card-open]').first().click();
      await expect(page.locator('[data-catalog-detail]').first()).toBeVisible({ timeout: 15_000 });
    });
    await closeOverlays(page);
    await reset(page);

    // ---- Settings, one capture per wordy section (a modal dialog; its sections are #settings-<id>) ----
    const SETTINGS: [string, string, string, string[], boolean?][] = [
      ['appearance', 'Settings, Appearance', 'The top of Settings, the App group', ['settings-tab']],
      ['notifications', 'Settings, Notifications', 'The notifications section', ['settings-tab'], true],
      ['keyboard', 'Settings, Keyboard', 'The keyboard shortcuts table', ['settings-tab', 'keymap']],
      ['voice', 'Settings, Voice', 'Voice dictation settings', ['settings-tab']],
      ['browser', 'Settings, Browser', 'The browser section, no profile imported', ['settings-tab']],
      ['artifacts', 'Settings, Artifacts', 'The artifacts section', ['settings-tab']],
      ['sessions', 'Settings, Sessions', 'The Sessions section of Sessions & engine', ['settings-tab', 'budget']],
      ['gateway', 'Settings, Gateway', 'How sessions reach the model', ['settings-tab', 'gateway']],
      ['usage', 'Settings, Usage', 'Accounts and limits from the ClaudeUsage fixture, newest reading two minutes old', ['settings-tab', 'usage', 'accounts']],
      ['engine', 'Settings, Engine', 'The engine version and its update', ['settings-tab', 'engine-surface']],
      ['supervisor', 'Settings, Supervisor', 'The supervisor daemon', ['settings-tab']],
      ['org', 'Settings, Org', 'Not signed in to an org', ['settings-tab', 'accounts', 'owner']],
    ];
    for (const [section, title, state, folders, added] of SETTINGS) {
      const meta = { id: added ? `m0-settings-${section}` : `settings-${section}`, title, how: `Settings (⌘,), ${title.replace('Settings, ', '')} in its index`, state, folders };
      await shot(page, added ? m0(meta) : meta, async () => {
        await settingsAt(app, page, section);
      });
    }
    // rows whose helper words wait for the pointer: the first row of a section, hovered (M1: its note open over the rows
    // that follow)
    for (const [section, title] of [['notifications', 'Notifications'], ['sessions', 'Sessions']] as const) {
      const first = page.locator(`section[aria-labelledby="settings-${section}"] [data-settings-row]`).first();
      await shot(page, { id: `settings-${section}-hover`, title: `Settings, ${title}, pointer on its first row`, how: `Settings, ${title}; hover its first row`, state: 'The first row of the section under the pointer', folders: ['settings-tab'], hover: true }, async () => {
        await settingsAt(app, page, section);
        await first.hover();
        await page.waitForTimeout(1200);
      }, { check: checks(pointedAt(first, `the first ${title} row`), noteShown(first, `the first ${title} row`)) });
    }
    await reset(page);
    await settingsM1(app, page);
    await reset(page);

    // round 2: dialogs from typed commands, answered by the widget backend's recorded reads (MAWS_WIDGET_BACKEND=fixtures)
    const open = async (command: string, rest = '', session = SID.idle) => {
      await openSession(page, session);
      await typed(page, command, rest);
      await expect(dialogOf(page, command)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1500);
    };
    for (const [command, title] of [['mcp', 'Connectors dialog (/mcp)'], ['permissions', 'Permissions dialog (/permissions)'], ['config', 'Config dialog (/config)'], ['context', 'Context dialog (/context)'], ['agents', 'Agents dialog (/agents)'], ['memory', 'Memory dialog (/memory)'], ['sandbox', 'Sandbox dialog (/sandbox)'], ['model', 'Model menu (/model)'], ['diff', 'Diff dialog (/diff)'], ['hooks', 'Hooks dialog (/hooks)']] as const) {
      await shot(page, r2({ id: `r2-dialog-${command}`, title, how: `Type /${command} in a session's message box and press Enter`, state: 'An idle session; the dialog answered from the widget backend’s recorded reads', folders: ['widgets', 'composer'] }), async () => {
        await open(command);
      });
      await reset(page);
    }
    // the same dialogs in other states (the widget backend's reads replaced from committed recordings)
    await shot(page, m0({ id: 'm0-dialog-mcp-signin', title: 'Connectors dialog (/mcp), every server needing sign-in', how: 'Type /mcp in a session’s message box and press Enter', state: 'Four recorded servers, each needing sign-in, with Sign in and Reconnect on its line', folders: ['widgets', 'composer'] }), async () => {
      await scriptRead(app, 'session.mcpStatus', recorded('spikes/protocol-probe/fixtures/p4/p4-agg-m4-signin.jsonl', 7));
      await open('mcp');
      await soft(dialogOf(page, 'mcp').locator('[data-mcp-server]'), 'a server row');
    }, { after: () => unscriptReads(app) });
    await reset(page);
    await shot(page, m0({ id: 'm0-dialog-config-defaults', title: 'Config dialog (/config), defaults only', how: 'Type /config in a session’s message box and press Enter', state: 'A recorded settings read with nothing beyond the defaults', folders: ['widgets', 'composer'] }), async () => {
      await scriptRead(app, 'session.getSettings', recorded('spikes/protocol-probe/fixtures/reads.jsonl', 60));
      await open('config');
    }, { after: () => unscriptReads(app) });
    await reset(page);
    await shot(page, m0({ id: 'm0-dialog-sandbox-details', title: 'Sandbox dialog (/sandbox), Details open', how: 'Type /sandbox, then open Details', state: 'Sandbox off, its details unfolded', folders: ['widgets', 'composer'] }), async () => {
      await open('sandbox');
      await page.locator('[data-widget="sandbox"] details > summary').first().click();
    });
    await reset(page);
    await shot(page, m0({ id: 'm0-dialog-export', title: 'Export dialog (/export)', how: 'Type /export in a session’s message box and press Enter', state: 'The recorded export: a file name and the conversation’s text', folders: ['widgets', 'composer'] }), async () => {
      await open('export');
    });
    await reset(page);
    await shot(page, m0({ id: 'm0-dialog-compact', title: 'Compact dialog (/compact)', how: 'Type /compact focus on tests and press Enter', state: 'The instructions field filled, beside the context reading; nothing compacted', folders: ['widgets', 'composer'] }), async () => {
      await open('compact', 'focus on tests');
    });
    await reset(page);
    await shot(page, m0({ id: 'm0-dialog-rename', title: 'Rename (/rename) in a scenario session', how: 'Type /rename New title and press Enter', state: 'The widget’s own title field, renamed (a scenario launch registers no session actions)', folders: ['widgets', 'composer'] }), async () => {
      await open('rename', 'New title');
    });
    await reset(page);
    // The catalogue's read is made as a session's message box attaches it (stores/catalog.ts, attachCatalog), so the session
    // is one the rig has not opened, and one the widget backend answers for: the backend holds the scenario's `engine`
    // statuses only (src/main/widgets/fixture-backend.ts), and a read for any other session fails with "unknown app
    // session" (test/support/widget-backend.ts, statusOf), which is how M0's choice, a session with no status, missed.
    // Its dialog then had no catalogue to read at all and offered Load now instead of the empty list.
    const agentsDialog = () => dialogOf(page, 'agents');
    await shot(page, m0({ id: 'm0-dialog-agents-none', title: 'Agents dialog (/agents) with no agents', how: 'Type /agents in a session not opened before, its catalogue holding no agents', state: 'The dialog’s empty state', folders: ['widgets', 'composer'] }), async () => {
      await app.evaluate(async (_, id) => {
        const backend = (globalThis as unknown as { __maws_widget_backend: Backend; __words_undo?: (() => void)[] }).__maws_widget_backend;
        const catalog = (await backend.answer('session.catalog', { appSessionId: id })) as Record<string, unknown>;
        ((globalThis as unknown as { __words_undo?: (() => void)[] }).__words_undo ??= []).push(backend.script('session.catalog', () => ({ ...catalog, agents: [] })));
      }, SID.unopened);
      await open('agents', '', SID.unopened);
    }, {
      // the empty state: the body's one line, its own words, and no list of agents (widgets/AgentsWidget.tsx, AgentsBody;
      // parts.tsx, Rows); a failed read or Load now draws other words in a `p` and is not this state
      check: async () => {
        await expect(agentsDialog().locator('ul'), 'no list of agents').toHaveCount(0);
        await inView(agentsDialog().getByText(AGENTS_NONE, { exact: true }), 'the empty list’s line');
      },
      after: () => unscriptReads(app),
    });
    await reset(page);
    // the resume chooser over the scenario's sessions, a filter typed so a session with turns is in its preview
    await shot(page, m0({ id: 'm0-resume', title: 'The resume chooser (/resume)', how: 'Type /resume in a session of the first project, then type “drag”', state: 'The project’s sessions filtered to one, its preview with the turns where it left off', folders: ['resume', 'widgets', 'composer'] }), async () => {
      await open('resume', '', SID.running);
      await page.keyboard.type('drag');
      await soft(page.locator('[data-testid="resume-preview"]'), 'the preview');
    }, { check: checks(() => inView(page.locator('[data-resume-chooser]'), 'the chooser'), () => inView(page.locator('[data-testid="resume-preview"]'), 'the preview')) });
    await reset(page);
    await m2Scenario(app, page, SID, open);

    // ---- the palette and the tab strip ----
    await shot(page, m0({ id: 'm0-palette-typed', title: 'Command palette with a query', how: 'Go › Command palette (⌘K), type “sidebar”', state: 'Sessions, artifacts, projects, channels and actions matching the query, and the row that searches the Library', folders: ['palette'] }), async () => {
      await menu(app, 'palette.open');
      await expect(page.locator('[cmdk-root]').first()).toBeVisible({ timeout: 10_000 });
      await page.keyboard.type('sidebar');
      await page.waitForTimeout(1200);
    });
    await reset(page);
    await shot(page, m0({ id: 'm0-tab-menu', title: 'A main tab’s menu', how: 'Right-click the tab in front', state: 'The menu of a session’s tab', folders: ['main'] }), async () => {
      await openSession(page, SID.idle);
      await page.locator('[data-chrome-tabs] [role="tab"][aria-selected="true"]').first().click({ button: 'right' });
      await expect(page.locator('[role="menu"]').first()).toBeVisible({ timeout: 5_000 });
    });
    await reset(page);

    // last, since it changes the scenario: the timeline played to the point where the approval's session exits
    await shot(page, m0({ id: 'm0-session-interrupted', title: 'A session interrupted with its approval lost', how: 'The scenario’s timeline played to 12 s, then the session opened', state: 'The session that waited on an approval exited: interrupted, one approval lost', folders: ['session', 'attention', 'sidebar', 'request-card'] }), async () => {
      await app.evaluate((_, ms) => (globalThis as unknown as { __maws_scenario: { advanceTo(ms: number): unknown } }).__maws_scenario.advanceTo(ms), 12_000);
      await page.waitForTimeout(1500);
      await openSession(page, SID.approval);
    });
    await reset(page);
  } finally {
    await maws.cleanup();
  }
});

// The word cut's M1 in launch 1 (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M1; the rows of
// 2026-11-16-word-cut/settings.md): the Settings states a cut row changes that no other scene draws, each reached the way
// a person reaches it (pointing, the keyboard, a typed search, a switch) or, where the state is a stored setting or a
// fixture's reading, through the settings write or the scratch ClaudeUsage folder, put back after its capture.
async function settingsM1(app: ElectronApplication, page: Page) {
  const section = (id: string) => page.locator(`section[aria-labelledby="settings-${id}"]`);
  const row = (id: string) => page.locator(`[data-settings-row="${id}"]`);
  const searchField = () => page.locator('[data-settings-dialog] nav input[type="search"]');
  const results = () => page.locator('[data-settings-dialog] nav [role="listbox"] [role="option"]');
  const clearSearch = async () => void (await searchField().fill('').catch(() => undefined));

  // a note opened by the keyboard: Tab from the section's heading into its first row (G13 to G15)
  const firstSessions = section('sessions').locator('[data-settings-row]').first();
  await shot(page, m1({ id: 'm1-settings-sessions-focus', title: 'Settings, Sessions, keyboard focus in its first row', how: 'Settings, Sessions; Tab from the section’s heading', state: 'The first row of the section holding the keyboard, its note open at once', folders: ['settings-tab', 'ui'] }), async () => {
    await settingsAt(app, page, 'sessions');
    await letGo(page);
    await page.locator('#settings-sessions').focus();
    await page.keyboard.press('Tab');
  }, { check: checks(focusIn(firstSessions, 'the first Sessions row'), noteShown(firstSessions, 'the first Sessions row')) });
  // the longest note, the Binary row’s, opened by pointing: it floats over the rows that follow (G125, G127, G128)
  const binary = row('engine.binary');
  await shot(page, m1({ id: 'm1-settings-engine-hover', title: 'Settings, Engine, pointer on the Binary row', how: 'Settings, Engine; hover the Binary row', state: 'The Binary row under the pointer: its note with the binary’s path, the config home and the tested version', folders: ['settings-tab', 'ui'], hover: true }), async () => {
    await settingsAt(app, page, 'engine');
    await binary.hover();
    await page.waitForTimeout(1200);
  }, { check: checks(pointedAt(binary, 'the Binary row'), noteShown(binary, 'the Binary row')) });

  // the search (G8, G9): results, no match, and a landing whose focus opens the note the words were found in
  await shot(page, m1({ id: 'm1-settings-search-results', title: 'Settings, Search settings with results', how: 'Settings (⌘,), type “hook” in Search settings', state: 'The results in the index’s place, each a row’s name over its section', folders: ['settings-tab'] }), async () => {
    await settingsAt(app, page, 'appearance');
    await searchField().fill('hook');
    await page.waitForTimeout(800);
  }, { check: () => inView(results(), 'a result for “hook”'), after: clearSearch });
  await shot(page, m1({ id: 'm1-settings-search-none', title: 'Settings, Search settings with no match', how: 'Settings (⌘,), type “zebra crossing” in Search settings', state: 'The index says nothing matches', folders: ['settings-tab'] }), async () => {
    await settingsAt(app, page, 'appearance');
    await searchField().fill('zebra crossing');
    await page.waitForTimeout(800);
  }, {
    check: async () => {
      await expect(page.locator('[data-settings-dialog] nav [role="status"]'), 'the index’s no-match line').toHaveText(INDEX.noMatch, { timeout: 3_000 });
      await expect(results(), 'no result').toHaveCount(0);
    },
    after: clearSearch,
  });
  // the words found, PATH, in view where the landing shows them: the Binary row's open note on the cut's build, the
  // More that master's landing opens on its line
  const pathShown = async () => {
    const shown = cutBuild() ? binary.locator('[data-row-note][data-open]') : binary.locator('[data-settings-note]:has([data-settings-more][aria-expanded="true"])');
    await inView(shown.getByText(/\bPATH\b/), 'PATH, the words found');
  };
  await shot(page, m1({ id: 'm1-settings-search-landed', title: 'Settings, a search result landed on', how: 'Settings (⌘,), type “PATH” in Search settings, Enter', state: 'The Binary row holding the keyboard, its note open with the words found', folders: ['settings-tab'] }), async () => {
    await settingsAt(app, page, 'appearance');
    await searchField().fill('PATH');
    await page.waitForTimeout(500);
    await searchField().press('Enter');
    await page.waitForTimeout(2000); // past the landing's mark
  }, { check: checks(focusIn(binary, 'the Binary row'), noteShown(binary, 'the Binary row'), pathShown), after: clearSearch });

  // Notifications: the approvals box's caption is its tooltip, shown by the keyboard (G33); the tip wraps the box's label.
  // Master draws the caption after the box's word.
  const approvals = row('notifications.kinds').locator('label').nth(1);
  const caption = row('notifications.kinds').locator('label').filter({ hasText: NOTIFICATIONS.approvalsCaption });
  await shot(page, m1({ id: 'm1-settings-notifications-approvals-tip', title: 'Settings, Notifications, the approvals caption', how: 'Settings, Notifications; Tab to the approvals box', state: 'The approvals box holding the keyboard, its caption as the tooltip', folders: ['settings-tab', 'ui'] }), async () => {
    await settingsAt(app, page, 'notifications');
    await focusTip(page, approvals.locator('input[type="checkbox"]'), caption);
  }, { check: tipShown(page, approvals, 'the approvals box', caption) });

  // Keyboard with a binding off its default (G39, G40, G44): Next Needs-you unbound through the settings write. Its cap
  // is empty and named Unbound on the cut's build, the word Unbound on master's.
  const unbound = async () => {
    value(await invoke(page, 'settings.set', { keymap: { 'attention.next': null } } as never));
    await page.waitForTimeout(500);
  };
  const defaults = async () => void value(await invoke(page, 'settings.set', { keymap: {} } as never));
  const nextRow = () => page.locator('[data-settings-binding="attention.next"]');
  const cap = nextRow().locator('kbd');
  const capUnbound = () => (cutBuild() ? expect(cap, 'the cap unbound').toHaveAttribute('aria-label', KEYBOARD.unbound, { timeout: 3_000 }) : expect(cap, 'the cap unbound').toHaveText(KEYBOARD.unbound, { timeout: 3_000 }));
  await shot(page, m1({ id: 'm1-settings-keyboard-override', title: 'Settings, Keyboard, a binding changed', how: 'Settings, Keyboard, with Next Needs-you unbound (as Backspace while recording leaves it), scrolled to the table’s end', state: 'Reset to defaults under the table, drawn while a binding differs from its default', folders: ['settings-tab', 'keymap'] }), async () => {
    await unbound();
    await settingsAt(app, page, 'keyboard');
    await row('keyboard.reset').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  }, { check: checks(capUnbound, () => inView(row('keyboard.reset'), 'Reset to defaults')), after: defaults });
  await shot(page, m1({ id: 'm1-settings-keyboard-unbound-tip', title: 'Settings, Keyboard, an unbound key cap', how: 'Settings, Keyboard, Next Needs-you unbound; Tab to its key cap', state: 'The empty key cap holding the keyboard, its tooltip Unbound', folders: ['settings-tab', 'keymap', 'ui'] }), async () => {
    await unbound();
    await settingsAt(app, page, 'keyboard');
    await focusTip(page, cap, cap);
  }, { check: checks(capUnbound, tipShown(page, cap, 'the unbound key cap', cap)), after: defaults });
  // Change is drawn transparent until its row is pointed at (KeymapSection.tsx), which only its opacity tells; master
  // draws it at rest
  const change = nextRow().locator('[role="cell"]').last().locator('button');
  await shot(page, m1({ id: 'm1-settings-keyboard-row-hover', title: 'Settings, Keyboard, pointer on a binding', how: 'Settings, Keyboard; hover Next Needs-you', state: 'The binding under the pointer, its Change shown', folders: ['settings-tab', 'keymap'], hover: true }), async () => {
    await settingsAt(app, page, 'keyboard');
    await nextRow().scrollIntoViewIfNeeded();
    await nextRow().hover();
    await page.waitForTimeout(800);
  }, { check: checks(pointedAt(nextRow(), 'Next Needs-you'), () => expect(change.first(), 'Change on the pointed binding').toHaveCSS('opacity', '1', { timeout: 3_000 })) });

  // Supervisor: the status's tooltip with its row's note, both opened by its focus (G129), the memory budget turned off
  // by its switch (G140) and, on, the limit's note on pointing (G142). Master draws the tooltip's facts in the status and
  // the daemon's own row.
  const budget = () => row('supervisor.memoryBudget').locator('[role="switch"]');
  const budgetIs = async (on: boolean) => {
    await expect(budget(), `the memory budget ${on ? 'on' : 'off'}`).toHaveAttribute('aria-checked', String(on), { timeout: 5_000 });
    for (const id of ['supervisor.limit', 'supervisor.stateful']) await expect(row(id), `${id} ${on ? 'drawn' : 'gone'}`).toHaveCount(on ? 1 : 0, { timeout: 5_000 });
  };
  // the limit at its default: no limit set, the field empty, the default's size (a number of GB) its placeholder
  const limitField = row('supervisor.limit').locator('input');
  const atDefault = async () => {
    await expect(row('supervisor.limit'), 'the limit sized from the default').toHaveAttribute('data-settings-state', 'sized', { timeout: 5_000 });
    await expect(limitField, 'no limit set').toHaveValue('');
    await expect(limitField, 'the default’s size').toHaveAttribute('placeholder', /^\d+(\.\d+)?$/);
  };
  // the running supervisor's facts and the connected daemon's, in the words of the build's copy: on the cut's build the
  // status's tooltip (and its description), the status keeping the keyboard; on master's, the status line and the
  // daemon's own line, in view
  const daemonLines = (['unit', 'private'] as const).map((kind) => SUPERVISOR.daemonLine(kind, COUNT, HOLE));
  const runningShown = async () => {
    if (cutBuild()) {
      await expect(status, 'the status keeps the keyboard').toBeFocused({ timeout: 3_000 });
      const tip = page.getByRole('tooltip').first();
      await expect(tip, 'the running supervisor’s facts').toContainText(shaped(SUPERVISOR.runningFacts(HOLE, COUNT, HOLE)), { timeout: 3_000 });
      await expect(tip, 'the connected daemon’s line').toContainText(shaped(...daemonLines.map((line) => SUPERVISOR.daemonFact(line))));
      return;
    }
    // master's template: running(since, pid, live, exit), its sessions counted in words
    const running = (SUPERVISOR.running as unknown as (since: string, pid: number, live: number, exit: string) => string)(HOLE, COUNT, COUNT, HOLE);
    await expect(status, 'master’s running status').toHaveText(new RegExp(`^(${shaped(running).source.replace(`\\d+ sessions`, '(no sessions|\\d+ sessions?)')})$`), { timeout: 3_000 });
    await inView(row('supervisor.daemon').locator('[data-daemon-line]'), 'master’s daemon line');
    await expect(row('supervisor.daemon').locator('[data-daemon-line]'), 'master’s daemon connected').toHaveText(new RegExp(`^(${shaped(...daemonLines).source})$`));
  };
  const turnBudget = async (on: boolean) => {
    if ((await budget().getAttribute('aria-checked')) !== String(on)) await budget().click();
    await budgetIs(on);
  };
  const status = row('supervisor.status').locator('[role="status"]');
  await shot(page, m1({ id: 'm1-settings-supervisor-status-tip', title: 'Settings, Supervisor, the status’s tooltip', how: 'Settings, Supervisor; Tab to the status', state: 'The status holding the keyboard: its tooltip with the start, the pid, the exit rule and the machine daemon, and the row’s note', folders: ['settings-tab', 'ui'] }), async () => {
    await settingsAt(app, page, 'supervisor');
    await focusTip(page, status, row('supervisor.daemon'));
  }, { check: checks(tipShown(page, status, 'the supervisor’s status', row('supervisor.daemon')), runningShown, noteShown(row('supervisor.status'), 'the status row')) });
  await shot(page, m1({ id: 'm1-settings-supervisor-budget-off', title: 'Settings, Supervisor, the memory budget off', how: 'Settings, Supervisor; turn the memory budget’s switch off', state: 'The budget off, its limit and stateful rows gone, the switch holding the keyboard with the off note open', folders: ['settings-tab', 'budget'] }), async () => {
    await settingsAt(app, page, 'supervisor');
    await turnBudget(false);
  }, { check: checks(() => budgetIs(false), focusIn(row('supervisor.memoryBudget'), 'the memory budget row'), noteShown(row('supervisor.memoryBudget'), 'the memory budget row')), after: () => turnBudget(true) });
  await shot(page, m1({ id: 'm1-settings-supervisor-limit-hover', title: 'Settings, Supervisor, pointer on the memory limit', how: 'Settings, Supervisor, the budget on; hover its Limit row', state: 'The limit at its default (the default’s size in the field), its note on pointing', folders: ['settings-tab', 'budget'], hover: true }), async () => {
    await settingsAt(app, page, 'supervisor');
    await turnBudget(true);
    await row('supervisor.limit').scrollIntoViewIfNeeded();
    await row('supervisor.limit').hover();
    await page.waitForTimeout(1200);
  }, { check: checks(() => budgetIs(true), atDefault, pointedAt(row('supervisor.limit'), 'the Limit row'), noteShown(row('supervisor.limit'), 'the Limit row')) });

  // Org, not signed in: Sign in… draws the pairing-code field, focused, its note open (G147 to G149); master draws the
  // field at rest, which takes the focus there
  const code = section('org').getByRole('textbox', { name: ORG.code, exact: true });
  await shot(page, m1({ id: 'm1-settings-org-signin', title: 'Settings, Org, Sign in… pressed', how: 'Settings, Org (not signed in); press Sign in…', state: 'The pairing-code field holding the keyboard, its note on where a code comes from open', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
    await settingsAt(app, page, 'org');
    // the status read first; a retry finds the field Sign in… drew still there
    const signIn = CUT_ORG.signInOpen === undefined ? null : section('org').getByRole('button', { name: CUT_ORG.signInOpen, exact: true });
    await expect(signIn === null ? code : signIn.or(code).first()).toBeVisible({ timeout: 10_000 });
    if (signIn !== null && (await signIn.count())) await signIn.click();
    else await code.focus();
  }, { check: checks(() => expect(code, 'the pairing-code field').toBeFocused({ timeout: 3_000 }), noteShown(section('org').getByRole('group', { name: ORG.code, exact: true }), 'the pairing-code row')) });
}

// The word cut's M2 in launch 1 (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M2): the message box's and the
// dialogs' states a cut row changes that the scenario reaches, each opened as a person opens it (the keyboard's focus,
// a chip pressed, a typed command), over the widget backend's recorded reads.
async function m2Scenario(app: ElectronApplication, page: Page, SID: Record<'running' | 'terminal' | 'idle' | 'unopened', string>, open: (command: string, rest?: string, session?: string) => Promise<void>) {
  const toolbar = () => pane(page).locator('[data-composer] [role="toolbar"]').first();
  // C158: a filter chip's key is its tooltip (resume/ResumeChooser.tsx, the chips' group; ⌃A is the first chip's key);
  // master draws the key in the chip
  const chooser = () => page.locator('[data-resume-chooser]');
  const chip = () => chooser().locator('[role="group"] button[aria-pressed]').first();
  const chipKey = () => chooser().locator('[role="group"] kbd').first();
  await shot(page, m2({ id: 'm2-resume-chip-key', title: 'The resume chooser, a filter chip holding the keyboard', how: 'Type /resume in a session of the first project, then Tab to its first filter chip', state: 'The All projects chip focused, its key (⌃A) its tooltip', folders: ['resume', 'widgets', 'ui'] }), async () => {
    await openSession(page, SID.running);
    await m2Build(page);
    await open('resume', '', SID.running);
    await expect(chip()).toBeVisible({ timeout: 10_000 });
    await focusTip(page, chip(), chipKey(), m2Cut);
  }, { check: tipShown(page, chip(), 'the first filter chip', chipKey(), m2Cut) });
  await reset(page);

  // P537: /model with a name the catalogue lacks; its line in the effort view's warning (widgets/ModelSelector.tsx,
  // `unknown`, the same element on both builds)
  await shot(page, m2({ id: 'm2-model-unknown-name', title: 'Model menu (/model) with a name it does not know', how: 'Type /model nonesuch in an idle session and press Enter', state: 'The menu’s line saying no model has that name', folders: ['widgets', 'composer'] }), async () => {
    await openSession(page, SID.idle);
    await m2Build(page); // the line is the same element on both builds: the build is checked against the checkout first
    await open('model', 'nonesuch');
  }, { check: () => inView(dialogOf(page, 'model').locator('p.text-warning'), 'the line for the unknown name') });
  await reset(page);

  // C32: the microphone a named glyph, Dictate its tooltip on focus; master's word is its system title, which no
  // picture draws, so the before shows the focused button alone
  const mic = () => pane(page).locator(MIC).first();
  await shot(page, m2({ id: 'm2-mic-tip', title: 'Message box, the microphone holding the keyboard', how: 'An idle session; Tab to the microphone under the message box', state: 'The microphone focused, its word Dictate its tooltip (master’s is a system tooltip, not drawn here)', folders: ['composer/dictation', 'composer/frame', 'ui'] }), async () => {
    await openSession(page, SID.idle);
    await m2Build(page);
    await letGo(page);
    await mic().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await mic().focus();
  }, { check: checks(focusIn(mic(), 'the microphone'), tipShown(page, mic(), 'the microphone', mic(), m2Cut)) });
  await letGo(page);

  // C46: the context popover's figures line owns the percentage and what is left until compaction (statusline/
  // ContextPopover.tsx, Breakdown: the figures the first line under the heading on both builds; master draws the
  // percentage at rest on the line after it, which M2 cut). The reading is the widget backend's get_context_usage
  // (test/support/widget-backend.ts: reads.jsonl seq 57, 30,433 of 200,000 tokens, 15%, compaction at 167,000), as each
  // build writes it (statusline/copy.ts CONTEXT_POPOVER on M2, master's Breakdown literals): the check reads the figures
  // themselves, so a lost breakdown or another reading is not taken for them
  const context = () => page.locator('[role="dialog"][aria-label="Context window"]');
  const figures = () => context().locator('h3 + p');
  const masterUsed = () => context().locator('h3 + p + p'); // master's second line
  const FIGURES = { m2: '30k of 200k · compacts at 167k', master: '30k of 200k · autocompact at 167k' };
  const USED = '15.0% used · 137k until compaction';
  await shot(page, m2({ id: 'm2-context-figures-tip', title: 'Context popover, its figures holding the keyboard', how: 'An idle session, the ring at the end of the row under the message box; Tab to its first line', state: 'The recorded context reading’s line focused: the percentage used and what is left until compaction its tooltip', folders: ['statusline', 'composer/frame', 'ui'] }), async () => {
    await openSession(page, SID.idle);
    await m2Build(page);
    await pane(page).locator('[data-composer] [data-context-ring]').first().click();
    await expect(context().locator('table'), 'the breakdown read').toBeVisible({ timeout: 10_000 });
    await focusTip(page, figures(), masterUsed(), m2Cut);
  }, {
    check: async () => {
      await expect(figures(), 'the recorded figures').toHaveText(byBuild(FIGURES), { timeout: 3_000 });
      if (!m2Cut()) {
        await inView(masterUsed(), 'master’s line of the share used');
        return void (await expect(masterUsed(), 'master’s recorded share used').toHaveText(USED, { timeout: 3_000 }));
      }
      await tipShown(page, figures(), 'the context’s figures', masterUsed(), m2Cut)();
      await expect(page.getByRole('tooltip').first(), 'the recorded share used, its tooltip').toHaveText(USED, { timeout: 3_000 });
      await expect(figures(), 'the recorded share used, its description').toHaveAccessibleDescription(USED, { timeout: 3_000 });
    },
    after: () => closeOverlays(page),
  });
  await reset(page);

  // C128: the held line's pid waits on its words (session/HolderNotice.tsx); master's line names it at rest
  const note = () => pane(page).locator('[role="note"]').first();
  const holder = () => note().locator('span[tabindex="0"]');
  await shot(page, m2({ id: 'm2-held-pid-tip', title: 'A session held by a terminal, its line holding the keyboard', how: 'Click a session another terminal runs; Tab to the line in the message box’s place', state: 'Live in Terminal · read-only focused, the holder’s pid its tooltip', folders: ['session', 'ui'] }), async () => {
    await openSession(page, SID.idle);
    await m2Build(page);
    await openSession(page, SID.terminal);
    await expect(note()).toBeVisible({ timeout: 10_000 });
    await focusTip(page, holder(), note(), m2Cut);
  }, { check: tipShown(page, holder(), 'the holder’s line', note(), m2Cut) });
  await letGo(page);
  await reset(page);

  // the model view by the effort view's button that names the model (widgets/ModelSelector.tsx: `data-effort-title`
  // inside it, `data-model-selector` the view shown, on both builds); P555's new chat is launch 10's (m2-new-chat-model-view)
  const selector = () => page.locator('[data-model-selector]').first();
  const modelView = () => page.locator('[data-model-selector="model"]').first();

  // P549: a model asked for that the engine has not confirmed: the widget backend accepts set_model and moves the
  // status's `requested` without the init frame that would confirm it (test/support/widget-backend.ts, control), so the
  // checked row stays on its way. On M2's build a quiet spinner in the check's place; on master's, the row's "setting…"
  // (ModelSelector.tsx: the checked row's `ml-auto` word). The session is the unopened one, so no other scene's chip
  // shows the change.
  const modelChip = () => toolbar().locator('button[aria-haspopup="dialog"]:not([data-context-ring])').last();
  const toModels = async () => {
    await expect(selector()).toBeVisible({ timeout: 10_000 });
    if ((await selector().getAttribute('data-model-selector')) !== 'model') await selector().locator('button:has([data-effort-title])').first().click();
    await expect(modelView()).toBeVisible({ timeout: 5_000 });
  };
  const askedRow = () => modelView().locator('[role="menu"] [role="menuitemradio"][aria-checked="true"]').first();
  await shot(page, m2({ id: 'm2-model-pending', title: 'Model menu, a model asked for and not confirmed yet', how: 'A session not opened before, the model chip under the message box; the model’s name, another model, then the model’s name again', state: 'The list with the model asked for checked, its change on its way a spinner in its check’s place', folders: ['widgets', 'composer/frame', 'ui'] }), async () => {
    await openSession(page, SID.unopened);
    await m2Build(page);
    await modelChip().click();
    await toModels();
    await modelView().locator('[role="menu"] [role="group"] [role="menuitemradio"][aria-checked="false"]:not([disabled])').first().click();
    await expect(selector(), 'back to the effort view').toHaveAttribute('data-model-selector', 'effort', { timeout: 5_000 });
    await toModels();
  }, {
    check: async () => {
      await inView(askedRow(), 'the model asked for, checked');
      if (m2Cut()) await expect(askedRow().getByRole('progressbar'), 'its change on its way').toBeVisible({ timeout: 3_000 });
      else await inView(askedRow().locator('span.ml-auto'), 'master’s setting… on the row');
    },
    after: () => closeOverlays(page),
  });
  await reset(page);

  // C10: the Memory chip's menu, opened onto the memory files under no heading (composer/modes/ModeChrome.tsx: the chip
  // is the mode's one menu trigger, inside the editor's `data-mode` element, on both builds). The files are the widget
  // backend's get_memory_dialog answer (reads#69: User instructions and Project instructions), so the menu settles: no
  // loading line ("Reading the memory files…", the same literal on both builds), both files listed, and master's heading
  // "# appends to" (its DropdownMenu.Label) in view there and absent on M2.
  const memoryChip = () => pane(page).locator('[data-composer] [data-mode="memory"] button[aria-haspopup="menu"]').first();
  const memoryMenu = () => page.getByRole('menu').first();
  const clearBox = async () => {
    await closeOverlays(page);
    await box(page).click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
  };
  await shot(page, m2({ id: 'm2-memory-menu', title: 'The message box in memory mode, its Memory chip’s menu', how: 'An idle session; type # in the message box, then press the Memory chip', state: 'The menu of where # appends: the memory files read, under no heading; nothing sent', folders: ['composer', 'composer/modes'] }), async () => {
    await openSession(page, SID.idle);
    await m2Build(page);
    await box(page).click();
    await page.keyboard.type('#');
    await memoryChip().click();
    await expect(memoryMenu()).toBeVisible({ timeout: 5_000 });
  }, {
    check: checks(
      () => expect(memoryChip(), 'the Memory chip open').toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 }),
      () => inView(memoryMenu(), 'its menu'),
      () => expect(memoryMenu().getByText('Reading the memory files…', { exact: true }), 'the files read: no loading line').toHaveCount(0, { timeout: 5_000 }),
      () => inView(memoryMenu().getByRole('menuitem').filter({ hasText: 'User instructions' }), 'the user’s memory file'),
      () => inView(memoryMenu().getByRole('menuitem').filter({ hasText: 'Project instructions' }), 'the project’s memory file'),
      () => (m2Cut() ? expect(memoryMenu().getByText('# appends to', { exact: true }), 'no heading (C10)').toHaveCount(0) : inView(memoryMenu().getByText('# appends to', { exact: true }), 'master’s heading')),
    ),
    after: clearBox,
  });

  // C54: an agent's description only on its highlighted row (composer/mentions/AtMenu.tsx). The widget backend's
  // catalogue (pass2/auto-routed#4) lists Explore; typed in full, its row is the one highlighted, and its description
  // stands in it on both builds (master draws every row's description at rest)
  const explore = () => page.getByRole('listbox').first().getByRole('option', { name: /^Explore\b/ }).first();
  await shot(page, m2({ id: 'm2-mention-agent', title: 'Mention menu (typing @), an agent highlighted', how: 'An idle session; type @Explore in the message box', state: 'The Explore agent highlighted, its description on its row', folders: ['composer/mentions', 'composer', 'composer/editor'] }), async () => {
    await openSession(page, SID.idle);
    await m2Build(page);
    await box(page).click();
    await page.keyboard.type('@Explore');
    await expect(explore()).toBeVisible({ timeout: 10_000 });
  }, {
    check: checks(
      () => expect(explore(), 'Explore highlighted').toHaveAttribute('aria-selected', 'true', { timeout: 5_000 }),
      () => inView(explore().getByText(/^Fast read-only search agent/), 'its description, the catalogue’s words'),
    ),
    after: clearBox,
  });
  await reset(page);
}

// ======================================================================================================================
// Launch 2: sessions discovered from a scratch engine store, then played through the replay engine, so their
// transcripts have real tool calls, agents and finished turns; the right column's panels; the Artifacts library.
// ======================================================================================================================
type Row = { direction: string; frame: { type?: string; message?: { content?: unknown } } };
const promptsOf = (fixture: string) =>
  readFileSync(join(REPO_ROOT, fixture), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Row)
    .filter((r) => r.direction === 'out' && r.frame.type === 'user').map((r) => r.frame.message!.content as string);

const PLAYED = [
  { key: 'agents', fixture: 'test/fixtures/transcript/agents-and-messages.jsonl', engineId: '0a1b2c3d-0000-4000-8000-000000000001', title: 'Survey TODOs with two agents' },
  { key: 'tools', fixture: 'test/fixtures/transcript/mockup-turn.jsonl', engineId: '0a1b2c3d-0000-4000-8000-000000000002', title: 'Fix the sidebar drag' },
  { key: 'explore', fixture: 'test/fixtures/transcript/exploration-and-web.jsonl', engineId: '0a1b2c3d-0000-4000-8000-000000000003', title: 'Research the stream reconnects' },
  { key: 'edit', fixture: 'test/fixtures/transcript/edit-and-receipt.jsonl', engineId: '0a1b2c3d-0000-4000-8000-000000000004', title: 'Tidy the quota module' },
] as const;
// pass3/stop-task: a background shell, a background agent and a workflow, each stopped by the person after its prompt
const STOPPED = { fixture: 'spikes/protocol-probe/fixtures/pass3/stop-task.jsonl', engineId: '0a1b2c3d-0000-4000-8000-000000000005', title: 'Stop the background work', stops: ['ba3cr5gnx', 'ac2bd8a00d8e492f4', 'wkmzd07jp'] };
const IDLE = ['Usage reset countdown', 'SDK wire inventory', 'Terminal workflow notes', 'Workstation north star'];

// The turn's line ends its turn, under the answer (board ticket 789); opening it shows the work as runs of calls, one
// line each, which open in turn (U2a: transcript/view/rows/Divider.tsx, Group.tsx).
const turnLine = (page: Page) => pane(page).locator('.transcript-row[data-kind="divider"] button.transcript-disclosure');
const scroller = (page: Page) => pane(page).locator('[data-transcript-scroller]').first();
async function toTop(page: Page) {
  await scroller(page).evaluate((el) => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }));
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  }).catch(() => undefined);
  await page.waitForTimeout(400);
}
async function toEnd(page: Page) {
  // the list is virtual: twice, the second after the first's rows have drawn
  for (let i = 0; i < 2; i++) {
    await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(600);
  }
}
// A transcript control pressed with what covers it cleared first (closeOverlays), each click given a few seconds; a
// control that takes neither of two clicks fails the step, naming what covered it, where the click's own 30 s wait,
// repeated down a loop, outlasted the test.
async function press(page: Page, target: Locator, what: string) {
  for (let attempt = 0; ; attempt++) {
    await closeOverlays(page);
    const error = await target.click({ timeout: 4_000 }).then(() => null, (e: unknown) => e);
    if (error === null) return;
    if (attempt === 1) {
      const cover = stripVTControlCharacters(error instanceof Error ? error.message : String(error)).split('\n').find((line) => line.includes('intercepts pointer events'));
      throw new Error(`${what} took no click, twice${cover ? `: ${cover.trim().slice(0, 200)}` : ''}`, { cause: error });
    }
  }
}
// Each closed disclosure `closed` matches pressed open, the first first, until none is left or `max` presses were made.
async function unfold(page: Page, closed: Locator, what: string, max: number) {
  for (let i = 0; i < max && (await closed.count()) > 0; i++) {
    await press(page, closed.first(), what);
    await page.waitForTimeout(300);
  }
}
async function openTurn(page: Page, runs = false) {
  const line = turnLine(page).last();
  if ((await line.getAttribute('aria-expanded', { timeout: 10_000 })) !== 'true') await press(page, line, 'the last turn’s line');
  await page.waitForTimeout(800);
  if (runs) await unfold(page, pane(page).locator('.transcript-run-line[aria-expanded="false"]'), 'a closed run’s line', 20);
  await toTop(page);
}
async function unfoldAll(page: Page) {
  await unfold(page, pane(page).locator('.transcript-row[data-kind="divider"] button.transcript-disclosure[aria-expanded="false"], .transcript-run-line[aria-expanded="false"]'), 'a closed turn’s or run’s line', 40);
  await toTop(page);
}
// A panel's own sections open (section[data-section] > h3 > button): the agents' Running, Done and On disk
async function unfoldSections(page: Page, id: string) {
  const folded = surface(page, id).locator('section[data-section] > h3 > button[aria-expanded="false"], section[data-section] h3 > button[aria-expanded="false"]');
  for (let i = 0; i < 4 && (await folded.count()) > 0; i++) await folded.first().click();
  await page.waitForTimeout(600);
}

test('replay: transcripts, the right column, the Artifacts library and an editor', async () => {
  test.setTimeout(1_200_000);
  const repo = makeRepo('MAWS');
  const other = makeRepo('orbit');
  const config = join(SCRATCH, 'claude-config');
  rmSync(config, { recursive: true, force: true });
  [...PLAYED, STOPPED].forEach((p, i) => seedSession(config, repo, p.engineId, p.title, `2026-09-29T10:${String(10 + i).padStart(2, '0')}:00.000Z`));
  IDLE.forEach((title, i) => seedSession(config, i % 2 ? other : repo, `0a1b2c3d-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, title, `2026-09-29T10:0${i}:00.000Z`));
  const usage = usageFixture();
  trust(config);
  // a file outside every session's folder, which File › Open picks through the e2e pick seam (src/main/client/e2e-pick.ts).
  // It is in MAWS's own profile folder: a file the person picks anywhere else opens editable, with no Read-only mark (the
  // pick grants it, services/files/service.ts), and MAWS's own files are the ones a pick still opens read-only
  // (services/files/own.ts; e2e/sessions.spec.ts's A8 opens one so)
  mkdirSync(join(SCRATCH, 'profile-replay'), { recursive: true });
  const outside = join(SCRATCH, 'profile-replay', 'notes.txt');
  writeFileSync(outside, 'Notes kept outside every project.\n');
  const maws = await launchMaws({ userData: join(SCRATCH, 'profile-replay'), prepare: noGh, env: BASE_ENV({ MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config, MAWS_CLAUDE_USAGE_DIR: usage, MAWS_E2E_PICK_PATHS: outside, PATH: NO_GH_PATH }) });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    const ids: Record<string, string> = {};
    await expect.poll(async () => {
      const { sessions } = value(await invoke(page, 'session.list', {}));
      for (const p of [...PLAYED, { ...STOPPED, key: 'stopped' }]) ids[p.key] = sessions.find((s) => s.engineSessionId === p.engineId)?.appId ?? '';
      return Object.values(ids).every(Boolean);
    }, { timeout: 30_000 }).toBe(true);
    const status = async (id: string) => value(await invoke(page, 'session.status', { appSessionId: id as never }));

    // play each journal into its session: open it, launch the replay, send what the journal's person sent
    mkdirSync(join(SCRATCH, 'journals'), { recursive: true });
    for (const p of PLAYED) {
      try {
        const journal = join(SCRATCH, 'journals', p.fixture.split('/').at(-1)!);
        cpSync(join(REPO_ROOT, p.fixture), journal);
        await openSession(page, ids[p.key]!);
        await launchReady(page, ids[p.key]!, journal, { cwd: repo });
        for (const content of promptsOf(p.fixture)) {
          value(await invoke(page, 'session.send', { appSessionId: ids[p.key] as never, content }));
          await expect.poll(async () => (await status(ids[p.key]!)).turn, { timeout: 60_000 }).toBeNull();
        }
        // a launched replay files the transcript under the fixture's engine id and the record loses its seeded title
        value(await invoke(page, 'session.rename', { appSessionId: ids[p.key] as never, title: p.title }));
      } catch (error) {
        setupFailed(`replay ${p.key}`, error);
      }
    }
    // the stopped work: each prompt, then the person's stop of what it started (the recording's stop_task writes). The
    // replay holds at each recorded `out` row until the app writes it (engine-host/replay-transport.ts), and the shell's
    // and the workflow's stops were written while their turns still ran: stop-task.jsonl's seq 42 comes before its first
    // turn's result (57), and 230 before the third's (243); only the agent's (135) follows its turn's result (130). So
    // each stop is written once the task it stops is listed running (its `background_tasks_changed`, seq 39, 104, 222,
    // which the replay plays before it holds at the stop), and the turn's end is awaited after it; waiting for the turn
    // to end first, as M0's run did, waited on a turn the replay could not end. After the agent's stop the engine opens a
    // turn of its own for the stopped agent's notice (seq 141 to 166), which ends before the next prompt is sent.
    let stopped = false;
    try {
      const journal = join(SCRATCH, 'journals', 'stop-task.jsonl');
      cpSync(join(REPO_ROOT, STOPPED.fixture), journal);
      await openSession(page, ids.stopped!);
      await launchReady(page, ids.stopped!, journal, { cwd: repo });
      const prompts = promptsOf(STOPPED.fixture);
      for (let i = 0; i < STOPPED.stops.length; i++) {
        const task = STOPPED.stops[i]!;
        value(await invoke(page, 'session.send', { appSessionId: ids.stopped as never, content: prompts[i]! }));
        await expect.poll(async () => (await status(ids.stopped!)).backgroundTasks.some((t) => t.taskId === task), { message: `${task} listed running`, timeout: 60_000 }).toBe(true);
        value(await invoke(page, 'session.stopTask', { appSessionId: ids.stopped as never, taskId: task } as never));
        await expect.poll(async () => (await status(ids.stopped!)).turn, { message: `the turn of ${task}’s stop ended`, timeout: 60_000 }).toBeNull();
        await page.waitForTimeout(1500);
        await expect.poll(async () => (await status(ids.stopped!)).turn, { message: 'the engine’s own turn after the stop ended', timeout: 60_000 }).toBeNull();
      }
      stopped = true;
    } catch (error) {
      setupFailed('replay stopped', error);
    }
    await dismissToasts(page);
    await page.waitForTimeout(1000);

    await shot(page, { id: 'shell-agents', title: 'The shell: a finished session that used agents', how: 'Click the session in the sidebar', state: 'One finished turn that dispatched two agents, messaged one and searched code, folded to its line under the answer; the right column’s session cards beside it', folders: ['shell', 'sidebar', 'transcript', 'tools', 'panel', 'panel/summary', 'composer', 'statusline', 'session'] }, async () => {
      await openSession(page, ids.agents!);
    });
    await shot(page, { id: 'shell-agents-composer-hover', title: 'The shell, pointer and caret in the message box', how: 'Click into the message box of a session', state: 'The agents session with the pointer and the caret in the message box: its chips (model, mode, place)', folders: ['composer', 'statusline', 'widgets'], hover: true }, async () => {
      await openSession(page, ids.agents!);
      // the pointer and the caret in the box: chips that wait for the box's hover or focus show (the caret is hidden)
      await box(page).click();
      await box(page).hover();
      await page.waitForTimeout(1200);
    });
    // the turn's line folded (T1, T2: on M2's build its duration and what the turn did, with no "Worked for")
    const folded = (open: boolean) => () => inView(turnLine(page).last().and(page.locator(`[aria-expanded="${open}"]`)), `the turn’s line ${open ? 'open' : 'folded'}`);
    await shot(page, { id: 'shell-tools', title: 'A finished session with many tool calls', how: 'Click the session in the sidebar', state: 'One finished turn: reads, searches, edits and commands, folded to its line', folders: ['transcript', 'tools', 'markup', 'session', 'composer'] }, async () => {
      await openSession(page, ids.tools!);
    }, { check: folded(false) });
    await shot(page, { id: 'shell-explore', title: 'A finished session that searched and read the web', how: 'Click the session in the sidebar', state: 'Searches, reads, a web search and fetch, a skill and a connector call, folded to the turn’s line', folders: ['transcript', 'tools', 'markup'] }, async () => {
      await openSession(page, ids.explore!);
    });
    await shot(page, { id: 'shell-edit', title: 'A finished session that edited files', how: 'Click the session in the sidebar', state: 'Read, Edit, MultiEdit, Write and a command, with the turn’s receipt', folders: ['transcript', 'tools', 'markup', 'delivery'] }, async () => {
      await openSession(page, ids.edit!);
    });
    await shot(page, { id: 'transcript-hover-turn', title: 'Transcript, pointer on a finished turn’s line', how: 'Hover the turn’s line, the last line of the turn, under its answer', state: 'The tool-heavy session with its turn folded; the pointer on its line', folders: ['transcript', 'transcript/view'], hover: true }, async () => {
      await openSession(page, ids.tools!);
      await pane(page).locator('.transcript-row[data-kind="divider"]').last().hover();
      await page.waitForTimeout(1200);
    });
    await shot(page, { id: 'shell-tools-open', title: 'A finished turn opened: its tool calls', how: 'Click the turn’s line at the end of the turn', state: 'The tool-heavy session’s turn opened, read from the top: its steps as runs of calls, one line each', folders: ['transcript', 'transcript/view', 'tools', 'markup'] }, async () => {
      await openSession(page, ids.tools!);
      await openTurn(page);
    }, { check: () => expect(turnLine(page).last(), 'the turn’s line open').toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 }) });
    await shot(page, m0({ id: 'm0-shell-tools-runs', title: 'A finished turn opened, every run opened', how: 'Then click each run’s line', state: 'The tool-heavy session’s turn with every run opened onto its calls, read from the top', folders: ['transcript', 'transcript/view', 'tools', 'markup'] }), async () => {
      await openSession(page, ids.tools!);
      await openTurn(page, true);
    });
    await shot(page, m0({ id: 'm0-shell-tools-open-end', title: 'A finished turn opened, scrolled to its end', how: 'The opened turn, scrolled down', state: 'The end of the tool-heavy session’s opened turn: its last calls, the answer and the turn’s line', folders: ['transcript', 'transcript/view', 'tools'] }), async () => {
      await openSession(page, ids.tools!);
      await openTurn(page, true);
      await toEnd(page);
    });
    // M2 (T18, T20, T22): a command's call opened, a copy glyph holding the keyboard. The call is mockup-turn.jsonl's
    // `pnpm test` (toolu_synth_mock_9; a cell's id is `cell:<tool use id>`, transcript/model/keys.ts); its line opens its
    // detail (transcript/view/cells/CellLine.tsx). Copy command is the heading's one button on both builds (master's
    // worded button, M2's glyph named by those words, drawn while the heading is pointed at or holds focus); Copy output
    // on M2's build is the glyph over the output's corner, drawn the same way, where master words it in the footer. Each
    // glyph shows only for its own part, so each is its own scene.
    const call = () => pane(page).locator('[data-cell-id="cell:toolu_synth_mock_9"]').first();
    const callOpen = async () => {
      await openSession(page, ids.tools!);
      await m2Build(page);
      await openTurn(page, true);
      await seek(page, call());
      const line = call().locator('button.transcript-cell-line').first();
      if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
      await expect(call().locator('.transcript-shell').first(), 'the call’s detail').toBeVisible({ timeout: 10_000 });
      await letGo(page);
    };
    const copyCommand = () => call().locator('.transcript-shell-heading button').first();
    await shot(page, m2({ id: 'm2-shell-call-open', title: 'A command’s call opened, its copy glyph holding the keyboard', how: 'The tool-heavy session’s turn and runs opened, click the pnpm test call, then Tab to its Copy command', state: 'The call’s command, output and footer (its time alone), Copy command focused with its word the tooltip; Copy all a glyph in the footer', folders: ['transcript/view', 'transcript/view/cells', 'tools', 'ui'] }), async () => {
      await callOpen();
      await copyCommand().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await copyCommand().focus();
    }, { check: checks(focusIn(copyCommand(), 'Copy command'), drawn(copyCommand(), 'Copy command drawn'), tipShown(page, copyCommand(), 'Copy command', copyCommand(), m2Cut)) });
    await letGo(page);
    // its name on both builds (transcript/model/copy.ts DETAIL.copyOutput): M2's glyph over the output, master's worded footer button
    const copyOutput = () => call().locator('.transcript-shell-output').getByRole('button', { name: 'Copy output', exact: true }).first();
    await shot(page, m2({ id: 'm2-shell-output-copy', title: 'A command’s call opened, its output’s copy glyph holding the keyboard', how: 'The tool-heavy session’s turn and runs opened, click the pnpm test call, then Tab to its Copy output', state: 'The output’s copy glyph focused over the output’s corner, its word Copy output the tooltip (master words it in the footer)', folders: ['transcript/view', 'transcript/view/cells', 'ui'] }), async () => {
      await callOpen();
      if (!m2Cut()) return void (await call().locator('.transcript-shell-footer').scrollIntoViewIfNeeded());
      await copyOutput().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await copyOutput().focus();
    }, {
      check: async () => {
        if (!m2Cut()) return inView(call().locator('.transcript-shell-footer').getByRole('button', { name: 'Copy output', exact: true }), 'master’s worded Copy output in the footer');
        await checks(focusIn(copyOutput(), 'Copy output'), drawn(copyOutput(), 'Copy output drawn'), tipShown(page, copyOutput(), 'Copy output', copyOutput(), m2Cut))();
      },
    });
    await letGo(page);
    await shot(page, { id: 'shell-agents-open', title: 'A finished turn opened: agents and their messages', how: 'Click the turn’s line of the agents session', state: 'Two agents dispatched, one messaged, a search, as runs read from the top', folders: ['transcript', 'transcript/view', 'tools/agents'] }, async () => {
      await openSession(page, ids.agents!);
      await openTurn(page);
    });
    await shot(page, { id: 'shell-explore-open', title: 'A finished turn opened: searches, reads and the web', how: 'Click the turn’s line of the research session', state: 'Searches, reads, a web search and fetch, a skill and a connector call, as runs read from the top', folders: ['transcript', 'transcript/view', 'tools'] }, async () => {
      await openSession(page, ids.explore!);
      await openTurn(page);
    });
    const noSwitch = 'the Report/Transcript switch above a session was removed (U2 A14); its successor, one line above the message box, draws only for a session that holds a to-human message, which r2-disk-tohuman and m0-tohuman-full show';
    gone({ id: 'shell-tools-transcript-view', title: 'The Transcript view of a session', how: 'Transcript in the switch at the top right of the session', state: 'The tool-heavy session shown as its full transcript instead of the report', folders: ['transcript', 'owner/report', 'transcript/view'] }, noSwitch);
    gone({ id: 'shell-tools-transcript-view-end', title: 'The Transcript view, scrolled to its end', how: 'Transcript view, scrolled down', state: 'The end of the tool-heavy session’s transcript', folders: ['transcript', 'transcript/view', 'tools'] }, `${noSwitch}; m0-shell-tools-open-end shows the end of the opened turn`);

    // ---- the right column's panels, on the agents session (its directory is the scratch repository) ----
    const PANELS: [string, string, string, string, string[], (() => Promise<void>)?][] = [
      ['session-info', 'Session info', 'View › More surfaces › Session info', 'Session info of a finished replayed session', ['tools/session-info', 'panel']],
      ['source-control', 'Source control', 'View › More surfaces › Source control', 'The scratch repository’s Source control page: on main; Uncommitted, three changed files (one edited, one new, one staged); Commits, one since origin/main, not pushed; the pull request part (no gh on this PATH)', ['tools/scm', 'tools/code/review', 'panel', 'panel/summary'], () => soft(surface(page, 'source-control').locator('[data-scm-page]'), 'the Source control page')],
      ['review', 'Review', 'View › Review (⌘⇧D)', 'The same changes as a review: the Uncommitted scope, each changed file a section of one stack', ['tools/code/review', 'tools/code', 'panel', 'side'], () => soft(surface(page, 'review').locator('[data-review-stack]'), 'the review stack')],
      ['subagents', 'Subagents', 'View › More surfaces › Subagents', 'The two agents the turn dispatched, each section open', ['tools/agents', 'tools', 'panel'], () => unfoldSections(page, 'subagents')],
      ['background', 'Background tasks', 'View › More surfaces › Background tasks', 'The session’s background tasks', ['tools/agents/background', 'tools/agents', 'panel']],
      ['files', 'Files', 'View › Files (⌘⇧F)', 'The scratch repository’s files: the Go to file field, a Changed group of the three changed entries, then the tree', ['tools/code/files', 'tools/code', 'panel']],
    ];
    for (const [id, title, how, state, folders, then] of PANELS) {
      await shot(page, { id: `panel-${id}`, title: `Right column, ${title}`, how, state, folders }, async () => {
        await openSession(page, ids.agents!);
        await sideSurface(app, page, id);
        await then?.();
      });
    }
    gone(r2({ id: 'r2-scm-push-sheet', title: 'Source control, the Push sheet', how: 'Source control › Push', state: 'One commit ahead of a local origin; the sheet open, nothing pushed', folders: ['tools/scm'] }), 'U5b-2 made Source control a page to read: the Push and pull request sheets, the remote actions and the commit form were deleted (tools/scm/SourceControlPage.tsx); m0-scm-behind and m0-scm-conflict show the page’s other states');
    await shot(page, m0({ id: 'm0-scm-commit-review', title: 'A commit opened from Source control', how: 'Source control, focus a commit and press Enter', state: 'Review on the Commit scope: the scratch repository’s unpushed commit', folders: ['tools/scm', 'tools/code/review', 'panel'] }), async () => {
      await openSession(page, ids.agents!);
      await sideSurface(app, page, 'source-control');
      await surface(page, 'source-control').locator('button[data-scm-commit]').first().focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-surface="review"] [data-chip="commit"][aria-pressed="true"]').first()).toBeVisible({ timeout: 10_000 });
    });
    await shot(page, m0({ id: 'm0-review-staged', title: 'Review, the Staged scope', how: 'Review, the Staged chip', state: 'The one staged file as a review', folders: ['tools/code/review', 'panel'] }), async () => {
      await openSession(page, ids.agents!);
      await sideSurface(app, page, 'review');
      await surface(page, 'review').locator('[data-chip="staged"]').first().click();
      await expect(surface(page, 'review').locator('[data-chip="staged"][aria-pressed="true"]').first()).toBeVisible({ timeout: 10_000 });
    });
    await shot(page, m0({ id: 'm0-files-goto', title: 'Files, Go to file', how: 'Go › Go to file (⌘P), type “side”', state: 'The finder’s results for “side” in the scratch repository', folders: ['tools/code/files', 'panel'] }), async () => {
      await openSession(page, ids.agents!);
      await goToFile(app);
      await expect(page.locator('[data-surface="files"] [data-files-filter]').first()).toBeFocused({ timeout: 10_000 });
      await page.keyboard.type('side');
      await soft(page.locator('[data-files-results] [data-files-result]'), 'a finder result');
    });
    await closeOverlays(page);
    await shot(page, m0({ id: 'm0-files-nomatch', title: 'Files, Go to file with no match', how: 'Go › Go to file (⌘P), type “zzqx”', state: 'The finder’s line for no match', folders: ['tools/code/files', 'panel'] }), async () => {
      await openSession(page, ids.agents!);
      await goToFile(app);
      await page.locator('[data-surface="files"] [data-files-filter]').first().fill('zzqx');
      await expect(page.locator('[data-files-line][data-line="none"]').first()).toBeVisible({ timeout: 10_000 });
    });
    await closeOverlays(page);
    await shot(page, m0({ id: 'm0-file-beside-chat', title: 'A file open beside the conversation', how: 'Files, click a file in the tree', state: 'src/sidebar.ts of the scratch repository in the side column’s viewer, its change marked', folders: ['tools/code/viewer', 'tools/code/files', 'panel'] }), async () => {
      await openSession(page, ids.agents!);
      await sideSurface(app, page, 'files');
      await filesTree(page);
      const root = surface(page, 'files').locator('[role="treeitem"][data-kind="root"]').first();
      if ((await root.getAttribute('aria-expanded').catch(() => null)) === 'false') await root.click();
      const src = treeItem(page, `${repo}/src`);
      if ((await src.getAttribute('aria-expanded').catch(() => null)) === 'false') await src.click();
      await treeItem(page, `${repo}/src/sidebar.ts`).click();
      await expect(page.locator(`[data-region="panel"] [data-file-viewer][data-path="${repo}/src/sidebar.ts"]`).first()).toBeVisible({ timeout: 10_000 });
    });
    await shot(page, m0({ id: 'm0-file-outside', title: 'A file outside the session’s folders, its Read-only panel', how: 'File › Open File… (⌘O) on a file outside every project, then its read-only mark', state: 'notes.txt from MAWS’s own profile folder, outside every session’s folders: the viewer’s Read-only mark and its panel', folders: ['tools/code/viewer', 'panel'] }), async () => {
      await openSession(page, ids.agents!);
      await menu(app, 'file.open');
      const viewer = page.locator(`[data-file-viewer][data-path="${outside}"]`).first();
      await expect(viewer).toBeVisible({ timeout: 10_000 });
      await viewer.locator('[data-read-only="maws"]').first().click();
      await soft(page.locator('[data-read-only-panel]'), 'the Read-only panel');
    });
    await closeOverlays(page);
    await shot(page, { id: 'panel-subagents-tools-session', title: 'Right column, Subagents, on a session with no agents', how: 'Subagents with the tool-heavy session in front', state: 'An empty Subagents panel', folders: ['tools/agents', 'tools', 'panel'] }, async () => {
      await openSession(page, ids.tools!);
      await sideSurface(app, page, 'subagents');
    });
    await shot(page, m0({ id: 'm0-subagents-stopped', title: 'Right column, Subagents, an agent the person stopped', how: 'The session whose background work was stopped, Subagents with its sections open', state: 'The background agent stopped by the person, under Done', folders: ['tools/agents', 'panel'] }), async () => {
      if (!stopped) throw new Error('the stop-task replay did not reach its third stop');
      await openSession(page, ids.stopped!);
      await sideSurface(app, page, 'subagents');
      await unfoldSections(page, 'subagents');
    }, {
      // the recording's agent (stop-task.jsonl: ac2bd8a00d8e492f4, "Sleep 90 seconds", stopped at seq 135) under Done,
      // its line saying stopped (tools/agents/subagents/AgentRow.tsx; the words of tools/agents/copy.ts, unchanged by M2)
      check: async () => {
        const row = surface(page, 'subagents').locator('section[data-section="done"] [data-agent-row="ac2bd8a00d8e492f4"]');
        await inView(row, 'the stopped agent under Done');
        await expect(row.locator('[data-part="state"]').first(), 'its line').toHaveText(new RegExp(`^${SUBAGENTS_COPY.stoppedUndated}\\b`), { timeout: 3_000 });
      },
    });
    await shot(page, m0({ id: 'm0-background-stopped', title: 'Right column, Background tasks, stopped work', how: 'The same session, Background tasks with Done open', state: 'A shell and a workflow the person stopped, under Done', folders: ['tools/agents/background', 'panel'] }), async () => {
      if (!stopped) throw new Error('the stop-task replay did not reach its third stop');
      await openSession(page, ids.stopped!);
      await sideSurface(app, page, 'background');
      await unfoldSections(page, 'background');
    }, {
      // the recording's shell (ba3cr5gnx, stopped at seq 42) and workflow (wkmzd07jp, stopped at seq 230) under Done, each
      // saying stopped (tools/agents/background/TaskRows.tsx's line, run-parts.tsx's badge)
      check: async () => {
        const done = surface(page, 'background').locator('section[data-section="done"]');
        const shell = done.locator('[data-shell="ba3cr5gnx"]');
        const workflow = done.locator('[data-workflow="wkmzd07jp"]');
        await inView(shell, 'the stopped shell under Done');
        await expect(shell.locator('[data-part="state"]').first(), 'the shell’s state').toContainText(BACKGROUND_COPY.status.stopped, { timeout: 3_000 });
        await inView(workflow, 'the stopped workflow under Done');
        await expect(workflow.locator('[data-part="status"]').first(), 'the workflow’s badge').toHaveText(BACKGROUND_COPY.status.stopped, { timeout: 3_000 });
      },
    });
    await reset(page);

    // typed dialogs that need a session with turns and session actions (index mode)
    await shot(page, m0({ id: 'm0-dialog-rewind', title: 'Rewind (/rewind)', how: 'Type /rewind in the agents session and press Enter', state: 'The session’s prompts, newest first, and what to rewind: conversation, files or both', folders: ['widgets', 'composer'] }), async () => {
      await openSession(page, ids.agents!);
      await typed(page, 'rewind');
      await expect(dialogOf(page, 'rewind')).toBeVisible({ timeout: 15_000 });
    });
    await reset(page);
    await shot(page, m0({ id: 'm0-dialog-rename-index', title: 'Rename (/rename) in an indexed session', how: 'Type /rename in the agents session and press Enter', state: 'The Rename dialog of a session the app indexes', folders: ['widgets', 'sessions', 'composer'] }), async () => {
      await openSession(page, ids.agents!);
      await typed(page, 'rename');
      await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15_000 });
    });
    await reset(page);

    // ---- the Artifacts library and an editor ----
    const created: string[] = [];
    {
      for (const [kind, title] of [['document', 'Launch notes'], ['presentation', 'Quarterly review'], ['dashboard', 'Usage by week'], ['design', 'Sidebar redesign']] as const) {
        const result = await invoke(page, 'artifacts.create', { kind, title } as never);
        if (result.ok) created.push((result.value as { artifact: { id: string } }).artifact.id);
        else console.log(`[words] artifacts.create ${kind}: ${result.error.message}`);
      }
      // the bytes made in the page, as the library spec makes them
      const html = (await page.evaluate(
        ([t, h]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean; value?: { artifact: { id: string } } }> } }).maws.invoke('artifacts.create', { kind: 'html', title: t, content: { bytes: new TextEncoder().encode(h), name: 'index.html' } }),
        ['Status page', '<!doctype html><h1>Status</h1>'] as const,
      )) as { ok: boolean; value?: { artifact: { id: string } } };
      if (html.ok) created.push(html.value!.artifact.id);
    }
    const make = page.locator('section[aria-labelledby="library-make"]').first();
    await shot(page, { id: 'artifacts-library', title: 'Artifacts library', how: 'Artifacts in the sidebar, or View › Artifacts', state: 'Five artifacts made in this profile and the seeded design systems; above them Make something new: four cards and More, with the design-system choice', folders: ['library', 'artifacts', 'destination'] }, async () => {
      await library(app, page);
      await soft(make.locator('[data-make-kind] > button:not([disabled])'), 'the make-new cards');
    });
    await shot(page, { id: 'artifacts-library-hover', title: 'Artifacts library, pointer on a row', how: 'Hover a row in the Artifacts library', state: 'The first row under the pointer', folders: ['library'], hover: true }, async () => {
      await library(app, page);
      await page.locator('[data-library] article[data-artifact-row]').first().hover();
      await page.waitForTimeout(1200);
    });
    await shot(page, m0({ id: 'm0-library-more', title: 'Artifacts library, Make something new’s More menu', how: 'Artifacts, the last button of Make something new', state: 'The More menu: a design system, an HTML page, a file', folders: ['library'] }), async () => {
      await library(app, page);
      await make.locator('> div:last-child > button').last().click();
      await expect(page.locator('[role="menu"]').first()).toBeVisible({ timeout: 5_000 });
    });
    await closeOverlays(page);
    await shot(page, { id: 'artifact-document', title: 'A document artifact open', how: 'Click a document in the Artifacts library', state: 'The document editor with one paragraph typed', folders: ['artifacts', 'library', 'tools/document', 'src/artifacts/document/editor'] }, async () => {
      await library(app, page);
      await page.locator(`[data-library] article[data-artifact-row="${created[0]}"]`).click();
      const text = page.locator(`[data-artifact-tab="${created[0]}"] .ds-doc .ProseMirror`).first();
      await expect(text).toBeVisible({ timeout: 20_000 });
      if (!(await text.innerText()).includes('Friday')) {
        await text.click();
        await page.keyboard.type('The launch moves to Friday. Owners confirm by Wednesday.');
      }
      await page.locator('[data-region="main"]').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    });
    await shot(page, m0({ id: 'm0-send-to', title: 'An artifact’s Send to sheet', how: 'The document, its header’s Send to', state: 'The Send to sheet of the document, no connection made', folders: ['delivery', 'tools/document', 'artifacts'] }), async () => {
      await page.locator('[data-region="main"] [data-editor-header] [data-editor-action="sendTo"]').first().click();
      await expect(page.locator('[data-send-to]').first()).toBeVisible({ timeout: 10_000 });
    });
    await closeOverlays(page);
    await reset(page);
    // last: the dialog does not always close on Escape
    await shot(page, { id: 'permissions-dialog', title: 'Permissions (the /permissions dialog)', how: 'Session info › Permissions › /permissions, or /permissions in the message box', state: 'The finished agents session’s permissions, before its rules are read', folders: ['widgets', 'tools/session-info', 'panel'] }, async () => {
      await openSession(page, ids.agents!);
      await sideSurface(app, page, 'session-info');
      // the row's button is the command's name, not the app's copy
      await surface(page, 'session-info').getByText('/permissions', { exact: true }).first().click();
      // its rules are read on request, which relaunches the session's engine: a replayed session's cannot, so the dialog
      // is taken as it opens
      await expect(dialogOf(page, 'permissions')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1500);
    });
    await reset(page);
  } finally {
    await maws.cleanup();
  }
});

// ======================================================================================================================
// Round 2, launch 3: recorded engine transcripts read from disk (the repository's transcript fixtures, their cwd and
// session id moved onto the scratch repositories), and the press-to-open menus and popovers around a session.
// ======================================================================================================================
const DISK: { key: string; file: string; title: string; state: string; folders: string[]; added?: boolean; open?: boolean }[] = [
  { key: 'subagents', file: 'test/fixtures/transcripts/subagent-parent.jsonl', title: 'A session whose agents have finished', state: 'Two agents dispatched and finished, with their own transcripts on disk', folders: ['transcript', 'transcript/view', 'tools/agents'] },
  { key: 'browser', file: 'test/fixtures/transcripts/p1-maws-browser.jsonl', title: 'A session that drove the browser', state: 'A recorded session whose turns used the browser tools', folders: ['transcript', 'transcript/view', 'tools/browser', 'computer-use'] },
  { key: 'ask', file: 'test/fixtures/transcripts/p1-maws-ask-async.jsonl', title: 'A session that asked the person questions', state: 'A recorded session where the agent asked with MAWS’s ask without waiting; the question’s row', folders: ['transcript', 'transcript/view', 'owner', 'attention'] },
  { key: 'artifacts', file: 'test/fixtures/transcripts/p1-maws-artifacts.jsonl', title: 'A session that made an artifact', state: 'A recorded session that created, screenshotted and updated an artifact', folders: ['transcript', 'transcript/view', 'tools/maws', 'artifacts'] },
  { key: 'compact', file: 'test/fixtures/transcripts/w1-compact.jsonl', title: 'A session that was compacted', state: 'A recorded session with a compaction boundary', folders: ['transcript', 'transcript/view'] },
  { key: 'hooks', file: 'test/fixtures/transcripts/w1-hooks-blocking.jsonl', title: 'A session whose hook blocked', state: 'A recorded session with a blocking hook', folders: ['transcript', 'transcript/view'] },
  { key: 'interrupted', file: 'test/fixtures/transcripts/interrupt-marker.jsonl', title: 'A session the person interrupted', state: 'A recorded session with an interrupt marker', folders: ['transcript', 'transcript/view'] },
  { key: 'errors', file: 'test/fixtures/transcript-d1-api-errors.jsonl', title: 'A session with API errors', state: 'Synthetic transcript with API error lines', folders: ['transcript', 'transcript/view'] },
  { key: 'notices', file: 'test/fixtures/transcript-d1-notices.jsonl', title: 'A session with notice lines', state: 'Synthetic transcript of system notices', folders: ['transcript', 'transcript/view'] },
  { key: 'local', file: 'test/fixtures/transcript-d1-local-commands.jsonl', title: 'A session with local commands', state: 'Synthetic transcript of typed local commands and their output', folders: ['transcript', 'transcript/view'] },
  { key: 'agentfail', file: 'test/fixtures/transcript-d1-agent-failure.jsonl', title: 'A session whose agent failed', state: 'Synthetic transcript with a failed agent', folders: ['transcript', 'transcript/view', 'tools/agents'] },
  // the to-human view is read folded: its record line is the fold (owner/view)
  { key: 'tohuman', file: 'test/fixtures/transcript-to-human-final.jsonl', title: 'A session that reported to the person', state: 'The to-human view: the message, the work folded to its record line, the switch above the message box', folders: ['transcript', 'owner/view', 'owner/to-human'], open: false },
  { key: 'rewind', file: 'test/fixtures/transcripts/rewind-real.jsonl', title: 'A session that was rewound', state: 'A recorded session with a rewind boundary', folders: ['transcript', 'transcript/view'], added: true },
  { key: 'peer', file: 'spikes/protocol-probe/fixtures/uxwave/u3-sminos-r1-maws.transcript.jsonl', title: 'A session that heard from another session', state: 'A recorded session with a peer’s message line', folders: ['transcript', 'transcript/view'], added: true },
];
const diskId = (i: number) => `0b2c3d4e-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`;
// The engine's workflow files for a disk session (engine-host/fs/workflows.ts): the recorded run of pass2/workflow-disk
const WORKFLOW = 'spikes/protocol-probe/fixtures/pass2/workflow-disk';
// A recorded transcript's row moved onto a scratch session: its cwd onto `repo`, its session id onto `id`.
function moveRow(line: string, id: string, repo: string): string {
  if (!line.trim()) return line;
  const row = JSON.parse(line) as Record<string, unknown>;
  if ('cwd' in row) row.cwd = repo;
  if ('sessionId' in row) row.sessionId = id;
  return JSON.stringify(row);
}
// A recorded transcript written into the scratch engine store as session `id` of `repo`'s project; its project folder.
function writeDisk(config: string, file: string, id: string, repo: string): string {
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split('\n');
  writeFileSync(join(project, `${id}.jsonl`), lines.map((l) => moveRow(l, id, repo)).join('\n'));
  return project;
}
// four sessions to a project at most, so every one is a row in the sidebar's tree (it lists five, then Show more)
function seedDisk(config: string, repos: string[]) {
  const move = moveRow;
  DISK.forEach((d, i) => {
    const id = diskId(i);
    const repo = repos[i % repos.length]!;
    const project = writeDisk(config, d.file, id, repo);
    if (d.key === 'subagents') {
      const from = join(REPO_ROOT, 'test/fixtures/transcripts/9a1d4262-0b43-46ad-acb9-5982f31d209c/subagents');
      const to = join(project, id, 'subagents');
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(from)) {
        const text = readFileSync(join(from, name), 'utf8');
        writeFileSync(join(to, name), name.endsWith('.jsonl') ? text.split('\n').map((l) => move(l, id, repo)).join('\n') : text);
      }
      // and a finished workflow beside them
      mkdirSync(join(project, id, 'workflows'), { recursive: true });
      cpSync(join(REPO_ROOT, WORKFLOW, 'wf_7cacbb2d-902.json'), join(project, id, 'workflows', 'wf_7cacbb2d-902.json'));
      mkdirSync(join(to, 'workflows', 'wf_7cacbb2d-902'), { recursive: true });
      cpSync(join(REPO_ROOT, WORKFLOW, 'journal.jsonl'), join(to, 'workflows', 'wf_7cacbb2d-902', 'journal.jsonl'));
    }
  });
  // the engine's task list of the compacted session (engine-host/fs/tasks.ts; a disk session's list is its engine id)
  const tasks = join(config, 'tasks', diskId(DISK.findIndex((d) => d.key === 'compact')));
  mkdirSync(tasks, { recursive: true });
  [['Read the stream code', 'completed'], ['Find where reconnects are counted', 'in_progress'], ['Write the summary', 'pending']].forEach(([subject, status], i) => {
    writeFileSync(join(tasks, `${i + 1}.json`), JSON.stringify({ id: String(i + 1), subject, description: `${subject}.`, status, blocks: [], blockedBy: i > 0 ? [String(i)] : [] }));
  });
}

test('round 2: recorded transcripts, menus and popovers around a session', async () => {
  test.setTimeout(1_200_000);
  const repos = REPOS.map((name) => makeRepo(name, name === 'stages' ? 'scheduled' : undefined));
  const config = join(SCRATCH, 'claude-config-r2');
  rmSync(config, { recursive: true, force: true });
  seedDisk(config, repos);
  trust(config);
  const usage = usageFixture();
  const server = await startBrowserServer();
  mkdirSync(join(SCRATCH, 'profile-r2'), { recursive: true });
  const maws = await launchMaws({ userData: join(SCRATCH, 'profile-r2'), prepare: noGh, env: BASE_ENV({ MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config, MAWS_CLAUDE_USAGE_DIR: usage, PATH: NO_GH_PATH }) });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    const ids: Record<string, string> = {};
    await expect.poll(async () => {
      const { sessions } = value(await invoke(page, 'session.list', {}));
      DISK.forEach((d, i) => (ids[d.key] = sessions.find((s) => s.engineSessionId === diskId(i))?.appId ?? ''));
      return DISK.every((d) => ids[d.key]);
    }, { timeout: 30_000 }).toBe(true);
    for (const d of DISK) {
      const meta = { id: d.added ? `m0-disk-${d.key}` : `r2-disk-${d.key}`, title: d.title, how: 'Click the session in the sidebar', state: d.open === false ? d.state : `${d.state}; every turn and every run opened`, folders: d.folders };
      await shot(page, d.added ? m0(meta) : r2(meta), async () => {
        await openSession(page, ids[d.key]!);
        await expect(pane(page).locator('.transcript-row[data-kind]').first()).toBeVisible({ timeout: 20_000 });
        if (d.open !== false) await unfoldAll(page);
      });
    }
    // the to-human view's record line opened, then the whole transcript through the switch above the message box
    await shot(page, m0({ id: 'm0-tohuman-record', title: 'The to-human view, its record line opened', how: 'The reporting session, press its record line', state: 'The work behind the message unfolded under its record line', folders: ['owner/view', 'owner/to-human', 'transcript'] }), async () => {
      await openSession(page, ids.tohuman!);
      await pane(page).locator('[data-row-id^="record-fold:closed:"] button[aria-expanded="false"]').first().click();
      await page.waitForTimeout(800);
    });
    await shot(page, m0({ id: 'm0-tohuman-full', title: 'The to-human session as its full transcript', how: 'The reporting session, the switch above the message box', state: 'The whole transcript in place of the report; the switch now offers the report', folders: ['owner/view', 'transcript'] }), async () => {
      await openSession(page, ids.tohuman!);
      await pane(page).locator('[data-view-switch] button').first().click();
      await page.waitForTimeout(800);
    });
    // M2 (T105, T106): a done browser action pointed at: its time and wait the tooltip of its phrase, opened by pointing
    // anywhere along its line, and its quiet actions drawn (transcript/view/rows/BrowserAction.tsx). The action is the
    // recording's first snapshot (p1-maws-browser: toolu_01Fych5jA99p8WVKoT575nt1, done in 60 ms, its page text the
    // result), the first done row with both quiet actions, each found by its name (BROWSER_ACTION, the same on both builds):
    // Show snapshot (the disclosure, `aria-expanded`) and Open tab;
    // on master's build its time stands on the line (`data-browser-took`). The row is pinned by its id (the same on both
    // builds, transcript/model/keys.ts `browserAction`): the recording's second snapshot reads the same, so any other
    // match would pass every check below with the wrong row
    const action = () => pane(page).locator('[data-row-id="browser:toolu_01Fych5jA99p8WVKoT575nt1"] .transcript-browser-action[data-tool="browser_snapshot"][data-state="done"]');
    const actionButtons = () => action().locator('.transcript-browser-action-actions button.transcript-quiet-button');
    await shot(page, m2({ id: 'm2-browser-action-pointed', title: 'A browser action, the pointer on its line', how: 'The session that drove the browser, its turns opened; hover the first snapshot’s line', state: 'The snapshot’s time its tooltip, Show snapshot and Open tab drawn', folders: ['transcript/view', 'tools/browser', 'ui'], hover: true }), async () => {
      await openSession(page, ids.browser!);
      await m2Build(page);
      await expect(pane(page).locator('.transcript-row[data-kind]').first()).toBeVisible({ timeout: 20_000 });
      await unfoldAll(page);
      await seek(page, action());
      await page.mouse.move(W - 2, H - 2);
      await action().locator('.transcript-browser-action-line').first().hover();
      await page.waitForTimeout(1200);
    }, {
      check: checks(
        pointedAt(action().locator('.transcript-browser-action-line'), 'the snapshot’s line'),
        tipShown(page, action().locator('[data-browser-heading]'), 'the snapshot’s phrase', action().locator('[data-browser-took]'), m2Cut),
        () => expect(actionButtons(), 'its two quiet actions').toHaveCount(2, { timeout: 3_000 }),
        () => expect(actionButtons().filter({ hasText: /^Show snapshot$/ }), 'Show snapshot, closed').toHaveAttribute('aria-expanded', 'false'),
        drawn(action().locator('.transcript-browser-action-actions'), 'its actions drawn'),
        () => inView(action().getByRole('button', { name: 'Show snapshot', exact: true }), 'Show snapshot'),
        () => inView(action().getByRole('button', { name: 'Open tab', exact: true }), 'Open tab'),
      ),
    });
    await shot(page, r2({ id: 'r2-subagents-finished', title: 'Right column, Subagents, two finished agents', how: 'The agents session, Subagents in the right column, its sections open', state: 'Two agents read from disk (their sidecar files only, so filed under On disk)', folders: ['tools/agents', 'panel'] }), async () => {
      await openSession(page, ids.subagents!);
      await sideSurface(app, page, 'subagents');
      await unfoldSections(page, 'subagents');
    });
    await shot(page, r2({ id: 'r2-subagent-page', title: 'Right column, Subagents, one agent opened', how: 'Click an agent in the Subagents panel', state: 'The first finished agent’s page', folders: ['tools/agents', 'panel'] }), async () => {
      if ((await surface(page, 'subagents').count()) === 0) {
        await sideSurface(app, page, 'subagents');
        await unfoldSections(page, 'subagents');
      }
      await surface(page, 'subagents').locator('[data-agent-row] > button[data-part="open"]').first().click();
      await soft(surface(page, 'subagents').locator('[data-view="agent"]'), 'the agent’s page');
    });
    await shot(page, m0({ id: 'm0-background-workflow', title: 'Right column, Background tasks, a finished workflow', how: 'The agents session, Background tasks with Done open', state: 'A recorded workflow under Done, read from disk', folders: ['tools/agents/background', 'panel'] }), async () => {
      await openSession(page, ids.subagents!);
      await sideSurface(app, page, 'background');
      await unfoldSections(page, 'background');
      await soft(surface(page, 'background').locator('[data-workflow]'), 'the workflow row');
    });
    // M3 (T210, T213, T238, T239): the recorded workflow's page, opened from its card (tools/agents/background/RunWidget.tsx:
    // its line, its phases and its agents' table, `data-view="run"` on both builds)
    const run = () => surface(page, 'background').locator('[data-view="run"]').first();
    await shot(page, m3({ id: 'm3-background-workflow-page', title: 'Right column, Background, a finished workflow’s page', how: 'The agents session, Background with Done open, click the workflow card’s title', state: 'The recorded workflow’s page: its line, its phases and its agents with their states (T210, T213, T238, T239)', folders: ['tools/agents/background', 'panel'] }), async () => {
      await openSession(page, ids.subagents!);
      await m3Build(page);
      await sideSurface(app, page, 'background');
      if ((await run().count()) === 0) {
        await unfoldSections(page, 'background');
        // the card's title opens the page (background/WorkflowCard.tsx, both builds); the card itself takes no press
        await surface(page, 'background').locator('[data-workflow] h4 button').first().click();
      }
      await expect(run(), 'the workflow’s page').toBeVisible({ timeout: 10_000 });
    }, {
      check: async () => {
        await inView(run(), 'the workflow’s page');
        await inView(run().locator('[data-phase-option][data-state="done"]'), 'a finished phase');
        // a finished agent's state: on M3 the check alone (T238), named by the engine's word; on master the word "done"
        const state = page.locator('td[data-part="state"]');
        const finished = run().locator('[data-run-agent]').filter({ has: m3Cut() ? state.filter({ has: page.getByRole('img', { name: BACKGROUND_COPY.phaseDone, exact: true }) }) : state.filter({ hasText: /^done$/ }) });
        await inView(finished, 'a finished agent’s row');
      },
    });
    await shot(page, m0({ id: 'm0-background-scheduled', title: 'Right column, Background tasks, scheduled jobs', how: 'A session of the project with durable scheduled jobs, Background tasks', state: 'The project’s recorded durable jobs under Scheduled (their next runs follow the clock)', folders: ['tools/agents/background', 'panel'] }), async () => {
      await openSession(page, ids[DISK[3]!.key]!); // the fourth disk session's project: stages, the one with .claude/scheduled_tasks.json
      await sideSurface(app, page, 'background');
      await expect(surface(page, 'background').locator('section[data-section="scheduled"] [data-scheduled]').first()).toBeVisible({ timeout: 15_000 });
    });
    await shot(page, m0({ id: 'm0-tasks', title: 'Right column, the Tasks panel', how: 'The compacted session, Background tasks, its task list opened', state: 'Three tasks from the engine’s task list: one done, one in progress, one waiting on it', folders: ['tools/agents/background', 'tools/agents', 'panel'] }), async () => {
      await openSession(page, ids.compact!);
      await sideSurface(app, page, 'background');
      await surface(page, 'background').locator('section[data-section="tasks"] [data-part="action"] button').first().click();
      await expect(surface(page, 'tasks')).toBeVisible({ timeout: 10_000 });
    });
    await reset(page);

    // the press-to-open places around a session, on the agents session
    const toolbar = () => pane(page).locator('[data-composer] [role="toolbar"]').first();
    await shot(page, r2({ id: 'r2-cards-unfolded', title: 'Session cards, every card unfolded', how: 'Open each card in the right column', state: 'Environment, Context and Connectors open on a finished session', folders: ['panel', 'panel/summary'] }), async () => {
      for (const id of ['subagents', 'background', 'tasks']) if (await surface(page, id).isVisible().catch(() => false)) await menu(app, `surface.${id}`).catch(() => undefined);
      await openSession(page, ids.subagents!);
      await unfoldCards(page);
    });
    await shot(page, r2({ id: 'r2-model-menu', title: 'Model menu, opened from the model chip', how: 'Click the model chip under the message box', state: 'The model and effort menu of a finished session', folders: ['composer/frame', 'widgets'] }), async () => {
      await openSession(page, ids.subagents!);
      await box(page).click();
      await toolbar().locator('button[aria-haspopup="dialog"]:not([data-context-ring])').last().click();
      await soft(page.locator('[data-model-selector]'), 'the model selector');
    }, { check: () => inView(page.locator('[data-model-selector="effort"]'), 'the model menu’s effort view') });
    await reset(page);
    await shot(page, r2({ id: 'r2-context-popover', title: 'Context popover, from the ring', how: 'Click the ring at the end of the row under the message box', state: 'The context reading of a finished session no process runs: its last reading (or none yet), and Refresh', folders: ['composer/frame', 'statusline'] }), async () => {
      await openSession(page, ids.subagents!);
      await pane(page).locator('[data-composer] [data-context-ring]').first().click();
      await page.waitForTimeout(1500);
    }, {
      // composer/frame/ContextRing.tsx's popover, named on both builds. The session is read from disk and never started
      // here, so its popover holds the dormant reading (statusline/ContextPopover.tsx: the breakdown draws only for a
      // live process): the line under its heading, no breakdown, and the gesture that starts it
      check: async () => {
        const popover = page.locator('[role="dialog"][aria-label="Context window"]');
        await inView(popover.locator('h3 + p'), 'the context popover’s reading');
        await expect(popover.locator('table'), 'no live breakdown').toHaveCount(0);
        await inView(popover.locator('[data-dormant-gesture]'), 'its Refresh');
      },
    });
    await reset(page);
    await shot(page, r2({ id: 'r2-plus-menu', title: 'Message box, the + menu', how: 'Click + under the message box', state: 'The + menu of a finished session', folders: ['composer/frame', 'composer', 'composer/plus-menu'] }), async () => {
      await openSession(page, ids.subagents!);
      await box(page).click();
      await toolbar().locator('button[aria-haspopup="menu"]').first().click();
      await expect(page.locator('[role="menu"]').first()).toBeVisible({ timeout: 5_000 });
    });
    await reset(page);
    const clearBox = async () => {
      await closeOverlays(page);
      await box(page).click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Backspace');
    };
    await shot(page, r2({ id: 'r2-mention-menu', title: 'Mention menu (typing @)', how: 'Type @ in the message box', state: 'The mention menu over the scratch repository', folders: ['composer', 'composer/mentions', 'composer/editor'] }), async () => {
      await openSession(page, ids.subagents!);
      await box(page).click();
      await page.keyboard.type('@');
      await expect(page.locator('[role="listbox"]').first()).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(1200);
    }, { check: () => inView(page.locator('[role="listbox"] [role="option"][aria-selected="true"]'), 'the menu with a row highlighted'), after: clearBox });
    await shot(page, r2({ id: 'r2-slash-menu', title: 'Slash command menu (typing /)', how: 'Type / in the message box', state: 'The command list of a finished session', folders: ['composer', 'composer/mentions', 'palette'] }), async () => {
      await openSession(page, ids.subagents!);
      await box(page).click();
      await page.keyboard.type('/');
      await expect(page.locator('[role="listbox"]').first()).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(1200);
    }, { after: clearBox });
    await shot(page, m0({ id: 'm0-composer-bash', title: 'The message box in Bash mode', how: 'Type ! and a command in the message box', state: '“!git status” typed: the Bash mode’s chip and hint; nothing sent', folders: ['composer', 'composer/modes', 'composer/editor'] }), async () => {
      await openSession(page, ids.subagents!);
      await box(page).click();
      await page.keyboard.type('!git status');
      await soft(pane(page).locator('[data-composer] [data-mode="bash"]'), 'the Bash mode');
    }, { check: () => inView(pane(page).locator('[data-composer] [data-mode="bash"]'), 'the box in Bash mode'), after: clearBox }); // composer/editor/Editor.tsx, data-mode
    await shot(page, m0({ id: 'm0-composer-memory', title: 'The message box in memory mode', how: 'Type # in the message box', state: '“#” typed: the memory mode’s chip and hint; nothing sent', folders: ['composer', 'composer/modes', 'composer/editor'] }), async () => {
      await openSession(page, ids.subagents!);
      await box(page).click();
      await page.keyboard.type('#');
      await soft(pane(page).locator('[data-composer] [data-mode="memory"]'), 'the memory mode');
    }, { check: () => inView(pane(page).locator('[data-composer] [data-mode="memory"]'), 'the box in memory mode'), after: clearBox });
    // M2 (C22): the location chip of a started session opened: its path alone, where master adds that the location is
    // fixed (composer/frame/LocationChip.tsx: its trigger named `Location <path>` and its popover `Location`, the same on
    // both builds; the note is the popover's second line on master's)
    const location = () => page.locator('[role="dialog"][aria-label="Location"]');
    await shot(page, m2({ id: 'm2-location-popover', title: 'The location chip opened on a started session', how: 'Click the folder chip under the message box', state: 'The session’s folder, and no line saying it cannot move', folders: ['composer/frame', 'composer'] }), async () => {
      await openSession(page, ids.subagents!);
      await m2Build(page);
      await toolbar().locator('button[aria-label^="Location "]').first().click();
      await expect(location()).toBeVisible({ timeout: 5_000 });
    }, {
      check: async () => {
        await inView(location().locator('p').first(), 'the session’s folder');
        if (!m2Cut()) await inView(location().locator('p').nth(1), 'master’s line on the fixed location');
      },
      after: () => closeOverlays(page),
    });
    // M2 (P579): the + menu's Connectors, of a session that is not running: its one line says why it lists none
    await shot(page, m2({ id: 'm2-plus-connectors-stopped', title: 'Message box, + › Connectors of a session not running', how: 'Click + under the message box, then Connectors', state: 'The Connectors submenu of a finished session no process runs: why it lists none, In this chat and Manage', folders: ['composer/plus-menu', 'composer', 'widgets'], hover: true }), async () => {
      await openSession(page, ids.subagents!);
      await m2Build(page);
      await plusSubmenu(page, 'Connectors');
    }, { check: submenuHolds(page, 'Connectors', [], () => byBuild(CONNECTORS_LINE.notRunning)), after: () => closeOverlays(page) });
    await reset(page);
    await shot(page, r2({ id: 'r2-usage-popover', title: 'Usage ring popover', how: 'Click the ring at the right end of the title bar', state: 'The ClaudeUsage fixture, newest reading two minutes old', folders: ['usage'] }), async () => {
      await page.locator('[data-toolbar] [data-usage-ring]').first().click();
      await soft(page.locator('[data-usage-popover]'), 'the usage popover');
    });
    await reset(page);
    await shot(page, r2({ id: 'r2-palette', title: 'Command palette', how: 'Go › Command palette (⌘K)', state: 'The palette with nothing typed: Recent, Projects, Channels, Actions', folders: ['palette'] }), async () => {
      await menu(app, 'palette.open');
      await expect(page.locator('[cmdk-root]').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
    });
    await reset(page);
    await shot(page, r2({ id: 'r2-shortcuts', title: 'The shortcuts window', how: 'Help › Keyboard shortcuts (⌘/)', state: 'The shortcuts overview', folders: ['keymap'] }), async () => {
      await menu(app, 'shortcuts.open');
      await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1000);
    });
    await reset(page);
    // the in-app browser: a tab that never navigated, a page that failed to load (a closed loopback port refuses it), and
    // a page of the repository's scratch server with the tab's own controls open
    const browserTab = async (url: string | null) => {
      await openSession(page, ids.browser!);
      await sideSurface(app, page, 'browser');
      value(await invoke(page, 'browser.tabs.open', { appSessionId: ids.browser as never, url, select: true } as never));
      await page.waitForTimeout(3000);
    };
    const browser = () => surface(page, 'browser');
    // Browser options, the address row's last control, is itself the menu's trigger (chrome/OverflowMenu.tsx: no element
    // wraps it, so a button inside the row's last child never matches), named the same on both builds
    const browserOptions = () => browser().getByRole('button', { name: BROWSER_COPY.options, exact: true }).first();
    await shot(page, r2({ id: 'r2-browser-blank', title: 'Browser, a tab that never navigated', how: 'Browser in the right column, a new tab', state: 'A new tab with no address', folders: ['tools/browser'] }), async () => {
      await browserTab(null);
      await soft(browser().locator('[data-browser-page="empty"]'), 'the empty tab');
    });
    await shot(page, r2({ id: 'r2-browser-failed', title: 'Browser, a page that failed to load', how: 'Browser in the right column, an address that refuses', state: `http://127.0.0.1:${REFUSING_PORT}/ refused the connection`, folders: ['tools/browser'] }), async () => {
      await browserTab(`http://127.0.0.1:${await refusingPort()}/`);
      await expect(browser().locator('[data-browser-page="error-refused"]').first()).toBeAttached({ timeout: 30_000 });
    });
    await shot(page, m0({ id: 'm0-browser-find', title: 'Browser, the options menu’s Find', how: 'A loaded page, the options menu at the end of the address row, Find', state: 'A scratch page with the find row open', folders: ['tools/browser'] }), async () => {
      await browserTab(server.url('/a.html'));
      await browserOptions().click();
      await page.getByRole('menu').first().getByRole('menuitem', { name: BROWSER_COPY.menu.find, exact: true }).click();
      await expect(browser().locator('[data-browser-find]').first()).toBeVisible({ timeout: 10_000 });
    });
    await closeOverlays(page);
    await shot(page, m0({ id: 'm0-browser-options', title: 'Browser, the options menu', how: 'A loaded page, the options menu at the end of the address row', state: 'The tab’s options menu open over a scratch page', folders: ['tools/browser'] }), async () => {
      await browserTab(server.url('/a.html'));
      await browserOptions().click();
      await expect(page.locator('[role="menu"]').first()).toBeVisible({ timeout: 5_000 });
    });
    await closeOverlays(page);
    await shot(page, m0({ id: 'm0-browser-profile', title: 'Browser, the profile popover', how: 'Click the profile pill of the address row', state: 'The default profile’s popover, no Chrome profile imported', folders: ['tools/browser'] }), async () => {
      await browserTab(server.url('/a.html'));
      await browser().locator('[data-browser-partition]').first().click();
      await expect(page.locator('[data-profile-popover]').first()).toBeVisible({ timeout: 5_000 });
    });
    await closeOverlays(page);
    await shot(page, m0({ id: 'm0-browser-suggestions', title: 'Browser, address suggestions', how: 'Click the address and type', state: '“page” typed: Go to, Search and the visited scratch pages', folders: ['tools/browser'] }), async () => {
      await browserTab(server.url('/a.html'));
      await browser().locator('[data-address-box] input[role="combobox"]').first().click();
      await page.keyboard.type('page');
      await expect(page.locator('[data-address-suggestions]').first()).toBeVisible({ timeout: 5_000 });
    });
    await closeOverlays(page);
    await reset(page);
    for (const id of ['browser']) if (await surface(page, id).isVisible().catch(() => false)) await menu(app, `surface.${id}`).catch(() => undefined);
    await shot(page, r2({ id: 'r2-session-menu', title: 'A session row’s menu', how: 'Right-click a session in the sidebar', state: 'The menu of a finished session, with Open in', folders: ['sidebar', 'sessions', 'open-in'] }), async () => {
      await (await sidebarRow(page, { appSessionId: ids.subagents! })).click({ button: 'right' });
      await expect(page.locator('[role="menu"]').first()).toBeVisible({ timeout: 5_000 });
    });
    await reset(page);
    await shot(page, r2({ id: 'r2-project-menu', title: 'A project row’s menu', how: 'Right-click a project in the sidebar', state: 'The menu of the scratch project', folders: ['sidebar'] }), async () => {
      await sidebar(page).locator('[data-kind="project"] [data-project-line]').first().click({ button: 'right' });
      await expect(page.locator('[role="menu"]').first()).toBeVisible({ timeout: 5_000 });
    });
    await reset(page);
  } finally {
    await maws.cleanup();
    await server.close();
  }
});

// ======================================================================================================================
// Round 2, launch 4: work in progress, from recorded replays that hold where the recording waited for the app (a
// replay with no exit row waits at its next `out` row, so its agents and shells stay running), a command auto mode
// blocked, Source control behind and in conflict, and the artifact editors seeded through their e2e seams.
// ======================================================================================================================
const UXWAVE = 'spikes/protocol-probe/fixtures/pass3/uxwave/uxwave-subagent-tasks-nodelay.jsonl';
// benchDeckFiles(6) with two sections, a hidden slide and a slide held because one element is not a slide element
function deckFiles(): Record<string, string> {
  const files = benchDeckFiles(6);
  const deck = JSON.parse(files['project/deck.json']!) as { order: string[]; sections?: Record<string, { description: string; start: string }> };
  deck.order = [...deck.order, 'quiet', 'broken'];
  deck.sections = { s1: { description: 'Opening', start: 's001' }, s2: { description: 'Detail', start: 's004' } };
  files['project/deck.json'] = JSON.stringify(deck);
  files['project/slides/quiet.html'] = '<section id="quiet" hidden style="background:#ffffff; padding:128px"><h2 id="q" style="font-size:64px">Backup slide</h2></section>';
  files['project/slides/broken.html'] = '<section id="broken" style="background:#ffffff"><h2 id="b" style="font-size:64px">Broken</h2><blink>not a slide element</blink></section>';
  return files;
}
test('round 2: running agents and shells, the queue, a blocked command, Source control states, artifact editors', async () => {
  test.setTimeout(1_500_000);
  const repo = makeRepo('MAWS');
  const behind = makeRepo('upstream', 'behind');
  const conflicted = makeRepo('merge', 'conflict');
  const config = join(SCRATCH, 'claude-config-r2run');
  rmSync(config, { recursive: true, force: true });
  const engineIds = { run: '0c3d4e5f-0000-4000-8000-000000000301', queue: '0c3d4e5f-0000-4000-8000-000000000302', block: '0c3d4e5f-0000-4000-8000-000000000303', behind: '0c3d4e5f-0000-4000-8000-000000000304', conflict: '0c3d4e5f-0000-4000-8000-000000000305' };
  seedSession(config, repo, engineIds.run, 'Agents and a shell at work', '2026-09-29T11:00:00.000Z');
  seedSession(config, repo, engineIds.queue, 'Count slowly', '2026-09-29T11:01:00.000Z');
  seedSession(config, repo, engineIds.block, 'Run the marker command', '2026-09-29T11:02:00.000Z');
  seedSession(config, behind, engineIds.behind, 'Catch up with upstream', '2026-09-29T11:03:00.000Z');
  seedSession(config, conflicted, engineIds.conflict, 'Settle the merge', '2026-09-29T11:04:00.000Z');
  trust(config);
  mkdirSync(join(SCRATCH, 'journals'), { recursive: true });
  const usage = usageFixture();
  mkdirSync(join(SCRATCH, 'profile-r2run'), { recursive: true });
  const maws = await launchMaws({ userData: join(SCRATCH, 'profile-r2run'), prepare: noGh, env: BASE_ENV({ MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config, MAWS_CLAUDE_USAGE_DIR: usage, PATH: NO_GH_PATH }) });
  const { app, page } = maws;
  const status = async (id: string) => value(await invoke(page, 'session.status', { appSessionId: id as never }));
  try {
    await size(maws);
    await light(page);
    const ids: Record<string, string> = {};
    await expect.poll(async () => {
      const { sessions } = value(await invoke(page, 'session.list', {}));
      for (const [key, id] of Object.entries(engineIds)) ids[key] = sessions.find((s) => s.engineSessionId === id)?.appId ?? '';
      return Object.values(ids).every(Boolean);
    }, { timeout: 30_000 }).toBe(true);
    const request = () => pane(page).locator('[data-request-end] [data-request-card]').first();

    // ---- agents and a shell running: the uxwave recording, sent its first two prompts, holds at its third
    const journal = join(SCRATCH, 'journals', 'uxwave-subagent-tasks-nodelay.jsonl');
    cpSync(join(REPO_ROOT, UXWAVE), journal);
    const prompts = promptsOf(UXWAVE);
    let running = false;
    try {
      await openSession(page, ids.run!);
      await launchReady(page, ids.run!, journal, { cwd: repo });
      for (const content of prompts.slice(0, 2)) {
        value(await invoke(page, 'session.send', { appSessionId: ids.run as never, content }));
        await expect.poll(async () => (await status(ids.run!)).turn, { timeout: 60_000 }).toBeNull();
      }
      // no rename here: a live session's rename is written to its engine, which the replay does not expect
      running = true;
    } catch (error) {
      setupFailed('uxwave replay', error);
    }
    const need = () => {
      if (!running) throw new Error('the held replay did not reach its second hold');
    };
    await shot(page, r2({ id: 'r2-run-cards', title: 'Session cards while agents run', how: 'A session whose agents are still at work', state: 'Two background agents dispatched by the recorded session, still running; the turn has ended', folders: ['panel', 'panel/summary', 'tools/agents'] }), async () => {
      need();
      await openSession(page, ids.run!);
      await unfoldCards(page);
    });
    // a working agent's line (transcript/view/rows/Subagent.tsx; `data-status` none of the three ended ones): on M2's
    // build the running ring named Working before the descriptions (T86); on master's, the lines under it saying what
    // each agent is doing (`data-agent-detail`)
    const working = () => pane(page).locator('.transcript-subagent:not([data-status="finished"]):not([data-status="finished_with_errors"]):not([data-status="stopped"])').first();
    const agentWorking = async () => {
      if (await m2Build(page)) await expect(working().locator('.transcript-subagent-ring[role="img"]'), 'a working agent’s ring').toBeAttached({ timeout: 3_000 });
      else await expect(working().locator('[data-agent-detail]').first(), 'master’s line of what a working agent is doing').toBeAttached({ timeout: 3_000 });
    };
    // the two agents the recording dispatched, both still at work and in view: their glyphs in the working rows (one row
    // of two, or a row each; Subagent.tsx's Glyphs on both builds), and on master's build a line of what each is doing
    const workingRows = () => pane(page).locator('.transcript-subagent:not([data-status="finished"]):not([data-status="finished_with_errors"]):not([data-status="stopped"])');
    const workingGlyphs = () => workingRows().locator('.transcript-glyphs > :not(.transcript-glyph-overflow)');
    const agentsRun = async () => {
      await agentWorking();
      await expect(workingGlyphs(), 'two agents at work').toHaveCount(2, { timeout: 3_000 });
      for (const n of [0, 1]) await expect(workingGlyphs().nth(n), 'a working agent in view').toBeInViewport({ timeout: 3_000 });
      if (!m2Cut()) await expect(workingRows().locator('[data-agent-detail]'), 'master’s line for each').toHaveCount(2);
    };
    await shot(page, r2({ id: 'r2-run-transcript', title: 'The transcript while agents run', how: 'The same session, its turns and runs opened', state: 'Two agents running in the background', folders: ['transcript', 'transcript/view', 'tools/agents'] }), async () => {
      need();
      await openSession(page, ids.run!);
      await unfoldAll(page);
      if ((await workingRows().count()) > 0) await workingRows().first().scrollIntoViewIfNeeded(); // a no-op when it is in view already
    }, { check: agentsRun });
    // M2 (T87): what a working agent is doing, and for how long, the tooltip of what stands for it: the line of a
    // one-agent row, a glyph of a grouped row, or the line's words where nothing opens an agent
    const agentOwner = () => working().locator('button.transcript-subagent-line, button.transcript-glyph, .transcript-subagent-sentence[tabindex="0"]').first();
    await shot(page, m2({ id: 'm2-run-agent-tip', title: 'The transcript while agents run, a working agent holding the keyboard', how: 'The same session, its turns opened; Tab to a working agent’s line', state: 'The agent’s line focused, its type, its last tool and its time running the tooltip', folders: ['transcript/view', 'tools/agents', 'ui'] }), async () => {
      need();
      await openSession(page, ids.run!);
      await m2Build(page);
      await unfoldAll(page);
      await seek(page, working());
      await letGo(page);
      await focusTip(page, agentOwner(), working().locator('[data-agent-detail]'), m2Cut);
    }, { check: checks(agentWorking, tipShown(page, agentOwner(), 'a working agent', working().locator('[data-agent-detail]'), m2Cut)) });
    await letGo(page);
    // M2 (P578; C17, C18): the + menu's Connectors and Plugins of a running session, whose engine reports no connector
    // and four plugins (the recording's `system/init`, every one of them)
    const ready = async () => expect((await status(ids.run!)).process, 'the session running').toBe('ready');
    const PLUGINS = ['cc-plugin-agents-md', 'cc-plugin-telemetry', 'cc-plugin-privacy', 'cc-plugin-plugin-authoring'];
    for (const [label, id, state, rows, empty] of [
      ['Connectors', 'm2-plus-connectors-running', 'The Connectors submenu of a running session that reports none: its one line, In this chat and Manage', [], () => byBuild(CONNECTORS_LINE.noneReported)],
      ['Plugins', 'm2-plus-plugins-running', 'The Plugins submenu of a running session: the plugins by name alone, In this chat and Manage', PLUGINS, null],
    ] as const) {
      await shot(page, m2({ id, title: `Message box, + › ${label} of a running session`, how: `Click + under the message box, then ${label}`, state, folders: ['composer/plus-menu', 'composer', 'widgets'], hover: true }), async () => {
        need();
        await openSession(page, ids.run!);
        await m2Build(page);
        await plusSubmenu(page, label);
      }, { check: checks(ready, submenuHolds(page, label, rows, empty)), after: () => closeOverlays(page) });
    }
    await reset(page);
    await shot(page, r2({ id: 'r2-run-subagents', title: 'Right column, Subagents, agents running', how: 'Subagents in the right column', state: 'Two agents running', folders: ['tools/agents', 'panel'] }), async () => {
      need();
      await sideSurface(app, page, 'subagents');
    });
    await shot(page, r2({ id: 'r2-run-subagent-page', title: 'Right column, Subagents, a running agent opened', how: 'Click a running agent in Subagents', state: 'One running agent’s page with its message box', folders: ['tools/agents', 'panel'] }), async () => {
      need();
      if ((await surface(page, 'subagents').count()) === 0) await sideSurface(app, page, 'subagents');
      await surface(page, 'subagents').locator('[data-agent-row] > button[data-part="open"]').first().click();
      await soft(surface(page, 'subagents').locator('[data-view="agent"]'), 'the agent’s page');
    });
    await shot(page, r2({ id: 'r2-run-background', title: 'Right column, Background tasks, agents running', how: 'Background tasks in the right column', state: 'The running work of the session', folders: ['tools/agents/background', 'tools/agents', 'panel'] }), async () => {
      need();
      await sideSurface(app, page, 'background');
    });
    if (await surface(page, 'background').isVisible().catch(() => false)) await menu(app, 'surface.background').catch(() => undefined);
    // the third prompt starts a shell in the background and an agent asks to run a command: it holds at that answer
    let third = false;
    if (running) {
      try {
        value(await invoke(page, 'session.send', { appSessionId: ids.run as never, content: prompts[2]! }));
        await expect(request()).toBeVisible({ timeout: 60_000 });
        third = true;
      } catch (error) {
        setupFailed('uxwave third prompt', error);
      }
    }
    const atApproval = () => {
      if (!third) throw new Error('the held replay did not reach its approval');
    };
    await shot(page, r2({ id: 'r2-run-approval-cards', title: 'A running session waiting on an approval, with its cards', how: 'The same session after its third prompt', state: 'Agents running, a background shell started, an agent’s command waiting for approval at the end of the conversation', folders: ['request-card', 'panel', 'panel/summary', 'tools/agents'] }), async () => {
      atApproval();
      await openSession(page, ids.run!);
      await unfoldCards(page);
    });
    await shot(page, r2({ id: 'r2-deny-reason', title: 'An approval with the deny-with-reason field open', how: 'Click the deny-with-reason field of an approval card', state: 'The field focused, nothing typed', folders: ['request-card'] }), async () => {
      atApproval();
      const field = request().locator('textarea');
      if ((await field.count()) === 0) await request().locator('button.mr-auto').first().evaluate((el) => (el as HTMLButtonElement).click());
      await expect(field.first()).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(800);
    });
    await shot(page, r2({ id: 'r2-run-background-shell', title: 'Right column, Background tasks, a shell and agents running', how: 'Background tasks in the right column', state: 'A background shell and agents running', folders: ['tools/agents/background', 'panel'] }), async () => {
      atApproval();
      await sideSurface(app, page, 'background');
    });
    if (await surface(page, 'background').isVisible().catch(() => false)) await menu(app, 'surface.background').catch(() => undefined);
    // M3 (T166): the agent waiting on the approval, in Agents: on M3's build its row's warning disc, and Approval needed
    // the tooltip of its open button (tools/agents/subagents/AgentRow.tsx: `data-part="waiting"`, the open button the
    // keyboard's owner); master's row says it in its second line
    const agentRows = () => surface(page, 'subagents').locator('[data-agent-row]');
    const waitingRow = () => agentRows().filter({ has: page.locator('[data-part="waiting"]') }).or(agentRows().filter({ hasText: SUBAGENTS_COPY.approvalNeeded })).first();
    const waitingOpen = () => waitingRow().locator('button[data-part="open"]').first();
    await shot(page, m3({ id: 'm3-agents-approval', title: 'Right column, Agents, an agent waiting on an approval', how: 'The same session after its third prompt, Agents (back to its list), its sections open; Tab to the waiting agent’s row', state: 'The waiting agent’s row holding the keyboard: on M3 its disc, Approval needed the tooltip; master: its line (T166)', folders: ['tools/agents/subagents', 'tools/agents', 'panel', 'ui'] }), async () => {
      atApproval();
      await openSession(page, ids.run!);
      await m3Build(page);
      await sideSurface(app, page, 'subagents');
      // the list, not the agent's page r2-run-subagent-page opened, which the panel keeps (subagents/DrillIn.tsx's Back:
      // the agent's page's header's first button, or the waiting page's own)
      if ((await surface(page, 'subagents').locator('[data-view="lists"]').count()) === 0) await surface(page, 'subagents').locator('[data-view="agent"] > header > button, [data-view="pending"] > button').first().click();
      await expect(surface(page, 'subagents').locator('[data-view="lists"]'), 'the agents’ list').toBeVisible({ timeout: 10_000 });
      await unfoldSections(page, 'subagents');
      await expect(waitingRow(), 'the waiting agent’s row').toBeAttached({ timeout: 10_000 });
      await letGo(page);
      if (m3Cut()) await waitingOpen().focus();
      else await waitingRow().scrollIntoViewIfNeeded();
    }, { check: tip3(page, waitingOpen(), 'the waiting agent’s row', waitingRow().locator('[data-part="state"]')) });
    await letGo(page);
    if (await surface(page, 'subagents').isVisible().catch(() => false)) await menu(app, 'surface.subagents').catch(() => undefined);

    // ---- the queue: a counting turn held at its next user write (two releases recorded, so a stop can follow); ↑ walks
    // history while nothing waits; one message for the next step, one for after the turn; ↑ takes the newest back; the
    // stop holds both
    let counting = false;
    try {
      await openSession(page, ids.queue!);
      await launchReady(page, ids.queue!, steerStopJournal(join(SCRATCH, 'journals'), 'steer', 2), { cwd: repo });
      await box(page).click();
      await page.keyboard.type('Count to 30 slowly');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await status(ids.queue!)).turn, { timeout: 30_000 }).not.toBeNull();
      counting = true;
    } catch (error) {
      setupFailed('queue', error);
    }
    const isCounting = () => {
      if (!counting) throw new Error('the counting turn did not start');
    };
    await shot(page, r2({ id: 'r2-history-step', title: 'The message box stepping back through history (↑)', how: 'Press ↑ in the empty message box while a turn runs and nothing waits', state: 'The box showing the session’s earlier message, with the history hint', folders: ['composer', 'composer/editor'] }), async () => {
      isCounting();
      await openSession(page, ids.queue!);
      await box(page).click();
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(800);
    }, { after: async () => void (await page.keyboard.press('ArrowDown')) });
    let queued = false;
    if (counting) {
      try {
        await box(page).click();
        await page.keyboard.type('Use one Bash call for the rest.');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(800);
        await page.keyboard.type('Then sum the numbers.');
        await page.keyboard.press('Meta+Enter');
        await expect(pane(page).locator('li[data-queue-state="after"]').first()).toBeVisible({ timeout: 10_000 });
        queued = true;
      } catch (error) {
        setupFailed('queue rows', error);
      }
    }
    const isQueued = () => {
      if (!queued) throw new Error('the two messages did not queue');
    };
    await shot(page, r2({ id: 'r2-queue', title: 'The message box mid-turn with two queued messages', how: 'Type while a turn runs: Enter for the next step, ⌘Enter for after the turn', state: 'A turn running; one message queued for the next step, one for after the turn', folders: ['composer', 'composer/queue', 'composer/submit'] }), async () => {
      isQueued();
      await openSession(page, ids.queue!);
    });
    await shot(page, r2({ id: 'r2-queue-hover', title: 'The queue, pointer on a queued message', how: 'Hover a queued message', state: 'The pointer on the first queued row: its Send now, Delete and More', folders: ['composer/queue'], hover: true }), async () => {
      isQueued();
      await pane(page).locator('li[data-queue-state]').first().hover();
      await page.waitForTimeout(1000);
    });
    await shot(page, m0({ id: 'm0-queue-take-back', title: 'The queue, the newest message taken back (↑)', how: 'Press ↑ in the empty message box while messages wait', state: 'The after-the-turn message back in the box, its row gone; the next-step message still waiting', folders: ['composer', 'composer/queue', 'composer/editor'] }), async () => {
      isQueued();
      await page.mouse.move(W - 2, H - 2);
      await box(page).click();
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(800);
    }, {
      // queued again for the paused queue below (never a second ↑: that withdraws the next-step message from the engine)
      after: async () => {
        if (queued) {
          await box(page).click();
          await page.keyboard.press('Meta+Enter');
          await page.waitForTimeout(800);
        }
      },
    });
    await shot(page, m0({ id: 'm0-queue-paused', title: 'A paused queue with waiting messages', how: 'Stop the turn while two messages wait', state: 'Both messages held; the queue paused because you interrupted, with Resume', folders: ['composer', 'composer/queue', 'composer/submit'] }), async () => {
      isQueued();
      await pane(page).locator('[data-composer] [data-submit-state="stop"]').first().click();
      await expect(pane(page).locator('li[data-queue-state="held"]').first()).toBeVisible({ timeout: 15_000 });
    });
    await reset(page);

    // ---- a command auto mode blocked (uxwave/u1-soft-seeded-1): the turn ends with the call refused and its retry offered
    // A session's status is the engine host's row, which a session gets at its launch: `session.status` for one never
    // launched fails with "internal: unknown session <id>" (engine-host/ipc.ts, sessionOf), which is how M0's run, reading
    // the status before the launch, missed. So the launch comes first, once (a retry finds it launched), and the turn's
    // end is awaited either way.
    let blockLaunched = false;
    const blocked = () => pane(page).locator('[data-cell-id="cell:toolu_01JqskAh583hVgaieABZQ9yn"]').first();
    await shot(page, m0({ id: 'm0-auto-blocked', title: 'A command auto mode blocked', how: 'A finished turn whose command auto mode refused, its count on the turn’s line opened', state: 'The blocked call’s row, the command it blocked and Approve and retry', folders: ['transcript', 'transcript/view', 'composer/queue'] }), async () => {
      await openSession(page, ids.block!);
      if (!blockLaunched) {
        await launchReady(page, ids.block!, recordedBlockJournal(join(SCRATCH, 'journals'), 'blk', 'u1-soft-seeded-1'), { cwd: repo });
        blockLaunched = true;
        await box(page).click();
        await page.keyboard.type('Run the marker command.');
        await page.keyboard.press('Enter');
      }
      // The replayed turn can start and end between two reads of the status, so its end is read from what it leaves:
      // the turn's line counting the call auto mode denied (rows/Divider.tsx's CountLink, the same on both builds), and
      // no turn running.
      const count = pane(page).locator('.transcript-divider-count').filter({ hasText: 'auto-denied' });
      await expect.poll(async () => (await count.count()) > 0 && (await status(ids.block!)).turn === null, { message: 'the marker command’s turn ended, its line counting the denied call', timeout: 60_000 }).toBe(true);
      await press(page, count.last(), 'the turn line’s auto-denied count');
      await soft(blocked(), 'the blocked call’s cell');
    }, {
      // the call's row denied (data-status), its line naming the recording's command, and Approve and retry under it
      // (blocked-call/ApproveAndRetry.tsx: the one button of `.transcript-blocked`, on both builds). The classifier gave
      // the stand-in reason (transcript/model/blocked.ts, STAND_IN_REASONS), so the line names no reason of its own.
      check: async () => {
        await inView(blocked(), 'the blocked call’s row');
        await expect(blocked(), 'the call denied').toHaveAttribute('data-status', 'denied', { timeout: 3_000 });
        await expect(blocked().locator('.transcript-cell-line').first(), 'its line naming the command').toContainText('marker-1.txt');
        await inView(blocked().locator('.transcript-blocked button.transcript-button'), 'Approve and retry');
      },
    });
    await reset(page);

    // ---- Source control in two more states, each its own scratch repository
    await shot(page, m0({ id: 'm0-scm-behind', title: 'Source control, behind its upstream', how: 'A session of the project whose origin moved on, Source control', state: 'Main one ahead of origin/main and one behind; Uncommitted as in the other repositories', folders: ['tools/scm', 'panel'] }), async () => {
      await openSession(page, ids.behind!);
      await sideSurface(app, page, 'source-control');
      await expect(surface(page, 'source-control').locator('[data-scm-behind]').first()).toBeVisible({ timeout: 15_000 });
    });
    await shot(page, m0({ id: 'm0-scm-conflict', title: 'Source control, a file in conflict', how: 'A session of the project with an unmerged file, Source control', state: 'Uncommitted with one conflict', folders: ['tools/scm', 'panel'] }), async () => {
      await openSession(page, ids.conflict!);
      await sideSurface(app, page, 'source-control');
      await expect(surface(page, 'source-control').locator('[data-scm-uncommitted] [data-scm-conflicts]').first()).toBeVisible({ timeout: 15_000 });
    });
    if (await surface(page, 'source-control').isVisible().catch(() => false)) await menu(app, 'surface.source-control').catch(() => undefined);
    await reset(page);

    // ---- artifact editors, seeded through their seams (installed under MAWS_E2E=1, which every launch sets)
    const created: Record<string, string> = {};
    const make = async (kind: string, title: string) => {
      const result = await invoke(page, 'artifacts.create', { kind, title } as never);
      if (!result.ok) throw new Error(result.error.message);
      return (result.value as { artifact: { id: string } }).artifact.id;
    };
    const tab = (id: string) => page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
    const openArtifact = async (id: string) => {
      await library(app, page);
      await page.locator(`[data-library] article[data-artifact-row="${id}"]`).click();
      await expect(tab(id)).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
    };
    try {
      created.deck = await make('presentation', 'Quarterly review');
      await page.evaluate(([a, f]) => (window as unknown as { __maws_presentations: { seed(id: string, files: Record<string, string>): Promise<void> } }).__maws_presentations.seed(a, f), [created.deck, benchDeckFiles(6)] as const);
      created.review = await make('presentation', 'Planning deck');
      await page.evaluate(([a, f]) => (window as unknown as { __maws_presentations: { seed(id: string, files: Record<string, string>): Promise<void> } }).__maws_presentations.seed(a, f), [created.review, deckFiles()] as const);
      created.design = await createDesign(page, 'Launch screens', DESIGN_FILES);
      created.doc = await make('document', 'Launch notes');
      created.dashboard = await make('dashboard', 'Source states');
    } catch (error) {
      setupFailed('seeding', error);
    }
    await shot(page, r2({ id: 'r2-deck', title: 'A presentation open in the slides editor', how: 'Click a presentation in the Artifacts library', state: 'A six-slide deck, its first slide selected', folders: ['tools/presentation', 'artifacts', 'src/artifacts/slides/editor'] }), async () => {
      await openArtifact(created.deck!);
      await expect(page.locator('[data-deck-editor]').first()).toBeVisible({ timeout: 20_000 });
    });
    await shot(page, r2({ id: 'r2-deck-element', title: 'Slides editor, an element selected', how: 'Click the first slide’s heading', state: 'The heading selected, the inspector beside the stage', folders: ['tools/presentation', 'src/artifacts/slides/editor', 'src/artifacts/slides/editor/inspector'] }), async () => {
      if (!(await tab(created.deck!).isVisible().catch(() => false))) await openArtifact(created.deck!);
      const heading = (await tab(created.deck!).locator('[data-stage-slide="s001"] [data-eid]').first().boundingBox())!;
      await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
      await expect(tab(created.deck!).locator('[data-overlay] [data-selected]').first()).toBeVisible({ timeout: 10_000 });
      await soft(tab(created.deck!).locator('[data-deck-inspector]'), 'the inspector');
    });
    await reset(page);
    await shot(page, m0({ id: 'm0-deck-check', title: 'Slides editor, a held slide and the Check rail', how: 'A deck with sections, a hidden slide and a held slide; select the held slide, then More › Check', state: 'Two sections in the thumbnails, a hidden slide, the held slide selected with its banner, the Check rail open', folders: ['tools/presentation', 'src/artifacts/slides/editor'] }), async () => {
      await openArtifact(created.review!);
      const t = tab(created.review!);
      await t.locator('[data-slide-thumb="broken"] .deck-thumb-button').first().click();
      await soft(t.locator('[data-held-banner]'), 'the held banner');
      await t.locator('.deck-toolbar [data-editor-toolbar] [data-editor-more]').first().click();
      await page.locator('[role="menu"] [role="menuitemcheckbox"]').nth(1).click();
      await expect(t.locator('[data-deck-rail="check"]').first()).toBeVisible({ timeout: 10_000 });
    });
    await closeOverlays(page);
    await shot(page, m0({ id: 'm0-deck-theme', title: 'Slides editor, the Theme rail and a thumbnail’s menu', how: 'The same deck, More › Theme, then a thumbnail’s menu', state: 'The Theme rail open; the second slide’s thumbnail menu open', folders: ['tools/presentation', 'src/artifacts/slides/editor'] }), async () => {
      if (!(await tab(created.review!).isVisible().catch(() => false))) await openArtifact(created.review!);
      const t = tab(created.review!);
      await t.locator('.deck-toolbar [data-editor-toolbar] [data-editor-more]').first().click();
      await page.locator('[role="menu"] [role="menuitemcheckbox"]').nth(0).click();
      await soft(t.locator('[data-deck-rail="theme"]'), 'the Theme rail');
      await t.locator('[data-slide-thumb="s002"] .deck-thumb-menu').first().click();
      await expect(page.locator('[role="menu"]').first()).toBeVisible({ timeout: 5_000 });
    });
    await closeOverlays(page);
    // the presenter view: its own window (src/main/presentations/present.ts), photographed as that window's page
    let presenter: Page | null = null;
    await shot(page, m0({ id: 'm0-presenter', title: 'The presenter view', how: 'A deck, Present; on one display the audience window’s p shows the presenter view', state: 'The six-slide deck’s presenter view on its first slide: the slide, the next one, notes and the clock', folders: ['tools/presentation', 'src/artifacts/slides/editor/present'] }), async () => {
      const shows = () => app.windows().filter((w) => w.url().includes('present=1'));
      const { opened } = value(await invoke(page, 'presentations.present', { artifactId: created.deck!, slideId: 's001' } as never)) as { opened: string };
      await expect.poll(() => shows().length, { timeout: 15_000 }).toBe(opened === 'audience+presenter' ? 2 : 1);
      const audience = shows().find((w) => w.url().includes('role=audience'))!;
      await expect(audience.locator('[data-present-view="audience"]')).toBeVisible({ timeout: 15_000 });
      presenter = opened === 'audience+presenter' ? shows().find((w) => w.url().includes('role=presenter'))! : audience;
      if (presenter === audience) await audience.keyboard.press('p');
      await expect(presenter.locator('[data-present-view="presenter"]')).toBeVisible({ timeout: 10_000 });
    }, {
      of: () => presenter ?? page,
      after: async () => {
        const shows = app.windows().filter((w) => w.url().includes('present=1'));
        if (shows.length === 0) return;
        const closed = Promise.all(shows.map((w) => w.waitForEvent('close', { timeout: 10_000 }).catch(() => undefined)));
        await shows[0]!.keyboard.press('Escape');
        await closed;
      },
    });
    await reset(page);
    await shot(page, r2({ id: 'r2-design', title: 'A design open in the workbench', how: 'Click a design in the Artifacts library', state: 'Five boards, one of them held because its HTML is broken', folders: ['tools/design', 'artifacts', 'src/artifacts/design/editor'] }), async () => {
      await openArtifact(created.design!);
      await expect(page.locator('[data-design-editor]').first()).toBeVisible({ timeout: 20_000 });
    });
    await shot(page, m0({ id: 'm0-design-held', title: 'Design workbench, the held board selected', how: 'The design, click the held board’s title', state: 'The broken board selected: its banner and the board inspector, its values locked', folders: ['tools/design', 'src/artifacts/design/editor'] }), async () => {
      if (!(await tab(created.design!).isVisible().catch(() => false))) await openArtifact(created.design!);
      await tab(created.design!).locator('[data-board-title="broken"]').first().click();
      await soft(tab(created.design!).locator('[data-board-inspector]'), 'the board inspector');
    });
    await shot(page, m0({ id: 'm0-design-comments', title: 'Design workbench, the comments rail', how: 'The design with two comments, its header’s Comments', state: 'Two threads on the desktop board in the comments rail', folders: ['tools/design', 'src/artifacts/design/editor'] }), async () => {
      if (!(await tab(created.design!).isVisible().catch(() => false))) await openArtifact(created.design!);
      if ((await tab(created.design!).locator('[data-thread-id], [data-comment-thread]').count()) === 0) {
        await editDesign(page, created.design!, { op: 'addThread', threadId: 'on-a', boardId: 'desktop', elementId: 'a', body: 'Can the headline sit higher?' });
        await editDesign(page, created.design!, { op: 'addThread', threadId: 'on-b', boardId: 'desktop', elementId: 'b', body: 'The button reads small here.' });
      }
      await page.locator('[data-region="main"] [data-editor-action="comments"]').first().click();
      await page.waitForTimeout(1200);
    });
    await reset(page);
    await shot(page, r2({ id: 'r2-design-system', title: 'A design system page', how: 'Click the MAWS design system in the Artifacts library', state: 'The built-in MAWS design system: its type samples and components', folders: ['src/artifacts/design-system/page', 'artifacts/design-system', 'library'] }), async () => {
      const { houseId } = value(await invoke(page, 'designSystems.house', undefined as never)) as { houseId: string | null };
      if (!houseId) throw new Error('no house design system');
      await openArtifact(houseId);
      await soft(page.locator(`[data-ds-page="${houseId}"] .dsp-intro`), 'the design system page');
    });
    await shot(page, m0({ id: 'm0-ds-check', title: 'A design system page, its Check section', how: 'The MAWS design system, scrolled to Check', state: 'The built-in system’s check against its law', folders: ['src/artifacts/design-system/page', 'artifacts/design-system'] }), async () => {
      const { houseId } = value(await invoke(page, 'designSystems.house', undefined as never)) as { houseId: string | null };
      if (!houseId) throw new Error('no house design system');
      if (!(await tab(houseId).isVisible().catch(() => false))) await openArtifact(houseId);
      await page.locator(`[data-ds-page="${houseId}"] [data-ds-section="check"]`).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    });
    await reset(page);
    await shot(page, r2({ id: 'r2-doc-versions', title: 'A document with a saved version, its history open', how: 'Document, formatting toolbar › History (⌥⇧⌘H)', state: 'One paragraph, one saved version, the version history rail open', folders: ['tools/document', 'artifacts', 'src/artifacts/document/editor'] }), async () => {
      await openArtifact(created.doc!);
      const text = tab(created.doc!).locator('.ds-doc .ProseMirror').first();
      if (!(await text.innerText()).includes('Friday')) {
        await text.click();
        await page.keyboard.type('The launch moves to Friday.');
        await page.waitForTimeout(1500);
        value(await invoke(page, 'artifacts.saveVersion', { artifactId: created.doc!, label: 'Draft' } as never));
        await text.click();
        await page.keyboard.type(' Owners confirm by Wednesday.');
        await page.waitForTimeout(1500);
      }
      // the toolbar's end group runs Add comment (when a selection allows it), Comments, History, Find
      await tab(created.doc!).locator('.doc-format-toolbar .doc-toolbar-end > button.doc-tool:nth-last-of-type(2)').first().click();
      await expect(tab(created.doc!).locator('aside.doc-rail').first()).toBeVisible({ timeout: 10_000 });
    });
    await shot(page, m0({ id: 'm0-doc-version-preview', title: 'A document showing a saved version', how: 'The history rail, click the saved version', state: 'The version “Draft” previewed read-only, its preview bar with Restore', folders: ['tools/document', 'src/artifacts/document/editor'] }), async () => {
      const rail = tab(created.doc!).locator('aside.doc-rail').first();
      // the version's own label, which the rig wrote
      await rail.getByRole('button', { name: /Draft/ }).first().click();
      await expect(tab(created.doc!).locator('[data-editor="preview"]').first()).toBeVisible({ timeout: 10_000 });
    });
    await reset(page);
    await shot(page, m0({ id: 'm0-doc-save-version', title: 'A document’s Save version form', how: 'The document’s header, Save version', state: 'The history rail open on its Save version form', folders: ['tools/document', 'src/artifacts/document/editor'] }), async () => {
      await openArtifact(created.doc!);
      await page.locator('[data-region="main"] [data-editor-header] [data-editor-action="save-version"]').first().click();
      await expect(tab(created.doc!).locator('aside.doc-rail').first()).toBeVisible({ timeout: 10_000 });
    });
    await reset(page);
    // a dashboard whose three sources are stale, paused and failing (support/dashboards.ts: the owner's own binds)
    await shot(page, m0({ id: 'm0-dashboard-states', title: 'A dashboard with sources stale, paused and failing', how: 'A dashboard with three charts over three bound CSV sources', state: 'Each chart’s source line: stale since a fixed date, paused with no live session, and failing', folders: ['tools/dashboard', 'src/artifacts/dashboard'] }), async () => {
      await openArtifact(created.dashboard!);
      const t = tab(created.dashboard!);
      await expect(t.locator('.ds-doc .ProseMirror').first()).toBeVisible({ timeout: 20_000 });
      if ((await t.locator('.ds-doc figure.dash-view').count()) < 3) {
        const at = Date.UTC(2026, 9, 1, 9, 0);
        const csv = 'region,total\nnorth,120\nsouth,98\nwest,40\n';
        await bindCsv(page, created.dashboard!, 'stale', { title: 'Sales', name: 'sales.csv', csv, at, state: { status: 'stale', at } });
        await bindCsv(page, created.dashboard!, 'paused', { title: 'Visits', name: 'visits.csv', csv, at, state: { status: 'paused', at } });
        await bindCsv(page, created.dashboard!, 'failing', { title: 'Orders', name: 'orders.csv', csv, at, state: { status: 'error', message: 'the source answered 503', at } });
        await insertBlocks(t, [chart('stale', { view: 'bar', x: 'region', y: 'total', title: 'A stale source' }), chart('paused', { view: 'bar', x: 'region', y: 'total', title: 'A paused source' }), chart('failing', { view: 'bar', x: 'region', y: 'total', title: 'A failing source' })]);
      }
      await expect(t.locator('.ds-doc figure.dash-view .dash-source-label')).toHaveCount(3, { timeout: 20_000 });
    });
    await shot(page, m0({ id: 'm0-dashboard-source-sheet', title: 'A dashboard’s source sheet', how: 'The same dashboard, click a chart’s source line', state: 'The stale source’s sheet', folders: ['tools/dashboard', 'src/artifacts/dashboard'] }), async () => {
      if (!(await tab(created.dashboard!).isVisible().catch(() => false))) await openArtifact(created.dashboard!);
      await tab(created.dashboard!).locator('figure.dash-view button.dash-source-label').first().click();
      await expect(tab(created.dashboard!).locator('aside.dash-sheet').first()).toBeVisible({ timeout: 10_000 });
    });
    await reset(page);
  } finally {
    await maws.cleanup();
  }
});

// ======================================================================================================================
// Launch 5: states seeded through main's e2e seams: Settings › Org signed in (the harness build's org fixture,
// src/main/org/page-fixture.ts, from a seed copied from e2e/org-page.spec.ts with its random ids made fixed), and no
// ClaudeUsage data (the usage ring and Settings › Usage unavailable).
// ======================================================================================================================
// Fixed "random" bytes: the same ids, keys and fingerprints on every run, so a before/after pair differs in words only.
let detCount = 0;
const det = (n: number): Buffer => createHash('sha256').update(`words-rig-${++detCount}`).digest().subarray(0, n);

test('states: Settings › Org signed in, usage unavailable', async () => {
  test.setTimeout(600_000);
  const userData = join(SCRATCH, 'profile-states');
  mkdirSync(userData, { recursive: true });
  const harnessBuilt = existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
  const local = readOrMintMachineRef(userData); // the machine the app will be, so the view can list it up
  detCount = 0;
  const { status, view, grants } = seededOrg(local, userData, Date.now());
  const fixture = join(userData, 'org-page.json');
  writeFileSync(fixture, JSON.stringify({ status, view, grants }));
  const noUsage = join(SCRATCH, 'claude-usage-none');
  mkdirSync(noUsage, { recursive: true });
  const maws = await launchMaws({ userData, env: BASE_ENV({ MAWS_E2E_ORG_PAGE: fixture, MAWS_CLAUDE_USAGE_DIR: noUsage }) });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    await page.waitForTimeout(1500);
    await dismissToasts(page);
    const org = () => page.locator('section[aria-labelledby="settings-org"]');
    await shot(page, m0({ id: 'm0-settings-org', title: 'Settings, Org, signed in', how: 'Settings (⌘,), Org in its index', state: 'A seeded org: you (an admin, this Mac’s key refused), people with their devices and a pairing in progress, machines, delegations in each state', folders: ['settings-tab', 'settings-tab/org', 'accounts', 'owner'] }), async () => {
      if (!harnessBuilt) throw new Error('the seeded org needs the harness build’s main (scripts/e2e-build.sh harness)');
      await settingsAt(app, page, 'org');
      await expect(org().locator('[data-org-group="people"]').first()).toBeVisible({ timeout: 15_000 });
    });
    await shot(page, m0({ id: 'm0-settings-org-delegations', title: 'Settings, Org, its delegations', how: 'Settings, Org, scrolled to Delegations', state: 'Four delegations: in effect, behind on the hub, unsent with its error, dropped', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
      if (!harnessBuilt) throw new Error('the seeded org needs the harness build’s main (scripts/e2e-build.sh harness)');
      await settingsAt(app, page, 'org');
      await org().locator('[data-org-section="delegations"]').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    });
    await shot(page, m0({ id: 'm0-org-pairing', title: 'Settings, Org, a member’s pairing sheet', how: 'Settings, Org, the pairing member’s Show…', state: 'The pairing sheet of a member’s first device, its code waiting', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
      if (!harnessBuilt) throw new Error('the seeded org needs the harness build’s main (scripts/e2e-build.sh harness)');
      await settingsAt(app, page, 'org');
      // no data attribute on the row's button: its words, from the page's own copy module
      await org().locator('[data-org-group="people"]').getByRole('button', { name: ORG.pairingShow, exact: true }).first().click();
      await expect(page.getByRole('dialog').filter({ hasNot: page.locator('#settings-org') }).first()).toBeVisible({ timeout: 10_000 });
    });
    await reset(page);
    await orgM1(app, page, harnessBuilt, { status, view });
    await reset(page);
    await shot(page, m0({ id: 'm0-usage-unavailable', title: 'Usage ring popover, no ClaudeUsage data', how: 'Click the ring at the right end of the title bar, ClaudeUsage’s folder empty', state: 'The usage reading unavailable', folders: ['usage'] }), async () => {
      await page.locator('[data-toolbar] [data-usage-ring]').first().click();
      await page.waitForTimeout(1500);
    });
    await reset(page);
    await shot(page, m0({ id: 'm0-settings-usage-unavailable', title: 'Settings, Usage, no ClaudeUsage data', how: 'Settings (⌘,), Usage, ClaudeUsage’s folder empty', state: 'Accounts and limits unavailable', folders: ['settings-tab', 'usage', 'accounts'] }), async () => {
      await settingsAt(app, page, 'usage');
    });
    await reset(page);
  } finally {
    await maws.cleanup();
  }
});

// The word cut's M1 over launch 5's seeded org (G153 to G196): what waits behind the Org page's chevrons, in its menus
// and its tooltips, each opened as a person opens it, and a note on pointing. The code destination is unset in this
// seed, so New delegation… is greyed with its reason.
async function orgM1(app: ElectronApplication, page: Page, harnessBuilt: boolean, seed: { status: Registered; view: OrgView }) {
  const org = () => page.locator('section[aria-labelledby="settings-org"]');
  const group = (id: string) => org().locator(`[data-org-group="${id}"]`);
  const at = async (id: string) => {
    if (!harnessBuilt) throw new Error('the seeded org needs the harness build’s main (scripts/e2e-build.sh harness)');
    await settingsAt(app, page, 'org');
    await expect(group('people').first()).toBeVisible({ timeout: 15_000 });
    await group(id).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
  };
  // a chevron opened for its capture and folded after, so the next scene opens from the page at rest; master's build has
  // no chevron (its label not in master's copy), what it discloses (`rest`) drawn at rest
  const chevron = (scope: () => Locator, label: string | undefined) => (label === undefined ? null : scope().getByRole('button', { name: label, exact: true }).first());
  const unfold = async (button: Locator | null, rest: Locator) => {
    if (!cutBuild()) return rest.first().scrollIntoViewIfNeeded({ timeout: 10_000 });
    if ((await button!.getAttribute('aria-expanded')) !== 'true') await button!.click();
    await expect(button!).toHaveAttribute('aria-expanded', 'true');
  };
  // what a chevron discloses, its seed's facts in view (on master's build, drawn at rest), the chevron open on the cut's
  const unfolded = (button: Locator | null, scope: Locator, facts: string[], what: string) => async () => {
    if (cutBuild()) await expect(button!, `the chevron of ${what} open`).toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 });
    for (const fact of facts) await inView(scope.getByText(fact, { exact: false }), `${what}: ${fact}`);
  };
  const you = seed.view.members.find((member) => member.you)!;
  const thisMac = you.devices.find((d) => d.thisMac)!;
  const firstSeeded = seed.view.machines[0]!;
  const fold = (button: Locator | null) => async () => {
    if (button !== null && (await button.getAttribute('aria-expanded').catch(() => null)) === 'true') await button.click();
  };
  // a member's row by the email it shows; a row's "…" is its first menu trigger, before its devices' own
  const member = (email: string) => group('people').getByRole('group').filter({ hasText: email });
  const trigger = (scope: Locator) => scope.locator('button[aria-haspopup="menu"]').first();

  const device = chevron(() => group('you'), CUT_ORG.deviceDetails);
  const deviceRow = group('you').getByRole('group', { name: ORG.device, exact: true });
  await shot(page, m1({ id: 'm1-org-device-details', title: 'Settings, Org, This Mac’s details open', how: 'Settings, Org; the chevron on This Mac', state: 'This Mac’s device id and fingerprint, out from behind the chevron', folders: ['settings-tab/org'] }), async () => {
    await at('you');
    await unfold(device, deviceRow);
  }, { check: unfolded(device, group('you'), [thisMac.id.slice(0, 8), thisMac.fingerprint], 'This Mac’s id and fingerprint'), after: fold(device) });
  const kind = group('people').locator('[data-org-device] span[tabindex="0"]');
  const firstDevice = group('people').locator('[data-org-device]').first();
  await shot(page, m1({ id: 'm1-org-device-tip', title: 'Settings, Org, a device’s id', how: 'Settings, Org, People; Tab to a device’s kind', state: 'A device’s kind holding the keyboard, its id’s first 8 as the tooltip', folders: ['settings-tab/org', 'ui'] }), async () => {
    await at('people');
    await focusTip(page, kind, firstDevice);
  }, { check: tipShown(page, kind, 'a device’s kind', firstDevice) });
  // Ben, a member and not you: his menu holds the role change, the email change and the removal (PeopleGroup.tsx)
  const ben = member('ben@northwind.example');
  await shot(page, m1({ id: 'm1-org-person-menu', title: 'Settings, Org, a person’s menu', how: 'Settings, Org, People; the … of Ben, a member', state: 'A person’s actions in their menu: make admin, change email, remove', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
    await at('people');
    await openMenu(ben, trigger(ben));
  }, { check: menuShows(page, trigger(ben), [ORG.makeAdmin, ORG.changeEmail, ORG.removePerson], ben), after: () => closeMenu(page) });
  // an admin's Mac that is no root, Maximiliana Ortiz's third device: it may be made a root, or removed
  const ortizMac = member('maximiliana.ortiz@northwind.example').locator('[data-org-device]').nth(2);
  await shot(page, m1({ id: 'm1-org-device-menu', title: 'Settings, Org, a device’s menu', how: 'Settings, Org, People; the … on the line of an admin’s Mac that is no root', state: 'A device’s actions in its menu: make a root, remove', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
    await at('people');
    await openMenu(ortizMac, trigger(ortizMac));
  }, { check: menuShows(page, trigger(ortizMac), [ORG.makeDeviceRoot, ORG.removeDevice], ortizMac), after: () => closeMenu(page) });
  // studio-mini, the org's own and not this Mac: grant, owners, re-enroll and drop (MachineRow.tsx)
  const studio = group('machines').getByRole('group', { name: 'studio-mini', exact: true });
  await shot(page, m1({ id: 'm1-org-machine-menu', title: 'Settings, Org, a machine’s menu', how: 'Settings, Org, Machines; the … of studio-mini', state: 'A machine’s actions in its menu: grant, owners, re-enroll, drop', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
    await at('machines');
    await openMenu(studio, trigger(studio));
  }, { check: menuShows(page, trigger(studio), [ORG.grant, ORG.ownersAction, ORG.reenroll, ORG.drop], studio), after: () => closeMenu(page) });
  const up = group('machines').locator('[role="img"][tabindex="0"]');
  const upWord = group('machines').getByText(ORG.machineState.up, { exact: true });
  await shot(page, m1({ id: 'm1-org-up-tip', title: 'Settings, Org, a machine’s Up dot', how: 'Settings, Org, Machines; Tab to this machine’s dot', state: 'The green dot holding the keyboard, Up its tooltip', folders: ['settings-tab/org', 'ui'] }), async () => {
    await at('machines');
    await focusTip(page, up, upWord);
  }, { check: tipShown(page, up, 'the Up dot', upWord) });
  const firstMachine = group('machines').getByRole('group', { name: firstSeeded.name, exact: true });
  const key = chevron(() => firstMachine, CUT_ORG.keyDetails);
  await shot(page, m1({ id: 'm1-org-key-open', title: 'Settings, Org, a machine’s key open', how: 'Settings, Org, Machines; the chevron on the first machine', state: 'The machine’s key id, out from behind the chevron', folders: ['settings-tab/org'] }), async () => {
    await at('machines');
    await unfold(key, firstMachine);
  }, { check: unfolded(key, firstMachine, [ORG.machineKey(firstSeeded.keyId)], `${firstSeeded.name}’s key`), after: fold(key) });
  const details = chevron(() => group('org'), CUT_ORG.details);
  const recovery = group('org').getByRole('group', { name: ORG.recovery, exact: true });
  await shot(page, m1({ id: 'm1-org-details-open', title: 'Settings, Org, the Org group’s details open', how: 'Settings, Org; the chevron beside the Org heading', state: 'The org’s id, its roots and its recovery key, out from behind the chevron', folders: ['settings-tab/org'] }), async () => {
    await at('org');
    await unfold(details, recovery);
  }, { check: unfolded(details, group('org'), [seed.status.org, seed.view.recoveryKid], 'the org’s id and recovery key'), after: fold(details) });
  const delegations = () => org().locator('[data-org-section="delegations"]');
  const stray = delegations().getByRole('group', { name: ORG.strayKeys, exact: true });
  await shot(page, m1({ id: 'm1-org-stray-hover', title: 'Settings, Org, pointer on Stray hub keys', how: 'Settings, Org, Delegations; hover Stray hub keys', state: 'The stray keys’ row under the pointer, its note open', folders: ['settings-tab/org', 'ui'], hover: true }), async () => {
    await at('org');
    await delegations().first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await stray.hover();
    await page.waitForTimeout(1200);
  }, { check: checks(pointedAt(stray, 'Stray hub keys'), noteShown(stray, 'Stray hub keys')) });
  const create = delegations().locator('[data-org-new-delegation] button');
  const createRow = delegations().getByRole('group', { name: MASTER_ORG.newDelegation ?? '', exact: true });
  await shot(page, m1({ id: 'm1-org-new-delegation-reason', title: 'Settings, Org, New delegation… greyed', how: 'Settings, Org, Delegations, the code destination unset; Tab to New delegation…', state: 'New delegation… greyed and holding the keyboard, why its tooltip; the destination’s form in view', folders: ['settings-tab/org', 'ui'] }), async () => {
    await at('org');
    await delegations().first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await focusTip(page, create, createRow);
  }, { check: tipShown(page, create, 'New delegation…', createRow) });
}

// ======================================================================================================================
// Launch 6: the word cut's M1, the states one more seed holds: Settings › Org for a member who may not sign (the seed of
// launch 5 with this Mac no root and its member no admin), a Chrome profile imported from the synthetic Chrome user data
// directory (test/support/chrome-profile.ts, through the import's seams), and the scripted voice probe with its helper
// missing, then with the permissions not asked.
// ======================================================================================================================
test('states: Settings › Org read-only, an imported Chrome profile, Voice in trouble', async () => {
  test.setTimeout(600_000);
  const userData = join(SCRATCH, 'profile-m1-readonly');
  mkdirSync(userData, { recursive: true });
  const harnessBuilt = existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
  detCount = 0;
  const fixture = join(userData, 'org-page.json');
  writeFileSync(fixture, JSON.stringify(readOnlyOrg(seededOrg(readOrMintMachineRef(userData), userData, Date.now()))));
  const chrome = buildChromeUserData(join(SCRATCH, 'chrome'));
  const maws = await launchMaws({
    userData,
    env: BASE_ENV({ MAWS_E2E_ORG_PAGE: fixture, MAWS_E2E_CHROME_USER_DATA: chrome.dir, MAWS_E2E_KEYCHAIN: `file:${chrome.passwordFile}`, MAWS_E2E_VOICE: JSON.stringify({ helper: 'missing' }) }),
  });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    await page.waitForTimeout(1500);
    await dismissToasts(page);
    const org = () => page.locator('section[aria-labelledby="settings-org"]');
    const group = (id: string) => org().locator(`[data-org-group="${id}"]`);
    const delegations = () => org().locator('[data-org-section="delegations"]');
    const orgAt = async (target: string) => {
      if (!harnessBuilt) throw new Error('the seeded org needs the harness build’s main (scripts/e2e-build.sh harness)');
      await settingsAt(app, page, 'org');
      await expect(group('people').first()).toBeVisible({ timeout: 15_000 });
      await org().locator(target).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    };
    // What may not sign shows: on the cut's build the one view-only line and neither Enroll's nor New delegation's line;
    // on master's, Enroll's and New delegation's rows each saying admins do it (this member is no admin), and no
    // button that would act
    const viewOnly = () => org().getByText(new RegExp(`^${CUT_ORG.viewOnly?.([]) ?? 'View only'}`)).first();
    const enrollRest = () => group('machines').getByRole('group', { name: MASTER_ORG.enroll ?? '', exact: true });
    const createRest = () => delegations().getByRole('group', { name: MASTER_ORG.newDelegation ?? '', exact: true });
    const mayNotSign = async () => {
      await expect(org().getByRole('button', { name: ORG.enrollAction, exact: true }), 'no Enroll a machine…').toHaveCount(0);
      await expect(org().getByRole('button', { name: ORG.createAction, exact: true }), 'no New delegation…').toHaveCount(0);
      if (cutBuild()) {
        await expect(viewOnly(), 'the view-only line').toBeVisible({ timeout: 3_000 });
        await expect(org().locator('[data-org-enroll], [data-org-new-delegation]'), 'no Enroll line and no New delegation line').toHaveCount(0);
      } else {
        await expect(enrollRest(), 'Enroll, for admins').toContainText(ORG.enrollAdmins, { timeout: 3_000 });
        await expect(createRest(), 'New delegation, for admins').toContainText(ORG.delegationsAdmins, { timeout: 3_000 });
        // the role answers before the signing does on master's page: this Mac no root, its Signer row says how to make it one
        await expect(group('org').getByRole('group', { name: ORG.signer, exact: true }), 'master’s Signer row, no root').toContainText(ORG.makeRoot, { timeout: 3_000 });
      }
    };
    await shot(page, m1({ id: 'm1-org-read-only', title: 'Settings, Org, for someone who may not sign', how: 'Settings (⌘,), Org, as a member whose Mac is no root', state: 'The one view-only line naming who signs, above You; no Enroll and no New delegation line', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
      await orgAt('#settings-org');
    }, { check: checks(mayNotSign, () => inView(cutBuild() ? viewOnly() : group('you'), 'the page’s top')) });
    await shot(page, m1({ id: 'm1-org-read-only-machines', title: 'Settings, Org, Machines for someone who may not sign', how: 'Settings, Org, scrolled to Machines', state: 'The machines with no Enroll a machine… line under them', folders: ['settings-tab/org'] }), async () => {
      await orgAt('[data-org-group="machines"]');
    }, { check: checks(mayNotSign, () => inView(cutBuild() ? group('machines') : enrollRest(), 'Machines')) });
    await shot(page, m1({ id: 'm1-org-read-only-delegations', title: 'Settings, Org, Delegations for someone who may not sign', how: 'Settings, Org, scrolled to Delegations', state: 'The delegations with nothing offered to create one', folders: ['settings-tab/org'] }), async () => {
      await orgAt('[data-org-section="delegations"]');
    }, { check: checks(mayNotSign, () => inView(cutBuild() ? delegations() : createRest(), 'Delegations')) });
    await reset(page);

    // Voice: the helper missing (G50, G55, G56), then the helper there and the permissions not asked yet (G53), the
    // script changed on main's environment (scripted-backend.ts reads it at each probe) and read again past the probe's
    // ten-second cache. Each waits for the probe's answer drawn, in the words of the build's copy.
    const voiceRow = (id: string) => page.locator(`[data-settings-row="voice.${id}"]`);
    const voiceReads = async (rows: Record<string, string>) => {
      for (const [id, words] of Object.entries(rows)) await expect(voiceRow(id), `Voice, ${id}`).toContainText(words, { timeout: 3_000 });
    };
    const trouble = { microphone: VOICE.permissionUnknown, speech: VOICE.permissionUnknown, recognition: VOICE.permissionUnknown };
    const notAsked = { microphone: VOICE.permission.notDetermined, speech: VOICE.permission.notDetermined };
    await shot(page, m1({ id: 'm1-settings-voice-trouble', title: 'Settings, Voice, the helper missing', how: 'Settings, Voice, the scripted probe reporting no helper', state: 'The Helper row with where it was looked for, the permissions and the recognition unknown', folders: ['settings-tab'] }), async () => {
      await settingsAt(app, page, 'voice');
      await expect(voiceRow('recognition'), 'the probe answered').toContainText(VOICE.permissionUnknown, { timeout: 15_000 });
    }, {
      check: async () => {
        // main's own status: the helper missing, at the path it names; the Helper row says so, with that path's file
        const { helper } = value(await invoke(page, 'voice.status', { locale: null }));
        expect(helper.state, 'main’s helper').toBe('missing');
        await expect(voiceRow('helper'), 'the Helper row').toContainText(VOICE.helperMissing, { timeout: 3_000 });
        await expect(voiceRow('helper'), 'the path looked at').toContainText(helper.path.split('/').pop()!);
        await voiceReads(trouble);
      },
    });
    await reset(page);
    await shot(page, m1({ id: 'm1-settings-voice-not-asked', title: 'Settings, Voice, permissions not asked yet', how: 'Settings, Voice, the scripted probe reporting the helper and both permissions not asked', state: 'Microphone and Speech recognition not asked yet, each its word alone', folders: ['settings-tab'] }), async () => {
      await app.evaluate((_, script) => void (process.env.MAWS_E2E_VOICE = script), JSON.stringify({ permission: { microphone: 'notDetermined', speech: 'notDetermined' } }));
      await reset(page);
      await page.waitForTimeout(11_000);
      await settingsAt(app, page, 'voice');
      await expect(voiceRow('microphone'), 'the probe answered').toContainText(VOICE.permission.notDetermined, { timeout: 15_000 });
    }, { check: () => voiceReads(notAsked) });
    await reset(page);

    // Browser: a Chrome profile imported once (history and cookies left out), checked whole as main recorded it (its
    // report done, its bookmarks read with no error, its extensions), then its row, its menu, its popups' ⓘ and its note
    // (G70 to G77, T538). Master draws the menu's actions as the profile's own buttons and the ⓘ's words as a line.
    const imported = () => page.locator('[data-imported-profile]');
    const profileRow = () => imported().locator('[data-settings-row="browser.importedProfile"]');
    const profileMenu = () => profileRow().locator('button[aria-haspopup="menu"]');
    const popupLimit = () => imported().locator('[data-extension-popup-limit]');
    const recordWhole = () => {
      const profiles = profilesFile(userData)?.profiles ?? [];
      expect(profiles, 'one imported profile').toHaveLength(1);
      const [record] = profiles;
      expect(record!.report.outcome, 'its import done').toBe('done');
      expect(record!.bookmarks, 'its bookmarks read, with no error').toMatchObject({ syncedAt: expect.any(String), error: null });
      expect(record!.extensions.length, 'its extensions').toBeGreaterThan(0);
    };
    const browserAt = async () => {
      if ((profilesFile(userData)?.profiles.length ?? 0) === 0) {
        await importThrough({ maws, page }, { history: false, cookies: false, bookmarks: true, extensions: true });
        await closeSheet({ maws, page });
      }
      recordWhole();
      await settingsAt(app, page, 'browser');
      await imported().first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
    };
    const profileShown = async () => {
      recordWhole();
      await inView(profileRow(), 'the imported profile’s row');
    };
    await shot(page, m1({ id: 'm1-settings-browser-imported', title: 'Settings, Browser, a Chrome profile imported', how: 'Settings, Browser; Import…, the synthetic Chrome profile with its bookmarks and extensions', state: 'The imported profile’s row (its date and its …), Extensions with its ⓘ, a switch per extension', folders: ['settings-tab', 'tools/browser/import'] }), browserAt, { check: checks(profileShown, () => inView(popupLimit(), 'Extensions’ ⓘ')) });
    await shot(page, m1({ id: 'm1-settings-browser-profile-menu', title: 'Settings, Browser, the imported profile’s menu', how: 'Settings, Browser; the … of the imported profile', state: 'Show report, Sync bookmarks now and Remove in its menu', folders: ['settings-tab', 'tools/browser/import'] }), async () => {
      await browserAt();
      await openMenu(profileRow(), profileMenu());
    }, { check: checks(profileShown, menuShows(page, profileMenu(), [BROWSER.showReport, BROWSER_COPY.profile.syncNow, BROWSER.remove], imported())), after: () => closeMenu(page) });
    await shot(page, m1({ id: 'm1-settings-browser-popup-tip', title: 'Settings, Browser, what extension popups cannot see', how: 'Settings, Browser; Tab to the ⓘ beside Extensions', state: 'The ⓘ holding the keyboard, the popups’ limit its tooltip', folders: ['settings-tab', 'ui'] }), async () => {
      await browserAt();
      await focusTip(page, popupLimit(), popupLimit().filter({ hasText: BROWSER.popupLimit }));
    }, { check: tipShown(page, popupLimit(), 'the ⓘ', popupLimit().filter({ hasText: BROWSER.popupLimit })) });
    await shot(page, m1({ id: 'm1-settings-browser-profile-hover', title: 'Settings, Browser, pointer on the imported profile', how: 'Settings, Browser; hover the imported profile’s row', state: 'The profile’s row under the pointer, its note with when its bookmarks were last read', folders: ['settings-tab', 'tools/browser/import'], hover: true }), async () => {
      await browserAt();
      await profileRow().first().hover();
      await page.waitForTimeout(1200);
    }, { check: checks(profileShown, pointedAt(profileRow(), 'the imported profile’s row'), noteShown(profileRow(), 'the imported profile’s row')) });
    await reset(page);
  } finally {
    await maws.cleanup();
  }
});

// ======================================================================================================================
// Launch 7: the word cut's M1, an admin's org with no delegation yet: the seed of launch 5 with its delegations and stray
// keys gone, the code destination set, and the weekly re-sign not due (so This Mac carries "signs" and no Signer row).
// ======================================================================================================================
test('states: Settings › Org with no delegation, the code destination set', async () => {
  test.setTimeout(600_000);
  const userData = join(SCRATCH, 'profile-m1-quiet');
  mkdirSync(userData, { recursive: true });
  const harnessBuilt = existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
  detCount = 0;
  const fixture = join(userData, 'org-page.json');
  writeFileSync(fixture, JSON.stringify({ ...quietOrg(seededOrg(readOrMintMachineRef(userData), userData, Date.now())), provisioningSecret: DESTINATION }));
  const maws = await launchMaws({ userData, env: BASE_ENV({ MAWS_E2E_ORG_PAGE: fixture }) });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    await page.waitForTimeout(1500);
    await dismissToasts(page);
    const org = () => page.locator('section[aria-labelledby="settings-org"]');
    const delegations = () => org().locator('[data-org-section="delegations"]');
    const project = () => delegations().getByRole('textbox', { name: ORG.destinationFields.project, exact: true });
    const orgAt = async (target: () => Locator) => {
      if (!harnessBuilt) throw new Error('the seeded org needs the harness build’s main (scripts/e2e-build.sh harness)');
      await settingsAt(app, page, 'org');
      await expect(org().locator('[data-org-group="people"]').first()).toBeVisible({ timeout: 15_000 });
      await target().first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(400);
    };
    const group = (id: string) => org().locator(`[data-org-group="${id}"]`);
    const signer = () => group('org').getByRole('group', { name: ORG.signer, exact: true });
    const destinationRow = () => delegations().getByRole('group', { name: ORG.destination, exact: true });
    // This Mac signs, its weekly re-sign not due (no Re-sign now anywhere): on the cut's build its "signs" chip and no
    // Signer row; on master's, the Signer row saying this Mac signs, brought into view
    const signs = async () => {
      await expect(org().getByRole('button', { name: ORG.resign, exact: true }), 'no weekly re-sign').toHaveCount(0);
      if (!cutBuild()) return expect(signer(), 'master’s Signer row: this Mac signs').toContainText(MASTER_ORG.signs!, { timeout: 3_000 });
      await inView(group('you').getByText(CUT_ORG.signsMark!, { exact: true }), 'This Mac’s “signs”');
      await expect(signer(), 'no Signer row').toHaveCount(0);
    };
    // the saved destination as main answered it (the seed's), field by field; the cut's build keeps the form mounted,
    // folded, so its fields are read whether drawn or not
    const field = (name: keyof typeof DESTINATION) => delegations().locator(`input[aria-label="${ORG.destinationFields[name]}"]`);
    const saved = async () => {
      for (const name of ['project', 'secret', 'account'] as const) await expect(field(name), `the saved ${name}`).toHaveValue(DESTINATION[name], { timeout: 5_000 });
    };
    // no delegation: on the cut's build no row at all in the section (the form is folded) and New delegation… enabled,
    // which it is only once the destination has read as set; on master's, the no-delegation line and only New
    // delegation's and the destination's rows
    const none = async () => {
      await saved();
      if (!cutBuild()) {
        await inView(delegations().getByText(ORG.noDelegations, { exact: true }), 'master’s no-delegation line');
        return void (await expect(delegations().getByRole('group'), 'master’s two rows: New delegation and the destination').toHaveCount(2, { timeout: 3_000 }));
      }
      await expect(delegations().getByRole('group'), 'no row').toHaveCount(0, { timeout: 3_000 });
      const create = delegations().locator('[data-org-new-delegation]').getByRole('button', { name: ORG.createAction, exact: true });
      await inView(create, 'New delegation…');
      await expect(create, 'New delegation… enabled').not.toHaveAttribute('aria-disabled', 'true');
      await expect(delegations().getByRole('button', { name: ORG.destination, exact: true }), 'the destination folded').toHaveAttribute('aria-expanded', 'false', { timeout: 3_000 });
    };
    await shot(page, m1({ id: 'm1-org-signs', title: 'Settings, Org, a root that signs', how: 'Settings (⌘,), Org, as an admin whose Mac is a root, the weekly re-sign not due', state: 'This Mac marked “signs”; no Signer row in the Org group', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
      await orgAt(() => (cutBuild() ? org() : signer()));
    }, { check: checks(signs, () => inView(cutBuild() ? group('you') : signer(), cutBuild() ? 'You' : 'master’s Signer row')) });
    await shot(page, m1({ id: 'm1-org-no-delegations', title: 'Settings, Org, no delegation yet', how: 'Settings, Org, scrolled to Delegations', state: 'No delegation: New delegation… alone, and the set code destination behind its chevron', folders: ['settings-tab/org'] }), async () => {
      await orgAt(delegations);
    }, { check: none });
    await shot(page, m1({ id: 'm1-org-destination-open', title: 'Settings, Org, the code destination open', how: 'Settings, Org, Delegations; Tab to the Code destination chevron, Enter (the form’s first field takes the keyboard)', state: 'The set destination’s project, secret and account, the first field holding the keyboard with the row’s note open', folders: ['settings-tab/org', 'ui'] }), async () => {
      await orgAt(delegations);
      // master's build draws the destination's form at rest, under no chevron: its first field is focused by hand. On the
      // cut's, the chevron is pressed by the keyboard from folded, and opening it hands the keyboard to the first field
      if (!cutBuild()) {
        await project().scrollIntoViewIfNeeded();
        return project().focus();
      }
      const open = delegations().getByRole('button', { name: ORG.destination, exact: true });
      if ((await open.getAttribute('aria-expanded')) === 'true') await open.click(); // a retry finds it open
      await expect(open).toHaveAttribute('aria-expanded', 'false');
      await open.focus();
      await page.keyboard.press('Enter');
      await expect(open).toHaveAttribute('aria-expanded', 'true');
    }, { check: checks(() => expect(project(), 'the project field').toBeFocused({ timeout: 3_000 }), saved, noteShown(destinationRow(), 'the Code destination row')) });
    await reset(page);
  } finally {
    await maws.cleanup();
  }
});

// ======================================================================================================================
// Launch 8: the word cut's M1, two Settings states that need their own main: a pairing code refused (Settings › Org over
// a fixture holding a Mac in no org, whose `org.register` answers busy, page-fixture.ts) and the relay up (the host's
// dev relay override, MAWS_RELAY_URL, pointed at the loopback model stub, which answers the relay's health check).
// ======================================================================================================================
test('states: Settings › Org with a pairing code refused, Gateway with the relay up', async () => {
  test.setTimeout(300_000);
  const userData = join(SCRATCH, 'profile-m1-refused');
  mkdirSync(userData, { recursive: true });
  const harnessBuilt = existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
  const fixture = join(userData, 'org-page.json');
  writeFileSync(fixture, JSON.stringify({ status: { state: 'none' }, view: null }));
  const relay = await startModelStub();
  const maws = await launchMaws({ userData, env: BASE_ENV({ MAWS_E2E_ORG_PAGE: fixture, MAWS_RELAY_URL: relay.url }) });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    await page.waitForTimeout(1500);
    await dismissToasts(page);
    const org = () => page.locator('section[aria-labelledby="settings-org"]');
    const code = () => org().getByRole('textbox', { name: ORG.code, exact: true });
    const codeRow = () => org().getByRole('group', { name: ORG.code, exact: true });
    const refusal = () => codeRow().getByRole('alert');
    // an invented code, typed and sent as a person sends it (master's build draws the field at rest), then let go, so
    // the field's focus no longer holds the row's note open over the refusal
    await shot(page, m1({ id: 'm1-settings-org-code-refused', title: 'Settings, Org, a pairing code refused', how: 'Settings (⌘,), Org (not signed in); Sign in…, type a pairing code, Enter; then click away', state: 'The refusal under the pairing-code field that sent it (the fixture’s main answers busy), the row’s note closed', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
      if (!harnessBuilt) throw new Error('the Org page fixture needs the harness build’s main (scripts/e2e-build.sh harness)');
      await settingsAt(app, page, 'org');
      const signIn = CUT_ORG.signInOpen === undefined ? null : org().getByRole('button', { name: CUT_ORG.signInOpen, exact: true });
      await expect(signIn === null ? code() : signIn.or(code()).first()).toBeVisible({ timeout: 10_000 });
      if (signIn !== null && (await signIn.count())) await signIn.click();
      await code().fill('QX7K-4MPL-92TD');
      await code().press('Enter');
      await expect(refusal()).toBeVisible({ timeout: 10_000 });
      await letGo(page);
    }, {
      check: async () => {
        await inView(refusal(), 'the code’s refusal');
        if (cutBuild()) await expect(codeRow().locator('[data-row-note][data-open]'), 'the row’s note closed').toHaveCount(0);
      },
    });
    await reset(page);
    // the relay's address, when it was last checked and how fast its tooltip (G109)
    const address = page.locator('[data-settings-row="gateway.relay"] span[tabindex="0"]');
    const line = page.locator('[data-settings-row="gateway.relay"]').getByText(/127\.0\.0\.1:\d+/); // master's: the address, when checked and how fast
    await shot(page, m1({ id: 'm1-settings-gateway-relay-tip', title: 'Settings, Gateway, the relay’s check', how: 'Settings, Gateway, the relay up; Tab to its address', state: 'The relay’s address holding the keyboard, when it was checked and its latency the tooltip', folders: ['settings-tab', 'gateway', 'ui'] }), async () => {
      await settingsAt(app, page, 'gateway');
      await expect((cutBuild() ? address : line).first(), 'the relay checked').toBeVisible({ timeout: 15_000 });
      await focusTip(page, address, line);
    }, { check: tipShown(page, address, 'the relay’s address', line) });
    await reset(page);
  } finally {
    await maws.cleanup();
    await relay.close();
  }
});

// ======================================================================================================================
// Launch 9: the word cut's M1, Settings › Usage over a copy of ClaudeUsage's fixture of its own, the relay's requests
// moved to the last minute before the launch: what an account served counts main's last ten minutes, which a launch that
// ran on would carry into its later Usage pictures. The routed account's email and its tooltip (W177, W178, G115), then
// an account to sign in again (W181), marked as accounts.spec marks it. Master draws what the tooltips hold in the card.
// ======================================================================================================================
test('states: Settings › Usage, an account that served, an account to sign in again', async () => {
  test.setTimeout(300_000);
  const userData = join(SCRATCH, 'profile-m1-usage');
  mkdirSync(userData, { recursive: true });
  const usage = usageFixture('claude-usage-m1');
  freshRequests(usage);
  const maws = await launchMaws({ userData, env: BASE_ENV({ MAWS_CLAUDE_USAGE_DIR: usage }) });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    await page.waitForTimeout(1500);
    await dismissToasts(page);
    const routed = page.locator('[data-usage-panel] [data-account][data-routing]');
    const email = routed.locator('span[tabindex="0"]');
    const served = routed.locator('[data-serving]'); // master's: what it served, a chip in the card
    await shot(page, m1({ id: 'm1-settings-usage-email-tip', title: 'Settings, Usage, the routed account’s email', how: 'Settings, Usage, the relay’s requests from the last minutes; Tab to the routed account’s email', state: 'The email holding the keyboard: its tooltip with the rate-limit tier, the saved sessions and what it served', folders: ['settings-tab', 'usage', 'accounts', 'ui'] }), async () => {
      await settingsAt(app, page, 'usage');
      if (cutBuild()) await expect(email.first(), 'what the routed account served').toHaveAccessibleDescription(/\d+ requests? · /, { timeout: 20_000 });
      else await expect(served.first(), 'what the routed account served').toBeVisible({ timeout: 20_000 });
      await focusTip(page, email, served);
    }, { check: tipShown(page, email, 'the routed account’s email', served) });
    await reset(page);
    const accounts = join(usage, 'accounts.json');
    const original = readFileSync(accounts, 'utf8');
    const card = page.locator('[data-usage-panel] [data-account][data-state="needs_reauth"]');
    const reauth = card.locator('p > span[tabindex="0"]');
    const said = card.locator(':scope > p').last(); // master's: the reauthentication paragraph, last in the card
    await shot(page, m1({ id: 'm1-settings-usage-reauth', title: 'Settings, Usage, an account to sign in again', how: 'Settings, Usage, ClaudeUsage marking 5@example.test as needing reauthentication; Tab to its Sign in again', state: 'The account dimmed and last, Sign in again in orange holding the keyboard, what follows from it its tooltip', folders: ['settings-tab', 'usage', 'accounts', 'ui'] }), async () => {
      const marked = (JSON.parse(original) as { email: string }[]).map((account) => (account.email === '5@example.test' ? { ...account, needsReauthentication: true } : account));
      writeFileSync(accounts, JSON.stringify(marked, null, 2));
      await settingsAt(app, page, 'usage');
      await expect(card.first()).toBeVisible({ timeout: 15_000 });
      await focusTip(page, reauth, said);
    }, { check: tipShown(page, reauth, 'Sign in again', said), after: async () => writeFileSync(accounts, original) });
    await reset(page);
  } finally {
    await maws.cleanup();
  }
});

// ======================================================================================================================
// Launch 10: the word cut's M2, recorded transcripts read from disk for the conversation's states no earlier launch holds,
// in a launch of their own so launch 3's sessions and pictures stay as they were: a steer the engine took mid-turn, an
// ask the interrupt withdrew, an agents listing with a message from another session, a scheduled job's fires, and the
// sminos bridge's wake. Each scene opens every turn and run first, as launch 3's do. Last, a new chat's model menu,
// which needs the index's New chat (a setup intent), not the scenario's.
// ======================================================================================================================
const M2_DISK: { key: string; file: string; title: string; state: string }[] = [
  // a `next` steer the engine took between the second and third Bash calls (transcript/model/disk.test.ts reads it so)
  { key: 'steer', file: 'test/fixtures/transcripts/w1-steer-next-disk.jsonl', title: 'Steer the counting', state: 'A message sent while the turn ran, which the engine took mid-turn' },
  // an ask whose call the interrupt withdrew (lane-a/run-routes.test.ts: `cancelled`, `withdrawn`, from the file)
  { key: 'askcut', file: 'test/fixtures/transcripts/p1-maws-ask-interrupt.jsonl', title: 'Ask, then stop', state: 'An ask without waiting, its turn stopped by the person' },
  // ListAgents (one peer session), a message from that session, the replies, and a send to nobody (pass 3's E7 probe)
  { key: 'listing', file: 'spikes/protocol-probe/fixtures/pass3/e7-peer-transcripts/db45d92e-e979-4edf-a62a-61f21dc01acb.jsonl', title: 'List the peers', state: 'The agent listed the sessions it can message; another session wrote to it' },
  // a session-only job firing every minute, three fires (lane-a/arrival-routes.test.ts reads them from the file)
  { key: 'cron', file: 'spikes/protocol-probe/fixtures/uxwave/u3-cron-r1.transcript.jsonl', title: 'Tick every minute', state: 'A scheduled job created, then its fires' },
  // a blocked command, an Esc, the person's grant and the bridge's wake (lane-a/blocked-routes.test.ts, u1c-t-esc-1)
  { key: 'wake', file: 'spikes/protocol-probe/fixtures/uxwave/u1c-t-esc-1.transcript.jsonl', title: 'Carry out the task file', state: 'A command blocked, the turn stopped, a grant delivered and the bridge waking the session' },
];
const m2DiskId = (i: number) => `0d4e5f6a-0000-4000-8000-0000000004${String(i).padStart(2, '0')}`;

test('the word cut’s M2: recorded transcripts for the conversation’s states', async () => {
  test.setTimeout(600_000);
  const repos = REPOS.map((name) => makeRepo(name, name === 'stages' ? 'scheduled' : undefined));
  const config = join(SCRATCH, 'claude-config-m2');
  rmSync(config, { recursive: true, force: true });
  M2_DISK.forEach((d, i) => writeDisk(config, d.file, m2DiskId(i), repos[i % repos.length]!));
  trust(config);
  const usage = usageFixture();
  mkdirSync(join(SCRATCH, 'profile-m2'), { recursive: true });
  const maws = await launchMaws({ userData: join(SCRATCH, 'profile-m2'), prepare: noGh, env: BASE_ENV({ MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config, MAWS_CLAUDE_USAGE_DIR: usage, PATH: NO_GH_PATH }) });
  const { page } = maws;
  try {
    await size(maws);
    await light(page);
    // Each disk session is found by its engine id as the index lists it; one the index has not listed within the wait
    // fails only the scenes that open it, each recorded as not reached with its fixture named.
    const ids: Record<string, string> = {};
    await expect.poll(async () => {
      const { sessions } = value(await invoke(page, 'session.list', {}));
      M2_DISK.forEach((d, i) => (ids[d.key] = sessions.find((s) => s.engineSessionId === m2DiskId(i))?.appId ?? ''));
      return M2_DISK.every((d) => ids[d.key]);
    }, { timeout: 30_000 }).toBe(true).catch((error: unknown) => setupFailed(`the disk sessions’ index (${M2_DISK.filter((d) => !ids[d.key]).map((d) => d.file).join(', ')} not listed)`, error));
    await dismissToasts(page);
    // a session opened with its turns and runs opened, the build read from its message box
    const opened = async (key: string) => {
      if (!ids[key]) throw new Error(`the disk session of ${M2_DISK.find((d) => d.key === key)!.file} was not listed by the index`);
      await openSession(page, ids[key]!);
      await m2Build(page);
      await expect(pane(page).locator('.transcript-row[data-kind]').first()).toBeVisible({ timeout: 20_000 });
      await unfoldAll(page);
    };
    const meta = (id: string, key: string, title: string, how: string, state: string, folders: string[], hover?: true) =>
      m2({ id, title, how: `The session “${M2_DISK.find((d) => d.key === key)!.title}” (${M2_DISK.find((d) => d.key === key)!.state.toLowerCase()}), every turn and run opened; ${how}`, state, folders, ...(hover && { hover }) });

    // T42: the steer stands where the engine took it, with no caption of its own; master captions it (User.tsx: the
    // row's `data-steer`, and master's `.transcript-user-caption`, "Sent during this turn")
    const steer = () => pane(page).locator('section.transcript-user[data-steer]').first();
    await shot(page, meta('m2-disk-steer', 'steer', 'A message the engine took mid-turn', 'scrolled to the steer', 'The steer between two of the turn’s calls, with no line saying when it was sent', ['transcript', 'transcript/view']), async () => {
      await opened('steer');
      await seek(page, steer());
    }, {
      // the steer in view; on M2's build with no caption (User.tsx: the main pane's mount gives a taken steer none), on
      // master's with its caption
      check: async () => {
        await inView(steer(), 'the steer');
        if (m2Cut()) await expect(steer().locator('.transcript-user-caption'), 'no caption on the steer').toHaveCount(0);
        else await inView(steer().locator('.transcript-user-caption'), 'master’s caption on the steer');
      },
    });

    // T97: a cancelled ask's chip reads Cancelled, why its tooltip (rows/AskCapsule.tsx: the chip takes the keyboard for
    // it); master's chip says why at rest
    const cancelled = () => pane(page).locator('section.transcript-ask[data-ask-state="cancelled"]').first();
    const askChip = () => cancelled().locator('[data-ask-chip]').first();
    await shot(page, meta('m2-ask-cancelled-tip', 'askcut', 'An ask the interrupt withdrew, its chip holding the keyboard', 'Tab to the ask’s Cancelled', 'The ask’s questions, its chip Cancelled focused, why it was cancelled the tooltip', ['transcript/view', 'tools/maws/ask', 'ui']), async () => {
      await opened('askcut');
      await seek(page, cancelled());
      await letGo(page);
      await focusTip(page, askChip(), askChip(), m2Cut);
    }, { check: tipShown(page, askChip(), 'the cancelled ask’s chip', askChip(), m2Cut) });
    await letGo(page);

    // T81, T82: the listing folded to its count (ui/counted-fold.tsx's `data-counted-fold`, its line a disclosure);
    // master draws the sections open at rest, under the self line
    const listing = () => pane(page).locator('.transcript-listing').first();
    const foldLine = () => pane(page).locator('.transcript-listing[data-counted-fold] > button').first();
    const sections = () => listing().locator('.transcript-listing-section');
    await shot(page, meta('m2-listing-folded', 'listing', 'An agents listing, folded to its count', 'scrolled to the listing', 'The listing one line with its count, folded', ['transcript/view', 'ui']), async () => {
      await opened('listing');
      await seek(page, listing());
      if (m2Cut() && (await foldLine().getAttribute('aria-expanded')) === 'true') await foldLine().click(); // a retry finds it open
    }, {
      check: async () => {
        if (!m2Cut()) return inView(sections(), 'master’s listing, its sections at rest');
        await inView(foldLine(), 'the listing’s line');
        await expect(foldLine(), 'the listing folded').toHaveAttribute('aria-expanded', 'false', { timeout: 3_000 });
      },
    });
    // T81, T84: the listing opened in place, the pointer on its one entry: its Message drawn (master draws it at rest)
    const entry = () => listing().locator('.transcript-listing-entry').first();
    await shot(page, meta('m2-listing-open', 'listing', 'An agents listing opened, the pointer on an entry', 'press the listing’s line, then hover its entry', 'The listing open in place under its line: its section, the peer session with its Message', ['transcript/view', 'ui'], true), async () => {
      await opened('listing');
      await seek(page, listing());
      if (m2Cut() && (await foldLine().getAttribute('aria-expanded')) !== 'true') await foldLine().click();
      await expect(entry()).toBeVisible({ timeout: 5_000 });
      await page.mouse.move(W - 2, H - 2);
      await entry().hover();
      await page.waitForTimeout(1200);
    }, {
      check: checks(
        async () => {
          if (m2Cut()) await expect(foldLine(), 'the listing open').toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 });
        },
        () => inView(sections(), 'its section'),
        pointedAt(entry(), 'the listing’s entry'),
        drawn(entry().locator('button.transcript-peer-toggle'), 'the entry’s Message'),
      ),
    });

    // T75, T76: another session's message, its Reply pressed: the reply box open under the line, with no label over it
    // (rows/AgentMessage.tsx: the line's `data-peer`, the row's `data-replying` while the box is open, on both builds)
    const inbound = () => pane(page).locator('.transcript-peer[data-peer="inbound"]').first();
    const reply = () => inbound().locator('button.transcript-peer-reply').first();
    await shot(page, meta('m2-peer-reply-open', 'listing', 'A message from another session, its Reply pressed', 'point at the message from the other session, then press its Reply', 'The reply box open under the message, nothing typed', ['transcript/view', 'transcript/view/rows']), async () => {
      await opened('listing');
      await seek(page, inbound());
      await inbound().hover();
      await page.waitForTimeout(600);
      if ((await inbound().getAttribute('data-replying')) === null) await reply().click();
      await expect(inbound()).toHaveAttribute('data-replying', '', { timeout: 5_000 });
    }, {
      // the reply box open and empty under the message (rows/PeerComposer.tsx's textarea, on both builds); on M2's build
      // with no label over it (T76), on master's under its label
      check: async () => {
        const field = inbound().locator('textarea').first();
        await inView(field, 'the reply box');
        await expect(field, 'nothing typed').toHaveValue('');
        if (m2Cut()) await expect(inbound().locator('.transcript-peer-label'), 'no label over the reply box').toHaveCount(0);
        else await inView(inbound().locator('.transcript-peer-label'), 'master’s label over the reply box');
      },
      after: async () => {
        if ((await inbound().getAttribute('data-replying').catch(() => null)) !== null) await reply().click();
      },
    });

    // T68, T70: the notices of a scheduled fire and of the bridge's wake (rows/Notice.tsx, `data-class`, on both builds)
    for (const [key, kind, id, title, state] of [
      ['cron', 'schedule', 'm2-disk-cron', 'A scheduled job’s fires', 'Each fire’s line naming the job’s prompt, and the turn it opened'],
      ['wake', 'wake', 'm2-disk-wake', 'The bridge waking a session', 'The wake’s line in the turn it opened, after the grant the person sent'],
    ] as const) {
      const notice = () => pane(page).locator(`.transcript-notice[data-class="${kind}"]`).first();
      await shot(page, meta(id, key, title, `scrolled to the first ${kind === 'schedule' ? 'fire' : 'wake'}`, state, ['transcript', 'transcript/view']), async () => {
        await opened(key);
        await seek(page, notice());
      }, { check: () => inView(notice(), `the ${kind} notice`) });
    }
    await reset(page);

    // P555: a new chat's model list has no line under it. Here, not in the scenario's launch, whose New chat mints an id
    // with no setup intent (app/scenario-session-creator.ts), so its model menu has no unstarted binding to show: this
    // launch's New chat is `session.create`, which writes the intent (sessions/connect.ts). The new chat is the one intent
    // New chat added, and the tab shown is its (the pane's message box names its session, `data-composer`, on both
    // builds); the model view as launch 1's scenes find it (widgets/ModelSelector.tsx: `data-effort-title` inside the
    // button that names the model, `data-model-selector` the view shown, on both builds). Last in the launch, so the
    // empty chat it leaves open is in no other scene.
    const intents = async () => value(await invoke(page, 'session.intent.list', undefined)).intents.map((intent) => intent.appSessionId as string);
    let before: Set<string> | null = null; // read once, by the first attempt: a retry's New chat reuses its empty chat (U13a)
    let chat: string | null = null;
    const newChat = () => pane(page).locator(`[data-composer="${chat}"]`);
    const selector = () => page.locator('[data-model-selector]').first();
    const modelView = () => page.locator('[data-model-selector="model"]').first();
    await shot(page, m2({ id: 'm2-new-chat-model-view', title: 'New chat, the model menu’s list of models', how: 'A session in front, File › New chat (⌘N), the model chip under the message box, then the model’s name at the menu’s top', state: 'The models of a chat not started yet, Default checked, with no line under the list', folders: ['widgets', 'composer/frame', 'composer'] }), async () => {
      await opened('steer');
      await reset(page);
      const known = (before ??= new Set(await intents()));
      await menu(maws.app, 'session.new');
      await expect.poll(async () => {
        const made = (await intents()).find((id) => !known.has(id));
        chat = made === undefined ? null : await addressed(page, made);
        return chat;
      }, { message: 'New chat’s setup intent', timeout: 10_000 }).not.toBeNull();
      await expect(newChat(), 'the new chat’s tab shown').toBeVisible({ timeout: 10_000 });
      await newChat().locator('[role="toolbar"] button[aria-haspopup="dialog"]:not([data-context-ring])').last().click();
      await expect(selector()).toBeVisible({ timeout: 10_000 });
      if ((await selector().getAttribute('data-model-selector')) !== 'model') await selector().locator('button:has([data-effort-title])').first().click();
    }, {
      check: async () => {
        await expect(newChat(), 'the new chat’s tab shown').toBeVisible({ timeout: 3_000 });
        await expect(modelView(), 'the model view').toBeVisible({ timeout: 3_000 });
        await expect(modelView().getByRole('menu').first(), 'its list').toBeVisible();
        // Default, the list's first row, checked (ModelSelector.tsx: the menu's own first menuitemradio, on both builds)
        await expect(modelView().locator('[role="menu"] > [role="menuitemradio"]').first(), 'Default checked').toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });
        const line = modelView().getByText(MASTER_MODEL_UNSTARTED, { exact: true });
        if (m2Cut()) await expect(line, 'no line under a new chat’s list').toHaveCount(0);
        else await inView(line, 'master’s line under a new chat’s list');
      },
      after: () => closeOverlays(page),
    });
    await reset(page);
  } finally {
    await maws.cleanup();
  }
});

// ======================================================================================================================
// Launch 11: the word cut's M3, the panels beside the conversation. Two sessions the engine store lists, never started:
// one on a repository with M3's git and file states (`panels`: a tracked binary changed, a merge commit and an empty
// commit unpushed, a symbolic link, untracked folders, a 5 MB log), one on a quiet repository (nothing changed, no
// remote). The browser's scratch server, and the Chrome import's seams over the synthetic Chrome profile (launch 6's).
// Its own launch, so every earlier launch's fixtures stay as they were.
// ======================================================================================================================
test('the word cut’s M3: Review, Source control, Files, the browser and its import, the surfaces’ menus and names', async () => {
  test.setTimeout(1_200_000);
  const panels = makeRepo('panels', 'panels');
  const quiet = quietRepo('quiet');
  const config = join(SCRATCH, 'claude-config-m3');
  rmSync(config, { recursive: true, force: true });
  const engineIds = { panels: '0e5f6a7b-0000-4000-8000-000000000501', quiet: '0e5f6a7b-0000-4000-8000-000000000502' };
  seedSession(config, panels, engineIds.panels, 'Tidy the panels', '2026-09-29T12:00:00.000Z');
  seedSession(config, quiet, engineIds.quiet, 'A quiet tree', '2026-09-29T12:01:00.000Z');
  trust(config);
  const usage = usageFixture();
  const server = await startBrowserServer();
  const chrome = buildChromeUserData(join(SCRATCH, 'chrome-m3'));
  const userData = join(SCRATCH, 'profile-m3');
  mkdirSync(userData, { recursive: true });
  const maws = await launchMaws({
    userData,
    prepare: noGh,
    env: BASE_ENV({ MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config, MAWS_CLAUDE_USAGE_DIR: usage, PATH: NO_GH_PATH, MAWS_E2E_CHROME_USER_DATA: chrome.dir, MAWS_E2E_KEYCHAIN: `file:${chrome.passwordFile}` }),
  });
  const { app, page } = maws;
  try {
    await size(maws);
    await light(page);
    await m3Build(page).catch((error: unknown) => setupFailed('reading the build', error)); // the stylesheet is the window's from its start
    const ids: Record<string, string> = {};
    await expect.poll(async () => {
      const { sessions } = value(await invoke(page, 'session.list', {}));
      for (const [key, id] of Object.entries(engineIds)) ids[key] = sessions.find((s) => s.engineSessionId === id)?.appId ?? '';
      return Object.values(ids).every(Boolean);
    }, { timeout: 30_000 }).toBe(true).catch((error: unknown) => setupFailed('the two sessions’ index', error));
    await dismissToasts(page);
    // a session in front, the build read
    const opened = async (key: 'panels' | 'quiet') => {
      if (!ids[key]) throw new Error(`the ${key} session was not listed by the index`);
      await openSession(page, ids[key]!);
      await m3Build(page);
    };
    const review = () => surface(page, 'review');
    const scm = () => surface(page, 'source-control');
    const files = () => surface(page, 'files');
    const browser = () => surface(page, 'browser');
    // each scene's folders by its id's family, the first prefix that matches
    const FOLDERS: [string, string[]][] = [
      ['m3-cards-', ['panel', 'panel/summary']],
      ['m3-session-info-', ['tools/session-info', 'tools/browser', 'panel']],
      ['m3-review-', ['tools/code/review', 'panel']],
      ['m3-scm-', ['tools/scm', 'panel']],
      ['m3-file', ['tools/code/files', 'tools/code/viewer', 'tools/code/editor', 'panel']],
      ['m3-surface-', ['panel', 'ui']],
      ['m3-tab-', ['panel', 'ui']],
      ['m3-artifacts-', ['tools/artifacts', 'panel', 'ui']],
      ['m3-questions-', ['tools/maws/ask', 'panel']],
      ['m3-side-', ['side', 'panel']],
      ['m3-palette-', ['palette', 'src/shared/keymap']],
      ['m3-settings-browser-', ['settings-tab', 'tools/browser/import']],
      ['m3-settings-', ['settings-tab', 'src/shared/keymap']],
      ['m3-shortcuts-', ['keymap', 'src/shared/keymap']],
      ['m3-browser-', ['tools/browser', 'tools/browser/chrome']],
      ['m3-import-', ['tools/browser/import', 'settings-tab']],
    ];
    const meta = (id: string, rows: string, title: string, how: string, state: string) => m3({ id, title, how, state: `${state} (${rows})`, folders: FOLDERS.find(([prefix]) => id.startsWith(prefix))![1] });

    // ---- the session cards of a session never started (P52, P62): nothing reported, each card open
    await shot(page, meta('m3-cards-not-reported', 'P52, P62', 'Session cards of a session that has reported nothing', 'Open a session the engine store lists and nothing has started, then each card', 'Environment, Context and Connectors open, Context and Connectors with nothing reported'), async () => {
      await opened('quiet');
      await unfoldCards(page);
    }, {
      check: async () => {
        await inView(cards(page), 'the session cards');
        await expect(cards(page).locator('section > h3 > button[aria-expanded="false"]'), 'every card open').toHaveCount(0, { timeout: 3_000 });
      },
    });

    // ---- Session info before any browser page is loaded (T540): on M3 no Browser tabs row (tools/session-info/model.ts
    // `browserTabsRow`); master's row reads No tabs loaded. Its label is the browser copy's, the same on both builds.
    const info = () => surface(page, 'session-info');
    const browserRow = () => info().getByText(BROWSER_COPY.sessionInfoLabel, { exact: true });
    // On M3 each group is folded to its head, Permissions and Usage open (session-info/SessionInfoView.tsx, T252), and the
    // Browser tabs row is in Engine, mounted only while it is open: its head pressed open (fix wave, scalpel-5#4). Master
    // draws every row at rest.
    const engineHead = () => info().locator(`[data-info-group="${M3_WORDS.engine}"] h4 button[aria-expanded]`).first();
    const engineOpen = async () => {
      if (!m3Cut()) return;
      if ((await engineHead().getAttribute('aria-expanded')) === 'false') await engineHead().click();
      await expect(engineHead(), 'the Engine group open').toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 });
      await page.waitForTimeout(400);
    };
    await shot(page, meta('m3-session-info-no-pages', 'T540', 'Session info with no browser page loaded', 'The quiet session, View › More surfaces › Session info, before any browser tab opened; on M3 its Engine group opened', 'Session info’s rows, Engine’s with no Browser tabs row on M3 (master: No tabs loaded)'), async () => {
      await opened('quiet');
      await sideSurface(app, page, 'session-info');
      await engineOpen();
    }, {
      check: async () => {
        await inView(info().locator('[data-session-info]'), 'Session info');
        if (m3Cut()) await expect(engineHead(), 'the Engine group open').toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 });
        if (m3Cut()) await expect(browserRow(), 'no Browser tabs row').toHaveCount(0);
        else await inView(browserRow(), 'master’s Browser tabs row');
      },
    });
    await reset(page);

    // ---- the quiet repository: Review's empty scope (T362) and Source control with no base (N62)
    await shot(page, meta('m3-review-empty', 'T362', 'Review of a clean working tree', 'The quiet session, View › Review (⌘⇧D)', 'The Uncommitted scope with no change: its one line'), async () => {
      await opened('quiet');
      await sideSurface(app, page, 'review');
    }, { check: () => inView(review().locator('[data-review-empty]'), 'the empty scope’s line') });
    // master's heading names the branch the commits are counted on (master's tools/scm/copy.ts `latestOn`, which M3 removed)
    const commitsHeading = () => scm().locator('[data-scm-commits-heading]').first();
    await shot(page, meta('m3-scm-no-base', 'N62', 'Source control with no base to count from', 'The quiet session, View › More surfaces › Source control', 'On main with no remote and no default branch: the Commits heading’s “· latest”'), async () => {
      await opened('quiet');
      await sideSurface(app, page, 'source-control');
    }, {
      check: async () => {
        await inView(commitsHeading(), 'the Commits heading');
        // the loaded heading (fix wave, scalpel-5#5): the bare heading of the pending and the failed reads holds no "latest"
        if (m3Cut()) await expect(commitsHeading(), 'the loaded heading’s “· latest”').toContainText(M3_WORDS.latest, { timeout: 3_000 });
        if (m3Cut()) await expect(commitsHeading(), 'no branch after “latest”').not.toContainText('latest on', { timeout: 3_000 });
        else await expect(commitsHeading(), 'master’s heading naming the branch').toContainText('latest on main', { timeout: 3_000 });
      },
    });

    // ---- the panels repository in Review: an untracked folder (T361), a tracked binary changed (N44)
    const section = (path: string) => review().locator(`section[data-review-file="${path}"]`).first();
    const toSection = async (path: string) => {
      await opened('panels');
      await sideSurface(app, page, 'review');
      await expect(review().locator('[data-review-file]').first(), 'the review stack').toBeAttached({ timeout: 15_000 });
      await section(path).scrollIntoViewIfNeeded({ timeout: 10_000 });
      await page.waitForTimeout(800);
    };
    const untrackedFolder = () => review().locator('section[data-review-file^="notes"] [data-review-note]').first();
    await shot(page, meta('m3-review-untracked-folder', 'T361', 'Review, an untracked folder', 'The panels session, View › Review, scrolled to the notes/ folder', 'The untracked folder’s section and its one line in place of a diff'), async () => {
      await toSection('notes/');
    }, { check: () => inView(untrackedFolder(), 'the untracked folder’s line') });
    await shot(page, meta('m3-review-binary', 'N44', 'Review, a changed binary file', 'The panels session, View › Review, scrolled to assets/sprite.dat', 'The binary’s section: its header, and nothing under it on M3 (master: “Binary file”)'), async () => {
      await toSection('assets/sprite.dat');
    }, {
      check: async () => {
        await inView(section('assets/sprite.dat'), 'the binary’s section');
        await expect(section('assets/sprite.dat'), 'a binary diff').toHaveAttribute('data-kind', 'binary', { timeout: 3_000 });
        const body = section('assets/sprite.dat').getByText(M3_WORDS.binaryFile, { exact: true });
        if (m3Cut()) await expect(body, 'no body under the header').toHaveCount(0);
        else await inView(body, 'master’s Binary file');
      },
    });

    // ---- commits opened in Review from Source control (m0-scm-commit-review's way): a merge commit (N52), an empty one (N40)
    const commitChip = () => review().locator('[data-chip="commit"]').first();
    const openCommit = async (subject: string) => {
      await opened('panels');
      await sideSurface(app, page, 'source-control');
      const commit = scm().locator('button[data-scm-commit]').filter({ hasText: subject }).first();
      await commit.scrollIntoViewIfNeeded({ timeout: 10_000 });
      await commit.focus();
      await page.keyboard.press('Enter');
      await expect(review().locator('[data-chip="commit"][aria-pressed="true"]').first(), 'the Commit scope').toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(800);
    };
    await shot(page, meta('m3-review-merge-commit', 'N52', 'A merge commit opened in Review, its chip holding the keyboard', 'The panels session, Source control, focus the merge commit and press Enter; then Tab to the commit’s chip', 'The merge commit’s diff against its first parent; on M3 the chip’s tooltip with its subject (master: the foot line)'), async () => {
      await openCommit('Merge the side note');
      if (m3Cut()) {
        await letGo(page);
        await commitChip().focus();
      }
    }, { check: tip3(page, commitChip(), 'the commit’s chip', review().locator('[data-review-footer]')) });
    await letGo(page);
    await shot(page, meta('m3-review-empty-commit', 'N40', 'An empty commit opened in Review', 'The panels session, Source control, focus the empty commit and press Enter', 'The commit that changed nothing: its one line'), async () => {
      await openCommit('Mark the release');
    }, { check: () => inView(review().locator('[data-review-empty]'), 'the empty commit’s line') });

    // ---- Files: a symbolic link (T316), a binary (T328), a file past the viewer's cap (T322), the find bar (T336), unsaved
    // edits (T338), the disk's copy changed under them (T341, T342)
    const item = (path: string) => treeItem(page, path);
    const unfolded = async (path: string) => {
      if ((await item(path).getAttribute('aria-expanded', { timeout: 10_000 }).catch(() => null)) === 'false') await item(path).click();
      await page.waitForTimeout(400);
    };
    const filesAt = async (...folders: string[]) => {
      await opened('panels');
      await sideSurface(app, page, 'files');
      await filesTree(page);
      const root = files().locator('[role="treeitem"][data-kind="root"]').first();
      if ((await root.getAttribute('aria-expanded').catch(() => null)) === 'false') await root.click();
      for (const folder of folders) await unfolded(join(panels, folder));
    };
    const viewer = (path: string) => page.locator(`[data-region="panel"] [data-file-viewer][data-path="${join(panels, path)}"]`).first();
    const openFile = async (folder: string | null, path: string) => {
      await filesAt(...(folder === null ? [] : [folder]));
      await item(join(panels, path)).click();
      await expect(viewer(path), `${path} in the viewer`).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(800);
    };
    await shot(page, meta('m3-files-symlink', 'T316', 'Files, a symbolic link', 'The panels session, View › Files, the docs folder opened', 'The link’s row: its arrow and target (master: “Symbolic link →” before them)'), async () => {
      await filesAt('docs');
    }, { check: () => inView(item(join(panels, 'docs/readme-link.md')), 'the link’s row') });
    await shot(page, meta('m3-file-binary', 'T328', 'A binary file opened from Files', 'The panels session, Files, assets/sprite.dat', 'The viewer’s one line for a file it does not draw: its kind and its size'), async () => {
      await openFile('assets', 'assets/sprite.dat');
    }, { check: () => inView(viewer('assets/sprite.dat').locator('[data-external-row]'), 'the binary’s row') });
    await shot(page, meta('m3-file-head', 'T322', 'A file past the viewer’s cap opened from Files', 'The panels session, Files, logs/build.log (5.6 MB)', 'The first part of the log, the bar’s notice its two sizes beside Load more'), async () => {
      await openFile('logs', 'logs/build.log');
    }, { check: () => inView(viewer('logs/build.log').locator('[data-notice]'), 'the bar’s notice') });
    const code = (path: string) => viewer(path).locator('.cm-content').first();
    await shot(page, meta('m3-file-find', 'T336', 'The find bar over a code file', 'The panels session, Files, src/sidebar.ts; click into the code, ⌘F, type “row”', 'The find bar with its controls (glyphs on M3, the editor library’s words on master)'), async () => {
      await openFile('src', 'src/sidebar.ts');
      await code('src/sidebar.ts').click();
      await page.keyboard.press('Meta+f');
      await expect(viewer('src/sidebar.ts').locator('.cm-search').first(), 'the find bar').toBeVisible({ timeout: 5_000 });
      await page.keyboard.type('row');
    }, { check: () => inView(viewer('src/sidebar.ts').locator('.cm-search'), 'the find bar'), after: () => closeOverlays(page) });
    await page.keyboard.press('Escape').catch(() => undefined);
    // an edit of the untracked notes file, never saved: the disk's copy is changed under it, then Reload takes the disk's
    // Each of the three scenes sets up what it needs itself (idempotent), so any one of them runs alone under WORDS_ONLY.
    const save = () => viewer('src/notes.md').locator('[data-editor-controls]').getByRole('button', { name: M3_WORDS.save, exact: true });
    const theirs = () => viewer('src/notes.md').locator('[data-theirs-notice]').first();
    const changes = () => viewer('src/notes.md').locator('[data-merge-changes]').first();
    let edited = false; // the notes file holds an unsaved edit (cleared when the compare scene reloads the disk's copy)
    const editedNotes = async () => {
      if (!(await viewer('src/notes.md').isVisible().catch(() => false))) await openFile('src', 'src/notes.md');
      // a markdown file opens rendered and is edited only in its Source view (viewer/FileViewer.tsx's toggle)
      if ((await code('src/notes.md').count()) === 0) await viewer('src/notes.md').getByRole('button', { name: M3_WORDS.source, exact: true }).first().click();
      if (!edited) {
        await code('src/notes.md').click();
        await page.keyboard.press('Meta+ArrowDown');
        await page.keyboard.type('And the drop keeps its place.');
        edited = true;
      }
      await expect(save(), 'Save').toBeVisible({ timeout: 5_000 });
    };
    const diskChanged = async () => {
      await editedNotes();
      // the one marker of the disk's change: editor/EditorControls.tsx draws it in the notice and in the merge view alike
      // (`data-theirs-notice` "notice" or "merge")
      if ((await theirs().count()) === 0) writeFileSync(join(panels, 'src/notes.md'), 'Drag keeps the row under the pointer.\nThe list scrolls with it.\nNothing jumps.\n');
      await expect(theirs(), 'the disk’s notice').toBeVisible({ timeout: 15_000 });
    };
    await shot(page, meta('m3-file-unsaved', 'T338', 'A file with unsaved edits, Save holding the keyboard', 'The panels session, Files, src/notes.md in its Source view; type at its end, then Tab to Save', 'Save focused; on M3 its chord the tooltip (master: a system title, not drawn)'), async () => {
      await editedNotes();
      await letGo(page);
      await save().focus();
    }, { check: tip3(page, save(), 'Save', save()) });
    await letGo(page);
    await shot(page, meta('m3-file-disk-changed', 'T341', 'Unsaved edits whose file changed on disk', 'The same file, its copy on disk rewritten', 'The bar’s notice that the disk changed, with Reload, Keep mine and Compare'), diskChanged, {
      check: async () => {
        await inView(theirs(), 'the disk’s notice');
        await expect(theirs(), 'the notice, not the merge view').toHaveAttribute('data-theirs-notice', 'notice', { timeout: 3_000 });
      },
    });
    await shot(page, meta('m3-file-disk-compare', 'T342', 'Unsaved edits compared with the disk’s copy', 'The same file, Compare', 'The merge view, the count of changes beside its arrows'), async () => {
      await diskChanged();
      if ((await theirs().getAttribute('data-theirs-notice')) !== 'merge') await viewer('src/notes.md').locator('[data-editor-controls]').getByRole('button', { name: M3_WORDS.compare, exact: true }).click();
      await expect(changes(), 'the count of changes').toBeVisible({ timeout: 10_000 });
    }, {
      check: async () => {
        await expect(theirs(), 'the merge view').toHaveAttribute('data-theirs-notice', 'merge', { timeout: 3_000 });
        await inView(changes(), 'the count of changes');
      },
      // Reload takes the disk's copy, so no unsaved edit is left to hold the app's quit
      after: async () => {
        const reload = viewer('src/notes.md').locator('[data-editor-controls]').getByRole('button', { name: M3_WORDS.reload, exact: true });
        if (await reload.count()) {
          await reload.click();
          edited = false;
        }
      },
    });
    await reset(page);

    // ---- the surfaces' icons and tabs: an open surface's menu (P8), a closed one's (P9), a tab's pin glyph (P11). Pin tab
    // and the pin glyph act on a Files tab that holds no file, the tree alone (panel/SurfaceRow.tsx, files/tabs.ts
    // `pinnableTab`), and a file opened beside the chat takes the session's tree-only tab (files/tabs.ts `placeOpen`), so
    // the panels session, whose Files tabs the scenes above filled, has none: these two are the quiet session's, whose
    // Files no scene opened a file in
    const icon = (title: string) => page.locator(`[data-surface-row] button[aria-label="${title}"]`).first();
    const contextMenu = () => page.getByRole('menu').first();
    await shot(page, meta('m3-surface-icon-menu', 'P8', 'An open surface’s icon, right-clicked', 'The quiet session with Files open; right-click the Files icon in the header', 'The icon’s menu: Pin tab and Hide surface (master: Keep open for every session)'), async () => {
      await opened('quiet');
      await sideSurface(app, page, 'files');
      await icon('Files').click({ button: 'right' });
      await expect(contextMenu(), 'the icon’s menu').toBeVisible({ timeout: 5_000 });
    }, {
      check: async () => {
        await inView(contextMenu(), 'the icon’s menu');
        const pin = byM3(M3_WORDS.pinTab);
        await inView(contextMenu().getByRole('menuitem', { name: pin, exact: true }), pin);
      },
      after: () => closeOverlays(page),
    });
    await shot(page, meta('m3-surface-icon-menu-closed', 'P9', 'A closed surface’s icon, right-clicked', 'The panels session; right-click the Terminal icon, its surface never opened', 'On M3 no menu (a press opens it); master: its menu with Open surface'), async () => {
      await opened('panels');
      await icon('Terminal').click({ button: 'right' });
      await page.waitForTimeout(800);
    }, {
      check: async () => {
        await inView(icon('Terminal'), 'the Terminal icon');
        if (m3Cut()) await expect(page.getByRole('menu'), 'no menu').toHaveCount(0);
        else await inView(contextMenu().getByRole('menuitem', { name: M3_WORDS.openSurface, exact: true }), 'master’s Open surface');
      },
      after: () => closeOverlays(page),
    });
    // the Files tab's own pin glyph (fix wave, scalpel-5#6), named "Pin <the tab's title>" (panel/copy.ts COPY.pin, both
    // builds), never another tab's: the quiet session's Review and Source control tabs carry one too
    const pinGlyph = () => page.locator('[data-region="panel"]:not([inert]) [data-side-strip] [data-tab-id] button[aria-label="Pin Files"]').first();
    await shot(page, meta('m3-tab-pin-tip', 'P11', 'A side tab’s pin glyph holding the keyboard', 'The quiet session with Files open; Tab to the Files tab’s pin glyph', 'The glyph focused; on M3 its verb the tooltip (master: a system title, not drawn)'), async () => {
      await opened('quiet');
      await sideSurface(app, page, 'files');
      await letGo(page);
      await pinGlyph().focus();
    }, { check: tip3(page, pinGlyph(), 'the pin glyph', pinGlyph()) });
    await letGo(page);

    // ---- surfaces opened from More surfaces: Artifacts with nothing made (T546) and with one open (T556), Questions with
    // no ask (T292), Side with no thread (P419)
    const fromMore = async (id: string, title: string) => {
      if (await surface(page, id).isVisible().catch(() => false)) return;
      await page.locator('[data-surface-row] button[aria-label="More surfaces"]').first().click();
      await page.getByRole('menu').first().getByRole('menuitem', { name: title, exact: true }).click();
      await expect(surface(page, id), title).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(800);
    };
    const artifacts = () => surface(page, 'artifacts');
    const scope = (n: number) => artifacts().locator('[data-artifacts-list] [role="group"] button').nth(n);
    await shot(page, meta('m3-artifacts-tab-empty', 'T546', 'The Artifacts tab of a session that made nothing', 'The panels session, More surfaces › Artifacts, This session', 'This session’s list empty: its one line'), async () => {
      await opened('panels');
      await fromMore('artifacts', M3_WORDS.artifacts);
      if ((await scope(0).getAttribute('aria-pressed')) !== 'true') await scope(0).click();
    }, {
      check: async () => {
        await inView(artifacts().locator('[data-artifacts-list]'), 'the list');
        await expect(scope(0), 'This session').toHaveAttribute('aria-pressed', 'true');
        await expect(artifacts().locator('[data-artifact-row]'), 'no artifact').toHaveCount(0);
      },
    });
    const back = () => artifacts().getByRole('button', { name: new RegExp(`^(${M3_WORDS.back.m3}|${M3_WORDS.back.master})$`) }).first(); // either build's
    let madeArtifact = false;
    await shot(page, meta('m3-artifacts-tab-open', 'T556', 'The Artifacts tab with an artifact open, Back holding the keyboard', 'The panels session, More surfaces › Artifacts, All, a document; Tab to Back', 'The record bar over the document; on M3 Back a chevron with its words the tooltip (master: the word Back)'), async () => {
      await opened('panels');
      if ((await back().count()) === 0) {
        if (!madeArtifact) {
          value(await invoke(page, 'artifacts.create', { kind: 'document', title: 'Launch notes' } as never));
          madeArtifact = true;
        }
        await fromMore('artifacts', M3_WORDS.artifacts);
        await scope(1).click();
        await artifacts().locator('[data-artifact-row]').first().click({ timeout: 15_000 });
      }
      await expect(back(), 'Back').toBeVisible({ timeout: 15_000 });
      await letGo(page);
      if (m3Cut()) await back().focus();
    }, { check: tip3(page, back(), 'Back', back()) });
    await letGo(page);
    await shot(page, meta('m3-questions-empty', 'T292', 'Questions with no open ask', 'The panels session, View › More surfaces › Questions', 'The panel’s empty state'), async () => {
      await opened('panels');
      await sideSurface(app, page, 'ask-sheet');
    }, {
      check: async () => {
        await inView(surface(page, 'ask-sheet').getByText(M3_WORDS.questionsRest, { exact: true }), 'the resting line');
        const detail = surface(page, 'ask-sheet').getByText(M3_WORDS.questionsDetail, { exact: true });
        if (m3Cut()) await expect(detail, 'no line under it').toHaveCount(0, { timeout: 3_000 });
        else await inView(detail, 'master’s line under it');
      },
    });
    await shot(page, meta('m3-side-empty', 'P419', 'Side with no side thread', 'The panels session, More surfaces › Side', 'The panel’s empty line'), async () => {
      await opened('panels');
      await fromMore('side', M3_WORDS.side);
    }, { check: () => inView(surface(page, 'side').getByText(byM3(M3_WORDS.sideEmpty), { exact: true }), 'the panel’s empty line') });
    await reset(page);

    // ---- the surfaces' names where the keymap's titles show them (N156, N157): the command palette, Settings › Keyboard,
    // Settings' search and the shortcuts window; View › More surfaces is the OS's menu bar, outside the window. Each title
    // is the checkout's own (shared/keymap/actions.ts): "Agents" and "Background" on M3, "Subagents" and "Background
    // tasks" on master.
    const titles = { agents: ACTIONS['surface.subagents'].title, background: ACTIONS['surface.background'].title };
    // the checkout's titles are its build's own: M3's on M3's build, master's on master's (an exact match, so "Agents" never
    // passes on "Subagents")
    const titlesHeld = () => {
      expect(titles.agents, 'the Agents surface’s title on this build').toBe(byM3(M3_WORDS.agentsTitle));
      expect(titles.background, 'the Background surface’s title on this build').toBe(byM3(M3_WORDS.backgroundTitle));
    };
    const titled = (words: string) => page.getByText(words, { exact: true });
    for (const [key, words] of Object.entries(titles)) {
      await shot(page, meta(`m3-palette-${key}`, key === 'agents' ? 'N156' : 'N157', `The command palette finding ${words}`, `Go › Command palette (⌘K), type “${words}”`, `The surface’s action among the results, under its title ${words}`), async () => {
        await opened('panels');
        await menu(app, 'palette.open');
        await expect(page.locator('[cmdk-root]').first()).toBeVisible({ timeout: 10_000 });
        await page.keyboard.type(words);
        await page.waitForTimeout(800);
      }, {
        check: async () => {
          titlesHeld();
          await inView(page.locator('[cmdk-item]').filter({ has: titled(words) }), `the action titled exactly ${words}`);
        },
        after: () => closeOverlays(page),
      });
    }
    const binding = (id: string) => page.locator(`[data-settings-dialog] [data-settings-binding="${id}"]`).first();
    await shot(page, meta('m3-settings-keyboard-surfaces', 'N156, N157', 'Settings › Keyboard, the surfaces’ rows', 'Settings (⌘,), Keyboard, scrolled to the surfaces', `The rows ${titles.agents} and ${titles.background} among the View actions`), async () => {
      await settingsAt(app, page, 'keyboard');
      await binding('surface.subagents').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
    }, {
      check: async () => {
        titlesHeld();
        for (const [id, words] of [['surface.subagents', titles.agents], ['surface.background', titles.background]] as const) {
          await inView(binding(id), words);
          await expect(binding(id), `the row named ${words}`).toHaveAttribute('aria-label', words, { timeout: 3_000 }); // KeymapSection's row, named by its title
          await expect(binding(id).getByText(words, { exact: true }).first(), `the row’s title ${words}`).toBeVisible({ timeout: 3_000 });
        }
      },
    });
    const searchField = () => page.locator('[data-settings-dialog] nav input[type="search"]');
    const results = () => page.locator('[data-settings-dialog] nav [role="listbox"] [role="option"]');
    for (const [key, words] of Object.entries(titles)) {
      await shot(page, meta(`m3-settings-search-${key}`, key === 'agents' ? 'N156' : 'N157', `Settings’ search finding ${words}`, `Settings (⌘,), type “${words}” in Search settings`, `The result for the surface’s key binding, titled ${words}`), async () => {
        await settingsAt(app, page, 'keyboard');
        await searchField().fill(words);
        await page.waitForTimeout(800);
      }, {
        check: async () => {
          titlesHeld();
          await inView(results().filter({ has: titled(words) }), `a result titled exactly ${words}`);
        },
        after: async () => void (await searchField().fill('').catch(() => undefined)),
      });
    }
    await reset(page);
    await shot(page, meta('m3-shortcuts-surfaces', 'N156, N157', 'The shortcuts window, the surfaces’ rows', 'Help › Keyboard shortcuts (⌘/), scrolled to the surfaces', `The rows ${titles.agents} and ${titles.background}`), async () => {
      await menu(app, 'shortcuts.open');
      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByText(titles.agents, { exact: true }).first().scrollIntoViewIfNeeded({ timeout: 5_000 });
      await page.waitForTimeout(400);
    }, {
      check: async () => {
        titlesHeld();
        const dialog = page.getByRole('dialog').first();
        await inView(dialog.getByText(titles.agents, { exact: true }), titles.agents);
        await inView(dialog.getByText(titles.background, { exact: true }), titles.background);
      },
    });
    await reset(page);

    // ---- the browser on a scratch page: the find count (T454, T455), the zoom (T452), the viewport chip (T441), and the
    // page cap's and a refused download's notices (T462, T463, T467), which only main's limits raise: sent to the window
    // as main sends them (emitToWindow), each in the scene's last step since a notice lasts four seconds
    let tabId: string | null = null;
    const browserTab = async () => {
      await opened('panels');
      await sideSurface(app, page, 'browser');
      if (tabId === null) tabId = (value(await invoke(page, 'browser.tabs.open', { appSessionId: ids.panels as never, url: server.url('/a.html'), select: true } as never)) as { tab: { tabId: string } }).tab.tabId;
      else value(await invoke(page, 'browser.tabs.select', { appSessionId: ids.panels as never, tabId: tabId as never }));
      await expect(browser().locator('[data-browser-nav]').first(), 'the tab’s address row').toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(2000);
    };
    const find = () => browser().locator('[data-browser-find]').first();
    const findFor = async (text: string) => {
      await browserTab();
      if (!(await find().isVisible().catch(() => false))) {
        // Browser options is itself the menu's trigger button (chrome/OverflowMenu.tsx), named the same on both builds
        await browser().getByRole('button', { name: BROWSER_COPY.options, exact: true }).first().click();
        await page.getByRole('menuitem', { name: BROWSER_COPY.menu.find, exact: true }).first().click();
        await expect(find(), 'the find row').toBeVisible({ timeout: 10_000 });
      }
      await find().locator('input').first().fill(text);
      await page.waitForTimeout(1000);
    };
    // the count as drawn: on M3 its numbers (aria-hidden, its words for a screen reader beside them), on master with "results"
    const findCounts = async (words: { m3: string; master: string }) => {
      const status = find().locator('[role="status"]');
      await inView(status, 'the count');
      await expect(m3Cut() ? status.locator('[aria-hidden]') : status, 'the count’s words').toHaveText(byM3(words), { timeout: 3_000 });
    };
    await shot(page, meta('m3-browser-find-count', 'T454', 'Browser, the find row with matches', 'A scratch page, the options menu’s Find, type “needle”', 'The count of the three matches beside the field (its numbers on M3, “results” after them on master)'), async () => {
      await findFor('needle');
    }, { check: () => findCounts(M3_WORDS.findCount) });
    await shot(page, meta('m3-browser-find-none', 'T455', 'Browser, the find row with no match', 'The same, type “zzqx”', 'The count of no match beside the field'), async () => {
      await findFor('zzqx');
    }, { check: () => findCounts(M3_WORDS.findNone), after: async () => void (await find().locator('input').first().press('Escape').catch(() => undefined)) });
    // `[data-browser-zoom]` is M3's chip itself (chrome/ZoomChip.tsx) and master's zoom row (chrome/ZoomBanner.tsx)
    const zoomed = () => browser().locator('[data-browser-zoom]').first();
    const zoomChip = zoomed;
    await shot(page, meta('m3-browser-zoom', 'T452', 'Browser, a page zoomed to 125%', 'A scratch page zoomed in twice; on M3 Tab to the zoom chip', 'On M3 the chip “125%” in the address row, Page zoom its tooltip; master: the zoom row under the address row'), async () => {
      await browserTab();
      for (let i = 0; i < 4; i++) {
        const { zoom } = value(await invoke(page, 'browser.tabs.zoom', { tabId: tabId as never, action: 'in' }));
        if (zoom >= 1.25) break;
      }
      await expect(zoomed(), 'the zoom’s place').toBeVisible({ timeout: 5_000 });
      await letGo(page);
      if (m3Cut()) await zoomChip().focus();
    }, { check: checks(tip3(page, zoomChip(), 'the zoom chip', zoomed()), () => expect(zoomed(), 'the level').toContainText('125%', { timeout: 3_000 })), after: async () => void (tabId && (await invoke(page, 'browser.tabs.zoom', { tabId: tabId as never, action: 'reset' }))) });
    await letGo(page);
    const viewportChip = () => browser().locator('[data-browser-viewport-chip]').first();
    await shot(page, meta('m3-browser-viewport', 'T441', 'Browser, a device size chosen, its chip holding the keyboard', 'A scratch page at 390 × 844; Tab to the viewport chip', 'The chip “390 × 844” focused; on M3 Viewport its tooltip (master: a system title, not drawn)'), async () => {
      await browserTab();
      value(await invoke(page, 'browser.tabs.setViewport', { tabId: tabId as never, viewport: { width: 390, height: 844 } }));
      await expect(viewportChip(), 'the viewport chip').toBeVisible({ timeout: 5_000 });
      await letGo(page);
      await viewportChip().focus();
    }, { check: tip3(page, viewportChip(), 'the viewport chip', viewportChip()), after: async () => void (tabId && (await invoke(page, 'browser.tabs.setViewport', { tabId: tabId as never, viewport: null }))) });
    await letGo(page);
    const notice = (kind: string) => browser().locator(`[data-browser-notice="${kind}"]`).first();
    for (const [id, rows, title, state, payload, line] of [
      ['m3-browser-cap-closed', 'T462', 'Browser, the page cap closed an extension’s options tab', 'The line main’s notice draws when the cap closes a tab it could not keep: on M3 “Closed: too many pages open”', { kind: 'tabsCap', count: 8 }, M3_WORDS.capClosed],
      ['m3-browser-cap-options', 'T463', 'Browser, the page cap refused an extension’s options', 'The line for an extension’s options the cap would not open', { kind: 'tabsCap', count: 8, name: 'uBlock Origin' }, M3_WORDS.capOptions],
      ['m3-browser-download-refused', 'T467', 'Browser, a download the agent started refused', 'The line for a download only the person may start', { kind: 'downloadRefusedAgent' }, M3_WORDS.downloadRefused],
    ] as const) {
      await shot(page, meta(id, rows, title, 'A scratch page; main’s notice sent to the window as main sends it', state), browserTab, {
        last: () => emitToWindow(app, 'browser.notice', { appSessionId: ids.panels, tabId: null, ...payload }),
        // the line itself, as this build words that notice: T462's and T463's are both a tabsCap notice
        check: async () => {
          await inView(notice(payload.kind), 'the notice');
          await expect(notice(payload.kind), 'the notice’s line').toContainText(byM3(line), { timeout: 3_000 });
        },
      });
    }
    await reset(page);

    // Session info once the browser holds a page (T539): the Browser tabs row, its count and memory (on M3 without
    // "outside the engine budget", which is its tooltip)
    // the row's value with a page loaded: "<n> loaded · <m> MB" (n at least 1); on M3 the budget words are the value's
    // tooltip, reached by focus (P162; session-info/SessionInfoView.tsx's Value), on master they end the value at rest
    const budget = 'outside the engine budget'; // tools/browser/copy.ts: M3's sessionInfoSource, the end of master's sessionInfo
    const loadedValue = () => (m3Cut() ? info().locator('span[tabindex="0"]').filter({ hasText: /^[1-9]\d* loaded( · \d+ MB)?$/ }) : info().getByText(new RegExp(`^[1-9]\\d* loaded( · \\d+ MB)? · ${budget}$`)));
    await shot(page, meta('m3-session-info-pages', 'T539, P162', 'Session info with browser pages loaded, its value holding the keyboard', 'The panels session after its browser tab loaded, View › More surfaces › Session info; on M3 open Engine, then Tab to the Browser tabs value', 'The Browser tabs row: the pages loaded and their memory; on M3 “outside the engine budget” its tooltip, master’s at the value’s end'), async () => {
      await browserTab(); // the scratch page loaded, whether or not an earlier scene opened it
      await sideSurface(app, page, 'session-info');
      await engineOpen();
      await expect(loadedValue().first(), 'a loaded page’s value').toBeVisible({ timeout: 15_000 });
      await loadedValue().first().scrollIntoViewIfNeeded();
      await letGo(page);
      if (m3Cut()) await loadedValue().first().focus();
    }, {
      check: async () => {
        await inView(browserRow(), 'the Browser tabs row');
        await inView(loadedValue(), 'a loaded page’s value');
        if (m3Cut()) {
          await focusIn(loadedValue(), 'the value')();
          await expect(page.getByRole('tooltip').first(), 'the value’s tooltip').toContainText(budget, { timeout: 3_000 });
        }
      },
    });
    await letGo(page);
    await reset(page);

    // ---- the Chrome import (launch 6's fixture): the consent step (T511, T516), the report (P388, P394, T533), Settings ›
    // Browser's extension rows with the same chip (P394), and the imported profile's popover (T478, T480, T483, T484, T486)
    const win = { maws, page };
    const sheet = () => sheetOf(win);
    // the import the report and the imported popover show: run once, by whichever of them comes
    // first (the report scene in a whole run; a later one alone under WORDS_ONLY), the sheet left on its report
    const importChoices = { history: false, cookies: false, bookmarks: true, extensions: true };
    const importedProfile = async () => {
      if ((profilesFile(userData)?.profiles.length ?? 0) > 0) return;
      await opened('panels');
      await importThrough(win, importChoices);
      await closeSheet(win);
      await closeSettings(win);
    };
    // An extension's chip as the import left it (tools/browser/import/Report.tsx's StatusChip, shared with Settings). The
    // chip of one switched on and not loaded yet ("On" on M3, P394; master's "On · loads when a tab next opens in this
    // profile") no launch of this rig draws: the import loads each extension it switches on at once
    // (main/browser/import/extensions-loader.ts, `importExtensions`), opening the profile's partition, and a switch turned
    // on in a partition opened this boot loads too (`setExtension`); only a later boot that has not opened the profile holds
    // an extension on and not loaded.
    const chip = (scope: Locator) => scope.locator('[data-extension-status]');
    await shot(page, meta('m3-import-consent', 'T511, T516', 'Import a Chrome profile, the categories', 'Settings › Browser, Import a Chrome profile…, Continue', 'The categories over the synthetic Chrome profile and its extensions (master adds a greyed passwords row and each extension’s chips)'), async () => {
      await opened('panels');
      if ((await sheet().getAttribute('data-browser-import').catch(() => null)) !== 'consent') {
        await openImportSheet(win);
        await sheet().getByRole('button', { name: 'Continue' }).click();
      }
      await expect(sheet()).toHaveAttribute('data-browser-import', 'consent', { timeout: 10_000 });
    }, {
      check: () => inView(sheet().locator('[data-category="extensions"]'), 'the extensions category'),
      after: async () => {
        await closeSheet(win);
        await closeSettings(win);
      },
    });
    await shot(page, meta('m3-import-report', 'P388, T533', 'Import a Chrome profile, the report', 'Settings › Browser, Import a Chrome profile…, bookmarks and extensions, Import', 'The finished report: its summary, the skipped lines under it, each extension’s chip as the import left it (loaded, or why not)'), async () => {
      if ((await sheet().getAttribute('data-browser-import').catch(() => null)) !== 'report') {
        if ((profilesFile(userData)?.profiles.length ?? 0) > 0) throw new Error('a profile is imported already: the report of a retried import is not this scene’s');
        await opened('panels');
        await importThrough(win, importChoices);
      }
    }, {
      check: async () => {
        await inView(sheet().locator('[data-import-summary]'), 'the report’s summary');
        await inView(chip(sheet()), 'an extension’s chip');
      },
      after: () => closeSheet(win).catch(() => undefined),
    });
    unreachable(meta('m3-settings-browser-extension-on', 'P394', 'Settings › Browser, an imported extension switched on', 'Settings (⌘,), Browser, scrolled to the imported profile’s extensions', 'The extension rows with the chip of one on and not loaded yet (“On” on M3)'), 'an extension on and not loaded yet needs a boot that has not opened its profile; this launch’s import opened it and loaded every extension it switched on');
    await closeSettings(win).catch(() => undefined);
    await reset(page);
    const popover = () => page.locator('[data-profile-popover]').first();
    await shot(page, meta('m3-browser-profile-imported', 'T478, T480, T483, T484, T486', 'Browser, the imported profile’s popover', 'A tab in the imported Chrome profile, its profile pill', 'The profile’s popover: its account, the other profiles, Sync bookmarks and Re-import'), async () => {
      await importedProfile();
      await opened('panels');
      await sideSurface(app, page, 'browser');
      const pill = async () => {
        await browser().locator('[data-browser-partition]').first().click();
        await expect(popover(), 'the profile popover').toBeVisible({ timeout: 5_000 });
      };
      value(await invoke(page, 'browser.tabs.open', { appSessionId: ids.panels as never, url: server.url('/b.html'), select: true } as never));
      await page.waitForTimeout(2000);
      await pill();
      if ((await popover().getAttribute('data-profile-popover')) !== 'profile') {
        // new tabs still open in Default: the imported profile's row sets them to it, then a new tab opens there
        await popover().locator('[data-profile-switch]').first().click();
        await closeOverlays(page);
        value(await invoke(page, 'browser.tabs.open', { appSessionId: ids.panels as never, url: server.url('/c.html'), select: true } as never));
        await page.waitForTimeout(2000);
        await pill();
      }
    }, {
      check: async () => {
        await expect(popover(), 'the imported profile’s popover').toHaveAttribute('data-profile-popover', 'profile', { timeout: 3_000 });
        await inView(popover().locator('[data-profile-sync]'), 'its Sync bookmarks');
      },
      after: () => closeOverlays(page),
    });
    await reset(page);
  } finally {
    await maws.cleanup();
    await server.close();
  }
});

// ======================================================================================================================
// Launch 12: the word cut's M3, the project Channel's folds (P447, P448), in a launch of its own: a harness build's main
// answers the channel from a file (e2e/support/words-channel.ts, a smaller seed of e2e/channel.spec.ts's) over C5's stub
// scenario, and the Channel tab opens from the project row's menu as a person opens it.
// ======================================================================================================================
test('the word cut’s M3: the project Channel’s folded runs', async () => {
  test.setTimeout(300_000);
  const metaOf = (id: string, rows: string, title: string, state: string) => m3({ id, title, how: 'A project of the org, its row’s menu, Channel (the seeded channel, offline)', state: `${state} (${rows})`, folders: ['channel'] });
  const ids = ['m3-channel-broadcast', 'm3-channel-exchange'];
  if (!ids.some(wanted)) return;
  const userData = join(SCRATCH, 'profile-m3-channel');
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(userData, { recursive: true });
  const fixture = join(userData, 'channel.json');
  writeFileSync(fixture, JSON.stringify(wordsChannel(Date.now())));
  const stub = join(userData, 'channel-scenario.json');
  writeFileSync(stub, JSON.stringify(wordsChannelScenario()));
  const harnessBuilt = existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
  const maws = await launchMaws({ userData, env: BASE_ENV({ [CHANNEL_FIXTURE_ENV]: fixture, MAWS_SESSION_SOURCE: `stub:${stub}` }) });
  const { page } = maws;
  try {
    await size(maws);
    await light(page);
    await m3Build(page).catch((error: unknown) => setupFailed('reading the build', error));
    await dismissToasts(page);
    const channel = () => page.locator(`[data-channel="${WORDS_CHANNEL_PROJECT}"]`);
    const opened = async () => {
      if (!harnessBuilt) throw new Error('the seeded channel needs the harness build’s main (scripts/e2e-build.sh harness)');
      await m3Build(page);
      if (await channel().isVisible().catch(() => false)) return;
      const row = page.locator(`[data-menu="project:${await addressed(page, WORDS_CHANNEL_PROJECT_ID)}"]`).first();
      await expect(row, 'the project’s row').toBeVisible({ timeout: 15_000 });
      await pointerAside(page);
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: CHANNEL.menuItem, exact: true }).click();
      await expect(channel(), 'the Channel tab').toBeVisible({ timeout: 15_000 });
    };
    const fold = (count: number) => channel().locator(`[data-channel-entry="exchange"][data-count="${count}"]`).getByRole('button').first();
    const { broadcast, exchange } = WORDS_CHANNEL_COUNTS;
    const lone = () => channel().locator('[data-channel-entry="say"]').filter({ hasText: 'The export moved' }).first();
    await shot(page, metaOf(ids[0]!, 'P447', 'The Channel, a session’s run to the whole project folded, and one message to everyone', `docs-writer’s ${broadcast} messages to everyone folded (on M3 “docs-writer · ${broadcast}”), and ledger-api’s one message to everyone after the exchange (on M3 with no “to everyone”)`), async () => {
      await opened();
      await fold(broadcast).scrollIntoViewIfNeeded({ timeout: 10_000 });
      await letGo(page);
    }, {
      check: async () => {
        await inView(fold(broadcast), 'the folded run');
        await expect(fold(broadcast), 'the run folded').toHaveAttribute('aria-expanded', 'false', { timeout: 3_000 });
        await expect(fold(broadcast), 'its sender').toContainText('docs-writer');
        await inView(lone(), 'the one message to everyone');
        await expect(lone(), 'its sender').toContainText('ledger-api');
        if (m3Cut()) {
          await expect(fold(broadcast).getByRole('img', { name: M3_WORDS.channelMessages(broadcast), exact: true }), 'the count, named').toHaveText(String(broadcast), { timeout: 3_000 });
          await expect(channel().getByText(M3_WORDS.toEveryone), 'no “to everyone”').toHaveCount(0, { timeout: 3_000 });
        } else {
          await expect(fold(broadcast), 'master’s fold').toContainText(M3_WORDS.channelFrom(broadcast), { timeout: 3_000 });
          await expect(fold(broadcast), 'master’s fold').toContainText(M3_WORDS.toEveryone);
          await expect(lone(), 'master’s message').toContainText(M3_WORDS.toEveryone);
        }
      },
    });
    await shot(page, metaOf(ids[1]!, 'P448', 'The Channel, an exchange between two sessions folded', `ledger-api’s and reconciler’s ${exchange} messages folded: on M3 “ledger-api and reconciler · ${exchange}”, master “${exchange} messages between ledger-api and reconciler”`), async () => {
      await opened();
      await fold(exchange).scrollIntoViewIfNeeded({ timeout: 10_000 });
      await letGo(page);
    }, {
      check: async () => {
        await inView(fold(exchange), 'the folded exchange');
        await expect(fold(exchange), 'the exchange folded').toHaveAttribute('aria-expanded', 'false', { timeout: 3_000 });
        for (const alias of ['ledger-api', 'reconciler']) await expect(fold(exchange), `its party ${alias}`).toContainText(alias);
        if (m3Cut()) {
          await expect(fold(exchange).getByRole('img', { name: M3_WORDS.channelMessages(exchange), exact: true }), 'the count, named').toHaveText(String(exchange), { timeout: 3_000 });
          await expect(fold(exchange), 'no count words before the names').not.toContainText(M3_WORDS.channelBetween(exchange));
        } else await expect(fold(exchange), 'master’s fold').toContainText(M3_WORDS.channelBetween(exchange), { timeout: 3_000 });
      },
    });
  } finally {
    await maws.cleanup();
  }
});

// ======================================================================================================================
// Launch 13 (board ticket 850, the report view repair): the to-human view of four recorded sessions, each drawn at rest
// by MAWS's mirror, and the first also started by MAWS. The scratch engine store holds the to-human plugin's style and an
// installation that declares it draws from 9 (test/support/to-human-plugin.ts, as the mod's 0.9.0 does), so the lane is
// on and a launch MAWS decides there carries what the build advertises: 9 on master (the mod draws; under the replay
// engine no mod runs, so the picture is what MAWS's window shows of a mod-drawn session), 8 from the repair (MAWS draws).
// Every text is invented. The sessions:
//   steer    a turn whose work a steer cut in two, the steer taken between two calls (a queued command, as the engine
//            keeps one), then the final message;
//   hidden   one turn of three messages, a lone search and a lone command between them: each call a standalone cell
//            the view hides behind its record line;
//   receipt  a finished turn, then a peer's message with sminos's receipt line before its frame opening a turn at idle;
//   task     a turn that started a background command, then the command's notification opening a turn at idle.
// Each scene opens its session afresh; the started session is stopped once its scene is taken.
const RV = { steer: 0, hidden: 1, receipt: 2, task: 3 } as const;
const rvDiskId = (i: number) => `0e5f6a7b-0000-4000-8000-0000000005${String(i).padStart(2, '0')}`;
function rvTranscript(i: number, repo: string): Record<string, unknown>[] {
  const engineId = rvDiskId(i);
  const rows: Record<string, unknown>[] = [];
  let parent: string | null = null;
  let n = 0;
  let clock = Date.UTC(2026, 10, 20, 9, 0, 0) + i * 3_600_000;
  const uuid = () => `a${i}000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const base = (type: string, id: string) => ({ type, uuid: id, parentUuid: parent, isSidechain: false, cwd: repo, sessionId: engineId, version: '2.1.322', timestamp: new Date((clock += 4_000)).toISOString(), userType: 'external', entrypoint: 'sdk-ts' });
  const add = (type: string, fields: Record<string, unknown>) => {
    const id = uuid();
    rows.push({ ...base(type, id), ...fields });
    parent = id;
    return id;
  };
  const prompt = (text: string) => add('user', { message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'sdk', turnOrigin: 'human' });
  const assistant = (content: unknown[], stop: string) => add('assistant', { message: { id: `msg_rv${i}${String(n).padStart(4, '0')}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content, stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } } });
  const thought = (text: string) => assistant([{ type: 'thinking', thinking: text, signature: '' }], 'tool_use');
  const note = (text: string) => assistant([{ type: 'text', text }], 'tool_use');
  const call = (id: string, name: string, input: Record<string, unknown>, output: unknown, content: string) => {
    assistant([{ type: 'tool_use', id, name, input }], 'tool_use');
    add('user', { toolUseResult: output, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] } });
  };
  const message = (id: string, text: string, final: boolean) => call(id, 'mcp__to-human__message', { text, final }, 'sent', 'sent');
  const end = () => add('system', { subtype: 'turn_duration', durationMs: 42_000 });
  const bash = (stdout: string) => ({ stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
  if (i === RV.steer) {
    prompt('Tidy the release notes, then run the tests.');
    note('Reading the notes first.');
    call(`toolu_01Rv0Read`, 'Read', { file_path: `${repo}/README.md` }, { type: 'text', file: { filePath: `${repo}/README.md`, content: '# notes', numLines: 1, startLine: 1, totalLines: 1 } }, '1\t# notes');
    call(`toolu_01Rv0Test`, 'Bash', { command: 'pnpm test', description: 'Run the tests' }, bash('42 passed'), '42 passed');
    // the steer, as the engine keeps a message it took mid-turn: the queue's record and the attachment the turn read
    const steer = 'Also set the changelog to today’s date.';
    rows.push({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date((clock += 1_000)).toISOString(), sessionId: engineId, content: steer });
    add('attachment', { attachment: { type: 'queued_command', prompt: steer, source_uuid: `b${i}000000-0000-4000-8000-000000000001`, commandMode: 'prompt', origin: { kind: 'human' }, timestamp: new Date(clock).toISOString(), humanTurn: true } });
    rows.push({ type: 'queue-operation', operation: 'remove', timestamp: new Date((clock += 1_000)).toISOString(), sessionId: engineId, content: steer, reason: 'absorbed_mid_turn' });
    thought('The person asked for the changelog date as well.');
    call(`toolu_01Rv0Date`, 'Bash', { command: 'grep -n "^## " CHANGELOG.md | head -1', description: 'Find the changelog’s latest heading' }, bash('3:## 1.4.0 (last week)'), '3:## 1.4.0 (last week)');
    call(`toolu_01Rv0Edit`, 'Bash', { command: 'sed -i "" "3s/(last week)/(today)/" CHANGELOG.md', description: 'Date the heading today' }, bash(''), '');
    message('toolu_01Rv0Done', 'The release notes are tidy and the 42 tests pass. The changelog’s latest heading now carries today’s date.', true);
    end();
  } else if (i === RV.hidden) {
    prompt('Where is the retry delay set, and is it still five seconds?');
    message('toolu_01Rv1Start', 'Looking for the retry delay now.', false);
    call('toolu_01Rv1Grep', 'Grep', { pattern: 'retryDelay', path: repo, output_mode: 'files_with_matches' }, { mode: 'files_with_matches', filenames: ['src/quota.ts'], numFiles: 1 }, 'Found 1 file\nsrc/quota.ts');
    message('toolu_01Rv1Found', 'It is set in `src/quota.ts`. Checking its value.', false);
    call('toolu_01Rv1Cat', 'Bash', { command: 'grep -n retryDelay src/quota.ts', description: 'Read the retry delay' }, bash('4:export const retryDelay = 5_000;'), '4:export const retryDelay = 5_000;');
    message('toolu_01Rv1Done', 'Yes: `retryDelay` in `src/quota.ts` is still 5,000 ms.', true);
    end();
  } else if (i === RV.receipt) {
    prompt('Wait for the reviewer’s note on the change.');
    message('toolu_01Rv2Wait', 'Waiting for the reviewer’s note.', true);
    end();
    // a peer's message at idle, as the engine keeps one sminos's inbox handed it: its receipt's line first, then the frame
    const words = 'The change reads well. One nit: the new flag needs a line in the README.';
    const body = `[sminos receipt ${'5e'.repeat(12)}.${'0c'.repeat(8)} attempt 1]\n[sminos chat orbit reviewer:7 from reviewer → @you]\n${words}`;
    add('user', {
      isMeta: true, origin: { kind: 'peer', from: 'unknown', name: 'reviewer', body }, promptSource: 'system', turnOrigin: 'peer',
      message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from-name="reviewer">\n${body}\n</cross-session-message>\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf.` },
    });
    thought('The reviewer wants a README line for the flag.');
    call('toolu_01Rv2Readme', 'Bash', { command: 'grep -n -- "--quiet" README.md', description: 'Look for the flag in the README' }, bash(''), '');
    message('toolu_01Rv2Done', 'The reviewer approved the change with one nit: the new `--quiet` flag needs a line in the README. Shall I add it?', true);
    end();
  } else {
    prompt('Run the slow suite in the background and tell me when it is done.');
    call('toolu_01Rv3Suite', 'Bash', { command: 'pnpm test:slow', description: 'Run the slow suite', run_in_background: true }, { ...bash(''), backgroundTaskId: 'brv3slow1' }, 'Command running in background with ID: brv3slow1. Output is being written to: /tmp/rv/tasks/brv3slow1.output');
    message('toolu_01Rv3Started', 'The slow suite is running; I will tell you when it finishes.', true);
    end();
    // the command's end, at idle, as the engine keeps the notification that opens a turn
    add('user', {
      origin: { kind: 'task-notification', producer: 'session-task', runId: 'rv3-slow-run' }, promptSource: 'system', turnOrigin: 'task_notification',
      message: { role: 'user', content: '<task-notification>\n<task-id>brv3slow1</task-id>\n<tool-use-id>toolu_01Rv3Suite</tool-use-id>\n<output-file>/tmp/rv/tasks/brv3slow1.output</output-file>\n<status>completed</status>\n<summary>Background command "Run the slow suite" completed (exit code 0)</summary>\n</task-notification>' },
    });
    thought('The slow suite finished; read its tail.');
    call('toolu_01Rv3Tail', 'Bash', { command: 'tail -1 /tmp/rv/tasks/brv3slow1.output', description: 'Read the suite’s result' }, bash('318 passed in 4m 02s'), '318 passed in 4m 02s');
    message('toolu_01Rv3Done', 'The slow suite passed: 318 tests in about four minutes.', true);
    end();
  }
  return rows;
}

test('the report view repair: the to-human view of recorded sessions, one started by MAWS', async () => {
  test.setTimeout(600_000);
  const ids = ['rv-steer-rest', 'rv-record-open', 'rv-record-closed', 'rv-steer-launched', 'rv-hidden', 'rv-hidden-open', 'rv-receipt', 'rv-receipt-open', 'rv-task', 'rv-task-open'];
  if (!ids.some(wanted)) return;
  const repos = REPOS.map((name) => makeRepo(name, name === 'stages' ? 'scheduled' : undefined));
  const config = join(SCRATCH, 'claude-config-rv');
  rmSync(config, { recursive: true, force: true });
  const keys = Object.keys(RV) as (keyof typeof RV)[];
  for (const key of keys) {
    const i = RV[key];
    const repo = repos[i % repos.length]!;
    const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, `${rvDiskId(i)}.jsonl`), `${rvTranscript(i, repo).map((row) => JSON.stringify(row)).join('\n')}\n`);
  }
  trust(config);
  installToHumanPlugin(config, { declares: true, version: '0.9.0' });
  // the steer session's one launch: the replay's handshake, then held at a prompt no one sends (no init is played, so
  // the launch's plugins are not yet reported), its engine session the seeded one's
  mkdirSync(join(SCRATCH, 'journals'), { recursive: true });
  const held = turnsJournal(join(SCRATCH, 'journals'), 'rv-held', 1);
  const heldText = readFileSync(held, 'utf8');
  const recorded = heldText.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { direction: string; frame: { session_id?: unknown } }).find((row) => row.direction === 'in' && typeof row.frame.session_id === 'string')?.frame.session_id as string;
  writeFileSync(held, heldText.replaceAll(recorded, rvDiskId(RV.steer)));
  const usage = usageFixture();
  const userData = join(SCRATCH, 'profile-rv');
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(userData, { recursive: true });
  const maws = await launchMaws({ userData, prepare: noGh, env: BASE_ENV({ MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: held, CLAUDE_CONFIG_DIR: config, MAWS_CLAUDE_USAGE_DIR: usage, PATH: NO_GH_PATH }) });
  const { page } = maws;
  try {
    await size(maws);
    await light(page);
    value(await invoke(page, 'settings.set', { gateway: { defaultRoute: 'direct' } })); // no relay in the run
    const sid: Record<string, string> = {};
    await expect.poll(async () => {
      const { sessions } = value(await invoke(page, 'session.list', {}));
      for (const key of keys) sid[key] = sessions.find((s) => s.engineSessionId === rvDiskId(RV[key]))?.appId ?? '';
      return keys.every((key) => sid[key]);
    }, { timeout: 30_000 }).toBe(true).catch((error: unknown) => setupFailed('the report view sessions’ index', error));
    await dismissToasts(page);
    const closedLines = () => pane(page).locator('[data-row-id^="record-fold:closed:"] button');
    const openLines = () => pane(page).locator('[data-row-id^="record-fold:open:"] button');
    // a session opened afresh, its transcript drawn, its view read from its end
    const opened = async (key: keyof typeof RV) => {
      if (!sid[key]) throw new Error(`the ${key} session was not listed by the index`);
      await openSession(page, sid[key]!);
      await expect(pane(page).locator('.transcript-row[data-kind]').first()).toBeVisible({ timeout: 20_000 });
      await toEnd(page);
    };
    // every closed record line opened, one press at a time (an opened stretch replaces its line)
    const openAll = async () => {
      await unfold(page, closedLines(), 'a closed record line', 8);
      await toTop(page);
    };
    // every opened stretch folded back
    const closeAll = async () => {
      await unfold(page, openLines(), 'an opened record line', 8);
    };
    const meta = (id: string, key: keyof typeof RV, title: string, how: string, state: string) =>
      rv({ id, title, how: `The ${key} session (launch 13); ${how}`, state, folders: ['owner/view', 'transcript/view', 'transcript/model'] });

    await shot(page, meta('rv-steer-rest', 'steer', 'A steer mid-turn, the session at rest', 'open it', 'The to-human view at rest: the prompt, a record line, the steer, a record line, the final message'), async () => {
      await opened('steer');
      await closeAll();
    }, { check: () => inView(closedLines(), 'a closed record line') });
    await shot(page, meta('rv-record-open', 'steer', 'A record line opened', 'press its first record line', 'The first stretch’s work unfolded in place, its fold line under it'), async () => {
      await opened('steer');
      await closeAll();
      await closedLines().first().click();
      await page.waitForTimeout(800);
    }, { check: () => inView(openLines(), 'the opened stretch’s fold line') });
    await shot(page, meta('rv-record-closed', 'steer', 'A record line closed again', 'press its first record line, then its fold line', 'The stretch folded back to its record line'), async () => {
      await opened('steer');
      await closeAll();
      await closedLines().first().click();
      await expect(openLines().first()).toBeVisible({ timeout: 5_000 });
      await openLines().first().click();
      await page.waitForTimeout(800);
    }, { check: async () => {
      await inView(closedLines(), 'the record line, closed');
      await expect(openLines(), 'no stretch open').toHaveCount(0);
    } });
    await shot(page, meta('rv-hidden', 'hidden', 'A turn with hidden standalone calls', 'open it', 'Three messages, a record line in place of each lone call between them'), async () => {
      await opened('hidden');
      await closeAll();
    }, { check: () => inView(closedLines(), 'a closed record line') });
    await shot(page, meta('rv-hidden-open', 'hidden', 'A turn with standalone calls, every record line opened', 'press each record line', 'Each lone call in place between the messages'), async () => {
      await opened('hidden');
      await openAll();
    }, { check: () => inView(openLines(), 'an opened stretch’s fold line') });
    await shot(page, meta('rv-receipt', 'receipt', 'A peer’s message with a receipt line, opening a turn at idle', 'open it', 'The to-human view: the peer’s message folded into the work it opened, or drawn where it stands'), async () => {
      await opened('receipt');
      await closeAll();
    });
    await shot(page, meta('rv-receipt-open', 'receipt', 'A peer’s message with a receipt line, its work opened', 'press each record line', 'The peer’s row as drawn: its sender and its words, or its raw text'), async () => {
      await opened('receipt');
      await openAll();
      await seek(page, pane(page).locator('.transcript-row[data-kind="agent_message"], .transcript-row[data-kind="user"]').last());
    });
    await shot(page, meta('rv-task', 'task', 'A background command’s notification opening a turn at idle', 'open it', 'The to-human view: the notification folded into the work it opened, or drawn where it stands'), async () => {
      await opened('task');
      await closeAll();
    });
    await shot(page, meta('rv-task-open', 'task', 'A background command’s notification, its work opened', 'press each record line', 'The notification’s line and the turn it opened, in place'), async () => {
      await opened('task');
      await openAll();
      await seek(page, pane(page).locator('.transcript-row[data-kind="notice"]').first());
    });
    // last: the steer session started by MAWS, which decides its launch (session.start; never session.launch, which
    // bypasses the decision), held at a prompt no one sends; master's launch advertises 9, the repair's 8
    if (wanted('rv-steer-launched')) {
      try {
        await openSession(page, sid.steer!);
        value(await invoke(page, 'session.start', { appSessionId: sid.steer as never, message: null, options: { gateway: 'direct', trust: 'accepted' } }));
        await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: sid.steer as never })).process, { timeout: 60_000 }).toBe('ready');
      } catch (error) {
        setupFailed('starting the steer session', error);
      }
    }
    await shot(page, meta('rv-steer-launched', 'steer', 'A steer mid-turn, the session started by MAWS', 'start it (its launch held before any prompt)', 'The same session while a launch MAWS decided runs: on master it advertises 9 and MAWS leaves the view to the mod, which the replay does not run; from the repair it advertises 8 and the mirror draws'), async () => {
      await openSession(page, sid.steer!);
      await expect(pane(page).locator('.transcript-row[data-kind]').first()).toBeVisible({ timeout: 20_000 });
      await toEnd(page);
    }, { after: async () => void (await invoke(page, 'session.stop', { appSessionId: sid.steer as never, reason: 'stop' })) });
  } finally {
    await maws.cleanup();
  }
});

// ---- the seeded org (e2e/org-page.spec.ts's seededOrg, its random ids from `det`) ----------------------------------
const kid = () => det(16).toString('base64url');
const memberId = () => det(16).toString('hex');
const ref = () => det(16).toString('base64url');
const fingerprint = () => {
  const letters = Array.from(det(10), (b) => 'abcdefghijklmnopqrstuvwxyz234567'[b & 31]).join('');
  return `${letters.slice(0, 5)}-${letters.slice(5)}`;
};

type Device = OrgView['members'][number]['devices'][number];
type Registered = Extract<OrgStatus, { state: 'registered' }>;
const device = (over: Partial<Device> & Pick<Device, 'class'>): Device => ({
  id: kid(),
  keyStorage: over.class === 'web-cards' ? 'webcrypto' : 'software',
  root: false,
  thisMac: false,
  fingerprint: fingerprint(),
  ...over,
});

const DAY_MS = 86_400_000;
// A delegation's id is its hub key's: 16 bytes of lowercase hex.
const delegationId = () => det(16).toString('hex');

/** The org: what main's session and view would send for it, `now` the clock the ages and the pairing's end read. */
function seededOrg(local: string, userData: string, now: number): { status: Registered; view: OrgView; grants: Record<string, GrantsView>; names: Map<string, string> } {
  type Seed = Pick<OrgView['members'][number], 'id' | 'email' | 'role'>;
  const ana: Seed = { id: memberId(), email: 'ana.lopez@northwind.example', role: 'admin' };
  const long: Seed = { id: memberId(), email: 'maximiliana.featherstonehaugh-villanueva-oyelaran@clinical-research-operations.northwind-health.example', role: 'member' };
  const ortiz: Seed = { id: memberId(), email: 'maximiliana.ortiz@northwind.example', role: 'admin' };
  const ben: Seed = { id: memberId(), email: 'ben@northwind.example', role: 'member' };
  const chen: Seed = { id: memberId(), email: 'chen.wei@northwind.example', role: 'member' };
  const names = memberNames([ana, long, ortiz, ben, chen]);

  const thisMac = device({ class: 'native-mac', root: true, thisMac: true });
  const anaWeb = device({ class: 'web-cards' });
  const ortizDevices = [device({ class: 'native-mac', root: true }), device({ class: 'native-mac', keyStorage: 'enclave', root: true }), device({ class: 'native-mac' }), device({ class: 'web-cards' })];
  const benMac = device({ class: 'native-mac' });
  const member = (m: Seed, devices: Device[]) => ({ ...m, name: names.get(m.id)!, you: m === ana, devices });

  const issued = new Date(now - 6 * 86_400_000).toISOString();
  const studio = ref();
  const farm = ref();
  const lab = ref();
  const runner = ref();
  const runners = delegationId();
  const at = (days: number) => new Date(now + days * DAY_MS).toISOString();
  const view: OrgView = {
    version: 41,
    issued,
    maySign: true,
    recoveryKid: kid(),
    members: [member(ana, [thisMac, anaWeb]), member(long, []), member(ortiz, ortizDevices), member(ben, [benMac]), member(chen, [])],
    machines: [
      { name: 'ana-mbp', ref: local, owners: [ana.id], keyId: kid(), certified: false, delegation: null, mayGrant: true },
      { name: 'studio-mini', ref: studio, owners: 'org', keyId: kid(), certified: false, delegation: null, mayGrant: true }, // Ana an admin: hers to grant on
      { name: 'render-farm-03.clinical-research-operations', ref: farm, owners: [long.id, ortiz.id, memberId()], keyId: kid(), certified: false, delegation: null, mayGrant: false }, // the last a former member
      { name: 'lab-mini-02', ref: lab, owners: [ana.id], keyId: kid(), certified: false, delegation: null, mayGrant: true },
      { name: 'ci-runner-7', ref: runner, owners: [ortiz.id], keyId: kid(), certified: true, delegation: runners, mayGrant: false },
    ],
    roots: [
      { kid: kid(), member: ana.id, device: thisMac.id },
      { kid: kid(), member: ortiz.id, device: ortizDevices[0]!.id },
      { kid: kid(), member: ortiz.id, device: ortizDevices[1]!.id },
      { kid: kid(), unlisted: true },
    ],
    // M4c: the Delegations section's rows in each state, and the hub's key list behind them
    delegations: [
      {
        id: runners,
        prefix: 'ci-runner-',
        owners: [ortiz.id],
        expires: at(23.05),
        maxUses: 25,
        machines: [
          { ref: runner, name: 'ci-runner-7', live: true },
          { ref: ref(), name: 'ci-runner-3', live: false },
        ],
        hub: { expires: at(23.05), uses: 4, revoked: false },
        state: 'in-effect',
        unsent: null,
        hubBehind: null,
        hubProblem: null,
      },
      {
        id: delegationId(),
        prefix: 'render-farm.clinical-research-operations-',
        owners: 'org',
        expires: at(180.05),
        maxUses: null,
        machines: [],
        hub: { expires: at(12.05), uses: 2, revoked: false },
        state: 'in-effect',
        unsent: null,
        hubBehind: 'renew',
        hubProblem: { reason: 'not-renewed', detail: "the hub's org state doesn't hold the renewal yet" },
      },
      {
        id: delegationId(),
        prefix: 'devcloud-vm-',
        owners: [ana.id],
        expires: at(90),
        maxUses: null,
        machines: [],
        hub: { expires: at(90), uses: 0, revoked: false },
        state: 'unsent',
        unsent: {
          rewrite: true,
          writing: false,
          problem: 'gcloud secrets versions add failed: PERMISSION_DENIED: Permission denied on secret projects/maws-example-prod/secrets/desk-provisioning-v2 for cli-owner@maws-example-prod.iam.gserviceaccount.com',
          generation: 1,
        },
        hubBehind: null,
        hubProblem: null,
      },
      {
        id: delegationId(),
        prefix: 'old-render-',
        owners: [],
        expires: at(40),
        maxUses: 50,
        machines: [],
        hub: { expires: at(40), uses: 9, revoked: false },
        state: 'dropped',
        unsent: null,
        hubBehind: 'revoke',
        hubProblem: { reason: 'hub', detail: 'the hub was not reached (timeout): Retry' },
      },
    ],
    strayKeys: [
      { id: delegationId(), prefix: 'tmp-', label: 'delegation create from a laptop, abandoned mid-way', created: at(-3), expires: at(87), young: false },
      { id: delegationId(), prefix: 'gpu-box-', label: 'gpu boxes', created: at(-4 / 1440), expires: at(30), young: true },
    ],
    hubKeys: { at: new Date(now - 20_000).toISOString(), failed: false },
  };
  const status: Registered = {
    state: 'registered',
    org: 'northwind-health',
    hub: 'https://desk.northwind-health.example',
    member: { id: ana.id, email: ana.email },
    device: thisMac.id,
    session: 'signed-in',
    hubAccess: 'connected',
    head: { version: view.version, issued },
    problem: null,
    refused: { code: 'keys', detail: `${join(userData, 'device', 'keys.json')} is gone` }, // org-session.ts's words at load
    signer: {
      root: true,
      maySign: true,
      fingerprint: thisMac.fingerprint,
      stepUpKid: view.roots[0]!.kid,
      due: true,
      ageDays: 6,
      pending: null,
      offer: null,
      owing: [{ version: view.version, machines: [studio, farm], tooLarge: [farm] }], // each named by the org state's name, never its ref
      abandoned: [{ hash: det(32).toString('base64url'), version: view.version - 1, hub: true, machines: [farm] }],
      rekey: null,
      rekeying: null,
      oldDevice: null,
    },
    pairing: {
      generation: 3,
      member: long.id,
      class: 'native-mac',
      expires: new Date(now + 8 * 60_000).toISOString(),
      entry: { id: kid(), class: 'native-mac', keyStorage: 'software', fingerprint: fingerprint(), digest: det(32).toString('hex') },
      problem: null,
    },
    enrolling: { generation: 2, name: 'gpu-box-02', replace: null, expires: new Date(now + 50 * 60_000).toISOString(), candidate: null, problem: null }, // awaiting its key
    hubRowsLeft: [{ name: 'old-render-01', ref: ref() }],
    delegations: { creating: false, rev: 0 },
  };
  // Each machine's rights as `org.grants.view` answers them: the machine's own word, this Mac's issued record beside it.
  const read = new Date(now).toISOString();
  const shown = (machine: string, patch: Partial<Extract<GrantsView, { ok: true }>>): GrantsView => ({ ok: true, ref: machine, live: true, asOf: read, grants: [], missing: [], digest: null, ...patch });
  const grants: Record<string, GrantsView> = {
    [local]: shown(local, { grants: [{ member: chen.id, rights: ['spawn'], version: 1, state: 'on-machine' }] }),
    [studio]: shown(studio, {
      grants: [
        { member: long.id, rights: ['machine-admin'], version: 4, state: 'refused', reason: 'not-newer' },
        { member: ben.id, rights: ['spawn', 'shell'], version: 3, state: 'on-machine' },
        { member: chen.id, rights: ['spawn'], version: 2, state: 'pending' },
      ],
    }),
    [farm]: shown(farm, { live: false, asOf: new Date(now - 3 * 3_600_000).toISOString() }), // not Ana's: her own entry, none
    [lab]: shown(lab, {
      missing: [
        { member: ben.id, rights: ['spawn'], version: 3 },
        { member: chen.id, rights: ['spawn', 'shell'], version: 2 },
      ],
      digest: det(32).toString('base64url'),
    }),
    [runner]: shown(runner, {}),
  };
  return { status, view, grants, names };
}

// The word cut's M1: two more orgs from the same seed (launches 6 and 7). Read-only: this Mac no root and its member no
// admin, so the page says who signs (G170). Quiet: no delegation and no stray key yet, the weekly re-sign not due
// (G183, G187), with the code destination set (G188, G189). Neither keeps the seed's refusal or its deliveries.
type Seeded = ReturnType<typeof seededOrg>;
type OrgSeed = Omit<Seeded, 'names'>;
function readOnlyOrg({ status, view, grants }: Seeded): OrgSeed {
  const you = view.members.find((member) => member.you)!;
  const mine = new Set(you.devices.map((d) => d.id));
  const rest: Registered = { ...status, signer: { ...status.signer!, root: false, maySign: false, due: false, owing: [], abandoned: [] }, pairing: null, enrolling: null, hubRowsLeft: [] };
  delete rest.refused;
  return {
    status: rest,
    view: {
      ...view,
      maySign: false,
      members: view.members.map((member) => (member.you ? { ...member, role: 'member' as const, devices: member.devices.map((d) => ({ ...d, root: false })) } : member)),
      roots: view.roots.filter((root) => 'unlisted' in root || !mine.has(root.device)),
      machines: view.machines.map((machine) => ({ ...machine, mayGrant: machine.mayGrant && machine.owners !== 'org' })),
    },
    grants,
  };
}
function quietOrg({ status, view, grants }: Seeded): OrgSeed {
  const rest: Registered = { ...status, signer: { ...status.signer!, due: false, ageDays: 1, owing: [], abandoned: [] }, hubRowsLeft: [] };
  delete rest.refused;
  return { status: rest, view: { ...view, delegations: [], strayKeys: [] }, grants };
}
// An invented code destination (org-page.spec.ts's shape): where a new delegation's code would be stored
const DESTINATION = { project: 'maws-example-prod', secret: 'desk-provisioning-v2', account: 'cli-owner@maws-example-prod.iam.gserviceaccount.com' };
