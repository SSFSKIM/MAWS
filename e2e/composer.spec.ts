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
import { isolatedGitEnv } from '../test/support/git-env';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { CardsHarnessApi, HarnessIntent, HarnessPane } from '../src/renderer/src/harness/composer/api';
import type { EditorHarnessApi, EditorPane } from '../src/renderer/src/harness/composer/editor-api';
import { consentMessage } from '../src/shared/engine/arrival';
import { askedSteerStopJournal, asyncAsk, blockedTurnJournal, invoke, joinedAnswerJournal, joinedAnswerRecorded, launchReady, queueInterruptJournal, recordedBlockJournal, rewindJournal, sendNowAfterJournal, sendNowJournal, steerStopJournal, stopThenQueueJournal, stopPendingJournal, turnsJournal, value, type RewindReplay } from './support/c7-replay';
import { clickRevealed } from './support/hover';
import type { AskAnswer, AskQuestion } from '@shared/maws/tools'; // UX wave U4b (M4): the waiting answer's envelope
import { askSteerText } from '../src/shared/maws/ask';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { ALLOW_ONCE_KEY, answerByKey, pastGrace, watchPrompts } from './support/request-keys';

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
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=MAWS e2e', '-c', 'user.email=e2e@example.test', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
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
const message = (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true });

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
  // P5 O3-B (a flaky pass of e2e:c7, run 40847569515): the editor is not editable while a send is pending, which outlasts
  // the session's event a case waits for, so the paste waits for it to be editable again
  await page.locator('[contenteditable="true"]').waitFor();
  await page.evaluate((it) => {
    const target = document.querySelector('[contenteditable="true"]') as HTMLElement;
    const data = new DataTransfer();
    if ('text' in it) data.setData('text/plain', it.text);
    else data.items.add(new File([Uint8Array.from(atob(it.file.base64), (c) => c.charCodeAt(0))], it.file.name, { type: it.file.type }));
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, item);
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// UX wave U4a (l3-input-08; charter §5.8 as amended): Enter sends the draft whatever its line count, Shift+Enter and
// Option+Enter break the line, and ⌘Enter, which keeps a message for after a running turn, sends as Enter does while
// none runs.
test('the editor sends as typed: Enter whatever the line count, Shift+Enter and ⌥Enter break the line, ⌘Enter sends while idle; a composing Enter never sends; ArrowUp recalls', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-editor-send';
  await launchEditor(page, id, turnsJournal(scratch, id, 4));
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await expect.poll(() => sent(page, id)).toEqual(['hello']);
  await expect.poll(async () => (await serialized(page))?.display).toBe('');

  await page.keyboard.type('two');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('lines');
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.type('three');
  await expect.poll(async () => (await serialized(page))?.display).toBe('two\nlines\nthree');
  expect(await submissions(page)).toHaveLength(1); // neither line break sent anything
  await page.keyboard.press('Enter');
  await expect.poll(() => sent(page, id)).toEqual(['hello', 'two\nlines\nthree']);
  await expect.poll(async () => (await serialized(page))?.display).toBe('');

  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id })).turn).toBeNull(); // idle: ⌘Enter has no turn to wait for
  await page.keyboard.type('four');
  await page.keyboard.press('Meta+Enter');
  await expect.poll(() => sent(page, id)).toEqual(['hello', 'two\nlines\nthree', 'four']);
  await expect.poll(async () => (await serialized(page))?.display).toBe('');

  // an Enter that belongs to an input method's composition is the IME's, never a send: the marker typed after it goes
  // out in the same message
  await page.keyboard.type('ime');
  await page.evaluate(() => document.querySelector('[contenteditable="true"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  await page.keyboard.type('marker');
  await page.keyboard.press('Enter');
  await expect.poll(() => sent(page, id)).toEqual(['hello', 'two\nlines\nthree', 'four', 'ime\nmarker']);
  await expect.poll(async () => (await submissions(page)).length).toBe(4); // recorded when session.send answers, after the write

  // ↑ in the empty box recalls, newest first, and the line under the text says where it is (M6)
  await expect.poll(async () => (await serialized(page))?.display).toBe('');
  const line = page.getByRole('status', { name: 'Prompt history' });
  await expect(line).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await serialized(page))?.display).toBe('ime\nmarker');
  await expect(line).toHaveText(/^History \d+\/\d+ · ↓ to restore your draft$/);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await serialized(page))?.display).toBe('four');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await serialized(page))?.display).toBe('two\nlines\nthree');
  await page.keyboard.press('ArrowDown'); // while recalling, the arrows move between entries, multi-line ones too
  await expect.poll(async () => (await serialized(page))?.display).toBe('four');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await serialized(page))?.display).toBe('ime\nmarker');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await serialized(page))?.display).toBe(''); // the draft the recall began from
  await expect(line).toHaveCount(0);
  expect(editor.consoleErrors()).toEqual([]);
});

test("paste and drop attach with the terminal's tag framing", async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-editor-paste';
  const sessionId = await launchEditor(page, id, turnsJournal(scratch, id, 2));
  // UX wave U4a (l3-input-09; charter §5.4 as amended): a paste of up to 20,000 characters stays text, whatever its lines
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of the paste`).join('\n');
  await paste(page, { text: lines });
  await expect.poll(async () => (await serialized(page))?.display).toBe(lines);
  await expect(page.locator('[data-pasted]')).toHaveCount(0);
  await clearEditor(page);
  // only a longer one becomes a chip, which the send frames in the terminal's tags
  const body = Array.from({ length: 400 }, (_, i) => `line ${i + 1} of a long paste, which together pass the chip's bound`).join('\n');
  expect(body.length).toBeGreaterThan(20_000);
  await paste(page, { text: body });
  await expect(page.getByText('Pasted text #1 +400 lines')).toBeVisible();
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

  // UX wave U4a (l3-input-06; charter §5.4 as amended): `/` lists names alone, an icon per kind and no headings, and the
  // highlighted row's description, hint and origin or reason stand in a popover beside the list. This page has no panel
  // registered yet, so the list opens on the engine's own entries; MAWS's window actions are ⌘K's and not listed here.
  // A headless command goes in as text.
  await page.keyboard.type('/');
  const commands = page.getByRole('listbox', { name: 'Commands' });
  const chosen = commands.locator('[role="option"][aria-selected="true"]'); // the list opens on the best match
  const detail = page.locator('#composer-slash-detail'); // the highlighted row's popover
  await expect(commands.getByRole('option').first()).toHaveAttribute('data-origin', 'engine');
  await expect(commands.getByRole('group')).toHaveCount(0);
  await expect(commands.locator('[data-origin="maws"]')).toHaveCount(0);
  await page.keyboard.type('split');
  await expect(page.getByRole('option', { name: /Split \/ send to other pane/ })).toHaveCount(0);
  await clearEditor(page);
  await page.keyboard.type('/');
  for (const name of ['compact', 'model']) {
    await page.keyboard.type(name);
    await expect(chosen).toContainText(`/${name}`); // C11: the chosen row
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await serialized(page))?.display).toBe(`/${name}`);
    await clearEditor(page);
    await page.keyboard.type('/');
  }
  // terminal-only and widget-only names are listed, greyed, once typed, and Enter leaves them be. W2: the engine's
  // terminal-only command says Terminal only, a widget this page did not register Not available here, and U4a moves the
  // reason from the row's text to its popover, which the row names as its description
  for (const [name, origin, hint] of [['doctor', 'engine', 'Terminal only'], ['permissions', 'widget', 'Not available here']]) {
    await page.keyboard.type(name);
    const row = chosen; // C11: the chosen row (a skill may be shown above it)
    await expect(row).toContainText(`/${name}`);
    await expect(row).toHaveAttribute('data-origin', origin);
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).not.toContainText(hint);
    await expect(detail).toContainText(hint);
    await expect(row).toHaveAccessibleDescription(new RegExp(hint));
    await expect(detail).not.toContainText('arrives with');
    await page.keyboard.press('Enter');
    await expect(commands).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(commands).toBeHidden();
    await clearEditor(page);
    await page.keyboard.type('/');
  }

  // once widgets are registered for them, `/model` (a panel, and the newest name chosen) opens the list, from MAWS, and
  // the same names open the widget (W3, C6: as the floating dialog, never in the box). The panels' declared order before
  // any pick is the next scene's: the names chosen above rank first with nothing typed (decision 17 c). The registrations
  // land with the list closed and a fresh `/` opens it, as the app's own land at its start: an open list takes the
  // editor's catalogue and panels when the suggestion renders, at a keystroke, not when a registration lands (popup.tsx),
  // so a list left open across them still holds the engine's rows (the Macs' runs of 443319d64; the CI run of b1bad4a07,
  // which read the engine's `/compact`, chosen too and listed before `/model`, first)
  await page.keyboard.press('Escape'); // the highlighted row's popover stands over the box and would take the clear's click
  await expect(commands).toBeHidden();
  await clearEditor(page);
  await page.evaluate(() => ['model', 'permissions'].forEach((name) => (window as unknown as EditorWindow).__maws_editor.registerWidget(name)));
  await page.keyboard.type('/');
  await expect(commands.getByRole('option').nth(0)).toHaveAccessibleName('/model');
  await expect(commands.getByRole('option').nth(0)).toHaveAttribute('data-origin', 'widget');
  await expect(chosen).toHaveAccessibleName('/model');
  await expect(detail).toContainText('Choose the model for this session');
  await expect(detail).toContainText('MAWS');
  for (const name of ['model', 'permissions']) {
    await page.keyboard.type(name);
    await expect(chosen).toContainText(`/${name}`); // C11: the chosen row
    await page.keyboard.press('Enter');
    const widget = page.getByRole('dialog', { name: `/${name} widget` });
    await expect(widget).toBeVisible();
    await expect(page.getByRole('region', { name: 'composer' }).getByRole('button', { name: 'Close' })).toHaveCount(0);
    await widget.getByRole('button', { name: 'Close' }).click();
    await expect(widget).toBeHidden();
    await message(page).click();
    await clearEditor(page);
    await page.keyboard.type('/');
  }
  expect(editor.consoleErrors()).toEqual([]);
});

// UX wave U4a (decision 17 h, the owner's "MAWS's panels first"): with nothing typed and nothing chosen yet in this
// window, the list opens on the panels the session has, in the order MAWS declares them whatever the order they were
// registered in, then the engine's entries in the engine's order.
test('/ opens on MAWS’s panels in their declared order before any pick, then the engine’s entries', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-editor-panels-first';
  await openEditor(page);
  value(await invoke(page, 'session.projects.add', { directory: repo }));
  await launchEditor(page, id, turnsJournal(scratch, id, 1));
  await page.keyboard.type('hi');
  await page.keyboard.press('Enter'); // the turn's system/init completes the catalogue
  await expect.poll(() => sent(page, id)).toEqual(['hi']);
  await expect.poll(async () => (await serialized(page))?.display).toBe('');
  await page.evaluate(() => ['permissions', 'model'].forEach((name) => (window as unknown as EditorWindow).__maws_editor.registerWidget(name)));

  await page.keyboard.type('/');
  const commands = page.getByRole('listbox', { name: 'Commands' });
  const options = commands.getByRole('option');
  await expect(options.nth(0)).toHaveAccessibleName('/model');
  await expect(options.nth(1)).toHaveAccessibleName('/permissions');
  await expect(options.nth(0)).toHaveAttribute('data-origin', 'widget');
  await expect(options.nth(1)).toHaveAttribute('data-origin', 'widget');
  await expect(options.nth(2)).toHaveAttribute('data-origin', 'engine');
  await expect(commands.locator('[role="option"][aria-selected="true"]')).toHaveAccessibleName('/model');
  await expect(page.locator('#composer-slash-detail')).toContainText('Choose the model for this session');
  await page.keyboard.press('Escape');
  await expect(commands).toBeHidden();
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
  // A submission is recorded once its invoke answers, which may land after the session's event the poll above saw
  // (P5 O3-B: a flaky pass of e2e:c7-utility, run 40838515514), so it is read until both are in.
  await expect.poll(async () => (await submissions(page)).map((s) => [s.mode, s.display, s.accepted])).toEqual([
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
const messageIn = (page: Page, index: 0 | 1) => pane(page, index).getByRole('textbox', { name: 'Message', exact: true }); // exact: an open inline edit is "Edited message"
const control = (page: Page, index: 0 | 1) => pane(page, index).locator('[data-submit-state]');
const statusOf = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id }));
// The frames the engine host wrote to the engine, from its own journal of the launch (W10: a steer's priority).
type OutFrame = { type?: string; uuid?: string; priority?: string; message?: { content?: unknown }; request?: { subtype?: string; send_now?: unknown; message_uuid?: unknown } }; // U4a: a send-now request's two keys
async function outFrames(page: Page, id: string): Promise<OutFrame[]> {
  return readFileSync((await statusOf(page, id)).journalPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { direction: string; frame: OutFrame })
    .filter((row) => row.direction === 'out')
    .map((row) => row.frame);
}
const COUNT = 'Count to 30 slowly. For each number use a separate Bash call sleep 1; echo NUMBER. Start now.';

// W10 (charter §4.2 and §5.4 as amended 2026-10-01), as the UX wave's U4a amends it (l3-input-03, -05 and -15): one round
// button. While a turn runs it is the queue mark with text (Enter and the button write a `next` steer, "Sends at the next
// step", and ⌘Enter keeps the message for after the turn) and Stop without; ⌥ changes nothing and there is no menu and no
// Stop beside it. A waiting message is drawn once, as a row of the stack above the composer with its mark. The plain stop
// (⌘.) withdraws the waiting steer into MAWS's paused queue before it interrupts, the row then reads Held under the
// pause's reason, and Resume releases it as a plain write (`steerStopJournal`).
test('the composer sends, steers, stops and resumes as labelled', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-surface-queue';
  await openComposerPage(page);
  await launchReady(page, id, steerStopJournal(scratch, id));
  await showPanes(page, [{ composer: id }, null]);
  await messageIn(page, 0).click();
  await expect(control(page, 0)).toHaveText('Send'); // the word is the button's hidden text (decision 9), beside its glyph
  await expect(control(page, 0)).toHaveAttribute('data-glyph', 'arrow');
  await expect(control(page, 0)).toBeDisabled(); // nothing to send yet
  await page.keyboard.type(COUNT);
  await expect(control(page, 0)).toBeEnabled();
  await expect(control(page, 0)).toHaveAttribute('title', 'Send (Enter)');
  await page.keyboard.press('Enter');
  await expect.poll(() => sent(page, id)).toEqual([COUNT]);
  await expect(control(page, 0)).toHaveText('Stop'); // the turn runs, the editor is empty
  await expect(control(page, 0)).toHaveAttribute('data-glyph', 'square');
  await expect(control(page, 0)).toHaveAttribute('title', 'Stop the running turn (⌘.)');

  const steered = 'Counting is cancelled. Reply exactly RESUMED.';
  await page.keyboard.type(steered);
  await expect(control(page, 0)).toHaveText('Send');
  await expect(control(page, 0)).toHaveAttribute('data-glyph', 'queue');
  await expect(control(page, 0)).toHaveAttribute('title', 'Sends at the next step (Enter) · ⌘Enter queues for later');
  await page.keyboard.down('Alt');
  await expect(control(page, 0)).toHaveText('Send'); // no relabel under ⌥
  await page.keyboard.up('Alt');
  const box = pane(page, 0).locator('[data-composer-box]');
  await expect(box.getByRole('button')).toHaveCount(1); // the one button: no caret, no Stop beside it
  await page.keyboard.press('Enter'); // the `next` steer, written into the running turn
  const list = pane(page, 0).getByRole('region', { name: 'Queued messages' });
  const row = list.locator('li');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-queue-state', 'next');
  await expect(row).toContainText(steered);
  await expect(row.locator('[data-mark]')).toHaveText('Next step');
  await expect.poll(async () => (await outFrames(page, id)).find((f) => f.type === 'user' && f.message?.content === steered)?.priority).toBe('next');

  await page.keyboard.press('Meta+.'); // the one app-level Stop, from the editor: the steer is held first, then the turn stops
  await expect(row).toHaveAttribute('data-queue-state', 'held');
  await expect(row.locator('[data-mark]')).toHaveText('Held');
  await expect(list.locator('header')).toContainText('Queue paused because you interrupted');
  await expect(list.locator('header').getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(list).not.toContainText('when this turn ends');
  await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  expect((await outFrames(page, id)).filter((f) => f.type === 'control_request').map((f) => f.request?.subtype)).toEqual(expect.arrayContaining(['cancel_async_message', 'interrupt']));
  await expect(control(page, 0)).toHaveText('Resume');
  await expect(control(page, 0)).toHaveAttribute('data-glyph', 'play');
  await list.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await outFrames(page, id)).filter((f) => f.type === 'user' && f.message?.content === steered && f.priority === undefined)).toHaveLength(1); // released: seq 199, a plain write
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
  // P2-A: no process behind the record, so Send offers to start the session (nothing is sent here: the draft is the subject)
  await expect(control(page, 0)).toBeEnabled();
  await expect(control(page, 0)).toHaveAttribute('aria-description', 'Starts this session');
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

  // W3 (C5): an intent that chose no mode shows what the launch passes, the user's defaultMode, else auto; never a printed default
  await expect(p.getByRole('button', { name: /^Permission mode/ })).toHaveAttribute('aria-label', 'Permission mode Auto');
  // a chip writes through the intent
  await p.getByRole('button', { name: /^Permission mode/ }).click();
  await page.getByRole('menuitemradio', { name: /^Plan/ }).click();
  await expect.poll(() => cards(page, 'patches')).toEqual([{ appSessionId: id, patch: { permissionMode: 'plan' } }]);
  await expect(p.getByRole('button', { name: /^Permission mode/ })).toHaveAttribute('aria-label', 'Permission mode Plan');
  // W10 (C9): the "+" menu's Add directory… writes through the intent too (main's e2e pick seam answers the picker)
  const extra = join(scratch, 'extra-dir');
  mkdirSync(extra, { recursive: true });
  await editor.app.evaluate((_electron, dir) => void (process.env.MAWS_E2E_PICK_PATHS = dir), extra);
  await p.getByRole('button', { name: 'Add files, photos or commands' }).click();
  await page.getByRole('menuitem', { name: 'Add directory…' }).click();
  await expect.poll(async () => (await cards(page, 'patches')).filter((x) => 'additionalDirectories' in x.patch)).toEqual([{ appSessionId: id, patch: { additionalDirectories: [extra] } }]);

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
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  expect(await cards(page, 'starts')).toEqual([{ appSessionId: id, content: 'first words', display: 'first words' }]);
  await expect(messageIn(page, 0)).toHaveText('first words');
  // W10 (C9): the "+" menu's Add directory… is gated with every chip while the start runs
  await p.getByRole('button', { name: 'Add files, photos or commands' }).click();
  const addDirectory = page.getByRole('menuitem', { name: /^Add directory…/ });
  await expect(addDirectory).toHaveAttribute('aria-disabled', 'true');
  await expect(addDirectory).toContainText('Session is starting…');
  await page.keyboard.press('Escape');
  await expect(addDirectory).toHaveCount(0);

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
  await expect(p.getByRole('toolbar', { name: 'Composer tools' })).toBeHidden(); // the card takes the box's and the toolbar's place
  await expect(p.getByRole('button', { name: `Location ${repo}` })).toBeHidden(); // W2: the location is the toolbar's, no chip row stays above the card
  await page.keyboard.press('Enter');
  await expect.poll(() => cards(page, 'stubAccepts')).toBe(1);
  await cards(page, 'undockStub');
  await expect(messageIn(page, 0)).toBeFocused();
  await expect(messageIn(page, 0)).toHaveText('next');
  expect(editor.consoleErrors()).toEqual([]);
});

// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, §I; B9): ⇧Tab in the box changes
// the permission mode and the composer's live region says the mode that resulted, "Permission mode: <the chip's label>".
// An unstarted session over the page's stub intent, whose chip writes through the intent as the scene above shows. The
// chip's menu says its own selection, so a pick there leaves the region empty; the press then writes it (the control,
// in this test, of that absence). Waited on: the chip's label, then the region's text.
test('U6b-5a, ⇧Tab says the mode: the composer’s live region reads “Permission mode: Plan” after a press from Accept edits', async ({ editor }) => {
  const { page } = editor;
  const id = 'u6b5-mode-said';
  const intent: HarnessIntent = { location: { kind: 'directory', path: repo }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null };
  await openComposerPage(page);
  await cards(page, 'intent', id, intent);
  await showPanes(page, [{ composer: id }, null]);
  const p = pane(page, 0);
  const chip = p.getByRole('button', { name: /^Permission mode/ });
  const said = p.locator('[data-mode-announcement]');
  await expect(said, 'the region is mounted with the composer, empty').toHaveText('');
  await chip.click();
  await page.getByRole('menuitemradio', { name: /^Accept edits/ }).click();
  await expect(chip).toHaveAttribute('aria-label', 'Permission mode Accept edits');
  await expect(said, 'the chip’s menu says nothing in the region').toHaveText('');

  await messageIn(page, 0).click();
  await page.keyboard.press('Shift+Tab');
  await expect(chip).toHaveAttribute('aria-label', 'Permission mode Plan');
  await expect(said).toHaveText('Permission mode: Plan');
  await expect(said).toHaveAttribute('aria-live', 'polite');
  expect(editor.consoleErrors()).toEqual([]);
});

// ---- UX wave U4a: the stack, Send now, taking a message back, Stop ---------------------------------------------------
// (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, M8's new scenes; C4: each runs alone on a Mac before its
// group.) Each draws its session's transcript above the composer as the session's pane does (`transcript` with
// `stacked`: the slot's `waiting="stacked"`), so a message that waits is drawn in the stack alone (decision 12). Not the
// `shell` pane, the real SessionPane: a replayed launch writes no index record, and that pane shows a session with none
// as unstarted (the CI and Mac runs of b1bad4a07).

const stackOf = (page: Page, index: 0 | 1) => pane(page, index).getByRole('region', { name: 'Queued messages' });
const transcriptOf = (page: Page, index: 0 | 1) => pane(page, index).locator('[data-transcript-scroller]');
const queueOf = async (page: Page, id: string) => value(await invoke(page, 'session.queue.list', { appSessionId: id }));

// A turn running behind the count (`queue-and-interrupt`, held at its next `user` write), its prompt drawn. `indexed`:
// the replay is launched under the scratch config home's indexed session, for an act that needs the session's record,
// as a take-back's save to the session's draft store does (the store refuses a session it does not hold; a replayed
// launch writes no record); the id launched is answered.
async function countRunning(page: Page, id: string, journal: string, options: { indexed?: true } = {}): Promise<string> {
  await openComposerPage(page);
  if (options.indexed) await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === transcriptSession)?.appId ?? '')).not.toBe('');
  await launchReady(page, id, journal);
  await showPanes(page, [{ composer: id, transcript: true, stacked: true }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type(COUNT);
  await page.keyboard.press('Enter');
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  await expect.poll(async () => (await statusOf(page, id)).turn).not.toBeNull();
  await expect(transcriptOf(page, 0)).toContainText('Count to 30 slowly');
  return id;
}

test('U4a, the stack: Enter adds a Next step row and ⌘Enter an After the turn row, each drawn once; three fold to one line that opens on a click', async ({ editor }) => {
  const { page } = editor;
  const id = 'u4a-stack';
  await countRunning(page, id, steerStopJournal(scratch, id));
  const [steered, later, last] = ['Use one Bash call for the rest.', 'Then sum the numbers.', 'And name the largest.'];
  const list = stackOf(page, 0);
  const transcript = transcriptOf(page, 0);

  await page.keyboard.type(steered);
  await page.keyboard.press('Enter'); // the `next` steer, written into the running turn (seq 146)
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  const next = list.locator('li[data-queue-state="next"]');
  await expect(next).toContainText(steered);
  await expect(next.locator('[data-mark]')).toHaveText('Next step');
  await page.keyboard.type(later);
  await page.keyboard.press('Meta+Enter'); // for after the turn: MAWS's queue holds it
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  const after = list.locator('li[data-queue-state="after"]');
  await expect(after).toContainText(later);
  await expect(after.locator('[data-mark]')).toHaveText('After the turn');
  await expect.poll(async () => (await outFrames(page, id)).find((f) => f.type === 'user' && f.message?.content === steered)?.priority).toBe('next');
  expect((await outFrames(page, id)).some((f) => f.type === 'user' && f.message?.content === later), 'a message kept for after the turn is not written while it runs').toBe(false);
  expect((await queueOf(page, id)).entries.filter((e) => e.state === 'queued')).toHaveLength(1);
  for (const text of [steered, later]) await expect(transcript.getByText(text), 'no dimmed bubble at the transcript’s tail').toHaveCount(0);

  await page.keyboard.type(last);
  await page.keyboard.press('Meta+Enter');
  const fold = list.getByRole('button', { name: `3 queued · Next: ${steered}` });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(list.locator('li')).toHaveCount(0);
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(list.locator('li [data-mark]')).toHaveText(['Next step', 'After the turn', 'After the turn']);
  await expect(list.locator('li [data-row-text]')).toHaveText([steered, later, last]);
  await expect(transcript.getByText(last)).toHaveCount(0);
  expect(editor.consoleErrors()).toEqual([]);
});

// Send now behind a running command, over the engine's own answers to it (`sendNowJournal`, `uxwave/u4p2-a-1`): the
// replay holds at the recorded request until the host writes it, and holds that write to the recorded one exactly.
test('U4a, Send now: on a next-step row it writes the engine’s send-now request for the row’s message and pauses nothing; the turn ends for the message and the command reads moved', async ({ editor }) => {
  const { page } = editor;
  const id = 'u4a-send-now';
  await openComposerPage(page);
  await launchReady(page, id, sendNowJournal(scratch, id));
  await showPanes(page, [{ composer: id, transcript: true, stacked: true }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type('Run the long command in the foreground.');
  await page.keyboard.press('Enter'); // seq 12; its Bash call then runs (32)
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  await expect.poll(async () => (await statusOf(page, id)).turn).not.toBeNull();
  const message = 'Reply with one word, then carry on.';
  await page.keyboard.type(message);
  await page.keyboard.press('Enter'); // at the next step, behind the running command (seq 37)
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  const list = stackOf(page, 0);
  const row = list.locator('li[data-queue-state="next"]');
  await expect(row).toContainText(message);
  const sendNow = row.getByRole('button', { name: 'Send now' });
  await expect(sendNow, 'this build’s engine host serves the session (decision 30)').toBeEnabled();
  await expect(sendNow).toHaveAttribute('title', 'Sends this now; what the agent is running keeps running');
  await clickRevealed(row, sendNow);

  // decision 3: the request as the probe wrote it, naming the row's message; nothing held, nothing paused
  const interrupts = async () => (await outFrames(page, id)).filter((f) => f.type === 'control_request' && f.request?.subtype === 'interrupt');
  await expect.poll(async () => (await interrupts()).length).toBe(1);
  const steer = (await outFrames(page, id)).find((f) => f.type === 'user' && f.message?.content === message);
  expect(steer?.priority).toBe('next');
  expect((await interrupts())[0]!.request).toEqual({ subtype: 'interrupt', send_now: true, message_uuid: steer?.uuid });
  expect((await outFrames(page, id)).some((f) => f.request?.subtype === 'cancel_async_message'), 'Send now holds nothing').toBe(false);
  expect((await queueOf(page, id)).paused).toBe(false);

  // the engine answered `delivering` (41), moved the command (43 to 46), ended the turn (`aborted_tools`, 47) and ran the
  // message as its own turn (49): the turn's line reads "Ended for your message", and the command's row reads moved
  const transcript = transcriptOf(page, 0);
  await expect(transcript).toContainText('Ended for your message after');
  await expect(transcript).not.toContainText('You stopped after');
  const toggle = transcript.locator('button[aria-expanded]').filter({ hasText: 'Ended for your message after' });
  if ((await toggle.count()) > 0 && (await toggle.first().getAttribute('aria-expanded')) === 'false') await toggle.first().click();
  await expect(transcript).toContainText(/Moved\s*`?node wait\.cjs a1 30`?\s*to the background after/);
  await expect(transcript).toContainText(message); // drawn once the engine started it
  await expect(list).toHaveCount(0);
  expect((await queueOf(page, id)).paused).toBe(false);
  expect(editor.consoleErrors()).toEqual([]);
});

// Send now on a row that waits after the turn (⌘Enter during a turn) while a turn runs is M3's conditional step (UX wave
// U4b, decision 15; the Decision Log's line on the first Mac run): the queue's promote at `next`, and then the engine's
// send-now request for the uuid it answered, over the engine's own answers (`sendNowAfterJournal`, `uxwave/u4b-two-1`,
// early in the shell call with a message already waiting): the replay holds at each recorded write until the host
// writes it, and holds the request to the promoted message's uuid.
test('U4b, Send now: on an after-the-turn row while a turn runs it goes at the next step and then is sent now with the message waiting there, and pauses nothing; the turn ends for the message', async ({ editor }) => {
  const { page } = editor;
  const id = 'u4b-send-now-after';
  await openComposerPage(page);
  await launchReady(page, id, sendNowAfterJournal(scratch, id));
  await showPanes(page, [{ composer: id, transcript: true, stacked: true }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type('Run the long command in the foreground.');
  await page.keyboard.press('Enter'); // seq 12; its Bash call then runs (32)
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  await expect.poll(async () => (await statusOf(page, id)).turn).not.toBeNull();
  const steered = 'Reply with one word at the next step.';
  await page.keyboard.type(steered);
  await page.keyboard.press('Enter'); // at the next step (37)
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  const later = 'Reply with another word now.';
  await page.keyboard.type(later);
  await page.keyboard.press('Meta+Enter'); // after the turn: MAWS's queue holds it, nothing is written
  const list = stackOf(page, 0);
  const after = list.locator('li[data-queue-state="after"]');
  await expect(after).toContainText(later);
  await expect.poll(async () => (await outFrames(page, id)).find((f) => f.type === 'user' && f.message?.content === steered)?.priority).toBe('next');
  expect((await outFrames(page, id)).some((f) => f.type === 'user' && f.message?.content === later), 'kept for after the turn, not written').toBe(false);
  const sendNow = after.getByRole('button', { name: 'Send now' });
  await expect(sendNow).toBeEnabled();
  await expect(sendNow, 'the message goes with the one waiting at the next step').toHaveAttribute('title', 'Sends the 2 waiting messages now; what the agent is running keeps running');
  await clickRevealed(after, sendNow);

  // the promote at `next` (40), then the request naming the promoted message (41); no frame at `now` for it, nothing
  // held or paused
  const interrupts = async () => (await outFrames(page, id)).filter((f) => f.type === 'control_request' && f.request?.subtype === 'interrupt');
  await expect.poll(async () => (await interrupts()).length).toBe(1);
  const frames = await outFrames(page, id);
  const promoted = frames.findIndex((f) => f.type === 'user' && f.message?.content === later);
  expect(frames[promoted]?.priority, 'the promote at the next step').toBe('next');
  expect(frames.findIndex((f) => f.type === 'control_request' && f.request?.subtype === 'interrupt'), 'the request after the promote’s frame').toBeGreaterThan(promoted);
  expect((await interrupts())[0]!.request).toEqual({ subtype: 'interrupt', send_now: true, message_uuid: frames[promoted]?.uuid });
  expect(frames.filter((f) => f.type === 'user' && f.message?.content === later).map((f) => f.priority), 'written once, at the next step, never at `now`').toEqual(['next']);
  expect(frames.some((f) => f.request?.subtype === 'cancel_async_message'), 'Send now holds nothing').toBe(false);
  expect((await queueOf(page, id)).paused).toBe(false);
  expect((await queueOf(page, id)).entries.filter((e) => e.state === 'queued'), 'the entry left the queue').toEqual([]);

  // the command moved (46) and the turn cut (`aborted_tools`, 50): its line reads "Ended for your message"; both messages
  // started (53, 54) and their rows leave
  const transcript = transcriptOf(page, 0);
  await expect(transcript).toContainText('Ended for your message after');
  await expect(transcript).not.toContainText('You stopped after');
  await expect(list.locator('li')).toHaveCount(0);
  expect((await queueOf(page, id)).paused).toBe(false);
  expect(editor.consoleErrors()).toEqual([]);
});

test('U4a, take back: ↑ in the empty box returns the newest waiting message to the box and removes its row', async ({ editor }) => {
  const { page } = editor;
  const id = await countRunning(page, 'u4a-take-back', steerStopJournal(scratch, 'u4a-take-back'), { indexed: true });
  const [steered, later] = ['Count only to ten.', 'Then say the total.'];
  const list = stackOf(page, 0);
  await page.keyboard.type(steered);
  await page.keyboard.press('Enter'); // at the next step (seq 146)
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  await page.keyboard.type(later);
  await page.keyboard.press('Meta+Enter'); // after the turn, the newer
  await expect(list.locator('li')).toHaveCount(2);
  await expect(messageIn(page, 0)).toHaveText('');

  // the newest is the one kept for after the turn: removed from MAWS's queue, and nothing is written to the engine
  await page.keyboard.press('ArrowUp');
  await expect(messageIn(page, 0)).toHaveText(later);
  await expect(messageIn(page, 0), 'the box is the editor’s again once the take-back has settled').toHaveAttribute('contenteditable', 'true');
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list.locator('li[data-queue-state="next"]')).toContainText(steered);
  expect((await queueOf(page, id)).entries.filter((e) => e.state === 'queued')).toEqual([]);
  expect((await outFrames(page, id)).filter((f) => f.type === 'control_request').map((f) => f.request?.subtype)).not.toContain('cancel_async_message');

  // with the box emptied, ↑ takes the one at the next step: withdrawn from the engine (the recorded `cancel_async_message`)
  await messageIn(page, 0).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(messageIn(page, 0)).toHaveText('');
  // the emptied box reaches the draft store (750 ms after the change) before ↑: a take-back stages only where no draft
  // with a document is kept, and the first message, loaded and settled, was one (decision 13, the claim)
  await expect.poll(async () => value(await invoke(page, 'session.drafts.get', { appSessionId: id as never })), { timeout: 10_000 }).toBeNull();
  await page.keyboard.press('ArrowUp');
  await expect(messageIn(page, 0)).toHaveText(steered);
  await expect(list).toHaveCount(0);
  expect((await outFrames(page, id)).filter((f) => f.type === 'control_request').map((f) => f.request?.subtype)).toContain('cancel_async_message');
  expect((await queueOf(page, id)).steers ?? []).toEqual([]);
  expect((await statusOf(page, id)).turn, 'taking a message back stops nothing').not.toBeNull();
  expect(editor.consoleErrors()).toEqual([]);
});

test('U4a, Stop: the square holds both waiting messages, the stack reads Held under the pause, and Resume sends the oldest, then the next', async ({ editor }) => {
  const { page } = editor;
  const id = 'u4a-stop';
  await countRunning(page, id, steerStopJournal(scratch, id, 2));
  const [first, second] = ['First, list the numbers so far.', 'Second, reply exactly RESUMED.'];
  const list = stackOf(page, 0);
  await page.keyboard.type(first);
  await page.keyboard.press('Meta+Enter'); // after the turn
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  await page.keyboard.type(second);
  await page.keyboard.press('Enter'); // at the next step (seq 146)
  await expect(list.locator('li')).toHaveCount(2);
  await expect(control(page, 0)).toHaveAttribute('data-submit-state', 'stop');
  await control(page, 0).click(); // the square: what waits is held first, then the turn stops

  await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  await expect(list.locator('li [data-mark]')).toHaveText(['Held', 'Held']);
  await expect(list.locator('li [data-row-text]')).toHaveText([first, second]);
  await expect(list.locator('header')).toContainText('Queue paused because you interrupted');
  await expect(list).not.toContainText('when this turn ends');
  const controls = (await outFrames(page, id)).filter((f) => f.type === 'control_request').map((f) => f.request?.subtype);
  expect(controls.indexOf('cancel_async_message'), 'the steer is withdrawn before the interrupt').toBeGreaterThan(-1);
  expect(controls.indexOf('interrupt')).toBeGreaterThan(controls.indexOf('cancel_async_message'));
  expect((await queueOf(page, id)).paused).toBe(true);

  await list.locator('header').getByRole('button', { name: 'Resume' }).click();
  const released = async () => (await outFrames(page, id)).filter((f) => f.type === 'user' && f.priority === undefined && (f.message?.content === first || f.message?.content === second)).map((f) => f.message?.content);
  await expect.poll(released).toEqual([first, second]); // the oldest at once (seq 199), the next when its turn ends
  await expect(list).toHaveCount(0);
  expect(editor.consoleErrors()).toEqual([]);
});

// Board ticket 790 (src/engine-host/queue.ts, `MessageQueue.stop`): a Stop with nothing waiting pauses the queue for
// its phase alone. Once the stopped turn has ended the pause holds nothing and ends, so a message the person then queues
// behind the next turn goes at that turn's end by itself: no Resume, and no row reads Held (`stopThenQueueJournal`; the
// next turn runs until the test's own context read, recorded before its result).
test('ticket 790, Stop with nothing waiting: the pause ends with the stopped turn, and a message queued behind the next turn goes at its end with no Resume, never reading Held', async ({ editor }) => {
  const { page } = editor;
  const id = 'ticket-790-stop-then-queue';
  await countRunning(page, id, stopThenQueueJournal(scratch, id));
  const list = stackOf(page, 0);
  type Row = { direction: string; frame: Record<string, unknown> };
  const rows = async (): Promise<Row[]> =>
    readFileSync((await statusOf(page, id)).journalPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Row);
  const isInterrupt = (r: Row) => r.direction === 'out' && r.frame.type === 'control_request' && (r.frame.request as { subtype?: string }).subtype === 'interrupt';
  await expect(list).toHaveCount(0);
  await expect(control(page, 0)).toHaveAttribute('data-submit-state', 'stop');
  await control(page, 0).click(); // the square, with nothing waiting: the interrupt alone
  await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  const controls = (await outFrames(page, id)).filter((f) => f.type === 'control_request').map((f) => f.request?.subtype);
  expect(controls).toContain('interrupt');
  expect(controls, 'nothing was waiting to withdraw').not.toContain('cancel_async_message');
  await expect.poll(async () => (await queueOf(page, id)).paused, 'the pause held nothing and ended with the stopped turn').toBe(false);
  await expect(list).toHaveCount(0);
  // the app's own context read after the stopped turn, answered by the replay before the person's send, so the read the
  // replay holds the next turn at is the test's
  await expect
    .poll(async () => {
      const all = await rows();
      return all.slice(all.findIndex(isInterrupt)).some((r) => r.direction === 'meta' && r.frame.event === 'replay_unrecorded_read' && r.frame.subtype === 'get_context_usage');
    })
    .toBe(true);

  const [next, later] = ['Now reply exactly NEXT.', 'Then reply exactly LATER.'];
  await messageIn(page, 0).click(); // the square's click took the keyboard
  await page.keyboard.type(next);
  await expect(messageIn(page, 0)).toHaveText(next);
  await page.keyboard.press('Enter'); // idle: sent at once, the next turn
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  await expect.poll(async () => (await outFrames(page, id)).some((f) => f.type === 'user' && f.message?.content === next)).toBe(true);
  await expect.poll(async () => (await statusOf(page, id)).turn).not.toBeNull();
  await page.keyboard.type(later);
  await expect(messageIn(page, 0)).toHaveText(later);
  await page.keyboard.press('Meta+Enter'); // for after the turn: MAWS's queue holds it
  await expect(messageIn(page, 0), 'the box is cleared by the send before the next words are typed').toHaveText('');
  const row = list.locator('li');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-queue-state', 'after');
  await expect(row.locator('[data-mark]')).toHaveText('After the turn');
  await expect(row).toContainText(later);
  await expect(list, 'no pause line: the stack has no header while nothing is paused').not.toContainText('Queue paused');
  expect((await queueOf(page, id)).paused).toBe(false);
  expect((await outFrames(page, id)).some((f) => f.type === 'user' && f.message?.content === later), 'kept for after the turn, not written while it runs').toBe(false);

  // the turn ends (the replay plays its result after the test's read): the message goes by itself, its row leaves
  value(await invoke(page, 'session.getContextUsage', { appSessionId: id as never, detail: 'summary' }));
  await expect.poll(async () => (await outFrames(page, id)).filter((f) => f.type === 'user' && f.message?.content === later)).toHaveLength(1);
  await expect(list).toHaveCount(0);
  await expect(list.locator('li[data-queue-state="held"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume', exact: true }), 'no Resume to press').toHaveCount(0);
  expect((await queueOf(page, id)).paused).toBe(false);
  const all = await rows();
  const results = all.flatMap((r, k) => (r.direction === 'in' && r.frame.type === 'result' ? [k] : []));
  const written = all.findIndex((r) => r.direction === 'out' && r.frame.type === 'user' && (r.frame.message as { content?: unknown } | undefined)?.content === later);
  expect(results.length, 'the stopped turn’s result and the next turn’s').toBeGreaterThanOrEqual(2);
  expect(written, 'written after the next turn’s result').toBeGreaterThan(results[1]!);
  expect(editor.consoleErrors()).toEqual([]);
});

// UX wave U4b (docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md, M4; Acceptance 1 and 3): a question
// the agent asked without waiting, answered while a turn runs, waits in the stack as what it is. The running turn holds
// the agent's recorded async ask (`askedSteerStopJournal`: `pass3/p1-maws-ask-async`'s call and acknowledgement), so the
// window holds the ask's row, as it does whenever a person answers an ask of the session they watch. The envelope the
// host writes for that ask's questions (the real `askSteerText`: since board ticket 711 each question by its place and a
// pick by `option <k>`, no text the model wrote) is handed to the running turn through `session.steer`, as the answered
// sheet hands it (the replay matches a user write by its type, not its text, so the journal's steer at seq 146 takes
// it); the row reads it back through the ask's questions (`askAnswersFromSteer`) as "Answer to <header, else the
// question>: <label>". It offers Send now alone; ↑ in the empty box skips it and walks the history; then an answer to an
// ask the window does not hold waits after the turn and reads the bare words, the pick by its place; after the square's
// Stop both read the same, marked Held.
const ANSWER_ROW = (question: AskQuestion, label: string) => `Answer to ${question.header ?? question.question}: ${label}`; // Interfaces A: `answer(title, words)`
const NO_CALL_ROW = 'Answer: option 1'; // Interfaces A: `answerBare(words)`, no ask's questions in hand

test('U4b, a waiting answer: the stack’s row reads “Answer to …”, offers Send now alone, ↑ walks the history past it, and after Stop it reads the same, Held', async ({ editor }) => {
  const { page } = editor;
  const id = 'u4b-answer';
  await countRunning(page, id, askedSteerStopJournal(scratch, id));
  const { askId, questions } = asyncAsk();
  const [question] = questions as [AskQuestion];
  const label = question.options![0]!.label;
  await expect(transcriptOf(page, 0).locator(`section.transcript-ask[data-ask-id="${askId}"]`), 'the window holds the ask’s row').toHaveAttribute('data-ask-state', 'asked');
  const list = stackOf(page, 0);
  const answered: AskAnswer = { id: question.id ?? 'q1', question: question.question, status: 'answered', value: [label] };
  const envelope = askSteerText(askId, questions, [answered]);
  expect(envelope, 'the host’s new form: no text the model wrote').not.toContain(question.question);
  value(await invoke(page, 'session.steer', { appSessionId: id as never, content: envelope, priority: 'next' }));

  const row = list.locator('li[data-queue-state="next"]');
  const rowText = ANSWER_ROW(question, label);
  await expect(row.locator('[data-row-text]')).toHaveText(rowText);
  await expect(row.locator('[data-row-text]'), 'the whole line in its hover title').toHaveAttribute('title', rowText);
  await expect(row.locator('[data-mark]')).toHaveText('Next step');
  await expect(list, 'not the envelope’s opening words').not.toContainText('[MAWS ask');
  await expect(row.getByRole('button', { name: 'Send now' })).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'Delete' }), 'an answer is not deleted or edited from the stack').toHaveCount(0);
  await expect(row.getByRole('button', { name: 'More' })).toHaveCount(0);
  await expect.poll(async () => (await outFrames(page, id)).find((f) => f.type === 'user' && f.message?.content === envelope)?.priority).toBe('next');

  // ↑ in the empty box takes nothing back: the answer is skipped and the history walks to the session's prompt
  await expect(messageIn(page, 0)).toHaveText('');
  await page.keyboard.press('ArrowUp');
  await expect(messageIn(page, 0), 'the history’s newest entry, the running turn’s prompt').toHaveText(COUNT);
  await expect(row.locator('[data-row-text]'), 'the answer still waits').toHaveText(rowText);
  await page.keyboard.press('ArrowDown'); // back to the empty draft the walk began from
  await expect(messageIn(page, 0)).toHaveText('');
  expect((await outFrames(page, id)).some((f) => f.request?.subtype === 'cancel_async_message'), 'nothing was taken back').toBe(false);

  // the no-call reading: an answer to an ask the window holds no row of, sent while the turn runs, waits after the turn
  // in MAWS's queue (nothing is written to the engine) and reads the bare words, the pick by its place
  const elsewhere = askSteerText('u4b-ask-elsewhere', questions, [answered]);
  expect(value(await invoke(page, 'session.send', { appSessionId: id as never, content: elsewhere }))).toMatchObject({ disposition: 'queued' });
  const after = list.locator('li[data-queue-state="after"]');
  await expect(after.locator('[data-row-text]')).toHaveText(NO_CALL_ROW);
  await expect(after.getByRole('button', { name: 'Send now' })).toHaveCount(1);
  await expect(after.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(list, 'neither row shows an envelope').not.toContainText('[MAWS ask');
  expect((await outFrames(page, id)).some((f) => f.type === 'user' && f.message?.content === elsewhere), 'it was not written').toBe(false);

  // the square: the answer is held into MAWS's paused queue before the interrupt, and both read the same, marked Held
  await expect(control(page, 0)).toHaveAttribute('data-submit-state', 'stop');
  await control(page, 0).click();
  await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  const held = list.locator('li[data-queue-state="held"]');
  await expect(held).toHaveCount(2);
  for (const text of [rowText, NO_CALL_ROW]) {
    const one = held.filter({ has: page.locator('[data-row-text]', { hasText: text }) });
    await expect(one.locator('[data-row-text]')).toHaveText(text);
    await expect(one.locator('[data-mark]')).toHaveText('Held');
    await expect(one.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  }
  await expect(list.locator('header')).toContainText('Queue paused because you interrupted');
  expect((await queueOf(page, id)).paused).toBe(true);
  expect(editor.consoleErrors()).toEqual([]);
});

// The UX wave, ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M3's scene; Acceptance 3 and 4): a prompt
// sent at the next step while a turn runs, and then the answer to a question the agent asked without waiting, wait
// together, and the engine writes them to the model as one message (`joinedAnswerJournal`, probe 1's
// `u704-end-prompt-first-1`). The host splits it where it becomes an event: the person's bubble holds the prompt alone,
// nothing on the page begins `[MAWS ask` or shows the answer's JSON, and the ask's capsule reads answered. The ask is
// the recording's real call, answered by the host's own `maws` server; the answer goes through `maws.ask.answer`, as
// the Question sheet's Submit sends it. Since board ticket 711 the host writes that envelope in its new form (no text the
// model wrote), while the recording's joined replay holds the envelope the probe wrote, in the earlier form: the replay
// matches a write by its type, so the window draws the recording's joined line, split as any is, and the capsule keeps
// the answers of the host's own write, which came first. Nothing asserted here reads the envelope's lines.
test('ticket 704, a joined answer: the prompt and the answer the engine joined draw as the person’s prompt alone and an answered capsule', async ({ editor }) => {
  const { page } = editor;
  const id = 'u704-joined-answer';
  const recorded = joinedAnswerRecorded();
  await openComposerPage(page);
  await launchReady(page, id, joinedAnswerJournal(scratch, id));
  await showPanes(page, [{ composer: id, transcript: true, stacked: true }, null]);
  value(await invoke(page, 'session.send', { appSessionId: id as never, content: recorded.first })); // seq 18
  // the engine's non-blocking ask (109), answered by the host's server at once; the turn runs on, held at the next write
  let askId = '';
  await expect.poll(async () => (askId = value(await invoke(page, 'maws.asks.list', { appSessionId: id as never })).asks[0]?.askId ?? '')).not.toBe('');
  await expect.poll(async () => (await statusOf(page, id)).turn).not.toBeNull();

  await messageIn(page, 0).click();
  await page.keyboard.type(recorded.prompt);
  await page.keyboard.press('Enter'); // at the next step (159)
  await expect.poll(async () => (await outFrames(page, id)).find((f) => f.type === 'user' && f.message?.content === recorded.prompt)?.priority).toBe('next');
  expect(value(await invoke(page, 'maws.ask.answer', { appSessionId: id as never, askId, answers: recorded.answers as AskAnswer[] })).outcome).toBe('delivered'); // the envelope (161)
  await expect.poll(async () => (await outFrames(page, id)).filter((f) => f.type === 'user' && f.priority === 'next').length).toBe(2);

  // the joined turn (676 to 726) drawn and ended
  // the prompt as the bubble draws it: its text is Markdown, so the backticks around `echo KIWI` draw as inline code
  const drawn = recorded.prompt.replace(/`([^`]*)`/g, '$1');
  const transcript = transcriptOf(page, 0);
  const bubble = transcript.locator('.transcript-user').filter({ hasText: drawn });
  await expect(bubble).toHaveCount(1);
  await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  await expect(bubble).toHaveCount(1);
  await expect(bubble.locator('[data-user-content]'), 'the person’s words alone, exactly').toHaveText(drawn);
  await expect(bubble.locator('[data-user-content] code')).toHaveText('echo KIWI');
  await expect(bubble, 'nothing of the envelope').not.toContainText('[MAWS ask');
  await expect(transcript, 'no envelope anywhere on the page').not.toContainText('[MAWS ask');
  await expect(pane(page, 0), 'nor its block').not.toContainText('"status": "answered"');
  await expect(transcript.locator('section.transcript-ask')).toHaveAttribute('data-ask-state', 'answered');
  expect(editor.consoleErrors()).toEqual([]);
});

// ---- UX wave U1c: "Approve and retry" under a call auto mode blocked --------------------------------------------------
// (docs/doperpowers/plans/2026-11-15-ux-wave-U1c-approve-and-retry.md, §H, M5's scenes; each runs alone on a Mac before
// its group.) Each draws its session's transcript above the composer as U4a's scenes do, the pane spanning the page; the
// page registers the control as App.tsx does. What the press wrote is read from the engine host's journal of the launch
// (the replay matches a `user` write by its type). The probe's tool use ids name the rows: a cell's id is its call's.

const MARKER = 'curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"'; // the probe's blocked command
const APPROVE = 'Approve and retry';
const cellIn = (page: Page, toolUseId: string) => transcriptOf(page, 0).locator(`[data-cell-id="cell:${toolUseId}"]`);
const labelOf = (cell: Locator) => cell.locator('.transcript-cell-label');
const grantsWritten = async (page: Page, id: string, subject: string) => (await outFrames(page, id)).filter((f) => f.type === 'user' && f.message?.content === consentMessage('command', subject));

// A replayed session in the wide transcript pane, its prompt sent.
async function blockedSession(page: Page, id: string, journal: string, prompt: string): Promise<void> {
  await openComposerPage(page);
  await launchReady(page, id, journal);
  await showPanes(page, [{ composer: id, transcript: true, stacked: true, wide: true }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type(prompt);
  await page.keyboard.press('Enter');
  await expect(messageIn(page, 0), 'the box is cleared by the send').toHaveText('');
}

// The transcript read from its top, so a row of the first turn is drawn: a wheel stops it following the tail, as a person's would.
const toTop = (page: Page) =>
  transcriptOf(page, 0).evaluate((element) => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }));
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });

// A cell of the newest turn, which folded when it ended: its line opened until the cell is drawn.
async function inNewestTurn(page: Page, toolUseId: string): Promise<Locator> {
  const cell = cellIn(page, toolUseId);
  await expect(async () => {
    const line = transcriptOf(page, 0).locator('.transcript-divider .transcript-disclosure').last();
    if ((await line.getAttribute('aria-expanded')) === 'false') await line.click();
    await expect(cell).toBeVisible({ timeout: 1_000 });
  }, 'the newest turn opened to its cell').toPass();
  return cell;
}

// S1 (Acceptance 1, 13): `u1-soft-seeded-1`, the block (seq 32 to 36) in the prompt's turn, the grant the press writes
// (48), the turn it opens and the retry that runs (66 to 70).
test('U1c S1: a blocked command reads its short label with the button under its whole line; the press writes the engine’s grant, "You approved" is drawn, the row reads approved and the retry runs', async ({ editor }, testInfo) => {
  const { page } = editor;
  const id = 'u1c-approve';
  await blockedSession(page, id, recordedBlockJournal(scratch, id, 'u1-soft-seeded-1'), 'Run the marker command.');
  const transcript = transcriptOf(page, 0);

  // the block's turn ends and folds; its line counts the block, and the count opens the row
  const count = transcript.getByRole('link', { name: '1 auto-denied' });
  await expect(count).toBeVisible();
  await count.click();
  const row = cellIn(page, 'toolu_01JqskAh583hVgaieABZQ9yn');
  await expect(labelOf(row), 'the short label, no reason: the classifier gave only its stand-in').toHaveText(`Auto mode blocked: ${MARKER}`);
  await expect(row, 'the line names the command whole').toHaveAttribute('data-names-whole', '');
  await expect(row.locator('.transcript-blocked-subject'), 'so no subject block').toHaveCount(0);
  const button = row.getByRole('button', { name: APPROVE });
  await expect(button).toBeEnabled();
  expect(await labelOf(row).evaluate((el) => ({ whiteSpace: getComputedStyle(el).whiteSpace, clipped: el.scrollWidth > el.clientWidth + 1 })), 'the line wraps, never clips').toEqual({ whiteSpace: 'pre-wrap', clipped: false });
  const [line, place] = [(await labelOf(row).boundingBox())!, (await button.boundingBox())!];
  expect(place.y, 'the button stands under the line').toBeGreaterThanOrEqual(line.y + line.height - 1);
  await expect(transcript, 'the stand-in reason is drawn nowhere').not.toContainText('it gave no explanation');
  await testInfo.attach('u1c-s1-offered', { body: await pane(page, 0).screenshot(), contentType: 'image/png' });

  await button.click();
  await expect.poll(async () => (await grantsWritten(page, id, MARKER)).length, 'the press writes the engine’s sentence once').toBe(1);
  await expect(transcript.locator('.transcript-consent')).toHaveText(`You approved ${MARKER}`);
  await expect((await inNewestTurn(page, 'toolu_01SuiSQhK6v2WVoFVJ5DMz9s')), 'the retry ran').toHaveAttribute('data-status', 'done');
  await toTop(page);
  await expect(labelOf(row)).toHaveText(`Auto mode blocked: ${MARKER} · approved`);
  await expect(row.getByRole('button', { name: APPROVE }), 'an approved row offers no button').toHaveCount(0);
  await testInfo.attach('u1c-s1-approved', { body: await pane(page, 0).screenshot(), contentType: 'image/png' });
  expect(await grantsWritten(page, id, MARKER), 'one grant, whatever followed').toHaveLength(1);
  expect(editor.consoleErrors()).toEqual([]);
});

// S2 (Acceptance 2): `u1-hard-seeded-1`, a rule that always denies: the block (seq 31 to 35), the grant (47), and the
// retry blocked again in the turn the grant opens (65 to 69).
test('U1c S2: a retry blocked again reads "Auto mode blocked again", offers the button once more and says in one muted line that such a rule blocks every time', async ({ editor }, testInfo) => {
  const { page } = editor;
  const id = 'u1c-again';
  await blockedSession(page, id, recordedBlockJournal(scratch, id, 'u1-hard-seeded-1'), 'Run the marker command.');
  const transcript = transcriptOf(page, 0);
  const counts = transcript.getByRole('link', { name: '1 auto-denied' });
  await expect(counts).toHaveCount(1);
  await counts.click();
  const first = cellIn(page, 'toolu_01AkGpuG3dxh4J2MM2ofSfZ9');
  await first.getByRole('button', { name: APPROVE }).click();
  await expect.poll(async () => (await grantsWritten(page, id, MARKER)).length).toBe(1);

  // the turn the grant opened ends blocked again: its own count opens its row
  await expect(transcript.locator('.transcript-consent')).toHaveText(`You approved ${MARKER}`);
  await expect(counts).toHaveCount(2);
  await counts.last().click();
  const again = cellIn(page, 'toolu_01DFoKqdVo4KipfKh9bopZFU');
  await expect(labelOf(again)).toHaveText(`Auto mode blocked again: ${MARKER}`);
  await expect(again.getByRole('button', { name: APPROVE }), 'offered once more').toBeEnabled();
  await expect(again.getByRole('status')).toHaveText('A rule that always denies this command blocks it every time. Change the rule or the mode to run it.');
  await testInfo.attach('u1c-s2-blocked-again', { body: await pane(page, 0).screenshot(), contentType: 'image/png' });
  await toTop(page);
  await expect(labelOf(first), 'the first row reads approved').toHaveText(`Auto mode blocked: ${MARKER} · approved`);
  expect(editor.consoleErrors()).toEqual([]);
});

// S3 (Acceptance 11, 13): `blockedTurnJournal`, a blocked command of two lines and the call after it still running.
const TWO_LINES = `${MARKER}\nwc -c marker-1.txt`;
test('U1c S3: a blocked command of two lines shows its subject whole above the button; pressed while the turn runs, the grant waits at the next step in the stack and greys the button; Delete brings the button back; pressed again, it is read at the running call’s result and the row reads approved', async ({ editor }, testInfo) => {
  const { page } = editor;
  const id = 'u1c-during-turn';
  const prompt = 'Do the two steps of the task, then reply DONE.';
  await blockedSession(page, id, blockedTurnJournal(scratch, id, prompt, TWO_LINES), prompt);
  await expect.poll(async () => (await statusOf(page, id)).turn, 'the turn runs on: the call after the block is held').not.toBeNull();

  // the open turn draws the blocked row: the subject the grant quotes, whole, then the button under it
  const row = cellIn(page, 'toolu_01UhxMDp7hAUYgsRA67ph4Dr');
  const subject = row.locator('pre.transcript-blocked-subject');
  await expect.poll(() => subject.textContent(), 'the block holds exactly the command the grant quotes').toBe(TWO_LINES);
  expect(await row.getAttribute('data-names-whole'), 'a command of two lines is not named on the line').toBeNull();
  const button = row.getByRole('button', { name: APPROVE });
  await expect(button).toBeEnabled();
  const [block, place] = [(await subject.boundingBox())!, (await button.boundingBox())!];
  expect(place.y, 'the button stands under the subject').toBeGreaterThanOrEqual(block.y + block.height - 1);
  await testInfo.attach('u1c-s3-subject', { body: await pane(page, 0).screenshot(), contentType: 'image/png' });

  // pressed while the turn runs: a steer at the next step, waiting in the stack as the line it becomes
  await button.click();
  await expect.poll(async () => (await grantsWritten(page, id, TWO_LINES)).map((f) => f.priority)).toEqual(['next']);
  const waiting = stackOf(page, 0).locator('li[data-queue-state="next"]');
  await expect(waiting.locator('[data-mark]')).toHaveText('Next step');
  await expect(waiting.locator('[data-row-text]')).toContainText(`You approved ${MARKER}`);
  await expect(waiting.locator('[data-row-text]')).toContainText('wc -c marker-1.txt');
  await expect(waiting.getByRole('button', { name: 'Send now' })).toHaveCount(1);
  await expect(waiting.getByRole('button', { name: 'Delete' })).toHaveCount(1);
  await expect(waiting.getByRole('button', { name: 'More' }), 'a grant is not edited or moved').toHaveCount(0);
  await expect(button, 'greyed while the grant waits').toBeDisabled();
  await expect(labelOf(row)).not.toHaveText(/· approved$/);
  await testInfo.attach('u1c-s3-greyed-with-stack', { body: await pane(page, 0).screenshot(), contentType: 'image/png' });

  // Delete withdraws the steer (the engine's `cancel_async_message` for the grant's write), and the button is back
  await clickRevealed(waiting, waiting.getByRole('button', { name: 'Delete' }));
  const [firstWrite] = await grantsWritten(page, id, TWO_LINES);
  await expect.poll(async () => (await outFrames(page, id)).filter((f) => f.type === 'control_request' && f.request?.subtype === 'cancel_async_message').map((f) => f.request?.message_uuid)).toEqual([firstWrite!.uuid]);
  await expect(stackOf(page, 0)).toHaveCount(0);
  await expect(button, 'the withdrawn grant leaves nothing waiting').toBeEnabled();

  // pressed again: written at the next step, read at the held call's result; the retry runs in the same turn
  await button.click();
  await expect.poll(async () => (await grantsWritten(page, id, TWO_LINES)).map((f) => f.priority)).toEqual(['next', 'next']);
  await expect(transcriptOf(page, 0).locator('.transcript-consent:not([data-dropped])')).toContainText(`You approved ${MARKER}`);
  await expect.poll(async () => (await statusOf(page, id)).turn, 'the turn ends').toBeNull();
  await toTop(page);
  const count = transcriptOf(page, 0).getByRole('link', { name: '1 auto-denied' });
  await count.click(); // the ended turn folded its work: the count opens it again
  await expect(labelOf(row)).toHaveText(/ · approved$/);
  await expect(row.getByRole('button', { name: APPROVE })).toHaveCount(0);
  await expect(cellIn(page, 'toolu_01QgESWU7YNR7Dsx71taDieF'), 'the retry ran').toHaveAttribute('data-status', 'done');
  await testInfo.attach('u1c-s3-approved', { body: await pane(page, 0).screenshot(), contentType: 'image/png' });
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

// W3 (B6): Edit turns the bubble itself into an editor (Codex's pattern); its Send rewinds this session to that message
// and resends. Once the rewind hid the bubble with its turn and the resend still waits, the composer's dock carries it.
const inlineEditor = (page: Page) => pane(page, 0).getByRole('region', { name: 'Edit your message' });
const inlineStatus = (page: Page) => inlineEditor(page).getByRole('status');
const editLine = (page: Page) => pane(page, 0).locator('[data-edit-mode]');

// Two prompts sent from the composer over `rewindJournal`, then the second bubble's Edit (C6's, through the adapter
// App.tsx registers): the bubble becomes an editor holding `turn two`, nothing goes into the composer, and ` edited` is
// typed at its end.
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
  await clickRevealed(bubble, bubble.getByRole('button', { name: 'Edit' }));
  const field = inlineEditor(page).getByRole('textbox', { name: 'Edited message' });
  await expect(field).toHaveValue('turn two');
  await expect(field).toBeFocused();
  await expect(messageIn(page, 0)).toHaveText(''); // nothing is pulled into the composer
  await expect(pane(page, 0).getByText('Editing an earlier message')).toHaveCount(0);
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
}

// The editor's Send (after `beforeSend`): this session rewinds to that message, no confirm when nothing newer started.
async function sendEdit(page: Page, beforeSend: () => Promise<unknown> = async () => {}): Promise<void> {
  await beforeSend();
  await inlineEditor(page).getByRole('button', { name: 'Send' }).click();
}

async function editSecondPrompt(page: Page, id: string, replay: RewindReplay, beforeSend?: () => Promise<unknown>): Promise<void> {
  await startEdit(page, id, replay);
  await sendEdit(page, beforeSend);
}

test('edit in place: Send rewinds to the message and resends, the bubble replaced by the edited one', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-edit-in-place';
  await editSecondPrompt(page, id, 'answered');
  await expect.poll(() => sent(page, id)).toEqual(['turn one', 'turn two', 'turn two edited']);
  await expect(inlineEditor(page)).toHaveCount(0);
  await expect(editLine(page)).toHaveCount(0);
  await expect(pane(page, 0).locator('.transcript-user').filter({ hasText: /^turn two$/ })).toHaveCount(0); // the rewound bubble left with its turn
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 0, users: 3 });
  expect(editor.consoleErrors()).toEqual([]);
});

test('edit in place never repeats a rewind: a send that fails after the replayed rewind retries the send alone from the dock', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-resubmit-send-fails';
  await editSecondPrompt(page, id, 'answered', () => cards(page, 'failNextSend', id)); // the resend after the rewind fails
  await expect(editLine(page)).toHaveText(/Rewound · the message was not sent/);
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 0, users: 2 }); // rewound; the resend never reached the engine
  await editLine(page).getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => sent(page, id)).toEqual(['turn one', 'turn two', 'turn two edited']);
  await expect(editLine(page)).toHaveCount(0);
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 0, users: 3 });
  expect((await statusOf(page, id)).process).toBe('ready');
  expect(editor.consoleErrors()).toEqual([]);
});

test('edit in place reconciles an unconfirmed rewind: held past the bridge timeout, its late answer lets Send go', async ({ editor }) => {
  test.setTimeout(90_000);
  const { page } = editor;
  const id = 'c7-resubmit-held';
  await editSecondPrompt(page, id, 'held');
  await expect(inlineStatus(page)).toHaveText(/Rewind unconfirmed · checking the transcript…/, { timeout: 15_000 }); // C3's 8 s bound answered `timeout`
  await expect(inlineEditor(page).getByRole('textbox', { name: 'Edited message' })).toHaveAttribute('readonly', '');
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 1, users: 2 });

  // the held answer is released: a read of the test's own goes first, and the late `rewound: true` follows it
  value(await invoke(page, 'session.getContextUsage', { appSessionId: id, detail: 'summary' }));
  await expect(editLine(page)).toHaveText(/Rewound · send your edited message/); // the bubble left with its turn
  expect(await sent(page, id)).toEqual(['turn one', 'turn two']); // confirmed by the transcript: Send is the human's
  await editLine(page).getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => sent(page, id)).toEqual(['turn one', 'turn two', 'turn two edited']);
  await expect(editLine(page)).toHaveCount(0);
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 1, users: 3 });
  expect(editor.consoleErrors()).toEqual([]);
});

test('edit in place reconciles an unconfirmed rewind: withheld for the whole window, Send without rewinding sends alone', async ({ editor }) => {
  test.setTimeout(90_000);
  const { page } = editor;
  const id = 'c7-resubmit-withheld';
  await openComposerPage(page);
  await cards(page, 'rewindWindow', 2_000); // C3's late window is 60 s; the composer's is shortened for the run
  await editSecondPrompt(page, id, 'withheld');
  await expect(inlineStatus(page)).toHaveText(/Rewind unconfirmed · checking the transcript…/, { timeout: 15_000 });
  await expect(inlineStatus(page)).toHaveText(/The rewind could not be confirmed/);
  expect(await inlineEditor(page).getByRole('button').allTextContents()).toEqual(['Rewind again', 'Send without rewinding', 'Keep editing']);
  await expect(inlineEditor(page).getByRole('textbox', { name: 'Edited message' })).not.toHaveAttribute('readonly', '');
  await inlineEditor(page).getByRole('button', { name: 'Send without rewinding' }).click();
  await expect.poll(() => sent(page, id)).toEqual(['turn one', 'turn two', 'turn two edited']);
  await expect(inlineEditor(page)).toHaveCount(0);
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 1, users: 3 });
  await cards(page, 'rewindWindow', null);
  expect(editor.consoleErrors()).toEqual([]);
});

test('edit in place: Cancel and Esc put the bubble back, and nothing is written', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-edit-cancel';
  await startEdit(page, id, 'answered');
  await inlineEditor(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(inlineEditor(page)).toHaveCount(0);
  const bubble = pane(page, 0).locator('.transcript-user').filter({ hasText: 'turn two' });
  await clickRevealed(bubble, bubble.getByRole('button', { name: 'Edit' }));
  await expect(inlineEditor(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inlineEditor(page)).toHaveCount(0);
  expect(await written(page, id)).toEqual({ rewinds: 0, cancels: 0, users: 2 });
  expect(editor.consoleErrors()).toEqual([]);
});

// W3 (B7, charter §5.4 as amended 2026-10-01): Esc Esc on an empty composer while no turn runs opens the rewind picker
// as a floating dialog; a conversation rewind leaves the engine's `prefillText` in the composer.
test('Esc Esc opens the rewind picker over the session’s messages; a conversation rewind leaves the engine’s text in the composer', async ({ editor }) => {
  const { page } = editor;
  const id = 'c7-rewind-picker';
  await openComposerPage(page);
  await launchReady(page, id, rewindJournal(scratch, id, 'answered'));
  await showPanes(page, [{ composer: id, transcript: true }, null]);
  for (const text of ['turn one', 'turn two']) {
    await messageIn(page, 0).click();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect.poll(() => sent(page, id)).toContain(text);
    await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  }
  await messageIn(page, 0).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const picker = page.getByRole('dialog', { name: 'Rewind' });
  await expect(picker).toBeVisible();
  const messages = picker.getByRole('radiogroup', { name: 'Your messages' }).getByRole('radio');
  await expect(messages).toHaveCount(2);
  await expect(messages.first()).toContainText('turn two'); // newest first, chosen
  await expect(messages.first()).toHaveAttribute('aria-checked', 'true');
  await expect(picker.getByRole('radio', { name: 'Conversation' })).toHaveAttribute('aria-checked', 'true');
  await picker.getByRole('button', { name: 'Rewind to before it' }).click();
  await expect(picker).toBeHidden();
  await expect(messageIn(page, 0)).toHaveText('turn 2'); // the engine's prefillText (the journal's answer)
  await expect(messageIn(page, 0)).toBeFocused();
  await expect(pane(page, 0).locator('.transcript-user').filter({ hasText: 'turn two' })).toHaveCount(0); // the rewound turn left the view
  expect(await written(page, id)).toEqual({ rewinds: 1, cancels: 0, users: 2 });
  expect(editor.consoleErrors()).toEqual([]);
});

// ---- W2: proportions -----------------------------------------------------------------------------------------------

// The rendered box of an element, and its padding, read in the page.
const geometry = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return { left: box.left, width: box.width, height: box.height, padLeft: parseFloat(style.paddingLeft), padRight: parseFloat(style.paddingRight), fontSize: style.fontSize, lineHeight: style.lineHeight };
  });

// B1 (charter §6 as amended 2026-10-01): the transcript's rows and the composer frame share one column, Codex's. In a pane
// wider than the column both sit at its 768px cap with 16px inside, so the frame is exactly the 736px of text; the prose
// is 14px at a 22.75px pitch.
test('W2: the shared column, the 14px prose, Codex’s bubble and Codex’s composer box', async ({ editor }) => {
  const { page } = editor;
  const id = 'w2-column';
  await openComposerPage(page);
  await launchReady(page, id, turnsJournal(scratch, id, 1));
  await showPanes(page, [{ composer: id, transcript: true, wide: true }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type('turn one');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
  const p = pane(page, 0);
  const userRow = p.locator('.transcript-row[data-kind="user"]').first();
  await expect(userRow).toBeVisible();

  const row = await geometry(userRow);
  const column = await geometry(p.locator('[data-composer]').locator('xpath=..'));
  const frame = await geometry(p.locator('[data-composer-frame]'));
  expect(row.width).toBe(768); // the column's cap, in px
  expect([row.padLeft, row.padRight]).toEqual([16, 16]);
  expect(column.width).toBe(row.width); // the composer's column is the transcript's
  expect(column.left).toBe(row.left);
  expect(frame.width).toBe(row.width - row.padLeft - row.padRight); // 736: the frame is exactly the text's width
  expect(frame.left).toBe(row.left + row.padLeft);
  expect(row.fontSize).toBe('14px');
  expect(await geometry(userRow.locator('.transcript-user-bubble p').first())).toMatchObject({ fontSize: '14px', lineHeight: '22.75px' });

  // B2: Codex's bubble. At most 70 percent of the column, 22px corners, 10 by 16px inside, the text colour at 5 percent
  // (the token), the prose's size. Time, Copy and Edit sit on one line under it, at its side, shown on hover or focus
  // within, in the 16 px the row already has under the bubble (B2 as amended 2026-11-12, UX wave U3, O-02).
  const bubble = userRow.locator('[data-bubble]');
  const look = await bubble.evaluate((el) => {
    const style = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'color-mix(in oklab, var(--fg) 5%, transparent)';
    document.body.append(probe);
    const tint = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      radius: style.borderTopLeftRadius,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      fontSize: style.fontSize,
      border: style.borderTopWidth,
      tinted: style.backgroundColor === tint,
      maxWidth: getComputedStyle(el.parentElement!).maxWidth,
    };
  });
  expect(look).toEqual({ radius: '22px', padding: ['10px', '16px', '10px', '16px'], fontSize: '14px', border: '0px', tinted: true, maxWidth: '70%' });
  const restRow = (await userRow.boundingBox())!.height;
  const bubbleHeight = (await bubble.boundingBox())!.height;
  expect(restRow - bubbleHeight).toBe(16); // the line under the bubble is laid out in the row's own 16 px
  const actions = userRow.locator('.transcript-user-line-actions');
  await expect(actions).toHaveCSS('opacity', '0');
  await actions.getByRole('button', { name: 'Copy' }).focus(); // as a hover does (a hover here scrolls the short harness transcript under the pointer)
  await expect(actions).toHaveCSS('opacity', '1');
  expect((await userRow.boundingBox())!.height).toBe(restRow); // showing them adds no height
  const actionsBox = (await actions.boundingBox())!;
  const bubbleBox = (await bubble.boundingBox())!;
  const rowBox = (await userRow.boundingBox())!;
  expect(actionsBox.y).toBeGreaterThanOrEqual(bubbleBox.y + bubbleBox.height - 0.5); // under the bubble, not beside it
  expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 0.5); // inside the row
  expect(actionsBox.x + actionsBox.width).toBeCloseTo(bubbleBox.x + bubbleBox.width, 0); // at the bubble's side: their right edge at its

  // C1: Codex's box. 44px at rest with 22px corners and the faint shadow; the editor grows to a quarter of the window,
  // then scrolls inside it.
  const box = p.locator('[data-composer-box]');
  expect((await box.boundingBox())!.height).toBe(44);
  await expect(box).toHaveCSS('border-top-left-radius', '22px');
  expect(await box.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  await messageIn(page, 0).click();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.type(`line ${i + 1}`);
    await page.keyboard.press('Shift+Enter');
  }
  const grown = await messageIn(page, 0).evaluate((el) => {
    const scroller = el.parentElement!;
    return { height: scroller.getBoundingClientRect().height, quarter: window.innerHeight / 4, scrolls: scroller.scrollHeight > scroller.clientHeight };
  });
  expect(grown.height).toBeCloseTo(grown.quarter, 0);
  expect(grown.scrolls).toBe(true);
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await box.boundingBox())!.height).toBe(44);

  // C2: nothing above the box at rest, one toolbar row below it: + · location · mode … model (no @; W10: no + dir; E9: the
  // dictation microphone after the mode, where C2 left the mic's place until dictation existed)
  const frameBox = (await p.locator('[data-composer-frame]').boundingBox())!;
  const boxAtRest = (await box.boundingBox())!;
  const toolbar = p.getByRole('toolbar', { name: 'Composer tools' });
  const tools = (await toolbar.boundingBox())!;
  expect(boxAtRest.y).toBe(frameBox.y);
  expect(tools.y).toBeGreaterThanOrEqual(boxAtRest.y + boxAtRest.height);
  expect(frameBox.y + frameBox.height).toBe(tools.y + tools.height);
  console.log(`W2 composer at rest: box ${boxAtRest.height}px, toolbar ${tools.height}px, frame ${frameBox.height}px, ${frameBox.width}px wide`);
  const labels = await toolbar.getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  expect(labels).toEqual(['Add files, photos or commands', expect.stringMatching(/^Location /), expect.stringMatching(/^Permission mode /), 'Dictate', expect.stringMatching(/^Model /)]);
  await expect(toolbar.getByRole('button', { name: 'Mention a file or agent' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Voice input' })).toHaveCount(0);
  expect(editor.consoleErrors()).toEqual([]);
});

// UX wave U4a, decision 31: while a turn runs the empty box says which key does what, on one line. In a box too narrow
// for the words (240px here) they are cut with an ellipsis, and never wrap or grow the box. The words are the empty
// paragraph's `::before`, a float one line tall, so the cut is read from its style and from the words' own width.
test('W2: the turn’s placeholder stays on one line, cut with an ellipsis in a box 240px wide', async ({ editor }) => {
  const { page } = editor;
  const id = 'w2-placeholder';
  await openComposerPage(page);
  await launchReady(page, id, steerStopJournal(scratch, id));
  await showPanes(page, [{ composer: id }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type(COUNT);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await statusOf(page, id)).turn).not.toBeNull();
  const p = pane(page, 0);
  const box = p.locator('[data-composer-box]');
  const empty = messageIn(page, 0).locator('[data-placeholder]');
  await expect(empty).toHaveAttribute('data-placeholder', 'Enter to send, ⌘Enter to queue for later');
  const placeholder = () =>
    empty.evaluate((el) => {
      const style = getComputedStyle(el, '::before');
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return { height: style.height, whiteSpace: style.whiteSpace, overflow: style.overflowX, textOverflow: style.textOverflow, words: context.measureText(el.getAttribute('data-placeholder') ?? '').width, room: el.getBoundingClientRect().width };
    });
  const roomy = await placeholder();
  expect(roomy).toMatchObject({ height: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  expect(roomy.room, 'the pane at rest holds the words whole').toBeGreaterThan(roomy.words);

  // the pane narrowed until its box is 240px wide
  const [paneWidth, boxWidth] = [(await p.boundingBox())!.width, (await box.boundingBox())!.width];
  await p.evaluate((el, width) => {
    (el as HTMLElement).style.maxWidth = `${width}px`;
  }, paneWidth - boxWidth + 240);
  await expect.poll(async () => (await box.boundingBox())!.width).toBeCloseTo(240, 0);
  const narrow = await placeholder();
  expect(narrow).toMatchObject({ height: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  expect(narrow.words, 'the words are wider than the line, so the ellipsis cuts them').toBeGreaterThan(narrow.room);
  expect((await box.boundingBox())!.height).toBe(44); // one line: the box keeps its height at rest
  expect(editor.consoleErrors()).toEqual([]);
});

// board 505 (UX wave U11a M3; the execution document's Interfaces §E): C5's own session pane reserves its transcript's
// scrollbar gutter, and the same under its composer, so under classic scrollbars the composer's column is a transcript
// row's; with overlay scrollbars nothing moves. The indexed session of the scratch config home, in the page's `shell` pane;
// the composer's footer photographed under each, for the frame's shadow, which the clipping footer must keep.
for (const scrollbars of ['Always', 'WhenScrolling'] as const) {
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  test(`board 505: the session pane's composer column and a transcript row share both edges (AppleShowScrollBars ${scrollbars}); its footer photographed`, async ({}, testInfo) => {
    testInfo.skip(!HARNESS_BUILT, 'the composer page needs a harness build (pnpm e2e:composer)');
    const maws = await launchMaws({ env: { MAWS_HARNESS: '1', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config }, appKitDefaults: { AppleShowScrollBars: scrollbars } });
    try {
      const { page } = maws;
      await openComposerPage(page);
      let appId = '';
      await expect.poll(async () => (appId = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === transcriptSession)?.appId ?? '')).not.toBe('');
      await showPanes(page, [{ composer: appId, shell: true }, null]);
      const p = pane(page, 0);
      const row = p.locator('.transcript-row[data-kind="user"]').first();
      await expect(row).toBeVisible();
      const gutter = await p.locator('[data-transcript-scroller]').evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth);
      if (scrollbars === 'Always') expect(gutter, "the transcript reserves its scrollbar's gutter (classic scrollbars)").toBeGreaterThan(0);
      else expect(gutter, 'overlay scrollbars take no width').toBe(0);
      const [column, line] = [await geometry(p.locator('[data-composer]').locator('xpath=..')), await geometry(row)];
      expect(Math.abs(column.left - line.left), `the composer's column starts where a transcript row does (${column.left} against ${line.left})`).toBeLessThan(0.5);
      expect(Math.abs(column.left + column.width - (line.left + line.width)), `and ends where it does (${column.width} against ${line.width} wide)`).toBeLessThan(0.5);
      await testInfo.attach(`session-pane-footer-${scrollbars}`, { body: await p.locator('.scroll-gutter-under').screenshot(), contentType: 'image/png' });
    } finally {
      await maws.cleanup();
    }
  });
}

const ACCEPTANCE_SIZES = [{ width: 1280, height: 820 }, { width: 1512, height: 982 }, { width: 900, height: 820 }, { width: 620, height: 820 }] as const;

// The two-pane harness leaves a composer narrower than the native window, exercising side-surface/split constraints.
test('narrow composer tools wrap without overlap, lost labels or clipped hit targets', async ({ editor }, testInfo) => {
  const { page, app } = editor;
  const id = 'acceptance-footer';
  await openComposerPage(page);
  await launchReady(page, id, turnsJournal(scratch, id, 1), { cwd: repo });
  await showPanes(page, [{ composer: id }, null]);
  const toolbar = pane(page, 0).getByRole('toolbar', { name: 'Composer tools' });
  for (const { width, height } of ACCEPTANCE_SIZES) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(0, 0);
      window.setContentSize(w, h);
    }, [width, height] as const);
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
    const controls = await toolbar.getByRole('button').evaluateAll((buttons) => buttons.map((button) => {
      const r = button.getBoundingClientRect();
      const parent = button.closest('[role="toolbar"]')!.getBoundingClientRect();
      return { label: button.getAttribute('aria-label'), x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width,
        contained: r.x >= parent.x - 1 && r.right <= parent.right + 1 && r.y >= parent.y - 1 && r.bottom <= parent.bottom + 1,
        clipped: button.scrollWidth > button.clientWidth + 1 };
    }));
    for (const [i, control] of controls.entries()) {
      expect(control.contained, `${width}: ${control.label} stays inside the footer`).toBe(true);
      expect(control.width, `${width}: ${control.label} keeps a hit target`).toBeGreaterThan(16);
      expect(control.clipped, `${width}: ${control.label} is not cut off`).toBe(false);
      for (const other of controls.slice(i + 1)) {
        const overlap = Math.min(control.right, other.right) - Math.max(control.x, other.x) > 1 && Math.min(control.bottom, other.bottom) - Math.max(control.y, other.y) > 1;
        expect(overlap, `${width}: ${control.label} and ${other.label} do not overlap`).toBe(false);
      }
    }
    await toolbar.getByRole('button', { name: /^Location / }).click();
    await expect(page.getByRole('dialog', { name: 'Location', exact: true })).toContainText(repo);
    await page.keyboard.press('Escape');
    const column = Math.round((await toolbar.boundingBox())!.width);
    await testInfo.attach(`composer-footer-${width}x${height}-column-${column}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  }
});

for (const { width, height } of ACCEPTANCE_SIZES) {
  test(`sending while reading old work follows the new turn and preserves tight user line breaks (${width}x${height})`, async ({ editor }, testInfo) => {
    const { page, app } = editor;
    await app.evaluate(({ BrowserWindow }, [w, h]) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(0, 0);
      window.setContentSize(w, h);
    }, [width, height] as const);
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
    const id = `acceptance-send-follow-${width}`;
    await openComposerPage(page);
    await launchReady(page, id, turnsJournal(scratch, id, 2), { cwd: repo });
    await showPanes(page, [{ composer: id, transcript: true }, null]);
    await messageIn(page, 0).click();
    // ⌘Enter sends with no turn running (U4a: Enter would too). Enough old work to scroll even at 982px high.
    await page.keyboard.insertText(Array.from({ length: 80 }, (_, i) => `Earlier instruction ${i + 1}`).join('\n'));
    await messageIn(page, 0).press('Meta+Enter');
    await expect.poll(() => sent(page, id)).toHaveLength(1);
    await expect.poll(async () => (await statusOf(page, id)).turn).toBeNull();
    const scroller = pane(page, 0).locator('[data-transcript-scroller]');
    await scroller.evaluate((element) => {
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }));
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(pane(page, 0).getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    await testInfo.attach(`composer-reading-old-${width}x${height}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await messageIn(page, 0).click();
    await page.keyboard.insertText('red apple\ngreen pear\nblue plum');
    await messageIn(page, 0).press('Meta+Enter');
    await expect.poll(() => sent(page, id)).toHaveLength(2);
    await expect(pane(page, 0).getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
    await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
    const paragraph = pane(page, 0).locator('.transcript-user-bubble p').filter({ hasText: 'red apple' });
    await expect(paragraph).toBeVisible();
    expect(await paragraph.evaluate((el) => el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight))).toBeCloseTo(3, 1);
    await expect(paragraph.locator('br')).toHaveCount(2);
    await testInfo.attach(`composer-send-follow-linebreaks-${width}x${height}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  });
}

// R5: the light composer elevation follows the window, not the pane; the dark edge stays inset.
test('R5: composer shadow switches below 640px and keeps the dark edge', async ({ editor }) => {
  const { page, app } = editor;
  const id = 'r5-shadow';
  const intent: HarnessIntent = { location: { kind: 'directory', path: repo }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null };
  await openComposerPage(page);
  await cards(page, 'intent', id, intent);
  await showPanes(page, [{ composer: id }, null]);
  const box = pane(page, 0).locator('[data-composer-box]');
  await expect(box).toBeVisible();
  const shadow = (blur: number) => `rgba(0, 0, 0, 0.04) 0px 0px 0px 1px, rgba(0, 0, 0, 0.04) 0px 2px 8px 0px, rgba(0, 0, 0, 0.024) 0px 4px ${blur}px 8px`;
  for (const width of [640, 639, 960]) {
    await app.evaluate(({ BrowserWindow }, w) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(0, 0);
      window.setContentSize(w, 700);
    }, width);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await expect.poll(() => box.evaluate((el, expected) => getComputedStyle(el).boxShadow.endsWith(expected), shadow(width < 640 ? 40 : 80))).toBe(true);
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await expect.poll(() => box.evaluate((el) => getComputedStyle(el).boxShadow.endsWith('rgba(255, 255, 255, 0.2) 0px 0px 1px 0px inset'))).toBe(true);
  }
  expect(editor.consoleErrors()).toEqual([]);
});

// A remote SessionMode drawing is a non-shrinking toolbar item: even its own cap must fit a narrow split column.
test('plugin mode drawings stay inside a split composer while short labels remain whole', async ({ editor }, testInfo) => {
  const { page, app } = editor;
  const recording = readFileSync(join(REPO_ROOT, 'spikes/protocol-probe/fixtures/pass3/mods-surface-render-sites.jsonl'), 'utf8');
  const labels = ['Repository investigation with the full workspace dependency graph enabled', 'Focus'];
  const ids = ['acceptance-plugin-mode-long', 'acceptance-plugin-mode-short'];
  await openComposerPage(page);
  for (const [index, id] of ids.entries()) {
    const journal = join(scratch, `${id}.jsonl`);
    // Keep the recorded hooked tree and handshake; change only the label's length.
    writeFileSync(journal, recording.replaceAll('MODS_PROBE_MODE modes=0', labels[index]));
    await launchReady(page, id, journal, { cwd: repo });
  }
  await showPanes(page, [{ composer: ids[0], transcript: true }, { composer: ids[1], transcript: true }]);
  for (const width of [1280, 620]) {
    await app.evaluate(({ BrowserWindow }, w) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(0, 0);
      window.setContentSize(w, 820);
    }, width);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    for (const index of [0, 1] as const) {
      const toolbar = pane(page, index).getByRole('toolbar', { name: 'Composer tools' });
      const mode = toolbar.getByLabel('Plugin modes');
      await expect(mode).toHaveText(labels[index]);
      const geometry = await mode.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const parent = element.closest('[role="toolbar"]')!.getBoundingClientRect();
        return { width: bounds.width, parentWidth: parent.width,
          contained: bounds.left >= parent.left - 1 && bounds.right <= parent.right + 1 && bounds.top >= parent.top - 1 && bounds.bottom <= parent.bottom + 1,
          clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 };
      });
      if (width === 620) expect(geometry.parentWidth, 'exercise a split footer narrower than the 256px mode cap').toBeLessThan(256);
      expect(geometry.contained, `${width}: pane ${index} plugin drawing stays inside its footer`).toBe(true);
      expect(geometry.width).toBeGreaterThan(16);
      if (index === 1) expect(geometry.clipped, `${width}: the ordinary short mode label is not cut off`).toBe(false);
      await testInfo.attach(`plugin-mode-${index}-${width}x820`, { body: await toolbar.screenshot(), contentType: 'image/png' });
    }
  }
  expect(editor.consoleErrors()).toEqual([]);
});

// ---- UX wave U1b: the composer beside a waiting prompt ----------------------------------------------------------------
// (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Proof 1, `e2e:composer`; acceptance 1 and 2.)
// The recorded permission round trip (`permission-roundtrip`, held at its answer, seq 50) in the session's transcript above
// its composer: the prompt stands at the transcript's end and the composer is never replaced. ⌘Enter with a draft is the
// composer's (§F: the claim yields to a draft) and keeps the message for after the turn, which writes nothing while the
// turn runs, so the replay still holds at the answer; the message is taken back (↑, which needs the session's record:
// launched under the scratch home's indexed session) and the box emptied, and ⌘Enter from the empty box then allows the
// prompt, the one write the replay waits on.
const PERMISSION_FIXTURE = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
function firstRecordedPrompt(fixture: string): string {
  for (const line of readFileSync(join(REPO_ROOT, fixture), 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as { direction: string; frame: { type: string; message?: { content: string } } };
    if (row.direction === 'out' && row.frame.type === 'user') return row.frame.message!.content;
  }
  throw new Error(`${fixture} records no prompt`);
}

test('U1b, a prompt waits at the transcript’s end while the editor takes text: ⌘Enter with a draft queues it and leaves the prompt, with none it allows', async ({ editor }) => {
  const { page } = editor;
  await openComposerPage(page);
  await watchPrompts(page);
  let id = '';
  await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === transcriptSession)?.appId ?? '')).not.toBe('');
  await launchReady(page, id, PERMISSION_FIXTURE);
  await showPanes(page, [{ composer: id, transcript: true, stacked: true }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type(firstRecordedPrompt(PERMISSION_FIXTURE));
  await page.keyboard.press('Enter');
  const card = pane(page, 0).locator('[data-request-end]').getByRole('group', { name: 'Approval needed' });
  const allow = card.getByRole('button', { name: 'Allow once', exact: true });
  await expect(allow, 'the prompt stands at the transcript’s end').toBeVisible();
  await expect(pane(page, 0).getByText(/^Waiting for approval: /).first(), 'the call says it waits').toBeVisible();
  await expect(messageIn(page, 0), 'the composer is not replaced').toBeVisible();
  await expect(messageIn(page, 0), 'nothing took the focus from the editor').toBeFocused();
  await expect(control(page, 0), 'Stop is there while the turn runs').toHaveAttribute('data-submit-state', 'stop');
  await expect(pane(page, 0).getByText('Composer paused')).toHaveCount(0);

  // a draft: ⌘Enter is the composer's, kept for after the turn; the prompt, armed, still waits and nothing is written
  await pastGrace(page, card);
  const later = 'Then list the tags as well.';
  await page.keyboard.type(later);
  await page.keyboard.press(ALLOW_ONCE_KEY);
  await expect(messageIn(page, 0), 'the box is cleared by the queue').toHaveText('');
  await expect(stackOf(page, 0).locator('li[data-queue-state="after"]')).toContainText(later);
  await page.waitForTimeout(300);
  expect((await outFrames(page, id)).filter((f) => f.type === 'control_response'), 'the prompt is not answered').toEqual([]);
  expect((await outFrames(page, id)).some((f) => f.type === 'user' && f.message?.content === later), 'the queued message is not written while the turn runs').toBe(false);
  await expect(allow).toBeEnabled();

  // taken back and emptied, so the turn's end releases nothing the replay did not record
  await page.keyboard.press('ArrowUp');
  await expect(messageIn(page, 0)).toHaveText(later);
  await expect(messageIn(page, 0)).toHaveAttribute('contenteditable', 'true');
  await expect(stackOf(page, 0)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(messageIn(page, 0)).toHaveText('');

  // none: ⌘Enter from the empty box allows the prompt, and the editor keeps the keyboard
  await answerByKey(page, {
    focus: messageIn(page, 0),
    control: allow,
    key: ALLOW_ONCE_KEY,
    answered: async () => (await outFrames(page, id)).some((f) => f.type === 'control_response'),
    what: id,
  });
  await expect(card).toHaveCount(0);
  await expect(messageIn(page, 0)).toBeFocused();
  await expect.poll(async () => (await statusOf(page, id)).turn, { message: 'the allowed command ran and the turn ended' }).toBeNull();
  expect(editor.consoleErrors()).toEqual([]);
});

// UX wave U1b (acceptance 1's "Stop withdraws the prompt and its card leaves"; decision 22): the main loop's prompt waits
// at the transcript's end and Stop is pressed. Over the engine's own frames (`stopPendingJournal`,
// `uxwave/u1b-intpend-main-r1`): the replay holds at the recorded interrupt until the plain stop writes it, then plays
// the engine's `control_cancel_request` for the request and the turn's end. The card leaves with no answer written: the
// broker retires the item only on that cancel (broker.test.ts, probe 8), and a subagent's prompt, which gets none, stays
// (prompt-keys.test.tsx).
test('U1b, Stop while the main loop’s prompt waits: the interrupt is written, the engine cancels the request, and the card leaves unanswered', async ({ editor }) => {
  const { page } = editor;
  const id = 'u1b-stop-pending';
  await openComposerPage(page);
  await launchReady(page, id, stopPendingJournal(scratch, id));
  await showPanes(page, [{ composer: id, transcript: true, stacked: true }, null]);
  await messageIn(page, 0).click();
  await page.keyboard.type('Run the one shell command.');
  await page.keyboard.press('Enter'); // seq 18; its Bash call then asks (39)
  const card = pane(page, 0).locator('[data-request-end]').getByRole('group', { name: 'Approval needed' });
  await expect(card.getByRole('button', { name: 'Allow once', exact: true }), 'the prompt stands at the transcript’s end').toBeVisible();
  await expect(pane(page, 0).getByText(/^Waiting for approval: /).first()).toBeVisible();
  await expect(control(page, 0), 'Stop is there while the turn runs').toHaveAttribute('data-submit-state', 'stop');
  const ofSession = (appSessionId: string) => appSessionId === id || appSessionId.endsWith(`/${id}`); // bare, or addressed
  const listed = async () => value(await invoke(page, 'attention.list', undefined)).filter((item) => ofSession(item.appSessionId) && (item.state === 'pending' || item.state === 'delivered'));
  await expect.poll(async () => (await listed()).length, { message: 'the session’s one request is listed' }).toBe(1);

  await control(page, 0).click();
  const interrupts = async () => (await outFrames(page, id)).filter((f) => f.type === 'control_request' && f.request?.subtype === 'interrupt');
  await expect.poll(async () => (await interrupts()).length).toBe(1);
  expect((await interrupts())[0]!.request, 'the plain stop’s interrupt, as recorded').toEqual({ subtype: 'interrupt', reason: 'user-cancel', cancel_queued: false });

  // the engine's cancel names the request the card stood for; the card leaves, nothing answered it, and nothing is listed
  const inbound = async () =>
    readFileSync((await statusOf(page, id)).journalPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { direction: string; frame: { type?: string; request_id?: string; request?: { subtype?: string } } })
      .filter((row) => row.direction === 'in')
      .map((row) => row.frame);
  await expect.poll(async () => (await inbound()).some((f) => f.type === 'control_cancel_request'), { message: 'the engine’s cancel arrived' }).toBe(true);
  const asked = (await inbound()).find((f) => f.type === 'control_request' && f.request?.subtype === 'can_use_tool')!;
  expect((await inbound()).filter((f) => f.type === 'control_cancel_request').map((f) => f.request_id)).toEqual([asked.request_id]);
  await expect(card, 'the card leaves on the cancel').toHaveCount(0);
  await expect(pane(page, 0).locator('[data-request-end]')).toHaveCount(0);
  await expect(pane(page, 0).getByText(/^Waiting for approval: /)).toHaveCount(0);
  expect((await outFrames(page, id)).filter((f) => f.type === 'control_response'), 'no answer was written for it').toEqual([]);
  await expect.poll(async () => (await listed()).length, { message: 'nothing waits' }).toBe(0);
  await expect.poll(async () => (await statusOf(page, id)).turn, { message: 'the turn ended' }).toBeNull();
  await expect(messageIn(page, 0), 'the composer stays').toBeVisible();
  expect(editor.consoleErrors()).toEqual([]);
});
