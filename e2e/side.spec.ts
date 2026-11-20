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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { anchoredMessage, commentsMessage, PROMOTION_HEAD, promotionMessage, quotedComment } from '../src/shared/anchor/message';
import { PASTED_BLOCK } from '@shared/composer/pasted-content'; // ticket 733a: the engine's frame, as its parser reads it
import { pastedTagId } from '@shared/composer/pasted-framing'; // ticket 733a: a segment's id
import { ScratchRepo } from '../test/support/scratch-repo';
import { addressed, localRef } from './support/address';
import { bareOf } from '../src/shared/machine/address';
import { collectBestEffortEvidence } from './support/best-effort-evidence';
import { StoreFixture } from '../test/support/store-fixture';
import { expectToolbarAsDrawn, menu, otherThemeColours } from './support/code-product';
import { clickRevealed } from './support/hover';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { FIRST_CREATED_REVISION } from './support/design-systems'; // Decision Log 67: fresh artifacts follow the seeded defaults.
import { seedTranscript, SIDE_FOLLOW_UP, SIDE_FOLLOW_UP_ROWS, SIDE_QUESTION, SIDE_QUESTION_ROWS, SideJournal, solidPng, transcript } from './support/side-replay';
import type { AppSessionId } from '@shared/graph/ids'; // P2-E1
import { frameAt, headerAction, importSeeded, mcpCalls, mcpResultOf, metaEvents, ofKind, pageUrlOf, resultText, seedArtifact } from './support/maws-tools'; // P2-E1; P3-L M6b; P3-F (case 12's evidence)
import { newChatIn, openProject, sidebarOf, sidebarRow } from './support/sidebar';
import { hideSurfaces, mainTabById, mountedTabs, openArtifactInPanel, openSurface, sessionCards, sideColumn, sideTab, surface, surfaceRow } from './support/shell';
// Ticket 733a (its document, Design 3): the ids of the pasted segments a sent text holds, in order. A form composed for
// the main conversation carries the session's own (`pastedTagId` of its engine id), a thread's first message, composed
// before its session exists, a random one, so a scene reads that id from what was sent and compares the bytes at it.
const segmentIds = (text: string) => [...text.matchAll(PASTED_BLOCK)].map((match) => match[1]!);

// E3's evidence screenshots, written only under MAWS_E3_SHOTS=1 (E11 W-E: a gate run leaves them alone); the cases'
// both-themes token scans run either way.
const SHOTS = process.env.MAWS_E3_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e3/shots') : null;

// The engine ids the journals pin: the parent, its side thread, a thread promoted from side questions.
const PARENT = 'e3e30000-0000-4000-8000-000000000001';
const CHILD = 'e3e30000-0000-4000-8000-000000000002';
const PROMOTED = 'e3e30000-0000-4000-8000-000000000003';
const CARD_CHILD = 'e3e30000-0000-4000-8000-000000000004'; // P2-E1 (M5): case 8's card thread

const APP = 'src/app.ts';
const APP_TEXT = Array.from({ length: 12 }, (_, i) => (i === 2 ? 'export const total = items.reduce((sum, item) => sum + item.price, 0);' : `export const v${i + 1} = ${i + 1};`)).join('\n') + '\n';
const FIRST_PROMPT = 'Remember the word ZEBRA, then tell me what src/app.ts does.';
// UX wave U7 (S-11): a session with no title is named by its first prompt's first six words, so a fork's caption names its original so
const FIRST_PROMPT_TITLE = 'Remember the word ZEBRA, then tell';
const FIRST_REPLY = 'Noted: ZEBRA. src/app.ts exports a running total and a few constants.';
const COMMENT = 'Why is the total recomputed here instead of cached?';
const CHILD_REPLY = 'The total is recomputed because items can change between calls. Caching it would need an invalidation hook.';
const CHILD_FOLLOW_UP = 'And would a memo help?';
const CHILD_REPLY_2 = 'A memo keyed on the items array would help. It is cheap to add.';
// P2-F (the owner's ruling at P2-F's sitting, A5.3): the second reply is a to-human report, whose tags the parent's row
// must not print (the thread reads the mark)
const CHILD_REPORT_2 = `<to-human>\n${CHILD_REPLY_2}\n</to-human>`;
const PROMOTED_REPLY = 'Continuing from the side questions: the word was ZEBRA.';

// ---- the bridge ------------------------------------------------------------------------------------------------------------

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name as string, input as unknown] as const) as Promise<CommandResult<N>>;
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

// P3-A (M6): the parent's first turn makes its page through the artifact store, `artifact_create` of the heading page
// (allowed by a rule); `parentPage` finds it in the store by the handle the parent gave it (P3-L M6b: X12's mirrored
// record is gone).
function pageParentJournal(cwd: string): SideJournal {
  const journal = new SideJournal(PARENT, cwd);
  const prompt = journal.prompt();
  journal.mawsToolCall('artifact_create', { id: 'dash', content: HEADING_PAGE, title: 'Dashboard' }, { status: 'created', id: 'dash', version: 1, title: 'Dashboard' }, { asked: false });
  journal.reply(prompt, FIRST_REPLY);
  journal.completed(prompt);
  return journal;
}
async function parentPage(page: Page, parent: string): Promise<{ id: string }> {
  let found: { id: string } | undefined;
  await expect
    .poll(async () => (found = value(await invoke(page, 'artifacts.list', { filter: { appSessionId: parent as AppSessionId } })).artifacts.find((artifact) => artifact.handle === 'dash')) !== undefined, { timeout: 20_000 })
    .toBe(true);
  return found!;
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
// Mac's relay, and the journals' `get_status` verifies it direct, so the side threads forked from it are direct too),
// and the first prompt through C10's start; answers once the first turn's reply is drawn.
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

// UX wave U4b (M4): the card column's cards' list and each of its cards, by box, rounded to the pixel.
type Box = { x: number; y: number; width: number; height: number };
const columnBoxes = (page: Page): Promise<{ list: Box; cards: Box[] }> =>
  sessionCards(page).evaluate((aside) => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const list = aside.querySelector('div[aria-label="Session cards"]')!;
    return { list: box(list), cards: Array.from(list.querySelectorAll(':scope > section')).map(box) };
  });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
// What each card of the column holds, with its height: printed beside the boxes' comparison, so a card whose box moved
// can be told from a card whose content changed (the first Mac run of scene 5: the first card 68 px shorter).
const columnCardsText = (page: Page): Promise<string[]> =>
  sessionCards(page).evaluate((aside) =>
    Array.from(aside.querySelectorAll<HTMLElement>('div[aria-label="Session cards"] > section')).map((section) => `${Math.round(section.getBoundingClientRect().height)} px: ${section.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)}`),
  );
// The open side chat card at the column's foot: inside the column, its bottom edge within 8 px of the column's, over
// neither the composer's frame nor the jump control, and the cards above it in the boxes `before` recorded. The jump
// control ("Jump to latest") is drawn only while the transcript is not following its end, which this scene's one short
// exchange never leaves, so it is not measured itself: the transcript's own root is, since the control is placed inside
// that box wherever it is drawn (`.transcript-jump` is absolute in the `relative` root, `transcript/view/transcript.css`).
async function expectAtFoot(page: Page, before: { cards: Box[] }): Promise<void> {
  const column = (await sessionCards(page).boundingBox())!;
  const card = (await sessionCards(page).locator('[data-btw-card="foot"]').boundingBox())!;
  expect(card.x >= column.x - 0.5 && card.x + card.width <= column.x + column.width + 0.5 && card.y >= column.y - 0.5, `the card ${JSON.stringify(card)} inside the column ${JSON.stringify(column)}`).toBe(true);
  const gap = column.y + column.height - (card.y + card.height);
  expect(gap, 'the card’s bottom edge at the column’s').toBeGreaterThanOrEqual(-0.5);
  expect(gap, 'the card’s bottom edge at the column’s').toBeLessThanOrEqual(8);
  const main = mainRegion(page);
  for (const [name, other] of [['the composer’s frame', main.locator('[data-composer-frame]:visible')], ['the transcript, which holds the jump control', main.locator('div.transcript[data-hydration]:visible')]] as const) {
    await expect(other, `${name} is drawn`).toHaveCount(1);
    const box = await other.boundingBox();
    expect(box, `${name} has a box`).not.toBeNull();
    expect(overlaps(card, box!), `the card ${JSON.stringify(card)} clear of ${name} ${JSON.stringify(box)}`).toBe(false);
  }
  console.log(`[side foot] the cards at the check: ${JSON.stringify(await columnCardsText(page))}`);
  expect((await columnBoxes(page)).cards, 'every card where it was before /btw').toEqual(before.cards);
}
// The title bar's "Session cards" icon (in "More surfaces" where the row has no room for it): the column off when it is
// shown, on when it is not.
async function pressSessionCards(page: Page): Promise<void> {
  const icon = surfaceRow(page).getByRole('button', { name: 'Session cards', exact: true });
  if (await icon.count()) await icon.click();
  else {
    await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Session cards', exact: true }).click();
  }
}

// The session's tab in the main area, shown through its sidebar row.
async function showSession(page: Page, id: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: id })).click();
  await page.mouse.move(700, 450); // off the sidebar: its hover card would cover what follows
  await expect(mainTabById(page, `session:${await addressed(page, id)}`)).toHaveAttribute('aria-selected', 'true');
}

// Files in the panel, the repository expanded down to `relative`, and its tab opened; answers the viewer. UX wave U6b-1
// (docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, Interfaces §G): the file opens beside the chat,
// as a tab of Files in the side column, which `showFileTab` brings back into view where another tab took its place.
async function openFile(page: Page, repo: ScratchRepo, relative: string): Promise<Locator> {
  await openSurface(page, 'Files');
  const files = surface(page, 'files');
  const row = (path: string) => files.locator(`[data-tool="files"] [role="treeitem"][data-kind][data-path="${path}"]`);
  let at = repo.root;
  for (const segment of ['', ...relative.split('/').slice(0, -1)]) {
    at = segment ? `${at}/${segment}` : at;
    await expect(row(at)).toBeVisible();
    if ((await row(at).getAttribute('aria-expanded')) !== 'true') await row(at).click();
    await expect(row(at)).toHaveAttribute('aria-expanded', 'true');
  }
  await row(repo.path(relative)).click();
  await expect(sideColumn(page).locator(`[data-file-viewer][data-path="${repo.path(relative)}"]`), `${relative} beside the chat`).toBeVisible();
  const viewer = page.locator(`[data-file-viewer][data-path="${repo.path(relative)}"]`);
  await expect(viewer.locator('.cm-line').first()).toBeVisible();
  return viewer;
}

// The file's side tab brought into view, in the place of the tab its group showed (the Side pane, after a thread opens).
async function showFileTab(page: Page, name: string): Promise<void> {
  const tab = sideTab(sideColumn(page), name);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

// The comment mark of `line` (shown while its gutter is hovered), clicked; answers E3's sheet.
async function commentOn(page: Page, viewer: Locator, line: number): Promise<Locator> {
  const mark = viewer.locator(`.cm-comment-mark[aria-label="Comment on line ${line}"]`);
  await expect(mark).toBeAttached();
  await clickRevealed(mark.locator('xpath=..'), mark);
  const sheet = page.getByRole('dialog', { name: `Comment on app.ts:${line}` });
  await expect(sheet).toBeVisible();
  return sheet;
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
  const child = await sideThreadOf(page, c.parent, 'comment');
  const pane = panelRegion(page).locator(`[data-side-thread-view="${await addressed(page, child)}"]`);
  await expect(pane, 'the Side pane opens on the new thread').toBeVisible();
  // UX wave U8b: the Side pane's tab comes into view in Files' place (one tab in view per group); Files stays a tab
  await expect(surface(page, 'files'), 'Files is out of view').toHaveCount(0);
  await expect(pane.getByText(CHILD_REPLY)).toBeVisible({ timeout: 20_000 });
  return { child, pane, viewer };
}

const fileAnchor = (repo: ScratchRepo, line: number) => ({ kind: 'file-line' as const, locator: `${repo.path(APP)}#L${line}`, label: `app.ts:${line}`, path: repo.path(APP), line });

// The sidebar's rows of the parent's project, in order: their ids and levels.
async function projectRows(page: Page, parent: string): Promise<{ id: string; level: string | null }[]> {
  await sidebarRow(page, { appSessionId: parent }); // its project expanded
  // the row that holds the parent (P5 O6 M5: a row is keyed by its org project's key, a session of none sits in its
  // machine's own row)
  const project = sidebarOf(page).locator('[data-kind="project"]').filter({ has: page.locator(`[data-menu="session:${await addressed(page, parent)}"]`) });
  const rows = await project.locator('[role="treeitem"][data-menu^="session:"]').evaluateAll((rows) => rows.map((r) => ({ id: r.getAttribute('data-menu')!.slice('session:'.length), level: r.getAttribute('aria-level') })));
  return rows.map((row) => ({ ...row, id: bareOf(row.id) })); // the rows name addresses; the callers, the raw bridge's bare ids
}

// ---- UX wave U5b (M6): comments on lines in Review ----------------------------------------------------------------------
// docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, A6: the agent's change over two files of the
// scratch repository (src/app.ts's line 3 rewritten; src/total.ts two lines added), commented on in Review's stack.

const TOTAL = 'src/total.ts';
const TOTAL_TEXT = 'export function sumOf(items: { price: number }[]): number {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n';
const OLD_TOTAL_LINE = APP_TEXT.split('\n')[2]!; // app.ts's line 3 as committed, removed by the change
const NEW_TOTAL_LINE = 'export const total = sumOf(items);'; // and as the change has it
const ROUNDING_LINE = 'export const rounding = 2;'; // total.ts's line 4, added
const CURRENCY_LINE = "export const currency = 'EUR';"; // total.ts's line 5, added, then rewritten
const CURRENCY_LINE_LATER = "export const currency = 'USD';";
const COMMENT_REMOVED = 'Why was the reduce dropped here?';
const COMMENT_ADDED = 'Should rounding come from the settings?';
const COMMENT_LEFT = 'Is the currency fixed for every market?';
const COMMENT_THREAD = 'Is sumOf safe for an empty list?';
const REVIEW_REPLY = 'Read both comments: the reduce moved into sumOf, and rounding will come from the settings.';
const REVIEW_THREAD_REPLY = 'sumOf returns 0 for an empty list, as reduce does with its seed.';
const LINE_LEFT_DIFF = 'The line this comment was on is no longer in this diff.'; // REVIEW_COPY.lineLeftDiff

// The anchor Review makes for a line (`reviewLineAnchor`): the absolute path and the line, `side: 'old'` for a removed one.
const reviewAnchor = (repo: ScratchRepo, path: string, line: number, side: 'old' | 'new') => ({
  kind: 'file-line' as const,
  locator: `${repo.path(path)}#L${line}`,
  label: `${basename(path)}:${line}`,
  path: repo.path(path),
  line,
  ...(side === 'old' && { side: 'old' as const }),
});

// The add button the diff library draws on a line of Review while the line is hovered, pressed (the library acts on the
// press); answers the comment card it opens under the line.
async function commentOnLine(review: Locator, path: string, side: 'old' | 'new', line: number): Promise<Locator> {
  const body = review.locator(`[data-review-file="${path}"] [data-review-body]`);
  const numbered = `[data-line-${side}-num="${line}"]`;
  const row = body.locator('tr').filter({ has: review.page().locator(numbered) }).first();
  await clickRevealed(body.locator(numbered).first(), row.locator(`[data-add-widget="${side}"] button`));
  const card = review.getByRole('dialog', { name: `Comment on ${basename(path)}:${line}` });
  await expect(card).toBeVisible();
  return card;
}

test.describe('side threads, Send to main and /btw (E3)', () => {
  test('1. the gutter’s comment mark opens the sheet: titled by the line, "Send to main" unchecked (a side thread), Send disabled until text', async () => {
    const c = await begin((cwd, dir) => [parentJournal(cwd).write(dir, 'parent')]);
    const viewer = await openFile(c.page, c.repo, APP);
    const sheet = await commentOn(c.page, viewer, 3);
    await expect(sheet).toHaveAttribute('data-anchor-kind', 'file-line');
    await expect(sheet).toHaveAttribute('data-anchor-locator', `${c.repo.path(APP)}#L3`);
    await expect(sheet.getByText(`${c.repo.path(APP)}#L3`), 'the locator shown').toBeVisible();
    // UX wave U5a (A1): one checkbox in place of the two segments, unchecked; its caption is its title alone
    const toMain = sheet.getByRole('checkbox', { name: 'Send to main' });
    await expect(toMain).not.toBeChecked();
    await expect(toMain).toBeEnabled();
    await expect(sheet.getByRole('radio'), 'no two-segment control').toHaveCount(0);
    await expect(sheet.locator('label:has([data-send-to-main])'), 'the parent is idle: an ordinary prompt').toHaveAttribute('title', 'Sent now');
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

  test('2. Side thread: a fork of the parent opens in the Side pane on the line, answers there, sums itself up in the parent and nests under it in the sidebar; the main conversation receives nothing; a /btw typed in it answers under it', async () => {
    test.setTimeout(120_000);
    const c = await begin((cwd, dir) => {
      const thread = threadJournal(CHILD, cwd, 'app.ts:3', [CHILD_REPLY, CHILD_REPORT_2]);
      thread.sideQuestions(SIDE_QUESTION_ROWS);
      return [parentJournal(cwd).write(dir, 'parent'), thread.write(dir, 'thread')];
    });
    const { page, maws, repo, parent } = c;
    // P4-R8: the app's MCP servers, set after the parent launched, reach the thread's launch (the next one) alone
    value(await invoke(page, 'settings.set', { engine: { mcpServers: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }] } }));
    const { child, pane } = await openThreadFromGutter(c);

    // the thread's head names the line; its first prompt is the comment under the anchor chip; its reply follows
    await expect(pane.getByRole('button', { name: 'Open app.ts:3' })).toBeVisible();
    const chip = pane.locator('[data-chip="anchor"]');
    await expect(chip).toHaveText('app.ts:3');
    await expect(chip).toHaveAttribute('data-anchor-kind', 'file-line');
    await expect(pane.getByText(COMMENT, { exact: true })).toBeVisible();
    await expect(pane.getByText('You are in a side thread', { exact: false }), 'the framing is MAWS’s, not drawn').toHaveCount(0);
    // the parent verified direct, so its thread is direct too: no relay pre-check, no route notice
    await expect(page.getByRole('group', { name: 'Relay not answering' })).toHaveCount(0);
    await expect(page.getByText('custom base URL', { exact: false })).toHaveCount(0);

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
    expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!), "the app's MCP servers (P4-R8)").toEqual({ mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } } });
    expect(spawnRow(maws, parent).args, 'the parent launched before the setting').not.toContain('--mcp-config');
    const first = writtenUsers(maws, child);
    expect(first).toHaveLength(1);
    expect(first[0]!.frame.message!.content).toEqual([{ type: 'text', text: anchoredMessage({ anchor: fileAnchor(repo, 3), text: COMMENT, destination: 'thread', screenshot: false }) }]);
    expect(writtenControls(maws, child, 'rename_session').map((r) => r.frame.request)).toEqual([{ subtype: 'rename_session', title: 'app.ts:3', source: 'host' }]);

    // the parent's transcript: one row for the thread, finished with its reply, whose Open shows it
    await showSession(page, parent);
    const row = mainRegion(page).locator(`[data-side-thread="${await addressed(page, child)}"]`);
    await expect(row).toHaveAttribute('data-state', 'finished');
    await expect(row).toContainText(`Side thread on app.ts:3 finished: ${CHILD_REPLY}`);
    expect(writtenUsers(maws, parent), 'the main conversation received no message').toHaveLength(1);

    // the thread's own composer sends to the thread; the parent's row counts its turns in place
    const threadPane = panelRegion(page).locator(`[data-side-thread-view="${await addressed(page, child)}"]`);
    await threadPane.getByRole('textbox', { name: 'Message' }).click();
    await page.keyboard.type(CHILD_FOLLOW_UP);
    await threadPane.locator('[data-submit-state]').click();
    await expect(threadPane.getByText(CHILD_REPLY_2)).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(`Side thread on app.ts:3 finished (2 turns): ${CHILD_REPLY_2}`);
    await expect(row, 'the report’s tags are the thread’s to read, not the row’s to print').not.toContainText('to-human>');
    await expect(mainRegion(page).locator('[data-side-thread]'), 'one row per thread').toHaveCount(1);
    expect(writtenUsers(maws, child)).toHaveLength(2);
    expect(writtenUsers(maws, parent)).toHaveLength(1);

    // a /btw typed in the thread's composer answers under the thread, in this pane: no panel of its own, no toast, the
    // main view kept (the architect's ruling)
    await threadPane.getByRole('textbox', { name: 'Message' }).click();
    await page.keyboard.type(`/btw ${SIDE_QUESTION}`);
    await page.keyboard.press('Enter');
    const inline = threadPane.locator(`[data-side-btw-view="${await addressed(page, child)}"]`);
    await expect(inline.locator('[data-side-exchange="answered"]').first()).toContainText('ZEBRA', { timeout: 20_000 });
    await expect(threadPane.getByRole('button', { name: 'Side questions' })).toHaveAttribute('aria-pressed', 'true');
    expect(writtenControls(maws, child, 'side_question').map((r) => r.frame.request)).toEqual([{ subtype: 'side_question', question: SIDE_QUESTION }]);
    expect(writtenControls(maws, parent, 'side_question')).toEqual([]);
    expect(writtenUsers(maws, child), 'no user frame for the question').toHaveLength(2);
    await expect(page.getByText('Side question asked in the side chat of', { exact: false })).toHaveCount(0);
    await expect(page.locator('[data-btw-card]'), 'UX wave U4a: a question asked under a hosted thread opens no card').toHaveCount(0);
    await expect(mainRegion(page).locator(`[data-side-thread="${await addressed(page, child)}"]`), 'the main view still shows the parent').toBeVisible();
    await threadPane.getByRole('button', { name: 'Side questions' }).click();
    await expect(inline).toHaveCount(0);

    // the sidebar lists the thread under its parent, a level in, marked ↳
    await expect.poll(() => projectRows(page, parent)).toEqual([{ id: parent, level: '2' }, { id: child, level: '3' }]);
    await expect((await sidebarRow(page, { appSessionId: child })).getByTestId('row-nested')).toHaveText('↳');

    // the head's label opens the file at the line, in the parent's context: beside the parent's chat (UX wave U6b-1), its
    // side tab in view in the thread's place, the parent's tab still in front and no main file tab
    const strip = await mountedTabs(page).evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id') ?? ''));
    await threadPane.getByRole('button', { name: 'Open app.ts:3' }).click();
    await expect(sideTab(sideColumn(page), 'app.ts')).toHaveAttribute('aria-selected', 'true');
    await expect(sideColumn(page).locator(`[data-files-tab][data-file="${repo.path(APP)}"] [data-file-viewer][data-path="${repo.path(APP)}"]`)).toBeVisible();
    await expect(mainTabById(page, `file:${await localRef(page)}:${repo.path(APP)}`), 'no main file tab').toHaveCount(0);
    await expect(mainTabById(page, `session:${await addressed(page, parent)}`)).toHaveAttribute('aria-selected', 'true');
    expect(await mountedTabs(page).evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id') ?? '')), 'the main strip as it was').toEqual(strip);
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('3. the summary row’s Open re-targets the pane; Open as tab yields the thread to a main tab until it closes; the index holds the lineage from the intent', async () => {
    test.setTimeout(120_000);
    const c = await begin((cwd, dir) => [parentJournal(cwd).write(dir, 'parent'), threadJournal(CHILD, cwd, 'app.ts:3', [CHILD_REPLY]).write(dir, 'thread')]);
    const { page, maws, repo, parent } = c;
    const { child } = await openThreadFromGutter(c);
    await showSession(page, parent);
    const panel = panelRegion(page);
    const thread = panel.locator(`[data-side-thread-view="${await addressed(page, child)}"]`);

    // away to another surface, then back through the parent's row (UX wave U4a, O-20: the Side pane has no question view
    // to leave to; Files comes into view in its place, one tab in view per group)
    await openSurface(page, 'Files');
    await expect(thread).toHaveCount(0);
    await mainRegion(page).locator(`[data-side-thread="${await addressed(page, child)}"]`).getByRole('button', { name: 'Open' }).click();
    await expect(thread).toBeVisible();
    await expect(panel.locator(`[data-side-chip="${await addressed(page, child)}"]`)).toHaveAttribute('aria-current', 'true');

    // Open as tab: the main area shows the thread; the pane says so instead of drawing a second one
    await thread.getByRole('button', { name: 'Open as tab' }).click();
    const tab = mainTabById(page, `session:${await addressed(page, child)}`);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(mainRegion(page).getByText(CHILD_REPLY)).toBeVisible();
    // the panel follows the shown session (now the thread): back to the parent's tab to see its pane
    await showSession(page, parent);
    await expect(thread.getByText('Shown in the main area')).toBeVisible();
    await expect(thread.getByRole('button', { name: 'Go to tab' })).toBeVisible();
    await expect(thread.locator('[data-composer]'), 'one live composer per session').toHaveCount(0);

    // closing that tab brings the thread back into the pane
    await clickRevealed(tab, tab.getByRole('button', { name: /^Close / }));
    await expect(tab).toHaveCount(0);
    await expect(thread.getByText('Shown in the main area')).toHaveCount(0);
    await expect(thread.getByText(CHILD_REPLY)).toBeVisible();
    await expect(thread.locator(`[data-composer="${await addressed(page, child)}"]`)).toBeVisible();

    // the index: the lineage as the record carries it, written from the intent
    const row = indexRow(maws, child);
    expect(row.lineage_source).toBe('intent');
    expect(JSON.parse(row.lineage!)).toEqual({ kind: 'side-thread', parentAppSessionId: parent, parentEngineSessionId: PARENT, anchor: fileAnchor(repo, 3), openedBy: 'comment' });
    expect(indexRow(maws, parent)).toEqual({ lineage: null, lineage_source: null });
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('4. Send to main: idle, an ordinary prompt that opens a turn; mid-turn, a `next` steer drawn where it was delivered; each with its anchor chip, and the screenshot as an image', async () => {
    // UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M8): the sheet's "Send to main" ticked is
    // the window's one path (`side.comment.content`, then the session's own send); `side.sendToMain` stays on the wire with
    // no caller in this window (R1), so its screenshot case here is what a window of an earlier build still sends.
    test.setTimeout(120_000);
    const replies = { sheet: 'Sheet comment read: the total is recomputed per call.', idle: 'Screenshot read: the total is drawn in the header.', steered: 'Folded the comment in after the step: the header shows the total.' };
    let steerUuid = '';
    const c = await begin((cwd, dir) => {
      const parent = parentJournal(cwd);
      parent.turn(replies.sheet); // the sheet's Send to main, the parent idle
      parent.turn(replies.idle); // `side.sendToMain` with a screenshot, idle (R1: an earlier build's window)
      const slow = parent.prompt(); // a prompt the test sends, whose Bash call is still running when the sheet's comment arrives
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

    // the sheet, Send to main ticked, the parent idle: `session.send` (no priority), an ordinary prompt opening a turn; the
    // engine receives one text block, today's text for that anchor to the byte
    const viewer = await openFile(page, repo, APP);
    const sheet = await commentOn(page, viewer, 3);
    await sheet.getByRole('checkbox', { name: 'Send to main' }).check();
    await expect(sheet.locator('label:has([data-send-to-main])')).toHaveAttribute('title', 'Sent now');
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

    // a producer's screenshot, the parent idle, through `side.sendToMain` as an earlier build's window sends it (R1):
    // sent, with the image first
    const idleComment = 'The total in the header looks stale.';
    expect(value(await invoke(page, 'side.sendToMain', { appSessionId: parent as never, anchor: fileAnchor(repo, 5), text: idleComment, screenshot }))).toMatchObject({ disposition: 'sent' });
    await expect(main.getByText(replies.idle)).toBeVisible({ timeout: 20_000 });
    await expect(bubble(idleComment).locator('[data-chip="anchor"]')).toHaveText('app.ts:5');
    await expect(bubble(idleComment).locator('img.transcript-attachment-image')).toBeVisible();
    expect((writtenUsers(maws, parent)[2]!.frame.message!.content as { type: string }[]).map((b) => b.type)).toEqual(['image', 'text']);

    // mid-turn: the sheet ticked is a `next` steer (its title the composer's words for it), folded in at the tool
    // boundary and drawn there
    const slowPrompt = 'Run the slow step, then report.';
    value(await invoke(page, 'session.send', { appSessionId: parent as never, content: slowPrompt }));
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: parent as never })).turn, { message: 'the slow turn is running' }).not.toBeNull();
    const steerComment = 'While you are in there, check line 7 too.';
    await showFileTab(page, 'app.ts'); // beside the parent's chat (UX wave U6b-1)
    const busySheet = await commentOn(page, viewer, 7);
    await busySheet.getByRole('checkbox', { name: 'Send to main' }).check();
    await expect(busySheet.locator('label:has([data-send-to-main])'), 'the composer’s words for a steer').toHaveAttribute('title', 'Sends at the next step');
    await busySheet.getByRole('textbox', { name: 'Comment' }).fill(steerComment);
    await busySheet.getByRole('button', { name: 'Send' }).click();
    await expect(busySheet, 'a steer is a confirmed delivery: the sheet closes').toHaveCount(0);
    await expect.poll(() => writtenUsers(maws, parent).length).toBe(5);
    const steer = writtenUsers(maws, parent)[4]!.frame;
    expect(steer.priority).toBe('next');
    expect(steer.message!.content).toEqual([{ type: 'text', text: anchoredMessage({ anchor: fileAnchor(repo, 7), text: steerComment, destination: 'main', screenshot: false }) }]);
    await showSession(page, parent);
    await expect(main.getByText(replies.steered)).toBeVisible({ timeout: 20_000 });
    await expect(bubble(steerComment).locator('[data-chip="anchor"]')).toHaveText('app.ts:7');
    // drawn at its delivery position: after the slow prompt's tool call, before the turn's reply
    const order = await main.evaluate((root, texts) => {
      const at = (text: string) => Array.from(root.querySelectorAll('*')).findIndex((el) => el.children.length === 0 && el.textContent?.includes(text));
      return texts.map(at);
    }, [slowPrompt, steerComment, replies.steered]);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order[0]! < order[1]! && order[1]! < order[2]!, `in order: ${order.join(', ')}`).toBe(true);
    expect(maws.consoleErrors()).toEqual([]);
  });

  // UX wave U4b (docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md, M4; Acceptance 4 and 5; O-20,
  // A18): with the card column shown for the session, its side chat card stands at the column's foot, at its bottom
  // right, and nothing lies over the pane's corner; with the column off it is over the corner again, the same card; the
  // cards above it keep their boxes, and with the card closed the column draws as it did before /btw was asked.
  test('5. /btw: the side question goes to the engine beside the conversation and answers in the session’s side chat card at the card column’s foot, with history; nothing reaches the main transcript; Continue as a side thread forks one', async () => {
    test.setTimeout(120_000);
    let appPath = ''; // UX wave U6b-4b: the file the second answer links, inside the session's folder
    const c = await begin((cwd, dir) => {
      appPath = join(cwd, APP);
      const parent = parentJournal(cwd);
      parent.sideQuestions(SIDE_QUESTION_ROWS);
      parent.sideQuestions(SIDE_FOLLOW_UP_ROWS, { zebra: `zebra, as [the app](${appPath}) has it` });
      return [parent.write(dir, 'parent'), threadJournal(PROMOTED, cwd, 'Side question', [PROMOTED_REPLY]).write(dir, 'promoted')];
    });
    const { page, maws, parent } = c;
    const main = mainRegion(page);
    const composer = main.getByRole('textbox', { name: 'Message' });
    const column = sessionCards(page);
    const foot = column.locator('[data-btw-card="foot"]');
    const corner = main.locator('[data-btw-card="corner"]');

    // the column as it is drawn before any /btw: the cards' list and each card, by box
    await expect(column, 'the card column is drawn for the session at this window’s width').toBeVisible();
    const before = await columnBoxes(page);
    expect(before.cards.length, 'the session’s cards').toBeGreaterThan(0);
    const firstCardText = () => column.locator('div[aria-label="Session cards"] > section').first().innerText();
    const firstCardBefore = await firstCardText();
    console.log(`[side foot] the cards before /btw: ${JSON.stringify(await columnCardsText(page))}`);

    // the palette lists it
    await composer.click();
    await page.keyboard.type('/bt');
    const commands = page.getByRole('listbox', { name: 'Commands' });
    await expect(commands.getByRole('option').filter({ hasText: '/btw' })).toBeVisible();
    // UX wave U4a (M7's fix; `openSideQuestions`): a bare `/btw` picked from the palette opens the session's side chat
    // card with its field focused, before any question (the widgets harness mounts no card: `e2e/widgets.spec.ts`
    // proves the hand-off there)
    await page.keyboard.type('w');
    await expect(commands.locator('[role="option"][aria-selected="true"]')).toContainText('/btw');
    await page.keyboard.press('Enter');
    await expect(foot).toBeVisible();
    await expect(corner, 'the card is drawn once, at the column’s foot').toHaveCount(0);
    await expect(foot.getByRole('textbox', { name: 'Ask a side question' })).toBeFocused();
    await expect(foot.getByRole('textbox', { name: 'Ask a side question' })).toHaveAttribute('placeholder', 'Ask a quick question…');
    await expect(page.locator('[data-widget-dialog="btw"]'), 'no dialog: the card took the pick').toHaveCount(0);
    expect(writtenControls(maws, parent, 'side_question'), 'nothing asked yet').toEqual([]);
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(composer).toHaveText('');

    // typed: asked, the composer cleared, the session's card shows it answered (UX wave U4a, O-20: the session's card, not
    // the Side pane; U4b: at the card column's foot while the column is drawn for the session)
    await page.keyboard.type(`/btw ${SIDE_QUESTION}`);
    await page.keyboard.press('Enter');
    await expect(composer).toHaveText('');
    const view = foot;
    await expect(view).toBeVisible();
    await expect(view.getByRole('heading', { name: 'Side chat' })).toBeVisible();
    await expect(corner).toHaveCount(0);
    await expect(panelRegion(page).locator('[data-side-btw-view]'), 'no question view in the Side pane').toHaveCount(0);
    await expect(view.locator('[data-side-exchange]').first()).toContainText(SIDE_QUESTION);
    await expect(view.locator('[data-side-exchange="answered"]').first()).toContainText('ZEBRA');
    expect(writtenControls(maws, parent, 'side_question').map((r) => r.frame.request)).toEqual([{ subtype: 'side_question', question: SIDE_QUESTION }]);
    expect(writtenUsers(maws, parent), 'no user frame').toHaveLength(1);
    await expect(main.locator('[data-bubble]'), 'the main transcript gained no row').toHaveCount(1);
    // the card is in the main region and holds the answer: the transcript is what must not
    await expect(main.locator('[data-transcript-scroller]').getByText('ZEBRA', { exact: true })).toHaveCount(0);

    // where it stands (what jsdom cannot show): inside the column, its bottom edge at the column's, over neither the
    // composer's frame nor the jump control, and every card above it where it was
    await expectAtFoot(page, before);

    // the column turned off: the same card over the pane's corner, with its exchange; turned on: at the foot again
    await pressSessionCards(page);
    await expect(column).toBeHidden();
    await expect(corner).toBeVisible();
    await expect(corner.locator('[data-side-exchange="answered"]').first()).toContainText('ZEBRA');
    await expect(foot).toHaveCount(0);
    await pressSessionCards(page);
    await expect(column).toBeVisible();
    await expect(foot).toBeVisible();
    await expect(corner).toHaveCount(0);
    await expect(foot.locator('[data-side-exchange="answered"]').first()).toContainText('ZEBRA');
    // Turned on again, the column is mounted anew, and the git store keeps nothing of a checkout its last holder let go
    // (`stores/git.ts`), so the first card draws without its branch and change rows until git answers. The boxes are
    // compared once the card holds what it held; the comparison itself stays one reading.
    await expect.poll(firstCardText, { message: 'the first card holds what it held before the column was turned off' }).toBe(firstCardBefore);
    await expectAtFoot(page, before);

    // folded, the chip is the column's; opened again, the card
    await foot.getByRole('button', { name: 'Fold side chat' }).click();
    await expect(column.locator('[data-btw-chip="foot"]')).toBeVisible();
    await expect(main.locator('[data-btw-chip="corner"]')).toHaveCount(0);
    await expect(foot).toHaveCount(0);
    await column.locator('[data-btw-chip="foot"]').click();
    await expect(foot).toBeVisible();

    // a second question carries the first exchange as history
    await view.getByRole('textbox', { name: 'Ask a side question' }).fill(SIDE_FOLLOW_UP);
    await view.getByRole('textbox', { name: 'Ask a side question' }).press('Enter');
    await expect(view.locator('[data-side-exchange="answered"]')).toHaveCount(2);
    await expect(view.locator('[data-side-exchange="answered"]').nth(1)).toContainText('zebra');
    expect(writtenControls(maws, parent, 'side_question')[1]!.frame.request).toEqual({ subtype: 'side_question', question: SIDE_FOLLOW_UP, history: [{ question: SIDE_QUESTION, response: 'ZEBRA' }] });
    await expect(main.locator('[data-bubble]')).toHaveCount(1);

    // closed: the column draws as before any /btw (decision 5's condition), and nothing of the card is left in it
    await view.getByRole('button', { name: 'Close side chat' }).click();
    await expect(main.locator('[data-btw-card], [data-btw-chip]')).toHaveCount(0);
    await expect.poll(() => columnBoxes(page), { message: 'the cards’ list and each card where they were before /btw' }).toEqual(before);

    // opened again by a bare /btw, with its two exchanges; Continue as a side thread: a fork whose first prompt lists the
    // exchanges, shown in the Side pane, the column gone with the side surface open, and the card, where still open, at the
    // pane's corner
    await composer.click();
    await page.keyboard.type('/btw');
    await expect(commands.locator('[role="option"][aria-selected="true"]')).toContainText('/btw');
    await page.keyboard.press('Enter');
    await expect(foot.locator('[data-side-exchange="answered"]')).toHaveCount(2);
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(composer).toHaveText('');
    await foot.getByRole('button', { name: 'Continue as a side thread' }).click();
    const promoted = await sideThreadOf(page, parent, 'btw');
    const thread = panelRegion(page).locator(`[data-side-thread-view="${await addressed(page, promoted)}"]`);
    await expect(thread).toBeVisible();
    await expect(thread.getByText(PROMOTED_REPLY)).toBeVisible({ timeout: 20_000 });
    await expect(thread.locator('header')).toContainText('Side question');
    await expect(thread.locator('[data-side-question]')).toHaveText(SIDE_QUESTION);
    await expect(column, 'a side surface open: no card column').toBeHidden();
    await expect(main.locator('[data-btw-card="foot"], [data-btw-chip="foot"]')).toHaveCount(0);
    await expect(main.locator('[data-btw-card]:not([data-btw-card="corner"])'), 'a card still open is the pane’s, at its corner').toHaveCount(0);
    const record = value(await invoke(page, 'session.get', { appSessionId: promoted as never }));
    expect(record?.lineage).toEqual({ kind: 'side-thread', parentAppSessionId: parent, parentEngineSessionId: PARENT, openedBy: 'btw' });
    expect(spawnRow(maws, promoted).args).toContain('--fork-session');
    const firstPrompt = String((writtenUsers(maws, promoted)[0]!.frame.message!.content as { text: string }[])[0]!.text);
    expect(firstPrompt).toContain(`Q: ${SIDE_QUESTION}\nA: ZEBRA`);
    expect(firstPrompt).toContain(`Q: ${SIDE_FOLLOW_UP}\nA: zebra`);
    // ticket 733a (S1): the host was handed the exchange inside one pasted segment, of a random id (the thread's session
    // did not exist when main composed it), and the writer's text to the byte; the thread's first row reads the exchange as
    // text, as it did before: no chip and no tag. Waits on the thread's reply above (the replay holds until the host wrote
    // the prompt) and on the promotion's row by its anchor chip's attribute.
    const ids = segmentIds(firstPrompt);
    expect(ids, 'the exchange in one segment').toHaveLength(1);
    expect(firstPrompt, 'the writer’s text, to the byte').toBe(promotionMessage([{ question: SIDE_QUESTION, response: 'ZEBRA' }, { question: SIDE_FOLLOW_UP, response: 'zebra' }], null, ids[0]!));
    const promotion = thread.locator('.transcript-row[data-kind="user"]').filter({ has: page.locator('[data-chip="anchor"][data-anchor-kind="none"]') });
    await expect(promotion, 'the promotion, one row of the thread').toHaveCount(1);
    await expect(promotion.locator('[data-user-content]'), 'its exchange read as text, as before').toHaveText(`Side question ${PROMOTION_HEAD} Q: ${SIDE_QUESTION} A: ZEBRA Q: ${SIDE_FOLLOW_UP} A: zebra Continue from here.`, { useInnerText: true });
    await expect(promotion.locator('.transcript-pasted'), 'no chip: the segment drawn in place').toHaveCount(0);
    await expect(promotion, 'no tag').not.toContainText('pasted_content');
    expect(writtenControls(maws, promoted, 'rename_session').map((r) => r.frame.request)).toEqual([{ subtype: 'rename_session', title: 'Side question', source: 'host' }]);
    expect(writtenUsers(maws, parent), 'still nothing written to the main conversation').toHaveLength(1);

    // UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, §G; L6, R4): the second answer's path is a
    // path link, and a click opens the file beside the chat of the session the card belongs to. The card is opened again by
    // a bare /btw, wherever it stands now (at the pane's corner, a side surface being open).
    await composer.click();
    await page.keyboard.type('/btw');
    await expect(commands.locator('[role="option"][aria-selected="true"]')).toContainText('/btw');
    await page.keyboard.press('Enter');
    const card = main.locator('[data-btw-card]');
    await expect(card.locator('[data-side-exchange="answered"]'), 'the card with its two exchanges').toHaveCount(2);
    const chip = card.locator('[data-side-exchange="answered"]').nth(1).locator(`[data-chip="path"][title="${appPath}"]`);
    await expect(chip, 'the answer’s path drawn as a path link').toBeVisible();
    await chip.click();
    await expect(sideColumn(page).locator(`[data-file-viewer][data-path="${appPath}"]`), 'the file beside the chat').toBeVisible({ timeout: 20_000 });
    await expect(sideColumn(page).locator(`[data-file-viewer][data-path="${appPath}"] .cm-content`)).toContainText('export const total', { timeout: 20_000 });
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
    await expect(page.getByTestId('hover-lineage')).toHaveText(`Fork of ${FIRST_PROMPT_TITLE}`);
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
    await expect(mainRegion(first.page).locator(`[data-side-thread="${await addressed(first.page, child)}"]`)).toHaveAttribute('data-state', 'finished');
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
    const row = mainRegion(page).locator(`[data-side-thread="${await addressed(page, child)}"]`);
    await expect(row).toHaveAttribute('data-state', 'finished');
    await expect(row).toContainText(`Side thread on app.ts:3 finished: ${CHILD_REPLY}`);
    await expect(mainRegion(page).locator('[data-side-thread]')).toHaveCount(1);
    await expect.poll(() => projectRows(page, parent)).toEqual([{ id: parent, level: '2' }, { id: child, level: '3' }]);
    expect(second.consoleErrors()).toEqual([]);
  });

  test('8. both themes: the sheet, the pane on a thread, the parent’s transcript (summary row and anchored prompt), the sidebar’s nesting, the side chat card and the comment card (composing, and its thread with the request card and the needs-you strip) use tokens only', async () => {
    test.setTimeout(180_000);
    const c = await begin((cwd, dir) => {
      const parent = parentJournal(cwd);
      parent.turn('Read it: the total is recomputed on every call, by design.');
      parent.sideQuestions(SIDE_QUESTION_ROWS);
      // P2-E1 (M5): the card's thread, held at a permission it raises, for the card's shots
      const card = new SideJournal(CARD_CHILD, cwd);
      const prompt = card.prompt();
      card.rename(HERO);
      card.permission(prompt, 'Bash', { command: 'echo themed', description: 'Print a word' });
      return [parent.write(dir, 'parent'), threadJournal(CHILD, cwd, 'app.ts:3', [CHILD_REPLY]).write(dir, 'thread'), card.write(dir, 'card')];
    });
    const { page, maws, parent } = c;
    const { child, viewer } = await openThreadFromGutter(c);
    // a comment to main, so the parent's transcript holds an anchored prompt beside the thread's row; the file's tab is
    // beside the chat, where the Side pane took its place (UX wave U6b-1)
    await showFileTab(page, 'app.ts');
    const sheet = await commentOn(page, viewer, 3);
    await sheet.getByRole('checkbox', { name: 'Send to main' }).check();
    await sheet.getByRole('textbox', { name: 'Comment' }).fill('Is the recompute intended?');
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet).toHaveCount(0);
    await showSession(page, parent);
    const main = mainRegion(page);
    await expect(main.getByText('Read it: the total is recomputed on every call, by design.')).toBeVisible({ timeout: 20_000 });
    await expect(main.locator(`[data-side-thread="${await addressed(page, child)}"]`)).toHaveAttribute('data-state', 'finished');
    // and a side question, answered
    await main.getByRole('textbox', { name: 'Message' }).click();
    await page.keyboard.type(`/btw ${SIDE_QUESTION}`);
    await page.keyboard.press('Enter');
    const panel = panelRegion(page);
    const sideChat = main.locator('[data-btw-card="corner"]'); // UX wave U4a (O-20): the session's card, not the Side pane
    await expect(sideChat.locator('[data-side-exchange="answered"]')).toContainText('ZEBRA');

    for (const theme of ['light', 'dark'] as const) {
      await menu(maws, `theme.${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const dir = SHOTS === null ? null : join(SHOTS, theme);
      if (dir !== null) mkdirSync(dir, { recursive: true });
      const shoot = async (target: Locator, name: string) => {
        await page.mouse.move(1, 1);
        expect(await otherThemeColours(page), `${theme}: ${name}`).toEqual([]);
        if (dir !== null) await target.screenshot({ path: join(dir, `${name}.png`) });
      };

      // the sheet, over the file's tab (beside the chat: UX wave U6b-1)
      await showFileTab(page, 'app.ts');
      const open = await commentOn(page, viewer, 3);
      await open.getByRole('textbox', { name: 'Comment' }).fill(COMMENT);
      await shoot(open, 'comment-sheet');
      await open.getByRole('button', { name: 'Cancel' }).click();
      await expect(open).toHaveCount(0);

      // the parent: its transcript, the pane on its thread, the side chat card, the sidebar; the Side pane back in view in
      // the file's place
      await showSession(page, parent);
      await sideTab(sideColumn(page), /^Side\b/).click();
      await panel.locator(`[data-side-chip="${await addressed(page, child)}"]`).click();
      await expect(panel.locator(`[data-side-thread-view="${await addressed(page, child)}"]`).getByText(CHILD_REPLY)).toBeVisible();
      await shoot(panel, 'side-pane-thread');
      await main.locator(`[data-side-thread="${await addressed(page, child)}"]`).scrollIntoViewIfNeeded();
      await shoot(main, 'parent-transcript');
      await expect(sideChat.locator('[data-side-exchange="answered"]')).toContainText('ZEBRA');
      await shoot(sideChat, 'side-chat');
      await (await sidebarRow(page, { appSessionId: child })).scrollIntoViewIfNeeded();
      await shoot(sidebarOf(page), 'sidebar-nesting');
    }
    await menu(maws, 'theme.light');

    // P2-E1 (M5): the comment card in both themes: composing beside the heading; then its thread, with C7's request card
    // inside it and the needs-you strip above Reply
    const { card } = await commentOnHeading(c);
    const viewerBox = panelRegion(page).locator('[data-artifact-viewer]');
    await card.getByRole('textbox', { name: 'Comment' }).fill(CARD_COMMENT);
    await shootCard(maws, viewerBox, 'card-composing');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card).toHaveAttribute('data-card-phase', 'thread', { timeout: 20_000 });
    await expect(card.locator('[data-request-end] [data-request-card]'), 'at the thread transcript’s end (UX wave U1b)').toContainText('echo themed', { timeout: 20_000 });
    await expect(card.locator('[data-needs-you]')).toContainText('Waiting for your permission');
    // the strip's words on one line at the card's width, its two buttons wrapping under them rather than squeezing them
    const stripLines = await card.locator('[data-needs-you] > span').evaluate((text) => Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)));
    expect(stripLines, 'the needs-you text on one line').toBe(1);
    await shootCard(maws, viewerBox, 'card-thread-request');

    // the panel at its narrowest (Home on its resizer): the viewer's body stays wider than the docked layout's 216 px
    // threshold, so the card stays anchored beside the element (the docked fallback is unreachable in the panel; its
    // layout is pinned by CardHost's unit test)
    await page.getByRole('separator', { name: 'Resize right panel' }).focus();
    await page.keyboard.press('Home');
    await expect(page.getByRole('separator', { name: 'Resize right panel' })).toHaveAttribute('aria-valuenow', '280');
    const narrowest = (await viewerBox.locator('[data-card-host]').boundingBox())!;
    console.log(`P2-E1: the viewer body at the panel's minimum width: ${narrowest.width} x ${narrowest.height} px`);
    expect(narrowest.width).toBeGreaterThanOrEqual(216);
    await expect(card).toHaveAttribute('data-placement', 'below');
    await shootCard(maws, viewerBox, 'card-thread-request-narrowest');
    expect(maws.consoleErrors()).toEqual([]);
  });

  // ---- P2-E1 (M2): the comment card's thread (P2-E1 document, acceptance 3, 4 and 5) ----------------------------------

  test('9. a comment on a delivered page’s element becomes its side thread in the card: the comment row and the reply with no parent history above them, the Artifacts surface still open and no Side surface; Reply while idle reaches the thread and nothing reaches the parent', async () => {
    test.setTimeout(150_000);
    const c = await begin((cwd, dir) => [parentJournal(cwd).write(dir, 'parent'), threadJournal(CHILD, cwd, HERO, [CARD_REPLY, CARD_REPLY_2]).write(dir, 'thread')]);
    const { page, maws, parent } = c;
    const { card } = await commentOnHeading(c);
    await card.getByRole('textbox', { name: 'Comment' }).fill(CARD_COMMENT);
    await card.getByRole('button', { name: 'Send' }).click();

    // the card stays and becomes the thread: the comment under its anchor chip, the reply, none of the parent's history
    await expect(card).toHaveAttribute('data-card-phase', 'thread', { timeout: 20_000 });
    const child = await sideThreadOf(page, parent, 'comment');
    await expect(card.getByText(CARD_REPLY)).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-chip="anchor"]')).toHaveText(HERO);
    await expect(card.getByText(CARD_COMMENT, { exact: true })).toBeVisible();
    await expect(card.getByText(FIRST_REPLY), 'none of the parent’s copied history').toHaveCount(0);
    await expect(card.getByText(FIRST_PROMPT)).toHaveCount(0);
    // the comment row's time, Copy and Edit, shown on hover on their line under the bubble (UX wave U3b, decision 10),
    // sit inside the card (the card's narrow width; whole-branch review, fix wave)
    const comment = card.getByRole('region', { name: 'Your message' }).first();
    await comment.hover();
    const toolbar = comment.locator('.transcript-user-line-actions');
    await expect(toolbar).toHaveCSS('opacity', '1');
    const [cardBox, toolbarBox] = [(await card.boundingBox())!, (await toolbar.boundingBox())!];
    expect(toolbarBox.x, 'the toolbar’s left inside the card').toBeGreaterThanOrEqual(cardBox.x);
    expect(toolbarBox.x + toolbarBox.width, 'its right inside the card').toBeLessThanOrEqual(cardBox.x + cardBox.width);
    await page.mouse.move(1, 1);
    await expect(surface(page, 'artifacts')).toBeVisible();
    await expect(surface(page, 'side'), 'no Side surface').toHaveCount(0);
    await expect(page.getByText('Side thread opened in the panel of', { exact: false })).toHaveCount(0);
    const first = writtenUsers(maws, child);
    expect(first).toHaveLength(1);
    expect(JSON.stringify(first[0]!.frame.message!.content)).toContain(CARD_COMMENT);

    // Reply while the thread is idle: an ordinary prompt to the thread, drawn as its next user row, answered in the card
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: child as never })).turn, { timeout: 20_000 }).toBeNull();
    await card.getByRole('textbox', { name: 'Reply' }).fill(CARD_FOLLOW_UP);
    await card.getByRole('textbox', { name: 'Reply' }).press('Enter');
    await expect.poll(() => writtenUsers(maws, child).length).toBe(2);
    const reply = writtenUsers(maws, child)[1]!.frame;
    expect(reply.priority, 'a send, not a steer').toBeUndefined();
    expect(JSON.stringify(reply.message!.content)).toContain(CARD_FOLLOW_UP);
    await expect(card.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
    await expect(card.getByRole('region', { name: 'Your message' }).filter({ hasText: CARD_FOLLOW_UP })).toBeVisible();
    await expect(card.getByText(CARD_REPLY_2)).toBeVisible({ timeout: 20_000 });
    expect(writtenUsers(maws, parent), 'the main conversation received nothing').toHaveLength(1);
    await expect(card).toBeVisible();
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('10. a permission the thread raises is answered inside the card, with the needs-you strip above Reply; a second one moved to the Side pane closes the card and shows its request card there', async () => {
    test.setTimeout(150_000);
    const c = await begin((cwd, dir) => {
      const thread = new SideJournal(CHILD, cwd);
      const prompt = thread.prompt();
      thread.rename(HERO);
      thread.permission(prompt, 'Bash', { command: 'echo first-step', description: 'First step' });
      thread.permission(prompt, 'Bash', { command: 'echo second-step', description: 'Second step' });
      thread.reply(prompt, CARD_REPLY);
      thread.completed(prompt);
      return [parentJournal(cwd).write(dir, 'parent'), thread.write(dir, 'thread')];
    });
    const { page, maws, parent } = c;
    const { card } = await commentOnHeading(c);
    await card.getByRole('textbox', { name: 'Comment' }).fill(CARD_COMMENT);
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card).toHaveAttribute('data-card-phase', 'thread', { timeout: 20_000 });
    const child = await sideThreadOf(page, parent, 'comment');
    const allowed = () => journal(maws, child).filter((r) => r.direction === 'out' && r.frame.type === 'control_response').length;

    // the first request: C7's inline card (the transcript's, named by its heading) inside the card's box, the strip above
    // Reply naming it. UX wave U1b: a permission is the card at the end of the thread's transcript
    const request = card.locator('[data-request-end] [data-request-card]');
    await expect(request).toBeVisible({ timeout: 20_000 });
    await expect(request.getByRole('heading', { name: 'Run a command' }), 'the loaded card says what is asked (U1a §D)').toBeVisible({ timeout: 20_000 });
    await expect(request).toContainText('echo first-step');
    const strip = card.locator('[data-needs-you]');
    await expect(strip).toContainText('Waiting for your permission');
    await expect(strip.getByRole('button', { name: 'Open in Side pane' })).toBeVisible();
    await expect(strip.getByRole('button', { name: 'Open as tab' })).toBeVisible();
    const allow = request.getByRole('button', { name: 'Allow once', exact: true });
    const [cardBox, allowBox] = [(await card.boundingBox())!, (await allow.boundingBox())!];
    expect(allowBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(allowBox.x + allowBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    expect(allowBox.y + allowBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
    await allow.click();
    await expect.poll(allowed).toBe(1);

    // the turn goes on to the second request, the card still open
    await expect(request).toContainText('echo second-step', { timeout: 20_000 });
    await expect(card).toBeVisible();
    await expect(strip).toContainText('Waiting for your permission');
    await strip.getByRole('button', { name: 'Open in Side pane' }).click();
    await expect(card).toHaveCount(0);
    const pane = panelRegion(page).locator(`[data-side-thread-view="${await addressed(page, child)}"]`);
    const atEnd = pane.locator('[data-request-end]').getByRole('group', { name: 'Approval needed' }); // UX wave U1b: the thread view's end
    await expect(atEnd).toContainText('echo second-step');
    await atEnd.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect.poll(allowed).toBe(2);
    await expect(pane.getByText(CARD_REPLY)).toBeVisible({ timeout: 20_000 });
    expect(writtenUsers(maws, parent)).toHaveLength(1);
    expect(maws.consoleErrors()).toEqual([]);
  });

  // ---- P2-E1 (M3): re-dock and re-pin (P2-E1 document, acceptance 6 and 4's last sentence) ------------------------------

  test('11. a thread moved to the Side pane and answered there comes back with “Show in artifact”: the Artifacts surface open, the card in thread phase pinned under the heading it found again, kept open, and still pinned after a Reload', async () => {
    test.setTimeout(150_000);
    const c = await begin((cwd, dir) => {
      const thread = new SideJournal(CHILD, cwd);
      const prompt = thread.prompt();
      thread.rename(HERO);
      thread.permission(prompt, 'Bash', { command: 'echo the-step', description: 'The step' });
      thread.reply(prompt, CARD_REPLY);
      thread.completed(prompt);
      return [parentJournal(cwd).write(dir, 'parent'), thread.write(dir, 'thread')];
    });
    const { page, maws, parent } = c;
    const { card } = await commentOnHeading(c);
    await card.getByRole('textbox', { name: 'Comment' }).fill(CARD_COMMENT);
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card).toHaveAttribute('data-card-phase', 'thread', { timeout: 20_000 });
    const child = await sideThreadOf(page, parent, 'comment');

    // the request is moved to the Side pane and answered there; the thread finishes its reply in the pane
    await expect(card.locator('[data-needs-you]')).toContainText('Waiting for your permission', { timeout: 20_000 });
    await card.locator('[data-needs-you]').getByRole('button', { name: 'Open in Side pane' }).click();
    await expect(card).toHaveCount(0);
    const pane = panelRegion(page).locator(`[data-side-thread-view="${await addressed(page, child)}"]`);
    const atEnd = pane.locator('[data-request-end]').getByRole('group', { name: 'Approval needed' }); // UX wave U1b: the thread view's end
    await expect(atEnd).toContainText('echo the-step');
    await atEnd.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(pane.getByText(CARD_REPLY)).toBeVisible({ timeout: 20_000 });

    // Show in artifact: the parent's Artifacts tool on the artifact, the card back on the same thread under the heading
    await pane.getByRole('button', { name: 'Show in artifact' }).click();
    await expect(surface(page, 'artifacts')).toBeVisible();
    await expect(surface(page, 'side'), 'the Artifacts tool came into view in the Side pane’s place').toHaveCount(0);
    const viewer = panelRegion(page).locator('[data-artifact-viewer]');
    const redocked = viewer.locator('[data-comment-card]');
    await expect(redocked).toHaveAttribute('data-card-phase', 'thread');
    await expect(redocked.locator(`[data-card-thread="${await addressed(page, child)}"]`)).toBeVisible();
    await expect(redocked.getByText(CARD_REPLY)).toBeVisible({ timeout: 20_000 });
    await expect(redocked).toHaveAttribute('data-placement', 'below');
    const hero = viewer.frameLocator('[data-artifact-frame="html"]').locator('#hero');
    const pinnedUnder = async () => {
      const [element, placed] = [(await hero.boundingBox())!, (await redocked.boundingBox())!];
      return Math.abs(placed.y - (element.y + element.height + 4)) <= 1 && Math.abs(placed.x - element.x) <= 1;
    };
    // pinned only once claimed, its thread drawn and the frame asked: its own close rule (the Side pane drew the thread a
    // moment ago) would have shut it in the commit that drew the thread, before any of that
    await expect.poll(pinnedUnder, { message: 'the card 4 px under the heading, at its left', timeout: 10_000 }).toBe(true);
    await expect(redocked).toBeVisible();
    await expect(redocked.getByRole('textbox', { name: 'Reply' })).toBeEnabled();

    await captureArtifactPins(c, viewer, redocked, hero);
    // a Reload mounts a new frame: the card stays and is pinned in it again
    await headerAction(page, panelRegion(page), 'Reload');
    await expect(viewer.frameLocator('[data-artifact-frame="html"]').locator('#hero')).toHaveText('Sales overview');
    await expect(redocked).toBeVisible();
    await expect(redocked).toHaveAttribute('data-card-phase', 'thread');
    await expect.poll(pinnedUnder, { message: 'pinned under the heading after the Reload', timeout: 10_000 }).toBe(true);
    expect(writtenUsers(maws, parent)).toHaveLength(1);
    expect(maws.consoleErrors()).toEqual([]);
  });

  // ---- P2-E1 (M5): the thread updates the page it comments on (P2-E1 document, acceptance 7, with 3, 4 and 6) ---------

  test('12. the thread updates the page it comments on: Allow in the card, the parent’s artifact one version longer and nothing under the thread, the viewer on v2 with the card open and pinned, and the thread’s “Updated artifact … · v2” row showing v2 in the same viewer', async () => {
    test.setTimeout(150_000);
    // the thread's journal is written again once the record and the parent's runtime id exist (its launch reads it then)
    // P3-A (M6): the parent made its page through the artifact store (its create allowed by a rule), so the thread can
    // read it and publish over it
    const c = await begin((cwd, dir) => [pageParentJournal(cwd).write(dir, 'parent'), updateJournal(cwd, {}).write(dir, 'thread')]);
    const { page, maws, parent, repo } = c;
    const { card, record } = await commentOnHeading(c, await parentPage(page, parent));
    const viewer = panelRegion(page).locator('[data-artifact-viewer]');
    const hero = viewer.frameLocator('[data-artifact-frame="html"]').locator('#hero');
    await captureArtifactPins(c, viewer, card, hero);
    updateJournal(repo.root, { status: 'published', id: 'dash', deliverableId: record.id, version: 2, title: 'Dashboard', changed: ['index.html'], ownerAppSessionId: parent }).write(c.journals, 'thread');
    await card.getByRole('textbox', { name: 'Comment' }).fill(CARD_COMMENT);
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card).toHaveAttribute('data-card-phase', 'thread', { timeout: 20_000 });
    const child = await sideThreadOf(page, parent, 'comment');

    // the thread reads the page (allowed by a rule) and asks to publish over it: C7's request card inside the card and the
    // strip, then Allow there
    const request = card.locator('[data-request-end] [data-request-card]'); // UX wave U1b: at the thread transcript's end
    await expect(request.getByRole('button', { name: 'Allow once', exact: true }), 'the loaded permission card').toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-needs-you]')).toContainText('Waiting for your permission');
    // P3-F (a diagnostic, not a fix): the request's identity and the public pending state are read before the two clicks
    // (so they follow each other as before), and again, collected alongside the poll and never awaited before it, from the
    // one Allow click; a failure below carries both and a third reading, by which the answer's path (card, event,
    // attention item, journal) can be told from where it stopped
    const evidenceFrom = Date.now();
    const pending = await allowEvidence(c, child, request, evidenceFrom);
    await request.getByRole('button', { name: 'Allow once', exact: true }).click();
    // started at the click, not awaited here: the 20 s poll below runs from the click, so these reads (each may take
    // seconds) cannot lengthen it, and a handler keeps a rejection from going unhandled while the poll runs
    const afterAllow = allowEvidence(c, child, request, evidenceFrom).catch((error: unknown) => ({ unreadable: String(error).slice(0, 200) }));

    // the host served the call against the parent's artifact: two versions long, the thread's the second (P3-L M6b: the
    // store's versions; X12's copy of v2 under the parent's record directory was the Deliverables store's alone), and no
    // X12 record anywhere
    const rows = () => journal(maws, child) as unknown as Parameters<typeof mcpCalls>[0];
    const served = () => {
      const call = mcpCalls(rows()).find((entry) => entry.name === 'artifact_publish');
      const result = call ? mcpResultOf(rows(), call.requestId) : null;
      return result ? (JSON.parse(resultText(result)) as Record<string, unknown>) : null;
    };
    try {
      await expect.poll(served, { timeout: 20_000 }).toMatchObject({ status: 'published', id: 'dash', deliverableId: record.id, version: 2, ownerAppSessionId: parent });
    } catch (error) {
      const [afterAllowReading, final] = await Promise.all([afterAllow, allowEvidence(c, child, request, evidenceFrom)]);
      const seen = Object.entries({ pending, afterAllow: afterAllowReading, final }).map(([label, reading]) => `  ${label}: ${JSON.stringify(reading)}`);
      throw new Error(
        `case 12: the thread's artifact_publish was not served as expected within 20 s of its single Allow click (side thread ${child}, engine session ${CHILD}; ids and statuses only; ms counts from just before the first reading to the start of each):\n${seen.join('\n')}\n${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const { versions } = value(await invoke(page, 'artifacts.versions', { artifactId: record.id }));
    const stored = [...versions].sort((a, b) => a.seq - b.seq);
    expect(await Promise.all(stored.map(async (v) => readFileSync(value(await invoke(page, 'library.content', { artifactId: record.id, revision: v.seq })).path, 'utf8')))).toEqual([HEADING_PAGE, HEADING_PAGE_V2]);
    expect(stored.map((v) => v.actor)).toEqual([{ kind: 'session', appSessionId: parent }, { kind: 'session', appSessionId: child }]);
    expect(existsSync(join(maws.userData, 'deliverables')), 'no X12 record, under the thread or anywhere').toBe(false);

    // the parent's viewer, on the latest, moves to v2; the card stays open in thread phase, pinned under the heading in the
    // new frame, and the thread's reply arrives in it
    await expect(viewer).toHaveAttribute('data-version', '2', { timeout: 20_000 });
    await expect(hero).toHaveText(HERO_V2);
    await expect(card).toHaveAttribute('data-card-phase', 'thread');
    await expect.poll(() => pinnedUnder(hero, card), { message: 'the card 4 px under the v2 heading, at its left', timeout: 10_000 }).toBe(true);
    await expect(card.getByText(CARD_UPDATED)).toBeVisible({ timeout: 20_000 });

    // the thread's row names v2; with the viewer switched back to v1 (the card re-pinned in that frame), the row's Open
    // shows v2 in the same viewer
    const row = card.locator('section.transcript-artifact');
    await expect(row.locator('[data-artifact-heading]')).toHaveText('Updated artifact Dashboard · v2');
    await viewer.getByRole('combobox', { name: 'Version' }).selectOption('1');
    await expect(viewer).toHaveAttribute('data-version', '1');
    await expect(hero).toHaveText('Sales overview');
    await expect.poll(() => pinnedUnder(hero, card), { message: 'pinned under the v1 heading', timeout: 10_000 }).toBe(true);
    await row.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(viewer).toHaveAttribute('data-version', '2');
    await expect(hero).toHaveText(HERO_V2);
    await expect(card).toHaveAttribute('data-card-phase', 'thread');
    await expect.poll(() => pinnedUnder(hero, card), { message: 'pinned under the v2 heading again', timeout: 10_000 }).toBe(true);
    await expect(surface(page, 'artifacts')).toBeVisible();
    await expect(surface(page, 'side'), 'no Side surface').toHaveCount(0);
    expect(writtenUsers(maws, parent), 'the main conversation received nothing').toHaveLength(1);
    await shootCard(maws, viewer, 'card-thread-updated');
    expect(maws.consoleErrors()).toEqual([]);
  });
  test('13. a line comment in Review: two comments on two files, one on a removed line, go to main as one message quoting each line; a draft whose line the agent rewrites is listed under the toolbar; an unticked comment opens its thread in the Side pane', async () => {
    test.setTimeout(150_000);
    const c = await begin((cwd, dir) => {
      const parent = parentJournal(cwd);
      parent.turn(REVIEW_REPLY); // the two comments, sent to main as one message
      return [parent.write(dir, 'parent'), threadJournal(CHILD, cwd, 'app.ts:3', [REVIEW_THREAD_REPLY]).write(dir, 'thread')];
    });
    const { page, maws, repo, parent } = c;
    await repo.fixture.write(TOTAL, TOTAL_TEXT);
    await repo.git('add', TOTAL);
    await repo.git('commit', '-q', '-m', 'total');
    writeFileSync(repo.path(APP), APP_TEXT.replace(OLD_TOTAL_LINE, NEW_TOTAL_LINE));
    writeFileSync(repo.path(TOTAL), `${TOTAL_TEXT}${ROUNDING_LINE}\n${CURRENCY_LINE}\n`);
    await openSurface(page, 'Review');
    const review = surface(page, 'review').locator('[data-review]');
    await expect(review.locator('[data-chip="uncommitted"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
    for (const path of [APP, TOTAL]) await expect(review.locator(`[data-review-file="${path}"] [data-review-body] table`).first()).toBeVisible({ timeout: 20_000 });

    // a draft on a line the agent then rewrites: kept in the pass, it leaves its line for the row under the toolbar, says
    // so, and opens there (D11)
    const draft = await commentOnLine(review, TOTAL, 'new', 5);
    await expect(draft.getByRole('checkbox', { name: 'Send to main' }), 'Review asks for main').toBeChecked();
    await draft.getByRole('textbox', { name: 'Comment' }).fill(COMMENT_LEFT);
    await draft.getByRole('textbox', { name: 'Comment' }).press('Escape');
    await expect(review.locator('[data-comment-card]'), 'Escape keeps the draft and closes the card').toHaveCount(0);
    await expect(review.locator(`[data-review-file="${TOTAL}"] [data-review-unsent-comment]`), 'the draft under its line').toHaveText(COMMENT_LEFT);
    writeFileSync(repo.path(TOTAL), `${TOTAL_TEXT}${ROUNDING_LINE}\n${CURRENCY_LINE_LATER}\n`);
    const unplaced = review.locator('[data-review-unplaced]');
    await expect(unplaced.locator('[data-review-unplaced-words="line-left"]')).toHaveText(LINE_LEFT_DIFF, { timeout: 20_000 });
    await expect(review.locator('[data-review-unsent-comment]'), 'under no line').toHaveCount(0);
    // the toolbar as drawn with the row, and the row under it (measured)
    await expectToolbarAsDrawn(review, 'the toolbar over the row of comments it cannot place');
    const [bar, row] = [await review.locator('[data-review-toolbar]').boundingBox(), await unplaced.boundingBox()];
    expect(row!.y, 'the row under the toolbar').toBeGreaterThanOrEqual(bar!.y + bar!.height - 0.5);
    await unplaced.locator('[data-review-unplaced-edit]').click();
    const away = unplaced.getByRole('dialog', { name: `Comment on ${basename(TOTAL)}:5` });
    await expect(away.getByRole('textbox', { name: 'Comment' }), 'its words, in the card under the toolbar').toHaveValue(COMMENT_LEFT);
    await away.getByRole('button', { name: 'Close', exact: true }).click(); // Close discards
    await expect(unplaced, 'with its last comment the row goes').toHaveCount(0);

    // two comments on two files, the first on the removed line: "Send 2 comments" sends one message to main, each comment
    // its lead, its quoted line (the removed one under "Before the change:") and its words
    const first = await commentOnLine(review, APP, 'old', 3);
    await first.getByRole('textbox', { name: 'Comment' }).fill(COMMENT_REMOVED);
    const second = await commentOnLine(review, TOTAL, 'new', 4);
    await second.getByRole('textbox', { name: 'Comment' }).fill(COMMENT_ADDED);
    await expect(review.locator(`[data-review-file="${APP}"] [data-review-unsent-comment]`), 'the other comment, a row under its line').toHaveText(COMMENT_REMOVED);
    await second.getByRole('button', { name: 'Send 2 comments', exact: true }).click();
    await expect.poll(() => writtenUsers(maws, parent).length, { timeout: 20_000 }).toBe(2);
    const removed = reviewAnchor(repo, APP, 3, 'old');
    const added = reviewAnchor(repo, TOTAL, 4, 'new');
    // ticket 733a (S2): each quoted line went inside a pasted segment of the session's own id (the window holds the main
    // conversation's engine id when it composes: Design 3, "The tag id"), the message the writer's to the byte; the bubble
    // below draws both lines as before
    const tag = pastedTagId(PARENT);
    const sent = writtenUsers(maws, parent)[1]!.frame.message!.content as { type: string; text: string }[];
    expect(sent).toEqual([
      {
        type: 'text',
        text: commentsMessage(
          [
            { anchor: removed, text: quotedComment(removed, OLD_TOTAL_LINE, COMMENT_REMOVED, tag), screenshot: false },
            { anchor: added, text: quotedComment(added, ROUNDING_LINE, COMMENT_ADDED, tag), screenshot: false },
          ],
          'main',
        ),
      },
    ]);
    expect(segmentIds(sent[0]!.text), 'each quoted line in a segment of the session’s id').toEqual([tag, tag]);
    expect(quotedComment(removed, OLD_TOTAL_LINE, COMMENT_REMOVED, tag)).toBe(`Before the change:\n\n\n<pasted_content id="${tag}">\n\`${OLD_TOTAL_LINE}\`\n</pasted_content id="${tag}">\n\n${COMMENT_REMOVED}`);
    // the transcript: one message, two chips, the two quoted lines as code, the removed one under its caption
    const main = mainRegion(page);
    await expect(main.getByText(REVIEW_REPLY)).toBeVisible({ timeout: 20_000 });
    const bubble = main.locator('[data-bubble]').filter({ hasText: COMMENT_REMOVED });
    await expect(bubble, 'one message').toHaveCount(1);
    await expect(bubble).toContainText(COMMENT_ADDED);
    await expect(bubble.locator('[data-chip="anchor"]')).toHaveText(['app.ts:3', 'total.ts:4']);
    await expect(bubble.locator('code')).toHaveText([OLD_TOTAL_LINE, ROUNDING_LINE]);
    await expect(bubble, 'the removed line under its caption').toContainText(/Before the change:\s*export const total = items\.reduce/);
    await expect(bubble.locator('.transcript-pasted'), 'no chip: the two segments drawn in place').toHaveCount(0);
    await expect(bubble, 'no tag').not.toContainText('pasted_content');
    await expect(main.getByText('2 comments, in the order made:', { exact: false }), 'no framing line drawn').toHaveCount(0);
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: parent as never })).turn, { timeout: 20_000 }).toBeNull();

    // one comment with "Send to main" unticked: its side thread opens in the Side pane, in Review's place
    const third = await commentOnLine(review, APP, 'new', 3);
    const toMain = third.getByRole('checkbox', { name: 'Send to main' });
    await expect(toMain).toBeChecked();
    await toMain.uncheck();
    await third.getByRole('textbox', { name: 'Comment' }).fill(COMMENT_THREAD);
    await third.getByRole('button', { name: 'Send', exact: true }).click();
    const child = await sideThreadOf(page, parent, 'comment');
    const pane = panelRegion(page).locator(`[data-side-thread-view="${await addressed(page, child)}"]`);
    await expect(pane, 'the Side pane opens on the new thread').toBeVisible({ timeout: 20_000 });
    await expect(surface(page, 'review'), 'in Review’s place').toHaveCount(0);
    await expect(pane.getByText(REVIEW_THREAD_REPLY)).toBeVisible({ timeout: 20_000 });
    await expect(pane.locator('[data-chip="anchor"]')).toHaveText('app.ts:3');
    const threaded = reviewAnchor(repo, APP, 3, 'new');
    const record = value(await invoke(page, 'session.get', { appSessionId: child as never }));
    expect(record?.lineage).toEqual({ kind: 'side-thread', parentAppSessionId: parent, parentEngineSessionId: PARENT, anchor: threaded, openedBy: 'comment' });
    // ticket 733a (S2): the thread's first message carries the quoted line in one segment of a random id (main composes it
    // before the thread's session exists), the writer's text to the byte at that id; the thread's row draws the line as
    // code, as before
    const firstMessages = writtenUsers(maws, child).map((r) => r.frame.message!.content as { type: string; text: string }[]);
    expect(firstMessages, 'one first message').toHaveLength(1);
    const threadIds = segmentIds(firstMessages[0]![0]!.text);
    expect(threadIds, 'the quoted line in one segment').toHaveLength(1);
    expect(firstMessages).toEqual([[{ type: 'text', text: commentsMessage([{ anchor: threaded, text: quotedComment(threaded, NEW_TOTAL_LINE, COMMENT_THREAD, threadIds[0]!), screenshot: false }], 'thread') }]]);
    const threadBubble = pane.locator('[data-bubble]').filter({ hasText: COMMENT_THREAD });
    await expect(threadBubble.locator('code'), 'its quoted line as code, as before').toHaveText([NEW_TOTAL_LINE]);
    await expect(threadBubble.locator('.transcript-pasted'), 'no chip: the segment drawn in place').toHaveCount(0);
    expect(writtenUsers(maws, parent), 'the main conversation received the one message').toHaveLength(2);
    expect(maws.consoleErrors()).toEqual([]);
  });
});

// P3-F, case 12's diagnostic: one reading of the thread's permission round, as bounded identities and statuses: the request
// card's own DOM (its request id, busy, the Allow once button's state and place, any alert or status text),
// the thread's status, its permission events, its permission attention items and the host's journal (the engine's asks,
// the host's answers, the `maws` calls and whether each was answered, the troubles the host noted). Never an input or a
// payload. Reads only: nothing here clicks, answers, focuses or waits, and a source that cannot be read says so in its
// place, so the reading cannot fail the case itself. `ms` is the reading's start, counted from `from` (a Date.now()).
async function allowEvidence(c: Case, child: string, request: Locator, from: number): Promise<Record<string, unknown>> {
  const { page, maws } = c;
  const id = child as never;
  const read = async <T>(source: () => T | Promise<T>): Promise<T | { unreadable: string }> => {
    try {
      return await source();
    } catch (error) {
      return { unreadable: String(error).slice(0, 200) };
    }
  };
  type Wire = {
    type?: string;
    request_id?: string;
    request?: { subtype?: string; tool_name?: string; tool_use_id?: string };
    response?: { subtype?: string; request_id?: string; response?: { behavior?: string } };
    event?: string;
    requestId?: string;
    expected?: string;
    got?: string;
    message?: string;
  };
  const wire = (row: JournalRow): Wire => row.frame as unknown as Wire;
  const troubles = new Set(['replay_mismatch', 'write_failed', 'transport_error']);
  return {
    ms: Date.now() - from,
    card: await read(() =>
      request.evaluateAll((roots) =>
        roots.map((root) => {
          // U1a §D: the button by its name, its key hint (hidden from the accessibility tree) left out
          const named = (button: HTMLButtonElement) =>
            Array.from(button.childNodes)
              .filter((node) => !(node instanceof HTMLElement && node.getAttribute('aria-hidden') === 'true'))
              .map((node) => node.textContent ?? '')
              .join('')
              .trim();
          const allow = Array.from(root.querySelectorAll('button')).find((button) => named(button) === 'Allow once');
          const box = allow?.getBoundingClientRect();
          return {
            requestCard: root.getAttribute('data-request-card'),
            busy: root.getAttribute('aria-busy'),
            allow: allow && box ? { disabled: allow.disabled, focused: allow === document.activeElement, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
            alert: Array.from(root.querySelectorAll('[role="alert"]')).map((node) => `${node.textContent ?? ''} | ${node.querySelector('[title]')?.getAttribute('title') ?? ''}`.slice(0, 200)),
            status: Array.from(root.querySelectorAll('[role="status"]')).map((node) => (node.textContent ?? '').slice(0, 80)),
          };
        }),
      ),
    ),
    status: await read(async () => {
      const s = value(await invoke(page, 'session.status', { appSessionId: id }));
      return { process: s.process, engineState: s.engineState, engineSessionId: s.engineSessionId, launchId: s.launchId, turn: s.turn?.id ?? null, exit: s.exit && { code: s.exit.code, signal: s.exit.signal, reason: s.exit.reason } };
    }),
    events: await read(async () => {
      const snapshot = value(await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null }));
      return {
        lastSeq: snapshot.lastSeq,
        requested: ofKind(snapshot.events, 'permission.requested').map((e) => ({ requestId: e.requestId, toolUseId: e.toolUseId, tool: e.toolName })),
        resolved: ofKind(snapshot.events, 'permission.resolved').map((e) => ({ requestId: e.requestId, behavior: e.behavior, by: e.resolvedBy })),
      };
    }),
    attention: await read(async () =>
      value(await invoke(page, 'attention.list', undefined))
        .filter((item) => item.appSessionId === child && item.kind === 'permission')
        .map((item) => ({ id: item.id, requestId: item.request.requestId, toolUseId: item.request.toolUseId, state: item.state })),
    ),
    journal: await read(() => {
      const rows = journal(maws, child);
      const shared = rows as unknown as Parameters<typeof mcpCalls>[0];
      return {
        asked: rows.filter((r) => r.direction === 'in' && wire(r).request?.subtype === 'can_use_tool').map((r) => ({ requestId: wire(r).request_id, tool: wire(r).request?.tool_name, toolUseId: wire(r).request?.tool_use_id })),
        answered: rows.filter((r) => r.direction === 'out' && wire(r).type === 'control_response').map((r) => ({ requestId: wire(r).response?.request_id, subtype: wire(r).response?.subtype, behavior: wire(r).response?.response?.behavior })),
        calls: mcpCalls(shared).map((call) => ({ requestId: call.requestId, name: call.name, answered: mcpResultOf(shared, call.requestId) !== null })),
        troubles: rows.filter((r) => r.direction === 'meta' && troubles.has(wire(r).event ?? '')).map((r) => ({ event: wire(r).event, requestId: wire(r).requestId, expected: wire(r).expected, got: wire(r).got, message: wire(r).message?.slice(0, 200) })),
        meta: metaEvents(shared).slice(-8),
      };
    }),
  };
}

// P2-E1 (M5): a side thread that updates its parent's page: the anchored prompt, the rename, the update (P3-A M6:
// `artifact_read` of the page, allowed by a rule, then `artifact_publish` of the new page from the revision the read
// returned, the parent's create following the seeded defaults (Decision Log 67); asked, allowed, served by the host), the reply. `answer`
// is the JSON the engine's tool result carries (the host's own answer is what the replay checks and the test reads).
function updateJournal(cwd: string, answer: Record<string, unknown>): SideJournal {
  const thread = new SideJournal(CHILD, cwd);
  const prompt = thread.prompt();
  thread.rename(HERO);
  thread.mawsToolCall('artifact_read', { artifact: 'dash' }, { status: 'read', id: 'dash', kind: 'html', revision: 1 }, { asked: false });
  thread.mawsToolCall('artifact_publish', { artifact: 'dash', baseRevision: FIRST_CREATED_REVISION, files: { 'index.html': HEADING_PAGE_V2 } }, answer); // Decision Log 67: the real read's fresh base.
  thread.reply(prompt, CARD_UPDATED);
  thread.completed(prompt);
  return thread;
}

// P2-E1 (M5): the card's evidence shots, `docs/doperpowers/evidence/p2-e1/shots/<name>-<theme>.png`, written only under
// MAWS_P2E1_SHOTS=1; in each theme the window holds no colour of the other's either way. Back to light after.
const CARD_SHOTS = process.env.MAWS_P2E1_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p2-e1/shots') : null;
async function shootCard(maws: MawsLaunch, target: Locator, name: string): Promise<void> {
  if (CARD_SHOTS !== null) mkdirSync(CARD_SHOTS, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    await menu(maws, `theme.${theme}`);
    await expect(maws.page.locator('html')).toHaveAttribute('data-theme', theme);
    await maws.page.mouse.move(1, 1);
    expect(await otherThemeColours(maws.page), `${theme}: ${name}`).toEqual([]);
    if (CARD_SHOTS !== null) await target.screenshot({ path: join(CARD_SHOTS, `${name}-${theme}.png`) });
  }
  await menu(maws, 'theme.light');
  await expect(maws.page.locator('html')).toHaveAttribute('data-theme', 'light');
}

// The custom Electron launches have no fixture-managed tracing. Keep frame replacement evidence for both Reload and
// version switches; capture is bounded/best-effort because it runs before the app and scratch disposals in afterEach.
async function captureArtifactPins({ maws, page }: Case, viewer: Locator, card: Locator, heading: Locator): Promise<void> {
  const info = test.info();
  await maws.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  cleanups.push(() => collectBestEffortEvidence({
    'artifact-pin-trace': async () => {
      const path = info.outputPath('artifact-pin-trace.zip');
      await maws.app.context().tracing.stop({ path });
      await info.attach('artifact-pin-trace', { path, contentType: 'application/zip' });
    },
    'artifact-pin-geometry': async () => {
      await info.attach('artifact-pin-geometry', {
        body: JSON.stringify({
          heading: await heading.boundingBox({ timeout: 1_000 }),
          card: await card.boundingBox({ timeout: 1_000 }),
          host: await viewer.locator('[data-card-host]').boundingBox({ timeout: 1_000 }),
          frame: await viewer.locator('[data-artifact-frame="html"]').boundingBox({ timeout: 1_000 }),
          cardStyle: await card.getAttribute('style', { timeout: 1_000 }),
        }, null, 2),
        contentType: 'application/json',
      });
    },
    'artifact-pin-screenshot': async () => {
      await info.attach('artifact-pin-screenshot', { body: await page.screenshot({ timeout: 5_000 }), contentType: 'image/png' });
    },
  }, 5_000));
  await viewer.evaluate((viewer) => {
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'maws:located') return;
      const currentFrame = event.source === viewer.querySelector<HTMLIFrameElement>('[data-artifact-frame="html"]')?.contentWindow;
      console.log('artifact-pin-located', JSON.stringify({ currentFrame, message: event.data }));
    });
  });
}

// The card 4 px under the element's bottom edge, at its left (D4's below placement).
async function pinnedUnder(element: Locator, card: Locator): Promise<boolean> {
  const [box, placed] = [await element.boundingBox(), await card.boundingBox()];
  return box !== null && placed !== null && Math.abs(placed.y - (box.y + box.height + 4)) <= 1 && Math.abs(placed.x - box.x) <= 1;
}

// P2-E1: a delivered page whose heading a comment is made on, in the parent's Artifacts viewer (E2's Deliverables viewer).
const HEADING_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Dashboard</title></head><body style="margin:0;font:16px system-ui;background:#ffffff;color:#1b1b1b">' +
  '<h1 id="hero" style="margin:0;padding:32px 24px;background:#e3f2fd">Sales overview</h1>' +
  '<p class="lead" style="padding:0 24px">Revenue by region, third quarter.</p></body></html>';
const HERO = 'Dashboard v1 › h1#hero “Sales overview”';
const HERO_V2 = 'Sales overview, larger';
const HEADING_PAGE_V2 = HEADING_PAGE.replace('padding:32px 24px;', 'padding:32px 24px;font-size:48px;').replace('>Sales overview<', `>${HERO_V2}<`);
const CARD_COMMENT = 'Make the heading larger.';
const CARD_REPLY = 'The heading is now 48 px, up from 32.';
const CARD_FOLLOW_UP = 'And the subtitle?';
const CARD_REPLY_2 = 'The subtitle stays at 16 px.';
const CARD_UPDATED = 'The heading now reads “Sales overview, larger” at 48 px: version 2 of the page.';

// The parent's page seeded as a pre-P3 deliverable (X12's layout, imported as the host imports it at start: P3-L M6b),
// opened through Library and Show in panel, then Comment and the heading clicked: answers the composing card and the
// seeded page. `existing`: the page when the parent made it (P3-A M6), else one is seeded.
async function commentOnHeading(c: Case & { parent: string }, existing?: { id: string }): Promise<{ card: Locator; record: { id: string } }> {
  const { page, maws, parent } = c;
  const record = existing ?? seedArtifact(maws.userData, parent as AppSessionId, 'dash', 'Dashboard', [HEADING_PAGE]);
  if (!existing) await importSeeded(page);
  await hideSurfaces(page);
  await openArtifactInPanel(page, record.id);
  const panel = surface(page, 'artifacts');
  const viewer = panel.locator('[data-artifact-viewer]');
  const frame = await frameAt(page, await pageUrlOf(page, record.id, 1));
  await expect(frame.locator('#hero')).toHaveText('Sales overview');
  await panel.locator('[data-editor-header]').getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(viewer.locator('[data-picking]')).toBeVisible();
  const box = (await viewer.locator('[data-artifact-frame="html"]').boundingBox())!;
  await page.mouse.click(box.x + 60, box.y + 30);
  const card = viewer.locator('[data-comment-card]');
  await expect(card).toHaveAttribute('data-card-phase', 'composing');
  await expect(card).toHaveAttribute('data-anchor-locator', '#hero');
  return { card, record };
}
