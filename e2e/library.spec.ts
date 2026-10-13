// The library in utility mode (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4 Proves; `pnpm e2e:library`):
// against the live engine host through P3-A's IPC and its test writer (an agent stand-in), the Artifacts tab shows
// what `artifacts.create` and the writer made in the right date group with their kind counts; search finds a word in
// a document's text and in an HTML page; Pin moves a row into Pinned; a Space made and an artifact moved into it shows
// under By Space; Rename and Delete land after the host's event; and the library is right after the host process is
// killed and restarted (M7: with a write main's index had missed, through main's e2e seam). M7's upgrade case: an index rewound
// to version 8 beside a populated host store migrates to 9 at launch and the first connection's snapshot fills it.
// `pnpm e2e:library` silences node:sqlite's ExperimentalWarning (the upgrade case opens the index file).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MIGRATIONS } from '../src/main/index/migrations';
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

async function libraryRevision(page: Page, artifactId: string): Promise<number | null> {
  return (await ok<{ row: { revision: number } | null }>(page, 'library.get', { artifactId })).row?.revision ?? null;
}

// Main's library stops following change events until the next host connection (src/main/library/index.ts's seam,
// MAWS_E2E=1 only), once the reads it has already taken have landed.
async function holdLibraryRefreshes(launch: MawsLaunch): Promise<void> {
  await launch.app.evaluate(() => (globalThis as unknown as { __maws_library: { holdRefreshes(): Promise<void> } }).__maws_library.holdRefreshes());
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

  // a write main misses: its library holds change-driven refreshes (the seam), the stand-in writes, and the change event
  // reaches the window (main has it too) while main's index stays behind; the host is killed, and the restarted host's
  // connection reconciles the index, the text included
  await page.evaluate((id) => {
    const seen = { revision: 0 };
    (window as unknown as { __changed: typeof seen }).__changed = seen;
    window.maws.on('artifacts.changed', (change) => {
      if (change.artifactId === id) seen.revision = Math.max(seen.revision, change.revision);
    });
  }, plan.id);
  await holdLibraryRefreshes(launch);
  const { revision: missed } = await ok<{ revision: number }>(page, 'artifacts.testWrite', {
    artifactId: plan.id, opId: 'lib-missed', appSessionId: AGENT,
    ops: [{ op: 'insertText', index: 0, text: 'The iguana signs off on Thursday. ' }],
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __changed: { revision: number } }).__changed.revision), { message: 'the write’s change event was told' }).toBe(missed);
  const stale = await libraryRevision(page, plan.id);
  expect(stale, 'main’s index missed the write').toBeLessThan(missed);
  await search.fill('iguana');
  await expect(library.getByText('No artifacts match “iguana”.')).toBeVisible();
  const { pid } = await hostState(page);
  process.kill(pid!, 'SIGKILL');
  await expect.poll(async () => (await hostState(page)).pid, { timeout: 30_000, message: 'the host restarts' }).not.toBe(pid);
  await expect.poll(async () => (await hostState(page)).state, { timeout: 30_000 }).toBe('ready');
  expect((await ok<{ artifact: { revision: number } }>(page, 'artifacts.get', { artifactId: plan.id })).artifact.revision).toBe(missed);
  await expect.poll(() => libraryRevision(page, plan.id), { timeout: 15_000, message: 'the reconciliation brought in the missed write' }).toBe(missed);
  await expect.poll(titles, { timeout: 15_000, message: 'and its text' }).toEqual(['Launch plan']);
  await search.fill('');
  await expect.poll(titles).toEqual(['Launch plan', 'Pricing, 2027']);
  await ok(page, 'artifacts.update', { artifactId: plan.id, title: 'Launch plan, final' });
  await expect(row('Launch plan, final')).toBeVisible({ timeout: 15_000 });
  await search.fill('zebra');
  await expect.poll(titles, { timeout: 15_000 }).toEqual(['Launch plan, final']);

  expect(launch.consoleErrors()).toEqual([]);
});

// The index's schema (every table, index and trigger, the FTS shadow tables included) and its version.
function schemaOf(db: DatabaseSync): { version: unknown; objects: unknown[] } {
  return {
    version: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    objects: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all(),
  };
}

// An index at version 8 as an install before P3-L left it: the library's four tables dropped (migration 9 only adds
// them) and the version set back, checked equal to the schema migrations 1 to 8 build.
function rewindIndexTo8(path: string): void {
  const db = new DatabaseSync(path);
  try {
    expect(schemaOf(db).version, 'the first launch left the index at 9').toBe(9);
    db.exec('DROP TABLE library_text; DROP TABLE library_links; DROP TABLE library_artifacts; DROP TABLE library_spaces; PRAGMA user_version = 8;');
    const template = new DatabaseSync(':memory:');
    try {
      for (const migration of MIGRATIONS.filter((m) => m.version <= 8)) template.exec(migration.sql);
      template.exec('PRAGMA user_version = 8');
      expect(schemaOf(db), 'the rewound index is a version-8 index').toEqual(schemaOf(template));
    } finally {
      template.close();
    }
  } finally {
    db.close();
  }
}

test('an index at version 8 beside a populated host store migrates to 9 at launch, and the first connection’s snapshot fills the library', async () => {
  test.setTimeout(120_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-library-upgrade-'));
  const userData = join(scratch, 'ud');
  mkdirSync(userData);
  const filePath = join(scratch, 'ledger.csv');
  writeFileSync(filePath, 'item,cost\nlantern,40\n');

  // the first launch fills the host's store (the index it leaves is rewound below)
  launch = await launchMaws({ userData });
  let { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  const harbour = await createHtml(page, 'Harbour page', '<html><body><p>The pelican pier opens at nine.</p></body></html>');
  const { artifact: ledger } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'file', title: 'ledger.csv', content: { path: filePath } });
  const { artifact: log } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Ship log' });
  const { revision } = await ok<{ revision: number }>(page, 'artifacts.testWrite', {
    artifactId: log.id, opId: 'upgrade-1', appSessionId: AGENT,
    ops: [{ op: 'insertText', index: 0, text: 'A walrus boarded at the second buoy.' }],
  });
  await launch.cleanup();
  launch = null;
  rewindIndexTo8(join(userData, 'index.sqlite'));

  // the upgrade: main migrates the index to 9, and the host's snapshot at the first connection is the whole library
  launch = await launchMaws({ userData });
  ({ page } = launch);
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const library = page.locator('[data-library]');
  const titles = () => library.getByRole('article').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')));
  await expect.poll(async () => (await titles()).sort(), { timeout: 15_000, message: 'the snapshot filled the library' }).toEqual(['Harbour page', 'Ship log', 'ledger.csv']);
  expect(await libraryRevision(page, log.id), 'the log at the session’s write').toBe(revision);
  // the session that wrote it is its last editor (the test writer links no session: a link comes from a session's own
  // create or tool write, which no IPC stand-in can make)
  expect((await ok<{ row: { lastEditor: unknown } }>(page, 'library.get', { artifactId: log.id })).row.lastEditor).toEqual({ kind: 'session', appSessionId: AGENT });
  await expect(library.getByRole('article', { name: 'Ship log', exact: true })).toContainText('by Claude'); // the writer's session has no record here
  await library.getByRole('button', { name: /Filter by type/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitemradio', { name: /^All types/ })).toHaveText('All types3');
  await page.keyboard.press('Escape');
  const search = library.getByRole('searchbox', { name: 'Search artifacts' });
  await search.fill('walrus');
  await expect.poll(titles, { timeout: 15_000, message: 'the document’s text is indexed after the upgrade' }).toEqual(['Ship log']);
  await search.fill('pelican');
  await expect.poll(titles, { timeout: 15_000 }).toEqual(['Harbour page']);
  await search.fill('lantern');
  await expect.poll(titles, { timeout: 15_000 }).toEqual(['ledger.csv']);
  for (const id of [harbour.id, ledger.id, log.id]) {
    expect(await libraryRevision(page, id), 'each row at the host’s revision').toBe((await ok<{ artifact: { revision: number } }>(page, 'artifacts.get', { artifactId: id })).artifact.revision);
  }
  expect(launch.consoleErrors()).toEqual([]);

  await launch.cleanup();
  launch = null;
  const db = new DatabaseSync(join(userData, 'index.sqlite'), { readOnly: true });
  try {
    expect(schemaOf(db).version, 'the index is at 9 again').toBe(9);
    expect((db.prepare('SELECT count(*) AS n FROM library_artifacts').get() as { n: number }).n).toBe(3);
  } finally {
    db.close();
  }
});
