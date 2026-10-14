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
import { loadavg } from 'node:os';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { benchDeckFiles } from '../src/artifacts/slides/fixtures/bench';
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
    edit(
      artifactId: string,
      edit: { op: 'zOrder'; slideId: string; elementId: string; to: 'front' | 'back' } | { op: 'setNotes'; slideId: string; text: string } | { op: 'setOverride'; name: string; value: string | null },
    ): Promise<void>;
    order(artifactId: string): Promise<string[]>;
    files(artifactId: string): Promise<Record<string, string>>;
    timings(artifactId: string): { surface: string; timings: { openedAt: number; syncedAt?: number; drawnAt?: number; thumbnails?: number } }[];
  };
}
type DeckSeam = Seam['__maws_presentations'];
const order = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.order(a), id);
const seed = (page: Page, id: string, files: Record<string, string>) => page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [id, files] as const);
const editDeck = (page: Page, id: string, edit: Parameters<DeckSeam['edit']>[1]) => page.evaluate(([a, e]) => (window as unknown as Seam).__maws_presentations.edit(a, e), [id, edit] as const);
const timingsOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.timings(a), id);

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
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts', exact: true }).click();
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${id}"]`).click();
  const inPanel = panel.locator(`[data-deck-artifact="${id}"]`);
  await expect(inPanel.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole('button', { name: 'Mark up', exact: true })).toBeVisible(); // the stage is the tab's Mark-up surface
  await panel.getByRole('button', { name: /^Pin / }).first().click();
  await panel.getByRole('button', { name: 'Open in tab' }).click();
  const inMain = page.locator(`[data-region="main"] [data-deck-artifact="${id}"]`);
  await expect(inMain.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('tab', { name: 'Artifacts' }).click(); // with no session shown, the pinned tab is picked again
  await expect(inPanel.locator('[data-deck-editor]')).toBeVisible();
  await expect(page.locator('[data-region="main"] [data-editor-header] [data-header-title]')).toHaveText('Q3 review');
  await expect(page.locator('[data-region="main"] [data-editor-header] [data-header-saved]')).toHaveText('All changes saved');
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
  const panelNotes = inPanel.getByRole('textbox', { name: 'Speaker notes' });
  await expect(panelNotes).toHaveValue('Open with the ramp time.');
  await panelNotes.click();
  await panelNotes.press('End');
  await panelNotes.pressSequentially(' Then the office.');
  await expect(inMain.getByRole('textbox', { name: 'Speaker notes' })).toHaveValue('Open with the ramp time. Then the office.');

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
  await cover.focus();
  await page.keyboard.press('Space');
  const lifted = inMain.locator(`[data-slide-thumb="${before[0]}"]`);
  await expect(lifted).toHaveAttribute('data-dragging', 'true'); // the sensor listens from the next tick on
  // the sensor starts listening a tick after the lift: an arrow pressed before that moves nothing, so press until it moves
  await expect(async () => {
    if (!/translate3d\(0px, [1-9]/.test((await lifted.getAttribute('style')) ?? '')) await page.keyboard.press('ArrowDown');
    await expect(lifted).toHaveAttribute('style', /translate3d\(0px, [1-9]/, { timeout: 250 });
  }).toPass();
  // dropped once the sensor has the next slide under it (its announcement says so)
  await expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: `over droppable area ${before[1]}.` })).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect.poll(() => order(page, id)).toEqual([before[1], before[0], ...before.slice(2)]);
  await expect(thumbs(inPanel).first()).toHaveAttribute('data-slide-thumb', before[1]!);
  await inMain.getByRole('button', { name: 'Undo' }).click();
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
  expect(open).toBeLessThanOrEqual(1_000);
  expect(launch!.consoleErrors()).toEqual([]);
});
