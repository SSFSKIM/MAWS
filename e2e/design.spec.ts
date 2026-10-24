// The design workbench in the product build (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3,
// acceptance 2; `pnpm e2e:design`). A design is created by the human's `artifacts.create` and seeded from files through
// the renderer's seam (`window.__maws_design`; e2e/support/design.ts), on a scratch profile.
// - Two replicas: the design opens in the panel's Artifacts tool (pinned) and in an `artifact` main tab; a board moved
//   in one is moved in the other. Every board is mounted as its own canvas (the same nodes through pan and zoom), at
//   its size with the screen type defaults; fit all, the wheel and a pinch, the zoom range 2 %–400 %. The evidence
//   screenshots: the main tab fitting every board, and the panel with the phone selected and its inspector open.
// - Board frames: a title drag moves a board (⌘ freely, else snapped to a sibling's edge with its guide), one undo
//   step; a handle resizes it; a preset sizes it; the cap is refused by name; the list adds from a preset, duplicates,
//   reorders by the keyboard, deletes and zooms to a board; every one undone from one stack.
// - Elements (parent Decision Log 20): a press on an inactive board's content activates it and selects the element
//   with no move and no pan; then C's gestures on it: move, resize, rotate, the inspector, Detach, z-order, group and
//   ungroup, a board move and an element edit undone from one stack, Insert on the phone at screen type, and text in
//   place through a Korean composition while another replica edits the same box.
// - Theme restyles every board through the document medium; a held board is drawn labelled and never written.
// - M6: a board's middle snaps to a sibling's and to an equal gap between two (their guides drawn); an edit in the main
//   tab patches the panel's replica within a frame, its geometry and its content (the seam's frame probe); the comments
//   rail and card, the history comparison and the Export sheet, wide (the design's main tab; the card in the panel
//   maximized beside the chat, where a comment goes) and narrow (the panel), each screenshotted and measured before its
//   bounds are read.
// - P3-F wave S F3: the design in the panel at its 280 px minimum, its toolbar wrapped by whole controls (C's
//   `.deck-toolbar` rules, no longer the workbench's own).
// - P4-B2 (D1 to D9, D12; F9's c43 rewritten): a board's text element ARMED on its first click, words typed replacing its
//   text (C's overlay); a double-click on an inactive board's heading edits it in one gesture (T22).
import { mainTab, openArtifactInPanel, openSurface, pinSurfaceForSessions } from './support/shell';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ScratchRepo } from '../test/support/scratch-repo';
import { launchMaws, type MawsLaunch } from './support/launch';
import { newChatIn, openProject } from './support/sidebar';
import { openArrange, resizePanel, squeezedControls } from './support/toolbar-controls';
import {
  armFrameProbe,
  boardAt,
  boardOf,
  boardsOf,
  centre,
  createDesign,
  DESIGN_FILES,
  drag,
  editDesign,
  elementOf,
  expectSurfaceBounds,
  exportEntry,
  frameOf,
  frameProbeResult,
  type FrameProbeResult,
  FRAMES,
  headerAction,
  ok,
  openFromLibrary,
  ORDER,
  plain,
  px,
  seamInstalled,
  surfaceEvidence,
  type SurfaceGeometry,
  threadsOf,
  viewOf,
  worldAt,
} from './support/design';

// H's words for an artifact with no session context (src/renderer/src/artifacts/session-context.ts, NO_SESSION_CONTEXT;
// the renderer module is not imported here, its stores being the window's)
const NO_SESSION_CONTEXT = 'Put this artifact in a Space linked to a folder to start a session for it';

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
  await expect.poll(() => seamInstalled(page), { message: 'the seam is installed' }).toBe('object');
  return page;
}

/** The design in the panel's Artifacts tool (pinned) and in a main tab: two replicas in one window. */
async function inPanelAndTab(page: Page, id: string): Promise<{ panel: Locator; inPanel: Locator; inMain: Locator }> {
  // a chat shown, so the panel takes tools; its Artifacts tool pinned, so it stays while a main tab shows the design
  repo = await ScratchRepo.create({ sentinels: false });
  const project = await ok<{ name: string }>(page, 'session.projects.add', { directory: repo.root });
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  const panel = page.locator('[data-region="panel"]');
  await openArtifactInPanel(page, id);
  const inPanel = panel.locator(`[data-design-artifact="${id}"]`);
  await expect(inPanel.locator('[data-design-editor]')).toBeVisible({ timeout: 15_000 });
  await pinSurfaceForSessions(page, 'Artifacts');
  await panel.getByRole('button', { name: 'Move to tab' }).click();
  const inMain = page.locator(`[data-region="main"] [data-design-artifact="${id}"]`);
  await expect(inMain.locator('[data-design-editor]')).toBeVisible({ timeout: 15_000 });
  // Move to tab moves the design (P3-F wave S, F16): the pinned tab is back on its list. Opened from it again, it is the
  // panel's replica beside the main tab's (the parent's Decision Log 8).
  await openSurface(page, 'Artifacts');
  await expect(inPanel).toHaveCount(0);
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${id}"]`).click();
  await expect(inPanel.locator('[data-design-editor]')).toBeVisible({ timeout: 15_000 });
  return { panel, inPanel, inMain };
}

const frameOnly = (id: keyof typeof FRAMES) => {
  const { x, y, w, h } = FRAMES[id]!;
  return { x, y, w, h };
};

test('a design in the panel and a main tab: two replicas, every board mounted through pan and zoom, the zoom range and its fits', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);
  expect((await boardsOf(page, id)).map((b) => b.id)).toEqual(ORDER);

  const { panel, inPanel, inMain } = await inPanelAndTab(page, id);
  await expect(page.locator('[data-region="main"] [data-editor-header] [data-header-title]')).toHaveText('Launch screens');
  await expect(page.locator('[data-region="main"] [data-editor-header] [data-header-saved]')).toHaveText('All changes saved');
  await expect.poll(async () => (await ok<{ artifact: { lastViewedAt: number | null } }>(page, 'artifacts.get', { artifactId: id })).artifact.lastViewedAt).not.toBeNull();

  // every board mounted in both replicas, each its own canvas at its size, marked a board: the screen type defaults
  for (const where of [inMain, inPanel]) await expect(where.locator('[data-board-id] .maws-slide[data-board]')).toHaveCount(ORDER.length);
  const fontSize = (boardId: string, eid: string) => inMain.locator(`[data-board-id="${boardId}"] [data-eid="${eid}"]`).evaluate((n) => getComputedStyle(n).fontSize);
  await expect.poll(() => fontSize('phone', 'title')).toBe('32px');
  expect(await fontSize('phone', 'lede')).toBe('16px');
  expect(await fontSize('tablet', 'head')).toBe('24px');
  const poster = await inMain.locator('[data-board-id="poster"] .maws-slide').evaluate((n) => ({ ratio: n.getBoundingClientRect().height / n.getBoundingClientRect().width, height: (n as HTMLElement).offsetHeight }));
  expect(poster.height).toBe(9000);
  expect(poster.ratio).toBeCloseTo(9000 / 1080, 2);
  await expect(inMain.locator('[data-board-id="broken"]')).toHaveAttribute('data-held', '');

  // fit all: every board inside the world; the wide evidence screenshot
  await inMain.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-all');
  const world = (await inMain.locator('[data-design-world]').boundingBox())!;
  for (const b of ORDER) {
    const box = (await inMain.locator(`[data-board-id="${b}"]`).boundingBox())!;
    expect(box.x, b).toBeGreaterThanOrEqual(world.x - 1);
    expect(box.y, b).toBeGreaterThanOrEqual(world.y - 1);
    expect(box.x + box.width, b).toBeLessThanOrEqual(world.x + world.width + 1);
    expect(box.y + box.height, b).toBeLessThanOrEqual(world.y + world.height + 1);
  }
  // each title stays over its own board at any zoom: never wider than the board is drawn, so never into a neighbour's;
  // its full name and size stay its tooltip
  const labels = await Promise.all(
    ORDER.map(async (b) => ({ b, title: (await inMain.locator(`[data-board-title="${b}"]`).boundingBox())!, board: (await inMain.locator(`[data-board-id="${b}"]`).boundingBox())! })),
  );
  for (const { b, title, board } of labels) {
    expect(title.x, b).toBeGreaterThanOrEqual(board.x - 1);
    expect(title.x + title.width, b).toBeLessThanOrEqual(board.x + board.width + 1);
  }
  for (let i = 1; i < labels.length; i++) expect(labels[i]!.title.x, `${labels[i]!.b} after ${labels[i - 1]!.b}`).toBeGreaterThanOrEqual(labels[i - 1]!.title.x + labels[i - 1]!.title.width - 1);
  await expect(inMain.locator('[data-board-title="poster"]')).toHaveAttribute('title', 'Poster, 1,080 × 9,000');
  await page.locator('[data-region="main"]').screenshot({ path: test.info().outputPath('design-workbench-fit-all.png') });

  // a drag on the empty world pans it; every canvas stays mounted: the same nodes before and after
  const canvases = inMain.locator('[data-board-id] .maws-slide');
  await canvases.evaluateAll((ns) => ns.forEach((n, i) => ((n as HTMLElement).dataset.e2eMark = String(i))));
  const before = (await viewOf(page, id, 'main')).viewport!;
  const from = await worldAt(inMain, before, 200, 4000); // below the phone: no board there
  expect(await inMain.locator('[data-design-world]').evaluate((world, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return hit !== null && world.contains(hit) && hit.closest('[data-board-id], [data-board-title]') === null;
  }, from), 'the empty-world pan begins on exposed canvas, not an overlaid Boards sheet').toBe(true);
  await drag(page, from, { x: from.x - 80, y: from.y - 60 });
  // P4-B3 Decision Log 35: the main tab adopts the view the panel held (X38's carry), whose arithmetic leaves the pan
  // about 3 × 10⁻⁵ px off; the offsets are compared within that, the zoom exactly
  await expect
    .poll(async () => {
      const after = (await viewOf(page, id, 'main')).viewport!;
      return { zoom: after.zoom, dx: Math.abs(after.x - (before.x - 80)), dy: Math.abs(after.y - (before.y - 60)) };
    })
    .toEqual({ zoom: before.zoom, dx: expect.closeTo(0, 3), dy: expect.closeTo(0, 3) });
  expect(await canvases.evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.e2eMark))).toEqual(ORDER.map((_, i) => String(i)));

  // the wheel pans; a pinch (⌃-wheel) zooms about the pointer
  const mid = await centre(inMain.locator('[data-design-world]'));
  await page.mouse.move(mid.x, mid.y);
  const v1 = (await viewOf(page, id, 'main')).viewport!;
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await viewOf(page, id, 'main')).viewport!.y).toBeLessThan(v1.y - 60);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await viewOf(page, id, 'main')).viewport!.zoom).toBeGreaterThan(v1.zoom);

  // the zoom range: 400 % at most, 2 % at least; every board still mounted at either end
  const zoomIn = inMain.getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 20 && (await zoomIn.isEnabled()); i++) await zoomIn.click();
  expect((await viewOf(page, id, 'main')).viewport!.zoom).toBe(4);
  const zoomOut = inMain.getByRole('button', { name: 'Zoom out' });
  for (let i = 0; i < 20 && (await zoomOut.isEnabled()); i++) await zoomOut.click();
  expect((await viewOf(page, id, 'main')).viewport!.zoom).toBe(0.02);
  expect(await canvases.evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.e2eMark))).toEqual(ORDER.map((_, i) => String(i)));
  await inMain.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-all');

  // an edit in one replica patches the other: the tablet moved through the main tab's inspector, then undone
  await inMain.locator('[data-board-title="tablet"]').click();
  const boardX = inMain.getByRole('textbox', { name: 'Board X' });
  await boardX.fill('600');
  await boardX.press('Enter');
  await expect(inPanel.locator('[data-board-id="tablet"]')).toHaveCSS('left', '600px', { timeout: 1_000 });
  await inMain.getByRole('button', { name: 'Undo' }).click();
  await expect(inPanel.locator('[data-board-id="tablet"]')).toHaveCSS('left', '490px', { timeout: 1_000 });

  // the narrow panel: the phone picked from the board list (a sheet over the world, closing once picked), the inspector
  // opened under the world, the phone fitted into what the world has left
  await inPanel.getByRole('button', { name: 'Boards', exact: true }).click();
  await inPanel.getByRole('button', { name: /^Phone, / }).click();
  await expect(inPanel.locator('[data-design-rail="boards"]')).toHaveCount(0);
  await inPanel.getByRole('button', { name: 'Inspector', exact: true }).click();
  await inPanel.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-selection');
  await expect(inPanel.getByRole('textbox', { name: 'Board width' })).toHaveValue('390');
  await expect(inPanel.locator('[data-board-id="phone"]')).toHaveAttribute('data-frame-selected', 'true');
  // the evidence first, so a first failing bound hides nothing: the screenshot, then every box the bounds below read
  // and each element of the editor's chrome lying outside it (the world's own contents excluded: its boards are clipped
  // to it by design), attached as one JSON
  await panel.screenshot({ path: test.info().outputPath('design-panel-phone.png') });
  const geometry = await inPanel.evaluate((n) => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    const editor = n.querySelector<HTMLElement>('[data-design-editor]')!;
    const e = editor.getBoundingClientRect();
    const world = editor.querySelector('[data-design-world]');
    const outside = Array.from(editor.querySelectorAll<HTMLElement>('*'))
      .filter((el) => !(world && world !== el && world.contains(el)))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.left < e.left - 1 || r.right > e.right + 1))
      .map(({ el }) => ({ tag: el.tagName.toLowerCase(), className: typeof el.className === 'string' ? el.className : '', role: el.getAttribute('role'), label: el.getAttribute('aria-label'), rect: rect(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    let scrolled = 0;
    for (let a: HTMLElement | null = n as HTMLElement; a; a = a.parentElement) scrolled += a.scrollLeft;
    return {
      editor: { rect: rect(editor), scrollWidth: editor.scrollWidth, clientWidth: editor.clientWidth },
      scrolled,
      toolbar: { rect: rect(editor.querySelector('[role="toolbar"]')), scrollWidth: editor.querySelector('[role="toolbar"]')?.scrollWidth ?? null },
      world: rect(world),
      inspector: rect(editor.querySelector('[data-design-rail="inspector"]')),
      phone: rect(editor.querySelector('[data-board-id="phone"]')),
      outside,
    };
  });
  const panelView = await viewOf(page, id, 'panel'); // the view's room and viewport, to tell a stale room from a stale layout
  await test.info().attach('design-panel-geometry', { body: JSON.stringify({ ...geometry, view: { room: panelView.room, viewport: panelView.viewport, frame: panelView.frame } }, null, 2), contentType: 'application/json' });
  // nothing overflows the panel sideways and nothing is scrolled: the editor fits it, every control lies inside it
  const panelBox = (await panel.boundingBox())!;
  const inside = async (what: string, locator: Locator) => {
    const box = (await locator.boundingBox())!;
    expect(box.x, what).toBeGreaterThanOrEqual(panelBox.x - 1);
    expect(box.x + box.width, what).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    return box;
  };
  const overflow = await inPanel.evaluate((n) => {
    let scrolled = 0;
    for (let a: HTMLElement | null = n as HTMLElement; a; a = a.parentElement) scrolled += a.scrollLeft;
    const editor = n.querySelector<HTMLElement>('[data-design-editor]')!;
    return { scrolled, over: editor.scrollWidth - editor.clientWidth };
  });
  expect(overflow.scrolled).toBe(0);
  expect(overflow.over).toBeLessThanOrEqual(1);
  await inside('the editor', inPanel.locator('[data-design-editor]'));
  for (const [what, control] of [
    ['Inspector', inPanel.getByRole('button', { name: 'Inspector', exact: true })],
    ['Insert', inPanel.getByRole('button', { name: 'Insert', exact: true })],
    ['Zoom in', inPanel.getByRole('button', { name: 'Zoom in' })],
    ['Board width', inPanel.getByRole('textbox', { name: 'Board width' })],
    ['Board size', inPanel.getByRole('combobox', { name: 'Board size' })],
  ] as const)
    await inside(what, control);
  expect((await inside('Zoom', inPanel.getByRole('combobox', { name: 'Zoom' }))).width).toBeGreaterThanOrEqual(56);
  expect((await inside('Text style', inPanel.getByRole('button', { name: 'Text style', exact: true }))).height).toBeLessThan(40); // one line, not a letter a line
  // the world keeps a usable height above the inspector, and shows the selected phone whole in it
  const worldBox = await inside('the world', inPanel.locator('[data-design-world]'));
  expect(worldBox.height).toBeGreaterThanOrEqual(150);
  const inspectorBox = await inside('the inspector', inPanel.locator('[data-design-rail="inspector"]'));
  expect(inspectorBox.y).toBeGreaterThanOrEqual(worldBox.y + worldBox.height - 1);
  const phoneBox = (await inPanel.locator('[data-board-id="phone"]').boundingBox())!;
  expect(phoneBox.x).toBeGreaterThanOrEqual(worldBox.x - 1);
  expect(phoneBox.y).toBeGreaterThanOrEqual(worldBox.y - 1);
  expect(phoneBox.x + phoneBox.width).toBeLessThanOrEqual(worldBox.x + worldBox.width + 1);
  expect(phoneBox.y + phoneBox.height).toBeLessThanOrEqual(worldBox.y + worldBox.height + 1);
  expect(geometry.outside, 'the editor’s chrome outside the editor').toEqual([]);

  expect(launch!.consoleErrors()).toEqual([]);
});

// P3-F wave S, F3 (docs/doperpowers/plans/2026-10-18-p3-f-finish.md, Wave S triage c37, obs 9, 7.1): the workbench's
// toolbar is C's `.deck-toolbar`, whose wrap rules are now that class's own (the workbench's scoped copies deleted). In
// the narrowest panel it wraps by whole controls, none squeezed, wrapped inside or overlapping, every control inside
// the panel: with nothing selected, and with the phone's heading selected (its role in Text style).
test('a design in the panel at its 280 px minimum: the toolbar wraps by whole controls, none squeezed, wrapped inside or overlapping', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);
  repo = await ScratchRepo.create({ sentinels: false });
  const project = await ok<{ name: string }>(page, 'session.projects.add', { directory: repo.root });
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  const panel = page.locator('[data-region="panel"]');
  await openArtifactInPanel(page, id);
  const inPanel = panel.locator(`[data-design-artifact="${id}"]`);
  await expect(inPanel.locator('[data-design-editor]')).toBeVisible({ timeout: 15_000 });
  await resizePanel(page, 280);
  const toolbar = inPanel.getByRole('toolbar', { name: 'Design' });
  await expect(toolbar.getByRole('button', { name: 'Text style', exact: true })).toBeVisible();

  await test.info().attach('design-panel-280', { body: await panel.screenshot(), contentType: 'image/png' });
  expect(await squeezedControls(toolbar, { within: panel }), 'nothing selected').toEqual([]);
  expect((await toolbar.boundingBox())!.height, 'the row wrapped').toBeGreaterThan(36);

  await inPanel.getByRole('button', { name: 'Boards', exact: true }).click();
  await inPanel.getByRole('button', { name: /^Phone, / }).click();
  await expect(inPanel.locator('[data-design-rail="boards"]')).toHaveCount(0);
  await inPanel.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-selection');
  const heading = (await inPanel.locator('[data-board-id="phone"] [data-eid="title"]').boundingBox())!;
  await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
  await expect.poll(async () => (await viewOf(page, id, 'panel')).selection).toEqual(['title']);
  await test.info().attach('design-panel-280-selected', { body: await panel.screenshot(), contentType: 'image/png' });
  expect(await squeezedControls(toolbar, { within: panel }), 'the phone’s heading selected').toEqual([]);

  expect(launch!.consoleErrors()).toEqual([]);
});

test('board frames: moved and snapped, resized, sized by preset and refused past the cap; the list adds, duplicates, reorders, deletes and zooms; one undo stack', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);
  const tab = await openFromLibrary(page, 'Launch screens', id);
  const frame = (boardId: string) => frameOf(page, id, boardId);
  const view = async () => (await viewOf(page, id, 'main')).viewport!;

  // the tablet's frame selected and the world at 25 % about it
  const title = tab.locator('[data-board-title="tablet"]');
  await title.click();
  await expect(tab.locator('[data-board-id="tablet"]')).toHaveAttribute('data-frame-selected', 'true');
  await tab.getByRole('combobox', { name: 'Zoom' }).selectOption('fit-selection');
  await tab.getByRole('combobox', { name: 'Zoom' }).selectOption('0.25');
  expect((await view()).zoom).toBe(0.25);

  // a title drag moves the board (⌘: no snapping): 40 × 20 screen px are 160 × 80 world px at 25 %
  const t0 = await centre(title);
  await page.keyboard.down('Meta');
  await drag(page, t0, { x: t0.x + 40, y: t0.y + 20 });
  await page.keyboard.up('Meta');
  await expect.poll(() => frame('tablet')).toEqual({ x: 650, y: 80, w: 834, h: 1194 });
  // dropped 4 world px below its siblings' tops: snapped to them, a guide drawn while it does
  const t1 = await centre(title);
  await drag(page, t1, { x: t1.x, y: t1.y - 19 }, { during: async () => await expect(tab.locator('.design-world-screen .deck-guide').first()).toBeVisible() });
  await expect.poll(() => frame('tablet')).toEqual({ x: 650, y: 0, w: 834, h: 1194 });
  // each drag one undo step
  await tab.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => frame('tablet')).toEqual({ x: 650, y: 80, w: 834, h: 1194 });
  await tab.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(() => frame('tablet')).toEqual({ x: 650, y: 0, w: 834, h: 1194 });

  // a handle resizes it: 25 screen px are 100 world px
  const e = await centre(tab.locator('[data-board-handle="e"]'));
  await page.keyboard.down('Meta');
  await drag(page, e, { x: e.x + 25, y: e.y });
  await page.keyboard.up('Meta');
  await expect.poll(() => frame('tablet')).toEqual({ x: 650, y: 0, w: 934, h: 1194 });

  // a preset sizes it; a size past the cap is refused by name and nothing is written
  await tab.getByRole('combobox', { name: 'Board size' }).selectOption('phone');
  await expect.poll(() => frame('tablet')).toEqual({ x: 650, y: 0, w: 390, h: 844 });
  const height = tab.getByRole('textbox', { name: 'Board height' });
  await height.fill('20000');
  await height.press('Enter');
  await expect(tab.getByRole('alert')).toContainText('over 16384 px a side');
  expect(await frame('tablet')).toEqual({ x: 650, y: 0, w: 390, h: 844 });
  await height.press('Escape');

  // M6: the now phone-sized tablet dropped 5 world px below the desktop's middle: its middle snapped to the desktop's,
  // a centre guide drawn (no edge or gap lies within the six screen px there)
  const t2 = await centre(title);
  await drag(page, t2, { x: t2.x, y: t2.y + 95 * 0.25 }, { during: async () => await expect(tab.locator('.design-world-screen .deck-guide[data-guide="centre"]').first()).toBeVisible() });
  await expect.poll(() => frame('tablet')).toEqual({ x: 650, y: 512 - 844 / 2, w: 390, h: 844 });
  // then 7 world px short of centred between the phone (ending at 390) and the desktop (starting at 1,424): an equal gap
  // either side, its gap guides drawn
  const t3 = await centre(title);
  await drag(page, t3, { x: t3.x + 55 * 0.25, y: t3.y }, { during: async () => await expect(tab.locator('.design-world-screen .deck-guide[data-guide="gap"]').first()).toBeVisible() });
  const between = (390 + 1424 - 390) / 2;
  await expect.poll(() => frame('tablet')).toEqual({ x: between, y: 90, w: 390, h: 844 });
  expect(between - 390).toBe(1424 - (between + 390));
  for (let i = 0; i < 2; i++) await tab.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => frame('tablet')).toEqual({ x: 650, y: 0, w: 390, h: 844 });

  // zoom to board: the poster, taller than 8,192 px, fitted by its height
  await tab.getByRole('button', { name: 'Board Poster options' }).click();
  await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
  const worldBox = (await tab.locator('[data-design-world]').boundingBox())!;
  await expect.poll(async () => Math.round((await tab.locator('[data-board-id="poster"]').boundingBox())!.height)).toBe(Math.round(worldBox.height - 96));

  // the list: add from a preset, duplicate, reorder by the keyboard, delete
  await tab.getByRole('button', { name: 'Add board' }).click();
  await page.getByRole('menuitem', { name: 'Slide 1,920 × 1,080' }).click();
  await expect.poll(async () => (await boardsOf(page, id)).length).toBe(6);
  const added = (await boardsOf(page, id)).at(-1)!;
  expect(added.title).toBe('Slide');
  expect(added.frame).toMatchObject({ w: 1920, h: 1080 });
  await expect(tab.locator(`[data-board-id="${added.id}"] .maws-slide[data-board]`)).toHaveCount(1);

  await tab.getByRole('button', { name: 'Board Phone options' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate board' }).click();
  await expect.poll(async () => (await boardsOf(page, id)).length).toBe(7);
  const copy = (await boardsOf(page, id))[1]!;
  expect(copy.frame).toEqual({ x: 490, y: 0, w: 390, h: 844 });
  expect((await boardOf(page, id, copy.id)).children.map((c) => c.id)).not.toContain('cta'); // its elements under new ids

  const ids = async () => (await boardsOf(page, id)).map((b) => b.id);
  const before = await ids();
  const row = tab.locator('[data-board-row="tablet"]');
  await row.getByRole('button', { name: /^Tablet, / }).focus();
  await page.keyboard.press('Space');
  await expect(row).toHaveAttribute('data-dragging', 'true');
  // the sensor starts listening a tick after the lift: press until the row moves (C's filmstrip spec)
  await expect(async () => {
    if (!/translate3d\(0px, [1-9]/.test((await row.getAttribute('style')) ?? '')) await page.keyboard.press('ArrowDown');
    await expect(row).toHaveAttribute('style', /translate3d\(0px, [1-9]/, { timeout: 250 });
  }).toPass();
  const next = before[before.indexOf('tablet') + 1]!;
  await expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: `Tablet, moved to position ${before.indexOf('tablet') + 2}.` })).toHaveCount(1); // W1-C L283: by name and position, no id
  await page.keyboard.press('Space');
  const at = before.indexOf('tablet');
  await expect.poll(ids).toEqual([...before.slice(0, at), next, 'tablet', ...before.slice(at + 2)]);

  await tab.locator(`[data-board-row="${copy.id}"]`).getByRole('button', { name: 'Board Phone options' }).click();
  await page.getByRole('menuitem', { name: 'Delete board' }).click();
  await expect.poll(async () => (await ids()).includes(copy.id)).toBe(false);

  // undone from one stack: the delete, the reorder, the duplicate, the add
  for (let i = 0; i < 4; i++) await tab.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(ids).toEqual(ORDER);

  expect(launch!.consoleErrors()).toEqual([]);
});

test('elements on boards: an inactive board’s press activates and selects without moving, then C’s gestures, one undo stack, Insert at screen type and a Korean composition', async () => {
  test.setTimeout(240_000);
  const page = await ready();
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);
  const tab = await openFromLibrary(page, 'Launch screens', id);
  const element = (eid: string, boardId = 'desktop') => elementOf(page, id, boardId, eid);
  const tabView = () => viewOf(page, id, 'main');

  // the desktop zoomed to, the phone the active board: the desktop's content is an inactive board's
  await tab.getByRole('button', { name: 'Board Desktop options' }).click();
  await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
  await tab.getByRole('button', { name: /^Phone, / }).click();
  await expect.poll(async () => (await tabView()).currentBoard).toBe('phone');
  const vBefore = (await tabView()).viewport;
  const d = await boardAt(tab, 'desktop', frameOnly('desktop'));

  // a press and drag on its red box: the desktop becomes active and the box selected; nothing moves, nothing pans
  await drag(page, d.at(300, 560), d.at(380, 600));
  await expect.poll(async () => {
    const t = await tabView();
    return [t.currentBoard, t.selection];
  }).toEqual(['desktop', ['a']]);
  expect((await tabView()).viewport).toEqual(vBefore);
  expect(await frameOf(page, id, 'desktop')).toEqual(frameOnly('desktop'));
  expect((await element('a'))?.style.left).toBe('200px');
  await expect(tab.locator('[data-active-board="desktop"] [data-overlay] [data-selected="a"]')).toBeVisible();

  // the next gesture edits: a drag moves the box, one undo step
  await drag(page, d.at(300, 560), { x: d.at(300, 560).x + 40, y: d.at(300, 560).y });
  await expect.poll(async () => px((await element('a'))?.style.left)).toBeGreaterThan(200);
  await tab.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await element('a'))?.style.left).toBe('200px');

  // resize with the aspect kept (Shift on the bottom-right handle)
  await page.mouse.click(d.at(300, 560).x, d.at(300, 560).y);
  const se = await centre(tab.locator('[data-overlay] [data-handle="se"]'));
  await page.keyboard.down('Shift');
  await drag(page, se, { x: se.x + 60 * d.zoom, y: se.y });
  await page.keyboard.up('Shift');
  await expect.poll(async () => px((await element('a'))?.style.width)).toBeGreaterThan(230);
  const resized = (await element('a'))!.style;
  expect(px(resized.width) / px(resized.height)).toBeCloseTo(200 / 120, 1);

  // rotate the ellipse by its handle, Shift by 15°
  await page.mouse.click(d.at(1100, 700).x, d.at(1100, 700).y);
  const rot = await centre(tab.locator('[data-overlay] [data-handle="rotate"]'));
  await page.keyboard.down('Shift');
  await drag(page, rot, d.at(1400, 705));
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await element('c'))?.style.transform).toBe('rotate(90deg)');

  // the inspector restyles the box
  await page.mouse.click(d.at(300, 560).x, d.at(300, 560).y);
  const inspector = tab.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByRole('textbox', { name: 'Fill colour' }).fill('rgb(0, 0, 255)');
  await inspector.getByRole('textbox', { name: 'Fill colour' }).press('Enter');
  await expect.poll(async () => (await element('a'))?.style.background).toBe('#0000ff');

  // Detach pins the paragraph where it is drawn; Bring to front puts the green box last
  await page.mouse.click(...((b) => [b.x + 20, b.y + b.height / 2] as const)((await tab.locator('[data-board-id="desktop"] [data-eid="para"]').boundingBox())!));
  await (await openArrange(page, tab)).getByRole('menuitem', { name: 'Detach', exact: true }).click();
  await expect.poll(async () => (await element('para'))?.style.position).toBe('absolute');
  await page.mouse.click(d.at(700, 560).x, d.at(700, 560).y);
  await (await openArrange(page, tab)).getByRole('menuitem', { name: 'Bring to front', exact: true }).click();
  await expect.poll(async () => (await boardOf(page, id, 'desktop')).children.at(-1)!.id).toBe('b');

  // group a and b (⌘G), then ungroup (⇧⌘G)
  await page.mouse.click(d.at(300, 560).x, d.at(300, 560).y);
  await page.keyboard.down('Shift');
  await page.mouse.click(d.at(700, 560).x, d.at(700, 560).y);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Meta+g');
  const grouped = async () => (await boardOf(page, id, 'desktop')).children.find((c) => c.attrs['data-group'] !== undefined)?.children.map((c) => c.id) ?? null;
  await expect.poll(grouped).toEqual(['a', 'b']);
  await page.keyboard.press('Meta+Shift+g');
  await expect.poll(grouped).toBeNull();

  // a board move and the element edits before it undo in turn from one stack
  const dt = await centre(tab.locator('[data-board-title="desktop"]'));
  await page.keyboard.down('Meta');
  await drag(page, dt, { x: dt.x + 30, y: dt.y });
  await page.keyboard.up('Meta');
  await expect.poll(async () => (await frameOf(page, id, 'desktop'))!.x).toBeGreaterThan(1424);
  await tab.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await frameOf(page, id, 'desktop'))!.x).toBe(1424);
  await tab.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(grouped).toEqual(['a', 'b']); // the ungroup undone
  await tab.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(grouped).toBeNull();

  // Insert on the phone: a text box at the board's screen type (no slide font size), fitted to the phone
  await tab.getByRole('button', { name: 'Board Phone options' }).click();
  await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
  await tab.getByRole('button', { name: /^Phone, / }).click();
  await tab.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Text box', exact: true }).click();
  await expect(tab.locator('.deck-textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  const inserted = (await boardOf(page, id, 'phone')).children.find((c) => c.tag === 'p' && c.id !== 'lede')!;
  expect(inserted.style['font-size']).toBeUndefined();
  expect(px(inserted.style.width)).toBeLessThanOrEqual(312);
  expect(await tab.locator(`[data-board-id="phone"] [data-eid="${inserted.id}"]`).evaluate((n) => getComputedStyle(n).fontSize)).toBe('16px');

  // text in place on the desktop: typed, then a Korean composition while another replica edits the same box
  await tab.getByRole('button', { name: 'Board Desktop options' }).click();
  await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
  await tab.getByRole('button', { name: /^Desktop, / }).click();
  const note = (await tab.locator('[data-board-id="desktop"] [data-eid="note"]').boundingBox())!;
  const box = tab.locator('.deck-textbox');
  // P4-B2 (T1, T10; F9's c43, obs 5a): a first click selects the board's text element ARMED, its box focused, and words
  // typed replace its text (C's overlay); Escape from the edit is ARMED again
  await page.mouse.click(note.x + 20, note.y + note.height / 2);
  await expect.poll(async () => (await tabView()).selection).toEqual(['note']);
  await expect(box).toBeFocused();
  await page.keyboard.type('Hi there');
  await expect.poll(async () => plain(await element('note'))).toBe('Hi there');
  await page.keyboard.press('Escape');
  await expect(tab.locator('[data-design-world][data-armed]')).toHaveCount(1);
  await page.mouse.dblclick(note.x + 20, note.y + note.height / 2);
  await expect(box).toBeFocused();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Hello');
  await expect.poll(async () => plain(await element('note'))).toBe('Hello');
  const cdp = await page.context().newCDPSession(page);
  const compose = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  await compose('ㅎ');
  await compose('하');
  await compose('한');
  await editDesign(page, id, { op: 'prependText', boardId: 'desktop', elementId: 'note', text: 'Remote ' }); // lands while composing
  await page.waitForTimeout(300);
  await expect(box).not.toContainText('Remote'); // held by the replica until the composition ends (the hold)
  await compose('한ㄱ');
  await compose('한그');
  await compose('한글');
  await cdp.send('Input.insertText', { text: '한글' });
  await expect.poll(async () => plain(await element('note'))).toBe('Remote Hello한글');
  await expect(box).toHaveText('Remote Hello한글');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); // ARMED, then nothing selected
  await expect(box).toHaveCount(0);
  await expect(tab.locator('[data-board-id="desktop"] [data-eid="note"]')).toHaveText('Remote Hello한글');

  expect(launch!.consoleErrors()).toEqual([]);
});

// P4-B2 (T22 and T5, D12; docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D5): a double-click on an inactive
// board's heading activates the board (the world's press) and edits the heading with the word under the pointer
// selected, in one gesture (the newly active board's overlay takes the double-click)
test('a double-click on an inactive board’s heading activates the board and edits the heading in one gesture (T22)', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);
  const tab = await openFromLibrary(page, 'Launch screens', id);
  const tabView = () => viewOf(page, id, 'main');
  await tab.getByRole('button', { name: 'Board Desktop options' }).click();
  await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
  await tab.getByRole('button', { name: /^Phone, / }).click();
  await expect.poll(async () => (await tabView()).currentBoard).toBe('phone');
  const head = (await tab.locator('[data-board-id="desktop"] [data-eid="head"]').boundingBox())!;
  await page.mouse.dblclick(head.x + 20, head.y + head.height / 2);
  await expect.poll(async () => {
    const t = await tabView();
    return [t.currentBoard, t.selection];
  }).toEqual(['desktop', ['head']]);
  const box = tab.locator('[data-board-id="desktop"] [data-eid="head"] .deck-textbox');
  await expect(box).toBeFocused();
  // the edit began with the word selected ("Overview", one word), not the ARMED box the first press already mounted
  // (whose first key would replace the text too): the world no longer armed, the editor's selection the word (Tiptap's
  // root carries its editor)
  await expect(tab.locator('[data-design-world][data-armed]')).toHaveCount(0);
  type WithEditor = { editor: { state: { selection: { from: number; to: number }; doc: { textBetween(from: number, to: number): string } } } };
  await expect.poll(() => box.evaluate((n) => ((s) => s.doc.textBetween(s.selection.from, s.selection.to))((n as unknown as WithEditor).editor.state))).toBe('Overview');
  await page.keyboard.type('Summary');
  await expect.poll(async () => plain(await elementOf(page, id, 'desktop', 'head'))).toBe('Summary');
  await page.keyboard.press('Escape');
  await expect(tab.locator('[data-design-world][data-armed]')).toHaveCount(1);
  expect(launch!.consoleErrors()).toEqual([]);
});

test('a held board is drawn labelled and never written; Theme restyles every board through the document medium', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);
  const tab = await openFromLibrary(page, 'Launch screens', id);

  // the held board: labelled, its frame selected but not moved, no handles, its inspector values locked, its reasons shown
  const held = tab.locator('[data-board-id="broken"]');
  await expect(held).toHaveAttribute('data-held', '');
  const bt = await centre(tab.locator('[data-board-title="broken"]'));
  await drag(page, bt, { x: bt.x + 60, y: bt.y });
  await expect(held).toHaveAttribute('data-frame-selected', 'true');
  expect(await frameOf(page, id, 'broken')).toEqual(frameOnly('broken'));
  await expect(tab.locator('[data-board-handle]')).toHaveCount(0);
  await expect(tab.getByRole('textbox', { name: 'Board X' })).toBeDisabled();
  await expect(tab.locator('[data-held-banner]')).toContainText('blink');

  // Theme: an override of the background recolours every board (the deck root's dsOverrides, the document medium's scope)
  await headerAction(page, 'Theme');
  const theme = tab.locator('[data-deck-rail="theme"]');
  await expect(theme).toBeVisible();
  const background = theme.getByRole('textbox', { name: 'Background', exact: true });
  await background.fill('#123456');
  await background.press('Enter');
  for (const b of ['phone', 'tablet', 'desktop', 'poster']) await expect.poll(() => tab.locator(`[data-board-id="${b}"] .maws-slide`).evaluate((n) => getComputedStyle(n).backgroundColor), { message: b }).toBe('rgb(18, 52, 86)');
  await expect.poll(async () => JSON.parse((await page.evaluate((a) => (window as unknown as { __maws_design: { files(a: string): Promise<Record<string, string>> } }).__maws_design.files(a), id))['project/canvas.json']!).dsOverrides).toEqual({ '--ds-color-bg': '#123456' });
  // every board in the document medium, not the deck's: a type role's size is the document's screen size (E0 (f): the
  // house h1 is 26 px in the document medium, 72 px in the deck's)
  for (const b of ['phone', 'poster']) expect(await tab.locator(`[data-board-id="${b}"] .maws-slide`).evaluate((n) => Number.parseFloat(getComputedStyle(n).getPropertyValue('--ds-type-h1-size')))).toBeLessThan(40);

  expect(launch!.consoleErrors()).toEqual([]);
});

// M6 (product evidence for the owner's sitting): M4's comments and history surfaces and M5's Export sheet, wide and
// narrow, a screenshot and the editor's measured geometry kept first, then the bounds every surface keeps (nothing
// sideways out of the editor, the rails inside it, the card and the sheet on the window). A comment goes to the session
// the main area shows (B's rule); while the main area shows the design's own tab, to the design's own context (P3-F,
// L230; H's owner-start policy as the document's and the deck's): this design, the owner's in no Space and no project,
// has none, so its new comment shows the card's notice saying why and starts nothing, and Close withdraws the comment.
// The wide comment card is the panel's, maximized beside the chat the main area shows, and the narrow surfaces are the
// panel at its own width beside that chat.
test('the comments, history and Export sheet surfaces, wide and narrow: evidence first, then their bounds', async () => {
  test.setTimeout(300_000);
  const page = await ready();
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);
  await editDesign(page, id, { op: 'addThread', threadId: 'board', boardId: 'phone', elementId: '', body: 'Is this the launch screen?' });
  await editDesign(page, id, { op: 'addThread', threadId: 'box', boardId: 'desktop', elementId: 'a', body: 'A softer red?' });
  await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Draft' });
  await editDesign(page, id, { op: 'setFrame', boardId: 'desktop', frame: { y: 300 } });
  await editDesign(page, id, { op: 'setStyle', boardId: 'desktop', elementId: 'a', props: { background: '#cc4444' } });
  await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Reviewed' });
  const { panel, inPanel, inMain } = await inPanelAndTab(page, id);
  const mainRegion = page.locator('[data-region="main"]');
  const bounds: [string, SurfaceGeometry][] = [];
  const keep = async (name: string, body: Locator, shot: Locator | null) => bounds.push([name, await surfaceEvidence(page, name, body, shot)]);
  const toolbarOf = (body: Locator) => body.getByRole('toolbar', { name: 'Design' });

  const commentsRail = async (surface: string, body: Locator, shot: Locator) => {
    await toolbarOf(body).getByRole('button', { name: /^Comments/ }).click();
    const rail = body.getByRole('complementary', { name: 'Comments' });
    await expect(rail.locator('article[data-thread]')).toHaveCount(2);
    await keep(`design-comments-rail-${surface}`, body, shot);
    await toolbarOf(body).getByRole('button', { name: /^Comments/ }).click();
    await expect(rail).toHaveCount(0);
  };
  const commentCard = async (surface: string, body: Locator, region: 'main' | 'panel') => {
    await body.getByRole('button', { name: 'Board Phone', exact: true }).click(); // its frame selected
    await expect.poll(async () => (await viewOf(page, id, region)).frame).toBe('phone');
    await toolbarOf(body).getByRole('button', { name: 'Add comment', exact: true }).click();
    const card = page.locator('[data-comment-card]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-anchor-locator', 'Phone');
    await keep(`design-comments-card-${surface}`, body, null);
    await page.keyboard.press('Escape'); // focus is in the card's field
    await expect(card).toHaveCount(0);
  };
  const history = async (surface: string, body: Locator, shot: Locator, region: 'main' | 'panel') => {
    await headerAction(page, 'Version history', region);
    const rail = body.getByRole('complementary', { name: 'Version history' });
    await expect(rail).toBeVisible();
    for (const fold of await rail.getByRole('button', { name: /^\d+ more versions?$/ }).all()) await fold.click();
    await rail.getByRole('button', { name: /^Version Draft by You/ }).click();
    const bar = body.getByRole('toolbar', { name: 'Version preview' });
    await expect(bar.locator('.deck-history-heading')).toContainText('Draft');
    await rail.getByRole('button', { name: /^Version Reviewed by You/ }).click({ modifiers: ['Shift'] });
    await expect(bar.locator('.deck-history-heading')).toHaveText('Draft → Reviewed');
    await expect(body.getByRole('region', { name: 'Design in this version' }).locator('[data-history-board="desktop"]')).toHaveAttribute('data-history-change', 'changed');
    await keep(`design-history-compare-${surface}`, body, shot);
    await bar.getByRole('button', { name: 'Back to design' }).click();
    await expect(toolbarOf(body)).toBeVisible();
    await headerAction(page, 'Version history', region);
    await expect(rail).toHaveCount(0);
  };
  const exportSheet = async (surface: string, body: Locator, region: 'main' | 'panel') => {
    await body.locator('[data-board-title="poster"]').click(); // its frame selected: what Export takes
    await expect.poll(async () => (await viewOf(page, id, region)).frame).toBe('poster');
    await exportEntry(page, 'PNG (selected board)', region);
    const sheet = page.getByRole('dialog', { name: 'Export “Poster” at 91.02%?' });
    await expect(sheet).toBeVisible();
    await keep(`design-export-sheet-${surface}`, body, null);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  };

  await test.step('wide, the design’s main tab: the comments rail, a new comment’s notice (no session shown, no context), history, the Export sheet', async () => {
    await commentsRail('wide', inMain, mainRegion);
    // P3-F (L230): the design's own context decides; none here, so the notice in the card's place says why
    await inMain.getByRole('button', { name: 'Board Phone', exact: true }).click(); // its frame selected
    await expect.poll(async () => (await viewOf(page, id, 'main')).frame).toBe('phone');
    await toolbarOf(inMain).getByRole('button', { name: 'Add comment', exact: true }).click();
    const notice = inMain.locator('[data-comment-context]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('role', 'dialog');
    await expect(notice).toHaveAttribute('data-comment-context', 'none');
    await expect(notice).toContainText(NO_SESSION_CONTEXT);
    await expect(page.locator('[data-comment-card]'), 'no composing card without a session').toHaveCount(0);
    await expect.poll(async () => (await threadsOf(page, id)).length, { message: 'the board’s new thread while the notice stands' }).toBe(3);
    await notice.getByRole('button', { name: 'Close' }).click();
    await expect(notice).toHaveCount(0);
    await expect.poll(async () => (await threadsOf(page, id)).map((t) => t.id).sort(), { message: 'the unsent comment withdrawn' }).toEqual(['board', 'box']);
    await history('wide', inMain, mainRegion, 'main');
    await exportSheet('wide', inMain, 'main');
  });

  // the main area back on the chat: comments in the panel go to it
  const chat = mainTab(page, /^New chat/);
  await chat.click();
  await expect(chat).toHaveAttribute('aria-selected', 'true');
  await expect(inPanel.locator('[data-design-editor]')).toBeVisible();

  await test.step('wide, the panel maximized beside the chat: a board’s new comment card', async () => {
    await panel.getByRole('button', { name: 'Expand surface' }).click();
    await expect.poll(async () => (await inPanel.boundingBox())?.width ?? 0, { message: 'the maximized panel lays the editor out wide' }).toBeGreaterThanOrEqual(720);
    await commentCard('wide', inPanel, 'panel');
    await panel.getByRole('button', { name: 'Restore surface' }).click();
    await expect.poll(async () => (await inPanel.boundingBox())?.width ?? Infinity).toBeLessThan(720);
  });

  await test.step('narrow, the panel beside the chat: the comments rail and card, history, the Export sheet', async () => {
    await commentsRail('narrow', inPanel, panel);
    await commentCard('narrow', inPanel, 'panel');
    await history('narrow', inPanel, panel, 'panel');
    await exportSheet('narrow', inPanel, 'panel');
  });

  for (const [name, geometry] of bounds) expectSurfaceBounds(name, geometry);
  expect(launch!.consoleErrors()).toEqual([]);
});

// M6 (acceptance 2: "an edit patches the other replica within a frame"): the panel's replica receives the main tab's edit
// through its port; the probe, armed on the panel before the edit, notes the inbound transaction's start in the replica's
// own `beforeTransaction` (origin its PortProvider), asks the next animation frame then, and reads the panel's DOM at that
// sentinel, with a MutationObserver noting when the values first stood. No layout or style is forced, no flush is called,
// and no text box is open on the panel (a composition hold would hold the frame by design).
test('an edit in one replica patches the other within a frame: a board’s geometry and an element’s fill, on the panel before its next animation frame', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const id = await createDesign(page, 'Launch screens', DESIGN_FILES);
  const { inPanel, inMain } = await inPanelAndTab(page, id);
  for (const where of [inMain, inPanel]) await expect(where.locator('[data-board-id] .maws-slide[data-board]')).toHaveCount(ORDER.length);
  const results: Record<string, FrameProbeResult> = {};

  await test.step('geometry: the tablet moved through the main tab’s inspector', async () => {
    await inMain.locator('[data-board-title="tablet"]').click();
    const boardX = inMain.getByRole('textbox', { name: 'Board X' });
    await expect(boardX).toHaveValue('490');
    const probe = await armFrameProbe(page, id, 'panel', { kind: 'frame', boardId: 'tablet', key: 'x', value: 600 }, [{ selector: '[data-board-id="tablet"]', style: 'left', equals: '600px' }]);
    await boardX.fill('600');
    await boardX.press('Enter');
    results.geometry = await frameProbeResult(page, probe);
  });

  await test.step('content: the desktop’s red box filled blue through the main tab’s inspector', async () => {
    await inMain.getByRole('button', { name: 'Board Desktop options' }).click();
    await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
    const d = await boardAt(inMain, 'desktop', frameOnly('desktop'));
    const point = d.at(300, 560);
    expect(await inMain.locator('[data-board-id="desktop"] .design-board-canvas [data-eid="a"]').evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit !== null && (hit === element || element.contains(hit));
    }, point), 'the measured desktop box is exposed, not underneath the Boards sheet').toBe(true);
    await page.mouse.click(point.x, point.y); // the inactive desktop activated, its box selected
    await expect.poll(async () => (await viewOf(page, id, 'main')).selection).toEqual(['a']);
    const probe = await armFrameProbe(page, id, 'panel', { kind: 'style', boardId: 'desktop', elementId: 'a', prop: 'background', value: '#0000ff' }, [{ selector: '[data-board-id="desktop"] .design-board-canvas [data-eid="a"]', style: 'background-color', equals: 'rgb(0, 0, 255)' }]);
    const fill = inMain.getByRole('complementary', { name: 'Inspector' }).getByRole('textbox', { name: 'Fill colour' });
    await fill.fill('rgb(0, 0, 255)');
    await fill.press('Enter');
    results.content = await frameProbeResult(page, probe);
  });

  // the evidence first, then the bounds: milliseconds are remote-transaction-start to DOM-observed on the panel, and to the
  // sentinel frame's callback; not port arrival
  await test.info().attach('design-frame-proof', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  for (const [what, r] of Object.entries(results))
    console.log(`[design frame] ${what}: remote-transaction-start → DOM observed ${r.domObservedMs?.toFixed(2) ?? 'never'} ms, → sentinel frame ${r.sentinelMs.toFixed(2)} ms (${r.inbound} inbound transaction${r.inbound === 1 ? '' : 's'} while armed)`);
  for (const [what, r] of Object.entries(results)) {
    expect(r.atSentinel.filter((v) => !v.ok), `${what}: every expected value stood at the sentinel`).toEqual([]);
    expect(r.domObservedMs, `${what}: the panel's DOM took the values before the sentinel`).not.toBeNull();
    expect(r.domObservedMs!, what).toBeLessThanOrEqual(r.sentinelMs);
    expect(r.withinFrame, what).toBe(true);
  }
  await expect(inPanel.locator('[data-board-id="tablet"]')).toHaveCSS('left', '600px');
  expect(launch!.consoleErrors()).toEqual([]);
});
