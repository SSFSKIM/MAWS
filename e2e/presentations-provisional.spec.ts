// P4-A2 G2 (X35; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §2 item 9, §4.2's four rules and §4.4's ARMED and
// EDIT states [binding]; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R1 to G-R5, G2.6): an agent's
// publish into a deck seen as it is written, end to end without a model. Part of `pnpm e2e:presentations`, the product
// build, through the host seam (`documents/kinds/document-perf.ts`, MAWS_DOCUMENT_PERF=1): its `stream` feeds a
// session's provisional emitter the call's input piece by piece as the normaliser's deltas would, and its `call` then
// runs the real `artifact_publish` under the same tool-use id (the commit), or a publish the host refuses, or `drop`
// ends the call with no commit. The deck is the human's (`artifacts.create`, seeded through the renderer's
// presentations seam); the agent's files are what its own `artifact_read` returned, changed.
//
// Proved here, on the stage and the filmstrip the owner sees (a page-side recorder, e2e/support/slides-provisional.ts):
// - the label "<name> is writing…" on the slide from the frame that names its file, before any element differs, and
//   the filmstrip's ring on the slide's thumbnail; the new text drawn at its element, growing, before the call; the real
//   text replacing it with no sample in which the element shows neither and none in which it shows both (rule 2); a
//   stale publish (from a read the owner's edit has overtaken) seen, refused and withdrawn without trace, the revision
//   and the slide unchanged (rule 3);
// - a deck opened mid-stream draws every file streamed so far (G-R1's restatement to a newly synced connection): each
//   slide written ringed and drawn in the filmstrip, a new slide's entry at its place; its entry swapped for the real one
//   at the commit with neither a gap nor a double;
// - rule 4 on the canvas (G-R4): an ARMED box, then an EDIT composition (CDP IME steps), never covered while the agent
//   streams into that element and a neighbour: the neighbour drawn, the protected element held back with its box,
//   focus and text exact and the composition never ended by the layer; once let go the agent's element is drawn; the
//   armed case then swaps, the composition's call is dropped leaving the owner's text;
// - a drag in progress (B2's gesture hold, D17) keeps the committed layer until the drop, then swaps.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { pieces } from './support/document-provisional';
import { HANGEUL, Ime, startTrace, stopTrace } from './support/ime';
import { boxDisturbed, brief, collapseChrome, isVeiled, layerOf, nothingDrawn, ok, openFromLibrary, recordSlides, revisionOf, shownOf, slideSwapOffenders, startWithSeam, entrySwapOffenders, type SeamApp, type SlideSample } from './support/slides-provisional';

interface Seam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    edit(artifactId: string, edit: { op: 'prependText'; slideId: string; elementId: string; text: string }): Promise<void>;
    files(artifactId: string): Promise<Record<string, string>>;
    slide(artifactId: string, slideId: string): Promise<{ children: { id: string; style: Record<string, string> }[] }>;
    editorState(artifactId: string): { surface: string; selection: string[]; editingText: string | null; keyboard: 'stage' | 'away' }[];
    frames(artifactId: string): { surface: string; received: number; held: number; capped: number; released: number }[];
  };
}
const seamOf = (page: Page) => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations);
const seed = (page: Page, id: string, files: Record<string, string>) => page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [id, files] as const);
const editDeck = (page: Page, id: string, edit: Parameters<Seam['__maws_presentations']['edit']>[1]) => page.evaluate(([a, e]) => (window as unknown as Seam).__maws_presentations.edit(a, e), [id, edit] as const);
const filesOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.files(a), id);
const elementOf = async (page: Page, id: string, slideId: string, eid: string) => (await page.evaluate(([a, s]) => (window as unknown as Seam).__maws_presentations.slide(a!, s!), [id, slideId] as const)).children.find((c) => c.id === eid);
const editorState = async (page: Page, id: string) => (await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.editorState(a), id))[0]!;
/** the remote content frames the tab's replica holds now (its hold's buffer) */
const held = async (page: Page, id: string) => (await framesOf(page, id)).held;
/** the tab's replica's hold: what it holds now, the times its 5 s cap cleared it, and the frames it released (B2's counts) */
const framesOf = async (page: Page, id: string) => (await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.frames(a), id))[0] ?? { surface: '', received: 0, held: 0, capped: 0, released: 0 };

let app: SeamApp | null = null;
test.afterEach(async () => {
  await app?.close();
  app = null;
});

const AGENT = 'deck-provisional-agent';
const LABEL = 'Claude is writing…'; // an agent session with no title (src/shared/artifacts/actor.ts), as the layer names it
const TITLE = 'Provisional deck';
const DECK_PATH = 'project/deck.json';
const slidePath = (id: string) => `project/slides/${id}.html`;
const OLD = 'Ship on Friday';
const NEW = 'Ship on Thursday, after the review';
const plainSlide = (id: string, heading: string) => `<section id="${id}" style="background:#ffffff; padding:128px"><h2 id="${id}h" style="position:absolute; left:128px; top:128px; width:1200px; font-size:64px">${heading}</h2></section>`;
// The stage's slide: a text element (a) and its neighbour (b) apart, and a shape (s) below them, all placed absolutely
// so no write moves another element
const DECK: Record<string, string> = {
  [DECK_PATH]: JSON.stringify({ v: 4, title: TITLE, cover: 's1', order: ['s1', 's2', 's3', 's4'] }),
  [slidePath('s1')]: `<section id="s1" style="background:#ffffff; padding:128px">
<p id="a" style="position:absolute; left:160px; top:160px; width:700px; font-size:64px">Hello</p>
<p id="b" style="position:absolute; left:1000px; top:160px; width:800px; font-size:48px">${OLD}</p>
<x-shape id="s" kind="ellipse" style="position:absolute; left:200px; top:640px; width:300px; height:200px; background:#0000ff"></x-shape>
</section>`,
  [slidePath('s2')]: plainSlide('s2', 'Budget'),
  [slidePath('s3')]: plainSlide('s3', 'Risks'),
  [slidePath('s4')]: plainSlide('s4', 'Appendix'),
};
const EMPTY = { x: 1500, y: 960 }; // slide px with no element under them

const ROOT = (id: string) => `[data-region="main"] [data-artifact-tab="${id}"]`;
const LIVE_NODE = (eid: string) => `[data-stage-slide="s1"] section.maws-slide:not([data-provisional-ghost]) [data-eid="${eid}"]`;
const LIVE = { a: LIVE_NODE('a'), b: LIVE_NODE('b') };

interface Read {
  revision: number;
  files: Record<string, string>;
}

/** The human's deck, created and seeded; the agent's read of it. */
async function deckWithRead(a: SeamApp): Promise<{ id: string; read: Read }> {
  const { page, seam } = a;
  await expect.poll(() => seamOf(page), { message: 'the presentations seam is installed' }).toBe('object');
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: TITLE });
  await seed(page, artifact.id, DECK);
  const read = await seam.call<Read>(AGENT, 'artifact_read', { artifact: artifact.id });
  expect(read.isError, read.text).toBe(false);
  for (const id of ['s1', 's2', 's3', 's4']) expect(read.result!.files[slidePath(id)], `the agent read ${id}`).toBeDefined();
  expect(read.result!.files[slidePath('s1')]).toContain(OLD);
  return { id: artifact.id, read: read.result! };
}

/** The deck opened from the library in a main tab, the sidebar and the panel collapsed so the stage is drawn wide. */
async function openDeck(a: SeamApp, id: string): Promise<{ tab: Locator; at: (x: number, y: number) => Promise<{ x: number; y: number }> }> {
  const tab = await openFromLibrary(a.page, TITLE, id, '[data-deck-editor]');
  await expect(a.page.locator(`${ROOT(id)} ${LIVE.b}`)).toHaveText(OLD, { timeout: 15_000 });
  await collapseChrome(a);
  const frame = tab.locator('[data-stage-slide="s1"]');
  await expect.poll(async () => (await frame.boundingBox())?.width ?? 0, { message: 'the slide is drawn wide (B2: 256 px at the default chrome)' }).toBeGreaterThanOrEqual(480);
  // slide px to page px, read when asked (the stage settles after the chrome collapses)
  const at = async (x: number, y: number) => {
    const box = (await frame.boundingBox())!;
    const scale = box.width / 1920;
    return { x: box.x + x * scale, y: box.y + y * scale };
  };
  return { tab, at };
}

const publishArgs = (id: string, baseRevision: number, files: Record<string, string>) => ({ artifact: id, baseRevision, files });
const last = async (seen: () => Promise<SlideSample[]>) => (await seen()).at(-1)!;
/** The press on an element's live node, left of its middle (its own text). */
async function press(page: Page, id: string, eid: string): Promise<void> {
  const box = (await page.locator(`${ROOT(id)} ${LIVE_NODE(eid)}`).boundingBox())!;
  await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
}

test('a publish is seen as it is written: the label from the frame naming the file, the text at its element before the call, the swap without a gap or a double; a stale publish withdrawn, the revision and the slide unchanged', async () => {
  test.setTimeout(150_000);
  app = await startWithSeam('presentations-provisional');
  const { page, seam } = app;
  const { id, read } = await deckWithRead(app);
  await openDeck(app, id);
  const seen = await recordSlides(page, ROOT(id), LIVE);

  // 1: the publish streams in two parts: up to b's new words (the file named, nothing in it differs yet), then the rest
  const toolUseId = 'toolu_deck_provisional_1';
  const args = publishArgs(id, read.revision, { [slidePath('s1')]: read.files[slidePath('s1')]!.replace(OLD, NEW) });
  const text = JSON.stringify(args);
  const cut = text.indexOf('Ship on Thu');
  expect(cut, 'the new words are in the input').toBeGreaterThan(0);
  const t0 = Date.now();
  await seam.stream(AGENT, toolUseId, 'artifact_publish', pieces(text.slice(0, cut)), 15);
  await expect.poll(async () => layerOf(await last(seen), 's1')?.label, { timeout: 10_000, message: 'the label from the frame that names the file' }).toBe(LABEL);
  const named = await last(seen);
  await test.step('the file named, nothing differing yet: the label and the filmstrip’s ring, no element drawn or veiled', () => {
    expect(named.shown, JSON.stringify(brief(named, t0))).toEqual([]);
    expect(named.veiled).toEqual([]);
    expect(layerOf(named, 's1')!.writing).toBe(toolUseId);
    expect(layerOf(named, 's1')!.color, 'the label in the agent’s colour').not.toBe('');
    expect(named.thumbs.find((t) => t.slide === 's1')?.writing, 'the filmstrip rings the slide being written').toBe(toolUseId);
  });
  const streamed = await seam.stream(AGENT, toolUseId, 'artifact_publish', pieces(text.slice(cut)), 25);
  await expect.poll(async () => shownOf(await last(seen), 's1', 'b')?.text, { timeout: 10_000, message: 'the whole new text drawn before the call' }).toBe(NEW);
  const before = await seen();
  const answer = await seam.call<{ revision: number }>(AGENT, 'artifact_publish', { ...args, toolUseId });
  expect(answer.isError, answer.text).toBe(false);
  await expect(page.locator(`${ROOT(id)} ${LIVE.b}`)).toHaveText(NEW, { timeout: 10_000 });
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 5_000, message: 'the layer withdrawn' }).toBe(true);

  const samples = await seen();
  const firstLabel = samples.findIndex((s) => layerOf(s, 's1')?.label === LABEL);
  const firstShown = samples.findIndex((s) => s.shown.some((n) => n.slide === 's1'));
  const texts = [...new Set(samples.flatMap((s) => (shownOf(s, 's1', 'b') ? [shownOf(s, 's1', 'b')!.text] : [])))];
  const timeline = { frames: streamed.frames, firstLabelMs: firstLabel >= 0 ? samples[firstLabel]!.at - t0 : null, firstShownMs: firstShown >= 0 ? samples[firstShown]!.at - t0 : null, texts };
  test.info().annotations.push({ type: 'provisional timeline (ms after the stream began)', description: JSON.stringify(timeline) });
  console.log(`[presentations-provisional] ${JSON.stringify(timeline)}`);
  await test.step('the label before any element differs, and on every sample the layer draws', () => {
    expect(firstLabel).toBeGreaterThanOrEqual(0);
    expect(firstShown).toBeGreaterThan(firstLabel);
    expect(samples.filter((s) => s.shown.length > 0).every((s) => layerOf(s, 's1')?.label === LABEL)).toBe(true);
  });
  await test.step('the new text grows at its element, the live element veiled beneath it, before the call', () => {
    expect(texts.length, `several lengths of the text were drawn: ${JSON.stringify(texts)}`).toBeGreaterThan(1);
    expect(texts.every((t) => NEW.startsWith(t)), JSON.stringify(texts)).toBe(true);
    expect(texts.at(-1)).toBe(NEW);
    const drawing = before.filter((s) => shownOf(s, 's1', 'b'));
    expect(drawing.every((s) => shownOf(s, 's1', 'b')!.kind === 'changed' && isVeiled(s, 's1', 'b')), 'b drawn as changed over its veiled live node').toBe(true);
    expect(before.every((s) => !(s.live.b ?? '').includes(NEW)), 'nothing of the publish is in the deck before the call').toBe(true);
    expect(samples.every((s) => !shownOf(s, 's1', 'a') && !isVeiled(s, 's1', 'a')), 'an element the publish leaves as it is is not drawn').toBe(true);
  });
  await test.step('the swap: no sample shows neither the layer nor the real text, and none shows both', () => {
    const { gaps, doubles } = slideSwapOffenders(samples, 's1', 'b', 'b', NEW);
    expect(gaps.map((s) => brief(s, t0)), 'a gap: b showed neither the layer nor the write').toEqual([]);
    expect(doubles.map((s) => brief(s, t0)), 'a double: the layer stayed after its write landed').toEqual([]);
  });

  // 2: the owner edits the slide; the agent then publishes from its first read: the stale publish is seen, then refused
  // and withdrawn whole
  await editDeck(page, id, { op: 'prependText', slideId: 's1', elementId: 'a', text: 'Draft ' });
  await expect(page.locator(`${ROOT(id)} ${LIVE.a}`)).toHaveText('Draft Hello', { timeout: 10_000 });
  await expect.poll(() => revisionOf(page, id), { message: 'the owner’s edit is the live revision' }).toBeGreaterThan(answer.result!.revision);
  const revisionBefore = await revisionOf(page, id);
  const filesBefore = await filesOf(page, id);
  const staleId = 'toolu_deck_provisional_stale';
  const STALE = 'Hi there';
  const stale = publishArgs(id, read.revision, { [slidePath('s1')]: read.files[slidePath('s1')]!.replace('Hello', STALE) });
  await seam.stream(AGENT, staleId, 'artifact_publish', pieces(JSON.stringify(stale)), 15);
  await expect.poll(async () => shownOf(await last(seen), 's1', 'a')?.text, { timeout: 10_000, message: 'the stale publish is seen' }).toBe(STALE);
  const refused = await seam.call(AGENT, 'artifact_publish', { ...stale, toolUseId: staleId });
  expect(refused.isError, 'the stale publish is refused').toBe(true);
  expect(refused.text).toMatch(/staleBase|conflict/);
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 10_000, message: 'the refused layer withdrawn' }).toBe(true);
  expect(await revisionOf(page, id), 'the revision is unchanged').toBe(revisionBefore);
  expect(await filesOf(page, id), 'the slide is unchanged').toEqual(filesBefore);
  const after = await last(seen);
  expect(after.live).toEqual({ a: 'Draft Hello', b: NEW });
  expect(app.launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('a deck opened mid-stream draws every file streamed so far, a new slide’s entry at its place, and swaps them at the commit', async () => {
  test.setTimeout(150_000);
  app = await startWithSeam('presentations-provisional-attach');
  const { page, seam } = app;
  const { id, read } = await deckWithRead(app);

  // the publish rewrites three slides and adds a fifth; the index and N = 3 slide files (s2, s3 and the new s5) stream
  // while the deck is open nowhere, s1's file after it opens
  const index = JSON.parse(read.files[DECK_PATH]!) as { order: string[] };
  index.order = [...index.order, 's5'];
  const NEW_SLIDE = plainSlide('s5', 'Next steps');
  const files = {
    [DECK_PATH]: JSON.stringify(index),
    [slidePath('s2')]: read.files[slidePath('s2')]!.replace('Budget', 'Budget, revised'),
    [slidePath('s3')]: read.files[slidePath('s3')]!.replace('Risks', 'Risks, revised'),
    [slidePath('s5')]: NEW_SLIDE,
    [slidePath('s1')]: read.files[slidePath('s1')]!.replace(OLD, NEW),
  };
  const toolUseId = 'toolu_deck_provisional_attach';
  const args = publishArgs(id, read.revision, files);
  const text = JSON.stringify(args);
  const cut = text.indexOf(`"${slidePath('s1')}"`);
  expect(cut).toBeGreaterThan(0);
  const t0 = Date.now();
  await seam.stream(AGENT, toolUseId, 'artifact_publish', pieces(text.slice(0, cut), 24), 10);

  const seen = await recordSlides(page, ROOT(id), LIVE); // the root appears with the tab
  await openDeck(app, id);
  const written = ['s2', 's3', 's5'];
  const drawnSoFar = (s: SlideSample) => written.filter((slide) => s.thumbs.some((t) => t.slide === slide && t.writing === toolUseId && t.drawn));
  await expect.poll(async () => drawnSoFar(await last(seen)), { timeout: 10_000, message: 'every file streamed before the deck opened is drawn' }).toEqual(written);
  await test.step('all N drawn: the rewritten slides ringed and drawn over their thumbnails, the new slide’s entry at its place, the stage’s slide not yet written', async () => {
    const s = await last(seen);
    expect(s.thumbs.filter((t) => t.slide === 's2' || t.slide === 's3').every((t) => !t.isNew)).toBe(true);
    expect(s.thumbs.find((t) => t.slide === 's5')?.isNew, 'the new slide drawn in a ghost entry').toBe(true);
    expect(s.newSlides).toEqual(['s5']);
    expect(s.entries).toEqual(['s1', 's2', 's3', 's4']);
    expect(layerOf(s, 's1'), 's1’s file has not streamed').toBeUndefined();
    const entry = page.locator(`${ROOT(id)} .deck-filmstrip-list > li`).last();
    await expect(entry, 'the new slide’s entry stands after the last slide').toHaveAttribute('data-provisional-new-slide', 's5');
    await expect(entry.locator('button, [tabindex]'), 'the entry takes no focus').toHaveCount(0);
  });

  await seam.stream(AGENT, toolUseId, 'artifact_publish', pieces(text.slice(cut), 24), 10);
  await expect.poll(async () => shownOf(await last(seen), 's1', 'b')?.text, { timeout: 10_000, message: 's1 drawn on the stage once its file streams' }).toBe(NEW);
  expect(layerOf(await last(seen), 's1')?.label).toBe(LABEL);
  const answer = await seam.call<{ revision: number }>(AGENT, 'artifact_publish', { ...args, toolUseId });
  expect(answer.isError, answer.text).toBe(false);
  await expect(page.locator(`${ROOT(id)} ${LIVE.b}`)).toHaveText(NEW, { timeout: 10_000 });
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 5_000, message: 'the layer withdrawn' }).toBe(true);
  const samples = await seen();
  await test.step('the swap: the stage’s element and the new slide’s entry, neither a gap nor a double', () => {
    const b = slideSwapOffenders(samples, 's1', 'b', 'b', NEW);
    expect(b.gaps.map((s) => brief(s, t0))).toEqual([]);
    expect(b.doubles.map((s) => brief(s, t0))).toEqual([]);
    // judged on what each entry draws, not on its markers: a ghost entry whose provisional slide is gone, or a real entry
    // whose canvas has not drawn yet, shows nothing
    const ghostDrawn = (s: SlideSample) => (s.newSlideText.s5 ?? '').includes('Next steps');
    const realDrawn = (s: SlideSample) => (s.entryText.s5 ?? '').includes('Next steps');
    const entry = entrySwapOffenders(samples, ghostDrawn, realDrawn);
    const where = (s: SlideSample) => ({ at: s.at - t0, entries: s.entries, newSlides: s.newSlides, entryText: s.entryText.s5 ?? null, newSlideText: s.newSlideText.s5 ?? null });
    expect(entry.gaps.map(where), 'a gap: s5’s entry drew no slide').toEqual([]);
    expect(entry.doubles.map(where), 'a double: s5 drawn in two entries').toEqual([]);
    expect(samples.at(-1)!.entries).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });
  const deck = await filesOf(page, id);
  expect(deck[slidePath('s2')]).toContain('Budget, revised');
  expect(deck[slidePath('s3')]).toContain('Risks, revised');
  expect(deck[slidePath('s5')]).toContain('Next steps');
  expect(app.launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('an ARMED box and an EDIT composition are never covered while the agent streams into their element and a neighbour: the box, its focus and the human’s text exact; the element drawn once let go', async () => {
  test.setTimeout(150_000);
  app = await startWithSeam('presentations-provisional-armed');
  const { page, seam } = app;
  const { id, read } = await deckWithRead(app);
  const { tab, at } = await openDeck(app, id);
  const seen = await recordSlides(page, ROOT(id), LIVE);
  const box = tab.locator(`${LIVE_NODE('a')} .deck-textbox`);
  // rule 4: the box alone, holding the human's text, with nothing of the layer over it (its element, or the label)
  const untouched = (samples: SlideSample[], text: string) => samples.filter((s) => boxDisturbed(s, 's1', 'a', text));

  // ARMED: one text element selected on the stage, its box mounted and focused
  await press(page, id, 'a');
  await expect(box).toBeFocused();
  expect(await editorState(page, id)).toEqual(expect.objectContaining({ selection: ['a'], editingText: null, keyboard: 'stage' }));
  const armedId = 'toolu_deck_provisional_armed';
  const WRITTEN = 'Hi there';
  const args = publishArgs(id, read.revision, { [slidePath('s1')]: read.files[slidePath('s1')]!.replace('Hello', WRITTEN).replace(OLD, NEW) });
  const from = (await seen()).length;
  const t0 = Date.now();
  await seam.stream(AGENT, armedId, 'artifact_publish', pieces(JSON.stringify(args)), 15);
  await expect.poll(async () => shownOf(await last(seen), 's1', 'b')?.text, { timeout: 10_000, message: 'the neighbour drawn' }).toBe(NEW);
  await test.step('ARMED: the neighbour drawn, the armed element held back, its box, focus and text exact', async () => {
    const armed = (await seen()).slice(from);
    expect(untouched(armed, 'Hello').map((s) => brief(s, t0)), 'the armed element covered or its box disturbed').toEqual([]);
    expect(layerOf(armed.at(-1)!, 's1')?.held, 'the layer holds the armed element back').toContain('a');
    expect(isVeiled(armed.at(-1)!, 's1', 'b')).toBe(true);
    await expect(box).toBeFocused();
    expect(await editorState(page, id)).toEqual(expect.objectContaining({ selection: ['a'], editingText: null, keyboard: 'stage' }));
  });
  // let go (a press on the slide's empty ground): the agent's element is drawn at the next state change
  const empty = await at(EMPTY.x, EMPTY.y);
  await page.mouse.click(empty.x, empty.y);
  await expect.poll(async () => shownOf(await last(seen), 's1', 'a')?.text, { timeout: 10_000, message: 'the element drawn once let go' }).toBe(WRITTEN);
  expect(layerOf(await last(seen), 's1')?.held ?? []).toEqual([]);
  const answer = await seam.call<{ revision: number }>(AGENT, 'artifact_publish', { ...args, toolUseId: armedId });
  expect(answer.isError, answer.text).toBe(false);
  await expect(page.locator(`${ROOT(id)} ${LIVE.a}`)).toHaveText(WRITTEN, { timeout: 10_000 });
  await expect(page.locator(`${ROOT(id)} ${LIVE.b}`)).toHaveText(NEW);
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 5_000 }).toBe(true);
  for (const [key, written] of [['a', WRITTEN], ['b', NEW]] as const) {
    const { gaps, doubles } = slideSwapOffenders(await seen(), 's1', key, key, written);
    expect(gaps.map((s) => brief(s, t0)), `a gap at ${key}`).toEqual([]);
    expect(doubles.map((s) => brief(s, t0)), `a double at ${key}`).toEqual([]);
  }

  // EDIT: the armed box typed on through the input method, a syllable left composing (하), while the next publish
  // streams into the same element and its neighbour
  await press(page, id, 'a');
  await expect(box).toBeFocused();
  const ime = await Ime.open(page);
  const editId = 'toolu_deck_provisional_edit';
  const NEXT = 'Ship on Monday instead';
  const next = publishArgs(id, answer.result!.revision, { [slidePath('s1')]: args.files[slidePath('s1')]!.replace(WRITTEN, 'Welcome').replace(NEW, NEXT) });
  try {
    await ime.step(HANGEUL[0]!);
    await ime.step(HANGEUL[1]!);
    await expect.poll(async () => (await editorState(page, id)).editingText).toBe('a');
    await expect(box).toHaveText('하');
    await startTrace(page);
    const composing = (await seen()).length;
    await seam.stream(AGENT, editId, 'artifact_publish', pieces(JSON.stringify(next)), 15);
    await expect.poll(async () => shownOf(await last(seen), 's1', 'b')?.text, { timeout: 10_000, message: 'the neighbour drawn while the human composes' }).toBe(NEXT);
    const events = await stopTrace(page);
    await test.step('EDIT: the composition untouched: never ended, never refocused, the composing text exact; the element held back, the neighbour drawn', async () => {
      const during = (await seen()).slice(composing);
      expect(untouched(during, '하').map((s) => brief(s, t0)), 'the composing element covered or its text disturbed').toEqual([]);
      expect(layerOf(during.at(-1)!, 's1')?.held).toContain('a');
      expect(events.filter((e) => ['compositionend', 'compositionstart', 'focusin', 'focusout', 'input'].includes(e.type)).map((e) => e.type), 'the page saw no composition event, focus change or input while the agent streamed').toEqual([]);
      await expect(box).toBeFocused();
    });
    await ime.commit('하'); // the composition ends: the human's text
  } finally {
    await ime.cdp.detach();
  }
  await page.mouse.click(empty.x, empty.y); // the edit ends
  await expect(box).toHaveCount(0);
  await expect(page.locator(`${ROOT(id)} ${LIVE.a}`)).toHaveText('하');
  await expect.poll(async () => shownOf(await last(seen), 's1', 'a')?.text, { timeout: 10_000, message: 'the agent’s element drawn once the edit ends' }).toBe('Welcome');
  // the agent abandons the call: the layer goes, the human's text stays exact
  await seam.drop(AGENT, editId);
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 5_000, message: 'the dropped layer withdrawn' }).toBe(true);
  expect((await last(seen)).live).toEqual({ a: '하', b: NEW });
  expect((await filesOf(page, id))[slidePath('s1')]).toContain('>하<');
  expect(app.launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('a drag in progress keeps the committed layer until the drop, then swaps without a gap or a double', async () => {
  test.setTimeout(150_000);
  app = await startWithSeam('presentations-provisional-drag');
  const { page, seam } = app;
  const { id, read } = await deckWithRead(app);
  await openDeck(app, id);
  const seen = await recordSlides(page, ROOT(id), LIVE);
  const toolUseId = 'toolu_deck_provisional_drag';
  const args = publishArgs(id, read.revision, { [slidePath('s1')]: read.files[slidePath('s1')]!.replace(OLD, NEW) });
  const t0 = Date.now();
  await seam.stream(AGENT, toolUseId, 'artifact_publish', pieces(JSON.stringify(args)), 15);
  await expect.poll(async () => shownOf(await last(seen), 's1', 'b')?.text, { timeout: 10_000, message: 'the whole new text drawn' }).toBe(NEW);

  // the shape selected, then dragged: the gesture holds the replica's remote frames (D17) while the publish commits
  await press(page, id, 's');
  await expect.poll(async () => (await editorState(page, id)).selection).toEqual(['s']);
  const shape = (await page.locator(`${ROOT(id)} ${LIVE_NODE('s')}`).boundingBox())!;
  const from = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const before = await framesOf(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const downAt = Date.now();
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + i * 8, from.y);
  const answer = await seam.call<{ revision: number }>(AGENT, 'artifact_publish', { ...args, toolUseId });
  expect(answer.isError, answer.text).toBe(false);
  await expect.poll(() => held(page, id), { timeout: 3_000, message: 'the commit’s update held by the drag' }).toBeGreaterThan(0);
  const during = await last(seen);
  await test.step('while the drag holds the commit: the layer stays, the live element still the old text beneath it', () => {
    expect(layerOf(during, 's1')?.writing, JSON.stringify(brief(during, t0))).toBe(toolUseId);
    expect(shownOf(during, 's1', 'b')?.text).toBe(NEW);
    expect(isVeiled(during, 's1', 'b')).toBe(true);
    expect(during.live.b).toBe(OLD);
  });
  // two more moves, then the drop, its moment taken in the page as the pointer comes up
  for (let i = 7; i <= 8; i++) await page.mouse.move(from.x + i * 8, from.y);
  await page.evaluate(() => {
    const w = window as unknown as { __pointerUpAt: number | null };
    w.__pointerUpAt = null;
    window.addEventListener('pointerup', () => (w.__pointerUpAt ??= Date.now()), { capture: true, once: true });
  });
  expect(Date.now() - downAt, 'the commit reached the tab inside the hold’s cap').toBeLessThan(4_500);
  await page.mouse.up();
  const upAt = await page.evaluate(() => (window as unknown as { __pointerUpAt: number | null }).__pointerUpAt);
  expect(upAt, 'the page saw the pointer come up').not.toBeNull();
  await expect(page.locator(`${ROOT(id)} ${LIVE.b}`)).toHaveText(NEW, { timeout: 10_000 });
  await expect.poll(async () => nothingDrawn(await last(seen)), { timeout: 5_000, message: 'the layer withdrawn at the drop' }).toBe(true);
  await expect.poll(() => held(page, id)).toBe(0);
  const after = await framesOf(page, id);
  const samples = await seen();
  await test.step('the swap is the drop’s: the gesture released the hold (no cap cleared it), and nothing swapped before the pointer came up', () => {
    expect(after.capped, 'the hold’s 5 s cap never cleared it').toBe(before.capped);
    expect(after.released, 'the drop released the held commit').toBeGreaterThan(before.released);
    const whole = samples.findIndex((s) => shownOf(s, 's1', 'b')?.text === NEW);
    const early = samples.slice(whole).filter((s) => s.at < upAt! && (!layerOf(s, 's1') || !shownOf(s, 's1', 'b') || (s.live.b ?? '').includes(NEW)));
    expect(early.map((s) => brief(s, t0)), 'the layer withdrawn or the write integrated before the drop').toEqual([]);
    const { gaps, doubles } = slideSwapOffenders(samples, 's1', 'b', 'b', NEW);
    expect(gaps.map((s) => brief(s, t0)), 'no gap across the drop').toEqual([]);
    expect(doubles.map((s) => brief(s, t0)), 'no double across the drop').toEqual([]);
  });
  // the drag itself landed: the shape moved
  const moved = (await elementOf(page, id, 's1', 's'))?.style.left;
  expect(moved, 'the shape is still on the slide').toBeDefined();
  expect(moved, 'the shape moved').not.toBe('200px');
  expect(app.launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
