// A design's version history in the product build (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4,
// acceptance 4; part of `pnpm e2e:design`). A design is created by the human's `artifacts.create`, given two real faces
// as uploaded assets (KaTeX's Main and Typewriter, shipped with the app's dependencies: their drawn widths tell them
// apart), seeded from files through the renderer's seam with its family mapped to the first, named in a design system
// and versioned through A's `artifacts.saveVersion`; then changed (a board moved, an element restyled, an element moved
// across boards by an agent's session through the host's design seam, an element and a board deleted, the family
// re-mapped to the second face and the system switched) and versioned again, and opened from the library in a main tab:
// - the header's Version history opens B's rail; the two versions compared (a click, then a shift-click: a version alone
//   previews against the version just before it, here the agent's own `auto` version) draw read-only in place of the
//   live world, every board at its frame in the later one, the changed boards edged in the list and the world, the
//   restyled element outlined, the agent's cross-board move shown once at its destination (credited to the agent) and
//   ghosted where it was, the deleted element ghosted, the deleted board drawn where it was, "N changes" counting the
//   move once, ↑ ↓ moving the view to each change; Show changes off draws the version plainly;
// - the earlier version alone draws in the system pinned at it and with its own face at its own revision, drawn: the
//   face's text measures as the first face while the live design draws the second; Back to design;
// - Restore brings the frames, the content and the deleted board back as a new `restore` version, with the banner, a
//   conversation since the version kept; no console error throughout.
// The second case: "See N new changes" after an agent's cross-board move between two views, counted once.
import { constants, existsSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { asAgent, boardsOf, createDesign, DESIGN_FILES, editDesign, elementOf, filesOf, headerAction, ok, openFromLibrary, pinOffset, plain, seamInstalled, seed, threadsOf } from './support/design';

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
// a bundled system's text colour as the heading resolves it (the token its `var(--ds-color-text, …)` reads; C's spec's way)
const bundled = (key: string) => JSON.parse(readFileSync(join(REPO_ROOT, `src/artifacts/types/design_system/defaults/${key}/tokens.tokens.json`), 'utf8')) as { color: { text: { $root: { $value: { hex: string } } } } };
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
const TEXT_IN = { official: rgbOf(bundled('official').color.text.$root.$value.hex), maws: rgbOf(bundled('maws').color.text.$root.$value.hex) };
const KATEX = (file: string) => [...readFileSync(join(REPO_ROOT, 'node_modules/katex/dist/fonts', file))];
async function upload(page: Page, artifactId: string, name: string, file: string): Promise<string> {
  return page.evaluate(
    async ([a, n, bytes]) => {
      const result = (await (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean; value: { ref: string } }> } }).maws.invoke('artifacts.uploadAsset', { artifactId: a, name: n, mime: 'font/woff2', bytes: new Uint8Array(bytes as number[]) })) as { ok: boolean; value: { ref: string } };
      return result.value.ref;
    },
    [artifactId, name, KATEX(file)] as const,
  );
}
/** The probe's drawn width in board px on a world (its board's zoom divided out), once it has stopped changing. */
async function settledWidth(world: Locator): Promise<number> {
  const width = async () => {
    const board = (await world.locator('[data-board-id="desktop"]').first().boundingBox())!;
    const probe = (await world.locator('[data-board-id="desktop"] .design-board-canvas [data-eid="probe"]').first().boundingBox())!;
    return Math.round(probe.width / (board.width / 1440));
  };
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await width();
        const same = now === last;
        last = now;
        return same;
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBe(true);
  return last;
}

const ground = 'background:var(--ds-color-bg, #ffffff)';
const CANVAS = (face: string | null) =>
  JSON.stringify({
    v: 1,
    title: 'History lab',
    ...(face && { faces: { brand: { family: 'History Brand', src: face } } }),
    boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, desktop: { x: 490, y: 0, w: 1440, h: 1024, title: 'Desktop' }, spare: { x: 2030, y: 0, w: 800, h: 600, title: 'Spare' } },
    order: ['phone', 'desktop', 'spare'],
  });
const FILES = (face: string | null): Record<string, string> => ({
  'project/canvas.json': CANVAS(face),
  'project/boards/phone.html': `<section id="phone" style="${ground}; padding:24px"><h1 id="title" style="color:var(--ds-color-text, #111111)">Launch</h1><p id="lede">Ship the first week.</p></section>`,
  'project/boards/desktop.html': `<section id="desktop" style="${ground}; padding:64px"><h2 id="head" style="color:var(--ds-color-text, #111111)">Overview</h2><p id="gone" style="position:absolute; left:200px; top:500px; width:300px; height:120px; background:#eef2ff">To be cut</p><p id="probe" style="position:absolute; left:64px; top:700px; font-size:96px; font-family:'History Brand', serif">iiiiiiiiiiiiiiii</p></section>`,
  'project/boards/spare.html': `<section id="spare" style="${ground}"><p id="extra">Extra</p></section>`,
});

test('history per board: the rail, two versions’ changes in the world and list, a cross-board move once, the pinned system and face, restore', async () => {
  test.setTimeout(240_000);
  channel = mkdtempSync(join(tmpdir(), 'maws-design-history-'));
  const page = await ready({ MAWS_DESIGN_HISTORY: channel });
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'design', title: 'History lab' });
  const id = artifact.id;
  const serifRef = await upload(page, id, 'brand-serif.woff2', 'KaTeX_Main-Regular.woff2');
  const monoRef = await upload(page, id, 'brand-mono.woff2', 'KaTeX_Typewriter-Regular.woff2');
  await seed(page, id, FILES(serifRef));
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  const maws = (await systems(page)).find((s) => s.title === 'MAWS')!;
  await ok(page, 'artifacts.update', { artifactId: id, designSystemId: official.id });
  const tab = await openFromLibrary(page, 'History lab', id);
  const liveWorld = tab.locator('[data-design-world]');
  const liveHead = liveWorld.locator('[data-board-id="desktop"] [data-eid="head"]');
  // the governing system's style arrives after the first draw (the heading reads its authored fallback until then): wait
  // for Official's own text colour, not for any colour
  const inOfficial = TEXT_IN.official;
  expect(inOfficial).not.toBe(TEXT_IN.maws);
  expect(inOfficial).not.toBe('rgb(17, 17, 17)'); // the heading's authored fallback, #111111
  await expect.poll(() => computed(liveHead, 'color'), { timeout: 15_000 }).toBe(inOfficial);
  const serif = await settledWidth(liveWorld); // the first face, live
  const draft = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Draft' });
  await editDesign(page, id, { op: 'addThread', threadId: 'late', boardId: 'desktop', elementId: '', body: 'Wider margins?' });

  // after the version: the desktop moved, its heading restyled, the agent's cross-board move, a cut, a board deleted,
  // the family re-mapped to the second face and the system switched
  await editDesign(page, id, { op: 'setFrame', boardId: 'desktop', frame: { y: 300 } });
  await editDesign(page, id, { op: 'setFrame', boardId: 'phone', frame: { w: 430, h: 932 } }); // M6: a resize alone
  await editDesign(page, id, { op: 'setStyle', boardId: 'desktop', elementId: 'head', props: { 'font-size': '64px' } });
  const { moved } = await asAgent(channel, id, { op: 'move', from: 'phone', to: 'desktop', elementId: 'lede' });
  const files = await filesOf(page, id);
  await seed(page, id, {
    ...files,
    'project/canvas.json': JSON.stringify({ ...JSON.parse(files['project/canvas.json']!), faces: { brand: { family: 'History Brand', src: monoRef } } }),
    'project/boards/desktop.html': files['project/boards/desktop.html']!.replace(/<p id="gone"[^>]*>To be cut<\/p>/, ''),
  });
  expect(await elementOf(page, id, 'desktop', 'gone')).toBeUndefined();
  await tab.getByRole('button', { name: 'Board Spare options' }).click();
  await page.getByRole('menuitem', { name: 'Delete board' }).click();
  await expect.poll(async () => (await boardsOf(page, id)).map((b) => b.id)).toEqual(['phone', 'desktop']);
  await ok(page, 'artifacts.update', { artifactId: id, designSystemId: maws.id });
  await expect.poll(() => computed(liveHead, 'color'), { timeout: 15_000 }).toBe(TEXT_IN.maws);
  const mono = await settledWidth(liveWorld); // the second face, live
  expect(Math.abs(mono - serif), `the two faces draw the probe apart (serif ${serif}, mono ${mono})`).toBeGreaterThan(serif * 0.2);
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
    await expect(rail.getByRole('button', { name: /^Version Reviewed by You/ })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Version history', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('Draft and Reviewed compared: the world and list edged, the restyle outlined, the move once with its ghost, the cut ghosted, the deleted board where it was', async () => {
    await rail.getByRole('button', { name: /^Version Draft by You/ }).click();
    await expect(bar.locator('.deck-history-heading')).toContainText('Draft');
    await rail.getByRole('button', { name: /^Version Reviewed by You/ }).click({ modifiers: ['Shift'] });
    await expect(bar.locator('.deck-history-heading')).toHaveText('Draft → Reviewed');
    await expect(bar.getByRole('button', { name: 'Restore this version' })).toHaveCount(0); // two versions: nothing to restore
    await expect(tab.getByRole('toolbar', { name: 'Design' })).toHaveCount(0); // the editor's tools are gone: read-only
    await expect(tab.locator('[data-active-board]')).toHaveCount(0);
    // the face's mapping, the phone's size, the desktop's frame, its heading, the move (once; C reads it as two), the cut,
    // the deleted board
    await expect(bar.locator('[data-history-count]')).toHaveText('7 changes');
    await expect(tab.locator('.deck-history-deck')).toHaveCount(0);
    for (const [board, kind] of [['phone', 'changed'], ['desktop', 'changed'], ['spare', 'removed']] as const) {
      await expect(world.locator(`[data-history-board="${board}"]`)).toHaveAttribute('data-history-change', kind);
      await expect(list.locator(`[data-history-board-row="${board}"]`)).toHaveAttribute('data-history-change', kind);
    }
    await expect(world.locator('[data-history-board="desktop"]')).toHaveAttribute('style', /top: 300px/); // the later version's frame
    // M6: the resize alone: the phone's frame drawn at its new size, named a size change (its position unchanged)
    const phoneBoard = world.locator('[data-history-board="phone"]');
    await expect(phoneBoard).toHaveAttribute('style', /left: 0px; top: 0px; width: 430px; height: 932px/);
    await expect(phoneBoard).toHaveAttribute('title', 'size');
    await expect(world.locator('[data-history-title="phone"]')).toContainText('430 × 932');
    await expect(world.locator('[data-history-board="desktop"]')).toHaveAttribute('title', 'position');
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

    // ↓: the design's settings first, then the phone's size, then the desktop's frame, its board brought into view
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(tab.locator('.deck-history-deck')).toHaveCount(0);
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(phoneBoard).toHaveAttribute('data-focused', 'true');
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(world.locator('[data-history-board="desktop"]')).toHaveAttribute('data-focused', 'true');
    const [w, d] = [(await world.boundingBox())!, (await world.locator('[data-history-board="desktop"]').boundingBox())!];
    expect(d.x).toBeGreaterThanOrEqual(w.x - 1);
    expect(d.x + d.width).toBeLessThanOrEqual(w.x + w.width + 1);

    // Show changes off draws the later version plainly
    await bar.getByRole('checkbox', { name: 'Show changes' }).uncheck();
    await expect(world.locator('[data-history-mark]')).toHaveCount(0);
    await expect(world.locator('[data-history-change]')).toHaveCount(0);
    await expect(world.locator('[data-history-board="spare"]')).toHaveCount(0);
    await expect(bar.locator('[data-history-count]')).toHaveCount(0);
  });

  await test.step('the draft alone draws in the system pinned at it, with its own face at its own revision, drawn', async () => {
    await rail.getByRole('button', { name: /^Version Draft by You/ }).click();
    await expect(bar.locator('.deck-history-heading')).not.toContainText('→');
    await expect(bar.locator('.deck-history-heading')).toContainText('Draft');
    await expect.poll(() => computed(world.locator('[data-board-id="desktop"] .design-board-canvas [data-eid="head"]').first(), 'color'), { timeout: 15_000 }).toBe(inOfficial);
    const faces = tab.locator('style[data-deck-faces]');
    await expect(faces).toHaveCount(1);
    const listed = await ok<{ versions: { id: number; seq: number }[] }>(page, 'artifacts.versions', { artifactId: id });
    const draftSeq = listed.versions.find((v) => v.id === draft.versionId)!.seq;
    expect(await faces.textContent()).toContain(`/${draftSeq}/${serifRef}`);
    // the draft's face is the one drawn: its probe measures as the first face, not as the live design's second
    const drawn = await settledWidth(world);
    expect(Math.abs(drawn - serif), `the draft's probe (${drawn}) draws the first face (${serif})`).toBeLessThanOrEqual(serif * 0.02);
    expect(Math.abs(drawn - mono)).toBeGreaterThan(serif * 0.2);
  });

  await test.step('Back to design: the live design in its system and with its own face again', async () => {
    await bar.getByRole('button', { name: 'Back to design' }).click();
    await expect(tab.getByRole('toolbar', { name: 'Design' })).toBeVisible();
    await expect.poll(() => computed(liveHead, 'color'), { timeout: 15_000 }).toBe(TEXT_IN.maws);
    expect(Math.abs((await settledWidth(liveWorld)) - mono)).toBeLessThanOrEqual(mono * 0.02);
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
    expect((await boardsOf(page, id))[0]!.frame).toEqual({ x: 0, y: 0, w: 390, h: 844 }); // M6: the resize undone too
    await expect(liveWorld.locator('[data-board-id="phone"]')).toHaveCSS('width', '390px');
    expect(await elementOf(page, id, 'phone', 'lede')).toBeDefined();
    expect(await elementOf(page, id, 'desktop', moved!)).toBeUndefined();
    expect(await elementOf(page, id, 'desktop', 'gone')).toBeDefined();
    expect((await elementOf(page, id, 'desktop', 'head'))?.style['font-size']).toBeUndefined();
    const after = await ok<{ versions: { kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
    expect(after.versions).toContainEqual(expect.objectContaining({ kind: 'restore', label: 'Restored from Draft' }));
    await expect(tab.getByRole('status', { name: 'Restored' })).toContainText('Restored from Draft');
    const late = (await threadsOf(page, id)).find((t) => t.id === 'late')!;
    expect(late.messages.map((m) => m.body)).toEqual(['Wider margins?', 'Margins widened.']);
    expect(Math.abs((await settledWidth(liveWorld)) - serif)).toBeLessThanOrEqual(serif * 0.02); // the draft's face mapping again
  });

  expect(launch!.consoleErrors()).toEqual([]);
});

test('See N new changes: an agent’s cross-board move between two views is offered as one new change', async () => {
  test.setTimeout(120_000);
  channel = mkdtempSync(join(tmpdir(), 'maws-design-history-'));
  const page = await ready({ MAWS_DESIGN_HISTORY: channel });
  const id = await createDesign(page, 'Pill lab', FILES(null));

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
  expect(launch!.consoleErrors()).toEqual([]);
});

// E-acc clauses 2 (design) and 3: one carried design, a real quit/relaunch, and the linked directory produced by the app.
test('carried design survives app relaunch with geometry, in-place text, conversation, restored history, export and read-only linked files', async () => {
  test.setTimeout(240_000);
  channel = mkdtempSync(join(tmpdir(), 'maws-carried-design-'));
  const env = { MAWS_DESIGN_HISTORY: join(channel, 'agent') };
  let page = await ready(env);
  const { space } = await ok<{ space: { id: string } }>(page, 'spaces.create', { name: 'Carried launch', linkedDir: channel });
  const title = 'Carried design';
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'design', title, spaceId: space.id });
  const id = artifact.id;
  const files = { ...DESIGN_FILES };
  const manifest = JSON.parse(files['project/canvas.json']!);
  delete manifest.boards.broken;
  manifest.order = ['phone', 'tablet', 'desktop', 'poster'];
  files['project/canvas.json'] = JSON.stringify(manifest);
  delete files['project/boards/broken.html'];
  await seed(page, id, files);
  let tab = await openFromLibrary(page, title, id);
  await editDesign(page, id, { op: 'setFrame', boardId: 'phone', frame: { x: 70, y: 90, w: 420, h: 900 } });
  await editDesign(page, id, { op: 'setFrame', boardId: 'desktop', frame: { x: 1500, y: 140, w: 1500, h: 1100 } });
  const toolbar = tab.getByRole('toolbar', { name: 'Design' });
  if (!(await tab.getByRole('navigation', { name: 'Boards' }).isVisible())) await toolbar.getByRole('button', { name: 'Boards', exact: true }).click();
  await tab.getByRole('button', { name: 'Board Desktop options' }).click();
  await page.getByRole('menuitem', { name: 'Zoom to board' }).click();
  await toolbar.getByRole('button', { name: 'Boards', exact: true }).click();
  const note = tab.locator('[data-board-id="desktop"] [data-eid="note"]');
  const box = (await note.boundingBox())!;
  await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
  await expect(tab.locator('.deck-textbox')).toBeFocused();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Owner: keep this launch note.');
  await page.keyboard.press('Escape');
  await expect(note).toHaveText('Owner: keep this launch note.');
  await editDesign(page, id, { op: 'addThread', threadId: 'carried-note', boardId: 'desktop', elementId: 'note', body: 'Keep the launch date.' });
  const before = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Carried layout' });
  await asAgent(env.MAWS_DESIGN_HISTORY, id, { op: 'reply', threadId: 'carried-note', body: 'The date is confirmed.' });
  await editDesign(page, id, { op: 'setFrame', boardId: 'desktop', frame: { y: 700 } });
  await editDesign(page, id, { op: 'prependText', boardId: 'desktop', elementId: 'note', text: 'Discarded ' });
  await expect.poll(async () => plain(await elementOf(page, id, 'desktop', 'note'))).toBe('Discarded Owner: keep this launch note.');
  await ok(page, 'artifacts.restore', { artifactId: id, versionId: before.versionId });
  await expect(note).toHaveText('Owner: keep this launch note.', { timeout: 15_000 });
  const exported = await ok<{ path: string }>(page, 'artifacts.export', { artifactId: id, format: 'png', board: 'phone' });
  const png = readFileSync(exported.path);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([420, 900]);
  const geometry = await boardsOf(page, id);
  expect(geometry.find((b) => b.id === 'phone')!.frame).toEqual({ x: 70, y: 90, w: 420, h: 900 });
  expect(geometry.find((b) => b.id === 'desktop')!.frame).toEqual({ x: 1500, y: 140, w: 1500, h: 1100 });
  const history = await ok<{ versions: { kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
  expect(history.versions).toContainEqual(expect.objectContaining({ kind: 'restore', label: 'Restored from Carried layout' }));
  const carriedFiles = await filesOf(page, id);
  const restoredNote = plain(await elementOf(page, id, 'desktop', 'note'));
  expect(restoredNote).toBe('Owner: keep this launch note.');
  const noteText = (html: string) => page.evaluate((source) => new DOMParser().parseFromString(source, 'text/html').querySelector('#note')?.textContent ?? null, html);
  const conversation = await threadsOf(page, id);
  expect(conversation).toEqual([expect.objectContaining({ id: 'carried-note', live: true, orphan: false, messages: [{ body: 'Keep the launch date.', by: 'human' }, { body: 'The date is confirmed.', by: expect.stringMatching(/^session:/) }] })]);

  const mirror = join(channel, 'artifacts', `Carried-design-${id.slice(0, 8)}`);
  const paths = ['canvas.json', 'boards/phone.html', 'boards/tablet.html', 'boards/desktop.html', 'boards/poster.html'];
  await expect.poll(() => paths.every((p) => existsSync(join(mirror, p))), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => noteText(readFileSync(join(mirror, 'boards/desktop.html'), 'utf8'))).toBe(restoredNote);
  await expect.poll(() => JSON.parse(readFileSync(join(mirror, 'canvas.json'), 'utf8')).boards.desktop).toMatchObject({ x: 1500, y: 140, w: 1500, h: 1100 });
  const mirrored = Object.fromEntries(paths.map((p) => [p, readFileSync(join(mirror, p), 'utf8')]));
  const assertMirror = async () => {
    expect(readdirSync(join(mirror, 'boards')).sort()).toEqual(['desktop.html', 'phone.html', 'poster.html', 'tablet.html']);
    expect(JSON.parse(readFileSync(join(mirror, 'canvas.json'), 'utf8'))).toEqual(JSON.parse(carriedFiles['project/canvas.json']!));
    const desktop = readFileSync(join(mirror, 'boards/desktop.html'), 'utf8');
    expect(await noteText(desktop)).toBe(restoredNote);
    expect(desktop).not.toContain('Discarded');
    for (const p of paths) {
      const path = join(mirror, p);
      expect(readFileSync(path, 'utf8')).toBe(mirrored[p]);
      expect(statSync(path).mode & 0o222, `${p} has no writable mode`).toBe(0);
      // A real open for writing must fail, without changing any bytes even if it unexpectedly succeeds.
      expect(() => { const fd = openSync(path, constants.O_WRONLY); closeSync(fd); }, `${p} refuses writes`).toThrow(/EACCES|EPERM/);
    }
  };
  await assertMirror();
  expect(launch!.consoleErrors()).toEqual([]);
  const original = launch!;
  const exited = original.app.waitForEvent('close');
  await original.app.evaluate(({ app }) => app.quit());
  await exited;
  const restarted = await launchMaws({ userData: original.userData, keepConfigHome: true, env });
  launch = { ...restarted, cleanup: async () => { await restarted.cleanup(); await original.cleanup(); } };
  page = restarted.page;
  await restarted.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1800, 1000));
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 30_000 }).toBe('ready');
  tab = await openFromLibrary(page, title, id);
  expect(await boardsOf(page, id)).toEqual(geometry);
  expect(await filesOf(page, id)).toEqual(carriedFiles);
  expect(await threadsOf(page, id)).toEqual(conversation);
  expect(await ok(page, 'artifacts.versions', { artifactId: id })).toEqual(history);
  expect((await ok<{ artifact: { spaceId: string } }>(page, 'artifacts.get', { artifactId: id })).artifact.spaceId).toBe(space.id);
  expect((await ok<{ spaces: { id: string; linkedDir: string }[] }>(page, 'spaces.list')).spaces).toContainEqual(expect.objectContaining({ id: space.id, linkedDir: channel }));
  await assertMirror();
  // The owner's library identifies the linked Space and the exact directory whose files were inspected above.
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const library = page.locator('[data-library]');
  await expect(library.getByRole('article', { name: title, exact: true }).getByRole('button', { name: 'Carried launch', exact: true })).toBeVisible();
  await library.getByRole('radio', { name: 'By Space' }).click();
  await expect(library.locator('span[title]').filter({ hasText: channel! })).toBeVisible();
  tab = await openFromLibrary(page, title, id);
  expect(readFileSync(exported.path)).toEqual(png);
  await expect(tab.locator('[data-board-id="desktop"] [data-eid="note"]')).toHaveText('Owner: keep this launch note.');
  const pin = tab.locator('[data-comment-pin="note"]');
  await expect(pin).toHaveCount(1);
  await expect.poll(() => pinOffset(pin, tab.locator('[data-board-id="desktop"] [data-eid="note"]'))).toBeLessThan(4);
  await tab.getByRole('toolbar', { name: 'Design' }).getByRole('button', { name: /^Comments/ }).click();
  const thread = tab.getByRole('complementary', { name: 'Comments' }).locator('article[data-thread="carried-note"]');
  await expect(thread).toContainText('Keep the launch date.');
  await expect(thread).toContainText('The date is confirmed.');
  await headerAction(page, 'Version history');
  await tab.getByRole('complementary', { name: 'Version history' }).getByRole('button', { name: /^Version Carried layout/ }).click();
  const preview = tab.getByRole('toolbar', { name: 'Version preview' });
  await expect(preview).toBeVisible();
  await preview.getByRole('checkbox', { name: 'Show changes' }).uncheck();
  const world = tab.getByRole('region', { name: 'Design in this version' });
  await expect(world.locator('[data-history-board="phone"]')).toHaveAttribute('style', /left: 70px; top: 90px; width: 420px; height: 900px/);
  await expect(world.locator('[data-history-board="desktop"]')).toHaveAttribute('style', /left: 1500px; top: 140px; width: 1500px; height: 1100px/);
  await expect(world.locator('[data-history-board="desktop"] .design-board-canvas [data-eid="note"]')).toHaveText('Owner: keep this launch note.');
  await preview.getByRole('button', { name: 'Back to design' }).click();
  await expect(tab.getByRole('toolbar', { name: 'Design' })).toBeVisible();
  expect(restarted.consoleErrors()).toEqual([]);
});
