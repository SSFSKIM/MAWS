// E10's detachable supervisor end to end (E10 execution document, M4 Task 4.1 and Task 4.4; Acceptance G1 to G4): the
// built product with the engine host detached (`MAWS_HOST_MODE=detached`) over C3's replay transport, no engine. Each
// case owns a scratch profile across its relaunches (`launchMaws({userData, keepConfigHome: true})`), and every
// supervisor it starts is killed and its files removed in the case's cleanup, whatever happened:
//   (a) start: the lock, the files and their modes, the process in its own group; an unbusy quit stops it; a kill -9
//       of the app leaves it serving; a kill -9 of it leaves a stale lock a relaunch replaces;
//   (b) G2: a paced replay kept across a quit streams on unobserved (its permission request lands while the app is
//       closed), the relaunch connects to the same pid, the request's Needs-you item shows exactly once, rows keep
//       arriving, and the finished transcript equals a control run's without the quit;
//   (c) G3: kill -9 of the supervisor mid-turn: the crash toast, a new pid in Diagnostics, the session not live;
//   (d) G3: Settings' Stop all: the old supervisor exits, a fresh one starts and launches;
//   (e) G3: the idle release (`idle`) and the supervisor's own idle exit, after a keep-quit and after a kill -9 of the app;
//   (f) an update (another build id): the banner, Restart now, a new pid;
//   (g) an incompatible update (another wire): the banner, launches refused, Restart now, a new pid;
//   (h) G4: a restored terminal after a keep-quit says its shell closed; a new one does not.
// The evidence (`relaunch.txt`, `crash.txt`, `idle.txt`, the screenshots in both themes) is written from what the cases
// observe. Run by `pnpm e2e:supervisor` (MAWS_SUPERVISOR_E2E=1), part of `pnpm verify`.
import { execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostStatus } from '@shared/ipc/schema/host';
import { invoke, launchReady, replaySpec, turnsJournal, value } from './support/c7-replay';
import { COLOUR_TOKENS, menu } from './support/code-product';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_SUPERVISOR_E2E !== '1', 'the supervisor e2e runs under pnpm e2e:supervisor (MAWS_SUPERVISOR_E2E=1)');

// C3's permission round trip: a prompt, ~44 `in` rows, a Bash `can_use_tool` (seq 49) the replay holds at until it is
// answered, ~40 more rows to the turn's result (seq 93), then a hold at the next prompt. Unpaced, the turn stays open at
// the request for as long as nobody answers it, which is how the cases below keep a session mid-turn.
const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
const EVIDENCE = join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e10');
const ROW_MS = '250'; // (b): about 11 s from the prompt to the request, 10 s from the answer to the result

function firstPrompt(fixture: string): string {
  for (const line of readFileSync(join(REPO_ROOT, fixture), 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as { direction: string; frame: { type: string; message?: { content: string } } };
    if (row.direction === 'out' && row.frame.type === 'user') return row.frame.message!.content;
  }
  throw new Error(`${fixture} records no prompt`);
}
const PROMPT = firstPrompt(PERMISSION);

// ---- processes ---------------------------------------------------------------------------------------------------------

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
function ps(pid: number, field: 'pgid' | 'command'): string {
  try {
    return execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return ''; // no such process
  }
}
// Every process whose command line names `text` (a scratch root: the supervisors' `--detached <dir>`), but this one.
function processesNaming(text: string): { pid: number; command: string }[] {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && m[2]!.includes(text))
    .map((m) => ({ pid: Number(m[1]), command: m[2]! }))
    .filter((p) => p.pid !== process.pid);
}

interface Lock { pid: number; procStart: string; socketPath: string; buildId: string }

// ---- one case's scratch profile, its launches and its supervisors ------------------------------------------------------

interface Run {
  maws: MawsLaunch;
  page: Page;
  child: ChildProcess;
  output(): string; // the app's stdout and stderr so far
  quitLines(): string[];
  exited: Promise<void>;
}

class Scratch {
  readonly root: string;
  readonly userData: string;
  readonly repo: string;
  readonly engineId = randomUUID();
  readonly supervisors = new Set<number>(); // every supervisor pid this case saw
  private readonly runs: Run[] = [];
  private readonly sockets = new Set<string>();

  constructor(name: string) {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), `maws-e10-${name}-`)));
    this.userData = join(this.root, 'ud');
    this.repo = join(this.root, 'repo');
    mkdirSync(this.repo, { recursive: true });
    // A session C4 files from a transcript in the engine store, so the replayed launch has a record (the sidebar, the
    // quit report and the panel read records); the store is kept across relaunches.
    const project = join(this.userData, 'claude-config', 'projects', this.repo.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(project, { recursive: true });
    const row = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'supervisor e2e session' }, uuid: randomUUID(), timestamp: '2026-10-06T10:00:00.000Z', cwd: this.repo, sessionId: this.engineId, version: '2.1.283' };
    writeFileSync(join(project, `${this.engineId}.jsonl`), `${JSON.stringify(row)}\n`);
  }

  get dir(): string {
    return join(this.userData, 'supervisor');
  }
  file(name: string): string {
    return join(this.dir, name);
  }
  lock(): Lock | null {
    try {
      const lock = JSON.parse(readFileSync(this.file('host.lock'), 'utf8')) as Lock;
      this.supervisors.add(lock.pid);
      this.sockets.add(lock.socketPath);
      return lock;
    } catch {
      return null;
    }
  }
  log(): string {
    return existsSync(this.file('host.log')) ? readFileSync(this.file('host.log'), 'utf8') : '';
  }

  async launch(env: Record<string, string> = {}): Promise<Run> {
    const maws = await launchMaws({ userData: this.userData, keepConfigHome: true, env: { MAWS_HARNESS: '0', MAWS_HOST_MODE: 'detached', MAWS_ENGINE_REPLAY: '1', ...env } });
    const child = maws.app.process(); // Playwright drops app.process() once the app closes; the cleanup still needs it
    let text = '';
    child.stdout?.on('data', (chunk) => (text += String(chunk)));
    child.stderr?.on('data', (chunk) => (text += String(chunk)));
    const exited = new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));
    const run: Run = { maws, page: maws.page, child, output: () => text, quitLines: () => text.split('\n').filter((l) => l.startsWith('quit-guard:')), exited };
    this.runs.push(run);
    return run;
  }

  // The connected supervisor as main reports it, once main is ready with one.
  async ready(page: Page, match: (s: HostStatus) => boolean = () => true): Promise<HostStatus> {
    let status: HostStatus | null = null;
    await expect
      .poll(async () => {
        const answer = await invoke(page, 'host.status', undefined);
        status = answer.ok ? answer.value : null;
        return status !== null && status.state === 'ready' && status.supervisor !== null && match(status);
      }, { timeout: 30_000, message: 'main is connected to a supervisor' })
      .toBe(true);
    const s = status as unknown as HostStatus;
    this.supervisors.add(s.supervisor!.pid);
    return s;
  }

  // The record C4 filed for the seeded transcript.
  async record(page: Page): Promise<AppSessionId> {
    let id = '';
    await expect
      .poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === this.engineId)?.appId ?? ''), { timeout: 20_000, message: 'the seeded session has a record' })
      .not.toBe('');
    return id as AppSessionId;
  }

  // Every journal row of the session's launches, oldest file first.
  journal(id: string): { direction: string; frame: Record<string, unknown> }[] {
    const dir = join(this.userData, 'engine-host', 'journal', id);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { direction: string; frame: Record<string, unknown> }));
  }

  // The app killed with SIGKILL (no quit, no question): its supervisor is left with no client.
  async killApp(run: Run): Promise<void> {
    run.child.kill('SIGKILL');
    await run.exited;
  }

  async quit(run: Run): Promise<void> {
    await run.maws.app.evaluate(({ app }) => app.quit());
    await bounded(run.exited, 20_000, () => `MAWS did not quit; the guard said ${JSON.stringify(run.quitLines())}`);
  }

  // Every app this case launched is killed, then every supervisor it saw or that names its profile, then the profile.
  async cleanup(): Promise<void> {
    for (const run of this.runs) {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
      await bounded(run.exited, 10_000, () => `app pid ${run.child.pid} did not exit after SIGKILL`).catch((error) => console.error(error));
      await run.maws.cleanup().catch(() => {}); // the app is gone; a given profile is left to this cleanup
    }
    this.lock();
    const named = processesNaming(this.root);
    for (const pid of new Set([...this.supervisors, ...named.map((p) => p.pid)])) {
      // a recorded pid is killed only while it is still a supervisor of this profile (never a reused pid)
      if (isAlive(pid) && ps(pid, 'command').includes(this.root)) process.kill(pid, 'SIGKILL');
    }
    await expect.poll(() => processesNaming(this.root).map((p) => p.pid), { timeout: 10_000, message: `no process of ${this.root} outlives the case` }).toEqual([]);
    for (const socket of this.sockets) if (!socket.startsWith(this.root)) rmSync(dirname(socket), { recursive: true, force: true });
    rmSync(this.root, { recursive: true, force: true });
  }
}

async function bounded<T>(promise: Promise<T>, ms: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message())), ms)));
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function withScratch(name: string, body: (s: Scratch) => Promise<void>): Promise<void> {
  const s = new Scratch(name);
  try {
    await body(s);
  } finally {
    await s.cleanup();
  }
}

// ---- the session ------------------------------------------------------------------------------------------------------

const statusOf = async (page: Page, id: AppSessionId) => value(await invoke(page, 'session.status', { appSessionId: id }));
const eventsOf = async (page: Page, id: AppSessionId) => value(await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null })).events;
const suffix = (eventId: string) => eventId.split(':').slice(-2).join(':'); // `seq:i`: ids embed the session and launch
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
const pendingPermissions = async (page: Page, id: AppSessionId): Promise<AttentionItem[]> =>
  value(await invoke(page, 'attention.list', undefined)).filter((i) => i.appSessionId === id && i.kind === 'permission');

// A replayed launch of the record and its prompt, written once the launch is ready.
async function startTurn(page: Page, s: Scratch, id: AppSessionId, fixture = PERMISSION, prompt = PROMPT): Promise<void> {
  await launchReady(page, id, fixture, { cwd: s.repo });
  value(await invoke(page, 'session.send', { appSessionId: id, content: prompt }));
  await expect.poll(async () => (await statusOf(page, id)).turn !== null, { message: 'the turn is open' }).toBe(true);
}

// The fixture's request, pending (the unpaced replay holds there for as long as nobody answers).
async function untilRequested(page: Page, id: AppSessionId): Promise<Extract<SessionEvent, { kind: 'permission.requested' }>> {
  let requested: SessionEvent | undefined;
  await expect.poll(async () => (requested = (await eventsOf(page, id)).find((e) => e.kind === 'permission.requested')) !== undefined, { timeout: 30_000 }).toBe(true);
  return requested as Extract<SessionEvent, { kind: 'permission.requested' }>;
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
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), `${lines.join('\n')}\n`);
}

// Elements whose background, text or border colour only the other theme's tokens produce (code-product's scan), among
// the elements that paint: one with no layout box (display: none, as xterm's IME composition view is until a
// composition starts, with its own fixed colours) shows nothing in either theme.
async function otherThemeColours(page: Page): Promise<string[]> {
  return page.evaluate((names) => {
    const resolve = (theme: string) => {
      const host = document.createElement('div');
      host.setAttribute('data-theme', theme);
      const probe = document.createElement('span');
      host.append(probe);
      document.body.append(host);
      const out = names.map((name) => {
        probe.style.color = `var(${name})`;
        return getComputedStyle(probe).color;
      });
      host.remove();
      return out;
    };
    const themed = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const own = resolve(themed);
    const forbidden = [...new Set(resolve(themed === 'dark' ? 'light' : 'dark'))].filter((colour) => !own.includes(colour));
    const props = ['background-color', 'color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.getClientRects().length === 0) continue;
      const style = getComputedStyle(el);
      const prop = props.find((p) => forbidden.includes(style.getPropertyValue(p)));
      if (prop) offenders.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').slice(0, 60)} ${prop} ${style.getPropertyValue(prop)}`);
      if (offenders.length >= 8) break;
    }
    return offenders;
  }, COLOUR_TOKENS);
}

// `target` in both themes (light last, the default), each checked for the other theme's colours first.
async function shots(maws: MawsLaunch, name: string, target: () => Locator | null): Promise<void> {
  const { page } = maws;
  mkdirSync(EVIDENCE, { recursive: true });
  for (const theme of ['dark', 'light'] as const) {
    await menu(maws, `theme.${theme}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await otherThemeColours(page), `${theme}: ${name}`).toEqual([]);
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
  await withScratch('start', async (s) => {
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

    // an unbusy quit stops every session and the supervisor with them (residue 23)
    await s.quit(first);
    await expect.poll(() => isAlive(lock.pid), { timeout: 10_000 }).toBe(false);
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

test('(b) G2: a kept session streams on while the app is closed; the relaunch catches up exactly once and ends as a control run does', async () => {
  const pace = { MAWS_E2E_REPLAY_ROW_MS: ROW_MS };
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
    const run = await s.launch(pace);
    await s.ready(run.page);
    const id = await s.record(run.page);
    await startTurn(run.page, s, id);
    // shown once the launch is live, as the relaunched window first shows it: a window attached to a live launch
    // hydrates the launch's events, and only one attached before it also holds the record's disk history
    await showSession(run.page, id);
    const requested = await untilRequested(run.page, id);
    value(await invoke(run.page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
    await finished(run.page, id);
    const events = await eventsOf(run.page, id);
    control.order = fixtureOrder(events);
    control.suffixes = events.map((e) => suffix(e.id));
    control.journal = s.journal(id).length;
    control.rows = await settledRows(run.page);
    expect(run.maws.consoleErrors()).toEqual([]);
  });

  await withScratch('keep', async (s) => {
    const log: string[] = ['E10 G2: a kept session across a quit and a relaunch (e2e/supervisor.spec.ts case (b))', `fixture ${PERMISSION}, MAWS_E2E_REPLAY_ROW_MS=${ROW_MS}`, ''];
    const first = await s.launch({ ...pace, MAWS_E2E_QUIT_ANSWER: 'keep' });
    const pid = (await s.ready(first.page)).supervisor!.pid;
    const id = await s.record(first.page);
    await startTurn(first.page, s, id);
    await showSession(first.page, id);
    await expect.poll(async () => (await eventsOf(first.page, id)).length, { message: 'a few rows have streamed' }).toBeGreaterThan(5);
    const seenBeforeQuit = (await eventsOf(first.page, id)).length;
    expect((await eventsOf(first.page, id)).some((e) => e.kind === 'permission.requested'), 'the request comes after the quit').toBe(false);
    await s.quit(first);
    const keepLine = first.quitLines().find((l) => l.includes('auto-answered keep'));
    expect(keepLine).toBe('quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
    expect(isAlive(pid), 'the supervisor outlives the app').toBe(true);
    log.push(`first run: supervisor pid ${pid}; ${seenBeforeQuit} events seen before the quit`, keepLine!, `after the app exited: pid ${pid} alive ${isAlive(pid)}`);

    // unobserved: the replay streams on and its permission request lands while no app is connected
    const journalLength = s.journal(id).length;
    await expect.poll(() => s.journal(id).some((r) => r.direction === 'in' && (r.frame.request as { subtype?: string } | undefined)?.subtype === 'can_use_tool'), { timeout: 30_000, message: 'the request reaches the journal while the app is closed' }).toBe(true);
    const unobservedRows = s.journal(id).length - journalLength;
    log.push(`while closed: ${unobservedRows} journal rows written, the permission request among them`);

    const second = await s.launch(pace);
    const status = await s.ready(second.page);
    expect(status.supervisor!.pid, 'the relaunch connects to the same supervisor').toBe(pid);
    expect(s.log().match(/client connected: appPid/g), 'the supervisor logs both apps’ connects').toHaveLength(2);
    expect(s.log().match(/ starting in /g), 'and started once').toHaveLength(1);
    await second.page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __e10: string[] }).__e10 = seen;
      window.maws.on('session.eventBatch', (batch) => seen.push(...batch.events.map((e) => `${batch.appSessionId}|${e.id}`)));
    });
    const atRelaunch = await eventsOf(second.page, id);
    expect(atRelaunch.length).toBeGreaterThan(seenBeforeQuit);
    const live = await statusOf(second.page, id);
    expect(live).toMatchObject({ process: 'ready', turn: expect.anything() });
    log.push('', `relaunch: the same supervisor pid ${status.supervisor!.pid}; ${atRelaunch.length} events in the launch at the connect, ${atRelaunch.length - seenBeforeQuit} of them streamed while the app was closed`);

    // the derived effect from inside the absence: the request's Needs-you item, exactly once
    await expect.poll(async () => (await pendingPermissions(second.page, id)).length, { message: 'the Needs-you item of the request raised while away' }).toBe(1);
    const row = await showSession(second.page, id);
    await expect(glyphOf(row)).toHaveAttribute('aria-label', 'Needs approval');
    await expect(submitOf(second.page), 'the renderer reads the turn open').toHaveAttribute('data-submit-state', 'stop');
    await new Promise((r) => setTimeout(r, 1_000));
    const items = await pendingPermissions(second.page, id);
    expect(items.map((i) => i.state), 'one Needs-you item, not two').toEqual(['pending']);
    const requested = atRelaunch.find((e) => e.kind === 'permission.requested') as Extract<SessionEvent, { kind: 'permission.requested' }>;
    expect(items[0]!.request.requestId).toBe(requested.requestId);
    log.push(`Needs-you items for the request after the relaunch: ${items.length} (${items[0]!.state}); sidebar glyph "Needs approval"`);

    // answered, rows keep arriving
    value(await invoke(second.page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
    await expect(glyphOf(row)).toHaveAttribute('aria-label', 'Working');
    const arrived = () => second.page.evaluate((id) => (window as unknown as { __e10: string[] }).__e10.filter((k) => k.startsWith(`${id}|`)).length, id);
    await expect.poll(arrived, { message: 'rows arrive live after the relaunch' }).toBeGreaterThan(5);
    await finished(second.page, id);
    const received = await second.page.evaluate((id) => (window as unknown as { __e10: string[] }).__e10.filter((k) => k.startsWith(`${id}|`)), id);
    expect(new Set(received).size, 'no event reached the window twice').toBe(received.length);

    // the finished transcript equals the control's: the same `seq:i` ids, the same rendered rows
    const events = await eventsOf(second.page, id);
    const suffixes = events.map((e) => suffix(e.id));
    expect(new Set(suffixes).size, 'no event id twice').toBe(suffixes.length);
    const seqs = suffixes.map((x) => Number(x.split(':')[0]));
    expect(seqs.every((seq, k) => k === 0 || seq >= seqs[k - 1]!), 'ids in journal order').toBe(true);
    const order = fixtureOrder(events);
    expect(order, 'the events equal the control run’s, in order (no duplicate, no gap)').toEqual(control.order);
    const reads = (rows: { direction: string; frame: Record<string, unknown> }[]) => rows.filter((r) => r.direction === 'meta' && r.frame.event === 'replay_unrecorded_read').length;
    const rows = await settledRows(second.page);
    expect(rows, 'the rendered transcript equals the control run’s').toEqual(control.rows);
    expect((await pendingPermissions(second.page, id)).filter((i) => i.state === 'pending')).toEqual([]);
    expect(second.maws.consoleErrors()).toEqual([]);
    log.push(
      `rows received live by the window after the relaunch: ${received.length}, none twice`,
      '',
      `finished: ${events.length} events, equal in fixture order (journal row rank:i kind) to the control run's ${control.order.length}: ${JSON.stringify(order) === JSON.stringify(control.order)}`,
      `  raw seq:i equal: ${JSON.stringify(suffixes) === JSON.stringify(control.suffixes)} (journal rows ${s.journal(id).length} here, ${control.journal} in the control; the app's own reads are journaled where they fell, ${reads(s.journal(id))} unrecorded-read rows here)`,
      `  this run's seq:i: ${suffixes.join(' ')}`,
      `  control's seq:i:  ${control.suffixes.join(' ')}`,
      `rendered transcript rows: ${rows.length} [${rows.join(', ')}], equal to the control run's ${control.rows.length}: ${JSON.stringify(rows) === JSON.stringify(control.rows)}`,
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

    process.kill(old, 'SIGKILL');
    const killedAt = new Date().toISOString();
    const toast = run.page.getByText(/^The session supervisor stopped unexpectedly/);
    await expect(toast).toHaveText('The session supervisor stopped unexpectedly (SIGKILL); 1 session was interrupted. Their transcripts are on disk; open one to resume.');
    await toast.hover(); // a hovered toast stays
    await shots(run.maws, 'notice-crashed', () => null);
    const restarted = await s.ready(run.page, (st) => st.supervisor!.pid !== old);
    const fresh = restarted.supervisor!.pid;
    expect(restarted.lastExit).toMatchObject({ code: null, signal: 'SIGKILL', interrupted: 1 });
    expect(s.lock()?.pid).toBe(fresh);

    // the renderer drops the dead host's statuses: the composer no longer offers Stop, the glyph is not live
    await expect(submitOf(run.page)).toHaveAttribute('data-submit-state', 'send');
    await expect(submitOf(run.page)).toHaveAttribute('title', 'Session ended');
    await expect(glyphOf(row)).not.toHaveAttribute('aria-label', /Working|Needs approval/);
    const composer = `"${await submitOf(run.page).textContent()}" (${await submitOf(run.page).getAttribute('title')})`;
    const sessions = value(await invoke(run.page, 'engine.sessions', undefined));
    expect(sessions.filter((st) => st.appSessionId === id && st.process !== 'exited'), 'the new supervisor holds no live row of it').toEqual([]);

    const strip = await openDiagnostics(run.maws);
    const supervisorRow = strip.getByRole('status', { name: 'supervisor' }).or(strip.locator('output[aria-label="supervisor"]'));
    await expect(supervisorRow).toContainText(`pid ${fresh}`);
    await expect(supervisorRow).toContainText(/last unexpected exit \d\d:\d\d \(SIGKILL\) · 1 interrupted/);
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
    const old = (await s.ready(run.page)).supervisor!.pid;
    const id = await s.record(run.page);
    await startTurn(run.page, s, id);
    await untilRequested(run.page, id);

    await menu(run.maws, 'settings.open');
    const group = run.page.getByRole('group', { name: 'Background supervisor' });
    await expect(group.getByRole('status')).toHaveText(new RegExp(`^Running since \\d\\d:\\d\\d · pid ${old} · 1 session · exits 10 min after the last session ends$`));
    await shots(run.maws, 'settings-supervisor', () => group);

    await group.getByRole('button', { name: 'Stop all sessions and the supervisor…' }).click();
    await expect(group).toContainText('Stop 1 session and the supervisor?');
    await group.getByRole('button', { name: 'Stop all', exact: true }).click();
    await expect.poll(() => isAlive(old), { timeout: 15_000 }).toBe(false);
    const fresh = (await s.ready(run.page, (st) => st.supervisor!.pid !== old)).supervisor!.pid;
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

test('(e) G3: an idle kept session is released as idle and the supervisor exits by itself, after a keep-quit and after a kill -9 of the app', async () => {
  const IDLE_MS = 10_000;
  const env = { MAWS_E2E_SUPERVISOR_IDLE_MS: String(IDLE_MS), MAWS_E2E_REPLAY_ROW_MS: '1500' };
  const lines: string[] = ['E10 G3: the idle release and the idle exit (e2e/supervisor.spec.ts case (e))', `MAWS_E2E_SUPERVISOR_IDLE_MS=${IDLE_MS}, MAWS_E2E_REPLAY_ROW_MS=1500, a replay of one human turn`];
  const t0 = Date.now();
  const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const released = (s: Scratch, id: string) => s.journal(id).find((r) => r.direction === 'meta' && r.frame.event === 'exit');
  const ended = (s: Scratch, id: string) => s.journal(id).some((r) => r.direction === 'in' && r.frame.type === 'command_lifecycle' && r.frame.state === 'completed');
  const goneAfterIdle = async (s: Scratch, pid: number) => {
    const { socketPath } = s.lock()!; // the profile's path, or its $TMPDIR fallback past 103 bytes
    await expect.poll(() => isAlive(pid), { timeout: IDLE_MS + 15_000, message: 'the supervisor exits by itself' }).toBe(false);
    expect(existsSync(s.file('host.lock')), 'the lock is unlinked').toBe(false);
    expect(existsSync(socketPath), 'the socket is unlinked').toBe(false);
    expect(s.log()).toContain('exiting (idle)');
  };

  await withScratch('idle-keep', async (s) => {
    const fixture = turnsJournal(s.root, 'idle', 1);
    const first = await s.launch({ ...env, MAWS_E2E_QUIT_ANSWER: 'keep' });
    const pid = (await s.ready(first.page)).supervisor!.pid;
    const id = await s.record(first.page);
    await startTurn(first.page, s, id, fixture, 'turn 1');
    await s.quit(first);
    expect(first.quitLines()).toContain('quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
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
    const row = await rowOf(second.page, id);
    await expect(row.locator('[data-released-mark]')).toHaveAttribute('title', /while idle/);
    lines.push(`  ${at()} relaunched: the same pid ${pid}; session.status exit.reason idle; the sidebar's mark "${await row.locator('[data-released-mark]').getAttribute('title')}"`);

    // the app killed: with no client and nothing live, the supervisor exits after the idle time
    await s.killApp(second);
    lines.push(`  ${at()} the app killed with SIGKILL; supervisor alive ${isAlive(pid)}`);
    await goneAfterIdle(s, pid);
    lines.push(`  ${at()} the supervisor exited by itself; lock and socket unlinked`, '  host.log:', ...s.log().split('\n').filter(Boolean).map((l) => `    ${l}`));
  });

  await withScratch('idle-kill', async (s) => {
    const fixture = turnsJournal(s.root, 'idle', 1);
    const run = await s.launch(env);
    const pid = (await s.ready(run.page)).supervisor!.pid;
    const id = await s.record(run.page);
    await startTurn(run.page, s, id, fixture, 'turn 1');
    const before = s.journal(id).length;
    await s.killApp(run);
    lines.push('', 'kill -9 of the app mid-turn:', `  ${at()} the app killed with SIGKILL mid-turn (pid ${pid} alive ${isAlive(pid)})`);
    await expect.poll(() => ended(s, id), { timeout: 30_000, message: 'the turn goes on and ends with no app' }).toBe(true);
    expect(isAlive(pid), 'the supervisor serves on').toBe(true);
    lines.push(`  ${at()} the turn ended with no app connected (${s.journal(id).length - before} journal rows after the kill)`);
    await expect.poll(() => released(s, id)?.frame.reason, { timeout: IDLE_MS + 15_000 }).toBe('idle');
    lines.push(`  ${at()} the row was released: journal ${JSON.stringify(released(s, id)!.frame)}`);
    await goneAfterIdle(s, pid);
    lines.push(`  ${at()} the supervisor exited by itself; lock and socket unlinked`, '  host.log:', ...s.log().split('\n').filter(Boolean).map((l) => `    ${l}`));
  });
  evidence('idle.txt', lines);
});

// A kept session mid-turn at its request, and the app quit with keep; returns the supervisor's pid.
async function keptMidTurn(s: Scratch): Promise<{ pid: number; id: AppSessionId }> {
  const first = await s.launch({ MAWS_E2E_QUIT_ANSWER: 'keep' });
  const pid = (await s.ready(first.page)).supervisor!.pid;
  const id = await s.record(first.page);
  await startTurn(first.page, s, id);
  await untilRequested(first.page, id);
  await s.quit(first);
  expect(first.quitLines()).toContain('quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
  expect(isAlive(pid)).toBe(true);
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
    const run = await s.launch({ MAWS_E2E_WIRE: 'other' });
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
  await withScratch('terminal', async (s) => {
    const first = await s.launch({ MAWS_E2E_QUIT_ANSWER: 'keep' });
    const pid = (await s.ready(first.page)).supervisor!.pid;
    const id = await s.record(first.page);
    await startTurn(first.page, s, id);
    await untilRequested(first.page, id);
    await showSession(first.page, id);
    const panel = first.page.locator('[data-region="panel"]');
    await panel.getByRole('button', { name: 'Add a tool' }).click();
    await first.page.getByRole('menuitem', { name: 'Terminal' }).click();
    let label = '';
    await expect.poll(async () => {
      const ptys = value(await invoke(first.page, 'pty.list', undefined)).ptys.filter((p) => p.appSessionId === id && p.alive);
      return (label = ptys[0]?.label ?? '');
    }, { timeout: 15_000, message: 'a shell for the session' }).not.toBe('');
    await expect.poll(async () => {
      const layout = value(await invoke(first.page, 'layout.get', { key: `panel.${id}` })).value as { tabs: { id: string }[] } | null;
      return layout?.tabs.map((t) => t.id) ?? [];
    }, { message: 'the tab reaches layout.json' }).toContain(label);
    await s.quit(first);
    expect(first.quitLines()).toContain('quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');

    const second = await s.launch();
    expect((await s.ready(second.page)).supervisor!.pid).toBe(pid);
    await showSession(second.page, id);
    const region = second.page.locator('[data-region="panel"]');
    await expect(region.locator(`[data-tab-id="${label}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(region.locator('[data-terminal-id]:visible')).toHaveCount(1, { timeout: 15_000 });
    const lost = region.getByRole('status', { name: 'previous shell' });
    await expect(lost).toHaveText(/The previous shell closed when MAWS quit/);
    await shots(second.maws, 'terminal-lost', () => region);

    // a terminal from the + menu is new, not restored: no line
    await region.getByRole('button', { name: 'Add a tool' }).click();
    await second.page.getByRole('menuitem', { name: 'Terminal' }).click();
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
