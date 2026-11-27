// The library in utility mode (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4 Proves; `pnpm e2e:library`):
// against the live engine host through P3-A's IPC and its test writer (an agent stand-in), the Artifacts tab shows
// what `artifacts.create` and the writer made in the right date group with their kind counts; search finds a word in
// a document's text and in an HTML page; Pin moves a row into Pinned; a Space made and an artifact moved into it shows
// under By Space; Rename and Delete land after the host's event; and the library is right after the host process is
// killed and restarted (M7: with a write main's index had missed, through main's e2e seam). M7's upgrade case: an index rewound
// to version 9 beside a populated host store migrates to the current version at launch and the first connection's snapshot fills it. M5b:
// an HTML artifact a session made (on C3's replay transport, `support/library-session.ts`) in the panel's Artifacts
// tool, its versions, P2's comment card and its Side thread, Move to tab and Export to PDF; a PDF, a video and an audio
// file played from the library. M6b: a profile with X12 records and an index at version 9 upgrades into the library.
// P3-H (P3 Decision Log 92): a row menu's Export on its first opening.
// UX wave U10b (M5, A4): an agent deletes its own draft while a tab shows it: the transcript's row, the Library without it,
// the tab's notice over an editor that takes no keystroke, and the row's Undo bringing it back.
// `pnpm e2e:library` silences node:sqlite's ExperimentalWarning (the upgrade case opens the index file).
import { activeMainTab, backToTabs, mainTab, openAppDestination, openArtifactInPanel, pageRegion } from './support/shell';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { artifactUrl } from '../src/shared/artifacts/scheme';
import { ADDED_COLUMNS, ADDED_TABLES, MIGRATIONS } from '../src/services/index/migrations';
import { launchMaws, type MawsLaunch } from './support/launch';
import { ownTitles } from './support/library';
import { DRAFTER, FIRST_REPLY, invoke, openDraftCase, PARENT, pageParentJournal, sideThreadOf, startSessionCase, threadJournal, value } from './support/library-session'; // M5b; UX wave U10b: DRAFTER, openDraftCase
import { AgentSeam } from './support/dashboards'; // UX wave U10b: the agent's draft, made by its session's own tools
import { SideJournal } from './support/side-replay'; // UX wave U7b
import { minimalPdf, recordedWebm, silentWav } from './support/media-fixtures'; // M5b
import { closeScene, launchScene, scratchProject, seedArtifact, seedRecord, show, viewerOf, type Scratch } from './support/maws-tools'; // M6b
import { sidebarRow } from './support/sidebar'; // P4 W2-D

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
// A viewer's frame URL with the query naming its machine (`artifactUrlOn`), this Mac's in these scenes
const escaped = (text: string) => text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
const namesMachine = (url: string) => new RegExp(`^${escaped(url)}\\?machine=[A-Za-z0-9_-]{16,64}$`);

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

// Main's library stops following change events until the next host connection (src/services/library/index.ts's seam,
// MAWS_E2E=1 only), once the reads it has already taken have landed.
async function holdLibraryRefreshes(launch: MawsLaunch): Promise<void> {
  await launch.app.evaluate(() => (globalThis as unknown as { __maws_library: { holdRefreshes(): Promise<void> } }).__maws_library.holdRefreshes());
}

const AGENT = 'app-e2e-library-agent';
let launch: MawsLaunch | null = null;
let scratch: string | null = null;
const cleanups: (() => Promise<void>)[] = []; // M5b: a session case's
let libraryListTrace = false;

test.afterEach(async () => {
  const testInfo = test.info();
  try {
    if (libraryListTrace && launch) {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          const path = testInfo.outputPath('library-menu-failure.png');
          await launch.page.screenshot({ path });
          await testInfo.attach('Library menu failure', { path, contentType: 'image/png' });
        }
      } finally {
        libraryListTrace = false;
        const path = testInfo.outputPath('library-menu-trace.zip');
        await launch.page.context().tracing.stop({ path });
        await testInfo.attach('Library menu trace', { path, contentType: 'application/zip' });
      }
    }
  } finally {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    await launch?.cleanup();
    launch = null;
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  }
});

test('the library lists, finds, pins, files into a Space, renames and deletes, and is right after the host restarts', async () => {
  test.setTimeout(120_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-library-'));
  const filePath = join(scratch, 'budget.csv');
  writeFileSync(filePath, 'month,amount\nOctober,1200\n');
  launch = await launchMaws();
  const { page } = launch;
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  libraryListTrace = true;
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

  // P3-H (the P3 spec's Decision Log 92): the row's own Export on the menu's first opening, the window's first ask for an
  // HTML page's formats (the viewer headers' cases always followed an earlier mount that had answered the kind)
  await row('Pricing page').getByRole('button', { name: 'Actions for Pricing page' }).click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'PNG', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Send to Google Drive…', exact: true })).toBeVisible();
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 1_000 });
  }, 'the menu closes').toPass({ timeout: 10_000 });

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
  await expect.poll(headings).toEqual(['Research', 'General']);
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
  // UX wave U10b (§C.5): a deleted artifact's answer says so, `undoable` only for an agent's delete (a person's here)
  expect(await ok(page, 'artifacts.get', { artifactId: budget.id })).toEqual({ artifact: null, deleted: { title: 'budget.csv', kind: 'file', undoable: false } });
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

// An index at version 9 as an install before P3-L left it: restore the browser's three tables (5 to 7), which P5 O3-A's
// migration 14 moved to the browser's own database, and drop P5 O6 M5's org columns (13), the library tables (10/11) and
// UX1-B's conversation search (12), checked against migrations 1 to 9.
function rewindIndexTo9(path: string): void {
  const db = new DatabaseSync(path);
  try {
    expect(schemaOf(db).version, 'the first launch left the index at 15').toBe(15);
    for (const migration of MIGRATIONS.filter((m) => m.version >= 5 && m.version <= 7)) db.exec(migration.sql);
    db.exec('ALTER TABLE projects DROP COLUMN org_smns_id; ALTER TABLE projects DROP COLUMN org_source; ALTER TABLE projects DROP COLUMN org_name; ALTER TABLE projects DROP COLUMN org_key;');
    db.exec('DROP TRIGGER session_text_delete; DROP TABLE session_text_chunks; DROP TABLE session_text_state; DROP TABLE session_text;');
    db.exec('DROP TABLE library_text; DROP TABLE library_links; DROP TABLE library_artifacts; DROP TABLE library_spaces; PRAGMA user_version = 9;');
    const template = new DatabaseSync(':memory:');
    try {
      for (const migration of MIGRATIONS.filter((m) => m.version <= 9)) template.exec(migration.sql);
      // the opener adds every ADDED_COLUMNS entry at any version (P5 O7 M4), so a version-9 index this build opened has them
      for (const added of ADDED_COLUMNS) template.exec(`ALTER TABLE ${added.table} ADD COLUMN ${added.column} ${added.definition}`);
      // and every ADDED_TABLES entry, with its indexes (P5 O8 M7b), which a rewind leaves in place as the build before keeps them
      for (const added of ADDED_TABLES) template.exec(added.sql);
      template.exec('PRAGMA user_version = 9');
      expect(schemaOf(db), 'the rewound index is a version-9 index').toEqual(schemaOf(template));
    } finally {
      template.close();
    }
  } finally {
    db.close();
  }
}

// P4-W2L (the owner's sitting candidates 4 and 7; P4 Decision Log 4, English throughout): on the owner's Korean app
// locale the library still reads English, "Edited now by You" under Today, never "Edited 지금 by You".
test('on a Korean app locale the library’s ages and date group read English', async () => {
  test.setTimeout(60_000);
  launch = await launchMaws({ lang: 'ko-KR' });
  const { page } = launch;
  expect(await page.evaluate(() => new Intl.DateTimeFormat().resolvedOptions().locale)).toMatch(/^ko/);
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await ok(page, 'artifacts.create', { kind: 'document', title: 'Launch plan' });
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const library = page.locator('[data-library]');
  const row = library.getByRole('article', { name: 'Launch plan', exact: true });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/Edited (now|\d+ minutes? ago) by You/);
  expect(await library.getByRole('heading', { level: 2 }).allTextContents()).toEqual(['Make something new', 'Today']);
});

test('an index at version 9 beside a populated host store migrates to the current version at launch, and the first connection’s snapshot fills the library', async () => {
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
  rewindIndexTo9(join(userData, 'index.sqlite'));

  // the upgrade: main migrates the index through 10 to 12, and the host's snapshot at the first connection is the whole library
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
    expect(schemaOf(db).version, 'the index is at 15 again').toBe(15);
    expect((db.prepare("SELECT count(*) AS n FROM library_artifacts WHERE kind <> 'design_system'").get() as { n: number }).n).toBe(3); // the case's own three (P3-D seeds design systems)
  } finally {
    db.close();
  }
});

// ---- M6b: the X12 upgrade ---------------------------------------------------------------------------------------------

// A profile as a build before P3-L left it: X12 deliverable records under `<userData>/deliverables/`, an index at
// version 9, and an engine transcript whose send_file call was answered with an X12 record's id (E1's answer, in the
// engine's own record of the call: what a relaunch draws the transcript from). The first launch makes the profile (its
// index and the two sessions); between the launches the records are written and the index rewound, so the second
// launch upgrades the index and its host imports the records at its start: the library shows a File and an HTML
// artifact with their sessions, and the transcript's delivery row opens the File artifact the record became.
function seedSendFile(scratch: Scratch, engineSessionId: string, path: string, recordId: string): void {
  const transcript = join(scratch.config, 'projects', scratch.repo.replace(/[^a-zA-Z0-9]/g, '-'), `${engineSessionId}.jsonl`);
  const first = JSON.parse(readFileSync(transcript, 'utf8').split('\n')[0]!) as { uuid: string };
  const common = { isSidechain: false, cwd: scratch.repo, sessionId: engineSessionId, version: '2.1.291', userType: 'external' };
  const toolUseId = 'toolu_01UpgradeSendFile0000000';
  const call = {
    ...common, parentUuid: first.uuid, type: 'assistant', uuid: randomUUID(), timestamp: '2026-10-06T00:00:05.000Z',
    message: { id: 'msg_01UpgradeSendFile', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'tool_use', id: toolUseId, name: 'mcp__maws__send_file', input: { files: ['hello.txt'] } }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } },
  };
  const answer = JSON.stringify({ status: 'delivered', deliverables: [{ id: recordId, path, name: 'hello.txt' }] });
  const result = {
    ...common, parentUuid: call.uuid, type: 'user', uuid: randomUUID(), timestamp: '2026-10-06T00:00:06.000Z', sourceToolAssistantUUID: call.uuid,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: answer }] }] },
  };
  appendFileSync(transcript, `${JSON.stringify(call)}\n${JSON.stringify(result)}\n`);
}

test('a profile with X12 records and an index at version 9 launches into a library of File and HTML artifacts with their sessions, and a transcript delivery row opens the artifact', async () => {
  test.setTimeout(180_000);
  const project = scratchProject({ titles: ['L: delivered here', 'L: the other session'], label: 'p3l-upgrade' });
  try {
    const path = join(project.repo, 'hello.txt');
    writeFileSync(path, 'HELLO_E1');
    const recordId = randomUUID();
    seedSendFile(project, project.engineIds[0]!, path, recordId);
    const first = await launchScene(project);
    const [here, other] = first.ids;
    await closeScene(first);

    const at = new Date(Date.now() - 3_600_000).toISOString();
    seedRecord(project.userData, { id: recordId, appSessionId: here, kind: 'file', path, title: 'hello.txt', versions: [{ path, at }], createdAt: at });
    const dashboard = seedArtifact(project.userData, other, 'dash', 'Dashboard', ['<!doctype html><html><body><h1 id="heading">DASHBOARD</h1></body></html>'], at);
    rewindIndexTo9(join(project.userData, 'index.sqlite'));

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
      expect(value(await invoke(page, 'artifacts.get', { artifactId: recordId })).artifact!.kind).toBe('file');
      expect(value(await invoke(page, 'artifacts.get', { artifactId: dashboard.id })).artifact!.kind).toBe('html');

      // the transcript's delivery row, naming the X12 record, opens the File artifact the record became
      await show(second, here);
      // UX wave U2b: a delivery row stays in sight in the to-human view and in the full transcript alike
      const name = second.pane.locator('[data-delivery] button.transcript-delivery-open');
      await expect(name).toHaveText('hello.txt', { timeout: 15_000 });
      await name.click();
      await expect(viewerOf(second.panel)).toHaveAttribute('data-artifact-viewer', recordId);
      await expect(viewerOf(second.panel).locator('[data-file-viewer]')).toContainText('HELLO_E1');
    } catch (error) {
      await second.maws.cleanup();
      throw error;
    }
    await closeScene(second);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
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

test('an HTML artifact in the panel’s Artifacts tool: its versions switch, Comment opens P2’s card and its Side thread, Move to tab shows it in a main tab, and Export to PDF saves a PDF', async () => {
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
  await openArtifactInPanel(page, id);
  const viewer = panel.locator('[data-artifact-viewer]');
  const frame = viewer.locator('[data-artifact-frame="html"]');
  await expect(frame).toHaveAttribute('src', namesMachine(artifactUrl(id, seqs[1]!, 'index.html')));
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  const content = viewer.frameLocator('[data-artifact-frame="html"]');
  await expect(content.locator('#version')).toHaveText('VERSION_TWO');
  await expect(panel.locator('[data-editor-header] [data-header-title]')).toHaveText('Dashboard');
  // the word cut (T567): a page viewer registers no saved state, so its header draws none, not "Read-only"
  await expect(panel.locator('[data-editor-header] [data-header-saved]')).toHaveCount(0);
  // the owner's view is recorded once the page is on screen (Decision Log 15)
  await expect.poll(async () => value(await invoke(page, 'artifacts.get', { artifactId: id })).artifact!.lastViewedAt, { message: 'markViewed set lastViewedAt' }).not.toBeNull();

  // its versions switch
  const picker = viewer.getByRole('combobox', { name: 'Version' });
  await expect(picker.locator('option')).toHaveText(['v1', 'v2 · latest']);
  await picker.selectOption('1');
  await expect(frame).toHaveAttribute('src', namesMachine(artifactUrl(id, seqs[0]!, 'index.html')));
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

  // "Send to main" unchecked routes it to a side thread (UX wave U5a): the card becomes the thread, answered in the card
  await expect(card.getByRole('checkbox', { name: 'Send to main' })).not.toBeChecked();
  await card.getByRole('textbox', { name: 'Comment' }).fill(CARD_COMMENT);
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card).toHaveAttribute('data-card-phase', 'thread', { timeout: 20_000 });
  await sideThreadOf(page, parent);
  await expect(card.getByText(CARD_REPLY)).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(CARD_COMMENT, { exact: true })).toBeVisible();

  // Move to tab: the same artifact in a main tab of its own
  await panel.getByRole('button', { name: 'Move to tab' }).click();
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
  // UX wave U5a (A18, §J): the save's folder is kept as main's layout key, for the next export's dialog, also after a
  // relaunch (the e2e seam skips the dialog and still records the folder)
  const layout = JSON.parse(readFileSync(join(c.maws.userData, 'layout.json'), 'utf8')) as Record<string, unknown>;
  expect(layout['library.exportFolder']).toEqual({ path: saved });
  expect(c.maws.consoleErrors()).toEqual([]);
});

// P4 W2-D (tracker 2026-10-19; P3-F wave S, F16): Move to tab's mirror, from the artifact main tab's context menu, over
// C8a's synthetic sessions (main serves them, so a session's panel holds tools).
test('an artifact main tab’s Show in panel, from its context menu, shows the record in the session’s panel and the tab is gone', async () => {
  launch = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: 'stub:test/fixtures/panel/harness-sessions.json' } });
  const { app, page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
  const { id } = await createHtml(page, 'Quarterly page', HEADING_PAGE('IN_PANEL'));
  const main = page.locator('[data-region="main"]');
  const panel = page.locator('[data-region="panel"]');
  const tab = mainTab(page, 'Quarterly page');
  const record = panel.locator(`[data-artifact-record="${id}"]`);

  // Harness A shown; the page from its panel's Artifacts tool (All) into a main tab beside it by the record's Move to tab
  await (await sidebarRow(page, 'Harness A')).click();
  await openArtifactInPanel(page, id);
  await expect(record).toBeVisible();
  await panel.getByRole('button', { name: 'Move to tab' }).click();
  await expect(main.locator(`[data-artifact-tab="${id}"] [data-artifact-viewer]`)).toBeVisible();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(record).toHaveCount(0);

  // the tab's context menu: Show in panel
  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to side surface', exact: true }).click();
  await expect(record).toBeVisible();
  await expect(record.frameLocator('[data-artifact-frame="html"]').locator('#version')).toHaveText('IN_PANEL');
  await expect(tab).toHaveCount(0);
  await expect(main.locator(`[data-artifact-tab="${id}"]`)).toHaveCount(0);
  await expect(mainTab(page, /^Harness A/)).toHaveAttribute('aria-selected', 'true');
  expect(launch.consoleErrors()).toEqual([]);
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
  await expect(pdfFrame).toHaveAttribute('src', new RegExp(`^maws-artifact://${report.id}/\\d+/report\\.pdf\\?machine=[A-Za-z0-9_-]{16,64}$`));
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

// UX wave U7b, O-40 (the same document, M8; A7): a destination page keeps the transcript it covers where it was. A
// replayed session whose one reply is long enough to scroll, scrolled up from its end; Customize opens as a page and
// Back returns to the same tab at the same scroll offset. shell.spec.ts's "a page beside the sidebar" proves the rest
// of the page's return on the nine-sessions stub, which draws no transcript today.
test('a replayed session’s transcript keeps its scroll offset across a page and Back', async () => {
  test.setTimeout(120_000);
  const paragraphs = Array.from({ length: 60 }, (_, n) => `Paragraph ${n + 1} of the long reply: the shell keeps each session’s place while the person moves between the pages beside the sidebar.`);
  const c = await startSessionCase((cwd) => {
    const journal = new SideJournal(PARENT, cwd);
    const prompt = journal.prompt();
    journal.reply(prompt, [FIRST_REPLY, ...paragraphs].join('\n\n'));
    journal.completed(prompt);
    return [journal];
  });
  cleanups.push(c.cleanup);
  const { page } = c;
  const scroller = page.locator('[data-region="main"] [data-transcript-scroller]');
  await expect(scroller.locator('[data-row-id]').first(), 'the transcript’s rows are drawn').toBeVisible();
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), { message: 'the transcript overflows its pane' }).toBeGreaterThan(0);
  // The offset is read when the wheel's scroll has ended: the scroller's own `scrollend`, which the browser fires once a
  // scroll, smooth or not, has finished (bounded, so a wheel that moved nothing fails here rather than at the timeout).
  await scroller.evaluate((el) => {
    (window as unknown as { __scrollEnded: Promise<number | null> }).__scrollEnded = new Promise((resolve) => {
      el.addEventListener('scrollend', () => resolve(el.scrollTop), { once: true });
      setTimeout(() => resolve(null), 10_000);
    });
  });
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  const offset = await page.evaluate(() => (window as unknown as { __scrollEnded: Promise<number | null> }).__scrollEnded);
  expect(offset, 'the wheel’s scroll ended').not.toBeNull();
  expect(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop), 'the transcript scrolled up from its end').toBeGreaterThan(0);
  const front = () => activeMainTab(page).getAttribute('aria-label');
  const tab = await front();
  expect(tab, 'the session’s tab is in front').toBeTruthy();

  await openAppDestination(page, 'Customize');
  await backToTabs(page);
  await expect.poll(front, { message: 'the same tab in front' }).toBe(tab);
  await expect(scroller).toBeVisible();
  expect(await scroller.evaluate((el) => el.scrollTop), 'the transcript kept its scroll offset').toBe(offset);
  expect(c.maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// UX wave U10b (A5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, M1 and M3; l6-artifacts-18): an HTML
// page's Export offers "Save a copy…", its stored page, in place of an `html` format, in the library row's menu and in
// the viewer's header; each saves the stored bytes where the owner chooses (the e2e's folder, MAWS_E2E_SAVE_PATH).
test('UX wave U10b (A5): an HTML page’s “Save a copy…” in its row’s Export and in its viewer’s Export saves the stored page byte for byte, and neither menu offers HTML', async () => {
  test.setTimeout(120_000);
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-library-copy-'));
  const saved = join(scratch, 'saved');
  mkdirSync(saved);
  launch = await launchMaws({ env: { MAWS_E2E_SAVE_PATH: saved } });
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  const html = HEADING_PAGE('SAVED_COPY');
  const { id } = await createHtml(page, 'Opening hours', html);
  const file = join(saved, 'Opening hours.html');
  const copied = () => (existsSync(file) ? readFileSync(file, 'utf8') : null);

  // the row's Export: the formats with no HTML, then Save a copy…
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const row = page.locator('[data-library]').getByRole('article', { name: 'Opening hours', exact: true });
  await row.getByRole('button', { name: 'Actions for Opening hours' }).click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Save a copy…', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'HTML', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Save a copy…', exact: true }).click();
  await expect.poll(copied, { timeout: 30_000, message: 'the row’s copy saved' }).toBe(html);
  await expect(page.getByRole('region', { name: /^Notifications/ }).getByText(`Saved to ${file}`)).toBeVisible();
  rmSync(file);

  // the viewer's Export in the page's main tab: the same entry, the same bytes
  await row.click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
  await expect(tab.frameLocator('[data-artifact-frame="html"]').locator('#version')).toHaveText('SAVED_COPY');
  await page.locator('[data-region="main"] [data-editor-header]').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'HTML', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Save a copy…', exact: true }).click();
  await expect.poll(copied, { timeout: 30_000, message: 'the viewer’s copy saved' }).toBe(html);
  expect(launch.consoleErrors()).toEqual([]);
});

// ---- UX wave U10b-4: "Make something new" and a Space's instructions ----------------------------------------------------
// UX wave U10b (docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, M8, M9 and M11; A7 and A8, §D.2, §E.2,
// §E.3, L5, H25). A7: the four cards and More in one row, none narrower than 180 px, wrapping in a narrow window with no
// description cut; Blank at least 24 px tall; More's menu under it and Design system's two entries on the menu's left;
// a system chosen in the heading; Blank makes the artifact bound to that system and opens it, which names it (a
// document's breadcrumb, a deck's Theme panel); a card leaves the page for a new chat whose box holds the opening words.
// A8: a Space's instructions written from its menu's sheet, the mark on its heading line, a card started from the Space
// whose draft holds the instructions as one chip by its name, and the mark following `spaces.changed` from a write the
// window did not make. Both run against the live engine host on the seeded design systems; no engine runs (a new chat
// is unstarted until its first send).

const MAKE_KINDS = ['Document', 'Presentation', 'Dashboard', 'Design'];
const makeSection = (library: Locator) => library.locator('section[aria-labelledby="library-make"]');
const composerBox = (page: Page) => page.locator('[data-region="main"] [data-composer] [contenteditable="true"]');

async function libraryPage(page: Page): Promise<Locator> {
  await openAppDestination(page, 'Artifacts');
  const library = page.locator('[data-library]');
  await expect(makeSection(library)).toBeVisible({ timeout: 15_000 });
  return library;
}

// The heading's design-system choice set to `name` (the choice lives as long as the page is open, so each visit sets it)
async function chooseSystem(page: Page, library: Locator, name: string): Promise<void> {
  const choice = makeSection(library).getByRole('button', { name: /^Design system: / });
  await expect(choice, 'the choice is read: the design systems and the defaults answered').toBeEnabled({ timeout: 15_000 });
  await choice.click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(choice).toHaveAccessibleName(`Design system: ${name}`);
}

// The page narrowed to the Space `name` (the view outlives the page, so a page opened again may already be)
async function narrowTo(page: Page, library: Locator, name: string): Promise<void> {
  const allSpaces = page.getByRole('button', { name: 'All Spaces' });
  if ((await allSpaces.count()) > 0 && (await library.getByRole('heading', { level: 2, name, exact: true }).count()) > 0) return;
  await library.getByRole('radio', { name: 'By Space' }).click();
  await library.getByRole('heading', { name }).getByRole('button').first().click();
  await expect(allSpaces).toBeVisible();
}

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not laid out');
  return box;
};

test('“Make something new”: four cards and More in one row that wraps in a narrow window; a chosen design system binds what Blank makes, which opens naming it; a card leaves the page for a chat holding the opening words', async () => {
  test.setTimeout(180_000);
  launch = await launchMaws();
  const { app, page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
  const systems = async () => (await ok<{ artifacts: { id: string; title: string }[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;
  await expect.poll(async () => (await systems()).map((s) => s.title).sort(), { timeout: 15_000, message: 'the built-in systems are seeded' }).toEqual(['Classroom', 'MAWS', 'Official']);
  const classroom = (await systems()).find((s) => s.title === 'Classroom')!;

  // the row: four cards, each a button with Blank beside it (never inside it), More its last cell
  let library = await libraryPage(page);
  let make = makeSection(library);
  const cards = make.locator('[data-make-kind]');
  await expect(cards).toHaveCount(4);
  expect(await cards.evaluateAll((groups) => groups.map((g) => g.getAttribute('aria-label')))).toEqual(MAKE_KINDS);
  for (const kind of MAKE_KINDS) {
    const card = make.getByRole('group', { name: kind, exact: true });
    await expect(card.getByRole('button', { name: kind, exact: true })).toBeEnabled();
    expect(await card.getByRole('button', { name: kind, exact: true }).locator('button').count(), `${kind}: no button inside the card's button`).toBe(0);
  }
  const blank = make.getByRole('button', { name: 'Blank document', exact: true });
  expect((await boxOf(blank)).height, 'Blank is at least 24 px tall').toBeGreaterThanOrEqual(24);
  const more = make.getByRole('button', { name: 'More', exact: true });
  const rowAt = async () => {
    const boxes = await Promise.all((await cards.all()).map(boxOf));
    return { boxes, tops: [...new Set(boxes.map((b) => Math.round(b.y)))], more: await boxOf(more) };
  };
  const wide = await rowAt();
  expect(wide.tops, 'at 1440 px the four cards share one line').toHaveLength(1);
  for (const box of wide.boxes) expect(box.width, 'no card narrower than 180 px').toBeGreaterThanOrEqual(179.5);
  expect(wide.more.x, 'More is the row’s last cell').toBeGreaterThanOrEqual(Math.max(...wide.boxes.map((b) => b.x + b.width)));

  // More: under it, aligned to its right edge; Design system's entries open as a submenu on the menu's left
  await more.click();
  const menu = page.getByRole('menu').first();
  await expect(menu.getByRole('menuitem')).toHaveText(['Design system', 'HTML page', 'Add a file…']);
  const menuBox = await boxOf(menu);
  expect(Math.abs(menuBox.x + menuBox.width - (wide.more.x + wide.more.width)), 'the menu is aligned to More’s right edge').toBeLessThanOrEqual(2);
  expect(menuBox.y, 'the menu opens under More').toBeGreaterThanOrEqual(wide.more.y + wide.more.height);
  await menu.getByRole('menuitem', { name: 'Design system', exact: true }).hover();
  const submenu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Ask Claude', exact: true }) });
  await expect(submenu.getByRole('menuitem')).toHaveText(['Ask Claude', 'Blank']);
  expect((await boxOf(submenu)).x + (await boxOf(submenu)).width, 'the submenu opens on the menu’s left').toBeLessThanOrEqual(menuBox.x + 1);
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 1_000 });
  }, 'the menus close').toPass({ timeout: 10_000 });

  // a narrow window: the row wraps to a second line, no card under 180 px and no description cut
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(800, 900));
  await expect.poll(async () => (await rowAt()).tops.length, { message: 'the cards wrap to a second line' }).toBeGreaterThan(1);
  for (const box of (await rowAt()).boxes) expect(box.width, 'no card narrower than 180 px when wrapped').toBeGreaterThanOrEqual(179.5);
  const cut = await cards.evaluateAll((groups) =>
    groups.filter((g) => Array.from(g.querySelectorAll('button span')).some((span) => span.scrollWidth > span.clientWidth + 1 || span.scrollHeight > span.clientHeight + 1)).map((g) => g.getAttribute('aria-label')),
  );
  expect(cut, 'no card’s name or description is cut').toEqual([]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));

  // a system chosen; Blank makes a document bound to it and opens it, whose breadcrumb names it
  await chooseSystem(page, library, 'Classroom');
  await make.getByRole('button', { name: 'Blank document', exact: true }).click();
  let made: { id: string; designSystemId?: string | null } | undefined;
  await expect
    .poll(async () => (made = (await ok<{ artifacts: { id: string; title: string; kind: string; designSystemId?: string | null }[] }>(page, 'artifacts.list', { filter: { kind: 'document' } })).artifacts.find((a) => a.title === 'Untitled document')), { message: 'Blank made the document' })
    .toBeDefined();
  expect(made!.designSystemId, 'bound to the chosen system').toBe(classroom.id);
  await expect(pageRegion(page), 'Blank left the page for the artifact’s tab').toHaveCount(0);
  await expect(page.locator(`[data-region="main"] [data-artifact-tab="${made!.id}"]`)).toBeVisible({ timeout: 15_000 });
  // the breadcrumb is one element whose segments are text between its separators, so it is read whole, not by a segment's exact text
  const crumb = page.locator('[data-region="main"] [data-header-breadcrumb]').filter({ hasText: 'Design: Classroom' }).first();
  await expect(crumb, 'the document’s breadcrumb names its system').toBeVisible({ timeout: 15_000 });

  // the same for a deck, whose Theme panel names it
  library = await libraryPage(page);
  make = makeSection(library);
  await expect(make.getByRole('button', { name: /^Design system: / }), 'the choice is gone with the page that held it').toHaveAccessibleName('Design system: MAWS · default');
  await chooseSystem(page, library, 'Classroom');
  await make.getByRole('button', { name: 'Blank presentation', exact: true }).click();
  let deck: { id: string; designSystemId?: string | null } | undefined;
  await expect
    .poll(async () => (deck = (await ok<{ artifacts: { id: string; title: string; designSystemId?: string | null }[] }>(page, 'artifacts.list', { filter: { kind: 'presentation' } })).artifacts.find((a) => a.title === 'Untitled presentation')), { message: 'Blank made the deck' })
    .toBeDefined();
  expect(deck!.designSystemId).toBe(classroom.id);
  const deckTab = page.locator(`[data-region="main"] [data-artifact-tab="${deck!.id}"]`);
  await expect(deckTab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  const toolbar = page.locator('[data-region="main"] .deck-toolbar [data-editor-toolbar]');
  await toolbar.getByRole('button', { name: 'Deck actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Theme', exact: true }).click();
  await expect(deckTab.locator(`[data-deck-rail="theme"] [data-system="${classroom.id}"]`), 'the deck’s Theme panel names its system').toHaveAttribute('aria-checked', 'true');

  // a card: the page left for a new chat whose box holds the opening words, the chosen system named
  library = await libraryPage(page);
  make = makeSection(library);
  await chooseSystem(page, library, 'Classroom');
  await make.getByRole('group', { name: 'Document', exact: true }).getByRole('button', { name: 'Document', exact: true }).click();
  await expect(pageRegion(page), 'the card left the page').toHaveCount(0);
  await expect(composerBox(page), 'the new chat’s box holds the opening words').toHaveText('Make a document, in the design system “Classroom”:', { timeout: 15_000, useInnerText: true });
  expect(launch.consoleErrors()).toEqual([]);
});

test('a Space’s instructions: written in its sheet, marked on its heading line, carried by a card’s chat as one chip by its name in the draft, and the mark follows spaces.changed', async () => {
  test.setTimeout(150_000);
  launch = await launchMaws();
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  const SPACE = 'Field notes';
  const TEXT = 'Write for ninth graders in plain English.\nName each source by its title.';
  const CHIP = `Instructions for “${SPACE}”`;
  const { space } = await ok<{ space: { id: string } }>(page, 'spaces.create', { name: SPACE });

  // the Space shown alone; its menu's Instructions…, directly after Rename…, opens the sheet
  const library = await libraryPage(page);
  await narrowTo(page, library, SPACE);
  const mark = library.getByRole('button', { name: 'Instructions', exact: true });
  await expect(mark, 'no mark before there are instructions').toHaveCount(0);
  await library.getByRole('button', { name: `Actions for the Space ${SPACE}`, exact: true }).first().click();
  const items = await page.getByRole('menu').getByRole('menuitem').allTextContents();
  expect(items.indexOf('Instructions…'), 'Instructions… stands directly after Rename…').toBe(items.indexOf('Rename…') + 1);
  await page.getByRole('menuitem', { name: 'Instructions…', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: CHIP });
  await expect(sheet.getByText('Every agent on this Mac that makes or opens an artifact in this Space is given these, and whoever can read its session can read them.')).toBeVisible();
  const field = sheet.getByRole('textbox', { name: CHIP });
  const save = sheet.getByRole('button', { name: 'Save', exact: true });
  await expect(save, 'nothing to save yet').toBeDisabled();
  await field.fill(TEXT);
  await save.click();
  await expect(sheet).toBeHidden();
  await expect(mark, 'the mark on the Space’s heading line').toBeVisible();
  expect((await boxOf(mark)).height, 'the mark is at least 24 px tall').toBeGreaterThanOrEqual(24);
  expect((await ok<{ instructions: { spaceId: string; text: string }[] }>(page, 'spaces.instructions', {})).instructions.map((i) => [i.spaceId, i.text])).toEqual([[space.id, TEXT]]);

  // a card from the Space: the chat's box holds the opening words and one chip by its name, kept in its draft
  await makeSection(library).getByRole('group', { name: 'Document', exact: true }).getByRole('button', { name: 'Document', exact: true }).click();
  await expect(pageRegion(page), 'the card left the page').toHaveCount(0);
  await expect(composerBox(page)).toContainText(`Make a document in the Space “${SPACE}”:`, { timeout: 15_000 });
  const chip = composerBox(page).locator('[data-pasted="text"]');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveText(`${CHIP} +3 lines`, { useInnerText: true }); // the section's line, then the two lines
  await expect
    .poll(async () => (await ok<{ intents: { draft: unknown }[] }>(page, 'session.intent.list')).intents.some((intent) => JSON.stringify(intent.draft ?? null).includes(JSON.stringify(CHIP).slice(1, -1))), { timeout: 10_000, message: 'the new chat’s stored draft names the chip' })
    .toBe(true);

  // the mark follows spaces.changed: instructions removed and set again by writes this window's sheet did not make
  const back = await libraryPage(page);
  await narrowTo(page, back, SPACE);
  const shown = back.getByRole('button', { name: 'Instructions', exact: true });
  await expect(shown, 'the page still shows the Space, marked').toBeVisible();
  await ok(page, 'spaces.setInstructions', { spaceId: space.id, text: '' });
  await expect(shown, 'removed: the mark goes').toHaveCount(0);
  await ok(page, 'spaces.setInstructions', { spaceId: space.id, text: 'Keep each answer under a page.' });
  await expect(shown, 'set again: the mark is back').toBeVisible();
  expect(launch.consoleErrors()).toEqual([]);
});

// UX wave U10b (M5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, A4, §C.4, §C.5): the session's own tools
// make its draft (the host's agent seam, as the session), a main tab shows it, and the session's turn deletes it
// (`artifact_delete`, served by the host's real tool server; the journal answers the engine's side as the host does).
// An edit is typed while the window's document port holds its outgoing frames (the e2e window's hold,
// src/renderer/src/artifacts/held-frames.ts), so the host has not seen it when the agent deletes the draft; released, the
// fence refuses it. The transcript's row reads "Deleted Draft plan" with Undo; the Library no longer lists the draft; the
// tab keeps the editor's text under the notice that the last edit is not saved, read-only, and a keystroke changes
// nothing. The row's Undo brings the draft back: the row reads "Restored Draft plan" with Open, the Library lists it,
// the notice goes, the edit typed before the notice is the store's, and the editor takes edits again.
test('an agent deletes its own draft while a tab shows it: the row reads Deleted with Undo, the Library leaves it out, the tab’s notice says an edit typed before it is not saved and holds an editor that takes no keystroke; Undo brings it back, Restored with Open, that edit saved, the editor writable again', async () => {
  const PROMPT = 'Delete the draft plan you made.';
  const REPLY = 'The draft plan is deleted.';
  const drafted = await openDraftCase();
  try {
    const { page, parent, maws } = drafted;
    const agent = new AgentSeam(join(maws.userData, 'dashboard-e2e'));
    const draft = await agent.ok<{ artifactId: string; title: string }>(parent, 'artifact_create', { kind: 'document', title: 'Draft plan', handle: 'draft-plan', content: '# Draft plan\n\nAn agent wrote this first.' });
    expect(draft.title).toBe('Draft plan');

    // the draft in a main tab, from the Library
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    const library = page.locator('[data-library]');
    await library.getByRole('article', { name: 'Draft plan', exact: true }).click({ timeout: 15_000 });
    const tab = page.locator(`[data-region="main"] [data-artifact-tab="${draft.artifactId}"]`);
    const editor = tab.locator('.ProseMirror[data-editor="live"]');
    await expect(editor).toContainText('An agent wrote this first.', { timeout: 20_000 });
    await expect(editor).toHaveAttribute('contenteditable', 'true');

    // an edit the host has not seen: typed while the window's document port holds what it sends
    type Frames = { hold(): void; release(): void; held(): number };
    const frames = (act: 'hold' | 'release' | 'held') => page.evaluate((name) => (window as unknown as { __maws_docFrames: Frames }).__maws_docFrames[name](), act);
    await frames('hold');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed before the notice.');
    await expect.poll(() => frames('held'), { message: 'the edit’s frames are held' }).toBeGreaterThan(0);

    // the session's turn: its delete, which the host's tool server runs against the store
    const journal = new SideJournal(DRAFTER, drafted.repo.root);
    const prompt = journal.prompt();
    journal.mawsToolCall('artifact_delete', { artifact: draft.artifactId }, { status: 'deleted', artifactId: draft.artifactId, kind: 'document', title: 'Draft plan' }, { asked: false });
    journal.reply(prompt, REPLY);
    journal.completed(prompt);
    await drafted.start(journal, PROMPT);
    await expect.poll(async () => value(await invoke(page, 'artifacts.get', { artifactId: draft.artifactId })).deleted ?? null, { timeout: 30_000, message: 'the host deleted the draft, as an agent’s delete Undo can take back' }).toEqual({ title: 'Draft plan', kind: 'document', undoable: true });

    // released: the fence refuses the edit; the tab: the editor's text under the notice, read-only; a keystroke changes nothing
    await frames('release');
    const notice = tab.locator('[data-artifact-deleted]');
    await expect(notice).toContainText('An agent deleted this artifact. Your last edit is not saved; restoring the artifact saves it.', { timeout: 20_000 });
    await expect(editor).toContainText('Typed before the notice.');
    await expect(editor).toContainText('An agent wrote this first.');
    await expect(editor).toHaveAttribute('contenteditable', 'false', { timeout: 10_000 });
    await editor.click();
    await page.keyboard.type('Ignored. ');
    await expect(editor).not.toContainText('Ignored.');
    await expect(notice.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();

    // the Library leaves it out
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    await expect(library.getByRole('article', { name: 'Draft plan', exact: true })).toHaveCount(0, { timeout: 15_000 });

    // the session's row: Deleted with Undo; Undo brings the draft back
    await (await sidebarRow(page, { appSessionId: parent })).click();
    const main = page.locator('[data-region="main"]');
    await expect(main.getByText(REPLY)).toBeVisible({ timeout: 20_000 });
    const row = main.locator(`section.transcript-artifact[data-artifact="${draft.artifactId}"]`);
    await expect(row.locator('[data-artifact-heading]')).toHaveText('Deleted Draft plan');
    const undo = row.getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeEnabled({ timeout: 15_000 }); // once the library has answered
    await undo.click();
    await expect(row.locator('[data-artifact-heading]')).toHaveText('Restored Draft plan', { timeout: 20_000 });
    const opens = row.getByRole('button', { name: 'Restored Draft plan', exact: true }); // the word cut (T103): the heading is the press
    await expect(opens).toBeVisible();
    await expect(opens).toHaveAccessibleDescription('Open');
    await expect(row.locator('[data-artifact-line]')).toHaveCount(0);
    expect(value(await invoke(page, 'artifacts.get', { artifactId: draft.artifactId })).artifact?.title).toBe('Draft plan');

    // the Library lists it again; the tab's editor is writable, and what is typed there is the store's
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    await library.getByRole('article', { name: 'Draft plan', exact: true }).click({ timeout: 15_000 });
    await expect(tab.locator('[data-artifact-deleted]')).toHaveCount(0, { timeout: 20_000 });
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 20_000 });
    await expect(editor).toContainText('An agent wrote this first.');
    const read = async () => JSON.stringify(await agent.ok(parent, 'artifact_read', { artifact: draft.artifactId }));
    await expect.poll(read, { timeout: 20_000, message: 'the edit typed before the notice is the store’s once restored' }).toContain('Typed before the notice.');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' The person kept it.');
    await expect.poll(read, { timeout: 20_000, message: 'the edit made after the restore is the store’s' }).toContain('The person kept it.');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await drafted.cleanup();
  }
});
