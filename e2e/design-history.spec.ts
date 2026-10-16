// A design's version history in the product build (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4,
// acceptance 4; part of `pnpm e2e:design`). A design is created by the human's `artifacts.create`, seeded from files
// through the renderer's seam, named in a design system and versioned through A's `artifacts.saveVersion`, then changed
// (a board moved, an element restyled, an element moved across boards by an agent's session through the host's design
// seam, an element and a board deleted, the faces and the system switched) and versioned again, and opened from the
// library in a main tab:
// - the header's Version history opens B's rail; a version previews read-only in place of the live world, every board at
//   its frame in that version, the changed boards edged in the list and the world, the restyled element outlined, the
//   agent's cross-board move shown once at its destination (credited to the agent) and ghosted where it was, the deleted
//   element ghosted, the deleted board drawn where it was, "N changes" counting the move once, ↑ ↓ moving the view to each
//   change; Show changes off draws the version plainly;
// - the earlier version draws in the system pinned at it, with its own faces at its own assets; Compare by shift-click;
//   Back to design;
// - Restore brings the frames, the content and the deleted board back as a new `restore` version, with the banner, a
//   conversation since the version kept.
// The second case: "See N new changes" after an agent's cross-board move between two views, counted once.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, type MawsLaunch } from './support/launch';
import { asAgent, boardsOf, createDesign, editDesign, elementOf, filesOf, headerAction, ok, openFromLibrary, seamInstalled, seed, threadsOf } from './support/design';

let launch: MawsLaunch | null = null;
let channel: string | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (channel) rmSync(channel, { recursive: true, force: true });
  channel = null;
});

interface Row {
  id: string;
  title: string;
}
const systems = async (page: Page): Promise<Row[]> => (await ok<{ artifacts: Row[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;

async function ready(env: Record<string, string>): Promise<Page> {
  launch = await launchMaws({ env });
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1800, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => seamInstalled(page), { message: 'the seam is installed' }).toBe('object');
  await expect.poll(async () => (await systems(page)).map((s) => s.title).sort(), { timeout: 15_000, message: 'the built-in systems are seeded' }).toEqual(['Classroom', 'MAWS', 'Official']);
  return page;
}

const computed = (node: Locator, property: string) => node.evaluate((n, p) => getComputedStyle(n).getPropertyValue(p), property);
const ground = 'background:var(--ds-color-bg, #ffffff)';
const CANVAS = (face: string, spare = true) =>
  JSON.stringify({
    v: 1,
    title: 'History lab',
    faces: { brand: { family: 'History Brand', src: `assets/${face}` } },
    boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, desktop: { x: 490, y: 0, w: 1440, h: 1024, title: 'Desktop' }, ...(spare && { spare: { x: 2030, y: 0, w: 800, h: 600, title: 'Spare' } }) },
    order: ['phone', 'desktop', ...(spare ? ['spare'] : [])],
  });
const FILES: Record<string, string> = {
  'project/canvas.json': CANVAS('brand-draft.woff2'),
  'project/boards/phone.html': `<section id="phone" style="${ground}; padding:24px"><h1 id="title" style="color:var(--ds-color-text, #111111)">Launch</h1><p id="lede">Ship the first week.</p></section>`,
  'project/boards/desktop.html': `<section id="desktop" style="${ground}; padding:64px"><h2 id="head" style="color:var(--ds-color-text, #111111)">Overview</h2><div id="gone" style="position:absolute; left:200px; top:500px; width:300px; height:120px; background:#eef2ff">To be cut</div></section>`,
  'project/boards/spare.html': `<section id="spare" style="${ground}"><p id="extra">Extra</p></section>`,
};

test('history per board: the rail, a version’s changes in its world and list, a cross-board move once, its pinned system, compare, restore', async () => {
  test.setTimeout(240_000);
  channel = mkdtempSync(join(tmpdir(), 'maws-design-history-'));
  const page = await ready({ MAWS_DESIGN_HISTORY: channel });
  const id = await createDesign(page, 'History lab', FILES);
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  const maws = (await systems(page)).find((s) => s.title === 'MAWS')!;
  await ok(page, 'artifacts.update', { artifactId: id, designSystemId: official.id });
  const tab = await openFromLibrary(page, 'History lab', id);
  const liveHead = tab.locator('[data-design-world] [data-board-id="desktop"] [data-eid="head"]');
  await expect.poll(() => computed(liveHead, 'color')).not.toBe('');
  const inOfficial = await computed(liveHead, 'color');
  const draft = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Draft' });
  await editDesign(page, id, { op: 'addThread', threadId: 'late', boardId: 'desktop', elementId: '', body: 'Wider margins?' });

  // after the version: the desktop moved, its heading restyled, the agent's cross-board move, a cut, a board deleted,
  // the faces and the system switched
  await editDesign(page, id, { op: 'setFrame', boardId: 'desktop', frame: { y: 300 } });
  await editDesign(page, id, { op: 'setStyle', boardId: 'desktop', elementId: 'head', props: { 'font-size': '64px' } });
  const { moved } = await asAgent(channel, id, { op: 'move', from: 'phone', to: 'desktop', elementId: 'lede' });
  const files = await filesOf(page, id);
  await seed(page, id, {
    ...files,
    'project/canvas.json': JSON.stringify({ ...JSON.parse(files['project/canvas.json']!), faces: { brand: { family: 'History Brand', src: 'assets/brand-reviewed.woff2' } } }),
    'project/boards/desktop.html': files['project/boards/desktop.html']!.replace(/<div id="gone"[^>]*>To be cut<\/div>/, ''),
  });
  expect(await elementOf(page, id, 'desktop', 'gone')).toBeUndefined();
  await tab.getByRole('button', { name: 'Board Spare options' }).click();
  await page.getByRole('menuitem', { name: 'Delete board' }).click();
  await expect.poll(async () => (await boardsOf(page, id)).map((b) => b.id)).toEqual(['phone', 'desktop']);
  await ok(page, 'artifacts.update', { artifactId: id, designSystemId: maws.id });
  await expect.poll(() => computed(liveHead, 'color')).not.toBe(inOfficial);
  await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Reviewed' });

  const header = page.locator('[data-region="main"] [data-editor-header]');
  const rail = tab.getByRole('complementary', { name: 'Version history' });
  const bar = tab.getByRole('toolbar', { name: 'Version preview' });
  const world = tab.getByRole('region', { name: 'Design in this version' });
  const list = tab.getByRole('navigation', { name: 'Boards in this version' });

  await test.step('the header’s Version history opens B’s rail, listing A’s versions', async () => {
    await headerAction(page, 'Version history');
    await expect(rail).toBeVisible();
    for (const fold of await rail.getByRole('button', { name: /^\d+ more versions?$/ }).all()) await fold.click();
    await expect(rail.getByRole('button', { name: /^Version Draft by You/ })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Version history', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('a version previews read-only: its world and list edged, the restyle outlined, the move once with its ghost, the cut ghosted, the deleted board where it was', async () => {
    await rail.getByRole('button', { name: /^Version Reviewed by You/ }).click();
    await expect(bar).toBeVisible();
    await expect(bar.locator('.deck-history-heading')).toContainText('Reviewed');
    await expect(tab.getByRole('toolbar', { name: 'Design' })).toHaveCount(0); // the editor's tools are gone: read-only
    await expect(tab.locator('[data-active-board]')).toHaveCount(0);
    // the faces, the desktop's frame, its heading, the move (once), the cut, the deleted board
    await expect(bar.locator('[data-history-count]')).toHaveText('6 changes');
    await expect(tab.locator('.deck-history-deck')).toContainText('faces');
    for (const [board, kind] of [['phone', 'changed'], ['desktop', 'changed'], ['spare', 'removed']] as const) {
      await expect(world.locator(`[data-history-board="${board}"]`)).toHaveAttribute('data-history-change', kind);
      await expect(list.locator(`[data-history-board-row="${board}"]`)).toHaveAttribute('data-history-change', kind);
    }
    await expect(world.locator('[data-history-board="desktop"]')).toHaveAttribute('style', /top: 300px/); // the version's frame
    const move = world.locator(`[data-history-mark="${moved}"]`);
    await expect(move).toHaveAttribute('data-kind', 'moved');
    await expect(move).toHaveAttribute('title', /Moved from Phone.*Claude/);
    await expect(world.locator('[data-history-mark="lede"]')).toHaveAttribute('data-kind', 'movedAway');
    await expect(world.locator('[data-history-board="phone"] .deck-history-ghosts [data-eid="lede"][data-ghost]')).toBeVisible();
    await expect(world.locator('[data-history-mark="head"]')).toHaveAttribute('data-kind', 'changed');
    await expect(world.locator('[data-history-mark="gone"]')).toHaveAttribute('data-kind', 'removed');
    await expect(world.locator('[data-history-board="desktop"] .deck-history-ghosts [data-eid="gone"][data-ghost]')).toContainText('To be cut');
    // a mark sits on its element as drawn
    const [m, el] = [await move.boundingBox(), await world.locator(`[data-history-board="desktop"] .design-board-canvas [data-eid="${moved}"]`).boundingBox()];
    expect(Math.abs(m!.x - el!.x)).toBeLessThan(3);
    expect(Math.abs(m!.width - el!.width)).toBeLessThan(3);

    // ↓: the design's settings first, then the desktop's frame, its board brought into view
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(tab.locator('.deck-history-deck')).toHaveAttribute('data-focused', 'true');
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(world.locator('[data-history-board="desktop"]')).toHaveAttribute('data-focused', 'true');
    const [w, d] = [(await world.boundingBox())!, (await world.locator('[data-history-board="desktop"]').boundingBox())!];
    expect(d.x).toBeGreaterThanOrEqual(w.x - 1);
    expect(d.x + d.width).toBeLessThanOrEqual(w.x + w.width + 1);
  });

  await test.step('Show changes off draws the version plainly; the draft draws in the system pinned at it, with its own faces', async () => {
    await bar.getByRole('checkbox', { name: 'Show changes' }).uncheck();
    await expect(world.locator('[data-history-mark]')).toHaveCount(0);
    await expect(world.locator('[data-history-change]')).toHaveCount(0);
    await expect(world.locator('[data-history-board="spare"]')).toHaveCount(0);
    await expect(bar.locator('[data-history-count]')).toHaveCount(0);

    await rail.getByRole('button', { name: /^Version Draft by You/ }).click();
    await expect(bar.locator('.deck-history-heading')).toContainText('Draft');
    await expect.poll(() => computed(world.locator('[data-board-id="desktop"] [data-eid="head"]').first(), 'color')).toBe(inOfficial);
    const faces = tab.locator('style[data-deck-faces]');
    await expect(faces).toHaveCount(1);
    const listed = await ok<{ versions: { id: number; seq: number }[] }>(page, 'artifacts.versions', { artifactId: id });
    const draftSeq = listed.versions.find((v) => v.id === draft.versionId)!.seq;
    expect(await faces.textContent()).toContain(`/${draftSeq}/assets/brand-draft.woff2`);
    expect(await faces.textContent()).not.toContain('brand-reviewed');
    await bar.getByRole('checkbox', { name: 'Show changes' }).check();
  });

  await test.step('Compare by shift-click; Back to design', async () => {
    await rail.getByRole('button', { name: /^Version Reviewed by You/ }).click({ modifiers: ['Shift'] });
    await expect(bar.locator('.deck-history-heading')).toHaveText('Draft → Reviewed');
    await expect(bar.getByRole('button', { name: 'Restore this version' })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Back to design' }).click();
    await expect(tab.getByRole('toolbar', { name: 'Design' })).toBeVisible();
    await expect.poll(() => computed(liveHead, 'color')).not.toBe(inOfficial); // the live design in its system again
    expect(await tab.locator('style[data-deck-faces]').textContent()).toContain('brand-reviewed.woff2');
  });

  await test.step('Restore brings the frames, the content and the deleted board back as a new restore version, a later conversation kept', async () => {
    await asAgent(channel!, id, { op: 'reply', threadId: 'late', body: 'Margins widened.' });
    if (!(await rail.isVisible())) await headerAction(page, 'Version history');
    await rail.getByRole('button', { name: /^Version Draft by You/ }).click();
    await bar.getByRole('button', { name: 'Restore this version' }).click();
    await tab.getByRole('alertdialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
    await expect(tab.getByRole('toolbar', { name: 'Design' })).toBeVisible();
    await expect.poll(async () => (await boardsOf(page, id)).map((b) => [b.id, b.frame?.y])).toEqual([
      ['phone', 0],
      ['desktop', 0],
      ['spare', 0],
    ]);
    expect(await elementOf(page, id, 'phone', 'lede')).toBeDefined();
    expect(await elementOf(page, id, 'desktop', moved!)).toBeUndefined();
    expect(await elementOf(page, id, 'desktop', 'gone')).toBeDefined();
    expect((await elementOf(page, id, 'desktop', 'head'))?.style['font-size']).toBeUndefined();
    const after = await ok<{ versions: { kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
    expect(after.versions).toContainEqual(expect.objectContaining({ kind: 'restore', label: 'Restored from Draft' }));
    await expect(tab.getByRole('status', { name: 'Restored' })).toContainText('Restored from Draft');
    const late = (await threadsOf(page, id)).find((t) => t.id === 'late')!;
    expect(late.messages.map((m) => m.body)).toEqual(['Wider margins?', 'Margins widened.']);
  });

  expect(launch!.consoleErrors()).toEqual([]);
});

test('See N new changes: an agent’s cross-board move between two views is offered as one new change', async () => {
  test.setTimeout(120_000);
  channel = mkdtempSync(join(tmpdir(), 'maws-design-history-'));
  const page = await ready({ MAWS_DESIGN_HISTORY: channel });
  const id = await createDesign(page, 'Pill lab', FILES);

  // the first view: the design drawn in a main tab records the owner's view (L's onShown, then the rail's markViewed)
  let tab = await openFromLibrary(page, 'Pill lab', id);
  await expect.poll(async () => (await ok<{ artifact: { lastViewedAt: number | null } }>(page, 'artifacts.get', { artifactId: id })).artifact.lastViewedAt).not.toBeNull();
  await expect(tab.locator('.deck-history-pill')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Pill lab', exact: true }).click();
  await expect(tab).toHaveCount(0);

  // between the views the agent moves an element across boards (one removal and one addition to C, one move here)
  const { moved } = await asAgent(channel, id, { op: 'move', from: 'phone', to: 'desktop', elementId: 'lede' });
  const versions = await ok<{ versions: { kind: string; actor: { kind: string } }[] }>(page, 'artifacts.versions', { artifactId: id });
  expect(versions.versions.at(-1)).toEqual(expect.objectContaining({ kind: 'auto', actor: expect.objectContaining({ kind: 'session' }) }));

  tab = await openFromLibrary(page, 'Pill lab', id);
  const pill = tab.locator('.deck-history-pill');
  await expect(pill.getByRole('button', { name: 'See 1 new change' })).toBeVisible();
  await pill.getByRole('button', { name: 'See 1 new change' }).click();
  const bar = tab.getByRole('toolbar', { name: 'Version preview' });
  await expect(bar.locator('.deck-history-heading')).toHaveText('Changes since you last looked');
  await expect(bar.locator('[data-history-count]')).toHaveText('1 change');
  const mark = tab.getByRole('region', { name: 'Design in this version' }).locator(`[data-history-mark="${moved}"]`);
  await expect(mark).toHaveAttribute('data-kind', 'moved');
  await expect(mark).toHaveAttribute('title', /Claude/); // the agent, by the session's title or "Claude"
  await expect(bar.getByRole('button', { name: 'Restore this version' })).toHaveCount(0); // the live design: nothing to restore
});
