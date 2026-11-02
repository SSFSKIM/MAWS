// Remote lane B over RL2 in the built app (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M2's "The
// e2e scene" and its `e2e:remote` Proves entry; Interfaces §Q; the tracker row "No e2e group drives main's RL2 link in
// the built app"). Two machines on this Mac, joined as production joins them (e2e/support/remote-scene.ts): profile B a
// private `mawsd` enrolled in a local org, its endpoint's direct listener behind a fake tailnet address, its lane B
// records and listings from sminos on its RL10 socket (the harness's fake); profile A the app under test, signed in to
// the org through MAWS_DEV_ORG with its own device keys, reaching B over the link main holds.
//
// B's session runs the replay engine (C3's transport behind the services' replay seam, MAWS_E2E_REPLAY_FIXTURES) on a
// journal of its own (e2e/support/side-replay.ts's builder), started over B's machine.sock as an app's composer starts
// one (`session.create`, `.intent.patch`, `.start`), and listed through sminos. A is launched twice over one profile:
//   1. through the hub: the dev session's map sends B's advertised address to a closed port, so the link comes `up` over
//      the relay; B's listed row reaches A's org rows and sidebar, its hover reads "via the hub", and a click opens it in
//      A's pane (M2's opener) with B's history; then A drives it: a send that B's transcript records and whose reply
//      streams to A as deltas, a permission card A answers, a pasted image B's transcript records;
//      then (M4) a text file dropped into the composer goes up to B's desk-uploads and the message names its path there;
//      the panel's tools work on B's checkout (a git repository of B's): the Files tool lists it and the editor saves a
//      file there, read back over B's machine.sock; a file the spec writes on B shows in A's tree and in the Source
//      control tool's status with no click, and so does one written while A's way to B is cut (the scene's pipe to the
//      hub), once the link is up again; the Source control tool commits;
//      then (M3) the Terminal tool opens a shell on B in the session's checkout, where `pwd` prints it; a reload of A's
//      window re-attaches the same shell (one pty on B, its label the tab's) and shows what it printed; a dev server
//      started in that shell (`python3 -m http.server`, dual-stack) opens from the `[::]` link B's reply names in A's
//      in-app browser, its tab marked "forwarded from B", its page the directory listing B's server sent, and stops at
//      ⌃C.
//      A runs this launch with no harness confirmation, so the owner's terminal and forward ask nothing: a step-up
//      would stop the act at a sheet nobody answers;
//   2. directly: the map sends it to B's listener, so the link comes `up` over the direct carrier; the hover reads
//      "direct (tailnet)" and the pane shows B's history again; then (M5a) at A's ask B's session makes two artifacts
//      through its `maws` tools (a text file of B's checkout as a File artifact, and an HTML page), linked to it on B:
//      the session's Artifacts tool in A lists them and reads the text; a rename in A's Library on B shows in B's own
//      library (read over B's machine.sock); Export › PDF of the page renders on B and Save As lands it in A's folder
//      (the save seam, MAWS_E2E_SAVE_PATH); Open externally on an HTML file of B's checkout opens a copy paged to A (the
//      open-log seam, MAWS_E2E_OPEN_LOG); the Browser tool's notice reads B's own reason; then (M5b) the page renders
//      in the Artifacts tool's frame with what B's store holds (main's scheme reading it over the link), and a document
//      B's session starts at A's ask opens in A's editor, where what A types reads back from B's store (B's own export
//      over its machine.sock); then (M4, under
//      MAWS_E2E_STEP_UP=accept) "+ Session" in
//      A's own checkout of the same org project (a `.smns` naming B's project) starts sessions on B through the machine
//      menu: one with its text as the brief, opening in A's pane with its reply and recording A's member as its
//      requester; one in a new worktree with a dropped file, which goes up under the worktree's desk-uploads before the
//      one message that names it; then (M6) B starts a session of its own that A has no tab of and whose first turn asks
//      a permission: it shows in A's Needs you under its listed row and counts in the dock badge (`app.dock` read in
//      main), ⌘⇧J (its menu item) opens it in A's pane, and the answer there clears both; conversation search finds a
//      word of B's transcript under B; its second turn asks again with its tab closed, and B's daemon stopped greys that
//      item in Needs you and takes it out of the badge.
//      M5c (before M4's "+ Session"): O4's surfaces on B from A. B's observer is a real engine (the installed Claude
//      Code, the replay list's `live` entry), started with no message as connector-scene.ts's owner Start starts one: it
//      reports three fixture servers of B's user settings (the dashboard-live-data rows server, a Notion-shaped one and
//      an OAuth one in its open phase), which Send to's status read on B observes; it stops, and only once it is dead
//      does the OAuth server demand sign-in (P3-HD Decision Log 23). Then the dashboard-live-data fixture's Dashboard,
//      written on B through the host's agent seam (MAWS_DASHBOARD_E2E), opened in A from B's library, draws B's rows
//      once A allows the tool and the next rows at its schedule, through MAWS's own instance of B's server; Connect on
//      the OAuth server, from an HTML page of B's that declares it, completes through a listener on A's loopback, the
//      consent opened on A (the fake browser following A's open log) and its redirect relayed to B, where the grant is
//      sealed; and Send to on B's plan makes one `notion-create-pages` call on B.
// B's spawned sessions and its M6 session run on journals of their own, the next fixtures on B's replay list.
// No wall-clock bound beyond Playwright's own timeouts: the measured numbers are M7's.
// Run by `pnpm e2e:remote` (MAWS_REMOTE_E2E=1).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { isolatedGitEnv } from '../test/support/git-env';
import type { MachineState } from '../src/shared/ipc/schema/machines';
import type { SessionEvent } from '../src/shared/graph/events';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { REMOTE_ACT_PENDING_MS, REMOTE_ATTACH_PENDING_MS } from '../src/shared/machine/remote-pending';
import { worktreeDirName } from '../src/shared/sessions/worktree';
import { SERVERS_COPY as S } from '../src/renderer/src/tools/artifacts/viewers/connectors/copy';
import { addedListeners, loopbackPort } from './support/connector-direct-checks';
import { browserOpens, connectionWords } from './support/connector-direct-oauth';
import { FIXTURE_SERVER, type CallLogEntry } from './support/connector-engine';
import { assertOpenPhase, enterOAuthPhase, readOAuthLog, startOAuthFixture, summarizeOAuthLog, type OAuthFixture } from './support/connector-oauth';
import { followAuthorization } from './support/connector-oauth-browser';
import { SERVER as ROWS_SERVER, TOOL as ROWS_TOOL, TOOL_NAME as ROWS_NAME } from './support/connector-scene';
import { AgentSeam } from './support/dashboards';
import { BOARD, drawsRows, labelOf, liveBlock, liveViews, NOT_FETCHED, openSheet, rows, tableRows, writeBoard } from './support/live-data';
import { installedEngine } from './support/p1-live';
import { isAlive, tcpListeners } from './support/processes';
import { DATASET_STATES } from '../src/artifacts/dashboard/states';
import { launchMaws, type MawsLaunch } from './support/launch';
import { menu } from './support/menu';
import { startRemoteScene, B_NAME, type RemoteScene } from './support/remote-scene';
import { mainTabById, openSurface, surface } from './support/shell';
import { SideJournal } from './support/side-replay';
import { newChatIn, showProjectList, sidebarOf } from './support/sidebar';

test.skip(process.env.MAWS_REMOTE_E2E !== '1', 'the remote scenes run under pnpm e2e:remote (MAWS_REMOTE_E2E=1)');
test.setTimeout(900_000);

const B_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000b2'; // the engine session id B's journal pins
const PROJECT = 'e2e-remote-project'; // sminos's project id for B's checkout
const FIRST = 'Say hello from B.';
const FIRST_REPLY = 'Hello from B.';
const TITLE = 'B’s lane B session';
// What A sends, and what B's replayed engine answers to each (the replay matches a prompt by type, so A's words are A's)
const SECOND = 'A asks B over the link.';
// The reply streams a strict prefix of itself, then the engine holds before the whole message, so A's pane can only show
// the prefix by drawing the deltas
const SECOND_DELTAS = ['Streamed ', 'from B '];
const SECOND_PARTIAL = 'Streamed from B';
const SECOND_REPLY = 'Streamed from B to A.';
const THIRD = 'Run the one command, then answer.';
const APPROVED = 'remote-approved';
const THIRD_REPLY = 'The command ran on B.';
const IMAGE_TEXT = 'What is in this picture?';
const IMAGE_REPLY = 'B saw the picture.';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; // 1×1
// M4: a text file dropped into the composer, which goes up to B; the message A sends with it, and B's answer
const DROPPED = { name: 'dropped-notes.txt', content: 'Dropped on A, uploaded to B.\n' };
const UPLOAD_TEXT = 'Read the file I dropped.';
const UPLOAD_REPLY = 'B read the dropped file.';
// M4: B's checkout, a git repository whose `.smns` names sminos's project (so its org project is `smns:<PROJECT>`)
const A_PROJECT = 'remote-project'; // the org project's name, and the directory name of A's own checkout of it
const NOTES = 'notes.txt'; // committed in B's checkout
const NOTES_TEXT = 'A line B committed.\n';
const TYPED = '// typed on A';
const ON_B = 'written-on-b.txt'; // the spec writes it on B while A watches
const WHILE_CUT = 'written-while-cut.txt'; // the spec writes it on B while A's way to B is cut
const COMMIT = 'Committed from A';
// M4: "+ Session" on B: a session started with its text as the brief, and one in a new worktree with a dropped file
const SPAWNED_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000b3';
const SPAWN_BRIEF = 'Start on B, please.';
const SPAWN_REPLY = 'Started on B from A.';
// P5 O12 M11: a spawned session opens in the pane before B's sminos lists it (B's endpoint ranks its spawner from the
// spine's launchedBy until sminos's record arrives), so the pane never gives up on it and any waiting line clears unlisted
const LISTING_WAIT = (machine: string) => `Waiting for ${machine} to list the new session…`;
const CANT_PLACE = (machine: string) => `${machine} can’t place this session`;
const WORKTREE_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000b4';
const WORKTREE_FILE = { name: 'worktree-notes.txt', content: 'Goes up to the worktree on B.\n' };
const WORKTREE_TEXT = 'Read the file in the worktree.';
const WORKTREE_REPLY = 'B read it in the worktree.';
// M3: the dev server's link in B's reply, as `python3 -m http.server` with no `--bind` prints it: dual-stack on `::`, so
// `http://[::]:<port>/`, the common case a forward has to take (its port chosen when the journal is written, since the
// reply is recorded before B's server listens)
const LINK_ASK = 'Where does the dev server listen?';
const LINK_TEXT = 'the dev server';
const devServerUrl = (port: number) => `http://[::]:${port}/`;
const linkReply = (port: number) => `It serves B’s checkout at [${LINK_TEXT}](<${devServerUrl(port)}>).`;
// M6: B's own session that asks while A has no tab of it, started on B as B's owner starts one: a permission at its first
// turn, answered from A, then one at its second turn that still waits when B's daemon stops
const WAITING_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000b5';
const WAITING_TITLE = 'B’s waiting session';
const WAITING_ASK = 'Check the build on B.';
const WAITING_FIRST = 'first-asked';
const WAITING_REPLY = 'The build on B is fine.';
const WAITING_AGAIN = 'Check it once more.';
const WAITING_SECOND = 'second-asked';
// M6: a word of B's first session's transcript (its first prompt, FIRST) and of no session's title once B's owner names it
const SEARCHED = 'hello';
// M5a: what B's first session makes at A's ask, through its `maws` tools (served by B's engine host, so each artifact is
// linked to the session): a text file it wrote in B's checkout, delivered as a File artifact, and an HTML page, whose
// PDF B's render host exports; the title A renames the File artifact to; an HTML file of B's checkout A opens a copy of
const MAKE_ASK = 'Make the notes and the report.';
const MADE_REPLY = 'Both are in B’s library.';
const NOTES_ARTIFACT = { file: 'b-notes.txt', title: 'B notes', text: 'Notes the session on B delivered.\n' };
const RENAMED = 'B notes, renamed on A';
const REPORT = { title: 'B report', html: '<!doctype html><html><body><h1>Report from B</h1><p>Rendered on B, saved on A.</p></body></html>' };
const PAGE_ON_B = { name: 'b-page.html', content: '<!doctype html><title>B page</title><p>A page in the checkout on B.</p>\n' };
// M5b: a document B's first session starts at A's ask (an empty one, linked to the session on B), and what A types in it
// M5c: the servers of B's user settings, by their names there (the rows server's and its tool's are the
// dashboard-live-data fixture's, connector-scene.ts's SERVER and TOOL); the rows it answers, first and at the schedule
const OAUTH_SERVER = 'secure';
const NOTION = 'notion';
const NOTION_TOOL = 'notion-create-pages';
const FIRST_SIGNUPS = [12, 18];
const NEXT_SIGNUPS = [12, 18, 27];
const SCHEDULE_MS = 30_000; // the dashboard-live-data query's schedule (live-data.ts SCHEDULE_S)
// The OAuth fixture's authorization endpoint as it advertises it: https on a name no resolver answers (RFC 6761
// `.invalid`), since a consent B asks A to open is never a loopback URL (main's openForMachine) and MAWS's OAuth takes no
// plain HTTP off 127.0.0.1; only the fake browser follows it, to the fixture's own /authorize
const AUTHORIZE_AT = 'https://authorize.invalid';
// An HTML page of B's that declares the OAuth server's tool, so its Connectors sheet lists that server's row (Connect is
// a byte viewer's sheet's, never a dashboard's source sheet)
const CONNECT_PAGE = {
  title: 'B connectors',
  space: 'B dashboards',
  html: `<!doctype html>
<html><head><meta charset="utf-8"><title>B connectors</title></head>
<body>
<h1>Connectors on B</h1>
<p id="declared">declaring</p>
<script>
(async () => {
  const declared = await mawsConnectors.declare([{ server: ${JSON.stringify(OAUTH_SERVER)}, tool: ${JSON.stringify(ROWS_TOOL)} }]);
  document.getElementById('declared').textContent = declared.ok ? 'declared' : declared.state + ':' + declared.reason;
})();
</script>
</body></html>
`,
};
/** A fixture server's entry in B's user settings. */
const stdioEntry = (id: string, log: string, tools: string[], extra: string[] = []) => ({ type: 'stdio', command: process.execPath, args: [FIXTURE_SERVER, '--id', id, '--log', log, '--tools', JSON.stringify(tools), ...extra] });
/** The rows server's next answer, written whole (connector-scene.ts's rule: the server reads it at each call). */
function writeRows(control: string, signups: number[]): void {
  writeFileSync(`${control}.tmp`, JSON.stringify({ reply: 'rows', rows: rows(...signups) }));
  renameSync(`${control}.tmp`, control);
}
const callsOn = (log: string, server: string) => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as CallLogEntry) : []).filter((entry) => entry.server === server && entry.method === 'tools/call');

const PLAN_ASK = 'Start the plan.';
const PLAN_MADE = 'The plan is in B’s library.';
const PLAN = { title: 'B plan' };
const TYPED_PLAN = 'Typed on A into the plan on B.';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8' }).trim();
// The repository's own settings, so the runner's global ones (a hooks path, signing, an identity) change nothing B's
// commit does (e2e/support/scm-scratch.ts's rule); B's `mawsd` runs git as a terminal there would.
function checkoutRepository(dir: string, hooks: string): void {
  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'config', 'user.name', 'MAWS Fixture');
  git(dir, 'config', 'user.email', 'fixture@maws.invalid');
  git(dir, 'config', 'core.hooksPath', hooks);
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, '.smns'), JSON.stringify({ project: PROJECT, name: A_PROJECT }));
  writeFileSync(join(dir, NOTES), NOTES_TEXT);
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'B’s checkout');
}

// The raw bridge's answer, or the test fails with the error it carried.
async function invoke<T>(page: Page, name: string, input: unknown, machine?: MachineRef): Promise<T> {
  const result = await page.evaluate(([n, i, m]) => window.maws.invoke(n as never, i as never, (m ?? undefined) as never), [name, input, machine ?? null] as const);
  if (!(result as { ok: boolean }).ok) throw new Error(`${name}: ${JSON.stringify((result as { error: unknown }).error)}`);
  return (result as { value: T }).value;
}
const machineOf = async (page: Page, ref: MachineRef) => (await invoke<{ machines: MachineState[] }>(page, 'machines.list', undefined)).machines.find((m) => m.ref === ref);
type Row = { machine: string; session: string; lane: string; title: string; owners: string[] };
const rowsOf = async (page: Page) => (await invoke<{ rows: Row[] }>(page, 'org.rows', undefined)).rows;

// Main's own lines about the org, the links and remote lane B, per launch, which a failure quotes.
const mainLines = new WeakMap<Page, string[]>();
function keepMainLines(launch: MawsLaunch): void {
  const lines: string[] = [];
  mainLines.set(launch.page, lines);
  const keep = (chunk: Buffer) => lines.push(...chunk.toString('utf8').split('\n').filter((line) => /\[(machines|dev-org|org|org-feed|lane-b)\]/.test(line)));
  launch.app.process().stdout?.on('data', keep);
  launch.app.process().stderr?.on('data', keep);
}
const mainSaid = (page: Page) => (mainLines.get(page) ?? []).slice(-60).join('\n');

const main = (page: Page) => page.locator('[data-region="main"]');
const composerOf = (page: Page) => main(page).getByRole('textbox', { name: 'Message' });
// A machine's row in the sidebar (T3: another machine's sessions with no org project here), expanded (read back until
// it holds: a restored layout may expand it under the click), and the row of a session at `address` in it: its listed
// row, or its record's once main said it (one row per address).
const machineRow = (page: Page, ref: MachineRef) => sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:machine:${ref}"]`);
async function expandMachine(page: Page, ref: MachineRef): Promise<void> {
  await showProjectList(page);
  const row = machineRow(page, ref);
  await expect(async () => {
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.locator('[data-project-line]').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}
const sessionRow = (page: Page, address: string) => sidebarOf(page).locator(`[role="treeitem"][data-tree-id="s:${address}"]`);
// The hover card's machine line for a row (P5 O7 M2, A2): the machine's name and its carrier.
async function hoverMachineLine(page: Page, row: ReturnType<typeof sessionRow>, expected: string): Promise<void> {
  const card = page.locator('[data-hover-card]');
  await expect(async () => {
    await page.mouse.move(700, 400);
    await row.hover();
    await expect(card.getByTestId('hover-machine')).toHaveText(expected, { timeout: 2_000 });
  }, `the hover reads "${expected}"`).toPass({ timeout: 20_000 });
  await page.mouse.move(700, 400);
}
// A's renderer's event batches as the raw bridge hears them (a bare id, and the machine it came from), kept from now on
// (window.__remote), and those of one session.
type Kept = { machine: string | null; appSessionId: string; events: SessionEvent[] };
async function keepBatches(page: Page): Promise<void> {
  await page.evaluate(() => {
    const kept: Kept[] = [];
    (window as unknown as { __remote: Kept[] }).__remote = kept;
    window.maws.on('session.eventBatch', (batch, machine) => void kept.push({ ...(batch as unknown as Kept), machine: machine ?? null }));
  });
}
const keptBatches = (page: Page) => page.evaluate(() => (window as unknown as { __remote: Kept[] }).__remote);
const batchedEvents = async (page: Page, machine: MachineRef, app: string) =>
  (await keptBatches(page)).filter((b) => b.machine === machine && b.appSessionId === app).flatMap((b) => b.events);
// A drop on the focused composer: one text file, as a file dragged from a browser is dropped (composer.spec.ts's
// synthetic drop); its bytes, not a path, which is what goes up to another machine.
async function dropTextFile(page: Page, file: { name: string; content: string }): Promise<void> {
  await page.locator('[data-region="main"] [contenteditable="true"]').waitFor();
  await page.evaluate(({ name, content }) => {
    const target = document.querySelector('[data-region="main"] [contenteditable="true"]') as HTMLElement;
    const data = new DataTransfer();
    data.items.add(new File([content], name, { type: 'text/plain' }));
    const box = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: box.left + 5, clientY: box.top + 5, bubbles: true, cancelable: true }));
  }, file);
  await expect(main(page).getByRole('list', { name: 'attachments' }).getByText(file.name)).toBeVisible();
}
// The machine's path of an upload a written message mentions (`@<path relative to the working directory>`), or null.
const uploadMention = (written: unknown, app: string): string | null => new RegExp(`@(\\.claude/desk-uploads/${app}/[^\\s"\\\\]+)`).exec(JSON.stringify(written))?.[1] ?? null;
// A New chat tab's machine menu, B chosen in it (sessions/remote-spawn.ts: the up RL2 machines with a checkout of the
// tab's org project), and the line naming B's lane B under the row.
async function chooseMachine(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Machine This Mac', exact: true });
  await expect(trigger, 'the machine menu, once the project’s org project is known').toBeEnabled({ timeout: 30_000 });
  await trigger.click();
  await page.getByRole('dialog', { name: 'Choose a machine' }).getByRole('menuitemradio', { name, exact: true }).click({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: `Machine ${name}`, exact: true })).toBeVisible();
  await expect(main(page).getByText(`Lane B on ${name} · ${name}’s inference route`)).toBeVisible();
}
// "+ Session" in a project: its New chat tab, and the intent the tab holds (A's own), in the mode B's journals and
// B's ceiling take (`default`; the composer's mode is what a spawn sends).
async function newChat(page: Page, project: string): Promise<string> {
  type Intents = { intents: { appSessionId: string }[] };
  const known = new Set((await invoke<Intents>(page, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId));
  await newChatIn(page, project);
  let tab: string | undefined;
  await expect.poll(async () => (tab = (await invoke<Intents>(page, 'session.intent.list', undefined)).intents.find((i) => !known.has(i.appSessionId))?.appSessionId), { timeout: 30_000 }).toBeDefined();
  await invoke(page, 'session.intent.patch', { appSessionId: tab!, patch: { permissionMode: 'default' } });
  return tab!;
}
// The address the pane's composer moved to on B, other than `before` (a spawn's tab moving to its new session); waited
// past main's spawn bound (210 s from the sheet), so a spawn still pending says so. A failure quotes the toasts (a
// refusal's words), the pane's statuses and `said`.
async function movedTo(page: Page, machine: MachineRef, before: string | null, said: () => Promise<string>): Promise<string> {
  let address: string | null = null;
  await expect
    .poll(async () => {
      address = await main(page).locator(`[data-composer^="${machine}/"]`).first().getAttribute('data-composer', { timeout: 1_000 }).catch(() => null);
      return address !== null && address !== before;
    }, { timeout: 240_000, message: `the tab moves to a new session on ${machine}` })
    .toBe(true)
    .catch(async (error: unknown) => {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await paneSaid(page)}\n${mainSaid(page)}\n${await said()}`);
    });
  return address!;
}
// What the pane says now: its composers' addresses and its statuses, for a failure.
async function paneSaid(page: Page): Promise<string> {
  const composers = await main(page).locator('[data-composer]').evaluateAll((els) => els.map((el) => el.getAttribute('data-composer'))).catch(() => []);
  const statuses = await main(page).getByRole('status').allTextContents().catch(() => []);
  const toasts = ((await page.locator('[data-toast-viewport]').textContent({ timeout: 1_000 }).catch(() => null)) ?? '').trim();
  return `the pane's composers: ${composers.join(', ') || 'none'}; its statuses: ${statuses.join(' | ') || 'none'}; the toasts: ${toasts || 'none'}`;
}
const bareOf = (address: string) => address.slice(address.indexOf('/') + 1);
// A wait whose failure quotes what `said` reads then, at the failure, rather than before the wait.
async function quoting<T>(wait: Promise<T>, said: () => Promise<string> | string): Promise<T> {
  return wait.catch(async (error: unknown) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await said()}`);
  });
}
// M6: a session's row in A's Needs you (by its address), the heading that counts the live rows, and the dock badge main
// sets ('' at none)
const needsYouRow = (page: Page, address: string) => sidebarOf(page).getByRole('list', { name: 'Needs you' }).locator(`button[data-needs-you="${address}"]`);
const needsYouCount = (page: Page, count: number) => sidebarOf(page).getByRole('heading', { name: `Needs you · ${count}` });
const dockBadge = (app: ElectronApplication) => app.evaluate(({ app }) => app.dock?.getBadge() ?? '');
// The files a session's desk-uploads holds on B (its parts' `.staging` directory left out).
const uploadedFiles = (cwd: string, app: string) => readdirSync(join(cwd, '.claude', 'desk-uploads', app)).filter((name) => !name.startsWith('.'));

// A paste into the focused composer: one PNG file, as a screenshot is pasted (composer.spec.ts's synthetic paste)
async function pastePng(page: Page): Promise<void> {
  await page.locator('[data-region="main"] [contenteditable="true"]').waitFor();
  await page.evaluate((base64) => {
    const target = document.querySelector('[data-region="main"] [contenteditable="true"]') as HTMLElement;
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'shot.png', { type: 'image/png' }));
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG);
}

// M3: a port nothing listens on now (on any address, as the dev server's dual-stack listener takes it), outside the
// ephemeral range other listeners take theirs from, for B's dev server, whose link B's journal names before it starts.
async function quietPort(): Promise<number> {
  for (;;) {
    const port = 20_000 + Math.floor(Math.random() * 10_000);
    const free = await new Promise<boolean>((done) => {
      const server = createServer();
      server.once('error', () => done(false));
      server.listen(port, () => server.close(() => done(true)));
    });
    if (free) return port;
  }
}
// Whether something accepts a connection on 127.0.0.1:<port> now (B's loopback: B runs on this Mac).
const listening = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
// The terminal on screen in the session's Terminal tool, and its id, waited past the tool's whole budget for adopting a
// remote tab's shell (its list, then its attach and replay, each under main's act bound); what its emulator holds,
// through the page's terminals seam (it draws on a canvas): every row, scrollback first.
const ADOPTED_WITHIN_MS = REMOTE_ACT_PENDING_MS + REMOTE_ATTACH_PENDING_MS + 30_000;
async function shownTerminal(page: Page): Promise<string> {
  const shown = surface(page, 'terminal').locator('[data-terminal-id]:visible');
  await expect(shown, `one terminal on screen\n${mainSaid(page)}`).toHaveCount(1, { timeout: ADOPTED_WITHIN_MS });
  return (await shown.getAttribute('data-terminal-id'))!;
}
const terminalRows = (page: Page, id: string) =>
  page.evaluate((tid) => (window as unknown as { __maws_terminals?: { lines(id: string): string[] | null } }).__maws_terminals?.lines(tid) ?? [], id);
// Whether the shell printed `text` as a line of its own, from a row's start, however many rows the terminal's width
// wrapped it over (a wrapped row is full, so the rows read on into one another).
const printedLine = (rows: string[], text: string) =>
  rows.some((_, i) => {
    let line = '';
    for (let j = i; j < rows.length && line.length < text.length; j++) line += rows[j];
    return line === text;
  });
// Whether `text` shows anywhere in the terminal, a wrap included.
const printedAnywhere = (rows: string[], text: string) => rows.join('').includes(text);
// A line typed into the terminal's own input, as a person types it.
async function typeInTerminal(page: Page, id: string, line: string): Promise<void> {
  await surface(page, 'terminal').locator(`[data-terminal-id="${id}"] textarea`).focus();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}
// What the Terminal tool says now: its status lines and the terminal's last written rows (its screen's foot may be
// blank), for a failure.
async function terminalSaid(page: Page, id: string | null): Promise<string> {
  const statuses = await surface(page, 'terminal').getByRole('status').allTextContents().catch(() => []);
  const rows = id === null ? [] : await terminalRows(page, id).catch(() => []);
  const written = rows.filter((row) => row.trim() !== '');
  return `the Terminal tool's statuses: ${statuses.join(' | ') || 'none'}\nthe terminal's ${rows.length} rows, its last 40 written:\n${written.slice(-40).join('\n')}`;
}

test('A reaches B’s mawsd over RL2, through the hub and then directly, and drives B’s lane B session from its listed row: history, a streamed reply, a permission, an image', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-'));
  const checkout = join(root, 'b-checkout');
  const journals = join(root, 'journals');
  const hooks = join(root, 'no-hooks'); // B's repository's hooks path: none run
  const aCheckout = join(root, A_PROJECT); // A's own checkout of the org project, for "+ Session"
  const savedOnA = join(root, 'saved-on-a'); // M5a: where A's Save As lands (MAWS_E2E_SAVE_PATH, A's second launch)
  const openLog = join(root, 'a-open.log'); // M5a: what A's main hands the OS to open (MAWS_E2E_OPEN_LOG)
  for (const dir of [checkout, journals, hooks, aCheckout, savedOnA]) mkdirSync(dir);
  checkoutRepository(checkout, hooks);
  checkoutRepository(aCheckout, hooks); // a repository too: New chat offers Worktree only in git
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  let oauth: OAuthFixture | null = null; // M5c
  let app = '';
  try {
    // B's session: C3's prelude, one whole turn for B's own first message, then A's: a send whose reply streams, a
    // command the engine asks permission for (the replay holds at the `allow`), and a message with a pasted image.
    const journal = new SideJournal(B_SESSION, checkout);
    journal.turn(FIRST_REPLY);
    const second = journal.prompt();
    journal.reply(second, SECOND_REPLY, SECOND_DELTAS, () => journal.holdAtContextUsage());
    journal.completed(second);
    const third = journal.prompt();
    journal.permission(third, 'Bash', { command: `echo ${APPROVED}`, description: 'Print a word' }, APPROVED);
    journal.reply(third, THIRD_REPLY);
    journal.completed(third);
    journal.turn(IMAGE_REPLY);
    journal.turn(UPLOAD_REPLY); // M4: the message naming the dropped file's path on B
    const devPort = await quietPort();
    journal.turn(linkReply(devPort)); // M3: the reply naming B's dev server
    // M5a: A's ask in its second launch, answered by two `artifact_create` calls (a rule allows them: nothing asked) that
    // B's engine host serves, linking each artifact to the session; the tool results are the engine's words, the host's
    // own answers are what B's store holds
    const make = journal.prompt();
    journal.mawsToolCall('artifact_create', { kind: 'file', title: NOTES_ARTIFACT.title, path: NOTES_ARTIFACT.file }, { status: 'created', kind: 'file', title: NOTES_ARTIFACT.title }, { asked: false });
    journal.mawsToolCall('artifact_create', { kind: 'html', title: REPORT.title, content: REPORT.html }, { status: 'created', kind: 'html', title: REPORT.title }, { asked: false });
    journal.reply(make, MADE_REPLY);
    journal.completed(make);
    // M5b: A's next ask, answered by one `artifact_create` of a document, linked to the session as M5a's are
    const plan = journal.prompt();
    journal.mawsToolCall('artifact_create', { kind: 'document', title: PLAN.title }, { status: 'created', kind: 'document', title: PLAN.title }, { asked: false });
    journal.reply(plan, PLAN_MADE);
    journal.completed(plan);
    const fixture = journal.write(journals, 'b-session');
    // M4: the sessions "+ Session" starts on B, the next fixtures on B's list: one whose brief is its first turn, and one
    // in a new worktree, whose journal is written once A's tab names the worktree (its init's directory)
    const spawned = new SideJournal(SPAWNED_SESSION, checkout);
    spawned.turn(SPAWN_REPLY);
    const spawnedFixture = spawned.write(journals, 'b-spawned');
    const worktreeFixture = join(journals, 'b-spawned-worktree.jsonl');
    // M6: the session B starts last, while A has no tab of it: a permission its first turn asks (answered from A), then
    // one its second turn asks (the replay holds at its `allow` until B's daemon stops)
    const waiting = new SideJournal(WAITING_SESSION, checkout);
    const asked = waiting.prompt();
    waiting.permission(asked, 'Bash', { command: `echo ${WAITING_FIRST}`, description: 'Print a word' }, WAITING_FIRST);
    waiting.reply(asked, WAITING_REPLY);
    waiting.completed(asked);
    waiting.permission(waiting.prompt(), 'Bash', { command: `echo ${WAITING_SECOND}`, description: 'Print a word' }, WAITING_SECOND);
    const waitingFixture = waiting.write(journals, 'b-waiting');
    // M5c: the fixture servers of B's user settings (the dashboard-live-data rows server, a Notion-shaped one, the OAuth
    // one in its open phase, which the observer's engine reads before it demands sign-in), as connector-scene.ts
    // configures its own; B's observer is the replay list's `live` entry, the installed engine (MAWS_E2E_ENGINE_BIN)
    // under a scratch HOME, and B's host runs the dashboard's agent seam (MAWS_DASHBOARD_E2E)
    const mcpLog = join(root, 'b-mcp-calls.jsonl');
    const rowsControl = join(root, 'b-rows-control.json');
    writeRows(rowsControl, FIRST_SIGNUPS);
    oauth = await startOAuthFixture({ root, id: OAUTH_SERVER, tools: [ROWS_TOOL] });
    const mcpServers: Record<string, Record<string, unknown>> = {
      [ROWS_SERVER]: stdioEntry('series', mcpLog, [ROWS_TOOL], ['--mode', 'rows', '--control', rowsControl]),
      [NOTION]: stdioEntry(NOTION, mcpLog, [NOTION_TOOL], ['--mode', 'notion']),
      [OAUTH_SERVER]: { type: 'http', url: oauth.resourceUrl },
    };
    const bHome = join(root, 'b-home'); // B's HOME: nothing on B reads the runner's
    mkdirSync(bHome);
    scene = await startRemoteScene({
      scratch: join(root, 'scene'),
      aUserData,
      b: {
        env: {
          MAWS_ENGINE_REPLAY: '1',
          MAWS_E2E_REPLAY_FIXTURES: [fixture, 'live', spawnedFixture, worktreeFixture, waitingFixture].join(','), // M5c: the observer is B's second launch
          MAWS_E2E_ENGINE_BIN: installedEngine().bin, // M5c: the `live` launch's engine (the replays never run a binary)
          HOME: bHome,
          MAWS_DASHBOARD_E2E: '1', // M5c: the host's agent seam writes the dashboard
          DISABLE_AUTOUPDATER: '1',
        },
        // B's checkout trusted, onboarding done (the observer is a real engine), and the default mode the journal was
        // recorded under (sessions.spec.ts's launchCase)
        prepare: ({ claudeConfigDir }) => {
          writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [checkout]: { hasTrustDialogAccepted: true } }, mcpServers })); // M5c: B's user-scope servers
          writeFileSync(join(claudeConfigDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }));
        },
      },
    });
    const { b } = scene;
    // B's transcript, as its own machine.sock serves it: the messages its engine was written (not its echoes)
    type UserMessage = Extract<SessionEvent, { kind: 'user.message' }>;
    const writtenOn = async (session: string): Promise<UserMessage['content'][]> => {
      const { events } = await b.request<{ events: SessionEvent[] }>('session.events', { appSessionId: session, afterSeq: null, limit: null });
      return events.filter((e): e is UserMessage => e.kind === 'user.message' && !e.isReplay).map((e) => e.content);
    };
    const writtenOnB = () => writtenOn(app);
    const turnOverOnB = async () => (await b.request<{ turn: unknown; process: string }>('session.status', { appSessionId: app })).turn === null;

    // B's own sessions take the direct route (B's owner's choice, its machine settings): what B's journals answer, and
    // what a session "+ Session" starts on B runs on.
    await b.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    // B starts its session over its machine.sock, as its own app's composer would, and its first turn ends.
    const project = await b.request<{ id: string }>('session.projects.add', { directory: checkout });
    app = (await b.request<{ appSessionId: string }>('session.create', { projectId: project.id, location: null })).appSessionId;
    const address = addressOf(b.ref, app);
    await b.request('session.intent.patch', { appSessionId: app, patch: { gateway: 'direct' } });
    const started = await b.request<{ status: string }>('session.start', { appSessionId: app, message: { content: FIRST, display: FIRST }, options: {} });
    expect(started.status, `B's session starts: ${JSON.stringify(started)}`).not.toBe('needs_trust');
    type Status = { process: string; turn: unknown; engineSessionId: string | null };
    await expect
      .poll(async () => {
        const status = await b.request<Status>('session.status', { appSessionId: app }).catch(() => null);
        return status !== null && status.process === 'ready' && status.turn === null ? status.engineSessionId : null;
      }, { timeout: 60_000, message: `B's session ends its first turn\n${b.log().slice(-4000)}` })
      .toBe(B_SESSION);
    await scene.sminos.list({ engine: B_SESSION, app, owners: [scene.member], project: PROJECT, title: TITLE, cwd: checkout });

    // 1. Through the hub: B's address maps to a closed port, so the link comes up over the relay.
    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A' } });
    keepMainLines(a);
    const page = a.page;
    await expect
      .poll(async () => {
        const m = await machineOf(page, b.ref);
        return m === undefined ? null : { state: m.state, carrier: m.carrier ?? null, name: m.name, local: m.local };
      }, { timeout: 60_000, message: `A's link to B comes up over the relay\n${mainSaid(page)}` })
      .toEqual({ state: 'up', carrier: 'relay', name: B_NAME, local: false });
    console.log(`[e2e:remote] A's first launch: B (${b.ref}) up over relay`);
    // B's listed row: sminos's member frame, B's signed listing at the hub, A's feed and rows.
    await expect
      .poll(async () => (await rowsOf(page)).find((row) => row.machine === b.ref && row.session === app) ?? null, {
        timeout: 60_000,
        message: `B's session is a row of A's\n${mainSaid(page)}\nB's log:\n${b.log().slice(-4000)}`,
      })
      .toMatchObject({ lane: 'B', title: TITLE, owners: [scene.member] });

    // The row in A's sidebar, under B's machine row; its hover names the carrier; a click opens it in A's pane, which
    // reads B's history over the link.
    await keepBatches(page);
    await expandMachine(page, b.ref);
    const row = sessionRow(page, address);
    await expect(row, `B's row in A's sidebar\n${mainSaid(page)}`).toBeVisible({ timeout: 30_000 });
    await hoverMachineLine(page, row, `${B_NAME} · via the hub`);
    await row.click();
    await expect(main(page).getByText(FIRST_REPLY).first(), `B's history in A's pane\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });

    // A sends: B's engine is written A's words, and its reply reaches A as it streams, deltas first.
    await composerOf(page).click();
    await page.keyboard.type(SECOND);
    await page.keyboard.press('Enter');
    await expect.poll(async () => JSON.stringify(await writtenOnB()), { timeout: 60_000, message: `B's transcript records A's send\n${mainSaid(page)}` }).toContain(SECOND);
    // While B's engine holds before the whole message, A's pane draws the streamed prefix, and only that.
    await expect(main(page).getByText(SECOND_PARTIAL).first(), `the streamed text in A's pane before the whole reply\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
    await expect(main(page).getByText(SECOND_REPLY)).toHaveCount(0);
    await b.request('session.getContextUsage', { appSessionId: app, detail: 'summary' }); // lets B's engine go on
    await expect(main(page).getByText(SECOND_REPLY).first(), 'the whole reply in A’s pane').toBeVisible({ timeout: 60_000 });
    const onA = await batchedEvents(page, b.ref, app);
    const deltas = onA.filter((e): e is Extract<SessionEvent, { kind: 'assistant.block.delta' }> => e.kind === 'assistant.block.delta');
    const onB = (await b.request<{ events: SessionEvent[] }>('session.events', { appSessionId: app, afterSeq: null, limit: null })).events;
    const batchIds = [...new Set((await keptBatches(page)).map((k) => `${k.machine ?? 'this Mac'}: ${k.appSessionId}`))];
    const said = () => `A's batches for ${address}: ${onA.map((e) => e.kind).join(', ')}\nthe sessions A's batches named: ${batchIds.join(', ')}\nB's events: ${onB.map((e) => e.kind).join(', ')}`;
    expect(deltas.map((e) => e.textDelta), `the reply streamed to A as its deltas\n${said()}`).toEqual(SECOND_DELTAS);
    await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);

    // A permission B's engine asks for, answered in A's pane: the replay goes on only on the `allow` it holds at.
    await composerOf(page).click();
    await page.keyboard.type(THIRD);
    await page.keyboard.press('Enter');
    const card = main(page).getByRole('group', { name: 'Approval needed' });
    await expect(card, `the permission card in A's pane\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(`echo ${APPROVED}`);
    await card.getByRole('radio', { name: 'Allow once' }).click();
    await card.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(card).toBeHidden({ timeout: 30_000 });
    await expect(main(page).getByText(THIRD_REPLY).first(), `the turn goes on on B\n${b.log().slice(-3000)}`).toBeVisible({ timeout: 60_000 });
    await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);

    // A pasted image goes with the message, inline, and B's engine is written it.
    await composerOf(page).click();
    await pastePng(page);
    await expect(main(page).getByRole('list', { name: 'attachments' }).getByText('shot.png')).toBeVisible();
    await page.keyboard.type(IMAGE_TEXT);
    await page.keyboard.press('Enter');
    type Block = { type: string; source?: { media_type?: string } };
    await expect
      .poll(async () => (await writtenOnB()).filter((c): c is Block[] => Array.isArray(c)).map((blocks) => blocks.map((x) => [x.type, x.source?.media_type ?? null])), { timeout: 60_000, message: 'B’s transcript records the image' })
      .toContainEqual([['image', 'image/png'], ['text', null]]);
    await expect(main(page).getByText(IMAGE_REPLY).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);

    await test.step('M4: a dropped text file goes up to B’s desk-uploads, and the message names its path there', async () => {
      await composerOf(page).click();
      await dropTextFile(page, DROPPED);
      await page.keyboard.type(UPLOAD_TEXT);
      await page.keyboard.press('Enter');
      let mention: string | null = null;
      await expect
        .poll(async () => (mention = (await writtenOnB()).map((content) => uploadMention(content, app)).find((m) => m !== null) ?? null), {
          timeout: 60_000,
          message: `B's transcript records a message naming the upload's path on B\n${mainSaid(page)}`,
        })
        .not.toBeNull();
      expect(JSON.stringify(await writtenOnB()), 'the text went with it').toContain(UPLOAD_TEXT);
      expect(uploadedFiles(checkout, app), 'one file under B’s desk-uploads for the session').toHaveLength(1);
      expect(readFileSync(join(checkout, mention!), 'utf8'), 'the named path holds the dropped bytes').toBe(DROPPED.content);
      await expect(main(page).getByText(UPLOAD_REPLY).first()).toBeVisible({ timeout: 60_000 });
      await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);
    });

    // The panel's tools over B's checkout. Each surface's rows, by path.
    const files = surface(page, 'files');
    const treeRow = (name: string) => files.locator(`[role="treeitem"][data-path="${name === '' ? checkout : join(checkout, name)}"]`);
    const scm = surface(page, 'source-control').locator('[data-scm]');
    const scmRow = (group: 'staged' | 'unstaged' | 'untracked', path: string) => scm.locator(`[data-scm-group="${group}"] [data-scm-row][data-path="${path}"]`);

    await test.step('M4: the Files tool lists B’s checkout, and the editor saves a file there', async () => {
      await openSurface(page, 'Files');
      const checkoutRow = treeRow('');
      await expect(checkoutRow, `B's checkout in A's Files tool\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      await expect(async () => {
        if ((await checkoutRow.getAttribute('aria-expanded')) !== 'true') await checkoutRow.click();
        await expect(checkoutRow).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      await expect(treeRow(NOTES), 'the checkout’s committed file').toBeVisible({ timeout: 60_000 });

      await treeRow(NOTES).click();
      const viewer = page.locator(`[data-file-viewer][data-path="${join(checkout, NOTES)}"]`);
      await expect(viewer).toHaveAttribute('data-editable', 'true', { timeout: 60_000 });
      await expect(viewer.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
      await expect(viewer.locator('.cm-content .cm-line').first()).toHaveText(NOTES_TEXT.trim());
      await viewer.locator('.cm-content .cm-line').first().click({ position: { x: 3, y: 4 } }); // the line's start
      await page.keyboard.type(TYPED);
      await page.keyboard.press('Enter');
      await expect(viewer).toHaveAttribute('data-dirty', 'true');
      await viewer.locator('[data-editor-controls]').getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(async () => (await b.request<{ content: string }>('files.read', { appSessionId: app, path: join(checkout, NOTES) })).content, {
          timeout: 60_000,
          message: `the saved file, read over B's machine.sock\n${mainSaid(page)}`,
        })
        .toBe(`${TYPED}\n${NOTES_TEXT}`);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
      // back to the session's tab: the panel's tools are the session's
      await mainTabById(page, `session:${address}`).click();
    });

    await test.step('M4: files written on B show in A’s tree and status with no click, one written while A is cut off after the reconnect', async () => {
      await openSurface(page, 'Source control');
      await expect(scm.locator('[data-scm-header]'), `B's repository in A's Source control tool\n${mainSaid(page)}`).toContainText('⎇ main', { timeout: 60_000 });
      await expect(scmRow('unstaged', NOTES), 'the saved file is a change in B’s status').toBeVisible({ timeout: 60_000 });
      await expect(files, 'both tools are on screen').toBeVisible();
      await expect(treeRow(NOTES)).toBeVisible();

      // Nothing is clicked from here on in this step: each change reaches the tools through the checkout's feed.
      writeFileSync(join(checkout, ON_B), 'Written on B.\n');
      await expect(treeRow(ON_B), `B's new file in A's tree\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      await expect(scmRow('untracked', ON_B), 'and in B’s status').toBeVisible({ timeout: 60_000 });

      // A's way to B cut (the relay through the hub; the direct dial already fails): the link goes down, the file is
      // written, and A is let back.
      scene!.aHub.cut();
      await expect
        .poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 60_000, message: `A's link to B goes down once cut\n${mainSaid(page)}` })
        .toBe('down');
      writeFileSync(join(checkout, WHILE_CUT), 'Written on B while A was cut off.\n');
      scene!.aHub.restore();
      await expect
        .poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 120_000, message: `A's link to B comes up again\n${mainSaid(page)}` })
        .toBe('up');
      await expect(treeRow(WHILE_CUT), `the file written while cut off, in A's tree after the reconnect\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      await expect(scmRow('untracked', WHILE_CUT), 'and in B’s status').toBeVisible({ timeout: 60_000 });
    });

    await test.step('M4: the Source control tool commits on B', async () => {
      await scmRow('unstaged', NOTES).getByRole('button', { name: `Stage ${NOTES}`, exact: true }).click();
      await expect(scmRow('staged', NOTES)).toBeVisible({ timeout: 60_000 });
      await scm.getByRole('textbox', { name: 'Commit message' }).fill(COMMIT);
      await scm.getByRole('button', { name: 'Commit', exact: true }).click();
      await expect(scm.locator('[data-scm-last-commit]')).toHaveText(new RegExp(`^[0-9a-f]{7} · ${COMMIT}$`), { timeout: 60_000 });
      expect(git(checkout, 'log', '-1', '--format=%s'), 'B’s repository has the commit').toBe(COMMIT);
      expect(git(checkout, 'show', 'HEAD:notes.txt'), 'with the saved file').toBe(`${TYPED}\n${NOTES_TEXT}`.trim());
      await expect(scmRow('staged', NOTES)).toHaveCount(0);
    });

    // M3: the session's shells on B, as B's own pty host lists them
    type Pty = { ptyId: string; appSessionId: string; label: string; cwd: string; alive: boolean };
    const shellsOnB = async () => (await b.request<{ ptys: Pty[] }>('pty.list')).ptys.filter((p) => p.appSessionId === app && p.alive);
    const bPtyLines = () => b.log().split('\n').filter((line) => /pty|stream|forward|endpoint/i.test(line)).slice(-30).join('\n');
    let terminal = ''; // the Terminal tool's terminal on screen, the shell on B under it

    await test.step('M3: the Terminal tool opens a shell on B in the session’s checkout, and a reload re-attaches the same shell', async () => {
      await openSurface(page, 'Terminal');
      terminal = await shownTerminal(page);
      const id = terminal;
      await expect
        .poll(async () => (await terminalRows(page, id)).some((row) => row.trim() !== ''), { timeout: 60_000, message: 'the shell on B draws its prompt' })
        .toBe(true)
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await terminalSaid(page, id)}\n${mainSaid(page)}\nB's log:\n${bPtyLines()}`);
        });
      await expect.poll(async () => (await shellsOnB()).length, { timeout: 30_000, message: 'one shell for the session on B' }).toBe(1);
      const [shell] = await shellsOnB();
      expect(shell!.cwd, 'in the session’s checkout').toBe(checkout);

      await typeInTerminal(page, id, 'pwd');
      await expect
        .poll(async () => printedLine(await terminalRows(page, id), checkout), { timeout: 30_000, message: 'pwd prints B’s checkout' })
        .toBe(true)
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await terminalSaid(page, id)}`);
        });

      // A reload of A's window: the tab comes back from the layout and re-attaches to the shell under its label.
      type Panel = { tabs: { id: string; toolId: string }[] } | null;
      await expect
        .poll(async () => ((await invoke<{ value: Panel }>(page, 'layout.get', { key: `panel.${address}` })).value?.tabs ?? []).map((tab) => [tab.id, tab.toolId]), {
          timeout: 30_000,
          message: 'the Terminal tab reaches the layout under the shell’s label',
        })
        .toContainEqual([shell!.label, 'terminal']);
      await page.reload();
      await expect(main(page).getByText(UPLOAD_REPLY).first(), `B's session in A's pane after the reload\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      await openSurface(page, 'Terminal');
      terminal = await shownTerminal(page);
      const reattached = terminal;
      await expect
        .poll(async () => printedLine(await terminalRows(page, reattached), checkout), { timeout: 60_000, message: 'the re-attached terminal shows what the shell printed' })
        .toBe(true)
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await terminalSaid(page, reattached)}\n${mainSaid(page)}\nB's log:\n${bPtyLines()}`);
        });
      const bars = surface(page, 'terminal');
      await expect(bars.getByRole('status', { name: 'terminal pending' }), 'the tab adopted its shell').toHaveCount(0, { timeout: 30_000 });
      await expect(bars.getByRole('status', { name: 'previous shell' }), 'no lost-shell line: the shell is the same').toHaveCount(0);
      expect((await shellsOnB()).map((p) => p.ptyId), 'still the one shell on B').toEqual([shell!.ptyId]);
    });

    await test.step('M3: a dev server in that shell opens from B’s localhost link in A’s browser, forwarded from B', async () => {
      const id = terminal;
      // The server process and its port as this Mac sees them (B runs here), for a failure: whether the command ran, and
      // whether the server bound or listens yet.
      const serverSaid = () => {
        const run = (command: string, args: string[]) => {
          try {
            return execFileSync(command, args, { encoding: 'utf8' });
          } catch (error) {
            return `${command}: ${(error as { stdout?: string }).stdout || (error instanceof Error ? error.message : String(error))}`;
          }
        };
        const processes = run('ps', ['-axo', 'pid,ppid,etime,stat,command']).split('\n').filter((line) => line.includes('http.server'));
        return `the http.server processes: ${processes.join('\n') || 'none'}\nport ${devPort}: ${run('lsof', ['-nP', `-iTCP:${devPort}`])}`;
      };
      // Before it prints its line, http.server looks up the name of the address it bound (`socket.getfqdn('::')` in
      // HTTPServer.server_bind), a reverse lookup a hosted runner's resolver answers only after its timeouts: 72 s on
      // run 41321392450, against nothing measurable with `--bind 127.0.0.1`. The wait sits well above that; the time it
      // took is logged.
      const typedAt = Date.now();
      await typeInTerminal(page, id, `python3 -m http.server ${devPort}`);
      await expect
        .poll(async () => printedAnywhere(await terminalRows(page, id), `Serving HTTP on :: port ${devPort} (${devServerUrl(devPort)})`), {
          timeout: 180_000,
          message: 'B’s dev server listens dual-stack and prints the link B’s reply names',
        })
        .toBe(true)
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serverSaid()}\n${await terminalSaid(page, id)}\n${mainSaid(page)}\nB's log:\n${bPtyLines()}`);
        });
      console.log(`[e2e:remote] B's dev server printed its line ${Date.now() - typedAt} ms after the command was typed`);
      expect(await listening(devPort), 'B’s loopback reaches it').toBe(true);

      // B names it in its reply as the server printed it, and the link opens in the in-app browser through a forward of
      // B's port (the endpoint connects to B's 127.0.0.1, which the dual-stack listener accepts).
      await composerOf(page).click();
      await page.keyboard.type(LINK_ASK);
      await page.keyboard.press('Enter');
      const link = main(page).getByRole('link', { name: LINK_TEXT });
      await expect(link, `B's reply names the dev server\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      await link.click();
      const mark = page.locator('[data-browser-view="panel"] [data-browser-chip] [data-forward-mark]');
      await expect(mark, `the browser's tab, marked forwarded\n${mainSaid(page)}\nB's log:\n${bPtyLines()}`).toHaveText(`forwarded from ${B_NAME}`, { timeout: 60_000 });
      await expect(mark).toHaveAttribute('title', `Port ${devPort} on ${B_NAME}, forwarded to this Mac`);
      type Tab = { url: string; forward?: { machine: string; port: number; localPort: number } };
      const forwardedTab = async () => (await invoke<{ tabs: Tab[] }>(page, 'browser.tabs.list', { appSessionId: app }, b.ref)).tabs.find((t) => t.forward?.port === devPort);
      await expect.poll(async () => (await forwardedTab()) !== undefined, { timeout: 30_000, message: 'the session’s browser holds the forwarded tab' }).toBe(true);
      const tab = (await forwardedTab())!;
      const { machine, localPort } = tab.forward!;
      expect(machine, 'forwarded from B').toBe(b.ref);
      expect(localPort, 'a listener of A’s own, not B’s port').not.toBe(devPort);
      expect(tab.url, 'the page loads from A’s listener').toBe(`http://127.0.0.1:${localPort}/`);

      // The page is the directory listing B's server sent for the checkout.
      const pageText = () =>
        a!.app.evaluate(async ({ webContents }, origin) => {
          const view = webContents.getAllWebContents().find((w) => w.getURL().startsWith(origin));
          return view ? ((await view.executeJavaScript('document.body ? document.body.innerText : ""')) as string) : null;
        }, `http://127.0.0.1:${localPort}/`);
      await expect.poll(pageText, { timeout: 60_000, message: 'the forwarded page shows B’s checkout' }).toContain('Directory listing for /');
      const listed = (await pageText())!;
      for (const name of [NOTES, ON_B, WHILE_CUT]) expect(listed, `the listing names ${name}`).toContain(name);
      // Back in the Terminal tool (the browser may have taken its place): B's server logged the page's request, and ⌃C
      // stops it.
      await openSurface(page, 'Terminal');
      const shown = await shownTerminal(page);
      await expect
        .poll(async () => printedAnywhere(await terminalRows(page, shown), '"GET / HTTP/1.1" 200'), { timeout: 30_000, message: 'B’s server logged the page’s request' })
        .toBe(true);
      await surface(page, 'terminal').locator(`[data-terminal-id="${shown}"] textarea`).focus();
      await page.keyboard.press('Control+C');
      await expect
        .poll(async () => printedAnywhere(await terminalRows(page, shown), 'Keyboard interrupt received, exiting.'), { timeout: 30_000, message: 'the server ends at ⌃C' })
        .toBe(true)
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await terminalSaid(page, shown)}`);
        });
      await expect.poll(() => listening(devPort), { timeout: 30_000, message: 'nothing listens on B’s port' }).toBe(false);
      await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);
    });
    await a.cleanup();
    a = null;

    // 2. Directly: B's address maps to its listener, so the link comes up over the direct carrier.
    // MAWS_E2E_STEP_UP=accept: the step-up sheet a spawn always asks for is accepted with no sheet and no Touch ID
    // (src/main/device/step-up-sheet.ts's harness confirmation); the signed action is still the device's.
    // M5a: Save As lands in `savedOnA` with no dialog, and what main would hand the OS is written to `openLog` instead.
    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(true), MAWS_MACHINE_NAME: 'A', MAWS_E2E_STEP_UP: 'accept', MAWS_E2E_SAVE_PATH: savedOnA, MAWS_E2E_OPEN_LOG: openLog } });
    keepMainLines(a);
    const again = a.page;
    const againApp = a.app;
    await expect
      .poll(async () => {
        const m = await machineOf(again, b.ref);
        return m === undefined ? null : { state: m.state, carrier: m.carrier ?? null };
      }, { timeout: 60_000, message: `A's link to B comes up directly\n${mainSaid(again)}` })
      .toEqual({ state: 'up', carrier: 'direct' });
    console.log(`[e2e:remote] A's second launch: B (${b.ref}) up over direct`);
    await expect
      .poll(async () => (await rowsOf(again)).some((row) => row.machine === b.ref && row.session === app), { timeout: 60_000, message: `B's row again\n${mainSaid(again)}` })
      .toBe(true);
    await expandMachine(again, b.ref);
    const rowAgain = sessionRow(again, address);
    await expect(rowAgain).toBeVisible({ timeout: 30_000 });
    await hoverMachineLine(again, rowAgain, `${B_NAME} · direct (tailnet)`);
    await rowAgain.click();
    await expect(main(again).getByText(IMAGE_REPLY).first(), `B's history over the direct carrier\n${mainSaid(again)}`).toBeVisible({ timeout: 60_000 });

    await test.step('M5a: B’s session’s artifacts list and read in A, a rename shows in B’s library, a PDF export of B’s saves on A, a file of B’s checkout opens as a copy, and the Browser tool reads B’s reason', async () => {
      const sessionTab = mainTabById(again, `session:${address}`);
      const bLines = (pattern: RegExp) => b.log().split('\n').filter((line) => pattern.test(line)).slice(-30).join('\n');

      // B's session makes its artifacts at A's ask: the text file it wrote in B's checkout, and a page
      writeFileSync(join(checkout, NOTES_ARTIFACT.file), NOTES_ARTIFACT.text);
      await composerOf(again).click();
      await again.keyboard.type(MAKE_ASK);
      await again.keyboard.press('Enter');
      await quoting(expect(main(again).getByText(MADE_REPLY).first(), 'B’s reply once its artifacts are made').toBeVisible({ timeout: 60_000 }), () => `${mainSaid(again)}\nB's log:\n${bLines(/artifact|tool|maws|replay/i)}`);
      await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);
      type Linked = { artifacts: { id: string; title: string; kind: string }[] };
      const linked = (await b.request<Linked>('artifacts.list', { filter: { appSessionId: app } })).artifacts;
      expect(linked.map((x) => [x.kind, x.title]).sort(), 'both linked to B’s session in B’s store').toEqual([['file', NOTES_ARTIFACT.title], ['html', REPORT.title]]);
      const notes = linked.find((x) => x.kind === 'file')!;
      const report = linked.find((x) => x.kind === 'html')!;

      // The page's transcript row (B's host registered it: `maws.delivery.artifact`) opens it in the session's Artifacts
      // tool, the way to that tool now (it is no longer a surface of its own to launch); Back is the session's list, read
      // from B, and the text artifact reads there
      const pageCall = main(again).locator('section.transcript-artifact[data-artifact-state="registered"]').filter({ hasText: REPORT.title });
      await quoting(expect(pageCall, 'the page’s row in B’s transcript, registered').toBeVisible({ timeout: 60_000 }), () => mainSaid(again));
      await pageCall.getByRole('button', { name: 'Open', exact: true }).click();
      const tool = surface(again, 'artifacts');
      const pageRecord = tool.locator(`[data-artifact-record="${report.id}"]`);
      await quoting(expect(pageRecord, 'the page in the session’s Artifacts tool').toBeVisible({ timeout: 60_000 }), async () => `${await paneSaid(again)}\n${mainSaid(again)}`);
      await pageRecord.getByRole('button', { name: 'Back', exact: true }).click();
      await tool.getByRole('button', { name: 'This session', exact: true }).click();
      const toolRow = (id: string) => tool.locator(`button[data-artifact-row][data-artifact-id="${id}"]`);
      await quoting(expect(toolRow(notes.id), 'the text artifact in the session’s Artifacts tool').toBeVisible({ timeout: 60_000 }), () => mainSaid(again));
      await expect(toolRow(report.id), 'and the page').toBeVisible();
      await toolRow(notes.id).click();
      const record = tool.locator(`[data-artifact-record="${notes.id}"]`);
      await quoting(expect(record, 'the text read from B').toContainText(NOTES_ARTIFACT.text.trim(), { timeout: 60_000 }), async () => `the record: ${await record.innerText().catch(() => '')}\n${mainSaid(again)}`);
      await record.getByRole('button', { name: 'Back', exact: true }).click();

      // Open library opens B's library; a rename there is B's store's, as B's own library reads it
      await tool.getByRole('button', { name: 'Open library', exact: true }).click();
      const library = again.locator('[data-library]');
      await expect(library.locator('button[data-library-machine]'), 'the library is B’s').toHaveAttribute('data-library-machine', b.ref, { timeout: 30_000 });
      await expect(library.getByRole('button', { name: `Library on ${B_NAME}` })).toBeVisible();
      const libraryRow = (id: string) => library.locator(`article[data-artifact-row="${id}"]`);
      await expect(libraryRow(notes.id)).toHaveAttribute('aria-label', NOTES_ARTIFACT.title, { timeout: 60_000 });
      await libraryRow(notes.id).getByRole('button', { name: `Actions for ${NOTES_ARTIFACT.title}` }).click();
      await again.getByRole('menuitem', { name: 'Rename…' }).click();
      const rename = again.getByRole('dialog', { name: 'Rename artifact' });
      await rename.getByRole('textbox', { name: 'Title' }).fill(RENAMED);
      await rename.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(rename).toBeHidden();
      type Rows = { rows: { id: string; title: string }[] };
      await expect
        .poll(async () => (await b.request<Rows>('library.list', {})).rows.find((row) => row.id === notes.id)?.title, { timeout: 60_000, message: `B's own library, over its machine.sock, holds the new title\n${mainSaid(again)}` })
        .toBe(RENAMED);
      await expect(libraryRow(notes.id), 'and A’s view of B’s library follows').toHaveAttribute('aria-label', RENAMED, { timeout: 60_000 });

      // Export › PDF of B's page: B's render host exports it, and Save As pages it to A's folder (the save seam)
      await libraryRow(report.id).getByRole('button', { name: `Actions for ${REPORT.title}` }).click();
      await again.getByRole('menuitem', { name: 'Export', exact: true }).click();
      await again.getByRole('menuitem', { name: 'PDF', exact: true }).click();
      const pdf = join(savedOnA, `${REPORT.title}.pdf`);
      await expect
        .poll(() => (existsSync(pdf) ? readFileSync(pdf).subarray(0, 5).toString('latin1') : ''), { timeout: 180_000, message: 'the PDF B exported, saved in A’s folder' })
        .toBe('%PDF-')
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await paneSaid(again)}\n${mainSaid(again)}\nB's log:\n${bLines(/render|export/i)}`);
        });
      await expect(again.getByRole('region', { name: /^Notifications/ }).getByText(`Saved to ${pdf}`)).toBeVisible();
      console.log(`[e2e:remote] M5a: B's PDF export saved on A, ${readFileSync(pdf).length} bytes`);

      // Open externally on an HTML file of B's checkout: a copy paged here is what main hands the OS (the open seam)
      writeFileSync(join(checkout, PAGE_ON_B.name), PAGE_ON_B.content);
      await sessionTab.click();
      await openSurface(again, 'Files');
      const files = surface(again, 'files');
      const checkoutRow = files.locator(`[role="treeitem"][data-path="${checkout}"]`);
      await expect(checkoutRow, `B's checkout in A's Files tool\n${mainSaid(again)}`).toBeVisible({ timeout: 60_000 });
      await expect(async () => {
        if ((await checkoutRow.getAttribute('aria-expanded')) !== 'true') await checkoutRow.click();
        await expect(checkoutRow).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      const pageRow = files.locator(`[role="treeitem"][data-path="${join(checkout, PAGE_ON_B.name)}"]`);
      await expect(pageRow, 'the page written on B, in A’s tree').toBeVisible({ timeout: 60_000 });
      await pageRow.click();
      const external = again.locator(`[data-file-viewer][data-path="${join(checkout, PAGE_ON_B.name)}"] [data-external-row]`);
      const open = external.getByRole('button', { name: 'Open externally', exact: true });
      await expect(open).toHaveAttribute('title', `Opens a copy of this file from ${B_NAME} on this Mac`, { timeout: 60_000 });
      await open.click();
      const opened = () => (existsSync(openLog) ? readFileSync(openLog, 'utf8').split('\n') : []).filter((line) => line.endsWith(`/${PAGE_ON_B.name}`));
      await quoting(expect.poll(() => opened().length, { timeout: 60_000, message: 'main hands the OS a copy of B’s file' }).toBe(1), async () => `the row: ${await external.innerText().catch(() => '')}\n${mainSaid(again)}`);
      const [copy] = opened();
      expect(copy, 'a copy under this Mac’s copies of B’s files, not B’s path').toContain(`/maws-remote-copies/${b.ref}/`);
      expect(readFileSync(copy!, 'utf8'), 'holding the file’s bytes').toBe(PAGE_ON_B.content);
      await expect(external.getByRole('alert'), 'nothing refused').toHaveCount(0);
      rmSync(dirname(copy!), { recursive: true, force: true });

      // The Browser tool's notice is B's reason the session's agent has no browser there, as B's own front answers it
      await sessionTab.click();
      type Capabilities = { browser?: { available: boolean; reason?: string } };
      const browserOnB = (await b.request<Capabilities>('session.capabilities', { appSessionId: app })).browser;
      expect(browserOnB?.available, `B's session has no browser on B: ${JSON.stringify(browserOnB)}`).toBe(false);
      expect(browserOnB?.reason, 'B’s reason names B').toContain(B_NAME);
      await openSurface(again, 'Browser');
      await expect(surface(again, 'browser').locator('[data-browser-agent-unavailable]')).toHaveText(`The agent has no browser here: ${browserOnB!.reason}`, { timeout: 30_000 });
      console.log(`[e2e:remote] M5a: the Browser tool reads B's reason: ${browserOnB!.reason}`);
    });

    await test.step('M5b: B’s page renders in A’s frame with what B’s store holds, and a document B’s session starts, typed in A’s editor, reads back from B’s store', async () => {
      const sessionTab = mainTabById(again, `session:${address}`);
      const bLines = (pattern: RegExp) => b.log().split('\n').filter((line) => pattern.test(line)).slice(-30).join('\n');

      // B's session starts the plan at A's ask
      await sessionTab.click();
      await composerOf(again).click();
      await again.keyboard.type(PLAN_ASK);
      await again.keyboard.press('Enter');
      await quoting(expect(main(again).getByText(PLAN_MADE).first(), 'B’s reply once the plan is made').toBeVisible({ timeout: 60_000 }), () => `${mainSaid(again)}\nB's log:\n${bLines(/artifact|tool|maws|replay/i)}`);
      await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);
      type Linked = { artifacts: { id: string; title: string; kind: string }[] };
      const linked = (await b.request<Linked>('artifacts.list', { filter: { appSessionId: app } })).artifacts;
      const report = linked.find((x) => x.kind === 'html' && x.title === REPORT.title)!;
      const plan = linked.find((x) => x.kind === 'document' && x.title === PLAN.title);
      expect(plan, `the plan linked to B’s session in B’s store: ${JSON.stringify(linked)}`).toBeDefined();

      // The page in the Artifacts tool's frame: what B's store holds, read here only over the link (A's own store has no
      // such artifact), the bridge script B's scheme inserts left aside
      const onB = (await b.request<{ content: string }>('library.read', { artifactId: report.id })).content;
      const [heading, paragraph] = [/<h1>([^<]*)<\/h1>/.exec(onB)?.[1], /<p>([^<]*)<\/p>/.exec(onB)?.[1]];
      expect([heading, paragraph], 'B’s store holds the page').toEqual(['Report from B', 'Rendered on B, saved on A.']);
      const pageCall = main(again).locator('section.transcript-artifact[data-artifact-state="registered"]').filter({ hasText: REPORT.title });
      await pageCall.getByRole('button', { name: 'Open', exact: true }).click();
      const tool = surface(again, 'artifacts');
      const pageRecord = tool.locator(`[data-artifact-record="${report.id}"]`);
      await quoting(expect(pageRecord, 'the page in the session’s Artifacts tool').toBeVisible({ timeout: 60_000 }), async () => `${await paneSaid(again)}\n${mainSaid(again)}`);
      const frame = pageRecord.frameLocator('[data-artifact-frame="html"]');
      await quoting(expect(frame.locator('h1'), 'B’s page in A’s frame').toHaveText(heading!, { timeout: 60_000 }), async () => `the record: ${await pageRecord.innerText().catch(() => '')}\n${mainSaid(again)}`);
      await expect(frame.locator('p')).toHaveText(paragraph!);
      console.log(`[e2e:remote] M5b: B's page renders in A's frame: ${heading}`);

      // The plan in A's editor: what A types there lands in B's store, as B's own export of it reads it
      await pageRecord.getByRole('button', { name: 'Back', exact: true }).click();
      await tool.getByRole('button', { name: 'This session', exact: true }).click();
      const planRow = tool.locator(`button[data-artifact-row][data-artifact-id="${plan!.id}"]`);
      await quoting(expect(planRow, 'the plan in the session’s Artifacts tool').toBeVisible({ timeout: 60_000 }), () => mainSaid(again));
      await planRow.click();
      const editor = tool.locator(`[data-artifact-record="${plan!.id}"] .ds-doc .ProseMirror`);
      await quoting(expect(editor, 'B’s plan in A’s editor').toBeVisible({ timeout: 60_000 }), async () => `${await paneSaid(again)}\n${mainSaid(again)}`);
      await expect(editor, 'writable: A owns B').toHaveAttribute('contenteditable', 'true', { timeout: 30_000 });
      await editor.click();
      await again.keyboard.type(TYPED_PLAN);
      await expect(editor).toContainText(TYPED_PLAN);
      const exported = async () => {
        const { path } = await b.request<{ path: string }>('artifacts.export', { artifactId: plan!.id, format: 'md' });
        return readFileSync(path, 'utf8');
      };
      await expect
        .poll(exported, { timeout: 60_000, message: 'B’s store holds what A typed (B’s own export of the plan)' })
        .toContain(TYPED_PLAN)
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await paneSaid(again)}\n${mainSaid(again)}\nB's log:\n${bLines(/document|artifact|endpoint|stream/i)}`);
        });
      console.log(`[e2e:remote] M5b: what A typed reads back from B's store`);
    });

    await test.step('M5c: O4’s surfaces on B from A: a dashboard of B’s refreshes in A, Connect completes through A’s loopback, and Send to Notion makes one page on B', async () => {
      const bLines = (pattern: RegExp) => b.log().split('\n').filter((line) => pattern.test(line)).slice(-40).join('\n');
      const sessionTab = mainTabById(again, `session:${address}`);
      type Linked = { artifacts: { id: string; title: string; kind: string }[] };
      const linked = (await b.request<Linked>('artifacts.list', { filter: { appSessionId: app } })).artifacts;
      const report = linked.find((x) => x.kind === 'html' && x.title === REPORT.title)!;
      const plan = linked.find((x) => x.kind === 'document' && x.title === PLAN.title)!;

      // The dashboard-live-data fixture's Dashboard, written on B as its agent writes it (the host's agent seam, the `maws`
      // server's real tools), and an HTML page declaring the OAuth server, both in a Space linked to B's checkout (their
      // directory for the connectors' routes)
      const { space } = await b.request<{ space: { id: string } }>('spaces.create', { name: CONNECT_PAGE.space, linkedDir: checkout });
      const dashboard = await writeBoard(new AgentSeam(join(b.userData, 'dashboard-e2e')));
      await b.request('artifacts.update', { artifactId: dashboard, spaceId: space.id });
      const connectPage = (await b.request<{ artifact: { id: string } }>('artifacts.create', { kind: 'html', title: CONNECT_PAGE.title, spaceId: space.id, content: { bytes: new TextEncoder().encode(CONNECT_PAGE.html), name: 'index.html' } })).artifact.id;

      // B's observer: a real engine, started with no message (no model turn), whose report of B's servers Send to's
      // status read observes. B's first session goes first: it is a replay, whose unrecorded `mcp_status` answers empty,
      // which fails its schema, and the observation cache fails the launch context closed until main reattaches
      // (src/engine-host/connectors/provenance.ts); its journal has played to its end by now.
      type Live = { appSessionId: string; process: string; pid: number | null };
      const liveOnB = async () => (await b.request<Live[]>('engine.sessions')).filter((s) => s.process === 'ready');
      await b.request('session.stop', { appSessionId: app, reason: 'stop' });
      await expect.poll(async () => (await liveOnB()).map((s) => s.appSessionId), { timeout: 30_000, message: 'B’s first session stopped before the observation' }).toEqual([]);
      assertOpenPhase(oauth!);
      const observerApp = (await b.request<{ appSessionId: string }>('session.create', { projectId: project.id, location: null })).appSessionId;
      await b.request('session.intent.patch', { appSessionId: observerApp, patch: { gateway: 'direct' } });
      const begun = await b.request<{ status: string }>('session.start', { appSessionId: observerApp, message: null, options: {} });
      expect(begun.status, `B's observer starts: ${JSON.stringify(begun)}`).not.toBe('needs_trust');
      let observerPid = 0;
      await expect
        .poll(async () => (observerPid = (await liveOnB()).find((s) => s.appSessionId === observerApp)?.pid ?? 0), { timeout: 90_000, message: `B's observer engine is live\n${bLines(/session|spawn|engine|setup/i)}` })
        .toBeGreaterThan(0);
      type Report = { mcpServers: { name: string; status: string }[] };
      await expect
        .poll(async () => {
          const said = await b.request<Report>('session.mcpStatus', { appSessionId: observerApp }).catch(() => null);
          return Object.fromEntries((said?.mcpServers ?? []).filter((server) => [ROWS_SERVER, NOTION, OAUTH_SERVER].includes(server.name)).map((server) => [server.name, server.status]));
        }, { timeout: 60_000, message: 'B’s observer engine connected B’s three servers' })
        .toEqual({ [ROWS_SERVER]: 'connected', [NOTION]: 'connected', [OAUTH_SERVER]: 'connected' });
      type NotionStatus = { state: string; source?: { server: string } };
      const observed = await b.request<NotionStatus>('delivery.status', { target: 'notion', artifactId: plan.id });
      // on a failure: the observer's row, B's servers, the host's observation asked directly, and B's logs' connector lines
      const observerSaid = async () => {
        if (observed.state === 'ready') return '';
        const row = (await b.request<Record<string, unknown>[]>('engine.sessions')).find((s) => s.appSessionId === observerApp);
        const logs = (readdirSync(b.userData, { recursive: true }) as string[]).filter((name) => name.endsWith('.log')).map((name) => {
          const lines = readFileSync(join(b.userData, name), 'utf8').split('\n').filter((line) => /connector|observ|mcp|deliver|locat|status cache/i.test(line));
          return `${name}:\n${lines.slice(-30).map((line) => line.slice(0, 400)).join('\n')}`;
        });
        const servers = await b.request('connectors.servers', { artifactId: connectPage, tools: [{ server: NOTION, tool: NOTION_TOOL }, { server: ROWS_SERVER, tool: ROWS_TOOL }] }).then((answer) => JSON.stringify(answer).slice(0, 1500), String);
        const asked = row ? await b.request('connectors.observe', { appSessionId: observerApp, launchId: row.launchId, cwd: row.cwd }).then((answer) => JSON.stringify(answer), String) : 'no row';
        const after = await b.request('connectors.servers', { artifactId: connectPage, tools: [{ server: NOTION, tool: NOTION_TOOL }] }).then((answer) => JSON.stringify(answer).slice(0, 800), String);
        return `the observer's row: ${JSON.stringify(row && { launchId: row.launchId, cwd: row.cwd, process: row.process, pid: row.pid })}\nB's servers: ${servers}\nthe host's observe asked directly: ${asked}; the servers then: ${after}\nB's logs:\n${logs.join('\n')}`;
      };
      expect(observed, `Send to's status read on B observed the observer's report: ${JSON.stringify(observed)}\n${await observerSaid().catch(String)}`).toMatchObject({ state: 'ready', source: { server: NOTION } });
      // the observer stopped and confirmed dead; only then does the OAuth server demand sign-in, of MAWS alone, at the
      // authorization endpoint B asks A to open (never a loopback URL: main's openForMachine)
      await b.request('session.stop', { appSessionId: observerApp, reason: 'stop' });
      await expect.poll(async () => (await liveOnB()).length, { timeout: 30_000, message: 'B’s observer stopped' }).toBe(0);
      await expect.poll(() => isAlive(observerPid), { timeout: 30_000, message: `B’s observer engine (pid ${observerPid}) gone` }).toBe(false);
      enterOAuthPhase(oauth!, { enginePids: [observerPid] }, { advertise: { authorizationEndpoint: `${AUTHORIZE_AT}/authorize` } });

      // (a) The dashboard in A, opened from B's library: not fetched and not allowed, then B's rows once A allows the
      // tool on B, read through MAWS's own instance of B's server (no engine is live on B), and the next rows at the
      // query's schedule
      await sessionTab.click();
      const pageCall = main(again).locator('section.transcript-artifact[data-artifact-state="registered"]').filter({ hasText: REPORT.title });
      await pageCall.getByRole('button', { name: 'Open', exact: true }).click();
      const tool = surface(again, 'artifacts');
      const reportRecord = tool.locator(`[data-artifact-record="${report.id}"]`);
      await quoting(expect(reportRecord, 'the page in the session’s Artifacts tool').toBeVisible({ timeout: 60_000 }), async () => `${await paneSaid(again)}\n${mainSaid(again)}`);
      await reportRecord.getByRole('button', { name: 'Back', exact: true }).click();
      await tool.getByRole('button', { name: 'Open library', exact: true }).click();
      const library = again.locator('[data-library]');
      await expect(library.locator('button[data-library-machine]'), 'the library is B’s').toHaveAttribute('data-library-machine', b.ref, { timeout: 30_000 });
      const openFromLibrary = async (id: string, title: string) => {
        await library.getByRole('article', { name: title, exact: true }).click({ timeout: 60_000 });
        const tab = main(again).locator(`[data-artifact-tab="${id}"]`);
        await quoting(expect(tab, `${title} in a main tab`).toBeVisible({ timeout: 60_000 }), async () => `${await paneSaid(again)}\n${mainSaid(again)}`);
        return tab;
      };
      const views = liveViews(await openFromLibrary(dashboard, BOARD));
      await quoting(expect(labelOf(views), 'B’s dashboard, not fetched and not allowed').toHaveText(`${NOT_FETCHED} · ${DATASET_STATES.notAllowed}`, { timeout: 60_000 }), async () => `${mainSaid(again)}\nB's log:\n${bLines(/connector|lease|dataset/i)}`);
      const sourceSheet = await openSheet(views);
      const block = liveBlock(sourceSheet);
      await block.getByRole('button', { name: `Allow ${ROWS_NAME} to read` }).click();
      await sourceSheet.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(tableRows(views), 'B’s first rows reach A').toHaveCount(FIRST_SIGNUPS.length, { timeout: 60_000 }).catch(() => undefined); // drawsRows says what is drawn
      // on a failure: what A shows, what B holds (the grant, the dashboard's revision), what B's rows server was asked,
      // and B's connector lines
      const dashboardSaid = async () => {
        const label = await labelOf(views).innerText().catch(String);
        const blockText = await openSheet(views).then(async (open) => {
          const text = await liveBlock(open).innerText().catch(String);
          await open.getByRole('button', { name: 'Close', exact: true }).click().catch(() => undefined);
          return text;
        }, String);
        const grants = await b.request('artifacts.connectorGrants', { artifactId: dashboard }).then((answer) => JSON.stringify(answer), String);
        const revision = await b.request<{ artifact: { revision: number } }>('artifacts.get', { artifactId: dashboard }).then((answer) => String(answer.artifact.revision), String);
        const asked = existsSync(mcpLog) ? readFileSync(mcpLog, 'utf8').trim().split('\n').filter((line) => line.includes('"series"')).slice(-10).join('\n') : 'no call log';
        const logs = (readdirSync(b.userData, { recursive: true }) as string[]).filter((name) => name.endsWith('.log')).map((name) => {
          const lines = readFileSync(join(b.userData, name), 'utf8').split('\n').filter((line) => /connector|dataset|direct|lease|publish|grant/i.test(line));
          return `${name}:\n${lines.slice(-30).map((line) => line.slice(0, 400)).join('\n')}`;
        });
        return `A's label: ${label}\nA's live block: ${blockText}\nB's grants: ${grants}\nB's dashboard revision: ${revision}\nB's rows server was asked:\n${asked}\n${mainSaid(again)}\nB's logs:\n${logs.join('\n')}`;
      };
      await drawsRows(views, FIRST_SIGNUPS, 'B’s rows drawn in A').catch(async (error: unknown) => {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await dashboardSaid().catch(String)}`);
      });
      const firstCalls = callsOn(mcpLog, 'series').length;
      writeRows(rowsControl, NEXT_SIGNUPS);
      await expect.poll(() => callsOn(mcpLog, 'series').length, { timeout: SCHEDULE_MS + 60_000, message: 'the schedule’s next call on B’s rows server' }).toBeGreaterThan(firstCalls);
      await drawsRows(views, NEXT_SIGNUPS, 'B’s next rows drawn at the schedule');
      console.log(`[e2e:remote] M5c: B's dashboard refreshed in A, ${callsOn(mcpLog, 'series').length} calls on B's rows server`);

      // (c) Connect on B's OAuth server, from the page that declares it: the listener is A's (main's, on A's loopback),
      // the consent opened on A, the redirect relayed to B, where the code is exchanged and the grant sealed
      const reopenLibrary = async () => {
        await sessionTab.click();
        await pageCall.getByRole('button', { name: 'Open', exact: true }).click();
        await reportRecord.getByRole('button', { name: 'Back', exact: true }).click();
        await tool.getByRole('button', { name: 'Open library', exact: true }).click();
      };
      await reopenLibrary();
      const connectTab = await openFromLibrary(connectPage, CONNECT_PAGE.title);
      await expect(connectTab.frameLocator('[data-artifact-frame="html"]').locator('#declared'), 'the page declares the OAuth server’s tool on B').toHaveText('declared', { timeout: 60_000 });
      await main(again).getByRole('button', { name: 'Connectors' }).click();
      const sheet = again.locator('[data-connectors-sheet]');
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: `Show the connectors on ${B_NAME}` }).click();
      const secure = sheet.locator(`[data-connector-server="${OAUTH_SERVER}"][data-kind="source"]`);
      // observed open, so no MAWS sign-in is saved for it yet; Connect finds it demanding one now (the page only declares
      // its tool, so no read has been refused: connectors-oauth.spec.ts's `needsConnect` follows a refused read)
      await quoting(expect(secure.locator('[data-connector-server-state]'), 'the OAuth server, no MAWS sign-in on B yet').toContainText(connectionWords('disconnected'), { timeout: 60_000 }), async () => `${await sheet.innerText().catch(() => '')}\n${mainSaid(again)}`);
      const mainPid = a!.app.process().pid!;
      const before = tcpListeners(mainPid);
      const afterOpens = browserOpens(openLog);
      await secure.getByRole('button', { name: S.connectLabel(OAUTH_SERVER) }).click();
      let added: string[] = [];
      await expect.poll(() => (added = addedListeners(before, tcpListeners(mainPid))).length, { timeout: 30_000, message: 'the Connect bound a callback listener in A’s main' }).toBeGreaterThan(0);
      expect(added, 'one listener').toHaveLength(1);
      const listener = loopbackPort(added[0]!);
      expect(listener, `on exactly 127.0.0.1 (lsof: ${added[0]})`).not.toBeNull();
      const followed = await followAuthorization({ openLog, afterOpens, origin: oauth!.origin, authorizeAt: AUTHORIZE_AT, timeoutMs: 60_000 }).catch(async (error: unknown) => {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${mainSaid(again)}\nB's log:\n${bLines(/connector|oauth|client/i)}`);
      });
      expect({ authorizeStatus: followed.authorizeStatus, outcome: followed.outcome, callbackStatus: followed.callbackStatus, throughA: followed.callbackPort === listener }, 'the consent’s redirect taken by A’s listener').toEqual({ authorizeStatus: 302, outcome: 'code', callbackStatus: 200, throughA: true });
      await expect.poll(() => tcpListeners(mainPid).includes(added[0]!), { timeout: 30_000, message: 'A’s listener closed at the flow’s end on B' }).toBe(false);
      await quoting(expect(secure.locator('[data-connector-server-state]'), 'connected on B').toContainText(connectionWords('connected'), { timeout: 30_000 }), async () => `${await sheet.innerText().catch(() => '')}\n${mainSaid(again)}`);
      const consented = summarizeOAuthLog(readOAuthLog(oauth!)).oauth;
      expect({ registrations: consented.registrations, authorizations: consented.authorizations, codeExchanges: consented.codeExchanges }, 'one consent, exchanged once, by B').toEqual({ registrations: 1, authorizations: 1, codeExchanges: 1 });
      const sealedOnB = join(b.userData, 'connectors', 'oauth');
      expect(existsSync(sealedOnB) ? readdirSync(sealedOnB).filter((name) => name.endsWith('.sealed')) : [], 'the grant sealed on B').toHaveLength(1);
      expect(existsSync(join(aUserData, 'connectors', 'oauth')) ? readdirSync(join(aUserData, 'connectors', 'oauth')).filter((name) => name.endsWith('.sealed')) : [], 'and nothing on A').toEqual([]);
      console.log(`[e2e:remote] M5c: Connect to B's OAuth server completed through A's loopback port ${listener}`);
      await sheet.getByRole('button', { name: 'Done' }).click();
      await expect(sheet).toHaveCount(0);

      // (b) Send to Notion from A for B's plan: B exports it and makes one page through MAWS's own instance of B's server
      await reopenLibrary();
      await openFromLibrary(plan.id, PLAN.title);
      const header = main(again).locator('[data-editor-header]');
      await header.getByRole('button', { name: 'Send to…' }).click();
      const sendTo = again.locator('[data-send-to]');
      await expect(sendTo).toHaveAttribute('data-send-to', 'notion');
      await quoting(expect(sendTo.locator('[data-send-to-connection]'), 'B’s Notion server, MAWS’s own connection there').toHaveText(/Through MAWS’s own connection: “notion” in your user settings\./, { timeout: 60_000 }), async () => `${await sendTo.innerText().catch(() => '')}\n${mainSaid(again)}`);
      const sentBefore = callsOn(mcpLog, NOTION).length;
      await sendTo.getByRole('button', { name: 'Send', exact: true }).click();
      await quoting(expect(sendTo.locator('[data-send-to-status]'), 'sent from B').toHaveText(`Sent to Notion as “${PLAN.title}”.`, { timeout: 120_000 }), async () => `${await sendTo.innerText().catch(() => '')}\n${mainSaid(again)}\nB's log:\n${bLines(/deliver|export|notion|direct/i)}`);
      const made = callsOn(mcpLog, NOTION).slice(sentBefore);
      expect(made.map((entry) => entry.tool), 'one notion-create-pages call on B').toEqual([NOTION_TOOL]);
      expect(JSON.stringify(made[0]!.arguments), 'the plan, as B exported it').toContain(TYPED_PLAN);
      console.log(`[e2e:remote] M5c: Send to Notion from A made one ${NOTION_TOOL} call on B`);
    });

    // M4: A's own checkout of the org project B's checkout belongs to, so "+ Session" in it offers B. (Added only now:
    // B's listed row then sits under that project's row, no longer under B's machine row, which the steps above read.)
    await invoke(again, 'session.projects.add', { directory: aCheckout });
    type Projects = { projects: { directory: string; org?: { key: string } }[] };
    await expect
      .poll(async () => (await invoke<Projects>(again, 'session.projects.list', undefined)).projects.find((p) => p.directory === aCheckout)?.org?.key ?? null, { timeout: 30_000 })
      .toBe(`smns:${PROJECT}`);

    // B's own lines about the spawn and the sessions it started, for a failure
    const bSaid = async () => {
      const intents = await b.request<{ intents: { appSessionId: string; location: unknown }[] }>('session.intent.list').catch((error: unknown) => String(error));
      const engines = await b.request<unknown[]>('engine.sessions').catch((error: unknown) => String(error));
      const lines = b.log().split('\n').filter((line) => /spawn|session\.(create|start|intent)|machine\.op|step-up|refus|setup|replay|endpoint/i.test(line));
      return `B's intents: ${JSON.stringify(intents)}\nB's engine sessions: ${JSON.stringify(engines)}\nB's log:\n${lines.slice(-40).join('\n')}`;
    };
    // sminos's part in a spawn (the harness's fake stands in for it, as for B's first session): B's sminos lists every
    // session on its machine, which then decides its owners' rank on it at B's endpoint; until it does, B's endpoint
    // ranks the spawner as its owner from the spine's launchedBy (P5 O12 M11). `runsOnB`: the session B's engine host
    // runs as the pinned engine session; `listSpawned` lists it then, as sminos would on its start.
    const runsOnB = async (engine: string): Promise<string> => {
      type Live = { appSessionId: string; engineSessionId: string | null };
      let spawnedApp: string | undefined;
      await expect
        .poll(async () => (spawnedApp = (await b.request<Live[]>('engine.sessions')).find((s) => s.engineSessionId === engine)?.appSessionId), {
          timeout: 120_000,
          intervals: [100],
          message: `B's engine host runs the spawned session ${engine}`,
        })
        .toBeDefined()
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await paneSaid(again)}\n${mainSaid(again)}\n${await bSaid()}`);
        });
      return spawnedApp!;
    };
    const listOnB = (engine: string, app: string, cwd: string, title: string) => scene!.sminos.list({ engine, app, owners: [scene!.member], project: PROJECT, title, cwd });
    const listSpawned = async (engine: string, cwd: string, title: string): Promise<string> => {
      const spawnedApp = await runsOnB(engine);
      await listOnB(engine, spawnedApp, cwd, title);
      return spawnedApp;
    };
    let first = '';
    await test.step('M4 and O12 M11: "+ Session" on B starts a session that opens in A’s pane before B’s sminos lists it', async () => {
      await newChat(again, A_PROJECT);
      await chooseMachine(again, B_NAME);
      await composerOf(again).click();
      await again.keyboard.type(SPAWN_BRIEF);
      await again.keyboard.press('Enter');
      const spawnedApp = await runsOnB(SPAWNED_SESSION);
      // Nothing listed on B: B's endpoint ranks A's member as the spawner (the bridge), so the pane opens the session and
      // never gives up with "can't place"; a waiting line it shows before B's engine host runs the session clears unlisted
      let gaveUp = false;
      let watching = true;
      const watch = (async () => {
        while (watching) {
          if ((await main(again).getByText(CANT_PLACE(B_NAME)).count().catch(() => 0)) > 0) gaveUp = true;
          await again.waitForTimeout(250).catch(() => (watching = false));
        }
      })();
      try {
        first = await movedTo(again, b.ref, address, bSaid); // the pane showed B’s first session before the New chat tab
      } finally {
        watching = false;
        await watch;
      }
      expect(gaveUp, `the pane never said it can't place the session\n${await paneSaid(again)}`).toBe(false);
      await expect(main(again).getByText(LISTING_WAIT(B_NAME)), `no waiting line once the session opened, nothing listed on B\n${await paneSaid(again)}`).toHaveCount(0);
      expect(bareOf(first), 'the tab moved to the session B started').toBe(spawnedApp);
      // B's sminos records it later with the spawner as owner (its M11 record), and the record taking over changes nothing
      await listOnB(SPAWNED_SESSION, spawnedApp, checkout, 'B’s spawned session');
      await expect(main(again).getByText(SPAWN_REPLY).first(), `the new session's reply in A's pane\n${mainSaid(again)}\nB's log:\n${b.log().slice(-3000)}`).toBeVisible({ timeout: 60_000 });
      expect(JSON.stringify(await writtenOn(bareOf(first))), 'B’s new session was written the brief').toContain(SPAWN_BRIEF);
      type Spawned = { directory: string; launchedBy?: { member: string } };
      const record = await b.request<Spawned | null>('session.get', { appSessionId: bareOf(first) });
      expect(record?.directory, 'started in B’s checkout').toBe(checkout);
      expect(record?.launchedBy?.member, 'the requester recorded on B’s session').toBe(scene!.member);
    });

    await test.step('M4: "+ Session" on B in a new worktree with a dropped file: the file goes up under the worktree, then one message names it', async () => {
      const tab = await newChat(again, A_PROJECT);
      await chooseMachine(again, B_NAME);
      // the box shows the intent's location, so it holds checked once main's patch of the intent is back
      const worktreeBox = again.locator('[data-project-row]').getByRole('checkbox', { name: 'Worktree' });
      await worktreeBox.click();
      await expect(worktreeBox).toBeChecked({ timeout: 30_000 });
      type Intents = { intents: { appSessionId: string; location: { kind: string; name?: string } | null }[] };
      let name: string | undefined;
      await expect
        .poll(async () => {
          const location = (await invoke<Intents>(again, 'session.intent.list', undefined)).intents.find((i) => i.appSessionId === tab)?.location;
          return (name = location?.kind === 'newWorktree' ? location.name : undefined);
        }, { timeout: 30_000 })
        .toBeDefined();
      const worktree = join(checkout, '.claude', 'worktrees', worktreeDirName(name!));
      const inWorktree = new SideJournal(WORKTREE_SESSION, worktree);
      inWorktree.turn(WORKTREE_REPLY);
      expect(inWorktree.write(journals, 'b-spawned-worktree')).toBe(worktreeFixture);

      await composerOf(again).click();
      await dropTextFile(again, WORKTREE_FILE);
      await again.keyboard.type(WORKTREE_TEXT);
      await again.keyboard.press('Enter');
      const worktreeApp = await listSpawned(WORKTREE_SESSION, worktree, 'B’s worktree session');
      const second = bareOf(await movedTo(again, b.ref, first, bSaid));
      expect(second, 'the tab moved to the session B started').toBe(worktreeApp);
      await expect(main(again).getByText(WORKTREE_REPLY).first(), `the worktree session's reply in A's pane\n${mainSaid(again)}\nB's log:\n${b.log().slice(-3000)}`).toBeVisible({ timeout: 120_000 });
      type Spawned = { worktree: { path: string } | null };
      expect((await b.request<Spawned | null>('session.get', { appSessionId: second }))?.worktree?.path, 'B’s session runs in the new worktree').toBe(worktree);
      const written = await writtenOn(second);
      expect(written, 'one message, the first the session was written').toHaveLength(1);
      expect(JSON.stringify(written)).toContain(WORKTREE_TEXT);
      const mention = uploadMention(written[0], second);
      expect(mention, `the message names the upload's path on B: ${JSON.stringify(written)}`).not.toBeNull();
      expect(readFileSync(join(worktree, mention!), 'utf8'), 'the path, from the worktree, holds the dropped bytes').toBe(WORKTREE_FILE.content);
      expect(uploadedFiles(worktree, second), 'under the worktree’s desk-uploads').toHaveLength(1);
    });

    // M6: B's own session, started on B as B's owner starts one (its journal the last on B's replay list), which A has
    // no tab of and no record of; sminos lists it, sharing it with A's member, and the endpoint's attention feed then
    // says what waits on it.
    let waitingApp = '';
    let waitingAddress = '';
    const waitingTurnOver = async () => (await b.request<{ turn: unknown }>('session.status', { appSessionId: waitingApp })).turn === null;
    const waitingComposer = () => main(again).locator(`[data-composer="${waitingAddress}"]`);
    await test.step('M6: a permission B’s session asks with no tab of it on A shows in Needs you under its listed row and in the dock badge; ⌘⇧J opens it in A’s pane, and the answer there clears both', async () => {
      await showProjectList(again);
      await expect.poll(() => dockBadge(againApp), { timeout: 30_000, message: 'nothing waits before B asks' }).toBe('');
      waitingApp = (await b.request<{ appSessionId: string }>('session.create', { projectId: project.id, location: null })).appSessionId;
      waitingAddress = addressOf(b.ref, waitingApp);
      await b.request('session.intent.patch', { appSessionId: waitingApp, patch: { gateway: 'direct' } });
      const begun = await b.request<{ status: string }>('session.start', { appSessionId: waitingApp, message: { content: WAITING_ASK, display: WAITING_ASK }, options: {} });
      expect(begun.status, `B's session starts: ${JSON.stringify(begun)}`).not.toBe('needs_trust');
      await scene!.sminos.list({ engine: WAITING_SESSION, app: waitingApp, owners: [scene!.member], project: PROJECT, title: WAITING_TITLE, cwd: checkout });
      // With no record of A's the listed row stands in: the row reads B's name for its project and the listing's title.
      const row = needsYouRow(again, waitingAddress);
      await quoting(expect(row, 'B’s permission in A’s Needs you').toHaveAccessibleName(`${B_NAME} · ${WAITING_TITLE} · Approval needed`, { timeout: 60_000 }), async () => `${mainSaid(again)}\n${await bSaid()}`);
      await expect(needsYouCount(again, 1)).toBeVisible();
      await expect.poll(() => dockBadge(againApp), { timeout: 30_000, message: 'the dock badge counts it' }).toBe('1');
      // ⌘⇧J is the menu item's chord; the item is clicked in main, since a menu accelerator never reaches the menu
      // through Playwright's keys (support/menu.ts)
      expect(await againApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('attention.next')?.accelerator ?? null)).toBe('Cmd+Shift+J');
      await menu(againApp, 'attention.next');
      await quoting(expect(waitingComposer(), '⌘⇧J opens B’s session in A’s pane').toBeVisible({ timeout: 60_000 }), async () => `${await paneSaid(again)}\n${mainSaid(again)}`);
      const card = main(again).getByRole('group', { name: 'Approval needed' });
      await expect(card, 'the permission card in A’s pane').toBeVisible({ timeout: 60_000 });
      await expect(card).toContainText(`echo ${WAITING_FIRST}`);
      await card.getByRole('radio', { name: 'Allow once' }).click();
      await card.getByRole('button', { name: 'Allow', exact: true }).click();
      await expect(card).toBeHidden({ timeout: 30_000 });
      await quoting(expect(main(again).getByText(WAITING_REPLY).first(), 'the turn goes on on B').toBeVisible({ timeout: 60_000 }), () => b.log().slice(-3000));
      await expect(row, 'answered: gone from Needs you').toHaveCount(0, { timeout: 30_000 });
      await expect.poll(() => dockBadge(againApp), { timeout: 30_000, message: 'answered: gone from the dock badge' }).toBe('');
      await expect.poll(waitingTurnOver, { timeout: 30_000 }).toBe(true);
      // its tab closed again, for its second ask
      await menu(againApp, 'tab.close');
      await expect(waitingComposer(), 'B’s session’s tab closed').toHaveCount(0, { timeout: 30_000 });
      console.log(`[e2e:remote] M6: B's permission (${waitingAddress}) in Needs you and the badge, opened by ⌘⇧J, answered in A's pane, both cleared`);
    });

    await test.step('M6: conversation search finds a word of B’s transcript, its hit under B', async () => {
      // B's owner names B's first session as sminos lists it, so its title (its first prompt until now) holds no
      // SEARCHED: B's index answers it from the transcript's text, with a snippet
      await b.request('session.update', { appSessionId: app, patch: { title: { text: TITLE, source: 'user' } } });
      type Searched = { hits: { appSessionId: string; snippet: string | null }[]; indexing: boolean; incomplete: boolean };
      let onB: Searched | null = null;
      await quoting(
        expect
          .poll(async () => {
            onB = await b.request<Searched>('session.search', { query: SEARCHED });
            return (onB.hits.find((hit) => hit.appSessionId === app)?.snippet ?? '').toLowerCase().includes(SEARCHED);
          }, { timeout: 60_000, message: 'B’s own index finds the word in its first session’s transcript' })
          .toBe(true),
        () => `B's own search answered: ${JSON.stringify(onB)}`,
      );
      const field = sidebarOf(again).getByRole('searchbox', { name: 'Search projects and sessions' });
      await field.fill(SEARCHED);
      await sidebarOf(again).getByRole('button', { name: `Search in conversations for ‘${SEARCHED}’`, exact: true }).click();
      const palette = again.getByRole('dialog', { name: 'Command palette' });
      await expect(palette).toBeVisible();
      // B's hits are a group headed by B's name once a machine other than this Mac has any; its wrapper names B's ref
      const underB = palette.getByRole('group', { name: B_NAME, exact: true });
      await quoting(expect(underB.getByRole('option').filter({ hasText: SEARCHED }), 'the hit under B').toHaveCount(1, { timeout: 60_000 }), async () => `the palette: ${await palette.innerText().catch(() => '')}\n${mainSaid(again)}`);
      expect(await underB.evaluate((el) => el.closest('[data-search-machine]')?.getAttribute('data-search-machine') ?? null), 'the group is B’s').toBe(b.ref);
      console.log(`[e2e:remote] M6: search for "${SEARCHED}" found under B: ${(await underB.getByRole('option').filter({ hasText: SEARCHED }).innerText()).replace(/\s+/g, ' ')}`);
      await again.keyboard.press('Escape');
      await expect(palette).toHaveCount(0);
      await field.fill('');
    });

    await test.step('M6: B’s daemon stopped greys what its session asks with its tab closed, and the dock badge drops', async () => {
      await b.request('session.send', { appSessionId: waitingApp, content: WAITING_AGAIN });
      const row = needsYouRow(again, waitingAddress);
      await quoting(expect(row, 'the second ask in A’s Needs you').toHaveAccessibleName(/ · Approval needed$/, { timeout: 60_000 }), async () => `${mainSaid(again)}\n${await bSaid()}`);
      await expect(needsYouCount(again, 1)).toBeVisible();
      await expect.poll(() => dockBadge(againApp), { timeout: 30_000, message: 'the second ask counts in the dock badge' }).toBe('1');
      const stoppedAt = Date.now();
      await b.stop();
      // main greys a machine's items at its link's `down`: drawn after the live rows, out of the count and the badge
      await quoting(expect(row, 'greyed once B is gone').toHaveAttribute('data-greyed', 'true', { timeout: 60_000 }), async () => `B on A: ${JSON.stringify(await machineOf(again, b.ref))}\n${mainSaid(again)}`);
      await expect(row).toHaveAccessibleName(/ · Approval needed, machine offline$/);
      await expect(needsYouCount(again, 0)).toBeVisible();
      await expect.poll(() => dockBadge(againApp), { timeout: 30_000, message: 'a greyed item leaves the dock badge' }).toBe('');
      console.log(`[e2e:remote] M6: B's item greyed and out of the badge ${Date.now() - stoppedAt} ms after B's daemon was told to stop`);
    });
  } finally {
    await a?.cleanup();
    await scene?.stop();
    await oauth?.close(); // M5c
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
