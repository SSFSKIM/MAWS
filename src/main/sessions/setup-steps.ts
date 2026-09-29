// The setup runner's shared parts (C10 execution document, Interfaces "Session service"): the service's dependencies as
// the runner holds them, the failures a setup ends in, and the small steps every launch path takes (a setup event, the
// replay seam's next fixture, a quiet stop, the engine's own refusal read as `held`).
import { randomUUID } from 'node:crypto';
import type { AppSessionId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { SetupEvent, SetupPhase } from '@shared/sessions/setup';
import type { GitRun } from '../git/runner';
import type { WorktreeService } from '../git/worktrees';
import type { SessionStore } from '../index/sessions';
import type { HostDispatch } from '../ipc/router';
import { attachCommand } from '@shared/sessions/attach';
import { bgRefusalOf } from './attach';
import { hostCall, reservationOf, type Emit, type HostEvents } from './context';
import type { BootstrapNotes, IntentStore } from './intents';
import type { C10Settings } from './launch-mapping';
import type { LaunchWatch } from './launch-watch';
import type { ReplaySeam } from './replay-seam';

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
export class WatchdogFailure extends SetupFailure {
  constructor() {
    super('launching', 'no answer from the engine host');
  }
}

export class RelayFailure extends Error {
  constructor(readonly health: RelayHealth) {
    super(`relay unreachable: ${health.error ?? `status ${health.status ?? 'none'}`}`);
  }
}

// The engine's own refusal to resume a session a `--bg` job holds (authoritative over MAWS's holder read).
export class HeldFailure extends Error {
  constructor(
    readonly jobId: string | null,
    text: string,
  ) {
    super(text);
  }
}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---- small steps ---------------------------------------------------------------------------------------------------

export function setupEvent(s: Setup, appSessionId: AppSessionId, phase: SetupPhase, detail: string | null, outcome: SetupEvent['outcome'] = null): void {
  s.emit('session.setup', { appSessionId, phase, detail, outcome });
}

// The next replay fixture, or null without the seam; a spent list refuses the launch.
export function takeReplay(s: Setup, phase: SetupPhase): { path: string; sessionId: SessionId } | null {
  if (s.replay === null) return null;
  const fixture = s.replay.take();
  if (fixture === null) throw new SetupFailure(phase, 'replay_disabled: MAWS_E2E_REPLAY_FIXTURES has no fixture left for this launch');
  return fixture;
}

export async function stopQuietly(s: Setup, appSessionId: AppSessionId): Promise<void> {
  try {
    if ((await reservationOf(s.dispatch, appSessionId)) !== null) await hostCall(s.dispatch, 'session.stop', { appSessionId, reason: 'stop' });
  } catch (error) {
    s.log(`could not stop ${appSessionId}: ${messageOf(error)}`);
  }
}

export function exitFailure(errors: string[]): Error {
  const text = errors.join('\n');
  const refusal = bgRefusalOf(text);
  if (refusal) return new HeldFailure(refusal.jobId, text);
  return new SetupFailure('launching', text.trim() === '' ? 'the engine exited before it was ready' : `the engine exited before it was ready: ${text.trim()}`);
}

export async function heldOutcome(s: Setup, failure: HeldFailure): Promise<Extract<NonNullable<SetupEvent['outcome']>, { kind: 'held' }>> {
  let attach: { jobId: string; command: string } | null = null;
  if (failure.jobId !== null) {
    const binary = await hostCall(s.dispatch, 'engine.binaryInfo', undefined).catch(() => null);
    if (binary) attach = { jobId: failure.jobId, command: attachCommand(binary.path, failure.jobId) };
  }
  return { kind: 'held', holder: { kind: 'background_job', pid: null, jobId: failure.jobId }, attach };
}

// The newest user message the launched session reports, for a fork's rewind (C3 passes it as the human's last seen).
export async function newestUserUuid(s: Setup, appSessionId: AppSessionId): Promise<MessageUuid | null> {
  const snapshot = await hostCall(s.dispatch, 'session.events', { appSessionId, afterSeq: null, limit: null }).catch(() => null);
  const users = (snapshot?.events ?? []).filter((e) => e.kind === 'user.message' && e.messageUuid !== null && !e.isSynthetic);
  const last = users.at(-1);
  return last && last.kind === 'user.message' ? last.messageUuid : null;
}

// Tells the session its launch fell back to the direct route (C11's `relayUnreachable: 'direct'`).
export function directFallbackNotice(s: Setup, appSessionId: AppSessionId, sessionId: SessionId | null): void {
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
