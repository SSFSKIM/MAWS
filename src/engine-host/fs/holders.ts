// Who else holds a session right now (C4 execution document, Interfaces "Holder rule"; charter residue *Holder
// detection*; SPEC 35.27.1, pass-2 item 10). Interactive `claude` and `claude --bg` write `sessions/<pid>.json` at
// startup and unlink it at exit; `-p` processes write none. A record is a holder when it names a session, its pid is
// alive, and its `procStart`, when present, equals `ps -o lstart=` rendered exactly as the engine renders it
// (`LC_ALL=C TZ=UTC`, never the host's zone). `jobs/<short>/state.json` adds the job's facts, never liveness.
// Read-only: registry and job files are read, never written or removed.
import { execFile } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionId } from '@shared/graph/ids';
import { JobStateSchema, LiveSessionRecordSchema, type Holder, type JobState, type LiveSessionRecord } from '@shared/wire/store';
import type { StorePaths } from './paths';
import { isMissing, readJsonWithRetry } from './sidecars';

export type HolderSink = (sessionId: SessionId, holder: Holder, registry: LiveSessionRecord | null, job: JobState | null) => void;

export interface HolderDeps {
  ps?: string; // the ps binary; tests point it somewhere that cannot spawn
  pollMs?: number; // liveness poll while at least one holder is known
}

export const POLL_MS = 2_000;
export const JOB_STATE_MAX_BYTES = 8 * 1024 * 1024; // the engine's own cap; a larger state.json is treated as absent
const NONE: Holder = { kind: 'none' };
const REGISTRY_FILE = /^(\d+)\.json$/;

interface Held {
  holder: Holder;
  registry: LiveSessionRecord;
  job: JobState | null;
}

export class HolderRegistry {
  private readonly ps: string;
  private readonly pollMs: number;
  private readonly records = new Map<number, LiveSessionRecord>();
  private readonly jobs = new Map<string, JobState>();
  private readonly held = new Map<SessionId, Held>();
  private readonly unknownKinds = new Set<string>(); // logged once each
  private chain: Promise<void> = Promise.resolve();
  private queuedRefresh: Promise<void> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly paths: StorePaths,
    private readonly sink: HolderSink,
    deps: HolderDeps = {},
  ) {
    this.ps = deps.ps ?? '/bin/ps';
    this.pollMs = deps.pollMs ?? POLL_MS;
  }

  async start(): Promise<void> {
    await this.serial(() => this.readAllJobs());
    await this.refresh();
  }

  // Re-reads every registry record, re-checks liveness and emits each holder that changed. Runs on every `sessions/`
  // change and on the poll; requests that arrive while one is queued share it, and one that arrives while a refresh
  // runs queues the next, so a change seen mid-read is always read again.
  refresh(): Promise<void> {
    if (this.queuedRefresh) return this.queuedRefresh;
    const run = this.serial(async () => {
      this.queuedRefresh = null;
      await this.readRegistry();
      await this.recompute();
    });
    this.queuedRefresh = run;
    return run;
  }

  // A `jobs/<short>/state.json` change (or a rescan of `jobs/` with `jobId` null).
  jobChanged(jobId: string | null): Promise<void> {
    return this.serial(async () => {
      if (jobId === null) await this.readAllJobs();
      else await this.readJob(jobId);
      await this.recompute();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  holderOf(sessionId: SessionId): Holder {
    return this.held.get(sessionId)?.holder ?? NONE;
  }

  // Every session with a live holder.
  holders(): { sessionId: SessionId; holder: Holder }[] {
    return [...this.held].map(([sessionId, { holder }]) => ({ sessionId, holder }));
  }

  // The live holders as they are now, for a guard that must not trust an asynchronous projection: a registry read that
  // starts after this call (the poll's liveness rule, unchanged), then every live record whose session id is listed or
  // whose cwd is one of `directories`, both compared as NFC-normalised realpaths. Both filters null: every live holder.
  async liveNow(filter: { sessionIds: readonly SessionId[] | null; directories: readonly string[] | null }): Promise<{ sessionId: SessionId; holder: Holder; cwd: string | null }[]> {
    await this.refresh();
    const ids = filter.sessionIds === null ? null : new Set(filter.sessionIds);
    const directories = filter.directories === null ? null : new Set(await Promise.all(filter.directories.map(canonicalDirectory)));
    const answer: { sessionId: SessionId; holder: Holder; cwd: string | null }[] = [];
    for (const [sessionId, { holder, registry }] of this.held) {
      const cwd = registry.cwd === undefined ? null : await canonicalDirectory(registry.cwd);
      const matches = (ids === null && directories === null) || ids?.has(sessionId) || (cwd !== null && directories?.has(cwd));
      if (matches) answer.push({ sessionId, holder, cwd });
    }
    return answer;
  }

  private serial(step: () => Promise<void>): Promise<void> {
    const run = this.chain.then(() => (this.stopped ? undefined : step())).catch((error: unknown) => {
      console.error('[fs] holder refresh failed:', error instanceof Error ? error.message : error);
    });
    this.chain = run;
    return run;
  }

  private async readRegistry(): Promise<void> {
    const pids = new Set(
      (await listNames(this.paths.sessions)).flatMap((name) => {
        const pid = REGISTRY_FILE.exec(name)?.[1];
        return pid === undefined ? [] : [Number(pid)];
      }),
    );
    for (const pid of this.records.keys()) if (!pids.has(pid)) this.records.delete(pid);
    await Promise.all(
      [...pids].map(async (pid) => {
        // The engine patches the record by read-modify-write, so a read can land before `sessionId` is back.
        const record = await readJsonWithRetry(
          join(this.paths.sessions, `${pid}.json`),
          (raw) => LiveSessionRecordSchema.parse({ ...(raw as object), pid }),
          (value) => value.sessionId !== undefined || value.spare === true || value.parkedJobId !== undefined,
        );
        // Unparseable after every retry: keep the record as last read whole. Absent: unlinked since the listing.
        if (record.status === 'ok') this.records.set(pid, record.value);
        else if (record.status === 'absent') this.records.delete(pid);
      }),
    );
  }

  private async readAllJobs(): Promise<void> {
    const names = await listNames(this.paths.jobs);
    for (const jobId of this.jobs.keys()) if (!names.includes(jobId)) this.jobs.delete(jobId);
    await Promise.all(names.map((jobId) => this.readJob(jobId)));
  }

  private async readJob(jobId: string): Promise<void> {
    const path = join(this.paths.jobs, jobId, 'state.json');
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch (error) {
      if (!isMissing(error)) throw error;
      this.jobs.delete(jobId);
      return;
    }
    if (size > JOB_STATE_MAX_BYTES) {
      this.jobs.delete(jobId);
      return;
    }
    const job = await readJsonWithRetry(path, (raw) => JobStateSchema.parse(raw));
    if (job.status === 'ok') this.jobs.set(jobId, job.value);
    else if (job.status === 'absent') this.jobs.delete(jobId); // unparseable keeps the state last read whole
  }

  private async recompute(): Promise<void> {
    const alive = [...this.records.values()].filter(
      (record) => record.sessionId !== undefined && record.spare !== true && record.parkedJobId === undefined && isAlive(record.pid),
    );
    const checked = alive.filter((record) => record.procStart !== undefined);
    const tokens = checked.length > 0 ? await startTokens(this.ps, checked.map((record) => record.pid)) : new Map<number, string>();
    if (this.stopped) return;
    // A token that differs is a reused pid. When ps cannot run at all, liveness alone decides, as for a record that
    // carries no token (the engine's own probe treats a missing expected token the same way).
    const live = alive.filter((record) => record.procStart === undefined || tokens === null || tokens.get(record.pid) === record.procStart);

    const bySession = new Map<SessionId, LiveSessionRecord>();
    for (const record of live) {
      const sessionId = record.sessionId as SessionId;
      const previous = bySession.get(sessionId);
      if (!previous || (record.startedAt ?? 0) > (previous.startedAt ?? 0)) bySession.set(sessionId, record);
    }

    for (const sessionId of new Set([...this.held.keys(), ...bySession.keys()])) {
      const record = bySession.get(sessionId) ?? null;
      const job = this.jobFor(sessionId);
      const holder = record ? this.holderFor(record, sessionId) : NONE;
      const before = this.held.get(sessionId)?.holder ?? NONE;
      if (record) this.held.set(sessionId, { holder, registry: record, job: job?.state ?? null });
      else this.held.delete(sessionId);
      if (!sameHolder(before, holder)) this.sink(sessionId, holder, record, job?.state ?? null);
    }

    if (this.held.size > 0 && !this.poll) {
      this.poll = setInterval(() => void this.refresh(), this.pollMs);
      this.poll.unref();
    } else if (this.held.size === 0 && this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  private holderFor(record: LiveSessionRecord, sessionId: SessionId): Holder {
    switch (record.kind) {
      case 'interactive':
      case undefined: // a record too old to say: only an interactive start writes one without a kind
        return { kind: 'terminal', pid: record.pid };
      case 'bg':
        return { kind: 'background_job', pid: record.pid, jobId: record.jobId ?? this.jobFor(sessionId)?.jobId ?? null };
      case 'daemon':
      case 'daemon-worker':
        return { kind: 'background_job', pid: record.pid, jobId: null };
      default:
        // A kind this build does not know, with a live pid, still holds the session: X6's launch refusal must hold for
        // a process MAWS cannot classify. Not a terminal badge, since nothing says it is one.
        if (!this.unknownKinds.has(record.kind)) {
          this.unknownKinds.add(record.kind);
          console.warn(`[fs] registry record ${record.pid} has kind ${JSON.stringify(record.kind)}, unknown to this build; holding as a background job`);
        }
        return { kind: 'background_job', pid: record.pid, jobId: record.jobId ?? null };
    }
  }

  private jobFor(sessionId: SessionId): { jobId: string; state: JobState } | null {
    for (const [jobId, state] of this.jobs) if (state.sessionId === sessionId) return { jobId, state };
    return null;
  }
}

function sameHolder(a: Holder, b: Holder): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// `kill(pid, 0)`: delivered means alive, EPERM means alive under another user; anything else means gone.
function isAlive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// One batched `ps -o pid=,lstart= -p a,b,c` under the engine's own environment (`LC_ALL=C TZ=UTC`, nothing inherited).
// Dead pids are simply absent from the output, so the exit code is not consulted; null when ps could not run.
function startTokens(ps: string, pids: number[]): Promise<Map<number, string> | null> {
  return new Promise((resolve) => {
    execFile(ps, ['-o', 'pid=,lstart=', '-p', pids.join(',')], { env: { LC_ALL: 'C', TZ: 'UTC' }, timeout: 5_000 }, (error, stdout) => {
      if (error && (typeof (error as NodeJS.ErrnoException).code === 'string' || error.killed)) {
        console.error(`[fs] ${ps} failed; holders fall back to liveness alone:`, error.message);
        resolve(null);
        return;
      }
      const tokens = new Map<number, string>();
      for (const line of stdout.split('\n')) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (match) tokens.set(Number(match[1]), match[2].trim()); // macOS pads the token with trailing spaces
      }
      resolve(tokens);
    });
  });
}

// A directory as the engine keys it: realpath, NFC-normalised; a path that no longer resolves compares as written.
async function canonicalDirectory(path: string): Promise<string> {
  try {
    return (await realpath(path)).normalize('NFC');
  } catch {
    return path.normalize('NFC');
  }
}

async function listNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
