// The library in utility mode (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4 Proves; `pnpm e2e:library`):
// against the live engine host through P3-A's IPC and its test writer (an agent stand-in), the Artifacts tab shows
// what `artifacts.create` and the writer made in the right date group with their kind counts; search finds a word in
// a document's text and in an HTML page; Pin moves a row into Pinned; a Space made and an artifact moved into it shows
// under By Space; Rename and Delete land after the host's event; and the library is right after the host process is
// killed and restarted (M7: with a write main's index had missed, through main's e2e seam). M7's upgrade case: an index rewound
// to version 8 beside a populated host store migrates to 9 at launch and the first connection's snapshot fills it. M5b:
// an HTML artifact a session made (on C3's replay transport, `support/library-session.ts`) in the panel's Artifacts
// tool, its versions, P2's comment card and its Side thread, Open in tab and Export to PDF; a PDF, a video and an audio
// file played from the library. M6b: a profile with X12 records and an index at version 8 upgrades into the library.
// `pnpm e2e:library` silences node:sqlite's ExperimentalWarning (the upgrade case opens the index file).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { artifactUrl } from '../src/shared/artifacts/scheme';
import { MIGRATIONS } from '../src/main/index/migrations';
import { launchMaws, type MawsLaunch } from './support/launch';
import { ownTitles } from './support/library';
import { invoke, pageParentJournal, sideThreadOf, startSessionCase, threadJournal, value } from './support/library-session'; // M5b
import { minimalPdf, recordedWebm, silentWav } from './support/media-fixtures'; // M5b
import { allowNext, closeScene, idle, launchScene, ofKind, recordedCwd, replay, scratchProject, seedArtifact, seedFile, show, viewerOf } from './support/maws-tools'; // M6b

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
const cleanups: (() => Promise<void>)[] = []; // M5b: a session case's

test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
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
  const titles = () => ownTitles(page, library); // without the seeded design systems (P3-D)
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
  const seeded = Number((await menu.getByRole('menuitemradio', { name: /^Design systems/ }).textContent())!.replace(/\D/g, '')); // P3-D's seeds: the baseline
  await expect(menu.getByRole('menuitemradio', { name: /^All types/ })).toHaveText(`All types${3 + seeded}`);
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
  const titles = () => ownTitles(page, library); // without the seeded design systems (P3-D)
  await expect.poll(async () => (await titles()).sort(), { timeout: 15_000, message: 'the snapshot filled the library' }).toEqual(['Harbour page', 'Ship log', 'ledger.csv']);
  expect(await libraryRevision(page, log.id), 'the log at the session’s write').toBe(revision);
  // the session that wrote it is its last editor (the test writer links no session: a link comes from a session's own
  // create or tool write, which no IPC stand-in can make)
  expect((await ok<{ row: { lastEditor: unknown } }>(page, 'library.get', { artifactId: log.id })).row.lastEditor).toEqual({ kind: 'session', appSessionId: AGENT });
  await expect(library.getByRole('article', { name: 'Ship log', exact: true })).toContainText('by Claude'); // the writer's session has no record here
  await library.getByRole('button', { name: /Filter by type/ }).click();
  const menu = page.getByRole('menu');
  const seeded = Number((await menu.getByRole('menuitemradio', { name: /^Design systems/ }).textContent())!.replace(/\D/g, '')); // P3-D's seeds: the baseline
  await expect(menu.getByRole('menuitemradio', { name: /^All types/ })).toHaveText(`All types${3 + seeded}`);
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
    expect((db.prepare("SELECT count(*) AS n FROM library_artifacts WHERE kind <> 'design_system'").get() as { n: number }).n).toBe(3); // the case's own three (P3-D seeds design systems)
  } finally {
    db.close();
  }
});

// ---- M6b: the X12 upgrade ---------------------------------------------------------------------------------------------

// A profile as a build before P3-L left it: X12 deliverable records under `<userData>/deliverables/`, an index at
// version 8, and a transcript whose send_file row names an X12 record. The first launch replays E1's send_file
// recording (the transcript's row) and is then made pre-P3-L between the launches: the File artifact today's send_file
// made is deleted, and the journal's answer names an X12 record of the same file in its place, as E1's host answered;
// one more record, an HTML artifact (X12's `artifact`), belongs to the other session. The second launch's host imports
// the records at its start: the library shows a File and an HTML artifact with their sessions, and the row opens the
// File artifact.
const SEND_FILE = 'spikes/protocol-probe/fixtures/pass3/p1-maws-send-file.jsonl';

test('a profile with X12 records and an index at version 8 launches into a library of File and HTML artifacts with their sessions, and a transcript delivery row opens the artifact', async () => {
  test.setTimeout(180_000);
  // send_file stats the file in the recording's working directory, recreated before the launch (as E1's case does)
  const repo = recordedCwd(SEND_FILE);
  const existed = existsSync(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'hello.txt'), 'HELLO_E1');
  const project = scratchProject({ titles: ['L: delivered here', 'L: the other session'], repo });
  try {
    const first = await launchScene(project);
    const [here, other] = first.ids;
    let today: string;
    try {
      await show(first, here);
      await replay(first, here, SEND_FILE);
      await allowNext(first, here); // Write (seq 67)
      await allowNext(first, here); // mcp__maws__send_file (seq 99)
      await idle(first, here);
      today = ofKind(await first.events(here), 'maws.delivery.file')[0]!.deliverables[0]!.id;
      value(await invoke(first.page, 'artifacts.delete', { artifactId: today }));
    } catch (error) {
      await first.maws.cleanup();
      throw error;
    }
    await closeScene(first);

    const at = new Date(Date.now() - 3_600_000).toISOString();
    const hello = seedFile(project.userData, here, join(repo, 'hello.txt'), at);
    const dashboard = seedArtifact(project.userData, other, 'dash', 'Dashboard', ['<!doctype html><html><body><h1 id="heading">DASHBOARD</h1></body></html>'], at);
    const journals = join(project.userData, 'engine-host', 'journal', here);
    let named = 0;
    for (const name of readdirSync(journals).filter((n) => n.endsWith('.jsonl'))) {
      const text = readFileSync(join(journals, name), 'utf8');
      named += text.split(today).length - 1;
      writeFileSync(join(journals, name), text.replaceAll(today, hello.id));
    }
    expect(named, 'the journal named today’s File artifact').toBeGreaterThan(0);
    rewindIndexTo8(join(project.userData, 'index.sqlite'));

    const second = await launchScene(project, first.ids);
    try {
      const { page } = second;
      await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
      const library = page.locator('[data-library]');
      await expect.poll(async () => (await ownTitles(page, library)).sort(), { timeout: 20_000, message: 'the import filled the library' }).toEqual(['Dashboard', 'hello.txt']);
      const file = library.getByRole('article', { name: 'hello.txt', exact: true });
      await expect(file).toContainText('File');
      await expect(file.getByRole('button', { name: 'L: delivered here', exact: true })).toBeVisible();
      const dashRow = library.getByRole('article', { name: 'Dashboard', exact: true });
      await expect(dashRow).toContainText('HTML page');
      await expect(dashRow.getByRole('button', { name: 'L: the other session', exact: true })).toBeVisible();
      expect(value(await invoke(page, 'artifacts.get', { artifactId: dashboard.id })).artifact!.kind).toBe('html');

      // the transcript's delivery row, naming the X12 record, opens the File artifact the record became
      await show(second, here);
      const name = second.pane.locator('[data-delivery] button.transcript-delivery-open');
      await expect(name).toHaveText('hello.txt');
      await name.click();
      await expect(viewerOf(second.panel)).toHaveAttribute('data-artifact-viewer', hello.id);
      await expect(viewerOf(second.panel).locator('[data-file-viewer]')).toContainText('HELLO_E1');
    } catch (error) {
      await second.maws.cleanup();
      throw error;
    }
    await closeScene(second);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
    if (!existed) rmSync(repo, { recursive: true, force: true });
  }
});

// ---- M5b: the HTML and File viewers on the store, P2's comment card, Export -------------------------------------------------

const HEADING_PAGE = (version: string) =>
  '<!doctype html><html><head><meta charset="utf-8"><title>Dashboard</title></head><body style="margin:0;font:16px system-ui;background:#ffffff;color:#1b1b1b">' +
  '<h1 id="hero" style="margin:0;padding:32px 24px;background:#e3f2fd">Sales overview</h1>' +
  `<p id="version" style="padding:0 24px">${version}</p></body></html>`;
const CARD_COMMENT = 'Make the heading larger.';
const CARD_REPLY = 'The heading is now 48 px, up from 32.';

// The card 4 px under the element's bottom edge, at its left (P2's below placement).
async function pinnedUnder(element: Locator, card: Locator): Promise<boolean> {
  const [box, placed] = [await element.boundingBox(), await card.boundingBox()];
  return box !== null && placed !== null && Math.abs(placed.y - (box.y + box.height + 4)) <= 1 && Math.abs(placed.x - box.x) <= 1;
}

test('an HTML artifact in the panel’s Artifacts tool: its versions switch, Comment opens P2’s card and its Side thread, Open in tab shows it in a main tab, and Export to PDF saves a PDF', async () => {
  test.setTimeout(180_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-library-viewer-'));
  const saved = join(scratch, 'saved');
  mkdirSync(saved);
  const c = await startSessionCase(
    (cwd) => [pageParentJournal(cwd, HEADING_PAGE('VERSION_ONE'), 'Dashboard'), threadJournal(cwd, 'Dashboard v2 › h1#hero “Sales overview”', CARD_REPLY)],
    { MAWS_E2E_SAVE_PATH: saved },
  );
  cleanups.push(c.cleanup);
  const { page, parent } = c;

  // the parent's page, in the store and linked to it; a second version written as the session
  let id = '';
  await expect.poll(async () => (id = value(await invoke(page, 'library.list', { filter: { appSessionId: parent as never, kind: 'html' } })).rows[0]?.id ?? ''), { timeout: 15_000 }).not.toBe('');
  value(await invoke(page, 'artifacts.testWrite', { artifactId: id, opId: 'library-v2', ops: [{ op: 'page', text: HEADING_PAGE('VERSION_TWO') }], appSessionId: parent as never }));
  const seqs = value(await invoke(page, 'artifacts.versions', { artifactId: id })).versions.map((v) => v.seq).sort((a, b) => a - b);
  expect(seqs).toHaveLength(2);
  expect(value(await invoke(page, 'artifacts.get', { artifactId: id })).artifact!.lastViewedAt).toBeNull();

  // the panel's Artifacts tool, This session: the page opens in the record view on its latest version
  const panel = page.locator('[data-region="panel"]');
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${id}"]`).click();
  const viewer = panel.locator('[data-artifact-viewer]');
  const frame = viewer.locator('[data-artifact-frame="html"]');
  await expect(frame).toHaveAttribute('src', artifactUrl(id, seqs[1]!, 'index.html'));
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  const content = viewer.frameLocator('[data-artifact-frame="html"]');
  await expect(content.locator('#version')).toHaveText('VERSION_TWO');
  await expect(panel.locator('[data-editor-header] [data-header-title]')).toHaveText('Dashboard');
  await expect(panel.locator('[data-editor-header] [data-header-saved]')).toHaveText('Read-only');
  // the owner's view is recorded once the page is on screen (Decision Log 15)
  await expect.poll(async () => value(await invoke(page, 'artifacts.get', { artifactId: id })).artifact!.lastViewedAt, { message: 'markViewed set lastViewedAt' }).not.toBeNull();

  // its versions switch
  const picker = viewer.getByRole('combobox', { name: 'Version' });
  await expect(picker.locator('option')).toHaveText(['v1', 'v2 · latest']);
  await picker.selectOption('1');
  await expect(frame).toHaveAttribute('src', artifactUrl(id, seqs[0]!, 'index.html'));
  await expect(content.locator('#version')).toHaveText('VERSION_ONE');
  await picker.selectOption('2');
  await expect(content.locator('#version')).toHaveText('VERSION_TWO');

  // Comment: picking, a click on the heading, the card anchored under it, as P2's
  await panel.locator('[data-editor-header]').getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(viewer.locator('[data-picking]')).toBeVisible();
  const box = (await frame.boundingBox())!;
  await page.mouse.click(box.x + 60, box.y + 30);
  const card = viewer.locator('[data-comment-card]');
  await expect(card).toHaveAttribute('data-card-phase', 'composing');
  await expect(card).toHaveAttribute('data-anchor-locator', '#hero');
  await expect(viewer.getByRole('dialog', { name: 'Comment on Dashboard v2 › h1#hero “Sales overview”' })).toBeVisible();
  await expect(viewer.locator('[data-picking]')).toHaveCount(0); // one pick per Comment
  await expect.poll(() => pinnedUnder(content.locator('#hero'), card), { message: 'the card 4 px under the heading, at its left' }).toBe(true);

  // Side thread routes it: the card becomes the thread, answered in the card
  await expect(card.getByRole('radio', { name: 'Side thread' })).toBeChecked();
  await card.getByRole('textbox', { name: 'Comment' }).fill(CARD_COMMENT);
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card).toHaveAttribute('data-card-phase', 'thread', { timeout: 20_000 });
  await sideThreadOf(page, parent);
  await expect(card.getByText(CARD_REPLY)).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(CARD_COMMENT, { exact: true })).toBeVisible();

  // Open in tab: the same artifact in a main tab of its own
  await panel.getByRole('button', { name: 'Open in tab' }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
  await expect(tab.locator('[data-artifact-viewer]')).toBeVisible();
  await expect(tab.frameLocator('[data-artifact-frame="html"]').locator('#version')).toHaveText('VERSION_TWO');

  // Export › PDF in the tab's header: the export saved where the owner chose (the e2e's folder), a PDF
  const mainHeader = page.locator('[data-region="main"] [data-editor-header]');
  await mainHeader.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click();
  const pdf = join(saved, 'Dashboard.pdf');
  await expect.poll(() => (existsSync(pdf) ? readFileSync(pdf).subarray(0, 5).toString('latin1') : ''), { timeout: 60_000, message: 'the exported PDF saved' }).toBe('%PDF-');
  await expect(page.getByRole('region', { name: /^Notifications/ }).getByText(`Saved to ${pdf}`)).toBeVisible();
  expect(c.maws.consoleErrors()).toEqual([]);
});

test('a PDF, a video and an audio file artifact play in their viewers from the library', async () => {
  test.setTimeout(120_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-library-media-'));
  launch = await launchMaws();
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  const put = (name: string, bytes: Buffer) => {
    const path = join(scratch!, name);
    writeFileSync(path, bytes);
    return path;
  };
  const make = async (title: string, path: string) => (await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'file', title, content: { path } })).artifact;
  const report = await make('report.pdf', put('report.pdf', minimalPdf()));
  const clip = await make('clip.webm', put('clip.webm', await recordedWebm(page)));
  const tone = await make('tone.wav', put('tone.wav', silentWav()));

  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const library = page.locator('[data-library]');
  const open = async (title: string, id: string) => {
    await library.getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
    const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
    await expect(tab.locator('[data-artifact-viewer]')).toBeVisible();
    return tab;
  };

  // the PDF: Chromium's viewer draws the page in the unsandboxed frame
  const pdfTab = await open('report.pdf', report.id);
  const pdfFrame = pdfTab.locator('[data-artifact-frame="pdf"]');
  await expect(pdfFrame).toHaveAttribute('src', new RegExp(`^maws-artifact://${report.id}/\\d+/report\\.pdf$`));
  await expect(pdfFrame).not.toHaveAttribute('sandbox');
  await expect.poll(() => darkPixels(launch!, pdfFrame), { timeout: 15_000, message: 'the PDF frame draws its page' }).toBeGreaterThan(2_000);

  // the video plays; the tone plays
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const video = (await open('clip.webm', clip.id)).locator('video[data-artifact-media="video"]');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const audio = (await open('tone.wav', tone.id)).locator('audio[data-artifact-media="audio"]');
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeCloseTo(1, 1);
  await audio.evaluate(async (a: HTMLAudioElement) => {
    a.muted = true;
    await a.play();
  });
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.2);
  expect(launch.consoleErrors()).toEqual([]);
});

// The dark pixels the window draws inside `element` (a PDF page's black square).
async function darkPixels(maws: MawsLaunch, element: Locator): Promise<number> {
  const rect = (await element.boundingBox())!;
  const clip = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  return maws.app.evaluate(async ({ BrowserWindow }, clip) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!;
    const bitmap = (await win.webContents.capturePage(clip)).toBitmap(); // BGRA
    let dark = 0;
    for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i]! < 40 && bitmap[i + 1]! < 40 && bitmap[i + 2]! < 40) dark++;
    return dark;
  }, clip);
}
