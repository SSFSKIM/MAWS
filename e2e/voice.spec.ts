// E9's push-to-talk dictation end to end (E9 execution document, M5 and Acceptance items 2 and 4). No case ever opens
// the microphone or raises a consent dialog:
// - The scripted cases launch with MAWS_E2E_VOICE set, so main chooses the scripted recognizer (Design §3) and each
//   case scripts its next answer on main's `process.env` before the hold, reading what main asked from the stub's log
//   (`globalThis.__mawsVoiceScript`). They drive the `#composer` harness page (C7's, with the app's DictationKeys
//   mounted) over an unstarted session and the page's stub of C10's intent, so an unstarted composer is shown to take
//   dictation and Enter's send is read from the stub's `starts`. `pnpm e2e:voice` builds the harness and runs this file;
//   under a plain build those cases skip. One more scripted case opens the app's own Settings › Voice.
// - The packaged case runs only against `MAWS_E2E_EXECUTABLE` and launches without MAWS_E2E_VOICE, so main runs the
//   bundled helper probe-only: `voice.status` is answered by the real helper and `voice.start` is refused.
// `composer.dictate` is unbound by default (M6), so the hold cases bind it to ⌥Space first through the app's own
// `settings.set`, as Settings › Keyboard would. The hold is ⌥Space as Playwright presses it: Alt down, Space down (a
// second Space down carries `repeat`), Space up, Alt up. The toolbar microphone is a click toggle. Interim text is the editor's `.text-fg-muted` span; settled text is the editor's text. With MAWS_E9_SHOTS
// naming a directory the scripted cases leave dictation-listening.png, dictation-denied.png and settings-voice.png there.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import type { CardsHarnessApi, HarnessIntent, HarnessPane } from '../src/renderer/src/harness/composer/api';
import { invoke, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

const PACKAGED = Boolean(process.env.MAWS_E2E_EXECUTABLE);
// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now.
const HARNESS_BUILT = !PACKAGED && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
const SHOTS = process.env.MAWS_E9_SHOTS ? resolve(REPO_ROOT, process.env.MAWS_E9_SHOTS) : null;

// The scripted recognizer's script (src/main/voice/scripted-backend.ts); every field optional.
interface VoiceScript {
  permission?: { microphone: string; speech: string };
  startedDelayMs?: number;
  partials?: string[];
  partialDelayMs?: number;
  final?: string;
  lateAfterFinal?: boolean;
  error?: { code: string; message: string } | null;
  helper?: 'ready' | 'missing';
}
interface VoiceLog {
  starts: { captureId: string; locale: string | null }[];
  stops: string[];
  cancels: string[];
  privacyPanes: string[];
}

const backendOf = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __mawsVoiceBackend?: string }).__mawsVoiceBackend ?? null);

async function launchScripted(env: Record<string, string>): Promise<MawsLaunch> {
  const maws = await launchMaws({ env: { MAWS_E2E_VOICE: '{}', ...env } });
  try {
    expect(await backendOf(maws.app), 'the backend is chosen at startup from MAWS_E2E_VOICE').toBe('scripted');
  } catch (error) {
    await maws.cleanup();
    throw error;
  }
  return maws;
}

const test = base.extend<{ voice: MawsLaunch; voiceApp: MawsLaunch; packagedVoice: MawsLaunch }>({
  // The `#composer` harness page over the scripted recognizer.
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  voice: async ({}, use, testInfo) => {
    testInfo.skip(!HARNESS_BUILT, 'the composer page needs a harness build (pnpm e2e:voice)');
    const maws = await launchScripted({ MAWS_HARNESS: '1' });
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
  },
  // The app itself (its Settings tab) over the scripted recognizer.
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  voiceApp: async ({}, use, testInfo) => {
    testInfo.skip(PACKAGED, 'the scripted recognizer is proven on the development build; the packaged run proves the helper');
    const maws = await launchScripted({ MAWS_HARNESS: '0' });
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
  },
  // The packaged app without a script: the bundled helper, probe-only. The launcher copies the runner's environment,
  // so a MAWS_E2E_VOICE the runner's shell carries is taken out of it for the launch.
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  packagedVoice: async ({}, use, testInfo) => {
    testInfo.skip(!PACKAGED, 'the probe-only case runs against the packaged app (MAWS_E2E_EXECUTABLE)');
    const inherited = process.env.MAWS_E2E_VOICE;
    delete process.env.MAWS_E2E_VOICE;
    let maws: MawsLaunch;
    try {
      maws = await launchMaws();
    } finally {
      if (inherited !== undefined) process.env.MAWS_E2E_VOICE = inherited;
    }
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
  },
});

let scratch: string;
test.beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e9-voice-')));
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// ---- the harness page and the stub's log -------------------------------------------------------------------------

type CardsWindow = Window & { __maws_cards: CardsHarnessApi };

const cards = <K extends keyof CardsHarnessApi>(page: Page, name: K, ...args: Parameters<CardsHarnessApi[K]>) =>
  page.evaluate(([n, a]) => ((window as unknown as CardsWindow).__maws_cards[n] as (...x: unknown[]) => unknown)(...(a as unknown[])), [name, args] as const) as Promise<ReturnType<CardsHarnessApi[K]>>;
const pane = (page: Page, index: 0 | 1) => page.getByRole('region', { name: `pane ${index}` });
const messageIn = (page: Page, index: 0 | 1) => pane(page, index).getByRole('textbox', { name: 'Message', exact: true });
const interimIn = (page: Page, index: 0 | 1) => messageIn(page, index).locator('.text-fg-muted');
const statusIn = (page: Page, index: 0 | 1) => pane(page, index).getByRole('status', { name: 'Dictation' });
const noticeIn = (page: Page, index: 0 | 1) => pane(page, index).getByRole('note', { name: 'Dictation notice' });

const script = (app: ElectronApplication, next: VoiceScript) => app.evaluate((_electron, json) => void (process.env.MAWS_E2E_VOICE = json), JSON.stringify(next));
const voiceLog = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __mawsVoiceScript: VoiceLog }).__mawsVoiceScript);

function intentAt(path: string): HarnessIntent {
  return { location: { kind: 'directory', path }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null };
}

// Binds the dictation hold to ⌥Space through the app's settings, and waits until the page's settings store has it (the
// toolbar microphone's tooltip names the chord).
async function bindDictate(page: Page): Promise<void> {
  const result = await page.evaluate(() => window.maws.invoke('settings.set', { keymap: { 'composer.dictate': 'Alt+Space' } }));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  await expect(pane(page, 0).getByRole('button', { name: 'Dictate' })).toHaveAttribute('title', /⌥Space/);
}

// The `#composer` page with unstarted sessions' composers (C10's intent stubbed), the dictation hold bound, focus in the
// first one's editor.
async function showComposers(page: Page, ids: [string] | [string, string]): Promise<void> {
  await page.evaluate(() => void (location.hash = 'composer'));
  await page.waitForFunction(() => (window as unknown as Partial<CardsWindow>).__maws_cards !== undefined);
  for (const id of ids) await cards(page, 'intent', id, intentAt(scratch));
  const panes: [HarnessPane, HarnessPane] = [{ composer: ids[0] }, ids[1] === undefined ? null : { composer: ids[1] }];
  await cards(page, 'show', panes);
  await expect(messageIn(page, 0)).toBeVisible();
  await bindDictate(page);
  await messageIn(page, 0).click();
}

const holdDown = async (page: Page) => {
  await page.keyboard.down('Alt');
  await page.keyboard.down('Space');
};
const holdUp = async (page: Page) => {
  await page.keyboard.up('Space');
  await page.keyboard.up('Alt');
};
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, name) });
};
// The editor's text as the human reads it, a hard break as a newline.
const linesOf = (page: Page, index: 0 | 1) => messageIn(page, index).evaluate((el) => (el as HTMLElement).innerText.replace(/\n$/, ''));

// ---- the scripted recognizer over the composer ----------------------------------------------------------------------

test('a hold shows Listening…, draws the partials greyed in place, settles the final on release, and ⌘Z removes it whole', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-hold']);
  await script(app, { partials: ['hello', 'hello world'], partialDelayMs: 600, final: 'Hello world.' });

  await holdDown(page);
  await page.keyboard.down('Space'); // the key's repeat: still one capture
  await expect(statusIn(page, 0)).toHaveText('Listening…');
  await expect(interimIn(page, 0)).toHaveText('hello');
  await expect(interimIn(page, 0)).toHaveText('hello world');
  await expect(interimIn(page, 0)).toHaveCount(1);
  await expect(messageIn(page, 0)).toHaveText('hello world'); // replaced, not appended; no space typed by the hold
  expect(await cards(page, 'dictation')).toEqual({ phase: 'listening', appSessionId: 'e9-hold' });
  await shot(page, 'dictation-listening.png');
  await holdUp(page);

  await expect(messageIn(page, 0)).toHaveText('Hello world.');
  await expect(interimIn(page, 0)).toHaveCount(0);
  await expect(statusIn(page, 0)).toHaveCount(0);
  expect(await cards(page, 'dictation')).toBeNull();
  const log = await voiceLog(app);
  expect(log.starts).toHaveLength(1);
  expect(log.stops).toEqual([log.starts[0]!.captureId]);
  expect(log.cancels).toEqual([]);

  await page.keyboard.press('Meta+z');
  await expect(messageIn(page, 0)).toHaveText('');
  await page.keyboard.press('Meta+z'); // nothing of the dictation is left to undo, no partial comes back
  await expect(messageIn(page, 0)).toHaveText('');
  expect(voice.consoleErrors()).toEqual([]);
});

test('dictation lands at a mid-paragraph caret with a leading space, and after a selection without replacing it', async ({ voice }) => {
  const { page } = voice;
  await showComposers(page, ['e9-caret', 'e9-selection']);

  // between `alpha` and ` beta`, with a hard break and a second line below
  await page.keyboard.type('alpha beta');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('gamma');
  await page.keyboard.press('Meta+ArrowUp'); // the document's start
  for (let i = 0; i < 'alpha'.length; i++) await page.keyboard.press('ArrowRight');
  await holdDown(page);
  await expect(interimIn(page, 0)).toHaveText('hello world');
  expect(await linesOf(page, 0)).toBe('alpha hello world beta\ngamma');
  await holdUp(page);
  await expect(interimIn(page, 0)).toHaveCount(0);
  await expect.poll(() => linesOf(page, 0)).toBe('alpha Hello world. beta\ngamma');

  // with `alpha` selected (Select All), the words go after it and `alpha` stays
  await messageIn(page, 1).click();
  await page.keyboard.type('alpha');
  await page.keyboard.press('Meta+a');
  await holdDown(page);
  await expect(interimIn(page, 1)).toHaveText('hello world');
  await expect(messageIn(page, 1)).toHaveText('alpha hello world');
  await holdUp(page);
  await expect(messageIn(page, 1)).toHaveText('alpha Hello world.');
  await expect(interimIn(page, 1)).toHaveCount(0);
  expect(voice.consoleErrors()).toEqual([]);
});

test('a release before the recognizer started cancels at once: no text, the control idle, nothing heard later', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-early']);
  await script(app, { startedDelayMs: 500 });

  await holdDown(page);
  expect(await cards(page, 'dictation'), 'still asking main when the hold ends').toMatchObject({ phase: 'requesting' });
  await page.waitForTimeout(50);
  await holdUp(page);
  await expect.poll(async () => (await voiceLog(app)).cancels).toHaveLength(1);
  const log = await voiceLog(app);
  expect(log.starts).toHaveLength(1);
  expect(log.cancels).toEqual([log.starts[0]!.captureId]);
  expect(log.stops).toEqual([]);
  expect(await cards(page, 'dictation')).toBeNull();
  await page.waitForTimeout(800); // past the scripted `started` and its partials
  await expect(messageIn(page, 0)).toHaveText('');
  await expect(statusIn(page, 0)).toHaveCount(0);
  await expect(noticeIn(page, 0)).toHaveCount(0); // a hold the human ended is not a failure
  expect(voice.consoleErrors()).toEqual([]);
});

test('letting go of ⌥ first ends the hold, and the still-held Space types nothing', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-alt-first']);

  await holdDown(page);
  await expect(interimIn(page, 0)).toHaveText('hello world');
  await page.keyboard.up('Alt');
  await expect(messageIn(page, 0)).toHaveText('Hello world.');
  expect(await cards(page, 'dictation')).toBeNull();
  for (let i = 0; i < 3; i++) await page.keyboard.down('Space'); // auto-repeat of the key still down, ⌥ up
  await page.keyboard.up('Space');
  await expect(messageIn(page, 0)).toHaveText('Hello world.');
  expect(await linesOf(page, 0)).toBe('Hello world.');
  expect((await voiceLog(app)).starts).toHaveLength(1);

  // after its own keyup the key types again
  await page.keyboard.press('Space');
  await page.keyboard.type('ok');
  await expect(messageIn(page, 0)).toHaveText('Hello world. ok');
  expect(voice.consoleErrors()).toEqual([]);
});

// Started from the toolbar microphone (a click), so the keyboard types without ⌥ held.
test('typing inside the greyed words keeps them and the letter, and ends the capture; the next partial changes nothing', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-edit-inside']);
  await script(app, { partials: ['hello world', 'never drawn'], partialDelayMs: 2000 });

  await pane(page, 0).getByRole('button', { name: 'Dictate' }).click();
  await expect(statusIn(page, 0)).toHaveText('Listening…');
  await expect(interimIn(page, 0)).toHaveText('hello world');
  await expect(messageIn(page, 0)).toBeFocused(); // the button leaves focus at the caret
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('x');

  await expect(messageIn(page, 0)).toHaveText('hello woxrld');
  await expect(interimIn(page, 0)).toHaveCount(0);
  expect(await cards(page, 'dictation')).toBeNull();
  await expect.poll(async () => (await voiceLog(app)).cancels).toHaveLength(1);
  await page.waitForTimeout(2500); // past the second partial's time
  await expect(messageIn(page, 0)).toHaveText('hello woxrld');
  const log = await voiceLog(app);
  expect(log.starts).toHaveLength(1);
  expect(log.cancels).toEqual([log.starts[0]!.captureId]);
  expect(log.stops).toEqual([]);
  expect(voice.consoleErrors()).toEqual([]);
});

test('the toolbar microphone toggles: a click starts listening, a second settles the final; a click while asking cancels', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-click']);
  await script(app, { partials: ['hello world'], partialDelayMs: 100, final: 'Hello world.' });
  const mic = pane(page, 0).getByRole('button', { name: 'Dictate' });
  await expect(mic).toHaveAttribute('title', 'Click to dictate · on this Mac · or hold ⌥Space');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');

  await mic.click();
  await expect(statusIn(page, 0)).toHaveText('Listening…');
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(interimIn(page, 0)).toHaveText('hello world');
  await expect(messageIn(page, 0)).toBeFocused(); // the words go to the caret; the button does not take focus
  await mic.click();
  await expect(messageIn(page, 0)).toHaveText('Hello world.');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect(interimIn(page, 0)).toHaveCount(0);
  await expect(statusIn(page, 0)).toHaveCount(0);
  let log = await voiceLog(app);
  expect(log.starts).toHaveLength(1);
  expect(log.stops).toEqual([log.starts[0]!.captureId]);

  // a second click before the recognizer started cancels: nothing is heard, nothing lands
  await script(app, { startedDelayMs: 500 });
  await mic.click();
  expect(await cards(page, 'dictation'), 'still asking main at the second click').toMatchObject({ phase: 'requesting' });
  await mic.click();
  await expect.poll(async () => (await voiceLog(app)).cancels).toHaveLength(1);
  log = await voiceLog(app);
  expect(log.starts).toHaveLength(2);
  expect(log.cancels).toEqual([log.starts[1]!.captureId]);
  await page.waitForTimeout(800); // past the scripted `started` and its partials
  await expect(messageIn(page, 0)).toHaveText('Hello world.');
  await expect(statusIn(page, 0)).toHaveCount(0);
  await expect(noticeIn(page, 0)).toHaveCount(0);
  expect(voice.consoleErrors()).toEqual([]);
});

test('Enter while finishing sends the greyed words as they stand, and the late final changes nothing', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-enter']);
  await script(app, { partials: ['send these words'], partialDelayMs: 100, final: 'A different final.' });

  await holdDown(page);
  await expect(interimIn(page, 0)).toHaveText('send these words');
  // The scripted stop answers its final within one IPC round trip, so the release and the Enter happen in one task:
  // the final cannot arrive between them.
  const phaseAtEnter = await page.evaluate(() => {
    const editor = document.querySelector('[data-pane="0"] [contenteditable="true"]')!;
    editor.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    const phase = (window as unknown as CardsWindow).__maws_cards.dictation()?.phase ?? null;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return phase;
  });
  expect(phaseAtEnter).toBe('finishing');
  await page.keyboard.up('Space');
  await page.keyboard.up('Alt');

  await expect.poll(() => cards(page, 'starts')).toEqual([{ appSessionId: 'e9-enter', content: 'send these words', display: 'send these words' }]);
  await expect.poll(async () => (await voiceLog(app)).stops).toHaveLength(1);
  await page.waitForTimeout(300);
  await expect(messageIn(page, 0)).toHaveText('send these words'); // the start is still pending; the final never landed
  await expect(interimIn(page, 0)).toHaveCount(0);
  expect(await cards(page, 'dictation')).toBeNull();
  expect(voice.consoleErrors()).toEqual([]);
});

test("with two composers the words land in the focused pane's only", async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-left', 'e9-right']);
  await messageIn(page, 1).click();

  await holdDown(page);
  await expect(statusIn(page, 1)).toHaveText('Listening…');
  await expect(statusIn(page, 0)).toHaveCount(0);
  await expect(interimIn(page, 1)).toHaveText('hello world');
  await holdUp(page);
  await expect(messageIn(page, 1)).toHaveText('Hello world.');
  await expect(messageIn(page, 0)).toHaveText('');
  expect((await voiceLog(app)).starts).toHaveLength(1);
  expect(voice.consoleErrors()).toEqual([]);
});

test('a card docked over the composer refuses the hold with a notice and no start', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-docked']);
  await cards(page, 'dockStub', 'e9-docked');
  await expect(pane(page, 0).getByRole('group', { name: 'Trust this folder?' })).toBeFocused();

  await holdDown(page);
  await holdUp(page);
  await expect(noticeIn(page, 0)).toContainText('Dictation needs a composer that can take text');
  expect(await cards(page, 'voiceNotice')).toEqual({ kind: 'no_editor', message: 'Dictation needs a composer that can take text' });
  expect((await voiceLog(app)).starts).toEqual([]);
  expect(await cards(page, 'stubAccepts')).toBe(0); // the hold is not the card's Enter
  await cards(page, 'undockStub');
  await expect(messageIn(page, 0)).toHaveText('');
  expect(voice.consoleErrors()).toEqual([]);
});

test('the window losing focus mid-hold cancels and removes the interim words', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-blur']);
  await page.keyboard.type('kept');
  await script(app, { partials: ['hello world'], partialDelayMs: 100 });

  await holdDown(page);
  await expect(interimIn(page, 0)).toHaveText('hello world');
  await expect(messageIn(page, 0)).toHaveText('kept hello world');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(interimIn(page, 0)).toHaveCount(0);
  await expect(messageIn(page, 0)).toHaveText('kept');
  await expect(statusIn(page, 0)).toHaveCount(0);
  await holdUp(page);
  await expect.poll(async () => (await voiceLog(app)).cancels).toHaveLength(1);
  const log = await voiceLog(app);
  expect(log.cancels).toEqual([log.starts[0]!.captureId]);
  expect(log.stops).toEqual([]);
  await expect(messageIn(page, 0)).toHaveText('kept');
  expect(voice.consoleErrors()).toEqual([]);
});

test('a denied microphone shows the notice whose button records the pane and opens nothing', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-denied']);
  await script(app, { permission: { microphone: 'denied', speech: 'notDetermined' } });

  await holdDown(page);
  await expect(noticeIn(page, 0)).toContainText('Microphone access is off for MAWS');
  await holdUp(page);
  expect(await cards(page, 'voiceNotice')).toEqual({ kind: 'microphone_denied', message: 'Microphone access is off for MAWS' });
  await expect(messageIn(page, 0)).toHaveText('');
  await expect(statusIn(page, 0)).toHaveCount(0);
  await shot(page, 'dictation-denied.png');
  await noticeIn(page, 0).getByRole('button', { name: 'Open System Settings' }).click();
  await expect.poll(async () => (await voiceLog(app)).privacyPanes).toEqual(['microphone']);
  await noticeIn(page, 0).getByRole('button', { name: 'Dismiss' }).click();
  await expect(noticeIn(page, 0)).toHaveCount(0);
  expect(voice.consoleErrors()).toEqual([]);
});

test('a missing helper refuses the hold with the path it looked at', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-missing']);
  await script(app, { helper: 'missing' });

  await holdDown(page);
  await expect(noticeIn(page, 0)).toContainText(/Dictation is unavailable · helper not found at \/.+maws-voice-helper/);
  await holdUp(page);
  expect(await cards(page, 'voiceNotice')).toMatchObject({ kind: 'unavailable' });
  await expect(messageIn(page, 0)).toHaveText('');
  expect(await cards(page, 'dictation')).toBeNull();
  expect(voice.consoleErrors()).toEqual([]);
});

test('a partial arriving after the final leaves the settled text unchanged', async ({ voice }) => {
  const { page, app } = voice;
  await showComposers(page, ['e9-late']);
  await script(app, { lateAfterFinal: true });

  await holdDown(page);
  await expect(interimIn(page, 0)).toHaveText('hello world');
  await holdUp(page);
  await expect(messageIn(page, 0)).toHaveText('Hello world.');
  await page.waitForTimeout(300); // the stub's late partial comes 20 ms after its final
  await expect(messageIn(page, 0)).toHaveText('Hello world.');
  await expect(interimIn(page, 0)).toHaveCount(0);
  expect(voice.consoleErrors()).toEqual([]);
});

// ---- Settings › Voice over the scripted recognizer -----------------------------------------------------------------

async function menu(app: ElectronApplication, id: string): Promise<void> {
  const click = () =>
    app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item?.enabled) return false;
      item.click();
      return true;
    }, id);
  await expect.poll(click, { message: `menu item ${id} exists and is enabled` }).toBe(true);
}

test('Settings › Voice reads the status from main and writes the language to settings version 9', async ({ voiceApp }) => {
  const { page, app, userData } = voiceApp;
  await menu(app, 'settings.open');
  const settings = page.locator('[data-region="main"]').getByRole('tabpanel');
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Voice', exact: true }).click();
  const section = settings.getByRole('region', { name: 'Voice' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('scripted recognizer (test harness)');
  await expect(section.getByRole('group', { name: 'Shortcut' })).toContainText('Unbound'); // M6: no default hold
  const language = section.getByRole('combobox', { name: 'Language' });
  await expect(language.locator('option').first()).toHaveText('System (en-US)');
  await expect(section.getByText('Allowed', { exact: true })).toHaveCount(2); // microphone and speech, as the script grants them
  await shot(page, 'settings-voice.png');

  await language.selectOption({ label: 'English (United Kingdom)' });
  const readVoice = () => (JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as { version: number; voice: unknown });
  await expect.poll(() => readVoice()).toMatchObject({ version: 10, voice: { locale: 'en-GB' } }); // E10: settings version 10
  expect(voiceApp.consoleErrors()).toEqual([]);
});

// ---- the packaged app: the bundled helper, probe-only ----------------------------------------------------------------

test('packaged: the bundled helper answers voice.status from Contents/Resources and voice.start is refused under the harness', async ({ packagedVoice }) => {
  const { page, app } = packagedVoice;
  expect(packagedVoice.packaged).toBe(true);
  expect(await backendOf(app)).toBe('helper-probe-only');

  const status = value(await invoke(page, 'voice.status', { locale: null }));
  expect(status.backend).toBe('helper');
  expect(status.helper.state, JSON.stringify(status.helper)).toBe('ready');
  expect(status.helper.path).toMatch(/\/MAWS\.app\/Contents\/Resources\/voice-helper\/maws-voice-helper$/);
  // The probe reads this Mac's states for MAWS without asking; which they are is the owner's, so only their shape.
  const states = ['notDetermined', 'authorized', 'denied', 'restricted'];
  expect(states).toContain(status.permission?.microphone);
  expect(states).toContain(status.permission?.speech);
  expect(status.locales.length).toBeGreaterThan(0);
  expect(status.systemLocale).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
  expect(typeof status.supportsOnDevice).toBe('boolean');

  expect(value(await invoke(page, 'voice.start', { captureId: randomUUID(), locale: null }))).toEqual({ accepted: false, reason: 'e2e_refused', path: null });
  expect(packagedVoice.consoleErrors()).toEqual([]);
});
