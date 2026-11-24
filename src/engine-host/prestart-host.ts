// Ticket 851, M2 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D1 to D4 as amended, R4-1 to R4-9): the engine
// host's prestarts. At most one per host: a launch admitted for a spine root (`owner`) over one connection, run hidden
// (process-table.ts, launcher.ts `HiddenLaunch`, prestart.ts), and either adopted by `session.launch { adopt }` or ended.
//
// The admission is registered in the handler before its first await, with a generation the host assigns. A newer
// prestart (for any id), a launch of the id, a withdraw of that generation, a forget or stop of the id, the end of the
// connection that asked and the release of its owner each cancel it (the launcher reads it after its probes and in the
// step that reserves the row, so a cancelled admission never spawns) or end its row. Ending ("kill") stops the engine
// through the ladder and drops the row at once (no released id, no exited row); once the process has exited, the
// launch's staged files (which an adopt that failed after writing them leaves) are removed, then its session host's
// roster entry, which a marked host keeps at its exit (M1's rule: the files before the entry).
//
// Every launch of an id a prestart holds or is admitting runs under the id's serialization. Adopt takes the hidden row
// when it is claimable (R4-9) and its spec (but for `sessionId`), key and engine binary are the ones asked: the stage and
// the held writes are written (R4-1's step 2, still hidden), the session host promotes the launch (step 3), then the row
// is revealed, its snapshot published and the answer given, the surface attaching afterwards (step 4, R4-5). Anything
// else, or a failure in steps 2 and 3, ends the prestart and launches the spec as any launch.
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

export type PrestartState = 'hidden' | 'committed' | 'ended';
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
  // the session host's roster entry removed once the host has exited (index.ts); absent: a direct spawn, or the next
  // engine host's start clears it
  endHost?: (host: { holderId: string; pid: number }) => Promise<void>;
  promoteMs?: number;
  stageMaxBytes?: number;
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
      id, generation: ++this.generation, owner, request, client, spec, key, session: null, state: 'admitted', announced: false, unwatch: () => {}, handedOver: false,
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

  // A forget or a stop of the id: its prestart ends (a commit under way is waited for, and then the row is the
  // session's). Answers once the id holds no hidden row.
  async endFor(appSessionId: AppSessionId, why: string): Promise<void> {
    const h = this.current;
    if (h !== null && h.id === appSessionId) this.end(h, why);
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
    const committing = (async (): Promise<string | null> => {
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
    })();
    this.commits.add(committing);
    let failed: string | null;
    try {
      failed = await committing;
    } finally {
      this.commits.delete(committing);
    }
    if (failed !== null) {
      // step 5: no write of the staged commit lands from now on and its state is restored before the fresh launch reads
      // any (finding 2); the engine ends, then its journal files and its host's entry go
      await session.discardStage().catch((error: unknown) => this.deps.log(`${h.id}: the state of the prestart not restored: ${messageOf(error)}`));
      h.state = 'hidden';
      this.end(h, `not adopted: ${failed}`);
      return fresh();
    }
    // step 4 (R4-3, R4-5): revealed, published, answered; the surface attaches behind the answer
    h.state = 'committed';
    if (this.current === h) this.current = null;
    this.rows.delete(session);
    h.stage.close();
    session.settleStage();
    this.deps.table.reveal(h.id);
    this.deps.publish(session);
    session.reveal();
    this.announce(h, 'committed');
    this.deps.log(`${h.id}: prestart generation ${h.generation} adopted (launch ${session.status().launchId})`);
    return { status: 'launching', session: session.status() };
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
    h.state = 'ended';
    h.unwatch();
    if (this.current === h) this.current = null;
    // M2's review, finding 5: a row reserved and not yet taken up by its launch (the one hidden row there is) is its
    const reserved = h.session ?? (this.deps.table.isHidden(h.id) ? (this.deps.table.getAny(h.id) ?? null) : null);
    if (reserved !== null) this.kill(h, reserved, why);
    else this.deps.log(`${h.id}: prestart generation ${h.generation} withdrawn before its row (${why})`);
  }

  private kill(h: Prestart, session: EngineSession, why: string): void {
    h.state = 'ended';
    h.session = session;
    h.stage.close();
    this.rows.delete(session);
    if (this.deps.table.getAny(h.id) === session) this.deps.table.detachHidden(h.id);
    this.deps.drop(session);
    if (h.announced) this.announce(h, 'ended');
    const status = session.status();
    this.deps.log(`${h.id}: prestart generation ${h.generation} ended (${why}); launch ${status.launchId} stopped`);
    const holder = status.holder;
    void (async () => {
      await session.stop('stop').catch((error: unknown) => this.deps.log(`${h.id}: prestart not stopped: ${messageOf(error)}`));
      await session.exited;
      // M1's order: the launch's staged files, then its session host's entry
      try {
        removeStagedFiles(this.deps.journalDir(h.id), status.launchId);
      } catch (error) {
        this.deps.log(`${h.id}: the staged files of launch ${status.launchId} not removed (${messageOf(error)}); the next start removes them with its entry`);
        return;
      }
      if (holder && this.deps.endHost) await this.deps.endHost({ holderId: holder.holderId, pid: holder.pid }).catch((error: unknown) => this.deps.log(`${h.id}: the session host entry of launch ${status.launchId} not removed: ${messageOf(error)}`));
    })();
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
