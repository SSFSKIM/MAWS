// The session service (C10 execution document, Interfaces "Session service"; charter §3 "Sessions", D-16): main's owner
// of a session's lifecycle. An unstarted session is an app id with a persisted setup intent and no record; `start`
// runs its setup (worktree → trusting → launching → ready, `setup.ts`) or resumes a record; `fork`, `archive`,
// `remove` (delete conversation) and `rename` act on records; at app start every stale `self` holder is reset, stale
// bootstrap ids are forgotten and intents whose record exists are reconciled (`recovery.ts`), never re-run.
//
// A command answers synchronously only what is fast (its guards, or `starting`); everything that can take seconds
// streams as `session.setup`. MAWS's own lifecycle operations on one app id are serialised through a per-id lock, so
// two never interleave on one session. Guards never read `SessionRecord.holder`: "live in MAWS" is C3's process table
// and "foreign" a fresh registry read (holders.ts), which fails closed.
import { NO_USER_DEFAULTS } from '../settings/user-engine-defaults'; // W3
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppSessionId, MessageUuid, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { worktreeDirName } from '@shared/sessions/worktree';
import type { FirstMessage, ForkTarget, Location, SetupIntent, SetupIntentPatch } from '@shared/sessions/intent';
import type { SetupResources, StartOutcome } from '@shared/sessions/setup';
import type { TrustState } from '@shared/sessions/trust';
import type { ArchiveOutcome, DeleteOutcome, StartOptions } from '@shared/ipc/schema/session';
import { emptyProgress, HostError, hostCall, STOP_WAIT_MS, WATCHDOG_MS, type SessionServiceDeps } from './context';
import { DeletionManifests, type DeletionManifest } from './delete-manifest';
import { checkAdditionalDirectories, checkLocation, sessionDirectoryOf, trustDirectoryOf, type RuleVerdict } from './intent-rules';
import { readSettings, seedPermissionMode } from './launch-mapping';
import { archiveRecord, deleteRecord, forkIntentOf, previewDeletion, renameRecord, revealablePath } from './record-actions';
import { liveRows, markInterrupted, reconcileIntent, type LiveRows } from './recovery';
import { removeCreatedWorktree, retainedWorktree, type Setup } from './setup';
import { forkRefusal, guardIntentStart, guardResumeStart, sideThreadRefusal, type GuardContext, type Guarded } from './start-guards';
// E3 start
import { promotionMessage } from '@shared/anchor/message';
import type { ContentBlock } from '@shared/graph/events';
import type { Lineage } from '@shared/graph/session';
import { sendContentRefusal } from '@shared/engine/session-state-store';
import type { SideThreadFrom } from '@shared/ipc/schema/side';
import { commentContent, screenshotRoots, withoutScreenshot } from '../side/content';
import { InvalidSideInput } from '../side/invalid';
import { sendToMain, type SendToMainInput, type SendToMainOutput } from '../side/send-to-main';
// E3 end
import { trustKeyOf, trustStateOf } from './trust';
import { findPane, paneCall, readProcesses } from './pane-holder';
import { pauseTakeOver, until } from './pause-take-over';
import { holderAuthority } from './holders';
import { reservationOf } from './context';
import type { SetupEvent } from '@shared/sessions/setup';
import { releaseHolder, type TakeOverDeps } from './take-over'; // W7
import type { ForeignHolder } from '@shared/graph/session'; // W7
import type { TakeOverOutcome } from '@shared/ipc/schema/session'; // W7

// A refusal of an intent command, mapped to X2 by the registration: `invalid` is `invalid_input` naming the field;
// `starting`, `retained_worktree` and the rest are `internal` with this message.
export class IntentRefused extends Error {
  constructor(
    readonly reason: 'invalid' | 'starting' | 'retained_worktree' | 'unknown_intent' | 'no_retained_worktree',
    message: string,
    readonly field: string | null = null,
  ) {
    super(message);
    this.name = 'IntentRefused';
  }
}

export class SessionService {
  private setup: Setup | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly locks = new Map<string, Promise<void>>();
  private readonly starting = new Set<string>(); // ids with a start in flight (guards through the end of the setup)
  private readonly startingNames = new Set<string>(); // new-worktree directory names a start in flight holds (claimWorktreeName)
  private readonly resumeMessages = new Map<string, FirstMessage>(); // a resume's message, retained behind a card
  private readonly reconcileFailures = new Map<string, string>(); // ids whose start-time reconciliation failed
  // E10: the start-time recovery, deferred while the host's table cannot be read, re-run when the host streams again
  private recoveryDeferred = false;
  private recovering: Promise<void> | null = null;
  private offReady: (() => void) | null = null;
  private readonly manifests: DeletionManifests;
  private readonly now: () => string;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: SessionServiceDeps) {
    this.manifests = new DeletionManifests(join(deps.userData, 'sessions', 'deletions'));
    this.now = deps.now ?? (() => new Date().toISOString());
    this.log = deps.log ?? ((message) => console.warn(`[sessions] ${message}`));
  }

  // D-16 at start: every `self` holder is stale (C3 owns no process yet) and is reset before anything else, then the
  // intents load, stale bootstrap ids are forgotten, and intents whose record exists are reconciled. `intent.list` and
  // every command wait for it. E10: a row the supervisor kept is re-marked `self` by its status in the connect burst,
  // and the recovery reads the host's table first (`recover`).
  start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    try {
      const reset = this.deps.index.sessions.resetSelfHolders();
      if (reset > 0) this.log(`reset ${reset} stale self holder${reset === 1 ? '' : 's'} (D-16)`);
    } catch (error) {
      // an index this app cannot write (a newer app's, opened read-only) answers every call with its reason; the app runs on
      this.log(`the D-16 reset could not run: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.readyPromise = this.boot();
    return this.readyPromise;
  }

  // Stops listening and halts every watch in flight, leaving their setups where they are (the tests' app restart).
  dispose(): void {
    this.offReady?.();
    for (const watch of [...(this.setup?.watches ?? [])]) watch.halt();
  }

  private async boot(): Promise<void> {
    const env = await this.deps.env;
    this.setup = {
      sessions: this.deps.index.sessions,
      sideThreads: this.deps.index.sideThreads ?? null, // E3
      dispatch: this.deps.host.dispatch,
      onEvent: this.deps.host.onEvent,
      worktrees: this.deps.worktrees,
      git: this.deps.git,
      intents: this.deps.intents,
      bootstraps: this.deps.bootstraps,
      emit: this.deps.emit,
      env,
      replay: this.deps.replay ?? null,
      settings: this.deps.settings ?? readSettings,
      userDefaults: this.deps.userDefaults ?? (async () => NO_USER_DEFAULTS), // W3
      launchGate: this.deps.launchGate ?? (async () => null), // C12
      now: this.now,
      log: this.log,
      watchdogMs: this.deps.timing?.watchdogMs ?? WATCHDOG_MS,
      stopWaitMs: this.deps.timing?.stopWaitMs ?? STOP_WAIT_MS,
      watches: new Set(),
    };
    await this.deps.intents.load();
    await this.deps.host.ready?.();
    for (const manifest of await this.manifests.list()) {
      this.log(`a deletion of ${manifest.appSessionId} was interrupted (${manifest.trashed.length} of ${manifest.paths.length} moved); session.delete finishes it`);
    }
    this.offReady = this.deps.host.onReady?.(() => {
      if (!this.recoveryDeferred || this.recovering !== null) return;
      this.recovering = this.recover()
        .catch((error: unknown) => this.log(`the deferred recovery failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => (this.recovering = null));
    }) ?? null;
    await this.recover();
  }

  // The start-time recovery (recovery.ts). E10: it reads the host's live rows first; when `engine.sessions` cannot be
  // answered (a host crashed, waiting on an incompatible supervisor or held by a lock), a kept session may be live where
  // main cannot see it, so none of the steps runs (nothing marked failed, no record removed, no bootstrap forgotten)
  // and the recovery runs again the next time the host streams. A re-run passes over ids with a start in flight.
  private async recover(): Promise<void> {
    let live: LiveRows;
    try {
      live = await liveRows(this.deps.host.dispatch);
    } catch (error) {
      this.recoveryDeferred = true;
      this.log(`recovery waits for the engine host (engine.sessions: ${error instanceof Error ? error.message : String(error)}); nothing is failed, removed or forgotten until it answers`);
      return;
    }
    this.recoveryDeferred = false;
    const settled = () => this.deps.intents.list().filter((intent) => !this.starting.has(intent.appSessionId));
    // a start the quit cut short before any record is marked failed, so its tab offers Retry (recovery.ts)
    for (const intent of settled()) {
      await markInterrupted(this.s, intent).catch((error: unknown) => this.log(`${intent.appSessionId}: could not mark the interrupted start: ${error instanceof Error ? error.message : String(error)}`));
    }
    // every bootstrap id a previous run left is forgotten; one whose row is live is stopped first (nothing drives it)
    for (const intent of settled()) {
      const bootstrap = intent.progress.bootstrap;
      if (bootstrap === null) continue;
      if (await this.retireBootstrap(bootstrap.appSessionId, live)) await this.putIntent({ ...intent, progress: { ...intent.progress, bootstrap: null } });
    }
    for (const note of await this.deps.bootstraps.list()) {
      if (this.starting.has(note.appSessionId)) continue;
      if (await this.retireBootstrap(note.bootstrapId, live)) await this.deps.bootstraps.remove(note.bootstrapId);
    }
    for (const intent of settled()) await this.reconcileOne(intent, live);
  }

  // A bootstrap id a previous run left: forgotten, after a stop when its row is live (a trust bootstrap the supervisor
  // kept running through a keep-quit). False (logged) when the host refuses or cannot answer; the id stays noted.
  private async retireBootstrap(bootstrapId: AppSessionId, live: LiveRows): Promise<boolean> {
    if (live.has(bootstrapId)) {
      try {
        await hostCall(this.deps.host.dispatch, 'session.stop', { appSessionId: bootstrapId, reason: 'stop' });
      } catch (error) {
        this.log(`could not stop the bootstrap ${bootstrapId}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }
    return this.forgetQuietly(bootstrapId);
  }

  private get s(): Setup {
    if (this.setup === null) throw new Error('the session service has not started');
    return this.setup;
  }

  private async ready(): Promise<Setup> {
    await (this.readyPromise ?? this.start());
    await this.recovering; // E10: a deferred recovery the host's return started
    return this.s;
  }

  // ---- serialisation ---------------------------------------------------------------------------------------------

  private async lock(id: string): Promise<() => void> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => held);
    this.locks.set(id, tail);
    await previous;
    return () => {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    };
  }

  private async serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.lock(id);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // ---- intents ----------------------------------------------------------------------------------------------------

  private async putIntent(intent: SetupIntent): Promise<SetupIntent> {
    await this.deps.intents.put(intent);
    this.deps.emit('session.intent.changed', { appSessionId: intent.appSessionId, intent });
    return intent;
  }

  private intentOf(appSessionId: AppSessionId): SetupIntent {
    const intent = this.deps.intents.get(appSessionId);
    if (intent === null) throw new IntentRefused('unknown_intent', `no setup intent for ${appSessionId}`);
    return intent;
  }

  private refuseWhileStarting(appSessionId: AppSessionId): void {
    if (this.starting.has(appSessionId)) throw new IntentRefused('starting', `starting: a start is in flight for ${appSessionId}`);
  }

  async listIntents(): Promise<SetupIntent[]> {
    await this.ready();
    return this.deps.intents.list();
  }

  async getIntent(appSessionId: AppSessionId): Promise<SetupIntent | null> {
    await this.ready();
    return this.deps.intents.get(appSessionId);
  }

  // `session.create`: an app id and a persisted intent; no process, no record, no row. With neither a project nor a
  // location it is a New chat (2026-10-01): no location until the composer's project picker patches one in.
  async create(req: { projectId: ProjectId | null; location: Location | null }): Promise<{ appSessionId: AppSessionId; intent: SetupIntent }> {
    const s = await this.ready();
    const appSessionId = randomUUID() as AppSessionId;
    const now = this.now();
    const location = req.location ?? this.projectLocation(req.projectId);
    const intent: SetupIntent = {
      appSessionId,
      projectId: location === null ? null : req.projectId,
      createdAt: now,
      updatedAt: now,
      kind: 'create',
      source: null,
      location,
      additionalDirectories: [],
      model: null,
      effort: null,
      permissionMode: seedPermissionMode(await s.userDefaults()), // W3: the user's defaultMode, else auto
      gateway: s.settings().gateway.defaultRoute,
      trust: 'unanswered',
      trustKey: null,
      message: null,
      draft: null,
      progress: emptyProgress(),
    };
    await this.putIntent(intent);
    return { appSessionId, intent };
  }

  // The project's directory as a location; none for no project or an unknown one (the New chat's project picker asks).
  private projectLocation(projectId: ProjectId | null): Location | null {
    const project = projectId === null ? undefined : this.knownProject(projectId);
    return project ? { kind: 'directory', path: project.directory } : null;
  }

  private knownProject(projectId: ProjectId) {
    return this.deps.index.projects.list({ includeHidden: true }).find((p) => p.id === projectId);
  }

  // The location a project choice moves a New chat to when the patch names none: the project's directory, or for
  // "Don't work in a project" (null) the home directory the engine receives, whose session lists under Other sessions.
  private projectChoiceLocation(projectId: ProjectId | null): Location {
    if (projectId === null) return { kind: 'directory', path: this.s.env.HOME ?? homedir() };
    const location = this.projectLocation(projectId);
    if (location === null) throw new IntentRefused('invalid', `projectId: unknown project ${projectId}`, 'projectId');
    return location;
  }

  // `session.intent.patch`: the changed fields validated; a location change re-binds the trust decision to its key.
  // New chat: the project chip patches `projectId`, alone (the location follows it) or with a location; a project
  // must be one the index knows.
  async patch(appSessionId: AppSessionId, requested: SetupIntentPatch): Promise<SetupIntent> {
    this.refuseWhileStarting(appSessionId);
    return this.serial(appSessionId, async () => {
      const s = await this.ready();
      const intent = this.intentOf(appSessionId);
      this.refuseWhileStarting(appSessionId);
      if (requested.projectId != null && this.knownProject(requested.projectId) === undefined) {
        throw new IntentRefused('invalid', `projectId: unknown project ${requested.projectId}`, 'projectId');
      }
      const patch = requested.projectId !== undefined && requested.location === undefined ? { ...requested, location: this.projectChoiceLocation(requested.projectId) } : requested;
      if (patch.location !== undefined && intent.progress.worktree?.createdHere) {
        throw new IntentRefused('retained_worktree', `retained_worktree: the failed attempt's worktree ${intent.progress.worktree.path} is kept; discard it or keep it first`);
      }
      let next: SetupIntent = { ...intent, ...patch, updatedAt: this.now() };
      if (patch.location !== undefined) {
        this.rule(await checkLocation(s, next, { forStart: false }));
        if (intent.progress.worktree !== null) next = { ...next, progress: { ...next.progress, worktree: null } }; // an existing worktree's note: the next start re-reads it
      }
      if (patch.location !== undefined || patch.additionalDirectories !== undefined) {
        this.rule(await checkAdditionalDirectories(next, next.location === null ? null : await sessionDirectoryOf(s, next.location)));
      }
      next = await this.bindTrust(next, patch.location !== undefined, patch.trust);
      return this.putIntent(next);
    });
  }

  private rule(verdict: RuleVerdict): void {
    if (verdict.ok) return;
    if (verdict.kind === 'invalid') throw new IntentRefused('invalid', `${verdict.field}: ${verdict.message}`, verdict.field);
    throw new IntentRefused('invalid', `location: directory not found: ${verdict.directory}`, 'location');
  }

  // A decision answers one trust key: when the effective key moved (a location change), the decision resets before
  // anything else, so a decision for A never attests B; a decision given now is bound to the key as it is now. The
  // recorded trust belongs to the key it was recorded for: whenever the bound key moves (to null included), it goes.
  // A New chat with no location has no key, so it holds no decision.
  private async bindTrust(intent: SetupIntent, locationChanged: boolean, decision: SetupIntent['trust'] | undefined): Promise<SetupIntent> {
    if (!locationChanged && decision === undefined) return intent;
    const key = intent.location === null ? null : (await trustKeyOf(trustDirectoryOf(intent.location), this.s.git)).trustKey;
    let next = intent;
    if (next.trustKey !== null && next.trustKey !== key) next = { ...next, trust: 'unanswered', trustKey: null };
    if (decision !== undefined) next = { ...next, trust: key === null ? 'unanswered' : decision, trustKey: decision === 'unanswered' ? null : key };
    if (next.trustKey !== intent.trustKey && next.progress.trustRecorded) next = { ...next, progress: { ...next.progress, trustRecorded: false } };
    return next;
  }

  // `session.intent.release`: the hand-back after a cancelled card or "Back to editing"; the draft is untouched.
  // A record's id releases whatever message a resume retained behind its card (none, for a resume sent without one) and
  // answers null, so the hand-back is idempotent and the renderer need not know what main retained; an id with neither
  // an intent nor a record is unknown.
  async release(appSessionId: AppSessionId): Promise<SetupIntent | null> {
    this.refuseWhileStarting(appSessionId);
    return this.serial(appSessionId, async () => {
      await this.ready();
      this.refuseWhileStarting(appSessionId);
      if (this.deps.intents.get(appSessionId) === null && (this.resumeMessages.delete(appSessionId) || this.deps.index.sessions.get(appSessionId) !== null)) return null;
      const intent = this.intentOf(appSessionId);
      return this.putIntent({ ...intent, message: null, updatedAt: this.now() });
    });
  }

  // `session.intent.discard`: the intent (and its draft) goes; a bootstrap id no longer reserved is forgotten, and so
  // are the failed attempts' store file and journal when no record stands on them. A worktree a failed attempt created
  // and could not remove is named, left for the cleanup dialog.
  async discard(appSessionId: AppSessionId): Promise<{ leftover: { worktree: { path: string; branch: string | null } } | null }> {
    this.refuseWhileStarting(appSessionId);
    return this.serial(appSessionId, async () => {
      await this.ready();
      const intent = this.deps.intents.get(appSessionId);
      if (intent === null) return { leftover: null };
      this.refuseWhileStarting(appSessionId);
      if (intent.progress.bootstrap !== null) await this.forgetQuietly(intent.progress.bootstrap.appSessionId);
      if (this.deps.index.sessions.get(appSessionId) === null) await this.forgetQuietly(appSessionId);
      await this.deps.intents.remove(appSessionId);
      this.reconcileFailures.delete(appSessionId);
      this.deps.emit('session.intent.changed', { appSessionId, intent: null });
      const w = intent.progress.worktree;
      return { leftover: w !== null && w.createdHere ? { worktree: { path: w.path, branch: w.branch } } : null };
    });
  }

  // The failure card's two resolutions of a checkout a failed attempt created and kept: "Discard changes and remove"
  // (the acknowledged discard, then the branch step; `progress.worktree` cleared) or "Keep the worktree" (detached from
  // the attempt: the location becomes that existing worktree, editable again).
  async resolveRetainedWorktree(appSessionId: AppSessionId, resolution: 'discard' | 'keep'): Promise<{ intent: SetupIntent; worktree: NonNullable<SetupResources['worktree']> }> {
    this.refuseWhileStarting(appSessionId);
    return this.serial(appSessionId, async () => {
      const s = await this.ready();
      const intent = this.intentOf(appSessionId);
      this.refuseWhileStarting(appSessionId);
      const w = intent.progress.worktree;
      if (w === null || !w.createdHere || intent.location?.kind !== 'newWorktree') throw new IntentRefused('no_retained_worktree', `no retained worktree for ${appSessionId}`);
      const repoRoot = intent.location.repoRoot;
      if (resolution === 'keep') {
        const next = await this.putIntent({
          ...intent,
          updatedAt: this.now(),
          location: { kind: 'existingWorktree', repoRoot, path: w.path },
          progress: { ...intent.progress, worktree: { ...w, createdHere: false } },
        });
        return { intent: next, worktree: { path: w.path, branch: w.branch, createdHere: false, state: 'kept', detail: null, branchState: 'none' } };
      }
      const { resource, removed } = await removeCreatedWorktree(s, repoRoot, w, { newBranch: intent.location.branch.kind === 'new', discard: true });
      const next = removed ? await this.putIntent({ ...intent, updatedAt: this.now(), progress: { ...intent.progress, worktree: null } }) : intent;
      return { intent: next, worktree: resource };
    });
  }

  // ---- take over (W7) ----------------------------------------------------------------------------------------------

  // `session.takeOver`: ends the foreign holder the owner confirmed and waits for the registry to clear (take-over.ts).
  // Refused while a start of this id is in flight; the resume that follows is the renderer's `session.start`.
  async takeOverPane(pid: number): Promise<{ ptyId: string; label: string } | null> {
    await this.ready();
    const target = await findPane(this.s.dispatch, pid);
    return target ? { ptyId: target.pane.ptyId, label: target.pane.label } : null;
  }

  async takeOver(appSessionId: AppSessionId, expected: ForeignHolder, paneId?: string | null): Promise<TakeOverOutcome> {
    await this.ready();
    if (this.starting.has(appSessionId)) return { status: 'refused', reason: 'self', message: 'This session is starting in MAWS.' };
    this.starting.add(appSessionId);
    try {
      return await this.serial(appSessionId, async () => {
        const record = this.deps.index.sessions.get(appSessionId);
        if (record === null) return { status: 'refused', reason: 'unknown_session', message: `no session record for ${appSessionId}` };
        const deps: TakeOverDeps = {
          dispatch: this.s.dispatch, sessions: this.s.sessions, env: this.s.env, ...this.deps.takeOver, paneId,
          resumePane: async (target) => pauseTakeOver({
            processes: readProcesses,
            write: (data) => paneCall(this.s.dispatch, 'pty.write', { ptyId: target.pane.ptyId, data }),
            foreground: () => paneCall(this.s.dispatch, 'pty.foreground', { ptyId: target.pane.ptyId }),
            signal: (pid, signal) => process.kill(pid, signal),
            clear: async () => {
              const { holders } = await hostCall(this.s.dispatch, 'fs.holders', { sessionIds: [record.engineSessionId!], directories: null });
              return !holders.some((row) => row.holder.kind === 'terminal' && row.holder.pid === target.holder.pid);
            },
            resume: async (paused) => {
              let outcome: SetupEvent['outcome'] = null;
              const setup: Setup = { ...this.s, emit: (name, payload) => {
                if (name === 'session.setup') outcome = (payload as SetupEvent).outcome;
                return this.s.emit(name, payload);
              } };
              const [guard, run] = await guardResumeStart(setup, record, { message: null, options: {} }, this.resumeMessages, paused);
              if (!run) throw new Error(`MAWS could not resume this session: ${guard.status}.`);
              await run();
              const answer = outcome as SetupEvent['outcome'];
              if (answer?.kind !== 'ready') throw new Error(answer?.kind === 'error' ? answer.message : `MAWS could not become ready: ${answer?.kind ?? 'no answer'}.`);
            },
            authority: (paused) => holderAuthority({ dispatch: this.s.dispatch, sessions: this.s.sessions }, { appSessionId, engineSessionId: record.engineSessionId! }, paused),
            cancel: async () => {
              if (await reservationOf(this.s.dispatch, appSessionId)) await hostCall(this.s.dispatch, 'session.stop', { appSessionId, reason: 'stop' });
              return until(async () => await reservationOf(this.s.dispatch, appSessionId) === null, STOP_WAIT_MS, 100);
            },
          }, { appSessionId, engineSessionId: record.engineSessionId! }, target),
        };
        return releaseHolder(deps, { engineSessionId: record.engineSessionId, appSessionId, expected });
      });
    } finally {
      this.starting.delete(appSessionId);
    }
  }

  // ---- start ------------------------------------------------------------------------------------------------------

  // `session.start`: an intent's setup, or a record's resume. `starting` is the only answer after which phases stream.
  async startSession(appSessionId: AppSessionId, args: { message: FirstMessage | null; options: StartOptions }): Promise<StartOutcome> {
    await this.ready();
    // Marked synchronously, before the guards' first await: a second start, a patch or a release of this id is refused
    // `starting` from here on, and a new worktree's name is reserved against every other start, so two starts can
    // never both pass their guards for one checkout.
    this.refuseWhileStarting(appSessionId);
    this.starting.add(appSessionId);
    const claim = this.claimWorktreeName(this.deps.intents.get(appSessionId));
    let release: (() => void) | null = null;
    let handedOff = false;
    try {
      if (claim === 'taken') {
        const location = this.intentOf(appSessionId).location as Extract<Location, { kind: 'newWorktree' }>;
        return await this.rejectIntent(appSessionId, { status: 'invalid', appSessionId, field: 'location', message: `a worktree named ${location.name} is being created by another start` });
      }
      release = await this.lock(appSessionId);
      // a reconciliation that failed at start is re-run first, never the setup in its place; E10: so is one a deferred
      // recovery has not reached (an intent with a record, whose row a supervisor main cannot reach may still run)
      const intentBefore = this.deps.intents.get(appSessionId);
      const unreconciled = this.recoveryDeferred && this.deps.index.sessions.get(appSessionId) !== null;
      if (intentBefore !== null && (this.reconcileFailures.has(appSessionId) || unreconciled)) {
        const failure = await this.reconcileOne(intentBefore, null);
        if (failure !== null) throw new Error(failure);
      }
      const intent = this.deps.intents.get(appSessionId);
      let outcome: StartOutcome;
      let run: (() => Promise<void>) | null;
      if (intent !== null) [outcome, run] = await this.guardIntent(intent, args);
      else {
        const record = this.deps.index.sessions.get(appSessionId);
        if (record === null) return { status: 'refused', appSessionId, reason: 'unknown_session', message: `no setup intent and no session record for ${appSessionId}` };
        [outcome, run] = await this.guardResume(record, args);
      }
      if (run === null) return outcome;
      handedOff = true;
      const held = release;
      void run().finally(() => {
        this.endStart(appSessionId, claim);
        held();
      });
      return outcome;
    } finally {
      if (!handedOff) {
        this.endStart(appSessionId, claim);
        release?.();
      }
    }
  }

  // A new worktree an unretained intent would create, claimed by its directory name (every repository alike: two spellings
  // of one repository must not both pass, and the name is known without an await). 'taken' when another start holds it.
  private claimWorktreeName(intent: SetupIntent | null): string | null | 'taken' {
    if (intent === null || intent.location?.kind !== 'newWorktree' || intent.progress.worktree !== null) return null;
    const key = worktreeDirName(intent.location.name);
    if (this.startingNames.has(key)) return 'taken';
    this.startingNames.add(key);
    return key;
  }

  private endStart(appSessionId: AppSessionId, claim: string | null | 'taken'): void {
    this.starting.delete(appSessionId);
    if (claim !== null && claim !== 'taken') this.startingNames.delete(claim);
  }

  // A rejected guard hands the message back: C7's gate reads `intent.message`, so the editor unlocks the moment the
  // answer lands; the draft is untouched.
  private async rejectIntent<T extends StartOutcome | null>(appSessionId: AppSessionId, outcome: T): Promise<T> {
    const intent = this.deps.intents.get(appSessionId);
    if (intent !== null && intent.message !== null) await this.putIntent({ ...intent, message: null, updatedAt: this.now() });
    return outcome;
  }

  // The start guards (start-guards.ts). One that could not answer (the relay check, a fail-closed holder read, a git
  // failure) hands the message back as a rejection does, then fails the command with its error.
  private async guardIntent(intentIn: SetupIntent, args: { message: FirstMessage | null; options: StartOptions }): Promise<Guarded> {
    try {
      return await guardIntentStart(this.s, this.guardContext, intentIn, args);
    } catch (error) {
      await this.rejectIntent(intentIn.appSessionId, null).catch(() => {});
      throw error;
    }
  }

  private async guardResume(record: SessionRecord, args: { message: FirstMessage | null; options: StartOptions }): Promise<Guarded> {
    try {
      return await guardResumeStart(this.s, record, args, this.resumeMessages);
    } catch (error) {
      this.resumeMessages.delete(record.appId); // a guard that could not answer hands the message back
      throw error;
    }
  }

  // what the start guards write through: the service's intent writes and its bootstrap forgetting
  private readonly guardContext: GuardContext = {
    putIntent: (intent) => this.putIntent(intent),
    rejectIntent: (appSessionId, outcome) => this.rejectIntent(appSessionId, outcome),
    bindTrust: (intent, locationChanged, decision) => this.bindTrust(intent, locationChanged, decision),
    forgetQuietly: (appSessionId) => this.forgetQuietly(appSessionId),
  };

  // ---- fork, archive, delete, rename, reveal (record-actions.ts) --------------------------------------------------

  // `session.fork`: a fork intent over the source's conversation, started at once. The outcome's id is the fork's. A
  // start that is rejected or throws opens no tab, so the fork's intent goes before the answer (nothing launched: there
  // is nothing else to forget).
  async fork(appSessionId: AppSessionId, target: ForkTarget, args: { message: FirstMessage | null; rewindTo: MessageUuid | null }): Promise<StartOutcome> {
    const allocated = await this.serial(appSessionId, async (): Promise<StartOutcome | AppSessionId> => {
      const s = await this.ready();
      const source = s.sessions.get(appSessionId);
      const refusal = await forkRefusal(s, appSessionId);
      if (source === null || refusal !== null) return { status: 'refused', appSessionId, ...(refusal ?? { reason: 'unknown_session', message: `no session ${appSessionId}` }) };
      const intent = await forkIntentOf(s, source, target, args);
      if ('invalid' in intent) return { status: 'invalid', appSessionId, field: 'target', message: intent.invalid };
      await this.putIntent(intent);
      return intent.appSessionId;
    });
    return typeof allocated === 'string' ? this.startFork(allocated) : allocated;
  }

  // A fork's intent, started at once; one its start rejects or that throws is dropped before the answer.
  private async startFork(forkId: AppSessionId): Promise<StartOutcome> {
    let outcome: StartOutcome;
    try {
      outcome = await this.startSession(forkId, { message: null, options: {} });
    } catch (error) {
      await this.dropForkIntent(forkId);
      throw error;
    }
    if (outcome.status === 'invalid' || outcome.status === 'missing_directory' || outcome.status === 'refused') await this.dropForkIntent(forkId);
    return outcome;
  }

  // E3 start: `side.thread.open` (E3 execution document, Design §3): C10's fork of the parent, in place and at its current
  // point, under the side thread's own guard (a running turn does not refuse it), its intent carrying the lineage the
  // record takes and the anchored first message (or the promotion of answered side questions). The outcome's id is the
  // thread's. A screenshot outside the allowed roots throws `ScreenshotRefused`, and a first message larger than a send
  // may be `InvalidSideInput`, both before anything is created.
  async openSideThread(appSessionId: AppSessionId, from: SideThreadFrom): Promise<StartOutcome> {
    const allocated = await this.serial(appSessionId, async (): Promise<StartOutcome | AppSessionId> => {
      const s = await this.ready();
      const source = s.sessions.get(appSessionId);
      const refusal = sideThreadRefusal(s, appSessionId);
      if (source === null || refusal !== null) return { status: 'refused', appSessionId, ...(refusal ?? { reason: 'unknown_session', message: `no session ${appSessionId}` }) };
      const content: ContentBlock[] =
        from.kind === 'comment'
          ? await commentContent({ ...from, destination: 'thread' }, () => screenshotRoots(this.deps.userData, source))
          : [{ type: 'text', text: promotionMessage(from.exchanges, from.text) }];
      const tooLarge = sendContentRefusal(content);
      if (tooLarge !== null) throw new InvalidSideInput([], `the side thread's first message is too large: ${tooLarge.message}`);
      const display = String(content.at(-1)!.text); // the anchored text, whole: what a failed setup hands back to the editor
      const lineage: Lineage = {
        kind: 'side-thread',
        parentAppSessionId: source.appId,
        parentEngineSessionId: source.engineSessionId,
        ...(from.kind === 'comment' ? { anchor: withoutScreenshot(from.anchor) } : {}),
        openedBy: from.kind,
      };
      const intent = await forkIntentOf(s, source, { kind: 'inPlace' }, { message: { content, display }, rewindTo: null }, lineage);
      if ('invalid' in intent) return { status: 'invalid', appSessionId, field: 'target', message: intent.invalid }; // never for an in-place fork
      await this.putIntent(intent);
      return intent.appSessionId;
    });
    return typeof allocated === 'string' ? this.startFork(allocated) : allocated;
  }

  // `side.sendToMain` (Design §8): the anchored comment to the parent itself.
  async sendToMain(input: SendToMainInput): Promise<SendToMainOutput> {
    return sendToMain(await this.ready(), this.deps.userData, input);
  }
  // E3 end

  private dropForkIntent(forkId: AppSessionId): Promise<void> {
    return this.serial(forkId, async () => {
      if (this.deps.intents.get(forkId) === null) return;
      await this.deps.intents.remove(forkId);
      this.deps.emit('session.intent.changed', { appSessionId: forkId, intent: null });
    });
  }

  archive(appSessionId: AppSessionId, opts: { onlyIfIdle?: boolean } = {}): Promise<ArchiveOutcome> {
    return this.serial(appSessionId, async () => archiveRecord(await this.ready(), appSessionId, opts));
  }

  remove(appSessionId: AppSessionId, stopIfLive: boolean): Promise<DeleteOutcome> {
    return this.serial(appSessionId, async () => deleteRecord(await this.ready(), { manifests: this.manifests, trash: this.deps.trash }, appSessionId, stopIfLive));
  }

  // What a delete would move, for its sheet; a delete interrupted half-way, for the session's tab ("Finish deleting"
  // is `session.delete` again; "Keep" drops the manifest and leaves what did not move where it is).
  previewDeletion = async (appSessionId: AppSessionId) => previewDeletion(await this.ready(), appSessionId);
  listDeletions = async (): Promise<DeletionManifest[]> => this.ready().then(() => this.manifests.list());
  keepDeletion = (appSessionId: AppSessionId): Promise<void> => this.serial(appSessionId, () => this.manifests.remove(appSessionId));

  rename(appSessionId: AppSessionId, title: string): Promise<{ record: SessionRecord; via: 'engine' | 'override' }> {
    return this.serial(appSessionId, async () => renameRecord(await this.ready(), appSessionId, title));
  }

  async revealPath(path: string): Promise<void> {
    this.deps.reveal(await revealablePath(await this.ready(), this.deps.index.projects, path));
  }

  // `session.trust.check`, read with the environment the engine receives.
  async trustCheck(directory: string): Promise<TrustState> {
    const s = await this.ready();
    return trustStateOf(directory, { git: s.git, env: s.env });
  }

  // ---- reconciliation ---------------------------------------------------------------------------------------------

  // One intent's reconciliation; answers the failure's message (kept for the tab's Retry) or null. `live` null: the
  // host's live rows are read here (a Retry of a failed reconciliation), a read failure failing this reconciliation.
  private async reconcileOne(intent: SetupIntent, live: LiveRows | null): Promise<string | null> {
    try {
      await reconcileIntent(this.s, intent, live ?? (await liveRows(this.s.dispatch)));
      this.reconcileFailures.delete(intent.appSessionId);
      return null;
    } catch (error) {
      const message = `reconciliation failed: ${error instanceof Error ? error.message : String(error)}`;
      this.log(`${intent.appSessionId}: ${message}`);
      this.reconcileFailures.set(intent.appSessionId, message);
      const current = this.deps.intents.get(intent.appSessionId);
      if (current !== null) {
        const resources: SetupResources = { worktree: retainedWorktree(current), record: 'kept', transcript: 'none' };
        await this.putIntent({ ...current, updatedAt: this.now(), progress: { ...current.progress, lastFailure: { at: this.now(), phase: 'launching', message, resources } } }).catch(() => {});
      }
      return message;
    }
  }

  // `session.forget` for an id nothing reserves; false (logged) when the host refuses or cannot answer.
  private async forgetQuietly(appSessionId: AppSessionId): Promise<boolean> {
    try {
      await hostCall(this.deps.host.dispatch, 'session.forget', { appSessionId });
      return true;
    } catch (error) {
      this.log(`could not forget ${appSessionId}: ${error instanceof HostError || error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
