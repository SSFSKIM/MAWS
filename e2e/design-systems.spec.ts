// Design systems in utility mode (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; `pnpm e2e:design-systems`).
// It reads the host's store file once (`pnpm e2e:design-systems` silences node:sqlite's ExperimentalWarning). M6's first cases, through A's store and L's library on a scratch instance: a fresh store is seeded with the built-in
// systems, which open from the library as the Design System page in an artifact tab (L's registry); and the owner's
// default chosen in Settings › Artifacts reaches the engine host (main's `artifacts.setDefaults`), so a document that
// names no system is pinned to it when a version is written (Acceptance 12 over the settings). M7 adds the rest of the
// group (Acceptance 9 to 14).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchMaws, type MawsLaunch } from './support/launch';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
interface Row {
  id: string;
  title: string;
}

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
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

test('a fresh store holds the built-in systems, and one opens from the library as the Design System page', async () => {
  test.setTimeout(90_000);
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
  await library.getByRole('article', { name: 'MAWS', exact: true }).click();
  const house = (await systems(page)).find((s) => s.title === 'MAWS')!;
  const tab = page.locator(`[data-artifact-tab="${house.id}"]`);
  await expect(tab.locator(`[data-ds-page="${house.id}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(tab.locator('.dsp-title')).toHaveText('MAWS');
  for (const section of ['palette', 'type', 'measures', 'canon', 'law', 'check']) await expect(tab.locator(`[data-ds-section="${section}"]`)).toBeAttached();
  await expect(tab.getByLabel('--ds-color-accent hex')).toBeVisible();
  // the owner looked at it: L's surface recorded the view once the page said it was on screen
  await expect.poll(async () => (await ok<{ artifact: { lastViewedAt: number | null } }>(page, 'artifacts.get', { artifactId: house.id })).artifact.lastViewedAt, { timeout: 10_000 }).not.toBeNull();
  expect(launch!.consoleErrors()).toEqual([]);
});

test('the owner’s default chosen in Settings reaches the host: a document naming no system is pinned to it', async () => {
  test.setTimeout(90_000);
  const page = await ready();
  const classroom = (await systems(page)).find((s) => s.title === 'Classroom')!;
  await menu(launch!.app, 'settings.open');
  const panel = page.locator('[data-region="main"]').getByRole('tabpanel');
  const select = panel.getByRole('combobox', { name: 'Default design system' });
  await expect(select).toBeVisible({ timeout: 15_000 });
  await expect(select.locator('option')).toHaveText(['House system', ...BUILT_IN]);
  await select.selectOption({ label: 'Classroom' });
  const settingsFile = join(launch!.userData, 'settings.json');
  await expect.poll(() => (JSON.parse(readFileSync(settingsFile, 'utf8')) as { artifacts: unknown }).artifacts).toEqual({ defaultDesignSystem: classroom.id, spaceDesignSystems: {} });

  const { artifact: doc } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Syllabus' });
  await ok(page, 'artifacts.testWrite', { artifactId: doc.id, opId: 'ds-e2e-1', ops: [{ op: 'insertText', index: 0, text: 'Week one.' }] });
  // main pushes the defaults on every settings change; the pin follows once the host has them
  await expect
    .poll(async () => {
      await ok(page, 'artifacts.saveVersion', { artifactId: doc.id, label: `check ${Date.now()}` });
      const { versions } = await ok<{ versions: { designSystemRef?: { id: string } | null }[] }>(page, 'artifacts.versions', { artifactId: doc.id });
      return versions.at(-1)?.designSystemRef?.id ?? null;
    }, { timeout: 10_000 })
    .toBe(classroom.id);
  expect(launch!.consoleErrors()).toEqual([]);
});
