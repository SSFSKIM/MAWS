// P4-A2 G2 (X35; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §2 item 9, §4.2's four rules and §4.4's ARMED state
// [binding]; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R3, G-R4, G-R6, G2.6): an agent's publish into
// a design seen as it is written, end to end without a model. Part of `pnpm e2e:design`, the product build, through the
// host seam (`documents/kinds/document-perf.ts`, MAWS_DOCUMENT_PERF=1): `stream` feeds a session's provisional emitter
// the call's input piece by piece, `call` runs the real `artifact_publish` under the same tool-use id, `drop` ends it
// with no commit. The design is the human's (`artifacts.create`, seeded through the renderer's design seam); the
// agent's files are its own `artifact_read`'s, changed.
//
// Proved here, on the boards the owner sees (the page-side recorder of e2e/support/slides-provisional.ts, over the deck
// layer's hooks, which every board carries): each board a publish writes takes its own layer (its label from the frame
// naming its file, its changed element drawn over the veiled live one before the call); a new board is drawn whole as a
// ghost at its frame once `canvas.json`'s entry for it is whole, and is swapped for the real board at the commit; the
// element swaps with no sample showing neither and none showing both; a stale publish is seen, refused and withdrawn
// without trace, the revision and the board unchanged; on the active board an ARMED element is never covered while the
// agent streams into it and a neighbour (the protection is the active board's: an inactive board's element is drawn).
import { expect, test, type Locator } from '@playwright/test';
import { pieces } from './support/document-provisional';
import { boardOf, filesOf, plain, seamInstalled, seed, editDesign, tabsOf } from './support/design';
import { boxDisturbed, brief, entrySwapOffenders, isVeiled, layerOf, nothingDrawn, ok, openFromLibrary, recordSlides, revisionOf, shownOf, slideSwapOffenders, startWithSeam, type SeamApp, type SlideSample } from './support/slides-provisional';

let app: SeamApp | null = null;
test.afterEach(async () => {
  await app?.close();
  app = null;
});

const AGENT = 'design-provisional-agent';
const LABEL = 'Claude is writing…'; // an agent session with no title (src/shared/artifacts/actor.ts), as the layer names it
const TITLE = 'Provisional screens';
const CANVAS = 'project/canvas.json';
const boardPath = (id: string) => `project/boards/${id}.html`;
const ground = 'background:#ffffff';
const LEDE = 'Ship the first week.';
const LEDE_NEW = 'Ship the first week, then the second.';
// Two boards, their elements placed absolutely so no write moves another element
const FILES: Record<string, string> = {
  [CANVAS]: JSON.stringify({ v: 1, title: TITLE, boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, tablet: { x: 490, y: 0, w: 834, h: 1194, title: 'Tablet' } }, order: ['phone', 'tablet'] }),
  [boardPath('phone')]: `<section id="phone" style="${ground}; padding:24px"><h1 id="title" style="position:absolute; left:24px; top:40px; width:342px; font-size:32px">Launch</h1><p id="lede" style="position:absolute; left:24px; top:240px; width:342px; font-size:16px">${LEDE}</p></section>`,
  [boardPath('tablet')]: `<section id="tablet" style="${ground}; padding:48px"><h2 id="head" style="position:absolute; left:48px; top:48px; width:600px; font-size:40px">Dashboard</h2></section>`,
};
const WATCH = { x: 1424, y: 0, w: 396, h: 484, title: 'Watch' }; // the new board's frame, right of the tablet
const WATCH_FILE = `<section id="watch" style="${ground}; padding:24px"><h2 id="steps" style="position:absolute; left:24px; top:24px; width:348px; font-size:32px">Steps</h2></section>`;

const ROOT = (id: string) => `[data-region="main"] [data-artifact-tab="${id}"]`;
// a board's live canvas (G2.4: a bare `[data-board-id] [data-eid]` also finds the board's ghost nodes)
const LIVE_NODE = (board: string, eid: string) => `[data-board-id="${board}"] .design-board-canvas .maws-slide [data-eid="${eid}"]`;
// the live text the recorder keeps; `watch` is the real new board's canvas, absent until the commit
const LIVE = { title: LIVE_NODE('phone', 'title'), lede: LIVE_NODE('phone', 'lede'), head: LIVE_NODE('tablet', 'head'), watch: '[data-board-id="watch"] .design-board-canvas .maws-slide' };
/** The new board's ghost drawn at its frame (G2.4's `[data-provisional-new-board]`, the whole board inside). */
const NEW_BOARD = '[data-design-layer] [data-provisional-new-board="watch"]';
const watchDrawn = (s: SlideSample) => s.newBoards.some((b) => b.board === 'watch' && b.drawn);

interface Read {
  revision: number;
  files: Record<string, string>;
}

async function designWithRead(a: SeamApp): Promise<{ id: string; read: Read }> {
  const { page, seam } = a;
  await expect.poll(() => seamInstalled(page), { message: 'the design seam is installed' }).toBe('object');
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'design', title: TITLE });
  await seed(page, artifact.id, FILES);
  const read = await seam.call<Read>(AGENT, 'artifact_read', { artifact: artifact.id });
  expect(read.isError, read.text).toBe(false);
  expect(read.result!.files[boardPath('phone')]).toContain(LEDE);
  return { id: artifact.id, read: read.result! };
}

async function openDesign(a: SeamApp, id: string): Promise<Locator> {
  const tab = await openFromLibrary(a.page, TITLE, id, '[data-design-editor]');
  await expect(a.page.locator(`${ROOT(id)} ${LIVE.lede}`)).toHaveText(LEDE, { timeout: 15_000 });
  return tab;
}

const last = async (seen: () => Promise<SlideSample[]>) => (await seen()).at(-1)!;
const publishArgs = (id: string, baseRevision: number, files: Record<string, string>) => ({ artifact: id, baseRevision, files });

test('a publish drawn on the board it writes and a new board at its frame, as they stream; the swap without a gap or a double; a stale publish withdrawn, the revision and the board unchanged', async () => {
  test.setTimeout(150_000);
  app = await startWithSeam('design-provisional');
  const { page, seam } = app;
  const { id, read } = await designWithRead(app);
  await openDesign(app, id);
  const seen = await recordSlides(page, ROOT(id), LIVE);

  // the publish: the index with a third board, the new board's file, then the phone's lede rewritten; streamed up to
  // the lede's new words (the phone's file named, nothing in it differing yet), then the rest
  const canvas = JSON.parse(read.files[CANVAS]!) as { boards: Record<string, unknown>; order: string[] };
  canvas.boards.watch = WATCH;
  canvas.order = [...canvas.order, 'watch'];
  const toolUseId = 'toolu_design_provisional_1';
  const args = publishArgs(id, read.revision, { [CANVAS]: JSON.stringify(canvas), [boardPath('watch')]: WATCH_FILE, [boardPath('phone')]: read.files[boardPath('phone')]!.replace(LEDE, LEDE_NEW) });
  const text = JSON.stringify(args);
  const cut = text.indexOf('Ship the first week, then');
  expect(cut).toBeGreaterThan(0);
  const t0 = Date.now();
  await seam.stream(AGENT, toolUseId, 'artifact_publish', pieces(text.slice(0, cut)), 15);
  await expect.poll(async () => layerOf(await last(seen), 'phone')?.label, { timeout: 10_000, message: 'the phone’s label from the frame that names its file' }).toBe(LABEL);
  await expect.poll(async () => watchDrawn(await last(seen)), { timeout: 10_000, message: 'the new board drawn as a ghost at its frame' }).toBe(true);
  const named = await last(seen);
  await test.step('the phone’s file named, nothing in it differing yet; the new board drawn whole, no real board for it', async () => {
    expect(named.shown.filter((n) => n.slide === 'phone'), JSON.stringify(brief(named, t0))).toEqual([]);
    expect(named.veiled).toEqual([]);
    expect(named.live.watch, 'no real board for the new one before the commit').toBeNull();
    expect(layerOf(named, 'tablet'), 'a board the publish leaves alone has no layer').toBeUndefined();
    const ghost = page.locator(`${ROOT(id)} ${NEW_BOARD}`);
    await expect(ghost).toHaveAttribute('data-provisional-writing', toolUseId);
    await expect(ghost).toHaveAttribute('data-provisional-frame', `${WATCH.x} ${WATCH.y} ${WATCH.w} ${WATCH.h}`);
    await expect(ghost.locator('[data-provisional-thumb="watch"] section.maws-slide')).toContainText('Steps');
    await expect(ghost.locator('[data-provisional-label]')).toHaveText(LABEL);
    await expect(page.locator(ROOT(id)).getByRole('button', { name: /^Watch, / }), 'the board list shows nothing new').toHaveCount(0);
    await expect(page.locator(`${ROOT(id)} [data-board-title="watch"]`), 'the ghost is no board of the world').toHaveCount(0);
  });
  await seam.stream(AGENT, toolUseId, 'artifact_publish', pieces(text.slice(cut)), 25);
  await expect.poll(async () => shownOf(await last(seen), 'phone', 'lede')?.text, { timeout: 10_000, message: 'the whole new text drawn on its board before the call' }).toBe(LEDE_NEW);
  const before = await seen();
  const answer = await seam.call<{ revision: number }>(AGENT, 'artifact_publish', { ...args, toolUseId });
  expect(answer.isError, answer.text).toBe(false);
  await expect(page.locator(`${ROOT(id)} ${LIVE.lede}`)).toHaveText(LEDE_NEW, { timeout: 10_000 });
  await expect(page.locator(`${ROOT(id)} ${LIVE.watch}`)).toContainText('Steps', { timeout: 10_000 });
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 5_000, message: 'the layer withdrawn' }).toBe(true);

  const samples = await seen();
  const texts = [...new Set(samples.flatMap((s) => (shownOf(s, 'phone', 'lede') ? [shownOf(s, 'phone', 'lede')!.text] : [])))];
  test.info().annotations.push({ type: 'the lede as drawn', description: JSON.stringify(texts) });
  await test.step('the new text grows at its element on its board, the live element veiled beneath it, before the call', () => {
    expect(texts.length, JSON.stringify(texts)).toBeGreaterThan(1);
    expect(texts.every((t) => LEDE_NEW.startsWith(t)), JSON.stringify(texts)).toBe(true);
    expect(before.filter((s) => shownOf(s, 'phone', 'lede')).every((s) => isVeiled(s, 'phone', 'lede'))).toBe(true);
    expect(before.every((s) => !(s.live.lede ?? '').includes('then the second'))).toBe(true);
    expect(samples.every((s) => !shownOf(s, 'phone', 'title') && !isVeiled(s, 'phone', 'title')), 'an element left as it is is not drawn').toBe(true);
  });
  await test.step('the swaps: the lede, and the new board for its ghost, neither a gap nor a double', () => {
    const lede = slideSwapOffenders(samples, 'phone', 'lede', 'lede', LEDE_NEW);
    expect(lede.gaps.map((s) => brief(s, t0))).toEqual([]);
    expect(lede.doubles.map((s) => brief(s, t0))).toEqual([]);
    const board = entrySwapOffenders(samples, watchDrawn, (s) => s.live.watch !== null);
    expect(board.gaps.map((s) => ({ at: s.at - t0, newBoards: s.newBoards, watch: s.live.watch })), 'a gap: the new board was not drawn').toEqual([]);
    expect(board.doubles.map((s) => ({ at: s.at - t0, newBoards: s.newBoards, watch: s.live.watch })), 'a double: the new board drawn twice').toEqual([]);
  });

  // the owner edits the phone; the agent then publishes from its first read: seen, refused, withdrawn whole
  await editDesign(page, id, { op: 'prependText', boardId: 'phone', elementId: 'title', text: 'Draft ' });
  await expect(page.locator(`${ROOT(id)} ${LIVE.title}`)).toHaveText('Draft Launch', { timeout: 10_000 });
  await expect.poll(() => revisionOf(page, id)).toBeGreaterThan(answer.result!.revision);
  const revisionBefore = await revisionOf(page, id);
  const filesBefore = await filesOf(page, id);
  const staleId = 'toolu_design_provisional_stale';
  const stale = publishArgs(id, read.revision, { [boardPath('phone')]: read.files[boardPath('phone')]!.replace('Launch', 'Lift-off') });
  await seam.stream(AGENT, staleId, 'artifact_publish', pieces(JSON.stringify(stale)), 15);
  await expect.poll(async () => shownOf(await last(seen), 'phone', 'title')?.text, { timeout: 10_000, message: 'the stale publish is seen' }).toBe('Lift-off');
  const refused = await seam.call(AGENT, 'artifact_publish', { ...stale, toolUseId: staleId });
  expect(refused.isError, 'the stale publish is refused').toBe(true);
  expect(refused.text).toMatch(/staleBase|conflict/);
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 10_000, message: 'the refused layer withdrawn' }).toBe(true);
  expect(await revisionOf(page, id), 'the revision is unchanged').toBe(revisionBefore);
  expect(await filesOf(page, id), 'the design is unchanged').toEqual(filesBefore);
  expect(app.launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('on the active board an ARMED element is never covered while the agent streams into it and a neighbour; an inactive board’s element is drawn; the element drawn once let go', async () => {
  test.setTimeout(150_000);
  app = await startWithSeam('design-provisional-armed');
  const { page, seam } = app;
  const { id, read } = await designWithRead(app);
  const tab = await openDesign(app, id);
  // the phone zoomed to and made the active board, then its heading pressed: ARMED, its box focused (P4-B2 T1)
  await tab.getByRole('button', { name: 'Board Phone options' }).click();
  await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
  await tab.getByRole('button', { name: /^Phone, / }).click();
  await expect.poll(async () => (await tabsOf(page, id)).find((v) => v.surface === 'main')?.currentBoard).toBe('phone');
  const heading = (await page.locator(`${ROOT(id)} ${LIVE.title}`).boundingBox())!;
  await page.mouse.click(heading.x + Math.min(20, heading.width / 2), heading.y + heading.height / 2);
  const box = tab.locator(`${LIVE.title} .deck-textbox`);
  await expect(box).toBeFocused();
  await expect(tab.locator('[data-design-world][data-armed]')).toHaveCount(1);
  const seen = await recordSlides(page, ROOT(id), LIVE);

  const toolUseId = 'toolu_design_provisional_armed';
  const args = publishArgs(id, read.revision, {
    [boardPath('phone')]: read.files[boardPath('phone')]!.replace('Launch', 'Lift-off').replace(LEDE, LEDE_NEW),
    [boardPath('tablet')]: read.files[boardPath('tablet')]!.replace('Dashboard', 'Dashboard, live'),
  });
  const t0 = Date.now();
  await seam.stream(AGENT, toolUseId, 'artifact_publish', pieces(JSON.stringify(args)), 15);
  await expect.poll(async () => shownOf(await last(seen), 'phone', 'lede')?.text, { timeout: 10_000, message: 'the neighbour drawn' }).toBe(LEDE_NEW);
  await expect.poll(async () => shownOf(await last(seen), 'tablet', 'head')?.text, { timeout: 10_000, message: 'the inactive board’s element drawn' }).toBe('Dashboard, live');
  await test.step('the armed element held back with its box, focus and text exact; the neighbour and the other board drawn', async () => {
    const samples = await seen();
    const covered = samples.filter((s) => boxDisturbed(s, 'phone', 'title', 'Launch')); // the box alone, its text exact, nothing of the layer over it
    expect(covered.map((s) => brief(s, t0)), 'the armed element covered or its box disturbed').toEqual([]);
    expect(layerOf(samples.at(-1)!, 'phone')?.held).toContain('title');
    expect(layerOf(samples.at(-1)!, 'tablet')?.held ?? [], 'nothing held on an inactive board').toEqual([]);
    await expect(box).toBeFocused();
    expect((await tabsOf(page, id)).find((v) => v.surface === 'main')?.selection).toEqual(['title']);
  });
  // let go: ARMED, then nothing selected (P4-B2's Escapes); the agent's heading is drawn at the next state change
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await tabsOf(page, id)).find((v) => v.surface === 'main')?.selection).toEqual([]);
  await expect(box).toHaveCount(0);
  await expect.poll(async () => shownOf(await last(seen), 'phone', 'title')?.text, { timeout: 10_000, message: 'the heading drawn once let go' }).toBe('Lift-off');
  // the call is abandoned: the layer goes without trace
  await seam.drop(AGENT, toolUseId);
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 5_000 }).toBe(true);
  expect((await last(seen)).live).toEqual(expect.objectContaining({ title: 'Launch', lede: LEDE, head: 'Dashboard' }));
  expect(plain((await boardOf(page, id, 'phone')).children.find((c) => c.id === 'title'))).toBe('Launch');
  expect(app.launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
