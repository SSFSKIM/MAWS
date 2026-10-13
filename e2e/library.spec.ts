// The library in utility mode (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4 Proves; `pnpm e2e:library`):
// against the live engine host through P3-A's IPC and its test writer (an agent stand-in), the Artifacts tab shows
// what `artifacts.create` and the writer made in the right date group with their kind counts; search finds a word in
// a document's text and in an HTML page; Pin moves a row into Pinned; a Space made and an artifact moved into it shows
// under By Space; Rename and Delete land after the host's event; and the library is right after the host process is
// killed and restarted.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, type MawsLaunch } from './support/launch';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

// An HTML page made through the bridge (its bytes are built in the page: a Uint8Array does not cross `evaluate`).
async function createHtml(page: Page, title: string, html: string): Promise<{ id: string }> {
  const result = (await page.evaluate(
    ([t, h]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke('artifacts.create', { kind: 'html', title: t, content: { bytes: new TextEncoder().encode(h), name: 'index.html' } }),
    [title, html] as const,
  )) as Result<{ artifact: { id: string } }>;
  if (!result.ok) throw new Error(`artifacts.create failed: ${result.error.message}`);
  return result.value.artifact;
}

async function hostState(page: Page): Promise<{ state: string; pid: number | null }> {
  return ok(page, 'engine.hostState');
}

const AGENT = 'app-e2e-library-agent';
let launch: MawsLaunch | null = null;
let scratch: string | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

test('the library lists, finds, pins, files into a Space, renames and deletes, and is right after the host restarts', async () => {
  test.setTimeout(120_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-library-'));
  const filePath = join(scratch, 'budget.csv');
  writeFileSync(filePath, 'month,amount\nOctober,1200\n');
  launch = await launchMaws();
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');

  // what the owner and an agent made
  const pricing = await createHtml(page, 'Pricing page', '<html><head><style>.quokka-style{}</style></head><body><h1>Plans</h1><p>Every quokka plan is billed monthly.</p></body></html>');
  const { artifact: budget } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'file', title: 'budget.csv', content: { path: filePath } });
  const { artifact: plan } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Launch plan' });
  await ok(page, 'artifacts.testWrite', {
    artifactId: plan.id, opId: 'lib-1', appSessionId: AGENT,
    ops: [{ op: 'insertText', index: 0, text: 'The launch waits for the zebra review on Friday.' }],
  });

  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const library = page.locator('[data-library]');
  const row = (title: string): Locator => library.getByRole('article', { name: title, exact: true });
  const titles = () => library.getByRole('article').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')));
  for (const title of ['Pricing page', 'budget.csv', 'Launch plan']) await expect(row(title)).toBeVisible({ timeout: 15_000 });

  // the date group and the kinds' counts
  const headings = () => library.getByRole('heading', { level: 2 }).allTextContents();
  expect(await headings()).toEqual(['Make something new', 'Today']);
  await expect(row('Launch plan')).toContainText('Edited');
  await expect(row('Launch plan')).toContainText('by Claude'); // the writer's session has no record in this profile
  await library.getByRole('button', { name: /Filter by type/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitemradio', { name: /^Documents/ })).toHaveText('Documents1');
  await expect(menu.getByRole('menuitemradio', { name: /^HTML pages/ })).toHaveText('HTML pages1');
  await expect(menu.getByRole('menuitemradio', { name: /^Files/ })).toHaveText('Files1');
  await expect(menu.getByRole('menuitemradio', { name: /^All types/ })).toHaveText('All types3');
  await page.keyboard.press('Escape');

  // search: a word inside the document's text (indexed once its revision settles), and inside the HTML page's body
  const search = library.getByRole('searchbox', { name: 'Search artifacts' });
  await search.fill('zebra');
  await expect.poll(titles, { timeout: 15_000, message: 'the document’s text is searchable' }).toEqual(['Launch plan']);
  await search.fill('quokka plan');
  await expect.poll(titles, { timeout: 15_000, message: 'the page’s text is searchable, its style is not' }).toEqual(['Pricing page']);
  await search.fill('quokka-style');
  await expect(library.getByText('No artifacts match “quokka-style”.')).toBeVisible();
  await search.fill('');

  // Pin moves the row into Pinned
  await row('Launch plan').getByRole('button', { name: 'Actions for Launch plan' }).click();
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect.poll(headings).toEqual(['Make something new', 'Pinned', 'Today']);
  await expect.poll(async () => (await titles())[0]).toBe('Launch plan');
  await library.getByRole('radio', { name: 'Pinned' }).click();
  await expect.poll(titles).toEqual(['Launch plan']);
  await library.getByRole('radio', { name: 'All' }).click();

  // a Space made, an artifact moved into it, shown under By Space
  await library.getByRole('button', { name: 'New Space' }).click();
  const sheet = page.getByRole('dialog', { name: 'New Space' });
  await sheet.getByRole('textbox', { name: 'Name' }).fill('Research');
  await sheet.getByRole('button', { name: 'Create' }).click();
  await expect(sheet).toBeHidden();
  await row('budget.csv').getByRole('button', { name: 'Actions for budget.csv' }).click();
  await page.getByRole('menuitem', { name: 'Move to Space' }).hover();
  await page.getByRole('menuitemradio', { name: 'Research' }).click();
  await expect(row('budget.csv').getByRole('button', { name: 'Research' })).toBeVisible();
  await library.getByRole('radio', { name: 'By Space' }).click();
  await expect.poll(headings).toEqual(['Research', 'No Space']);
  await library.getByRole('heading', { name: 'Research' }).getByRole('button').click();
  await expect(page.getByRole('button', { name: 'All Spaces' })).toBeVisible();
  await expect.poll(titles).toEqual(['budget.csv']);
  await page.getByRole('button', { name: 'All Spaces' }).click();
  await library.getByRole('radio', { name: 'All' }).click();

  // Rename through its sheet, and Delete after its confirmation, each shown once the host's event reached the index
  await row('Pricing page').getByRole('button', { name: 'Actions for Pricing page' }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename artifact' });
  await rename.getByRole('textbox', { name: 'Title' }).fill('Pricing, 2027');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(row('Pricing, 2027')).toBeVisible();
  expect(await ok<{ artifact: { title: string } }>(page, 'artifacts.get', { artifactId: pricing.id })).toMatchObject({ artifact: { title: 'Pricing, 2027' } });
  await row('budget.csv').getByRole('button', { name: 'Actions for budget.csv' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('dialog', { name: 'Delete “budget.csv”?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(row('budget.csv')).toHaveCount(0);
  expect(await ok(page, 'artifacts.get', { artifactId: budget.id })).toEqual({ artifact: null });
  await expect.poll(titles).toEqual(['Launch plan', 'Pricing, 2027']);

  // the host killed: it restarts, main reconciles at the new connection, and the library is as it was and follows on
  const { pid } = await hostState(page);
  process.kill(pid!, 'SIGKILL');
  await expect.poll(async () => (await hostState(page)).pid, { timeout: 30_000, message: 'the host restarts' }).not.toBe(pid);
  await expect.poll(async () => (await hostState(page)).state, { timeout: 30_000 }).toBe('ready');
  await expect.poll(titles).toEqual(['Launch plan', 'Pricing, 2027']);
  await ok(page, 'artifacts.update', { artifactId: plan.id, title: 'Launch plan, final' });
  await expect(row('Launch plan, final')).toBeVisible({ timeout: 15_000 });
  await search.fill('zebra');
  await expect.poll(titles, { timeout: 15_000 }).toEqual(['Launch plan, final']);

  expect(launch.consoleErrors()).toEqual([]);
});
