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
import { machineProjectId } from '../src/shared/machine/project-ids'; // the UX wave, U9: a plain folder's project, as sminos derives it
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
import { applicationOf, launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { menu } from './support/menu';
import { startRemoteScene, B_NAME, type RemoteScene } from './support/remote-scene';
import type { PlaneRow } from './support/fake-sminos'; // 2026-11-06
import { answered, BUTTON, FIELD, startPages } from './support/headless-browser'; // P5 O17 M10
import { connectorControl, writeCuaEngine, type ConnectorControl } from '../test/support/cua-engine'; // P5 O17 M10
import { activeMainTab, backToTabs, hideSurface, mainTabById, mainTabs, moveSideTab, openSurface, sessionCard, showSessionCards, sideColumn, sideGroup, sideTab, surface } from './support/shell';
import { backgroundAgentRecords, backgroundBashRecords, turnEndRecords, userRecord } from './support/lane-a'; // UX wave U8b M9
import { seedTranscript, SIDE_QUESTION, SideJournal, slugOf, transcript } from './support/side-replay';
import { newChatIn, openProject, projectLine, projectRow, showProjectList, sidebarOf } from './support/sidebar';
import { clickRevealed } from './support/hover'; // P5 O7 M8
import { REMOTE_UNAVAILABLE } from '../src/shared/ipc/remote-unavailable'; // P5 O7 M8
import { withNativeClipboard } from './support/clipboard'; // the UX wave, U9 (A4)
import { remoteSessionActions, SESSION_ACTIONS } from '../src/renderer/src/app/session-actions'; // the UX wave, U9 (the architect's ruling of 2026-11-13)

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
// A row of the sidebar expanded (read back until it holds: a restored layout may expand it under the click): a machine's
// row (T3: another machine's sessions whose project is listed nowhere, design §12's `known` included), or a registry
// project's row, keyed by main's key table (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §J.1: a project with a declared location on some machine is a row here, though this Mac has no checkout of
// it); and the row of a session at `address` in it: its listed row, or its record's once main said it (one row per address).
const machineRow = (page: Page, ref: MachineRef) => sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:machine:${ref}"]`);
async function expandSidebarRow(page: Page, row: ReturnType<typeof machineRow>): Promise<void> {
  await showProjectList(page);
  await expect(async () => {
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.locator('[data-project-line]').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}
const expandMachine = (page: Page, ref: MachineRef) => expandSidebarRow(page, machineRow(page, ref));
async function expandRegistryProject(page: Page, id: string): Promise<void> {
  const keyOf = async () => (await invoke<{ keys: Record<string, string> }>(page, 'org.projects', undefined)).keys[id] ?? null; // never changes once given
  await expect.poll(keyOf, { timeout: 60_000, message: `project ${id} has a row key in A's main\n${mainSaid(page)}` }).not.toBeNull();
  await expandSidebarRow(page, sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:${(await keyOf())!}"]`));
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
        root: '/tmp', // P5 O17 M10: the session's cua socket within a Unix socket's bound (the runner's tmpdir is long)
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

    // The row in A's sidebar, under its project's row: B's checkout is declared on B and its `.smns` names PROJECT, so
    // B's projects record lists the project and A has a row of it (the project registry, Interfaces §J.1); its hover
    // names B's carrier; a click opens it in A's pane, which reads B's history over the link.
    await keepBatches(page);
    await expandRegistryProject(page, PROJECT);
    const row = sessionRow(page, address);
    await expect(row, `B's row in A's sidebar\n${mainSaid(page)}`).toBeVisible({ timeout: 30_000 });
    await hoverMachineLine(page, row, `${B_NAME} · via the hub`);
    // UX wave U7a (O-38 with #559, O-16; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
    // M4; A2, A3): the row, only listed here, opens as a local row does. Its menu begins Open, Open in new tab, Hide (then
    // Share and Add owner where the row has them); ⌘-click opens it through lane B's opener in a tab of its own, which
    // comes to the front as a local row's ⌘-click does; Hide puts it under its project's "Hidden · 1" and the tab stays.
    // Unhide brings the row back for the steps below.
    await test.step('UX wave U7: the listed row’s menu, ⌘-click to a tab of its own, Hide and Unhide', async () => {
      await expect(row, 'only listed: A holds no record of it yet').toHaveAttribute('data-kind', 'listed');
      // its project's key, from the project row that holds it (`has` is matched inside each project row, so it names the
      // row by its tree id alone)
      const projectKey = (await sidebarOf(page).locator('[data-kind="project"]', { has: page.locator(`[data-tree-id="s:${address}"]`) }).getAttribute('data-tree-id'))!.slice('p:'.length);
      const hidden = sidebarOf(page).locator(`[data-tree-id="hidden:${projectKey}"]`);
      await row.click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();
      const items = await page.getByRole('menuitem').allTextContents();
      expect(items.slice(0, 3), 'a listed row’s menu: its two opens, then Hide').toEqual(['Open', 'Open in new tab', 'Hide']);
      // after Hide, U9's acts over the link for a lane B listing that is yours, in their order, then Share and Add owner
      const acts = remoteSessionActions({ lane: 'B', record: false, mine: true, remoteReading: true }).map((id) => SESSION_ACTIONS[id]);
      expect(items.slice(3).filter((item) => item !== 'Share…' && item !== 'Add owner…'), 'after Hide, the acts over the link (U9) and nothing else but Share and Add owner').toEqual(acts);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);

      // First a tab a plain open would replace: Diagnostics, unpinned and in front of the one strip (U13a). A plain open
      // (`replaceActive`) would give its place to the session; only a tab of its own keeps both. On this fresh profile the
      // strip is otherwise empty, where the two opens could not be told apart.
      type StoredMain = { current: string; sets: Record<string, { panes: { tabs: { id: string }[] }[] }> };
      const storedTabs = async () => {
        const stored = (await invoke<{ value: StoredMain | null }>(page, 'layout.get', { key: 'main.tabs' })).value;
        return Object.values(stored?.sets ?? {}).flatMap((set) => set.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id))).sort();
      };
      await menu(applicationOf(page), 'diagnostics.open');
      await expect(activeMainTab(page), 'a replaceable tab in front: Diagnostics').toHaveAttribute('data-tab-id', 'diagnostics');
      await expect(mainTabById(page, 'diagnostics').getByRole('img', { name: 'Pinned' }), 'unpinned').toHaveCount(0);
      await expect.poll(storedTabs, { message: 'Diagnostics stored in the strip' }).toContain('diagnostics');
      await expect(row, 'still only listed').toHaveAttribute('data-kind', 'listed');

      const tabIds = () => mainTabs(page).locator('[role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id')));
      const before = await tabIds();
      await row.click({ modifiers: ['Meta'] });
      const added = async () => (await tabIds()).filter((id) => !before.includes(id));
      await expect.poll(added, { timeout: 60_000, message: `⌘-click adds a tab of its own\n${mainSaid(page)}` }).toEqual([`session:${address}`]);
      expect(await tabIds(), 'and keeps every tab it found, Diagnostics among them').toEqual(expect.arrayContaining(before));
      const opened = await tabIds();
      await expect(activeMainTab(page), 'the new tab is in front').toHaveAttribute('data-tab-id', `session:${address}`);
      await expect.poll(storedTabs, { message: 'both tabs stored in the strip' }).toEqual(expect.arrayContaining(['diagnostics', `session:${address}`]));
      await expect(main(page).getByText(FIRST_REPLY).first(), `B's history in the new tab\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });

      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Hide', exact: true }).click();
      await expect(row, 'hidden: out of its project’s list').toHaveCount(0);
      await expect(hidden).toHaveText('Hidden · 1');
      await expect(hidden).toHaveAttribute('aria-expanded', 'false');
      await expect(mainTabById(page, `session:${address}`), 'its tab stays, in front').toHaveAttribute('aria-selected', 'true');
      expect(await tabIds(), 'no tab closed or opened').toEqual(opened);

      await hidden.click();
      await expect(row, 'under the Hidden row, indented').toHaveAttribute('data-indented', 'true');
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Unhide', exact: true }).click();
      await expect(hidden).toHaveCount(0);
      await expect(row).toBeVisible();
      await expect(row).not.toHaveAttribute('data-indented', 'true');
      await mainTabById(page, 'diagnostics').click({ button: 'middle' }); // the steps below meet the strip as before: B's session alone
      await expect(mainTabById(page, 'diagnostics')).toHaveCount(0);
    });
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
    // P5 O7 M10 (a busy remote session's state): mid-turn, its tab open here, A holds its record with no digest, and the
    // row reads B's listing. sminos's observer restates the session busy at its turn's start; the scene plays that.
    const listing = { engine: B_SESSION, app, owners: [scene.member], project: PROJECT, title: TITLE, cwd: checkout };
    await scene.sminos.list({ ...listing, state: 'busy' });
    await expect(row.getByRole('img', { name: 'Working', exact: true }), `B's row reads Working mid-turn, from its listing\n${mainSaid(page)}`).toBeVisible({ timeout: 30_000 });
    await b.request('session.getContextUsage', { appSessionId: app, detail: 'summary' }); // lets B's engine go on
    await expect(main(page).getByText(SECOND_REPLY).first(), 'the whole reply in A’s pane').toBeVisible({ timeout: 60_000 });
    const onA = await batchedEvents(page, b.ref, app);
    const deltas = onA.filter((e): e is Extract<SessionEvent, { kind: 'assistant.block.delta' }> => e.kind === 'assistant.block.delta');
    const onB = (await b.request<{ events: SessionEvent[] }>('session.events', { appSessionId: app, afterSeq: null, limit: null })).events;
    const batchIds = [...new Set((await keptBatches(page)).map((k) => `${k.machine ?? 'this Mac'}: ${k.appSessionId}`))];
    const said = () => `A's batches for ${address}: ${onA.map((e) => e.kind).join(', ')}\nthe sessions A's batches named: ${batchIds.join(', ')}\nB's events: ${onB.map((e) => e.kind).join(', ')}`;
    expect(deltas.map((e) => e.textDelta), `the reply streamed to A as its deltas\n${said()}`).toEqual(SECOND_DELTAS);
    await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);
    await scene.sminos.list({ ...listing, state: 'idle' }); // the turn over, restated idle
    await expect(row.getByRole('img', { name: 'Idle', exact: true }), `B's row reads Idle once its listing does\n${mainSaid(page)}`).toBeVisible({ timeout: 30_000 });

    // A permission B's engine asks for, answered in A's pane: the replay goes on only on the `allow` it holds at.
    await composerOf(page).click();
    await page.keyboard.type(THIRD);
    await page.keyboard.press('Enter');
    const card = main(page).getByRole('group', { name: 'Approval needed' });
    await expect(card, `the permission card in A's pane\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(`echo ${APPROVED}`);
    await card.getByRole('button', { name: 'Allow once', exact: true }).click();
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
      // UX wave U8b: one tab is in view per group, so Source control came into view in Files' place; moved below, it is
      // the lower group's, and Files, the tab it left, is in view above it
      await moveSideTab(page, 'Source control', 'below');
      await expect(sideGroup(page, 'lower')).toHaveAttribute('aria-label', 'Source control');
      await expect(sideGroup(page, 'upper')).toHaveAttribute('aria-label', 'Files');
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
    await expandRegistryProject(again, PROJECT); // under its project's row, as in the first launch
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
      // UX wave U7b (O-40): Open library opened the library as a page beside the sidebar; its Back shows the session's tab
      // again (the strip is inert under a page, so the tab is not clicked)
      await backToTabs(again);
      await expect(sessionTab).toHaveAttribute('aria-selected', 'true');
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

      // The session's agent has a browser on B, seen from here by screencast (P5 O17's local stage, §I): B's own front reads
      // it, A's main answers it for B's session over the link (M5a's capability read), and A's Browser tool shows the
      // agent's group on B with no tab, since this session's replayed engine opens none (P5 O17 M10), never the notice
      await sessionTab.click();
      type Capabilities = { browser?: { available: boolean; reason?: string; viewed?: string } };
      const SCREENCAST = { available: true, viewed: 'screencast' };
      const browserOnB = (await b.request<Capabilities>('session.capabilities', { appSessionId: app })).browser;
      expect(browserOnB, 'B’s session’s agent has a browser on B, seen by screencast').toEqual(SCREENCAST);
      await expect.poll(async () => (await invoke<Capabilities>(again, 'session.capabilities', { appSessionId: app }, b.ref)).browser, { timeout: 30_000, message: 'A’s main reads B’s answer' }).toEqual(SCREENCAST);
      await openSurface(again, 'Browser');
      const browserTool = surface(again, 'browser');
      await expect(browserTool.locator('[data-browser-agent-group]'), `the agent’s group on B\n${mainSaid(again)}`).toContainText(`Agent on ${B_NAME}`, { timeout: 30_000 });
      await expect(browserTool.locator('[data-browser-agent-status]'), 'no agent tab yet').toHaveText('No agent browser tabs', { timeout: 30_000 });
      await expect(browserTool.locator('[data-browser-agent-unavailable]')).toHaveCount(0);
      console.log('[e2e:remote] M5a: the Browser tool shows the agent’s browser on B, no tab yet');
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
      await quoting(expect(secure.locator('[data-connector-server-state]'), 'the OAuth server, no MAWS sign-in on B yet').toContainText(connectionWords('none'), { timeout: 60_000 }), async () => `${await sheet.innerText().catch(() => '')}\n${mainSaid(again)}`);
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
      // M5c review 1: B's rows are read again only at the owner's Refresh (each a confirmation on B, as Show was); the
      // Connect's own events marked them stale. Pressed while the mark shows, so an event after a read is read too.
      const refresh = sheet.getByRole('button', { name: `Refresh the connectors on ${B_NAME}` });
      await expect(sheet.locator('[data-connectors-servers-stale]'), 'B’s rows marked stale by the Connect').toBeVisible({ timeout: 30_000 });
      await quoting(
        expect
          .poll(
            async () => {
              if (await refresh.isVisible()) await refresh.click();
              return (await secure.locator('[data-connector-server-state]').textContent()) ?? '';
            },
            { timeout: 30_000, intervals: [1_000], message: 'connected on B, read at Refresh' },
          )
          .toContain(connectionWords('connected')),
        async () => `${await sheet.innerText().catch(() => '')}\n${mainSaid(again)}`,
      );
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
      await sendTo.getByRole('button', { name: 'Done' }).click(); // the sheet is modal: M4's steps after this use the sidebar
      await expect(sendTo).toHaveCount(0);
    });

    // M4: A's own checkout of the org project B's checkout belongs to, so "+ Session" in it offers B. (Added only now, so
    // the steps above show B's project listed by B's declared checkout alone; the row keeps its key, a key table's entry
    // never changing, Interfaces §I.)
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
      await card.getByRole('button', { name: 'Allow once', exact: true }).click();
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

    await test.step('M6: B’s daemon stopped keeps what its session asks with its tab closed counted while B reconnects, then greys it and the dock badge drops', async () => {
      await b.request('session.send', { appSessionId: waitingApp, content: WAITING_AGAIN });
      const row = needsYouRow(again, waitingAddress);
      await quoting(expect(row, 'the second ask in A’s Needs you').toHaveAccessibleName(/ · Approval needed$/, { timeout: 60_000 }), async () => `${mainSaid(again)}\n${await bSaid()}`);
      await expect(needsYouCount(again, 1)).toBeVisible();
      await expect.poll(() => dockBadge(againApp), { timeout: 30_000, message: 'the second ask counts in the dock badge' }).toBe('1');
      const stoppedAt = Date.now();
      await b.stop();
      // The UX wave, U9 (the architect's ruling of 2026-11-13): main greys a machine's items by its phase, the window's
      // one rule (src/shared/machine/link-phase.ts): for the minute B's link reconnects the item stays live, in the count
      // and the dock badge, its row saying so (sidebar/NeedsYou.tsx); past it, greyed, after the live rows, out of both
      await quoting(expect(row, 'while B reconnects').toHaveAccessibleName(/ · Approval needed, reconnecting$/, { timeout: 60_000 }), async () => `B on A: ${JSON.stringify(await machineOf(again, b.ref))}\n${mainSaid(again)}`);
      await expect(row, 'not greyed while B reconnects').not.toHaveAttribute('data-greyed', 'true');
      await expect(needsYouCount(again, 1), 'counted while B reconnects').toBeVisible();
      expect(await dockBadge(againApp), 'in the dock badge while B reconnects').toBe('1');
      const down = await machineOf(again, b.ref);
      const offlineAt = Date.parse(down?.since ?? new Date(stoppedAt).toISOString()) + REMOTE_ACT_PENDING_MS;
      expect(Date.now(), 'the reconnecting reads were made inside the minute').toBeLessThan(offlineAt);
      await quoting(expect(row, 'past the minute, greyed').toHaveAttribute('data-greyed', 'true', { timeout: Math.max(0, offlineAt - Date.now()) + 15_000 }), async () => `B on A: ${JSON.stringify(await machineOf(again, b.ref))}`);
      await expect(row, 'past the minute, offline').toHaveAccessibleName(/ · Approval needed, machine offline$/);
      await expect.poll(() => dockBadge(againApp), { timeout: 30_000, message: 'a greyed item leaves the dock badge' }).toBe('');
      console.log(`[e2e:remote] M6: B's item counted while B reconnected, greyed and out of the badge ${Date.now() - stoppedAt} ms after B's daemon was told to stop`);
      await expect(needsYouCount(again, 0), 'still out of the count').toBeVisible();
      expect(await dockBadge(againApp), 'and of the badge').toBe('');
    });
  } finally {
    await a?.cleanup();
    await scene?.stop();
    await oauth?.close(); // M5c
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// P5 O17 M10 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M10's Proves): the agent's browser on B, seen and
// driven from A's Browser tool. B runs no app: its sessions' engine is the cua engine stub coming ready
// (test/support/cua-engine.ts), started through the ordinary start path, whose connector plays cua's host and drives
// cua's creation sequence against a page B serves on its loopback (e2e/support/headless-browser.ts's `/remote`), so the
// tab is a headless one in B's render host. A opens B's session from its listed row and the Browser tool shows the
// agent's group on B; then, in order:
//   - A sees the tab and its pixels under `view` (it owns the session), and only this session's: B's second session holds
//     the identical page, which A's view does not list, and a select naming that tab is refused (`unknown`) with no frame
//     of it reaching A's window, A's own stream going on;
//   - after Take control, A's click on the page's button changes B's page and the next frame shows it, and what A types
//     reaches B's field once; A's Enter submits a form and breaks a text area's line (the producer's character event);
//     given back, A's clicks and keys reach nothing;
//   - the Browser tool hidden closes its view (its feed and stream), not B's tab, and shown again opens a new one;
//   - B's app arriving mid-lease (the connector holds its tab's debugger) closes A's stream `engine-changed`; the agent's
//     next tab is the app's, and A then views it.
// Held below e2e level, by the architect's two rulings in the Decision Log: a `view`-only member, a non-owner's step-up
// and a revocation ("the remote Browser view's shape": the fake sminos has one member; endpoint and lane-B units over the
// real authorizer); a slow carrier's one frame plus 4 KiB (M9a's endpoint backlog test) and a peer without
// `rl2.browser-screencast` (M9a's device `not-offered` test and the view's unsupported words,
// src/renderer/src/tools/browser/remote/View.test.tsx), the entry of 2026-11-03: the scene has no carrier throttling and
// `e2e:remote` pairs no builds.
const BROWSER_PROJECTS = ['e2e-remote-browser', 'e2e-remote-browser-other'];
const BLANK_AT = { x: 900, y: 600 }; // a point of `/remote` nothing is drawn at, in the viewport's DIP
// a form of one field and a text area the agent adds to B's `/remote` (step 3), in the viewport's DIP
const FORM_FIELD = { x: 40, y: 220, width: 200, height: 30 } as const;
const AREA = { x: 40, y: 270, width: 200, height: 60 } as const;
const centre = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

// A viewport point of the agent's tab A shows, as client coordinates through its canvas's fitted image
function remotePoint(page: Page, at: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y]) => {
    const box = document.querySelector<HTMLElement>('[data-browser-view="panel"] [data-remote-browser]')!;
    const canvas = box.querySelector('canvas')!;
    const [vw, vh] = box.dataset.remoteViewport!.split('x').map(Number) as [number, number];
    const r = canvas.getBoundingClientRect();
    const scale = Math.min(r.width / canvas.width, r.height / canvas.height);
    const left = r.left + (r.width - canvas.width * scale) / 2;
    const top = r.top + (r.height - canvas.height * scale) / 2;
    return { x: left + (x / vw) * canvas.width * scale, y: top + (y / vh) * canvas.height * scale };
  }, [at.x, at.y] as const);
}

// The colour A's canvas holds at a viewport point of the shown tab, or null before a frame
function remotePixel(page: Page, at: { x: number; y: number }): Promise<number[] | null> {
  return page.evaluate(([x, y]) => {
    const box = document.querySelector<HTMLElement>('[data-browser-view="panel"] [data-remote-browser]');
    const canvas = box?.querySelector('canvas');
    if (!box?.dataset.remoteViewport || !canvas || canvas.width === 0) return null;
    const [vw, vh] = box.dataset.remoteViewport.split('x').map(Number) as [number, number];
    const data = canvas.getContext('2d')!.getImageData(Math.floor((x / vw) * canvas.width), Math.floor((y / vh) * canvas.height), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!];
  }, [at.x, at.y] as const);
}
const isWhite = (rgb: number[] | null) => rgb !== null && rgb.every((c) => c > 200);
const isClicked = (rgb: number[] | null) => rgb !== null && rgb[0]! > 150 && rgb[1]! < 100 && rgb[2]! < 100; // CLICKED_RGB through JPEG

test('O17 M10: the agent’s tab on B, which runs no app, seen and driven from A’s Browser tool; another session’s tab unreachable; a hidden tool closes its view, not the tab; B’s app arriving mid-lease moves A to the app’s tab', async () => {
  test.setTimeout(600_000);
  const root = realpathSync(mkdtempSync('/tmp/mrv-')); // short: the connectors' control sockets are in the sessions' directories
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-'));
  const repos = [join(root, 'r0'), join(root, 'r1')];
  for (const repo of repos) mkdirSync(repo);
  const bin = writeCuaEngine(join(root, 'cua-engine'), { ready: true, retry: true, control: true, lifeMs: 600_000 });
  const pages = await startPages();
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  const bApp: { launch: MawsLaunch | null } = { launch: null }; // set inside a step, so held where the finally sees it
  try {
    scene = await startRemoteScene({
      scratch: join(root, 'scene'),
      aUserData,
      b: {
        root: '/tmp', // B's app (the last step) keeps its cua sockets under B's profile
        env: { MAWS_E2E_ENGINE_BIN: bin },
        prepare: ({ claudeConfigDir }) => {
          writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: Object.fromEntries(repos.map((repo) => [repo, { hasTrustDialogAccepted: true }])) }));
          writeFileSync(join(claudeConfigDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }));
        },
      },
    });
    const { b } = scene;
    const listed = scene;
    await b.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    // B's sessions, through the ordinary start path, each listed through sminos in a project of its own
    type Status = { process: string; turn: unknown; pid: number | null; engineSessionId: string | null };
    const startOnB = async (repo: string, project: string, title: string): Promise<string> => {
      const added = await b.request<{ id: string }>('session.projects.add', { directory: repo });
      const { appSessionId } = await b.request<{ appSessionId: string }>('session.create', { projectId: added.id, location: { kind: 'directory', path: repo } });
      const started = await b.request<{ status: string }>('session.start', { appSessionId, message: { content: 'o17 m10', display: 'o17 m10' }, options: { gateway: 'direct' } });
      expect(started.status, `B's session starts (${JSON.stringify(started)})`).toBe('starting');
      let engine: string | null = null;
      await expect
        .poll(async () => {
          const st = await b.request<Status>('session.status', { appSessionId }).catch(() => null);
          engine = st?.engineSessionId ?? null;
          return st !== null && st.process === 'ready' && st.turn === null && st.pid !== null && engine !== null;
        }, { timeout: 60_000, message: `${appSessionId}'s engine ready on B, its first turn ended\n${b.log().slice(-3000)}` })
        .toBe(true);
      await listed.sminos.list({ engine: engine!, app: appSessionId, owners: [listed.member], project, title, cwd: repo });
      return appSessionId;
    };
    const connectorIn = async (repo: string): Promise<ConnectorControl> => {
      let control: ConnectorControl | null = null;
      await expect.poll(async () => (control = await connectorControl(repo).catch(() => null)) !== null, { timeout: 30_000, message: `the connector in ${repo} listens on its control socket` }).toBe(true);
      return control!;
    };
    const app = await startOnB(repos[0]!, BROWSER_PROJECTS[0]!, 'B’s browsing session');
    const other = await startOnB(repos[1]!, BROWSER_PROJECTS[1]!, 'B’s other session');
    const address = addressOf(b.ref, app);
    // the agent's tab in each, against B's loopback; the first session's connector keeps its lease (its debugger attached)
    const cua = await connectorIn(repos[0]!);
    const cuaOther = await connectorIn(repos[1]!);
    const created = await answered('the agent’s creation sequence on B', cua.sequence(pages.url('/remote')));
    await answered('the other session’s, of the same page', cuaOther.sequence(pages.url('/remote')));
    type Render = { render?: { browserSessions?: number; browserTabs?: number } };
    expect((await b.request<Render>('daemon.status')).render, 'B’s render host holds both sessions’ tabs').toMatchObject({ browserSessions: 2, browserTabs: 2 });
    const onB = async (expression: string): Promise<unknown> => {
      const answer = await cua.call<{ result: { value: unknown } }>('debugger.sendCommand', { debuggee: { tabId: created.tabId }, method: 'Runtime.evaluate', params: { expression, returnByValue: true }, timeoutMs: 3_000 });
      if (!answer.ok) throw new Error(answer.error);
      return answer.result.result.value;
    };

    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(true), MAWS_MACHINE_NAME: 'A', MAWS_E2E_STEP_UP: 'accept' } });
    keepMainLines(a);
    const page = a.page;
    await expect
      .poll(async () => (await machineOf(page, b.ref))?.state ?? null, { timeout: 60_000, message: `A's link to B comes up\n${mainSaid(page)}` })
      .toBe('up');
    await expect.poll(async () => (await rowsOf(page)).some((row) => row.machine === b.ref && row.session === app), { timeout: 60_000, message: `B's browsing session is a row of A's\n${mainSaid(page)}` }).toBe(true);
    await expandMachine(page, b.ref);
    const row = sessionRow(page, address);
    await expect(row, `B's row in A's sidebar\n${mainSaid(page)}`).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(mainTabById(page, `session:${address}`)).toBeVisible({ timeout: 30_000 });
    await openSurface(page, 'Browser');
    const tool = surface(page, 'browser');
    const group = tool.locator('[data-browser-agent-group]');
    const canvas = tool.locator('[data-remote-browser]');
    const toolSaid = async () => `the tool: ${(await tool.innerText().catch(() => '')).replace(/\s+/g, ' ')}\nthe canvas: ${JSON.stringify(await canvas.evaluate((el) => ({ ...(el as HTMLElement).dataset })).catch(() => null))}\n${mainSaid(page)}\nB's log:\n${b.log().slice(-3000)}`;

    await test.step('A sees the tab B’s agent made against B’s loopback, its title, address and pixels, under view', async () => {
      await quoting(expect(group, 'the agent’s group on B').toContainText(`Agent on ${B_NAME}`, { timeout: 60_000 }), toolSaid);
      await quoting(expect(canvas, 'the agent’s tab shown of itself, live').toHaveAttribute('data-remote-stream', 'live', { timeout: 60_000 }), toolSaid);
      // the chips (or, in a narrow panel, the picker they collapse to) list one tab: this session's, not the other's
      const chips = group.locator('[data-browser-agent-chip]');
      await expect(chips, 'one tab: this session’s, not the other session’s identical one').toHaveCount(1);
      await expect(chips).toHaveAttribute('aria-selected', 'true');
      await expect(chips).toContainText('remote');
      await expect(tool.locator('[data-browser-remote-url]')).toHaveText(pages.url('/remote'));
      await expect(tool.locator('[data-remote-control-state="view"]')).toHaveText('View only');
      await expect.poll(async () => isWhite(await remotePixel(page, BLANK_AT)), { timeout: 30_000, message: 'the page’s white, drawn' }).toBe(true);
      console.log(`[e2e:remote] M10: A shows B's agent tab ${await canvas.getAttribute('data-remote-tab')}, frame ${await canvas.getAttribute('data-remote-seq')}, ${await canvas.getAttribute('data-remote-viewport')}`);
    });

    await test.step('another session’s identical tab is unreachable from this view: a select naming it is refused and A’s own stream goes on', async () => {
      const foreign = (await b.request<{ tabId: string }>('daemon.e2eBrowserView', { appSessionId: other, frames: 1 })).tabId;
      const own = (await canvas.getAttribute('data-remote-tab'))!;
      expect(foreign, 'a tab of its own').not.toBe(own);
      await page.evaluate(() => {
        type Listen = <P>(name: string, listener: (payload: P) => void) => () => void;
        const w = window as unknown as { __remoteClosed: string[]; __remoteFrames: string[]; maws: { on: Listen } };
        w.__remoteClosed = [];
        w.__remoteFrames = [];
        w.maws.on<{ reason: string }>('browser.remote.closed', (payload) => w.__remoteClosed.push(payload.reason));
        w.maws.on<{ frame: { tabId: string } }>('browser.remote.frame', (payload) => w.__remoteFrames.push(payload.frame.tabId));
      });
      const viewId = (await canvas.getAttribute('data-remote-view'))!;
      const epoch = (await canvas.getAttribute('data-remote-epoch'))!;
      await invoke(page, 'browser.remote.select', { viewId, epoch, tabId: foreign });
      const closed = () => page.evaluate(() => (window as unknown as { __remoteClosed: string[] }).__remoteClosed);
      await expect.poll(closed, { timeout: 30_000, message: 'the stream for the other session’s tab is refused' }).toHaveLength(1);
      expect((await closed())[0], 'refused as a tab this session does not hold').toBe('unknown');
      await quoting(expect(canvas, 'A’s own tab again').toHaveAttribute('data-remote-tab', own, { timeout: 30_000 }), toolSaid);
      await expect(canvas).toHaveAttribute('data-remote-stream', 'live', { timeout: 30_000 });
      const frames = await page.evaluate(() => (window as unknown as { __remoteFrames: string[] }).__remoteFrames);
      expect(frames, 'frames of A’s own tab reached the window').toContain(own);
      expect(frames, 'no frame of the other session’s tab reached the window').not.toContain(foreign);
    });

    await test.step('after Take control, A’s click changes B’s page and the next frame shows it; what A types reaches B’s field once; given back, nothing reaches it', async () => {
      await tool.getByRole('button', { name: 'Take control', exact: true }).click();
      await quoting(expect(tool.locator('[data-remote-control-state="held"]'), 'A has control').toHaveText('You have control', { timeout: 60_000 }), toolSaid);
      const button = await remotePoint(page, { x: BUTTON.x + BUTTON.width / 2, y: BUTTON.y + BUTTON.height / 2 });
      await page.mouse.click(button.x, button.y);
      await quoting(expect.poll(async () => isClicked(await remotePixel(page, BLANK_AT)), { timeout: 30_000, message: 'the next frame shows the click' }).toBe(true), toolSaid);
      const field = await remotePoint(page, { x: FIELD.x + FIELD.width / 2, y: FIELD.y + FIELD.height / 2 });
      await page.mouse.click(field.x, field.y);
      await page.keyboard.type('hi');
      // the agent's commands wait out the person's input (3 s after the last), then read B's page
      await expect(async () => expect(await onB(`[document.querySelector('#state').textContent, document.querySelector('#field').value, document.activeElement?.id ?? null]`)).toEqual(['clicked', 'hi', 'field'])).toPass({ timeout: 30_000 });
      // Enter acts at its keypress: a form of one field submits, and a text area breaks its line
      const place = (id: string, box: { x: number; y: number; width: number; height: number }) => `#${id}{position:absolute;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;box-sizing:border-box}`;
      await onB(
        `(() => { window.__submitted = 0; const style = document.createElement('style'); style.textContent = ${JSON.stringify(place('submit-field', FORM_FIELD) + place('area', AREA))}; ` +
          `const form = document.createElement('form'); form.addEventListener('submit', (e) => { e.preventDefault(); window.__submitted += 1; }); form.innerHTML = '<input id="submit-field">'; ` +
          `const area = document.createElement('textarea'); area.id = 'area'; document.head.append(style); document.body.append(form, area); return true; })()`,
      );
      const formField = await remotePoint(page, centre(FORM_FIELD));
      await page.mouse.click(formField.x, formField.y);
      await page.keyboard.press('Enter');
      const area = await remotePoint(page, centre(AREA));
      await page.mouse.click(area.x, area.y);
      await page.keyboard.type('a');
      await page.keyboard.press('Enter');
      await page.keyboard.type('b');
      await expect(async () => expect(await onB(`[window.__submitted, document.querySelector('#area').value]`), 'the form submitted once; the text area has two lines').toEqual([1, 'a\nb'])).toPass({ timeout: 30_000 });
      await tool.getByRole('button', { name: 'Give back', exact: true }).click();
      await expect(tool.locator('[data-remote-control-state="view"]')).toHaveText('View only', { timeout: 30_000 });
      await page.mouse.click(field.x, field.y);
      await page.keyboard.type('x');
      await new Promise((resolve) => setTimeout(resolve, 4_000)); // past the person's grace, had anything been sent
      expect(await onB(`document.querySelector('#field').value`), 'view only: nothing typed reached B').toBe('hi');
      console.log('[e2e:remote] M10: A took control, clicked and typed into B’s page, and gave it back');
    });

    await test.step('the Browser tool out of view closes its view, not B’s tab, its column hidden or another tool in its place; in view again it opens a new view of the tab', async () => {
      const bTabGoesOn = async () => {
        expect((await b.request<Render>('daemon.status')).render?.browserTabs, 'B’s tab goes on').toBe(2);
        const tabs = await cua.call<{ id: number }[]>('tabs.query');
        expect(tabs.ok && tabs.result.some((t) => t.id === created.tabId), 'the agent still holds it').toBe(true);
      };
      const before = (await canvas.getAttribute('data-remote-view'))!;
      await hideSurface(page, 'Browser'); // UX wave U8b: the side column hides; its Browser tab stays, and only a tab in view is mounted
      await expect(canvas).toHaveCount(0);
      await bTabGoesOn();
      await openSurface(page, 'Browser');
      await quoting(expect(canvas, 'live again').toHaveAttribute('data-remote-stream', 'live', { timeout: 60_000 }), toolSaid);
      const shown = (await canvas.getAttribute('data-remote-view'))!;
      expect(shown, 'a new view').not.toBe(before);
      // a second tool opened beside the chat comes into view in the Browser's place, which stays a tab of the strip
      await openSurface(page, 'Session info');
      await expect(canvas).toHaveCount(0);
      await expect(sideTab(sideColumn(page), 'Browser'), 'the Browser still a tab').toBeVisible();
      await bTabGoesOn();
      await sideTab(sideColumn(page), 'Browser').click();
      await quoting(expect(canvas, 'live again').toHaveAttribute('data-remote-stream', 'live', { timeout: 60_000 }), toolSaid);
      expect(await canvas.getAttribute('data-remote-view'), 'a new view again').not.toBe(shown);
    });

    await test.step('B’s app arriving mid-lease closes A’s stream engine-changed; the agent’s next tab is the app’s, and A views it', async () => {
      const headlessTab = (await canvas.getAttribute('data-remote-tab'))!;
      await page.evaluate(() => void ((window as unknown as { __remoteClosed: string[] }).__remoteClosed.length = 0));
      bApp.launch = await launchMaws({ userData: b.userData, keepConfigHome: true, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', MAWS_E2E_ENGINE_BIN: bin, MAWS_MACHINE_NAME: B_NAME } });
      await expect.poll(() => page.evaluate(() => (window as unknown as { __remoteClosed: string[] }).__remoteClosed), { timeout: 60_000, message: `A's stream closed as B's app took the agent's browser\n${await toolSaid()}` }).toContain('engine-changed');
      // cua's host lost its backend and is served by the app within its retry; the agent's next tab is the app's
      await expect(async () => void (await answered('the agent’s creation sequence in B’s app', cua.sequence(pages.url('/remote'))))).toPass({ timeout: 60_000 });
      await quoting(expect(group.locator('[data-browser-agent-chip]').filter({ hasText: 'remote' }), 'the app’s agent tab listed').toHaveCount(1, { timeout: 60_000 }), toolSaid);
      await quoting(expect(canvas, 'A views the app’s tab').not.toHaveAttribute('data-remote-tab', headlessTab, { timeout: 60_000 }), toolSaid);
      await quoting(expect(canvas, 'live').toHaveAttribute('data-remote-stream', 'live', { timeout: 60_000 }), toolSaid);
      await expect.poll(async () => isWhite(await remotePixel(page, BLANK_AT)), { timeout: 30_000, message: 'the app’s tab, white' }).toBe(true);
      console.log(`[e2e:remote] M10: B's app took over; A views its agent tab ${await canvas.getAttribute('data-remote-tab')}`);
    });
  } finally {
    await bApp.launch?.cleanup().catch((error: unknown) => console.error(error));
    await a?.cleanup();
    await scene?.stop();
    await pages.close();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// P5 O7 M8 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8's Proves: acceptance 4's row, 5's second client,
// 2's and 9's MAWS ask answered from this Mac, an operation across a link drop, 6's greying with its reason): the sitting's
// failures, on e2e:remote's scene over the relay (A's way to the hub is then its only carrier to B, so the scene's cut drops
// the link). Two apps of the member's are attached to B at once: A, whose own checkout of the org project holds nine
// idle local sessions (seeded transcripts its engine host indexes, unpinned and marked unread, each last active on
// 2026-11-01, before anything the run does), more than the group's cap of eight; and A2, a second device with a checkout
// of its own. Then, in order:
//   - "+ Session" on B from A, in that project: its row leads A's group's visible rows (with no Show more) while its
//     first turn runs, from A's spawn mark; the turn ends on screen, as the owner watched it at M10's sitting, so the
//     session is read (lane-b/read-marks.ts marks only a turn ending off screen); its tab closes, and past the stream's
//     linger the row stays first within the visible rows, above the nine stale unread ones (P5 O7 M10's follow-up, the
//     owner's "Fresh unread first": an unread session ranks ahead only within 24 h of the turn that made it unread, and
//     the nine's turns are days old. Live, the read row fell behind eight or more stale unread rows; A's fix before it
//     covered a turn ending off screen, which the unit tests keep, sidebar/derive.test.ts); and Resume… in the project
//     opens it again;
//   - A2, which has no mark, has it as a listed row and opens it through Resume…, the row naming `@B`;
//   - the composer's `!` on it, a command declared not offered on another machine, greys Run with its declared reason and
//     Enter sends nothing;
//   - a MAWS ask B's session raises is read and answered from A, and the card settles on A, on B and on A2;
//   - `/btw` across a link drop: the side question is taken on B, A's link drops, B answers it, and once the link is back
//     the operation's completion (`session.operation`, the outcome B's engine host kept, asked for at the reopening)
//     reaches A once, with B's answer, and A's view shows it;
//   - follow ownership: A and A2 each follow an agent of the session on B; A's unfollow, then A quitting, lets go of A's
//     hold alone, and B keeps the follow for A2, read in B's engine host's log (its follow lines: a client's hold, its
//     release, the follow's drop), since no client sees whether B's follow runs.
// No wall-clock bound (e2e:remote carries none; the gate's note on the group): the row's time from B's engine running the
// session is logged, and its 5 s bound is M10's to measure live.
// Held below e2e level: Reload plugins (the replay engine records no `reload_plugins`); the operation's `pending` and
// `unknown` answers at the reopening (remote-session.test.ts).
const M8_SPAWNED = 'b0c0d0e0-0000-4000-8000-0000000000b6'; // the engine session id the spawn's journal pins
const M8_TITLE = 'B’s session started from A';
const M8_BRIEF = 'Start the M8 session on B.';
// its first turn streams a prefix of its reply, then holds at a read until the spec lets it go, so the turn is running
// (the spawn mark leads) for as long as the spec reads the sidebar
const M8_DELTAS = ['Started ', 'on B '];
const M8_PARTIAL = 'Started on B';
const M8_REPLY = 'Started on B from A, first turn over.';
const M8_ASK_PROMPT = 'Ask me before you go on.';
const M8_QUESTION = 'Go on with the plan on B?';
const M8_ASK = { questions: [{ id: 'q1', question: M8_QUESTION, modality: 'choice', options: [{ label: 'Yes' }, { label: 'No' }] }] };
const M8_ASK_REPLY = 'Going on, as A answered.';
const M8_SIDE_ANSWER = 'ZEBRA'; // p1-side-question-session seq 92's
const M8_IDLE = 9; // past the cap: SESSIONS_CAP (8) in src/renderer/src/sidebar/derive.ts
const M8_FIRST_SHOWN = 5; // SESSIONS_FIRST: a group's rows before its Show more
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A's renderer's `session.operation` events as the raw bridge hears them (window.__operations), kept from now on
type HeardOperation = { opId: string; command: string; late: boolean; outcome: { ok: boolean; value?: unknown } };
async function keepOperations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const heard: HeardOperation[] = [];
    (window as unknown as { __operations: HeardOperation[] }).__operations = heard;
    window.maws.on('session.operation', (event) => void heard.push(event as unknown as HeardOperation));
  });
}
const heardOperations = (page: Page) => page.evaluate(() => (window as unknown as { __operations: HeardOperation[] }).__operations);

test('M8: a session spawned on B leads a full project past its cap and stays among its visible rows by its activity, Resume… opens it, a second app has it by parity; a declared control greys with its reason; a MAWS ask answered on one app settles on the other; /btw’s completion crosses a link drop', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-m8-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-m8-'));
  const a2UserData = mkdtempSync(join(tmpdir(), 'maws-ra2-m8-'));
  const checkout = join(root, 'b-checkout');
  const journals = join(root, 'journals');
  const hooks = join(root, 'no-hooks');
  const aCheckout = join(root, A_PROJECT);
  const a2Checkout = join(root, 'second', A_PROJECT); // A2's own checkout of the org project
  for (const dir of [checkout, journals, hooks, aCheckout]) mkdirSync(dir);
  mkdirSync(a2Checkout, { recursive: true });
  checkoutRepository(checkout, hooks);
  checkoutRepository(aCheckout, hooks);
  checkoutRepository(a2Checkout, hooks);
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  let a2: MawsLaunch | null = null;
  try {
    // B's session, the first launch on B's replay list: the brief's turn (held mid-reply), A's turn that raises a MAWS ask,
    // then a side question held between its receipt and its answer
    const journal = new SideJournal(M8_SPAWNED, checkout);
    const first = journal.prompt();
    journal.reply(first, M8_REPLY, M8_DELTAS, () => journal.holdAtContextUsage());
    journal.completed(first);
    const asking = journal.prompt();
    journal.mawsToolCall('ask', M8_ASK, { status: 'answered', answers: [{ id: 'q1', status: 'answered', value: ['Yes'] }] }, { asked: false });
    journal.reply(asking, M8_ASK_REPLY);
    journal.completed(asking);
    journal.sideQuestions([88, 91]); // the question and the engine's `started`
    journal.holdAtContextUsage(); // held: the link drops here
    journal.sideQuestions([92]); // the answer
    const fixture = journal.write(journals, 'b-m8');

    scene = await startRemoteScene({
      scratch: join(root, 'scene'),
      aUserData,
      secondUserData: a2UserData,
      b: {
        // B's profile under a realpathed root of its own: the replay writes the session's transcript (which B's index
        // lists, and its agents' directory with it) only into a config home that is its own real path
        root: '/tmp',
        env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixture, DISABLE_AUTOUPDATER: '1' },
        prepare: ({ claudeConfigDir }) => {
          writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [checkout]: { hasTrustDialogAccepted: true } } }));
          writeFileSync(join(claudeConfigDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }));
        },
      },
    });
    const { b } = scene;
    await b.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    await b.request('session.projects.add', { directory: checkout }); // B's checkout of the org project, which "+ Session" offers

    // A's nine idle local sessions of the org project, in A's own checkout: transcripts its engine host indexes at its
    // start, each last active on 2026-11-01, older than anything the run does
    const idleIds = Array.from({ length: M8_IDLE }, (_, i) => `a0c0d0e0-0000-4000-8000-0000000000${String(i + 10)}`);
    a = await launchMaws({
      userData: aUserData,
      env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A', MAWS_E2E_STEP_UP: 'accept' }, // the step-up a spawn always asks, accepted
      prepare: ({ claudeConfigDir }) => {
        idleIds.forEach((sessionId, i) => {
          const t = transcript({ sessionId, cwd: aCheckout, start: Date.UTC(2026, 10, 1, 9, i, 0) });
          t.user(`a1c0d0e0-0000-4000-8000-0000000000${String(i + 10)}`, `Local idle session ${i + 1}`);
          t.text(`a2c0d0e0-0000-4000-8000-0000000000${String(i + 10)}`, `Answered on A, ${i + 1}.`);
          t.turnEnd(`a3c0d0e0-0000-4000-8000-0000000000${String(i + 10)}`);
          seedTranscript(claudeConfigDir, aCheckout, sessionId, t.records);
        });
      },
    });
    keepMainLines(a);
    const { page, app: aApp } = a;
    // A2: the member's second app, attached to B over its own channel, with no session of its own
    a2 = await launchMaws({ userData: a2UserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false, 'second'), MAWS_MACHINE_NAME: 'A2' } });
    keepMainLines(a2);
    const page2 = a2.page;
    type Projects = { projects: { directory: string; org?: { key: string } }[] };
    const attach = async (on: Page, directory: string): Promise<string> => {
      await expect
        .poll(async () => (await machineOf(on, b.ref))?.state ?? null, { timeout: 60_000, message: `the app's link to B comes up over the relay\n${mainSaid(on)}` })
        .toBe('up');
      const added = await invoke<{ id: string }>(on, 'session.projects.add', { directory });
      await expect
        .poll(async () => (await invoke<Projects>(on, 'session.projects.list', undefined)).projects.find((p) => p.directory === directory)?.org?.key ?? null, { timeout: 30_000 })
        .toBe(`smns:${PROJECT}`);
      return added.id;
    };
    const project = await attach(page, aCheckout);
    await attach(page2, a2Checkout);
    type Records = { sessions: { appId: string; engineSessionId: string | null; projectId: string | null }[] };
    let idle: string[] = [];
    await expect
      .poll(async () => (idle = (await invoke<Records>(page, 'session.list', { includeArchived: true })).sessions.filter((r) => r.engineSessionId !== null && idleIds.includes(r.engineSessionId) && r.projectId === project).map((r) => r.appId)).length, {
        timeout: 60_000,
        message: 'A indexes its nine local sessions in its checkout',
      })
      .toBe(M8_IDLE);
    // unread, as the owner's group held them live (P5 O7 M10), their dots stale: last active days before any run
    for (const id of idle) await invoke(page, 'session.update', { appSessionId: id, patch: { unread: true } });

    // Each app's group of the org project, its drawn rows (a record's or a listing's) and its Show more (never pressed)
    const groupOf = (on: Page) => projectRow(on, A_PROJECT);
    const shownRowsOf = (on: Page) => groupOf(on).locator('[data-kind="session"], [data-kind="listed"]');
    const showMoreOf = async (on: Page) => groupOf(on).locator(`[data-tree-id="more:${(await groupOf(on).getAttribute('data-tree-id'))!.slice('p:'.length)}"]`);
    await openProject(page, A_PROJECT);
    await expect(shownRowsOf(page), 'A’s group draws five of its nine idle sessions').toHaveCount(M8_FIRST_SHOWN, { timeout: 30_000 });
    await expect(shownRowsOf(page).getByRole('img', { name: 'Unread', exact: true }), 'each unread').toHaveCount(M8_FIRST_SHOWN);
    await expect(await showMoreOf(page), 'and holds the rest behind Show more').toHaveCount(1);

    // B's own lines about the spawn, for a failure
    const bSaid = async () => {
      const engines = await b.request<unknown[]>('engine.sessions').catch((error: unknown) => String(error));
      const lines = b.log().split('\n').filter((line) => /spawn|session\.(create|start|intent)|machine\.op|step-up|refus|replay|endpoint|side|ask/i.test(line));
      return `B's engine sessions: ${JSON.stringify(engines)}\nB's log:\n${lines.slice(-40).join('\n')}`;
    };
    type UserMessage = Extract<SessionEvent, { kind: 'user.message' }>;
    const writtenOn = async (session: string) => (await b.request<{ events: SessionEvent[] }>('session.events', { appSessionId: session, afterSeq: null, limit: null })).events.filter((e): e is UserMessage => e.kind === 'user.message' && !e.isReplay);
    let spawnedApp = '';
    let address = '';
    const turnOverOnB = async () => (await b.request<{ turn: unknown }>('session.status', { appSessionId: spawnedApp })).turn === null;
    const composerOn = (on: Page) => main(on).locator(`[data-composer="${address}"]`);
    const chooserOf = (on: Page) => on.getByRole('dialog', { name: 'Resume session' });
    const spawnedRowOf = (on: Page) => groupOf(on).locator(`[role="treeitem"][data-tree-id="s:${address}"]`);
    // Resume… in the app's group: the option `hasText` names, opened by a double click, the session's history then in its pane
    const resumeOn = async (on: Page, hasText: string | RegExp, says: string) => {
      await openProject(on, A_PROJECT);
      await clickRevealed(projectLine(groupOf(on)), groupOf(on).getByRole('button', { name: `Resume a session in ${A_PROJECT}`, exact: true }));
      const chooser = chooserOf(on);
      await expect(chooser).toBeVisible();
      const option = chooser.getByRole('option').filter({ hasText });
      await quoting(expect(option, `Resume… lists it, ${says}`).toContainText(`@${B_NAME}`, { timeout: 30_000 }), async () => `the chooser: ${await chooser.innerText().catch(() => '')}`);
      await option.dblclick();
      await expect(chooser).toHaveCount(0);
      await quoting(expect(composerOn(on), 'Resume… opened it in the pane').toBeVisible({ timeout: 60_000 }), async () => `${await paneSaid(on)}\n${mainSaid(on)}`);
      await expect(main(on).getByText(M8_REPLY).first(), 'with its history').toBeVisible({ timeout: 60_000 });
    };

    await test.step('acceptance 4: the session spawned on B leads the full group’s visible rows while its first turn runs, stays first within them after it ends on screen, above the stale unread rows, and comes back through Resume…', async () => {
      await newChat(page, A_PROJECT);
      await chooseMachine(page, B_NAME);
      await composerOf(page).click();
      await page.keyboard.type(M8_BRIEF);
      await page.keyboard.press('Enter');
      // the engine's first event: B's engine host runs the pinned engine session
      await expect
        .poll(async () => (spawnedApp = (await b.request<{ appSessionId: string; engineSessionId: string | null }[]>('engine.sessions')).find((s) => s.engineSessionId === M8_SPAWNED)?.appSessionId ?? ''), {
          timeout: 120_000,
          intervals: [100],
          message: 'B’s engine host runs the spawned session',
        })
        .not.toBe('')
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await paneSaid(page)}\n${mainSaid(page)}\n${await bSaid()}`);
        });
      const ranAt = Date.now();
      address = addressOf(b.ref, spawnedApp);
      // B's owner names it, and sminos lists it as it does every session its machine starts (the harness's fake)
      await b.request('session.update', { appSessionId: spawnedApp, patch: { title: { text: M8_TITLE, source: 'user' } } });
      await scene!.sminos.list({ engine: M8_SPAWNED, app: spawnedApp, owners: [scene!.member], project: PROJECT, title: M8_TITLE, cwd: checkout });
      expect(bareOf(await movedTo(page, b.ref, null, bSaid)), 'the New chat tab moved to the session B started').toBe(spawnedApp);
      await expect(main(page).getByText(M8_PARTIAL).first(), `its first turn runs in A's pane\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      await expect(main(page).getByText(M8_REPLY), 'held mid-reply: the turn still runs').toHaveCount(0);
      await quoting(expect(spawnedRowOf(page), 'the spawned session within the group’s visible rows, Show more not pressed').toBeVisible({ timeout: 60_000 }), async () => `the group's rows: ${(await shownRowsOf(page).allTextContents()).join(' | ')}\n${mainSaid(page)}`);
      const shownAfter = Date.now() - ranAt;
      await expect(shownRowsOf(page).first(), 'the spawned row leads the group').toHaveAttribute('data-tree-id', `s:${address}`);
      await expect(shownRowsOf(page), 'within the five drawn: the lead takes no extra row when it is inside the cut').toHaveCount(M8_FIRST_SHOWN);
      await expect(await showMoreOf(page), 'the idle rest behind Show more').toHaveCount(1);
      console.log(`[e2e:remote] M8: the spawned row (${address}) within the visible rows ${shownAfter} ms after B's engine host ran it`);

      // the first turn ends on screen, the session's tab selected and the pointer off the sidebar (so its ranks aren't
      // held), as the owner watched it end: the session is read, and with the lead over the row ranks by its activity
      await page.mouse.move(700, 400);
      await b.request('session.getContextUsage', { appSessionId: spawnedApp, detail: 'summary' }); // lets B's engine go on
      await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);
      await expect(main(page).getByText(M8_REPLY).first(), 'the turn’s end on screen').toBeVisible({ timeout: 60_000 });
      // A's own status has the turn over (the reply's text arrives before it): the composer's Stop, which reads the status
      // the read marks watch (lane-b/read-marks.ts), is Send again, so no turn end can reach A after the tab closes
      await expect(main(page).locator('[data-submit-state]'), 'A has the turn over, on screen').toHaveAttribute('data-submit-state', 'send', { timeout: 30_000 });
      await expect(mainTabById(page, `session:${address}`), 'the session’s tab selected').toHaveAttribute('aria-selected', 'true');
      await expect(spawnedRowOf(page).getByRole('img', { name: 'Unread', exact: true }), 'read: its turn ended on screen').toHaveCount(0);
      // its tab closed, which reads nothing more
      await menu(aApp, 'tab.close');
      await expect(mainTabById(page, `session:${address}`), 'the session’s tab closed').toHaveCount(0, { timeout: 30_000 });
      await page.mouse.move(700, 400);
      // past the stream's linger (REMOTE_LANE_B_TIMING.unsubscribeLingerMs, 10 s, src/main/lane-b/remote.ts) main has let
      // the session go, which it tells the page nothing of: A's record of it stays as last received, and its listing and
      // the turns A saw on its stream stand for its activity from then on
      await page.waitForTimeout(12_000);
      await quoting(expect(spawnedRowOf(page), 'its first turn over and its tab closed, the row still within the visible rows, Show more not pressed').toBeVisible({ timeout: 30_000 }), async () => `the group's rows: ${(await shownRowsOf(page).allTextContents()).join(' | ')}\n${mainSaid(page)}`);
      await expect(spawnedRowOf(page).getByRole('img', { name: 'Unread', exact: true }), 'still read').toHaveCount(0);
      await expect(shownRowsOf(page).first(), 'first: the group’s latest activity, the stale unread rows behind it').toHaveAttribute('data-tree-id', `s:${address}`);
      await expect(shownRowsOf(page).getByRole('img', { name: 'Unread', exact: true }), 'the four stale rows drawn under it keep their dots').toHaveCount(M8_FIRST_SHOWN - 1);
      await expect(shownRowsOf(page), 'five drawn').toHaveCount(M8_FIRST_SHOWN);
      await expect(await showMoreOf(page), 'the idle rest behind Show more').toHaveCount(1);
      // A still holds the record main read for the tab, which Resume… lists in the listing's place, by the record's title:
      // B's owner's, or the brief's if the rename hadn't reached the record when the tab let it go
      await resumeOn(page, new RegExp(`${escaped(M8_TITLE)}|${escaped(M8_BRIEF)}`), 'its record’s row naming its machine');
    });

    await test.step('acceptance 5: A2, attached to B and holding no mark, has the session as a listed row and opens it through Resume…', async () => {
      await expect.poll(async () => (await rowsOf(page2)).some((row) => row.machine === b.ref && row.session === spawnedApp), { timeout: 60_000, message: `A2 has B's listing of it\n${mainSaid(page2)}` }).toBe(true);
      await openProject(page2, A_PROJECT);
      await quoting(expect(spawnedRowOf(page2), 'A2’s group draws it, a listed row').toHaveAttribute('data-kind', 'listed', { timeout: 30_000 }), async () => `A2's rows: ${(await shownRowsOf(page2).allTextContents()).join(' | ')}\n${mainSaid(page2)}`);
      await resumeOn(page2, M8_TITLE, 'a listed row naming its machine');
    });

    await test.step('acceptance 6: `!` on the session on B greys Run with its declared reason, and Enter sends nothing', async () => {
      const before = (await writtenOn(spawnedApp)).length;
      await composerOf(page).click();
      await page.keyboard.type('!ls');
      const run = composerOn(page).locator('[data-submit-state]');
      await expect(run, 'the `!` mode’s control').toHaveText('Run', { timeout: 30_000 });
      await expect(run).toBeDisabled();
      expect(await run.getAttribute('title'), 'its reason, the declared words').toContain(REMOTE_UNAVAILABLE['session.bash']!);
      await page.keyboard.press('Enter');
      await expect(composerOf(page), 'Enter kept the text').toContainText('ls');
      expect((await writtenOn(spawnedApp)).length, 'nothing reached B').toBe(before);
      // the refused Enter's flight went read-only, which drops the focus to the page; the box takes it back, so clearing
      // the text by the keyboard leaves the greyed `!` for a plain Send
      await expect(composerOf(page), 'the box has the keyboard back').toBeFocused({ timeout: 5_000 });
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await expect(run, 'the cleared box, out of `!`').toHaveText('Send');
    });

    await test.step('acceptances 2, 5 and 9: a MAWS ask B’s session raises is read and answered from A, and the card settles on A, on B and on A2', async () => {
      await composerOf(page).click();
      await page.keyboard.type(M8_ASK_PROMPT);
      await page.keyboard.press('Enter');
      type Asks = { asks: { askId: string }[] };
      let askId = '';
      await expect
        .poll(async () => (askId = (await b.request<Asks>('maws.asks.list', { appSessionId: spawnedApp })).asks[0]?.askId ?? ''), { timeout: 60_000, message: `B's session asks\n${await bSaid()}` })
        .not.toBe('');
      const capsuleOn = (on: Page) => main(on).locator('section.transcript-ask');
      await quoting(expect(capsuleOn(page), 'the ask’s card in A’s pane, waiting').toHaveAttribute('data-ask-state', 'pending', { timeout: 60_000 }), async () => `${await paneSaid(page)}\n${mainSaid(page)}`);
      await quoting(expect(capsuleOn(page2), 'and in A2’s').toHaveAttribute('data-ask-state', 'pending', { timeout: 60_000 }), async () => `${await paneSaid(page2)}\n${mainSaid(page2)}`);
      const sheet = page.locator('[data-ask-sheet]');
      await expect(sheet, 'its sheet, read from A').toHaveAttribute('data-ask-id', askId, { timeout: 30_000 });
      const question = sheet.locator('section[data-question-id="q1"]');
      await expect(question).toContainText(M8_QUESTION);
      await question.getByRole('radio', { name: 'Yes' }).click();
      await sheet.getByRole('button', { name: 'Submit', exact: true }).click();
      await quoting(expect(capsuleOn(page), 'settled on A').toHaveAttribute('data-ask-state', 'answered', { timeout: 60_000 }), async () => `${mainSaid(page)}\n${await bSaid()}`);
      await expect.poll(async () => (await b.request<Asks>('maws.asks.list', { appSessionId: spawnedApp })).asks, { timeout: 30_000, message: 'on B: nothing pending' }).toEqual([]);
      await quoting(expect(capsuleOn(page2), 'and on A2, which answered nothing').toHaveAttribute('data-ask-state', 'answered', { timeout: 60_000 }), async () => `${await paneSaid(page2)}\n${mainSaid(page2)}`);
      const { events } = await b.request<{ events: SessionEvent[] }>('session.events', { appSessionId: spawnedApp, afterSeq: null, limit: null });
      expect(events.filter((e): e is Extract<SessionEvent, { kind: 'maws.ask.answered' }> => e.kind === 'maws.ask.answered').map((e) => e.askId), 'B recorded the answer once').toEqual([askId]);
      await expect(main(page).getByText(M8_ASK_REPLY).first(), 'the turn goes on on B').toBeVisible({ timeout: 60_000 });
      await expect.poll(turnOverOnB, { timeout: 30_000 }).toBe(true);
    });

    await test.step('an operation across a link drop: /btw taken on B, the link dropped, B answers, and its completion reaches A once the link is back', async () => {
      type Side = { exchanges: { id: string; question: string; state: string; response: string | null }[] };
      const exchangesOnB = async () => (await b.request<Side>('side.question.list', { appSessionId: spawnedApp })).exchanges;
      const onB = async () => (await exchangesOnB()).map((e) => [e.question, e.state, e.response]);
      await keepOperations(page);
      await composerOf(page).click();
      await page.keyboard.type(`/btw ${SIDE_QUESTION}`);
      await page.keyboard.press('Enter');
      const view = page.locator(`[data-side-btw-view="${address}"]`);
      await expect(view, 'the side question’s view').toBeVisible({ timeout: 30_000 });
      await expect(view.locator('[data-side-exchange="pending"]'), 'asked, pending').toContainText(SIDE_QUESTION, { timeout: 30_000 });
      await expect.poll(onB, { timeout: 30_000, message: `B took it (its receipt)\n${await bSaid()}` }).toEqual([[SIDE_QUESTION, 'pending', null]]);
      const opId = (await exchangesOnB())[0]!.id; // the exchange's id is its operation's
      // a read over the link after the receipt: the channel carried what came before it, the act's answer included
      await invoke(page, 'side.question.list', { appSessionId: spawnedApp }, b.ref);
      // its completions as A hears them, the late correction §U allows left out (`late: true`, at most once more)
      const completions = async () => (await heardOperations(page)).filter((event) => event.opId === opId && !event.late);

      scene!.aHub.cut();
      await expect.poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 60_000, message: `A's link to B goes down once cut\n${mainSaid(page)}` }).toBe('down');
      expect(await onB(), 'still unanswered when the link dropped').toEqual([[SIDE_QUESTION, 'pending', null]]);
      await b.request('session.getContextUsage', { appSessionId: spawnedApp, detail: 'summary' }); // lets B's engine answer
      await expect.poll(onB, { timeout: 30_000, message: 'B answers it while A is cut off' }).toEqual([[SIDE_QUESTION, 'answered', M8_SIDE_ANSWER]]);
      expect(await completions(), 'A heard no completion while cut off').toEqual([]);
      await expect(view.locator('[data-side-exchange="answered"]'), 'nor drew one').toHaveCount(0);
      scene!.aHub.restore();
      await expect.poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 120_000, message: `A's link to B comes up again\n${mainSaid(page)}` }).toBe('up');
      // the completion itself, not only the view (which the reopening's re-read of the log would also settle)
      await quoting(
        expect.poll(async () => (await completions()).map((event) => [event.command, event.outcome.ok, (event.outcome.value as { response?: string } | undefined)?.response ?? null]), { timeout: 60_000, message: 'the side question’s completion reaches A after the reconnect' }).toEqual([['session.sideQuestion', true, M8_SIDE_ANSWER]]),
        async () => `${mainSaid(page)}\n${await bSaid()}`,
      );
      await expect(view.locator('[data-side-exchange="answered"]'), 'the answer in A’s view').toContainText(M8_SIDE_ANSWER, { timeout: 60_000 });
      await expect(view.locator('[data-side-exchange="pending"]'), 'nothing left pending').toHaveCount(0);
      expect(await completions(), 'its completion came once').toHaveLength(1);
    });

    await test.step('follow ownership: A and A2 each follow an agent of the session on B; A’s unfollow, then A quitting, lets go of A’s hold alone, and B keeps A2’s follow', async () => {
      // a workflow agent of the session on B (a workflow's agent follows at once, its meta naming no tool use)
      const agentId = 'a0e2e5f0110b6d8c1';
      const agentDir = join(b.claudeConfigDir, 'projects', slugOf(checkout), M8_SPAWNED, 'subagents', 'workflows', 'wf_m8e2e00-001');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, `agent-${agentId}.jsonl`), `${JSON.stringify({ type: 'user', uuid: 'f6e30000-0000-4000-8000-0000000000c1', parentUuid: null, isSidechain: true, agentId, cwd: checkout, message: { role: 'user', content: 'Count the files on B.' } })}\n`);
      const follow = { appSessionId: spawnedApp, agentId };
      // B's engine host's lines about this follow, from every log of B's (the scene's way of reading B's files)
      const prefix = `[fs] follow ${spawnedApp}/${agentId}: `;
      const followLines = () =>
        (readdirSync(b.userData, { recursive: true }) as string[])
          .filter((name) => name.endsWith('.log'))
          .flatMap((name) => readFileSync(join(b.userData, name), 'utf8').split('\n'))
          .map((line) => line.slice(Math.max(0, line.indexOf(prefix))))
          .filter((line) => line.startsWith(prefix))
          .map((line) => line.slice(prefix.length));
      const heldBy = (n: number) => new RegExp(`^held by client ([0-9a-f]{8}) \\(${n} holding\\)$`);
      const tagOf = (re: RegExp) => followLines().map((line) => re.exec(line)?.[1]).find((tag) => tag !== undefined) ?? null;
      const said = async () => `B's lines for the follow:\n${followLines().join('\n') || 'none'}\n${await bSaid()}`;

      // A follows (retried while B's index lists the agent), then A2
      await expect(async () => void (await invoke(page, 'fs.agentEvents', follow, b.ref))).toPass({ timeout: 30_000 });
      let tagA: string | null = null;
      await quoting(expect.poll(() => (tagA = tagOf(heldBy(1))), { timeout: 30_000, message: 'B logs A’s hold' }).not.toBeNull(), said);
      await invoke(page2, 'fs.agentEvents', follow, b.ref);
      let tagA2: string | null = null;
      await quoting(expect.poll(() => (tagA2 = tagOf(heldBy(2))), { timeout: 30_000, message: 'B logs A2’s hold beside it' }).not.toBeNull(), said);
      expect(tagA2, 'two clients, two holds').not.toBe(tagA);

      // A unfollows: its hold alone is let go, and the follow runs on for A2
      await invoke(page, 'fs.unfollow', follow, b.ref);
      await quoting(expect.poll(followLines, { timeout: 30_000, message: 'A’s hold released, A2’s kept' }).toContain(`released by client ${tagA} (1 holding)`), said);
      expect(followLines(), 'no drop: A2 still follows').not.toContain('dropped');

      // A follows again and quits: its channel's end lets go of its hold alone
      await invoke(page, 'fs.agentEvents', follow, b.ref);
      await quoting(expect.poll(() => followLines().filter((line) => line === `held by client ${tagA} (2 holding)`).length, { timeout: 30_000, message: 'A holds it again' }).toBe(1), said);
      await a!.cleanup();
      a = null;
      await quoting(
        expect.poll(() => followLines().filter((line) => line === `released by client ${tagA} (1 holding)`).length, { timeout: 120_000, message: 'A quit: B lets go of its hold as its channel ends' }).toBe(2),
        said,
      );
      expect(followLines(), 'no drop: A2 still follows').not.toContain('dropped');
      expect(followLines().filter((line) => line.startsWith(`released by client ${tagA2}`)), 'and A2’s hold untouched').toEqual([]);

      // the log tells a drop when there is one: A2, the last holder, lets go
      await invoke(page2, 'fs.unfollow', follow, b.ref);
      await quoting(expect.poll(followLines, { timeout: 30_000, message: 'the last hold let go, the follow dropped' }).toEqual(expect.arrayContaining([`released by client ${tagA2} (0 holding)`, 'dropped'])), said);
      console.log(`[e2e:remote] M8: B's follow of ${agentId}: ${followLines().join('; ')}`);
    });
  } finally {
    await a2?.cleanup();
    await a?.cleanup();
    await scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(a2UserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9's Proves: P5 acceptance 5's spawn on a machine
// with no setup), on e2e:remote's scene over the relay. B holds a checkout of the org project that nobody registered there,
// under a home of the scene's own (B's HOME, a folder in the scene's root: nothing on B lists the runner's), untrusted on
// B; B keeps its own default route, the machine's own, and its engine (a replay) reports an Anthropic login. From A, in
// order: the machine menu offers B as a machine like any other (machine first, 2026-11-06: no setup item), and with B
// chosen the project chip, which has no checkout of the project there to take, falls back to Choose a project; its New
// project opens B's folder sheet, which lists B's home, a private folder there marked and never opened (no e2e opens
// one), and is walked to the checkout; its trust is read on B and B's trust card shows, with no start without trusting;
// Trust, then the registration (its Touch ID accepted by the harness), and B registers the folder, which the chip then
// names; the brief's Send spawns there with `trust: 'accepted'`, so B runs its trust bootstrap (the first launch on B's
// replay list) and then the session (the second), the tab moves to it and its row shows in A's group; B's status names
// the login its machine route reached, and A's Session info names it in the Route row.
// Not driven: a non-owner's greyed item. The scene's org has one member, who owns B; a non-owner is a second member
// signed in on an app of their own, which the local org does not stage. sessions/MachineMenu.test.tsx holds the greyed
// item and its reason, test/endpoint/setup-rows.test.ts the endpoint's `owners-only` for a member and a grant-holder.
const M9_SPAWNED = 'b0c0d0e0-0000-4000-8000-0000000000b7'; // the engine session id the session's journal pins
const M9_TITLE = 'B’s session set up from A';
const M9_BRIEF = 'Start the M9 session on B.';
const M9_REPLY = 'Started on B in the folder A set up.';
const M9_LOGIN = 'Claude Max account'; // what B's engine reports (`Login`, `Organization`: pass2/auto-unrouted's rows)
const M9_ORGANIZATION = 'B owner’s organization';
const M9_BOOTSTRAP = join(REPO_ROOT, 'spikes/protocol-probe/fixtures/pass3/trust-bootstrap-recorded.jsonl'); // e2e/sessions.spec.ts's
// A New chat tab's project chip: `Choose a project` until a place is chosen, then `Project <label>`; and its menu, where a
// greyed item reads its reason on a second line, so an item is matched by its text, never by its exact name.
const projectChip = (page: Page, label: string | null) => main(page).locator('[data-project-row]').getByRole('button', { name: label === null ? 'Choose a project' : `Project ${label}`, exact: true });
const placesMenu = (page: Page) => page.getByRole('dialog', { name: 'Choose a project' });
const placeItem = (page: Page, text: string) => placesMenu(page).getByRole('option').filter({ hasText: text });

test('M9: "+ Session" on B with no registered checkout sets its folder up there: browsed, trusted on B, registered and spawned, and Session info names the route B’s own settings reached', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-m9-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-m9-'));
  const journals = join(root, 'journals');
  const hooks = join(root, 'no-hooks');
  const aCheckout = join(root, A_PROJECT);
  const bHome = join(root, 'b-home');
  const bCheckout = join(bHome, 'Developer', 'GitHub', A_PROJECT);
  for (const dir of [journals, hooks, aCheckout, bHome]) mkdirSync(dir);
  mkdirSync(bCheckout, { recursive: true });
  mkdirSync(join(bHome, 'Documents')); // a protected folder's name in B's home: listed, marked, never opened
  checkoutRepository(bCheckout, hooks);
  checkoutRepository(aCheckout, hooks);
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  try {
    const journal = new SideJournal(M9_SPAWNED, bCheckout, [{ label: 'Login', value: M9_LOGIN }, { label: 'Organization', value: M9_ORGANIZATION }]);
    journal.turn(M9_REPLY);
    const fixture = journal.write(journals, 'b-m9');
    scene = await startRemoteScene({
      scratch: join(root, 'scene'),
      aUserData,
      b: {
        root: '/tmp', // as M8's: the replay writes the session's transcript only into a config home that is its own real path
        // B's launches in order: the trust bootstrap the accepted trust runs, then the session
        env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: [M9_BOOTSTRAP, fixture].join(','), HOME: bHome, DISABLE_AUTOUPDATER: '1' },
        // onboarding done and the journal's mode; no folder trusted, so the trust card is B's own
        prepare: ({ claudeConfigDir }) => {
          writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: {} }));
          writeFileSync(join(claudeConfigDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }));
        },
      },
    });
    const { b } = scene;
    const bProjects = async () => (await b.request<{ projects: { directory: string }[] }>('session.projects.list')).projects.map((p) => p.directory);
    expect(await bProjects(), 'B’s checkout is registered nowhere on B').not.toContain(bCheckout);

    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A', MAWS_E2E_STEP_UP: 'accept' } }); // the registration's and the spawn's step-ups, accepted
    keepMainLines(a);
    const { page } = a;
    await expect.poll(async () => (await machineOf(page, b.ref))?.state ?? null, { timeout: 60_000, message: `A's link to B comes up over the relay\n${mainSaid(page)}` }).toBe('up');
    type Projects = { projects: { directory: string; org?: { key: string } }[] };
    await invoke(page, 'session.projects.add', { directory: aCheckout });
    await expect
      .poll(async () => (await invoke<Projects>(page, 'session.projects.list', undefined)).projects.find((p) => p.directory === aCheckout)?.org?.key ?? null, { timeout: 30_000 })
      .toBe(`smns:${PROJECT}`);
    const bSaid = async () => {
      const engines = await b.request<unknown[]>('engine.sessions').catch((error: unknown) => String(error));
      const lines = b.log().split('\n').filter((line) => /spawn|session\.(create|start|intent|projects|trust)|machine\.(op|folders|setupTrust)|step-up|refus|setup|trust|replay|endpoint|route/i.test(line));
      return `B's engine sessions: ${JSON.stringify(engines)}\nB's log:\n${lines.slice(-40).join('\n')}`;
    };

    const sheet = page.getByRole('dialog', { name: `New project on ${B_NAME}` });
    await test.step('the machine menu offers B, which has no registered checkout of the project; there the project chip falls back to Choose a project, and its New project opens B’s folder sheet: B’s home, a private folder marked and never opened, walked to the checkout', async () => {
      await newChat(page, A_PROJECT);
      await chooseMachine(page, B_NAME); // a machine of its own in the menu, whatever it holds
      await quoting(expect(projectChip(page, null), 'B holds no registered checkout of the project: the chip falls back to Choose a project').toBeVisible({ timeout: 30_000 }), async () => `the project row: ${await main(page).locator('[data-project-row]').innerText({ timeout: 1_000 }).catch(() => 'none')}\n${mainSaid(page)}`);
      await projectChip(page, null).click();
      await expect(placesMenu(page).getByPlaceholder('Search projects')).toBeVisible();
      await placeItem(page, 'New project').click();
      await quoting(expect(sheet, 'B’s folder sheet').toBeVisible({ timeout: 30_000 }), async () => `the dialogs: ${(await page.getByRole('dialog').allInnerTexts().catch(() => [])).join(' | ') || 'none'}\n${mainSaid(page)}`);
      await expect(sheet, 'the privacy warning first').toContainText('Private folders macOS protects');
      const folders = sheet.getByRole('list', { name: `Folders on ${B_NAME}` });
      await expect(folders.getByRole('button').filter({ hasText: 'Documents' }), 'a protected folder, listed and marked').toContainText('private');
      const use = sheet.getByRole('button', { name: 'Use this folder', exact: true });
      await expect(use, 'not at the home').toBeDisabled();
      for (const name of ['Developer', 'GitHub', A_PROJECT]) await folders.getByRole('button', { name, exact: true }).click();
      await expect(sheet.getByText(`~/Developer/GitHub/${A_PROJECT}`, { exact: true }), 'the checkout shown').toBeVisible();
      await use.click();
    });

    await test.step('B reads the folder’s trust and shows its card; Trust registers it on B, the chip names B’s project there, and the tab targets B', async () => {
      const card = page.getByRole('dialog', { name: `Trust this folder on ${B_NAME}?` });
      await quoting(expect(card, 'B’s trust card: the folder isn’t trusted there').toBeVisible({ timeout: 60_000 }), async () => `the sheet: ${await sheet.innerText().catch(() => 'gone')}\n${mainSaid(page)}\n${await bSaid()}`);
      await expect(card).toContainText(bCheckout);
      await expect(card.getByRole('button', { name: 'Start without trusting' }), 'no start without trusting on another machine').toHaveCount(0);
      await card.getByRole('button', { name: 'Trust', exact: true }).click();
      await quoting(expect(page.getByRole('dialog', { name: /^(New project|Trust this folder) on / }), 'the sheet closes once B registered the folder').toHaveCount(0, { timeout: 60_000 }), async () => `${mainSaid(page)}\n${await bSaid()}`);
      await expect.poll(bProjects, { timeout: 30_000, message: 'B registered the folder' }).toContain(bCheckout);
      await expect(projectChip(page, A_PROJECT), 'the chip names B’s project of the folder').toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: `Machine ${B_NAME}`, exact: true })).toBeVisible();
      await expect(main(page).getByText(`Lane B on ${B_NAME} · ${B_NAME}’s inference route`)).toBeVisible();
    });

    let spawnedApp = '';
    let address = '';
    await test.step('the brief’s Send spawns on B with the trust accepted: B runs its trust bootstrap, then the session, which opens in A’s pane and shows as a row in A’s group', async () => {
      await composerOf(page).click();
      await page.keyboard.type(M9_BRIEF);
      await page.keyboard.press('Enter');
      type Live = { appSessionId: string; engineSessionId: string | null };
      // the session's pin is the replay list's second launch: the first, the trust bootstrap, ran before it
      await expect
        .poll(async () => (spawnedApp = (await b.request<Live[]>('engine.sessions')).find((s) => s.engineSessionId === M9_SPAWNED)?.appSessionId ?? ''), {
          timeout: 120_000,
          intervals: [100],
          message: 'B’s engine host runs the spawned session, after its trust bootstrap',
        })
        .not.toBe('')
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await paneSaid(page)}\n${mainSaid(page)}\n${await bSaid()}`);
        });
      address = addressOf(b.ref, spawnedApp);
      await scene!.sminos.list({ engine: M9_SPAWNED, app: spawnedApp, owners: [scene!.member], project: PROJECT, title: M9_TITLE, cwd: bCheckout });
      expect(bareOf(await movedTo(page, b.ref, null, bSaid)), 'the New chat tab moved to the session B started').toBe(spawnedApp);
      await expect(main(page).getByText(M9_REPLY).first(), `its turn in A's pane\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      expect((await b.request<{ directory: string } | null>('session.get', { appSessionId: spawnedApp }))?.directory, 'it runs in the folder set up on B').toBe(bCheckout);
      await openProject(page, A_PROJECT);
      const row = projectRow(page, A_PROJECT).locator(`[role="treeitem"][data-tree-id="s:${address}"]`);
      await quoting(expect(row, 'its row in A’s group').toBeVisible({ timeout: 60_000 }), async () => `the group's rows: ${(await projectRow(page, A_PROJECT).locator('[data-kind="session"], [data-kind="listed"]').allTextContents()).join(' | ')}\n${mainSaid(page)}`);
    });

    await test.step('B started it on its own default route, the machine’s own: B’s status names the login it reached, and A’s Session info names it in the Route row', async () => {
      type Gateway = { mode: string; verified: string; route?: string; observed?: { kind: string; login?: string; organization?: string } };
      await expect
        .poll(async () => (await b.request<{ gateway: Gateway }>('session.status', { appSessionId: spawnedApp })).gateway, { timeout: 30_000, message: 'B’s status of the session' })
        .toMatchObject({ mode: 'direct', verified: 'direct', route: 'machine', observed: { kind: 'login', login: M9_LOGIN, organization: M9_ORGANIZATION } });
      await openSurface(page, 'Session info');
      const route = surface(page, 'session-info').locator('[data-session-info]').getByRole('term').filter({ hasText: /^Route$/ }).locator('xpath=following-sibling::dd[1]');
      await quoting(expect(route, 'the Route row names what B reports').toContainText(`The machine’s own · Anthropic login · ${M9_LOGIN}`, { timeout: 30_000 }), async () => `Session info: ${await surface(page, 'session-info').innerText().catch(() => 'none')}\n${mainSaid(page)}`);
      console.log(`[e2e:remote] M9: ${address} on B's own route; Session info's Route row: ${await route.innerText()}`);
    });
  } finally {
    await a?.cleanup();
    await scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// Machine first (the owner's ask of 2026-11-06: "let machine be chosable without choosing project. If I just want to open
// a session on mini, in a certain directory with no git, I should be able to"), on e2e:remote's scene over the relay, B's
// HOME a folder of the scene's own as in M9, nothing trusted on B. A New chat tab's machine chip opens whenever A reaches
// another machine, project or none, and with B chosen the project chip offers B's places. From A, which has no project
// of its own: a New chat tab, B chosen; "New project" on B walks B's home to a folder that no git repository holds, B's
// trust card for it, Trust and the registration, and the brief's Send starts the session there (B's trust bootstrap, then
// the session, as M9's); then a second New chat tab, B and "Don't work in a project": the first Send is refused
// untrusted (B's home is trusted nowhere) and the tab keeps its text, the toast's Review trust… shows B's trust card for
// its home, Trust and start sends again, and B starts the session in its home with no project. Claude Code never saves
// trust for a home folder, so that start runs no bootstrap (services/sessions/launch-mapping.ts, `trustMapping`: each
// launch attests it), and B's replay list holds none before the home session's journal.
// In A's sidebar both sessions sit under B's machine row: each is listed under a project the key table gives no row key
// (a listing's `orgKey` is the table's entry for its project, main/org/rows.ts), so its listing files under its machine,
// and the record A reads over the link files where its listing is, whether or not B's registry entry for the folder
// has reached A (stores/org-projects.ts, ticket 644).
const MF_FOLDER_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000c8'; // the engine session ids the journals pin
const MF_HOME_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000c9';
const MF_FOLDER = ['Scratch', 'loose-notes'] as const; // the folder's path from B's home, no git repository on it
const MF_FOLDER_BRIEF = 'Start on B in the loose folder.';
const MF_FOLDER_REPLY = 'Started on B in a folder with no git.';
const MF_HOME_BRIEF = 'Start on B in no project.';
const MF_HOME_REPLY = 'Started on B in its home.';
// sminos's projects and titles for the two sessions' listings: no `.smns` names either folder, and no project of A's joins
const MF_FOLDER_LISTED = { project: 'e2e-remote-loose', title: 'B’s session in a folder with no git' };
const MF_HOME_LISTED = { project: 'e2e-remote-home', title: 'B’s session in its home' };
const DONT_WORK_IN_A_PROJECT = "Don't work in a project";
const HOME_TRUST = 'Claude Code never saves trust for your home folder'; // a home's trust card (TrustCard.tsx, HOME_TRUST_COPY)

// The sidebar's New chat with no project of A's to start in (sessions.spec.ts's "New chat from the project list"): its
// tab's intent, in no project, in the mode B's journals and B's ceiling take (as `newChat`'s).
async function newChatInNoProject(page: Page): Promise<void> {
  type Intents = { intents: { appSessionId: string; projectId: string | null }[] };
  const known = new Set((await invoke<Intents>(page, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId));
  const fresh = async () => (await invoke<Intents>(page, 'session.intent.list', undefined)).intents.find((i) => !known.has(i.appSessionId));
  await sidebarOf(page).getByRole('button', { name: 'New chat', exact: true }).click();
  await expect.poll(fresh, { timeout: 30_000, message: 'the New chat tab’s intent' }).toBeDefined();
  const tab = (await fresh())!;
  expect(tab.projectId, 'the New chat tab is in no project').toBeNull();
  await invoke(page, 'session.intent.patch', { appSessionId: tab.appSessionId, patch: { permissionMode: 'default' } });
  await expect(projectChip(page, null), 'its project chip, no place chosen').toBeVisible({ timeout: 30_000 });
}
// A New chat tab's machine chip, enabled with no project chosen, and `name` chosen in its menu, where each machine is a
// choice of its own whatever it holds; the chip and the line under the row then name it (`chooseMachine`'s checks).
async function chooseMachineFirst(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Machine This Mac', exact: true });
  await quoting(expect(trigger, 'the machine chip, with no project chosen').toBeEnabled({ timeout: 30_000 }), async () => `the chip's title: ${(await trigger.getAttribute('title', { timeout: 1_000 }).catch(() => null)) ?? 'no chip'}\n${mainSaid(page)}`);
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Choose a machine' });
  await quoting(menu.getByRole('menuitemradio', { name, exact: true }).click({ timeout: 30_000 }), async () => `the menu: ${await menu.innerText({ timeout: 1_000 }).catch(() => 'gone')}\n${mainSaid(page)}`);
  await expect(page.getByRole('button', { name: `Machine ${name}`, exact: true })).toBeVisible();
  await expect(main(page).getByText(`Lane B on ${name} · ${name}’s inference route`)).toBeVisible();
}

test('machine first: a New chat tab with no project starts on B, in a folder with no git that New project registers there, and with Don’t work in a project in B’s home once its trust is reviewed', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-mf-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-mf-'));
  const journals = join(root, 'journals');
  const bHome = join(root, 'b-home');
  const folder = join(bHome, ...MF_FOLDER);
  const folderName = MF_FOLDER[MF_FOLDER.length - 1];
  mkdirSync(journals);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'notes.txt'), 'Notes on B, in no repository.\n');
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  try {
    // B's engine reports M9's login, so B's own default route verifies as it does there
    const login = [{ label: 'Login', value: M9_LOGIN }, { label: 'Organization', value: M9_ORGANIZATION }];
    const inFolder = new SideJournal(MF_FOLDER_SESSION, folder, login);
    inFolder.turn(MF_FOLDER_REPLY);
    const folderFixture = inFolder.write(journals, 'b-mf-folder');
    const atHome = new SideJournal(MF_HOME_SESSION, bHome, login);
    atHome.turn(MF_HOME_REPLY);
    const homeFixture = atHome.write(journals, 'b-mf-home');
    scene = await startRemoteScene({
      scratch: join(root, 'scene'),
      aUserData,
      b: {
        root: '/tmp', // as M9's: the replay writes a session's transcript only into a config home that is its own real path
        // B's launches in order: the folder's trust bootstrap, the folder's session, then the home's session, which no
        // bootstrap precedes (a home's trust is attested at each launch); the refused start launches nothing
        env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: [M9_BOOTSTRAP, folderFixture, homeFixture].join(','), HOME: bHome, DISABLE_AUTOUPDATER: '1' },
        // onboarding done and the journals' mode; nothing trusted, B's home included, so both trust cards are B's own
        prepare: ({ claudeConfigDir }) => {
          writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: {} }));
          writeFileSync(join(claudeConfigDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }));
        },
      },
    });
    const { b } = scene;
    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A', MAWS_E2E_STEP_UP: 'accept' } }); // the registration's and the spawns' step-ups, accepted
    keepMainLines(a);
    const { page } = a;
    await expect.poll(async () => (await machineOf(page, b.ref))?.state ?? null, { timeout: 60_000, message: `A's link to B comes up over the relay\n${mainSaid(page)}` }).toBe('up');
    const bSaid = async () => {
      const engines = await b.request<unknown[]>('engine.sessions').catch((error: unknown) => String(error));
      const lines = b.log().split('\n').filter((line) => /spawn|session\.(create|start|intent|projects|trust)|machine\.(op|folders|setupTrust)|step-up|refus|setup|trust|replay|endpoint|route/i.test(line));
      return `B's engine sessions: ${JSON.stringify(engines)}\nB's log:\n${lines.slice(-40).join('\n')}`;
    };
    type Live = { appSessionId: string; engineSessionId: string | null };
    const enginesOnB = async () => (await b.request<Live[]>('engine.sessions')).map((s) => s.engineSessionId);
    const projectsOnB = async () => (await b.request<{ projects: { id: string; directory: string }[] }>('session.projects.list')).projects;
    const recordOnB = (app: string) => b.request<{ directory: string; projectId: string | null } | null>('session.get', { appSessionId: app });
    // The app session B's engine host runs under the engine session id `engine`, once it runs it.
    const runsOnB = async (engine: string, what: string): Promise<string> => {
      let app = '';
      await quoting(
        expect.poll(async () => (app = (await b.request<Live[]>('engine.sessions')).find((s) => s.engineSessionId === engine)?.appSessionId ?? ''), { timeout: 120_000, intervals: [100], message: what }).not.toBe(''),
        async () => `${await paneSaid(page)}\n${mainSaid(page)}\n${await bSaid()}`,
      );
      return app;
    };
    // A session's row under B's machine row in A's sidebar (`p:machine:<B>`, named B); a failure names every row there is.
    const sidebarSaid = async () => {
      const projects = await sidebarOf(page).locator('[data-kind="project"]').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-tree-id')} "${el.getAttribute('aria-label')}"`)).catch(() => []);
      const sessions = await sidebarOf(page).locator('[role="treeitem"][data-tree-id^="s:"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-tree-id'))).catch(() => []);
      return `the sidebar's project rows: ${projects.join('; ') || 'none'}\nits session rows: ${sessions.join('; ') || 'none'}\n${mainSaid(page)}`;
    };
    const underB = async (address: string, what: string) => {
      await quoting(expect(machineRow(page, b.ref), 'B’s machine row in A’s sidebar').toBeVisible({ timeout: 60_000 }), sidebarSaid);
      await expandMachine(page, b.ref);
      await quoting(expect(machineRow(page, b.ref).locator(`[role="treeitem"][data-tree-id="s:${address}"]`), what).toBeVisible({ timeout: 60_000 }), sidebarSaid);
    };

    await test.step('a New chat tab with no project: its machine chip is enabled and opens, and B is chosen; on B no place is chosen yet', async () => {
      await newChatInNoProject(page);
      await chooseMachineFirst(page, B_NAME);
      await expect(projectChip(page, null), 'on B, no place chosen yet').toBeVisible();
    });

    const sheet = page.getByRole('dialog', { name: `New project on ${B_NAME}` });
    let folderAddress = '';
    await test.step('New project on B: B’s folder sheet walked to a folder in B’s home that no git repository holds, trusted on B and registered there; the chip names B’s new project, and Send starts the session in it on B, after B’s trust bootstrap', async () => {
      await projectChip(page, null).click();
      await expect(placesMenu(page).getByPlaceholder('Search projects'), 'the menu this Mac’s project chip has').toBeVisible();
      await expect(placeItem(page, DONT_WORK_IN_A_PROJECT)).toBeVisible();
      await placeItem(page, 'New project').click();
      await quoting(expect(sheet, 'B’s folder sheet').toBeVisible({ timeout: 30_000 }), async () => `the dialogs: ${(await page.getByRole('dialog').allInnerTexts().catch(() => [])).join(' | ') || 'none'}\n${mainSaid(page)}\n${await bSaid()}`);
      await expect(sheet, 'the privacy warning first').toContainText('Private folders macOS protects');
      const folders = sheet.getByRole('list', { name: `Folders on ${B_NAME}` });
      for (const name of MF_FOLDER) await folders.getByRole('button', { name, exact: true }).click();
      await expect(sheet.getByText(`~/${MF_FOLDER.join('/')}`, { exact: true }), 'the folder shown').toBeVisible();
      await sheet.getByRole('button', { name: 'Use this folder', exact: true }).click();
      const card = page.getByRole('dialog', { name: `Trust this folder on ${B_NAME}?` });
      await quoting(expect(card, 'B’s trust card: the folder isn’t trusted there').toBeVisible({ timeout: 60_000 }), async () => `the sheet: ${await sheet.innerText({ timeout: 1_000 }).catch(() => 'gone')}\n${mainSaid(page)}\n${await bSaid()}`);
      await expect(card).toContainText(folder);
      await card.getByRole('button', { name: 'Trust', exact: true }).click();
      await quoting(expect(page.getByRole('dialog', { name: /^(New project|Trust this folder) on / }), 'the sheet closes once B registered the folder').toHaveCount(0, { timeout: 60_000 }), async () => `${mainSaid(page)}\n${await bSaid()}`);
      await expect.poll(async () => (await projectsOnB()).map((p) => p.directory), { timeout: 30_000, message: 'B registered the folder' }).toContain(folder);
      await expect(projectChip(page, folderName), 'the chip names B’s new project').toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: `Machine ${B_NAME}`, exact: true }), 'still on B').toBeVisible();

      await composerOf(page).click();
      await page.keyboard.type(MF_FOLDER_BRIEF);
      await page.keyboard.press('Enter');
      // the session's pin is the second launch on B's replay list: the first, the trust bootstrap, ran before it
      const app = await runsOnB(MF_FOLDER_SESSION, 'B’s engine host runs the folder’s session, after its trust bootstrap');
      folderAddress = addressOf(b.ref, app);
      await scene!.sminos.list({ engine: MF_FOLDER_SESSION, app, owners: [scene!.member], ...MF_FOLDER_LISTED, cwd: folder });
      expect(bareOf(await movedTo(page, b.ref, null, bSaid)), 'the New chat tab moved to the session B started').toBe(app);
      await expect(main(page).getByText(MF_FOLDER_REPLY).first(), `its turn in A's pane\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      const record = await recordOnB(app);
      expect(record?.directory, 'it runs in the folder on B').toBe(folder);
      expect(record?.projectId, 'in the project B registered for the folder').toBe((await projectsOnB()).find((p) => p.directory === folder)?.id);
      await underB(folderAddress, 'its row under B’s machine row: its listing’s project has no row key on A');
    });

    await test.step('a second New chat tab, B and Don’t work in a project: the first Send is refused untrusted, Review trust… shows B’s trust card for its home, and Trust and start sends again, so B starts the session in its home with no project', async () => {
      await newChatInNoProject(page);
      await chooseMachineFirst(page, B_NAME);
      await projectChip(page, null).click();
      await expect(placeItem(page, folderName), 'B’s own projects, the folder registered there among them').toBeVisible({ timeout: 30_000 });
      await placeItem(page, DONT_WORK_IN_A_PROJECT).click();
      await expect(projectChip(page, 'No project'), 'the chip says so').toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: `Machine ${B_NAME}`, exact: true }), 'still on B').toBeVisible();

      await composerOf(page).click();
      await page.keyboard.type(MF_HOME_BRIEF);
      await page.keyboard.press('Enter');
      // B's home is trusted nowhere: B refuses the start (`untrusted`), launching nothing, and the tab keeps its text; the
      // toast offers the trust card (read before the card's sheet hides the composer, and clicked while the toast lasts)
      const review = page.locator('[data-toast-viewport]').getByRole('button', { name: 'Review trust…', exact: true });
      await quoting(expect(review, 'the refusal’s toast offers B’s trust card').toBeVisible({ timeout: 120_000 }), async () => `${await paneSaid(page)}\n${mainSaid(page)}\n${await bSaid()}`);
      expect(await enginesOnB(), 'nothing started on B').not.toContain(MF_HOME_SESSION);
      await expect(composerOf(page), 'the refused Send kept the brief').toContainText(MF_HOME_BRIEF);
      await review.click();
      const card = page.getByRole('dialog', { name: `Trust this folder on ${B_NAME}?` });
      await quoting(expect(card, 'B’s trust card names its home').toContainText(bHome, { timeout: 60_000 }), async () => `the card: ${await card.innerText({ timeout: 1_000 }).catch(() => 'none')}\n${mainSaid(page)}\n${await bSaid()}`);
      await expect(card, 'a home’s trust, which Claude Code never saves').toContainText(HOME_TRUST);
      await card.getByRole('button', { name: 'Trust and start', exact: true }).click();

      // no bootstrap for a home: the session's pin is the next launch on B's replay list
      const app = await runsOnB(MF_HOME_SESSION, 'B’s engine host runs the home’s session, its trust attested at the launch');
      const address = addressOf(b.ref, app);
      await scene!.sminos.list({ engine: MF_HOME_SESSION, app, owners: [scene!.member], ...MF_HOME_LISTED, cwd: bHome });
      expect(bareOf(await movedTo(page, b.ref, folderAddress, bSaid)), 'the second New chat tab moved to the session B started').toBe(app);
      await expect(main(page).getByText(MF_HOME_REPLY).first(), `its turn in A's pane\n${mainSaid(page)}`).toBeVisible({ timeout: 60_000 });
      expect(await recordOnB(app), 'it runs in B’s home, in no project').toMatchObject({ directory: bHome, projectId: null });
      await underB(address, 'its row under B’s machine row, where another machine’s sessions in no project sit');
      console.log(`[e2e:remote] machine first: ${folderAddress} in ${folder}, ${address} in B's home, both under B's machine row`);
    });
  } finally {
    await a?.cleanup();
    await scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// A subagent of B's lane B session, drilled into from A (the owner's report of 2026-11-06: the drill-in showed "a
// subagent's own rows aren't carried from another machine yet" in place of the agent's transcript). On e2e:remote's
// scene over the relay, A starts the session on B with "+ Session"; its first turn starts a background agent (the frames
// of `subagent.jsonl`'s first agent) that replies, holds, replies again, holds and ends. From A's Subagents tool, in order:
// the drill-in into the running agent shows the reply it gave before it was opened (the session's slice for the agent,
// read over the link); the next reply shows in it as B's engine gives it (the session's stream); and once the agent
// ends, its work folds behind its last reply as a local agent's does, still from the stream: nothing on B follows the
// agent's transcript for A, whose one disk window would cross the link as one answer.
const SUB_SPAWNED = 'b0c0d0e0-0000-4000-8000-0000000000b8'; // the engine session id the session's journal pins
const SUB_TITLE = 'B’s session with an agent';
const SUB_BRIEF = 'Start an agent on B.';
const SUB_AGENT = { id: 'ab5e2e00000000001', description: 'Survey the checkout on B' };
const SUB_FIRST = 'The agent on B is reading the checkout.';
const SUB_SECOND = 'The agent on B found one file.';
const SUB_SUMMARY = 'One file on B.'; // the engine's summary of the agent at its end

test('a subagent of B’s lane B session, drilled into from A: the rows it gave before, the next as B’s engine gives it, and its work folded once it ends', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-agent-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-agent-'));
  const checkout = join(root, 'b-checkout');
  const journals = join(root, 'journals');
  const hooks = join(root, 'no-hooks');
  const aCheckout = join(root, A_PROJECT);
  for (const dir of [checkout, journals, hooks, aCheckout]) mkdirSync(dir);
  checkoutRepository(checkout, hooks);
  checkoutRepository(aCheckout, hooks);
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  try {
    // B's session: the brief's turn starts the agent, which replies and reads a file, holds (until the spec asks B's
    // engine its context usage), replies again, holds, and ends; the turn itself goes on with no reply of its own
    const journal = new SideJournal(SUB_SPAWNED, checkout);
    journal.prompt();
    const agent = journal.agent(SUB_AGENT.id, SUB_AGENT.description);
    agent.text(SUB_FIRST);
    agent.read();
    journal.holdAtContextUsage();
    agent.text(SUB_SECOND);
    journal.holdAtContextUsage();
    agent.completed(SUB_SUMMARY);
    const fixture = journal.write(journals, 'b-agent');

    scene = await startRemoteScene({
      scratch: join(root, 'scene'),
      aUserData,
      b: {
        root: '/tmp', // as M8's: the replay writes the session's transcript only into a config home that is its own real path
        env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixture, DISABLE_AUTOUPDATER: '1' },
        prepare: ({ claudeConfigDir }) => {
          writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [checkout]: { hasTrustDialogAccepted: true } } }));
          writeFileSync(join(claudeConfigDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }));
        },
      },
    });
    const { b } = scene;
    await b.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    await b.request('session.projects.add', { directory: checkout }); // B's checkout of the org project, which "+ Session" offers

    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A', MAWS_E2E_STEP_UP: 'accept' } }); // the spawn's step-up, accepted
    keepMainLines(a);
    const { page } = a;
    await expect.poll(async () => (await machineOf(page, b.ref))?.state ?? null, { timeout: 60_000, message: `A's link to B comes up over the relay\n${mainSaid(page)}` }).toBe('up');
    type Projects = { projects: { directory: string; org?: { key: string } }[] };
    await invoke(page, 'session.projects.add', { directory: aCheckout });
    await expect
      .poll(async () => (await invoke<Projects>(page, 'session.projects.list', undefined)).projects.find((p) => p.directory === aCheckout)?.org?.key ?? null, { timeout: 30_000 })
      .toBe(`smns:${PROJECT}`);
    const bSaid = async () => {
      const engines = await b.request<unknown[]>('engine.sessions').catch((error: unknown) => String(error));
      const lines = b.log().split('\n').filter((line) => /spawn|session\.(create|start|intent)|machine\.op|step-up|refus|replay|endpoint|follow|agent/i.test(line));
      return `B's engine sessions: ${JSON.stringify(engines)}\nB's log:\n${lines.slice(-40).join('\n')}`;
    };

    let spawnedApp = '';
    await test.step('"+ Session" starts the session on B, whose first turn starts the agent', async () => {
      await newChat(page, A_PROJECT);
      await chooseMachine(page, B_NAME);
      await composerOf(page).click();
      await page.keyboard.type(SUB_BRIEF);
      await page.keyboard.press('Enter');
      await expect
        .poll(async () => (spawnedApp = (await b.request<{ appSessionId: string; engineSessionId: string | null }[]>('engine.sessions')).find((s) => s.engineSessionId === SUB_SPAWNED)?.appSessionId ?? ''), {
          timeout: 120_000,
          intervals: [100],
          message: 'B’s engine host runs the spawned session',
        })
        .not.toBe('')
        .catch(async (error: unknown) => {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await paneSaid(page)}\n${mainSaid(page)}\n${await bSaid()}`);
        });
      await scene!.sminos.list({ engine: SUB_SPAWNED, app: spawnedApp, owners: [scene!.member], project: PROJECT, title: SUB_TITLE, cwd: checkout });
      expect(bareOf(await movedTo(page, b.ref, null, bSaid)), 'the New chat tab moved to the session B started').toBe(spawnedApp);
    });

    // the agent's slice of the session as B's engine host holds it (its own rows and the session's reports on it)
    const sliceOnB = async () => JSON.stringify((await b.request<{ events: SessionEvent[] }>('session.events', { appSessionId: spawnedApp, afterSeq: null, limit: null, agentId: SUB_AGENT.id })).events);
    const tool = surface(page, 'subagents');
    const drillIn = tool.locator('[data-view="agent"]');
    const drillInSaid = async () => `the drill-in: ${await drillIn.innerText({ timeout: 1_000 }).catch(() => 'none')}\n${mainSaid(page)}\n${await bSaid()}`;
    await test.step('the drill-in into the running agent shows the reply it gave before the drill-in opened', async () => {
      await expect.poll(async () => (await sliceOnB()).includes(SUB_FIRST), { timeout: 60_000, message: `B's engine gave the agent's first reply\n${await bSaid()}` }).toBe(true);
      expect(await sliceOnB(), 'and holds before its next').not.toContain(SUB_SECOND);
      await openSurface(page, 'Subagents');
      const row = tool.locator(`[data-agent-row="${SUB_AGENT.id}"]`);
      await quoting(expect(row, 'the agent in A’s Subagents tool').toBeVisible({ timeout: 60_000 }), async () => `the tool: ${await tool.innerText().catch(() => 'none')}\n${mainSaid(page)}`);
      await row.click();
      await quoting(expect(drillIn.getByText(SUB_FIRST, { exact: true }), 'its first reply, in the drill-in').toBeVisible({ timeout: 60_000 }), drillInSaid);
      await expect(drillIn.getByTestId('subagent-rows-gap'), 'no gap in place of its rows').toHaveCount(0);
    });

    await test.step('its next reply shows in the open drill-in as B’s engine gives it', async () => {
      await b.request('session.getContextUsage', { appSessionId: spawnedApp, detail: 'summary' }); // lets B's engine go on
      await expect.poll(async () => (await sliceOnB()).includes(SUB_SECOND), { timeout: 30_000, message: `B's engine gave the agent's next reply\n${await bSaid()}` }).toBe(true);
      await quoting(expect(drillIn.getByText(SUB_SECOND, { exact: true }), 'its next reply, appended').toBeVisible({ timeout: 60_000 }), drillInSaid);
      await expect(drillIn.getByText(SUB_FIRST, { exact: true }), 'the first still there, once').toHaveCount(1);
    });

    await test.step('once the agent ends, its work folds behind its last reply, from the stream: nothing on B follows its transcript', async () => {
      await b.request('session.getContextUsage', { appSessionId: spawnedApp, detail: 'summary' }); // lets the agent end
      await quoting(expect(drillIn.getByRole('button', { name: /^Worked for / }), 'its work folded, as a finished local agent’s').toBeVisible({ timeout: 60_000 }), drillInSaid);
      await expect(drillIn.getByText(SUB_SECOND, { exact: true }), 'behind its last reply').toBeVisible();
      await expect(drillIn.getByTestId('subagent-rows-gap')).toHaveCount(0);
      // B's engine host's lines about a follow of the agent's transcript, from every log of B's (M8's way of reading them)
      const prefix = `[fs] follow ${spawnedApp}/${SUB_AGENT.id}: `;
      const followLines = (readdirSync(b.userData, { recursive: true }) as string[])
        .filter((name) => name.endsWith('.log'))
        .flatMap((name) => readFileSync(join(b.userData, name), 'utf8').split('\n'))
        .filter((line) => line.includes(prefix));
      expect(followLines, 'no follow of the agent’s transcript on B').toEqual([]);
      console.log(`[e2e:remote] agent drill-in: ${spawnedApp}/${SUB_AGENT.id} read from the session's stream, running and ended`);
    });
  } finally {
    await a?.cleanup();
    await scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// 2026-11-06 (the remote lane A drill-in): a subagent of a terminal session on B (lane A, which B's sminos serves: no
// engine of B's runs it), drilled into from A, shows the agent's own transcript from B's session plane: a watch naming
// the agent, which A's link sends to B's endpoint behind `rl2.agent-scope` and the endpoint holds as an upstream of the
// agent's own in sminos (the scene's fake, e2e/support/fake-sminos.ts). Its newest row comes with its snapshot and the
// older ones page in at the top; a row the agent writes while A is cut off from B arrives once A is let back, the
// endpoint's ring replaying it under the same upstream; and when sminos ends that upstream (a gap in its bridge's stream)
// the view starts over under a fresh one, every row drawn kept. An endpoint of an earlier build, which lists no
// `rl2.agent-scope`, is asked nothing for the agent: the drill-in names B as the machine to update.
const TERMINAL = { engine: 'b0c0d0e0-0000-4000-8000-0000000000c1', title: 'B’s terminal session', launch: 'L-terminal-1' };
const TERMINAL_ASK = 'Survey the checkout with an agent.';
const TERMINAL_REPLY = 'The agent is surveying B’s checkout.';
const TERMINAL_AGENT = { id: 'ab5e2e000000000c1', description: 'Survey the checkout on B' };
const AGENT_TASK = 'Read each file of the checkout.';
const AGENT_OLDER = 'The agent read the checkout’s first file.';
const AGENT_NEWER = 'The agent read the checkout’s second file.';
const AGENT_WHILE_CUT = 'The agent wrote this while A was cut off.';
const AGENT_AFTER_RESET = 'The agent went on after B’s plane started over.';

/** A row of the terminal session's transcripts, as the engine writes one (the main loop's, or an agent's sidechain). */
function terminalRow(n: number, type: 'user' | 'assistant', text: string, agentId: string | null, cwd: string): PlaneRow {
  const uuid = `c1c1c1c1-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const parentUuid = n === 1 || n === 11 ? null : `c1c1c1c1-0000-4000-8000-${String(n - 1).padStart(12, '0')}`;
  const base = { parentUuid, isSidechain: agentId !== null, ...(agentId !== null && { agentId }), type, uuid, timestamp: new Date(Date.parse('2026-11-06T09:00:00.000Z') + n * 1000).toISOString(), sessionId: TERMINAL.engine, cwd, version: '2.1.312' };
  if (type === 'user') return { ...base, message: { role: 'user', content: text } };
  return { ...base, message: { id: `msg_c1${String(n).padStart(6, '0')}`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } };
}

/** What `terminalAgent` has started, held as each is acquired: the caller's `finally` stops them, A first, whatever failed. */
type TerminalHeld = { scene: RemoteScene | null; a: MawsLaunch | null };

/** The terminal session on B, listed and served, A launched over the relay with B up, and the agent's drill-in opened. */
async function terminalAgent(opts: { root: string; aUserData: string; bEnv?: Record<string, string> }, held: TerminalHeld) {
  const checkout = join(opts.root, 'b-terminal');
  mkdirSync(checkout);
  const agent = TERMINAL_AGENT.id;
  const scene = (held.scene = await startRemoteScene({ scratch: join(opts.root, 'scene'), aUserData: opts.aUserData, ...(opts.bEnv !== undefined && { b: { env: opts.bEnv } }) }));
  const plane = scene.sminos.laneA(PROJECT, {
    engine: TERMINAL.engine,
    title: TERMINAL.title,
    cwd: checkout,
    owners: [scene.member],
    launch: TERMINAL.launch,
    main: [terminalRow(1, 'user', TERMINAL_ASK, null, checkout), terminalRow(2, 'assistant', TERMINAL_REPLY, null, checkout)],
    agents: { [agent]: [terminalRow(11, 'user', AGENT_TASK, agent, checkout), terminalRow(12, 'assistant', AGENT_OLDER, agent, checkout), terminalRow(13, 'assistant', AGENT_NEWER, agent, checkout)] },
    subagents: [{ agentId: agent, meta: { agentType: 'general-purpose', description: TERMINAL_AGENT.description }, status: 'running', evidence: 'bridge' }],
    agentWindow: 1, // the agent's snapshot holds its newest row: the rest page in
  });
  const a = (held.a = await launchMaws({ userData: opts.aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A' } }));
  keepMainLines(a);
  const { page } = a;
  const { b } = scene;
  const said = () => `${mainSaid(page)}\nB's endpoint to sminos:\n${scene.sminos.said().split('\n').slice(-30).join('\n')}`;
  await expect.poll(async () => (await machineOf(page, b.ref))?.state ?? null, { timeout: 60_000, message: `A's link to B comes up over the relay\n${mainSaid(page)}` }).toBe('up');
  await expect
    .poll(async () => (await rowsOf(page)).find((row) => row.machine === b.ref && row.session === TERMINAL.engine) ?? null, { timeout: 60_000, message: `B's terminal session is a row of A's\n${said()}` })
    .toMatchObject({ lane: 'A', title: TERMINAL.title });
  await expandMachine(page, b.ref);
  const row = sessionRow(page, addressOf(b.ref, TERMINAL.engine));
  await expect(row, `the terminal session's row in A's sidebar\n${mainSaid(page)}`).toBeVisible({ timeout: 30_000 });
  await row.click();
  await quoting(expect(main(page).getByText(TERMINAL_REPLY).first(), 'the terminal session’s own transcript in A’s pane').toBeVisible({ timeout: 60_000 }), said);
  await openSurface(page, 'Subagents');
  const tool = surface(page, 'subagents');
  const agentRow = tool.locator(`[data-agent-row="${agent}"]`);
  await quoting(expect(agentRow, 'the agent in A’s Subagents tool').toBeVisible({ timeout: 60_000 }), async () => `the tool: ${await tool.innerText().catch(() => 'none')}\n${said()}`);
  await agentRow.click();
  const drillIn = tool.locator('[data-view="agent"]');
  const drillInSaid = async () => `the drill-in: ${await drillIn.innerText({ timeout: 1_000 }).catch(() => 'none')}\n${said()}`;
  return { scene, page, plane, drillIn, drillInSaid, agent, checkout };
}

test('a subagent of B’s terminal session, drilled into from A: its own rows from B’s plane, older rows paged in, a channel drop and a reset survived', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-la-agent-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-la-agent-'));
  const held: TerminalHeld = { scene: null, a: null };
  try {
    const { scene, page, plane, drillIn, drillInSaid, agent, checkout } = await terminalAgent({ root, aUserData }, held);
    const { b } = scene;
    const once = (text: string) => expect(drillIn.getByText(text, { exact: true }), `"${text}" once in the drill-in`).toHaveCount(1);

    await test.step('the drill-in shows the agent’s own newest row, then pages its older ones in at the top', async () => {
      await quoting(expect(drillIn.getByText(AGENT_NEWER, { exact: true }), 'the agent’s newest row').toBeVisible({ timeout: 60_000 }), drillInSaid);
      await expect(drillIn.getByTestId('subagent-rows-gap'), 'no gap in place of its rows').toHaveCount(0);
      expect(plane.subscribes(agent), 'one upstream of the agent’s own, naming it').toHaveLength(1);
      await quoting(expect(drillIn.getByText(AGENT_OLDER, { exact: true }), 'its older row, paged in').toBeVisible({ timeout: 60_000 }), drillInSaid);
      expect(plane.pages(agent).map((f) => f.before), 'the page asked of the agent’s transcript, before its newest row').toContain('c1c1c1c1-0000-4000-8000-000000000013');
      await expect(main(page).getByText(AGENT_NEWER), 'nothing of the agent’s in the session’s own transcript').toHaveCount(0);
    });

    await test.step('a row the agent writes while A is cut off from B arrives once A is let back, under the same upstream', async () => {
      scene.aHub.cut();
      await expect.poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 60_000, message: `A's link to B goes down once cut\n${mainSaid(page)}` }).toBe('down');
      plane.append(agent, terminalRow(14, 'assistant', AGENT_WHILE_CUT, agent, checkout));
      scene.aHub.restore();
      await expect.poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 120_000, message: `A's link to B comes up again\n${mainSaid(page)}` }).toBe('up');
      await quoting(expect(drillIn.getByText(AGENT_WHILE_CUT, { exact: true }), 'the row written while cut off').toBeVisible({ timeout: 60_000 }), drillInSaid);
      for (const text of [AGENT_OLDER, AGENT_NEWER, AGENT_WHILE_CUT]) await once(text);
      expect(plane.subscribes(agent), 'the resume a replay of the same upstream').toHaveLength(1);
    });

    await test.step('when sminos ends the agent’s upstream, the view starts over under a fresh one, every row drawn kept', async () => {
      plane.end(agent);
      await expect.poll(() => plane.subscribes(agent).length, { timeout: 60_000, message: `a fresh upstream of the agent\n${await drillInSaid()}` }).toBe(2);
      plane.append(agent, terminalRow(15, 'assistant', AGENT_AFTER_RESET, agent, checkout));
      await quoting(expect(drillIn.getByText(AGENT_AFTER_RESET, { exact: true }), 'the row after the fresh snapshot').toBeVisible({ timeout: 60_000 }), drillInSaid);
      for (const text of [AGENT_OLDER, AGENT_NEWER, AGENT_WHILE_CUT, AGENT_AFTER_RESET]) await once(text);
      expect(plane.subscribes(agent).every((f) => f.agentId === agent), 'each upstream names the agent').toBe(true);
      expect(plane.subscribes(null), 'the session’s own upstream untouched by the agent’s').toHaveLength(1);
      console.log(`[e2e:remote] terminal agent drill-in: ${TERMINAL.engine}/${agent} over ${plane.subscribes(agent).length} upstreams, ${plane.pages(agent).length} pages`);
    });
  } finally {
    await held.a?.cleanup();
    await held.scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('a subagent of B’s terminal session, where B’s endpoint lists no rl2.agent-scope: the drill-in names B to update, and nothing is asked of B for the agent', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-la-old-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-la-old-'));
  const held: TerminalHeld = { scene: null, a: null };
  try {
    const { scene, page, plane, drillIn, drillInSaid, agent } = await terminalAgent({ root, aUserData, bEnv: { MAWS_E2E_ENDPOINT_WITHOUT: 'rl2.agent-scope' } }, held); // an endpoint of an earlier build
    expect((await machineOf(page, scene.b.ref))?.capabilities ?? [], 'B’s endpoint lists no rl2.agent-scope').not.toContain('rl2.agent-scope');
    await quoting(expect(drillIn.getByTestId('subagent-rows-gap'), 'the gap, naming B').toHaveText(`${B_NAME} can’t send a subagent’s own transcript to this Mac yet; update MAWS on ${B_NAME}`, { timeout: 60_000 }), drillInSaid);
    await page.waitForTimeout(2_000); // what a watch of the agent would have asked by now
    expect(plane.subscribes(agent), 'nothing asked of B for the agent').toEqual([]);
    expect(plane.subscribes(null), 'the session’s own transcript still read').toHaveLength(1);
  } finally {
    await held.a?.cleanup();
    await held.scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// The UX wave, U9 (docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M3; #563, O-39, S-01): a session tab of
// B's keeps its pane through the link's drop, one status line above it, and the reader keeps their place (A4), for a
// session MAWS runs on B (lane B) and for a terminal session of B's (lane A, which has no record by design); a Stop
// pressed in A reaches B's engine and the turn ends, and one pressed once the link is down reads "Stopping…" and then
// says it did not stop (A11). A's way to B is the hub alone (the relay), so cutting its pipe takes the link down. While
// the link is down the reader also scrolls, selects and copies a paragraph, and sees no error text (`readWhileDown`;
// the pane has no find to read a count from); a second outage with the reader at the end keeps the arriving row in view.
const PLACE_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000d5';
const STOP_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000d6';
const PLACE_TURNS = 10; // enough of B's history for the pane to scroll
const longReply = (turn: number) => Array.from({ length: 12 }, (_, k) => `B’s reply ${turn}, paragraph ${k + 1}.`).join('\n\n');
const WHILE_DOWN_REPLY = 'B answered this while A was cut off.';
const SECOND_DOWN_REPLY = 'B answered this through the second outage.';
const PLACE_DRAFT = 'a draft kept while B reconnects';
const STOP_FIRST_REPLY = 'B is ready to count.';
const STOP_DELTAS = ['Counting ', 'on B: 1, 2, '];
const RECONNECTING = `Reconnecting to ${B_NAME}…`;

// The first row in view of the pane's transcript and its top against the scroller's: the reader's place.
const placeIn = (page: Page) =>
  main(page)
    .locator('[data-transcript-scroller]')
    .first()
    .evaluate((scroller) => {
      const top = scroller.getBoundingClientRect().top;
      const row = Array.from(scroller.querySelectorAll<HTMLElement>('[data-row-id]')).find((r) => r.getBoundingClientRect().bottom > top + 1);
      return row === undefined ? null : { id: row.dataset.rowId!, offset: Math.round(row.getBoundingClientRect().top - top), scrollHeight: scroller.scrollHeight };
    });
// Scrolls the pane's transcript up, as a reader's wheel does, until its place holds still.
async function scrollUp(page: Page): Promise<{ id: string; offset: number; scrollHeight: number }> {
  const scroller = main(page).locator('[data-transcript-scroller]').first();
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1_200);
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await placeIn(page));
    const still = now === last && now !== 'null';
    last = now;
    return still;
  }, { timeout: 10_000, intervals: [250] }).toBe(true);
  return JSON.parse(last) as { id: string; offset: number; scrollHeight: number };
}
// Every alert the main region shows from now on, kept as text: an outage must draw none.
async function keepAlerts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __alerts: string[] }).__alerts = seen;
    const region = document.querySelector('[data-region="main"]')!;
    const look = () => region.querySelectorAll('[role="alert"]').forEach((el) => seen.push(el.textContent ?? ''));
    new MutationObserver(look).observe(region, { subtree: true, childList: true, characterData: true });
    look();
  });
}
const alertsSeen = (page: Page) => page.evaluate(() => (window as unknown as { __alerts: string[] }).__alerts);
const linkLine = (page: Page) => main(page).locator('[data-link-words="line"]');
const primaryOf = (page: Page) => main(page).locator('[data-submit-state]');
const toastsOf = (page: Page) => page.locator('[data-toast-viewport]');
// The pane's error texts, by name: any alert in the main region, the transcript's failed read and older page
// (src/renderer/src/transcript/model/copy.ts's HYDRATION.failed and OLDER.failed), and an act's ending without its
// effect (UC-7.5's "Not sent", "Not stopped").
const PANE_ERRORS = /Couldn’t load this conversation|Older messages didn’t load|Not sent|Not stopped/;
async function paneErrors(page: Page): Promise<string[]> {
  const alerts = await main(page).locator('[role="alert"]').allTextContents();
  const words = await main(page).getByText(PANE_ERRORS).allTextContents();
  return [...alerts.map((t) => `alert: ${t}`), ...words.map((t) => `text: ${t}`)];
}
// The transcript's scroller, and whether its last row is in view (the reader following the end).
const scrollerOf = (page: Page) => main(page).locator('[data-transcript-scroller]').first();
const lastRowInView = (page: Page) =>
  scrollerOf(page).evaluate((scroller) => {
    const rows = scroller.querySelectorAll<HTMLElement>('[data-row-id]');
    const last = rows[rows.length - 1];
    if (last === undefined) return false;
    const box = scroller.getBoundingClientRect();
    const at = last.getBoundingClientRect();
    return at.bottom <= box.bottom + 2 && at.bottom > box.top && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
  });

/**
 * What a reader does in the kept pane while its link is down (A4): scrolls, and the first row in view moves; selects a
 * paragraph of that row and copies it, and the Mac's pasteboard reads it back (webContents' own copy, as Edit ▸ Copy);
 * and sees no error text. MAWS's session pane has no find of its own (⌘F there is unbound: find is the Browser tool's
 * and the document editor's), so a find and its count are not read here. Answers the place left once done.
 */
async function readWhileDown(page: Page, electron: ElectronApplication, before: { id: string }): Promise<{ id: string; offset: number; scrollHeight: number }> {
  const moved = await scrollUp(page);
  expect(moved.id, 'the reader scrolls the kept pane: another first row in view').not.toBe(before.id);
  const copied = await scrollerOf(page).evaluate((scroller, id) => {
    const row = scroller.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    const paragraph = Array.from(row?.querySelectorAll<HTMLElement>('p') ?? []).find((p) => (p.textContent ?? '').trim() !== '');
    if (paragraph === undefined) return null;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  }, moved.id);
  expect(copied, `a paragraph of the row in view (${moved.id}) is selected`).toBeTruthy();
  await withNativeClipboard(electron, [copied!], async () => {
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())!.webContents.copy());
    await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText()), { message: 'the copy reads back from the pasteboard' }).toBe(copied);
  });
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  expect(await paneErrors(page), 'no error text in the pane while the link is down').toEqual([]);
  return (await placeIn(page))!;
}

/**
 * B's lane B session on `journal`, its first turn over and listed; A launched over the relay, the session open in A (with
 * `open: false`, left as A's listed row, no tab of it opened: the UX wave, U9, M4's acts scene).
 *
 * The checkout is a plain folder (no git, no `.smns`), so sminos lists the session under B's own project, its
 * `machine_project_id` (src/shared/machine/project-ids.ts), which is also the project B's registry gives the folder. A
 * machine's own project takes no row key on A, so the session's row stays under B's machine row however its listing,
 * its record and B's registry entry reach A, and in whichever order they arrive (ticket 644's filing).
 */
async function laneBOpened(opts: { root: string; aUserData: string; journal: SideJournal; first: string; firstReply: string; title: string; open?: boolean; launches?: readonly SideJournal[] }, held: TerminalHeld) {
  const checkout = join(opts.root, 'b-checkout');
  const journals = join(opts.root, 'journals');
  for (const dir of [checkout, journals]) mkdirSync(dir);
  // the session's own journal, then one for each later launch on B in turn (the UX wave, U9: a fork's)
  const fixture = [opts.journal.write(journals, 'b-session'), ...(opts.launches ?? []).map((launch, i) => launch.write(journals, `b-launch-${i + 1}`))].join(',');
  const scene = (held.scene = await startRemoteScene({
    scratch: join(opts.root, 'scene'),
    aUserData: opts.aUserData,
    b: {
      root: '/tmp', // as M8's: the replay writes the session's transcript only into a config home that is its own real path
      env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixture, DISABLE_AUTOUPDATER: '1' },
      prepare: ({ claudeConfigDir }) => {
        writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [checkout]: { hasTrustDialogAccepted: true } } }));
        writeFileSync(join(claudeConfigDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }));
      },
    },
  }));
  const { b } = scene;
  await b.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
  const project = await b.request<{ id: string }>('session.projects.add', { directory: checkout });
  const app = (await b.request<{ appSessionId: string }>('session.create', { projectId: project.id, location: null })).appSessionId;
  await b.request('session.intent.patch', { appSessionId: app, patch: { gateway: 'direct' } });
  type Status = { process: string; turn: unknown; engineSessionId: string | null };
  const status = () => b.request<Status>('session.status', { appSessionId: app }).catch(() => null);
  const turnOver = async () => {
    const s = await status();
    return s !== null && s.process === 'ready' && s.turn === null;
  };
  const started = await b.request<{ status: string }>('session.start', { appSessionId: app, message: { content: opts.first, display: opts.first }, options: {} });
  expect(started.status, `B's session starts: ${JSON.stringify(started)}`).not.toBe('needs_trust');
  await expect.poll(turnOver, { timeout: 60_000, message: `B's session ends its first turn\n${b.log().slice(-4000)}` }).toBe(true);
  /** One more turn of B's own, written over its machine.sock as its own app's composer would. */
  const sendOnB = (content: string) => b.request('session.send', { appSessionId: app, content });
  const engine = (await status())?.engineSessionId ?? opts.journal.sessionId;
  const a = (held.a = await launchMaws({ userData: opts.aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A' } }));
  keepMainLines(a);
  const { page } = a;
  await expect.poll(async () => (await machineOf(page, b.ref))?.state ?? null, { timeout: 60_000, message: `A's link to B comes up over the relay\n${mainSaid(page)}` }).toBe('up');
  const bProject = machineProjectId((await scene.org.chain()).org, B_NAME);
  await scene.sminos.list({ engine, app, owners: [scene.member], project: bProject, title: opts.title, cwd: checkout });
  await expect.poll(async () => (await rowsOf(page)).some((row) => row.machine === b.ref && row.session === app), { timeout: 60_000, message: `B's session is a row of A's\n${mainSaid(page)}` }).toBe(true);
  await expandMachine(page, b.ref);
  const row = sessionRow(page, addressOf(b.ref, app));
  await expect(row, `B's row in A's sidebar\n${mainSaid(page)}`).toBeVisible({ timeout: 30_000 });
  if (opts.open !== false) {
    await row.click();
    await quoting(expect(main(page).getByText(opts.firstReply).first(), 'B’s history in A’s pane').toBeVisible({ timeout: 60_000 }), () => mainSaid(page));
  }
  return { scene, b, page, electron: a.app, turnOver, sendOnB, app, bProject };
}

test('U9 A4, a session MAWS runs on B: its tab keeps its pane through the link’s drop under one status line, and the reader keeps their place, their draft and no error', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-place-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-place-'));
  const held: TerminalHeld = { scene: null, a: null };
  try {
    const journal = new SideJournal(PLACE_SESSION, join(root, 'b-checkout'));
    for (let turn = 1; turn <= PLACE_TURNS; turn += 1) journal.turn(longReply(turn));
    journal.turn(WHILE_DOWN_REPLY);
    journal.turn(SECOND_DOWN_REPLY);
    const { scene, b, page, electron, turnOver, sendOnB } = await laneBOpened({ root, aUserData, journal, first: 'Write the first long reply.', firstReply: 'B’s reply 1, paragraph 1.', title: 'B’s long session' }, held);
    // B's history, written on B before A reads it again
    for (let turn = 2; turn <= PLACE_TURNS; turn += 1) {
      await sendOnB(`Write long reply ${turn}.`);
      await expect.poll(turnOver, { timeout: 60_000 }).toBe(true);
    }
    await quoting(expect(main(page).getByText(`B’s reply ${PLACE_TURNS}, paragraph 12.`).first(), 'B’s last reply in A’s pane').toBeVisible({ timeout: 60_000 }), () => mainSaid(page));

    let place = await scrollUp(page);
    await composerOf(page).click();
    await page.keyboard.type(PLACE_DRAFT);
    const pane = await main(page).locator('[data-transcript-scroller]').first().elementHandle();
    await keepAlerts(page);

    await test.step('the link down: the line says B reconnects, over the same pane, and a reply B writes meanwhile waits', async () => {
      scene.aHub.cut();
      await quoting(expect(linkLine(page), 'the status line above the kept pane').toHaveText(RECONNECTING, { timeout: 60_000 }), () => mainSaid(page));
      await expect(main(page).locator('[data-link-words="middle"]'), 'no words in the pane’s place').toHaveCount(0);
      expect(await pane!.evaluate((node) => node.isConnected), 'the same pane, still mounted').toBe(true);
      await sendOnB('Answer while A is cut off.');
      await expect.poll(turnOver, { timeout: 60_000 }).toBe(true);
      expect((await machineOf(page, b.ref))?.state, 'A has not seen it').not.toBe('up');
      place = await readWhileDown(page, electron, place);
      await expect(linkLine(page), 'still down, the line still above the pane').toHaveText(RECONNECTING);
    });

    await test.step('the link back: the same first row at the same place, the new reply below it, the draft, and no error drawn', async () => {
      scene.aHub.restore();
      await expect.poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 120_000, message: `A's link to B comes up again\n${mainSaid(page)}` }).toBe('up');
      await expect(linkLine(page), 'the line gone with the link up').toHaveCount(0);
      await expect.poll(async () => ((await placeIn(page))?.scrollHeight ?? 0) > place.scrollHeight, { timeout: 60_000, message: 'the reply written meanwhile joins the transcript' }).toBe(true);
      const after = (await placeIn(page))!;
      expect(after.id, 'the same first row in view').toBe(place.id);
      expect(Math.abs(after.offset - place.offset), `at the same place (${place.offset} px, then ${after.offset} px)`).toBeLessThanOrEqual(2);
      expect(await pane!.evaluate((node) => node.isConnected), 'the same pane throughout').toBe(true);
      await expect(composerOf(page), 'the draft kept').toHaveText(PLACE_DRAFT);
      expect(await alertsSeen(page), 'no error drawn in the pane').toEqual([]);
      const scroller = main(page).locator('[data-transcript-scroller]').first();
      await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
      await expect(main(page).getByText(WHILE_DOWN_REPLY).first(), 'the reply below, once scrolled to').toBeVisible({ timeout: 30_000 });
    });

    await test.step('a second down and up with the reader at the end: the reply that arrives is in view', async () => {
      await expect.poll(() => lastRowInView(page), { timeout: 10_000, message: 'the reader follows the end' }).toBe(true);
      scene.aHub.cut();
      await quoting(expect(linkLine(page)).toHaveText(RECONNECTING, { timeout: 60_000 }), () => mainSaid(page));
      await sendOnB('Answer through the second outage.');
      await expect.poll(turnOver, { timeout: 60_000 }).toBe(true);
      scene.aHub.restore();
      await expect.poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 120_000, message: `A's link to B comes up again
${mainSaid(page)}` }).toBe('up');
      await expect(main(page).getByText(SECOND_DOWN_REPLY).first(), 'the reply that arrived').toBeVisible({ timeout: 60_000 });
      await expect.poll(() => lastRowInView(page), { timeout: 10_000, message: 'the last row in view: the reader still follows' }).toBe(true);
      expect(await paneErrors(page)).toEqual([]);
    });
  } finally {
    await held.a?.cleanup();
    await held.scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('U9 A4, a terminal session of B’s: its recordless pane stays through the link’s drop under one status line, and the reader keeps their place, their draft and no error', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-la-place-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-la-place-'));
  const held: TerminalHeld = { scene: null, a: null };
  try {
    const checkout = join(root, 'b-terminal');
    mkdirSync(checkout);
    const scene = (held.scene = await startRemoteScene({ scratch: join(root, 'scene'), aUserData }));
    const { b } = scene;
    const engine = 'b0c0d0e0-0000-4000-8000-0000000000d7';
    // The main transcript, chained: an ask and a long answer per turn (terminalRow's numbering, from 101)
    const rows: PlaneRow[] = [];
    const add = (type: 'user' | 'assistant', text: string) => {
      const n = 101 + rows.length;
      const row: PlaneRow = { ...terminalRow(n, type, text, null, checkout), sessionId: engine, parentUuid: rows.at(-1)?.uuid ?? null };
      rows.push(row);
      return row;
    };
    for (let turn = 1; turn <= PLACE_TURNS; turn += 1) {
      add('user', `Write long reply ${turn}.`);
      add('assistant', longReply(turn));
    }
    const plane = scene.sminos.laneA(PROJECT, { engine, title: 'B’s long terminal session', cwd: checkout, owners: [scene.member], launch: 'L-terminal-place', main: rows, agents: {}, subagents: [] });
    const a = (held.a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A' } }));
    keepMainLines(a);
    const { page } = a;
    await expect.poll(async () => (await machineOf(page, b.ref))?.state ?? null, { timeout: 60_000, message: `A's link to B comes up over the relay\n${mainSaid(page)}` }).toBe('up');
    await expect
      .poll(async () => (await rowsOf(page)).find((row) => row.machine === b.ref && row.session === engine) ?? null, { timeout: 60_000, message: `B's terminal session is a row of A's\n${mainSaid(page)}` })
      .toMatchObject({ lane: 'A' });
    await expandMachine(page, b.ref);
    const row = sessionRow(page, addressOf(b.ref, engine));
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await quoting(expect(main(page).getByText(`B’s reply ${PLACE_TURNS}, paragraph 12.`).first(), 'the terminal session’s transcript in A’s pane').toBeVisible({ timeout: 60_000 }), () => mainSaid(page));

    let place = await scrollUp(page);
    await composerOf(page).click();
    await page.keyboard.type(PLACE_DRAFT);
    const pane = await main(page).locator('[data-transcript-scroller]').first().elementHandle();
    await keepAlerts(page);

    await test.step('the link down: the line says B reconnects, over the same pane, and rows the session writes meanwhile wait', async () => {
      scene.aHub.cut();
      await quoting(expect(linkLine(page), 'the status line above the kept pane').toHaveText(RECONNECTING, { timeout: 60_000 }), () => mainSaid(page));
      await expect(main(page).locator('[data-link-words="middle"]'), 'no words in the pane’s place').toHaveCount(0);
      expect(await pane!.evaluate((node) => node.isConnected), 'the same pane, still mounted').toBe(true);
      plane.append(null, add('user', 'Answer while A is cut off.'));
      plane.append(null, add('assistant', WHILE_DOWN_REPLY));
      place = await readWhileDown(page, a.app, place);
      await expect(linkLine(page), 'still down, the line still above the pane').toHaveText(RECONNECTING);
    });

    await test.step('the link back: the same first row at the same place, the new rows below it, the draft, and no error drawn', async () => {
      scene.aHub.restore();
      await expect.poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 120_000, message: `A's link to B comes up again\n${mainSaid(page)}` }).toBe('up');
      await expect(linkLine(page), 'the line gone with the link up').toHaveCount(0);
      await expect.poll(async () => ((await placeIn(page))?.scrollHeight ?? 0) > place.scrollHeight, { timeout: 60_000, message: 'the rows written meanwhile join the transcript' }).toBe(true);
      const after = (await placeIn(page))!;
      expect(after.id, 'the same first row in view').toBe(place.id);
      expect(Math.abs(after.offset - place.offset), `at the same place (${place.offset} px, then ${after.offset} px)`).toBeLessThanOrEqual(2);
      expect(await pane!.evaluate((node) => node.isConnected), 'the same pane throughout').toBe(true);
      await expect(composerOf(page), 'the draft kept').toHaveText(PLACE_DRAFT);
      expect(await alertsSeen(page), 'no error drawn in the pane').toEqual([]);
      const scroller = main(page).locator('[data-transcript-scroller]').first();
      await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
      await expect(main(page).getByText(WHILE_DOWN_REPLY).first(), 'the rows below, once scrolled to').toBeVisible({ timeout: 30_000 });
    });

    await test.step('a second down and up with the reader at the end: the rows that arrive are in view', async () => {
      await expect.poll(() => lastRowInView(page), { timeout: 10_000, message: 'the reader follows the end' }).toBe(true);
      scene.aHub.cut();
      await quoting(expect(linkLine(page)).toHaveText(RECONNECTING, { timeout: 60_000 }), () => mainSaid(page));
      plane.append(null, add('user', 'Answer through the second outage.'));
      plane.append(null, add('assistant', SECOND_DOWN_REPLY));
      scene.aHub.restore();
      await expect.poll(async () => (await machineOf(page, b.ref))?.state, { timeout: 120_000, message: `A's link to B comes up again
${mainSaid(page)}` }).toBe('up');
      await expect(main(page).getByText(SECOND_DOWN_REPLY).first(), 'the row that arrived').toBeVisible({ timeout: 60_000 });
      await expect.poll(() => lastRowInView(page), { timeout: 10_000, message: 'the last row in view: the reader still follows' }).toBe(true);
      expect(await paneErrors(page)).toEqual([]);
    });
  } finally {
    await held.a?.cleanup();
    await held.scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

/** B's lane B session open in A with a turn running on B, which only a Stop ends (SideJournal.stoppedTurn). */
async function stoppableOpened(root: string, aUserData: string, held: TerminalHeld) {
  const journal = new SideJournal(STOP_SESSION, join(root, 'b-checkout'));
  journal.turn(STOP_FIRST_REPLY);
  journal.stoppedTurn(STOP_DELTAS);
  const opened = await laneBOpened({ root, aUserData, journal, first: 'Get ready to count.', firstReply: STOP_FIRST_REPLY, title: 'B’s counting session' }, held);
  await opened.sendOnB('Count slowly.');
  await quoting(expect(main(opened.page).getByText('Counting on B: 1, 2,').first(), 'the running turn’s text in A’s pane').toBeVisible({ timeout: 60_000 }), () => mainSaid(opened.page));
  await expect(primaryOf(opened.page), 'the composer offers Stop').toHaveText('Stop', { timeout: 30_000 });
  return opened;
}

test('U9 A11, a Stop that reaches B: pressed in A on B’s running turn, B’s engine is interrupted and A reads the turn’s end', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-stop-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-stop-'));
  const held: TerminalHeld = { scene: null, a: null };
  try {
    const { page, turnOver } = await stoppableOpened(root, aUserData, held);
    expect(await turnOver(), 'B’s turn runs').toBe(false);
    await primaryOf(page).click();
    await expect.poll(turnOver, { timeout: 60_000, message: `B's turn ends at the Stop\n${mainSaid(page)}` }).toBe(true);
    await expect(primaryOf(page), 'A reads the turn’s end: the composer offers Stop no more').not.toHaveText(/^Stop/, { timeout: 30_000 });
    await expect(toastsOf(page), 'and says nothing failed').not.toContainText('Not stopped');
  } finally {
    await held.a?.cleanup();
    await held.scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('U9 A11, a Stop pressed once the line says B reconnects: it reads “Stopping…” under the link’s hold, then says it did not stop because B is offline', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-stop-cut-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-stop-cut-'));
  const held: TerminalHeld = { scene: null, a: null };
  try {
    const { scene, page, turnOver } = await stoppableOpened(root, aUserData, held);
    scene.aHub.cut();
    await quoting(expect(linkLine(page), 'the status line').toHaveText(RECONNECTING, { timeout: 60_000 }), () => mainSaid(page));
    await expect(primaryOf(page), 'Stop is left as it is while B reconnects: main’s hold answers it').toHaveText('Stop');
    await primaryOf(page).click();
    await expect(primaryOf(page), 'a Stop on its way').toHaveText('Stopping…', { timeout: 5_000 });
    await expect(primaryOf(page)).toBeDisabled();
    await quoting(expect(toastsOf(page), 'the notice once the hold gives up').toContainText(`Not stopped: ${B_NAME} is offline`, { timeout: REMOTE_ACT_PENDING_MS + 30_000 }), () => mainSaid(page));
    await expect(primaryOf(page), 'Stopping… no more').not.toHaveText('Stopping…');
    expect(await turnOver(), 'nothing reached B: its turn still runs').toBe(false);
  } finally {
    await held.a?.cleanup();
    await held.scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// The UX wave, U9 (docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M4; A8, A9, A10): the session acts on
// B's session from A's window, over RL2, under the harness's accepting confirmation. Rename… on its listed row (A holds no
// record of it) renames it on B and the row says the new title; Fork from its row's menu, its tab open, opens the fork in
// a new tab on B's address, a session B's index holds as the source's fork; Archive from its menu closes its tab and its
// row leaves A's sidebar; "Archived sessions…" on B's machine row lists it, and Unarchive brings its row back; archived
// again, the sidebar footer's "Archived sessions…" lists it in B's section (M5, the architect's ruling (A)), and Unarchive
// there brings it back too.
const ACTS_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000d7';
const ACTS_FORK = 'b0c0d0e0-0000-4000-8000-0000000000d8'; // the fork's launch on B, pinned by its own journal
const ACTS_TITLE = 'B’s session to act on';
const ACTS_REPLY = 'B is ready to be acted on.';
const RENAMED_ON_A = 'Renamed from A';

// The session tabs of A's strip, by address, as main last saved the layout (a renderer change reaches it a moment later).
async function sessionTabsOf(page: Page): Promise<string[]> {
  type Pane = { tabs: { kind: string; appSessionId?: string }[] };
  const main = await invoke<{ value: { current: string; sets: Record<string, { panes: Pane[] }> } | null }>(page, 'layout.get', { key: 'main.tabs' });
  const set = main.value === null ? undefined : main.value.sets[main.value.current];
  return (set?.panes ?? []).flatMap((pane) => pane.tabs.flatMap((tab) => (tab.kind === 'session' && tab.appSessionId !== undefined ? [tab.appSessionId] : [])));
}
async function menuItemOfRow(page: Page, row: ReturnType<typeof sessionRow>, name: string) {
  await row.click({ button: 'right' });
  const item = page.getByRole('menu').getByRole('menuitem', { name, exact: true });
  await expect(item, `the row's menu offers ${name}, enabled`).toBeVisible({ timeout: 10_000 });
  await expect(item).not.toHaveAttribute('data-disabled', /.*/);
  return item;
}

test('U9 A8, A9, A10: from A, Rename… on B’s listed row renames it on B; Fork from its row opens a fork there in a new tab; Archive closes its tab and row; Unarchive brings it back, from B’s machine row and from the footer', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-acts-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-acts-'));
  const held: TerminalHeld = { scene: null, a: null };
  try {
    const journal = new SideJournal(ACTS_SESSION, join(root, 'b-checkout'));
    journal.turn(ACTS_REPLY);
    journal.rename(RENAMED_ON_A); // a live session is renamed through its engine (the host's `rename_session`)
    const fork = new SideJournal(ACTS_FORK, join(root, 'b-checkout')); // the fork's engine: its prelude, no turn
    const { scene, b, page, app, bProject } = await laneBOpened({ root, aUserData, journal, first: 'Get ready to be acted on.', firstReply: ACTS_REPLY, title: ACTS_TITLE, open: false, launches: [fork] }, held);
    const address = addressOf(b.ref, app);
    const row = sessionRow(page, address);
    type Record = { title: { text: string }; archived: boolean; lineage: { parentAppSessionId: string } | null };
    const onB = (id: string) => b.request<Record | null>('session.get', { appSessionId: id }).catch(() => null);
    await expect.poll(async () => (await machineOf(page, b.ref))?.capabilities ?? [], { message: `B lists the session acts\n${mainSaid(page)}` }).toContain('rl2.session-acts');

    await test.step('Rename… on the listed row: B’s engine takes the title, and A’s row says it', async () => {
      await expect(row, 'a listed row: A holds no record of the session').toHaveAttribute('data-kind', 'listed');
      await (await menuItemOfRow(page, row, 'Rename…')).click();
      const sheet = page.getByRole('dialog', { name: 'Rename' });
      await expect(sheet.getByRole('textbox', { name: 'Title' })).toHaveValue(ACTS_TITLE);
      await sheet.getByRole('textbox', { name: 'Title' }).fill(RENAMED_ON_A);
      await sheet.getByRole('textbox', { name: 'Title' }).press('Enter');
      // the sheet closes only on B's answer: its engine took the journal's `rename_session` with this title (a replay
      // writes no title into the engine's store, so B's record keeps its first prompt's title here)
      await expect(sheet, 'B answered the rename').toBeHidden({ timeout: 30_000 });
      await quoting(expect(row, 'A’s row says the new title').toHaveAttribute('aria-label', RENAMED_ON_A, { timeout: 10_000 }), () => mainSaid(page));
    });

    await test.step('Fork from the row’s menu, its tab open: the fork opens in a new tab on B’s address, a fork of the session on B', async () => {
      await row.click();
      await quoting(expect(main(page).getByText(ACTS_REPLY).first(), 'B’s history in A’s pane').toBeVisible({ timeout: 60_000 }), () => mainSaid(page));
      const before = await sessionTabsOf(page);
      await (await menuItemOfRow(page, row, 'Fork')).click();
      let forked: string | undefined;
      await quoting(
        expect.poll(async () => (forked = (await sessionTabsOf(page)).find((id) => !before.includes(id))), { timeout: 60_000, message: 'a new session tab opens' }).toBeDefined(),
        () => mainSaid(page),
      );
      expect(forked!.startsWith(`${b.ref}/`), `the fork's tab is on B's address (${forked})`).toBe(true);
      const bare = bareOf(forked!);
      await expect.poll(async () => (await onB(bare))?.lineage?.parentAppSessionId ?? null, { timeout: 30_000, message: 'B holds the fork, of the session' }).toBe(app);
      expect(await sessionTabsOf(page), 'the source’s tab stays').toContain(address);
      // sminos lists the fork as it lists every session of B's: B's machine row keeps a row once the source is archived
      await scene.sminos.list({ engine: ACTS_FORK, app: bare, owners: [scene.member], project: bProject, title: 'B’s fork', cwd: join(root, 'b-checkout') });
      await quoting(expect(sessionRow(page, forked!), 'the fork’s row in A’s sidebar').toBeVisible({ timeout: 60_000 }), () => mainSaid(page));
    });

    await test.step('Archive from the row’s menu: its tab closes, its row leaves A’s sidebar, and B’s record is archived', async () => {
      await (await menuItemOfRow(page, row, 'Archive')).click();
      // its tab open, A holds B's record, whose title the sheet says (B's own: the replay above keeps its first one)
      const sheet = page.getByRole('dialog', { name: `Archive “${(await onB(app))!.title.text}”?` });
      await expect(sheet).toContainText(`Ends its engine process on ${B_NAME} and hides it`);
      await sheet.getByRole('button', { name: 'Archive' }).click();
      await expect(sheet).toBeHidden({ timeout: 60_000 });
      await expect(row, 'the row leaves at once').toHaveCount(0, { timeout: 5_000 });
      await expect.poll(() => sessionTabsOf(page), { timeout: 10_000, message: 'the session’s tab is closed (the layout as main last saved it)' }).not.toContain(address);
      await expect.poll(async () => (await onB(app))?.archived ?? null, { timeout: 30_000, message: 'B’s record is archived' }).toBe(true);
      // the hub's listing withdrawn as main holds the org's rows: the row stays gone once the hub has said so
      await expect.poll(async () => (await rowsOf(page)).some((r) => r.machine === b.ref && r.session === app), { timeout: 30_000, message: 'the hub withdrew the session’s listing' }).toBe(false);
      await expect(row).toHaveCount(0);
    });

    await test.step('“Archived sessions…” on B’s machine row lists it, and Unarchive brings its row back', async () => {
      await machineRow(page, b.ref).locator('[data-project-line]').click({ button: 'right' });
      await page.getByRole('menu').getByRole('menuitem', { name: 'Archived sessions…' }).click();
      const dialog = page.getByRole('dialog', { name: `Archived sessions · ${B_NAME}` });
      const listed = dialog.getByRole('listitem', { name: (await onB(app))!.title.text }); // B's record's own title (above)
      await quoting(expect(listed, 'B answers the archived read').toBeVisible({ timeout: 30_000 }), () => mainSaid(page));
      await listed.getByRole('button', { name: 'Unarchive' }).click();
      await expect(listed).toBeHidden({ timeout: 30_000 });
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await onB(app))?.archived ?? null, { timeout: 30_000, message: 'B’s record is unarchived' }).toBe(false);
      await quoting(expect(row, 'its row is back in A’s sidebar').toBeVisible({ timeout: 60_000 }), () => mainSaid(page));
    });

    await test.step('Archived again, the footer’s “Archived sessions…” lists it under B’s name, and Unarchive there brings its row back', async () => {
      await (await menuItemOfRow(page, row, 'Archive')).click();
      const sheet = page.getByRole('dialog', { name: /^Archive “.*”\?$/ });
      await sheet.getByRole('button', { name: 'Archive' }).click();
      await expect(sheet).toBeHidden({ timeout: 60_000 });
      await expect(row, 'the row leaves at once').toHaveCount(0, { timeout: 5_000 });
      await expect.poll(async () => (await onB(app))?.archived ?? null, { timeout: 30_000, message: 'B’s record is archived again' }).toBe(true);
      await page.getByRole('button', { name: 'Archived sessions…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Archived sessions', exact: true });
      const listed = dialog.getByRole('region', { name: B_NAME }).getByRole('listitem', { name: (await onB(app))!.title.text });
      await quoting(expect(listed, 'B’s section of the footer’s sheet lists it').toBeVisible({ timeout: 30_000 }), () => mainSaid(page));
      await listed.getByRole('button', { name: 'Unarchive' }).click();
      await expect(listed).toBeHidden({ timeout: 30_000 });
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await onB(app))?.archived ?? null, { timeout: 30_000, message: 'B’s record is unarchived from the footer' }).toBe(false);
      await quoting(expect(row, 'its row is back in A’s sidebar').toBeVisible({ timeout: 60_000 }), () => mainSaid(page));
    });
  } finally {
    await held.a?.cleanup();
    await held.scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// UX wave U8b (docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md; A2 and A7, M6 and M8; X-168 and the
// architect's ruling of 2026-11-13, Decision Log 13): a terminal session on B whose turn ended while an agent it started
// in the background still works, beside a shell it runs in the background. A's card column for it draws the Subagents
// card from B's plane (the subagent tree its plane transcript keeps) and the Background tasks card from the jobs its
// lane A watch carries. A pause of A's link to B changes nothing. Then B's sminos says the session has no live process
// (its presence, `record: null`) while B is up: the agent ended with the session, whatever B last reported of it, so the
// row of its Agent call in the transcript folds with the ended turn, the Subagents card leaves, and the Subagents panel
// lists it under Done, ended with the session. The scene sends the presence alone, not the tree a current sminos derives
// again beside it once the process is gone, so the exit holds against a tree that still says running (M6 decision 5).
// What becomes of the shell is not asserted: on this route its end is the jobs B's plane derives, which the scene leaves.
const GONE = { engine: 'b0c0d0e0-0000-4000-8000-0000000000c2', title: 'B’s terminal session that ends', launch: 'L-terminal-2' };
const GONE_AGENT = { agentId: 'ab5e2e000000000c2', description: 'Count the files on B', prompt: 'Count every file of the checkout.', at: '2026-11-06T10:00:02.000Z' };
const GONE_SHELL = { taskId: 'bwatch0c2', command: 'sleep 600', description: 'Watch the build on B', at: '2026-11-06T10:00:01.000Z' };

test('X-168 on B’s terminal session: the Subagents and Background tasks cards from B’s plane; a pause of the link changes nothing; its presence with no live record ends its agent: the transcript’s row folds, the Subagents card leaves, the panel reads ended with the session', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-la-gone-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-la-gone-'));
  const held: TerminalHeld = { scene: null, a: null };
  try {
    const checkout = join(root, 'b-terminal');
    mkdirSync(checkout);
    const scene = (held.scene = await startRemoteScene({ scratch: join(root, 'scene'), aUserData }));
    const { b } = scene;
    // its main transcript: the ask, the shell and the agent each started in the background, the answer, the turn's end
    const ask = 'c2c2c2c2-0000-4000-8000-000000000001';
    const shell = backgroundBashRecords(GONE.engine, checkout, ask, GONE_SHELL);
    const turn = backgroundAgentRecords(GONE.engine, checkout, shell.at(-1)!.uuid as string, GONE_AGENT);
    const rows = [
      userRecord(GONE.engine, checkout, ask, null, 'Watch the build and count the files in the background.', '2026-11-06T10:00:00.000Z'),
      ...shell,
      ...turn,
      ...turnEndRecords(GONE.engine, checkout, turn.at(-1)!.uuid as string, '2026-11-06T10:00:03.000Z'),
    ] as PlaneRow[];
    const plane = scene.sminos.laneA(PROJECT, {
      engine: GONE.engine,
      title: GONE.title,
      cwd: checkout,
      owners: [scene.member],
      launch: GONE.launch,
      main: rows,
      agents: {},
      subagents: [{ agentId: GONE_AGENT.agentId, meta: { agentType: 'general-purpose', description: GONE_AGENT.description, toolUseId: `toolu_${GONE_AGENT.agentId}` }, status: 'running', evidence: 'bridge' }],
      jobs: [{ taskId: GONE_SHELL.taskId, kind: 'shell', toolUseId: `toolu_${GONE_SHELL.taskId}`, startedAt: GONE_SHELL.at, description: GONE_SHELL.description, command: GONE_SHELL.command, outputFile: `/tmp/claude/tasks/${GONE_SHELL.taskId}.output`, status: 'running' }],
    });
    const a = (held.a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(false), MAWS_MACHINE_NAME: 'A' } }));
    keepMainLines(a);
    const { page } = a;
    const said = () => `${mainSaid(page)}\nB's endpoint to sminos:\n${scene.sminos.said().split('\n').slice(-30).join('\n')}`;
    const linkState = async () => (await machineOf(page, b.ref))?.state ?? null;
    await expect.poll(linkState, { timeout: 60_000, message: `A's link to B comes up over the relay\n${mainSaid(page)}` }).toBe('up');
    await expect
      .poll(async () => (await rowsOf(page)).find((row) => row.machine === b.ref && row.session === GONE.engine) ?? null, { timeout: 60_000, message: `B's terminal session is a row of A's\n${said()}` })
      .toMatchObject({ lane: 'A', title: GONE.title });
    await expandMachine(page, b.ref);
    const row = sessionRow(page, addressOf(b.ref, GONE.engine));
    await expect(row, `the terminal session's row in A's sidebar\n${mainSaid(page)}`).toBeVisible({ timeout: 30_000 });
    await row.click();
    await quoting(expect(main(page).getByText('It is working in the background.').first(), 'the terminal session’s transcript in A’s pane').toBeVisible({ timeout: 60_000 }), said);
    const agentRow = main(page).locator('.transcript-subagent', { hasText: GONE_AGENT.description });
    const subagentsCard = sessionCard(page, 'Subagents');
    const backgroundCard = sessionCard(page, 'Background tasks');
    const onCard = subagentsCard.locator(`[data-agent-row="${GONE_AGENT.agentId}"]`);

    await test.step('the turn ended while its agent works: its row stays in view, and the column has a card for each kind of running work', async () => {
      await quoting(expect(agentRow, 'the agent’s call stays in view under the ended turn').toBeVisible({ timeout: 60_000 }), said);
      await showSessionCards(page);
      await quoting(expect(onCard, 'the agent on the Subagents card, from B’s subagent tree').toContainText(GONE_AGENT.description, { timeout: 60_000 }), said);
      await expect(subagentsCard.getByRole('button', { name: 'Subagents 1 running', exact: true })).toBeVisible();
      await quoting(expect(backgroundCard.locator(`[data-task-id="${GONE_SHELL.taskId}"]`), 'the shell on the Background tasks card, from the session’s lane A watch').toContainText(GONE_SHELL.description, { timeout: 60_000 }), said);
      await expect(backgroundCard.getByRole('button', { name: 'Background tasks 1 running', exact: true })).toBeVisible();
    });

    await test.step('a pause of A’s link to B changes nothing', async () => {
      scene.aHub.cut();
      await expect.poll(linkState, { timeout: 60_000, message: `A's link to B goes down once cut\n${mainSaid(page)}` }).toBe('down');
      // The UX wave, U9 (M3, A4; P5 Decision Log 28 as it amends it): while the link reconnects the session's pane stays
      // mounted under one status line, so the agent's row stays in view beside its card.
      await quoting(expect(linkLine(page), 'the status line above the kept pane').toHaveText(RECONNECTING, { timeout: 60_000 }), () => mainSaid(page));
      await expect(agentRow, 'the agent’s row stays in the kept pane while the link is down').toBeVisible();
      await expect(onCard, 'the agent stays on the Subagents card while the link is down').toBeVisible();
      await expect(onCard, 'the link down says nothing of the process: the agent still works').toContainText('Working');
      scene.aHub.restore();
      await expect.poll(linkState, { timeout: 120_000, message: `A's link to B comes up again\n${mainSaid(page)}` }).toBe('up');
      await expect(agentRow).toBeVisible();
      await expect(onCard).toBeVisible();
    });

    await test.step('B says the session has no live process while B is up: its agent ended with the session', async () => {
      expect(await linkState(), 'B is up').toBe('up');
      plane.presence(null);
      await quoting(expect(agentRow, 'the agent’s row folds with the ended turn').toHaveCount(0, { timeout: 60_000 }), said);
      await expect(subagentsCard, 'nothing of the session’s runs as an agent: the Subagents card leaves').toHaveCount(0, { timeout: 30_000 });
      await openSurface(page, 'Subagents');
      const tool = surface(page, 'subagents');
      const done = tool.locator('section[data-section="done"]');
      await quoting(expect(done, 'the agent under Done').toHaveAttribute('aria-label', 'Done 1', { timeout: 30_000 }), async () => `the tool: ${await tool.innerText().catch(() => 'none')}\n${said()}`);
      await expect(tool.locator('section[data-section="running"]'), 'nothing under Running').toHaveCount(0);
      const unfold = done.getByRole('heading').getByRole('button');
      if ((await unfold.getAttribute('aria-expanded')) !== 'true') await unfold.click(); // Done is folded at first
      await expect(done.locator(`[data-agent-row="${GONE_AGENT.agentId}"]`)).toContainText('ended with the session');
      console.log(`[e2e:remote] X-168: ${GONE.engine}/${GONE_AGENT.agentId} ended with the session on B's presence`);
    });
  } finally {
    await held.a?.cleanup();
    await held.scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
