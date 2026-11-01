// A detached supervisor's end-to-end scratch (E10 execution document, M4; moved here from e2e/supervisor.spec.ts for
// the two-build check, e2e/cross-build.spec.ts): a case's profile across its relaunches, its supervisors and the kept
// session's fixtures. Each case owns a scratch profile across its relaunches (`launchMaws({userData, keepConfigHome:
// true})`), and every supervisor it starts is killed and its files removed in the case's cleanup, whatever happened.
// A launch may run another checkout's built app on the same profile (`root`, launch.ts), so a case can keep a session on
// one build's supervisor and attach another build's app to it.
// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): under `MAWS_HOST_MODE=daemon` (`e2e:supervisor-daemon`)
// every launch runs on the daemon shape: main reaches the engine host through a private `mawsd` on the profile, whose
// lock and sockets are under `<profile>/mawsd/`; the engine host keeps the supervisor's files. `ready` then waits for
// main to know the daemon too, and every `mawsd` the case saw is killed with the supervisors.
// P5 O16 M2b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md; D28, D31): a case that calls `useStub` runs its
// sessions on the stub engine, a real process each under a real session host, instead of the in-process replay:
// every launch of the app names the stub (MAWS_E2E_ENGINE_BIN), and `launchSession` (and so `startTurn`) launches live
// sessions that play their fixture on it. Every other case keeps the replay.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { DAEMON_FILES, daemonPaths } from '@shared/daemon/files';
import type { HostStatus } from '@shared/ipc/schema/host';
import { invoke, launchReady, value } from './c7-replay';
import { launchMaws, onLaunched, REPO_ROOT, type MawsLaunch } from './launch';
import { killScratchProcesses } from './processes';
import { tmpSocketDirOf } from './supervisor-socket';
import { stubLaunchReady, writeStubEngine, type StubEngine, type StubSceneOptions } from './stub-engine'; // P5 O16 M2b

// C3's permission round trip: a prompt, ~44 `in` rows, a Bash `can_use_tool` (seq 49) the replay holds at until it is
// answered, ~40 more rows to the turn's result (seq 93), then a hold at the next prompt. Unpaced, the turn stays open at
// the request for as long as nobody answers it, which is how the cases keep a session mid-turn.
export const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';

export function firstPrompt(fixture: string): string {
  for (const line of readFileSync(join(REPO_ROOT, fixture), 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as { direction: string; frame: { type: string; message?: { content: string } } };
    if (row.direction === 'out' && row.frame.type === 'user') return row.frame.message!.content;
  }
  throw new Error(`${fixture} records no prompt`);
}
export const PROMPT = firstPrompt(PERMISSION);

// The kept-session fixture: the permission round trip with one background task's failure (a `task_notification`, status
// failed, as C3's frames carry one) inserted right before its request, so the span the app is closed for holds an event
// whose derived effect only main's `session.eventBatch` listeners produce: the attention service's error item (nothing
// else derives it, the resync folds only the digest, and the first app never saw the event).
export const TASK_FAILED = 'e10 background check';
export function tailFixture(dir: string): string {
  const rows = readFileSync(join(REPO_ROOT, PERMISSION), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow);
  const at = rows.findIndex(isRequestRow);
  const before = rows[at - 1]!;
  const failure = { type: 'system', subtype: 'task_notification', task_id: 'e10tail01', status: 'failed', output_file: null, summary: TASK_FAILED, uuid: 'e1000000-0000-4000-8000-000000000001', session_id: before.frame.session_id };
  rows.splice(at, 0, { seq: 0, direction: 'in', at: before.at, frame: failure });
  const path = join(dir, 'permission-task-failure.jsonl');
  writeFileSync(path, `${rows.map((row, k) => JSON.stringify({ ...row, seq: k + 1 })).join('\n')}\n`);
  return path;
}

export interface Lock { pid: number; procStart: string; socketPath: string; buildId: string }

// The shape the suite runs on: the daemon's under `e2e:supervisor-daemon`, else the embedded shape's detached supervisor.
export const HOST_MODE = process.env.MAWS_HOST_MODE === 'daemon' ? 'daemon' : 'detached';
export const DAEMON = HOST_MODE === 'daemon';
// The quit guard's line for a quit that leaves one session running mid-turn (`parts`, the report's words): a keep the
// embedded shape asks and the case answers; on the daemon shape nothing is asked, the sessions outliving the app (P5
// O3-D, Q1)
export const keptQuitLine = (parts = '1 mid-turn') => (DAEMON ? `quit-guard: ${parts}, not asked: they outlive the app` : `quit-guard: ${parts}, auto-answered keep, 1 session kept`);
export interface JournalRow { seq: number; direction: string; at: string; frame: Record<string, unknown> }
export const isRequestRow = (r: JournalRow) => r.direction === 'in' && (r.frame.request as { subtype?: string } | undefined)?.subtype === 'can_use_tool';
export const isTaskFailureRow = (r: JournalRow) => r.direction === 'in' && r.frame.type === 'system' && r.frame.subtype === 'task_notification';

// ---- one case's scratch profile, its launches and its supervisors ------------------------------------------------------

export interface Run {
  maws: MawsLaunch;
  page: Page;
  child: ChildProcess;
  output(): string; // the app's stdout and stderr so far
  quitLines(): string[];
  exited: Promise<void>;
}

export class Scratch {
  readonly root: string;
  readonly userData: string;
  readonly repo: string;
  readonly engineId = randomUUID();
  readonly supervisors = new Set<number>(); // every supervisor pid this case saw
  readonly daemons = new Set<number>(); // every `mawsd` pid this case saw (the daemon shape)
  stub: StubEngine | null = null; // P5 O16 M2b: the case's engine, once `useStub` wrote it
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

  // The daemon shape's `mawsd`: its directory, files, lock and log.
  get daemonDir(): string {
    return join(this.userData, DAEMON_FILES.dir);
  }
  daemonFile(name: string): string {
    return join(this.daemonDir, name);
  }
  daemonSockets(): Record<'engine-host' | 'pty-host' | 'machine', string> {
    return daemonPaths(this.userData).sockets;
  }
  daemonLock(): Lock | null {
    try {
      const lock = JSON.parse(readFileSync(this.daemonFile(DAEMON_FILES.lock), 'utf8')) as Lock;
      this.daemons.add(lock.pid);
      return lock;
    } catch {
      return null;
    }
  }
  daemonLog(): string {
    return existsSync(this.daemonFile(DAEMON_FILES.log)) ? readFileSync(this.daemonFile(DAEMON_FILES.log), 'utf8') : '';
  }

  // P5 O16 M2b: the case's sessions on the stub engine from here on, `rowMs` the pace of its `in` rows (the value the
  // case gives MAWS_E2E_REPLAY_ROW_MS); call before the first launch that should name it
  useStub(opts: StubSceneOptions = {}): StubEngine {
    this.stub = writeStubEngine(this.root, opts);
    return this.stub;
  }

  // P5 O16 M3c: `fixture` as the seeded transcript's own session (its recorded session id replaced by this case's engine
  // id), for a resume of the record: the record, its transcript and its binding keep one engine session id
  asOwnSession(fixture: string): string {
    const text = readFileSync(join(REPO_ROOT, fixture), 'utf8');
    const recorded = text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow).find((r) => r.direction === 'in' && typeof r.frame.session_id === 'string')!.frame.session_id as string;
    const path = join(this.root, `own-${randomUUID()}.jsonl`);
    writeFileSync(path, text.replaceAll(recorded, this.engineId));
    return path;
  }

  // P5 O16 M3c: a subagent transcript of the seeded session (`<sessionId>/subagents/agent-<id>.jsonl` beside the
  // transcript), as the engine writes one when the model starts an agent
  writeAgent(agentId: string): void {
    const dir = join(this.userData, 'claude-config', 'projects', this.repo.replace(/[^a-zA-Z0-9]/g, '-'), this.engineId, 'subagents');
    mkdirSync(dir, { recursive: true });
    const row = { parentUuid: null, isSidechain: true, type: 'user', message: { role: 'user', content: `agent ${agentId}'s task` }, uuid: randomUUID(), timestamp: new Date().toISOString(), cwd: this.repo, sessionId: this.engineId, agentId, version: '2.1.283' };
    writeFileSync(join(dir, `agent-${agentId}.jsonl`), `${JSON.stringify(row)}\n`);
  }

  // P5 O16 M3c: `mawsd <args> --profile <profile>`, the built CLI under this checkout's Electron as Node, as an owner
  // runs it against the profile's daemon (src/mawsd/cli.ts)
  mawsd(args: string[], timeoutMs = 150_000): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const electron = join(REPO_ROOT, 'node_modules', 'electron', 'dist', readFileSync(join(REPO_ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8').trim());
    const script = join(REPO_ROOT, 'out', 'main', 'mawsd.js');
    return new Promise((done, failed) => {
      const run = spawn(electron, ['--disable-sigusr1', script, ...args, '--profile', this.userData], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MAWS_E2E: '1' }, stdio: ['ignore', 'pipe', 'pipe'], argv0: 'mawsd' });
      let [stdout, stderr] = ['', ''];
      run.stdout!.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
      run.stderr!.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
      const timer = setTimeout(() => {
        run.kill('SIGKILL');
        failed(new Error(`mawsd ${args.join(' ')} did not end within ${timeoutMs} ms: ${stdout}${stderr}`));
      }, timeoutMs);
      run.once('exit', (status) => {
        clearTimeout(timer);
        done({ status, stdout, stderr });
      });
    });
  }

  // P5 O16 M3c: the session's journaled stderr lines, oldest first (the stub's directives print theirs there)
  stderrOf(id: string): string[] {
    return this.journal(id).filter((r) => r.direction === 'stderr').map((r) => String(r.frame.text ?? ''));
  }

  // A session of `fixture` launched and ready: live on the stub engine under `useStub`, else the in-process replay.
  async launchSession(page: Page, id: string, fixture: string, over: Partial<LaunchSpec> = {}): Promise<void> {
    if (this.stub !== null) await stubLaunchReady(page, this.stub, id, fixture, over);
    else await launchReady(page, id, fixture, over);
  }

  // `root`: another checkout whose built app runs on this profile instead of this one's (launch.ts). The app's output is
  // read from the moment the launch resolves (`onLaunched`), so main's lines from its start (its first connect) are kept.
  async launch(env: Record<string, string> = {}, root?: string): Promise<Run> {
    let text = '';
    const read = (app: ElectronApplication) => {
      app.process().stdout?.on('data', (chunk) => (text += String(chunk)));
      app.process().stderr?.on('data', (chunk) => (text += String(chunk)));
    };
    const maws = await onLaunched(read, () => launchMaws({ userData: this.userData, keepConfigHome: true, root, env: { MAWS_HARNESS: '0', MAWS_HOST_MODE: HOST_MODE, MAWS_ENGINE_REPLAY: '1', ...(this.stub && { MAWS_E2E_ENGINE_BIN: this.stub.bin }), ...env } }));
    const child = maws.app.process(); // Playwright drops app.process() once the app closes; the cleanup still needs it
    const exited = new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));
    const run: Run = { maws, page: maws.page, child, output: () => text, quitLines: () => text.split('\n').filter((l) => l.startsWith('quit-guard:')), exited };
    this.runs.push(run);
    return run;
  }

  // The connected supervisor as main reports it, once main is ready with one (on the daemon shape, and knows the daemon).
  async ready(page: Page, match: (s: HostStatus) => boolean = () => true, timeout = 30_000): Promise<HostStatus> {
    let status: HostStatus | null = null;
    await expect
      .poll(async () => {
        const answer = await invoke(page, 'host.status', undefined);
        status = answer.ok ? answer.value : null;
        return status !== null && status.state === 'ready' && status.supervisor !== null && (!DAEMON || status.daemon !== null) && match(status);
      }, { timeout, message: DAEMON ? 'main is connected to a supervisor through mawsd' : 'main is connected to a supervisor' })
      .toBe(true);
    const s = status as unknown as HostStatus;
    this.supervisors.add(s.supervisor!.pid);
    if (s.daemon) this.daemons.add(s.daemon.pid);
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
  journal(id: string): JournalRow[] {
    const dir = join(this.userData, 'engine-host', 'journal', id);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow));
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
    this.daemonLock();
    let leftover: unknown = null; // a survivor is reported, after the files are removed all the same
    await killScratchProcesses(this.root, [...this.supervisors, ...this.daemons]).catch((error: unknown) => (leftover = error));
    for (const socket of this.sockets) {
      const dir = tmpSocketDirOf(this.userData, socket); // a socket under root goes with it
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    }
    const { socketDir } = daemonPaths(this.userData); // `mawsd`'s sockets' $TMPDIR fallback, when they took it
    if (!socketDir.startsWith(this.root)) rmSync(socketDir, { recursive: true, force: true });
    rmSync(this.root, { recursive: true, force: true });
    if (leftover !== null) throw leftover;
  }
}

export async function bounded<T>(promise: Promise<T>, ms: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message())), ms)));
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withScratch(name: string, body: (s: Scratch) => Promise<void>): Promise<void> {
  const s = new Scratch(name);
  let failed = false;
  try {
    await body(s);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // a cleanup failure is the case's failure only when the body passed; otherwise it is logged and the body's error stands
    await s.cleanup().catch((error: unknown) => {
      if (!failed) throw error;
      console.error(error);
    });
  }
}

// ---- the session ------------------------------------------------------------------------------------------------------

export const statusOf = async (page: Page, id: AppSessionId) => value(await invoke(page, 'session.status', { appSessionId: id }));
export const eventsOf = async (page: Page, id: AppSessionId) => value(await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null })).events;
export const suffix = (eventId: string) => eventId.split(':').slice(-2).join(':'); // `seq:i`: ids embed the session and launch
export const attentionOf = async (page: Page, id: AppSessionId, kind: AttentionItem['kind']): Promise<AttentionItem[]> =>
  value(await invoke(page, 'attention.list', undefined)).filter((i) => i.appSessionId === id && i.kind === kind);
export const pendingPermissions = (page: Page, id: AppSessionId) => attentionOf(page, id, 'permission');

// A launch of the record (replayed, or on the stub under `useStub`) and its prompt, written once the launch is ready.
export async function startTurn(page: Page, s: Scratch, id: AppSessionId, fixture = PERMISSION, prompt = PROMPT): Promise<void> {
  await s.launchSession(page, id, fixture, { cwd: s.repo });
  value(await invoke(page, 'session.send', { appSessionId: id, content: prompt }));
  await expect.poll(async () => (await statusOf(page, id)).turn !== null, { message: 'the turn is open' }).toBe(true);
}

// The fixture's request, pending (the unpaced replay holds there for as long as nobody answers).
export async function untilRequested(page: Page, id: AppSessionId): Promise<Extract<SessionEvent, { kind: 'permission.requested' }>> {
  let requested: SessionEvent | undefined;
  await expect.poll(async () => (requested = (await eventsOf(page, id)).find((e) => e.kind === 'permission.requested')) !== undefined, { timeout: 30_000 }).toBe(true);
  return requested as Extract<SessionEvent, { kind: 'permission.requested' }>;
}
