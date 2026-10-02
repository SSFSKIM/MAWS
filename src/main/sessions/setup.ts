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
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { Location, SetupIntent } from '@shared/sessions/intent';
import type { SetupEvent, SetupPhase, SetupResources } from '@shared/sessions/setup';
import { WorktreeAddFailed } from '../git/worktrees';
import { hostCall, pathExists, realOrSelf, transcriptPathOf } from './context';
import { canonicalPath } from './holders';
import { newWorktreeTarget } from './intent-rules';
import { LaunchWatch } from './launch-watch';
import { bootstrapSpec, intentLaunchSpec, seedPermissionMode, trustMapping } from './launch-mapping';
import {
  directFallbackNotice,
  exitFailure,
  heldOutcome,
  HeldFailure,
  messageOf,
  newestUserUuid,
  RelayFailure,
  SetupFailure,
  setupEvent,
  stopQuietly,
  takeReplay,
  WatchdogFailure,
  type Setup,
} from './setup-steps';
import { trustStateOf } from './trust';

export { SetupFailure, type Setup } from './setup-steps';

// C12 start: main's custody gate (C12 execution document, Interfaces "Engine custody"). A refusal fails as a refused
// `session.launch` does, when a setup or a resume begins: no worktree, record, bootstrap, unfollow or spawn precedes it.
export async function passLaunchGate(s: Setup): Promise<void> {
  const refusal = await s.launchGate();
  if (refusal !== null) throw new SetupFailure('launching', `${refusal.reason}: ${refusal.message}`);
}
// C12 end

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
    await passLaunchGate(s); // C12: custody refuses before anything this setup would have to undo
    // worktree
    const location = run.intent.location!; // the start guards refused an intent with no location (New chat, 2026-10-01)
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
    const mode = intent.permissionMode ?? seedPermissionMode(await s.userDefaults()); // W3: an intent from before the seed
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
    const spec = intentLaunchSpec({ ...run.intent, permissionMode: mode, gateway: attempt.gateway }, { cwd, trust: mapping.attestation, replay: fixture?.path ?? null }, s.settings());
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

// The checkout an intent keeps, as the tab reports it (a relay failure, a launch that kept its transcript, a restart):
// kept, its branch kept when this intent made it.
export function retainedWorktree(intent: SetupIntent): WorktreeResource | null {
  const w = intent.progress.worktree;
  if (w === null) return null;
  return { path: w.path, branch: w.branch, createdHere: w.createdHere, state: 'kept', detail: null, branchState: w.createdHere && createdNewBranch(intent) ? 'kept' : 'none' };
}

function createdNewBranch(intent: SetupIntent): boolean {
  return intent.location?.kind === 'newWorktree' && intent.location.branch.kind === 'new';
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
      const resources: SetupResources = { worktree: retainedWorktree(intent), record: 'kept', transcript: 'kept' };
      await s.intents.remove(appSessionId);
      // the removal first: the renderer tells a failure without an intent as a record's (a toast; the session stays,
      // exited), and a failure told while it still held the intent would be hidden with the intent a moment later
      s.emit('session.intent.changed', { appSessionId, intent: null });
      run.event('failed', null, { kind: 'error', message, resources });
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
        worktree = retainedWorktree(intent);
      } else {
        const repoRoot = intent.location === null || intent.location.kind === 'directory' ? p.worktree.path : intent.location.repoRoot;
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
