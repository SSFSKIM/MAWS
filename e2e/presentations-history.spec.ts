// Version history per slide in the product build (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M8, D11;
// Acceptance 5; part of `pnpm e2e:presentations`). A deck is created by the human's `artifacts.create`, seeded from files
// through the renderer's seam (presentations.spec.ts's way), named in a design system and versioned through A's
// `artifacts.saveVersion`, then changed (a slide removed, one added, an element deleted, a restyle, the notes, the cover,
// the system switched) and versioned again, and opened from the library in a main tab:
// - the header's Version history opens B's rail beside the stage, listing A's versions as B's does;
// - a version previews read-only on the stage with Show changes on: the filmstrip edges each changed slide (a new one
//   badged, a deleted one ghosted at its place), the stage outlines the changed element in the author's colour and
//   ghosts the deleted one from the earlier doc, the notes below show the diff, "N changes" with ↑ ↓ moving the stage;
// - the preview draws with the design system pinned at the version (the earlier version in Official, the live deck now
//   in MAWS);
// - Show changes off draws the version plainly; Compare by shift-click; Back to presentation;
// - Show editors on a selected element names who edited it;
// - Restore brings the slides and the deck's properties back as a new `restore` version, with the banner.
// "See N new changes" needs an agent's write since the owner's last view, which the product build cannot make without
// an engine; the controller's unit suite covers it (src/artifacts/slides/editor/history/controller.test.ts).
// The second case is M8's bound: the preview of a 3-month-old version of S7a's heavy deck (the soak's own states, read
// from MAWS_DECK_HISTORY's export) ≤ 1,000 ms through the editor's whole path, the 1-minute load printed beside it.
import { existsSync, readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

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
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
});

interface Row {
  id: string;
  title: string;
}
const systems = async (page: Page): Promise<Row[]> => (await ok<{ artifacts: Row[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;

async function ready(): Promise<Page> {
  launch = await launchMaws();
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

/** A header action by its label: its button, or its entry under More actions when the header folded it there. */
async function headerAction(page: Page, label: string): Promise<void> {
  const header = page.locator('[data-region="main"] [data-editor-header]');
  const button = header.getByRole('button', { name: label, exact: true });
  if (await button.isVisible()) return button.click();
  await header.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: label }).or(page.getByRole('menuitem', { name: label })).click();
}

const bundled = (key: string) => JSON.parse(readFileSync(join(REPO_ROOT, `src/artifacts/types/design_system/defaults/${key}/tokens.tokens.json`), 'utf8')) as { color: Record<string, { $root: { $value: { hex: string } } }> };
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
const computed = (node: Locator, property: string) => node.evaluate((n, p) => getComputedStyle(n).getPropertyValue(p), property);

const DECK_JSON = (order: string[], cover: string) => JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-15T09:00:00Z' }, title: 'History lab', cover, order });
const slide = (id: string, body: string, notes: string) => `<section id="${id}" style="background:var(--ds-color-bg, #ffffff); padding:128px">${body}<aside>${notes}</aside></section>`;
const S1 = slide('s1', '<h1 id="t1" style="font-size:96px; color:var(--ds-color-text, #111111)">Opening</h1>', 'Welcome everyone.');
const S2 = slide('s2', '<h2 id="title" style="font-size:72px; color:var(--ds-color-text, #111111)">Plan</h2><p id="body" style="font-size:40px">One path</p>', 'Speak to the plan.');
const S3 = slide('s3', '<h2 id="t3" style="font-size:72px">Numbers</h2><p id="gone" style="position:absolute; left:300px; top:600px; width:600px; height:120px; font-size:48px; background:#eef2ff">To be cut</p>', 'The numbers.');
const S3_CUT = slide('s3', '<h2 id="t3" style="font-size:72px">Numbers</h2>', 'The numbers.');
const S4 = slide('s4', '<h2 id="t4" style="font-size:72px">Next steps</h2>', 'Close.');
const DRAFT: Record<string, string> = { 'project/deck.json': DECK_JSON(['s1', 's2', 's3'], 's1'), 'project/slides/s1.html': S1, 'project/slides/s2.html': S2, 'project/slides/s3.html': S3 };
const REVIEWED: Record<string, string> = { 'project/deck.json': DECK_JSON(['s2', 's3', 's4'], 's2'), 'project/slides/s2.html': S2, 'project/slides/s3.html': S3_CUT, 'project/slides/s4.html': S4 };

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
  const listed = await ok<{ versions: { id: number; kind: string; designSystemRef?: { id: string } }[] }>(page, 'artifacts.versions', { artifactId: id });
  expect(listed.versions.find((v) => v.id === draft.versionId)?.designSystemRef?.id, 'the draft pins Official').toBe(official.id);

  const tab = await openFromLibrary(page, 'History lab', id);
  const header = page.locator('[data-region="main"] [data-editor-header]');

  await test.step('the header’s Version history opens B’s rail, listing A’s versions', async () => {
    await headerAction(page, 'Version history');
    const rail = tab.getByRole('complementary', { name: 'Version history' });
    await expect(rail).toBeVisible();
    await expect(tab.locator('[data-deck-rail="history"]')).toBeVisible();
    for (const fold of await rail.getByRole('button', { name: /^\d+ more versions?$/ }).all()) await fold.click();
    await expect(rail.getByRole('button', { name: /^Version / })).toHaveCount(listed.versions.length);
    await expect(rail.getByRole('button', { name: /^Version Draft by You/ })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Version history', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
    await expect(bar.locator('[data-history-count]')).toHaveText('6 changes');
    await expect(tab.locator('.deck-history-deck')).toContainText('cover');

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
  });

  await test.step('Show editors on the selected element names who edited it', async () => {
    await headerAction(page, 'Version history'); // the rail closed: under 720 px of editor it is a sheet over the stage
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
    await headerAction(page, 'Version history');
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

// M8's bound on S7a's heavy deck: the soak's 3-month-old version and its live state, written into a deck through A's
// store (a V2 state applied as an edit), versioned, and previewed through the rail.
const HEAVY = process.env.MAWS_DECK_HISTORY ?? '';
test('the preview of a 3-month-old version of S7a’s heavy deck draws within 1,000 ms', async () => {
  test.skip(!HEAVY || !existsSync(join(HEAVY, 'next.bin')), 'MAWS_DECK_HISTORY names no export of S7a’s heavy deck soak (src/engine-host/presentations/history-bench.test.ts says how)');
  test.setTimeout(240_000);
  const page = await ready();
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'Heavy deck' });
  const id = artifact.id;
  const apply = async (file: string) => {
    const bytes = [...readFileSync(join(HEAVY, file))];
    await page.evaluate(async ([artifactId, state]) => {
      const docs = (window as unknown as Seam).__maws_documents;
      const handle = await docs.open(artifactId as string);
      docs.applyState(handle, new Uint8Array(state as number[]));
      for (let i = 0; i < 600 && docs.state(handle).unsaved > 0; i++) await new Promise((r) => setTimeout(r, 50));
      docs.close(handle);
    }, [id, bytes] as const);
  };
  await apply('prev.bin');
  const old = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Three months ago' });
  await apply('next.bin');
  await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Today' });
  expect((await seam(page, 'order', id)).length).toBeGreaterThan(50);

  const tab = await openFromLibrary(page, 'Heavy deck', id);
  await headerAction(page, 'Version history');
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
  expect(median).toBeLessThanOrEqual(1_000);
});
