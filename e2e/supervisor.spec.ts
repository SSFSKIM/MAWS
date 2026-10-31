// E10's detachable supervisor end to end (E10 execution document, M4 Task 4.1 and Task 4.4; Acceptance G1 to G4): the
// built product with the engine host detached (`MAWS_HOST_MODE=detached`) over C3's replay transport, no engine. Each
// case owns a scratch profile across its relaunches (`launchMaws({userData, keepConfigHome: true})`), and every
// supervisor it starts is killed and its files removed in the case's cleanup, whatever happened:
//   (a) start: the lock, the files and their modes, the process in its own group; an unbusy quit stops it; a kill -9
//       of the app leaves it serving; a kill -9 of it leaves a stale lock a relaunch replaces;
//   (b) G2: a paced replay kept across a quit streams on unobserved (a background task's failure and the permission
//       request land while the app is closed), the relaunch connects to the same pid, the failure's Needs-you item
//       (derived only from the undelivered tail) and the request's show once each, `engine.budget` answers from the kept
//       supervisor, rows keep arriving, and the finished transcript equals a control run's without the quit;
//   (c) G3: kill -9 of the supervisor mid-turn: the crash toast, a new pid in Diagnostics, the session not live;
//   (d) G3: Settings' Stop all: the old supervisor exits, a fresh one starts and launches;
//   (e) G3: the idle release (`idle`) and the supervisor's own idle exit, after a keep-quit and after a kill -9 of the app;
//   (f) an update (another build id): the banner, Restart now, a new pid;
//   (g) an incompatible update (another wire major, P5 O1 M6): the banner, launches refused, Restart now, a new pid;
//   (h) G4: a restored terminal after a keep-quit says its shell closed; a new one does not;
//   (i) P3-A M5: a document a session (the test writer standing in for an agent) edits while no window and no main
//       exist; the next launch lists it at its new revision and opens it through main's relay over the socket's
//       document channel, an edit syncing back; a kill -9 of the supervisor during a relayed edit loses nothing
//       acknowledged once main has started a new one;
//   (j) P3-L M7: the library after a detached edit: a kept session's stand-in edits one artifact, creates another and
//       deletes a third while the app has quit; the next launch's library (main's derived index, reconciled by one
//       host read at the connection) lists them at the host's revisions, the session their last editor and their new
//       words searchable, and drops the deleted one.
// The evidence (`relaunch.txt`, `crash.txt`, `idle.txt`, the screenshots in both themes) is written from what the cases
// observe, under MAWS_E10_SHOTS=1 only (E11 W-E: a gate run leaves the committed evidence alone; the both-themes token
// scans run either way). Run by `pnpm e2e:supervisor` (MAWS_SUPERVISOR_E2E=1), part of `pnpm verify`.
// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "The suites"): `pnpm e2e:supervisor-daemon` runs the
// same cases on the daemon shape (`MAWS_HOST_MODE=daemon`): main reaches the engine host through a private `mawsd` on
// the scratch profile, and each case reads the shape (`DAEMON`) where the table's daemon-shape expectation differs: (a)
// `mawsd` and the engine host each in a group of their own, the engine host parked at an unbusy quit and `mawsd` gone
// once idle; (c) the toast with no signal (main did not spawn the engine host) and `mawsd`'s pid unchanged; (e) the
// engine host parked and `mawsd` gone once idle; (f), (g) the seams passed to a fresh `mawsd`; (h) inverted: the
// terminals outlive the app; (i), (j) the stand-in's request through `mawsd`'s relay. Two cases run on either shape:
//   (l) the daemon shape only: a kill -9 of `mawsd` mid-turn, which the app's transport replaces, the engine host and the
//       turn going on;
//   (m) with the app open and a short idle time, a session with no tab is released and one in a tab, one marked Keep
//       running and one holding a durable cron (fresh and resumed; P5 Decision Logs 46 and 47) are not; O16 M5: with a
//       fake observer on the engine host's gate.sock, the release's `arm` arrives, the scene answers `armed` and the
//       session is released; a `turn` after the arm is answered `proceed` and the session stays live another period;
//       an observer gone silent holds its session past two periods.
// P5 O16 M2b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M2; D28, D31): cases (a), (b), (e) and (m) run their
// sessions on the stub engine (e2e/support/stub-engine.ts), a real process playing the same fixtures under a real session
// host, rather than the in-process replay, which spawns nothing; (a) adds a live session whose engine, session host and
// roster entry it checks and sees end with the session. Every other case keeps the replay.
import { addressed } from './support/address';
import { openSurface, surface } from './support/shell';
import { createConnection } from 'node:net'; // P3-A M5
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { MACHINE_SPINE_CAPABILITY, SOCKET_PROTOCOL } from '@shared/host/socket-protocol'; // P3-A M5
import type { AttentionItem } from '@shared/graph/attention';
import { daemonPaths } from '@shared/daemon/files';
import { reachMachine } from '../src/mawsd/machine-client';
import { WIRE_MINOR } from '@shared/ipc/wire'; // P3-A M5; P5 O1 M6: the hello's minor
import { invoke, launchReady, replaySpec, turnsJournal, value } from './support/c7-replay';
import { menu, otherThemeColours } from './support/code-product';
import { ownTitles } from './support/library'; // P3-L M7
import { documents, seamReady } from './support/documents'; // P3-A M5
import { REPO_ROOT, type MawsLaunch } from './support/launch';
import { isAlive, ps } from './support/processes';
import { sidebarRow } from './support/sidebar';
import { FakeObserver } from '../src/engine-host/holder/fake-observer'; // O16 M5
// the case's scratch profile, its supervisors and the kept session's fixtures (moved there for e2e/cross-build.spec.ts)
import { attentionOf, DAEMON, eventsOf, firstPrompt, isRequestRow, isTaskFailureRow, keptQuitLine, pendingPermissions, PERMISSION, startTurn, statusOf, suffix, tailFixture, TASK_FAILED, untilRequested, withScratch, type JournalRow, type Scratch } from './support/supervisor-scratch';
import { CLOCK } from './support/clock'; // L129

test.skip(process.env.MAWS_SUPERVISOR_E2E !== '1', 'the supervisor e2e runs under pnpm e2e:supervisor (MAWS_SUPERVISOR_E2E=1)');

const EVIDENCE = process.env.MAWS_E10_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e10') : null;
const ROW_MS = '250'; // (b): about 11 s from the prompt to the request, 10 s from the answer to the result

// ---- the session ------------------------------------------------------------------------------------------------------

// The launch's events in fixture order: each event's `seq` replaced by the rank of its journal row among the rows that
// produced events, with its index in that row and its kind. The journal also numbers the read traffic the app's own
// reads cause (get_settings, get_context_usage and the replay's `replay_unrecorded_read` rows, which produce no event)
// at moments that depend on the app's windows, so two runs' raw `seq` differ where their reads fell; the ranked list is
// equal exactly when both runs hold the same events in the same order, none twice, none missing.
function fixtureOrder(events: readonly SessionEvent[]): string[] {
  const ranks = new Map<string, number>();
  return events.map((e) => {
    const [seq, i] = suffix(e.id).split(':');
    if (!ranks.has(seq!)) ranks.set(seq!, ranks.size + 1);
    return `${ranks.get(seq!)}:${i} ${e.kind}`;
  });
}
// The session's sidebar row (its project expanded; a click landing while the tree re-renders at a connect can be lost,
// so the expansion is retried), clicked to show the session in the main region.
async function rowOf(page: Page, id: AppSessionId): Promise<Locator> {
  let row: Locator | null = null;
  await expect(async () => {
    row = await sidebarRow(page, { appSessionId: id });
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return row!;
}
async function showSession(page: Page, id: AppSessionId): Promise<Locator> {
  const row = await rowOf(page, id);
  await row.click();
  return row;
}
const glyphOf = (row: Locator) => row.locator('[role="img"]').first();
const submitOf = (page: Page) => page.locator('[data-region="main"] [data-submit-state]');

// ---- evidence ---------------------------------------------------------------------------------------------------------

function evidence(name: string, lines: string[]): void {
  if (EVIDENCE === null) return;
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), `${lines.join('\n')}\n`);
}

// `target` in both themes (light last, the default), each checked for the other theme's colours first.
async function shots(maws: MawsLaunch, name: string, target: () => Locator | null): Promise<void> {
  const { page } = maws;
  if (EVIDENCE !== null) mkdirSync(EVIDENCE, { recursive: true });
  for (const theme of ['dark', 'light'] as const) {
    await menu(maws, `theme.${theme}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await otherThemeColours(page, { paintedOnly: true }), `${theme}: ${name}`).toEqual([]); // xterm's hidden IME view keeps fixed colours
    if (EVIDENCE === null) continue;
    const path = join(EVIDENCE, `${name}-${theme}.png`);
    const element = target();
    if (element) await element.screenshot({ path });
    else await page.screenshot({ path });
  }
}

async function openDiagnostics(maws: MawsLaunch): Promise<Locator> {
  const strip = maws.page.getByRole('region', { name: 'Diagnostics' });
  await expect
    .poll(async () => {
      if (await strip.isVisible()) return true;
      await maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('diagnostics.open')?.click());
      return strip.isVisible();
    }, { timeout: 10_000, message: 'Help › Diagnostics opens the Diagnostics tab' })
    .toBe(true);
  return strip;
}

const banner = (page: Page, text: string) => page.locator('[data-banner-host]').getByRole('status').filter({ hasText: text });

// ---- the cases ---------------------------------------------------------------------------------------------------------

test.beforeEach(() => test.setTimeout(180_000));

test('(a) the supervisor starts in its own group with its files; an unbusy quit stops it; it outlives a killed app; a stale lock is replaced', async () => {
  if (DAEMON) return startOnTheDaemon();
  await withScratch('start', async (s) => {
    s.useStub(); // O16 M2b
    const first = await s.launch();
    const status = await s.ready(first.page);
    expect(status).toMatchObject({ transport: 'detached', state: 'ready', matches: 'same', supervisor: { mode: 'detached' } });
    const lock = s.lock()!;
    expect(lock.pid).toBe(status.supervisor!.pid);
    expect(isAlive(lock.pid)).toBe(true);
    expect(Number(ps(lock.pid, 'pgid')), 'the supervisor leads its own process group').toBe(lock.pid);
    expect(ps(lock.pid, 'command')).toMatch(/^maws-supervisor .* --detached /);
    expect(statSync(s.dir).mode & 0o777).toBe(0o700);
    for (const name of ['host.lock', 'host.token', 'host.sock']) expect(statSync(s.file(name)).mode & 0o777, name).toBe(0o600);
    expect(existsSync(s.file('host.log'))).toBe(true);
    expect(lock.socketPath).toBe(s.file('host.sock'));
    const hosted = await hostedSession(s, first.page); // O16 M2b

    // an unbusy quit stops every session and the supervisor with them (residue 23), the session host with its session
    await s.quit(first);
    await expect.poll(() => isAlive(lock.pid), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => [isAlive(hosted.engine), isAlive(hosted.host)], { timeout: 10_000, message: 'the engine and its session host end with the session' }).toEqual([false, false]);
    expect(existsSync(hosted.roster), 'the session host removed its roster entry').toBe(false);
    expect(existsSync(s.file('host.lock')), 'the lock is unlinked').toBe(false);
    expect(existsSync(s.file('host.sock')), 'the socket is unlinked').toBe(false);

    // absent, it is started; a kill -9 of the app leaves it serving
    const second = await s.launch();
    const p2 = (await s.ready(second.page)).supervisor!.pid;
    expect(p2).not.toBe(lock.pid);
    await s.killApp(second);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(isAlive(p2), 'the supervisor outlives a killed app').toBe(true);
    expect(s.lock()?.pid).toBe(p2);
    expect(existsSync(s.file('host.sock'))).toBe(true);

    // its kill -9 leaves a stale lock, which the next start replaces
    process.kill(p2, 'SIGKILL');
    await expect.poll(() => isAlive(p2)).toBe(false);
    expect(s.lock()?.pid, 'the stale lock is still there').toBe(p2);
    const third = await s.launch();
    const p3 = (await s.ready(third.page)).supervisor!.pid;
    expect(p3).not.toBe(p2);
    expect(s.lock()?.pid, 'the stale lock was replaced').toBe(p3);
    expect(third.maws.consoleErrors()).toEqual([]);
    await s.quit(third);
    await expect.poll(() => isAlive(p3), { timeout: 10_000 }).toBe(false);
  });
});

// (a) on the daemon shape: the private `mawsd` in its own group with its files and modes, the engine host in another with
// the supervisor's; after an unbusy quit `mawsd` parks the engine host once idle and exits once idle; a killed app leaves
// both serving; a kill -9 of `mawsd` leaves a stale lock the next start replaces, the engine host's pid unchanged.
// P5 O3-D M5b fix round 5: Quit sends no stop-all on the daemon shape (Q1, the cutover's D12), so what parks the engine
// host is `mawsd`'s idle clock (no app and no interest for the idle time, D6), the idle time this scene's spine pushes
async function startOnTheDaemon(): Promise<void> {
  const IDLE_MS = 4_000; // `mawsd`'s idle exit, each idle-reading launch's host.configure (its spine's, MAWS_E2E_SUPERVISOR_IDLE_MS)
  await withScratch('start', async (s) => {
    s.useStub(); // O16 M2b
    const first = await s.launch({ MAWS_E2E_SUPERVISOR_IDLE_MS: String(IDLE_MS) });
    const status = await s.ready(first.page);
    expect(status).toMatchObject({ transport: 'daemon', state: 'ready', matches: 'same', supervisor: { mode: 'detached' }, daemon: { kind: 'private' }, daemonUnavailable: null });
    const daemon = s.daemonLock()!;
    expect(daemon.pid).toBe(status.daemon!.pid);
    expect(isAlive(daemon.pid)).toBe(true);
    expect(Number(ps(daemon.pid, 'pgid')), 'mawsd leads its own process group').toBe(daemon.pid);
    expect(ps(daemon.pid, 'command')).toMatch(/^mawsd .*mawsd\.js run --private --dir /);
    expect(statSync(s.daemonDir).mode & 0o777).toBe(0o700);
    for (const name of ['mawsd.lock', 'mawsd.token']) expect(statSync(s.daemonFile(name)).mode & 0o777, name).toBe(0o600);
    for (const [name, path] of Object.entries(s.daemonSockets())) expect(statSync(path).mode & 0o777, `${name}.sock`).toBe(0o600);
    expect(existsSync(s.daemonFile('mawsd.log'))).toBe(true);
    // the engine host it started: its own group, the supervisor's files
    const engine = s.lock()!;
    expect(engine.pid).toBe(status.supervisor!.pid);
    expect(engine.pid).not.toBe(daemon.pid);
    expect(Number(ps(engine.pid, 'pgid')), 'the engine host leads a process group of its own').toBe(engine.pid);
    expect(ps(engine.pid, 'command')).toMatch(/^maws-supervisor .* --detached /);
    expect(statSync(s.dir).mode & 0o777).toBe(0o700);
    for (const name of ['host.lock', 'host.token', 'host.sock']) expect(statSync(s.file(name)).mode & 0o777, name).toBe(0o600);
    // O16 M2b: a live session runs under a session host; stopped, it ends with its host, and the quit below stays unbusy
    const hosted = await hostedSession(s, first.page);
    expect(value(await invoke(first.page, 'session.stop', { appSessionId: hosted.id, reason: 'stop' }))).toMatchObject({ exited: true });
    await expect.poll(() => [isAlive(hosted.engine), isAlive(hosted.host)], { timeout: 10_000, message: 'the engine and its session host end with the session' }).toEqual([false, false]);
    expect(existsSync(hosted.roster), 'the session host removed its roster entry').toBe(false);

    // an unbusy quit leaves the engine host to `mawsd`'s idle clock, which parks it; `mawsd` exits once idle
    await s.quit(first);
    await expect.poll(() => isAlive(engine.pid), { timeout: IDLE_MS + 6_000, message: 'the engine host is parked' }).toBe(false);
    expect(s.daemonLog()).toContain('no app and no interest for the idle time: asking the engine host to exit when idle');
    expect(existsSync(s.file('host.lock')), 'the engine host’s lock is unlinked').toBe(false);
    await expect.poll(() => isAlive(daemon.pid), { timeout: IDLE_MS + 15_000, message: 'mawsd exits once idle' }).toBe(false);
    expect(existsSync(s.daemonFile('mawsd.lock')), 'mawsd’s lock is unlinked').toBe(false);
    expect(s.daemonLog()).toContain('no client, both hosts parked and no hold for the idle time');

    // absent, both are started; a kill -9 of the app leaves both serving
    const second = await s.launch();
    const again = await s.ready(second.page);
    const [d2, e2] = [again.daemon!.pid, again.supervisor!.pid];
    expect(d2).not.toBe(daemon.pid);
    expect(e2).not.toBe(engine.pid);
    await s.killApp(second);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(isAlive(d2), 'mawsd outlives a killed app').toBe(true);
    expect(isAlive(e2), 'the engine host outlives a killed app').toBe(true);
    expect(s.daemonLock()?.pid).toBe(d2);

    // a kill -9 of `mawsd` leaves a stale lock, which the next start replaces; the engine host serves on
    process.kill(d2, 'SIGKILL');
    await expect.poll(() => isAlive(d2)).toBe(false);
    expect(s.daemonLock()?.pid, 'the stale lock is still there').toBe(d2);
    expect(isAlive(e2), 'the engine host outlives mawsd').toBe(true);
    const third = await s.launch({ MAWS_E2E_SUPERVISOR_IDLE_MS: String(IDLE_MS) }); // the new `mawsd`'s spine pushes the idle time
    const replaced = await s.ready(third.page, (st) => st.daemon!.pid !== d2);
    expect(s.daemonLock()?.pid, 'the stale lock was replaced').toBe(replaced.daemon!.pid);
    expect(replaced.supervisor!.pid, 'the new mawsd adopted the running engine host').toBe(e2);
    expect(third.maws.consoleErrors()).toEqual([]);
    await s.quit(third);
    await expect.poll(() => isAlive(e2), { timeout: IDLE_MS + 6_000, message: 'after the unbusy quit the new mawsd parks the adopted engine host once idle' }).toBe(false);
  });
}

// O16 M2b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M2): a live session on the stub engine, ready: its engine
// runs under a session host, the engine's parent in a process group of its own, with its roster entry in the supervisor's
// `hosts/` (0700, the entry 0600); the spawn row names the stub as `bin` and the host as `holder`.
async function hostedSession(s: Scratch, page: Page): Promise<{ id: AppSessionId; engine: number; host: number; roster: string }> {
  const id = `a-hosted-${Date.now()}` as AppSessionId;
  await s.launchSession(page, id, PERMISSION, { cwd: s.repo });
  const status = await statusOf(page, id);
  const engine = status.pid!;
  const host = status.holder!.pid;
  expect(status.holder).toMatchObject({ adopted: false });
  expect(host).not.toBe(engine);
  expect(Number(ps(engine, 'ppid')), 'the session host is the engine’s parent').toBe(host);
  expect(Number(ps(host, 'pgid')), 'the session host leads its own process group').toBe(host);
  expect(ps(host, 'command')).toMatch(/maws-session-host /);
  const hosts = join(s.dir, 'hosts');
  expect(statSync(hosts).mode & 0o777).toBe(0o700);
  const roster = join(hosts, `${status.launchId}.json`);
  expect(statSync(roster).mode & 0o777).toBe(0o600);
  const spawn = s.journal(id).find((r) => r.direction === 'meta' && r.frame.event === 'spawn')!.frame;
  expect(spawn).toMatchObject({ bin: s.stub!.bin, holder: { pid: host, holderId: status.holder!.holderId } });
  return { id, engine, host, roster };
}

test('(b) G2: a kept session streams on while the app is closed; the relaunch reconnects, its undelivered tail reaches main, and it ends as a control run does', async () => {
  const pace = { MAWS_E2E_REPLAY_ROW_MS: ROW_MS };
  const dd = (scope: Locator, term: string) => scope.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
  const transcriptRows = async (page: Page) => page.locator('[data-region="main"] [data-row-id]').evaluateAll((rows) => rows.map((r) => (r.getAttribute('data-row-id') ?? '').split(':')[0]!)); // the row's kind (its id's head; the rest names this run's turn)
  const settledRows = async (page: Page) => {
    let last = '';
    await expect.poll(async () => {
      const now = JSON.stringify(await transcriptRows(page));
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [500], timeout: 15_000, message: 'the transcript settles' }).toBe(true);
    return JSON.parse(last) as string[];
  };
  const finished = async (page: Page, id: AppSessionId) =>
    expect.poll(async () => {
      const status = await statusOf(page, id);
      return status.turn === null && (await eventsOf(page, id)).some((e) => e.kind === 'turn.ended');
    }, { timeout: 60_000, message: 'the fixture has played its turn' }).toBe(true);

  // the control: the same fixture at the same pace, the app open throughout
  const control = { order: [] as string[], suffixes: [] as string[], rows: [] as string[], journal: 0 };
  await withScratch('control', async (s) => {
    s.useStub({ rowMs: Number(ROW_MS) }); // O16 M2b: the session on the stub engine under a session host
    const run = await s.launch(pace);
    await s.ready(run.page);
    const id = await s.record(run.page);
    await startTurn(run.page, s, id, tailFixture(s.root));
    // shown once the launch is live, as the relaunched window first shows it: a window attached to a live launch
    // hydrates the launch's events, and only one attached before it also holds the record's disk history
    await showSession(run.page, id);
    const requested = await untilRequested(run.page, id);
    value(await invoke(run.page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
    await finished(run.page, id);
    // the owner's ruling (2026-10-30): with its session shown in front, the fixture's failure is seen as it arrives (or
    // retired once the session shows, had it arrived first): nothing of it waits in Needs you
    expect((await attentionOf(run.page, id, 'error')).filter((i) => i.state !== 'retired'), 'the failure with its session shown leaves no open item').toEqual([]);
    const events = await eventsOf(run.page, id);
    control.order = fixtureOrder(events);
    control.suffixes = events.map((e) => suffix(e.id));
    control.journal = s.journal(id).length;
    control.rows = await settledRows(run.page);
    expect(run.maws.consoleErrors()).toEqual([]);
  });

  await withScratch('keep', async (s) => {
    s.useStub({ rowMs: Number(ROW_MS) }); // O16 M2b
    const log: string[] = ['E10 G2: a kept session across a quit and a relaunch (e2e/supervisor.spec.ts case (b))', `fixture ${PERMISSION} with one background task failure inserted before its request, MAWS_E2E_REPLAY_ROW_MS=${ROW_MS}`, ''];
    const first = await s.launch({ ...pace, MAWS_E2E_QUIT_ANSWER: 'keep' });
    const firstStatus = await s.ready(first.page);
    const pid = firstStatus.supervisor!.pid;
    const id = await s.record(first.page);
    await startTurn(first.page, s, id, tailFixture(s.root));
    await showSession(first.page, id);
    await expect.poll(async () => (await eventsOf(first.page, id)).length, { message: 'a few rows have streamed' }).toBeGreaterThan(5);
    const seenBeforeQuit = (await eventsOf(first.page, id)).length;
    await s.quit(first);
    expect(first.quitLines()).toEqual([keptQuitLine()]);
    expect(isAlive(pid), 'the supervisor outlives the app').toBe(true);
    // the precondition, read once the app has exited: neither the failure nor the request is journaled yet
    const atQuit = s.journal(id);
    const seqAtQuit = Math.max(...atQuit.map((r) => r.seq));
    expect(atQuit.filter((r) => isTaskFailureRow(r) || isRequestRow(r)), 'the failure and the request come after the app has exited').toEqual([]);
    log.push(`first run: supervisor pid ${pid}; ${seenBeforeQuit} events read just before ⌘Q`, keptQuitLine(), `after the app exited: pid ${pid} alive ${isAlive(pid)}; journal at seq ${seqAtQuit}, holding neither the task failure nor the permission request`);

    // unobserved: the replay streams on; the failure and the request land while no app is connected
    await expect.poll(() => s.journal(id).some(isRequestRow), { timeout: 30_000, message: 'the request reaches the journal while the app is closed' }).toBe(true);
    const closed = s.journal(id);
    log.push(`while closed: ${closed.length - atQuit.length} journal rows written, the task failure (seq ${closed.find(isTaskFailureRow)!.seq}) and the permission request (seq ${closed.find(isRequestRow)!.seq}) among them`);
    if (DAEMON) {
      // P5 O3-D (acceptance 1): with no app, `mawsd`'s spine derives the session's items; a second client of machine.sock reads them
      await expect.poll(async () => (await attentionWithNoApp(s)).filter((i) => i.appSessionId === id).map((i) => i.kind), { timeout: 15_000, message: 'attention.list over machine.sock shows the failure and the request raised while away' }).toEqual(expect.arrayContaining(['error', 'permission']));
      log.push('while closed: attention.list over machine.sock, a second client, shows the task failure’s item and the pending request');
    }

    const second = await s.launch(pace);
    const status = await s.ready(second.page);
    expect(status.supervisor!.pid, 'the relaunch connects to the same supervisor').toBe(pid);
    // on the daemon shape `mawsd` is the engine host's one permanent client (O3-D M3): the supervisor logs its one connect,
    // and each app's attachment is `mawsd`'s own engine-host.sock connect, logged with that app's pid
    if (DAEMON) {
      expect(status.daemon!.pid, 'through the same mawsd').toBe(firstStatus.daemon!.pid);
      const connects = s.log().match(/client connected: appPid \d+ .*/g) ?? [];
      expect(connects, 'the supervisor logs mawsd’s one connect, across both apps').toHaveLength(1);
      expect(connects[0], 'which declares the attachment').toContain('host.attachment');
      const attached = [...s.daemonLog().matchAll(/engine-host\.sock: client connected: appPid (\d+)/g)].map((m) => Number(m[1]));
      expect([...new Set(attached)], 'mawsd logs each app’s attachment on engine-host.sock').toEqual([first.child.pid, second.child.pid]);
    } else expect(s.log().match(/client connected: appPid/g), 'the supervisor logs both apps’ connects').toHaveLength(2);
    expect(s.log().match(/ starting in /g), 'and started once').toHaveLength(1);
    await second.page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __e10: string[] }).__e10 = seen;
      window.maws.on('session.eventBatch', (batch) => seen.push(...batch.events.map((e) => `${batch.appSessionId}|${e.id}`)));
    });
    const atRelaunch = await eventsOf(second.page, id);
    const seqOf = (e: SessionEvent) => Number(suffix(e.id).split(':')[0]);
    const afterExit = atRelaunch.filter((e) => seqOf(e) > seqAtQuit).length;
    expect(afterExit, 'events from rows journaled after the app had exited').toBeGreaterThan(0);
    const live = await statusOf(second.page, id);
    expect(live).toMatchObject({ process: 'ready', turn: expect.anything() });
    log.push('', `relaunch: the same supervisor pid ${status.supervisor!.pid}; ${atRelaunch.length} events in the launch at the connect; between ${afterExit} (from rows journaled after the app had exited) and ${atRelaunch.length - seenBeforeQuit} (all after the last read before ⌘Q) streamed while the app was closed`);

    // the undelivered tail reached main's `session.eventBatch` listeners: the failure's error item, which only the
    // attention service's derivation of the live tail raises (the first app never saw the event; the resync folds the
    // digest only), from the event journaled while the app was closed; one item (derived items are keyed by event id)
    const failure = atRelaunch.find((e) => e.kind === 'task.notification')!;
    expect(seqOf(failure), 'the failure event was journaled after the app had exited').toBeGreaterThan(seqAtQuit);
    await expect.poll(async () => (await attentionOf(second.page, id, 'error')).map((i) => i.id), { message: 'the failure’s Needs-you item, derived from the tail' }).toEqual([`${id}:error:${failure.id}`]);
    const [errorItem] = await attentionOf(second.page, id, 'error');
    expect(errorItem!.summary).toBe(`Background task failed: ${TASK_FAILED}`);
    // the request's item comes from the burst's broker items (host-held state re-listed at the connect)
    await expect.poll(async () => (await pendingPermissions(second.page, id)).length, { message: 'the Needs-you item of the request raised while away' }).toBe(1);
    // The owner's ruling (2026-10-30): the failure came while nobody was looking (journaled after the app had exited, so
    // after the session's last-seen mark), so it was raised; the relaunch restores this session's tab, and shown there in
    // front the session is seen, which retires the error for good, and the glyph reads the pending request, never an
    // ended session
    await expect.poll(async () => (await attentionOf(second.page, id, 'error'))[0]?.state, { timeout: 10_000, message: 'seen once its restored session shows' }).toBe('retired');
    const row = await rowOf(second.page, id);
    await expect(glyphOf(row), 'the glyph reads the request, not the seen error').toHaveAttribute('aria-label', 'Needs approval');
    await row.click();
    // E11 W-E: the liveness G2's glyph showed before the error item outranked it, read from main's digest after the
    // resync: the turn open with the one request pending. The phase is `working` (the fold's `turn.started`), never
    // `waiting`: that reading needs an engine `requires_action` state (a `session.state` event or the status's
    // `engineState`), and both come only from `session_state_changed` frames, which permission-roundtrip.jsonl lacks
    const digestOf = async () => value(await invoke(second.page, 'session.digests', undefined)).digests.find((d) => d.appSessionId === id);
    await expect.poll(async () => (await digestOf())?.pendingRequests, { message: 'the digest counts the request raised while away' }).toBe(1);
    const digest = (await digestOf())!;
    expect(digest.phase, 'the digest reads the turn open after the resync').toBe('working');
    await expect(submitOf(second.page), 'the renderer reads the turn open').toHaveAttribute('data-submit-state', 'stop');
    await new Promise((r) => setTimeout(r, 1_000));
    const items = await pendingPermissions(second.page, id);
    expect(items.map((i) => i.state), 'one Needs-you item for the request').toEqual(['pending']);
    const requested = atRelaunch.find((e) => e.kind === 'permission.requested') as Extract<SessionEvent, { kind: 'permission.requested' }>;
    expect(items[0]!.request.requestId).toBe(requested.requestId);
    expect(await attentionOf(second.page, id, 'error'), 'still one error item after a settle').toHaveLength(1);
    log.push(
      `the tail reached main's listeners: the error item "${errorItem!.summary}" (id …:error:${suffix(failure.id)}), from the failure event journaled at seq ${seqOf(failure)} after the app had exited, 1 item (${(await attentionOf(second.page, id, 'error'))[0]?.state}: retired once its restored session showed); main's digest after the resync: phase ${digest.phase}, ${digest.pendingRequests} pending request`,
      `the request's Needs-you item (from the host's re-listed broker items): ${items.length} (${items[0]!.state})`,
    );

    // G4: the memory budget answers from the kept supervisor, counting its session, and the renderer's store holds it
    const budget = value(await invoke(second.page, 'engine.budget', undefined));
    expect(budget.blocked.length + budget.settling + budget.candidates, 'engine.budget counts the kept session').toBe(1);
    await openSurface(second.page, 'Session info');
    const budgetRow = dd(second.page.locator(`[data-session-info="${await addressed(second.page, id)}"]`), 'Memory budget');
    await expect(budgetRow, 'Session info reads the budget the renderer holds').toHaveText(/ · 1 session$/);
    log.push(`engine.budget after the relaunch: ${JSON.stringify(budget)}; Session info's Memory budget "${await budgetRow.textContent()}"`);

    // answered, rows keep arriving
    value(await invoke(second.page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
    await expect.poll(async () => (await pendingPermissions(second.page, id)).filter((i) => i.state === 'pending'), { message: 'the answer retires the request' }).toEqual([]);
    const arrived = () => second.page.evaluate((id) => (window as unknown as { __e10: string[] }).__e10.filter((k) => k.startsWith(`${id}|`)).length, id);
    await expect.poll(arrived, { message: 'rows arrive live after the relaunch' }).toBeGreaterThan(5);
    await finished(second.page, id);
    const received = await second.page.evaluate((id) => (window as unknown as { __e10: string[] }).__e10.filter((k) => k.startsWith(`${id}|`)), id);
    expect(new Set(received).size, 'no event reached the window twice in its live batches').toBe(received.length);

    // the finished stream equals the control's in fixture order (the host's own stream: the same whether or not a
    // client was connected), and the rendered rows equal the control's
    const events = await eventsOf(second.page, id);
    const suffixes = events.map((e) => suffix(e.id));
    expect(new Set(suffixes).size, 'no event id twice').toBe(suffixes.length);
    const seqs = suffixes.map((x) => Number(x.split(':')[0]));
    expect(seqs.every((seq, k) => k === 0 || seq >= seqs[k - 1]!), 'ids in journal order').toBe(true);
    const order = fixtureOrder(events);
    expect(order, 'the host’s stream equals the control run’s, in fixture order (no duplicate, no gap in the stream)').toEqual(control.order);
    const reads = (rows: JournalRow[]) => rows.filter((r) => r.direction === 'meta' && r.frame.event === 'replay_unrecorded_read').length;
    const rows = await settledRows(second.page);
    expect(rows, 'the rendered transcript equals the control run’s').toEqual(control.rows);
    expect(second.maws.consoleErrors()).toEqual([]);
    log.push(
      `rows received live by the window once its listener was installed (after the connect's burst): ${received.length}, none twice`,
      '',
      `finished: the host's stream for the launch holds ${events.length} events, equal in fixture order (journal row rank:i kind) to the control run's ${control.order.length}: ${JSON.stringify(order) === JSON.stringify(control.order)}`,
      `  raw seq:i equal: ${JSON.stringify(suffixes) === JSON.stringify(control.suffixes)} (journal rows ${s.journal(id).length} here, ${control.journal} in the control; the app's own reads are journaled where they fell, ${reads(s.journal(id))} unrecorded-read rows here)`,
      `  this run's seq:i: ${suffixes.join(' ')}`,
      `  control's seq:i:  ${control.suffixes.join(' ')}`,
      `rendered transcript rows: ${rows.length} [${rows.join(', ')}], equal to the control run's ${control.rows.length}: ${JSON.stringify(rows) === JSON.stringify(control.rows)}`,
      '',
      'What this proves: the session kept, the supervisor surviving the app, the same pid at the relaunch, its state re-listed',
      '(status, broker items, budget), the undelivered tail reaching main\'s session.eventBatch listeners (the error item only',
      'it raises), the host\'s stream equal to the control\'s, no event twice in the window\'s live batches. That no tail',
      'event reaches a listener twice rests on the delivered cursor\'s units (Task 2.1) and the live probe\'s Q6: derived',
      'items are keyed by event id and rendered rows by row id, so neither would show a doubled event.',
      '',
      'host.log (the supervisor across both app runs):',
      ...s.log().split('\n').filter(Boolean).map((l) => `  ${l}`),
    );
    evidence('relaunch.txt', log);
  });
});

test('(c) G3: kill -9 of the supervisor mid-turn: the crash toast names the session, Diagnostics shows the new pid, the session is not live', async () => {
  await withScratch('crash', async (s) => {
    const run = await s.launch();
    const old = (await s.ready(run.page)).supervisor!.pid;
    const id = await s.record(run.page);
    const row = await showSession(run.page, id);
    await startTurn(run.page, s, id);
    await untilRequested(run.page, id);
    await expect(submitOf(run.page)).toHaveAttribute('data-submit-state', 'stop');

    const daemonPid = DAEMON ? (await s.ready(run.page)).daemon!.pid : null;
    process.kill(old, 'SIGKILL');
    const killedAt = new Date().toISOString();
    const toast = run.page.getByText(/^The session supervisor stopped unexpectedly/);
    // on the daemon shape `mawsd` started the engine host, so main reads no signal; `mawsd` starts a new one
    const cause = DAEMON ? '' : ' (SIGKILL)';
    await expect(toast).toHaveText(`The session supervisor stopped unexpectedly${cause}; 1 session was interrupted. Their transcripts are on disk; open one to resume.`);
    await toast.hover(); // a hovered toast stays
    const restarted = await s.ready(run.page, (st) => st.supervisor!.pid !== old);
    const fresh = restarted.supervisor!.pid;
    expect(restarted.lastExit).toMatchObject({ code: null, signal: DAEMON ? null : 'SIGKILL', interrupted: 1 });
    expect(s.lock()?.pid).toBe(fresh);
    if (DAEMON) expect(restarted.daemon!.pid, 'mawsd serves on').toBe(daemonPid);

    // the renderer drops the dead host's statuses: the composer no longer offers Stop, the glyph is not live; P2-A: Send
    // offers to start the session again
    await expect(submitOf(run.page)).toHaveAttribute('data-submit-state', 'send');
    await expect(submitOf(run.page)).toHaveAttribute('aria-description', 'Starts this session');
    await expect(glyphOf(row)).not.toHaveAttribute('aria-label', /Working|Needs approval/);
    const composer = `"${await submitOf(run.page).textContent()}" (${await submitOf(run.page).getAttribute('title')})`;
    // the transcript closes the dead turn once the successor's table does not list the session: stopped, not Working
    await expect(run.page.getByText('Session process exited (crash)')).toBeVisible();
    await expect(run.page.getByRole('button', { name: /Stopped after .*\(engine process exited\)/ })).toBeVisible(); // the human turn's divider, in the engine's words (E11)
    await expect(run.page.getByText(/^Working/)).toHaveCount(0);
    await expect(toast).toBeVisible();
    await shots(run.maws, 'notice-crashed', () => null);
    const sessions = value(await invoke(run.page, 'engine.sessions', undefined));
    expect(sessions.filter((st) => st.appSessionId === id && st.process !== 'exited'), 'the new supervisor holds no live row of it').toEqual([]);

    const strip = await openDiagnostics(run.maws);
    const supervisorRow = strip.getByRole('status', { name: 'supervisor' });
    await expect(supervisorRow).toContainText(`pid ${fresh}`);
    await expect(supervisorRow).toContainText(new RegExp(`last unexpected exit ${CLOCK}${DAEMON ? '' : ' \\(SIGKILL\\)'} · 1 interrupted`));
    if (DAEMON) await expect(strip.getByRole('status', { name: 'mawsd' }), 'Diagnostics’ daemon row keeps mawsd’s pid').toContainText(`mawsd · private · pid ${daemonPid} · `);
    const rowText = (await supervisorRow.textContent())!;
    await shots(run.maws, 'diagnostics-supervisor', () => strip);
    expect(run.maws.consoleErrors()).toEqual([]);
    evidence('crash.txt', [
      'E10 G3: kill -9 of the supervisor mid-turn (e2e/supervisor.spec.ts case (c))',
      `supervisor pid ${old} killed with SIGKILL at ${killedAt}, the session mid-turn at its permission request`,
      `toast: ${await toast.textContent().catch(() => '(gone)')}`,
      `host.status after the restart: state ${restarted.state}, pid ${fresh}, lastExit ${JSON.stringify(restarted.lastExit)}`,
      `Diagnostics: ${rowText}`,
      `the composer reads ${composer}; engine.sessions lists no live row of the session`,
      `the lock names pid ${s.lock()?.pid}`,
      '',
      'host.log (the killed supervisor, then its successor):',
      ...s.log().split('\n').filter(Boolean).map((l) => `  ${l}`),
    ]);
  });
});

test('(d) G3: Settings’ Stop all stops the sessions and the supervisor; a fresh one starts and launches', async () => {
  await withScratch('stopall', async (s) => {
    const run = await s.launch();
    const before = await s.ready(run.page);
    const old = before.supervisor!.pid;
    const id = await s.record(run.page);
    await startTurn(run.page, s, id);
    await untilRequested(run.page, id);

    await menu(run.maws, 'settings.open');
    const group = run.page.getByRole('group', { name: 'Background supervisor' });
    await expect(group.getByRole('status')).toHaveText(new RegExp(`^Running since ${CLOCK} · pid ${old} · 1 session · exits 10 min after the last session ends$`));
    await shots(run.maws, 'settings-supervisor', () => group);

    await group.getByRole('button', { name: 'Stop all sessions and the supervisor…' }).click();
    await expect(group).toContainText('Stop 1 session and the supervisor?');
    await group.getByRole('button', { name: 'Stop all', exact: true }).click();
    await expect.poll(() => isAlive(old), { timeout: 15_000 }).toBe(false);
    const after = await s.ready(run.page, (st) => st.supervisor!.pid !== old);
    const fresh = after.supervisor!.pid;
    if (DAEMON) expect(after.daemon!.pid, 'mawsd parked the old engine host and started the new one').toBe(before.daemon!.pid);
    const log = s.log();
    expect(log).toContain('stop all asked');
    expect(log).toContain('exiting (stopAll)');
    expect(s.lock()?.pid).toBe(fresh);
    await expect(group.getByRole('status')).toContainText(`pid ${fresh} · no sessions`);
    expect(value(await invoke(run.page, 'engine.sessions', undefined)).filter((st) => st.process !== 'exited')).toEqual([]);

    // the fresh supervisor admits a launch (a stopped one never could: the shutdown latch)
    await launchReady(run.page, `e10-after-stop-${Date.now()}`, PERMISSION);
    expect(run.maws.consoleErrors()).toEqual([]);
  });
});

// P5 O2 M7: on the daemon shape an idle release is followed by the engine host, parked by `mawsd` once no app and no
// interest have held it for the idle time, then by the private `mawsd` itself once idle. A failed reading carries the
// logs (O16 M2b: they tell a lock left behind from a successor's).
const logsOf = (s: Scratch) => `\nhost.lock: ${JSON.stringify(s.lock())}\nhost.log:\n${s.log().split('\n').slice(-60).join('\n')}\nmawsd.log:\n${s.daemonLog().split('\n').slice(-60).join('\n')}`;
async function parkedThenGone(s: Scratch, idleMs: number, enginePid: number, daemonPid: number): Promise<void> {
  await expect.poll(() => isAlive(enginePid), { timeout: idleMs + 15_000, message: 'mawsd parks the engine host' }).toBe(false);
  expect(existsSync(s.file('host.lock')), `the engine host’s lock is unlinked${existsSync(s.file('host.lock')) ? logsOf(s) : ''}`).toBe(false);
  expect(s.daemonLog()).toContain('no app and no interest for the idle time: asking the engine host to exit when idle');
  await expect.poll(() => isAlive(daemonPid), { timeout: idleMs + 15_000, message: 'the private mawsd exits once idle' }).toBe(false);
  expect(existsSync(s.daemonFile('mawsd.lock')), 'mawsd’s lock is unlinked').toBe(false);
  expect(s.daemonLog()).toContain('no client, both hosts parked and no hold for the idle time');
}

test('(e) G3: an idle kept session is released as idle and the supervisor exits by itself, after a keep-quit and after a kill -9 of the app', async () => {
  const IDLE_MS = 10_000;
  const env = { MAWS_E2E_SUPERVISOR_IDLE_MS: String(IDLE_MS), MAWS_E2E_REPLAY_ROW_MS: '1500' };
  const lines: string[] = ['E10 G3: the idle release and the idle exit (e2e/supervisor.spec.ts case (e))', `MAWS_E2E_SUPERVISOR_IDLE_MS=${IDLE_MS}, MAWS_E2E_REPLAY_ROW_MS=1500, a replay of one human turn`];
  const t0 = Date.now();
  const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const released = (s: Scratch, id: string) => s.journal(id).find((r) => r.direction === 'meta' && r.frame.event === 'exit');
  const completion = (s: Scratch, id: string) => s.journal(id).findIndex((r) => r.direction === 'in' && r.frame.type === 'command_lifecycle' && r.frame.state === 'completed');
  const ended = (s: Scratch, id: string) => completion(s, id) >= 0;
  // host.log's timestamp of the last line matching `pattern`
  const loggedAt = (s: Scratch, pattern: RegExp) => {
    const line = s.log().split('\n').filter((l) => pattern.test(l)).at(-1);
    return line === undefined ? null : Date.parse(line.slice(0, line.indexOf(' ')));
  };
  // The supervisor exits by itself, and not before the idle time has passed since the later of the last client's
  // disconnect and the last idle release (host.log's own clock; 250 ms for the order of a timer's arming and its line)
  const goneAfterIdle = async (s: Scratch, pid: number): Promise<number> => {
    const { socketPath } = s.lock()!; // the profile's path, or its $TMPDIR fallback past 103 bytes
    await expect.poll(() => isAlive(pid), { timeout: IDLE_MS + 15_000, message: 'the supervisor exits by itself' }).toBe(false);
    expect(existsSync(s.file('host.lock')), 'the lock is unlinked').toBe(false);
    expect(existsSync(socketPath), 'the socket is unlinked').toBe(false);
    const exited = loggedAt(s, /exiting \(idle\)$/);
    expect(exited, 'host.log: exiting (idle)').not.toBeNull();
    const idleSince = Math.max(loggedAt(s, /client disconnected$/) ?? 0, loggedAt(s, /idle release of /) ?? 0);
    const waited = exited! - idleSince;
    expect(waited, 'the supervisor waited the idle time before exiting').toBeGreaterThanOrEqual(IDLE_MS - 250);
    return waited;
  };

  if (DAEMON) {
    await withScratch('idle-keep', async (s) => {
      const fixture = turnsJournal(s.root, 'idle', 1);
      s.useStub({ rowMs: 1500 }); // O16 M2b
      const first = await s.launch({ ...env, MAWS_E2E_QUIT_ANSWER: 'keep' });
      const status = await s.ready(first.page);
      const id = await s.record(first.page);
      await startTurn(first.page, s, id, fixture, 'turn 1');
      await s.quit(first);
      expect(first.quitLines()).toContain(keptQuitLine());
      await expect.poll(() => ended(s, id), { timeout: 30_000, message: 'the turn ends while the app is closed' }).toBe(true);
      await expect.poll(() => released(s, id)?.frame.reason, { timeout: IDLE_MS + 15_000, message: 'the idle row is released' }).toBe('idle');
      lines.push('', 'keep-quit (daemon shape):', `  ${at()} the row was released: journal ${JSON.stringify(released(s, id)!.frame)}`);
      await parkedThenGone(s, IDLE_MS, status.supervisor!.pid, status.daemon!.pid);
      lines.push(`  ${at()} the engine host parked and mawsd exited by itself`, '  mawsd.log:', ...s.daemonLog().split('\n').filter(Boolean).map((l) => `    ${l}`));
    });
    await withScratch('idle-kill', async (s) => {
      const fixture = turnsJournal(s.root, 'idle', 1);
      s.useStub({ rowMs: 1500 }); // O16 M2b
      const run = await s.launch(env);
      const status = await s.ready(run.page);
      const id = await s.record(run.page);
      await startTurn(run.page, s, id, fixture, 'turn 1');
      await s.killApp(run);
      expect(ended(s, id), 'the kill landed mid-turn').toBe(false);
      await expect.poll(() => ended(s, id), { timeout: 30_000, message: 'the turn goes on and ends with no app' }).toBe(true);
      await expect.poll(() => released(s, id)?.frame.reason, { timeout: IDLE_MS + 15_000 }).toBe('idle');
      await parkedThenGone(s, IDLE_MS, status.supervisor!.pid, status.daemon!.pid);
    });
    return;
  }

  await withScratch('idle-keep', async (s) => {
    const fixture = turnsJournal(s.root, 'idle', 1);
    s.useStub({ rowMs: 1500 }); // O16 M2b
    const first = await s.launch({ ...env, MAWS_E2E_QUIT_ANSWER: 'keep' });
    const pid = (await s.ready(first.page)).supervisor!.pid;
    const id = await s.record(first.page);
    await startTurn(first.page, s, id, fixture, 'turn 1');
    await s.quit(first);
    expect(first.quitLines()).toContain(keptQuitLine());
    lines.push('', 'keep-quit:', `  ${at()} quit mid-turn, answered keep (pid ${pid} alive ${isAlive(pid)})`);
    await expect.poll(() => ended(s, id), { timeout: 30_000, message: 'the turn ends while the app is closed' }).toBe(true);
    lines.push(`  ${at()} the turn ended with no app connected`);
    await expect.poll(() => released(s, id)?.frame.reason, { timeout: IDLE_MS + 15_000, message: 'the idle row is released' }).toBe('idle');
    lines.push(`  ${at()} the row was released: journal ${JSON.stringify(released(s, id)!.frame)}`);
    expect(isAlive(pid)).toBe(true);

    // relaunched before the supervisor's own idle exit: the session reads released, as idle
    const second = await s.launch(env);
    expect((await s.ready(second.page)).supervisor!.pid).toBe(pid);
    expect(await statusOf(second.page, id)).toMatchObject({ process: 'exited', exit: { reason: 'idle' } });
    const exits = (await eventsOf(second.page, id)).filter((e) => e.kind === 'process.exited');
    expect(exits.map((e) => (e as Extract<SessionEvent, { kind: 'process.exited' }>).reason), 'session.events ends the launch with process.exited, reason idle').toEqual(['idle']);
    const row = await rowOf(second.page, id);
    await expect(row.locator('[data-released-mark]')).toHaveAttribute('title', /while idle/);
    lines.push(`  ${at()} relaunched: the same pid ${pid}; session.status exit.reason idle; session.events' process.exited reason idle; the sidebar's mark "${await row.locator('[data-released-mark]').getAttribute('title')}"`);

    // the app killed: with no client and nothing live, the supervisor exits after the idle time
    await s.killApp(second);
    lines.push(`  ${at()} the app killed with SIGKILL; supervisor alive ${isAlive(pid)}`);
    const waited = await goneAfterIdle(s, pid);
    lines.push(`  ${at()} the supervisor exited by itself ${waited} ms after the app's disconnect; lock and socket unlinked`, '  host.log:', ...s.log().split('\n').filter(Boolean).map((l) => `    ${l}`));
  });

  await withScratch('idle-kill', async (s) => {
    const fixture = turnsJournal(s.root, 'idle', 1);
    s.useStub({ rowMs: 1500 }); // O16 M2b
    const run = await s.launch(env);
    const pid = (await s.ready(run.page)).supervisor!.pid;
    const id = await s.record(run.page);
    await startTurn(run.page, s, id, fixture, 'turn 1');
    await s.killApp(run);
    const before = s.journal(id).length; // read once the app has exited
    expect(ended(s, id), 'the kill landed mid-turn').toBe(false);
    lines.push('', 'kill -9 of the app mid-turn:', `  ${at()} the app killed with SIGKILL mid-turn (pid ${pid} alive ${isAlive(pid)}; ${before} journal rows, no completion)`);
    await expect.poll(() => ended(s, id), { timeout: 30_000, message: 'the turn goes on and ends with no app' }).toBe(true);
    expect(completion(s, id), 'the completion was journaled after the app had exited').toBeGreaterThanOrEqual(before);
    expect(isAlive(pid), 'the supervisor serves on').toBe(true);
    lines.push(`  ${at()} the turn ended with no app connected (${s.journal(id).length - before} journal rows after the kill, the completion at row ${completion(s, id) + 1})`);
    await expect.poll(() => released(s, id)?.frame.reason, { timeout: IDLE_MS + 15_000 }).toBe('idle');
    lines.push(`  ${at()} the row was released: journal ${JSON.stringify(released(s, id)!.frame)}`);
    const waited = await goneAfterIdle(s, pid);
    lines.push(`  ${at()} the supervisor exited by itself ${waited} ms after the idle release; lock and socket unlinked`, '  host.log:', ...s.log().split('\n').filter(Boolean).map((l) => `    ${l}`));
  });
  evidence('idle.txt', lines);
});

// A kept session mid-turn at its request, and the app quit with keep; returns the supervisor's pid. On the daemon shape
// the e2e seams are `mawsd`'s (its environment, from the app that starts it), so the `mawsd` that kept the session is
// killed with -9 and the next launch starts a fresh one carrying that launch's seams; the engine host serves on.
async function keptMidTurn(s: Scratch): Promise<{ pid: number; id: AppSessionId }> {
  const first = await s.launch({ MAWS_E2E_QUIT_ANSWER: 'keep' });
  const status = await s.ready(first.page);
  const pid = status.supervisor!.pid;
  const id = await s.record(first.page);
  await startTurn(first.page, s, id);
  await untilRequested(first.page, id);
  await s.quit(first);
  expect(first.quitLines()).toContain(keptQuitLine());
  expect(isAlive(pid)).toBe(true);
  if (DAEMON) {
    const daemon = status.daemon!.pid;
    expect(isAlive(daemon), 'mawsd serves the kept session').toBe(true);
    process.kill(daemon, 'SIGKILL');
    await expect.poll(() => isAlive(daemon)).toBe(false);
    expect(isAlive(pid), 'the engine host outlives mawsd').toBe(true);
  }
  return { pid, id };
}

test('(f) an update that changed no wire shape: the banner names the kept session; Restart now moves to a new supervisor', async () => {
  await withScratch('updated', async (s) => {
    const { pid } = await keptMidTurn(s);
    const run = await s.launch({ MAWS_E2E_BUILD_ID: 'stale' });
    // served, with its exit armed for when its sessions go idle (§Design 6)
    expect(await s.ready(run.page, (st) => st.supervisor!.exitWhenIdle)).toMatchObject({ matches: 'build', supervisor: { pid, liveSessions: 1, exitWhenIdle: true } });
    const notice = banner(run.page, 'MAWS was updated.');
    await expect(notice).toContainText("MAWS was updated. 1 session is still running on the previous version's supervisor; MAWS moves to the new one when they become idle.");
    await shots(run.maws, 'notice-updated', () => null);
    await notice.getByRole('button', { name: 'Restart now' }).click();
    const fresh = (await s.ready(run.page, (st) => st.supervisor!.pid !== pid)).supervisor!.pid;
    expect(fresh).not.toBe(pid);
    await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);
    await expect(notice).toHaveCount(0);
    expect(await s.ready(run.page)).toMatchObject({ matches: 'same' });
    expect(run.maws.consoleErrors()).toEqual([]);
  });
});

test('(g) an incompatible update: the banner, launches answer host_unavailable, Restart now moves to a new supervisor', async () => {
  await withScratch('incompatible', async (s) => {
    const { pid } = await keptMidTurn(s);
    const run = await s.launch({ MAWS_E2E_WIRE_MAJOR: '4' }); // P5 O1 M6: another wire major (OX1), which no hello of this one's crosses
    await expect
      .poll(async () => {
        const answer = await invoke(run.page, 'host.status', undefined);
        return answer.ok ? { state: answer.value.state, reason: answer.value.reason, waiting: answer.value.waitingLiveSessions } : null;
      }, { timeout: 30_000 })
      .toEqual({ state: 'crashed', reason: 'incompatible', waiting: 1 });
    const notice = banner(run.page, 'cannot talk to the previous supervisor');
    await expect(notice).toContainText('MAWS was updated and cannot talk to the previous supervisor, which still runs 1 session.');
    const refused = await invoke(run.page, 'session.launch', { spec: replaySpec(`e10-refused-${Date.now()}`, PERMISSION) });
    expect(refused.ok ? 'ok' : refused.error.code).toBe('host_unavailable');
    expect(isAlive(pid)).toBe(true);
    await notice.getByRole('button', { name: 'Restart now' }).click();
    const fresh = (await s.ready(run.page, (st) => st.supervisor!.pid !== pid)).supervisor!.pid;
    expect(fresh).not.toBe(pid);
    await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);
    await expect(notice).toHaveCount(0);
  });
});

test('(h) G4: after a keep-quit a restored terminal tab says its shell closed with MAWS; a new terminal does not', async () => {
  if (DAEMON) return terminalsOutliveTheApp();
  await withScratch('terminal', async (s) => {
    const first = await s.launch({ MAWS_E2E_QUIT_ANSWER: 'keep' });
    const pid = (await s.ready(first.page)).supervisor!.pid;
    const id = await s.record(first.page);
    await startTurn(first.page, s, id);
    await untilRequested(first.page, id);
    await showSession(first.page, id);
    await openSurface(first.page, 'Terminal');
    let label = '';
    await expect.poll(async () => {
      const ptys = value(await invoke(first.page, 'pty.list', undefined)).ptys.filter((p) => p.appSessionId === id && p.alive);
      return (label = ptys[0]?.label ?? '');
    }, { timeout: 15_000, message: 'a shell for the session' }).not.toBe('');
    await expect.poll(async () => {
      const layout = value(await invoke(first.page, 'layout.get', { key: `panel.${await addressed(first.page, id)}` })).value as { tabs: { id: string }[] } | null;
      return layout?.tabs.map((t) => t.id) ?? [];
    }, { message: 'the tab reaches layout.json' }).toContain(label);
    await s.quit(first);
    expect(first.quitLines()).toContain(keptQuitLine());

    const second = await s.launch();
    expect((await s.ready(second.page)).supervisor!.pid).toBe(pid);
    await showSession(second.page, id);
    await openSurface(second.page, 'Terminal');
    const region = surface(second.page, 'terminal');
    await expect(region.locator(`[data-tab-id="${label}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(region.locator('[data-terminal-id]:visible')).toHaveCount(1, { timeout: 15_000 });
    const lost = region.getByRole('status', { name: 'previous shell' });
    await expect(lost).toHaveText(/The previous shell closed when MAWS quit/);
    await shots(second.maws, 'terminal-lost', () => region);

    // A tab from Terminal's own strip is new, not restored: no line.
    await region.getByRole('button', { name: 'New terminal tab', exact: true }).click();
    await expect.poll(async () => value(await invoke(second.page, 'pty.list', undefined)).ptys.filter((p) => p.appSessionId === id && p.alive).length, { timeout: 15_000 }).toBe(2);
    await expect(region.locator('[data-terminal-id]:visible')).toHaveCount(1);
    await expect(lost).toBeHidden();
    // back on the restored tab the line is still there until dismissed
    await region.locator(`[data-tab-id="${label}"]`).click();
    await expect(lost).toBeVisible();
    await lost.getByRole('button', { name: 'Dismiss' }).click();
    await expect(lost).toHaveCount(0);
    expect(second.maws.consoleErrors()).toEqual([]);
  });
});

// The bytes a pty's ring holds now, read as text without taking its output credit from the window that holds it.
async function ringText(page: Page, ptyId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const answer = await window.maws.invoke('pty.attach', { ptyId: id as never, credit: false });
    if (!answer.ok) throw new Error(`pty.attach: ${answer.error.code}`);
    return new TextDecoder().decode((answer.value as { replay: Uint8Array }).replay);
  }, ptyId);
}

// (h) on the daemon shape, inverted (acceptance 2): the terminals belong to `mawsd`'s pty host, not the app. After a
// keep-quit the restored tab is alive, the same shell pid, and its ring holds what the shell printed while the app was
// closed; a second terminal that wrote more than the ring and the watermark (about 2 MiB) with the app closed has
// reached its end marker. The markers are computed by the shell, so the echoed command line never matches them.
async function terminalsOutliveTheApp(): Promise<void> {
  const DELAY_S = 6; // after the quit has begun: the output lands while no app runs
  const WRITTEN = 3_000_000;
  await withScratch('terminal', async (s) => {
    const first = await s.launch({ MAWS_E2E_QUIT_ANSWER: 'keep' });
    const daemonPid = (await s.ready(first.page)).daemon!.pid;
    const id = await s.record(first.page);
    await startTurn(first.page, s, id);
    await untilRequested(first.page, id);
    await showSession(first.page, id);
    await openSurface(first.page, 'Terminal');
    const alive = async (page: Page) => value(await invoke(page, 'pty.list', undefined)).ptys.filter((p) => p.appSessionId === id && p.alive);
    let shell: Awaited<ReturnType<typeof alive>>[number] | undefined;
    await expect.poll(async () => (shell = (await alive(first.page))[0]) !== undefined, { timeout: 15_000, message: 'a shell for the session' }).toBe(true);
    const { label, ptyId, pid: shellPid } = shell!;
    await expect.poll(async () => {
      const layout = value(await invoke(first.page, 'layout.get', { key: `panel.${await addressed(first.page, id)}` })).value as { tabs: { id: string }[] } | null;
      return layout?.tabs.map((t) => t.id) ?? [];
    }, { message: 'the tab reaches layout.json' }).toContain(label);
    value(await invoke(first.page, 'pty.write', { ptyId, data: `sleep ${DELAY_S}; echo m7-closed-$((40+2))\n` }));
    const writer = value(await invoke(first.page, 'pty.spawn', { appSessionId: id, label: 'm7-writer', cwd: s.repo, cols: 80, rows: 24, shell: '/bin/sh', args: [], command: `sleep ${DELAY_S}; head -c ${WRITTEN} /dev/zero | tr '\\0' x; echo; echo m7-end-$((40+2))` }));
    await s.quit(first);
    // the two shells run a command, so the log names them; on the daemon shape they keep running and nothing is asked (P5 O3-D, Q1)
    expect(first.quitLines()).toContainEqual(expect.stringMatching(/^quit-guard: 1 mid-turn, (\d+ busy terminals?|terminals unknown), not asked: they outlive the app$/));
    expect(isAlive(shellPid), 'the shell outlives the app').toBe(true);
    expect(isAlive(daemonPid), 'mawsd serves the terminals').toBe(true);
    await new Promise((r) => setTimeout(r, (DELAY_S + 10) * 1_000)); // both commands run to their end with no app

    const second = await s.launch();
    expect((await s.ready(second.page)).daemon!.pid, 'the same mawsd').toBe(daemonPid);
    const ptys = await alive(second.page);
    expect(ptys.find((p) => p.ptyId === ptyId)?.pid, 'the restored terminal’s shell is the same process').toBe(shellPid);
    const written = ptys.find((p) => p.ptyId === writer.ptyId);
    expect(written?.pid, 'the writer’s shell is alive').toBe(writer.pid);
    expect(written!.offset, 'it wrote more than the ring and the watermark while the app was closed').toBeGreaterThan(WRITTEN);
    expect(await ringText(second.page, writer.ptyId), 'and reached its end marker').toContain('m7-end-42');
    expect(await ringText(second.page, ptyId), 'what the shell printed while the app was closed').toContain('m7-closed-42');
    await showSession(second.page, id);
    await openSurface(second.page, 'Terminal');
    const region = surface(second.page, 'terminal');
    await expect(region.locator(`[data-tab-id="${label}"]`)).toBeVisible({ timeout: 15_000 });
    const restored = region.locator('[data-terminal-id]:visible');
    await expect(restored).toHaveCount(1, { timeout: 15_000 });
    // the restored terminal shows it: its emulator's buffer, read through the page's terminals seam (it draws on a canvas)
    const terminalId = (await restored.getAttribute('data-terminal-id'))!;
    await expect.poll(() => second.page.evaluate((tid) => (window as unknown as { __maws_terminals: { lines(id: string): string[] | null } }).__maws_terminals.lines(tid), terminalId), { timeout: 15_000, message: 'the restored terminal renders what the shell printed while the app was closed' }).toContain('m7-closed-42');
    await expect(region.getByRole('status', { name: 'previous shell' }), 'no lost-shell line: the shell is the same').toHaveCount(0);
    expect(second.maws.consoleErrors()).toEqual([]);
  });
}

// ---- P3-A M5: the detached document channel ------------------------------------------------------------------------

// One request to the supervisor as a client of its own, while no app runs: the hello (the token from the profile, this
// build's wire), the request, its answer, the close. It stands in for a session's tool call, which reaches the store
// in the supervisor with no main at all.
// On the daemon shape the stand-in is a client of `mawsd`'s engine-host relay (its token), as the app is: the engine host
// has one client, `mawsd`, and a second would replace it.
async function attentionWithNoApp(s: Scratch): Promise<AttentionItem[]> {
  const reached = await reachMachine(daemonPaths(s.userData), { build: 'e2e-second-client' });
  if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
  try {
    const answer = await reached.link.request('attention.list', undefined);
    if (!answer.ok) throw new Error(`attention.list: ${answer.error.code} ${answer.error.message}`);
    return answer.value as AttentionItem[];
  } finally {
    reached.link.close();
  }
}

async function askWithNoApp(s: Scratch, name: string, input: unknown): Promise<unknown> {
  const socketPath = DAEMON ? s.daemonSockets()['engine-host'] : s.lock()!.socketPath;
  const token = readFileSync(DAEMON ? s.daemonFile('mawsd.token') : s.file('host.token'), 'utf8').trim();
  const socket = createConnection(socketPath);
  try {
    await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject));
    const lines: { t: string; id?: string; ok?: boolean; value?: unknown; error?: unknown }[] = [];
    let buffered = '';
    socket.on('data', (chunk) => {
      buffered += String(chunk);
      for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
        lines.push(JSON.parse(buffered.slice(0, at)));
        buffered = buffered.slice(at + 1);
      }
    });
    // P5 O3-D: on the daemon shape the stand-in runs no spine of its own, so its hello says so (`mawsd` refuses one that does not)
    const capabilities = DAEMON ? [MACHINE_SPINE_CAPABILITY] : [];
    socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: 'e2e-session-stand-in', capabilities, appPid: process.pid })}\n`);
    await expect.poll(() => lines[0]?.t, { message: 'the supervisor welcomes a client with no app running' }).toBe('welcome');
    socket.write(`${JSON.stringify({ t: 'req', id: 'm5', name, input })}\n`);
    await expect.poll(() => lines.some((line) => line.t === 'res' && line.id === 'm5'), { message: `${name} is answered` }).toBe(true);
    const answer = lines.find((line) => line.t === 'res' && line.id === 'm5')!;
    if (!answer.ok) throw new Error(`${name} failed: ${JSON.stringify(answer.error)}`);
    return answer.value;
  } finally {
    socket.end();
  }
}

test('(i) P3-A M5: a document edited while no app runs reads at its new revision through main’s relay, syncs back, and survives a kill -9 of the supervisor mid-edit', async () => {
  await withScratch('documents', async (s) => {
    const first = await s.launch();
    const pid = (await s.ready(first.page)).supervisor!.pid;
    await seamReady(first.page);
    const { artifact } = value(await invoke(first.page, 'artifacts.create', { kind: 'document', title: 'Kept document' }));
    const one = documents(first.page);
    const opened = await one.open(artifact.id); // through main's relay over the socket's document channel
    await one.insertText(opened, 0, 'human;');
    await expect.poll(async () => (await one.state(opened)).unsaved, { message: 'the relayed edit is acknowledged' }).toBe(0);

    // Every window and main itself go; the supervisor serves on, and a session writes to the document.
    await s.killApp(first);
    expect(isAlive(pid), 'the supervisor outlives the app').toBe(true);
    const written = (await askWithNoApp(s, 'artifacts.testWrite', { artifactId: artifact.id, opId: 'm5-absent', appSessionId: 'app-e2e-session', ops: [{ op: 'insertText', index: 0, text: 'agent;' }] })) as { revision: number };

    // The next launch reaches the same supervisor: the list shows the new revision, a relayed replica the content.
    const second = await s.launch();
    expect((await s.ready(second.page)).supervisor!.pid, 'the same supervisor').toBe(pid);
    const row = value(await invoke(second.page, 'artifacts.list', {})).artifacts.find((a) => a.id === artifact.id);
    expect(row?.revision).toBe(written.revision);
    await seamReady(second.page);
    const two = documents(second.page);
    const replica = await two.open(artifact.id);
    expect((await two.json(replica)).text).toBe('agent;human;');
    await two.insertText(replica, 'agent;human;'.length, 'back;');
    await expect.poll(async () => (await two.state(replica)).unsaved, { message: 'the edit syncs back' }).toBe(0);
    const reader = await two.open(artifact.id);
    expect((await two.json(reader)).text).toBe('agent;human;back;');
    await two.close(reader);

    // A kill -9 of the supervisor while the window types through the relay: main starts a new one, and every edit the
    // window was told is durable is there. The typer is closed at once, so nothing it re-sends could hide a loss.
    const start = (await two.state(replica)).revision;
    await two.startTyping(replica, 'k', 5);
    await expect.poll(async () => (await two.state(replica)).revision, { message: 'the typing is being acknowledged' }).toBeGreaterThan(start + 20);
    process.kill(pid, 'SIGKILL');
    const { typed, acked } = await two.stopTyping(replica);
    await two.close(replica);
    expect(acked).toBeGreaterThan(0);
    expect(typed).toBeGreaterThanOrEqual(acked);
    const next = (await s.ready(second.page, (status) => status.supervisor!.pid !== pid)).supervisor!.pid;
    expect(next).not.toBe(pid);
    const after = await two.open(artifact.id);
    const text = (await two.json(after)).text;
    expect(text.startsWith('agent;human;back;')).toBe(true);
    const lost = Array.from({ length: acked }, (_, i) => `k${i};`).filter((token) => !text.includes(token));
    expect(lost, 'every acknowledged keystroke survived the kill').toEqual([]);
    expect(second.maws.consoleErrors()).toEqual([]);
  });
});

// ---- P3-L M7: the library after a detached edit ---------------------------------------------------------------------

// Main's library row of an artifact (its derived index) and the host's own row, to compare revisions.
const libraryRow = async (page: Page, artifactId: string) => value(await invoke(page, 'library.get', { artifactId })).row;
const hostRow = async (page: Page, artifactId: string) => value(await invoke(page, 'artifacts.get', { artifactId })).artifact;
const searched = async (page: Page, query: string) => value(await invoke(page, 'library.list', { filter: { query } })).rows.map((row) => row.title);

test('(j) P3-L M7: the library is right after a detached edit: what a kept session wrote while the app had quit is listed and searchable at the next launch', async () => {
  await withScratch('library', async (s) => {
    // the first run: a session kept mid-turn, and the library indexing what the owner and that session made
    const first = await s.launch({ MAWS_E2E_QUIT_ANSWER: 'keep' });
    const pid = (await s.ready(first.page)).supervisor!.pid;
    const id = await s.record(first.page);
    await startTurn(first.page, s, id);
    await untilRequested(first.page, id);
    const { artifact: notes } = value(await invoke(first.page, 'artifacts.create', { kind: 'document', title: 'Field notes' }));
    const { artifact: doomed } = value(await invoke(first.page, 'artifacts.create', { kind: 'document', title: 'Doomed draft' }));
    value(await invoke(first.page, 'artifacts.testWrite', { artifactId: notes.id, opId: 'lib-before', appSessionId: id, ops: [{ op: 'insertText', index: 0, text: 'The heron counts start at dawn.' }] }));
    await expect.poll(() => searched(first.page, 'heron'), { timeout: 15_000, message: 'the first run indexed the notes’ text' }).toEqual(['Field notes']);
    const before = (await libraryRow(first.page, notes.id))!;
    expect((await libraryRow(first.page, doomed.id))?.title).toBe('Doomed draft');
    await s.quit(first);
    expect(first.quitLines()).toContain(keptQuitLine());
    expect(isAlive(pid), 'the supervisor outlives the app').toBe(true);

    // while no window and no main exist, the session's stand-in edits the notes, makes a report and deletes the draft
    const edited = (await askWithNoApp(s, 'artifacts.testWrite', { artifactId: notes.id, opId: 'lib-away-1', appSessionId: id, ops: [{ op: 'insertText', index: 0, text: 'An okapi crossed the trail. ' }] })) as { revision: number };
    expect(edited.revision).toBeGreaterThan(before.revision);
    const { artifact: report } = (await askWithNoApp(s, 'artifacts.create', { kind: 'document', title: 'Away report' })) as { artifact: { id: string } };
    const reported = (await askWithNoApp(s, 'artifacts.testWrite', { artifactId: report.id, opId: 'lib-away-2', appSessionId: id, ops: [{ op: 'insertText', index: 0, text: 'A narwhal tally, written while MAWS was closed.' }] })) as { revision: number };
    await askWithNoApp(s, 'artifacts.delete', { artifactId: doomed.id });

    // the next launch reaches the same supervisor; main's index, reconciled at the connection, holds the host's state
    const second = await s.launch();
    expect((await s.ready(second.page)).supervisor!.pid, 'the same supervisor').toBe(pid);
    const { page } = second;
    await expect.poll(async () => (await libraryRow(page, notes.id))?.revision, { timeout: 15_000, message: 'the notes at the revision written while away' }).toBe(edited.revision);
    expect((await hostRow(page, notes.id))?.revision).toBe(edited.revision);
    await expect.poll(async () => (await libraryRow(page, report.id))?.revision, { message: 'the report made while away' }).toBe(reported.revision);
    expect(await libraryRow(page, doomed.id), 'the draft deleted while away is gone from the library').toBeNull();
    // the session is each one's last editor (the test writer links no session: a link comes from a session's own create
    // or tool write, which no IPC stand-in can make)
    for (const artifactId of [notes.id, report.id]) expect((await libraryRow(page, artifactId))?.lastEditor).toEqual({ kind: 'session', appSessionId: id });

    // the Artifacts tab shows it: the rows, the words written while away found, the deleted draft absent
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    const library = page.locator('[data-library]');
    const titles = () => ownTitles(page, library); // without the seeded design systems (P3-D)
    await expect.poll(titles, { timeout: 15_000 }).toEqual(['Away report', 'Field notes']);
    const search = library.getByRole('searchbox', { name: 'Search artifacts' });
    await search.fill('okapi');
    await expect.poll(titles, { timeout: 15_000, message: 'the words written while away are searchable' }).toEqual(['Field notes']);
    await search.fill('narwhal');
    await expect.poll(titles, { timeout: 15_000 }).toEqual(['Away report']);
    await search.fill('heron');
    await expect.poll(titles).toEqual(['Field notes']);
    await search.fill('Doomed');
    await expect(library.getByText('No artifacts match “Doomed”.')).toBeVisible();
    expect(second.maws.consoleErrors()).toEqual([]);
  });
});

// ---- P5 O2 M7: the daemon shape's own cases --------------------------------------------------------------------------

test('(l) P5 O2 M7: a kill -9 of mawsd mid-turn: the app’s transport starts a new one; the engine host and the turn go on, the permission card once, no input twice', async () => {
  test.skip(!DAEMON, 'the daemon shape’s case (pnpm e2e:supervisor-daemon)');
  await withScratch('mawsd-kill', async (s) => {
    const run = await s.launch();
    const { page } = run;
    const before = await s.ready(page);
    const [daemonPid, enginePid] = [before.daemon!.pid, before.supervisor!.pid];
    const id = await s.record(page);
    await showSession(page, id);
    await startTurn(page, s, id);
    const requested = await untilRequested(page, id);
    await expect.poll(async () => (await pendingPermissions(page, id)).length, { message: 'the request’s card' }).toBe(1);

    process.kill(daemonPid, 'SIGKILL');
    await expect.poll(() => isAlive(daemonPid)).toBe(false);
    const after = await s.ready(page, (st) => st.daemon!.pid !== daemonPid);
    expect(after.supervisor!.pid, 'the engine host is the same process').toBe(enginePid);
    expect(s.daemonLock()?.pid, 'the new mawsd holds the lock').toBe(after.daemon!.pid);
    expect(await statusOf(page, id), 'the session is live, mid-turn').toMatchObject({ process: 'ready', turn: expect.anything() });
    await new Promise((r) => setTimeout(r, 1_000)); // a duplicate would have landed by now
    expect((await pendingPermissions(page, id)).map((i) => i.request.requestId), 'the card shows once').toEqual([requested.requestId]);
    expect((await eventsOf(page, id)).filter((e) => e.kind === 'permission.requested'), 'one request event').toHaveLength(1);

    value(await invoke(page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
    await expect.poll(async () => (await statusOf(page, id)).turn === null && (await eventsOf(page, id)).some((e) => e.kind === 'turn.ended'), { timeout: 60_000, message: 'the turn completes' }).toBe(true);
    const out = s.journal(id).filter((r) => r.direction === 'out');
    expect(out.filter((r) => r.frame.type === 'user'), 'the prompt was written once').toHaveLength(1);
    expect(out.filter((r) => r.frame.type === 'control_response' && JSON.stringify(r.frame).includes('"behavior"')), 'the answer was written once').toHaveLength(1);
    const ids = (await eventsOf(page, id)).map((e) => e.id);
    expect(new Set(ids).size, 'no event twice').toBe(ids.length);
    expect(run.maws.consoleErrors()).toEqual([]);
  });
});

// Acceptance 3 (P5 §2's release rule, M2): with the app open the engine host releases an idle session no client holds
// interest in, and only that one. A session in a tab is held by main's interest; one marked Keep running by its mark;
// one whose `<cwd>/.claude/scheduled_tasks.json` lists a durable job its lineage created (P5 Decision Logs 46 and 47;
// the probe's recordings, replayed, with the file their `durable_file` row recorded) by that job, freshly launched and
// resumed. The untabbed control shows the release ran in the window the others were watched through.
test('(m) P5 O2 M7: with the app open, an idle session with no tab is released; one in a tab, one kept running and one holding a durable cron (fresh and resumed) are not', async () => {
  const IDLE_MS = 5_000;
  const DURABLE = 'spikes/protocol-probe/fixtures/p5/p5-o2-stop-crons-durable.jsonl';
  const RESUMED = 'spikes/protocol-probe/fixtures/p5/p5-o2-stop-crons-durable-resume.jsonl';
  const rowsOf = (fixture: string) => readFileSync(join(REPO_ROOT, fixture), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow);
  const recorded = rowsOf(DURABLE).find((r) => r.direction === 'meta' && r.frame.event === 'durable_file')!.frame.content;
  const engineSessionId = rowsOf(RESUMED).find((r) => r.direction === 'in' && typeof r.frame.session_id === 'string')!.frame.session_id as string;
  const released = (s: Scratch, id: string) => s.journal(id).find((r) => r.direction === 'meta' && r.frame.event === 'exit');
  await withScratch('interest', async (s) => {
    mkdirSync(join(s.repo, '.claude'), { recursive: true });
    writeFileSync(join(s.repo, '.claude', 'scheduled_tasks.json'), `${JSON.stringify(recorded, null, 2)}\n`);
    s.useStub(); // O16 M2b: every session of the case on the stub engine under a session host
    const run = await s.launch({ MAWS_E2E_SUPERVISOR_IDLE_MS: String(IDLE_MS) });
    const { page } = run;
    await s.ready(page);
    const fixture = turnsJournal(s.root, 'interest', 1);
    const stamp = Date.now();
    // a launch of the replay and its prompt, played to its turn's end (unpaced, a turn may open and end between reads)
    const played = async (id: AppSessionId, replay: string, prompt: string) => {
      await s.launchSession(page, id, replay, { cwd: s.repo });
      value(await invoke(page, 'session.send', { appSessionId: id, content: prompt }));
      await expect.poll(async () => (await eventsOf(page, id)).some((e) => e.kind === 'turn.ended'), { timeout: 30_000, message: `${id}'s turn ends` }).toBe(true);
    };
    const tabbed = await s.record(page);
    await showSession(page, tabbed);
    await played(tabbed, fixture, 'turn 1');
    const untabbed = `m7-untabbed-${stamp}` as AppSessionId;
    await played(untabbed, fixture, 'turn 1');
    const kept = `m7-kept-${stamp}` as AppSessionId;
    await s.launchSession(page, kept, fixture, { cwd: s.repo });
    value(await invoke(page, 'session.setKeep', { appSessionId: kept, keep: true })); // before its turn can make it eligible
    value(await invoke(page, 'session.send', { appSessionId: kept, content: 'turn 1' }));
    const durable = `m7-durable-${stamp}` as AppSessionId;
    await played(durable, DURABLE, firstPrompt(DURABLE));
    const resumed = `m7-resumed-${stamp}` as AppSessionId;
    await s.launchSession(page, resumed, RESUMED, { cwd: s.repo, resume: { sessionId: engineSessionId as never, fork: false }, sessionId: null });
    const all = [tabbed, untabbed, kept, durable, resumed];
    await expect.poll(async () => (await Promise.all(all.map((id) => statusOf(page, id)))).every((st) => st.turn === null), { timeout: 30_000, message: 'every turn has ended' }).toBe(true);

    await expect.poll(() => released(s, untabbed)?.frame.reason, { timeout: IDLE_MS + 20_000, message: 'the untabbed session is released as idle' }).toBe('idle');
    await new Promise((r) => setTimeout(r, IDLE_MS + 2_000)); // past the idle time again: anything due has gone
    for (const [id, why] of [[tabbed, 'in a tab'], [kept, 'kept running'], [durable, 'holding a durable cron'], [resumed, 'resumed, holding a durable cron']] as const) {
      expect(released(s, id), `the session ${why} is not released`).toBeUndefined();
      expect((await statusOf(page, id)).process, `the session ${why} is live`).toBe('ready');
    }
    expect((await statusOf(page, kept)).kept, 'the mark').toBe(true);
    for (const id of [durable, resumed]) {
      const st = await statusOf(page, id);
      expect(st.work?.crons.map((c) => c.id), 'the durable job, read from the file').toEqual(['efd35f19']);
      expect(st.keepAlive).toContain('background_tasks');
    }

    // O16 M5 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, acceptance 2): the release armed through the gate. Three
    // more sessions with no tab, each with a fake observer (the sminos bridge's stand-in) on the engine host's gate.sock,
    // held by the keep mark until the observer has said hello, then let go together.
    const gatePath = (await s.ready(page, (st) => typeof st.supervisor?.holder?.gate === 'string')).supervisor!.holder!.gate!;
    const observers: FakeObserver[] = [];
    try {
      const watched = async (name: string, beat: boolean) => {
        const id = `m7-${name}-${stamp}` as AppSessionId;
        await s.launchSession(page, id, fixture, { cwd: s.repo });
        value(await invoke(page, 'session.setKeep', { appSessionId: id, keep: true }));
        const observer = await FakeObserver.connect(gatePath);
        observers.push(observer);
        observer.hello((await statusOf(page, id)).engineSessionId!, { pid: null, childPid: null });
        await observer.next('welcome', 10_000);
        if (beat) observer.beat(5_000); // the bridge's heartbeat
        await expect.poll(async () => (await statusOf(page, id)).reap?.observer, { message: `${name}: the observer in the status` }).toBe('healthy');
        return { id, observer };
      };
      const armed = await watched('armed', true);
      const turned = await watched('turned', true);
      const silent = await watched('silent', false);
      const acknowledged = await watched('acknowledged', true); // kept until its own scene, below
      for (const { id } of [armed, turned, silent]) value(await invoke(page, 'session.setKeep', { appSessionId: id, keep: false }));
      // armed: the arm comes before any signal; the release follows the scene's armed
      const arm = await armed.observer.next('arm', IDLE_MS + 15_000);
      expect(arm).toMatchObject({ t: 'arm', leaseMs: 10_000 });
      expect(released(s, armed.id), 'no signal before armed').toBeUndefined();
      armed.observer.send({ t: 'armed', fence: arm.fence as number });
      await expect.poll(() => released(s, armed.id)?.frame.reason, { timeout: 20_000, message: 'the armed session is released as idle' }).toBe('idle');
      // turned: a turn after the arm is answered proceed; the session stays live for another period
      const turnArm = await turned.observer.next('arm', IDLE_MS + 15_000);
      turned.observer.send({ t: 'turn', fence: turnArm.fence as number, origin: 'query' });
      expect(await turned.observer.next('proceed', 5_000)).toEqual({ t: 'proceed', fence: turnArm.fence });
      await new Promise((r) => setTimeout(r, IDLE_MS));
      expect(released(s, turned.id), 'the session whose turn proceeded is not released').toBeUndefined();
      expect((await statusOf(page, turned.id)).process).toBe('ready');
      // silent: once its silence passes the window the session is held, past two periods
      await expect.poll(async () => (await statusOf(page, silent.id)).work?.unknown, { timeout: 30_000, message: 'the silent observer holds its session' }).toBe('observer_unhealthy');
      await new Promise((r) => setTimeout(r, 2 * IDLE_MS + 1_000));
      expect(released(s, silent.id), 'the session whose observer went silent is not released').toBeUndefined();
      expect((await statusOf(page, silent.id)).process).toBe('ready');
      // acknowledged: a turn after the observer's armed, before any signal, is answered proceed and the reap is
      // cancelled. A healthy observer's armed within the lease less its margin is signalled in the same step, so the
      // window the design makes real is the renewal (D53, the gate fixture's `armed-renewing-turn-proceed`). An armed
      // after the lease less its margin and before the lease ends is renewed with the same fence, and the turn lands
      // while the host awaits the renewal's armed. The renewal is what shows the host took the armed.
      value(await invoke(page, 'session.setKeep', { appSessionId: acknowledged.id, keep: false }));
      const ackArm = await acknowledged.observer.next('arm', IDLE_MS + 15_000);
      const armSeen = Date.now(); // the host's lease runs from its send, a little earlier
      const leaseMs = ackArm.leaseMs as number;
      // armed 600 ms before the lease ends: past the lease less reap.ts's LEASE_MARGIN_MS (1 s), 400 ms into the window
      await new Promise((r) => setTimeout(r, armSeen + leaseMs - 600 - Date.now()));
      expect(released(s, acknowledged.id), 'no signal before armed').toBeUndefined();
      acknowledged.observer.send({ t: 'armed', fence: ackArm.fence as number });
      expect(await acknowledged.observer.next('arm', 2_000), 'the late armed is taken and the arm renewed').toEqual({ t: 'arm', fence: ackArm.fence, leaseMs });
      acknowledged.observer.send({ t: 'turn', fence: ackArm.fence as number, origin: 'query' });
      expect(await acknowledged.observer.next('proceed', 5_000)).toEqual({ t: 'proceed', fence: ackArm.fence });
      expect(await acknowledged.observer.next('disarm', 5_000), 'the reap is cancelled').toEqual({ t: 'disarm', fence: ackArm.fence });
      await new Promise((r) => setTimeout(r, IDLE_MS));
      expect(released(s, acknowledged.id), 'the session whose turn proceeded after its armed is not released').toBeUndefined();
      expect((await statusOf(page, acknowledged.id)).process).toBe('ready');
    } finally {
      for (const observer of observers) if (!observer.isClosed) await observer.close();
    }
    expect(run.maws.consoleErrors()).toEqual([]);
  });
});

test('(e′) O16 M2b: the spine released just before an idle release: the release’s events load it again, and no engine host starts in place of the one that parks', async () => {
  test.skip(!DAEMON, 'the daemon shape’s case (pnpm e2e:supervisor-daemon)');
  // The race behind case (e)'s flake (hosted run 41217185059), run on purpose. Two clocks start at about the turn's end:
  // the row's idle release (the idle time) and mawsd's spine release (its quiet period, the idle time unless
  // MAWS_SPINE_QUIET_MS sets it). Here the spine's is 2 s shorter, so the spine is cold when the release's events reach
  // mawsd while the engine host, asked to exit when idle, exits. Those events load the spine again. Before #409 that
  // load's pushes (engine.configure, host.configure, fs.bind and the rest) were held by the link for the exiting host
  // and started a successor at its park. Since #409 a load the engine host's events alone caused sends a host that is
  // not ready nothing (spine-seam.ts `wanted`, spine-hosts.ts).
  const IDLE_MS = 10_000;
  const SPINE_QUIET_MS = IDLE_MS - 2_000;
  const released = (s: Scratch, id: string) => s.journal(id).find((r) => r.direction === 'meta' && r.frame.event === 'exit');
  const ended = (s: Scratch, id: string) => s.journal(id).some((r) => r.direction === 'in' && r.frame.type === 'command_lifecycle' && r.frame.state === 'completed');
  const spawns = (s: Scratch) => s.daemonLog().split('\n').filter((l) => l.includes('[hosts] spawned a supervisor'));
  const at = (line: string) => Date.parse(line.slice(0, line.indexOf(' ')));
  await withScratch('spine-race', async (s) => {
    const fixture = turnsJournal(s.root, 'spine-race', 1);
    s.useStub({ rowMs: 1500 });
    const run = await s.launch({ MAWS_E2E_SUPERVISOR_IDLE_MS: String(IDLE_MS), MAWS_SPINE_QUIET_MS: String(SPINE_QUIET_MS) });
    const status = await s.ready(run.page);
    const id = await s.record(run.page);
    await startTurn(run.page, s, id, fixture, 'turn 1');
    const hostsBefore = spawns(s); // both hosts up
    await s.killApp(run);
    expect(ended(s, id), 'the kill landed mid-turn').toBe(false);
    await expect.poll(() => ended(s, id), { timeout: 30_000, message: 'the turn goes on and ends with no app' }).toBe(true);
    await expect.poll(() => released(s, id)?.frame.reason, { timeout: IDLE_MS + 15_000, message: 'the idle row is released' }).toBe('idle');
    await parkedThenGone(s, IDLE_MS, status.supervisor!.pid, status.daemon!.pid);
    expect(spawns(s), `no host was started after the turn began${logsOf(s)}`).toEqual(hostsBefore);

    // the scene ran the race: the spine released before the row did, and the release's events loaded it again
    const release = s.log().split('\n').find((l) => l.includes('idle release of '));
    expect(release, 'host.log: the idle release').toBeDefined();
    const spine = s.daemonLog().split('\n').filter((l) => l.includes('[spine] '));
    const quiet = spine.findLast((l) => l.includes('[spine] releasing (quiet)') && at(l) < at(release!));
    expect(quiet, `the spine released on its quiet before the row's release${logsOf(s)}`).toBeDefined();
    expect(spine.some((l) => l.includes('[spine] loading (event)') && at(l) >= at(release!)), `the release's events loaded the cold spine${logsOf(s)}`).toBe(true);
  });
});
