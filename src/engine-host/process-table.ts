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
//
// E10: the supervisor's idle-row release (E10 execution document, §Design 1 "Idle exit, and idle rows"; charter §4.4 as
// amended by A-29). While no app is connected, or under an armed exit-when-idle (the policy's `active`, which the
// supervisor sets), a ready row that has held no hard reason for the idle time is stopped with reason `idle`: a release
// like the budget's (kept in the released set, resumed from disk at its next use), whether or not the budget is on,
// since its reason is that no app is there to use the process, not memory. A row's clock starts at the later of the
// moment its last hard reason cleared and the moment the release became active; one timer serves every row, and each
// row is read again when it fires.
//
// E10: the orphan ledger (§Design 1 "The orphan ledger and sweep"). Once the supervisor records (`recordLive`, after
// its predecessor's orphans are swept), every change of the live rows that have a process (a launch's pid known, an
// exit) is handed to the writer as `{appSessionId, pid, procStart, launchId}`, so a successor of a supervisor that died
// can stop the engines it left. Each process's start time is read once (`ps`), at its first entry.
import { execFile } from 'node:child_process';
import { totalmem } from 'node:os';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { BudgetState } from '@shared/ipc/schema/engine';
import { defaultBudgetKiB, evaluate, EXITED_ROWS_MAX, isIdleRow, type BudgetPolicy, type BudgetVerdict } from './budget';
import type { LiveRow } from './live-ledger'; // E10
import type { EngineSession } from './session';
import { procStartOf as psProcStart } from './supervisor-files'; // E10

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
  private shuttingDown = false;
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
  // E10 start: the idle-row release and the row set's listeners
  private idlePolicy: { idleMs: number | null; activeSince: number | null } = { idleMs: null, activeSince: null };
  private readonly idleSince = new Map<EngineSession, number>(); // ready rows with no hard reason, since when
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly rowsListeners = new Set<() => void>();
  private readonly procStartOf: (pid: number) => string | null;
  private liveLedger: ((rows: LiveRow[]) => void) | null = null; // the orphan ledger's writer, once recording
  private readonly ledgerKeys = new WeakMap<EngineSession, string>(); // each row's part of the ledger: exited, pid
  private readonly procStarts = new WeakMap<EngineSession, string>();
  private ledgerWritten: string | null = null; // the rows last written, so an unchanged set is not rewritten
  // E10 end

  constructor(opts: { ps?: () => Promise<string>; sampleMs?: number; log?: (message: string) => void; totalMemBytes?: number; exitedRowsMax?: number /* C12 */; procStartOf?: (pid: number) => string | null /* E10 */ } = {}) {
    this.ps = opts.ps ?? runPs;
    this.procStartOf = opts.procStartOf ?? psProcStart; // E10
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
    if (this.shuttingDown) throw new Error('engine host is shutting down');
    const existing = this.rows.get(appSessionId);
    if (existing) {
      const state = existing.status().process;
      if (state !== 'exited') return { status: 'refused', reason: 'already_live', message: `process is ${state}` };
    }
    const session = create();
    this.rows.set(appSessionId, session);
    session.on('status', (status) => {
      if (status.process === 'exited') this.exitedRow(session, status); // C12
      this.trackIdle(session, status); // E10
      this.trackLive(session, status); // E10
      for (const listener of this.listeners) listener(status);
    });
    this.rowsChanged(); // E10
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
    this.rows.delete(appSessionId);
    this.rowsChanged(); // E10
    return true;
  }

  // E10 start ---------------------------------------------------------------------------------------------------------
  // Told whenever a row enters or leaves the table (a launch, an archive's or a forget's release, the exited-row cap),
  // which no status announces: the supervisor's row count and its clocks follow it.
  onRowsChanged(listener: () => void): () => void {
    this.rowsListeners.add(listener);
    return () => this.rowsListeners.delete(listener);
  }

  private rowsChanged(): void {
    for (const listener of this.rowsListeners) {
      try {
        listener();
      } catch (error) {
        this.log(`rows listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // The orphan ledger: from now on every change of the live rows goes to `write` (the supervisor's live.json), starting
  // with the rows live now. A write that fails is logged and the next change writes the whole set again.
  recordLive(write: (rows: LiveRow[]) => void): void {
    this.liveLedger = write;
    this.ledgerWritten = null;
    this.writeLiveLedger();
  }

  private trackLive(session: EngineSession, status: EngineSessionStatus): void {
    const key = `${status.process === 'exited'}:${status.pid}`;
    if (this.ledgerKeys.get(session) === key) return;
    this.ledgerKeys.set(session, key);
    this.writeLiveLedger();
  }

  private writeLiveLedger(): void {
    if (this.liveLedger === null) return;
    const rows: LiveRow[] = [];
    for (const session of this.rows.values()) {
      const status = session.status();
      if (status.process === 'exited' || status.pid === null) continue;
      let procStart = this.procStarts.get(session);
      if (procStart === undefined) {
        procStart = this.procStartOf(status.pid) ?? ''; // '' is never swept: a start time that cannot be compared
        this.procStarts.set(session, procStart);
      }
      rows.push({ appSessionId: status.appSessionId, pid: status.pid, procStart, launchId: status.launchId });
    }
    const signature = JSON.stringify(rows);
    if (signature === this.ledgerWritten) return;
    try {
      this.liveLedger(rows);
      this.ledgerWritten = signature;
    } catch (error) {
      this.log(`the orphan ledger could not be written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The idle-row release's policy, set by the supervisor on every change: `idleMs` null is never; `active` while no
  // client is connected or exit-when-idle is armed. An activation keeps its start across a new idle time.
  setIdleRelease(policy: { idleMs: number | null; active: boolean }): void {
    this.idlePolicy = { idleMs: policy.idleMs, activeSince: policy.active ? (this.idlePolicy.activeSince ?? Date.now()) : null };
    this.scheduleIdleRelease();
  }

  // Each status of a row's own process: an idle row's clock starts when it becomes idle and stops when it is not.
  private trackIdle(session: EngineSession, status: EngineSessionStatus): void {
    const idle = this.rows.get(status.appSessionId) === session && isIdleRow(status, this.stateful);
    if (idle === this.idleSince.has(session)) return;
    if (idle) this.idleSince.set(session, Date.now());
    else this.idleSince.delete(session);
    this.scheduleIdleRelease();
  }

  private scheduleIdleRelease(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const { idleMs, activeSince } = this.idlePolicy;
    if (idleMs === null || activeSince === null || this.shuttingDown || this.idleSince.size === 0) return;
    const due = Math.min(...[...this.idleSince.values()].map((since) => Math.max(since, activeSince) + idleMs));
    this.idleTimer = setTimeout(() => this.releaseIdleRows(), Math.max(0, due - Date.now()));
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  // The timer fired: every row whose clock has run out is read again and, still idle, stopped as `idle`, in the same
  // synchronous step as the read (as the budget's release), so no event can land between the verdict and the stop.
  private releaseIdleRows(): void {
    this.idleTimer = null;
    const { idleMs, activeSince } = this.idlePolicy;
    if (idleMs === null || activeSince === null || this.shuttingDown) return;
    const now = Date.now();
    for (const [session, since] of [...this.idleSince]) {
      const status = session.status();
      if (this.rows.get(status.appSessionId) !== session || !isIdleRow(status, this.stateful)) {
        this.idleSince.delete(session);
        continue;
      }
      if (now < Math.max(since, activeSince) + idleMs) continue;
      this.idleSince.delete(session);
      this.log(`idle release of ${status.appSessionId}: no hard reason for ${idleMs} ms with no app connected or exit-when-idle armed`);
      session.stop('idle').catch((error: unknown) => this.log(`idle release of ${status.appSessionId} failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    this.scheduleIdleRelease();
  }
  // E10 end -----------------------------------------------------------------------------------------------------------

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
    if (status.exit?.reason === 'budget' || status.exit?.reason === 'idle' /* E10 */) this.released.add(status.appSessionId);
    if (this.releasing === session) {
      this.releasing = null;
      this.budget = { ...this.budget, releasing: null };
      this.emitBudget(false);
    }
    // an exited row that still holds a queue neither counts nor goes (whole-branch review): session.queue.edit and remove
    // need it for what the list shows from disk; once its queue is empty the next exit's cap picks it up. Nor does a
    // released row: main archives a released session only through its row (record-actions `releasedByHost`), and the
    // archive's release is what clears the released id. Released rows are bounded by the sessions the budget (E10: or
    // the idle clock) released in this host's run, each with a stream capped at EXITED_RING, and leave at the id's next
    // launch or archive.
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
    if (oldest.length > 0) this.rowsChanged(); // E10
  }
  // C12 end -----------------------------------------------------------------------------------------------------------

  // engine.shutdown: every live process through the ladder in parallel with reason `quit` (the end_session wait capped
  // at 3 s); `stopped` counts the exits before SIGKILL, `forced` the SIGKILLs. Idempotent: a process already exited
  // counts in neither, one already in its ladder is awaited on that ladder.
  async shutdown(opts: { graceMs: number }): Promise<{ stopped: number; forced: number }> {
    this.shuttingDown = true; // close admission synchronously, before any stop yields
    this.scheduleIdleRelease(); // E10: clears the idle clock; the ladder below stops every row as `quit`
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
