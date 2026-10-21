// Comments on a deck's elements in the product build (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M7, D9;
// Acceptance 4's owner half; part of `pnpm e2e:presentations`). A deck is created by the human's `artifacts.create` and
// seeded from files through the renderer's seam, then opened in the panel's Artifacts tool beside a chat, since a
// comment goes to the session the main area shows (B's rule). An element selected on the stage and commented opens P2's
// card with B's artifact target and anchor; Resolve on the card keeps the thread, the rail reopens it; its pin sits at
// the element's top-right and follows it through a drag, a resize from another replica, a re-order of slides and an
// agent's republish that rewrites its text (the quote following); deleting the element shows the thread orphaned with
// that last text; Resolve and Reopen in the rail; the header counts the open threads. Decision Log 31's narrow-panel
// ruling: at the panel's default width (under 720 px of editor) a rail overlays the stage as a sheet from the right, so
// the stage keeps its width. The agent's three tools are the
// host's unit tests (src/engine-host/presentations/threads.test.ts), through the real tool server.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ScratchRepo } from '../test/support/scratch-repo';
import { launchMaws, type MawsLaunch } from './support/launch';
import { newChatIn, openProject } from './support/sidebar';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

interface Seam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    edit(artifactId: string, edit: { op: 'setStyle'; slideId: string; elementId: string; props: Record<string, string | null> }): Promise<void>;
    files(artifactId: string): Promise<Record<string, string>>;
    order(artifactId: string): Promise<string[]>;
  };
}
const seam = <K extends keyof Seam['__maws_presentations']>(page: Page, name: K, ...args: Parameters<Seam['__maws_presentations'][K]>) =>
  page.evaluate(([n, a]) => ((window as unknown as Seam).__maws_presentations[n as K] as (...x: unknown[]) => unknown)(...(a as unknown[])), [name, args] as const) as ReturnType<Seam['__maws_presentations'][K]>;

let launch: MawsLaunch | null = null;
let repo: ScratchRepo | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  repo?.dispose();
  repo = null;
});

async function ready(): Promise<Page> {
  launch = await launchMaws();
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1800, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations), { message: 'the seam is installed' }).toBe('object');
  return page;
}

const DECK_JSON = (order: string[]) => JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-14T09:00:00Z' }, title: 'Q3 review', cover: 's1', order });
const FILES: Record<string, string> = {
  'project/deck.json': DECK_JSON(['s1', 's2']),
  'project/slides/s1.html': `<section id="s1" style="background:#ffffff; padding:128px"><h2 id="title" style="font-size:72px">Plan</h2><p id="body" style="position:absolute; left:300px; top:500px; width:500px; height:120px; font-size:48px; background:#eef2ff">One path</p></section>`,
  'project/slides/s2.html': `<section id="s2" style="background:#ffffff; padding:128px"><h2 id="t2" style="font-size:72px">Numbers</h2></section>`,
};

/** The stage's frame and the screen point of a slide px on it. */
async function stageAt(deck: Locator) {
  const frame = (await deck.locator('[data-stage-slide]').boundingBox())!;
  const scale = frame.width / 1920;
  return { scale, at: (x: number, y: number) => ({ x: frame.x + x * scale, y: frame.y + y * scale }) };
}
/** `stageAt` once the stage's frame has stopped changing (a zoom that fits re-lays out a frame after a resize). */
async function settledStage(deck: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await deck.locator('[data-stage-slide]').boundingBox());
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return stageAt(deck);
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
  await page.mouse.up();
}

/** How far the pin sits from its element's top-right corner (its point on the corner), in screen px. */
async function pinOffset(deck: Locator, elementId: string): Promise<number> {
  const pin = await deck.locator(`[data-comment-pin="${elementId}"]`).boundingBox();
  const element = await deck.locator(`[data-stage-slide] [data-eid="${elementId}"]`).boundingBox();
  if (!pin || !element) return Number.POSITIVE_INFINITY;
  return Math.max(Math.abs(pin.x - (element.x + element.width)), Math.abs(pin.y + pin.height - element.y));
}

test('comments on a deck’s elements: the card, the pin through a move, a resize, a re-order and a republish, the orphan, Resolve and Reopen', async () => {
  test.setTimeout(180_000);
  repo = await ScratchRepo.create({ sentinels: false });
  const page = await ready();
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'Q3 review' });
  const id = artifact.id;
  await seam(page, 'seed', id, FILES);

  // a chat shown (a comment goes to it), the deck in the panel's Artifacts tool beside it
  const project = await ok<{ name: string }>(page, 'session.projects.add', { directory: repo.root });
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  const panel = page.locator('[data-region="panel"]');
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts', exact: true }).click();
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${id}"]`).click();
  const deck = panel.locator(`[data-deck-artifact="${id}"]`);
  await expect(deck.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  const toolbar = deck.getByRole('toolbar', { name: 'Deck' });

  // at the panel's default width a rail is a sheet over the stage, which keeps its width (Decision Log 31's ruling)
  expect((await deck.locator('[data-deck-editor]').boundingBox())!.width).toBeLessThan(720);
  const surface = deck.locator('[data-stage-surface]');
  const before = (await surface.boundingBox())!;
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  const sheet = deck.locator('[data-deck-rail="comments"]');
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  const [over, under] = [(await sheet.boundingBox())!, (await surface.boundingBox())!];
  expect(Math.abs(under.width - before.width)).toBeLessThan(1);
  expect(over.x).toBeLessThan(under.x + under.width); // it lies over the stage's right side
  expect(over.x + over.width).toBeGreaterThan(under.x + under.width - 1);
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  await expect(sheet).toHaveCount(0);

  // the panel widened to its widest (640 px), so the gestures below have room on the stage
  const divider = panel.getByRole('separator', { name: 'Resize right panel' });
  const room = Number(await divider.getAttribute('aria-valuemax')) - Number(await divider.getAttribute('aria-valuenow'));
  const grip = (await divider.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - room, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThanOrEqual(600);

  // the element selected by a click and commented: P2's card on B's artifact target, labelled with the slide
  const first = (await stageAt(deck)).at;
  await page.mouse.click(first(550, 560).x, first(550, 560).y);
  await expect(deck.locator('[data-overlay] [data-selected="body"]')).toBeVisible();
  await toolbar.getByRole('button', { name: 'Comment', exact: true }).click();
  const card = page.locator('[data-comment-card]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-comment');
  await expect(card).toHaveAttribute('data-anchor-locator', 'One path');
  await expect(card).toHaveAttribute('aria-label', 'Comment on Q3 review, slide 1: Plan');
  // kept on purpose without a session's answer: Resolve on the card (B's way), then Reopen from the rail
  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(card).toHaveCount(0);
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  const rail = deck.getByRole('complementary', { name: 'Comments' });
  const thread = rail.locator('article[data-element="body"]');
  await expect(thread).toHaveAttribute('data-status', 'resolved');
  await thread.getByRole('button', { name: 'Reopen' }).click();
  await expect(thread).toHaveAttribute('data-status', 'open');
  await expect(panel.getByRole('button', { name: '1 open comment' })).toBeVisible(); // the header's count

  // the pin at the element's top-right
  await expect.poll(() => pinOffset(deck, 'body'), { message: 'the pin on the element’s corner' }).toBeLessThan(4);
  const { at, scale } = await settledStage(deck); // the fit zoom after the panel's resize
  // a drag moves the element: the pin follows
  await drag(page, at(550, 560), at(850, 360));
  await expect.poll(async () => (await seam(page, 'files', id))['project/slides/s1.html']).toContain('left:600px');
  await expect.poll(() => pinOffset(deck, 'body')).toBeLessThan(4);
  // another replica restyles it wider: the pin follows its right edge
  await seam(page, 'edit', id, { op: 'setStyle', slideId: 's1', elementId: 'body', props: { width: '800px', color: '#aa0000' } });
  await expect.poll(async () => (await deck.locator('[data-stage-slide] [data-eid="body"]').boundingBox())!.width).toBeGreaterThan(780 * scale);
  await expect.poll(() => pinOffset(deck, 'body')).toBeLessThan(4);

  // the agent republishes: the slides re-ordered and the element's text rewritten, its id kept
  const files = await seam(page, 'files', id);
  await seam(page, 'seed', id, { ...files, 'project/deck.json': DECK_JSON(['s2', 's1']), 'project/slides/s1.html': files['project/slides/s1.html']!.replace('One path', 'Two paths') });
  expect(await seam(page, 'order', id)).toEqual(['s2', 's1']);
  await expect(thread.locator('.deck-thread-slide')).toHaveText('Slide 2');
  await expect(thread.locator('.deck-thread-quote-text')).toHaveText('Two paths'); // the quote read from the element
  await expect(deck.locator('[data-stage-slide="s1"]')).toBeVisible(); // still the slide shown
  await expect.poll(() => pinOffset(deck, 'body')).toBeLessThan(4);

  // the element deleted (the sheet closed so the stage takes the click, then opened again): the thread orphaned with the
  // element's last text, stored by the host from the text just before the deletion; no pin; still counted open
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  await expect(rail).toHaveCount(0);
  const box = (await deck.locator('[data-stage-slide] [data-eid="body"]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(deck.locator('[data-overlay] [data-selected="body"]')).toBeVisible();
  await page.keyboard.press('Delete');
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  await expect(thread).toHaveAttribute('data-orphan', '');
  await expect(thread).toContainText('The commented element was deleted.');
  await expect(thread.locator('.deck-thread-quote-text')).toHaveText('Two paths');
  await expect(deck.locator('[data-comment-pin]')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '1 open comment' })).toBeVisible();

  // Resolve and Reopen in the rail; the count follows
  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(thread).toHaveAttribute('data-status', 'resolved');
  await expect(panel.getByRole('button', { name: /open comment/ })).toHaveCount(0);
  await thread.getByRole('button', { name: 'Reopen' }).click();
  await expect(thread).toHaveAttribute('data-orphan', '');
  await expect(panel.getByRole('button', { name: '1 open comment' })).toBeVisible();
  // an undo brings the element back: the thread is no orphan any more, its pin is back
  await deck.getByRole('button', { name: 'Undo' }).click();
  await expect(thread).not.toHaveAttribute('data-orphan', '');
  await expect.poll(() => pinOffset(deck, 'body')).toBeLessThan(4);

  expect(launch!.consoleErrors()).toEqual([]);
});

// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the P4 spec's §2 item 2; the prior art's V2, V4,
// V5, V8, V10): the pin popover. The deck in the panel beside a chat as above (a comment goes to the shown session), the
// panel at its widest so the stage takes presses. A kept thread's pin opens its popover at the pin with the reply field
// focused and no rail; Escape keeps a typed reply and gives the keyboard to the pin, the pin's press restores it; a press
// on the empty stage closes it and selects nothing; the reply posts; the last resolve removes the popover, the pin and
// the filmstrip's badge.
test('the pin popover: at the pin with its reply field focused, Escape keeps the draft, an empty-stage press selects nothing, the last resolve removes the pin and the badge', async () => {
  test.setTimeout(180_000);
  repo = await ScratchRepo.create({ sentinels: false });
  const page = await ready();
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'Q3 review' });
  const id = artifact.id;
  await seam(page, 'seed', id, FILES);

  const project = await ok<{ name: string }>(page, 'session.projects.add', { directory: repo.root });
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  const panel = page.locator('[data-region="panel"]');
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts', exact: true }).click();
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${id}"]`).click();
  const deck = panel.locator(`[data-deck-artifact="${id}"]`);
  await expect(deck.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  const toolbar = deck.getByRole('toolbar', { name: 'Deck' });
  const divider = panel.getByRole('separator', { name: 'Resize right panel' });
  const room = Number(await divider.getAttribute('aria-valuemax')) - Number(await divider.getAttribute('aria-valuenow'));
  const grip = (await divider.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - room, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThanOrEqual(600);
  const { at } = await settledStage(deck);

  // a thread kept on the body (Comment, then Resolve on the card and Reopen in the rail: the card's own thread is the
  // card's view while nothing is sent in it; reopened, it is the pin's)
  await page.mouse.click(at(550, 560).x, at(550, 560).y);
  await expect(deck.locator('[data-overlay] [data-selected="body"]')).toBeVisible();
  await toolbar.getByRole('button', { name: 'Comment', exact: true }).click();
  const card = page.locator('[data-comment-card]');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(card).toHaveCount(0);
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  const rail = deck.getByRole('complementary', { name: 'Comments' });
  await rail.locator('article[data-element="body"]').getByRole('button', { name: 'Reopen' }).click();
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  await expect(rail).toHaveCount(0);

  // the filmstrip's badge, in the thumbnail's name (V10)
  const badge = deck.locator('[data-slide-thumb="s1"] [data-comments-badge]');
  await expect(badge).toHaveText('1');
  await expect(deck.getByRole('button', { name: 'Slide 1, 1 open comment' })).toBeVisible();

  // the pin's press: its popover at the pin, the reply field focused, no rail (V2)
  const pin = deck.locator('[data-comment-pin="body"]');
  await expect.poll(() => pinOffset(deck, 'body')).toBeLessThan(4);
  await pin.click();
  const popover = page.getByRole('dialog', { name: 'Comments on “One path”' });
  await expect(popover).toBeVisible();
  const reply = popover.getByRole('textbox', { name: 'Reply' });
  await expect(reply).toBeFocused();
  await expect(pin).toHaveAttribute('aria-expanded', 'true');
  await expect(rail).toHaveCount(0);
  const [p, q] = [(await pin.boundingBox())!, (await popover.boundingBox())!];
  expect(Math.abs(q.x - p.x), 'its left at the pin’s').toBeLessThan(2);
  expect(q.y - (p.y + p.height), 'its top just under the pin').toBeGreaterThanOrEqual(0);
  expect(q.y - (p.y + p.height)).toBeLessThan(8);

  // a reply typed, Escape: closed, the keyboard on the pin; the pin again: the draft is there (V4, V5)
  await page.keyboard.type('Shorter?');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(pin).toBeFocused();
  await pin.click();
  await expect(reply).toHaveValue('Shorter?');

  // a press on the empty stage: closed, and nothing selected anew (the body stays selected; no marquee) (V4)
  await page.mouse.click(at(1800, 1000).x, at(1800, 1000).y);
  await expect(popover).toHaveCount(0);
  await expect(deck.locator('[data-overlay] [data-selected="body"]')).toBeVisible();
  await expect(deck.locator('[data-marquee]')).toHaveCount(0);
  await expect(pin).toBeFocused();

  // the reply posted from the popover; the last resolve: the popover, the pin and the badge go (V8)
  await pin.click();
  await reply.press('Enter');
  await expect(popover.locator('.thread-card-body')).toHaveText(['Shorter?']);
  await popover.getByRole('button', { name: 'Resolve' }).click();
  await expect(popover).toHaveCount(0);
  await expect(pin).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await expect(deck.getByRole('button', { name: 'Slide 1', exact: true })).toBeVisible();

  expect(launch!.consoleErrors()).toEqual([]);
});
