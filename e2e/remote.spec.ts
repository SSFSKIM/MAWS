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
//   2. directly: the map sends it to B's listener, so the link comes `up` over the direct carrier; the hover reads
//      "direct (tailnet)" and the pane shows B's history again.
// No wall-clock bound beyond Playwright's own timeouts: the measured numbers are M7's.
// Run by `pnpm e2e:remote` (MAWS_REMOTE_E2E=1).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { MachineState } from '../src/shared/ipc/schema/machines';
import type { SessionEvent } from '../src/shared/graph/events';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { launchMaws, type MawsLaunch } from './support/launch';
import { startRemoteScene, B_NAME, type RemoteScene } from './support/remote-scene';
import { SideJournal } from './support/side-replay';
import { showProjectList, sidebarOf } from './support/sidebar';

test.skip(process.env.MAWS_REMOTE_E2E !== '1', 'the remote scenes run under pnpm e2e:remote (MAWS_REMOTE_E2E=1)');
test.setTimeout(420_000);

const B_SESSION = 'b0c0d0e0-0000-4000-8000-0000000000b2'; // the engine session id B's journal pins
const PROJECT = 'e2e-remote-project'; // sminos's project id for B's checkout
const FIRST = 'Say hello from B.';
const FIRST_REPLY = 'Hello from B.';
const TITLE = 'B’s lane B session';
// What A sends, and what B's replayed engine answers to each (the replay matches a prompt by type, so A's words are A's)
const SECOND = 'A asks B over the link.';
const SECOND_DELTAS = ['Streamed ', 'from B ', 'to A.'];
const SECOND_REPLY = SECOND_DELTAS.join('');
const THIRD = 'Run the one command, then answer.';
const APPROVED = 'remote-approved';
const THIRD_REPLY = 'The command ran on B.';
const IMAGE_TEXT = 'What is in this picture?';
const IMAGE_REPLY = 'B saw the picture.';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; // 1×1

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
  for (const dir of [checkout, journals]) mkdirSync(dir);
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  let app = '';
  try {
    // B's session: C3's prelude, one whole turn for B's own first message, then A's: a send whose reply streams, a
    // command the engine asks permission for (the replay holds at the `allow`), and a message with a pasted image.
    const journal = new SideJournal(B_SESSION, checkout);
    journal.turn(FIRST_REPLY);
    journal.turn(SECOND_REPLY, SECOND_DELTAS);
    const third = journal.prompt();
    journal.permission(third, 'Bash', { command: `echo ${APPROVED}`, description: 'Print a word' }, APPROVED);
    journal.reply(third, THIRD_REPLY);
    journal.completed(third);
    journal.turn(IMAGE_REPLY);
    const fixture = journal.write(journals, 'b-session');
    scene = await startRemoteScene({
      scratch: join(root, 'scene'),
      aUserData,
      b: {
        env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixture },
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
    const writtenOnB = async (): Promise<UserMessage['content'][]> => {
      const { events } = await b.request<{ events: SessionEvent[] }>('session.events', { appSessionId: app, afterSeq: null, limit: null });
      return events.filter((e): e is UserMessage => e.kind === 'user.message' && !e.isReplay).map((e) => e.content);
    };
    const turnOverOnB = async () => (await b.request<{ turn: unknown; process: string }>('session.status', { appSessionId: app })).turn === null;

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
    await expect(main(page).getByText(SECOND_REPLY).first(), 'the reply in A’s pane').toBeVisible({ timeout: 60_000 });
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
    await a.cleanup();
    a = null;

    // 2. Directly: B's address maps to its listener, so the link comes up over the direct carrier.
    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(true), MAWS_MACHINE_NAME: 'A' } });
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
  } finally {
    await a?.cleanup();
    await scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
