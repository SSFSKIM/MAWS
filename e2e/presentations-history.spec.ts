// Version history per slide in the product build (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M8, D11;
// Acceptance 5; part of `pnpm e2e:presentations`). A deck is created by the human's `artifacts.create`, seeded from files
// through the renderer's seam (presentations.spec.ts's way), named in a design system and versioned through A's
// `artifacts.saveVersion`, then changed (a slide removed, one added, an element deleted, a restyle, the notes, the cover,
// the system switched) and versioned again, and opened from the library in a main tab:
// - the document toolbar's Version history opens its floating card and Fit uses the width it leaves;
// - a version previews read-only on the stage with Show changes on: the filmstrip edges each changed slide (a new one
//   badged, a deleted one ghosted at its place), the stage outlines the changed element in the author's colour and
//   ghosts the deleted one from the earlier doc, the notes below show the diff, "N changes" with ↑ ↓ moving the stage;
// - the preview draws with the design system pinned at the version (the earlier version in Official, the live deck now
//   in MAWS);
// - Show changes off draws the version plainly; Compare by shift-click; Back to presentation;
// - Show editors on a selected element names who edited it;
// - Restore brings the slides and the deck's properties back as a new `restore` version, with the banner.
// - fix wave 1 (R4): "See N new changes": the owner views the deck, an agent session writes into it between two views
//   (the host's e2e-only history seam, `writeAs` as the session, then the scheduler's `auto` version), and the next
//   showing offers the pill with the count; opening it shows the comparison since the last view.
// The second case is M8's bound: the preview of a 3-month-old version of S7a's heavy deck (the soak's own states, read
// from MAWS_DECK_HISTORY's export) ≤ 1,000 ms through the editor's whole path, the 1-minute load printed beside it.
import { openArtifactInPanel, openSurface, pinSurfaceForSessions } from './support/shell';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ScratchRepo } from '../test/support/scratch-repo';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { newChatIn, openProject } from './support/sidebar';

// The heavy deck's preview bound is presentations-scale's row 5, measured there settled and calibrated (MEASURED_E2E);
// here, in a functional group a neighbour or ci-kit's guest may run beside, the median is printed and the bound asserted
// only under MAWS_PRESENTATIONS_PERF=1, the presentations group's switch for its measured bounds, a run on purpose
// (gate.yml's VM contract).
const MEASURED = process.env.MAWS_PRESENTATIONS_PERF === '1';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

interface Seam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    edit(artifactId: string, edit: { op: 'setStyle'; slideId: string; elementId: string; props: Record<string, string | null> } | { op: 'setNotes'; slideId: string; text: string }): Promise<void>;
    files(artifactId: string): Promise<Record<string, string>>;
    order(artifactId: string): Promise<string[]>;
    timings(artifactId: string): { surface: string; timings: { previewMs?: number[] } }[];
  };
  __maws_documents: {
    open(artifactId: string): Promise<number>;
    applyState(id: number, state: Uint8Array): void;
    state(id: number): { unsaved: number };
    close(id: number): void;
  };
}
const seam = <K extends keyof Seam['__maws_presentations']>(page: Page, name: K, ...args: Parameters<Seam['__maws_presentations'][K]>) =>
  page.evaluate(([n, a]) => ((window as unknown as Seam).__maws_presentations[n as K] as (...x: unknown[]) => unknown)(...(a as unknown[])), [name, args] as const) as ReturnType<Seam['__maws_presentations'][K]>;

let launch: MawsLaunch | null = null;
let channel: string | null = null; // fix wave 1 (R4): the host's history seam's directory
let repo: ScratchRepo | null = null; // fix wave 2: a chat shown, so the panel takes the deck beside a main tab
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  repo?.dispose();
  repo = null;
  if (channel) rmSync(channel, { recursive: true, force: true });
  channel = null;
});

/** Fix wave 1 (R4): one command through the host's history seam (src/engine-host/presentations/history-seam.ts). */
async function hostWrite(command: unknown): Promise<{ ok: boolean; error?: string }> {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  mkdirSync(join(channel!, 'in'), { recursive: true });
  writeFileSync(join(channel!, 'in', `${name}.tmp`), JSON.stringify(command));
  renameSync(join(channel!, 'in', `${name}.tmp`), join(channel!, 'in', name));
  const out = join(channel!, 'out', name);
  await expect.poll(() => existsSync(out), { timeout: 15_000, message: 'the history seam answers' }).toBe(true);
  return JSON.parse(readFileSync(out, 'utf8')) as { ok: boolean; error?: string };
}

interface Row {
  id: string;
  title: string;
}
const systems = async (page: Page): Promise<Row[]> => (await ok<{ artifacts: Row[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;

async function ready(env?: Record<string, string>): Promise<Page> {
  launch = await launchMaws(env ? { env } : {});
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1800, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations), { message: 'the seam is installed' }).toBe('object');
  await expect.poll(async () => (await systems(page)).map((s) => s.title).sort(), { timeout: 15_000, message: 'the built-in systems are seeded' }).toEqual(['Classroom', 'MAWS', 'Official']);
  return page;
}

async function openFromLibrary(page: Page, title: string, artifactId: string): Promise<Locator> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  return tab;
}

/** History keeps its document toolbar/card controls; Theme lives under Deck actions. */
async function deckAction(page: Page, label: 'Version history' | 'Theme'): Promise<void> {
  const editor = page.locator('[data-region="main"] [data-deck-editor]');
  if (label === 'Version history') {
    const close = editor.getByRole('button', { name: 'Close version history', exact: true });
    if (await close.isVisible()) return close.click();
    return editor.getByRole('toolbar', { name: 'Deck', exact: true }).getByRole('button', { name: label, exact: true }).click();
  }
  await editor.locator('.deck-toolbar [data-editor-toolbar]').getByRole('button', { name: 'Deck actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click();
}

const bundled = (key: string) => JSON.parse(readFileSync(join(REPO_ROOT, `src/artifacts/types/design_system/defaults/${key}/tokens.tokens.json`), 'utf8')) as { color: Record<string, { $root: { $value: { hex: string } } }> };
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
const computed = (node: Locator, property: string) => node.evaluate((n, p) => getComputedStyle(n).getPropertyValue(p), property);

// fix wave 1 (R2): the deck's uploaded face is re-mapped after the version
const DECK_JSON = (order: string[], cover: string, face: string) => JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-15T09:00:00Z' }, title: 'History lab', cover, order, faces: { brand: { family: 'History Brand', src: `assets/${face}` } } });
const slide = (id: string, body: string, notes: string) => `<section id="${id}" style="background:var(--ds-color-bg, #ffffff); padding:128px">${body}<aside>${notes}</aside></section>`;
const S1 = slide('s1', '<h1 id="t1" style="font-size:96px; color:var(--ds-color-text, #111111)">Opening</h1>', 'Welcome everyone.');
const S2 = slide('s2', '<h2 id="title" style="font-size:72px; color:var(--ds-color-text, #111111)">Plan</h2><p id="body" style="font-size:40px">One path</p>', 'Speak to the plan.');
const S3 = slide('s3', '<h2 id="t3" style="font-size:72px">Numbers</h2><p id="gone" style="position:absolute; left:300px; top:600px; width:600px; height:120px; font-size:48px; background:#eef2ff">To be cut</p>', 'The numbers.');
const S3_CUT = slide('s3', '<h2 id="t3" style="font-size:72px">Numbers</h2>', 'The numbers.');
const S4 = slide('s4', '<h2 id="t4" style="font-size:72px">Next steps</h2>', 'Close.');
const DRAFT: Record<string, string> = { 'project/deck.json': DECK_JSON(['s1', 's2', 's3'], 's1', 'brand-draft.woff2'), 'project/slides/s1.html': S1, 'project/slides/s2.html': S2, 'project/slides/s3.html': S3 };
const REVIEWED: Record<string, string> = { 'project/deck.json': DECK_JSON(['s2', 's3', 's4'], 's2', 'brand-reviewed.woff2'), 'project/slides/s2.html': S2, 'project/slides/s3.html': S3_CUT, 'project/slides/s4.html': S4 };

test('history per slide: the rail, a version’s changes on the stage and filmstrip, its pinned system, compare, Show editors, restore', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'History lab' });
  const id = artifact.id;
  await seam(page, 'seed', id, DRAFT);
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  const maws = (await systems(page)).find((s) => s.title === 'MAWS')!;
  await ok(page, 'artifacts.update', { artifactId: id, designSystemId: official.id });
  const draft = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Draft' });

  // after the version: a slide removed and one added, the cover moved, an element cut, a restyle, the notes, the system
  await seam(page, 'seed', id, REVIEWED);
  await seam(page, 'edit', id, { op: 'setStyle', slideId: 's2', elementId: 'title', props: { color: '#c0392b' } });
  await seam(page, 'edit', id, { op: 'setNotes', slideId: 's2', text: 'Speak to the revised plan.' });
  await ok(page, 'artifacts.update', { artifactId: id, designSystemId: maws.id });
  const reviewed = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Reviewed' });
  const listed = await ok<{ versions: { id: number; seq: number; kind: string; designSystemRef?: { id: string } }[] }>(page, 'artifacts.versions', { artifactId: id });
  expect(listed.versions.find((v) => v.id === draft.versionId)?.designSystemRef?.id, 'the draft pins Official').toBe(official.id);

  const tab = await openFromLibrary(page, 'History lab', id);

  await test.step('WR #37: a narrow deck keeps a working slide beside its filmstrip', async () => {
    const editor = tab.locator('[data-deck-editor]');
    await editor.evaluate((el) => { (el as HTMLElement).style.width = '560px'; });
    await expect.poll(async () => (await tab.locator('[data-stage-slide]').boundingBox())!.width).toBeGreaterThan(300);
    await editor.evaluate((el) => { (el as HTMLElement).style.width = ''; });
    // The width reset and its ResizeObserver fit are separate frames: take the history baseline only after both.
    await expect.poll(() => tab.locator('[data-stage-surface]').evaluate((el) => {
      const fittedWidth = 1920 * Math.max(0.05, Math.min((el.clientWidth - 48) / 1920, (el.clientHeight - 48) / 1080));
      return Math.abs(el.querySelector('[data-stage-slide]')!.getBoundingClientRect().width - fittedWidth);
    }), { message: 'the wide stage has fitted its restored viewport' }).toBeLessThan(1);
  });

  await test.step('the document toolbar’s Version history opens its floating card and Fit uses the width it leaves', async () => {
    const stageBefore = await tab.locator('[data-stage-slide]').boundingBox();
    await deckAction(page, 'Version history');
    const rail = tab.getByRole('complementary', { name: 'Version history' });
    await expect(rail).toBeVisible();
    await expect.poll(async () => (await tab.locator('[data-stage-slide]').boundingBox())!.width, { message: 'Fit gives the open card real width' }).toBeLessThan(stageBefore!.width);
    await expect.poll(() => tab.evaluate((root) => {
      const viewport = root.querySelector<HTMLElement>('.deck-stage')!;
      const cards = root.querySelector<HTMLElement>('.deck-tool-cards')!;
      const slide = root.querySelector('[data-stage-slide]')!.getBoundingClientRect();
      // Approved Fit geometry: the measured card stack plus its 16px gutters, and 48px of stage surround.
      const fittedWidth = Math.min(viewport.clientWidth - cards.clientWidth - 16 - 48, (viewport.clientHeight - 48) * 16 / 9);
      return Math.abs(slide.width - fittedWidth);
    }), { message: 'the slide exactly fits the space left by the floating tool stack' }).toBeLessThan(1);
    const [slideBox, cardBox] = [(await tab.locator('[data-stage-slide]').boundingBox())!, (await tab.locator('.deck-tool-cards').boundingBox())!];
    expect(slideBox.x + slideBox.width, 'the full slide stays left of the floating card').toBeLessThanOrEqual(cardBox.x);
    await expect(tab.locator('[data-deck-rail="history"]')).toBeVisible();
    for (const fold of await rail.getByRole('button', { name: /^\d+ more versions?$/ }).all()) await fold.click();
    await expect(rail.getByRole('button', { name: /^Version / })).toHaveCount(listed.versions.length);
    await expect(rail.getByRole('button', { name: /^Version Draft by You/ })).toBeVisible();
    await expect(tab.getByRole('toolbar', { name: 'Deck', exact: true }).getByRole('button', { name: 'Version history', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  const rail = tab.getByRole('complementary', { name: 'Version history' });
  const bar = tab.getByRole('toolbar', { name: 'Version preview' });
  const stage = tab.locator('[data-history-stage]');
  const filmstrip = tab.getByRole('navigation', { name: 'Slides in this version' });

  await test.step('a version previews read-only with its changes: the filmstrip’s edges, the stage’s marks and ghosts, the notes’ diff', async () => {
    await rail.getByRole('button', { name: /^Version Reviewed by You/ }).click();
    await expect(bar).toBeVisible();
    await expect(bar.locator('.deck-history-heading')).toContainText('Reviewed');
    await expect(tab.getByRole('toolbar', { name: 'Deck' })).toHaveCount(0); // the editor's tools are gone: read-only
    await expect(tab.locator('[data-overlay]')).toHaveCount(0);
    await expect(filmstrip.locator('[data-slide-thumb="s1"]')).toHaveAttribute('data-history-change', 'removed');
    await expect(filmstrip.locator('[data-slide-thumb="s4"]')).toHaveAttribute('data-history-change', 'added');
    await expect(filmstrip.locator('[data-slide-thumb="s2"]')).toHaveAttribute('data-history-change', 'changed');
    await expect(filmstrip.locator('[data-slide-thumb="s3"]')).toHaveAttribute('data-history-change', 'changed');
    await expect(filmstrip.locator('[data-slide-thumb]')).toHaveCount(4); // the deleted slide at its earlier place
    expect(await filmstrip.locator('[data-slide-thumb]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slide-thumb')))).toEqual(['s1', 's2', 's3', 's4']);
    // "N changes": the deck's cover, s1 removed, s4 added, s3's element cut, s2's title and its notes
    await expect(bar.locator('[data-history-count]')).toContainText('of 6 changes');
    await expect(tab.locator('.deck-history-deck')).toHaveCount(0);

    // ↓ from the first slide: the stage moves to each change; s2's title outlined, its notes' diff below
    await filmstrip.locator('[data-slide-thumb="s1"] button').click();
    await expect(stage.locator('[data-history-slide]')).toHaveAttribute('data-history-slide', 'removed');
    await bar.getByRole('button', { name: 'Next change' }).click();
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(stage.locator('[data-stage-slide]')).toHaveAttribute('data-stage-slide', 's2');
    const mark = stage.locator('[data-history-mark="title"]');
    await expect(mark).toHaveAttribute('data-kind', 'changed');
    await expect(mark).toHaveAttribute('data-focused', '');
    expect(await computed(mark, 'border-top-style')).toBe('solid');
    const notes = tab.locator('[data-history-notes]');
    await expect(notes.locator('ins')).toContainText('revised');
    // the mark sits on the element as drawn
    const [m, el] = [await mark.boundingBox(), await stage.locator('[data-eid="title"]').first().boundingBox()];
    expect(Math.abs(m!.x - el!.x)).toBeLessThan(3);
    expect(Math.abs(m!.width - el!.width)).toBeLessThan(3);

    // s3: the cut element ghosted from the earlier doc where it was, outlined dashed
    await filmstrip.locator('[data-slide-thumb="s3"] button').click();
    const ghost = stage.locator('.deck-history-ghosts [data-eid="gone"][data-ghost]');
    await expect(ghost).toBeVisible();
    await expect(stage.locator('[data-history-mark="gone"]')).toHaveAttribute('data-kind', 'removed');
    await expect(ghost).toContainText('To be cut');
  });

  await test.step('Show changes off draws the version plainly; the draft draws in the system pinned at it', async () => {
    await bar.getByRole('checkbox', { name: 'Show changes' }).uncheck();
    await expect(stage.locator('[data-history-mark]')).toHaveCount(0);
    await expect(filmstrip.locator('[data-history-change]')).toHaveCount(0);
    await expect(bar.locator('[data-history-count]')).toHaveCount(0);

    await rail.getByRole('button', { name: /^Version Draft by You/ }).click();
    await expect(bar.locator('.deck-history-heading')).toContainText('Draft');
    await filmstrip.locator('[data-slide-thumb="s2"] button').click();
    const title = stage.locator('[data-stage-slide] [data-eid="title"]').first();
    await expect.poll(() => computed(title, 'color')).toBe(rgbOf(bundled('official').color.text!.$root.$value.hex));
    // fix wave 1 (R2): the draft's own face mapping, at the draft's assets, not the live deck's
    const faces = tab.locator('style[data-deck-faces]');
    await expect(faces).toHaveCount(1);
    const draftRevision = listed.versions.find((v) => v.id === draft.versionId)!.seq;
    expect(await faces.textContent()).toContain(`/${draftRevision}/assets/brand-draft.woff2`);
    expect(await faces.textContent()).not.toContain('brand-reviewed');
  });

  await test.step('Compare by shift-click; Back to presentation', async () => {
    await rail.getByRole('button', { name: /^Version Reviewed by You/ }).click({ modifiers: ['Shift'] });
    await expect(bar.locator('.deck-history-heading')).toHaveText('Draft → Reviewed');
    await expect(bar.getByRole('button', { name: 'Restore this version' })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Back to presentation' }).click();
    await expect(tab.getByRole('toolbar', { name: 'Deck' })).toBeVisible();
    // the live deck draws in its system now (MAWS) with the restyle
    const live = tab.locator('[data-stage-slide] [data-eid="title"]');
    await tab.locator('[data-slide-thumb="s2"] .deck-thumb-button').click();
    await expect.poll(() => computed(live, 'color')).toBe('rgb(192, 57, 43)');
    expect(await tab.locator('style[data-deck-faces]').textContent()).toContain('brand-reviewed.woff2'); // the live mapping again
  });

  await test.step('Show editors on the selected element names who edited it', async () => {
    await deckAction(page, 'Version history'); // the rail closed: under 720 px of editor it is a sheet over the stage
    await expect(tab.locator('[data-deck-rail="history"]')).toHaveCount(0);
    const live = tab.locator('[data-stage-slide] [data-eid="title"]');
    await live.click();
    await expect(tab.locator('[data-overlay] [data-selected="title"]')).toBeVisible();
    await live.click({ button: 'right' });
    await tab.getByRole('menuitem', { name: 'Show editors' }).click();
    const editors = tab.getByRole('dialog', { name: 'Editors' });
    await expect(editors.getByRole('listitem').first()).toContainText('You');
    await editors.getByRole('button', { name: 'Close editors' }).click();
  });

  await test.step('Restore brings the slides and the deck’s properties back as a new restore version, with the banner', async () => {
    await deckAction(page, 'Version history');
    await rail.getByRole('button', { name: /^Version Draft by You/ }).click();
    await bar.getByRole('button', { name: 'Restore this version' }).click();
    await tab.getByRole('alertdialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
    await expect(tab.getByRole('toolbar', { name: 'Deck' })).toBeVisible();
    await expect.poll(() => seam(page, 'order', id)).toEqual(['s1', 's2', 's3']);
    const files = await seam(page, 'files', id);
    expect(JSON.parse(files['project/deck.json']!).cover).toBe('s1');
    expect(files['project/slides/s3.html']).toContain('id="gone"');
    expect(files['project/slides/s2.html']).not.toContain('#c0392b');
    expect(files['project/slides/s2.html']).toContain('Speak to the plan.');
    const after = await ok<{ versions: { id: number; kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
    expect(after.versions).toContainEqual(expect.objectContaining({ kind: 'restore', label: 'Restored from Draft' }));
    await expect(tab.getByRole('status', { name: 'Restored' })).toContainText('Restored from Draft');
    expect(reviewed.versionId).toBeGreaterThan(draft.versionId);
  });
});

test('WR #46: an open history card receives committed human and automatic agent versions without reopening', async () => {
  channel = mkdtempSync(join(tmpdir(), 'maws-deck-history-'));
  const page = await ready({ MAWS_PRESENTATIONS_HISTORY: channel });
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'Live history' });
  const id = artifact.id;
  await seam(page, 'seed', id, DRAFT);
  const tab = await openFromLibrary(page, 'Live history', id);
  await deckAction(page, 'Version history');
  const rail = tab.getByRole('complementary', { name: 'Version history' });
  await expect(rail).toBeVisible();
  const listed = async () => (await ok<{ versions: { id: number }[] }>(page, 'artifacts.versions', { artifactId: id })).versions;
  const reaches = async (count: number) => {
    await expect(async () => {
      for (const fold of await rail.getByRole('button', { name: /^\d+ more versions?$/ }).all()) if (await fold.getAttribute('aria-expanded') === 'false') await fold.click();
      await expect(rail.getByRole('button', { name: /^Version / })).toHaveCount(count);
    }).toPass({ timeout: 15_000 });
  };
  await reaches((await listed()).length);
  await seam(page, 'edit', id, { op: 'setNotes', slideId: 's1', text: 'A human update.' });
  await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Human update' });
  await expect(rail.getByRole('button', { name: /^Version Human update by You/ })).toBeVisible();
  expect(await hostWrite({ cmd: 'write', artifactId: id, session: '00000000-0000-4000-8000-0000000000a7', edit: { op: 'setNotes', slideId: 's2', text: 'An agent update.' } })).toEqual(expect.objectContaining({ ok: true }));
  await reaches((await listed()).length);
});

test('See N new changes: an agent session’s write between two views is offered as a pill, opening the changes since the last view', async () => {
  test.setTimeout(120_000);
  channel = mkdtempSync(join(tmpdir(), 'maws-deck-history-'));
  const page = await ready({ MAWS_PRESENTATIONS_HISTORY: channel });
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'Pill lab' });
  const id = artifact.id;
  await seam(page, 'seed', id, DRAFT);

  // the first view: the deck drawn in a main tab records the owner's view (L's onShown, then the rail's markViewed)
  let tab = await openFromLibrary(page, 'Pill lab', id);
  await expect.poll(async () => (await ok<{ artifact: { lastViewedAt: number | null } }>(page, 'artifacts.get', { artifactId: id })).artifact.lastViewedAt).not.toBeNull();
  await expect(tab.locator('.deck-history-pill')).toHaveCount(0); // nothing new: no pill
  await page.getByRole('button', { name: 'Close Pill lab', exact: true }).click();
  await expect(tab).toHaveCount(0);

  // an agent session writes between the views: a restyle and the notes of s2, then the scheduler's version
  const session = '00000000-0000-4000-8000-0000000000a7';
  expect(await hostWrite({ cmd: 'write', artifactId: id, session, edit: { op: 'setStyle', slideId: 's2', elementId: 'title', props: { color: '#2e86de' } } })).toEqual(expect.objectContaining({ ok: true }));
  expect(await hostWrite({ cmd: 'write', artifactId: id, session, edit: { op: 'setNotes', slideId: 's2', text: 'Speak to the plan, briefly.' } })).toEqual(expect.objectContaining({ ok: true }));
  const versions = await ok<{ versions: { kind: string; actor: { kind: string } }[] }>(page, 'artifacts.versions', { artifactId: id });
  expect(versions.versions.at(-1)).toEqual(expect.objectContaining({ kind: 'auto', actor: expect.objectContaining({ kind: 'session' }) }));

  // the next showing offers the pill with the count, and opening it shows the comparison since the last view
  tab = await openFromLibrary(page, 'Pill lab', id);
  const pill = tab.locator('.deck-history-pill');
  await expect(pill.getByRole('button', { name: 'See 2 new changes' })).toBeVisible();
  await pill.getByRole('button', { name: 'See 2 new changes' }).click();
  const bar = tab.getByRole('toolbar', { name: 'Version preview' });
  await expect(bar.locator('.deck-history-heading')).toHaveText('Changes since you last looked');
  await expect(bar.locator('[data-history-count]')).toHaveText('2 changes');
  await expect(tab.getByRole('complementary', { name: 'Version history' })).toBeVisible();
  const filmstrip = tab.getByRole('navigation', { name: 'Slides in this version' });
  await expect(filmstrip.locator('[data-slide-thumb="s2"]')).toHaveAttribute('data-history-change', 'changed');
  await filmstrip.locator('[data-slide-thumb="s2"] button').click();
  const mark = tab.locator('[data-history-stage] [data-history-mark="title"]');
  await expect(mark).toHaveAttribute('title', /Claude/); // the agent, by the session's title or "Claude"
  await expect(tab.locator('[data-history-notes] ins')).toContainText('briefly');
  await expect(bar.getByRole('button', { name: 'Restore this version' })).toHaveCount(0); // the live deck: nothing to restore
});

// Fix wave 2 (R2): one deck in the panel (live) and in a main tab (a version's preview) at once, the family its text asks
// for mapped to one uploaded face in the version and to another live: each surface draws its own face. Two real faces
// of different widths (KaTeX's Main and Typewriter, shipped with the app's dependencies), told apart by the drawn width
// of the same text in slide px.
const KATEX = (file: string) => [...readFileSync(join(REPO_ROOT, 'node_modules/katex/dist/fonts', file))];
// fix wave 3: `token` reads the family through the design system's body token, which the Theme's Body face overrides
const FACE_SLIDE = `<section id="f1" style="background:#ffffff; padding:128px"><p id="probe" style="position:absolute; left:128px; top:300px; font-size:96px; font-family:'Face Lab', serif">iiiiiiiiiiiiiiii</p><p id="token" style="position:absolute; left:128px; top:600px; font-size:96px; font-family:var(--ds-font-body, serif)">iiiiiiiiiiiiiiii</p></section>`;
const faceDeck = (ref: string) => ({
  'project/deck.json': JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-15T09:00:00Z' }, title: 'Face lab', cover: 'f1', order: ['f1'], faces: { lab: { family: 'Face Lab', src: ref } } }),
  'project/slides/f1.html': FACE_SLIDE,
});
/** An element's drawn width in slide px on a surface's stage (its zoom divided out). */
async function probeWidth(where: Locator, eid = 'probe'): Promise<number> {
  const frame = await where.locator('[data-stage-slide]').first().boundingBox();
  const probe = await where.locator(`[data-stage-slide] [data-eid="${eid}"]`).first().boundingBox();
  return probe!.width / (frame!.width / 1920);
}
/** A width once it has stopped changing (a face loads after the first layout). */
async function settledWidth(where: Locator, eid = 'probe'): Promise<number> {
  let last = -1;
  await expect.poll(async () => {
    const now = Math.round(await probeWidth(where, eid));
    const same = now === last;
    last = now;
    return same;
  }, { timeout: 15_000, intervals: [300] }).toBe(true);
  return last;
}

test('a live editor and a version’s preview of one deck in one window each draw their own upload for the same family', async () => {
  test.setTimeout(180_000);
  repo = await ScratchRepo.create({ sentinels: false });
  const page = await ready();
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'Face lab' });
  const id = artifact.id;
  const upload = (name: string, file: string) =>
    page.evaluate(
      async ([artifactId, n, bytes]) => {
        const result = (await (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean; value: { ref: string } }> } }).maws.invoke('artifacts.uploadAsset', { artifactId, name: n, mime: 'font/woff2', bytes: new Uint8Array(bytes as number[]) })) as { ok: boolean; value: { ref: string } };
        return result.value.ref;
      },
      [id, name, KATEX(file)] as const,
    );
  const serifRef = await upload('lab-main.woff2', 'KaTeX_Main-Regular.woff2');
  const monoRef = await upload('lab-mono.woff2', 'KaTeX_Typewriter-Regular.woff2');
  await seam(page, 'seed', id, faceDeck(serifRef));

  // the deck in the panel's Artifacts tool beside a chat, pinned, then moved to a main tab (Move to tab, P3-F wave S,
  // F16) and opened from the pinned tab's list again: two replicas (the parent's Decision Log 8)
  const project = await ok<{ name: string }>(page, 'session.projects.add', { directory: repo.root });
  await openProject(page, project.name);
  await newChatIn(page, project.name);
  const panel = page.locator('[data-region="panel"]');
  await openArtifactInPanel(page, id);
  const inPanel = panel.locator(`[data-deck-artifact="${id}"]`);
  await expect(inPanel.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await pinSurfaceForSessions(page, 'Artifacts');
  await panel.getByRole('button', { name: 'Move to tab' }).click();
  const inMain = page.locator(`[data-region="main"] [data-deck-artifact="${id}"]`);
  await expect(inMain.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await openSurface(page, 'Artifacts');
  await expect(inPanel).toHaveCount(0);
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${id}"]`).click();
  await expect(inPanel.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });

  // fix wave 3: the Theme's Body face set to the uploaded family, so text reading the body token asks for it too
  await deckAction(page, 'Theme');
  await inMain.locator('[data-deck-rail="theme"]').getByRole('combobox', { name: 'Body face', exact: true }).selectOption({ label: 'Face Lab' });
  await expect.poll(async () => JSON.parse((await seam(page, 'files', id))['project/deck.json']!).dsOverrides?.['--ds-font-body'] ?? '').toContain('Face Lab');
  await deckAction(page, 'Theme');
  await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Serif face' });

  // the serif face's width, live; then the deck re-mapped to the monospace face: both live surfaces follow
  const serif = await settledWidth(inMain);
  expect(Math.abs((await settledWidth(inMain, 'token')) - serif)).toBeLessThanOrEqual(serif * 0.02); // the token draws the upload
  const keepOverrides = JSON.parse((await seam(page, 'files', id))['project/deck.json']!).dsOverrides as Record<string, string>;
  const mono_ = faceDeck(monoRef);
  mono_['project/deck.json'] = JSON.stringify({ ...JSON.parse(mono_['project/deck.json']!), dsOverrides: keepOverrides });
  await seam(page, 'seed', id, mono_);
  await expect.poll(async () => Math.abs((await probeWidth(inPanel)) - serif), { timeout: 15_000 }).toBeGreaterThan(serif * 0.2);
  const mono = await settledWidth(inPanel);

  // the main tab previews the version while the panel stays live: each draws its own upload for 'Face Lab'
  await deckAction(page, 'Version history');
  await inMain.getByRole('complementary', { name: 'Version history' }).getByRole('button', { name: /^Version Serif face by You/ }).click();
  await expect(inMain.getByRole('toolbar', { name: 'Version preview' })).toBeVisible();
  const preview = await settledWidth(inMain.locator('[data-history-stage]'));
  const live = await settledWidth(inPanel);
  const previewToken = await settledWidth(inMain.locator('[data-history-stage]'), 'token');
  const liveToken = await settledWidth(inPanel, 'token');
  console.log(`[deck history e2e] 'Face Lab' drawn widths in slide px: serif ${serif}, monospace ${mono}; at once: the preview ${preview} (through the body token ${previewToken}), the live panel ${live} (token ${liveToken})`);
  expect(Math.abs(preview - serif)).toBeLessThanOrEqual(serif * 0.02);
  expect(Math.abs(live - mono)).toBeLessThanOrEqual(mono * 0.02);
  expect(Math.abs(preview - live)).toBeGreaterThan(serif * 0.2);
  expect(Math.abs(previewToken - serif)).toBeLessThanOrEqual(serif * 0.02); // fix wave 3: the Theme's Body face in the preview
  expect(Math.abs(liveToken - mono)).toBeLessThanOrEqual(mono * 0.02);
});

// M8's bound on S7a's heavy deck: the soak's 3-month-old version and its live state, written into a deck through A's
// store (a V2 state applied as an edit), versioned, and previewed through the rail.
const HEAVY = process.env.MAWS_DECK_HISTORY ?? '';
test('the preview of a 3-month-old version of S7a’s heavy deck draws within 1,000 ms', async () => {
  test.skip(!HEAVY || !existsSync(join(HEAVY, 'next.bin')), 'MAWS_DECK_HISTORY names no export of S7a’s heavy deck soak (src/engine-host/presentations/history-bench.test.ts says how)');
  test.setTimeout(240_000);
  const page = await ready();
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'Heavy deck' });
  const id = artifact.id;
  // P3-F (editor-proof scalpel-1#2): the state applied as an edit fails the case when the host has not acknowledged it
  // within 30 s; the port is closed only once it has. Closing it with edits unacknowledged dropped them, and the version
  // saved next snapshotted a truncated deck the preview was then timed on.
  const apply = async (file: string) => {
    const bytes = [...readFileSync(join(HEAVY, file))];
    const unsaved = await page.evaluate(async ([artifactId, state]) => {
      const docs = (window as unknown as Seam).__maws_documents;
      const handle = await docs.open(artifactId as string);
      docs.applyState(handle, new Uint8Array(state as number[]));
      for (let i = 0; i < 600 && docs.state(handle).unsaved > 0; i++) await new Promise((r) => setTimeout(r, 50));
      const left = docs.state(handle).unsaved;
      if (left === 0) docs.close(handle);
      return left;
    }, [id, bytes] as const);
    expect(unsaved, `the heavy deck's ${file} acknowledged by the host within 30 s, before it is versioned`).toBe(0);
  };
  await apply('prev.bin');
  const old = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Three months ago' });
  await apply('next.bin');
  await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Today' });
  expect((await seam(page, 'order', id)).length).toBeGreaterThan(50);

  const tab = await openFromLibrary(page, 'Heavy deck', id);
  await deckAction(page, 'Version history');
  const rail = tab.getByRole('complementary', { name: 'Version history' });
  const bar = tab.getByRole('toolbar', { name: 'Version preview' });
  const times: number[] = [];
  for (let run = 0; run < 3; run++) {
    // the 3-month-old version against today, as S7a measured it (a click, then a shift-click to compare)
    await rail.getByRole('button', { name: /^Version Three months ago/ }).click();
    await expect(bar).toBeVisible();
    await rail.getByRole('button', { name: /^Version Today/ }).click({ modifiers: ['Shift'] });
    await expect(bar.locator('.deck-history-heading')).toHaveText('Three months ago → Today');
    await expect.poll(async () => (await seam(page, 'timings', id))[0]?.timings.previewMs?.length ?? 0).toBe(2 * (run + 1));
    times.push((await seam(page, 'timings', id))[0]!.timings.previewMs!.at(-1)!);
    await bar.getByRole('button', { name: 'Back to presentation' }).click();
  }
  const median = [...times].sort((a, b) => a - b)[1]!;
  console.log(`[deck history e2e] 3-month-old version of S7a's heavy deck (version ${old.versionId}): preview to drawn ms ${JSON.stringify(times.map((t) => Math.round(t)))}, median ${Math.round(median)} (load ${loadavg()[0]!.toFixed(1)})`);
  if (MEASURED) expect(median).toBeLessThanOrEqual(1_000);
});
