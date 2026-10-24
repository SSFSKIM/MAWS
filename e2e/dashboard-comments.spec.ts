// A comment on a dashboard's chart in the product app (P3-E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md,
// acceptance 3; E's Decision Log 28; `pnpm e2e:dashboard`, MAWS_HARNESS=0). The dashboard sits in the panel's pinned
// Artifacts tool beside session A (a comment is offered while the main area shows a session). The owner selects a
// drawn chart and chooses Comment: P2's card opens on the block, its locator the view and caption; kept the owner's way
// (Resolve on the card, Reopen in the rail), replied to in the rail, versioned. The chart cut through the Mac's
// pasteboard orphans the thread (its quote kept); pasted into a new tab, the thread follows it there (the host moves its
// tab); deleted, it is orphaned again and is resolved and reopened in the rail; a restore of the version brings the chart
// back to its first tab with the thread live, every reply kept. Evidence shots go to test-results/dashboard-proof/.
import { addDocumentSection } from './support/document-sections';
import { expect, test, type Locator } from '@playwright/test';
import { bindCsv, chart, closeDrawer, durable, edit, figures, insertBlocks, ok, openInPanel, paragraph, selectPanelSession, railOf, reply, selectChart, startApp, type DashboardApp } from './support/dashboards';

const PROOF = 'test-results/dashboard-proof';
const SALES_CSV = 'region,total\nNorth,10\nSouth,20\nWest,15\n';
const QUOTE = 'chart: Sales by region';

let app: DashboardApp | null = null;
test.afterEach(async () => {
  await app?.close();
  app = null;
});

// The thread as the panel's replica holds it (the host's refresh reaches it), and the tabs by title.
const replicaRead = (record: Locator, threadId: string) =>
  record
    .locator('.ds-doc .ProseMirror')
    .first()
    .evaluate((el, id) => {
      type Y = { getAttr(name: string): unknown; attrEntries(): Iterable<[string, unknown]> };
      const editor = (el as HTMLElement & { editor: { extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { doc: { get(name: string): Y } } } } }> } } }).editor;
      const doc = editor.extensionManager.extensions.find((extension) => extension.name === 'collaboration')!.options.hold!.base.doc;
      const thread = doc.get('threads').getAttr(id) as Y | undefined;
      const tabs = Object.fromEntries([...doc.get('tabs').attrEntries()].map(([tabId, tab]) => [String((tab as Y).getAttr('title')), tabId]));
      return { tabs, tabId: thread?.getAttr('tabId') as string | undefined, blockId: thread?.getAttr('blockId') as string | undefined, anchor: thread?.getAttr('anchor'), status: thread?.getAttr('status') as string | undefined };
    }, threadId);

test('a chart’s comment follows it through a cut and a paste into another tab, is orphaned with its quote when deleted, resolves and reopens, and a restore brings it back live with every reply', async () => {
  test.setTimeout(180_000);
  app = await startApp(PROOF);
  const { page, launch } = app;
  await selectPanelSession(page);
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title: 'Regional board' });
  const id = artifact.id;
  const record = await openInPanel(page, id);
  await bindCsv(page, id, 'sales', { title: 'Sales', name: 'sales.csv', csv: SALES_CSV, at: Date.UTC(2026, 9, 1, 9, 0) });
  await insertBlocks(record, [paragraph('Sales rose in every region.'), chart('sales', { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' }), paragraph('Notes follow.')]);
  await expect(figures(record).first().locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
  const tabs = record.getByRole('tablist', { name: 'Tabs' });
  const chartBlock = record.locator('.doc-chart');

  let threadId = '';
  let firstTab = '';
  await test.step('Comment on the selected chart opens the card on the block, its locator the view and caption, and writes no mark', async () => {
    await selectChart(record);
    await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Add comment', exact: true }).click();
    const card = page.locator('[data-comment-card]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-comment');
    await expect(card).toHaveAttribute('data-anchor-locator', QUOTE);
    await expect.poll(async () => (await chartBlock.getAttribute('class'))?.match(/\bcomment-(?!active\b)([\w-]+)/)?.[1] ?? '', { message: 'the chart drawn as the comment’s block' }).not.toBe('');
    threadId = (await chartBlock.getAttribute('class'))!.match(/\bcomment-(?!active\b)([\w-]+)/)![1]!;
    expect(await record.locator('[data-thread]').count(), 'no comment mark in the text').toBe(0);
    const held = await replicaRead(record, threadId);
    expect(held).toMatchObject({ blockId: expect.any(String), anchor: { kind: 'block' }, status: 'open' });
    firstTab = held.tabId!;
    await page.screenshot({ path: `${PROOF}/comment-card.png` });
    // kept the owner's way (nothing is sent to the session here): Resolve on the card, Reopen in the rail
    await card.getByRole('button', { name: 'Resolve' }).click();
    await expect(card).toHaveCount(0);
    await expect(chartBlock).not.toHaveClass(new RegExp(`comment-${threadId}`));
    const rail = await railOf(record);
    await rail.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Reopen' }).click();
    await expect(chartBlock).toHaveClass(new RegExp(`\\bcomment-${threadId}\\b`));
    await reply(rail, threadId, 'Why does the west dip?');
    await expect(rail.locator(`article[data-thread="${threadId}"]`).getByRole('listitem')).toHaveText(['YouWhy does the west dip?']);
    await expect(rail.locator(`article[data-thread="${threadId}"] .doc-thread-quote-text`)).toHaveText(QUOTE);
  });

  await durable(record);
  const { versionId } = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Commented' });

  await test.step('cut through the pasteboard, the thread is orphaned with its quote; pasted into a new tab, it follows the chart there', async () => {
    await selectChart(record);
    await edit(launch, 'cut');
    await expect(figures(record)).toHaveCount(0);
    const rail = await railOf(record);
    const item = rail.locator(`article[data-thread="${threadId}"]`);
    const showDeleted = rail.getByRole('button', { name: 'Show deleted-target comments', exact: true });
    await expect(showDeleted).toHaveAttribute('aria-pressed', 'false');
    await expect(item).toHaveCount(0);
    await showDeleted.click();
    await expect(item).toHaveAttribute('data-orphan', '');
    await expect(item.locator('.doc-thread-quote-text')).toHaveText(QUOTE);
    // Back to the default filter: pasting the target must show its thread without revealing deleted targets.
    await rail.getByRole('button', { name: 'Hide deleted-target comments', exact: true }).click();
    await expect(item).toHaveCount(0);

    await addDocumentSection(record);
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
    // the rail is P3-F1's drawer over the narrow panel's page: the owner closes it to click into the new tab's page, and
    // opens it again to read the thread
    await closeDrawer(record);
    await record.locator('.ds-doc .ProseMirror').first().click();
    await edit(launch, 'paste');
    await expect(figures(record)).toHaveCount(1, { timeout: 10_000 });
    await expect(figures(record).first().locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
    await railOf(record);
    await expect(chartBlock).toHaveClass(new RegExp(`\\bcomment-${threadId}\\b`));
    await expect(item).not.toHaveAttribute('data-orphan');
    await expect.poll(async () => {
      const held = await replicaRead(record, threadId);
      return held.tabId !== firstTab && held.tabId === held.tabs['Tab 2'];
    }, { timeout: 10_000, message: 'the host moved the thread to the chart’s new tab' }).toBe(true);
    await expect(item.locator('.doc-thread-tab')).toHaveCount(0); // the shown tab's own thread: no other tab named
    await page.screenshot({ path: `${PROOF}/comment-moved.png` });
  });

  await test.step('deleted, the thread is orphaned with its quote; the rail resolves and reopens it and takes a reply', async () => {
    await selectChart(record);
    await page.keyboard.press('Backspace');
    await expect(figures(record)).toHaveCount(0);
    const rail = await railOf(record);
    const item = rail.locator(`article[data-thread="${threadId}"]`);
    const showDeleted = rail.getByRole('button', { name: 'Show deleted-target comments', exact: true });
    await expect(showDeleted).toHaveAttribute('aria-pressed', 'false');
    await expect(item).toHaveCount(0);
    await showDeleted.click();
    await expect(item).toHaveAttribute('data-orphan', '');
    await expect(item.locator('.doc-thread-quote-text')).toHaveText(QUOTE);
    await item.getByRole('button', { name: 'Resolve' }).click();
    const resolved = rail.getByRole('region', { name: /Resolved/ });
    await expect(resolved.locator(`article[data-thread="${threadId}"]`)).toHaveAttribute('data-status', 'resolved');
    await resolved.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Reopen' }).click();
    await expect(rail.locator(`article[data-thread="${threadId}"]`)).toHaveAttribute('data-status', 'open');
    await reply(rail, threadId, 'Posted after the deletion.');
    await expect(rail.locator(`article[data-thread="${threadId}"]`).getByRole('listitem')).toHaveText(['YouWhy does the west dip?', 'YouPosted after the deletion.']);
  });

  await test.step('a restore of the version brings the chart back to its first tab, the thread live there with every reply', async () => {
    await durable(record);
    await ok(page, 'artifacts.restore', { artifactId: id, versionId });
    await expect(tabs).toHaveCount(0, { timeout: 15_000 });
    await expect(figures(record)).toHaveCount(1, { timeout: 15_000 });
    await expect(figures(record).first().locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
    await expect(chartBlock).toHaveClass(new RegExp(`\\bcomment-${threadId}\\b`));
    const rail = await railOf(record);
    const item = rail.locator(`article[data-thread="${threadId}"]`);
    await expect(item).not.toHaveAttribute('data-orphan');
    await expect(item).toHaveAttribute('data-status', 'open');
    await expect(item.getByRole('listitem'), 'the reply posted after the version stays').toHaveText(['YouWhy does the west dip?', 'YouPosted after the deletion.']);
    await expect.poll(async () => (await replicaRead(record, threadId)).tabId, { timeout: 10_000, message: 'the thread back on the first tab' }).toBe(firstTab);
    await record.screenshot({ path: `${PROOF}/comment-restored.png` });
  });
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
