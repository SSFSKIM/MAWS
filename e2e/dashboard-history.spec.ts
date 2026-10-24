// A dashboard's data in version history in the product app (P3-E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md,
// acceptance 4 and M4's proof; E's Decision Log 8 and 28; `pnpm e2e:dashboard`, MAWS_HARNESS=0). The owner draws a bar
// chart and a table over `sales` and keeps a second dataset no view binds, saves a version, and looks. While the tab is
// closed session A replaces both datasets' snapshots and nothing else: every chart attribute stays byte-identical. The
// store's scheduler writes its `auto` version (two minutes after the owner's last write, credited to the session),
// then the engine host is killed and restarts. Reopened, the dashboard offers "See 3 new changes" (the two views of the
// replaced dataset and the unbound one): the bar counts 3, the views are marked, and ↑ ↓ reach the chart, the table and
// the labelled unbound entry. The retained version previews its own numbers and time while the live document keeps the
// new ones; Make a copy draws the copy's own snapshot; Restore brings the old data back as a new version, which a closed
// and reopened tab keeps. Evidence shots go to test-results/dashboard-proof/.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bindCsv, chart, durable, insertBlocks, ok, openInMain, openInPanel, paragraph, selectPanelSession, railOf, reply, restartHost, selectChart, SESSION_A, startApp, tipsOf, toggleDatasets, type DashboardApp } from './support/dashboards';
import { launchMaws } from './support/launch';

const PROOF = 'test-results/dashboard-proof';
const AUTO_IDLE_MS = 2 * 60_000; // A's: an auto version this long after the last human update (src/engine-host/documents/store.ts)
const TITLE = 'Data history';
const OLD = { csv: 'region,total\nNorth,10\nSouth,20\n', at: Date.UTC(2026, 9, 1, 9, 0), tips: ['North · total: 10', 'South · total: 20'] };
const NEW = { csv: 'region,total\nNorth,30\nSouth,40\n', at: Date.UTC(2026, 9, 2, 10, 30), tips: ['North · total: 30', 'South · total: 40'] };
const OLD_LABEL = 'Sales · from sales.csv · updated 2026-10-01 09:00 UTC by You';
const NEW_LABEL = /^Sales · from sales\.csv · updated 2026-10-02 10:30 UTC by (?!You)/;
const VIEWS = [paragraph('Sales by region, quarterly.'), chart('sales', { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' }), chart('sales', { view: 'table', columns: ['region', 'total'], title: 'Sales table' })];

let app: DashboardApp | null = null;
test.afterEach(async () => {
  await app?.close();
  app = null;
});

// The views the live editor draws under a tab's scope, and the views of the version its preview shows.
const live = (scope: Locator) => scope.locator('.doc-live figure.dash-view');
const previewed = (scope: Locator) => scope.locator('.doc-preview figure.dash-view');

/** The bar chart's tips, the table's cells and the bar chart's source label, of `views` (the bar first, the table second). */
async function drawn(views: Locator): Promise<{ tips: (string | null)[]; table: string; label: string }> {
  const bar = views.nth(0);
  await expect(bar.locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
  await expect(views.nth(1).locator('.dash-figure > table')).toBeVisible({ timeout: 15_000 });
  return { tips: await tipsOf(bar), table: (await views.nth(1).locator('.dash-figure > table tbody').textContent()) ?? '', label: (await bar.locator('.dash-source-label').textContent()) ?? '' };
}
const showsOld = async (views: Locator) => {
  await expect.poll(async () => (await drawn(views)).tips, { timeout: 15_000, message: 'the old numbers' }).toEqual(OLD.tips);
  const now = await drawn(views);
  expect(now.table).toContain('10');
  expect(now.table).not.toContain('30');
  expect(now.label).toBe(OLD_LABEL);
};
const showsNew = async (views: Locator) => {
  await expect.poll(async () => (await drawn(views)).tips, { timeout: 15_000, message: 'the new numbers' }).toEqual(NEW.tips);
  const now = await drawn(views);
  expect(now.table).toContain('30');
  expect(now.label).toMatch(NEW_LABEL);
};
const closeTab = async (page: Page, main: Locator) => {
  await page.getByRole('button', { name: `Close ${TITLE}`, exact: true }).click();
  await expect(main).toHaveCount(0);
};

test('a replacement-only agent change counts, marks and steps after a host restart; a retained version previews its own data and time; duplicate and restore keep the snapshots', async () => {
  test.setTimeout(AUTO_IDLE_MS + 240_000);
  app = await startApp(PROOF);
  const { page, launch } = app;
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title: TITLE });
  const id = artifact.id;
  let main = await openInMain(page, id);

  // the owner's dashboard: the data bound, the views drawn, a version saved; the owner's last write starts A's idle clock
  await bindCsv(page, id, 'sales', { title: 'Sales', name: 'sales.csv', csv: OLD.csv, at: OLD.at });
  await bindCsv(page, id, 'spare', { title: 'Spare', name: 'spare.csv', csv: OLD.csv, at: OLD.at });
  await insertBlocks(main, VIEWS);
  await showsOld(live(main));
  await durable(main);
  const ownersLastWrite = Date.now();
  await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Before' });
  await expect(main.locator('.ds-doc .ProseMirror .doc-chart')).toHaveCount(2);

  await test.step('the tab closed and the owner’s view recorded, session A replaces both snapshots and nothing else; the scheduler’s version is the session’s', async () => {
    await closeTab(page, main);
    await ok(page, 'artifacts.markViewed', { artifactId: id });
    const viewed = (await ok<{ artifact: { lastViewedAt: number | null } }>(page, 'artifacts.get', { artifactId: id })).artifact.lastViewedAt!;
    await bindCsv(page, id, 'sales', { title: 'Sales', name: 'sales.csv', csv: NEW.csv, at: NEW.at, appSessionId: SESSION_A });
    await bindCsv(page, id, 'spare', { title: 'Spare', name: 'spare.csv', csv: NEW.csv, at: NEW.at, appSessionId: SESSION_A });
    const sessions = async () => (await ok<{ versions: { kind: string; at: number; actor: { kind: string } }[] }>(page, 'artifacts.versions', { artifactId: id })).versions.filter((v) => v.kind === 'auto' && v.actor.kind === 'session' && v.at > viewed);
    await expect.poll(async () => (await sessions()).length, { timeout: AUTO_IDLE_MS - (Date.now() - ownersLastWrite) + 60_000, intervals: [5_000], message: 'the scheduler’s auto version, credited to the session' }).toBe(1);
  });

  await test.step('after a host restart the reopened dashboard draws the new data and offers See 3 new changes', async () => {
    await restartHost(page);
    main = await openInMain(page, id);
    await showsNew(live(main));
    await expect(main.getByRole('button', { name: 'See 3 new changes' })).toBeVisible({ timeout: 20_000 });
    await main.screenshot({ path: `${PROOF}/history-pill.png` });
  });

  await test.step('the comparison counts 3, marks both views, and ↑ ↓ reach the chart, the table and the unbound entry', async () => {
    await main.getByRole('button', { name: 'See 3 new changes' }).click();
    const bar = main.getByRole('toolbar', { name: 'Version preview' });
    await expect(bar.getByText('Changes since you last looked')).toBeVisible({ timeout: 15_000 });
    await expect(bar.getByText('3 changes')).toBeVisible();
    const previewed = main.locator('.ProseMirror[data-editor="preview"] .doc-chart');
    await expect(previewed).toHaveCount(2, { timeout: 15_000 });
    for (const view of await previewed.all()) {
      await expect(view).toHaveClass(/\bdoc-change-attrs\b/);
      await expect(view).toHaveAttribute('data-change-block', '');
    }
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(previewed.nth(0)).toHaveClass(/\bdoc-change-current\b/);
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(previewed.nth(1)).toHaveClass(/\bdoc-change-current\b/);
    await expect(previewed.nth(0)).not.toHaveClass(/\bdoc-change-current\b/);
    await bar.getByRole('button', { name: 'Next change' }).click();
    const entry = bar.getByText('Dataset “spare” replaced');
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('data-current', '');
    await expect(main.locator('.ProseMirror[data-editor="preview"] .doc-change-current')).toHaveCount(0);
    // M6 (the tracker's unbound-stop row): the table reached before keeps no block selection outline
    await expect(main.locator('.ProseMirror[data-editor="preview"] .ProseMirror-selectednode')).toHaveCount(0);
    await main.screenshot({ path: `${PROOF}/history-steps.png` });
    await bar.getByRole('button', { name: 'Next change' }).click(); // wraps to the chart
    await expect(previewed.nth(0)).toHaveClass(/\bdoc-change-current\b/);
    await expect(entry).toBeHidden();
    await bar.getByRole('button', { name: 'Back to document' }).click();
    await expect(bar).toBeHidden();
  });

  await test.step('the retained version previews its own numbers and time; the live document keeps the new ones', async () => {
    const rail = main.getByRole('complementary', { name: 'Version history' });
    if (!(await rail.isVisible())) await main.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Version history' }).click(); // the pill opened it
    await rail.getByRole('button', { name: /^Version Before/ }).click();
    const bar = main.getByRole('toolbar', { name: 'Version preview' });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await showsOld(previewed(main));
    await main.screenshot({ path: `${PROOF}/history-preview-old.png` });
    // M6 (the displayed document, E2's Decision Log 12 and 17): the header's Datasets inspects the version shown, its
    // old snapshot's rows, not the live one's; back on the document it inspects the live snapshot
    const sourceRows = async () => {
      await toggleDatasets(page.locator('[data-region="main"] [data-editor-header]'));
      const sheet = page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'Dataset' }) });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('combobox', { name: 'Dataset' }).selectOption({ label: 'Sales (sales)' });
      const rows = sheet.getByRole('table', { name: 'Rows' });
      await expect(rows).toHaveAttribute('aria-rowcount', '3');
      const text = (await rows.textContent()) ?? '';
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      return text;
    };
    const versionRows = await sourceRows();
    expect(versionRows).toContain('10');
    expect(versionRows).not.toContain('30');

    await bar.getByRole('button', { name: 'Make a copy' }).click();
    await expect.poll(async () => (await ok<{ artifacts: { id: string; kind: string }[] }>(page, 'artifacts.list', {})).artifacts.filter((row) => row.kind === 'dashboard' && row.id !== id).length, { timeout: 15_000 }).toBe(1);
    await bar.getByRole('button', { name: 'Back to document' }).click();
    await showsNew(live(main));
    const liveRows = await sourceRows();
    expect(liveRows).toContain('30');
    expect(liveRows).not.toContain('10');
  });

  await test.step('Restore brings the old snapshot back as a new version; a closed and reopened tab keeps it', async () => {
    const rail = main.getByRole('complementary', { name: 'Version history' });
    await rail.getByRole('button', { name: /^Version Before/ }).click();
    const bar = main.getByRole('toolbar', { name: 'Version preview' });
    await bar.getByRole('button', { name: 'Restore this version' }).click();
    await main.getByRole('alertdialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(main.getByRole('status', { name: 'Restored' })).toContainText('Restored from Before', { timeout: 15_000 });
    await showsOld(live(main));
    const versions = await ok<{ versions: { kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
    expect(versions.versions).toContainEqual(expect.objectContaining({ kind: 'restore', label: 'Restored from Before' }));
    await durable(main);
    await closeTab(page, main);
    main = await openInMain(page, id);
    await showsOld(live(main));
  });

  await test.step('the copy of the retained version draws its own copied snapshot', async () => {
    const { artifacts } = await ok<{ artifacts: { id: string; kind: string; title: string }[] }>(page, 'artifacts.list', {});
    const copies = artifacts.filter((row) => row.kind === 'dashboard' && row.id !== id);
    expect(copies).toHaveLength(1);
    const copy = await openInMain(page, copies[0]!.id);
    await showsOld(live(copy));
    await copy.screenshot({ path: `${PROOF}/history-copy.png` });
  });
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// E-acc: accumulated file-backed state crosses a real application quit, not only a host or tab restart.
test('carried dashboard: bind, owner prose and conversation, agent replacement, restore, app relaunch and ordinary Duplicate', async () => {
  test.setTimeout(240_000);
  app = await startApp(PROOF);
  let { page } = app;
  const { agent } = app;
  await selectPanelSession(page);
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title: 'Carried dashboard' });
  const id = artifact.id;
  let record = await openInPanel(page, id);
  const read = () => agent.ok<{ revision: number }>('A', 'artifact_read', { artifact: id });
  await agent.ok('A', 'artifact_dataset', { artifact: id, baseRevision: (await read()).revision, id: 'sales', title: 'Sales', path: await agent.write('A', 'sales.csv', OLD.csv) });
  await insertBlocks(record, VIEWS);
  await insertBlocks(record, [paragraph('Owner: compare with last year.')]);
  await expect.poll(() => tipsOf(live(record).first())).toEqual(OLD.tips);
  const labels = await live(record).locator('.dash-source-label').allTextContents();
  expect(labels).toHaveLength(2);
  for (const label of labels) expect(label).toMatch(/^Sales · from sales\.csv · updated .* UTC by Harness A$/);
  await selectChart(record);
  await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Add comment', exact: true }).click();
  const card = page.locator('[data-comment-card]');
  await expect(card).toBeVisible();
  const block = record.locator('.doc-chart').first();
  await expect.poll(async () => (await block.getAttribute('class'))?.match(/\bcomment-(?!active\b)([\w-]+)/)?.[1] ?? '').not.toBe('');
  const threadId = (await block.getAttribute('class'))!.match(/\bcomment-(?!active\b)([\w-]+)/)![1]!;
  await card.getByRole('button', { name: 'Resolve' }).click();
  let rail = await railOf(record);
  await rail.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Reopen' }).click();
  await reply(rail, threadId, 'Keep the regional comparison.');
  await durable(record);
  const { versionId } = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Carried baseline' });
  await agent.ok('A', 'artifact_reply', { artifact: id, threadId, body: 'The comparison stays.' });
  await agent.ok('A', 'artifact_dataset', { artifact: id, baseRevision: (await read()).revision, id: 'sales', path: await agent.write('A', 'sales.csv', NEW.csv) });
  await expect.poll(() => tipsOf(live(record).first())).toEqual(NEW.tips);
  await expect(live(record).nth(1).locator('tbody')).toContainText('30');
  await expect(record.locator('.doc-live .ProseMirror')).toContainText('Owner: compare with last year.');
  await expect(rail.locator(`article[data-thread="${threadId}"]`)).toContainText('The comparison stays.');
  await ok(page, 'artifacts.restore', { artifactId: id, versionId });
  await expect.poll(() => tipsOf(live(record).first())).toEqual(OLD.tips);
  await durable(record);
  const history = await ok<{ versions: { id: number; kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
  expect(history.versions).toContainEqual(expect.objectContaining({ kind: 'restore', label: 'Restored from Carried baseline' }));
  expect(app.launch.consoleErrors()).toEqual([]);

  const original = app;
  const exited = original.launch.app.waitForEvent('close');
  await original.launch.app.evaluate(({ app }) => app.quit());
  await exited;
  const restarted = await launchMaws({ userData: original.launch.userData, keepConfigHome: true, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: 'stub:test/fixtures/panel/harness-sessions.json', MAWS_DASHBOARD_E2E: '1' } });
  app = { ...original, launch: restarted, page: restarted.page, close: async () => { await restarted.cleanup(); await original.close(); } };
  page = restarted.page;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 30_000 }).toBe('ready');
  record = await openInMain(page, id);
  await expect.poll(() => tipsOf(live(record).first())).toEqual(OLD.tips);
  await expect(live(record).nth(1).locator('tbody')).toHaveText('North10South20');
  await expect(live(record).locator('.dash-source-label')).toHaveText(labels);
  await expect(record.locator('.doc-live .ProseMirror')).toContainText('Owner: compare with last year.');
  rail = await railOf(record);
  const thread = rail.locator(`article[data-thread="${threadId}"]`);
  await expect(thread).toHaveAttribute('data-status', 'open');
  await expect(thread).not.toHaveAttribute('data-orphan');
  await expect(thread.getByRole('listitem')).toHaveText(['YouKeep the regional comparison.', /The comparison stays\.$/]);
  expect(await ok(page, 'artifacts.versions', { artifactId: id })).toEqual(history);
  await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Version history' }).click();
  await record.getByRole('complementary', { name: 'Version history' }).getByRole('button', { name: /^Version Carried baseline/ }).click();
  const preview = record.getByRole('toolbar', { name: 'Version preview' });
  await expect(preview).toBeVisible();
  await expect.poll(() => tipsOf(previewed(record).first())).toEqual(OLD.tips);
  await expect(previewed(record).nth(1).locator('tbody')).toHaveText('North10South20');
  await expect(previewed(record).locator('.dash-source-label')).toHaveText(labels);
  await expect(record.locator('.doc-preview .ProseMirror')).toContainText('Owner: compare with last year.');
  await preview.getByRole('button', { name: 'Back to document' }).click();
  await expect(preview).toBeHidden();

  // Ordinary library Duplicate, never the version preview's Make a copy.
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator(`[data-library] article[data-artifact-row="${id}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  const copies = async () => (await ok<{ artifacts: { id: string; kind: string }[] }>(page, 'artifacts.list', {})).artifacts.filter((a) => a.kind === 'dashboard' && a.id !== id);
  await expect.poll(async () => (await copies()).length).toBe(1);
  const copy = await openInMain(page, (await copies())[0]!.id);
  await expect.poll(() => tipsOf(live(copy).first())).toEqual(OLD.tips);
  await expect(live(copy).nth(1).locator('tbody')).toHaveText('North10South20');
  await expect(live(copy).locator('.dash-source-label')).toHaveText(labels);
  expect(restarted.consoleErrors()).toEqual([]);
});
