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
import { dirname, join } from 'node:path';
import type { AppSessionId, MessageUuid, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { isGatewayModel } from '@shared/sessions/models';
import type { FirstMessage, ForkTarget, Location, SetupIntent, SetupIntentPatch } from '@shared/sessions/intent';
import type { SetupResources, StartOutcome } from '@shared/sessions/setup';
import type { TrustState } from '@shared/sessions/trust';
import type { ArchiveOutcome, DeleteOutcome, StartOptions } from '@shared/ipc/schema/session';
import { EffortSchema } from '@shared/engine/launch-spec';
import { resolveStorePaths, slugOf } from '../../engine-host/fs/paths';
import { attachCommand } from './attach';
import { emptyProgress, HostError, hostCall, isDirectory, realOrSelf, reservationOf, STOP_WAIT_MS, WATCHDOG_MS, type SessionServiceDeps } from './context';
import { DeletionManifests, enumerateConversation } from './delete-manifest';
import { canonicalPath, holderAuthority } from './holders';
import { checkAdditionalDirectories, checkLocation, sessionDirectoryOf, trustDirectoryOf, type RuleVerdict } from './intent-rules';
import { readSettings } from './launch-mapping';
import { reconcileIntent } from './recovery';
import { removeCreatedWorktree, runIntentSetup, runResume, type Setup } from './setup';
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

type Rejection = Extract<StartOutcome, { status: 'invalid' | 'missing_directory' | 'refused' }>;

export class SessionService {
  private setup: Setup | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly locks = new Map<string, Promise<void>>();
  private readonly starting = new Set<string>(); // ids with a start in flight (guards through the end of the setup)
  private readonly startingPaths = new Set<string>(); // new-worktree paths a start in flight will create
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
    const reset = this.deps.index.sessions.resetSelfHolders();
    if (reset > 0) this.log(`reset ${reset} stale self holder${reset === 1 ? '' : 's'} (D-16)`);
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
  async release(appSessionId: AppSessionId): Promise<SetupIntent> {
    this.refuseWhileStarting(appSessionId);
    return this.serial(appSessionId, async () => {
      await this.ready();
      const intent = this.intentOf(appSessionId);
      this.refuseWhileStarting(appSessionId);
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
    this.refuseWhileStarting(appSessionId);
    const release = await this.lock(appSessionId);
    let handedOff = false;
    try {
      if (this.starting.has(appSessionId)) throw new IntentRefused('starting', `starting: a start is in flight for ${appSessionId}`);
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
      this.starting.add(appSessionId);
      handedOff = true;
      void run().finally(() => {
        this.starting.delete(appSessionId);
        release();
      });
      return outcome;
    } finally {
      if (!handedOff) release();
    }
  }

  private async guardIntent(intentIn: SetupIntent, args: { message: FirstMessage | null; options: StartOptions }): Promise<[StartOutcome, (() => Promise<void>) | null]> {
    const s = this.s;
    const appSessionId = intentIn.appSessionId;
    // the options and the message first, persisted and published (C7's gate closes on the published message); the
    // decision is re-bound to the key the location answers to now
    let intent: SetupIntent = { ...intentIn, updatedAt: this.now() };
    if (args.options.gateway !== undefined) intent = { ...intent, gateway: args.options.gateway };
    if (args.message !== null) intent = { ...intent, message: args.message };
    intent = await this.bindTrust(intent, true, args.options.trust);
    intent = await this.putIntent(intent);

    const reject = async (outcome: Rejection): Promise<[StartOutcome, null]> => {
      // the hand-back: C7's gate reads `intent.message`, so the editor unlocks the moment this answer lands
      await this.putIntent({ ...this.intentOf(appSessionId), message: null, updatedAt: this.now() });
      return [outcome, null];
    };
    const verdict = await checkLocation(s, intent, { forStart: true });
    if (!verdict.ok) {
      return reject(verdict.kind === 'invalid' ? { status: 'invalid', appSessionId, field: verdict.field, message: verdict.message } : { status: 'missing_directory', appSessionId, directory: verdict.directory });
    }
    const target = intent.location.kind === 'newWorktree' ? await sessionDirectoryOf(s, intent.location) : null;
    if (target !== null && intent.progress.worktree === null && this.startingPaths.has(await canonicalPath(target))) {
      return reject({ status: 'invalid', appSessionId, field: 'location', message: `worktree path in use by another start: ${target}` });
    }
    const dirs = await checkAdditionalDirectories(intent, await sessionDirectoryOf(s, intent.location));
    if (!dirs.ok && dirs.kind === 'invalid') return reject({ status: 'invalid', appSessionId, field: dirs.field, message: dirs.message });
    if (intent.kind === 'fork') {
      const refusal = await this.forkRefusal(intent.source!.appSessionId);
      if (refusal !== null) return reject({ status: 'refused', appSessionId, ...refusal });
    }

    // the card outcomes: the message stays with the intent until the card's continuation, a release or the handoff
    const trust = await trustStateOf(trustDirectoryOf(intent.location), { git: s.git, env: s.env });
    if (!trust.trusted && intent.trust === 'unanswered') return [{ status: 'needs_trust', appSessionId, trust }, null];
    let gateway = intent.gateway;
    let directFallback = false;
    if (gateway === 'gateway') {
      const health = await hostCall(s.dispatch, 'engine.relayHealth', { force: true });
      if (!health.ok) {
        if (s.settings().gateway.relayUnreachable === 'direct' && !isGatewayModel(intent.model ?? '')) {
          gateway = 'direct';
          directFallback = true;
        } else {
          return [{ status: 'relay_unreachable', appSessionId, health }, null];
        }
      }
    }

    // guards passed: the pin is minted once and kept across retries; a bootstrap an interrupted attempt left goes
    let progress = intent.progress;
    if (progress.engineSessionId === null) progress = { ...progress, engineSessionId: randomUUID() as NonNullable<typeof progress.engineSessionId> };
    if (progress.bootstrap !== null && (await this.forgetQuietly(progress.bootstrap.appSessionId))) progress = { ...progress, bootstrap: null };
    if (progress !== intent.progress) await this.putIntent({ ...intent, progress, updatedAt: this.now() });
    const worktreePath = target !== null && progress.worktree === null ? await canonicalPath(target) : null;
    if (worktreePath !== null) this.startingPaths.add(worktreePath);
    const run = () => runIntentSetup(s, appSessionId, { gateway, directFallback }).finally(() => worktreePath !== null && this.startingPaths.delete(worktreePath));
    return [{ status: 'starting', appSessionId }, run];
  }

  // A fork is refused for a source that is gone, has no engine id, or has a turn open in MAWS (a copy taken mid-turn
  // would hold a half-written turn).
  private async forkRefusal(sourceId: AppSessionId): Promise<{ reason: 'no_engine_session' | 'busy' | 'unknown_session'; message: string } | null> {
    const source = this.deps.index.sessions.get(sourceId);
    if (source === null) return { reason: 'unknown_session', message: `no session ${sourceId}` };
    if (source.engineSessionId === null) return { reason: 'no_engine_session', message: 'the session has no engine conversation to fork yet' };
    const live = await reservationOf(this.s.dispatch, sourceId);
    if (live !== null && live.turn !== null) return { reason: 'busy', message: 'the session has a turn running; fork it once the turn ends' };
    return null;
  }

  private async guardResume(record: SessionRecord, args: { message: FirstMessage | null; options: StartOptions }): Promise<[StartOutcome, (() => Promise<void>) | null]> {
    const s = this.s;
    const appSessionId = record.appId;
    if (args.message !== null) this.resumeMessages.set(appSessionId, args.message);
    const handBack = (outcome: StartOutcome): [StartOutcome, null] => {
      this.resumeMessages.delete(appSessionId);
      return [outcome, null];
    };
    if (record.archived) return handBack({ status: 'archived', appSessionId });
    const verdict = await holderAuthority({ dispatch: s.dispatch, sessions: s.sessions }, { engineSessionId: record.engineSessionId, appSessionId });
    if (verdict.live === 'self') return handBack({ status: 'already_live', appSessionId });
    if (verdict.live === 'foreign') return handBack({ status: 'held', appSessionId, holder: verdict.holder, attach: await this.attachOf(verdict.holder) });
    if (!(await isDirectory(record.directory))) return handBack({ status: 'missing_directory', appSessionId, directory: record.directory });
    const decision = args.options.trust === 'accepted' || args.options.trust === 'declined' ? args.options.trust : null;
    if (decision === null) {
      const trust: TrustState = await trustStateOf(record.directory, { git: s.git, env: s.env });
      if (!trust.trusted) return [{ status: 'needs_trust', appSessionId, trust }, null];
    }
    const message = this.resumeMessages.get(appSessionId) ?? null;
    const run = () => runResume(s, record, { decision, options: args.options, message, onSent: () => this.resumeMessages.delete(appSessionId) });
    return [{ status: 'starting', appSessionId }, run];
  }

  private async attachOf(holder: SessionRecord['holder']): Promise<{ jobId: string; command: string } | null> {
    if (holder.kind !== 'background_job' || holder.jobId === null) return null;
    const binary = await hostCall(this.s.dispatch, 'engine.binaryInfo', undefined);
    return { jobId: holder.jobId, command: attachCommand(binary.path, holder.jobId) };
  }

  // ---- fork -------------------------------------------------------------------------------------------------------

  // `session.fork`: a fork intent over the source's conversation, started at once. The outcome's id is the fork's.
  async fork(appSessionId: AppSessionId, target: ForkTarget, args: { message: FirstMessage | null; rewindTo: MessageUuid | null }): Promise<StartOutcome> {
    const allocated = await this.serial(appSessionId, async (): Promise<StartOutcome | AppSessionId> => {
      const s = await this.ready();
      const source = s.sessions.get(appSessionId);
      const refusal = await this.forkRefusal(appSessionId);
      if (source === null || refusal !== null) return { status: 'refused', appSessionId, ...(refusal ?? { reason: 'unknown_session', message: `no session ${appSessionId}` }) };
      let location: Location;
      if (target.kind === 'inPlace') location = { kind: 'directory', path: source.directory };
      else {
        const listed = await s.worktrees.list(source.directory).catch(() => null);
        if (listed === null) return { status: 'invalid', appSessionId, field: 'target', message: `not a git repository: ${source.directory}` };
        location = { kind: 'newWorktree', repoRoot: listed.repoRoot, name: target.name, branch: target.branch };
      }
      const effort = EffortSchema.safeParse(source.effort);
      const routed = source.gateway.routed;
      const forkId = randomUUID() as AppSessionId;
      const now = this.now();
      await this.putIntent({
        appSessionId: forkId,
        projectId: source.projectId,
        createdAt: now,
        updatedAt: now,
        kind: 'fork',
        source: { appSessionId, engineSessionId: source.engineSessionId!, rewindTo: args.rewindTo },
        location,
        additionalDirectories: source.additionalDirectories,
        model: source.model.requested,
        effort: effort.success ? effort.data : null,
        permissionMode: source.permissionMode.requested,
        gateway: routed === true ? 'gateway' : routed === false ? 'direct' : s.settings().gateway.defaultRoute,
        trust: 'unanswered',
        trustKey: null,
        message: args.message,
        draft: null,
        progress: emptyProgress(),
      });
      return forkId;
    });
    if (typeof allocated !== 'string') return allocated;
    return this.startSession(allocated, { message: null, options: {} });
  }

  // ---- archive, delete, rename -------------------------------------------------------------------------------------

  // `session.archive`: never a foreign holder's process; under `onlyIfIdle` (the cleanup dialog's step, whose snapshot
  // may be stale) any live session is skipped, nothing stopped. The store file is kept (C3's archive deletes only the
  // journal), so an unarchived session resumes with its queue and grants.
  archive(appSessionId: AppSessionId, opts: { onlyIfIdle?: boolean } = {}): Promise<ArchiveOutcome> {
    return this.serial(appSessionId, async () => {
      const s = await this.ready();
      const record = this.recordOf(appSessionId);
      const verdict = await holderAuthority({ dispatch: s.dispatch, sessions: s.sessions }, { engineSessionId: record.engineSessionId, appSessionId });
      if (verdict.live === 'foreign') return { status: 'held', holder: verdict.holder };
      if (opts.onlyIfIdle && verdict.live !== 'none') return { status: 'skipped_live', holder: verdict.holder };
      if ((await reservationOf(s.dispatch, appSessionId)) !== null) await hostCall(s.dispatch, 'session.stop', { appSessionId, reason: 'archive' });
      s.sessions.update(appSessionId, { archived: true });
      return { archived: true as const };
    });
  }

  // `session.delete`: whole or not at all. Refused for a foreign holder, and for a MAWS-live session unless the caller
  // asked to stop it, in which case only a confirmed exit continues; the files are enumerated and persisted before the
  // first Trash move, the transcript last; then C3's store file and journal are forgotten and the record removed.
  remove(appSessionId: AppSessionId, stopIfLive: boolean): Promise<DeleteOutcome> {
    return this.serial(appSessionId, async () => {
      const s = await this.ready();
      const record = this.recordOf(appSessionId);
      const authority = () => holderAuthority({ dispatch: s.dispatch, sessions: s.sessions }, { engineSessionId: record.engineSessionId, appSessionId });
      let verdict = await authority();
      if (verdict.live === 'foreign') return { status: 'held', holder: verdict.holder };
      if (verdict.live === 'self') {
        if (!stopIfLive) return { status: 'live' };
        if ((await reservationOf(s.dispatch, appSessionId)) !== null) {
          const stopped = await hostCall(s.dispatch, 'session.stop', { appSessionId, reason: 'archive' });
          if (!stopped.exited) return { status: 'stop_unconfirmed', detail: 'the session has not exited yet; try again in a moment' };
        }
        verdict = await authority();
        if (verdict.live !== 'none') return { status: 'held', holder: verdict.holder };
      }

      const existing = await this.manifests.get(appSessionId);
      const paths = record.engineSessionId === null ? [] : await enumerateConversation(this.projectDirOf(record), record.engineSessionId);
      const manifest = { appSessionId, engineSessionId: record.engineSessionId, paths, trashed: existing?.trashed ?? [], createdAt: existing?.createdAt ?? this.now() };
      await this.manifests.put(manifest);
      const trashed: string[] = [];
      for (const path of paths) {
        try {
          await this.deps.trash(path);
        } catch (error) {
          await this.manifests.put({ ...manifest, trashed: [...manifest.trashed, ...trashed] });
          return { status: 'partial', trashed, failed: { path, error: error instanceof Error ? error.message : String(error) } };
        }
        trashed.push(path);
      }
      await hostCall(s.dispatch, 'session.forget', { appSessionId }); // a failure keeps the manifest: a retry finishes
      s.sessions.remove(appSessionId);
      await this.manifests.remove(appSessionId);
      return { status: 'deleted', trashed };
    });
  }

  // The directory of the record's current transcript: its summary's path, else (a `/clear` rebind cleared it until
  // the new transcript's first summary) the slug of the record's directory.
  private projectDirOf(record: SessionRecord): string {
    const summary = this.deps.index.sessions.summaryOf(record.appId);
    if (summary?.transcriptPath) return dirname(summary.transcriptPath);
    return join(resolveStorePaths(this.s.env).projects, slugOf(record.directory));
  }

  // `session.rename`: a ready process renames through the engine (its store carries the title and C4 reads it back);
  // otherwise C4's override, which a later terminal `/rename` supersedes.
  rename(appSessionId: AppSessionId, title: string): Promise<{ record: SessionRecord; via: 'engine' | 'override' }> {
    return this.serial(appSessionId, async () => {
      const s = await this.ready();
      const record = this.recordOf(appSessionId);
      const text = title.trim();
      const live = await reservationOf(s.dispatch, appSessionId);
      if (live?.process === 'ready') {
        await hostCall(s.dispatch, 'session.renameSession', { appSessionId, title: text });
        return { record: s.sessions.get(appSessionId) ?? record, via: 'engine' as const };
      }
      return { record: s.sessions.update(appSessionId, { title: { text, source: 'user' } }), via: 'override' as const };
    });
  }

  private recordOf(appSessionId: AppSessionId): SessionRecord {
    const record = this.deps.index.sessions.get(appSessionId);
    if (record === null) throw new Error(`unknown app session: ${appSessionId}`);
    return record;
  }

  // ---- trust, reveal ----------------------------------------------------------------------------------------------

  // `session.trust.check`, read with the environment the engine receives.
  async trustCheck(directory: string): Promise<TrustState> {
    const s = await this.ready();
    return trustStateOf(directory, { git: s.git, env: s.env });
  }

  // `session.revealPath`: only a project directory, a session's directory or worktree, or a path under the store's
  // `projects/`.
  async revealPath(path: string): Promise<void> {
    const s = await this.ready();
    const target = await canonicalPath(path);
    const within = (dir: string) => target === dir || target.startsWith(`${dir}/`);
    const allowed = [
      ...this.deps.index.projects.list({ includeHidden: true }).map((p) => p.directory),
      ...s.sessions.list({ includeArchived: true }).flatMap((r) => [r.directory, ...(r.worktree ? [r.worktree.path] : [])]),
    ];
    const projects = await realOrSelf(resolveStorePaths(s.env).projects);
    const ok = within(projects) || (await Promise.all(allowed.map(canonicalPath))).some((dir) => target === dir);
    if (!ok) throw new Error(`not a project, session directory or store path: ${path}`);
    this.deps.reveal(target);
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
        const resources: SetupResources = { worktree: null, record: 'kept', transcript: 'none' };
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
