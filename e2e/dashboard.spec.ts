// The dashboard editor in the product app (P3-E2 M3 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, "Proof";
// `pnpm e2e:dashboard`, the product build, MAWS_HARNESS=0). A dashboard opens through L's registry in an `artifact` main
// tab and in the panel's Artifacts tool as two replicas of one host doc; its chart and table blocks draw E's renderer
// over real data (M1's vendored World Bank and penguin tables, Korean labels included) with their source labels; the
// narrow panel scrolls a figure rather than shrinking its text; the real editor's hover reaches a scatter's last point
// and a hatched bar's own value; the keyboard opens and closes the source sheet from a label; the sheet copies its rows,
// downloads the snapshot's own bytes through main's save, and stays on the snapshot it opened on while the dataset is
// replaced, both views redrawing; the header's Datasets lists the datasets. M6 extends this group with the agent's path
// (artifact_create, artifact_dataset), comments, history and exports.
//
// The data is bound as `artifact_dataset` binds it (an uploaded asset and its descriptor in the doc's `datasets` root),
// written here through the human's upload and the host's MAWS_E2E test writer, since this milestone's proof is the
// editor's; the agent's tool is M2's (unit-proved) and M6's (product). Evidence shots go to test-results/dashboard-proof/.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { GDP_CSV, PENGUINS_CSV } from '../src/artifacts/dashboard/fixtures/datasets';
import { DatasetError, parseDataset } from '../src/artifacts/dashboard/parse';
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
const hostState = (page: Page) => ok<{ state: string }>(page, 'engine.hostState');

const PROOF = 'test-results/dashboard-proof';
const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json';
let launch: MawsLaunch | null = null;
let userData: string | null = null;
let saved: string | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  for (const dir of [userData, saved]) if (dir) rmSync(dir, { recursive: true, force: true });
  userData = saved = null;
});

async function start(): Promise<Page> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true }); // session A's directory in the scenario
  mkdirSync(PROOF, { recursive: true });
  userData = mkdtempSync('/tmp/maws-e2e-dashboard-');
  saved = mkdtempSync('/tmp/maws-e2e-dashboard-saved-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS, MAWS_E2E_SAVE_PATH: saved } });
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  return page;
}

/** Binds `csv` as dataset `id`: the bytes uploaded as the dashboard's asset, the descriptor written as artifact_dataset writes it. */
let writes = 0;
async function bind(page: Page, artifactId: string, id: string, title: string, name: string, csv: string): Promise<string> {
  const bytes = new TextEncoder().encode(csv);
  const parsed = parseDataset(bytes, 'csv');
  if (parsed instanceof DatasetError) throw new Error(parsed.reason);
  const { ref } = (await page.evaluate(
    ([a, n, b]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean; value: { ref: string } }> } }).maws.invoke('artifacts.uploadAsset', { artifactId: a, name: n, mime: 'text/csv', bytes: new Uint8Array(b as number[]) }).then((r) => r.value),
    [artifactId, name, [...bytes]] as const,
  )) as { ref: string };
  const at = Date.now();
  const descriptor = {
    title,
    source: { kind: 'file', ref, name, format: 'csv', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length },
    columns: parsed.columns,
    rows: parsed.rows.length,
    updated: { at, by: { kind: 'human' } },
    state: { status: 'ok', at },
  };
  await ok(page, 'artifacts.testWrite', { artifactId, opId: `dashboard-bind-${++writes}`, ops: [{ op: 'setAttr', root: 'datasets', key: id, value: descriptor }] });
  return ref;
}

const chart = (source: string, spec: Record<string, unknown>) => ({ type: 'chart', attrs: { source, spec } });
const VIEWS = [
  chart('gdp', { view: 'bar', x: 'country_ko', y: 'growth_pct', filter: [{ column: 'year', op: 'eq', value: 2024 }], sort: { by: 'growth_pct', dir: 'desc' }, title: '2024년 실질 GDP 성장률 (%)' }),
  chart('gdp', { view: 'table', columns: ['country_ko', 'year', 'growth_pct'], filter: [{ column: 'year', op: 'eq', value: 2020 }], sort: { by: 'growth_pct', dir: 'asc' }, title: '2020년 성장률, 낮은 순' }),
  chart('penguins', { view: 'scatter', x: 'flipper_length_mm', y: 'body_mass_g', series: 'species_ko', title: '펭귄 344마리의 날개 길이와 체중' }),
  chart('penguins', { view: 'bar', x: 'island_ko', series: 'species_ko', agg: 'count', title: '섬별 종의 관측 수' }),
];

/** The owner's editor in `scope` inserts the blocks after its last one (the editor's own write, through its replica). */
async function insertBlocks(scope: Locator, blocks: unknown[]): Promise<void> {
  await scope.locator('.ds-doc .ProseMirror').first().evaluate((el, content) => {
    const editor = (el as HTMLElement & { editor: { state: { doc: { content: { size: number } } }; commands: { insertContentAt(at: number, content: unknown): boolean } } }).editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, content);
  }, blocks);
}

const figures = (scope: Locator) => scope.locator('.ds-doc figure.dash-view');
const tipsOf = (figure: Locator) => figure.locator('svg [data-tip]').evaluateAll((els) => els.map((el) => el.getAttribute('data-tip')));

test('a dashboard draws its views in the main tab and the panel, hovers every point, and opens its source sheet by keyboard; the sheet copies, downloads and keeps its snapshot across a replacement', async () => {
  test.setTimeout(180_000);
  const page = await start();
  const panel = page.locator('[data-region="panel"]');
  await (await sidebarRow(page, 'Harness A')).click();
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts' }).click();
  await panel.getByRole('button', { name: 'Pin Artifacts' }).click();

  const title = '성장률 대시보드';
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title });
  const id = artifact.id;
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const main = page.locator(`[data-artifact-tab="${id}"]`);
  await expect(main.locator('.ds-doc .ProseMirror')).toBeVisible({ timeout: 15_000 });
  const mainHeader = page.locator('[data-region="main"] [data-editor-header]');

  const gdpRef = await bind(page, id, 'gdp', '세계은행 GDP 성장률', 'gdp-growth.csv', GDP_CSV);
  await bind(page, id, 'penguins', 'Palmer penguins', 'penguins.csv', PENGUINS_CSV);
  await insertBlocks(main, [{ type: 'paragraph', content: [{ type: 'text', text: '2020년의 급락 이후 대부분의 경제가 회복했다.' }] }, ...VIEWS]);

  await test.step('the main tab draws every view with its caption and source label', async () => {
    await expect(figures(main)).toHaveCount(4);
    for (const figure of await figures(main).all()) await expect(figure.locator('.dash-figure > svg, .dash-figure > table')).toBeVisible({ timeout: 15_000 });
    const bar = figures(main).nth(0);
    await expect(bar.locator('.dash-caption')).toHaveText('2024년 실질 GDP 성장률 (%)');
    expect((await tipsOf(bar))[0]).toBe('미국 · growth_pct: 2.79');
    await expect(bar.locator('button.dash-source-label')).toHaveText(/^세계은행 GDP 성장률 · from gdp-growth\.csv · updated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC by You$/);
    // the table view is the document's own table, its text selectable: the first 25 rows of the view, noted
    const table = figures(main).nth(1).locator('.dash-figure > table.dash-table');
    await expect(table).toContainText('대한민국');
    await expect(table.locator('tbody tr')).toHaveCount(8);
    expect(await figures(main).nth(1).locator('.dash-figure svg').count()).toBe(0);
    // M1's geometry grade on the real faces: every text's glyph box inside its figure, Korean included
    const outside = await main.locator('.dash-figure svg').evaluateAll((svgs) =>
      svgs.flatMap((svg) => {
        const width = Number(svg.getAttribute('width'));
        const height = Number(svg.getAttribute('height'));
        return Array.from(svg.querySelectorAll('text')).flatMap((text) => {
          const box = (text as SVGTextElement).getBBox();
          return box.x < -0.5 || box.y < -0.5 || box.x + box.width > width + 0.5 || box.y + box.height > height + 0.5 ? [text.textContent] : [];
        });
      }),
    );
    expect(outside, 'no text outside its figure').toEqual([]);
    await main.screenshot({ path: `${PROOF}/main-tab.png` });
    expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
  });

  let record: Locator | null = null;
  await test.step('the panel, a second replica, draws the same views; a narrow column scrolls a figure rather than shrinking it', async () => {
    await panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/ }).click();
    await panel.getByRole('button', { name: 'All', exact: true }).click();
    await panel.locator(`[data-artifact-row][data-artifact-id="${id}"]`).click({ timeout: 15_000 });
    const shown = panel.locator(`[data-artifact-record="${id}"]`);
    record = shown;
    await expect(figures(shown)).toHaveCount(4, { timeout: 15_000 });
    await expect(figures(shown).nth(0).locator('svg')).toBeVisible({ timeout: 15_000 });
    expect(await tipsOf(figures(shown).nth(0))).toEqual(await tipsOf(figures(main).nth(0)));
    const frame = figures(shown).nth(0).locator('.dash-figure');
    const sizes = await frame.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, svg: el.querySelector('svg')!.getBoundingClientRect().width }));
    expect(sizes.svg, 'the figure keeps its legible size').toBeGreaterThanOrEqual(480);
    if (sizes.client < 480) expect(sizes.scroll, 'the narrow column scrolls the figure').toBeGreaterThan(sizes.client);
    await panel.screenshot({ path: `${PROOF}/panel-narrow.png` });
  });

  await test.step('the real editor\'s hover reaches the scatter\'s last point and a hatched bar\'s own value', async () => {
    const scatter = figures(main).nth(2);
    await scatter.scrollIntoViewIfNeeded();
    const last = await scatter.locator('svg').evaluate((svg) => {
      const layer = svg.querySelector('[data-hover="nearest"]')!;
      const [x, y] = layer.getAttribute('data-xy')!.split(' ').at(-1)!.split(',').map(Number);
      const box = svg.getBoundingClientRect();
      const scale = box.width / Number(svg.getAttribute('width'));
      return { x: box.left + x * scale, y: box.top + y * scale, tip: layer.getAttribute('data-tips')!.split('\n').at(-1)! };
    });
    await page.mouse.move(last.x, last.y);
    await expect(scatter.locator('.dash-tip')).toHaveText(last.tip);
    const counts = figures(main).nth(3);
    await counts.scrollIntoViewIfNeeded();
    const hatched = await counts.locator('svg').evaluate((svg) => {
      const hatch = Array.from(svg.querySelectorAll('path[pointer-events="none"]')).find((p) => p.previousElementSibling?.hasAttribute('data-tip'))!;
      const box = hatch.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, tip: hatch.previousElementSibling!.getAttribute('data-tip')! };
    });
    await page.mouse.move(hatched.x, hatched.y);
    await expect(counts.locator('.dash-tip')).toHaveText(hatched.tip);
    await counts.screenshot({ path: `${PROOF}/hatched-hover.png` });
  });

  await test.step('the keyboard opens the source sheet from a label, on the view\'s own rows, and closes it, the focus returning', async () => {
    const label = figures(main).nth(0).locator('button.dash-source-label');
    await label.focus();
    await page.keyboard.press('Enter');
    const sheet = main.page().getByRole('dialog', { name: 'Source of 세계은행 GDP 성장률' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'This view’s rows (8)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', '9'); // 2024, sorted as the view
    await expect(sheet.getByRole('row').nth(1)).toContainText('미국');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(await label.evaluate((el) => el === document.activeElement)).toBe(true);
  });

  await test.step('the sheet sorts and copies its rows, downloads the snapshot\'s own bytes, and keeps its snapshot across a replacement', async () => {
    await figures(main).nth(0).locator('button.dash-source-label').click();
    const sheet = page.getByRole('dialog', { name: 'Source of 세계은행 GDP 성장률' });
    await sheet.getByRole('button', { name: 'All source rows (48)' }).click();
    await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', '49');
    await sheet.getByRole('button', { name: 'Sort by growth_pct' }).click();
    await sheet.getByRole('button', { name: 'Sort by growth_pct' }).click(); // descending
    await sheet.getByRole('button', { name: 'Copy rows' }).click();
    await expect.poll(() => launch!.app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^country\tcountry_ko\tiso3\tyear\tgrowth_pct\n/);
    const text = await launch!.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(text.split('\n')).toHaveLength(50); // the header, 48 rows, the final newline
    await sheet.getByRole('button', { name: 'Download gdp-growth.csv' }).click();
    await expect(sheet.getByRole('status')).toHaveText('Saved to gdp-growth.csv');
    expect(readdirSync(saved!)).toEqual(['gdp-growth.csv']);
    expect(readFileSync(join(saved!, 'gdp-growth.csv'), 'utf8')).toBe(GDP_CSV);
    await page.screenshot({ path: `${PROOF}/source-sheet.png` });

    // the dataset replaced by its 2024 rows alone (a real subset): both replicas' views redraw, the open sheet stays
    const header = GDP_CSV.split('\n')[0];
    const only2024 = `${[header, ...GDP_CSV.split('\n').filter((line) => /,2024,[^,]*$/.test(line))].join('\n')}\n`; // "Korea, Rep." is quoted with its comma
    const replacedRef = await bind(page, id, 'gdp', '세계은행 GDP 성장률', 'gdp-growth.csv', only2024);
    expect(replacedRef).not.toBe(gdpRef);
    await expect(figures(main).nth(1).locator('table caption')).toHaveText('no rows to draw', { timeout: 15_000 }); // the 2020 table, now empty
    await expect(figures(record!).nth(1).locator('table caption')).toHaveText('no rows to draw', { timeout: 15_000 });
    await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', '49');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await figures(main).nth(0).locator('button.dash-source-label').click();
    await page.getByRole('dialog').getByRole('button', { name: 'All source rows (8)' }).click();
    await expect(page.getByRole('dialog').getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', '9');
    await page.keyboard.press('Escape');
  });

  await test.step('the header\'s Datasets (after B\'s actions, in More actions) opens the sheet on every dataset of the shown document', async () => {
    const datasets = async () => {
      await mainHeader.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Datasets' }).click();
    };
    await datasets();
    const picker = page.getByRole('dialog').getByRole('combobox', { name: 'Dataset' });
    await expect(picker.locator('option')).toHaveText(['세계은행 GDP 성장률 (gdp)', 'Palmer penguins (penguins)']);
    await page.screenshot({ path: `${PROOF}/datasets-sheet.png` });
    await datasets();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
