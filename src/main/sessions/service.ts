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
import { DeletionManifests } from './delete-manifest';
import { checkAdditionalDirectories, checkLocation, sessionDirectoryOf, trustDirectoryOf, type RuleVerdict } from './intent-rules';
import { readSettings } from './launch-mapping';
import { archiveRecord, deleteRecord, forkIntentOf, renameRecord, revealablePath } from './record-actions';
import { reconcileIntent, retainedWorktree } from './recovery';
import { removeCreatedWorktree, type Setup } from './setup';
import { forkRefusal, guardIntentStart, guardResumeStart, type GuardContext, type Guarded } from './start-guards';
import { trustKeyOf, trustStateOf } from './trust';

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
  // every command wait for it.
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
    for (const watch of [...(this.setup?.watches ?? [])]) watch.halt();
  }

  private async boot(): Promise<void> {
    const env = await this.deps.env;
    this.setup = {
      sessions: this.deps.index.sessions,
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
      now: this.now,
      log: this.log,
      watchdogMs: this.deps.timing?.watchdogMs ?? WATCHDOG_MS,
      stopWaitMs: this.deps.timing?.stopWaitMs ?? STOP_WAIT_MS,
      watches: new Set(),
    };
    await this.deps.intents.load();
    await this.deps.host.ready?.();
    // nothing is reserved at start, so every bootstrap id a previous run left is forgotten
    for (const intent of this.deps.intents.list()) {
      const bootstrap = intent.progress.bootstrap;
      if (bootstrap === null) continue;
      if (await this.forgetQuietly(bootstrap.appSessionId)) await this.putIntent({ ...intent, progress: { ...intent.progress, bootstrap: null } });
    }
    for (const note of await this.deps.bootstraps.list()) {
      if (await this.forgetQuietly(note.bootstrapId)) await this.deps.bootstraps.remove(note.bootstrapId);
    }
    for (const manifest of await this.manifests.list()) {
      this.log(`a deletion of ${manifest.appSessionId} was interrupted (${manifest.trashed.length} of ${manifest.paths.length} moved); session.delete finishes it`);
    }
    for (const intent of this.deps.intents.list()) await this.reconcileOne(intent);
  }

  private get s(): Setup {
    if (this.setup === null) throw new Error('the session service has not started');
    return this.setup;
  }

  private async ready(): Promise<Setup> {
    await (this.readyPromise ?? this.start());
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

  // `session.create`: an app id and a persisted intent; no process, no record, no row.
  async create(req: { projectId: ProjectId | null; location: Location | null }): Promise<{ appSessionId: AppSessionId; intent: SetupIntent }> {
    const s = await this.ready();
    const appSessionId = randomUUID() as AppSessionId;
    const now = this.now();
    const intent: SetupIntent = {
      appSessionId,
      projectId: req.projectId,
      createdAt: now,
      updatedAt: now,
      kind: 'create',
      source: null,
      location: req.location ?? { kind: 'directory', path: this.defaultDirectory(req.projectId) },
      additionalDirectories: [],
      model: null,
      effort: null,
      permissionMode: null,
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

  // The project's directory, else the last directory an intent or a session used, else the home directory.
  private defaultDirectory(projectId: ProjectId | null): string {
    const project = projectId === null ? undefined : this.deps.index.projects.list({ includeHidden: true }).find((p) => p.id === projectId);
    if (project) return project.directory;
    const lastIntent = [...this.deps.intents.list()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (lastIntent) return trustDirectoryOf(lastIntent.location);
    const lastRecord = this.deps.index.sessions.list()[0];
    return lastRecord?.directory ?? this.s.env.HOME ?? homedir();
  }

  // `session.intent.patch`: the changed fields validated; a location change re-binds the trust decision to its key.
  async patch(appSessionId: AppSessionId, patch: SetupIntentPatch): Promise<SetupIntent> {
    this.refuseWhileStarting(appSessionId);
    return this.serial(appSessionId, async () => {
      const s = await this.ready();
      const intent = this.intentOf(appSessionId);
      this.refuseWhileStarting(appSessionId);
      if (patch.location !== undefined && intent.progress.worktree?.createdHere) {
        throw new IntentRefused('retained_worktree', `retained_worktree: the failed attempt's worktree ${intent.progress.worktree.path} is kept; discard it or keep it first`);
      }
      let next: SetupIntent = { ...intent, ...patch, updatedAt: this.now() };
      if (patch.location !== undefined) {
        this.rule(await checkLocation(s, next, { forStart: false }));
        if (intent.progress.worktree !== null) next = { ...next, progress: { ...next.progress, worktree: null } }; // an existing worktree's note: the next start re-reads it
      }
      if (patch.location !== undefined || patch.additionalDirectories !== undefined) {
        this.rule(await checkAdditionalDirectories(next, await sessionDirectoryOf(s, next.location)));
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
  // anything else, so a decision for A never attests B; a decision given now is bound to the key as it is now.
  private async bindTrust(intent: SetupIntent, locationChanged: boolean, decision: SetupIntent['trust'] | undefined): Promise<SetupIntent> {
    if (!locationChanged && decision === undefined) return intent;
    const key = (await trustKeyOf(trustDirectoryOf(intent.location), this.s.git)).trustKey;
    let next = intent;
    if (next.trustKey !== null && next.trustKey !== key) next = { ...next, trust: 'unanswered', trustKey: null, progress: { ...next.progress, trustRecorded: false } };
    if (decision !== undefined) next = { ...next, trust: decision, trustKey: decision === 'unanswered' ? null : key };
    return next;
  }

  // `session.intent.release`: the hand-back after a cancelled card or "Back to editing"; the draft is untouched.
  // A record's id releases the message a resume retained behind its card and answers null; an id with neither an intent
  // nor a retained message is unknown.
  async release(appSessionId: AppSessionId): Promise<SetupIntent | null> {
    this.refuseWhileStarting(appSessionId);
    return this.serial(appSessionId, async () => {
      await this.ready();
      this.refuseWhileStarting(appSessionId);
      if (this.deps.intents.get(appSessionId) === null && this.resumeMessages.delete(appSessionId)) return null;
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
      if (w === null || !w.createdHere || intent.location.kind !== 'newWorktree') throw new IntentRefused('no_retained_worktree', `no retained worktree for ${appSessionId}`);
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
      // a reconciliation that failed at start is re-run first, never the setup in its place
      const intentBefore = this.deps.intents.get(appSessionId);
      if (intentBefore !== null && this.reconcileFailures.has(appSessionId)) {
        const failure = await this.reconcileOne(intentBefore);
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
    if (intent === null || intent.location.kind !== 'newWorktree' || intent.progress.worktree !== null) return null;
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

  // `session.fork`: a fork intent over the source's conversation, started at once. The outcome's id is the fork's.
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
    if (typeof allocated !== 'string') return allocated;
    return this.startSession(allocated, { message: null, options: {} });
  }

  archive(appSessionId: AppSessionId, opts: { onlyIfIdle?: boolean } = {}): Promise<ArchiveOutcome> {
    return this.serial(appSessionId, async () => archiveRecord(await this.ready(), appSessionId, opts));
  }

  remove(appSessionId: AppSessionId, stopIfLive: boolean): Promise<DeleteOutcome> {
    return this.serial(appSessionId, async () => deleteRecord(await this.ready(), { manifests: this.manifests, trash: this.deps.trash }, appSessionId, stopIfLive));
  }

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

  // One intent's reconciliation; answers the failure's message (kept for the tab's Retry) or null.
  private async reconcileOne(intent: SetupIntent): Promise<string | null> {
    try {
      await reconcileIntent(this.s, intent);
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
