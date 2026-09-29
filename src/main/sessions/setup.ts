// The setup runner (C10 execution document, Interfaces "Session service", the setup state machine and Rollback): one
// async function per setup, shaped by the table (`worktree` → `trusting` → `launching` → `binding` → `ready`, or
// `failed` with a per-resource rollback), driven by a watch that resolves on the launch's status or exit events. The
// service's guards have already passed and answered `starting`; everything here streams as `session.setup`.
//
// Invariants: the intent is written before each effect it records and the moment C3 answers (`progress.launch` at
// `launching`, `progress.send` at the handoff), so a crash leaves `progress` truthful for the start-time
// reconciliation; `session.launch` answering `launching` is the linearisation point after which the process is C3's to
// report; rollback is per resource, never forced, and never a transcript.
import { randomUUID } from 'node:crypto';
import type { AppSessionId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { FirstMessage, Location, SetupIntent } from '@shared/sessions/intent';
import type { SetupEvent, SetupPhase, SetupResources } from '@shared/sessions/setup';
import type { StartOptions } from '@shared/ipc/schema/session';
import type { GitRun } from '../git/runner';
import { WorktreeAddFailed, type WorktreeService } from '../git/worktrees';
import type { SessionStore } from '../index/sessions';
import type { HostDispatch } from '../ipc/router';
import { attachCommand, bgRefusalOf } from './attach';
import { hostCall, pathExists, realOrSelf, reservationOf, transcriptPathOf, type Emit, type HostEvents } from './context';
import { canonicalPath } from './holders';
import { newWorktreeTarget } from './intent-rules';
import type { BootstrapNotes, IntentStore } from './intents';
import { bootstrapSpec, intentLaunchSpec, resumeLaunchSpec, trustMapping, type C10Settings } from './launch-mapping';
import type { ReplaySeam } from './replay-seam';
import { trustStateOf } from './trust';

// The service's dependencies, resolved (the engine's environment in hand).
export interface Setup {
  sessions: SessionStore;
  dispatch: HostDispatch;
  onEvent: HostEvents;
  worktrees: WorktreeService;
  git: GitRun;
  intents: IntentStore;
  bootstraps: BootstrapNotes;
  emit: Emit;
  env: NodeJS.ProcessEnv;
  replay: ReplaySeam | null;
  settings: () => C10Settings;
  now: () => string;
  log: (message: string) => void;
  watchdogMs: number;
  stopWaitMs: number;
  watches: Set<LaunchWatch>; // halted when the service is disposed
}

// ---- failures ------------------------------------------------------------------------------------------------------

export class SetupFailure extends Error {
  constructor(
    readonly phase: SetupPhase,
    message: string,
  ) {
    super(message);
    this.name = 'SetupFailure';
  }
}

// A launch that reported nothing for the watchdog's span (C3's own initialize deadline is shorter, so this is the host
// itself not answering): the process, if any, is stopped.
class WatchdogFailure extends SetupFailure {
  constructor() {
    super('launching', 'no answer from the engine host');
  }
}

class RelayFailure extends Error {
  constructor(readonly health: RelayHealth) {
    super(`relay unreachable: ${health.error ?? `status ${health.status ?? 'none'}`}`);
  }
}

// The engine's own refusal to resume a session a `--bg` job holds (authoritative over MAWS's holder read).
class HeldFailure extends Error {
  constructor(
    readonly jobId: string | null,
    text: string,
  ) {
    super(text);
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---- the launch watch ----------------------------------------------------------------------------------------------

export type LaunchEnd = { kind: 'ready'; status: EngineSessionStatus } | { kind: 'exited'; errors: string[] } | { kind: 'timeout' };

// One launch's statuses and exit, from the moment before `session.launch` (so nothing it reports is missed). The
// watchdog restarts at every status: a launch that reports nothing for `watchdogMs` has timed out.
export class LaunchWatch {
  private last: EngineSessionStatus | null = null;
  private exited = false;
  private halted = false;
  private readonly errors: string[] = [];
  private readonly offs: (() => void)[];
  private wake: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly s: Setup,
    readonly appSessionId: AppSessionId,
  ) {
    s.watches.add(this);
    this.offs = [
      s.onEvent('session.status', ({ appSessionId: id, status }) => {
        if (id !== appSessionId) return;
        this.last = status;
        if (status.process === 'exited' || status.exit !== null) this.exited = true;
        this.poke();
      }),
      s.onEvent('session.eventBatch', ({ appSessionId: id, events }) => {
        if (id !== appSessionId) return;
        for (const event of events) {
          if (event.kind === 'error.raised' && event.scope === 'process') this.errors.push(event.message);
          if (event.kind === 'process.exited') this.exited = true;
        }
        this.poke();
      }),
    ];
  }

  async untilReady(): Promise<LaunchEnd> {
    for (;;) {
      if (this.exited) return { kind: 'exited', errors: await this.exitErrors() };
      if (this.last?.process === 'ready') return { kind: 'ready', status: this.last };
      if (await this.nextChange(this.s.watchdogMs)) return { kind: 'timeout' };
    }
  }

  // Whether the process exits within `ms`.
  async untilExit(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (this.exited) return true;
      const left = deadline - Date.now();
      if (left <= 0 || (await this.nextChange(left))) return this.exited;
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.s.watches.delete(this);
  }

  // The service was disposed (tests restart the app over the same disk): nothing here resolves again.
  halt(): void {
    this.halted = true;
    if (this.timer) clearTimeout(this.timer);
    this.dispose();
  }

  private poke(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  // Resolves true on timeout, false on a change; never while halted.
  private nextChange(ms: number): Promise<boolean> {
    if (this.halted) return new Promise(() => {});
    return new Promise((resolve) => {
      this.timer = setTimeout(() => {
        this.wake = null;
        if (!this.halted) resolve(true);
      }, ms);
      this.wake = () => {
        if (this.timer) clearTimeout(this.timer);
        if (!this.halted) resolve(false);
      };
    });
  }

  // The process-scope errors the exit came with: C3 batches events, so a snapshot of the session's ring fills in what
  // the batch has not delivered yet.
  private async exitErrors(): Promise<string[]> {
    if (this.errors.length > 0) return this.errors;
    try {
      const snapshot = await hostCall(this.s.dispatch, 'session.events', { appSessionId: this.appSessionId, afterSeq: null, limit: null });
      for (const event of snapshot.events) if (event.kind === 'error.raised' && event.scope === 'process') this.errors.push(event.message);
    } catch {
      // nothing more to learn
    }
    return this.errors;
  }
}

// ---- small steps ---------------------------------------------------------------------------------------------------

function setupEvent(s: Setup, appSessionId: AppSessionId, phase: SetupPhase, detail: string | null, outcome: SetupEvent['outcome'] = null): void {
  s.emit('session.setup', { appSessionId, phase, detail, outcome });
}

// The next replay fixture, or null without the seam; a spent list refuses the launch.
function takeReplay(s: Setup, phase: SetupPhase): { path: string; sessionId: SessionId } | null {
  if (s.replay === null) return null;
  const fixture = s.replay.take();
  if (fixture === null) throw new SetupFailure(phase, 'replay_disabled: MAWS_E2E_REPLAY_FIXTURES has no fixture left for this launch');
  return fixture;
}

async function stopQuietly(s: Setup, appSessionId: AppSessionId): Promise<void> {
  try {
    if ((await reservationOf(s.dispatch, appSessionId)) !== null) await hostCall(s.dispatch, 'session.stop', { appSessionId, reason: 'stop' });
  } catch (error) {
    s.log(`could not stop ${appSessionId}: ${messageOf(error)}`);
  }
}

function exitFailure(errors: string[]): Error {
  const text = errors.join('\n');
  const refusal = bgRefusalOf(text);
  if (refusal) return new HeldFailure(refusal.jobId, text);
  return new SetupFailure('launching', text.trim() === '' ? 'the engine exited before it was ready' : `the engine exited before it was ready: ${text.trim()}`);
}

async function heldOutcome(s: Setup, failure: HeldFailure): Promise<Extract<NonNullable<SetupEvent['outcome']>, { kind: 'held' }>> {
  let attach: { jobId: string; command: string } | null = null;
  if (failure.jobId !== null) {
    const binary = await hostCall(s.dispatch, 'engine.binaryInfo', undefined).catch(() => null);
    if (binary) attach = { jobId: failure.jobId, command: attachCommand(binary.path, failure.jobId) };
  }
  return { kind: 'held', holder: { kind: 'background_job', pid: null, jobId: failure.jobId }, attach };
}

// The newest user message the launched session reports, for a fork's rewind (C3 passes it as the human's last seen).
async function newestUserUuid(s: Setup, appSessionId: AppSessionId): Promise<MessageUuid | null> {
  const snapshot = await hostCall(s.dispatch, 'session.events', { appSessionId, afterSeq: null, limit: null }).catch(() => null);
  const users = (snapshot?.events ?? []).filter((e) => e.kind === 'user.message' && e.messageUuid !== null && !e.isSynthetic);
  const last = users.at(-1);
  return last && last.kind === 'user.message' ? last.messageUuid : null;
}

// Tells the session its launch fell back to the direct route (C11's `relayUnreachable: 'direct'`).
function directFallbackNotice(s: Setup, appSessionId: AppSessionId, sessionId: SessionId | null): void {
  s.emit('session.eventBatch', {
    appSessionId,
    events: [
      {
        id: `${appSessionId}:c10:relay-fallback:${randomUUID()}`, sessionId: sessionId ?? 'unknown', at: s.now(), seq: null, agentId: null, parentToolUseId: null,
        kind: 'notice.posted', level: 'warning', key: 'relay:direct_fallback', text: 'The relay was unreachable, so this session started on the direct route.',
      },
    ],
  } as never);
}

// ---- the trust bootstrap -------------------------------------------------------------------------------------------

export interface BootstrapNote {
  put(bootstrapId: AppSessionId, at: string): Promise<void>;
  clear(bootstrapId: AppSessionId): Promise<void>;
}

// An initialize-only, attested launch under a bootstrap id of its own, confirmed by `workspace_trust_recorded: true`,
// stopped and forgotten, so the real launch reads the recorded trust at its own launch (Trust, "Trust bootstrap").
export async function runBootstrap(
  s: Setup,
  appSessionId: AppSessionId,
  input: { cwd: string; additionalDirectories: readonly string[]; gateway: 'gateway' | 'direct'; trustKey: string; note: BootstrapNote },
): Promise<void> {
  const bootstrapId = randomUUID() as AppSessionId;
  await input.note.put(bootstrapId, s.now());
  setupEvent(s, appSessionId, 'trusting', `Trusting ${input.trustKey}`);
  const fixture = takeReplay(s, 'trusting');
  const spec = bootstrapSpec({ bootstrapId, cwd: input.cwd, additionalDirectories: input.additionalDirectories, gateway: input.gateway, trustKey: input.trustKey, replay: fixture?.path ?? null }, s.settings());
  if (fixture) spec.sessionId = fixture.sessionId; // under replay every launch carries its fixture's pin
  const watch = new LaunchWatch(s, bootstrapId);
  const forget = async () => {
    try {
      await hostCall(s.dispatch, 'session.forget', { appSessionId: bootstrapId });
      await input.note.clear(bootstrapId);
    } catch (error) {
      s.log(`the trust bootstrap ${bootstrapId} is not forgotten yet: ${messageOf(error)}`);
    }
  };
  try {
    const answer = await hostCall(s.dispatch, 'session.launch', { spec });
    if (answer.status === 'relay_unreachable') {
      await forget();
      throw new RelayFailure(answer.health);
    }
    if (answer.status === 'refused') {
      await forget();
      throw new SetupFailure('trusting', `the trust bootstrap was refused: ${answer.reason}: ${answer.message}`);
    }
    const end = await watch.untilReady();
    if (end.kind !== 'ready') {
      if (end.kind === 'timeout') await stopQuietly(s, bootstrapId);
      if (end.kind === 'exited' || (await watch.untilExit(s.stopWaitMs))) await forget();
      const failure = end.kind === 'exited' ? exitFailure(end.errors) : new SetupFailure('trusting', 'no answer from the engine host');
      throw failure instanceof SetupFailure ? new SetupFailure('trusting', `the trust bootstrap failed: ${failure.message}`) : failure;
    }
    const { recorded } = end.status.trust;
    const engineId = end.status.engineSessionId;
    const stop = await hostCall(s.dispatch, 'session.stop', { appSessionId: bootstrapId, reason: 'stop' });
    if (!stop.exited && !(await watch.untilExit(s.stopWaitMs))) {
      throw new SetupFailure('trusting', `the trust bootstrap did not stop within ${Math.round(s.stopWaitMs / 1000)} s`); // its id stays noted
    }
    await forget();
    if (recorded !== true) throw new SetupFailure('trusting', `the engine did not record trust for ${input.trustKey}`);
    setupEvent(s, appSessionId, 'trusting', `Trust recorded for ${input.trustKey} (bootstrap ${engineId ?? spec.sessionId ?? 'unknown'})`);
  } finally {
    watch.dispose();
  }
}

// ---- an intent's setup ---------------------------------------------------------------------------------------------

// The intent as the run sees it: re-read, patched and persisted, published on every write (the renderer's store holds
// the progress a tab shows).
class IntentRun {
  phase: SetupPhase = 'worktree';

  constructor(
    private readonly s: Setup,
    readonly appSessionId: AppSessionId,
  ) {}

  get intent(): SetupIntent {
    const intent = this.s.intents.get(this.appSessionId);
    if (intent === null) throw new Error(`no setup intent for ${this.appSessionId}`);
    return intent;
  }

  async progress(patch: Partial<SetupIntent['progress']>, rest: Partial<SetupIntent> = {}): Promise<SetupIntent> {
    const intent = this.intent;
    const next: SetupIntent = { ...intent, ...rest, updatedAt: this.s.now(), progress: { ...intent.progress, ...patch } };
    await this.s.intents.put(next);
    this.s.emit('session.intent.changed', { appSessionId: this.appSessionId, intent: next });
    return next;
  }

  event(phase: SetupPhase, detail: string | null, outcome: SetupEvent['outcome'] = null): void {
    if (phase !== 'ready' && phase !== 'failed') this.phase = phase;
    setupEvent(this.s, this.appSessionId, phase, detail, outcome);
  }
}

export interface IntentAttempt {
  gateway: 'gateway' | 'direct'; // the intent's, or `direct` for this attempt when the relay was down and settings say so
  directFallback: boolean;
}

export async function runIntentSetup(s: Setup, appSessionId: AppSessionId, attempt: IntentAttempt): Promise<void> {
  const run = new IntentRun(s, appSessionId);
  let cwd: string | null = null;
  let watch: LaunchWatch | null = null;
  try {
    // worktree
    const location = run.intent.location;
    let worktree: SessionRecord['worktree'] = null;
    if (location.kind === 'newWorktree') {
      if (run.intent.progress.worktree === null) {
        run.event('worktree', `Creating worktree ${location.name}`);
        let info;
        try {
          info = await s.worktrees.add({ repoRoot: location.repoRoot, name: location.name, branch: location.branch });
        } catch (error) {
          // only git's own `worktree add` can have created something; a refusal before it (`worktree path exists`,
          // `branch exists`) names what someone else made, which is never read back as this attempt's
          if (error instanceof WorktreeAddFailed) await recordPartialWorktree(s, run, location);
          throw new SetupFailure('worktree', messageOf(error));
        }
        await run.progress({ worktree: { path: info.path, branch: info.branch, head: info.head, createdHere: true } });
      }
      const w = run.intent.progress.worktree!;
      cwd = w.path;
      worktree = { path: w.path, branch: w.branch };
    } else if (location.kind === 'existingWorktree') {
      const listed = await s.worktrees.list(location.repoRoot);
      const path = await canonicalPath(location.path);
      const entry = listed.worktrees.find((w) => w.path === path);
      if (!entry) throw new SetupFailure('worktree', `not a worktree of ${listed.repoRoot}: ${location.path}`);
      await run.progress({ worktree: { path: entry.path, branch: entry.branch, head: entry.head, createdHere: false } });
      cwd = entry.path;
      worktree = { path: entry.path, branch: entry.branch };
    } else {
      cwd = await realOrSelf(location.path);
    }

    // trusting
    run.phase = 'trusting';
    const trust = await trustStateOf(cwd, { git: s.git, env: s.env });
    const intent = run.intent;
    const mapping = trustMapping({ decision: intent.trust, decisionKey: intent.trustKey, trustRecorded: intent.progress.trustRecorded }, trust);
    if (mapping.bootstrap) {
      await runBootstrap(s, appSessionId, {
        cwd,
        additionalDirectories: intent.additionalDirectories,
        gateway: attempt.gateway,
        trustKey: trust.trustKey,
        note: { put: async (id, at) => void (await run.progress({ bootstrap: { appSessionId: id, at } })), clear: async () => void (await run.progress({ bootstrap: null })) },
      });
      await run.progress({ trustRecorded: true });
    }

    // launching: the record first (the pane swaps to it; attention is kept only for a recorded id), then C3's launch
    run.phase = 'launching';
    const mode = intent.permissionMode ?? 'default';
    const created = s.sessions.createForLaunch({
      appSessionId,
      directory: cwd,
      additionalDirectories: [...new Set(intent.additionalDirectories)],
      worktree,
      model: { requested: intent.model, resolved: null },
      effort: intent.effort,
      permissionMode: { requested: mode, effective: mode, refusal: null },
    });
    if (!created.ok) s.log(`a record already exists under ${appSessionId}; the launch reuses it`);
    run.event('launching', 'Starting');
    const fixture = takeReplay(s, 'launching');
    if (fixture) await run.progress({ engineSessionId: fixture.sessionId });
    const spec = intentLaunchSpec({ ...run.intent, gateway: attempt.gateway }, { cwd, trust: mapping.attestation, replay: fixture?.path ?? null }, s.settings());
    watch = new LaunchWatch(s, appSessionId);
    const answer = await hostCall(s.dispatch, 'session.launch', { spec });
    if (answer.status === 'relay_unreachable') throw new RelayFailure(answer.health);
    if (answer.status === 'refused') throw new SetupFailure('launching', `${answer.reason}: ${answer.message}`);
    await run.progress({ launch: { launchId: answer.session.launchId, at: s.now() } });
    if (attempt.directFallback) directFallbackNotice(s, appSessionId, run.intent.progress.engineSessionId);
    const end = await watch.untilReady();
    if (end.kind === 'timeout') throw new WatchdogFailure();
    if (end.kind === 'exited') throw exitFailure(end.errors);

    // binding
    const bound = run.intent;
    const engineSessionId = end.status.engineSessionId ?? bound.progress.engineSessionId!;
    const rewindTo = bound.kind === 'fork' ? (bound.source?.rewindTo ?? null) : null;
    if (rewindTo !== null) {
      const lastSeen = (await newestUserUuid(s, appSessionId)) ?? rewindTo;
      const rewound = await hostCall(s.dispatch, 'session.rewind', { appSessionId, targetMessageUuid: rewindTo, lastSeenMessageUuid: lastSeen, files: false });
      if (!rewound.rewound) throw new SetupFailure('launching', `the fork could not rewind to ${rewindTo}: ${rewound.reason ?? rewound.error ?? 'refused'}`);
    }
    let firstTurn: 'sent' | 'queued' | 'none' = 'none';
    if (bound.message !== null) {
      const sent = await hostCall(s.dispatch, 'session.send', { appSessionId, content: bound.message.content });
      // the handoff: from this write the message is C3's and is never sent again, whatever happens next
      await run.progress({ send: { queueId: sent.queueId, messageUuid: sent.messageUuid, disposition: sent.disposition, at: s.now() } });
      firstTurn = sent.disposition;
    }
    await finishBinding(s, run, bound, engineSessionId, firstTurn);
  } catch (error) {
    await rollbackIntent(s, run, cwd, error);
  } finally {
    watch?.dispose();
  }
}

// After the handoff nothing is rolled back: a fork titled by the human gets its `(fork)` name through the engine, the
// intent goes, and `ready` is told. A failure here is logged (the next start's reconciliation drops a leftover intent).
async function finishBinding(s: Setup, run: IntentRun, intent: SetupIntent, engineSessionId: SessionId, firstTurn: 'sent' | 'queued' | 'none'): Promise<void> {
  const { appSessionId } = run;
  if (intent.kind === 'fork' && intent.source !== null) {
    const title = s.sessions.get(intent.source.appSessionId)?.title;
    if (title?.source === 'user' && title.text !== '') {
      await hostCall(s.dispatch, 'session.renameSession', { appSessionId, title: `${title.text} (fork)` }).catch((error: unknown) => s.log(`the fork ${appSessionId} kept the engine's title: ${messageOf(error)}`));
    }
  }
  try {
    await s.intents.remove(appSessionId);
  } catch (error) {
    s.log(`the intent of ${appSessionId} could not be removed: ${messageOf(error)}`);
  }
  run.event('ready', null, { kind: 'ready', engineSessionId, firstTurn });
  s.emit('session.intent.changed', { appSessionId, intent: null });
}

// `git worktree add` threw: with `-b` git creates the branch before the checkout, and a failing post-checkout hook
// leaves the checkout, so what this attempt created is read back from git and recorded, for rollback to undo.
async function recordPartialWorktree(s: Setup, run: IntentRun, location: Extract<Location, { kind: 'newWorktree' }>): Promise<void> {
  try {
    const target = await newWorktreeTarget(s, location);
    const path = await canonicalPath(target.path);
    const entry = (await s.worktrees.list(target.root)).worktrees.find((w) => w.path === path);
    if (entry) {
      await run.progress({ worktree: { path: entry.path, branch: entry.branch, head: entry.head, createdHere: true } });
      return;
    }
    if (location.branch.kind !== 'new') return; // an existing branch is never this attempt's
    const branch = await s.worktrees.branch(target.root, location.branch.name);
    if (branch) await run.progress({ worktree: { path, branch: branch.branch, head: branch.head, createdHere: true } });
  } catch (error) {
    s.log(`could not read back what the failed worktree add left for ${run.appSessionId}: ${messageOf(error)}`);
  }
}

// ---- rollback ------------------------------------------------------------------------------------------------------

type WorktreeResource = NonNullable<SetupResources['worktree']>;

function keptWorktree(w: NonNullable<SetupIntent['progress']['worktree']>, newBranch: boolean, detail: string | null = null): WorktreeResource {
  return { path: w.path, branch: w.branch, createdHere: w.createdHere, state: 'kept', detail, branchState: w.createdHere && newBranch ? 'kept' : 'none' };
}

function createdNewBranch(intent: SetupIntent): boolean {
  return intent.location.kind === 'newWorktree' && intent.location.branch.kind === 'new';
}

// A checkout this attempt created: removed only when clean (or with the human's acknowledged discard), then its
// attempt-created branch deleted only when it has no commits the removal did not expect. `removed` tells the caller to
// clear `progress.worktree`, so the next attempt creates afresh under the initial rules.
export async function removeCreatedWorktree(
  s: Pick<Setup, 'worktrees'>,
  repoRoot: string,
  w: NonNullable<SetupIntent['progress']['worktree']>,
  opts: { newBranch: boolean; discard: boolean },
): Promise<{ resource: WorktreeResource; removed: boolean }> {
  const resource: WorktreeResource = { path: w.path, branch: w.branch, createdHere: true, state: 'removed', detail: null, branchState: 'none' };
  let expect = { branch: w.branch, head: w.head };
  if (opts.discard) {
    // the human acknowledged the checkout as it is now: its identity is revalidated against git's current answer
    const now = await s.worktrees.status(repoRoot, w.path);
    if (now !== null && now.branch === w.branch) expect = { branch: now.branch, head: now.head };
  }
  try {
    const removal = await s.worktrees.remove({ repoRoot, path: w.path, expect, discard: opts.discard });
    if ('refused' in removal && removal.refused !== 'missing') {
      return { resource: { ...resource, state: 'remove_refused', detail: `${removal.refused}: ${removal.detail}`, branchState: opts.newBranch ? 'kept' : 'none' }, removed: false };
    }
  } catch (error) {
    return { resource: { ...resource, state: 'remove_failed', detail: messageOf(error), branchState: opts.newBranch ? 'kept' : 'none' }, removed: false };
  }
  if (!opts.newBranch || w.branch === null) return { resource, removed: true };
  try {
    const deletion = await s.worktrees.deleteBranch({ repoRoot, branch: w.branch, expect: { head: w.head }, acknowledgeUnmerged: false });
    if ('deleted' in deletion) return { resource: { ...resource, branchState: 'deleted' }, removed: true };
    if (deletion.refused === 'missing') return { resource, removed: true };
    return { resource: { ...resource, branchState: 'delete_refused', detail: `${deletion.refused}: ${deletion.detail}` }, removed: true };
  } catch (error) {
    return { resource: { ...resource, branchState: 'delete_failed', detail: messageOf(error) }, removed: true };
  }
}

async function rollbackIntent(s: Setup, run: IntentRun, cwd: string | null, error: unknown): Promise<void> {
  const { appSessionId } = run;
  const phase = error instanceof SetupFailure ? error.phase : run.phase;
  const message = messageOf(error);
  if (!(error instanceof SetupFailure) && !(error instanceof RelayFailure) && !(error instanceof HeldFailure)) s.log(`setup of ${appSessionId} failed: ${message}`);
  try {
    await stopQuietly(s, appSessionId); // a process still running (a refused rewind or send, a watchdog) stops first
    const intent = run.intent;
    const p = intent.progress;
    const newBranch = createdNewBranch(intent);

    // (1) a launch that wrote a transcript under the pin has a conversation: kept and bound, never rolled back
    if (p.launch !== null && p.engineSessionId !== null && cwd !== null && (await pathExists(await transcriptPathOf(s.env, cwd, p.engineSessionId)))) {
      const record = s.sessions.get(appSessionId);
      // a record already bound to another id was rebound by a `/clear` in the first message: it stands as bound
      if (record !== null && record.engineSessionId === null) s.sessions.bindEngineId(appSessionId, p.engineSessionId);
      const resources: SetupResources = { worktree: p.worktree ? keptWorktree(p.worktree, newBranch) : null, record: 'kept', transcript: 'kept' };
      await s.intents.remove(appSessionId);
      run.event('failed', null, { kind: 'error', message, resources });
      s.emit('session.intent.changed', { appSessionId, intent: null });
      return;
    }

    // (2) the provisional record this attempt created
    let record: SetupResources['record'] = 'none';
    if (s.sessions.get(appSessionId) !== null) {
      s.sessions.remove(appSessionId);
      record = 'removed';
    }

    // (3) the worktree: kept on a relay failure (the retry reuses it); else a checkout created here is removed only
    // when clean, and an existing one is never touched
    let worktree: SetupResources['worktree'] = null;
    let clearWorktree = false;
    if (p.worktree !== null) {
      if (error instanceof RelayFailure || !p.worktree.createdHere) {
        worktree = keptWorktree(p.worktree, newBranch);
      } else {
        const repoRoot = intent.location.kind === 'directory' ? p.worktree.path : intent.location.repoRoot;
        const result = await removeCreatedWorktree(s, repoRoot, p.worktree, { newBranch, discard: false });
        worktree = result.resource;
        clearWorktree = result.removed;
      }
    }

    // (4) the store file and journal stay: they are the evidence of what failed (forgotten when the intent is discarded)
    const resources: SetupResources = { worktree, record, transcript: 'none' };
    await run.progress({ lastFailure: { at: s.now(), phase, message, resources }, ...(clearWorktree ? { worktree: null } : {}) });
    const outcome: SetupEvent['outcome'] =
      error instanceof RelayFailure ? { kind: 'relay_unreachable', health: error.health } : error instanceof HeldFailure ? await heldOutcome(s, error) : { kind: 'error', message, resources };
    run.event('failed', null, outcome);
  } catch (rollbackError) {
    s.log(`rollback of ${appSessionId} failed: ${messageOf(rollbackError)}`);
    run.event('failed', null, { kind: 'error', message: `${message}; rollback failed: ${messageOf(rollbackError)}`, resources: { worktree: null, record: 'kept', transcript: 'none' } });
  }
}

// ---- a record's resume ---------------------------------------------------------------------------------------------

export async function runResume(
  s: Setup,
  record: SessionRecord,
  input: { decision: 'accepted' | 'declined' | null; options: StartOptions; message: FirstMessage | null; onSent: () => void },
): Promise<void> {
  const appSessionId = record.appId;
  let watch: LaunchWatch | null = null;
  try {
    const trust = await trustStateOf(record.directory, { git: s.git, env: s.env });
    const attestation = input.decision === 'accepted' ? { accepted: true as const, directory: trust.trustKey } : null;
    const gateway = input.options.gateway ?? (record.gateway.routed === true ? 'gateway' : record.gateway.routed === false ? 'direct' : s.settings().gateway.defaultRoute);
    if (input.decision === 'accepted' && !trust.isHome && !trust.trusted) {
      // under a bootstrap id of its own, never the record's (whose statuses C4 would apply to the conversation)
      await runBootstrap(s, appSessionId, {
        cwd: record.directory,
        additionalDirectories: record.additionalDirectories,
        gateway,
        trustKey: trust.trustKey,
        note: { put: (bootstrapId, at) => s.bootstraps.put({ bootstrapId, appSessionId, at }), clear: (bootstrapId) => s.bootstraps.remove(bootstrapId) },
      });
    }
    setupEvent(s, appSessionId, 'launching', 'Starting');
    // disk-to-live: C4's follower fed the exited session's tab from its transcript; C3's stream takes over
    if (record.engineSessionId !== null) {
      await hostCall(s.dispatch, 'fs.unfollow', { appSessionId, agentId: null }).catch((error: unknown) => {
        throw new SetupFailure('launching', `could not hand the transcript over to the live session: ${messageOf(error)}`);
      });
    }
    const fixture = takeReplay(s, 'launching');
    const spec = resumeLaunchSpec(record, input.options, { trust: attestation, replay: fixture?.path ?? null }, s.settings());
    watch = new LaunchWatch(s, appSessionId);
    const answer = await hostCall(s.dispatch, 'session.launch', { spec });
    if (answer.status === 'relay_unreachable') throw new RelayFailure(answer.health);
    if (answer.status === 'refused') throw new SetupFailure('launching', `${answer.reason}: ${answer.message}`);
    const end = await watch.untilReady();
    if (end.kind === 'timeout') throw new WatchdogFailure();
    if (end.kind === 'exited') throw exitFailure(end.errors);
    let firstTurn: 'sent' | 'queued' | 'none' = 'none';
    if (input.message !== null) {
      const sent = await hostCall(s.dispatch, 'session.send', { appSessionId, content: input.message.content });
      input.onSent();
      firstTurn = sent.disposition;
    }
    const engineSessionId = end.status.engineSessionId ?? record.engineSessionId ?? spec.sessionId;
    setupEvent(s, appSessionId, 'ready', null, { kind: 'ready', engineSessionId: engineSessionId as SessionId, firstTurn });
  } catch (error) {
    if (!(error instanceof SetupFailure) && !(error instanceof RelayFailure) && !(error instanceof HeldFailure)) s.log(`resume of ${appSessionId} failed: ${messageOf(error)}`);
    if (error instanceof WatchdogFailure) await stopQuietly(s, appSessionId);
    const transcript = record.engineSessionId !== null && (await pathExists(await transcriptPathOf(s.env, record.directory, record.engineSessionId)));
    const resources: SetupResources = { worktree: null, record: 'kept', transcript: transcript ? 'kept' : 'none' };
    const outcome: SetupEvent['outcome'] =
      error instanceof RelayFailure ? { kind: 'relay_unreachable', health: error.health } : error instanceof HeldFailure ? await heldOutcome(s, error) : { kind: 'error', message: messageOf(error), resources };
    setupEvent(s, appSessionId, 'failed', null, outcome);
  } finally {
    watch?.dispose();
  }
}
