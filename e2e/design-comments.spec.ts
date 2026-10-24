// Comments on a design's boards and elements in the product build (docs/doperpowers/plans/2026-10-16-p3-e1-design-
// workbench.md, M4, acceptance 3; part of `pnpm e2e:design`). A design is created by the human's `artifacts.create` and
// seeded from files through the renderer's seam (e2e/support/design.ts), then opened in the panel's Artifacts tool beside
// a chat, since a comment goes to the session the main area shows (B's rule); an agent session's writes, replies and
// resolutions come through the host's design seam (MAWS_DESIGN_HISTORY; src/engine-host/designs/history-seam.ts).
// - A board's comment (its frame selected, Comment) opens P2's card on B's artifact target quoting the board's title;
//   Resolve on the card, Reopen in the rail; its pin at the board's top-right follows a board move; its quote follows a
//   rename the agent publishes; the header counts it.
// - An element's comment (an inactive board's press activates and selects it, Comment) opens the card quoting the
//   element; its pin follows the element's move and its board's move; "Move to board…" takes the element across boards
//   under a derived id, the thread with it, and again onto a board already holding the id that move would derive (the
//   element under a minted id, the thread on it); the agent's republish of its text moves the quote.
// - The agent replies and resolves through its tools' writes; the rail shows both and the count follows. Its move of the
//   element to a board this replica does not show leaves the source active and pins the element on the destination once.
// - Deleting the element orphans its thread with the last text, Undo brings it back; deleting the board orphans the
//   board's thread with the last title, a restore of a version from before brings the board back with the thread live and
//   every conversation since kept.
import { openArtifactInPanel } from './support/shell';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ScratchRepo } from '../test/support/scratch-repo';
import { launchMaws, type MawsLaunch } from './support/launch';
import { newChatIn, openProject } from './support/sidebar';
import { AgentSeam, refusalOf } from './support/dashboards';
import { openFromLibrary, plain } from './support/design';
import { AGENT_SESSION, asAgent, createDesign, derivedIdOf, DESIGN_FILES, editDesign, elementOf, filesOf, FRAMES, ok, pinOffset, seamInstalled, seed, threadsOf, viewOf } from './support/design';

let launch: MawsLaunch | null = null;
let repo: ScratchRepo | null = null;
let channel: string | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  repo?.dispose();
  repo = null;
  if (channel) rmSync(channel, { recursive: true, force: true });
  channel = null;
});

async function ready(env: Record<string, string>): Promise<Page> {
  launch = await launchMaws({ env });
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1800, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => seamInstalled(page), { message: 'the seam is installed' }).toBe('object');
  return page;
}

/** A press at the middle of what `target` draws (the world decides who takes it, as a person's press). */
async function pressOn(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** The design's files with the manifest's board `title` changed and a board file's text replaced (an agent's republish). */
async function republish(page: Page, id: string, change: { title?: [string, string]; text?: [string, string, string]; append?: [string, string] }) {
  const files = await filesOf(page, id);
  const canvas = JSON.parse(files['project/canvas.json']!) as { boards: Record<string, { title?: string }> };
  if (change.title) canvas.boards[change.title[0]]!.title = change.title[1];
  const next: Record<string, string> = { ...files, 'project/canvas.json': JSON.stringify(canvas) };
  if (change.text) next[`project/boards/${change.text[0]}.html`] = next[`project/boards/${change.text[0]}.html`]!.replace(change.text[1], change.text[2]);
  if (change.append) next[`project/boards/${change.append[0]}.html`] = next[`project/boards/${change.append[0]}.html`]!.replace('</section>', `${change.append[1]}</section>`);
  await seed(page, id, next);
}

test('comments on a design’s boards and elements: the card, the pins through moves across boards, the agent’s reply and resolution, orphans, undo and restore', async () => {
  test.setTimeout(300_000);
  channel = mkdtempSync(join(tmpdir(), 'maws-design-comments-'));
  repo = await ScratchRepo.create({ sentinels: false });
  const page = await ready({ MAWS_DESIGN_HISTORY: channel });
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);

  // a chat shown (a comment goes to it), the design in the panel's Artifacts tool beside it, the panel at its widest
  const project = await ok<{ name: string }>(page, 'session.projects.add', { directory: repo.root });
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  const panel = page.locator('[data-region="panel"]');
  await openArtifactInPanel(page, id);
  const ws = panel.locator(`[data-design-artifact="${id}"]`);
  await expect(ws.locator('[data-design-editor]')).toBeVisible({ timeout: 15_000 });
  const divider = panel.getByRole('separator', { name: 'Resize right panel' });
  const room = Number(await divider.getAttribute('aria-valuemax')) - Number(await divider.getAttribute('aria-valuenow'));
  const grip = (await divider.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - room, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThanOrEqual(600);

  const toolbar = ws.getByRole('toolbar', { name: 'Design' });
  const card = page.locator('[data-comment-card]');
  const rail = ws.getByRole('complementary', { name: 'Comments' });
  const toggleRail = () => toolbar.getByRole('button', { name: /^Comments/ }).click();
  const zoomTo = async (label: string) => {
    await toolbar.getByRole('button', { name: 'Boards', exact: true }).click();
    await ws.getByRole('button', { name: `Board ${label} options` }).click();
    await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
    if (await ws.getByRole('navigation', { name: 'Boards' }).isVisible()) await toolbar.getByRole('button', { name: 'Boards', exact: true }).click();
  };
  const threadOf = async (where: (t: Awaited<ReturnType<typeof threadsOf>>[number]) => boolean) => (await threadsOf(page, id)).find(where);

  let boardThread = '';
  await test.step('a board’s comment: the card on its title, Resolve and Reopen, the pin through a board move, the quote through a rename', async () => {
    await zoomTo('Phone');
    await ws.getByRole('button', { name: 'Board Phone', exact: true }).click(); // its frame selected
    await expect.poll(async () => (await viewOf(page, id, 'panel')).frame).toBe('phone');
    await toolbar.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-comment');
    await expect(card).toHaveAttribute('data-anchor-locator', 'Phone');
    await expect(card).toHaveAttribute('aria-label', 'Comment on Launch screens, Phone');
    boardThread = (await threadOf((t) => t.slideId === 'phone' && t.elementId === ''))!.id;
    await card.getByRole('button', { name: 'Resolve' }).click();
    await expect(card).toHaveCount(0);
    await toggleRail();
    const thread = rail.locator(`article[data-thread="${boardThread}"]`);
    await expect(thread).toHaveAttribute('data-status', 'resolved');
    await thread.getByRole('button', { name: 'Reopen' }).click();
    await expect(thread).toHaveAttribute('data-status', 'open');
    await expect(panel.getByRole('button', { name: '1 open comment' })).toBeVisible(); // the header's count
    await toggleRail();
    await expect(rail).toHaveCount(0);

    const pin = ws.locator('[data-board-pin="phone"]');
    const phone = ws.locator('[data-board-id="phone"]');
    await expect.poll(() => pinOffset(pin, phone), { message: 'the pin on the board’s corner' }).toBeLessThan(4);
    await editDesign(page, id, { op: 'setFrame', boardId: 'phone', frame: { y: 120 } }); // another replica moves the board
    await expect.poll(() => pinOffset(pin, phone)).toBeLessThan(4);
    await republish(page, id, { title: ['phone', 'Phone — sign in'] });
    await expect.poll(async () => (await threadOf((t) => t.id === boardThread))?.quote).toBe('Phone — sign in');
    await expect(pin).toHaveAttribute('aria-label', 'Comment on “Phone — sign in”');
  });

  let noteThread = '';
  let onTablet = '';
  await test.step('an element’s comment: the card, its pin through the element’s and its board’s moves', async () => {
    await zoomTo('Desktop');
    await pressOn(page, ws.locator('[data-board-id="desktop"] [data-eid="note"]')); // the inactive desktop activated, the note selected
    await expect.poll(async () => (await viewOf(page, id, 'panel')).selection).toEqual(['note']);
    await toolbar.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(card).toHaveAttribute('data-anchor-locator', 'Edit me');
    await expect(card).toHaveAttribute('aria-label', 'Comment on Launch screens, Desktop');
    noteThread = (await threadOf((t) => t.elementId === 'note'))!.id;
    await card.getByRole('button', { name: 'Resolve' }).click();
    await expect(card).toHaveCount(0);
    await toggleRail();
    await rail.locator(`article[data-thread="${noteThread}"]`).getByRole('button', { name: 'Reopen' }).click();
    await toggleRail();

    const pin = ws.locator('[data-comment-pin="note"]');
    const note = ws.locator('[data-board-id="desktop"] [data-eid="note"]');
    await expect.poll(() => pinOffset(pin, note)).toBeLessThan(4);
    await editDesign(page, id, { op: 'setStyle', boardId: 'desktop', elementId: 'note', props: { left: '400px', top: '700px' } });
    await expect.poll(async () => (await elementOf(page, id, 'desktop', 'note'))?.style.left).toBe('400px');
    await expect.poll(() => pinOffset(pin, note)).toBeLessThan(4);
    await editDesign(page, id, { op: 'setFrame', boardId: 'desktop', frame: { y: 200 } });
    await expect.poll(() => pinOffset(pin, note)).toBeLessThan(4);
  });

  await test.step('Move to board… takes it across boards under a derived id, the thread and the pin with it', async () => {
    await expect.poll(async () => (await viewOf(page, id, 'panel')).selection).toEqual(['note']);
    await toolbar.getByRole('button', { name: 'Inspector', exact: true }).click();
    await ws.getByRole('button', { name: 'Move to board…' }).click();
    await page.getByRole('menuitem', { name: 'Tablet', exact: true }).click();
    await expect.poll(async () => (await viewOf(page, id, 'panel')).currentBoard).toBe('tablet');
    onTablet = (await viewOf(page, id, 'panel')).selection[0]!;
    expect(onTablet).toMatch(/^m[0-9a-z]{8}$/);
    expect(await elementOf(page, id, 'desktop', 'note')).toBeUndefined();
    // pinned, it keeps its top and is nudged left just enough to lie inside the narrower tablet (834 px; it is 800 wide)
    const there = (await elementOf(page, id, 'tablet', onTablet))!.style;
    expect(there.top).toBe('700px');
    expect(Number.parseFloat(there.left!)).toBeLessThanOrEqual(34.5);
    await expect.poll(async () => await threadOf((t) => t.id === noteThread)).toMatchObject({ slideId: 'tablet', elementId: onTablet, live: true, quote: 'Edit me' });
    const pin = ws.locator(`[data-comment-pin="${onTablet}"]`);
    await expect.poll(() => pinOffset(pin, ws.locator(`[data-board-id="tablet"] [data-eid="${onTablet}"]`))).toBeLessThan(4);
  });

  let onPhone = '';
  await test.step('and onto a board already holding the id that move would derive: a minted id, the thread on it; the agent’s republish moves the quote', async () => {
    const derived = await derivedIdOf(page, id, 'tablet', 'phone', onTablet);
    await republish(page, id, { append: ['phone', `<p id="${derived}" style="position:absolute; left:24px; top:300px; width:200px">Squatter</p>`] });
    await expect.poll(async () => (await elementOf(page, id, 'phone', derived))?.id).toBe(derived);
    await expect.poll(async () => (await viewOf(page, id, 'panel')).selection).toEqual([onTablet]); // still selected on the tablet
    await ws.getByRole('button', { name: 'Move to board…' }).click();
    await page.getByRole('menuitem', { name: 'Phone — sign in', exact: true }).click();
    await expect.poll(async () => (await viewOf(page, id, 'panel')).currentBoard).toBe('phone');
    onPhone = (await viewOf(page, id, 'panel')).selection[0]!;
    expect(onPhone).not.toBe(derived);
    expect(onPhone).not.toBe(onTablet);
    await expect.poll(async () => await threadOf((t) => t.id === noteThread)).toMatchObject({ slideId: 'phone', elementId: onPhone, live: true });
    expect((await elementOf(page, id, 'phone', derived))?.text).toBeDefined(); // the squatter stays itself
    await expect.poll(() => pinOffset(ws.locator(`[data-comment-pin="${onPhone}"]`), ws.locator(`[data-board-id="phone"] [data-eid="${onPhone}"]`))).toBeLessThan(4);

    await republish(page, id, { text: ['phone', 'Edit me', 'Edit me, revised'] });
    await expect.poll(async () => (await threadOf((t) => t.id === noteThread))?.quote).toBe('Edit me, revised');
    await expect.poll(() => pinOffset(ws.locator(`[data-comment-pin="${onPhone}"]`), ws.locator(`[data-board-id="phone"] [data-eid="${onPhone}"]`))).toBeLessThan(4);
  });

  await test.step('the agent replies and resolves; the rail and the count follow', async () => {
    await asAgent(channel!, id, { op: 'reply', threadId: noteThread, body: 'Revised as asked.' });
    await toggleRail();
    const thread = rail.locator(`article[data-thread="${noteThread}"]`);
    await expect(thread).toContainText('Revised as asked.');
    await expect(panel.getByRole('button', { name: '2 open comments' })).toBeVisible();
    await asAgent(channel!, id, { op: 'resolve', threadId: noteThread });
    await expect(thread).toHaveAttribute('data-status', 'resolved');
    await expect(panel.getByRole('button', { name: '1 open comment' })).toBeVisible();
    expect((await threadOf((t) => t.id === noteThread))!.messages.at(-1)).toEqual({ body: 'Revised as asked.', by: `session:${AGENT_SESSION}` });
    await thread.getByRole('button', { name: 'Reopen' }).click();
    await expect(thread).toHaveAttribute('data-status', 'open');
    await toggleRail();
  });

  await test.step('deleting the element orphans its thread with its last text; Undo brings it back', async () => {
    // the move left it selected, and a press on the element selected alone edits it at the press (P4-B2's T3), so the
    // Delete would take a character: a press on the phone's empty ground (right of the squatter, above the element)
    // first selects nothing, then the press on it selects it ARMED, where Delete removes it (T14)
    const phone = ws.locator('[data-board-id="phone"]');
    const ground = (await phone.boundingBox())!;
    const zoom = ground.width / FRAMES.phone!.w;
    await page.mouse.click(ground.x + 300 * zoom, ground.y + 600 * zoom);
    await expect.poll(async () => (await viewOf(page, id, 'panel')).selection).toEqual([]);
    // the press on what the phone draws of it, the whole board in view: the move kept it 800 px wide on the 390 px phone,
    // whose canvas clips it, so its box's middle lies past the board's right edge, on the empty world (which takes the
    // press, selects nothing and pans)
    await zoomTo('Phone — sign in');
    const board = (await phone.boundingBox())!;
    const drawn = (await ws.locator(`[data-board-id="phone"] [data-eid="${onPhone}"]`).boundingBox())!;
    const right = Math.min(drawn.x + drawn.width, board.x + board.width);
    await page.mouse.click((Math.max(drawn.x, board.x) + right) / 2, drawn.y + drawn.height / 2); // the world takes the keys
    await expect.poll(async () => (await viewOf(page, id, 'panel')).selection).toEqual([onPhone]);
    await expect(ws.locator('[data-design-world][data-armed]')).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect.poll(async () => await threadOf((t) => t.id === noteThread)).toMatchObject({ orphan: true, live: false, quote: 'Edit me, revised' });
    await toggleRail();
    const thread = rail.locator(`article[data-thread="${noteThread}"]`);
    const showDeleted = rail.getByRole('button', { name: 'Show deleted-target comments', exact: true });
    await expect(showDeleted).toHaveAttribute('aria-pressed', 'false');
    await expect(thread).toHaveCount(0);
    await showDeleted.click();
    await expect(thread).toHaveAttribute('data-orphan', '');
    await expect(thread.locator('.deck-thread-quote-text')).toHaveText('Edit me, revised');
    await toggleRail();
    await toolbar.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => await threadOf((t) => t.id === noteThread)).toMatchObject({ orphan: false, live: true });
  });

  await test.step('the agent moves it to a board this replica does not show: the source stays active, the pin follows, once', async () => {
    const { moved } = await asAgent(channel!, id, { op: 'move', from: 'phone', to: 'desktop', elementId: onPhone });
    await expect.poll(async () => await threadOf((t) => t.id === noteThread)).toMatchObject({ slideId: 'desktop', elementId: moved, live: true });
    expect((await viewOf(page, id, 'panel')).currentBoard).toBe('phone'); // nothing activated the destination here
    await ws.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-all');
    const pin = ws.locator(`[data-comment-pin="${moved}"]`);
    await expect(pin).toHaveCount(1);
    await expect(ws.locator(`[data-comment-pin="${moved}"][data-pin-board="desktop"]`)).toHaveCount(1); // P4-B2: one layer for every board's pins
    await expect.poll(() => pinOffset(pin, ws.locator(`[data-board-id="desktop"] [data-eid="${moved}"]`))).toBeLessThan(4);
    await expect(ws.locator(`[data-comment-pin="${onPhone}"]`)).toHaveCount(0);
  });

  await test.step('deleting the board orphans its thread with the last title; a restore brings it back live, every conversation since kept', async () => {
    const before = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Before the cut' });
    await asAgent(channel!, id, { op: 'reply', threadId: boardThread, body: 'Taller header?' }); // a conversation after the version
    await toolbar.getByRole('button', { name: 'Boards', exact: true }).click();
    await ws.getByRole('button', { name: 'Board Phone — sign in options' }).click();
    await page.getByRole('menuitem', { name: 'Delete board' }).click();
    await expect.poll(async () => await threadOf((t) => t.id === boardThread)).toMatchObject({ orphan: true, live: false, quote: 'Phone — sign in' });
    await expect(ws.locator('[data-board-pin="phone"]')).toHaveCount(0);
    await ok(page, 'artifacts.restore', { artifactId: id, versionId: before.versionId });
    await expect.poll(async () => await threadOf((t) => t.id === boardThread), { timeout: 15_000 }).toMatchObject({ orphan: false, live: true, quote: 'Phone — sign in' });
    expect((await threadOf((t) => t.id === boardThread))!.messages.map((m) => m.body)).toContain('Taller header?');
    await expect.poll(() => pinOffset(ws.locator('[data-board-pin="phone"]'), ws.locator('[data-board-id="phone"]'))).toBeLessThan(4);
  });

  expect(launch!.consoleErrors()).toEqual([]);
});

// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V6 and V15): every board's pins in
// one layer, merged on a zoomed-out world and parted by the merged pin's fit, and the pin popover following its pin
// through a pan, hidden while the pin is outside the world. The design opened from the library in a main tab (wide);
// its threads written through the seam, so no session is needed.
test('a design’s pins: merged at a zoom-out, a press fits them apart; the popover follows its pin through a pan and hides with it', async () => {
  test.setTimeout(180_000);
  const page = await ready({});
  const id = await createDesign(page, 'Cluster lab', DESIGN_FILES);
  const tab = await openFromLibrary(page, 'Cluster lab', id);
  await editDesign(page, id, { op: 'addThread', threadId: 'on-a', boardId: 'desktop', elementId: 'a', body: 'Redder?' });
  await editDesign(page, id, { op: 'addThread', threadId: 'on-b', boardId: 'desktop', elementId: 'b', body: 'Greener?' });
  const pinA = tab.locator('[data-comment-pin="a"][data-pin-board="desktop"]');
  const pinB = tab.locator('[data-comment-pin="b"][data-pin-board="desktop"]');

  // at 5 % the two corners (400 board px apart) are 20 screen px apart: one count at their centroid (V15)
  await tab.getByRole('combobox', { name: 'Zoom' }).selectOption('0.05');
  const cluster = tab.locator('[data-pin-cluster="desktop/a desktop/b"]');
  await expect(cluster).toHaveText('2');
  await expect(cluster).toHaveAttribute('aria-label', '2 comments here; zoom to them');
  await expect(pinA).toHaveCount(0);
  // its press fits the two elements: the pins part
  await cluster.click();
  await expect.poll(async () => (await viewOf(page, id, 'main')).viewport?.zoom ?? 0).toBeGreaterThan(0.2);
  await expect(pinA).toBeVisible();
  await expect(pinB).toBeVisible();
  await expect(cluster).toHaveCount(0);

  // a pin's popover, its reply field focused; a pan moves it with its pin, in step (V6)
  await pinA.click();
  const popover = page.locator('[data-pin-popover]');
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('textbox', { name: 'Reply' })).toBeFocused();
  const offset = async () => {
    const [p, q] = [(await pinA.boundingBox())!, (await popover.boundingBox())!];
    return { x: Math.round(q.x - p.x), y: Math.round(q.y - p.y) };
  };
  const before = await offset();
  const world = (await tab.locator('[data-design-world]').boundingBox())!;
  await page.mouse.move(world.x + 24, world.y + world.height - 24); // away from the popover
  const startY = (await pinA.boundingBox())!.y;
  await page.mouse.wheel(0, 60);
  await expect.poll(async () => Math.round(startY - (await pinA.boundingBox())!.y)).toBe(60);
  await expect.poll(offset).toEqual(before);
  // panned until its pin is above the world's top: hidden, kept; panned back: shown where it was
  const up = Math.ceil((await pinA.boundingBox())!.y - world.y) + 60;
  await page.mouse.wheel(0, up);
  await expect(popover).toBeHidden();
  await expect(popover).toHaveCount(1);
  await page.mouse.wheel(0, -up);
  await expect(popover).toBeVisible();
  await expect.poll(offset).toEqual(before);
  // Escape in its reply field closes it, the keyboard on the pin
  await popover.getByRole('textbox', { name: 'Reply' }).press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(pinA).toBeFocused();
  expect(launch!.consoleErrors()).toEqual([]);
});

// E-acc: the same colour/property collides, while text against colour merges; no paid model turn.
test('carried design colour collision across every board, text merge contrast and re-read preserve the owner’s colour and comment pin', async () => {
  test.setTimeout(180_000);
  const page = await ready({ MAWS_DASHBOARD_E2E: '1' });
  const agent = new AgentSeam(join(launch!.userData, 'dashboard-e2e'));
  const ids = ['phone', 'tablet', 'desktop', 'poster'];
  const files: Record<string, string> = {
    'project/canvas.json': JSON.stringify({ v: 1, title: 'Colour collision', order: ids, boards: {
      phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, tablet: { x: 490, y: 0, w: 834, h: 1194, title: 'Tablet' },
      desktop: { x: 1424, y: 0, w: 1440, h: 1024, title: 'Desktop' }, poster: { x: 2964, y: 0, w: 1080, h: 9000, title: 'Poster' },
    } }),
    ...Object.fromEntries(ids.map((b) => [`project/boards/${b}.html`, `<section id="${b}" style="background:#ffffff; padding:24px"><h1 id="title" style="color:#112233">Launch</h1></section>`])),
  };
  const id = await createDesign(page, 'Colour collision', files);
  const tab = await openFromLibrary(page, 'Colour collision', id);
  await editDesign(page, id, { op: 'addThread', threadId: 'colour-note', boardId: 'phone', elementId: 'title', body: 'Keep this phone colour.' });
  const read = () => agent.ok<{ revision: number; files: Record<string, string> }>('A', 'artifact_read', { artifact: id });
  const changeColour = (source: Record<string, string>, from: string, to: string) => Object.fromEntries(Object.entries(source).map(([path, content]) => [path, path.endsWith('.html') ? content.replaceAll(from, to) : content]));
  const base = await read();
  await editDesign(page, id, { op: 'setStyle', boardId: 'phone', elementId: 'title', props: { color: '#aa2244' } });
  const ownerFiles = await filesOf(page, id);
  const refused = refusalOf(await agent.call('A', 'artifact_publish', { artifact: id, baseRevision: base.revision, files: changeColour(base.files, '#112233', '#225588') }));
  expect(refused).toMatchObject({ reason: 'conflict', conflicts: [{ path: 'project/boards/phone.html', detail: expect.stringMatching(/element title: color changed since your read/) }] });
  expect(await filesOf(page, id), 'the refusal applies nothing on any board').toEqual(ownerFiles);

  // A stale text-only edit of the same element is disjoint from the owner's colour, and therefore merges.
  await agent.ok('A', 'artifact_publish', { artifact: id, baseRevision: base.revision, files: { 'project/boards/phone.html': base.files['project/boards/phone.html']!.replace('Launch', 'Launch revised') } });
  expect(plain(await elementOf(page, id, 'phone', 'title'))).toBe('Launch revised');
  expect((await elementOf(page, id, 'phone', 'title'))!.style.color).toBe('#aa2244');
  const fresh = await read();
  await agent.ok('A', 'artifact_publish', { artifact: id, baseRevision: fresh.revision, files: changeColour(fresh.files, '#112233', '#225588') });
  for (const board of ids) expect((await elementOf(page, id, board, 'title'))!.style.color, board).toBe(board === 'phone' ? '#aa2244' : '#225588');
  expect(plain(await elementOf(page, id, 'phone', 'title'))).toBe('Launch revised');
  await expect.poll(async () => (await threadsOf(page, id)).find((t) => t.id === 'colour-note')).toMatchObject({ slideId: 'phone', elementId: 'title', live: true, orphan: false, quote: 'Launch revised', messages: [{ body: 'Keep this phone colour.', by: 'human' }] });
  const pin = tab.locator('[data-comment-pin="title"]');
  await expect(pin).toHaveCount(1);
  await expect.poll(() => pinOffset(pin, tab.locator('[data-board-id="phone"] [data-eid="title"]'))).toBeLessThan(4);
  expect(launch!.consoleErrors()).toEqual([]);
});
