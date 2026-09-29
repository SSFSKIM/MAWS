// C7's composer end to end, the editor half (C7 execution document, M3 and Acceptance item 2): the harness's `#editor`
// page mounts one session's editor over the app's real stores and C5's real key dispatcher, in front of C3's replay
// transport. The replay matches a write by its frame type only, so what the editor sent is read from the `user.message`
// event C3 emits at the write, with the content it wrote. A scratch git repository under /tmp stands in for the
// session's directory: listed as a project for `@`, and discovered as a session (a transcript in the launch's scratch
// config home) for drafts, whose store needs an indexed record; the same scratch home holds the terminal's history and
// paste cache for recall. Never the owner's `~/.claude`. The page needs a harness build: `pnpm e2e:composer` builds one
// and runs this file; under a plain build the cases skip. The surface half (M4) runs the whole composer on the
// `#composer` page (a pane kind there, over the layout store's panes): the submit states over `queue-and-interrupt`,
// the one app-level ⌘. from either pane, drafts, and an unstarted session over the page's stub of C10's intent. M4b's
// edit-and-resubmit runs there too, with the session's transcript above its composer (a bubble's Edit is the way in):
// the replay holds a `rewind_conversation` answer back past C3's 8 s bound, or withholds it, and the engine host's
// own journal says how many rewinds and prompts were written.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { CardsHarnessApi, HarnessIntent, HarnessPane } from '../src/renderer/src/harness/composer/api';
import type { EditorHarnessApi, EditorPane } from '../src/renderer/src/harness/composer/editor-api';
import { invoke, launchReady, queueInterruptJournal, rewindJournal, turnsJournal, value, type RewindReplay } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));

const test = base.extend<{ editor: MawsLaunch }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  editor: async ({}, use, testInfo) => {
    testInfo.skip(!HARNESS_BUILT, 'the editor page needs a harness build (pnpm e2e:composer)');
    const maws = await launchMaws({ env: { MAWS_HARNESS: '1', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config } });
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
  },
});

let scratch: string; // realpath'd: /private/tmp/…
let repo: string;
let config: string;
const transcriptSession = randomUUID();
const bodyA = Array.from({ length: 40 }, (_, i) => `first paste line ${i + 1}`).join('\n');
const bodyB = Array.from({ length: 40 }, (_, i) => `second paste line ${i + 1}`).join('\n');

test.beforeAll(() => {
  scratch = realpathSync(mkdtempSync('/tmp/maws-c7-composer-'));
  repo = join(scratch, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'docs'));
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repo, 'src/main.ts'), 'export {};\n');
  writeFileSync(join(repo, 'docs/a b.md'), '# notes\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=MAWS e2e', '-c', 'user.email=e2e@example.test', ...args], { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'init');

  // The scratch config home: one transcript for the repository (C4 discovers it: an indexed record, so drafts persist),
  // and the terminal's history with two pastes of one display and two bodies, the second in the paste cache.
  config = join(scratch, 'claude-config');
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const record = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'an earlier prompt' }, uuid: randomUUID(), timestamp: '2026-09-28T10:00:00.000Z', cwd: repo, sessionId: transcriptSession, version: '2.1.283' };
  writeFileSync(join(project, `${transcriptSession}.jsonl`), `${JSON.stringify(record)}\n`);
  const hashB = createHash('sha256').update(bodyB).digest('hex').slice(0, 16);
  mkdirSync(join(config, 'paste-cache'));
  writeFileSync(join(config, 'paste-cache', `${hashB}.txt`), bodyB);
  const history = [
    { display: '[Pasted text #1 +40 lines]', pastedContents: { '1': { id: 1, type: 'text', content: bodyA } }, timestamp: Date.parse('2026-09-28T10:01:00.000Z'), project: repo, sessionId: transcriptSession },
    { display: '[Pasted text #1 +40 lines]', pastedContents: { '1': { id: 1, type: 'text', contentHash: hashB } }, timestamp: Date.parse('2026-09-28T10:02:00.000Z'), project: repo, sessionId: transcriptSession },
  ];
  writeFileSync(join(config, 'history.jsonl'), history.map((row) => JSON.stringify(row)).join('\n') + '\n');
});
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type EditorWindow = Window & { __maws_editor: EditorHarnessApi; __c7: { batches: { appSessionId: string; events: SessionEvent[] }[] } };

async function openEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __c7?: { batches: unknown[] } };
    if (!w.__c7) {
      const log = { batches: [] as unknown[] };
      w.__c7 = log;
      window.maws.on('session.eventBatch', (payload) => log.batches.push(payload));
    }
    location.hash = 'editor';
  });
  await page.waitForFunction(() => (window as unknown as Partial<EditorWindow>).__maws_editor !== undefined);
}

const show = (page: Page, pane: EditorPane | null) => page.evaluate((p) => (window as unknown as EditorWindow).__maws_editor.show(p), pane);
const serialized = (page: Page) => page.evaluate(() => (window as unknown as EditorWindow).__maws_editor.serialize());
const submissions = (page: Page) => page.evaluate(() => (window as unknown as EditorWindow).__maws_editor.submissions());
const sent = (page: Page, id: string) =>
  page.evaluate(
    (appSessionId) =>
      (window as unknown as EditorWindow).__c7.batches
        .filter((b) => b.appSessionId === appSessionId)
        .flatMap((b) => b.events)
        .filter((e) => e.kind === 'user.message' && !e.isReplay)
        .map((e) => (e as Extract<SessionEvent, { kind: 'user.message' }>).content),
    id,
  );
const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });

async function launchEditor(page: Page, id: string, journal: string, cwd = repo): Promise<string | null> {
  await openEditor(page);
  await launchReady(page, id, journal);
  const status = value(await invoke(page, 'session.status', { appSessionId: id }));
  await show(page, { appSessionId: id, cwd, sessionId: status.engineSessionId });
  await expect(message(page)).toBeVisible();
  await message(page).click();
  return status.engineSessionId;
}

async function clearEditor(page: Page) {
  await message(page).click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await serialized(page))?.display).toBe('');
}

// A paste as the system delivers it: a ClipboardEvent carrying text or files.
async function paste(page: Page, item: { text: string } | { file: { name: string; type: string; base64: string } }) {
  await page.evaluate((it) => {
    const target = document.querySelector('[contenteditable="true"]') as HTMLElement;
    const data = new DataTransfer();
    if ('text' in it) data.setData('text/plain', it.text);
    else data.items.add(new File([Uint8Array.from(atob(it.file.base64), (c) => c.charCodeAt(0))], it.file.name, { type: it.file.type }));
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, item);
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('the editor sends as typed: Enter in one line, lines by Shift+Enter then Enter, ⌘Enter always; a composing Enter never sends; ArrowUp recalls', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-editor-send';
  await launchEditor(page, id, turnsJournal(scratch, id, 3));
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await expect.poll(() => sent(page, id)).toEqual(['hello']);
  await expect.poll(async () => (await serialized(page))?.display).toBe('');

  // once the document has a second line, Enter breaks lines too (§5.8) and ⌘Enter sends
  await page.keyboard.type('two');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('lines');
  await page.keyboard.press('Enter');
  await page.keyboard.type('three');
  await expect.poll(async () => (await serialized(page))?.display).toBe('two\nlines\nthree');
  expect(await submissions(page)).toHaveLength(1);
  await page.keyboard.press('Meta+Enter');
  await expect.poll(() => sent(page, id)).toEqual(['hello', 'two\nlines\nthree']);
  await expect.poll(async () => (await serialized(page))?.display).toBe('');

  // an Enter that belongs to an input method's composition is the IME's, never a send, even in one line: the marker
  // typed after it goes out in the same message
  await page.keyboard.type('ime');
  await page.evaluate(() => document.querySelector('[contenteditable="true"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  await page.keyboard.type('marker');
  await page.keyboard.press('Meta+Enter');
  await expect.poll(() => sent(page, id)).toEqual(['hello', 'two\nlines\nthree', 'ime\nmarker']);
  await expect.poll(async () => (await submissions(page)).length).toBe(3); // recorded when session.send answers, after the write

  await expect.poll(async () => (await serialized(page))?.display).toBe('');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await serialized(page))?.display).toBe('ime\nmarker');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await serialized(page))?.display).toBe('two\nlines\nthree');
  await page.keyboard.press('ArrowDown'); // while recalling, the arrows move between entries, multi-line ones too
  await expect.poll(async () => (await serialized(page))?.display).toBe('ime\nmarker');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await serialized(page))?.display).toBe(''); // the draft the recall began from
  expect(editor.consoleErrors()).toEqual([]);
});

test("paste and drop attach with the terminal's tag framing", async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-editor-paste';
  const sessionId = await launchEditor(page, id, turnsJournal(scratch, id, 2));
  const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of the paste`).join('\n');
  await paste(page, { text: body });
  await expect(page.getByText('Pasted text #1 +40 lines')).toBeVisible();
  await page.keyboard.type(' then </pasted_content> done');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sent(page, id)).length).toBe(1);
  const [content] = (await sent(page, id)) as string[];
  const tag = sessionId === null ? '[0-9a-f]{4}' : createHash('sha256').update(sessionId).digest('hex').slice(0, 4);
  const framed = new RegExp(`^\\n\\n<pasted_content id="(${tag})">\\n([\\s\\S]*)\\n</pasted_content id="\\1">\\n then <\\\\/pasted_content> done$`);
  const match = framed.exec(content);
  expect(match, content).not.toBeNull();
  expect(match![2]).toBe(body);

  // a screenshot attaches beside the text and goes as an image block before it
  await paste(page, { file: { name: 'shot.png', type: 'image/png', base64: PNG } });
  await expect(page.getByRole('list', { name: 'attachments' }).getByText('shot.png')).toBeVisible();
  await page.keyboard.type('what is this');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sent(page, id)).length).toBe(2);
  const blocks = (await sent(page, id))[1] as { type: string; source?: { media_type: string } }[];
  expect(blocks.map((b) => [b.type, b.source?.media_type ?? null])).toEqual([['image', 'image/png'], ['text', null]]);

  // a file dropped without a path (from a browser) is read as text into an atom named after it, where it was dropped:
  // at the start of the line, ahead of the text the caret sits after
  await expect.poll(async () => (await serialized(page))?.display).toBe('');
  await page.keyboard.type('end of line');
  await page.evaluate(() => {
    const target = document.querySelector('[contenteditable="true"]') as HTMLElement;
    const data = new DataTransfer();
    data.items.add(new File(['alpha\nbeta\ngamma'], 'notes.txt', { type: 'text/plain' }));
    const box = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: box.left + 5, clientY: box.top + 5, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText('notes.txt +3 lines')).toBeVisible();
  expect((await serialized(page))?.pastedContents['1']?.content).toBe('alpha\nbeta\ngamma');
  expect((await serialized(page))?.display).toBe('[Pasted text #1 +3 lines]end of line');
  expect(editor.consoleErrors()).toEqual([]);
});

test('@ and / menus with the widget union', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-editor-menus';
  await openEditor(page);
  value(await invoke(page, 'session.projects.add', { directory: repo })); // the scratch repository is a directory main lists
  await launchEditor(page, id, turnsJournal(scratch, id, 1));
  await page.keyboard.type('hi');
  await page.keyboard.press('Enter'); // the turn's system/init completes the catalogue (skills, terminal-only commands)
  await expect.poll(() => sent(page, id)).toEqual(['hi']);
  await expect.poll(async () => (await serialized(page))?.display).toBe('');

  await page.keyboard.type('@a.ts');
  const mentions = page.getByRole('listbox', { name: 'Mention' });
  await expect(mentions.getByRole('option', { name: 'src/a.ts' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(mentions).toBeHidden();
  await expect.poll(async () => (await serialized(page))?.content).toBe('@src/a.ts');
  await clearEditor(page);

  // `/` lists the catalogue with origin badges; a headless command goes in as text
  await page.keyboard.type('/');
  const commands = page.getByRole('listbox', { name: 'Commands' });
  await expect(commands.getByRole('option').first()).toHaveAttribute('data-origin', 'engine');
  await expect(commands.getByRole('option').first()).toContainText('Engine');
  await page.keyboard.type('split');
  await expect(commands.getByRole('option').first()).toHaveAttribute('data-origin', 'maws'); // MAWS's own actions are in the union
  await expect(commands.getByRole('option').first()).toContainText('MAWS');
  await clearEditor(page);
  await page.keyboard.type('/');
  for (const name of ['compact', 'model']) {
    await page.keyboard.type(name);
    await expect(commands.getByRole('option').first()).toContainText(`/${name}`);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await serialized(page))?.display).toBe(`/${name}`);
    await clearEditor(page);
    await page.keyboard.type('/');
  }
  // terminal-only and widget-only names are listed, disabled, and Enter leaves them be
  for (const [name, origin] of [['doctor', 'engine'], ['permissions', 'widget']]) {
    await page.keyboard.type(name);
    const row = commands.getByRole('option').first();
    await expect(row).toContainText(`/${name}`);
    await expect(row).toHaveAttribute('data-origin', origin);
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).toContainText('Opens a widget · arrives with C11');
    await page.keyboard.press('Enter');
    await expect(commands).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(commands).toBeHidden();
    await clearEditor(page);
    await page.keyboard.type('/');
  }

  // once widgets are registered for them, the same names open the widget
  await page.evaluate(() => ['model', 'permissions'].forEach((name) => (window as unknown as EditorWindow).__maws_editor.registerWidget(name)));
  for (const name of ['model', 'permissions']) {
    await page.keyboard.type(name);
    await expect(commands.getByRole('option').first()).toContainText(`/${name}`);
    await page.keyboard.press('Enter');
    const widget = page.getByRole('region', { name: `/${name} widget` });
    await expect(widget).toBeVisible();
    await widget.getByRole('button', { name: 'Close' }).click();
    await message(page).click();
    await clearEditor(page);
    await page.keyboard.type('/');
  }
  expect(editor.consoleErrors()).toEqual([]);
});

test('history recalls with bodies: two pastes of one display come back as two entries', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-editor-history';
  await launchEditor(page, id, turnsJournal(scratch, id, 0));
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await serialized(page))?.pastedContents['1']?.content).toBe(bodyB); // the newer, from the paste cache
  await expect(page.getByText('Pasted text #1 +40 lines')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await serialized(page))?.pastedContents['1']?.content).toBe(bodyA); // the older, inline
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await serialized(page))?.display).toBe('');
  expect(editor.consoleErrors()).toEqual([]);
});

test('bash mode runs through the engine', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-editor-bash';
  await launchEditor(page, id, 'spikes/protocol-probe/fixtures/pass2/bash-context-echoed.jsonl', '/private/tmp');
  await page.keyboard.type('!printf MAWS_BASH_8823');
  await expect(page.locator('[data-key-sink="composer"]')).toHaveAttribute('data-mode', 'bash');
  await expect(page.getByText('Bash', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter'); // seq 5: the bash_command write
  await expect.poll(async () => (await sent(page, id)).some((c) => typeof c === 'string' && c.includes('<bash-input>printf MAWS_BASH_8823</bash-input>'))).toBe(true); // seq 9: C3's echo
  const prompt = 'I just ran a shell command with the ! prefix. What exactly did it print? Reply with only the printed text, or NONE if you cannot see it.';
  await expect.poll(async () => (await serialized(page))?.display).toBe('');
  await page.keyboard.type(prompt);
  await page.keyboard.press('Enter'); // seq 16
  await expect.poll(() => sent(page, id)).toContain(prompt);
  expect((await submissions(page)).map((s) => [s.mode, s.display, s.accepted])).toEqual([
    ['bash', '!printf MAWS_BASH_8823', true],
    ['send', prompt, true],
  ]);
  expect(editor.consoleErrors()).toEqual([]);
});

test('drafts survive a tab switch and a reload', async ({ editor }) => {
  const { page } = editor;
  await openEditor(page);
  // the transcript in the scratch config home is discovered as an indexed session in the repository
  let appId: string | null = null;
  await expect
    .poll(async () => {
      const { sessions } = value(await invoke(page, 'session.list', {}));
      appId = sessions.find((s) => s.engineSessionId === transcriptSession)?.appId ?? null;
      return appId;
    })
    .not.toBeNull();
  const pane = { appSessionId: appId!, cwd: repo, sessionId: transcriptSession };
  await show(page, pane);
  await message(page).click();
  await page.keyboard.type('a draft to keep');
  await expect.poll(async () => value(await invoke(page, 'session.drafts.get', { appSessionId: appId! }))).not.toBeNull(); // written 750 ms after the last key

  await show(page, null);
  await expect(message(page)).toBeHidden();
  await show(page, pane);
  await expect.poll(async () => (await serialized(page))?.display).toBe('a draft to keep');

  await page.reload();
  await openEditor(page);
  await show(page, pane);
  await expect.poll(async () => (await serialized(page))?.display).toBe('a draft to keep');
  expect(editor.consoleErrors()).toEqual([]);
});

// ---- M4: the composer surface ------------------------------------------------------------------------------------

type CardsWindow = Window & { __maws_cards: CardsHarnessApi; __c7: { batches: { appSessionId: string; events: SessionEvent[] }[] } };

async function openComposerPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __c7?: { batches: unknown[] } };
    if (!w.__c7) {
      const log = { batches: [] as unknown[] };
      w.__c7 = log;
      window.maws.on('session.eventBatch', (payload) => log.batches.push(payload));
    }
    location.hash = 'composer';
  });
  await page.waitForFunction(() => (window as unknown as Partial<CardsWindow>).__maws_cards !== undefined);
}
const showPanes = (page: Page, panes: [HarnessPane, HarnessPane]) => page.evaluate((p) => (window as unknown as CardsWindow).__maws_cards.show(p), panes);
const cards = <K extends keyof CardsHarnessApi>(page: Page, name: K, ...args: Parameters<CardsHarnessApi[K]>) =>
  page.evaluate(([n, a]) => ((window as unknown as CardsWindow).__maws_cards[n] as (...x: unknown[]) => unknown)(...(a as unknown[])), [name, args] as const) as Promise<ReturnType<CardsHarnessApi[K]>>;
const pane = (page: Page, index: 0 | 1) => page.getByRole('region', { name: `pane ${index}` });
const messageIn = (page: Page, index: 0 | 1) => pane(page, index).getByRole('textbox', { name: 'Message' });
const control = (page: Page, index: 0 | 1) => pane(page, index).locator('[data-submit-state]');
const statusOf = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id }));
const COUNT = 'Count to 30 slowly. For each number use a separate Bash call sleep 1; echo NUMBER. Start now.';

test('the composer sends, queues, steers, stops and resumes as labelled', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-surface-queue';
  await openComposerPage(page);
  await launchReady(page, id, queueInterruptJournal(scratch, id));
  await showPanes(page, [{ composer: id }, null]);
  await messageIn(page, 0).click();
  await expect(control(page, 0)).toHaveText('Send');
  await expect(control(page, 0)).toBeDisabled(); // nothing to send yet
  await page.keyboard.type(COUNT);
  await expect(control(page, 0)).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect.poll(() => sent(page, id)).toEqual([COUNT]);
  await expect(control(page, 0)).toHaveText('Stop'); // the turn runs, the editor is empty

  const queued = 'Counting is cancelled. Reply exactly RESUMED.';
  await page.keyboard.type(queued);
  await expect(control(page, 0)).toHaveText('Queue');
  await page.keyboard.down('Alt');
  await expect(control(page, 0)).toHaveText('Steer'); // live while ⌥ is down
  await page.keyboard.up('Alt');
  await expect(control(page, 0)).toHaveText('Queue');
  await pane(page, 0).getByRole('button', { name: 'More ways to send' }).click();
  const menu = page.getByRole('menu');
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual([
    'QueueEnterSends when this turn ends',
    'Steer⌥EnterAdds this to the running turn at its next step',
    'Interrupt and sendStops the running turn, then sends this',
  ]);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await messageIn(page, 0).click();
  await page.keyboard.press('Enter'); // the app queue holds it: nothing is written while the turn runs
  const list = pane(page, 0).getByRole('region', { name: 'Queued messages' });
  await expect(list).toContainText('1 queued');
  await expect(list).toContainText(queued);
  expect(await sent(page, id)).toEqual([COUNT]);

  await page.keyboard.press('Meta+.'); // the one app-level Stop, from the editor
  await expect(list.locator('header')).toHaveText(/Queue paused because you interrupted/);
  await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  await expect(control(page, 0)).toHaveText('Resume');
  await list.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await sent(page, id)).filter((c) => typeof c === 'string')).toEqual([COUNT, queued]); // released: seq 199 (between them, the engine's own interruption row)
  await expect(list).toHaveCount(0);
  expect(editor.consoleErrors()).toEqual([]);
});

test("composer.stop reaches the one app-level handler from either pane's editor", async ({ editor }) => {
  const { page } = editor;
  const [a, b] = ['c7-stop-a', 'c7-stop-b'];
  await openComposerPage(page);
  await launchReady(page, a, queueInterruptJournal(scratch, a));
  await launchReady(page, b, queueInterruptJournal(scratch, b));
  await showPanes(page, [null, { composer: b }]); // pane 1's composer first, then pane 0's: registration order runs against focus
  await expect(messageIn(page, 1)).toBeVisible();
  await showPanes(page, [{ composer: a }, { composer: b }]);
  for (const [index, id] of [[0, a], [1, b]] as const) {
    await messageIn(page, index).click();
    await page.keyboard.type(COUNT);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await statusOf(page, id)).turn).not.toBeNull();
  }
  await messageIn(page, 1).click();
  await page.keyboard.type('typing when I stop');
  await page.keyboard.press('Meta+.');
  await expect.poll(async () => (await statusOf(page, b)).turn).toBeNull();
  expect((await statusOf(page, a)).turn, 'the other pane keeps running').not.toBeNull();
  await messageIn(page, 0).click();
  await page.keyboard.press('Meta+.');
  await expect.poll(async () => (await statusOf(page, a)).turn).toBeNull();
  expect([(await statusOf(page, a)).process, (await statusOf(page, b)).process]).toEqual(['ready', 'ready']); // no unrecorded write ended either replay
  expect(editor.consoleErrors()).toEqual([]);
});

test('the composer keeps its draft across a tab switch and a reload', async ({ editor }) => {
  const { page } = editor;
  await openComposerPage(page);
  let appId: string | null = null;
  await expect
    .poll(async () => {
      appId = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === transcriptSession)?.appId ?? null;
      return appId;
    })
    .not.toBeNull();
  await showPanes(page, [{ composer: appId! }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type('a composer draft');
  await expect.poll(async () => value(await invoke(page, 'session.drafts.get', { appSessionId: appId! }))).not.toBeNull();
  await expect(control(page, 0)).toBeDisabled(); // no process behind the record: nothing sends
  await showPanes(page, [null, null]);
  await showPanes(page, [{ composer: appId! }, null]);
  await expect(messageIn(page, 0)).toHaveText('a composer draft');
  await page.reload();
  await openComposerPage(page);
  await showPanes(page, [{ composer: appId! }, null]);
  await expect(messageIn(page, 0)).toHaveText('a composer draft');
  expect(editor.consoleErrors()).toEqual([]);
});

test('an unstarted session binds the frame to the intent, holds a starting state and starts on Send', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-unstarted';
  const intent: HarnessIntent = { location: { kind: 'directory', path: repo }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null };
  await openComposerPage(page);
  await cards(page, 'intent', id, intent);
  await showPanes(page, [{ composer: id }, null]);
  const p = pane(page, 0);
  await expect(p.getByRole('button', { name: `Location ${repo}` })).toBeVisible();
  await expect(p.getByRole('region', { name: 'Queued messages' })).toHaveCount(0);

  // a chip writes through the intent
  await p.getByRole('button', { name: /^Permission mode/ }).click();
  await page.getByRole('menuitemradio', { name: /^plan/ }).click();
  await expect.poll(() => cards(page, 'patches')).toEqual([{ appSessionId: id, patch: { permissionMode: 'plan' } }]);
  await expect(p.getByRole('button', { name: /^Permission mode/ })).toHaveAttribute('aria-label', 'Permission mode plan');

  // `!` waits for the engine
  await messageIn(page, 0).click();
  await page.keyboard.type('!ls');
  await expect(control(page, 0)).toBeDisabled();
  await expect(control(page, 0)).toHaveAttribute('title', 'Available once the session starts');
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');

  await page.keyboard.type('first words');
  await page.keyboard.press('Enter');
  await expect(control(page, 0)).toHaveText('Starting…');
  await expect(control(page, 0)).toBeDisabled();
  await expect(p.getByRole('button', { name: 'Add a directory' })).toHaveAttribute('title', 'Session is starting…');
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  expect(await cards(page, 'starts')).toEqual([{ appSessionId: id, content: 'first words', display: 'first words' }]);
  await expect(messageIn(page, 0)).toHaveText('first words');

  await cards(page, 'answerStart', { ok: false, error: 'refused: the directory is not trusted' });
  await expect(control(page, 0)).toHaveText('Send');
  await expect(control(page, 0)).toBeEnabled();
  await expect(messageIn(page, 0)).toHaveText('first words');

  await messageIn(page, 0).click();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await cards(page, 'starts')).length).toBe(2);
  await cards(page, 'intent', id, { ...intent, message: { content: 'first words', display: 'first words' } });
  await cards(page, 'answerStart', { ok: true });
  await expect(messageIn(page, 0)).toHaveText('');
  await expect(control(page, 0)).toHaveAttribute('title', 'Your first message is with the setup above');
  await expect(control(page, 0)).toBeDisabled();
  await cards(page, 'intent', id, { ...intent, message: null });
  await messageIn(page, 0).click();
  await page.keyboard.type('next');
  await expect(control(page, 0)).toBeEnabled();

  // a card docked through dockCard takes the composer's place and focus, and answers Enter through its own onAccept
  await cards(page, 'dockStub', id);
  const frame = p.getByRole('group', { name: 'Trust this folder?' });
  await expect(frame).toBeFocused();
  await expect(messageIn(page, 0)).toBeHidden();
  await page.keyboard.press('Enter');
  await expect.poll(() => cards(page, 'stubAccepts')).toBe(1);
  await cards(page, 'undockStub');
  await expect(messageIn(page, 0)).toBeFocused();
  await expect(messageIn(page, 0)).toHaveText('next');
  expect(editor.consoleErrors()).toEqual([]);
});

// ---- M4b: edit-and-resubmit ------------------------------------------------------------------------------------------

// The engine host's own journal of the launch: what was written to the engine, whatever the renderer believed.
type JournalLine = { direction: string; frame: { type?: string; request?: { subtype?: string } } };
async function written(page: Page, id: string): Promise<{ rewinds: number; cancels: number; users: number }> {
  const lines = readFileSync((await statusOf(page, id)).journalPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as JournalLine)
    .filter((row) => row.direction === 'out');
  return {
    rewinds: lines.filter((row) => row.frame.type === 'control_request' && row.frame.request?.subtype === 'rewind_conversation').length,
    cancels: lines.filter((row) => row.frame.type === 'control_cancel_request').length,
    users: lines.filter((row) => row.frame.type === 'user').length,
  };
}

const editLine = (page: Page) => pane(page, 0).locator('[data-edit-mode]');

// Two prompts sent from the composer over `rewindJournal`, then the second bubble's Edit (C6's, through the adapter
// App.tsx registers): the composer holds `turn two` in edit mode and ` edited` is typed.
async function startEdit(page: Page, id: string, replay: RewindReplay): Promise<void> {
  await openComposerPage(page);
  await launchReady(page, id, rewindJournal(scratch, id, replay));
  await showPanes(page, [{ composer: id, transcript: true }, null]);
  for (const text of ['turn one', 'turn two']) {
    await messageIn(page, 0).click();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect.poll(() => sent(page, id)).toContain(text);
    await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  }
  const bubble = pane(page, 0).locator('.transcript-user').filter({ hasText: 'turn two' });
  await bubble.hover();
  await bubble.getByRole('button', { name: 'Edit' }).click();
  await expect(editLine(page)).toHaveText(/Editing an earlier message · sending forks this session from here/);
  await expect(messageIn(page, 0)).toHaveText('turn two');
  await messageIn(page, 0).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
}

// Send in edit mode asks to rewind, and the confirm is given (after `beforeConfirm`).
async function confirmResubmit(page: Page, beforeConfirm: () => Promise<unknown> = async () => {}): Promise<void> {
  await messageIn(page, 0).click();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Forking arrives with C10. Rewind this session to that message and resend instead?');
  await beforeConfirm();
  await dialog.getByRole('button', { name: 'Rewind and resend' }).click();
}

async function editSecondPrompt(page: Page, id: string, replay: RewindReplay, beforeConfirm?: () => Promise<unknown>): Promise<void> {
  await startEdit(page, id, replay);
  await confirmResubmit(page, beforeConfirm);
}

test('edit-and-resubmit never repeats a rewind: a send that fails after the replayed rewind retries the send alone', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-resubmit-send-fails';
  await editSecondPrompt(page, id, 'answered', () => cards(page, 'failNextSend', id)); // the resend after the rewind fails
  await expect(editLine(page)).toHaveText(/Rewound · the message was not sent/);
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 0, users: 2 }); // rewound; the resend never reached the engine
  await editLine(page).getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => sent(page, id)).toEqual(['turn one', 'turn two', 'turn two edited']);
  await expect(editLine(page)).toHaveCount(0);
  await expect(messageIn(page, 0)).toHaveText('');
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 0, users: 3 });
  expect((await statusOf(page, id)).process).toBe('ready');
  expect(editor.consoleErrors()).toEqual([]);
});

test('edit-and-resubmit reconciles an unconfirmed rewind: held past the bridge timeout, its late answer lets Send go', async ({ editor }) => {
  test.setTimeout(90_000);
  const { page } = editor;
  const id = 'c7-resubmit-held';
  await editSecondPrompt(page, id, 'held');
  await expect(editLine(page)).toHaveText(/Rewind unconfirmed · checking the transcript…/, { timeout: 15_000 }); // C3's 8 s bound answered `timeout`
  await expect(messageIn(page, 0)).toHaveAttribute('contenteditable', 'false');
  await expect(messageIn(page, 0)).toHaveText('turn two edited');
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 1, users: 2 });

  // the held answer is released: a read of the test's own goes first, and the late `rewound: true` follows it
  value(await invoke(page, 'session.getContextUsage', { appSessionId: id, detail: 'summary' }));
  await expect(editLine(page)).toHaveText(/Rewound/);
  expect(await sent(page, id)).toEqual(['turn one', 'turn two']); // confirmed by the transcript: Send is the human's
  await control(page, 0).click();
  await expect.poll(() => sent(page, id)).toEqual(['turn one', 'turn two', 'turn two edited']);
  await expect(editLine(page)).toHaveCount(0);
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 1, users: 3 });
  expect(editor.consoleErrors()).toEqual([]);
});

test('edit-and-resubmit reconciles an unconfirmed rewind: withheld for the whole window, Send without rewinding sends alone', async ({ editor }) => {
  test.setTimeout(90_000);
  const { page } = editor;
  const id = 'c7-resubmit-withheld';
  await openComposerPage(page);
  await cards(page, 'rewindWindow', 2_000); // C3's late window is 60 s; the composer's is shortened for the run
  await editSecondPrompt(page, id, 'withheld');
  await expect(editLine(page)).toHaveText(/Rewind unconfirmed · checking the transcript…/, { timeout: 15_000 });
  await expect(editLine(page)).toHaveText(/The rewind could not be confirmed/);
  expect(await editLine(page).getByRole('button').allTextContents()).toEqual(['Rewind again', 'Send without rewinding', 'Keep editing']);
  await expect(messageIn(page, 0)).toHaveAttribute('contenteditable', 'true');
  await editLine(page).getByRole('button', { name: 'Send without rewinding' }).click();
  await expect.poll(() => sent(page, id)).toEqual(['turn one', 'turn two', 'turn two edited']);
  await expect(editLine(page)).toHaveCount(0);
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 1, users: 3 });
  await cards(page, 'rewindWindow', null);
  expect(editor.consoleErrors()).toEqual([]);
});

test('edit-and-resubmit keeps edit mode across a reload, and Send after it confirms, rewinds and resends', async ({ editor }) => {
  const { page } = editor;
  await openComposerPage(page);
  // a record the index holds (C4's drafts need one), with the replay launched behind it
  let id: string | null = null;
  await expect
    .poll(async () => {
      id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === transcriptSession)?.appId ?? null;
      return id;
    })
    .not.toBeNull();
  await startEdit(page, id!, 'answered');
  const drafted = async () => ((value(await invoke(page, 'session.drafts.get', { appSessionId: id! })) as { doc: { attrs?: { editing?: unknown } } } | null)?.doc.attrs?.editing ?? null);
  await expect.poll(drafted).toMatchObject({ messageUuid: expect.any(String) }); // the draft carries the edit

  await page.reload();
  await openComposerPage(page);
  await showPanes(page, [{ composer: id!, transcript: true }, null]);
  await expect(editLine(page)).toHaveText(/Editing an earlier message · sending forks this session from here/);
  await expect(messageIn(page, 0)).toHaveText('turn two edited');
  await confirmResubmit(page);
  await expect.poll(() => sent(page, id!)).toEqual(['turn two edited']); // the event log restarted with the page
  await expect(editLine(page)).toHaveCount(0);
  expect(await written(page, id!)).toEqual({ rewinds: 1, cancels: 0, users: 3 });
  expect(editor.consoleErrors()).toEqual([]);
});

test('edit-and-resubmit across a reload during an unconfirmed rewind: edit mode is back at idle, and the late answer ends it with the text kept', async ({ editor }) => {
  test.setTimeout(90_000);
  const { page } = editor;
  await openComposerPage(page);
  let id: string | null = null;
  await expect
    .poll(async () => {
      id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === transcriptSession)?.appId ?? null;
      return id;
    })
    .not.toBeNull();
  await startEdit(page, id!, 'held');
  await confirmResubmit(page);
  await expect(editLine(page)).toHaveText(/Rewind unconfirmed · checking the transcript…/, { timeout: 15_000 });
  const drafted = async () => ((value(await invoke(page, 'session.drafts.get', { appSessionId: id! })) as { doc: { attrs?: { editing?: unknown } } } | null)?.doc.attrs?.editing ?? null);
  await expect.poll(drafted).toMatchObject({ messageUuid: expect.any(String) });

  await page.reload();
  await openComposerPage(page);
  await showPanes(page, [{ composer: id!, transcript: true }, null]);
  await expect(editLine(page)).toHaveText(/Editing an earlier message · sending forks this session from here/); // idle, nothing issued
  await expect(messageIn(page, 0)).toHaveText('turn two edited');
  expect(await written(page, id!)).toEqual({ rewinds: 1, cancels: 1, users: 2 });

  value(await invoke(page, 'session.getContextUsage', { appSessionId: id!, detail: 'summary' })); // the held answer comes late
  await expect(editLine(page)).toHaveCount(0); // the transcript shows the rewind: edit mode ends
  await expect(messageIn(page, 0)).toHaveText('turn two edited');
  await messageIn(page, 0).click();
  await page.keyboard.press('Enter'); // an ordinary send now
  await expect.poll(() => sent(page, id!)).toEqual(['turn two edited']);
  expect(await written(page, id!)).toEqual({ rewinds: 1, cancels: 1, users: 3 });
  expect(editor.consoleErrors()).toEqual([]);
});
