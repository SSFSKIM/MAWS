// The start guards (C10 execution document, Interfaces "Session service", the setup's `guarding` row and Resume): what
// a `session.start` answers before anything is created. For an intent: the options and message persisted first, the
// trust decision re-bound to the key, the rules (rejections hand the message back), then the card outcomes
// (`needs_trust`, the relay pre-check), then the pin; for a record: `archived`, `already_live`, `held` from a fresh
// holder read, `missing_directory`, `needs_trust`. A guard that passes answers the run the service starts.
import { randomUUID } from 'node:crypto';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { isGatewayModel } from '@shared/sessions/models';
import type { FirstMessage, SetupIntent } from '@shared/sessions/intent';
import type { StartOutcome } from '@shared/sessions/setup';
import type { TrustState } from '@shared/sessions/trust';
import type { StartOptions } from '@shared/ipc/schema/session';
import { attachCommand } from './attach';
import { hostCall, isDirectory, reservationOf } from './context';
import { holderAuthority } from './holders';
import { checkAdditionalDirectories, checkLocation, sessionDirectoryOf, trustDirectoryOf } from './intent-rules';
import { runResume } from './resume';
import { runIntentSetup } from './setup';
import type { Setup } from './setup-steps';
import { trustStateOf } from './trust';

export type Guarded = [StartOutcome, (() => Promise<void>) | null];
type Rejection = Extract<StartOutcome, { status: 'invalid' | 'missing_directory' | 'refused' }>;

// What an intent's guards write through (the service's intent writes, its bootstrap forgetting).
export interface GuardContext {
  putIntent(intent: SetupIntent): Promise<SetupIntent>;
  rejectIntent<T extends StartOutcome | null>(appSessionId: AppSessionId, outcome: T): Promise<T>;
  bindTrust(intent: SetupIntent, locationChanged: boolean, decision: SetupIntent['trust'] | undefined): Promise<SetupIntent>;
  forgetQuietly(appSessionId: AppSessionId): Promise<boolean>;
}

export async function guardIntentStart(s: Setup, ctx: GuardContext, intentIn: SetupIntent, args: { message: FirstMessage | null; options: StartOptions }): Promise<Guarded> {
  const appSessionId = intentIn.appSessionId;
  // the options and the message first, persisted and published (C7's gate closes on the published message); the
  // decision is re-bound to the key the location answers to now
  let intent: SetupIntent = { ...intentIn, updatedAt: s.now() };
  if (args.options.gateway !== undefined) intent = { ...intent, gateway: args.options.gateway };
  if (args.message !== null) intent = { ...intent, message: args.message };
  intent = await ctx.bindTrust(intent, true, args.options.trust);
  intent = await ctx.putIntent(intent);

  const reject = async (outcome: Rejection): Promise<[StartOutcome, null]> => [await ctx.rejectIntent(appSessionId, outcome), null];
  const verdict = await checkLocation(s, intent, { forStart: true });
  if (!verdict.ok) {
    return reject(verdict.kind === 'invalid' ? { status: 'invalid', appSessionId, field: verdict.field, message: verdict.message } : { status: 'missing_directory', appSessionId, directory: verdict.directory });
  }
  const dirs = await checkAdditionalDirectories(intent, await sessionDirectoryOf(s, intent.location));
  if (!dirs.ok && dirs.kind === 'invalid') return reject({ status: 'invalid', appSessionId, field: dirs.field, message: dirs.message });
  if (intent.kind === 'fork') {
    const refusal = await forkRefusal(s, intent.source!.appSessionId);
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
  let progress = intent.progress.lastFailure === null ? intent.progress : { ...intent.progress, lastFailure: null }; // a new attempt
  if (progress.engineSessionId === null) progress = { ...progress, engineSessionId: randomUUID() as NonNullable<typeof progress.engineSessionId> };
  if (progress.bootstrap !== null && (await ctx.forgetQuietly(progress.bootstrap.appSessionId))) progress = { ...progress, bootstrap: null };
  if (progress !== intent.progress) await ctx.putIntent({ ...intent, progress, updatedAt: s.now() });
  return [{ status: 'starting', appSessionId }, () => runIntentSetup(s, appSessionId, { gateway, directFallback })];
}

// A fork is refused for a source that is gone, has no engine id, or has a turn open in MAWS (a copy taken mid-turn
// would hold a half-written turn).
export async function forkRefusal(s: Setup, sourceId: AppSessionId): Promise<{ reason: 'no_engine_session' | 'busy' | 'unknown_session'; message: string } | null> {
  const source = s.sessions.get(sourceId);
  if (source === null) return { reason: 'unknown_session', message: `no session ${sourceId}` };
  if (source.engineSessionId === null) return { reason: 'no_engine_session', message: 'the session has no engine conversation to fork yet' };
  const live = await reservationOf(s.dispatch, sourceId);
  if (live !== null && live.turn !== null) return { reason: 'busy', message: 'the session has a turn running; fork it once the turn ends' };
  return null;
}

export async function guardResumeStart(s: Setup, record: SessionRecord, args: { message: FirstMessage | null; options: StartOptions }, resumeMessages: Map<string, FirstMessage>): Promise<Guarded> {
  const appSessionId = record.appId;
  if (args.message !== null) resumeMessages.set(appSessionId, args.message);
  const handBack = (outcome: StartOutcome): [StartOutcome, null] => {
    resumeMessages.delete(appSessionId);
    return [outcome, null];
  };
  if (record.archived) return handBack({ status: 'archived', appSessionId });
  const verdict = await holderAuthority({ dispatch: s.dispatch, sessions: s.sessions }, { engineSessionId: record.engineSessionId, appSessionId });
  if (verdict.live === 'self') return handBack({ status: 'already_live', appSessionId });
  if (verdict.live === 'foreign') return handBack({ status: 'held', appSessionId, holder: verdict.holder, attach: await attachOf(s, verdict.holder) });
  if (!(await isDirectory(record.directory))) return handBack({ status: 'missing_directory', appSessionId, directory: record.directory });
  const decision = args.options.trust === 'accepted' || args.options.trust === 'declined' ? args.options.trust : null;
  if (decision === null) {
    const trust: TrustState = await trustStateOf(record.directory, { git: s.git, env: s.env });
    if (!trust.trusted) return [{ status: 'needs_trust', appSessionId, trust }, null];
  }
  const message = resumeMessages.get(appSessionId) ?? null;
  const run = () => runResume(s, record, { decision, options: args.options, message, onSent: () => resumeMessages.delete(appSessionId) });
  return [{ status: 'starting', appSessionId }, run];
}

async function attachOf(s: Setup, holder: SessionRecord['holder']): Promise<{ jobId: string; command: string } | null> {
  if (holder.kind !== 'background_job' || holder.jobId === null) return null;
  const binary = await hostCall(s.dispatch, 'engine.binaryInfo', undefined);
  return { jobId: holder.jobId, command: attachCommand(binary.path, holder.jobId) };
}
