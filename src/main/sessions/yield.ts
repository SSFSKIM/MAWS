// W7 (charter §4.3 as amended 2026-10-01; docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md, F1): a live MAWS
// process yields when a foreign process that resumed the same session starts writing into it. The engine host reports
// that first write (`fs.foreignWrite`, once per contest); MAWS posts a notice in the session, pauses its queue while it
// holds messages so none starts on its own branch (an empty queue is never paused: it would silently hold the resumed
// session's next send, queue.ts), and stops its process as soon as nothing would be lost by it (`canYield`: no turn, no
// work in flight, no pending request, no background task). A turn in flight finishes first. The stop is
// `session.stop { ifIdle }`, which the host decides against the process as it is then: a send or an engine turn that
// began after the status this read answers `skipped`, and a later status tries again.
// After the exit the index re-applies the foreign holder and the pane follows the transcript read-only.
import { randomUUID } from 'node:crypto';
import { canYield, type EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { ForeignHolder, SessionRecord } from '@shared/graph/session';
import type { HostDispatch } from '../ipc/router';
import { hostCall, type Emit, type HostEvents } from './context';

export interface YieldDeps {
  dispatch: HostDispatch;
  onEvent: HostEvents;
  sessions: { getByEngineId(sessionId: SessionId): SessionRecord | null };
  emit: Emit;
  now?: () => string;
  log?: (message: string) => void;
}

export { canYield } from '@shared/engine/status';

// The holder as the notice names it (the row's own words: `Terminal · pid N`, `bg · <short>`).
export function holderPhrase(holder: ForeignHolder): string {
  if (holder.kind === 'terminal') return `A terminal (pid ${holder.pid})`;
  if (holder.jobId !== null) return `A background job (bg · ${holder.jobId})`;
  return holder.pid === null ? 'A background job' : `A background job (pid ${holder.pid})`;
}

// The notice, an event main synthesises for the session (`isAppSynthesised`: its id under the app id, `seq` null), so
// the read model keeps it and a transcript rebuilt from disk after the exit still shows it.
export function yieldNotice(appSessionId: AppSessionId, sessionId: SessionId, holder: ForeignHolder, at: string): SessionEvent {
  return {
    id: `${appSessionId}:w7:yield:${randomUUID()}`, sessionId, at, seq: null, agentId: null, parentToolUseId: null,
    kind: 'notice.posted', level: 'warning', key: 'session:yielded',
    text: `${holderPhrase(holder)} started writing this session. MAWS stops its own process once it is idle and follows the transcript read-only.`,
  } as SessionEvent;
}

export function startYield(deps: YieldDeps): () => void {
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? ((message: string) => console.warn(`[sessions] ${message}`));
  const yielding = new Set<AppSessionId>();
  const stopping = new Set<AppSessionId>();
  // the queue paused while it holds messages (so a turn's end releases none), the process stopped once it can yield
  const step = (appSessionId: AppSessionId, status: EngineSessionStatus) => {
    if (status.queue.length > 0 && !status.queue.paused) {
      hostCall(deps.dispatch, 'session.queue.setPaused', { appSessionId, paused: true }).catch((error: unknown) =>
        log(`${appSessionId}: could not pause the queue while yielding: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    if (canYield(status)) stop(appSessionId);
  };
  const stop = (appSessionId: AppSessionId) => {
    if (stopping.has(appSessionId)) return;
    stopping.add(appSessionId);
    hostCall(deps.dispatch, 'session.stop', { appSessionId, reason: 'stop', ifIdle: true }).then(
      (answer) => void (answer.skipped === true && stopping.delete(appSessionId)), // work began meanwhile: the next status tries again
      (error: unknown) => {
        stopping.delete(appSessionId); // the next status tries again
        log(`${appSessionId}: could not yield to the other writer: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  };
  const offs = [
    deps.onEvent('fs.foreignWrite', ({ sessionId, holder }) => {
      const record = deps.sessions.getByEngineId(sessionId as SessionId);
      if (record === null || record.holder.kind !== 'self' || yielding.has(record.appId)) return; // MAWS does not run it (any more)
      const id = record.appId;
      yielding.add(id);
      deps.emit('session.eventBatch', { appSessionId: id, events: [yieldNotice(id, sessionId as SessionId, holder, now())] });
      hostCall(deps.dispatch, 'session.status', { appSessionId: id }).then(
        (status) => yielding.has(id) && step(id, status),
        (error: unknown) => log(`${id}: could not begin yielding to the other writer: ${error instanceof Error ? error.message : String(error)}`),
      );
    }),
    deps.onEvent('session.status', ({ appSessionId, status }) => {
      const id = appSessionId as AppSessionId;
      if (!yielding.has(id)) return;
      if (status.process === 'exited') {
        yielding.delete(id);
        stopping.delete(id);
      } else step(id, status);
    }),
  ];
  return () => offs.forEach((off) => off());
}
