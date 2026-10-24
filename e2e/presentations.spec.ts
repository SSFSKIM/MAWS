// Presentations in the product build (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M4; `pnpm
// e2e:presentations`). A deck is created by the human's `artifacts.create` and seeded from files through the renderer's
// seam (`window.__maws_presentations`: the files published onto a replica by the kind's own publish; M3's tools add the
// agent's route), on a scratch profile.
// - The editor: the deck opens in the panel's Artifacts tool (pinned, so it stays while a main tab shows the deck too)
//   and in an `artifact` main tab, two replicas of one host document: an edit in one shows in the other; the filmstrip
//   shows live thumbnails, sections, a hidden and a held slide; slides are added, duplicated, deleted, hidden and
//   reordered (by the keyboard: dnd-kit's Space, arrows, Space); notes typed in the panel reach the main tab; zoom fits
//   and steps; undo and redo; the under-layer rule painted: a pinned backdrop listed over a flow card covers it, and sent
//   back it sits under the card, read from the window's pixels; a section renamed; the stage offered to Mark up.
// - The scale gate's open (Acceptance 7, Decision Log 50): S7b's 100-slide deck opened cold in a main tab, stage and 100
//   live thumbnails drawn ≤ 1,000 ms, measured through the seam, the 1-minute load average beside the number.
// - M5, the transform layer: select by click, shift-click and marquee; move with snapping guides; resize with the aspect
//   kept; rotate; nudge; a flow child re-ordered by drag and detached; z-order; group and ungroup; duplicate and delete.
// - M5, the inspector, Insert, text in place (marks, a Korean composition while a remote edit lands in the same box) and
//   copy and paste across two decks.
// - M5 fix wave 1: an element drawn scaled picked, handled and resized where it is painted; a turned group ungrouped
//   with each child kept where it was painted; another replica's selection outlined; a crop's focus read from pixels;
//   a picture copied across decks drawn from the second deck's own store.
// - M5, the scale gate's drag (Acceptance 7): since P4-B2 M0 in e2e/presentations-drag.spec.ts, whose agent republishes
//   through the host's `artifact_publish` (this group runs it too).
// - P3-F wave S F3: the deck in the panel at its 280 px minimum, its toolbar wrapped by whole controls (the owner's
//   obs 9: labels one letter a line over the canvas).
// - P4-B2 (D1 to D9, D12; F9's c43 rewritten): words typed on a selected text element replace its text (ARMED, T10);
//   Escape from an edit is ARMED again; a double-click edits the deepest text whatever the scope, a grouped heading in
//   one gesture; a table's cell edited by a double-click, Tab to the next; single clicks through a group (P7).
// - P4-B2 K6: the Edit menu's Undo and Redo, clicked by id, undo and redo a nudge on the stage and only the field's own
//   typing in the inspector.
import { mainTab, openArtifactInPanel, openSurface, pinSurfaceForSessions } from './support/shell';
import { loadavg } from 'node:os';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { benchDeckFiles } from '../src/artifacts/slides/fixtures/bench';
import { ScratchRepo } from '../test/support/scratch-repo';
import { traceForeground } from './support/foreground-trace';
import { launchMaws, type MawsLaunch } from './support/launch';
import { withNativeClipboard } from './support/clipboard';
import { newChatIn, openProject } from './support/sidebar';
import { openArrange, resizePanel, squeezedControls } from './support/toolbar-controls';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

interface Seam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    edit(
      artifactId: string,
      edit:
        | { op: 'zOrder'; slideId: string; elementId: string; to: 'front' | 'back' }
        | { op: 'setNotes'; slideId: string; text: string }
        | { op: 'setOverride'; name: string; value: string | null }
        | { op: 'prependText'; slideId: string; elementId: string; text: string }
        | { op: 'setStyle'; slideId: string; elementId: string; props: Record<string, string | null> }
        | { op: 'setAttrs'; slideId: string; elementId: string; attrs: Record<string, string | null> },
    ): Promise<void>;
    presence: { show(artifactId: string, slideId: string, elementIds: string[]): Promise<void>; clear(): Promise<void> };
    order(artifactId: string): Promise<string[]>;
    files(artifactId: string): Promise<Record<string, string>>;
    slide(artifactId: string, slideId: string): Promise<SlideIR>;
    timings(artifactId: string): { surface: string; timings: { openedAt: number; syncedAt?: number; drawnAt?: number; thumbnails?: number } }[];
    frames(artifactId: string): { surface: string; received: number; held: number }[];
    editorState(artifactId: string): { surface: string; selection: string[]; editingText: string | null; keyboard: 'stage' | 'away' }[];
  };
}
type DeckSeam = Seam['__maws_presentations'];
// The cold open's bound is presentations-scale's row 1, measured there settled and calibrated (MEASURED_E2E). Here, in a
// functional group a neighbour or ci-kit's guest may run beside, its figure is printed and the bound asserted only under
// MAWS_PRESENTATIONS_PERF=1, the presentations group's switch for its measured bounds (presentations-drag.spec.ts reads
// it too), a run on purpose (gate.yml's VM contract).
const MEASURED = process.env.MAWS_PRESENTATIONS_PERF === '1';
const order = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.order(a), id);
const seed = (page: Page, id: string, files: Record<string, string>) => page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [id, files] as const);
const editDeck = (page: Page, id: string, edit: Parameters<DeckSeam['edit']>[1]) => page.evaluate(([a, e]) => (window as unknown as Seam).__maws_presentations.edit(a, e), [id, edit] as const);
const timingsOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.timings(a), id);
const editorState = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.editorState(a), id);
/** A slide of the deck as the loader reads its file now (M5's checks read the model through its files). */
const slideOf = (page: Page, id: string, slideId: string) => page.evaluate(([a, s]) => (window as unknown as Seam).__maws_presentations.slide(a!, s!), [id, slideId] as const);
// The slide IR as the seam answers it (plain data; src/artifacts/slides/ir.ts)
interface ElementIR {
  id: string;
  tag: string;
  attrs: Record<string, string>;
  style: Record<string, string>;
  children: ElementIR[];
  text?: { type: 'p' | 'li'; inline: ({ text: string; marks: Record<string, unknown> } | { br: true })[] }[];
}
interface SlideIR {
  id: string;
  attrs: Record<string, string>;
  style: Record<string, string>;
  children: ElementIR[];
  notes: string;
}
function findIn(children: ElementIR[], id: string): ElementIR | undefined {
  for (const c of children) {
    if (c.id === id) return c;
    const inner = findIn(c.children, id);
    if (inner) return inner;
  }
  return undefined;
}
async function elementOf(page: Page, id: string, slideId: string, elementId: string): Promise<ElementIR | undefined> {
  return findIn((await slideOf(page, id, slideId)).children, elementId);
}

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
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations), { message: 'the seam is installed' }).toBe('object');
  return page;
}

async function createDeck(page: Page, title: string, files: Record<string, string>): Promise<string> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title });
  await seed(page, artifact.id, files);
  return artifact.id;
}

// The deck opened from the library: its editor in an `artifact` main tab (L's registry).
async function openFromLibrary(page: Page, title: string, artifactId: string): Promise<Locator> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  return tab;
}

async function openNotes(where: Locator): Promise<Locator> {
  const disclosure = where.getByRole('button', { name: 'Speaker notes', exact: true });
  await expect(disclosure).toBeVisible();
  if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  const field = where.getByRole('textbox', { name: 'Speaker notes', exact: true });
  await expect(field).toBeVisible();
  return field;
}

// One pixel of the window, as the compositor painted it (BGRA → rgb).
async function pixel(app: ElectronApplication, x: number, y: number): Promise<[number, number, number]> {
  return app.evaluate(async ({ BrowserWindow }, at) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    const image = await win.webContents.capturePage({ x: Math.round(at.x) - 10, y: Math.round(at.y) - 10, width: 20, height: 20 });
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    const i = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [bitmap[i + 2]!, bitmap[i + 1]!, bitmap[i]!] as [number, number, number];
  }, { x, y });
}
const centre = async (locator: Locator) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
/** The centre of `word` where it is drawn in the element, read from its text node's range (it holds at any zoom). */
const wordCentre = (locator: Locator, word: string) =>
  locator.evaluate((root, w) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent!.indexOf(w);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + w.length);
      const r = range.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    throw new Error(`no text node holds ${w}`);
  }, word);

const DECK_JSON = JSON.stringify({
  v: 4,
  createdOnFiles: { v: 1, at: '2026-10-14T09:00:00Z' },
  lists: 'css',
  title: 'Q3 review',
  cover: 'cover',
  order: ['cover', 'plan', 'layer', 'quiet', 'broken', 'tokens'],
  sections: { s1: { description: 'Opening', start: 'cover' }, s2: { description: 'Detail', start: 'layer' } },
  faces: {},
  designSystems: [],
});
const FILES: Record<string, string> = {
  'project/deck.json': DECK_JSON,
  'project/slides/cover.html': `<section id="cover" style="background:var(--ds-color-bg, #ffffff); padding:128px; display:flex; flex-direction:column; justify-content:flex-end"><h1 id="title" style="font-size:96px">Q3 review</h1><p id="sub" style="font-size:40px">Where we are</p><aside>Open with the ramp time.</aside></section>`,
  'project/slides/plan.html': `<section id="plan" style="background:#fbfbf8; padding:128px; gap:32px"><h2 id="heading" style="font-size:72px">Changes</h2><ul id="list" style="font-size:36px"><li>One path</li><li>Six weeks</li></ul></section>`,
  // the band is listed after the flow card: it is pinned over the flow layer and covers the card
  'project/slides/layer.html': `<section id="layer" style="background:#ffffff; padding:128px"><p id="card" style="width:800px; height:400px; background:#0000ff; color:#ffffff; font-size:48px">Flow card</p><div id="band" style="position:absolute; left:0px; top:0px; width:1920px; height:1080px; background:#ff0000"></div></section>`,
  'project/slides/quiet.html': `<section id="quiet" hidden style="background:#ffffff; padding:128px"><h2 id="q" style="font-size:64px">Backup slide</h2></section>`,
  // a stroke width and a type role's size from the design system, with fallbacks (fix wave 1, finding 7)
  'project/slides/tokens.html': `<section id="tokens" style="background:#ffffff; padding:128px"><x-shape id="ring" kind="ellipse" style="position:absolute; left:128px; top:128px; width:400px; height:200px; background:#ffffff; border:var(--ds-line, 4px) solid #000000"></x-shape><p id="fitted" style="position:absolute; left:800px; top:128px; width:400px; height:120px; font-size:var(--ds-fit-size, 64px)">One two three four five six seven eight nine ten</p></section>`,
  'project/slides/broken.html': `<section id="broken" style="background:#ffffff"><h2 id="b" style="font-size:64px">Broken</h2><blink>not a slide element</blink></section>`,
};

test('a deck in the panel and a main tab: two replicas, the filmstrip’s gestures, notes, zoom, undo, and the under-layer painted', async () => {
  test.setTimeout(180_000);
  repo = await ScratchRepo.create({ sentinels: false });
  const page = await ready();
  const app = launch!.app;
  const id = await createDeck(page, 'Q3 review', FILES);
  expect(await order(page, id)).toEqual(['cover', 'plan', 'layer', 'quiet', 'broken', 'tokens']);

  // a chat shown, so the panel takes tools; its Artifacts tool pinned, so it stays while a main tab shows the deck
  const project = await ok<{ name: string }>(page, 'session.projects.add', { directory: repo.root });
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  const panel = page.locator('[data-region="panel"]');
  await openArtifactInPanel(page, id);
  const inPanel = panel.locator(`[data-deck-artifact="${id}"]`);
  await expect(inPanel.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole('button', { name: 'Mark up', exact: true })).toBeVisible(); // the stage is the tab's Mark-up surface
  await pinSurfaceForSessions(page, 'Artifacts');
  await panel.getByRole('button', { name: 'Move to tab' }).click();
  const inMain = page.locator(`[data-region="main"] [data-deck-artifact="${id}"]`);
  await expect(inMain.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  // Move to tab moves the deck (P3-F wave S, F16): with no session shown, the pinned tab is picked again, back on its
  // list. Opened from it again, it is the panel's replica beside the main tab's (the parent's Decision Log 8).
  await openSurface(page, 'Artifacts');
  await expect(inPanel).toHaveCount(0);
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${id}"]`).click();
  await expect(inPanel.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await expect(mainTab(page, 'Q3 review')).toHaveAttribute('aria-selected', 'true');
  const saved = inMain.locator('.deck-toolbar [data-editor-toolbar] [data-header-saved]');
  await expect(saved).toHaveText('Saved');
  await expect(saved).toHaveAttribute('title', 'All changes saved');
  // the owner's view recorded once a slide is on screen (L's onShown)
  await expect.poll(async () => (await ok<{ artifact: { lastViewedAt: number | null } }>(page, 'artifacts.get', { artifactId: id })).artifact.lastViewedAt).not.toBeNull();

  // the filmstrip: live thumbnails, the sections before their slides, a hidden and a held slide
  const thumbs = (where: Locator) => where.locator('[data-slide-thumb]');
  await expect(thumbs(inMain)).toHaveCount(6);
  await expect(thumbs(inMain).locator('.maws-slide')).toHaveCount(6);
  await expect(inMain.locator('.deck-section-title')).toHaveText(['Opening', 'Detail']);
  await expect(inMain.locator('[data-slide-thumb="quiet"]')).toHaveAttribute('data-hidden', 'true');
  await expect(inMain.locator('[data-slide-thumb="broken"]')).toHaveAttribute('data-held', '');
  // a section renamed in one replica
  await inMain.getByRole('button', { name: 'Rename section Detail' }).click();
  await inMain.getByRole('textbox', { name: 'Section name' }).fill('Details');
  await inMain.getByRole('textbox', { name: 'Section name' }).press('Enter');
  await expect(inPanel.locator('.deck-section-title')).toHaveText(['Opening', 'Details']);
  await inMain.getByRole('button', { name: 'Slide 5, held' }).click();
  await expect(inMain.locator('[data-held-banner]')).toContainText('blink');

  // an edit in one replica shows in the other: hide in the main tab, dimmed in the panel
  await inMain.getByRole('button', { name: 'Slide 2 options' }).click();
  await page.getByRole('menuitem', { name: 'Hide slide' }).click();
  await expect(inPanel.locator('[data-slide-thumb="plan"]')).toHaveAttribute('data-hidden', 'true');
  // undo and redo, one step each, followed by the other replica
  await inMain.getByRole('button', { name: 'Undo' }).click();
  await expect(inPanel.locator('[data-slide-thumb="plan"]')).not.toHaveAttribute('data-hidden');
  await inMain.getByRole('button', { name: 'Redo' }).click();
  await expect(inPanel.locator('[data-slide-thumb="plan"]')).toHaveAttribute('data-hidden', 'true');

  // notes typed in the panel reach the main tab
  await inPanel.getByRole('button', { name: 'Slide 1', exact: true }).click();
  await inMain.getByRole('button', { name: 'Slide 1', exact: true }).click();
  await expect(inPanel.getByRole('button', { name: 'Speaker notes', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(inMain.getByRole('button', { name: 'Speaker notes', exact: true })).toHaveAttribute('aria-expanded', 'false');
  const panelNotes = await openNotes(inPanel);
  await expect(panelNotes).toHaveValue('Open with the ramp time.');
  await panelNotes.click();
  await panelNotes.press('End');
  await panelNotes.pressSequentially(' Then the office.');
  await expect(inMain.locator('.deck-notes-preview')).toHaveText('Open with the ramp time. Then the office.');
  await expect(await openNotes(inMain)).toHaveValue('Open with the ramp time. Then the office.');

  // add, duplicate, delete
  await inMain.getByRole('button', { name: 'New slide' }).click();
  await expect(thumbs(inPanel)).toHaveCount(7);
  const added = (await order(page, id))[1]!;
  expect(added).toMatch(/^s[0-9a-z]+-\d+$/);
  await inMain.getByRole('button', { name: 'Slide 3 options' }).click(); // plan, hidden
  await page.getByRole('menuitem', { name: 'Duplicate slide' }).click();
  await expect(thumbs(inPanel)).toHaveCount(8);
  await inMain.getByRole('button', { name: 'Slide 2 options' }).click(); // the new blank slide
  await page.getByRole('menuitem', { name: 'Delete slide' }).click();
  await expect(thumbs(inPanel)).toHaveCount(7);
  expect(await order(page, id)).not.toContain(added);

  // reorder by the keyboard: the cover lifted, moved down one, dropped
  const before = await order(page, id);
  const cover = inMain.getByRole('button', { name: 'Slide 1', exact: true });
  const trace = await traceForeground(app, page); // P3-F (tracker row 217): a failure reports the keys, focus and frames
  await cover.focus();
  await page.keyboard.press('Space');
  const lifted = inMain.locator(`[data-slide-thumb="${before[0]}"]`);
  await expect(lifted).toHaveAttribute('data-dragging', 'true');
  // dnd-kit's keyboard sensor adds its keydown listener in a timer it queues at the lift (`setTimeout` in its `attach`).
  // A page timer queued after the lift was seen runs after it (timers of equal delay run in the order they were set),
  // so once it has run the sensor takes the one arrow. An arrow pressed before that is not the sensor's (the browser may
  // scroll the filmstrip with it, under the droppables measured at the lift), and the old press-until-it-moves loop could
  // press again after a slow first move and move the cover a second slot.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const horizontal = await inMain.locator('.deck-filmstrip').getAttribute('data-direction') === 'horizontal';
  await page.keyboard.press(horizontal ? 'ArrowRight' : 'ArrowDown');
  // dropped once the sensor has the next slide under it (its announcement says so)
  await trace.step(
    'filmstrip-reorder',
    async () => {
      await expect(lifted).toHaveAttribute('style', horizontal ? /translate3d\([1-9]/ : /translate3d\(0px, [1-9]/);
      await expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: /^Slide 1(, .*)?, moved to position 2\.$/ })).toHaveCount(1); // W1-C L283: by position, no id
    },
    () =>
      inMain.locator('.deck-filmstrip-list').evaluate((list) => ({
        list: { direction: list.closest('.deck-filmstrip')?.getAttribute('data-direction'), left: Math.round(list.getBoundingClientRect().left), top: Math.round(list.getBoundingClientRect().top), clientWidth: list.clientWidth, clientHeight: list.clientHeight, scrollLeft: list.scrollLeft, scrollTop: list.scrollTop, scrollWidth: list.scrollWidth, scrollHeight: list.scrollHeight },
        thumbs: Array.from(list.querySelectorAll<HTMLElement>('[data-slide-thumb]')).map((t) => {
          const r = t.getBoundingClientRect();
          return [t.dataset.slideThumb, Math.round(r.top), Math.round(r.height), t.style.transform, t.dataset.dragging ?? null];
        }),
        live: Array.from(document.querySelectorAll('[id^="DndLiveRegion"]')).map((n) => n.textContent),
      })),
  );
  await page.keyboard.press('Space');
  await expect.poll(() => order(page, id)).toEqual([before[1], before[0], ...before.slice(2)]);
  await expect(thumbs(inPanel).first()).toHaveAttribute('data-slide-thumb', before[1]!);
  await inMain.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => order(page, id)).toEqual(before);

  // WR #38: a held pointer gesture reorders; Undo works by click at human timing, and by keyboard.
  const pointerReorder = async () => {
    const firstThumb = (await thumbs(inMain).nth(0).boundingBox())!;
    const secondThumb = (await thumbs(inMain).nth(1).boundingBox())!;
    await drag(page, { x: firstThumb.x + firstThumb.width / 2, y: firstThumb.y + firstThumb.height / 2 }, { x: secondThumb.x + secondThumb.width / 2, y: secondThumb.y + secondThumb.height / 2 });
    await expect.poll(() => order(page, id)).toEqual([before[1], before[0], ...before.slice(2)]);
    await expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: /dropped at position 2/ })).toHaveCount(1);
  };
  await pointerReorder();
  // Deliberately model the next human click, not a zero-delay click inside dnd-kit's 50ms guard.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  await inMain.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => order(page, id)).toEqual(before);
  await pointerReorder();
  await page.keyboard.press('Meta+z');
  await expect.poll(() => order(page, id)).toEqual(before);

  // zoom: fit, then steps
  const frame = inMain.locator('[data-stage-slide]');
  const fitWidth = (await frame.boundingBox())!.width;
  expect(fitWidth).toBeLessThan(1920);
  await inMain.getByRole('combobox', { name: 'Zoom' }).selectOption('1');
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(1920);
  await inMain.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(1440);
  await inMain.getByRole('combobox', { name: 'Zoom' }).selectOption('fit');
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(Math.round(fitWidth));

  // the under-layer rule in a real paint: the band covers the card; sent back (by another replica), the card is over it
  await inMain.locator('[data-slide-thumb="layer"] .deck-thumb-button').click();
  const card = inMain.locator('[data-stage-slide="layer"] [data-eid="card"]');
  await expect(card).toBeVisible();
  const at = await centre(card);
  await expect.poll(() => pixel(app, at.x, at.y), { message: 'the band paints over the flow card' }).toEqual([255, 0, 0]);
  await editDeck(page, id, { op: 'zOrder', slideId: 'layer', elementId: 'band', to: 'back' });
  await expect(inMain.locator('[data-stage-slide="layer"] [data-eid="band"]')).toHaveAttribute('data-layer', 'under');
  await expect.poll(() => pixel(app, at.x, at.y), { message: 'the band sent back sits under the flow card' }).toEqual([0, 0, 255]);
  const slideBox = (await inMain.locator('[data-stage-slide="layer"]').boundingBox())!;
  expect(await pixel(app, slideBox.x + slideBox.width * 0.85, slideBox.y + slideBox.height * 0.85)).toEqual([255, 0, 0]); // the band still paints the slide around the card

  // the design system's tokens re-lay the canvas (fix wave 1, finding 7): a stroke width token and a type role's size,
  // changed through the deck's overrides, redraw the outline at the new width and re-fit the text
  await inMain.locator('[data-slide-thumb="tokens"] .deck-thumb-button').click();
  const ring = inMain.locator('[data-stage-slide="tokens"] [data-eid="ring"] svg path');
  const fitted = inMain.locator('[data-stage-slide="tokens"] [data-eid="fitted"]');
  await expect(ring).toHaveCSS('stroke-width', '4px');
  const shrunk = Number.parseFloat(await fitted.evaluate((n) => getComputedStyle(n).fontSize));
  expect(shrunk).toBeLessThan(64); // 64 px does not fit the box: shrunk
  await editDeck(page, id, { op: 'setOverride', name: '--ds-line', value: '8px' });
  await expect(ring).toHaveCSS('stroke-width', '8px');
  await editDeck(page, id, { op: 'setOverride', name: '--ds-fit-size', value: '24px' });
  await expect.poll(() => fitted.evaluate((n) => getComputedStyle(n).fontSize)).toBe('24px'); // fits at the role's new size
  await editDeck(page, id, { op: 'setOverride', name: '--ds-line', value: null });
  await expect(ring).toHaveCSS('stroke-width', '4px');

  expect(launch!.consoleErrors()).toEqual([]);
});

// P3-F wave S, F3 (docs/doperpowers/plans/2026-10-18-p3-f-finish.md, Wave S triage c37, c40, obs 9): in the narrowest
// panel the toolbar wraps onto more rows by whole controls: no button narrower than its label, none wrapping it a letter
// a line, none over another, the zoom select whole, every control inside the panel; with nothing selected (the owner's
// view: Text style, Comments) and with a heading selected (its role in Text style).
test('a deck in the panel at its 280 px minimum: the toolbar wraps by whole controls, none squeezed, wrapped inside or overlapping', async () => {
  test.setTimeout(120_000);
  repo = await ScratchRepo.create({ sentinels: false });
  const page = await ready();
  const id = await createDeck(page, 'Q3 review', FILES);
  const project = await ok<{ name: string }>(page, 'session.projects.add', { directory: repo.root });
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  const panel = page.locator('[data-region="panel"]');
  await openArtifactInPanel(page, id);
  const inPanel = panel.locator(`[data-deck-artifact="${id}"]`);
  await expect(inPanel.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await resizePanel(page, 280);
  const toolbar = inPanel.getByRole('toolbar', { name: 'Deck' });
  await expect(toolbar.getByRole('button', { name: 'Text style', exact: true })).toBeVisible();
  const identity = toolbar.locator('[data-header-title]');
  await expect(identity).toHaveText('Q3 review');
  for (const label of ['Present', 'Deck actions', 'Float conversation over surface', 'Expand surface', 'Close surface']) {
    await expect(toolbar.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  const titleBox = (await identity.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(titleBox.width).toBeGreaterThan(0);
  expect(titleBox.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);

  await test.info().attach('deck-panel-280', { body: await panel.screenshot(), contentType: 'image/png' });
  expect(await squeezedControls(toolbar, { within: panel }), 'nothing selected').toEqual([]);
  expect((await toolbar.boundingBox())!.height, 'the row wrapped').toBeGreaterThan(36);

  const title = (await inPanel.locator('[data-stage-slide="cover"] [data-eid="title"]').boundingBox())!;
  await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2);
  await expect(inPanel.locator('[data-overlay] [data-selected="title"]')).toHaveCount(1);
  await test.info().attach('deck-panel-280-selected', { body: await panel.screenshot(), contentType: 'image/png' });
  expect(await squeezedControls(toolbar, { within: panel }), 'a heading selected').toEqual([]);

  // Leave F6 to the portable editor for this isolated profile instead of the shell's default region shortcuts.
  await ok(page, 'settings.set', { keymap: { 'region.focusNext': null, 'region.focusPrevious': null } });
  const hostAction = toolbar.getByRole('button', { name: 'Present', exact: true });
  await hostAction.focus();
  await expect(hostAction).toBeFocused();
  await page.keyboard.press('F6');
  await expect(inPanel.locator('.deck-filmstrip [data-current] .deck-thumb-button')).toBeFocused();
  await page.keyboard.press('Shift+F6');
  await expect(hostAction).toBeFocused();

  expect(launch!.consoleErrors()).toEqual([]);
});

test('the scale gate’s open: a 100-slide deck cold in a main tab, stage and 100 live thumbnails drawn within 1,000 ms', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const id = await createDeck(page, 'Bench', benchDeckFiles(100));
  const tab = await openFromLibrary(page, 'Bench', id);
  await expect(tab.locator('[data-slide-thumb] .maws-slide')).toHaveCount(100);
  let timings: { openedAt: number; syncedAt?: number; drawnAt?: number; thumbnails?: number } | undefined;
  await expect
    .poll(async () => {
      timings = (await timingsOf(page, id)).find((t) => t.timings.drawnAt !== undefined)?.timings;
      return timings !== undefined;
    }, { message: 'the open is drawn' })
    .toBe(true);
  const open = timings!.drawnAt! - timings!.openedAt;
  console.log(`[deck scale] cold open to stage and ${timings!.thumbnails} thumbnails drawn: ${open.toFixed(1)} ms (synced at ${(timings!.syncedAt! - timings!.openedAt).toFixed(1)} ms; load ${loadavg()[0]!.toFixed(1)})`);
  expect(timings!.thumbnails).toBe(100);
  if (MEASURED) expect(open).toBeLessThanOrEqual(1_000);
  expect(launch!.consoleErrors()).toEqual([]);
});

// ---- M5: the transform layer ----------------------------------------------------------------------------------------

const LAB_JSON = JSON.stringify({ v: 4, title: 'Layout lab', cover: 'lab', order: ['lab', 'text', 'xf'] });
const LAB: Record<string, string> = {
  'project/deck.json': LAB_JSON,
  'project/slides/lab.html': `<section id="lab" style="background:#ffffff; padding:128px; display:flex; flex-direction:column; gap:32px">
<h2 id="head" style="font-size:64px">Heading</h2>
<p id="para" style="font-size:32px; width:800px">Paragraph</p>
<div id="a" style="position:absolute; left:300px; top:500px; width:200px; height:120px; background:#ff0000"></div>
<div id="b" style="position:absolute; left:700px; top:500px; width:200px; height:120px; background:#00aa00"></div>
<x-shape id="c" kind="ellipse" style="position:absolute; left:1300px; top:640px; width:200px; height:200px; background:#0000ff"></x-shape>
</section>`,
  // P3-F F9: a heading inside a group (c43: the owner's head group); P4-B2 (D12): a table whose cells a double-click edits
  'project/slides/text.html': `<section id="text" style="background:#ffffff; padding:128px"><p id="note" style="position:absolute; left:300px; top:300px; width:1000px; font-size:48px">Edit me</p><div id="hg" data-group="" style="position:absolute; left:300px; top:600px; width:1000px; height:200px"><h2 id="gh" style="position:absolute; left:0px; top:0px; width:1000px; font-size:64px">Grouped heading</h2></div><table id="tb" style="position:absolute; left:1400px; top:300px; width:400px; font-size:32px"><tr id="tr1"><td>Aa</td><td>Bb</td></tr><tr id="tr2"><td>Cc</td><td>Dd</td></tr></table></section>`,
  // fix wave 1: an element drawn scaled, and a group drawn turned (its children measured as drawn)
  'project/slides/xf.html': `<section id="xf" style="background:#ffffff">
<div id="sc" style="position:absolute; left:300px; top:300px; width:200px; height:100px; transform:scale(2); background:#ff00ff"></div>
<div id="tk" style="position:absolute; left:1500px; top:700px; width:150px; height:100px; transform:var(--ds-pose, scale(1.5)); background:#00aaaa"></div>
<div id="g" data-group="" style="position:absolute; left:1000px; top:300px; width:400px; height:100px; transform:rotate(90deg)"><div id="k1" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background:#00aa00"></div><div id="k2" style="position:absolute; left:300px; top:0px; width:100px; height:100px; background:#0000aa"></div></div>
</section>`,
};

/** The stage's frame and the screen point of a slide px on it. */
async function stageAt(tab: Locator) {
  const frame = (await tab.locator('[data-stage-slide]').boundingBox())!;
  const scale = frame.width / 1920;
  return { scale, at: (x: number, y: number) => ({ x: frame.x + x * scale, y: frame.y + y * scale }) };
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, options: { steps?: number; during?: () => Promise<void> } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = options.steps ?? 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await options.during?.();
  await page.mouse.up();
}
const selected = (tab: Locator) => tab.locator('[data-overlay] [data-selected]');
const px = (v: string | undefined) => Number.parseFloat(v ?? 'NaN');

test('WR #35: first movement preserves a real SVG and flow-only-styled siblings inside a transformed flow container', async () => {
  const page = await ready();
  const id = await createDeck(page, 'SVG placement', {
    'project/deck.json': JSON.stringify({ v: 4, title: 'SVG placement', cover: 'svg', order: ['svg'] }),
    'project/slides/svg.html': `<section id="svg" style="background:#ffffff;padding:100px;gap:32px">
<div id="group" style="width:600px;height:400px;gap:32px;transform:translate(40px, 30px) rotate(90deg)">
<svg id="drawing" viewBox="0 0 100 50" style="width:200px;height:100px;transform:translate(10px, 20px)"><rect width="100" height="50" fill="#2b7a78"/></svg>
<p id="caption" style="font-size:32px;flex:1;align-self:center;min-width:120px;max-width:500px">A stationary caption</p></div>
<div id="target" style="position:absolute;left:1300px;top:600px;width:200px;height:100px;background:#ee7733"></div></section>`,
  });
  const tab = await openFromLibrary(page, 'SVG placement', id);
  const node = (eid: string) => tab.locator(`[data-stage-slide="svg"] [data-eid="${eid}"]`);
  await expect(node('drawing')).toBeVisible();
  expect(await node('drawing').evaluate((el) => el instanceof SVGSVGElement && !('offsetWidth' in el))).toBe(true);
  const target = (await node('target').boundingBox())!;
  const start = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  await page.mouse.click(start.x, start.y);
  await expect(tab.locator('[data-overlay] [data-selected="target"]')).toBeVisible();
  const stationary = ['group', 'drawing', 'caption'];
  const before = await Promise.all(stationary.map((eid) => node(eid).boundingBox()));
  const { scale } = await stageAt(tab);
  await page.keyboard.down('Meta');
  await drag(page, start, { x: start.x + 60 * scale, y: start.y + 40 * scale });
  await page.keyboard.up('Meta');
  await expect.poll(async () => (await elementOf(page, id, 'svg', 'target'))?.style.left).toBe('1360px');
  expect((await elementOf(page, id, 'svg', 'target'))?.style.top).toBe('640px');
  for (const [i, eid] of stationary.entries()) {
    await expect(node(eid)).toHaveCSS('position', 'absolute');
    const after = (await node(eid).boundingBox())!;
    // HTML layout offsets round to slide px before pinning; their error at this fitted zoom stays below one screen px.
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after[key] - before[i]![key]), `${eid}: ${key}`).toBeLessThan(1);
  }
  const afterTarget = (await node('target').boundingBox())!;
  expect(afterTarget.x - target.x).toBeCloseTo(60 * scale, 1);
  expect(afterTarget.y - target.y).toBeCloseTo(40 * scale, 1);
  const caption = (await elementOf(page, id, 'svg', 'caption'))!;
  expect(['flex', 'align-self', 'min-width', 'max-width'].filter((key) => caption.style[key] !== undefined)).toEqual([]);
  expect((await elementOf(page, id, 'svg', 'group'))?.style.transform).toBe('translate(40px, 30px) rotate(90deg)');
  expect(launch!.consoleErrors()).toEqual([]);
});

test('the transform layer: select, move with guides, resize, rotate, nudge, flow re-order and Detach, z-order, group, duplicate and delete', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const id = await createDeck(page, 'Layout lab', LAB);
  const tab = await openFromLibrary(page, 'Layout lab', id);
  const { at, scale } = await stageAt(tab);
  const element = (eid: string) => elementOf(page, id, 'lab', eid);

  // select: a click, a shift-click, a marquee, a click on nothing
  await page.mouse.click(at(400, 560).x, at(400, 560).y);
  await expect(selected(tab)).toHaveCount(1);
  await expect(tab.locator('[data-overlay] [data-selected="a"]')).toBeVisible();
  await page.keyboard.down('Shift');
  await page.mouse.click(at(800, 560).x, at(800, 560).y);
  await page.keyboard.up('Shift');
  await expect(selected(tab)).toHaveCount(2);
  await drag(page, at(140, 1000), at(1450, 560));
  await expect.poll(async () => (await selected(tab).evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.selected).sort())).join()).toBe('a,b,c');
  await page.mouse.click(at(1800, 1000).x, at(1800, 1000).y);
  await expect(selected(tab)).toHaveCount(0);

  // move with guides: a's left edge brought near the 128 px margin snaps to it, a guide drawn while it does
  const start = at(400, 560);
  await drag(page, start, { x: start.x - 169 * scale, y: start.y }, { during: async () => await expect(tab.locator('[data-overlay] .deck-guide').first()).toBeVisible() });
  await expect.poll(async () => (await element('a'))?.style.left).toBe('128px');
  expect((await element('a'))?.style.top).toBe('500px');
  // one undo step for the whole drag
  await tab.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await element('a'))?.style.left).toBe('300px');

  // resize with the aspect kept (Shift on the bottom-right handle)
  await page.mouse.click(at(400, 560).x, at(400, 560).y);
  const handle = tab.locator('[data-overlay] [data-handle="se"]');
  const hb = (await handle.boundingBox())!;
  await page.keyboard.down('Shift');
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2 + 100 * scale, y: hb.y + hb.height / 2 });
  await page.keyboard.up('Shift');
  await expect.poll(async () => px((await element('a'))?.style.width)).toBeGreaterThan(250);
  const resized = (await element('a'))!.style;
  expect(px(resized.width) / px(resized.height)).toBeCloseTo(200 / 120, 1);
  expect(resized.left).toBe('300px');

  // rotate the ellipse by its handle, Shift by 15°
  await page.mouse.click(at(1400, 740).x, at(1400, 740).y);
  const rot = (await tab.locator('[data-overlay] [data-handle="rotate"]').boundingBox())!;
  await page.keyboard.down('Shift');
  await drag(page, { x: rot.x + rot.width / 2, y: rot.y + rot.height / 2 }, at(1700, 745));
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await element('c'))?.style.transform).toBe('rotate(90deg)');

  // nudge: 1 px, then 10 with Shift
  await page.mouse.click(at(800, 560).x, at(800, 560).y);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => [(await element('b'))?.style.left, (await element('b'))?.style.top]).toEqual(['701px', '510px']);

  // WR #35: the first move already fixed the structured elements. A later drag moves only its target.
  const head = (await tab.locator('[data-stage-slide] [data-eid="head"]').boundingBox())!;
  const para = (await tab.locator('[data-stage-slide] [data-eid="para"]').boundingBox())!;
  await page.mouse.click(head.x + 40, head.y + head.height / 2);
  await drag(page, { x: head.x + 40, y: head.y + head.height / 2 }, { x: head.x + 40 + 60 * scale, y: head.y + head.height / 2 + 40 * scale });
  await expect.poll(async () => (await element('head'))?.style.position).toBe('absolute');
  const paraNow = (await tab.locator('[data-stage-slide] [data-eid="para"]').boundingBox())!;
  expect(paraNow.x).toBeCloseTo(para.x, 0);
  expect(paraNow.y).toBeCloseTo(para.y, 0);
  await expect((await openArrange(page, tab)).getByRole('menuitem', { name: 'Detach', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');

  // z-order: a sent to back sits under the flow layer (listed before the first flow child)
  await page.mouse.click(at(310, 510).x, at(310, 510).y);
  await (await openArrange(page, tab)).getByRole('menuitem', { name: 'Send to back', exact: true }).click();
  await expect.poll(async () => (await slideOf(page, id, 'lab')).children[0]!.id).toBe('a');

  // group a and b (⌘G), then ungroup (⇧⌘G)
  await page.mouse.click(at(310, 510).x, at(310, 510).y);
  await page.keyboard.down('Shift');
  await page.mouse.click(at(800, 560).x, at(800, 560).y);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Meta+g');
  await expect.poll(async () => (await slideOf(page, id, 'lab')).children.find((c) => c.attrs['data-group'] !== undefined)?.children.map((c) => c.id)).toEqual(['a', 'b']);
  await page.keyboard.press('Meta+Shift+g');
  await expect.poll(async () => (await slideOf(page, id, 'lab')).children.some((c) => c.attrs['data-group'] !== undefined)).toBe(false);
  expect((await element('b'))?.style.left).toBe('701px'); // its place kept through both

  // duplicate (⌘D) and delete
  await page.mouse.click(at(1400, 740).x, at(1400, 740).y);
  await page.keyboard.press('Meta+d');
  await expect.poll(async () => (await slideOf(page, id, 'lab')).children.filter((c) => c.tag === 'x-shape').length).toBe(2);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await slideOf(page, id, 'lab')).children.filter((c) => c.tag === 'x-shape').length).toBe(1);

  // fix wave 1: transforms measured as drawn. A scaled element is picked where it is painted, its handles sit on its
  // painted corners, and a resize keeps its painted top-left where it was
  await tab.locator('[data-slide-thumb="xf"] .deck-thumb-button').click();
  const xf = await stageAt(tab);
  const painted = (eid: string) => tab.locator(`[data-stage-slide="xf"] [data-eid="${eid}"]`).boundingBox().then((b) => b!);
  await page.mouse.click(xf.at(220, 270).x, xf.at(220, 270).y); // inside the painted box (200..600), outside its layout (300..500)
  await expect(tab.locator('[data-overlay] [data-selected="sc"]')).toBeVisible();
  const before = await painted('sc');
  const se = (await tab.locator('[data-overlay] [data-handle="se"]').boundingBox())!;
  expect(Math.abs(se.x + se.width / 2 - (before.x + before.width))).toBeLessThan(2);
  expect(Math.abs(se.y + se.height / 2 - (before.y + before.height))).toBeLessThan(2);
  await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x + se.width / 2 + 40, y: se.y + se.height / 2 + 20 }, { during: async () => {} });
  const after = await painted('sc');
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  expect(after.width - before.width).toBeGreaterThan(30);
  // a turned group: picked where its children are painted; ungrouped, each child stays where it was painted
  const k1 = await painted('k1');
  const k2 = await painted('k2');
  await page.mouse.click(k1.x + k1.width / 2, k1.y + k1.height / 2);
  await expect(tab.locator('[data-overlay] [data-selected="g"]')).toBeVisible();
  await page.keyboard.press('Meta+Shift+g');
  await expect.poll(async () => (await slideOf(page, id, 'xf')).children.some((c) => c.id === 'g')).toBe(false);
  for (const [eid, was] of [['k1', k1], ['k2', k2]] as const) {
    const now = await painted(eid);
    expect([Math.round(now.x - was.x), Math.round(now.y - was.y), Math.round(now.width - was.width), Math.round(now.height - was.height)]).toEqual([0, 0, 0, 0]);
  }
  expect((await elementOf(page, id, 'xf', 'k1'))?.style.transform).toBe('rotate(90deg)');
  // fix wave 3: a transform that is a design-system token is not rotated beside: the handle says why, nothing is written
  const tk = await painted('tk');
  await page.mouse.click(tk.x + tk.width / 2, tk.y + tk.height / 2);
  const tkRot = (await tab.locator('[data-overlay] [data-handle="rotate"]').boundingBox())!;
  await drag(page, { x: tkRot.x + tkRot.width / 2, y: tkRot.y + tkRot.height / 2 }, { x: tkRot.x + 120, y: tkRot.y + 80 });
  await expect(tab.locator('[data-deck-notice]')).toContainText('design-system token');
  // P3-F F3 review 4: the notice takes the row's free space beside the spacer, not half of it, and is never narrower
  // than its readable floor (12rem, or the row's width when that is less), so a refusal never reads as an ellipsis
  const split = await tab.getByRole('toolbar', { name: 'Deck' }).evaluate((bar) => {
    const width = (sel: string) => bar.querySelector(`:scope > ${sel}`)!.getBoundingClientRect().width;
    const style = getComputedStyle(bar);
    const inner = bar.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    return { notice: width('.deck-notice'), spacer: width('.deck-toolbar-spacer'), floor: Math.min(12 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize), inner) };
  });
  expect(split.spacer, `the spacer leaves the row's free space to the notice (${JSON.stringify(split)})`).toBeLessThanOrEqual(2);
  expect(split.notice, `the notice at its readable floor or wider (${JSON.stringify(split)})`).toBeGreaterThanOrEqual(split.floor - 1);
  expect((await elementOf(page, id, 'xf', 'tk'))?.style.transform).toBe('var(--ds-pose, scale(1.5))');
  // another replica's selection, outlined in its colour with its name
  await page.evaluate(([a]) => (window as unknown as Seam).__maws_presentations.presence.show(a!, 'xf', ['sc']), [id] as const);
  await expect(tab.locator('[data-overlay] [data-remote-selected="sc"]')).toHaveCount(1);
  await expect(tab.locator('[data-overlay] .deck-remote-name')).toHaveText('Claude');
  await page.evaluate(() => (window as unknown as Seam).__maws_presentations.presence.clear());
  await expect(tab.locator('[data-overlay] [data-remote-selected]')).toHaveCount(0);

  expect(launch!.consoleErrors()).toEqual([]);
});

// P4-B2 K6 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D10; finding 1 of spikes/p4-click-model): the Edit
// menu's Undo and Redo reach the deck's stack while the stage holds the focus, and stay the field's own native undo in
// the inspector. Clicked by id in main as the native menu calls them: Playwright's keys carry no native key code, so they
// never reach Electron's menu (finding 2).
test('Edit ▸ Undo and Redo: the deck’s step on the stage, the field’s own typing in the inspector', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const app = launch!.app;
  const id = await createDeck(page, 'Layout lab', LAB);
  const tab = await openFromLibrary(page, 'Layout lab', id);
  const { at } = await stageAt(tab);
  const element = (eid: string) => elementOf(page, id, 'lab', eid);
  const fromMenu = async (item: 'edit.undo' | 'edit.redo') =>
    expect(await app.evaluate(({ Menu }, menuId) => {
      const found = Menu.getApplicationMenu()?.getMenuItemById(menuId);
      found?.click();
      return found != null;
    }, item), `the menu has ${item}`).toBe(true);

  // a nudge on the stage, taken back and done again from the menu
  await page.mouse.click(at(800, 560).x, at(800, 560).y);
  await expect(tab.locator('[data-overlay] [data-selected="b"]')).toBeVisible();
  await expect(tab.locator('[data-stage-slide] [data-eid="b"]')).toBeFocused(); // D15's A3: the element's own node, the stage's
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await element('b'))?.style.left).toBe('701px');
  await fromMenu('edit.undo');
  await expect.poll(async () => (await element('b'))?.style.left).toBe('700px');
  await fromMenu('edit.redo');
  await expect.poll(async () => (await element('b'))?.style.left).toBe('701px');

  // typed into the inspector's Width field, the menu's Undo takes back the typing, not the deck's nudge
  await tab.getByRole('toolbar', { name: 'Deck', exact: true }).getByRole('button', { name: 'Inspector', exact: true }).click();
  const width = tab.getByRole('complementary', { name: 'Inspector' }).getByRole('textbox', { name: 'Width', exact: true });
  await expect(width).toHaveValue('200');
  await width.click();
  await width.selectText();
  await page.keyboard.type('999');
  await expect(width).toHaveValue('999');
  await fromMenu('edit.undo');
  await expect(width).toHaveValue('200');
  expect((await element('b'))?.style).toMatchObject({ left: '701px', width: '200px' });

  expect(launch!.consoleErrors()).toEqual([]);
});

// ---- M5: the inspector, Insert, text in place, the clipboard ---------------------------------------------------------

// a 4 × 1 picture: two red pixels, then two blue (fix wave 1's crop)
const STRIPE_4X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAEElEQVR4nGP4z8AARGDiPwAZ8wP9mthzMQAAAABJRU5ErkJggg==', 'base64');
// fix wave 2: an SVG mark, which a store copy carries byte for byte (a pixel copy would make it a PNG)
const MARK_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 4 2"><rect width="4" height="2" fill="#c9663f"/></svg>');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SECOND: Record<string, string> = {
  'project/deck.json': JSON.stringify({ v: 4, title: 'Second deck', cover: 'one', order: ['one'] }),
  'project/slides/one.html': `<section id="one" style="background:#ffffff; padding:128px"><h2 id="t2" style="font-size:64px">Second</h2></section>`,
};
const plain = (e: ElementIR | undefined) => (e?.text ?? []).map((b) => b.inline.map((r) => ('text' in r ? r.text : '\n')).join('')).join('\n');

test('the inspector restyles, Insert makes each kind, text is edited in place through a Korean composition, and elements copy across decks', async () => {
  test.setTimeout(240_000);
  const page = await ready();
  const app = launch!.app;
  const id = await createDeck(page, 'Inspector lab', LAB);
  const other = await createDeck(page, 'Second deck', SECOND);
  const tab = await openFromLibrary(page, 'Inspector lab', id);
  const element = (eid: string, slide = 'lab') => elementOf(page, id, slide, eid);
  await tab.getByRole('toolbar', { name: 'Deck', exact: true }).getByRole('button', { name: 'Inspector', exact: true }).click();
  const inspector = tab.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector).toBeVisible();

  // Opening the card refits the stage. Select the box at its current rendered position, not cached slide coordinates.
  await tab.locator('[data-stage-slide="lab"] [data-eid="a"]').click();
  await expect(tab.locator('[data-overlay] [data-selected="a"]')).toBeVisible();
  await expect(inspector.getByRole('textbox', { name: 'Fill colour' })).toHaveValue('#ff0000');
  // the inspector: a fill, a border, a font size, the text's fit
  await inspector.getByRole('textbox', { name: 'Fill colour' }).fill('rgb(0, 0, 255)');
  await inspector.getByRole('textbox', { name: 'Fill colour' }).press('Enter');
  await expect.poll(async () => (await element('a'))?.style.background).toBe('#0000ff');
  await inspector.getByRole('textbox', { name: 'Border width' }).fill('4');
  await inspector.getByRole('textbox', { name: 'Border width' }).press('Enter');
  await expect.poll(async () => (await element('a'))?.style.border).toMatch(/^4px solid /);
  const head = (await tab.locator('[data-stage-slide] [data-eid="head"]').boundingBox())!;
  await page.mouse.click(head.x + 30, head.y + head.height / 2);
  await inspector.getByRole('textbox', { name: 'Font size' }).fill('72');
  await inspector.getByRole('textbox', { name: 'Font size' }).press('Enter');
  await expect.poll(async () => (await element('head'))?.style['font-size']).toBe('72px');
  await inspector.getByRole('combobox', { name: 'Text fit' }).selectOption('shrink');
  await expect.poll(async () => (await element('head'))?.attrs['data-fit']).toBe('shrink');
  // a value the dialect refuses is shown and writes nothing
  await inspector.getByRole('textbox', { name: 'Font size' }).fill('900');
  await inspector.getByRole('textbox', { name: 'Font size' }).press('Enter');
  await expect(inspector.getByRole('alert')).toBeVisible();
  expect((await element('head'))?.style['font-size']).toBe('72px');
  await tab.getByRole('button', { name: 'Close inspector', exact: true }).click();

  // Insert: each kind lands on the slide through the loader; a text kind opens for typing
  const insert = async (item: string, sub?: string) => {
    await tab.getByRole('button', { name: 'Insert', exact: true }).click();
    if (sub) await page.getByRole('menuitem', { name: sub }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };
  const tags = async () => (await slideOf(page, id, 'lab')).children.map((c) => c.tag);
  await insert('Text box');
  await expect(tab.locator('.deck-textbox')).toBeFocused();
  await page.keyboard.press('Escape'); // T17: the new text box ARMED, selected
  await expect(tab.locator('[data-stage-surface][data-armed]')).toHaveCount(1);
  for (const item of ['Heading', 'Bulleted list', 'Numbered list']) {
    await insert(item);
    await expect(tab.locator('.deck-textbox')).toBeFocused();
    await page.keyboard.press('Escape');
  }
  await insert('Ellipse', 'Shape ›');
  await insert('Star', 'Icon ›');
  await insert('2 × 2 table', 'Table ›');
  await insert('Line');
  await insert('Connector');
  await tab.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Image…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await tab.locator('[data-insert-image]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect.poll(async () => (await tags()).filter((t) => t === 'img').length).toBe(1);
  const made = await tags();
  for (const tag of ['h2', 'ul', 'ol', 'x-shape', 'x-icon', 'table', 'x-connector', 'img']) expect(made, tag).toContain(tag);
  expect(made.filter((t) => t === 'p').length).toBe(2); // the paragraph and the new text box
  expect(made.filter((t) => t === 'x-connector').length).toBe(2); // the line and the connector
  expect((await slideOf(page, id, 'lab')).children.find((c) => c.tag === 'img')?.attrs.src).toMatch(/^assets\/pixel/);

  // fix wave 1: a crop's focus places the picture: a 4 × 1 stripe (red, then blue) in a square box, covered, shows its
  // red end with the focus at 0 % and its blue end at 100 %, at zoom 1
  await tab.locator('[data-insert-image]').setInputFiles({ name: 'stripe.png', mimeType: 'image/png', buffer: STRIPE_4X1 });
  await expect.poll(async () => (await slideOf(page, id, 'lab')).children.filter((c) => c.tag === 'img').length).toBe(2);
  const stripe = (await slideOf(page, id, 'lab')).children.find((c) => c.tag === 'img' && c.attrs.src?.startsWith('assets/stripe'))!;
  await editDeck(page, id, { op: 'setStyle', slideId: 'lab', elementId: stripe.id, props: { left: '1500px', top: '700px', width: '300px', height: '300px' } }); // clear of the heading the clipboard step picks
  const pic = tab.locator(`[data-stage-slide="lab"] [data-eid="${stripe.id}"]`);
  for (const [focus, rgb] of [
    ['0%', [255, 0, 0]],
    ['100%', [0, 0, 255]],
  ] as const) {
    await editDeck(page, id, { op: 'setAttrs', slideId: 'lab', elementId: stripe.id, attrs: { 'data-crop': `1 ${focus} 50%` } });
    await expect.poll(async () => pixel(app, ...((b) => [b.x + b.width / 2, b.y + b.height / 2] as const)((await pic.boundingBox())!)), { message: `the crop's focus at ${focus}` }).toEqual(rgb);
  }

  // text in place: typed, a word made bold, then a Korean composition while another replica edits the same box
  await tab.locator('[data-slide-thumb="text"] .deck-thumb-button').click();
  const note = (await tab.locator('[data-stage-slide="text"] [data-eid="note"]').boundingBox())!;
  const box = tab.locator('.deck-textbox');
  // P4-B2 (T1, T10; F9's c43, obs 5a): a first click selects the element ARMED, its box focused with the caret hidden,
  // and words typed replace its text
  await page.mouse.click(note.x + 40, note.y + note.height / 2);
  await expect(tab.locator('[data-overlay] [data-selected="note"]')).toHaveCount(1);
  await expect(box).toBeFocused();
  await expect(tab.locator('[data-stage-surface][data-armed]')).toHaveCount(1);
  await page.keyboard.type('Hi there');
  await expect.poll(async () => plain(await element('note', 'text'))).toBe('Hi there');
  await page.keyboard.press('Escape'); // T17: ARMED again, the same box, the element selected
  await expect(tab.locator('[data-stage-surface][data-armed]')).toHaveCount(1);
  await expect(tab.locator('[data-overlay] [data-selected="note"]')).toHaveCount(1);
  await expect(box).toBeFocused();
  await page.keyboard.press('Enter'); // T12: the edit with everything selected
  await expect.poll(async () => (await editorState(page, id))[0]?.editingText).toBe('note');
  await page.keyboard.type('Hello world');
  // the word picked by a double-click on it (the text box's own: the stage leaves it alone)
  const word = await box.evaluate((root) => {
    const text = Array.from(root.querySelectorAll('p'))
      .flatMap((p) => Array.from(p.childNodes))
      .find((n) => n.textContent?.includes('world'))!;
    const range = document.createRange();
    const at = text.textContent!.indexOf('world');
    range.setStart(text, at);
    range.setEnd(text, at + 5);
    const r = range.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.dblclick(word.x, word.y);
  // ProseMirror takes a mouse selection a moment after the browser draws it: ⌘B once the editor holds it (Tiptap's root
  // carries its editor)
  type WithEditor = { editor: { state: { selection: { from: number; to: number } } } };
  await expect.poll(() => box.evaluate((n) => (n as unknown as WithEditor).editor.state.selection.to - (n as unknown as WithEditor).editor.state.selection.from)).toBe(5);
  await page.keyboard.press('Meta+b');
  await expect.poll(async () => (await element('note', 'text'))?.text?.[0]?.inline).toEqual([
    { text: 'Hello ', marks: {} },
    { text: 'world', marks: { b: {} } },
  ]);
  await page.keyboard.press('End');
  const cdp = await page.context().newCDPSession(page);
  const compose = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  await compose('ㅎ');
  await compose('하');
  await compose('한');
  await editDeck(page, id, { op: 'prependText', slideId: 'text', elementId: 'note', text: 'Remote ' }); // lands while composing
  // P4-B2 (tracker row 256, closing P3-F's editor-proof scalpel-1#4): the tab's replica holds the remote frame before the
  // negative check below, read from its provider, so a hold that regressed fails here rather than passing a fixed wait
  await expect.poll(async () => (await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.frames(a), id))[0]?.held ?? 0).toBeGreaterThan(0);
  await expect(box).not.toContainText('Remote'); // held by the replica until the composition ends (the hold)
  await compose('한ㄱ');
  await compose('한그');
  await compose('한글');
  await cdp.send('Input.insertText', { text: '한글' });
  await expect.poll(async () => plain(await element('note', 'text'))).toBe('Remote Hello world한글');
  await expect(box).toHaveText('Remote Hello world한글');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await editorState(page, id))[0]?.editingText).toBeNull();
  await page.keyboard.press('Escape'); // from ARMED: nothing selected, the box gone
  await expect(box).toHaveCount(0);
  await expect(tab.locator('[data-stage-slide="text"] [data-eid="note"]')).toHaveText('Remote Hello world한글');

  // P4-B2 (T5, D12; F9's c43): the owner's grouped heading, from nothing selected: one double-click edits it with the word
  // under the pointer selected, whatever the scope, and the words typed replace it (its text one word less: the rest kept).
  // Aimed at the word's own text: at the default chrome the slide draws about 256 px wide, "Grouped" some 33 px of it
  const heading = tab.locator('[data-stage-slide="text"] [data-eid="gh"]');
  const grouped = (await heading.boundingBox())!;
  const groupedWord = await wordCentre(heading, 'Grouped');
  await page.mouse.dblclick(groupedWord.x, groupedWord.y);
  await expect(tab.locator('[data-overlay] [data-selected="gh"]')).toHaveCount(1);
  await expect.poll(async () => (await editorState(page, id))[0]?.editingText).toBe('gh');
  await expect(box).toBeFocused();
  await page.keyboard.type('Owners');
  await expect.poll(async () => plain(await element('gh', 'text'))).toBe('Owners heading');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); // ARMED, then the group (T18)
  await expect(tab.locator('[data-overlay] [data-selected="hg"]')).toHaveCount(1);
  await expect(box).toHaveCount(0);

  // P4-B2 (P7, D12): single clicks on the grouped heading: the group, then the heading ARMED, then a caret; a drag of
  // the group's first click moves the group
  await page.keyboard.press('Escape'); // from the group: nothing selected
  await expect(tab.locator('[data-overlay] [data-selected]')).toHaveCount(0);
  const groupLeft = async () => (await element('hg', 'text'))?.style.left;
  await page.mouse.click(grouped.x + 40, grouped.y + grouped.height / 2);
  await expect(tab.locator('[data-overlay] [data-selected="hg"]')).toHaveCount(1);
  await page.mouse.move(grouped.x + 40, grouped.y + grouped.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(grouped.x + 40 + i * 4, grouped.y + grouped.height / 2, { steps: 1 });
  await page.mouse.up();
  await expect.poll(groupLeft).not.toBe('300px');
  const movedGroup = (await tab.locator('[data-stage-slide="text"] [data-eid="gh"]').boundingBox())!;
  await page.mouse.click(movedGroup.x + 40, movedGroup.y + movedGroup.height / 2);
  await expect(tab.locator('[data-overlay] [data-selected="gh"]')).toHaveCount(1);
  await expect.poll(async () => (await editorState(page, id))[0]).toEqual(expect.objectContaining({ selection: ['gh'], editingText: null }));
  await expect(box).toBeFocused();
  await page.mouse.click(movedGroup.x + 40, movedGroup.y + movedGroup.height / 2);
  await expect.poll(async () => (await editorState(page, id))[0]?.editingText).toBe('gh');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);

  // P4-B2 (T5 and T16, D12; P6 and K5): a table's cell edited in one double-click from nothing selected, its word
  // selected (aimed at the cell's word "Aa", a few px wide at this scale); Tab to the next cell with its content selected;
  // Escape from a cell selects the table (T17)
  const cells = tab.locator('[data-stage-slide="text"] [data-eid="tb"] td');
  const cellIds = await cells.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-eid')));
  const firstWord = await wordCentre(cells.nth(0), 'Aa');
  await page.mouse.dblclick(firstWord.x, firstWord.y);
  await expect.poll(async () => (await editorState(page, id))[0]?.editingText).toBe(cellIds[0]);
  await page.keyboard.type('North');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await editorState(page, id))[0]?.editingText).toBe(cellIds[1]);
  await page.keyboard.type('East');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await editorState(page, id))[0]).toEqual(expect.objectContaining({ selection: ['tb'], editingText: null }));
  const cellTexts = async () => ((await element('tb', 'text'))?.children ?? []).flatMap((row) => row.children.map((cell) => plain(cell)));
  await expect.poll(cellTexts).toEqual(['North', 'East', 'Cc', 'Dd']);
  await page.keyboard.press('Escape');
  await expect(tab.locator('[data-overlay] [data-selected]')).toHaveCount(0);

  // copy in one deck, paste into another: the dialect on the Mac's pasteboard, loaded on the way in
  await tab.locator('[data-slide-thumb="lab"] .deck-thumb-button').click();
  const otherTab = page.locator(`[data-region="main"] [data-artifact-tab="${other}"]`);
  await withNativeClipboard(app, ['Heading', ''], async () => {
    const headNow = (await tab.locator('[data-stage-slide] [data-eid="head"]').boundingBox())!;
    await page.mouse.click(headNow.x + 30, headNow.y + headNow.height / 2);
    await page.keyboard.press('Meta+c');
    await openFromLibrary(page, 'Second deck', other);
    const second = await stageAt(otherTab);
    await page.mouse.click(second.at(1800, 1000).x, second.at(1800, 1000).y);
    await page.keyboard.press('Meta+v');
    await expect.poll(async () => plain(findIn((await slideOf(page, other, 'one')).children, 'head'))).toBe('Heading');
    // a picture copied across decks brings its asset (fix wave 2: the store's copy, so an SVG stays an SVG): drawn from
    // the second deck's own store
    await openFromLibrary(page, 'Inspector lab', id);
    await tab.locator('[data-insert-image]').setInputFiles({ name: 'mark.svg', mimeType: 'image/svg+xml', buffer: MARK_SVG });
    await expect.poll(async () => (await slideOf(page, id, 'lab')).children.filter((c) => c.tag === 'img').length).toBe(3);
    const mark = (await slideOf(page, id, 'lab')).children.find((c) => c.tag === 'img' && c.attrs.src?.startsWith('assets/mark'))!;
    const markBox = (await tab.locator(`[data-stage-slide="lab"] [data-eid="${mark.id}"]`).boundingBox())!;
    await page.mouse.click(markBox.x + markBox.width / 2, markBox.y + markBox.height / 2);
    await expect(tab.locator(`[data-overlay] [data-selected="${mark.id}"]`)).toHaveCount(1);
    await page.keyboard.press('Meta+c');
    await openFromLibrary(page, 'Second deck', other);
    await page.mouse.click(second.at(1800, 1000).x, second.at(1800, 1000).y);
    await page.keyboard.press('Meta+v');
    await expect.poll(async () => (await slideOf(page, other, 'one')).children.find((c) => c.tag === 'img')?.attrs.src ?? '').toBe('assets/mark.svg');
    await expect.poll(() => otherTab.locator('[data-stage-slide] img[data-eid]').evaluate((n) => (n as HTMLImageElement).naturalWidth)).toBe(40);
  });
  expect((await elementOf(page, other, 'one', 'head'))?.style['font-size']).toBe('72px'); // its style came with it

  expect(launch!.consoleErrors()).toEqual([]);
});

// ---- the final fix wave B (B1, B2, B3): what the canvas draws of an svg's stylesheet and ids, a container's display
// and an asset named in a style value, in Chromium

const svgOf = (gradient: string) =>
  `<svg id="chart" viewBox="0 0 200 100" style="position:absolute; left:1200px; top:600px; width:400px; height:200px"><desc><style>body{display:none!important} [data-region]{visibility:hidden!important}</style></desc><title><style>[data-region]{opacity:0!important}</style></title><style>body{display:none!important} [data-region]{visibility:hidden!important} .bar{fill:rgb(0,128,0)} @keyframes spin{to{opacity:.5}}</style><defs><linearGradient id="g"><stop offset="0" stop-color="${gradient}"/><stop offset="1" stop-color="${gradient}"/></linearGradient></defs><rect id="r" class="bar" width="50" height="50"/><rect id="filled" x="100" width="50" height="50" fill="url(#g)"/></svg>`;
const CONTAINED: Record<string, string> = {
  'project/deck.json': JSON.stringify({ v: 4, title: 'Contained', cover: 'one', order: ['one', 'two'] }),
  'project/slides/one.html': `<section id="one" style="background:#ffffff; padding:128px">
<div id="row" style="display:flex; gap:32px"><div id="c1" style="width:200px; height:100px; background:#ff0000"></div><div id="c2" style="width:200px; height:100px; background:#0000ff"></div></div>
<div id="col" style="gap:32px"><div id="d1" style="width:200px; height:100px; background:#ff0000"></div><div id="d2" style="width:200px; height:100px; background:#0000ff"></div></div>
<div id="art" style="position:absolute; left:1200px; top:200px; width:200px; height:200px; background:#eeeeee"></div>
${svgOf('#ff0000')}
</section>`,
  'project/slides/two.html': `<section id="two" style="background:#ffffff">${svgOf('#0000ff')}</section>`,
};

test('an svg’s stylesheet and ids stay its own; an explicit flex row is a row; a style’s asset draws from the store (final fix wave B)', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const id = await createDeck(page, 'Contained', CONTAINED);
  const tab = await openFromLibrary(page, 'Contained', id);
  await expect(tab.locator('[data-slide-thumb]')).toHaveCount(2);

  // B1: the app's document keeps its look; each drawing (the stage, both thumbnails) keeps its own rule and its own #g
  expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe('none');
  await expect(page.locator('[data-region="sidebar"]')).toBeVisible();
  expect(await page.locator('[data-region="main"]').evaluate((n) => getComputedStyle(n).visibility)).toBe('visible');
  // the same from an HTML <style> the parser makes under the svg's <desc> and <title> (B1 re-review 1)
  expect(await page.locator('[data-region="main"]').evaluate((n) => getComputedStyle(n).opacity)).toBe('1');
  expect(await tab.locator('.maws-slide svg[data-eid="chart"] style').count()).toBe(9); // three drawings, three sheets each, all drawn
  const drawings = await tab.locator('.maws-slide svg[data-eid="chart"]').evaluateAll((svgs) =>
    svgs.map((svg) => {
      const filled = svg.querySelector('rect[fill]')!;
      const ref = /#([^)"']+)/.exec(filled.getAttribute('fill') ?? '')?.[1] ?? '';
      const gradient = svg.ownerDocument.getElementById(ref);
      return { own: gradient !== null && svg.contains(gradient), stop: gradient?.querySelector('stop')?.getAttribute('stop-color'), slide: svg.closest('.maws-slide')!.getAttribute('data-slide'), bar: getComputedStyle(svg.querySelector('.bar')!).fill };
    }),
  );
  expect(drawings.length).toBe(3); // the stage's slide and the two thumbnails
  for (const d of drawings) {
    expect(d.own).toBe(true);
    expect(d.stop).toBe(d.slide === 'one' ? '#ff0000' : '#0000ff');
    expect(d.bar).toBe('rgb(0, 128, 0)');
  }

  // B2: an explicit display:flex with no direction lays its children in a row; no display, a column
  const box = async (eid: string) => (await tab.locator(`[data-stage-slide] [data-eid="${eid}"]`).boundingBox())!;
  const [c1, c2, d1, d2] = [await box('c1'), await box('c2'), await box('d1'), await box('d2')];
  expect(c2.x).toBeGreaterThan(c1.x + c1.width - 1);
  expect(Math.abs(c2.y - c1.y)).toBeLessThan(1);
  expect(d2.y).toBeGreaterThan(d1.y + d1.height - 1);
  expect(Math.abs(d2.x - d1.x)).toBeLessThan(1);

  // B3: an uploaded asset named in a style value draws from the store
  await tab.locator('[data-insert-image]').setInputFiles({ name: 'mark.svg', mimeType: 'image/svg+xml', buffer: MARK_SVG });
  await expect.poll(async () => (await slideOf(page, id, 'one')).children.some((c) => c.tag === 'img' && c.attrs.src === 'assets/mark.svg')).toBe(true);
  await editDeck(page, id, { op: 'setStyle', slideId: 'one', elementId: 'art', props: { background: 'url(assets/mark.svg) center / cover' } });
  await expect.poll(() => tab.locator('[data-stage-slide] [data-eid="art"]').evaluate((n) => getComputedStyle(n).backgroundImage)).toMatch(/^url\("maws-artifact:/);

  expect(launch!.consoleErrors()).toEqual([]);
});
