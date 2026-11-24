// Ticket 851, M2 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D1 to D4 as amended, R4-1 to R4-9): the engine
// host's prestarts. At most one per host: a launch admitted for a spine root (`owner`) over one connection, run hidden
// (process-table.ts, launcher.ts `HiddenLaunch`, prestart.ts), and either adopted by `session.launch { adopt }` or ended.
//
// The admission is registered in the handler before its first await, with a generation the host assigns. A newer
// prestart (for any id), a launch of the id, a withdraw of that generation, a forget or stop of the id, the end of the
// connection that asked and the release of its owner each cancel it (the launcher reads it after its probes and in the
// step that reserves the row, so a cancelled admission never spawns) or end its row. Ending ("kill") stops the engine
// through the ladder and drops the row at once (no released id, no exited row); once the process has exited and its
// session host is gone, the rollback below runs (the launch's staged files, then its session host's roster entry, which
// a marked host keeps at its exit: M1's rule, the files before the entry).
//
// Every launch of an id a prestart holds or is admitting runs under the id's serialization. Adopt takes the hidden row
// when it is claimable (R4-9) and its spec (but for `sessionId`), key and engine binary are the ones asked: the stage and
// the held writes are written (R4-1's step 2, still hidden), the session host promotes the launch (step 3), then the row
// is revealed, its snapshot published and the answer given, the surface attaching afterwards (step 4, R4-5). Anything
// else, or a failure in steps 2 and 3, ends the prestart and launches the spec as any launch.
//
// Ticket 851's xhigh panel, group A (promotion and rollback): a launch whose outcome is unknown stays recoverable by its
// successor. One rollback (`rollBack`) restores the state a commit wrote, removes the launch's staged files and then its
// session host's entry, and it runs only once the engine has exited and its session host is gone; a holder not
// confirmed gone keeps all of it for the next start. A commit that is not revealed (a refusal, a lost or late answer, an
// acknowledgement followed by a handover or a full stage) is retired, never rolled back in place: its row stays hidden
// and committing, holding its id (no disk fallback, no launch, no other prestart), while its engine stops and the
// rollback runs; then it is let go, and the spec launched fresh if Send still waits (`RETIRE_WAIT_MS`). A stop or forget
// of the id meanwhile waits for that outcome. A replaced prestart's engine has exited before the next one spawns.
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import type { ClientRef } from '@shared/ipc/client';
import type { LaunchResult } from '@shared/ipc/schema/session';
import type { BinaryCheck } from './binary-info';
import { removeStagedFiles } from './holder/adopt';
import type { HiddenLaunch, Launcher } from './launcher';
import { PRESTART_STAGE_MAX_BYTES, sameLaunchSpec, Stage } from './prestart';
import type { HiddenDue, ProcessTable } from './process-table';
import type { EngineSession } from './session';
import { LADDER_MS } from './session-ladder';

export type PrestartState = 'hidden' | 'committed' | 'ended';

// A stopped engine's exit: its ladder's worst case and a margin
const ENDING_MS = LADDER_MS.endSession + LADDER_MS.term + LADDER_MS.kill + 2_000;
// What Send waits for a failed commit's retirement before it is answered `refused` instead of launched fresh: with the
// promotion's own bound (HOST_START_MS, 5 s) inside the spine's request deadline (REQUEST_TIMEOUT_MS, 10 s)
export const RETIRE_WAIT_MS = 4_000;
export interface PrestartAnswer { status: 'started' | 'running' | 'refused'; generation: number; reason?: string }

export interface PrestartHostDeps {
  table: ProcessTable;
  launch: Launcher;
  emit: HostEmit;
  log: (line: string) => void;
  binaryProbe: () => Promise<BinaryCheck>;
  publish: (session: EngineSession) => void; // the revealed row's stream opened and its snapshot published (ipc.ts)
  drop: (session: EngineSession) => void; // what the host kept for an ended hidden row let go (ipc.ts)
  journalDir: (appSessionId: AppSessionId) => string;
  // once the session host has exited (index.ts): `rollback`, then its roster entry removed; whether it was gone. Absent:
  // a direct spawn, or the next engine host's start clears it
  endHost?: (host: { holderId: string; pid: number }, rollback: () => Promise<void>) => Promise<boolean>;
  promoteMs?: number;
  stageMaxBytes?: number;
  retireWaitMs?: number;
}

interface Prestart {
  id: AppSessionId;
  generation: number;
  owner: string;
  request: string | undefined; // the spine's name for the request that admitted it, or the newer one a `running` answered
  client: ClientRef;
  spec: LaunchSpec;
  key: string;
  stage: Stage;
  session: EngineSession | null;
  state: 'admitted' | 'hidden' | 'committing' | 'committed' | 'ended';
  announced: boolean; // `engine.prestart { hidden }` went out
  unwatch: () => void;
  handedOver: boolean; // M2's review, finding 8: a handover froze the host while its promotion was out
  settled: Promise<void>; // the panel's scalpel-1#3: its commit's outcome, a failed one's retirement included
}

const CLAIMABLE = new Set(['starting', 'initializing', 'ready']);

export class PrestartHost {
  private current: Prestart | null = null;
  private generation = 0;
  private readonly released = new Set<string>(); // owners released (R4-7)
  private readonly chains = new Map<AppSessionId, Promise<unknown>>();
  private readonly rows = new Map<EngineSession, Prestart>(); // each hidden row's prestart, until it is ended or committed
  private readonly fenced = new Map<AppSessionId, number>(); // M2's review, finding 6: the launches of each id under way
  private commits = new Set<Promise<unknown>>(); // M2's review, finding 8: the adopts in their commit
  private readonly ending = new Set<Promise<void>>(); // the panel's scalpel-2#8: the exits of the prestarts ended

  constructor(private readonly deps: PrestartHostDeps) {
    if (typeof deps.table.onHiddenDue === 'function') deps.table.onHiddenDue((session, why) => this.due(session, why)); // a test's stand-in table may have none
  }

  // `session.prestart`: the admission, synchronously; the launch runs behind the answer.
  prestart(input: { spec: LaunchSpec; key: string; owner: string; request?: string | undefined }, client: ClientRef): PrestartAnswer {
    const { spec, key, owner, request } = input;
    const id = spec.appSessionId;
    assertSafeAppSessionId(id);
    const refused = (reason: string): PrestartAnswer => ({ status: 'refused', generation: 0, reason });
    if (spec.replay !== null) return refused('a replay launch never prestarts');
    if (this.released.has(owner)) return refused('its owner was released');
    if (this.fenced.has(id)) return refused('a launch of the session is under way'); // M2's review, finding 6
    const cur = this.current;
    if (cur?.state === 'committing') return refused('a prestart is being adopted'); // M2's review, finding 7: it holds the slot
    if (cur !== null && cur.id === id && cur.owner === owner && cur.client.id === client.id && cur.key === key && sameLaunchSpec(cur.spec, spec)) {
      cur.request = request; // the xhigh panel (scalpel-2, finding 4): the newer request now names it
      return { status: 'running', generation: cur.generation };
    }
    if (cur !== null) this.end(cur, 'a newer prestart replaced it');
    const live = this.deps.table.get(id);
    if ((live !== undefined && live.lifecycle !== 'exited') || this.deps.table.isAdopting(id)) return refused('the session has a live process');
    const h: Prestart = {
      id, generation: ++this.generation, owner, request, client, spec, key, session: null, state: 'admitted', announced: false, unwatch: () => {}, handedOver: false, settled: Promise.resolve(),
      stage: new Stage({ maxBytes: this.deps.stageMaxBytes ?? PRESTART_STAGE_MAX_BYTES, overflow: () => this.end(h, `its stage passed ${this.deps.stageMaxBytes ?? PRESTART_STAGE_MAX_BYTES} bytes`) }),
    };
    this.current = h;
    h.unwatch = client.onGone(() => this.end(h, 'the connection that asked for it ended')); // at once when gone already
    if (h.state === 'ended') return refused('the connection that asked for it ended');
    void this.serial(id, () => this.launchHidden(h)).catch((error: unknown) => this.deps.log(`${id}: prestart not launched: ${messageOf(error)}`));
    return { status: 'started', generation: h.generation };
  }

  // `session.prestart.withdraw`: the prestart every given name matches (its generation, the spine's request: the xhigh
  // panel, scalpel-2 finding 4), only while it is not committing or committed; a withdraw that names neither does nothing.
  withdraw(appSessionId: AppSessionId, by: { generation?: number | undefined; request?: string | undefined }): void {
    const h = this.current;
    if (h === null || h.id !== appSessionId || (by.generation === undefined && by.request === undefined)) return;
    if ((by.generation === undefined || h.generation === by.generation) && (by.request === undefined || h.request === by.request)) this.end(h, 'withdrawn');
  }

  // `session.prestart.release` (R4-7): the owner's prestarts end, and it admits none from now on.
  release(owner: string): void {
    this.released.add(owner);
    const h = this.current;
    if (h !== null && h.owner === owner) this.end(h, 'its owner was released');
  }

  // A forget or a stop of the id: its prestart ends; a commit under way is waited for, its retirement included (the
  // panel's scalpel-1#3), and then the row is the session's or gone. Answers once the id holds no hidden row.
  async endFor(appSessionId: AppSessionId, why: string): Promise<void> {
    const h = this.current;
    if (h !== null && h.id === appSessionId) {
      if (h.state === 'committing') await h.settled;
      else this.end(h, why);
    }
    await this.chains.get(appSessionId);
  }

  // `session.launch`: with `adopt`, the hidden row when it is claimable and the same launch, else a fresh launch; with
  // none, a prestart of the id ends first. A launch of an id no prestart touches runs at once, as before.
  // M2's review: the launch fences the id's prestarts from its entry to its answer (finding 6); an admission still in its
  // probes is cancelled and the launch goes on at once (finding 5), as a row ended now leaves the id free at once.
  async launch(spec: LaunchSpec, artifactScope: readonly AppSessionId[] | undefined, adopt: { key: string } | undefined): Promise<LaunchResult> {
    const id = spec.appSessionId;
    this.fenced.set(id, (this.fenced.get(id) ?? 0) + 1);
    try {
      const fresh = () => this.deps.launch(spec, artifactScope);
      const cur = this.current;
      if (cur === null || cur.id !== id) return await fresh();
      // the panel's rule: a commit under way, or one being retired, holds its id until its outcome
      if (cur.state === 'committing') return { status: 'refused', reason: 'already_live', message: 'its prestart is being adopted or ended; try again in a moment' };
      if (adopt === undefined || cur.state === 'admitted') {
        this.end(cur, adopt === undefined ? 'a launch of its id' : 'adopted before it launched: a fresh launch');
        return await fresh();
      }
      return await this.adopt(cur, spec, adopt.key, fresh);
    } finally {
      const left = (this.fenced.get(id) ?? 1) - 1;
      if (left > 0) this.fenced.set(id, left);
      else this.fenced.delete(id);
    }
  }

  // M2's review, finding 8: every commit under way settled (each bounded by its promotion's), before a stop-all's
  async settled(): Promise<void> {
    while (this.commits.size > 0) await Promise.allSettled([...this.commits]);
  }

  // The hidden rows now, for a client's welcome and the internal query (R4-6).
  hidden(): { appSessionId: AppSessionId; engineSessionId: SessionId | null }[] {
    const h = this.current;
    if (h === null || h.session === null || !h.announced || (h.state !== 'hidden' && h.state !== 'committing')) return []; // M2's review, finding 7
    return [{ appSessionId: h.id, engineSessionId: h.session.status().engineSessionId }];
  }

  // ---------------------------------------------------------------------------------------------------------------------

  private async launchHidden(h: Prestart): Promise<void> {
    if (h.state === 'ended') return;
    // the panel's scalpel-2#8: one prestart engine at a time, an ending one included
    if (this.ending.size > 0) {
      await within(Promise.allSettled([...this.ending]), ENDING_MS);
      if (h.state !== 'admitted') return;
    }
    const hidden: HiddenLaunch = { admitted: () => h.state === 'admitted', stage: h.stage };
    let result: Awaited<ReturnType<Launcher>>;
    try {
      result = await this.deps.launch(h.spec, [], hidden);
    } catch (error) {
      this.deps.log(`${h.id}: prestart generation ${h.generation} not launched: ${messageOf(error)}`);
      this.end(h, 'its launch failed');
      return;
    }
    if (result.status === 'cancelled') return; // ended before it spawned
    if (result.status !== 'launching') {
      this.deps.log(`${h.id}: prestart generation ${h.generation} not launched: ${result.status === 'refused' ? result.message : 'its relay is unreachable'}`);
      this.end(h, 'its launch was refused');
      return;
    }
    const session = this.deps.table.getAny(h.id);
    if (session === undefined || !this.deps.table.isHidden(h.id)) {
      this.end(h, 'its row was not reserved hidden');
      return;
    }
    if (h.state !== 'admitted') { // ended between its reservation and this turn: the row goes now, unless its end took it
      if (h.session === null) this.kill(h, session, 'ended while it reserved its row');
      return;
    }
    h.session = session;
    this.rows.set(session, h);
    h.state = 'hidden';
    h.announced = true;
    this.announce(h, 'hidden');
    this.deps.log(`${h.id}: prestart generation ${h.generation} launched hidden (launch ${session.status().launchId})`);
  }

  private async adopt(h: Prestart, spec: LaunchSpec, key: string, fresh: () => Promise<LaunchResult>): Promise<LaunchResult> {
    const miss = this.unclaimable(h) ?? (!sameLaunchSpec(h.spec, spec) ? 'its spec differs' : h.key !== key ? 'its key differs' : await this.otherBinary(h)) ?? this.unclaimable(h);
    if (miss !== null) {
      this.end(h, `not adopted: ${miss}`);
      return fresh();
    }
    const session = h.session!;
    h.state = 'committing'; // immune to a newer prestart, a withdraw or the connection's end; it keeps the slot (finding 7)
    h.unwatch();
    let settle!: () => void;
    h.settled = new Promise<void>((resolve) => (settle = resolve));
    const commit = this.commit(h, session);
    this.commits.add(commit);
    let failed: string | null;
    try {
      failed = await commit;
    } finally {
      this.commits.delete(commit);
    }
    if (failed === null) {
      try {
        return this.reveal(h, session);
      } finally {
        settle();
      }
    }
    // step 5, under the panel's rule: retired, then a fresh launch once it is rolled back
    const retired = this.retire(h, session, `not adopted: ${failed}`);
    void retired.then(settle);
    const rolledBack = await within(retired, this.deps.retireWaitMs ?? RETIRE_WAIT_MS);
    if (rolledBack === true) return fresh();
    const why = rolledBack === undefined ? 'is still ending' : 'could not be confirmed gone, and is left for the next start';
    return { status: 'refused', reason: 'already_live', message: `its prestart (${failed}) ${why}; try again in a moment` };
  }

  // R4-1's steps 2 and 3, the row still hidden: null once promoted and still revealable, else why not
  private async commit(h: Prestart, session: EngineSession): Promise<string | null> {
    try {
      await session.commitStage(); // R4-1 step 2, the row still hidden; the state file durable (finding 1)
      if (h.handedOver || h.stage.over) return h.handedOver ? 'a handover began' : 'its stage is full';
      const promoted = await session.promote(this.deps.promoteMs); // step 3
      if (!promoted.ok) return `the session host did not promote it: ${promoted.message}`;
      if (h.handedOver) return 'a handover began while its promotion was out'; // finding 8: never revealed after the freeze
      if (h.stage.over) return 'its stage is full'; // finding 9
      if (!CLAIMABLE.has(session.lifecycle) || this.deps.table.getAny(h.id) !== session) return `its engine is ${session.lifecycle}`;
      return null;
    } catch (error) {
      return messageOf(error);
    }
  }

  // Step 4 (R4-3, R4-5): revealed, published, answered; the surface attaches behind the answer. The backup goes last, and
  // a removal that fails is logged, never the reveal's failure (the panel's scalpel-1#6): nothing restores a promoted
  // launch's backup.
  private reveal(h: Prestart, session: EngineSession): LaunchResult {
    h.state = 'committed';
    if (this.current === h) this.current = null;
    this.rows.delete(session);
    h.stage.close();
    this.deps.table.reveal(h.id);
    this.deps.publish(session);
    session.reveal();
    this.announce(h, 'committed');
    const launchId = session.status().launchId;
    try {
      session.settleStage();
    } catch (error) {
      this.deps.log(`${h.id}: the state backup of launch ${launchId} not removed (${messageOf(error)}); left as it is`);
    }
    this.deps.log(`${h.id}: prestart generation ${h.generation} adopted (launch ${launchId})`);
    return { status: 'launching', session: session.status() };
  }

  // A commit that is not revealed (the panel's rule): its row stays hidden and committing, holding its id, while its
  // engine stops and the rollback waits for its holder to be gone; then it is let go. True when it was rolled back.
  private async retire(h: Prestart, session: EngineSession, why: string): Promise<boolean> {
    const status = session.status();
    this.deps.log(`${h.id}: prestart generation ${h.generation} ${why}; launch ${status.launchId} stops before anything of it is rolled back`);
    await session.stop('stop').catch((error: unknown) => this.deps.log(`${h.id}: prestart not stopped: ${messageOf(error)}`));
    const rolledBack = await this.rollBack(h.id, session, status);
    this.letGo(h, session, why);
    return rolledBack;
  }

  // R4-9: why the row cannot be adopted, or null
  private unclaimable(h: Prestart): string | null {
    if (h.state !== 'hidden') return h.state === 'admitted' ? 'it has not launched' : `it is ${h.state}`;
    const session = h.session;
    if (session === null || this.deps.table.getAny(h.id) !== session || !this.deps.table.isHidden(h.id)) return 'its row is gone';
    if (!CLAIMABLE.has(session.lifecycle) || session.ending) return `its engine is ${session.lifecycle}`;
    if (session.initializeFailedSeen) return 'its initialize failed';
    if (this.released.has(h.owner)) return 'its owner was released';
    if (h.stage.over) return 'its stage is full';
    return null;
  }

  // D4 (finding R2-7): the engine binary the row was spawned with against the one configured now
  private async otherBinary(h: Prestart): Promise<string | null> {
    let probe: BinaryCheck;
    try {
      probe = await this.deps.binaryProbe();
    } catch (error) {
      return `the engine binary could not be probed: ${messageOf(error)}`;
    }
    const spawned = h.session!.spawnedBinary;
    if (!probe.ok || probe.path !== spawned.bin || probe.version !== spawned.engineVersion) return `its engine binary (${spawned.bin} ${spawned.engineVersion}) is not the configured one (${probe.path} ${probe.version ?? 'no version'})`;
    return null;
  }

  private due(session: EngineSession, why: HiddenDue): void {
    const h = this.rows.get(session);
    if (h === undefined) {
      // a hidden row with no prestart of its own (never: every hidden row is one's) is ended as one
      if (this.deps.table.detachHidden(session.status().appSessionId) !== null) void session.stop('stop');
      return;
    }
    if (h.state === 'committing') { // the commit decides: its promotion or its checks fail on an engine gone
      if (why === 'handover') h.handedOver = true; // M2's review, finding 8: settled once the promotion answers
      return;
    }
    this.end(h, why === 'exited' ? 'its engine exited' : `the ${why === 'handover' ? 'handover' : why === 'idle' ? 'idle release' : 'memory budget'} ended it`);
  }

  // Ends a prestart: its admission cancelled, or its row killed.
  private end(h: Prestart, why: string): void {
    if (h.state === 'ended' || h.state === 'committed' || h.state === 'committing') return;
    // M2's review, finding 5: a row reserved and not yet taken up by its launch (the one hidden row there is) is its
    const reserved = h.session ?? (this.deps.table.isHidden(h.id) ? (this.deps.table.getAny(h.id) ?? null) : null);
    if (reserved !== null) {
      this.kill(h, reserved, why);
      return;
    }
    h.state = 'ended';
    h.unwatch();
    if (this.current === h) this.current = null;
    this.deps.log(`${h.id}: prestart generation ${h.generation} withdrawn before its row (${why})`);
  }

  // A hidden row never committed: let go at once (its id free), its engine stopped, and rolled back once its holder is
  // gone.
  private kill(h: Prestart, session: EngineSession, why: string): void {
    const status = session.status();
    this.letGo(h, session, why);
    void (async () => {
      await session.stop('stop').catch((error: unknown) => this.deps.log(`${h.id}: prestart not stopped: ${messageOf(error)}`));
      await this.rollBack(h.id, session, status);
    })();
  }

  // The row leaves the table (its id free), what the host kept for it goes, and `ended` is announced. The next prestart
  // spawns once its exit is seen (scalpel-2#8).
  private letGo(h: Prestart, session: EngineSession, why: string): void {
    const exit = session.exited.then(() => {});
    this.ending.add(exit);
    void exit.then(() => this.ending.delete(exit));
    h.state = 'ended';
    h.session = session;
    h.unwatch();
    if (this.current === h) this.current = null;
    h.stage.close();
    this.rows.delete(session);
    if (this.deps.table.getAny(h.id) === session) this.deps.table.detachHidden(h.id);
    this.deps.drop(session);
    if (h.announced) this.announce(h, 'ended');
    this.deps.log(`${h.id}: prestart generation ${h.generation} ended (${why}); launch ${session.status().launchId} let go`);
  }

  // The one rollback (the panel's rule). Once the engine has exited (within its ladder's bound) and its session host is
  // gone (`endHost`, which then removes the host's entry while it is still marked): the state the launch's commit wrote
  // restored (or removed), then its staged files removed (M1's order: the files before the entry). A holder not
  // confirmed gone keeps all of it, recoverable by the next start. True when rolled back (a direct spawn's process is
  // its own holder). Never rejects.
  private async rollBack(id: AppSessionId, session: EngineSession, status: ReturnType<EngineSession['status']>): Promise<boolean> {
    const name = `${id}: launch ${status.launchId}`;
    if ((await within(session.exited, ENDING_MS)) === undefined) {
      this.deps.log(`${name}: its engine has not exited; nothing of it rolled back, left for the next start`);
      return false;
    }
    const files = async (): Promise<void> => {
      try {
        await session.discardStage();
        removeStagedFiles(this.deps.journalDir(id), status.launchId);
      } catch (error) {
        this.deps.log(`${name}: not all of it rolled back (${messageOf(error)}); its session host's entry stays for the next start`);
        throw error;
      }
    };
    const holder = status.holder;
    if (!holder || !this.deps.endHost) {
      await files().catch(() => {});
      return true;
    }
    const gone = await this.deps.endHost({ holderId: holder.holderId, pid: holder.pid }, files).catch((error: unknown) => {
      this.deps.log(`${name}: its session host's entry not removed: ${messageOf(error)}`);
      return true; // the rollback ran: the host was gone
    });
    if (!gone) this.deps.log(`${name}: its session host has not exited; nothing of it rolled back, left for the next start`);
    return gone;
  }

  private announce(h: Prestart, state: PrestartState): void {
    this.deps.emit('engine.prestart', { appSessionId: h.id, engineSessionId: h.session?.status().engineSessionId ?? null, state });
  }

  private serial<T>(id: AppSessionId, run: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(id) ?? Promise.resolve()).then(run, run);
    const tail = next.then(() => {}, () => {});
    this.chains.set(id, tail);
    void tail.then(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id);
    });
    return next;
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The promise's value, or undefined once `ms` has passed first
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
