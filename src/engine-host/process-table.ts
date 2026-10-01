// The process table (charter §4.4; C3 execution document, Interfaces "Process table and status", M4), keyed by
// `appSessionId`. A row is a reservation: taken when a launch is accepted and released only when the OS reports the
// exit (the session reads `exited`), never at an error, so a retry after a failed handshake cannot start a second
// writer on one engine session while the first is still dying. The table forwards every session's status to its
// listeners, samples memory for all live processes with one `ps` every 10 s, and ends them all on shutdown. What would
// keep a process alive is each status's `keepAlive` (C12: the budget's hard reasons, budget.ts). An exited row stays
// (its status and events still answer) until the id is relaunched, which replaces it, or archived, which releases it.
//
// C12: the table holds the memory budget (charter §4.4 as amended). After each sample and at a policy change it asks
// the policy (budget.ts `evaluate`) and, when the sum of the live trees is over the budget, releases the least recently
// used idle, quiet session with nothing to lose: `stop('budget')` in the same synchronous step as the read of the
// statuses, so no event can land between the verdict and the stop; one at a time, the next only after that exit.
// Evaluation has no timer of its own (§4.4: never a fixed timer). The ids it released are kept until each id's next
// launch, whose reconnect rows then read `process_exit`. Exited rows beyond EXITED_ROWS_MAX leave the table, the oldest
// exit first, at each exit; the host then answers such a session from disk, as it does for any it never launched. A
// released row is exempt, so a released id never outlives its row and an archive (which main finds by the row) clears it.
//
// W7: the budget can be off (settings' `engine.memoryBudget.enabled`, in the policy). Off, sampling and evaluation go on,
// so the state keeps the totals Session info shows, but nothing is over, so nothing is released and no banner flag rises:
// engine processes never exit on their own (charter §4.4's pre-C12 rule). On again, a policy change evaluates at once.
// The exited-row cap is hygiene and holds either way.
import { execFile } from 'node:child_process';
import { totalmem } from 'node:os';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { BudgetState } from '@shared/ipc/schema/engine';
import { defaultBudgetKiB, evaluate, EXITED_ROWS_MAX, type BudgetPolicy, type BudgetVerdict } from './budget';
import type { EngineSession } from './session';

export const MEMORY_SAMPLE_MS = 10_000;

export type ReserveOutcome = { status: 'launching'; session: EngineSession } | { status: 'refused'; reason: 'already_live'; message: string };
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

// C12: the budget state's identity for its event, without `sampledAt` (a sample that moved nothing else is not news)
const signatureOf = (state: BudgetState): string => JSON.stringify({ ...state, sampledAt: null });

const runPs = (): Promise<string> =>
  new Promise((resolve, reject) => execFile('/bin/ps', ['-axo', 'pid=,ppid=,rss='], { timeout: 5_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

export class ProcessTable {
  private readonly rows = new Map<AppSessionId, EngineSession>();
  private readonly listeners = new Set<(status: EngineSessionStatus) => void>();
  private readonly ps: () => Promise<string>;
  private readonly sampleMs: number;
  private sampler: ReturnType<typeof setInterval> | null = null;
  private sampling = false;
  // C12 start: the budget's policy (on at 25% of physical memory until main's first engine.policy.set) and its state
  private policy: BudgetPolicy;
  private stateful: ReadonlySet<string> = new Set();
  private readonly sampledSeqs = new WeakMap<EngineSession, number>(); // each process's lastEventSeq at the previous sample
  private readonly sampledQuiet = new WeakSet<EngineSession>(); // the processes the latest sample found quiet
  private previousOverWithoutCandidate = false; // the previous sample's `over && candidates === 0`
  private releasing: EngineSession | null = null; // a release whose ladder has not ended
  private readonly released = new Set<AppSessionId>(); // ids whose last exit was a release, until their next launch or archive; each keeps its row
  private lastRelease: BudgetState['lastRelease'] = null;
  private sampledAt: string | null = null;
  private budget: BudgetState;
  private budgetSignature = '';
  private readonly budgetListeners = new Set<(state: BudgetState) => void>();
  private readonly exitedRowsMax: number;
  private readonly dropListeners = new Set<(appSessionId: AppSessionId) => void>();
  private readonly exitsSeen = new WeakSet<EngineSession>();
  // C12 end

  constructor(opts: { ps?: () => Promise<string>; sampleMs?: number; log?: (message: string) => void; totalMemBytes?: number; exitedRowsMax?: number /* C12 */ } = {}) {
    this.ps = opts.ps ?? runPs;
    this.sampleMs = opts.sampleMs ?? MEMORY_SAMPLE_MS;
    this.log = opts.log ?? ((message) => console.warn(`[engine-host process table] ${message}`));
    // C12 start
    this.policy = { enabled: true /* W7 */, limitKiB: defaultBudgetKiB(opts.totalMemBytes ?? totalmem()), statefulMcpServers: [] };
    this.budget = { enabled: this.policy.enabled /* W7 */, limitKiB: this.policy.limitKiB, totalKiB: 0, sampledAt: null, over: false, overWithoutCandidate: false, candidates: 0, settling: 0, releasing: null, blocked: [], lastRelease: null };
    this.budgetSignature = signatureOf(this.budget);
    this.exitedRowsMax = opts.exitedRowsMax ?? EXITED_ROWS_MAX;
    // C12 end
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
      if (status.process === 'exited') this.exitedRow(session, status); // C12
      for (const listener of this.listeners) listener(status);
    });
    void session.start();
    return { status: 'launching', session };
  }

  // Drops an exited row (an archive: whole-branch review), so the host keeps nothing of a session no one will relaunch;
  // a row whose process has not exited stays, since it is still the reservation. True when a row was dropped.
  // C12: a dropped row takes its released id with it (an archived or forgotten session's next launch is a fresh one).
  release(appSessionId: AppSessionId): boolean {
    const row = this.rows.get(appSessionId);
    if (!row || row.status().process !== 'exited') return false;
    this.released.delete(appSessionId); // C12
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

  // One `ps` for every live process (never one per process); a sample never overlaps the previous one. C12: the budget
  // is evaluated right after the sample is recorded, in the same synchronous step (a sample with no process to measure
  // still evaluates, so the state follows the last exit); a failed `ps` evaluates nothing.
  async sampleMemory(): Promise<void> {
    if (this.sampling) return;
    const live = this.list().filter((s) => s.pid !== null && s.status().process !== 'exited');
    this.sampling = true;
    try {
      const tree = live.length > 0 ? parsePsTree(await this.ps()) : null;
      const sampledAt = new Date().toISOString();
      for (const session of live) {
        const sample = tree!.sample(session.pid!);
        session.recordMemory({ rssKiB: sample?.rssKiB ?? null, treeRssKiB: sample?.treeRssKiB ?? null, sampledAt });
      }
      this.sampledAt = sampledAt; // C12
      this.evaluateBudget(true); // C12
    } catch (error) {
      this.log(`memory sample failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sampling = false;
    }
  }

  // C12 start ---------------------------------------------------------------------------------------------------------
  // The budget's policy (engine.policy.set): every live status is re-read (keepAlive names the stateful servers), and
  // the policy is evaluated at once against the previous sample.
  configure(policy: BudgetPolicy): BudgetState {
    this.policy = { enabled: policy.enabled /* W7 */, limitKiB: policy.limitKiB, statefulMcpServers: [...policy.statefulMcpServers] };
    this.stateful = new Set(policy.statefulMcpServers);
    for (const session of this.list()) session.policyChanged();
    this.evaluateBudget(false);
    return this.budgetState();
  }

  get statefulMcpServers(): ReadonlySet<string> {
    return this.stateful;
  }

  budgetState(): BudgetState {
    return structuredClone(this.budget);
  }

  onBudget(listener: (state: BudgetState) => void): () => void {
    this.budgetListeners.add(listener);
    return () => this.budgetListeners.delete(listener);
  }

  // True once for an id whose last exit was a release: its next launch (the launcher asks as it creates the session)
  // reconnects with trigger `process_exit`.
  takeReleased(appSessionId: AppSessionId): boolean {
    return this.released.delete(appSessionId);
  }

  // Reads every status, asks the policy, and releases in the same synchronous step: nothing here awaits, so no frame is
  // processed between the verdict and the stop. `sample` is true after a memory sample, whose lastEventSeq per process
  // is what the next sample's `quiet` compares against, and whose flag the next sample's debounce reads. A policy
  // change between samples takes a row as quiet only when the latest sample found it quiet and its lastEventSeq has not
  // moved since: the sample's baseline alone would call quiet a row that spoke just before that sample (a turn's
  // `result`, say, with the engine's own follow-up `init` still to come), which has not been quiet for a period.
  private evaluateBudget(sample: boolean): void {
    const sessions = this.list();
    const statuses = sessions.map((session) => session.status());
    const quiet = new Set<AppSessionId>();
    sessions.forEach((session, i) => {
      const status = statuses[i]!;
      const unmoved = this.sampledSeqs.get(session) === status.lastEventSeq;
      if (sample ? unmoved : unmoved && this.sampledQuiet.has(session)) quiet.add(status.appSessionId);
      if (sample) {
        this.sampledSeqs.set(session, status.lastEventSeq);
        if (unmoved) this.sampledQuiet.add(session);
        else this.sampledQuiet.delete(session);
      }
    });
    const verdict = evaluate({ rows: statuses, policy: this.policy, quiet, releasing: this.releasing?.status().appSessionId ?? null, previousOverWithoutCandidate: this.previousOverWithoutCandidate });
    if (sample) this.previousOverWithoutCandidate = verdict.over && verdict.candidates === 0;
    if (verdict.release !== null) {
      const session = sessions[statuses.findIndex((s) => s.appSessionId === verdict.release)]!;
      this.releasing = session;
      this.lastRelease = { appSessionId: verdict.release, at: new Date().toISOString(), totalKiB: verdict.totalKiB };
      session.stop('budget', { release: { limitKiB: verdict.limitKiB, totalKiB: verdict.totalKiB } }).catch((error: unknown) => this.log(`release of ${verdict.release} failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    this.publishBudget(verdict, verdict.release !== null);
  }

  private publishBudget(verdict: BudgetVerdict, force: boolean): void {
    this.budget = {
      enabled: this.policy.enabled, // W7
      limitKiB: verdict.limitKiB, totalKiB: verdict.totalKiB, sampledAt: this.sampledAt, over: verdict.over, overWithoutCandidate: verdict.overWithoutCandidate,
      candidates: verdict.candidates, settling: verdict.settling, releasing: this.releasing?.status().appSessionId ?? null, blocked: verdict.blocked, lastRelease: this.lastRelease,
    };
    this.emitBudget(force);
  }

  private emitBudget(force: boolean): void {
    const signature = signatureOf(this.budget);
    if (!force && signature === this.budgetSignature) return;
    this.budgetSignature = signature;
    for (const listener of this.budgetListeners) {
      try {
        listener(this.budgetState());
      } catch (error) {
        this.log(`budget listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Told of each exited row the table drops beyond the cap (the host drops its stream and spec with it).
  onDropped(listener: (appSessionId: AppSessionId) => void): () => void {
    this.dropListeners.add(listener);
    return () => this.dropListeners.delete(listener);
  }

  // A row's process exited: a release's ends the one in flight, and its id is kept for its next launch; then the
  // exited rows beyond the cap go, the oldest exit first (ties in the table's order), each with no word to main: its
  // state file stays, and a later read of it answers from disk.
  private exitedRow(session: EngineSession, status: EngineSessionStatus): void {
    // once per process, and only while it is the id's row (a status an exited process emits later, or after a
    // relaunch replaced it, must not mark the new launch released)
    if (this.exitsSeen.has(session) || this.rows.get(status.appSessionId) !== session) return;
    this.exitsSeen.add(session);
    if (status.exit?.reason === 'budget') this.released.add(status.appSessionId);
    if (this.releasing === session) {
      this.releasing = null;
      this.budget = { ...this.budget, releasing: null };
      this.emitBudget(false);
    }
    // an exited row that still holds a queue neither counts nor goes (whole-branch review): session.queue.edit and remove
    // need it for what the list shows from disk; once its queue is empty the next exit's cap picks it up. Nor does a
    // released row: main archives a released session only through its row (record-actions `releasedByHost`), and the
    // archive's release is what clears the released id. Released rows are bounded by the sessions the budget released
    // in this host's run, each with a stream capped at EXITED_RING, and leave at the id's next launch or archive.
    const exited = [...this.rows].filter(([id, row]) => row.lifecycle === 'exited' && row.status().queue.length === 0 && !this.released.has(id));
    if (exited.length <= this.exitedRowsMax) return;
    // the row whose exit is being delivered is never dropped, so the excess comes from the others (a tied or earlier
    // exit time for it, a clock gone back, still leaves the table at the cap)
    const others = exited.filter(([, row]) => row !== session).map(([id, row], order) => ({ id, at: row.status().exit?.at ?? '', order }));
    const oldest = others.sort((x, y) => x.at.localeCompare(y.at) || x.order - y.order).slice(0, exited.length - this.exitedRowsMax);
    for (const { id } of oldest) {
      this.rows.delete(id);
      for (const listener of this.dropListeners) {
        try {
          listener(id);
        } catch (error) {
          this.log(`drop listener failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  // C12 end -----------------------------------------------------------------------------------------------------------

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
