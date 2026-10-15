// Design systems in utility mode (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md, Acceptance 9 to 14;
// `pnpm e2e:design-systems`, which silences node:sqlite's ExperimentalWarning, since a case reads the host's store file).
// Every case runs through A's store and L's library on a scratch instance:
// - a fresh store is seeded with the built-in systems, which open from the library as the Design System page; editing
//   the accent restyles the swatch and the page's `--ds-color-accent` within one frame and the canon preview at its
//   frame's next load (Decision Log 22), and the edit survives a reload (Acceptance 9);
// - the document fixture (`window.__maws_design_system_fixture`, the e2e seam standing for B's editor until it lands: a
//   minimal page in a `DesignSystemScope`, through `tokens.css`) restyles with its live system (10); a retained version
//   of a document pinned to an older revision of its system renders that revision while the live fixture shows the new
//   values (11); deleting the system is refused naming the document, succeeds once the page's sheet moves it, and the
//   retained version still renders the pinned state (13); once deleted, the system's face is still served at the
//   revision a retained version pins and refused live, until no version pins it (A's Decision Log 46);
// - D's chain, registered in A's store, governs the pin a version is written with: with no defaults, the house system;
//   then the defaults chosen in Settings › Artifacts (main's `artifacts.setDefaults`): a document's own system, else its
//   Space's default, else the owner's; a deleted default falls through to the next link (12);
// - the window resolves the same chain for a scope (the P3 spec's Decision Log 61): a fixture that names no system,
//   under no default, draws the house system the host's chain names (`designSystems.house`) as the owner edited it, not
//   the bundled floor, and the floor once the house system is deleted;
// - `official`'s bundled face sets its page's Type section through the app's CSP, a canon frame shows the system's
//   image asset, and the header's "Export for Claude" writes the system as a zip of Claude's files with every asset it
//   holds (A's export service; D12);
// - the agent's `ask` with design_system questions, over C3's replay of a journal derived from E1's recorded blocking ask
//   with only the ask's questions and its recorded answers rewritten (the replay matches the host's answers by request
//   id; what the sheet submitted is asserted on the journal's own rows): the sheet lists the seeded systems with their
//   swatches and origin, offers "Build one with me" where allowed, and answers `{designSystemId, name}` and
//   `{create: true}` (14).
// Not here: the document and deck restyle through B's and C's own editors (P3-F).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { artifactRefusalOf, type ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { allowNext, fixtureRows, mcpResultOf, ofKind, PASS3, resultText, scene, show, type Frame, type McpResult, type Scene } from './support/maws-tools';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; issues?: unknown } };
interface Row {
  id: string;
  title: string;
}

const call = async <T>(page: Page, name: string, input?: unknown): Promise<Result<T>> =>
  (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = await call<T>(page, name, input);
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
// The application menu's item, clicked as main's menu would (settings.spec.ts's helper).
async function menu(app: ElectronApplication, id: string): Promise<void> {
  const click = () =>
    app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item?.enabled) return false;
      item.click();
      return true;
    }, id);
  await expect.poll(click, { message: `menu item ${id} exists and is enabled` }).toBe(true);
}
const systems = async (page: Page): Promise<Row[]> => (await ok<{ artifacts: Row[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;
const titles = async (page: Page) => (await systems(page)).map((s) => s.title).sort();

const BUILT_IN = ['Classroom', 'MAWS', 'Official'];

let launch: MawsLaunch | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
});

async function ready(): Promise<Page> {
  launch = await launchMaws();
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => titles(page), { timeout: 15_000, message: 'the built-in systems are seeded' }).toEqual(BUILT_IN);
  return page;
}

// A default's colour as its bundled token file writes it (a literal srgb colour with its hex), and as CSS computes it.
const bundledHex = (key: string, role: 'bg' | 'accent'): string =>
  (JSON.parse(readFileSync(join(REPO_ROOT, `src/artifacts/types/design_system/defaults/${key}/tokens.tokens.json`), 'utf8')) as { color: Record<'bg' | 'accent', { $root: { $value: { hex: string } } }> }).color[role].$root.$value.hex;
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

// A system opened from the library: its page in the artifact main tab (L's registry).
async function openSystemPage(page: Page, title: string, artifactId: string) {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click();
  const tab = page.locator(`[data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator(`[data-ds-page="${artifactId}"]`)).toBeVisible({ timeout: 15_000 });
  return tab;
}

// Types `hex` into the page's accent field as one input event (the page writes the token as it is typed, Decision Log
// 24) and reads, in the first animation frame after that event, before the frame paints, the accent swatch's painted
// colour and the palette scope's `--ds-color-accent`.
function recolourAccent(page: Page, artifactId: string, hex: string): Promise<{ swatch: string; property: string }> {
  return page.evaluate(([id, value]) => {
    const tab = document.querySelector(`[data-artifact-tab="${id}"]`)!;
    const field = tab.querySelector<HTMLInputElement>('input[aria-label="--ds-color-accent hex"]')!;
    const chip = tab.querySelector<HTMLElement>('[data-ds-section="palette"] [data-token="color.accent"] .dsp-chip')!;
    const scope = chip.closest<HTMLElement>('[data-ds-scope]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise<{ swatch: string; property: string }>((resolve) =>
      requestAnimationFrame(() => resolve({ swatch: getComputedStyle(chip).backgroundColor, property: getComputedStyle(scope).getPropertyValue('--ds-color-accent').trim() })),
    );
  }, [artifactId, hex] as const);
}

// The document fixture (the renderer's e2e seam, standing for B's editor): a minimal page in a `DesignSystemScope`.
type SystemRef = { id: string; versionSeq?: number } | { builtin: 'maws' } | null | { governedBy: { designSystemId?: string | null; spaceId?: string | null } };
interface FixtureSeam {
  __maws_design_system_fixture: { mount(name: string, system: SystemRef): void; unmount(name: string): void };
}
const mountFixture = (page: Page, name: string, system: SystemRef) => page.evaluate(([n, ref]) => (window as unknown as FixtureSeam).__maws_design_system_fixture.mount(n, ref), [name, system] as const);
const unmountFixture = (page: Page, name: string) => page.evaluate((n) => (window as unknown as FixtureSeam).__maws_design_system_fixture.unmount(n), name);
const fixture = (page: Page, name: string) => page.locator(`[data-ds-fixtures] article[data-ds-fixture="${name}"]`);
const fixtureAccent = (page: Page, name: string) => fixture(page, name).locator('[data-part="accent"]').evaluate((element) => getComputedStyle(element).color);
const fixtureGround = (page: Page, name: string) => fixture(page, name).evaluate((element) => getComputedStyle(element).backgroundColor);

interface Version {
  id: number;
  designSystemRef?: { id: string; versionSeq: number } | null;
}
async function saveVersion(page: Page, artifactId: string, label: string): Promise<Version> {
  const { versionId } = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId, label });
  const { versions } = await ok<{ versions: Version[] }>(page, 'artifacts.versions', { artifactId });
  return versions.find((version) => version.id === versionId)!;
}

test('a fresh store holds the built-in systems; one opens from the library as the Design System page, and an accent edit restyles it at once and persists', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  // `official` is seeded with its bundled faces, read from the build beside the engine-host chunk
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  const db = new DatabaseSync(join(launch!.userData, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    const assets = db.prepare('SELECT name, size FROM artifact_assets WHERE artifactId = ? ORDER BY name').all(official.id) as { name: string; size: number }[];
    expect(assets.map((a) => a.name)).toEqual(['NotoSerifKR-Bold-full.woff2', 'NotoSerifKR-Regular-full.woff2', 'OFL.txt']);
    for (const asset of assets) expect(asset.size, asset.name).toBeGreaterThan(1000);
  } finally {
    db.close();
  }
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const library = page.locator('[data-library]');
  for (const title of BUILT_IN) await expect(library.getByRole('article', { name: title, exact: true })).toBeVisible({ timeout: 15_000 });
  const house = (await systems(page)).find((s) => s.title === 'MAWS')!;
  const tab = await openSystemPage(page, 'MAWS', house.id);
  await expect(tab.locator('.dsp-title')).toHaveText('MAWS');
  for (const section of ['palette', 'type', 'measures', 'canon', 'law', 'check']) await expect(tab.locator(`[data-ds-section="${section}"]`)).toBeAttached();
  const field = tab.getByLabel('--ds-color-accent hex');
  await expect(field).toHaveValue(bundledHex('maws', 'accent'));
  // the owner looked at it: L's surface recorded the view once the page said it was on screen
  await expect.poll(async () => (await ok<{ artifact: { lastViewedAt: number | null } }>(page, 'artifacts.get', { artifactId: house.id })).artifact.lastViewedAt, { timeout: 10_000 }).not.toBeNull();

  // Acceptance 9: the accent edited on the page; the swatch and the page's --ds-color-accent follow within one frame
  const canon = tab.locator('[data-ds-section="canon"] iframe').first();
  const canonAccent = async () => {
    const frame = await (await canon.elementHandle())!.contentFrame();
    return frame!.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-color-accent').trim());
  };
  await expect.poll(canonAccent, { message: 'the canon preview is drawn in the system' }).toBe(bundledHex('maws', 'accent'));
  const RECOLOURED = '#2f6b4f';
  expect(await recolourAccent(page, house.id, RECOLOURED)).toEqual({ swatch: rgbOf(RECOLOURED), property: RECOLOURED });
  // the canon preview at its frame's next load (Decision Log 22: the frames stay sandboxed and swap their source)
  await expect(canon).toHaveAttribute('srcdoc', new RegExp(`--ds-color-accent: ${RECOLOURED};`));
  await expect.poll(canonAccent, { message: 'the canon preview follows at its next load' }).toBe(RECOLOURED);

  // the edit persists: after a reload the page opens with it
  await page.reload();
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000 }).toBe('ready');
  const reopened = await openSystemPage(page, 'MAWS', house.id);
  await expect(reopened.getByLabel('--ds-color-accent hex')).toHaveValue(RECOLOURED);
  await expect.poll(() => reopened.locator('[data-ds-section="palette"] [data-token="color.accent"] .dsp-chip').evaluate((chip) => getComputedStyle(chip).backgroundColor)).toBe(rgbOf(RECOLOURED));
  expect(launch!.consoleErrors()).toEqual([]);
});

// Acceptance 10, 11 and 13 over the document fixture: a copy of Classroom (so no default is touched) governs a document.
test('a document fixture restyles with its system, its retained version keeps the pinned revision, and the system’s delete waits until the document moves', async () => {
  test.setTimeout(150_000);
  const page = await ready();
  const classroom = (await systems(page)).find((s) => s.title === 'Classroom')!;
  const { artifact: system } = await ok<{ artifact: Row }>(page, 'artifacts.duplicate', { artifactId: classroom.id });
  expect(system.title).toBe('Copy of Classroom');
  const { artifact: doc } = await ok<{ artifact: Row }>(page, 'artifacts.create', { kind: 'document', title: 'Syllabus', designSystemId: system.id });
  await ok(page, 'artifacts.testWrite', { artifactId: doc.id, opId: 'ds-e2e-fixture', ops: [{ op: 'insertText', index: 0, text: 'Week one.' }] });
  const BEFORE = bundledHex('classroom', 'accent');
  const AFTER = '#8a2be2';

  // the live fixture, in the document's system
  await mountFixture(page, 'live', { id: system.id });
  await expect(fixture(page, 'live')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect.poll(() => fixtureAccent(page, 'live')).toBe(rgbOf(BEFORE));
  expect(await fixtureGround(page, 'live')).toBe(rgbOf(bundledHex('classroom', 'bg')));
  // a version of the document, pinned to the system's state as it is now (X29), rendered from that pin
  const handedOut = await saveVersion(page, doc.id, 'Handed out');
  const pin = handedOut.designSystemRef!;
  expect(pin).toEqual({ id: system.id, versionSeq: expect.any(Number) });
  await mountFixture(page, 'retained', pin);
  await expect(fixture(page, 'retained')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect.poll(() => fixtureAccent(page, 'retained')).toBe(rgbOf(BEFORE));

  // the owner recolours the system on its page, which is titled as the library names the copy (Decision Log 29) while
  // its law keeps the original's title
  const tab = await openSystemPage(page, 'Copy of Classroom', system.id);
  await expect(tab.locator('.dsp-title')).toHaveText('Copy of Classroom');
  await expect(tab.locator('[data-ds-section="law"] h1').first()).toContainText('Classroom');
  const docRevision = (await ok<{ artifact: { revision: number } }>(page, 'artifacts.get', { artifactId: doc.id })).artifact.revision;
  expect(await recolourAccent(page, system.id, AFTER)).toEqual({ swatch: rgbOf(AFTER), property: AFTER });
  // Acceptance 10: the live fixture restyles, with no write to the document
  await expect.poll(() => fixtureAccent(page, 'live')).toBe(rgbOf(AFTER));
  expect((await ok<{ artifact: { revision: number } }>(page, 'artifacts.get', { artifactId: doc.id })).artifact.revision).toBe(docRevision);
  // Acceptance 11: the retained version still renders the revision it pinned, beside the live one
  expect(await fixtureAccent(page, 'retained')).toBe(rgbOf(BEFORE));
  // and a version written now pins the newer revision, which renders the new accent
  const revised = await saveVersion(page, doc.id, 'Revised');
  expect(revised.designSystemRef!.id).toBe(system.id);
  expect(revised.designSystemRef!.versionSeq).toBeGreaterThan(pin.versionSeq);
  await mountFixture(page, 'revised', revised.designSystemRef!);
  await expect.poll(() => fixtureAccent(page, 'revised'), { timeout: 15_000 }).toBe(rgbOf(AFTER));

  // Acceptance 13: A's store refuses the delete, naming the document
  const refused = await call(page, 'artifacts.delete', { artifactId: system.id });
  expect(refused.ok).toBe(false);
  const refusal: ArtifactRefusal | null = refused.ok ? null : artifactRefusalOf(refused.error as Parameters<typeof artifactRefusalOf>[0]);
  expect(refusal).toEqual({ reason: 'designSystemInUse', data: { artifactIds: [doc.id] } });
  // the page's delete sheet names it by title and moves it to another system, then deletes
  await page.getByRole('button', { name: 'Delete design system…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete “Copy of Classroom”?' });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  const inUse = page.getByRole('dialog', { name: 'Still in use' });
  await expect(inUse.getByRole('list', { name: 'Artifacts styled by this system' }).getByRole('listitem')).toHaveText(['Syllabus']);
  await inUse.getByRole('combobox', { name: 'Move them to…' }).selectOption({ label: 'Classroom' });
  await inUse.getByRole('button', { name: 'Move and delete', exact: true }).click();
  await expect(inUse).toBeHidden({ timeout: 15_000 });
  await expect.poll(async () => (await ok<{ artifact: Row | null }>(page, 'artifacts.get', { artifactId: system.id })).artifact, { timeout: 10_000 }).toBeNull();
  expect((await ok<{ artifact: { designSystemId: string | null } }>(page, 'artifacts.get', { artifactId: doc.id })).artifact.designSystemId).toBe(classroom.id);
  // the retained version still renders the pinned state: as shown, and read again from the store
  expect(await fixtureAccent(page, 'retained')).toBe(rgbOf(BEFORE));
  await unmountFixture(page, 'retained');
  await unmountFixture(page, 'revised');
  await expect(fixture(page, 'retained')).toHaveCount(0);
  await mountFixture(page, 'retained', pin);
  await expect(fixture(page, 'retained')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect.poll(() => fixtureAccent(page, 'retained')).toBe(rgbOf(BEFORE));
  expect(launch!.consoleErrors()).toEqual([]);
});

// A's Decision Log 46 (X29): a retained version pinned to a system deleted since keeps that system's faces. The store
// serves a deleted system's assets at a named revision while any retained version pins it, never live, and the version
// view loads its faces at the pinned revision.
test('a retained version keeps its deleted system’s face: served at the pinned revision, never live, until no version pins it', async () => {
  test.setTimeout(150_000);
  const page = await ready();
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  const { artifact: system } = await ok<{ artifact: Row }>(page, 'artifacts.duplicate', { artifactId: official.id }); // its assets copied with it
  const { artifact: doc } = await ok<{ artifact: Row }>(page, 'artifacts.create', { kind: 'document', title: 'Transcript request', designSystemId: system.id });
  const pin = (await saveVersion(page, doc.id, 'Sent')).designSystemRef!;
  expect(pin).toEqual({ id: system.id, versionSeq: expect.any(Number) });
  const FACE = 'assets/NotoSerifKR-Regular-full.woff2';
  const faceAt = (revision: number | 'live') => `maws-artifact://${system.id}/${revision}/${FACE}`;
  // Loads the face from the store as a new FontFace whose URL carries a fresh query, so no cache answers for the store
  const loads = (url: string) =>
    page.evaluate(async (u) => {
      try {
        await new FontFace('ds-e2e-probe', `url("${u}?probe=${Math.random()}")`).load();
        return true;
      } catch {
        return false;
      }
    }, url);
  // The face a fixture's body text is set in, under its private family name, and whether that face has loaded
  const fixtureFace = (name: string) =>
    fixture(page, name)
      .locator('p.ds-type-body')
      .evaluate(async (element) => {
        const alias = getComputedStyle(element).fontFamily.split(',').map((family) => family.trim().replace(/^["']|["']$/g, '')).find((family) => family.startsWith('ds-face-'));
        if (!alias) return null;
        const faces = await document.fonts.load(`400 16px "${alias}"`, '밀도');
        const urls = Array.from(document.head.querySelectorAll('style'), (style) => style.textContent ?? '').join('\n');
        return { loaded: faces.length > 0 && faces.every((face) => face.status === 'loaded'), urls };
      });
  const pinnedUrl = `//${system.id}/${pin.versionSeq}/${FACE}`;

  expect(await loads(faceAt(pin.versionSeq))).toBe(true);
  expect(await loads(faceAt('live'))).toBe(true);
  // the retained version renders in the pinned state, its face loaded at the pinned revision: the URL the window's
  // ArtifactHost gives for `assetUrl(id, ref, versionSeq)` (the P3 spec's Decision Log 59)
  await mountFixture(page, 'retained', pin);
  await expect(fixture(page, 'retained')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect.poll(async () => (await fixtureFace('retained'))?.loaded, { timeout: 15_000, message: 'the pinned face loads' }).toBe(true);
  expect((await fixtureFace('retained'))!.urls).toContain(pinnedUrl);
  await unmountFixture(page, 'retained');

  // the document moves to another system and the system is deleted
  await ok(page, 'artifacts.update', { artifactId: doc.id, designSystemId: null });
  await ok(page, 'artifacts.delete', { artifactId: system.id });
  expect((await ok<{ artifact: Row | null }>(page, 'artifacts.get', { artifactId: system.id })).artifact).toBeNull();
  // the face is still served at the pinned revision, and refused live
  expect(await loads(faceAt(pin.versionSeq))).toBe(true);
  expect(await loads(faceAt('live'))).toBe(false);
  // the retained version, read again from the store, still renders with its face
  await mountFixture(page, 'after delete', pin);
  await expect(fixture(page, 'after delete')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect.poll(async () => (await fixtureFace('after delete'))?.loaded, { timeout: 15_000, message: 'the pinned face loads after the delete' }).toBe(true);
  expect((await fixtureFace('after delete'))!.urls).toContain(pinnedUrl);
  await unmountFixture(page, 'after delete');

  // once no retained version pins it, the deleted system's face is refused at the pinned revision too
  expect((await ok<{ removed: number }>(page, 'artifacts.pruneVersions', { artifactId: doc.id, olderThan: Date.now() + 60_000 })).removed).toBeGreaterThan(0);
  expect(await loads(faceAt(pin.versionSeq))).toBe(false);
  // the only console errors are the two refused loads (Chromium's line names no URL)
  expect(launch!.consoleErrors()).toEqual(Array(2).fill('Failed to load resource: the server responded with a status of 404 (Not Found)'));
});

// A one-pixel PNG, the canon's image asset.
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const unzip = (...args: string[]) => execFileSync('/usr/bin/unzip', args, { encoding: 'utf8' });

// What A's M7 opened (its CSP admits `maws-artifact:` in img-src and font-src) and registered (the exporter registry).
test('Official’s bundled face sets its Type section, a canon frame shows an image asset, and the page exports the system for Claude', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  // a canon component that shows an image the system holds (written through the store's e2e seam)
  await page.evaluate(
    ([id, b64]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke('artifacts.uploadAsset', { artifactId: id, name: 'mark.png', mime: 'image/png', bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }),
    [official.id, PIXEL_PNG] as const,
  );
  // and an asset nothing in the system names, which the export carries all the same (A's assets.list())
  await page.evaluate(
    (id) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke('artifacts.uploadAsset', { artifactId: id, name: 'brand-notes.txt', mime: 'text/plain', bytes: new TextEncoder().encode('Notes for the brand.') }),
    official.id,
  );
  const MARK = '<div class="mark"><img src="assets/mark.png" alt="The office mark" width="24" height="24"></div>';
  await ok(page, 'artifacts.testWrite', { artifactId: official.id, opId: 'ds-e2e-mark', ops: [{ op: 'setAttr', root: 'files', key: 'components/mark.html', value: MARK }] });
  const tab = await openSystemPage(page, 'Official', official.id);

  // the body role's document specimen is set in Noto Serif KR, loaded from the system's assets under its private family
  // name (Decision Log 21, 24), so its Hangul is drawn in the bundled face
  const specimen = tab.locator('[data-ds-section="type"] [data-role="body"] .dsp-specimen p.ds-type-body').first();
  const alias = await specimen.evaluate((element) =>
    getComputedStyle(element).fontFamily.split(',').map((name) => name.trim().replace(/^["']|["']$/g, '')).find((name) => name.startsWith('ds-face-')) ?? null,
  );
  expect(alias, 'the specimen names the system’s face').not.toBeNull();
  const faceStatus = () =>
    page.evaluate(async (family) => {
      const faces = await document.fonts.load(`400 16px "${family}"`, '밀도'); // one per scope that declares it
      return { loaded: faces.length > 0 && faces.every((face) => face.status === 'loaded'), drawn: document.fonts.check(`400 16px "${family}"`, '밀도') };
    }, alias!);
  await expect.poll(faceStatus, { timeout: 15_000, message: 'Noto Serif KR loads through the app’s CSP' }).toEqual({ loaded: true, drawn: true });

  // the canon frame draws the image from the system's assets (its srcdoc's img-src and the app's CSP admit the scheme)
  const markFrame = tab.locator('[data-ds-section="canon"] iframe[title="components/mark.html"]');
  await expect(markFrame).toHaveAttribute('srcdoc', /maws-artifact:\/\/[^"]*assets\/mark\.png/);
  const markImage = async () => {
    const frame = await (await markFrame.elementHandle())!.contentFrame();
    return frame!.evaluate(() => {
      const image = document.querySelector('img');
      return image ? { complete: image.complete, width: image.naturalWidth } : null;
    });
  };
  await expect.poll(markImage, { timeout: 15_000, message: 'the canon frame shows the image asset' }).toEqual({ complete: true, width: 1 });

  // Export for Claude (the header's export, A's export service, D's exporter): one zip of Claude's files under the store
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export for Claude' }).click();
  const told = page.locator('[data-toast-viewport]').getByText(/^Exported for Claude to /);
  await expect(told).toBeVisible({ timeout: 30_000 });
  const path = (await told.textContent())!.replace(/^Exported for Claude to /, '').trim();
  expect(path.startsWith(join(launch!.userData, 'artifacts', official.id, 'exports'))).toBe(true);
  expect(path).toMatch(/\/\d+-claude\.zip$/);
  expect(unzip('-t', path)).toContain('No errors detected');
  expect(unzip('-Z1', path).trim().split('\n').sort()).toEqual([
    'README.md', 'assets/OFL.txt', 'assets/brand-notes.txt', 'assets/mark.png', 'fonts/NotoSerifKR-Bold-full.woff2', 'fonts/NotoSerifKR-Regular-full.woff2', 'tokens.json',
  ]);
  expect(unzip('-p', path, 'README.md')).toBe(readFileSync(join(REPO_ROOT, 'src/artifacts/types/design_system/defaults/official/DESIGN.md'), 'utf8'));
  const tokens = JSON.parse(unzip('-p', path, 'tokens.json')) as { name: string; color: { tokens: { name: string; value: string }[] }; type: { fonts: unknown[] } };
  expect(tokens.name).toBe('Official');
  expect(tokens.color.tokens.find((t) => t.name === 'bg')!.value.slice(0, 7)).toBe(bundledHex('official', 'bg'));
  expect(tokens.type.fonts).toEqual([
    { family: 'Noto Serif KR', file: 'NotoSerifKR-Regular-full.woff2', weight: '400', style: 'normal' },
    { family: 'Noto Serif KR', file: 'NotoSerifKR-Bold-full.woff2', weight: '700', style: 'normal' },
  ]);
  const bundledFont = readFileSync(join(REPO_ROOT, 'src/artifacts/types/design_system/defaults/official/assets/NotoSerifKR-Regular-full.woff2'));
  expect(Buffer.from(execFileSync('/usr/bin/unzip', ['-p', path, 'fonts/NotoSerifKR-Regular-full.woff2'], { maxBuffer: 16 * 1024 * 1024 })).equals(bundledFont)).toBe(true);
  expect(launch!.consoleErrors()).toEqual([]);
});

// The P3 spec's Decision Log 61: a scope the window resolves itself (as B's documents and C's decks do) ends the chain at
// the house system the host's chain names, so the owner's edits to it show; the bundled floor only once none is left.
test('a scope that names no system, under no default, draws the house system as the owner edited it, and the floor once it is deleted', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const house = (await systems(page)).find((s) => s.title === 'MAWS')!;
  expect(await ok(page, 'designSystems.house')).toEqual({ houseId: house.id });
  const BUNDLED = bundledHex('maws', 'accent');
  const EDITED = '#2f6b4f';
  expect(EDITED).not.toBe(BUNDLED);

  // a document page with no system of its own, in no Space, with no defaults set
  await mountFixture(page, 'loose', { governedBy: {} });
  await expect(fixture(page, 'loose')).toHaveAttribute('data-ds-system', house.id, { timeout: 15_000 });
  await expect(fixture(page, 'loose')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect.poll(() => fixtureAccent(page, 'loose')).toBe(rgbOf(BUNDLED));
  // the owner recolours the house system on its page: the scope follows, which the floor never would
  await openSystemPage(page, 'MAWS', house.id);
  expect(await recolourAccent(page, house.id, EDITED)).toEqual({ swatch: rgbOf(EDITED), property: EDITED });
  await expect.poll(() => fixtureAccent(page, 'loose'), { timeout: 10_000 }).toBe(rgbOf(EDITED));
  // a fixture mounted now resolves the same house, edited
  await mountFixture(page, 'later', { governedBy: { spaceId: null } });
  await expect(fixture(page, 'later')).toHaveAttribute('data-ds-system', house.id, { timeout: 15_000 });
  await expect.poll(() => fixtureAccent(page, 'later'), { timeout: 10_000 }).toBe(rgbOf(EDITED));

  // the house system deleted through its page: no system of the house key is left, so the window learns of it at the
  // change and the scope falls to the bundled floor
  await page.getByRole('button', { name: 'Delete design system…' }).click();
  await page.getByRole('dialog', { name: 'Delete “MAWS”?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await ok<{ artifact: Row | null }>(page, 'artifacts.get', { artifactId: house.id })).artifact, { timeout: 10_000 }).toBeNull();
  expect(await ok(page, 'designSystems.house')).toEqual({ houseId: null });
  await expect(fixture(page, 'loose')).toHaveAttribute('data-ds-system', 'floor', { timeout: 10_000 });
  await expect.poll(() => fixtureAccent(page, 'loose')).toBe(rgbOf(BUNDLED));
  expect(launch!.consoleErrors()).toEqual([]);
});

// Acceptance 12 through D's chain in A's store and the settings: with no defaults the house system; a document's own
// system, else its Space's default, else the owner's; a deleted default falls through to the next link.
test('the chain governs the pin: the house system with no defaults, then a document’s own system, its Space’s, the owner’s, and past a deleted default', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const byTitle = Object.fromEntries((await systems(page)).map((s) => [s.title, s.id])) as Record<string, string>;
  const { space } = await ok<{ space: { id: string } }>(page, 'spaces.create', { name: 'Chemistry' });

  // three documents that differ only in where their system comes from
  const create = async (title: string, placement: { spaceId?: string; designSystemId?: string }) => {
    const { artifact } = await ok<{ artifact: Row }>(page, 'artifacts.create', { kind: 'document', title, ...placement });
    await ok(page, 'artifacts.testWrite', { artifactId: artifact.id, opId: `ds-e2e-${title}`, ops: [{ op: 'insertText', index: 0, text: `${title}.` }] });
    return artifact.id;
  };
  const own = await create('Letter home', { spaceId: space.id, designSystemId: byTitle.Official });
  const inSpace = await create('Lab notes', { spaceId: space.id });
  const loose = await create('Syllabus', {});
  const pinOf = async (artifactId: string) => (await saveVersion(page, artifactId, `check ${Date.now()}`)).designSystemRef?.id ?? null;
  // the house link: no default is set, so a document with no system of its own pins to the house system (A's own chain
  // pinned nothing here)
  expect(await pinOf(loose), 'no defaults: the house system').toBe(byTitle.MAWS);
  expect(await pinOf(inSpace), 'a Space with no default: the house system').toBe(byTitle.MAWS);

  await menu(launch!.app, 'settings.open');
  const panel = page.locator('[data-region="main"]').getByRole('tabpanel');
  const owner = panel.getByRole('combobox', { name: 'Default design system' });
  const chemistry = panel.getByRole('combobox', { name: 'Design system for Chemistry' });
  await expect(owner).toBeVisible({ timeout: 15_000 });
  await expect(owner.locator('option')).toHaveText(['House system', ...BUILT_IN]);
  await owner.selectOption({ label: 'Classroom' });
  await expect(chemistry).toBeVisible({ timeout: 15_000 });
  await expect(chemistry.locator('option')).toHaveText(['Use my default', ...BUILT_IN]);
  await chemistry.selectOption({ label: 'MAWS' });
  const settingsFile = join(launch!.userData, 'settings.json');
  await expect.poll(() => (JSON.parse(readFileSync(settingsFile, 'utf8')) as { artifacts: unknown }).artifacts).toEqual({ defaultDesignSystem: byTitle.Classroom, spaceDesignSystems: { [space.id]: byTitle.MAWS } });

  // main pushes the defaults on every settings change; a pin follows them once the host has them
  await expect.poll(() => pinOf(loose), { timeout: 10_000, message: 'no Space: the owner’s default' }).toBe(byTitle.Classroom);
  await expect.poll(() => pinOf(inSpace), { timeout: 10_000, message: 'in the Space: its default' }).toBe(byTitle.MAWS);
  expect(await pinOf(own), 'its own system first').toBe(byTitle.Official);
  // the Space's pinned version renders the Space's system
  const pinned = (await saveVersion(page, inSpace, 'Shown')).designSystemRef!;
  await mountFixture(page, 'lab-notes', pinned);
  await expect.poll(() => fixtureAccent(page, 'lab-notes'), { timeout: 15_000 }).toBe(rgbOf(bundledHex('maws', 'accent')));

  // the Space back on "Use my default": its document follows the owner's
  await chemistry.selectOption({ label: 'Use my default' });
  await expect.poll(() => (JSON.parse(readFileSync(settingsFile, 'utf8')) as { artifacts: unknown }).artifacts).toEqual({ defaultDesignSystem: byTitle.Classroom, spaceDesignSystems: {} });
  await expect.poll(() => pinOf(inSpace), { timeout: 10_000, message: 'the Space has none: the owner’s default' }).toBe(byTitle.Classroom);

  // a deleted default falls through: the Space's to the owner's, the owner's to the house system, the settings unchanged
  await chemistry.selectOption({ label: 'Official' });
  await expect.poll(() => pinOf(inSpace), { timeout: 10_000, message: 'in the Space: its new default' }).toBe(byTitle.Official);
  await ok(page, 'artifacts.update', { artifactId: own, designSystemId: null }); // the one document naming Official moves
  await ok(page, 'artifacts.delete', { artifactId: byTitle.Official });
  expect(await pinOf(inSpace), 'its Space’s default deleted: the owner’s').toBe(byTitle.Classroom);
  await ok(page, 'artifacts.delete', { artifactId: byTitle.Classroom });
  expect(await pinOf(loose), 'the owner’s default deleted: the house system').toBe(byTitle.MAWS);
  expect(await pinOf(inSpace), 'both deleted: the house system').toBe(byTitle.MAWS);
  expect((JSON.parse(readFileSync(settingsFile, 'utf8')) as { artifacts: unknown }).artifacts).toEqual({ defaultDesignSystem: byTitle.Classroom, spaceDesignSystems: { [space.id]: byTitle.Official } });
  expect(launch!.consoleErrors()).toEqual([]);
});

// ---- M6b: the design_system ask (Acceptance 14) ------------------------------------------------------------------------

const ASK_BLOCKING = `${PASS3}/p1-maws-ask-blocking.jsonl`;
const ASK_TOOL_USE = 'toolu_012dCG4TE89gS8BSqhFFZnjS'; // the recorded ask's tool-use id, its askId
const QUESTIONS: AskQuestion[] = [
  { id: 'q1', question: 'Which of your design systems should the handout use?', header: 'Design system', modality: 'design_system', allowCreate: false },
  { id: 'q2', question: 'And the slides?', modality: 'design_system' },
];

// The fields of a journal frame the rewrite touches.
interface Block {
  type?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}
interface AskFrame {
  type?: string;
  event?: { delta?: { type?: string; partial_json?: string } };
  message?: { content?: Block[] | string };
  request?: { subtype?: string; tool_name?: string; input?: unknown; message?: { method?: string; params?: { name?: string; arguments?: unknown } } };
  response?: { response?: { updatedInput?: { questions?: unknown }; mcp_response?: { result?: { content?: { text?: string }[] } } } };
}

// E1's recorded blocking ask with `QUESTIONS` in place of its five: the tool_use, its streamed input (the whole input in
// the first delta, the others empty), the permission request and its answer, the tools/call; and the recorded answers in
// the results replaced by `answers`, so the transcript the replay feeds back reads the same answers the host wrote.
function designSystemAskJournal(dir: string, answers: AskAnswer[]): string {
  const input = { title: 'A look for the handout', questions: QUESTIONS };
  const result = JSON.stringify({ status: 'answered', askId: ASK_TOOL_USE, answers }, null, 2);
  let firstDelta = true;
  const rows = fixtureRows(ASK_BLOCKING).map((row) => {
    const frame = structuredClone(row.frame) as AskFrame;
    const delta = frame.event?.delta;
    if (frame.type === 'stream_event' && delta?.type === 'input_json_delta' && row.seq > 77 && row.seq < 130) {
      delta.partial_json = firstDelta ? JSON.stringify(input) : ''; // the ask's own content block (seq 77 to 130)
      firstDelta = false;
    }
    const blocks = Array.isArray(frame.message?.content) ? frame.message.content : [];
    if (frame.type === 'assistant') for (const block of blocks) if (block.type === 'tool_use' && block.id === ASK_TOOL_USE) block.input = input;
    if (frame.type === 'user') for (const block of blocks) if (block.type === 'tool_result' && block.tool_use_id === ASK_TOOL_USE) block.content = [{ type: 'text', text: result }];
    const request = frame.request;
    if (frame.type === 'control_request' && request?.subtype === 'can_use_tool' && request.tool_name === 'mcp__maws__ask') request.input = input;
    if (frame.type === 'control_request' && request?.message?.method === 'tools/call' && request.message.params?.name === 'ask') request.message.params.arguments = input;
    const response = frame.response?.response;
    if (frame.type === 'control_response' && response?.updatedInput?.questions !== undefined) response.updatedInput = input;
    const text = response?.mcp_response?.result?.content?.[0];
    if (frame.type === 'control_response' && text?.text?.includes(ASK_TOOL_USE)) text.text = result;
    return { ...row, frame: frame as Frame };
  });
  const path = join(dir, 'p3d-design-system-ask.jsonl');
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

// The derived journal launched under the session (an absolute path, which `replay` would read under the repository) and
// the recorded prompt sent, as `replay` does.
async function replayJournal(s: Scene, id: AppSessionId, journal: string): Promise<void> {
  await launchReady(s.page, id, journal, { cwd: s.repo });
  const prompt = (fixtureRows(ASK_BLOCKING).find((row) => row.direction === 'out' && (row.frame as Frame).type === 'user')!.frame as { message: { content: string } }).message.content;
  value(await invoke(s.page, 'session.send', { appSessionId: id, content: prompt }));
}

test('the agent asks for a design system: the sheet lists the systems with their swatches and origin, offers Build one with me where allowed, and answers the chosen id or create', async () => {
  test.setTimeout(120_000);
  await scene({ titles: ['P3-D: a design system ask'], label: 'p3d-ask' }, async (s) => {
    const [id] = s.ids;
    await expect.poll(async () => (await systems(s.page)).map((system) => system.title).sort(), { timeout: 20_000, message: 'the built-in systems are seeded' }).toEqual(BUILT_IN);
    const classroom = (await systems(s.page)).find((system) => system.title === 'Classroom')!;
    const answers: AskAnswer[] = [
      { id: 'q1', question: QUESTIONS[0]!.question, status: 'answered', designSystemId: classroom.id, name: 'Classroom' },
      { id: 'q2', question: QUESTIONS[1]!.question, status: 'answered', create: true },
    ];
    await show(s, id);
    await replayJournal(s, id, designSystemAskJournal(s.scratch.root, answers));
    await s.pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Transcript', exact: true }).click();
    await allowNext(s, id); // mcp__maws__ask

    const [opened] = ofKind(await s.events(id), 'maws.ask.opened');
    expect(opened).toMatchObject({ askId: ASK_TOOL_USE, blocking: true, questions: QUESTIONS });
    const sheet = s.panel.locator('[data-ask-sheet]');
    await expect(sheet).toHaveAttribute('data-ask-id', ASK_TOOL_USE);
    const section = (questionId: string) => sheet.locator(`section[data-question-id="${questionId}"]`);
    // every live system by name, in order, with "Build one with me" only where the question allows it
    await expect(section('q1').getByRole('radio')).toHaveText(BUILT_IN.map((title) => new RegExp(`^${title}`)));
    await expect(section('q2').getByRole('radio')).toHaveCount(BUILT_IN.length + 1);
    await expect(section('q2').getByRole('radio').last()).toHaveAccessibleName('Build one with me');
    for (const name of ['Decide for me', 'Skip']) await expect(section('q1').getByRole('button', { name })).toBeVisible();
    // a row: its origin and its five swatches, painted with the seeded system's own values
    const row = section('q1').locator(`[data-design-system="${classroom.id}"]`);
    await expect(row).toContainText('Built in');
    await expect(row.locator('[data-swatch]')).toHaveCount(5);
    for (const [swatch, role] of [['--ds-color-bg', 'bg'], ['--ds-color-accent', 'accent']] as const) {
      await expect.poll(() => row.locator(`[data-swatch="${swatch}"]`).evaluate((element) => getComputedStyle(element).backgroundColor), { message: swatch }).toBe(rgbOf(bundledHex('classroom', role)));
    }

    await section('q1').getByRole('radio', { name: 'Classroom' }).click();
    await section('q2').getByRole('radio', { name: 'Build one with me' }).click();
    await sheet.getByRole('button', { name: 'Submit', exact: true }).click();

    // the answers the host wrote to the engine: the system by its id and name, and the build request
    let written: McpResult | null = null;
    await expect.poll(() => (written = mcpResultOf(s.journal(id), opened!.requestId)) !== null, { timeout: 20_000 }).toBe(true);
    expect(JSON.parse(resultText(written!))).toEqual({ status: 'answered', askId: ASK_TOOL_USE, answers });
    const capsule = s.pane.locator('section.transcript-ask');
    await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
    await expect(capsule.locator('[data-ask-answer]')).toHaveText(['Design system→Classroom', 'And the slides?→Build one with me']);
  });
});
