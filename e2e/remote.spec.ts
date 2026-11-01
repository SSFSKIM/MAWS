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
//   2. directly: the map sends it to B's listener, so the link comes `up` over the direct carrier; the hover reads
//      "direct (tailnet)" and the pane shows B's history again; then (M4, under MAWS_E2E_STEP_UP=accept) "+ Session" in
//      A's own checkout of the same org project (a `.smns` naming B's project) starts sessions on B through the machine
//      menu: one with its text as the brief, opening in A's pane with its reply and recording A's member as its
//      requester; one in a new worktree with a dropped file, which goes up under the worktree's desk-uploads before the
//      one message that names it.
// B's spawned sessions run on journals of their own, the next fixtures on B's replay list.
// No wall-clock bound beyond Playwright's own timeouts: the measured numbers are M7's.
// Run by `pnpm e2e:remote` (MAWS_REMOTE_E2E=1).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { isolatedGitEnv } from '../test/support/git-env';
import type { MachineState } from '../src/shared/ipc/schema/machines';
import type { SessionEvent } from '../src/shared/graph/events';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { worktreeDirName } from '../src/shared/sessions/worktree';
import { launchMaws, type MawsLaunch } from './support/launch';
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
// The first spawned session is listed late, past main's few quick tries at placing it (0.5 to 4 s): the pane says it
// waits for B to list the session (main waits up to 60 s from the spawn's settlement), then opens it
const SMINOS_LATE_MS = 10_000;
const LISTING_WAIT = (machine: string) => `Waiting for ${machine} to list the new session…`;
const CANT_PLACE = (machine: string) => `${machine} can’t place this session`;
const WORKTREE_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000b4';
const WORKTREE_FILE = { name: 'worktree-notes.txt', content: 'Goes up to the worktree on B.\n' };
const WORKTREE_TEXT = 'Read the file in the worktree.';
const WORKTREE_REPLY = 'B read it in the worktree.';

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

test('A reaches B’s mawsd over RL2, through the hub and then directly, and drives B’s lane B session from its listed row: history, a streamed reply, a permission, an image', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-remote-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-ra-'));
  const checkout = join(root, 'b-checkout');
  const journals = join(root, 'journals');
  const hooks = join(root, 'no-hooks'); // B's repository's hooks path: none run
  const aCheckout = join(root, A_PROJECT); // A's own checkout of the org project, for "+ Session"
  for (const dir of [checkout, journals, hooks, aCheckout]) mkdirSync(dir);
  checkoutRepository(checkout, hooks);
  checkoutRepository(aCheckout, hooks); // a repository too: New chat offers Worktree only in git
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
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
    const fixture = journal.write(journals, 'b-session');
    // M4: the sessions "+ Session" starts on B, the next fixtures on B's list: one whose brief is its first turn, and one
    // in a new worktree, whose journal is written once A's tab names the worktree (its init's directory)
    const spawned = new SideJournal(SPAWNED_SESSION, checkout);
    spawned.turn(SPAWN_REPLY);
    const spawnedFixture = spawned.write(journals, 'b-spawned');
    const worktreeFixture = join(journals, 'b-spawned-worktree.jsonl');
    scene = await startRemoteScene({
      scratch: join(root, 'scene'),
      aUserData,
      b: {
        env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: [fixture, spawnedFixture, worktreeFixture].join(',') },
        // B's checkout trusted, and the default mode the journal was recorded under (sessions.spec.ts's launchCase)
        prepare: ({ claudeConfigDir }) => {
          writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ projects: { [checkout]: { hasTrustDialogAccepted: true } } }));
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
    await a.cleanup();
    a = null;

    // 2. Directly: B's address maps to its listener, so the link comes up over the direct carrier.
    // MAWS_E2E_STEP_UP=accept: the step-up sheet a spawn always asks for is accepted with no sheet and no Touch ID
    // (src/main/device/step-up-sheet.ts's harness confirmation); the signed action is still the device's.
    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(true), MAWS_MACHINE_NAME: 'A', MAWS_E2E_STEP_UP: 'accept' } });
    keepMainLines(a);
    const again = a.page;
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
    // session on its machine, which is what gives its owners a rank on it at B's endpoint; until it does, A's pane can't
    // place the session. `runsOnB`: the session B's engine host runs as the pinned engine session; `listSpawned` lists it
    // then, as sminos would on its start.
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
    await test.step('M4: "+ Session" on B starts a session that opens in A’s pane, once B’s sminos lists it however late', async () => {
      await newChat(again, A_PROJECT);
      await chooseMachine(again, B_NAME);
      await composerOf(again).click();
      await again.keyboard.type(SPAWN_BRIEF);
      await again.keyboard.press('Enter');
      const spawnedApp = await runsOnB(SPAWNED_SESSION);
      const runningAt = Date.now();
      // B's sminos slow to list it: the pane waits for the listing, and holds that past main's quick tries, never
      // giving up with "can't place"; the scenario's own delay, not a bound on MAWS
      const waiting = main(again).getByText(LISTING_WAIT(B_NAME));
      await expect(waiting, `the pane waits for B to list the new session\n${await paneSaid(again)}\n${mainSaid(again)}`).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(async () => {
          if ((await main(again).getByText(CANT_PLACE(B_NAME)).count()) > 0) return 'gave up';
          if (!(await waiting.isVisible())) return 'stopped waiting';
          return Date.now() - runningAt >= SMINOS_LATE_MS ? 'held' : 'waiting';
        }, { timeout: SMINOS_LATE_MS + 30_000, intervals: [250] })
        .toMatch(/^(held|gave up|stopped waiting)$/);
      expect(await main(again).getByText(CANT_PLACE(B_NAME)).count(), `still waiting, not given up, ${SMINOS_LATE_MS} ms after B ran the session\n${await paneSaid(again)}`).toBe(0);
      await expect(waiting, 'still the waiting line').toBeVisible();
      await listOnB(SPAWNED_SESSION, spawnedApp, checkout, 'B’s spawned session');
      first = await movedTo(again, b.ref, address, bSaid); // the pane showed B’s first session before the New chat tab
      await expect(waiting).toHaveCount(0);
      expect(bareOf(first), 'the tab moved to the session B started').toBe(spawnedApp);
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
  } finally {
    await a?.cleanup();
    await scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
