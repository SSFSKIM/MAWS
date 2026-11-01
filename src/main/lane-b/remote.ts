// Remote lane B (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M2 and Interfaces §J, §K): a lane B
// session on another machine, driven from this app over that machine's RL2 link (O7's `RemoteLink`, reached only through
// `Machines.remote(ref)`). The renderer keeps the local driver's commands and events; only this adapter knows the wire,
// and it opens no channel (O7's boundary.test.ts): every byte goes through the link's `call`, `act` and `subscribe`.
// Mirrors O9's remote lane A (src/main/lane-a/remote.ts).
//
// The composition root wraps the router's `remote` option (`routeLaneB` around `routeLaneA`): a name `handles` takes, for
// a machine `Machines.remote` answers, comes here with its link; every other command takes the manager's path, where a
// `list`- or `view`-graded one goes as a call (`dispatchOverLink`), which is how the pane's reads reach the machine.
//
// - Subscriptions follow the tabs (./remote-interest.ts): while a tab holds a session's address, its fold
//   (./remote-session.ts) reads its record and streams it; ten seconds after the last tab closed it is let go. A link the
//   roster drops ends its sessions (`closed`).
// - Acts are built here from typed fields and sealed by the link, in two shapes. An engine-host act (a send, a steer, an
//   interrupt, an answer, the queue's and the chips') names the session and carries the context of the last status its
//   stream delivered (`{lane: 'B', launchId, engineSessionId}`), its args the command's input (bare ids: the renderer
//   lowered them); an answer carries DX6's request digest over the pending request read with `session.pendingRequest`. A
//   `machine` act (`session.acquire`) carries neither a session nor a context: the machine places it by its args. An
//   engine-host act on a session with no `ready` status (released, opening, or its launch `exited` with the row kept)
//   resumes it first, `session.acquire` unless one is out, and is sealed with the first `ready` status the resumed launch
//   delivers; one whose launch is `starting` or `initializing` waits for its `ready`. An act on a session no tab holds is refused
//   `not-open`. Step-up is the link's `if-asked`.
// - Sends (`session.send`, `session.steer`) go one at a time per session: the next act is made at the one before's
//   outcome or at the pending bound, at most `sendQueueMax` waiting; an interrupt or an answer never waits behind them.
// - The pending bound. Every act answers at its outcome (./remote-outcomes.ts), never earlier, or at `sendPendingMs` from
//   its turn at the latest: an act the channel carried and whose answer was lost is queried by the link up to RL4's
//   horizon, so the renderer is answered `timeout` with the pending words, the act goes on querying and its late outcome
//   is logged. An act never put on a channel is past the bound only until the link's own hold ends it (`refused
//   offline`: A4's "Not sent").
// - Substitutes for two reads the pane makes that no offer row carries: `attention.request` from `session.pendingRequest`;
//   `engine.models` (machine-wide, graded `spawn`) from `session.listModels` of a live session there, the one in the asked
//   directory first, else the built-in list.
// - `session.events`, offered as a call, read in pages the channel carries when one answer would be too large
//   (./remote-history.ts): the pane's hydration of a long launch, or one holding large inline images; from M4, within the
//   machine's byte budget when its endpoint listed `rl2.events-budget`.
// - P5 O7 M4: the checkout. Its writes (`files.write`, the scm acts) are `machine` acts like `session.acquire`, so the
//   editor saves to an idle session's checkout without resuming it; `files.upload` crosses in parts, one upload at a time
//   per session (./remote-upload.ts); `session.spawn` is a `machine` act on the machine itself that always takes step-up
//   (the sheet and Touch ID), answered at its outcome within its own bound from the moment it went out. The checkout's
//   changes arrive on the session's feed and its watches are kept and given back across a reconnect
//   (./remote-checkout.ts). Every read of the checkout (`git.*`, `files.*`, `scm.*` reads) takes the manager's path as a
//   call, carrying the session it was made from (`MainContext.session`, sent as `call.session`).
import { requestDigestOf } from '@shared/host/request-digest';
import type { SessionEvent } from '@shared/graph/events';
import { ipcError, type IpcErrorCode } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import { validateCommandOutput } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { BUILTIN_MODELS } from '@shared/sessions/models';
import type { FilesUploadInput } from '@shared/ipc/schema/files';
import type { MainContext, RemoteDispatch } from '../ipc/router';
import type { LayoutFileStore } from '../layout/store';
import { peerLists } from '../machines/remote/capabilities';
import { dispatchOverLink } from '../machines/remote/dispatch';
import type { ActHandle, ActOutcome, RemoteLink } from '../machines/remote/link';
import { createRemoteCheckout, WATCH_COMMANDS, type RemoteCheckoutTiming } from './remote-checkout';
import { readEventsInPages } from './remote-history';
import { createRemoteInterest } from './remote-interest';
import { outcomeAsResult, pendingResult } from './remote-outcomes';
import { LIST_WAIT_MS, RemoteSession, type RemoteSessionTiming } from './remote-session';
import { createSpawnAttempts } from './remote-spawn';
import { readFileInPages } from './remote-files-read';
import { uploadInParts } from './remote-upload';

export interface RemoteLaneBTiming extends RemoteSessionTiming, RemoteCheckoutTiming {
  /** A closed tab's subscription outlives it this long. */
  unsubscribeLingerMs: number;
  /** An act answers the renderer by then: its outcome, or `timeout` with the pending words while it goes on querying. */
  sendPendingMs: number;
  /** Sends waiting behind the one in flight. */
  sendQueueMax: number;
  /** P5 O7 M4: a spawn answers by then from the moment it went out (after the sheet): the machine's own bound on it and a margin. */
  spawnPendingMs: number;
  /** M4c fix wave 2: how long a spawn's outcome no caller waited for is kept for the tab that asked (remote-spawn.ts). */
  spawnKeptMs: number;
}

export const REMOTE_LANE_B_TIMING: RemoteLaneBTiming = {
  unsubscribeLingerMs: 10_000,
  recordRetryMs: [500, 1000, 2000, 4000],
  idleRetryMs: [1000, 30_000],
  // past the machine's park window (10 min by default) and its first tries: a try wakes a parked host (O5's audit)
  idleProbeMaxMs: 30 * 60_000,
  sendPendingMs: 60_000,
  sendQueueMax: 8,
  batchMax: 500,
  // the machine's own bound on a spawn (`session.spawn`'s command budget, 200 s: the configure gate, a git call, the
  // launch watchdog and a margin; src/services/command-budgets.ts) and ten seconds for the round trip
  spawnPendingMs: 210_000,
  // a day: a tombstone is a few bytes, and one let go too soon could let the tab's next Send start a second session
  spawnKeptMs: 24 * 60 * 60_000,
  feedRetryMs: [1000, 30_000],
};

export interface RemoteLaneBDeps {
  local: MachineRef;
  /** `main.tabs`: the addresses of RL2 machines are the interest. */
  layout: Pick<LayoutFileStore, 'get' | 'onChange'>;
  /** Machines.remote. */
  remote(machine: MachineRef): RemoteLink | null;
  /** Machines.onRemote: a link closed ends its sessions. */
  onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;
  /** emitFrom. */
  emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;
  /**
   * The lane the org rows list a machine's session in, or null for one they don't (yet): a tab of a lane A session is
   * O9's adapter's and is never placed here. A session not listed is taken as lane B (a session this app just resumed or
   * spawned may be listed later). `refresh` reads the tabs again once the rows changed.
   */
  laneOf?(machine: MachineRef, session: string): 'A' | 'B' | null;
  timing?: Partial<RemoteLaneBTiming>;
  now?(): number;
  log(line: string): void;
}

export interface RemoteLaneB {
  /** Whether the adapter takes `name` for an RL2 machine: §L's lane B acts, the substitutes, the paged read and (M4) the checkout's watches. */
  handles(name: CommandName): boolean;
  dispatch(link: RemoteLink, name: CommandName, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>;
  /** The tabs read again: the org rows (`laneOf`) changed. */
  refresh(): void;
  /**
   * Says a held session's record, last parts and `remote.session` again, for a page that has just subscribed: the pane's
   * own `session.get` is that page's announcement (`routeLaneB`), made after it subscribed (C1's subscribe-then-read).
   */
  replay(machine: MachineRef, app: string): void;
  /** Every subscription closed: before the links, in the shutdown order. */
  stop(): void;
  /** M4c fix wave 2: the spawn attempts kept, by tab (tests): an act out, or its answer. */
  spawnsKept(): Array<{ key: string; state: 'out' | 'said' }>;
}

/** The engine-host acts §L offers for lane B, each sealed for the session's live launch. */
export const ENGINE_HOST_ACTS: ReadonlySet<CommandName> = new Set<CommandName>([
  'session.send', 'session.steer', 'session.interrupt', 'session.answer',
  'session.queue.edit', 'session.queue.promote', 'session.queue.setPaused', 'session.queue.hold', 'session.queue.remove',
  'session.setModel', 'session.setEffort', 'session.setThinking', 'session.setPermissionMode',
  'session.stopTask', 'session.sideQuestion', 'session.mcpToggle', 'session.mcpReconnect',
  'session.rewind', 'session.rewindFiles', 'session.forget', 'session.setKeep', 'session.generateTitle',
]);
/** The `machine` acts §L offers for lane B: placed by their args (or, a spawn, on the machine), neither a session nor a context. */
export const MACHINE_ACTS: ReadonlySet<CommandName> = new Set<CommandName>([
  'session.acquire',
  // P5 O7 M4: the checkout's writes, an upload's parts and the spawn
  'files.write', 'files.upload', 'scm.stage', 'scm.unstage', 'scm.discard', 'scm.commit', 'scm.push', 'scm.pr.create', 'scm.remote.cancel',
  'session.spawn',
]);
/** Reads the pane makes that no row offers, answered here from one that is. */
export const SUBSTITUTES: ReadonlySet<CommandName> = new Set<CommandName>(['attention.request', 'engine.models']);
/** Reads offered as calls that the adapter makes in pages the channel carries (./remote-history.ts). */
export const PAGED_READS: ReadonlySet<CommandName> = new Set<CommandName>(['session.events', 'files.read']); // files.read: M4's milestone review
const SENDS: ReadonlySet<CommandName> = new Set<CommandName>(['session.send', 'session.steer']);
export const NOT_OPEN = 'open the session to drive it';

/**
 * The router's `remote`: a name the adapter handles, for a machine `remote` answers, goes to it; everything else to
 * `base`. A `session.get` of an RL2 machine's session is a pane's opening read, after its page subscribed: once answered,
 * the adapter says that session's state again, so a reloaded page or a second window has what was said before it listened.
 */
export function routeLaneB(base: RemoteDispatch, remote: (machine: MachineRef) => RemoteLink | null, laneB: RemoteLaneB): RemoteDispatch {
  return async (machine, name, input, ctx) => {
    const link = laneB.handles(name) ? remote(machine) : null;
    if (link !== null) return laneB.dispatch(link, name, input, ctx);
    const result = await base(machine, name, input, ctx);
    const app = (input as { appSessionId?: unknown } | null | undefined)?.appSessionId;
    if (name === 'session.get' && typeof app === 'string' && remote(machine) !== null) laneB.replay(machine, app);
    return result;
  };
}

type Fields = Record<string, unknown>;
type Send = { name: CommandName; fields: Fields; resolve(result: CommandResult<CommandName>): void };
/** One session's lane: its fold, whether a tab holds it, its sends, and the resume out for it. */
type Lane = { session: RemoteSession; open: boolean; sends: Send[]; sending: boolean; acquiring: Promise<CommandResult<CommandName>> | null };
type Context = { launchId: string; engineSessionId: string };

const record = (value: unknown): Fields | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : null);
const failure = (code: IpcErrorCode, message: string, issues?: unknown): CommandResult<CommandName> => ({ ok: false, error: ipcError(code, message, issues) });

export function createRemoteLaneB(deps: RemoteLaneBDeps): RemoteLaneB {
  const timing: RemoteLaneBTiming = { ...REMOTE_LANE_B_TIMING, ...deps.timing };
  const now = deps.now ?? Date.now;
  const machines = new Map<MachineRef, { link: RemoteLink; lanes: Map<string, Lane> }>();
  let revision = 0;
  const sessionOf = (machine: MachineRef, app: string) => machines.get(machine)?.lanes.get(app)?.session;
  const checkout = createRemoteCheckout({
    remote: deps.remote,
    emit: deps.emit,
    timing,
    recordChanged: (machine, app, record) => sessionOf(machine, app)?.recordChanged(record),
    following: (machine, app) => sessionOf(machine, app)?.kick(),
    unfollowed: (machine, app) => sessionOf(machine, app)?.unfollowed(),
    log: deps.log,
  });
  /** Each session's upload in flight (machine and session): the next waits for it. */
  const uploads = new Map<string, Promise<unknown>>();
  /** P5 O7 M4: each New chat tab's spawn, kept by the tab it is made from (remote-spawn.ts). */
  /**
   * P5 O7 M4 (the architect's ruling on M4d's gap): the sessions this app spawned, by machine and appSessionId, and when
   * their spawn settled: their open waits a minute for the machine to list them (remote-session.ts). Let go at the first
   * record had, at the minute's end, and at stop.
   */
  const spawned = new Map<string, number>();
  const listWaitMs = timing.listWaitMs ?? LIST_WAIT_MS;
  const spawnedAt = (key: string): number | null => {
    for (const [held, at] of spawned) if (now() - at >= listWaitMs) spawned.delete(held);
    return spawned.get(key) ?? null;
  };
  const spawns = createSpawnAttempts({ now, log: deps.log, pendingMs: timing.spawnPendingMs, tombstoneMs: timing.spawnKeptMs, bounded: (handle, deadline) => bounded(handle, deadline) });

  // ---- Lanes, the tabs and the links -------------------------------------------------------------------------------------

  /** The machine's lanes under `link`; a new link for the machine (its roster entry made again) ends what the old one carried. */
  function lanesOf(link: RemoteLink): Map<string, Lane> {
    const held = machines.get(link.machine);
    if (held !== undefined && held.link === link) return held.lanes;
    if (held !== undefined) for (const [app, lane] of held.lanes) end(link.machine, app, lane, 'closed');
    const lanes = new Map<string, Lane>();
    machines.set(link.machine, { link, lanes });
    return lanes;
  }

  function open(machine: MachineRef, app: string): void {
    const link = deps.remote(machine);
    if (link === null) return;
    const lanes = lanesOf(link);
    let lane = lanes.get(app);
    if (lane === undefined) {
      const session = new RemoteSession({
        machine,
        app,
        link,
        emit: deps.emit,
        timing,
        revision: () => (revision = Math.max(revision + 1, now())),
        subscribed: () => checkout.open(link, app), // P5 O7 M4: the checkout feed beside the stream
        followed: () => checkout.follows(machine, app), // its record, which an idle stream waits for
        spawnedAt: () => spawnedAt(`${machine}\n${app}`), // spawned here: its open waits for the machine to list it
        spawnWaitOver: () => void spawned.delete(`${machine}\n${app}`),
        now,
        log: deps.log,
      });
      lanes.set(app, (lane = { session, open: false, sends: [], sending: false, acquiring: null }));
    }
    lane.open = true;
    lane.session.start();
  }

  /** A lane's stream and feed closed, said as `ended` when given. */
  function end(machine: MachineRef, app: string, lane: Lane, ended?: string): void {
    lane.session.stop(ended);
    checkout.close(machine, app);
  }

  function close(machine: MachineRef, app: string): void {
    const lanes = machines.get(machine)?.lanes;
    const lane = lanes?.get(app);
    if (lane === undefined) return;
    lane.open = false;
    end(machine, app, lane);
    forget(machine, app, lane);
  }

  /** A lane no tab holds and with no send out is let go. */
  function forget(machine: MachineRef, app: string, lane: Lane): void {
    if (lane.open || lane.sending || lane.sends.length > 0) return;
    const lanes = machines.get(machine)?.lanes;
    if (lanes?.get(app) === lane) lanes.delete(app);
  }

  const interest = createRemoteInterest({
    layout: deps.layout,
    local: deps.local,
    isRemote: (machine) => deps.remote(machine) !== null,
    isLaneA: (machine, session) => deps.laneOf?.(machine, session) === 'A',
    lingerMs: timing.unsubscribeLingerMs,
    open,
    close,
  });
  const offRemote = deps.onRemote(() => {
    spawns.linksChanged(deps.remote); // M4c fix wave 2: a spawn out on a link that ended can't be known
    for (const [machine, { link, lanes }] of [...machines]) {
      if (deps.remote(machine) === link) continue;
      for (const [app, lane] of lanes) end(machine, app, lane, 'closed');
      machines.delete(machine);
    }
    interest.refresh();
  });

  // ---- Acts ----------------------------------------------------------------------------------------------------------------

  /** The outcome, or `pending` at `deadline` once a copy of the act went out (one never sent waits for the link's hold). */
  function bounded(handle: ActHandle, deadline: number): Promise<ActOutcome | 'pending'> {
    return new Promise((resolve) => {
      let off = () => {};
      const timer = setTimeout(() => {
        if (handle.progress() !== 'waiting') return resolve('pending');
        off = handle.onProgress((progress) => {
          if (progress !== 'waiting') resolve('pending');
        });
      }, Math.max(0, deadline - now()));
      void handle.outcome.then((outcome) => {
        clearTimeout(timer);
        off();
        resolve(outcome);
      });
    });
  }

  async function settle(link: RemoteLink, name: CommandName, handle: ActHandle, deadline: number, what: string): Promise<CommandResult<CommandName>> {
    const outcome = await bounded(handle, deadline);
    if (outcome !== 'pending') return outcomeAsResult(name, link.name, outcome);
    deps.log(`lane B: ${name} on ${link.name}/${what} (${handle.opId}) unconfirmed at the pending bound; still querying`);
    void handle.outcome.then((late) => deps.log(`lane B: ${name} on ${link.name}/${what} (${handle.opId}) settled late: ${late.state}${'reason' in late ? ` ${late.reason}` : ''}`));
    return pendingResult(name, link.name);
  }

  /** A `machine` act: placed by its args, no session, no context. A ready resume subscribes an idle session at once. */
  async function machineAct(link: RemoteLink, name: CommandName, fields: Fields, deadline: number): Promise<CommandResult<CommandName>> {
    const handle = link.act({ action: name, args: fields, executor: 'machine', sendBy: deadline });
    const result = await settle(link, name, handle, deadline, String(fields.appSessionId ?? ''));
    if (name === 'session.acquire' && result.ok && record(result.value)?.status === 'ready') machines.get(link.machine)?.lanes.get(String(fields.appSessionId))?.session.kick();
    return result;
  }

  /** `files.upload` in parts, after any upload to the same session before it (P5 O7 M4, "Uploads in parts"). */
  function upload(link: RemoteLink, fields: Fields): Promise<CommandResult<CommandName>> {
    const input = fields as unknown as FilesUploadInput;
    const key = `${link.machine}\n${input.appSessionId}`;
    const before = uploads.get(key) ?? Promise.resolve();
    const run = before.then(() =>
      uploadInParts(input, {
        part: (args) => machineAct(link, 'files.upload', args as unknown as Fields, now() + timing.sendPendingMs),
        progress: (file, name, sent, parts) => deps.emit(link.machine, 'remote.upload', { appSessionId: input.appSessionId, file, name, sent, parts }),
      }),
    );
    const settled = run.then(
      () => {},
      () => {},
    );
    uploads.set(key, settled);
    void settled.then(() => {
      if (uploads.get(key) === settled) uploads.delete(key);
    });
    return run;
  }

  /** The session resumed and its live context, or why not. */
  async function resumed(link: RemoteLink, app: string, lane: Lane, deadline: number): Promise<Context | CommandResult<CommandName>> {
    if (lane.acquiring === null) {
      const acquiring = machineAct(link, 'session.acquire', { appSessionId: app, reason: 'send' }, deadline);
      lane.acquiring = acquiring;
      void acquiring.then(() => {
        if (lane.acquiring === acquiring) lane.acquiring = null;
      });
    }
    const acquired = await lane.acquiring;
    if (!acquired.ok) return acquired;
    const status = record(acquired.value)?.status;
    if (status !== 'ready') return failure('internal', `${link.name} couldn’t resume the session (${String(status)}); nothing was sent`, { refusal: status });
    const context = await lane.session.whenContext(deadline, now);
    return context ?? failure('host_unavailable', `Not sent: ${link.name} didn’t resume the session in time`);
  }

  /** An engine-host act on the session's live launch, resuming it first when it has none. */
  async function engineAct(link: RemoteLink, lane: Lane, name: CommandName, fields: Fields, deadline: number): Promise<CommandResult<CommandName>> {
    const app = lane.session.state.app;
    let context = lane.session.context();
    const resuming = context === null;
    if (context === null) {
      // A launch already on its way is waited for; one that ended (its row kept, `exited`) or none is resumed first.
      const resume = lane.session.launching()
        ? ((await lane.session.whenContext(deadline, now)) ?? failure('host_unavailable', `Not sent: ${link.name} didn’t resume the session in time`))
        : await resumed(link, app, lane, deadline);
      if ('ok' in resume) return resume;
      context = resume;
    }
    let requestDigest;
    if (name === 'session.answer') {
      const read = await dispatchOverLink(link, 'session.pendingRequest', { appSessionId: app, requestId: fields.requestId });
      if (!read.ok) return read;
      const event = (read.value as { event: SessionEvent | null }).event;
      if (event === null) return { ok: true, value: { outcome: 'not_pending' } } as CommandResult<CommandName>;
      requestDigest = requestDigestOf(app, event);
      if (requestDigest === null) return failure('internal', `${name}: the request on ${link.name} has no digest to answer it by`);
    }
    // One bound from the act's turn: what the resume (or the request's read) spent is not given back, so an act made at
    // the deadline is not made, and one made before it goes out by it or not at all (`sendBy`: no outbox, A4).
    if (now() >= deadline) return resuming ? failure('host_unavailable', `Not sent: ${link.name} didn’t resume the session in time`) : outcomeAsResult(name, link.name, { state: 'refused', reason: 'offline' });
    const handle = link.act({ action: name, session: app, context: { lane: 'B', ...context }, args: fields, executor: 'engine-host', sendBy: deadline, ...(requestDigest !== undefined && { requestDigest }) });
    return settle(link, name, handle, deadline, app);
  }

  /** The session's sends, one at a time: the next act is made only at the one before's answer. */
  async function pump(link: RemoteLink, lane: Lane): Promise<void> {
    if (lane.sending) return;
    lane.sending = true;
    try {
      for (let head = lane.sends[0]; head !== undefined; head = lane.sends[0]) {
        lane.session.state.sends = lane.sends.length - 1;
        head.resolve(await engineAct(link, lane, head.name, head.fields, now() + timing.sendPendingMs));
        lane.sends.shift();
      }
    } finally {
      lane.sending = false;
      lane.session.state.sends = 0;
      forget(link.machine, lane.session.state.app, lane);
    }
  }

  function send(link: RemoteLink, lane: Lane, name: CommandName, fields: Fields): Promise<CommandResult<CommandName>> {
    if (lane.sends.length - (lane.sending ? 1 : 0) >= timing.sendQueueMax) return Promise.resolve(failure('internal', `${name}: too many messages waiting for ${link.name}`, { refusal: 'busy' }));
    return new Promise((resolve) => {
      lane.sends.push({ name, fields, resolve });
      void pump(link, lane);
    });
  }

  // ---- The substitutes -------------------------------------------------------------------------------------------------------

  /** `engine.models` from a live session on the machine, the one in the asked directory first. */
  async function models(link: RemoteLink, fields: Fields): Promise<CommandResult<CommandName>> {
    const live = [...lanesOf(link).values()].filter((lane) => lane.session.context() !== null);
    const directory = (lane: Lane) => [lane.session.state.status?.cwd, lane.session.state.record?.directory];
    const chosen = live.find((lane) => fields.cwd !== undefined && directory(lane).includes(fields.cwd)) ?? live[0];
    if (chosen !== undefined) {
      const read = await dispatchOverLink(link, 'session.listModels', { appSessionId: chosen.session.state.app });
      const listed = read.ok ? record(read.value)?.models : undefined;
      if (Array.isArray(listed)) return validateCommandOutput('engine.models', { models: listed, source: 'live', at: new Date(now()).toISOString() }) as CommandResult<CommandName>;
      deps.log(`lane B: engine.models on ${link.name}: session.listModels of ${chosen.session.state.app} didn’t answer; the built-in list`);
    }
    return { ok: true, value: { models: [...BUILTIN_MODELS], source: 'builtin', at: null } } as CommandResult<CommandName>;
  }

  async function run(link: RemoteLink, name: CommandName, fields: Fields, ctx: MainContext): Promise<CommandResult<CommandName>> {
    const deadline = now() + timing.sendPendingMs;
    if (WATCH_COMMANDS.has(name)) return checkout.dispatch(link, name, fields, ctx);
    if (name === 'files.upload') return upload(link, fields);
    if (name === 'session.spawn') {
      // the tab it is made from (the envelope's session); a session it started is one this app spawned
      const result = await spawns.spawn(link, fields, ctx.session, ctx.client); // the page asking: an answer to a page gone isn't taken
      const output = result.ok ? (result.value as { status?: unknown; appSessionId?: unknown }) : null;
      if (output?.status === 'ok' && typeof output.appSessionId === 'string') {
        spawnedAt(''); // the sweep
        spawned.set(`${link.machine}\n${output.appSessionId}`, now());
      }
      return result;
    }
    if (name === 'attention.request') return dispatchOverLink(link, 'session.pendingRequest', { appSessionId: fields.appSessionId, requestId: fields.requestId });
    if (name === 'engine.models') return models(link, fields);
    if (name === 'files.read') return readFileInPages(link, fields, deps.log); // an answer past the channel, in ranged reads
    if (name === 'session.events') {
      const app = String(fields.appSessionId);
      return readEventsInPages(link, fields, {
        budget: peerLists(link, 'rl2.events-budget'), // P5 O7 M4: the architect's ruling, the field only to a peer that reads it
        launch: () => lanesOf(link).get(app)?.session.state.launch ?? null,
        gap: (launchId, at) => deps.emit(link.machine, 'remote.gap', { appSessionId: app as EventPayload<'remote.gap'>['appSessionId'], launchId, at }),
        tooLarge: (window) => deps.emit(link.machine, 'remote.historyTooLarge', { appSessionId: app as EventPayload<'remote.historyTooLarge'>['appSessionId'], window }),
        log: deps.log,
      });
    }
    if (MACHINE_ACTS.has(name)) return machineAct(link, name, fields, deadline);
    const lane = lanesOf(link).get(String(fields.appSessionId));
    if (lane === undefined || !lane.open) return failure('internal', `${name}: ${NOT_OPEN}`, { refusal: 'not-open' });
    if (SENDS.has(name)) return send(link, lane, name, fields);
    return engineAct(link, lane, name, fields, deadline);
  }

  return {
    handles: (name) => ENGINE_HOST_ACTS.has(name) || MACHINE_ACTS.has(name) || SUBSTITUTES.has(name) || PAGED_READS.has(name) || WATCH_COMMANDS.has(name),
    async dispatch(link, name, input, ctx) {
      try {
        return await run(link, name, record(input) ?? {}, ctx);
      } catch (error) {
        deps.log(`lane B: ${name} for ${link.name} failed: ${(error as Error).message}`);
        return failure('internal', (error as Error).message);
      }
    },
    refresh: () => interest.refresh(),
    spawnsKept: () => spawns.kept(),
    replay(machine, app) {
      const lane = machines.get(machine)?.lanes.get(app);
      if (lane?.open === true) lane.session.replay();
    },
    stop() {
      interest.stop();
      offRemote();
      checkout.stop();
      spawns.stop();
      spawned.clear();
      for (const { lanes } of machines.values()) for (const lane of lanes.values()) lane.session.stop();
      machines.clear();
    },
  };
}
