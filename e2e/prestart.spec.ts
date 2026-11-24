// The prestart's scenes (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md, A1 to A4, D8 to D10): a
// New chat's engine starts at the composer's first keystroke and Send takes it. Each scene launches the app with
// MAWS_E2E_PRESTART=1 (under MAWS_E2E the prestart is off without it, and it never runs on the replay seam or the stub
// session source, D9), on test/support/latency-engine-stub.mjs through MAWS_E2E_ENGINE_BIN: a real engine process the
// engine host launches, which writes one line per process start to its starts file, so engine starts are counted
// outside the journal and each started engine can be asked whether it still runs. The folder is trusted, the user's
// default mode `default` and the profile's default route direct, so the New chat's start guards pass with no card.
//
//   1. Typing starts one engine in the chat's folder, which nothing lists; Send takes it: one start in all, the record
//      pinned to that engine's session id, and its turn plays (A1, A2).
//   2. A model picked before Send relaunches the prestart with it; Send takes the relaunched engine, the one left running
//      (A3, D6).
//   3. A chat emptied and closed: its engine ends and leaves no file (A4, D9).
//   4. A draft restored by a relaunch starts nothing until the person edits it (D10).
//   5. The held Tools pick of e2e/sessions.spec.ts with the prestart on: the choice still being written when Send is
//      pressed is the launch's, the prestart made before it is not taken, and one engine runs (A3).
// The machine menu's pick of another machine, which withdraws the prestart (D8), needs a second machine: it is
// e2e/remote.spec.ts's scene "ticket 851: a New chat …", on e2e:remote's two profiles.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { writeLatencyEngine } from '../test/support/latency-engine';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { killScratchProcesses } from './support/processes';
import { adoptedPrestart, composer, engineRunning, journalFiles, newChatTab, runningEngines, spawnRowOf, startedEngines } from './support/prestart';
import { expectNewChatInFront } from './support/screen-reader-only';

test.describe.configure({ timeout: 180_000 });

const START_MS = 30_000; // a prestart's process appears this soon after the first keystroke, or the case fails
const END_MS = 30_000; // an ended prestart's process is gone within its stop ladder

interface Scene {
  root: string;
  repo: string;
  userData: string;
  startsFile: string;
  bin: string;
}
let scene: Scene | null = null;
const launches: MawsLaunch[] = [];

function newScene(): Scene {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-prestart-')));
  const repo = join(root, 'repo');
  const userData = join(root, 'ud');
  mkdirSync(repo);
  mkdirSync(userData);
  const startsFile = join(root, 'starts.jsonl');
  const bin = writeLatencyEngine(join(root, 'latency-engine'), join(root, 'samples.jsonl'), { startsFile });
  scene = { root, repo, userData, startsFile, bin };
  return scene;
}

// One launch over the scene's profile, the prestart on; `env` adds to it.
async function launch(s: Scene, env: Record<string, string> = {}): Promise<MawsLaunch> {
  const maws = await launchMaws({
    userData: s.userData,
    syntheticEngineBin: s.bin,
    defaultRoute: 'direct', // the stub's get_status answers a direct launch's
    env: { MAWS_E2E_ENGINE_BIN: s.bin, MAWS_E2E_PRESTART: '1', ...env },
    prepare: ({ claudeConfigDir }) => {
      writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ projects: { [s.repo]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
      writeFileSync(join(claudeConfigDir, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
    },
  });
  launches.push(maws);
  return maws;
}

test.afterEach(async () => {
  for (const maws of launches.splice(0).reverse()) await maws.cleanup().catch((error: unknown) => console.error(error));
  const s = scene;
  scene = null;
  if (s === null) return;
  try {
    await killScratchProcesses(s.root, []);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

// The prestart's engine, once typing has started it: the scene's only start so far, in the chat's folder.
async function prestarted(s: Scene, count = 1): Promise<void> {
  await expect.poll(() => startedEngines(s.startsFile).length, { timeout: START_MS, message: 'typing in the New chat starts its engine' }).toBe(count);
  expect(startedEngines(s.startsFile).at(-1)!.cwd, 'the prestart runs in the chat’s folder').toBe(s.repo);
}

// The session's turn played to its end: the stub's last marker in the transcript, then the session ready and idle.
async function turnPlayed(page: Page, id: string): Promise<void> {
  await expect(page.locator('[data-region="main"]').getByText(/⟦t1:300⟧/).first(), 'the reply’s last marker shown').toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => {
    const status = await invoke(page, 'session.status', { appSessionId: id as never });
    return status.ok ? `${status.value.process}/${status.value.turn === null ? 'idle' : 'turn'}` : status.error.code;
  }, { timeout: 30_000 }).toBe('ready/idle');
}

const listed = async (page: Page, id: string) => value(await invoke(page, 'engine.sessions', undefined)).some((row) => row.appSessionId === id);

test('typing in a New chat starts its engine in the chat’s folder, which nothing lists; Send takes it: one engine start, the record pinned to it, the turn played (A1, A2)', async () => {
  const s = newScene();
  const maws = await launch(s);
  const { page } = maws;
  const { id } = await newChatTab(page, s.repo);
  await composer(page).click();
  await page.keyboard.type('Tell me what this folder holds.');
  await prestarted(s);
  const [engine] = startedEngines(s.startsFile);
  expect(engine!.args, 'launched with a pinned session id').toContain('--session-id');
  expect(await listed(page, id), 'the prestarted engine is no session anything lists (D2)').toBe(false);
  await page.keyboard.press('Enter');
  await turnPlayed(page, id);
  expect(startedEngines(s.startsFile), 'Send started no engine of its own').toHaveLength(1);
  expect(adoptedPrestart(s.userData, id), 'the session’s journal says Send took the prestart').toBe(true);
  expect(value(await invoke(page, 'session.get', { appSessionId: id as never }))!.engineSessionId, 'the record’s pin is the engine’s').toBe(engine!.sessionId);
  expect(runningEngines(s.startsFile).map((e) => e.pid), 'the engine runs on as the session’s').toEqual([engine!.pid]);
  expect(maws.consoleErrors()).toEqual([]);
});

test('a model picked before Send relaunches the prestart with it; Send takes the relaunched engine, the one left running (A3, D6)', async () => {
  const s = newScene();
  const maws = await launch(s);
  const { page } = maws;
  const { id } = await newChatTab(page, s.repo);
  await composer(page).click();
  await page.keyboard.type('Plan the change, then wait.');
  await prestarted(s);
  const [first] = startedEngines(s.startsFile);
  // the pick, through the command the model chip calls; its patch asks the prestart again with the new spec
  value(await invoke(page, 'session.intent.patch', { appSessionId: id as never, patch: { model: 'opus' } }));
  await prestarted(s, 2);
  const second = startedEngines(s.startsFile)[1]!;
  expect(second.args.slice(second.args.indexOf('--model'), second.args.indexOf('--model') + 2), 'the relaunch carries the pick').toEqual(['--model', 'opus']);
  await expect.poll(() => engineRunning(first!.pid), { timeout: END_MS, message: 'the first prestart ended with its replacement' }).toBe(false);
  await composer(page).click();
  await page.keyboard.press('Enter');
  await turnPlayed(page, id);
  expect(startedEngines(s.startsFile), 'Send started no engine of its own').toHaveLength(2);
  expect(adoptedPrestart(s.userData, id), 'Send took the relaunched prestart').toBe(true);
  expect(value(await invoke(page, 'session.get', { appSessionId: id as never }))!.engineSessionId).toBe(second.sessionId);
  expect(runningEngines(s.startsFile).map((e) => e.pid), 'one engine runs: the relaunched one').toEqual([second.pid]);
  expect(maws.consoleErrors()).toEqual([]);
});

test('a New chat emptied and closed: its prestarted engine ends and leaves no file (A4, D9)', async () => {
  const s = newScene();
  const maws = await launch(s);
  const { page } = maws;
  const { id } = await newChatTab(page, s.repo);
  await composer(page).click();
  await page.keyboard.type('Never mind.');
  await prestarted(s);
  const [engine] = startedEngines(s.startsFile);
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await expect(composer(page), 'the chat is blank').toHaveText('');
  expect(engineRunning(engine!.pid), 'emptying the box does not end the prestart (D9)').toBe(true);
  // ⌘W, the File menu's Close Tab clicked in main (Playwright's keyboard never reaches a macOS menu accelerator); a
  // blank chat closes with no confirmation, and its intent's discard forgets the id
  const closed = await maws.app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('tab.close');
    if (!item?.enabled) return false;
    item.click();
    return true;
  });
  expect(closed, 'Close Tab exists and is enabled').toBe(true);
  await expect.poll(async () => value(await invoke(page, 'session.intent.list', undefined)).intents.some((i) => i.appSessionId === id), { message: 'the blank chat’s intent discarded' }).toBe(false);
  await expect.poll(() => engineRunning(engine!.pid), { timeout: END_MS, message: 'the prestarted engine ends with its chat' }).toBe(false);
  expect(journalFiles(s.userData, id), 'no journal or host map written for it').toEqual([]);
  expect(await listed(page, id)).toBe(false);
  expect(startedEngines(s.startsFile)).toHaveLength(1);
  expect(maws.consoleErrors()).toEqual([]);
});

test('a draft a relaunch restores starts nothing until the person edits it; the edit starts its engine (D10)', async () => {
  const s = newScene();
  const first = await launch(s);
  const { id, project } = await newChatTab(first.page, s.repo);
  await composer(first.page).click();
  await first.page.keyboard.type('half a thought');
  await expect.poll(async () => JSON.stringify(value(await invoke(first.page, 'session.intent.get', { appSessionId: id as never }))!.draft), { message: 'the draft written' }).toContain('half a thought');
  await prestarted(s);
  // the app quit and every process of the profile ended (its mawsd holds the spine, and the prestart dies with the
  // connection that asked for it), then the app launched again over the profile
  await first.cleanup();
  launches.splice(launches.indexOf(first), 1);
  await expect.poll(() => runningEngines(s.startsFile), { timeout: END_MS, message: 'nothing of the first launch runs' }).toEqual([]);
  const second = await launch(s);
  const page = second.page;
  await expectNewChatInFront(page, project, { message: 'the chat with its draft is back in front' });
  await expect(composer(page), 'its draft is back in the composer').toHaveText('half a thought');
  // a window for a start the restore might make (none may): the restored composer has loaded and told its spine
  // whatever it tells at a load
  await page.waitForTimeout(3_000);
  expect(startedEngines(s.startsFile), 'the restored draft started nothing').toHaveLength(1);
  await composer(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(', then the rest');
  await prestarted(s, 2);
  expect(second.consoleErrors()).toEqual([]);
});

// e2e/sessions.spec.ts's "a Tools choice still being written when Send is pressed is in that launch's spawn row" (board
// ticket 854), with the prestart on: typing prestarts the engine with the machine's default set, the choice is held at
// the spine (MAWS_E2E_INTENT_PATCH_HOLD, src/services/sessions/e2e-patch-hold.ts) while Send is pressed, and once the
// hold lifts the launch Send makes carries the choice; the prestart made with the default set is not taken (its spec
// differs, D4 and D6), and one engine runs, the session's.
test('the held Tools pick with the prestart on: the choice still being written when Send is pressed is the launch’s, the prestart made before it is not taken, and one engine runs (A3)', async () => {
  const s = newScene();
  const hold = join(s.root, 'e2e-intent-patch-hold');
  const maws = await launch(s, { MAWS_E2E_INTENT_PATCH_HOLD: hold });
  const { page } = maws;
  await page.evaluate(() => {
    const log: unknown[] = [];
    (window as unknown as { __setup: unknown[] }).__setup = log;
    window.maws.on('session.setup', (payload) => log.push(payload));
  });
  type Setup = { appSessionId: string; phase: string };
  const phasesOf = async (id: string) => ((await page.evaluate(() => (window as unknown as { __setup: Setup[] }).__setup)) as Setup[]).filter((e) => e.appSessionId === id).map((e) => e.phase);
  const { id } = await newChatTab(page, s.repo);
  await composer(page).click();
  await page.keyboard.type('Run with the tools I chose.');
  await prestarted(s);
  const [early] = startedEngines(s.startsFile);
  // the choice, by keyboard in the "+" menu, its write held at the spine
  writeFileSync(hold, '');
  await page.locator('[data-region="main"]').getByRole('button', { name: 'Add files, photos or commands' }).focus();
  await page.keyboard.press('Enter');
  const tools = page.getByRole('menuitem', { name: 'Tools' });
  await expect(tools).toBeVisible();
  await page.keyboard.press('End');
  await expect(tools).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const artifacts = page.getByRole('menuitemcheckbox', { name: 'Artifacts' });
  await expect(artifacts).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(artifacts, 'the menu shows the choice being written').toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(tools).toHaveCount(0);
  expect(value(await invoke(page, 'session.intent.get', { appSessionId: id as never }))!.mawsTools, 'the write is held: the intent has no set yet').toBeUndefined();
  const control = page.locator('[data-region="main"] [data-submit-state]');
  await expect(control).toHaveText('Send');
  await control.click();
  // Send waits for the write: no setup phase while it is held (a window that only stages the premise, not a bound)
  await page.waitForTimeout(1_000);
  expect(await phasesOf(id), 'nothing starts while the choice is being written').toEqual([]);
  rmSync(hold);
  await expect.poll(() => phasesOf(id), { timeout: 30_000 }).toContain('ready');
  const off = { artifacts: false, documents: false, dashboards: false, auxiliary: true, question: 'maws' };
  expect(value(await invoke(page, 'session.get', { appSessionId: id as never }))!.mawsTools, 'the record holds the choice').toEqual(off);
  const status = value(await invoke(page, 'session.status', { appSessionId: id as never }));
  expect(spawnRowOf(s.userData, id, status.launchId)?.mawsTools, 'the choice in the launch’s own spawn row').toEqual(off);
  await expect.poll(() => engineRunning(early!.pid), { timeout: END_MS, message: 'the prestart made with the default set ended, not taken' }).toBe(false);
  await expect.poll(() => runningEngines(s.startsFile).map((e) => e.sessionId), { timeout: END_MS, message: 'one engine runs: the session’s' }).toEqual([status.engineSessionId]);
  expect(maws.consoleErrors()).toEqual([]);
});
