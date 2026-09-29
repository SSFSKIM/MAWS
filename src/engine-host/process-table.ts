// The process table (charter §4.4; C3 execution document, Interfaces "Process table and status", M4), keyed by
// `appSessionId`. A row is a reservation: taken when a launch is accepted and released only when the OS reports the
// exit (the session reads `exited`), never at an error, so a retry after a failed handshake cannot start a second
// writer on one engine session while the first is still dying. The table forwards every session's status to its
// listeners, samples memory for all live processes with one `ps` every 10 s, and ends them all on shutdown. What would
// keep a process alive is computed (`keepAliveReasons`) and never acted on: under the interim rule nothing exits a
// process but stop, archive and shutdown (C12 decides otherwise later). An exited row stays (its status and events still
// answer) until the id is relaunched, which replaces it, or archived, which releases it.
import { execFile } from 'node:child_process';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { EngineSession } from './session';

export const MEMORY_SAMPLE_MS = 10_000;

export type ReserveOutcome = { status: 'launching'; session: EngineSession } | { status: 'refused'; reason: 'already_live'; message: string };
type KeepAlive = EngineSessionStatus['keepAlive'][number];

// §4.4's list, in a fixed order: a running turn, background tasks or workflows, session grants (lost on exit, restored
// on resume), a connected MCP server, a held peer message.
export function keepAliveReasons(s: { turnOpen: boolean; backgroundTasks: number; grants: number; mcpServers: { status: string }[]; heldPeerMessages: number }): KeepAlive[] {
  const reasons: KeepAlive[] = [];
  if (s.turnOpen) reasons.push('turn');
  if (s.backgroundTasks > 0) reasons.push('background_tasks');
  if (s.grants > 0) reasons.push('grants');
  if (s.mcpServers.some((m) => m.status === 'connected')) reasons.push('mcp_connected');
  if (s.heldPeerMessages > 0) reasons.push('held_peer_message');
  return reasons;
}

// `ps -axo pid=,ppid=,rss=` output (the probe's processTree): own and whole-tree RSS in KiB under a root pid.
export function parsePsTree(output: string): { sample(pid: number): { rssKiB: number; treeRssKiB: number } | null } {
  const rss = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const line of output.split('\n')) {
    const [pid, ppid, kib] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(kib)) continue;
    rss.set(pid!, kib!);
    children.set(ppid!, [...(children.get(ppid!) ?? []), pid!]);
  }
  return {
    sample(root) {
      const own = rss.get(root);
      if (own === undefined) return null;
      let tree = 0;
      const seen = new Set<number>();
      const stack = [root];
      while (stack.length > 0) {
        const pid = stack.pop()!;
        if (seen.has(pid)) continue;
        seen.add(pid);
        tree += rss.get(pid) ?? 0;
        stack.push(...(children.get(pid) ?? []));
      }
      return { rssKiB: own, treeRssKiB: tree };
    },
  };
}

const runPs = (): Promise<string> =>
  new Promise((resolve, reject) => execFile('/bin/ps', ['-axo', 'pid=,ppid=,rss='], { timeout: 5_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

export class ProcessTable {
  private readonly rows = new Map<AppSessionId, EngineSession>();
  private readonly listeners = new Set<(status: EngineSessionStatus) => void>();
  private readonly ps: () => Promise<string>;
  private readonly sampleMs: number;
  private sampler: ReturnType<typeof setInterval> | null = null;
  private sampling = false;

  constructor(opts: { ps?: () => Promise<string>; sampleMs?: number; log?: (message: string) => void } = {}) {
    this.ps = opts.ps ?? runPs;
    this.sampleMs = opts.sampleMs ?? MEMORY_SAMPLE_MS;
    this.log = opts.log ?? ((message) => console.warn(`[engine-host process table] ${message}`));
  }

  private readonly log: (message: string) => void;

  // Creates and starts a session unless the id holds one that has not exited. `create` runs only when accepted.
  reserve(appSessionId: AppSessionId, create: () => EngineSession): ReserveOutcome {
    const existing = this.rows.get(appSessionId);
    if (existing) {
      const state = existing.status().process;
      if (state !== 'exited') return { status: 'refused', reason: 'already_live', message: `process is ${state}` };
    }
    const session = create();
    this.rows.set(appSessionId, session);
    session.on('status', (status) => {
      for (const listener of this.listeners) listener(status);
    });
    void session.start();
    return { status: 'launching', session };
  }

  // Drops an exited row (an archive: whole-branch review), so the host keeps nothing of a session no one will relaunch;
  // a row whose process has not exited stays, since it is still the reservation. True when a row was dropped.
  release(appSessionId: AppSessionId): boolean {
    const row = this.rows.get(appSessionId);
    if (!row || row.status().process !== 'exited') return false;
    return this.rows.delete(appSessionId);
  }

  get(appSessionId: AppSessionId): EngineSession | undefined {
    return this.rows.get(appSessionId);
  }

  list(): EngineSession[] {
    return [...this.rows.values()];
  }

  onChange(listener: (status: EngineSessionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startSampling(): void {
    if (this.sampler) return;
    this.sampler = setInterval(() => void this.sampleMemory(), this.sampleMs);
    (this.sampler as { unref?: () => void }).unref?.();
  }

  stopSampling(): void {
    if (this.sampler) clearInterval(this.sampler);
    this.sampler = null;
  }

  // One `ps` for every live process (never one per process); a sample never overlaps the previous one.
  async sampleMemory(): Promise<void> {
    const live = this.list().filter((s) => s.pid !== null && s.status().process !== 'exited');
    if (live.length === 0 || this.sampling) return;
    this.sampling = true;
    try {
      const tree = parsePsTree(await this.ps());
      const sampledAt = new Date().toISOString();
      for (const session of live) {
        const sample = tree.sample(session.pid!);
        session.recordMemory({ rssKiB: sample?.rssKiB ?? null, treeRssKiB: sample?.treeRssKiB ?? null, sampledAt });
      }
    } catch (error) {
      this.log(`memory sample failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sampling = false;
    }
  }

  // engine.shutdown: every live process through the ladder in parallel with reason `quit` (the end_session wait capped
  // at 3 s); `stopped` counts the exits before SIGKILL, `forced` the SIGKILLs. Idempotent: a process already exited
  // counts in neither, one already in its ladder is awaited on that ladder.
  async shutdown(opts: { graceMs: number }): Promise<{ stopped: number; forced: number }> {
    const live = this.list().filter((s) => s.status().process !== 'exited');
    const results = await Promise.all(live.map(async (session) => ({ session, result: await session.stop('quit', { graceMs: opts.graceMs }) })));
    let stopped = 0;
    let forced = 0;
    for (const { session } of results) {
      if (session.forcedKill) forced += 1;
      else stopped += 1;
    }
    return { stopped, forced };
  }
}
