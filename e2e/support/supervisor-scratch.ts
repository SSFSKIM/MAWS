// A detached supervisor's end-to-end scratch (E10 execution document, M4; moved here from e2e/supervisor.spec.ts for
// the two-build check, e2e/cross-build.spec.ts): a case's profile across its relaunches, its supervisors and the kept
// session's fixtures. Each case owns a scratch profile across its relaunches (`launchMaws({userData, keepConfigHome:
// true})`), and every supervisor it starts is killed and its files removed in the case's cleanup, whatever happened.
// A launch may run another checkout's built app on the same profile (`root`, launch.ts), so a case can keep a session on
// one build's supervisor and attach another build's app to it.
import { type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostStatus } from '@shared/ipc/schema/host';
import { invoke, launchReady, value } from './c7-replay';
import { launchMaws, onLaunched, REPO_ROOT, type MawsLaunch } from './launch';
import { killScratchProcesses } from './processes';
import { tmpSocketDirOf } from './supervisor-socket';

// C3's permission round trip: a prompt, ~44 `in` rows, a Bash `can_use_tool` (seq 49) the replay holds at until it is
// answered, ~40 more rows to the turn's result (seq 93), then a hold at the next prompt. Unpaced, the turn stays open at
// the request for as long as nobody answers it, which is how the cases keep a session mid-turn.
export const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';

function firstPrompt(fixture: string): string {
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

  // `root`: another checkout whose built app runs on this profile instead of this one's (launch.ts). The app's output is
  // read from the moment the launch resolves (`onLaunched`), so main's lines from its start (its first connect) are kept.
  async launch(env: Record<string, string> = {}, root?: string): Promise<Run> {
    let text = '';
    const read = (app: ElectronApplication) => {
      app.process().stdout?.on('data', (chunk) => (text += String(chunk)));
      app.process().stderr?.on('data', (chunk) => (text += String(chunk)));
    };
    const maws = await onLaunched(read, () => launchMaws({ userData: this.userData, keepConfigHome: true, root, env: { MAWS_HARNESS: '0', MAWS_HOST_MODE: 'detached', MAWS_ENGINE_REPLAY: '1', ...env } }));
    const child = maws.app.process(); // Playwright drops app.process() once the app closes; the cleanup still needs it
    const exited = new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));
    const run: Run = { maws, page: maws.page, child, output: () => text, quitLines: () => text.split('\n').filter((l) => l.startsWith('quit-guard:')), exited };
    this.runs.push(run);
    return run;
  }

  // The connected supervisor as main reports it, once main is ready with one.
  async ready(page: Page, match: (s: HostStatus) => boolean = () => true, timeout = 30_000): Promise<HostStatus> {
    let status: HostStatus | null = null;
    await expect
      .poll(async () => {
        const answer = await invoke(page, 'host.status', undefined);
        status = answer.ok ? answer.value : null;
        return status !== null && status.state === 'ready' && status.supervisor !== null && match(status);
      }, { timeout, message: 'main is connected to a supervisor' })
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
    let leftover: unknown = null; // a survivor is reported, after the files are removed all the same
    await killScratchProcesses(this.root, this.supervisors).catch((error: unknown) => (leftover = error));
    for (const socket of this.sockets) {
      const dir = tmpSocketDirOf(this.userData, socket); // a socket under root goes with it
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    }
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

// A replayed launch of the record and its prompt, written once the launch is ready.
export async function startTurn(page: Page, s: Scratch, id: AppSessionId, fixture = PERMISSION, prompt = PROMPT): Promise<void> {
  await launchReady(page, id, fixture, { cwd: s.repo });
  value(await invoke(page, 'session.send', { appSessionId: id, content: prompt }));
  await expect.poll(async () => (await statusOf(page, id)).turn !== null, { message: 'the turn is open' }).toBe(true);
}

// The fixture's request, pending (the unpaced replay holds there for as long as nobody answers).
export async function untilRequested(page: Page, id: AppSessionId): Promise<Extract<SessionEvent, { kind: 'permission.requested' }>> {
  let requested: SessionEvent | undefined;
  await expect.poll(async () => (requested = (await eventsOf(page, id)).find((e) => e.kind === 'permission.requested')) !== undefined, { timeout: 30_000 }).toBe(true);
  return requested as Extract<SessionEvent, { kind: 'permission.requested' }>;
}
