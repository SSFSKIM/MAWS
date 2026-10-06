// E3's end-to-end spec (E3 execution document, M5, Acceptance 1 to 6): anchored comments, side threads and `/btw`
// against the built product with C3's replay transport (`MAWS_ENGINE_REPLAY=1`) and C10's replay seam
// (`MAWS_E2E_REPLAY_FIXTURES`: each launch, a side thread's fork included, takes the next journal and pins its id), the
// journals built by `support/side-replay.ts` behind C3's handshake prelude; the disk-only case seeds the engine's store
// instead. Each case runs over a scratch repository holding `src/app.ts`, a temp config home (`CLAUDE_CONFIG_DIR`)
// trusting it, and a throwaway profile; no engine runs, and the owner's `~/.claude`, `~/.claude.json` and checkouts are
// never read or written. A parent session starts through C10's "+" and `session.start` with its first prompt; a comment
// is made the way a person makes one: Files in the panel, the file's tab, the comment mark in the line's gutter, E3's
// sheet. Where a producer's screenshot is needed (E5's gutter gives none), `side.sendToMain` is called with a PNG
// written under `userData`, as E2's and E4's captures will be.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { anchoredMessage } from '../src/shared/anchor/message';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { menu, otherThemeColours } from './support/code-product';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { seedTranscript, SIDE_FOLLOW_UP, SIDE_FOLLOW_UP_ROWS, SIDE_QUESTION, SIDE_QUESTION_ROWS, SideJournal, solidPng, transcript } from './support/side-replay';
import { newChatIn, openProject, sidebarOf, sidebarRow } from './support/sidebar';

const SHOTS = join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e3/shots');

// The engine ids the journals pin: the parent, its side thread, a thread promoted from side questions.
const PARENT = 'e3e30000-0000-4000-8000-000000000001';
const CHILD = 'e3e30000-0000-4000-8000-000000000002';
const PROMOTED = 'e3e30000-0000-4000-8000-000000000003';

const APP = 'src/app.ts';
const APP_TEXT = Array.from({ length: 12 }, (_, i) => (i === 2 ? 'export const total = items.reduce((sum, item) => sum + item.price, 0);' : `export const v${i + 1} = ${i + 1};`)).join('\n') + '\n';
const FIRST_PROMPT = 'Remember the word ZEBRA, then tell me what src/app.ts does.';
const FIRST_REPLY = 'Noted: ZEBRA. src/app.ts exports a running total and a few constants.';
const COMMENT = 'Why is the total recomputed here instead of cached?';
const CHILD_REPLY = 'The total is recomputed because items can change between calls. Caching it would need an invalidation hook.';
const CHILD_FOLLOW_UP = 'And would a memo help?';
const CHILD_REPLY_2 = 'A memo keyed on the items array would help. It is cheap to add.';
const PROMOTED_REPLY = 'Continuing from the side questions: the word was ZEBRA.';

// ---- the bridge ------------------------------------------------------------------------------------------------------------

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<CommandResult<N>>;
}
function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

type JournalRow = { direction: string; frame: Record<string, unknown> & { type?: string; event?: string; args?: string[]; cwd?: string; priority?: string; message?: { content: unknown }; request?: Record<string, unknown> } };
// Every row the host journaled for a session, oldest file first.
function journal(maws: MawsLaunch, appSessionId: string): JournalRow[] {
  const dir = join(maws.userData, 'engine-host', 'journal', appSessionId);
  return readdirSync(dir)
    .sort()
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as JournalRow));
}
const writtenUsers = (maws: MawsLaunch, id: string) => journal(maws, id).filter((r) => r.direction === 'out' && r.frame.type === 'user');
const writtenControls = (maws: MawsLaunch, id: string, subtype: string) => journal(maws, id).filter((r) => r.direction === 'out' && r.frame.type === 'control_request' && r.frame.request?.subtype === subtype);
const spawnRow = (maws: MawsLaunch, id: string) => journal(maws, id).find((r) => r.direction === 'meta' && r.frame.event === 'spawn')!.frame;

// The index, read the way the acceptance reads it (`sqlite3` over `<userData>/index.sqlite`), never written.
function indexRow(maws: MawsLaunch, appSessionId: string): { lineage: string | null; lineage_source: string | null } {
  const out = execFileSync('sqlite3', ['-readonly', '-json', join(maws.userData, 'index.sqlite'), `select lineage, lineage_source from sessions where app_id = '${appSessionId}'`], { encoding: 'utf8' });
  return (JSON.parse(out || '[]') as { lineage: string | null; lineage_source: string | null }[])[0]!;
}

// ---- a case: a scratch repository, a config home trusting it, the journals, the product --------------------------------------

interface Case {
  maws: MawsLaunch;
  page: Page;
  repo: ScratchRepo;
  store: StoreFixture;
  journals: string; // where the case's journals were written
}

let cleanups: (() => Promise<void> | void)[] = [];
test.afterEach(async () => {
  const pending = cleanups.reverse();
  cleanups = [];
  for (const cleanup of pending) await cleanup();
});

async function scratch(): Promise<{ repo: ScratchRepo; store: StoreFixture; journals: string }> {
  const repo = await ScratchRepo.create({ sentinels: false });
  await repo.fixture.write(APP, APP_TEXT);
  await repo.git('add', APP);
  await repo.git('commit', '-q', '-m', 'app');
  const store = await StoreFixture.create();
  const journals = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e3-journals-')));
  cleanups.push(() => rmSync(journals, { recursive: true, force: true }), () => store.dispose(), () => repo.dispose());
  // C10's e2e settings: the directory trusted, and the recordings' default mode as the user's
  writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  writeFileSync(join(store.configHome, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
  return { repo, store, journals };
}

async function launch(s: { store: StoreFixture }, fixtures: string[], userData?: string): Promise<MawsLaunch> {
  const maws = await launchMaws({ env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixtures.join(','), CLAUDE_CONFIG_DIR: s.store.configHome }, ...(userData ? { userData } : {}) });
  cleanups.push(() => maws.cleanup());
  await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
  await expect(maws.page.locator('[data-region="main"]')).toBeVisible();
  return maws;
}

// The parent journal's first turn, which every case's parent starts with.
function parentJournal(cwd: string): SideJournal {
  const journal = new SideJournal(PARENT, cwd);
  journal.turn(FIRST_REPLY);
  return journal;
}

// A side thread's journal: its first prompt (the anchored comment), the rename `finishBinding` writes, the reply; then
// one more turn per follow-up.
function threadJournal(sessionId: string, cwd: string, title: string, replies: string[]): SideJournal {
  const journal = new SideJournal(sessionId, cwd);
  const first = journal.prompt();
  journal.rename(title);
  journal.reply(first, replies[0]!);
  journal.completed(first);
  for (const reply of replies.slice(1)) journal.turn(reply);
  return journal;
}

async function begin(build: (cwd: string, dir: string) => string[]): Promise<Case & { parent: string }> {
  const s = await scratch();
  const maws = await launch(s, build(s.repo.root, s.journals));
  const parent = await startParent(maws.page, s.repo);
  return { ...s, maws, page: maws.page, parent };
}

// "+" on the repository's project, the route direct (the replay ignores it; the relay pre-check must not depend on this
// Mac's relay), and the first prompt through C10's start; answers once the first turn's reply is drawn.
async function startParent(page: Page, repo: ScratchRepo): Promise<string> {
  const project = value(await invoke(page, 'session.projects.add', { directory: repo.root }));
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  await expect(page.getByRole('heading', { name: `New chat in ${project.name}` })).toBeVisible();
  const id = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
  value(await invoke(page, 'session.intent.patch', { appSessionId: id, patch: { gateway: 'direct' } }));
  value(await invoke(page, 'session.start', { appSessionId: id, message: { content: FIRST_PROMPT, display: FIRST_PROMPT }, options: {} }));
  await expect(mainRegion(page).getByText(FIRST_REPLY)).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id as never })).turn, { timeout: 10_000 }).toBeNull();
  return id;
}

const mainRegion = (page: Page) => page.locator('[data-region="main"]');
const panelRegion = (page: Page) => page.locator('[data-region="panel"]');

// The session's tab in the main area, shown through its sidebar row.
async function showSession(page: Page, id: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: id })).click();
  await page.mouse.move(700, 450); // off the sidebar: its hover card would cover what follows
  await expect(mainRegion(page).locator(`[role="tab"][data-tab-id="session:${id}"]`)).toHaveAttribute('aria-selected', 'true');
}

// Files in the panel, the repository expanded down to `relative`, and its tab opened; answers the viewer.
async function openFile(page: Page, repo: ScratchRepo, relative: string): Promise<Locator> {
  const panel = panelRegion(page);
  if ((await panel.locator('[data-tool="files"]').count()) === 0) {
    await panel.getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Files' }).click();
  }
  const row = (path: string) => panel.locator(`[data-tool="files"] [role="treeitem"][data-path="${path}"]`);
  let at = repo.root;
  for (const segment of ['', ...relative.split('/').slice(0, -1)]) {
    at = segment ? `${at}/${segment}` : at;
    await expect(row(at)).toBeVisible();
    if ((await row(at).getAttribute('aria-expanded')) !== 'true') await row(at).click();
    await expect(row(at)).toHaveAttribute('aria-expanded', 'true');
  }
  await row(repo.path(relative)).click();
  const viewer = page.locator(`[data-file-viewer][data-path="${repo.path(relative)}"]`);
  await expect(viewer.locator('.cm-line').first()).toBeVisible();
  return viewer;
}

// The comment mark of `line` (shown while its gutter is hovered), clicked; answers E3's sheet.
async function commentOn(page: Page, viewer: Locator, line: number): Promise<Locator> {
  const mark = viewer.locator(`.cm-comment-mark[aria-label="Comment on line ${line}"]`);
  await expect(mark).toBeAttached();
  await mark.locator('xpath=..').hover();
  await expect(mark).toBeVisible();
  await mark.click();
  const sheet = page.getByRole('dialog', { name: `Comment on app.ts:${line}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

// A fork of a replayed launch is routed (the record carries the route the prelude verified), so it meets the relay
// pre-check: when this Mac's relay is down, the thread's pane docks the relay card, and "Run direct" goes on.
async function passRelay(page: Page): Promise<void> {
  const health = value(await invoke(page, 'engine.relayHealth', { force: true }));
  if (health.ok) return;
  const card = page.getByRole('group', { name: 'Relay not answering' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Run direct' }).click();
}

// The side thread of `parent` whose record exists (its setup creates it before the engine runs).
async function sideThreadOf(page: Page, parent: string, openedBy: 'comment' | 'btw'): Promise<string> {
  let child = '';
  await expect
    .poll(async () => {
      const records = value(await invoke(page, 'session.list', {})).sessions;
      child = records.find((r) => r.lineage?.kind === 'side-thread' && r.lineage.parentAppSessionId === parent && r.lineage.openedBy === openedBy)?.appId ?? '';
      return child;
    }, { timeout: 20_000 })
    .not.toBe('');
  return child;
}

// The gutter's comment on line 3 sent to a side thread, through to the thread's first reply in the pane.
async function openThreadFromGutter(c: Case & { parent: string }): Promise<{ child: string; pane: Locator; viewer: Locator }> {
  const { page, repo } = c;
  const viewer = await openFile(page, repo, APP);
  const sheet = await commentOn(page, viewer, 3);
  await sheet.getByRole('textbox', { name: 'Comment' }).fill(COMMENT);
  await sheet.getByRole('button', { name: 'Send' }).click();
  await expect(sheet, 'the sheet closes once the thread starts').toHaveCount(0);
  await passRelay(page);
  const child = await sideThreadOf(page, c.parent, 'comment');
  const pane = panelRegion(page).locator(`[data-side-thread-view="${child}"]`);
  await expect(pane, 'the Side pane opens on the new thread').toBeVisible();
  await expect(pane.getByText(CHILD_REPLY)).toBeVisible({ timeout: 20_000 });
  return { child, pane, viewer };
}

const fileAnchor = (repo: ScratchRepo, line: number) => ({ kind: 'file-line' as const, locator: `${repo.path(APP)}#L${line}`, label: `app.ts:${line}`, path: repo.path(APP), line });

// The sidebar's rows of the parent's project, in order: their ids and levels.
async function projectRows(page: Page, parent: string): Promise<{ id: string; level: string | null }[]> {
  await sidebarRow(page, { appSessionId: parent }); // its project expanded
  const projectId = value(await invoke(page, 'session.get', { appSessionId: parent as never }))?.projectId ?? 'other';
  const project = sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:${projectId}"]`);
  return project.locator('[role="treeitem"][data-menu^="session:"]').evaluateAll((rows) => rows.map((r) => ({ id: r.getAttribute('data-menu')!.slice('session:'.length), level: r.getAttribute('aria-level') })));
}

test.describe('side threads, Send to main and /btw (E3)', () => {
  test('1. the gutter’s comment mark opens the sheet: titled by the line, Side thread selected, Send disabled until text', async () => {
    const c = await begin((cwd, dir) => [parentJournal(cwd).write(dir, 'parent')]);
    const viewer = await openFile(c.page, c.repo, APP);
    const sheet = await commentOn(c.page, viewer, 3);
    await expect(sheet).toHaveAttribute('data-anchor-kind', 'file-line');
    await expect(sheet).toHaveAttribute('data-anchor-locator', `${c.repo.path(APP)}#L3`);
    await expect(sheet.getByText(`${c.repo.path(APP)}#L3`), 'the locator shown').toBeVisible();
    await expect(sheet.getByRole('radio', { name: /Side thread/ })).toBeChecked();
    await expect(sheet.getByRole('radio', { name: /Send to main/ })).not.toBeChecked();
    await expect(sheet.getByRole('radio', { name: /Send to main/ })).toBeEnabled();
    await expect(sheet.locator('[data-destination="main"]'), 'the parent is idle: an ordinary prompt').toContainText('Sent now');
    await expect(sheet.locator('[data-comment-screenshot]'), 'the gutter gives no screenshot').toHaveCount(0);
    const send = sheet.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    await sheet.getByRole('textbox', { name: 'Comment' }).fill('   ');
    await expect(send, 'blank is no comment').toBeDisabled();
    await sheet.getByRole('textbox', { name: 'Comment' }).fill(COMMENT);
    await expect(send).toBeEnabled();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toHaveCount(0);
    expect(writtenUsers(c.maws, c.parent), 'nothing sent').toHaveLength(1);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('2. Side thread: a fork of the parent opens in the Side pane on the line, answers there, sums itself up in the parent and nests under it in the sidebar; the main conversation receives nothing', async () => {
    test.setTimeout(120_000);
    const c = await begin((cwd, dir) => [parentJournal(cwd).write(dir, 'parent'), threadJournal(CHILD, cwd, 'app.ts:3', [CHILD_REPLY, CHILD_REPLY_2]).write(dir, 'thread')]);
    const { page, maws, repo, parent } = c;
    const { child, pane } = await openThreadFromGutter(c);

    // the thread's head names the line; its first prompt is the comment under the anchor chip; its reply follows
    await expect(pane.getByRole('button', { name: 'Open app.ts:3' })).toBeVisible();
    const chip = pane.locator('[data-chip="anchor"]');
    await expect(chip).toHaveText('app.ts:3');
    await expect(chip).toHaveAttribute('data-anchor-kind', 'file-line');
    await expect(pane.getByText(COMMENT, { exact: true })).toBeVisible();
    await expect(pane.getByText('You are in a side thread', { exact: false }), 'the framing is MAWS’s, not drawn').toHaveCount(0);

    // the record and the launch: a fork of the parent at its current point, in its directory, under the pinned id
    const record = value(await invoke(page, 'session.get', { appSessionId: child as never }));
    expect(record?.lineage).toEqual({ kind: 'side-thread', parentAppSessionId: parent, parentEngineSessionId: PARENT, anchor: fileAnchor(repo, 3), openedBy: 'comment' });
    const spawn = spawnRow(maws, child);
    expect(spawn.cwd).toBe(repo.root);
    const args = spawn.args!;
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual(['--resume', PARENT]);
    expect(args).toContain('--fork-session');
    expect(args[args.indexOf('--session-id') + 1]).toBe(CHILD);
    expect(args[args.indexOf('--permission-mode') + 1], "the parent's mode").toBe(record!.permissionMode.requested);
    const first = writtenUsers(maws, child);
    expect(first).toHaveLength(1);
    expect(first[0]!.frame.message!.content).toEqual([{ type: 'text', text: anchoredMessage({ anchor: fileAnchor(repo, 3), text: COMMENT, destination: 'thread', screenshot: false }) }]);
    expect(writtenControls(maws, child, 'rename_session').map((r) => r.frame.request)).toEqual([{ subtype: 'rename_session', title: 'app.ts:3', source: 'host' }]);

    // the parent's transcript: one row for the thread, finished with its reply, whose Open shows it
    await showSession(page, parent);
    const row = mainRegion(page).locator(`[data-side-thread="${child}"]`);
    await expect(row).toHaveAttribute('data-state', 'finished');
    await expect(row).toContainText(`Side thread on app.ts:3 finished: ${CHILD_REPLY}`);
    expect(writtenUsers(maws, parent), 'the main conversation received no message').toHaveLength(1);

    // the thread's own composer sends to the thread; the parent's row counts its turns in place
    const threadPane = panelRegion(page).locator(`[data-side-thread-view="${child}"]`);
    await threadPane.getByRole('textbox', { name: 'Message' }).click();
    await page.keyboard.type(CHILD_FOLLOW_UP);
    await threadPane.locator('[data-submit-state]').click();
    await expect(threadPane.getByText(CHILD_REPLY_2)).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(`Side thread on app.ts:3 finished (2 turns): ${CHILD_REPLY_2}`);
    await expect(mainRegion(page).locator('[data-side-thread]'), 'one row per thread').toHaveCount(1);
    expect(writtenUsers(maws, child)).toHaveLength(2);
    expect(writtenUsers(maws, parent)).toHaveLength(1);

    // the sidebar lists the thread under its parent, a level in, marked ↳
    await expect.poll(() => projectRows(page, parent)).toEqual([{ id: parent, level: '2' }, { id: child, level: '3' }]);
    await expect((await sidebarRow(page, { appSessionId: child })).getByTestId('row-nested')).toHaveText('↳');

    // the head's label opens the file at the line, in the parent's context
    await threadPane.getByRole('button', { name: 'Open app.ts:3' }).click();
    await expect(mainRegion(page).locator(`[role="tab"][data-tab-id="file:${repo.path(APP)}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('3. the summary row’s Open re-targets the pane; Open as tab yields the thread to a main tab until it closes; the index holds the lineage from the intent', async () => {
    test.setTimeout(120_000);
    const c = await begin((cwd, dir) => [parentJournal(cwd).write(dir, 'parent'), threadJournal(CHILD, cwd, 'app.ts:3', [CHILD_REPLY]).write(dir, 'thread')]);
    const { page, maws, repo, parent } = c;
    const { child } = await openThreadFromGutter(c);
    await showSession(page, parent);
    const panel = panelRegion(page);
    const thread = panel.locator(`[data-side-thread-view="${child}"]`);

    // away to the question view, then back through the parent's row
    await panel.locator('[data-side-chip="btw"]').click();
    await expect(panel.locator(`[data-side-btw-view="${parent}"]`)).toBeVisible();
    await expect(thread).toHaveCount(0);
    await mainRegion(page).locator(`[data-side-thread="${child}"]`).getByRole('button', { name: 'Open' }).click();
    await expect(thread).toBeVisible();
    await expect(panel.locator(`[data-side-chip="${child}"]`)).toHaveAttribute('aria-current', 'true');

    // Open as tab: the main area shows the thread; the pane says so instead of drawing a second one
    await thread.getByRole('button', { name: 'Open as tab' }).click();
    const tab = mainRegion(page).locator(`[role="tab"][data-tab-id="session:${child}"]`);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(mainRegion(page).getByText(CHILD_REPLY)).toBeVisible();
    // the panel follows the shown session (now the thread): back to the parent's tab to see its pane
    await showSession(page, parent);
    await expect(thread.getByText('Shown in the main area')).toBeVisible();
    await expect(thread.getByRole('button', { name: 'Go to tab' })).toBeVisible();
    await expect(thread.locator('[data-composer]'), 'one live composer per session').toHaveCount(0);

    // closing that tab brings the thread back into the pane
    await tab.hover();
    await tab.getByRole('button', { name: /^Close / }).click();
    await expect(tab).toHaveCount(0);
    await expect(thread.getByText('Shown in the main area')).toHaveCount(0);
    await expect(thread.getByText(CHILD_REPLY)).toBeVisible();
    await expect(thread.locator(`[data-composer="${child}"]`)).toBeVisible();

    // the index: the lineage as the record carries it, written from the intent
    const row = indexRow(maws, child);
    expect(row.lineage_source).toBe('intent');
    expect(JSON.parse(row.lineage!)).toEqual({ kind: 'side-thread', parentAppSessionId: parent, parentEngineSessionId: PARENT, anchor: fileAnchor(repo, 3), openedBy: 'comment' });
    expect(indexRow(maws, parent)).toEqual({ lineage: null, lineage_source: null });
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('4. Send to main: idle, an ordinary prompt that opens a turn; mid-turn, a `next` steer drawn where it was delivered; each with its anchor chip, and the screenshot as an image', async () => {
    test.setTimeout(120_000);
    const replies = { sheet: 'Sheet comment read: the total is recomputed per call.', idle: 'Screenshot read: the total is drawn in the header.', steered: 'Folded the comment in after the step: the header shows the total.' };
    let steerUuid = '';
    const c = await begin((cwd, dir) => {
      const parent = parentJournal(cwd);
      parent.turn(replies.sheet); // the sheet's Send to main, the parent idle
      parent.turn(replies.idle); // `side.sendToMain` with a screenshot, idle
      const slow = parent.prompt(); // a prompt the test sends, whose Bash call is still running when the comment arrives
      parent.toolCall(slow);
      steerUuid = parent.steer();
      parent.toolResult();
      parent.started(steerUuid);
      parent.reply(slow, replies.steered);
      parent.completed(steerUuid);
      parent.completed(slow);
      return [parent.write(dir, 'parent')];
    });
    const { page, maws, repo, parent } = c;
    const main = mainRegion(page);
    const shotPath = join(realpathSync(maws.userData), 'captures', 'e3-header.png');
    mkdirSync(join(realpathSync(maws.userData), 'captures'), { recursive: true });
    writeFileSync(shotPath, solidPng(96, 48, [64, 128, 200]));
    const screenshot = { path: shotPath, width: 96, height: 48 };

    // the sheet, Send to main, the parent idle: `session.send` (no priority), an ordinary prompt opening a turn
    const viewer = await openFile(page, repo, APP);
    const sheet = await commentOn(page, viewer, 3);
    await sheet.locator('[data-destination="main"]').click();
    await expect(sheet.getByRole('radio', { name: /Send to main/ })).toBeChecked();
    await sheet.getByRole('textbox', { name: 'Comment' }).fill(COMMENT);
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => writtenUsers(maws, parent).length).toBe(2);
    const sent = writtenUsers(maws, parent)[1]!.frame;
    expect(sent.priority, 'a send, not a steer').toBeUndefined();
    expect(sent.message!.content).toEqual([{ type: 'text', text: anchoredMessage({ anchor: fileAnchor(repo, 3), text: COMMENT, destination: 'main', screenshot: false }) }]);
    await showSession(page, parent);
    await expect(main.getByText(replies.sheet)).toBeVisible({ timeout: 20_000 });
    const bubble = (text: string) => main.locator('[data-bubble]').filter({ hasText: text });
    await expect(bubble(COMMENT).locator('[data-chip="anchor"]')).toHaveText('app.ts:3');
    await expect(main.getByText('Comment on "app.ts:3"', { exact: false }), 'the lead line is not drawn').toHaveCount(0);
    await expect(main.locator('[data-side-thread]'), 'no side thread').toHaveCount(0);

    // a producer's screenshot, the parent idle: sent, with the image first
    const idleComment = 'The total in the header looks stale.';
    expect(value(await invoke(page, 'side.sendToMain', { appSessionId: parent as never, anchor: fileAnchor(repo, 5), text: idleComment, screenshot }))).toMatchObject({ disposition: 'sent' });
    await expect(main.getByText(replies.idle)).toBeVisible({ timeout: 20_000 });
    await expect(bubble(idleComment).locator('[data-chip="anchor"]')).toHaveText('app.ts:5');
    await expect(bubble(idleComment).locator('img.transcript-attachment-image')).toBeVisible();
    expect((writtenUsers(maws, parent)[2]!.frame.message!.content as { type: string }[]).map((b) => b.type)).toEqual(['image', 'text']);

    // mid-turn: a `next` steer, folded in at the tool boundary and drawn there
    const slowPrompt = 'Run the slow step, then report.';
    value(await invoke(page, 'session.send', { appSessionId: parent as never, content: slowPrompt }));
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: parent as never })).turn, { message: 'the slow turn is running' }).not.toBeNull();
    const steerComment = 'While you are in there, check line 7 too.';
    expect(value(await invoke(page, 'side.sendToMain', { appSessionId: parent as never, anchor: fileAnchor(repo, 7), text: steerComment, screenshot }))).toMatchObject({ disposition: 'steered' });
    await expect(main.getByText(replies.steered)).toBeVisible({ timeout: 20_000 });
    const steer = writtenUsers(maws, parent)[4]!.frame;
    expect(steer.priority).toBe('next');
    expect(steer.message!.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(shotPath).toString('base64') } },
      { type: 'text', text: anchoredMessage({ anchor: fileAnchor(repo, 7), text: steerComment, destination: 'main', screenshot: true }) },
    ]);
    await expect(bubble(steerComment).locator('[data-chip="anchor"]')).toHaveText('app.ts:7');
    await expect(bubble(steerComment).locator('img.transcript-attachment-image')).toBeVisible();
    // drawn at its delivery position: after the slow prompt's tool call, before the turn's reply
    const order = await main.evaluate((root, texts) => {
      const at = (text: string) => Array.from(root.querySelectorAll('*')).findIndex((el) => el.children.length === 0 && el.textContent?.includes(text));
      return texts.map(at);
    }, [slowPrompt, steerComment, replies.steered]);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order[0]! < order[1]! && order[1]! < order[2]!, `in order: ${order.join(', ')}`).toBe(true);
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('5. /btw: the side question goes to the engine beside the conversation and answers in the Side pane, with history; nothing reaches the main transcript; Continue as a side thread forks one', async () => {
    test.setTimeout(120_000);
    const c = await begin((cwd, dir) => {
      const parent = parentJournal(cwd);
      parent.sideQuestions(SIDE_QUESTION_ROWS);
      parent.sideQuestions(SIDE_FOLLOW_UP_ROWS);
      return [parent.write(dir, 'parent'), threadJournal(PROMOTED, cwd, 'Side question', [PROMOTED_REPLY]).write(dir, 'promoted')];
    });
    const { page, maws, parent } = c;
    const main = mainRegion(page);
    const composer = main.getByRole('textbox', { name: 'Message' });

    // the palette lists it
    await composer.click();
    await page.keyboard.type('/bt');
    const commands = page.getByRole('listbox', { name: 'Commands' });
    await expect(commands.getByRole('option').filter({ hasText: '/btw' })).toBeVisible();
    await page.keyboard.press('Escape');
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(composer).toHaveText('');

    // typed: asked, the composer cleared, the question view shows it answered
    await page.keyboard.type(`/btw ${SIDE_QUESTION}`);
    await page.keyboard.press('Enter');
    await expect(composer).toHaveText('');
    const view = panelRegion(page).locator(`[data-side-btw-view="${parent}"]`);
    await expect(view).toBeVisible();
    await expect(view.locator('[data-side-exchange]').first()).toContainText(SIDE_QUESTION);
    await expect(view.locator('[data-side-exchange="answered"]').first()).toContainText('ZEBRA');
    expect(writtenControls(maws, parent, 'side_question').map((r) => r.frame.request)).toEqual([{ subtype: 'side_question', question: SIDE_QUESTION }]);
    expect(writtenUsers(maws, parent), 'no user frame').toHaveLength(1);
    await expect(main.locator('[data-bubble]'), 'the main transcript gained no row').toHaveCount(1);
    await expect(main.getByText('ZEBRA', { exact: true })).toHaveCount(0);

    // a second question carries the first exchange as history
    await view.getByRole('textbox', { name: 'Ask a side question' }).fill(SIDE_FOLLOW_UP);
    await view.getByRole('textbox', { name: 'Ask a side question' }).press('Enter');
    await expect(view.locator('[data-side-exchange="answered"]')).toHaveCount(2);
    await expect(view.locator('[data-side-exchange="answered"]').nth(1)).toContainText('zebra');
    expect(writtenControls(maws, parent, 'side_question')[1]!.frame.request).toEqual({ subtype: 'side_question', question: SIDE_FOLLOW_UP, history: [{ question: SIDE_QUESTION, response: 'ZEBRA' }] });
    await expect(main.locator('[data-bubble]')).toHaveCount(1);

    // Continue as a side thread: a fork whose first prompt lists the exchanges, shown in the pane
    await view.getByRole('button', { name: 'Continue as a side thread' }).click();
    await passRelay(page);
    const promoted = await sideThreadOf(page, parent, 'btw');
    const thread = panelRegion(page).locator(`[data-side-thread-view="${promoted}"]`);
    await expect(thread).toBeVisible();
    await expect(thread.getByText(PROMOTED_REPLY)).toBeVisible({ timeout: 20_000 });
    await expect(thread.locator('header')).toContainText('Side question');
    await expect(thread.locator('[data-side-question]')).toHaveText(SIDE_QUESTION);
    const record = value(await invoke(page, 'session.get', { appSessionId: promoted as never }));
    expect(record?.lineage).toEqual({ kind: 'side-thread', parentAppSessionId: parent, parentEngineSessionId: PARENT, openedBy: 'btw' });
    expect(spawnRow(maws, promoted).args).toContain('--fork-session');
    const firstPrompt = String((writtenUsers(maws, promoted)[0]!.frame.message!.content as { text: string }[])[0]!.text);
    expect(firstPrompt).toContain(`Q: ${SIDE_QUESTION}\nA: ZEBRA`);
    expect(firstPrompt).toContain(`Q: ${SIDE_FOLLOW_UP}\nA: zebra`);
    expect(writtenControls(maws, promoted, 'rename_session').map((r) => r.frame.request)).toEqual([{ subtype: 'rename_session', title: 'Side question', source: 'host' }]);
    expect(writtenUsers(maws, parent), 'still nothing written to the main conversation').toHaveLength(1);
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('6. disk only: two --fork-session copies list under the family’s original, captioned in the hover card, with fork lineage; the original’s steered comment draws its chip and image from the engine’s JSONL', async () => {
    const s = await scratch();
    const cwd = s.repo.root;
    const [A, B, C] = ['e3e3000a-0000-4000-8000-00000000000a', 'e3e3000b-0000-4000-8000-00000000000b', 'e3e3000c-0000-4000-8000-00000000000c'];
    const root = 'e3e3d000-0000-4000-8000-000000000001';
    const steerText = 'Is the total right for an empty list?';
    const png = solidPng(96, 48, [200, 96, 64]);
    const anchor = fileAnchor(s.repo, 3);
    const content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
      { type: 'text', text: anchoredMessage({ anchor, text: steerText, destination: 'main', screenshot: true }) },
    ];
    // A: the original, born first, its comment steered into its second turn (the engine's `queued_command` record)
    const original = transcript({ sessionId: A, cwd, start: Date.UTC(2026, 9, 6, 6, 0, 0) });
    original.user(root, FIRST_PROMPT);
    original.text('e3e3d000-0000-4000-8000-000000000002', FIRST_REPLY);
    original.turnEnd('e3e3d000-0000-4000-8000-000000000003');
    original.user('e3e3d000-0000-4000-8000-000000000004', 'Run the slow step, then report.');
    original.toolCall('e3e3d000-0000-4000-8000-000000000005', 'toolu_e3_slow', 'sleep 2; echo done');
    original.toolResult('e3e3d000-0000-4000-8000-000000000006', 'toolu_e3_slow', 'done');
    original.steer('e3e3d000-0000-4000-8000-000000000007', 'e3e3d000-0000-4000-8000-000000000008', content);
    original.text('e3e3d000-0000-4000-8000-000000000009', 'For an empty list the total is 0, which is right.');
    original.turnEnd('e3e3d000-0000-4000-8000-00000000000a');
    seedTranscript(s.store.configHome, cwd, A, original.records);
    // B and C: `--fork-session` copies (p1-fork-session-flag seq 40's shape): A's first exchange under their own id,
    // then a turn of their own; each born after the one before
    const fork = (id: string, own: string, n: number) => {
      const t = transcript({ sessionId: id, cwd, start: Date.UTC(2026, 9, 6, 7, n, 0) });
      original.records.slice(0, 3).forEach((record) => t.copy(record));
      t.user(`e3e3d00${n}-0000-4000-8000-000000000001`, own);
      t.text(`e3e3d00${n}-0000-4000-8000-000000000002`, 'ZEBRA');
      t.turnEnd(`e3e3d00${n}-0000-4000-8000-000000000003`);
      return t.records;
    };
    await new Promise((r) => setTimeout(r, 200));
    seedTranscript(s.store.configHome, cwd, B, fork(B, 'What word did I plant?', 1));
    await new Promise((r) => setTimeout(r, 200));
    seedTranscript(s.store.configHome, cwd, C, fork(C, 'Spell the word backwards.', 2));

    const maws = await launch(s, []);
    const page = maws.page;
    const ids: Record<string, string> = {};
    await expect
      .poll(async () => {
        const records = value(await invoke(page, 'session.list', {})).sessions;
        for (const r of records) if (r.engineSessionId) ids[r.engineSessionId] = r.appId;
        return [A, B, C].every((id) => ids[id] !== undefined) && records.filter((r) => r.lineage?.kind === 'fork').length === 2;
      }, { timeout: 20_000 })
      .toBe(true);
    const [a, b, cc] = [ids[A]!, ids[B]!, ids[C]!];
    for (const id of [b, cc]) {
      const record = value(await invoke(page, 'session.get', { appSessionId: id as never }));
      expect(record?.lineage, 'a fork of the family’s original, not of the sibling born before it').toEqual({ kind: 'fork', parentAppSessionId: a, parentEngineSessionId: A, openedBy: 'fork' });
      expect(indexRow(maws, id).lineage_source).toBe('disk');
    }
    expect(value(await invoke(page, 'session.get', { appSessionId: a as never }))?.lineage).toBeNull();

    // the sidebar: B and C under A, a level in; the hover card says whose fork
    // (a disk fork's `createdAt` is its copied first record's, the original's, so two siblings tie and keep the
    // sidebar's own order, newest activity first)
    await expect.poll(async () => (await projectRows(page, a)).map((r) => `${r.id}@${r.level}`).sort()).toEqual([`${a}@2`, `${b}@3`, `${cc}@3`].sort());
    expect((await projectRows(page, a))[0], 'the original leads its forks').toEqual({ id: a, level: '2' });
    const forkRow = await sidebarRow(page, { appSessionId: b });
    await expect(forkRow.getByTestId('row-nested')).toHaveText('↳');
    await expect(async () => {
      await page.mouse.move(700, 450);
      await forkRow.hover();
      await expect(page.getByTestId('hover-lineage')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(page.getByTestId('hover-lineage')).toHaveText(`Fork of ${FIRST_PROMPT}`);
    await page.mouse.move(700, 450);

    // A, opened from the sidebar: the steered comment drawn from disk with its chip and image
    await (await sidebarRow(page, { appSessionId: a })).click();
    await page.mouse.move(700, 450);
    const main = mainRegion(page);
    const bubble = main.locator('[data-bubble]').filter({ hasText: steerText });
    await expect(bubble).toBeVisible({ timeout: 20_000 });
    await expect(bubble.locator('[data-chip="anchor"]')).toHaveText('app.ts:3');
    await expect(bubble.locator('img.transcript-attachment-image')).toBeVisible();
    await expect(main.getByText('Comment on "app.ts:3"', { exact: false })).toHaveCount(0);
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('7. relaunch parity: the parent’s side-thread row comes back from the index with the ids and times the live run emitted, and the sidebar still nests the thread', async () => {
    test.setTimeout(150_000);
    const s = await scratch();
    const first = await launch(s, [parentJournal(s.repo.root).write(s.journals, 'parent'), threadJournal(CHILD, s.repo.root, 'app.ts:3', [CHILD_REPLY]).write(s.journals, 'thread')]);
    const parent = await startParent(first.page, s.repo);
    const { child } = await openThreadFromGutter({ ...s, maws: first, page: first.page, parent });
    await showSession(first.page, parent);
    await expect(mainRegion(first.page).locator(`[data-side-thread="${child}"]`)).toHaveAttribute('data-state', 'finished');
    const sideEvents = async (page: Page) =>
      value(await invoke(page, 'session.appEvents', { appSessionId: parent as never }))
        .events.filter((e) => e.kind.startsWith('side.thread.'))
        .map((e) => ({ id: e.id, at: e.at, kind: e.kind }));
    const live = await sideEvents(first.page);
    expect(live.map((e) => e.kind)).toEqual(['side.thread.opened', 'side.thread.summarised']);
    // what the engine left in its store for the parent's first turn (the replay writes none)
    const t = transcript({ sessionId: PARENT, cwd: s.repo.root, start: Date.UTC(2026, 9, 6, 12, 0, 0) });
    t.user('e3e3e000-0000-4000-8000-000000000001', FIRST_PROMPT);
    t.text('e3e3e000-0000-4000-8000-000000000002', FIRST_REPLY);
    t.turnEnd('e3e3e000-0000-4000-8000-000000000003');
    seedTranscript(s.store.configHome, s.repo.root, PARENT, t.records);
    await first.app.close();

    const second = await launch(s, [], first.userData);
    const page = second.page;
    await expect.poll(() => sideEvents(page), { message: 'session.appEvents re-synthesised from the index' }).toEqual(live);
    await showSession(page, parent);
    const row = mainRegion(page).locator(`[data-side-thread="${child}"]`);
    await expect(row).toHaveAttribute('data-state', 'finished');
    await expect(row).toContainText(`Side thread on app.ts:3 finished: ${CHILD_REPLY}`);
    await expect(mainRegion(page).locator('[data-side-thread]')).toHaveCount(1);
    await expect.poll(() => projectRows(page, parent)).toEqual([{ id: parent, level: '2' }, { id: child, level: '3' }]);
    expect(second.consoleErrors()).toEqual([]);
  });

  test('8. both themes: the sheet, the pane on a thread, the parent’s transcript (summary row and anchored prompt), the sidebar’s nesting and the question view use tokens only', async () => {
    test.setTimeout(180_000);
    const c = await begin((cwd, dir) => {
      const parent = parentJournal(cwd);
      parent.turn('Read it: the total is recomputed on every call, by design.');
      parent.sideQuestions(SIDE_QUESTION_ROWS);
      return [parent.write(dir, 'parent'), threadJournal(CHILD, cwd, 'app.ts:3', [CHILD_REPLY]).write(dir, 'thread')];
    });
    const { page, maws, repo, parent } = c;
    const { child, viewer } = await openThreadFromGutter(c);
    // a comment to main, so the parent's transcript holds an anchored prompt beside the thread's row
    const sheet = await commentOn(page, viewer, 3);
    await sheet.locator('[data-destination="main"]').click();
    await sheet.getByRole('textbox', { name: 'Comment' }).fill('Is the recompute intended?');
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet).toHaveCount(0);
    await showSession(page, parent);
    const main = mainRegion(page);
    await expect(main.getByText('Read it: the total is recomputed on every call, by design.')).toBeVisible({ timeout: 20_000 });
    await expect(main.locator(`[data-side-thread="${child}"]`)).toHaveAttribute('data-state', 'finished');
    // and a side question, answered
    await main.getByRole('textbox', { name: 'Message' }).click();
    await page.keyboard.type(`/btw ${SIDE_QUESTION}`);
    await page.keyboard.press('Enter');
    const panel = panelRegion(page);
    await expect(panel.locator('[data-side-exchange="answered"]')).toContainText('ZEBRA');

    for (const theme of ['light', 'dark'] as const) {
      await menu(maws, `theme.${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const dir = join(SHOTS, theme);
      mkdirSync(dir, { recursive: true });
      const shoot = async (target: Locator, name: string) => {
        await page.mouse.move(1, 1);
        expect(await otherThemeColours(page), `${theme}: ${name}`).toEqual([]);
        await target.screenshot({ path: join(dir, `${name}.png`) });
      };

      // the sheet, over the file's tab
      await main.locator(`[role="tab"][data-tab-id="file:${repo.path(APP)}"]`).click();
      const open = await commentOn(page, viewer, 3);
      await open.getByRole('textbox', { name: 'Comment' }).fill(COMMENT);
      await shoot(open, 'comment-sheet');
      await open.getByRole('button', { name: 'Cancel' }).click();
      await expect(open).toHaveCount(0);

      // the parent: its transcript, the pane on its thread, the question view, the sidebar
      await showSession(page, parent);
      await panel.locator(`[data-side-chip="${child}"]`).click();
      await expect(panel.locator(`[data-side-thread-view="${child}"]`).getByText(CHILD_REPLY)).toBeVisible();
      await shoot(panel, 'side-pane-thread');
      await main.locator(`[data-side-thread="${child}"]`).scrollIntoViewIfNeeded();
      await shoot(main, 'parent-transcript');
      await panel.locator('[data-side-chip="btw"]').click();
      await expect(panel.locator('[data-side-exchange="answered"]')).toContainText('ZEBRA');
      await shoot(panel, 'side-questions');
      await (await sidebarRow(page, { appSessionId: child })).scrollIntoViewIfNeeded();
      await shoot(sidebarOf(page), 'sidebar-nesting');
    }
    await menu(maws, 'theme.light');
    expect(maws.consoleErrors()).toEqual([]);
  });
});
