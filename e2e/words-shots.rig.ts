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
// window here is the product's, MAWS_HARNESS=0) and runs the nine launches, about 35 minutes (M1 added launches 6 to
// 9 and the `m1-` scenes: the Settings and Org states the word cut's M1 changes, and the note placement prototype's
// twins, `m1-<scene>-overlay`). The pictures are
// <WORDS_OUT>/<scene id>.png, with <WORDS_OUT>/_run.json listing each scene's meta and whether it was reached (and why
// not). WORDS_ONLY=<id>,<prefix>* narrows the run to some scenes (a launch with none wanted still starts). The "after"
// pictures are the same command on the build's branch into another folder.
//
// The `m1-` scenes are this branch's alone, so their "before" is this rig run against master's build: in a clean
// checkout of master, `git checkout <this branch> -- e2e/words-shots.rig.ts e2e/support`, then the command above. Every
// launch's state is set from this file and e2e/support (fixtures, seams master's main already has). Each m1 scene checks
// its named state right before its capture, on master's build in master's terms (`cutBuild`), and is not reached when it
// cannot; the overlay twins are not reached there.
//
// Locators avoid the app's words (data attributes, menu ids, IPC, positions), because the words are what the other
// build changes; where only a word reaches a target it comes from the app's own copy module, or is marked. A step that
// cannot find its target records the screen as not reached instead of failing the run; a scene whose surface the UX
// wave removed is recorded as having no target on master, with why.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { GrantsView, OrgStatus, OrgView } from '../src/shared/ipc/schema/org';
import { readOrMintMachineRef } from '../src/shared/machine/identity-file';
import { memberNames } from '../src/shared/org/member-name';
import { BROWSER, INDEX, KEYBOARD, NOTIFICATIONS, ORG, VOICE } from '../src/renderer/src/settings-tab/copy';
import { BROWSER_COPY } from '../src/renderer/src/tools/browser/copy';
import { benchDeckFiles } from '../src/artifacts/slides/fixtures/bench';
import { isolatedGitEnv } from '../test/support/git-env';
import { ownerShapedState, writePluginCliStub } from '../test/support/plugin-cli-stub';
import { invoke, launchReady, recordedBlockJournal, steerStopJournal, value } from './support/c7-replay';
import { bindCsv, chart, insertBlocks } from './support/dashboards';
import { createDesign, DESIGN_FILES, editDesign } from './support/design';
import { startBrowserServer } from './support/browser-server';
import { closeSheet, importThrough, profilesFile } from './support/browser-import-scene';
import { buildChromeUserData } from '../test/support/chrome-profile';
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
// added for the Settings and Org states the cut changes. A folder is under src/renderer/src, or from the repository's
// root when it starts with src/.
type Meta = { id: string; title: string; how: string; state: string; folders: string[]; hover?: boolean; round?: 2 | 'm0' | 'm1' };
const META: Meta[] = [];
const results: { id: string; ok: boolean; error?: string; notes?: string[] }[] = [];
const wanted = (id: string) => !ONLY || ONLY.has(id) || [...ONLY].some((o) => o.endsWith('*') && id.startsWith(o.slice(0, -1)));
const r2 = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 2 });
const m0 = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 'm0' });
const m1 = (meta: Omit<Meta, 'round'>): Meta => ({ ...meta, round: 'm1' });

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
type RepoVariant = 'behind' | 'conflict' | 'scheduled';
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
  if (variant === 'scheduled') {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    cpSync(join(REPO_ROOT, 'spikes/protocol-probe/fixtures/pass3/e7-cron-durable/scheduled_tasks.json'), join(dir, '.claude/scheduled_tasks.json'));
    appendFileSync(join(dir, '.git/info/exclude'), '.claude/\n');
  }
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

// ---- capture ---------------------------------------------------------------------------------------------------------
async function size(maws: MawsLaunch) {
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
type ShotOptions = { of?: () => Page; check?: () => Promise<void>; after?: () => Promise<void> };
async function shot(page: Page, meta: Meta, prepare: () => Promise<void>, { of, check, after }: ShotOptions = {}) {
  if (!wanted(meta.id)) return;
  META.push(meta);
  notes = [];
  try {
    if (meta.hover) await dismissToasts(page);
    // one more try after a failed step: a loaded Mac can take a press before its target has drawn
    await prepare().catch(async (first) => {
      console.log(`[words] ${meta.id}: retrying after ${(first instanceof Error ? first.message : String(first)).split('\n')[0]!.slice(0, 120)}`);
      await closeOverlays(page);
      await page.waitForTimeout(1500);
      notes = [];
      await prepare();
    });
    const target = of?.() ?? page;
    await settle(target, meta.hover === true);
    if (meta.round === 'm1') await expect(page.locator('[data-settings-dialog]'), 'Settings open').toBeVisible({ timeout: 3_000 });
    await check?.();
    await target.screenshot({ path: join(OUT, `${meta.id}.png`), animations: 'disabled', caret: 'hide' });
    results.push({ id: meta.id, ok: true, ...(notes.length > 0 && { notes: [...notes] }) });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 300);
    results.push({ id: meta.id, ok: false, error: message });
    console.log(`[words] ${meta.id} not reached: ${message}`);
  } finally {
    if (after) await after().catch((error: unknown) => console.log(`[words] ${meta.id} after: ${String(error).slice(0, 200)}`));
  }
}
// ---- the word cut's M1: what waits for the pointer and the keyboard (ui/row-note.tsx, ui/tip.tsx) -------------------
// The m1 scenes' before is this rig, with its e2e support files, run against master's build (scenes.md). Master has no
// row notes, no tooltips on words, no "…" menus and no chevrons: what this branch keeps behind them is drawn at rest
// there. So each scene proves its named state on either build before its capture: on the cut's, the reveal itself (the
// owner's own tooltip, the row's own note, the row's own menu with its items, the chevron open); on master's, the words
// that reveal holds here, drawn at rest and in view. A scene that cannot prove it is not reached. An overlay twin, which
// only the cut's build draws, is not reached on master's.
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
const MASTER_ORG = ORG as typeof ORG & Partial<Record<'newDelegation' | 'enroll', string>>;
// Nothing pointed at and nothing focused, so what a scene opens opens from closed.
async function letGo(page: Page) {
  await page.mouse.move(W - 2, H - 2);
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.waitForTimeout(400);
}
// The note placement prototype (M1 task 1's switch, the `note-overlay` variant of styles/app.css): under
// `data-note-placement="overlay"` on the document root an open note floats over the rows below instead of pushing them.
async function notePlacement(page: Page, overlay: boolean) {
  await page.evaluate((on) => {
    if (on) document.documentElement.dataset.notePlacement = 'overlay';
    else delete document.documentElement.dataset.notePlacement;
  }, overlay);
}
// A scene with a row's note open, then its twin with the switch set before the note opens (`m1-<scene>-overlay`), so the
// owner sees the baseline placement and the prototype side by side. The twin asks the latched build first, so on
// master's it is not reached before any step runs (and, in a run that opened no Settings before it, once its step has).
async function noteShots(page: Page, meta: Meta, prepare: () => Promise<void>, options: ShotOptions = {}) {
  await shot(page, meta, prepare, options);
  const id = `${meta.id.startsWith('m1-') ? '' : 'm1-'}${meta.id}-overlay`;
  const twin: Meta = { ...meta, id, title: `${meta.title}, the note over the rows below`, state: `${meta.state}; the note placement prototype: the open note floats over the rows below`, round: 'm1' };
  const overlaid = async () => {
    const absent = () => new Error('no row note on this build: the overlay twin is the cut’s alone');
    if (cut === false) throw absent();
    await letGo(page);
    await notePlacement(page, true);
    await prepare();
    if (!cutBuild()) throw absent();
  };
  const after = async () => {
    await notePlacement(page, false);
    await options.after?.();
  };
  await shot(page, twin, overlaid, { ...options, after });
}
// What a check requires on master's build: `rest`, the words drawn at rest, inside the viewport.
const inView = (rest: Locator, what: string) => expect(rest.first(), what).toBeInViewport({ timeout: 3_000 });
// A word's or a glyph's tooltip, shown as the keyboard shows it: by focus. The owner is brought into view first and
// left to settle (a scroll closes an open tooltip). On master's build the words the tooltip holds here, `rest`, are
// brought into view instead.
async function focusTip(page: Page, owner: Locator, rest: Locator) {
  if (!cutBuild()) return rest.first().scrollIntoViewIfNeeded({ timeout: 10_000 });
  await owner.first().scrollIntoViewIfNeeded({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await owner.first().focus();
}
// The check that `trigger`'s own tooltip is open: the element the tip wraps (the focused word or control, or the label
// around a box) reads open to Radix, and a tooltip is drawn (one shows at a time). On master's, `rest` in view.
const tipShown = (page: Page, trigger: Locator, what: string, rest: Locator) => async () => {
  if (!cutBuild()) return inView(rest, `master’s words for the tooltip of ${what}`);
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

// A scene of the pin's manifest whose surface the UX wave removed: kept in _run.json, never captured.
function gone(meta: Meta, why: string) {
  if (!wanted(meta.id)) return;
  META.push(meta);
  results.push({ id: meta.id, ok: false, error: `no target on master: ${why}` });
}

// Escape only while an overlay is open. Since the UX wave's U1b, Escape on a waiting request's row (or on nothing while
// its pane holds the keyboard) denies the request (request-card/prompt-guard.ts), so a bare Escape could answer one.
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';
async function closeOverlays(page: Page) {
  for (let i = 0; i < 4 && (await page.locator(OVERLAY).count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
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
// The cards beside the conversation, each open (panel/summary/FloatingCard.tsx: section > h3 > button)
async function unfoldCards(page: Page) {
  await expect(cards(page)).toBeVisible({ timeout: 10_000 });
  for (const button of await cards(page).locator('section > h3 > button[aria-expanded="false"]').all()) await button.click().catch(() => undefined);
  await page.waitForTimeout(600);
}
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
test.afterAll(() => {
  const all = JSON.parse(existsSync(join(OUT, '_run.json')) ? readFileSync(join(OUT, '_run.json'), 'utf8') : '{"results":[],"screens":[]}') as { results: typeof results; screens: Meta[] };
  const keep = <T extends { id: string }>(old: T[], fresh: T[]) => [...old.filter((o) => !fresh.some((f) => f.id === o.id)), ...fresh];
  writeFileSync(join(OUT, '_run.json'), JSON.stringify({ results: keep(all.results, results), screens: keep(all.screens, META) }, null, 2));
});

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

    const SID = { approval: 'app-3eb04b84', question: 'app-d095dc75', plan: 'app-bac6130b', running: 'app-9a1d4262', terminal: 'app-466b0d0d', idle: 'app-7412a115', unvisited: 'app-1238089b' };

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
    });
    await shot(page, { id: 'session-plan', title: 'A session waiting on a plan', how: 'Click the session waiting on a plan', state: 'Plan review at the end of the conversation: the plan and its buttons; the message box under it', folders: ['request-card', 'composer', 'attention', 'session', 'panel'] }, async () => {
      await openSession(page, SID.plan, SID.idle);
      await expect(request()).toBeVisible({ timeout: 15_000 });
    });
    await shot(page, { id: 'session-terminal-held', title: 'A session held by a terminal', how: 'Click a session another terminal runs', state: 'The notice in the message box’s place: live in a terminal, read-only', folders: ['session', 'composer', 'lane-a', 'resume', 'transcript'] }, async () => {
      await openSession(page, SID.terminal, SID.idle);
      await soft(pane(page).locator('[role="note"]'), 'the holder notice');
    });
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
    });
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
    // rows whose helper words wait for the pointer: the first row of a section, hovered (M1: each with its twin under the
    // note placement prototype)
    for (const [section, title] of [['notifications', 'Notifications'], ['sessions', 'Sessions']] as const) {
      const first = page.locator(`section[aria-labelledby="settings-${section}"] [data-settings-row]`).first();
      await noteShots(page, { id: `settings-${section}-hover`, title: `Settings, ${title}, pointer on its first row`, how: `Settings, ${title}; hover its first row`, state: 'The first row of the section under the pointer', folders: ['settings-tab'], hover: true }, async () => {
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
    await shot(page, m0({ id: 'm0-dialog-agents-none', title: 'Agents dialog (/agents) with no agents', how: 'Type /agents in a session not opened before, its catalogue holding no agents', state: 'The dialog’s empty state', folders: ['widgets', 'composer'] }), async () => {
      // the renderer reads a session's catalogue once, as it attaches: the session is one the rig has not opened
      await app.evaluate(async (_, id) => {
        const backend = (globalThis as unknown as { __maws_widget_backend: Backend; __words_undo?: (() => void)[] }).__maws_widget_backend;
        const catalog = (await backend.answer('session.catalog', { appSessionId: id })) as Record<string, unknown>;
        ((globalThis as unknown as { __words_undo?: (() => void)[] }).__words_undo ??= []).push(backend.script('session.catalog', () => ({ ...catalog, agents: [] })));
      }, SID.unvisited);
      await open('agents', '', SID.unvisited);
    }, { after: () => unscriptReads(app) });
    await reset(page);
    // the resume chooser over the scenario's sessions, a filter typed so a session with turns is in its preview
    await shot(page, m0({ id: 'm0-resume', title: 'The resume chooser (/resume)', how: 'Type /resume in a session of the first project, then type “drag”', state: 'The project’s sessions filtered to one, its preview with the turns where it left off', folders: ['resume', 'widgets', 'composer'] }), async () => {
      await open('resume', '', SID.running);
      await page.keyboard.type('drag');
      await soft(page.locator('[data-testid="resume-preview"]'), 'the preview');
    });
    await reset(page);

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
  await noteShots(page, m1({ id: 'm1-settings-sessions-focus', title: 'Settings, Sessions, keyboard focus in its first row', how: 'Settings, Sessions; Tab from the section’s heading', state: 'The first row of the section holding the keyboard, its note open at once', folders: ['settings-tab', 'ui'] }), async () => {
    await settingsAt(app, page, 'sessions');
    await letGo(page);
    await page.locator('#settings-sessions').focus();
    await page.keyboard.press('Tab');
  }, { check: checks(focusIn(firstSessions, 'the first Sessions row'), noteShown(firstSessions, 'the first Sessions row')) });
  // the longest note, the Binary row's, opened by pointing: it pushes Supervisor down (G125, G127, G128)
  const binary = row('engine.binary');
  await noteShots(page, m1({ id: 'm1-settings-engine-hover', title: 'Settings, Engine, pointer on the Binary row', how: 'Settings, Engine; hover the Binary row', state: 'The Binary row under the pointer: its note with the binary’s path, the config home and the tested version', folders: ['settings-tab', 'ui'], hover: true }), async () => {
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
  await noteShots(page, m1({ id: 'm1-settings-search-landed', title: 'Settings, a search result landed on', how: 'Settings (⌘,), type “PATH” in Search settings, Enter', state: 'The Binary row holding the keyboard, its note open with the words found', folders: ['settings-tab'] }), async () => {
    await settingsAt(app, page, 'appearance');
    await searchField().fill('PATH');
    await page.waitForTimeout(500);
    await searchField().press('Enter');
    await page.waitForTimeout(2000); // past the landing's mark
  }, { check: checks(focusIn(binary, 'the Binary row'), noteShown(binary, 'the Binary row')), after: clearSearch });

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
    await expect(row('supervisor.limit'), `the Limit row ${on ? 'drawn' : 'gone'}`).toHaveCount(on ? 1 : 0, { timeout: 5_000 });
  };
  const turnBudget = async (on: boolean) => {
    if ((await budget().getAttribute('aria-checked')) !== String(on)) await budget().click();
    await budgetIs(on);
  };
  const status = row('supervisor.status').locator('[role="status"]');
  await noteShots(page, m1({ id: 'm1-settings-supervisor-status-tip', title: 'Settings, Supervisor, the status’s tooltip', how: 'Settings, Supervisor; Tab to the status', state: 'The status holding the keyboard: its tooltip with the start, the pid, the exit rule and the machine daemon, and the row’s note', folders: ['settings-tab', 'ui'] }), async () => {
    await settingsAt(app, page, 'supervisor');
    await focusTip(page, status, row('supervisor.daemon'));
  }, { check: checks(tipShown(page, status, 'the supervisor’s status', row('supervisor.daemon')), noteShown(row('supervisor.status'), 'the status row')) });
  await noteShots(page, m1({ id: 'm1-settings-supervisor-budget-off', title: 'Settings, Supervisor, the memory budget off', how: 'Settings, Supervisor; turn the memory budget’s switch off', state: 'The budget off, its limit and stateful rows gone, the switch holding the keyboard with the off note open', folders: ['settings-tab', 'budget'] }), async () => {
    await settingsAt(app, page, 'supervisor');
    await turnBudget(false);
  }, { check: checks(() => budgetIs(false), focusIn(row('supervisor.memoryBudget'), 'the memory budget row'), noteShown(row('supervisor.memoryBudget'), 'the memory budget row')), after: () => turnBudget(true) });
  await noteShots(page, m1({ id: 'm1-settings-supervisor-limit-hover', title: 'Settings, Supervisor, pointer on the memory limit', how: 'Settings, Supervisor, the budget on; hover its Limit row', state: 'The limit at its default (the default’s size in the field), its note on pointing', folders: ['settings-tab', 'budget'], hover: true }), async () => {
    await settingsAt(app, page, 'supervisor');
    await turnBudget(true);
    await row('supervisor.limit').scrollIntoViewIfNeeded();
    await row('supervisor.limit').hover();
    await page.waitForTimeout(1200);
  }, { check: checks(pointedAt(row('supervisor.limit'), 'the Limit row'), noteShown(row('supervisor.limit'), 'the Limit row')) });

  // Org, not signed in: Sign in… draws the pairing-code field, focused, its note open (G147 to G149); master draws the
  // field at rest, which takes the focus there
  const code = section('org').getByRole('textbox', { name: ORG.code, exact: true });
  await noteShots(page, m1({ id: 'm1-settings-org-signin', title: 'Settings, Org, Sign in… pressed', how: 'Settings, Org (not signed in); press Sign in…', state: 'The pairing-code field holding the keyboard, its note on where a code comes from open', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
    await settingsAt(app, page, 'org');
    // the status read first; the twin finds the field Sign in… drew still there
    const signIn = CUT_ORG.signInOpen === undefined ? null : section('org').getByRole('button', { name: CUT_ORG.signInOpen, exact: true });
    await expect(signIn === null ? code : signIn.or(code).first()).toBeVisible({ timeout: 10_000 });
    if (signIn !== null && (await signIn.count())) await signIn.click();
    else await code.focus();
  }, { check: checks(() => expect(code, 'the pairing-code field').toBeFocused({ timeout: 3_000 }), noteShown(section('org').getByRole('group', { name: ORG.code, exact: true }), 'the pairing-code row')) });
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
async function openTurn(page: Page, runs = false) {
  const line = turnLine(page).last();
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  await page.waitForTimeout(800);
  for (let i = 0; runs && i < 20; i++) {
    const run = pane(page).locator('.transcript-run-line[aria-expanded="false"]');
    if ((await run.count()) === 0) break;
    await run.first().click();
    await page.waitForTimeout(300);
  }
  await toTop(page);
}
async function unfoldAll(page: Page) {
  for (let i = 0; i < 40; i++) {
    const closed = pane(page).locator('.transcript-row[data-kind="divider"] button.transcript-disclosure[aria-expanded="false"], .transcript-run-line[aria-expanded="false"]');
    if ((await closed.count()) === 0) break;
    await closed.first().click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
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
  // a file outside every session's folder, which File › Open picks through the e2e pick seam (src/main/client/e2e-pick.ts)
  const outside = join(SCRATCH, 'outside', 'notes.txt');
  mkdirSync(join(SCRATCH, 'outside'), { recursive: true });
  writeFileSync(outside, 'Notes kept outside every project.\n');
  mkdirSync(join(SCRATCH, 'profile-replay'), { recursive: true });
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
        console.log(`[words] replay ${p.key} failed: ${(error as Error).message.split('\n')[0]}`);
      }
    }
    // the stopped work: each prompt, then the person's stop of what it started (the recording's stop_task writes)
    let stopped = false;
    try {
      const journal = join(SCRATCH, 'journals', 'stop-task.jsonl');
      cpSync(join(REPO_ROOT, STOPPED.fixture), journal);
      await openSession(page, ids.stopped!);
      await launchReady(page, ids.stopped!, journal, { cwd: repo });
      const prompts = promptsOf(STOPPED.fixture);
      for (let i = 0; i < STOPPED.stops.length; i++) {
        value(await invoke(page, 'session.send', { appSessionId: ids.stopped as never, content: prompts[i]! }));
        await expect.poll(async () => (await status(ids.stopped!)).turn, { timeout: 60_000 }).toBeNull();
        value(await invoke(page, 'session.stopTask', { appSessionId: ids.stopped as never, taskId: STOPPED.stops[i]! } as never));
        await page.waitForTimeout(1500);
      }
      stopped = true;
    } catch (error) {
      console.log(`[words] replay stopped failed: ${(error as Error).message.split('\n')[0]}`);
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
    await shot(page, { id: 'shell-tools', title: 'A finished session with many tool calls', how: 'Click the session in the sidebar', state: 'One finished turn: reads, searches, edits and commands, folded to its line', folders: ['transcript', 'tools', 'markup', 'session', 'composer'] }, async () => {
      await openSession(page, ids.tools!);
    });
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
    });
    await shot(page, m0({ id: 'm0-shell-tools-runs', title: 'A finished turn opened, every run opened', how: 'Then click each run’s line', state: 'The tool-heavy session’s turn with every run opened onto its calls, read from the top', folders: ['transcript', 'transcript/view', 'tools', 'markup'] }), async () => {
      await openSession(page, ids.tools!);
      await openTurn(page, true);
    });
    await shot(page, m0({ id: 'm0-shell-tools-open-end', title: 'A finished turn opened, scrolled to its end', how: 'The opened turn, scrolled down', state: 'The end of the tool-heavy session’s opened turn: its last calls, the answer and the turn’s line', folders: ['transcript', 'transcript/view', 'tools'] }), async () => {
      await openSession(page, ids.tools!);
      await openTurn(page, true);
      await toEnd(page);
    });
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
      const root = surface(page, 'files').locator('[role="treeitem"][data-kind="root"]').first();
      if ((await root.getAttribute('aria-expanded').catch(() => null)) === 'false') await root.click();
      const src = surface(page, 'files').locator(`[role="treeitem"][data-path="${repo}/src"]`).first();
      if ((await src.getAttribute('aria-expanded').catch(() => null)) === 'false') await src.click();
      await surface(page, 'files').locator(`[role="treeitem"][data-path="${repo}/src/sidebar.ts"]`).first().click();
      await expect(page.locator(`[data-region="panel"] [data-file-viewer][data-path="${repo}/src/sidebar.ts"]`).first()).toBeVisible({ timeout: 10_000 });
    });
    await shot(page, m0({ id: 'm0-file-outside', title: 'A file outside the session’s folders, its Read-only panel', how: 'File › Open File… (⌘O) on a file outside every project, then its read-only mark', state: 'notes.txt from a scratch folder no session works in: the viewer’s notice and the Read-only panel', folders: ['tools/code/viewer', 'panel'] }), async () => {
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
    });
    await shot(page, m0({ id: 'm0-background-stopped', title: 'Right column, Background tasks, stopped work', how: 'The same session, Background tasks with Done open', state: 'A shell and a workflow the person stopped, under Done', folders: ['tools/agents/background', 'panel'] }), async () => {
      if (!stopped) throw new Error('the stop-task replay did not reach its third stop');
      await openSession(page, ids.stopped!);
      await sideSurface(app, page, 'background');
      await unfoldSections(page, 'background');
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
// four sessions to a project at most, so every one is a row in the sidebar's tree (it lists five, then Show more)
function seedDisk(config: string, repos: string[]) {
  const move = (line: string, id: string, repo: string) => {
    if (!line.trim()) return line;
    const row = JSON.parse(line) as Record<string, unknown>;
    if ('cwd' in row) row.cwd = repo;
    if ('sessionId' in row) row.sessionId = id;
    return JSON.stringify(row);
  };
  DISK.forEach((d, i) => {
    const id = diskId(i);
    const repo = repos[i % repos.length]!;
    const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(project, { recursive: true });
    const lines = readFileSync(join(REPO_ROOT, d.file), 'utf8').split('\n');
    writeFileSync(join(project, `${id}.jsonl`), lines.map((l) => move(l, id, repo)).join('\n'));
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
    });
    await reset(page);
    await shot(page, r2({ id: 'r2-context-popover', title: 'Context popover, from the ring', how: 'Click the ring at the end of the row under the message box', state: 'The context breakdown of a finished session', folders: ['composer/frame', 'statusline'] }), async () => {
      await openSession(page, ids.subagents!);
      await pane(page).locator('[data-composer] [data-context-ring]').first().click();
      await page.waitForTimeout(1500);
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
    }, { after: clearBox });
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
    }, { after: clearBox });
    await shot(page, m0({ id: 'm0-composer-memory', title: 'The message box in memory mode', how: 'Type # in the message box', state: '“#” typed: the memory mode’s chip and hint; nothing sent', folders: ['composer', 'composer/modes', 'composer/editor'] }), async () => {
      await openSession(page, ids.subagents!);
      await box(page).click();
      await page.keyboard.type('#');
      await soft(pane(page).locator('[data-composer] [data-mode="memory"]'), 'the memory mode');
    }, { after: clearBox });
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
    // the in-app browser: a tab that never navigated, a page that failed to load (127.0.0.1:9 refuses on macOS), and a
    // page of the repository's scratch server with the tab's own controls open
    const browserTab = async (url: string | null) => {
      await openSession(page, ids.browser!);
      await sideSurface(app, page, 'browser');
      value(await invoke(page, 'browser.tabs.open', { appSessionId: ids.browser as never, url, select: true } as never));
      await page.waitForTimeout(3000);
    };
    const browser = () => surface(page, 'browser');
    await shot(page, r2({ id: 'r2-browser-blank', title: 'Browser, a tab that never navigated', how: 'Browser in the right column, a new tab', state: 'A new tab with no address', folders: ['tools/browser'] }), async () => {
      await browserTab(null);
      await soft(browser().locator('[data-browser-page="empty"]'), 'the empty tab');
    });
    await shot(page, r2({ id: 'r2-browser-failed', title: 'Browser, a page that failed to load', how: 'Browser in the right column, an address that refuses', state: 'http://127.0.0.1:9/ refused the connection', folders: ['tools/browser'] }), async () => {
      await browserTab('http://127.0.0.1:9/');
      await expect(browser().locator('[data-browser-page="error-refused"]').first()).toBeAttached({ timeout: 30_000 });
    });
    await shot(page, m0({ id: 'm0-browser-find', title: 'Browser, the options menu’s Find', how: 'A loaded page, the options menu at the end of the address row, Find', state: 'A scratch page with the find row open', folders: ['tools/browser'] }), async () => {
      await browserTab(server.url('/a.html'));
      await browser().locator('[data-browser-nav] > :last-child button').first().click();
      await page.locator('[role="menu"] [role="menuitem"]').nth(1).click();
      await expect(browser().locator('[data-browser-find]').first()).toBeVisible({ timeout: 10_000 });
    });
    await closeOverlays(page);
    await shot(page, m0({ id: 'm0-browser-options', title: 'Browser, the options menu', how: 'A loaded page, the options menu at the end of the address row', state: 'The tab’s options menu open over a scratch page', folders: ['tools/browser'] }), async () => {
      await browserTab(server.url('/a.html'));
      await browser().locator('[data-browser-nav] > :last-child button').first().click();
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
      console.log(`[words] uxwave replay: ${(error as Error).message.split('\n')[0]}`);
    }
    const need = () => {
      if (!running) throw new Error('the held replay did not reach its second hold');
    };
    await shot(page, r2({ id: 'r2-run-cards', title: 'Session cards while agents run', how: 'A session whose agents are still at work', state: 'Two background agents dispatched by the recorded session, still running; the turn has ended', folders: ['panel', 'panel/summary', 'tools/agents'] }), async () => {
      need();
      await openSession(page, ids.run!);
      await unfoldCards(page);
    });
    await shot(page, r2({ id: 'r2-run-transcript', title: 'The transcript while agents run', how: 'The same session, its turns and runs opened', state: 'Two agents running in the background', folders: ['transcript', 'transcript/view', 'tools/agents'] }), async () => {
      need();
      await openSession(page, ids.run!);
      await unfoldAll(page);
    });
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
        console.log(`[words] uxwave third prompt: ${(error as Error).message.split('\n')[0]}`);
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
      console.log(`[words] queue: ${(error as Error).message.split('\n')[0]}`);
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
        console.log(`[words] queue rows: ${(error as Error).message.split('\n')[0]}`);
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
    await shot(page, m0({ id: 'm0-auto-blocked', title: 'A command auto mode blocked', how: 'A finished turn whose command auto mode refused, its count on the turn’s line opened', state: 'The blocked call’s row with its reason and Approve and retry', folders: ['transcript', 'transcript/view', 'composer/queue'] }), async () => {
      await openSession(page, ids.block!);
      if ((await status(ids.block!)).turn === null && (await pane(page).locator('.transcript-divider-count').count()) === 0) {
        await launchReady(page, ids.block!, recordedBlockJournal(join(SCRATCH, 'journals'), 'blk', 'u1-soft-seeded-1'), { cwd: repo });
        await box(page).click();
        await page.keyboard.type('Run the marker command.');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await status(ids.block!)).turn, { timeout: 60_000 }).not.toBeNull();
        await expect.poll(async () => (await status(ids.block!)).turn, { timeout: 60_000 }).toBeNull();
      }
      await pane(page).locator('.transcript-divider-count').last().click();
      await soft(pane(page).locator('[data-cell-id="cell:toolu_01JqskAh583hVgaieABZQ9yn"]'), 'the blocked call’s cell');
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
      console.log(`[words] seeding: ${(error as Error).message.split('\n')[0]}`);
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
    await orgM1(app, page, harnessBuilt);
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
async function orgM1(app: ElectronApplication, page: Page, harnessBuilt: boolean) {
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
  const unfolded = (button: Locator | null, rest: Locator, what: string) => async () => {
    if (!cutBuild()) return inView(rest, `master’s ${what}`);
    await expect(button!, `the chevron of ${what} open`).toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 });
  };
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
  }, { check: unfolded(device, deviceRow, 'This Mac’s id and fingerprint'), after: fold(device) });
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
  const key = chevron(() => group('machines'), CUT_ORG.keyDetails);
  const firstMachine = group('machines').getByRole('group').first();
  await shot(page, m1({ id: 'm1-org-key-open', title: 'Settings, Org, a machine’s key open', how: 'Settings, Org, Machines; the chevron on the first machine', state: 'The machine’s key id, out from behind the chevron', folders: ['settings-tab/org'] }), async () => {
    await at('machines');
    await unfold(key, firstMachine);
  }, { check: unfolded(key, firstMachine, 'the first machine’s key'), after: fold(key) });
  const details = chevron(() => group('org'), CUT_ORG.details);
  const recovery = group('org').getByRole('group', { name: ORG.recovery, exact: true });
  await shot(page, m1({ id: 'm1-org-details-open', title: 'Settings, Org, the Org group’s details open', how: 'Settings, Org; the chevron beside the Org heading', state: 'The org’s id, its roots and its recovery key, out from behind the chevron', folders: ['settings-tab/org'] }), async () => {
    await at('org');
    await unfold(details, recovery);
  }, { check: unfolded(details, recovery, 'the org’s recovery key'), after: fold(details) });
  const delegations = () => org().locator('[data-org-section="delegations"]');
  const stray = delegations().getByRole('group', { name: ORG.strayKeys, exact: true });
  await noteShots(page, m1({ id: 'm1-org-stray-hover', title: 'Settings, Org, pointer on Stray hub keys', how: 'Settings, Org, Delegations; hover Stray hub keys', state: 'The stray keys’ row under the pointer, its note open', folders: ['settings-tab/org', 'ui'], hover: true }), async () => {
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
        await expect(voiceRow('helper'), 'the Helper row').toBeVisible({ timeout: 3_000 });
        await expect(voiceRow('helper'), 'the Helper row answered').not.toContainText(VOICE.reading);
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
    await noteShots(page, m1({ id: 'm1-settings-browser-profile-hover', title: 'Settings, Browser, pointer on the imported profile', how: 'Settings, Browser; hover the imported profile’s row', state: 'The profile’s row under the pointer, its note with when its bookmarks were last read', folders: ['settings-tab', 'tools/browser/import'], hover: true }), async () => {
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
    // This Mac signs: on the cut's build its "signs" chip and no Signer row; master's build draws the Signer row
    const signs = async () => {
      if (!cutBuild()) return void (await expect(signer(), 'master’s Signer row').toBeAttached({ timeout: 3_000 }));
      await inView(group('you').getByText(CUT_ORG.signsMark!, { exact: true }), 'This Mac’s “signs”');
      await expect(signer(), 'no Signer row').toHaveCount(0);
    };
    // no delegation (the seed's one prefix nowhere in the section): on the cut's build New delegation… alone and the
    // destination folded behind its chevron; on master's, its no-delegation line and the destination's form at rest
    const none = async () => {
      await expect(delegations(), 'no delegation').not.toContainText('ci-runner-');
      if (!cutBuild()) {
        await inView(delegations().getByText(ORG.noDelegations, { exact: true }), 'master’s no-delegation line');
        return void (await expect(destinationRow(), 'master’s destination').toBeVisible({ timeout: 3_000 }));
      }
      await inView(delegations().locator('[data-org-new-delegation]'), 'New delegation…');
      await expect(delegations().getByRole('button', { name: ORG.destination, exact: true }), 'the destination folded').toHaveAttribute('aria-expanded', 'false', { timeout: 3_000 });
    };
    await shot(page, m1({ id: 'm1-org-signs', title: 'Settings, Org, a root that signs', how: 'Settings (⌘,), Org, as an admin whose Mac is a root, the weekly re-sign not due', state: 'This Mac marked “signs”; no Signer row in the Org group', folders: ['settings-tab', 'settings-tab/org'] }), async () => {
      await orgAt(() => org());
    }, { check: checks(signs, () => inView(group('you'), 'You')) });
    await shot(page, m1({ id: 'm1-org-no-delegations', title: 'Settings, Org, no delegation yet', how: 'Settings, Org, scrolled to Delegations', state: 'No delegation: New delegation… alone, and the set code destination behind its chevron', folders: ['settings-tab/org'] }), async () => {
      await orgAt(delegations);
    }, { check: none });
    await noteShots(page, m1({ id: 'm1-org-destination-open', title: 'Settings, Org, the code destination open', how: 'Settings, Org, Delegations; the Code destination chevron, then Tab into its form', state: 'The set destination’s project, secret and account, the first field holding the keyboard with the row’s note open', folders: ['settings-tab/org', 'ui'] }), async () => {
      await orgAt(delegations);
      // master's build draws the destination's form at rest, under no chevron
      if (cutBuild()) {
        const open = delegations().getByRole('button', { name: ORG.destination, exact: true });
        if ((await open.getAttribute('aria-expanded')) !== 'true') await open.click();
      }
      await project().scrollIntoViewIfNeeded();
      await project().focus();
    }, { check: checks(() => expect(project(), 'the project field').toBeFocused({ timeout: 3_000 }), noteShown(destinationRow(), 'the Code destination row')) });
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
