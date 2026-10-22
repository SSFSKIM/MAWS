// P4-A2 G2 (X35; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §2 item 9 and §4.2's four rules [binding];
// docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R7, G-R7a, G2.5, G2.6): an agent's `artifact_dataset`
// call seen while it streams, end to end without a model. Part of `pnpm e2e:dashboard` (declared in
// e2e/support/dashboard-acceptance.ts), the product build, through the host seam (`documents/kinds/document-perf.ts`,
// MAWS_DOCUMENT_PERF=1): `stream` feeds a session's provisional emitter the call's input piece by piece, `call` runs the
// real `artifact_dataset` under the same tool-use id. The dashboard is the human's (`artifacts.create`, a paragraph
// typed); its three charts are the agent's own `artifact_edit`, two bound to `sales`, one to `costs`.
//
// Proved here, on the dashboard the owner sees (the document recorder of e2e/support/document-provisional.ts): from the
// frame in which the call's dataset id is whole, every chart bound to that dataset carries "<name> is updating <id>…" in
// the agent's colour, and no other chart does, with the agent's presence outline beside it, before the call writes
// anything; the label is withdrawn when the write lands, and never stands beside the data it announced; a refused call
// (a ragged file) is seen and withdrawn without trace, the revision and the drawn data unchanged.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { durable, figures, tipsOf } from './support/dashboards';
import { pieces, recordDrawing } from './support/document-provisional';
import type { ReadResult } from './support/document-scale';
import { ok, openFromLibrary, revisionOf, startWithSeam, type SeamApp } from './support/slides-provisional';

let app: SeamApp | null = null;
test.afterEach(async () => {
  await app?.close();
  app = null;
});

const AGENT = 'dashboard-provisional-agent';
const AGENT_NAME = 'Claude'; // an agent session with no title (src/shared/artifacts/actor.ts)
const TITLE = 'Provisional board';
const EDITOR = (id: string) => `[data-artifact-tab="${id}"] .ds-doc .ProseMirror[data-editor="live"]`;
const fence = (dataset: string, spec: Record<string, unknown>) => [`:::chart {spec-json='${JSON.stringify(spec)}'}`, dataset, ':::'].join('\n');
const CHARTS = [
  fence('sales', { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' }),
  fence('sales', { view: 'table', columns: ['region', 'total'], title: 'Sales table' }),
  fence('costs', { view: 'bar', x: 'region', y: 'cost', title: 'Costs by region' }),
].join('\n\n');
const SALES_CSV = 'region,total\n서울,120\n부산,98\n제주,40\n';
const SALES_TIPS = ['서울 · total: 120', '부산 · total: 98', '제주 · total: 40'];
const RAGGED_CSV = 'region,total\n"서울\n중구",120\n부산\n'; // its first record spans two lines; line 4 is ragged

const idOf = (read: ReadResult, words: string): string => {
  const line = read.markdown.split('\n').find((l) => l.includes(words));
  const marker = line && /\^([0-9a-z]+)\s*$/.exec(line);
  if (!marker) throw new Error(`no block reads "${words}" in:\n${read.markdown}`);
  return marker[1]!;
};

test('a dataset call labels every chart bound to it while it streams, the agent outlining them; the label withdrawn as the write lands, and without trace when the call is refused', async () => {
  test.setTimeout(150_000);
  app = await startWithSeam('dashboard-provisional');
  const { page, seam } = app;
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title: TITLE });
  const id = artifact.id;
  const tab = await openFromLibrary(page, TITLE, id, '.ds-doc .ProseMirror[data-editor="live"]');
  const editor = page.locator(EDITOR(id));
  await editor.click();
  await page.keyboard.type('Revenue by region.');
  await durable(tab);

  // the agent reads the dashboard and adds three charts after the paragraph: two over `sales`, one over `costs`
  const read = await seam.call<ReadResult>(AGENT, 'artifact_read', { artifact: id });
  expect(read.isError, read.text).toBe(false);
  const inserted = await seam.call<{ revision: number }>(AGENT, 'artifact_edit', { artifact: id, baseRevision: read.result!.revision, ops: [{ op: 'insert', after: idOf(read.result!, 'Revenue by region'), markdown: CHARTS }] });
  expect(inserted.isError, inserted.text).toBe(false);
  await expect(figures(tab)).toHaveCount(3, { timeout: 15_000 });
  // the insert's presence (its hold after the answer) clears before the dataset's call, so the outline judged is the call's
  await expect(editor.locator('[data-agent-editing]')).toHaveCount(0, { timeout: 20_000 });
  // the insert left a chart last, so the owner's editor writes its trailing paragraph (Tiptap's TrailingNode, guarded
  // against the binding's own write, runs on the editor's next transaction, here Presence's redraw): revision 24 in the
  // Mac run 39733208468, one after the insert's. The baseline is the revision once that has landed and nothing moves
  const trailing = () => editor.evaluate((root) => root.lastElementChild?.localName === 'p' && (root.lastElementChild.textContent ?? '') === '');
  await expect.poll(trailing, { timeout: 10_000, message: 'the editor’s trailing paragraph after the charts' }).toBe(true);
  await durable(tab);
  let settled = await revisionOf(page, id);
  await expect
    .poll(async () => {
      const now = await revisionOf(page, id);
      const same = now === settled;
      settled = now;
      return same;
    }, { intervals: [500], timeout: 10_000, message: 'the revision settled before the stream' })
    .toBe(true);
  const seen = await recordDrawing(page, EDITOR(id));

  // 1: `sales` bound from a CSV: streamed, then called; the agent's base stays its own last write (the insert), the
  // owner's trailing paragraph since merging as any unrelated change does
  const csv = join(app.dir, 'sales.csv');
  writeFileSync(csv, SALES_CSV);
  const toolUseId = 'toolu_dashboard_provisional_1';
  const args = { artifact: id, baseRevision: inserted.result!.revision, id: 'sales', title: 'Sales', path: csv };
  const t0 = Date.now();
  await seam.stream(AGENT, toolUseId, 'artifact_dataset', pieces(JSON.stringify(args)), 15);
  const labelled = editor.locator('[data-provisional-op="dataset"]');
  await expect(labelled).toHaveCount(2, { timeout: 10_000 });
  await test.step('each chart bound to the dataset labelled in the agent’s name, and no other, before the call writes anything', async () => {
    for (let i = 0; i < 2; i++) {
      const chart = labelled.nth(i);
      await expect(chart).toHaveAttribute('data-provisional', toolUseId);
      await expect(chart).toHaveAttribute('data-provisional-dataset', 'sales');
      await expect(chart).toHaveAttribute('data-provisional-label', `${AGENT_NAME} is updating sales…`);
      expect(await chart.evaluate((n) => n.matches('figure.dash-view') || n.querySelector('figure.dash-view') !== null), 'the label rides a chart').toBe(true);
    }
    const costs = figures(tab).filter({ hasText: 'Costs by region' });
    await expect(costs).toHaveCount(1);
    expect(await costs.evaluate((n) => n.closest('[data-provisional]') === null && n.querySelector('[data-provisional]') === null), 'the chart over another dataset is not labelled').toBe(true);
    expect(await revisionOf(page, id), 'nothing written since the stream began').toBe(settled);
  });
  await expect.poll(async () => (await seen()).some((s) => s.provisional.some((p) => p.id === toolUseId) && s.outlines.includes(AGENT_NAME)), { timeout: 10_000, message: 'the agent’s outline beside the label' }).toBe(true);
  expect(await revisionOf(page, id), 'nothing written by the stream, up to the call').toBe(settled);
  const bound = await seam.call<{ revision: number; rows: number }>(AGENT, 'artifact_dataset', { ...args, toolUseId });
  expect(bound.isError, bound.text).toBe(false);
  expect(bound.result!.rows).toBe(3);
  await expect(editor.locator('[data-provisional]')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => tipsOf(figures(tab).nth(0)), { timeout: 15_000, message: 'the bar draws the bound data' }).toEqual(SALES_TIPS);
  await expect(figures(tab).nth(0).locator('button.dash-source-label')).toHaveText(/^Sales · from sales\.csv · /);
  const samples = await seen();
  const firstLabel = samples.find((s) => s.provisional.some((p) => p.id === toolUseId));
  test.info().annotations.push({ type: 'the label (ms after the stream began)', description: JSON.stringify({ firstLabelMs: firstLabel ? firstLabel.at - t0 : null }) });
  await test.step('the label never stands beside the data it announced', () => {
    const doubles = samples.filter((s) => s.provisional.some((p) => p.id === toolUseId && p.text.includes('sales.csv')));
    expect(doubles.map((s) => ({ at: s.at - t0, provisional: s.provisional.map((p) => ({ id: p.id, op: p.op })) }))).toEqual([]);
  });

  // 2: a ragged file for the same dataset: the call is seen, refused, and withdrawn without trace
  const revisionBefore = await revisionOf(page, id);
  const ragged = join(app.dir, 'ragged.csv');
  writeFileSync(ragged, RAGGED_CSV);
  const refusedId = 'toolu_dashboard_provisional_refused';
  const refusedArgs = { artifact: id, baseRevision: bound.result!.revision, id: 'sales', path: ragged };
  await seam.stream(AGENT, refusedId, 'artifact_dataset', pieces(JSON.stringify(refusedArgs)), 15);
  await expect(editor.locator(`[data-provisional="${refusedId}"]`)).toHaveCount(2, { timeout: 10_000 });
  const refused = await seam.call(AGENT, 'artifact_dataset', { ...refusedArgs, toolUseId: refusedId });
  expect(refused.isError, 'the ragged file is refused').toBe(true);
  expect(refused.text).toMatch(/line 4/);
  await expect(editor.locator('[data-provisional]')).toHaveCount(0, { timeout: 10_000 });
  expect(await revisionOf(page, id), 'the revision is unchanged').toBe(revisionBefore);
  expect(await tipsOf(figures(tab).nth(0)), 'the drawn data is unchanged').toEqual(SALES_TIPS);
  expect(app.launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
