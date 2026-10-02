// A record's resume (C10 execution document, Interfaces "Session service", Resume): the trust bootstrap under an id of
// its own when the owner accepted trust for a key the engine has not recorded, the disk-to-live handoff, C3's launch
// with `--resume`, and the message sent at `ready`. Nothing rolls back: the record is the conversation's. A failure
// hands the message back (`onFailed`; the renderer returns it to the editor), except C3's `relay_unreachable`, whose
// card's continuation still sends it.
import type { SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { FirstMessage } from '@shared/sessions/intent';
import type { SetupEvent, SetupResources } from '@shared/sessions/setup';
import type { StartOptions } from '@shared/ipc/schema/session';
import { hostCall, pathExists, transcriptPathOf } from './context';
import { holderAuthority } from './holders';
import { LaunchWatch, type LaunchEnd } from './launch-watch';
import { resumeLaunchSpec } from './launch-mapping';
import { passLaunchGate, runBootstrap } from './setup'; // C12: passLaunchGate
import { exitFailure, heldOutcome, HeldFailure, messageOf, RelayFailure, SetupFailure, setupEvent, stopQuietly, takeReplay, WatchdogFailure, type Setup } from './setup-steps';
import { trustStateOf } from './trust';

// C3 corrective: the host's code for an engine that wrote nothing before its first-output bound, and what the retry says
const NO_OUTPUT = 'no_output';
export const RETRY_REASON = 'The engine gave no output for 30 s.';
export const RETRY_DETAIL = 'No output from the engine for 30 s · trying once more';

export async function runResume(
  s: Setup,
  record: SessionRecord,
  input: { decision: 'accepted' | 'declined' | null; options: StartOptions; message: FirstMessage | null; onSent: () => void; onFailed: () => void },
): Promise<void> {
  const appSessionId = record.appId;
  let watch: LaunchWatch | null = null;
  let launched = false;
  try {
    await passLaunchGate(s); // C12: the gate refuses before the trust bootstrap and the handover
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
      // the bootstrap took seconds: a terminal or a job that resumed the conversation meanwhile is found before MAWS
      // becomes its second writer (the guards' read is that old)
      const verdict = await holderAuthority({ dispatch: s.dispatch, sessions: s.sessions }, { engineSessionId: record.engineSessionId, appSessionId });
      if (verdict.live === 'foreign') throw HeldFailure.holding(verdict.holder);
      if (verdict.live === 'self') throw new SetupFailure('launching', 'the session is already running in MAWS');
    }
    setupEvent(s, appSessionId, 'launching', 'Starting');
    // disk-to-live: C4's follower fed the exited session's tab from its transcript; C3's stream takes over
    if (record.engineSessionId !== null) {
      await hostCall(s.dispatch, 'fs.unfollow', { appSessionId, agentId: null }).catch((error: unknown) => {
        throw new SetupFailure('launching', `could not hand the transcript over to the live session: ${messageOf(error)}`);
      });
    }
    const fixture = takeReplay(s, 'launching');
    let spec = resumeLaunchSpec(record, input.options, { trust: attestation, replay: fixture?.path ?? null }, s.settings());
    let end: LaunchEnd;
    let previousLaunchId: string | null = null;
    for (;;) {
      watch = new LaunchWatch(s, appSessionId, previousLaunchId);
      const answer = await hostCall(s.dispatch, 'session.launch', { spec });
      if (answer.status === 'relay_unreachable') throw new RelayFailure(answer.health);
      if (answer.status === 'refused') throw new SetupFailure('launching', `${answer.reason}: ${answer.message}`);
      launched = true;
      previousLaunchId = answer.session.launchId;
      end = await watch.untilReady();
      // C3 corrective: an engine that wrote nothing at all (`init_failed { no_output }`) touched nothing of the session,
      // so the resume launches once more, visibly (the host journals the retry's reconnect rows and a notice); never
      // chained, and the retry's own failure is told as any other
      if (end.kind !== 'exited' || spec.retry !== undefined || !end.codes.includes(NO_OUTPUT)) break;
      watch.dispose();
      watch = null;
      setupEvent(s, appSessionId, 'launching', RETRY_DETAIL);
      spec = { ...spec, retry: { attempt: 2, maxAttempts: 2, reason: RETRY_REASON } };
    }
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
    // a process this resume launched (still starting, or ready with its message refused) stops before the failure is told
    if (launched) await stopQuietly(s, appSessionId);
    const transcript = record.engineSessionId !== null && (await pathExists(await transcriptPathOf(s.env, record.directory, record.engineSessionId)));
    const resources: SetupResources = { worktree: null, record: 'kept', transcript: transcript ? 'kept' : 'none' };
    const outcome: SetupEvent['outcome'] =
      error instanceof RelayFailure ? { kind: 'relay_unreachable', health: error.health } : error instanceof HeldFailure ? await heldOutcome(s, error) : { kind: 'error', message: messageOf(error), resources };
    if (outcome.kind !== 'relay_unreachable') input.onFailed();
    setupEvent(s, appSessionId, 'failed', null, outcome);
  } finally {
    watch?.dispose();
  }
}
