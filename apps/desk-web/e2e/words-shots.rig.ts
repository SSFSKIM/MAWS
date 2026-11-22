// The desk's words rig (docs/doperpowers/specs/2026-11-16-word-cut-design.md; its manifest is
// docs/doperpowers/specs/2026-11-16-word-cut/scenes.md, "The desk's scenes"): the desk's web app in the states the word
// cut's M3 changed, from any build, so that a before/after pair differs only in the app's words. The Electron rig
// (e2e/words-shots.rig.ts at the repository's root) is the same idea for MAWS's windows. Nothing here asserts a look:
// each scene drives the desk to a state and photographs it. Only the desk's own fixtures: the DX3 double (fixtures.ts),
// the staged project (scene.ts), the fake machine's recordings (fake-machine.ts, depth-player.ts), and a group chat of
// invented sessions staged below. No picture is committed.
//
// On demand only. This file is not a *.spec.ts: the desk's playwright.config.ts (Playwright's default testMatch) never
// collects it, so the gated run lists what it listed before; its own config, playwright.words.config.ts, is the whole
// selection. From a checkout of the branch under test, with its dependencies installed:
//
//   WORDS_OUT=$HOME/maws-words/desk-after pnpm --filter desk-web shots:words
//
// which builds dist/ from the checkout first (the config's global setup, e2e/words-build.ts, so no older dist/ is ever
// photographed) and runs every scene, a minute or two. The pictures are <WORDS_OUT>/desk-<scene>.png, with
// <WORDS_OUT>/_desk-run.json listing each scene's meta and whether it was reached (and why not), and each run's commit.
// WORDS_ONLY=<id>,<prefix>* narrows the run to some scenes. A rerun into the same folder keeps only the results of its
// own build (a digest of the bundle it photographed): another build's are dropped from the manifest and their pictures
// renamed _stale-<scene>.png, and a scene's old picture is removed before it is taken again. The "before" is this rig
// run against master's build: in a clean checkout of master, `git checkout <this branch> --
// apps/desk-web/e2e/words-shots.rig.ts apps/desk-web/e2e/words-build.ts apps/desk-web/playwright.words.config.ts
// apps/desk-web/package.json`, then the command above into another folder. So it imports only modules master also has.
//
// Each scene proves its named state right before its capture, in the terms of the build it runs on: the build is read
// from what it draws (`cutBuild`: the stylesheet holds the touch rule's `[data-touch-fact]` on the cut's build alone),
// and the scene then checks the form that build draws there — the cut's words, or master's — so a scene whose surface
// is drawn the other way is not reached rather than photographed under the wrong name. A scene that cannot reach its
// state records "not reached: <reason: what Playwright received>" and the run goes on; every wait is bounded (the
// config's action and expect timeouts), so a missed scene costs seconds. Phone scenes run in a phone's context
// (isMobile, hasTouch, where `(hover: none)` matches) and check that media query before each capture; desktop scenes
// check `(hover: hover)`.
//
// Words: locators use test ids and data attributes; where a check reads the words each build draws, they are written
// here, marked with the build they belong to, because the copy modules that hold them differ between the builds.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { Locator, Page } from '@playwright/test';
import { loadRecording, SESSION_VIEW, TWO_SUBAGENTS, type Recording, type Step } from 'desk-hub/fake-machine';
import type { JsonObject } from 'desk-hub/protocol';
import type { HubDouble } from '../test/double/hub-double';
import { DepthPlayer } from './depth-player';
import { FakeMachineReplay } from './fake-machine';
import { DIST, expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';
import { revealEarlier } from './transcript-history';

const OUT = process.env.WORDS_OUT ?? '';
const ONLY = process.env.WORDS_ONLY ? new Set(process.env.WORDS_ONLY.split(',')) : null;
const RUN_FILE = () => join(OUT, '_desk-run.json');
test.skip(!OUT, 'WORDS_OUT names the folder the captures go to');

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const DESKTOP_NAME = '1440x900';
const PHONE_NAME = '390x844 phone (isMobile, hasTouch, (hover: none))';

// ---- _desk-run.json: what each capture shows, and whether it was reached ---------------------------------------------
type Meta = { id: string; title: string; how: string; state: string; viewport: string; rows: string[] };
type Result = { id: string; ok: boolean; error?: string; build?: string };
type Run = { at: string; dist: string; commit: string; changed: string[]; cut: boolean | null; scenes: string[] };
const META: Meta[] = [];
const results: Result[] = [];
const wanted = (id: string) => !ONLY || ONLY.has(id) || [...ONLY].some((o) => o.endsWith('*') && id.startsWith(o.slice(0, -1)));
const run: Run = { at: new Date().toISOString(), dist: '', commit: '', changed: [], cut: null, scenes: [] };

// Written after every scene, merged with what the folder holds (a scene's newer entry replaces its older one), so a run
// cut short still leaves what it took. Only this build's results are kept: one of another build (an earlier run's
// before or after, or a rebuild since) is dropped, and its picture renamed _stale-<scene>.png, so the folder never
// presents another build's picture as this one's.
function writeRun() {
  mkdirSync(OUT, { recursive: true });
  type File = { results: Result[]; screens: Meta[]; runs?: Run[] };
  const all = (existsSync(RUN_FILE()) ? JSON.parse(readFileSync(RUN_FILE(), 'utf8')) : { results: [], screens: [] }) as File;
  const keep = <T extends { id: string }>(old: T[], fresh: T[]) => [...old.filter((o) => !fresh.some((f) => f.id === o.id)), ...fresh];
  const build = buildKey();
  const ours = all.results.filter((r) => r.build === build);
  for (const stale of all.results.filter((r) => r.build !== build && !results.some((f) => f.id === r.id))) {
    const png = join(OUT, `${stale.id}.png`);
    if (existsSync(png)) renameSync(png, join(OUT, `_stale-${stale.id}.png`));
  }
  run.scenes = results.map((result) => result.id);
  const runs = [...(all.runs ?? []).filter((r) => r.at !== run.at), run];
  const screens = keep(
    all.screens.filter((m) => ours.some((r) => r.id === m.id)),
    META,
  );
  writeFileSync(RUN_FILE(), JSON.stringify({ results: keep(ours, results), screens, runs }, null, 2));
}
// This run's build, as each of its results records it: a digest of the bundle it photographed. dist/index.html names
// every script and stylesheet by Vite's content hash, so any change to what the app draws changes it, an uncommitted
// edit made again included; the commit and the files it changed stay in the run's entry as provenance.
function buildKey(): string {
  if (run.dist === '') Object.assign(run, { dist: createHash('sha256').update(readFileSync(join(DIST, 'index.html'))).digest('hex').slice(0, 16) }, buildIdentity());
  return run.dist;
}
// The checkout's commit and the tracked files it changed (the before's rig, taken from the branch), so a pair of runs
// says which builds it compares.
function buildIdentity(): Pick<Run, 'commit' | 'changed'> {
  const inRepo = (...args: string[]) => execFileSync('git', args, { cwd: import.meta.dirname, encoding: 'utf8' });
  const changed = inRepo('status', '--porcelain', '--untracked-files=no').split('\n').filter((line) => line !== '').map((line) => line.slice(3));
  return { commit: inRepo('rev-parse', 'HEAD').trim(), changed };
}

// Why a scene was not reached, as "<reason>: <what was found>": a failed check's first line and what Playwright
// received, so a miss says which way it missed (the Electron rig's form).
function notReached(error: unknown): string {
  const lines = stripVTControlCharacters(error instanceof Error ? error.message : String(error)).split('\n');
  const reason = lines[0]!.trim();
  const log = lines.findIndex((line) => /^\s*Call log:/.test(line));
  const found = (log < 0 ? lines : lines.slice(0, log)).slice(1).map((line) => line.trim()).filter((line) => /^(Received|Error)\b/.test(line) || /failed$/.test(line));
  return (found.length === 0 ? reason : `${reason}: ${found.join(' · ')}`).slice(0, 300);
}

// Whether this build is the word cut's M3: its stylesheet holds the touch rule (`[data-touch-fact]`, ui/touch-fact.tsx,
// drawn under `(hover: none)` alone), which master's does not. Read from the loaded app, which must have its stylesheet.
async function cutBuild(page: Page): Promise<boolean> {
  const { rules, touch } = await page.evaluate(() => {
    let rules = 0;
    let touch = false;
    const walk = (list: CSSRuleList) => {
      for (const rule of list) {
        rules++;
        if (rule instanceof CSSStyleRule && rule.selectorText.includes('[data-touch-fact')) touch = true;
        if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // a sheet of another origin: not the app's
      }
    }
    return { rules, touch };
  });
  if (rules < 100) throw new Error(`the app's stylesheet is not loaded (${rules} rules), so the build cannot be read`);
  if (run.cut !== null && run.cut !== touch) throw new Error(`the build read differently in one run: ${run.cut} then ${touch}`);
  run.cut = touch;
  return touch;
}

// The page at rest: the pointer aside (no tip opened by a press), fonts in, finite animations finished.
async function settle(page: Page) {
  await page.mouse.move(1, 1);
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
  });
  await page.locator('[role="tooltip"]').first().waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

// One scene: `prepare` drives the desk to the state; `check` proves it in the build's own terms (`cut`) right before the
// capture. Either failing leaves the scene not reached, with what Playwright saw, and the run goes on.
async function shot(page: Page, meta: Meta, prepare: () => Promise<void>, check: (cut: boolean) => Promise<void>) {
  META.push(meta);
  const errors: string[] = []; // the page's own errors, said with a miss
  page.on('pageerror', (error) => errors.push(error.message.split('\n')[0]!));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text().split('\n')[0]!);
  });
  for (const old of [`${meta.id}.png`, `_miss-${meta.id}.png`]) rmSync(join(OUT, old), { force: true }); // never a picture of an earlier run
  try {
    await prepare();
    await settle(page);
    const cut = await cutBuild(page);
    const phone = meta.viewport === PHONE_NAME;
    expect(await page.evaluate((query) => matchMedia(query).matches, phone ? '(hover: none)' : '(hover: hover)'), phone ? '(hover: none) matches on the phone' : '(hover: hover) matches on the desktop').toBe(true);
    await check(cut);
    await page.screenshot({ path: join(OUT, `${meta.id}.png`), animations: 'disabled', caret: 'hide' });
    results.push({ id: meta.id, ok: true, build: buildKey() });
  } catch (error) {
    const message = `${notReached(error)}${errors.length > 0 ? ` (page errors: ${errors.join(' | ')})` : ''}`.slice(0, 500);
    results.push({ id: meta.id, ok: false, error: message, build: buildKey() });
    await page.screenshot({ path: join(OUT, `_miss-${meta.id}.png`) }).catch(() => {}); // what the miss looked like, for a person
    console.log(`[desk words] ${meta.id} not reached: ${message}\n${error instanceof Error ? error.stack : String(error)}`);
  }
  writeRun();
}

// A scene as its own test, with its own hub double and page; skipped when WORDS_ONLY leaves it out.
function scene(meta: Meta, body: (page: Page, hub: HubDouble, meta: Meta) => Promise<void>) {
  test(meta.id, async ({ page, hub }) => {
    test.skip(!wanted(meta.id), 'not in WORDS_ONLY');
    await body(page, hub, meta);
  });
}

const cleanup: Array<() => void> = [];
test.afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
});

// ---- the desk's fixtures as the scenes use them ----------------------------------------------------------------------
const DIFF = readFileSync(join(TWO_SUBAGENTS, 'diff.patch'), 'utf8');
// An invented file with three hunks, so the Diff tab's hunk counter has somewhere to go
const SHELF = 'src/shelf.ts';
const SHELF_DIFF = [
  `diff --git a/${SHELF} b/${SHELF}`,
  'index 1a2b3c4..5d6e7f8 100644',
  `--- a/${SHELF}`,
  `+++ b/${SHELF}`,
  '@@ -1,3 +1,3 @@',
  ' export const shelves = [',
  "-  'top',",
  "+  'upper',",
  "   'middle',",
  '@@ -20,3 +20,4 @@ export function find(item: string) {',
  '   const shelf = index(item);',
  "+  if (shelf === null) return 'unknown';",
  '   return shelf;',
  ' }',
  '@@ -40,3 +41,3 @@ export function label(shelf: string) {',
  '-  return shelf.toUpperCase();',
  '+  return shelf.toLowerCase();',
  ' }',
  ' ',
  '',
].join('\n');

/** The staged project with the two-subagents recording played through as maws-45's session, its depth column open. */
async function openDepth(page: Page, hub: HubDouble, setUp: (player: DepthPlayer) => void): Promise<{ player: DepthPlayer; depth: Locator }> {
  await stageProject(hub);
  const player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks });
  cleanup.push(() => player.stop());
  player.skip(player.script.length); // both agents done, the session's answer in
  setUp(player);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const depth = page.getByTestId('depth');
  await expect(depth).toHaveAttribute('data-session', S.asks);
  await expect.poll(() => player.subscriptions(), { message: 'the session subscribed' }).toBe(1);
  return { player, depth };
}

/** The fake machine replaying `recording` as `producer`, its session joined, and the browser on its channel. */
async function openReplay(page: Page, hub: HubDouble, recording: Recording, producer: 'dc3' | 'dc8'): Promise<FakeMachineReplay> {
  const MACHINE = 'fake';
  await stageProject(hub);
  const fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { recording, producer });
  cleanup.push(() => fm.stop());
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: fm.recording.cwd, branch: 'main' }] },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${fm.session}`, kind: 'joined', session: fm.session, alias: 'fakerec', name_source: 'user', machine: MACHINE, cwd: fm.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  fm.sendPresence();
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${fm.session}`);
  await expect(page.getByTestId('session-view')).toHaveAttribute('data-session', fm.session);
  await expect.poll(() => fm.subscriptions(), { message: 'the session subscribed' }).toBe(1);
  return fm;
}

/**
 * Where a recording's agents are at work: just past the result row of its last `Agent` call (both launched), before any
 * agent's task notification (the parent's row still reads them working). Throws when the recording has no such point.
 */
function agentsAtWork(recording: Recording): number {
  const calls = recording.rows.main.flatMap((row) => {
    const content = (row.message as { content?: unknown } | undefined)?.content;
    return Array.isArray(content) ? content.flatMap((c: { type?: string; name?: string; id?: string }) => (c?.type === 'tool_use' && c.name === 'Agent' && c.id ? [c.id] : [])) : [];
  });
  if (calls.length === 0) throw new Error(`the recording ${recording.name} launches no agent`);
  const names = (text: string) => (step: Step) => step.k === 'row' && JSON.stringify(step.row).includes(text);
  const launched = recording.steps.findIndex(names(`"tool_use_id":"${calls.at(-1)}"`));
  const notified = recording.steps.findIndex(names('<task-notification>'));
  if (launched < 0 || (notified >= 0 && notified < launched)) throw new Error(`the recording ${recording.name} has no point where its agents are all launched and none has reported`);
  return launched + 1;
}

// A turn a touch scene adds to the session-view recording, after its last turn and before the session ends (as
// long-inputs.ts adds one): one of MAWS's own tool calls, which the recordings do not hold, written as the engine writes
// its rows — a historical browser call (`mcp__maws__browser_navigate`) with its result, the time it took and a wait for
// the person; or an ask (`mcp__maws__ask`) that never got a result before its turn closed, which the transcript reads as
// cancelled ("the session ended"). One call a turn. A delivered file (`mcp__maws__send_file`) has no scene: its row's
// file buttons read MAWS's bridge (`ipc.localMachine`), which the desk lacks, so the desk fails to load on one (word cut
// M3, task 9's report). Invented content throughout.
type TouchCall = 'ask' | 'browser';
const TOUCH = { tab: 'b_0123456789ab', url: 'https://example.com/shelves', answer: 'The labels are printed; the casing question can wait.' };
function withTouchTurn(recording: Recording, part: TouchCall): Recording {
  const main = recording.rows.main;
  const lastRow = main.at(-1)!;
  const end = recording.steps.findIndex((s) => s.k === 'presence' && s.record === null);
  if (end < 0) throw new Error(`the recording ${recording.name} has no end`);
  const at = recording.steps[end]!.at - 1;
  const base = Date.parse(String(lastRow.timestamp)) + 60_000;
  let parent = lastRow.uuid;
  const envelope = (i: number) => {
    const uuid = `70c4f00d-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const row = { uuid, parentUuid: parent, timestamp: new Date(base + i * 1000).toISOString(), sessionId: recording.session, isSidechain: false, userType: 'external', cwd: lastRow.cwd, version: lastRow.version, entrypoint: 'cli' };
    parent = uuid;
    return row;
  };
  const call = (i: number, id: string, name: string, input: JsonObject) => ({
    ...envelope(i),
    type: 'assistant',
    message: { id: `msg_touch${i}`, role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
  });
  const result = (i: number, id: string, json: JsonObject) => ({
    ...envelope(i),
    type: 'user',
    promptId: 'p-touch',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: JSON.stringify(json) }], is_error: false }] },
  });
  const calls: Record<TouchCall, JsonObject[]> = {
    browser: [
      call(2, 'toolu_touch_nav', 'mcp__maws__browser_navigate', { tabId: TOUCH.tab, url: TOUCH.url }),
      result(3, 'toolu_touch_nav', { status: 'ok', tabId: TOUCH.tab, url: TOUCH.url, title: 'Shelves', ms: 1240, waitedFor: 'human', waitedMs: 3000 }),
    ],
    ask: [call(2, 'toolu_touch_ask', 'mcp__maws__ask', { title: 'Label casing', questions: [{ question: 'Which casing do the labels use?', modality: 'choice', options: [{ label: 'lower' }, { label: 'upper' }] }] })],
  };
  const rows: JsonObject[] = [
    { ...envelope(1), type: 'user', origin: { kind: 'human' }, promptId: 'p-touch', message: { role: 'user', content: 'Check the shelf page, then ask me about the label casing.' } },
    ...calls[part],
    {
      ...envelope(7),
      type: 'assistant',
      message: { id: 'msg_touch7', role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'text', text: `<message>${TOUCH.answer}</message>` }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
    },
    { ...envelope(8), type: 'system', subtype: 'turn_duration', durationMs: 8000, isMeta: false },
  ];
  const steps: Step[] = rows.map((row) => ({ at, k: 'row', agentId: null, row: row as never }));
  return { ...recording, rows: { ...recording.rows, main: [...main, ...(rows as never[])] }, steps: [...recording.steps.slice(0, end), ...steps, ...recording.steps.slice(end)] };
}

/** The touch turn played in on the phone, every row in and the session still running; `target` in view in the session view. */
async function openTouchTurn(page: Page, hub: HubDouble, part: TouchCall, target: (view: Locator) => Locator): Promise<Locator> {
  const recording = withTouchTurn(loadRecording(SESSION_VIEW), part);
  const fm = await openReplay(page, hub, recording, 'dc8');
  fm.step(recording.steps.findIndex((s) => s.k === 'presence' && s.record === null));
  const view = channel(page).getByTestId('session-view');
  await expect(view).toContainText(TOUCH.answer);
  await view.locator('[data-transcript-scroller]').first().evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  // A call the report view folds into the turn's working record (a browser action, unlike an ask, does
  // not stay in view): the record unfolded, then its run of calls opened, each one tap, as phone.spec.ts does.
  const opens = [view.locator('[data-row-id^="record-fold:closed:toolu_touch_"] button'), view.locator(`[data-turn-id] .transcript-run-line[aria-expanded="false"]`).last()];
  for (const open of opens) if ((await target(view).count()) === 0 && (await open.count()) > 0) await open.click();
  const found = target(view);
  await expect(found, 'the surface in the session view').toHaveCount(1);
  await found.scrollIntoViewIfNeeded();
  await expect(found).toBeInViewport();
  return found;
}

/** A touch scene's check: on the cut's build the surface's fact drawn at rest and reading `text`; on master's, none. */
async function touchFact(surface: Locator, cut: boolean, text: string | RegExp) {
  const fact = surface.locator('[data-touch-fact]');
  if (!cut) return expect(fact, 'no touch fact on master').toHaveCount(0);
  await expect(fact, 'its touch fact').toHaveCount(1);
  await expect(fact).toBeVisible();
  await expect(fact).not.toHaveCSS('display', 'none');
  await expect(fact).toHaveText(text);
}

const channel = (page: Page) => page.getByRole('region', { name: 'Channel' });

// ---- desktop ---------------------------------------------------------------------------------------------------------
test.describe('desktop', () => {
  test.use({ viewport: DESKTOP });

  scene(
    {
      id: 'desk-diff-hunk',
      title: "The Diff tab's hunk counter, on a file's second hunk",
      how: `The staged project; maws-45's session plays the two-subagents recording through; its diff is the recording's with an invented third file of three hunks (${SHELF}); Diff tab, that file selected, the next-hunk arrow pressed once`,
      state: 'The cut: the counter reads "Hunk 2 of 3", MAWS\'s shared words for the counter\'s name, in the desk\'s own plain form (the desk\'s frozen Diff tab keeps master\'s layout). Master: "Showing hunk 2 of 3"',
      viewport: DESKTOP_NAME,
      rows: ['T306'],
    },
    async (page, hub, meta) => {
      let diff: Locator | null = null;
      await shot(
        page,
        meta,
        async () => {
          const { depth } = await openDepth(page, hub, (player) => (player.diff = { base: 'main', text: `${DIFF}${SHELF_DIFF}` }));
          await depth.getByTestId('depth-tab-diff').click();
          diff = depth.getByTestId('depth-diff');
          await diff.locator(`[data-path="${SHELF}"]`).click();
          await expect(diff.locator('[data-review-file-header]')).toContainText(SHELF);
          await diff.locator('[data-review-hunk] ~ button').nth(1).click(); // ↑ then ↓: the next hunk
          await expect(diff.locator('[data-review-body]')).toBeVisible();
        },
        async (cut) => {
          const counter = diff!.locator('[data-review-hunk]');
          await expect(counter).toHaveText(cut ? 'Hunk 2 of 3' : 'Showing hunk 2 of 3'); // REVIEW_COPY.hunkOf on each build
        },
      );
    },
  );
});

// ---- phone -----------------------------------------------------------------------------------------------------------
// The touch rule (ticket 830): a fact the cut moved into a tip is drawn at rest where nothing can point. One picture per
// surface the desk's phone draws and its fixtures reach. On master no `[data-touch-fact]` exists: its form of each scene
// is the same surface at rest with what master draws there.
test.describe('phone', () => {
  test.use(PHONE);

  scene(
    {
      id: 'desk-phone-subagents',
      title: "A subagent row on the phone while its agents work",
      how: "The staged project; the fake machine replays the session-view recording as a DC8 producer to just past its second Agent call's result (both agents launched, none reported); the phone on the session's channel",
      state: 'The cut: under the row\'s line, each working agent\'s "<name> · <tool> · <time>" drawn at rest, one a line. Master: the row at rest, working, with no such lines',
      viewport: PHONE_NAME,
      rows: ['T87', 'ticket 830'],
    },
    async (page, hub, meta) => {
      let row: Locator | null = null;
      await shot(
        page,
        meta,
        async () => {
          const recording = loadRecording(SESSION_VIEW);
          const fm = await openReplay(page, hub, recording, 'dc8');
          fm.step(agentsAtWork(recording));
          const view = channel(page).getByTestId('session-view');
          row = view.locator('.transcript-subagent').first();
          await expect(row).toBeAttached();
          if (!(await row.isVisible())) await revealEarlier(view, row);
          await row.scrollIntoViewIfNeeded();
          await expect(row).toBeInViewport();
        },
        async (cut) => {
          await expect(row!).not.toHaveAttribute('data-status', /^(finished|finished_with_errors|stopped)$/);
          const fact = row!.locator('[data-touch-fact]');
          if (cut) {
            await expect(fact).toBeVisible();
            await expect(fact).toHaveCSS('display', 'block');
            await expect(fact).toHaveText(/ · \d/); // "<name> · [<tool> · ]<time>"
          } else {
            await expect(fact).toHaveCount(0);
          }
        },
      );
    },
  );
  scene(
    {
      id: 'desk-phone-ask',
      title: "An ask's capsule on the phone, cancelled because its turn closed unanswered",
      how: 'The staged project; the fake machine replays the session-view recording as a DC8 producer with an invented turn added (a maws ask with no result before its turn ends), played to the session\'s end; the phone on the session\'s channel, at the bottom',
      state: 'The cut: the chip reads Cancelled and its why ("The session ended") is drawn at rest after it. Master: the chip at rest, the why only its tooltip',
      viewport: PHONE_NAME,
      rows: ['T97', 'ticket 830'],
    },
    async (page, hub, meta) => {
      let ask: Locator | null = null;
      await shot(
        page,
        meta,
        async () => {
          ask = await openTouchTurn(page, hub, 'ask', (view) => view.locator('.transcript-ask[data-ask-state="cancelled"]'));
        },
        async (cut) => {
          await expect(ask!.locator('[data-ask-chip]')).toBeVisible();
          await touchFact(ask!, cut, 'The session ended'); // the cut's words (ASK.why.ended)
        },
      );
    },
  );

  scene(
    {
      id: 'desk-phone-browser',
      title: "A browser action's row on the phone",
      how: 'As desk-phone-ask: the invented turn\'s maws browser_navigate call, done in 1.24 s after a 3 s wait for the person',
      state: 'The cut: the time it took and its wait drawn at rest on the line. Master: the line at rest, the time only its tooltip',
      viewport: PHONE_NAME,
      rows: ['T105', 'T106', 'ticket 830'],
    },
    async (page, hub, meta) => {
      let row: Locator | null = null;
      await shot(
        page,
        meta,
        async () => {
          row = await openTouchTurn(page, hub, 'browser', (view) => view.locator('.transcript-browser-action[data-state="done"]'));
        },
        async (cut) => {
          await expect(row!.locator('[data-browser-heading]')).toBeVisible();
          await touchFact(row!, cut, /\d.* · .*\d/); // "<took> · <waited>"
        },
      );
    },
  );
});
