// Handoff recovery (C10 execution document, Interfaces "Handoff recovery"): at app start an intent whose record exists
// (`createForLaunch` ran) is settled against three facts and never re-run from scratch, so no restart sends a first
// message twice or launches on its own (D-16). The facts: `sent`, the handoff was recorded (`progress.send`);
// `transcript`, the pin's transcript exists; `queue`, C3's persisted queue for the id has an entry (C3's documented
// `unknown session` reads as empty; any other error is this intent's reconciliation failure, and nothing moves).
//
// (a) any fact: the message is delivered or C3's. The record is bound to the pin when its transcript exists, unbound
//     when it does not (so the next launch is a fresh pinned session rather than `--resume` against nothing), and left
//     as it is when a `/clear` rebound it to another id; the intent goes.
// (b) none: the message never reached C3. The provisional record is removed as rollback removes it (the tab survives
//     through C5's retention, whose predicate is the retained intent), and the intent stays failed with its message,
//     its pin and any worktree, for the failure card's Retry.
import type { AppSessionId } from '@shared/graph/ids';
import type { SetupIntent } from '@shared/sessions/intent';
import type { SetupResources } from '@shared/sessions/setup';
import { hostCall, isUnknownSession, pathExists, transcriptPathOf } from './context';
import { retainedWorktree, type Setup } from './setup';

export type Reconciled = 'none' | 'handed_off' | 'not_started';

export async function reconcileIntent(s: Setup, intent: SetupIntent): Promise<Reconciled> {
  const appSessionId = intent.appSessionId;
  const record = s.sessions.get(appSessionId);
  if (record === null) return 'none'; // nothing reached `launching`
  const pin = intent.progress.engineSessionId;
  const sent = intent.progress.send !== null;
  const transcript = pin !== null && (await pathExists(await transcriptPathOf(s.env, record.directory, pin)));
  const queued = sent || transcript ? false : await queueHolds(s, appSessionId);

  if (sent || transcript || queued) {
    const rebound = record.engineSessionId !== null && pin !== null && record.engineSessionId !== pin; // a `/clear` in the first message
    if (!rebound) {
      if (transcript) s.sessions.bindEngineId(appSessionId, pin!);
      else if (record.engineSessionId !== null) s.sessions.unbindEngineId(appSessionId);
    }
    await s.intents.remove(appSessionId);
    s.emit('session.intent.changed', { appSessionId, intent: null });
    return 'handed_off';
  }

  s.sessions.remove(appSessionId);
  const resources: SetupResources = { worktree: retainedWorktree(intent), record: 'removed', transcript: 'none' };
  const next: SetupIntent = { ...intent, updatedAt: s.now(), progress: { ...intent.progress, lastFailure: { at: s.now(), phase: 'launching', message: 'MAWS quit before the session started', resources } } };
  await s.intents.put(next);
  s.emit('session.intent.changed', { appSessionId, intent: next });
  return 'not_started';
}

// An intent with no record whose start was cut short: the app quit in the `worktree` or `trusting` phase, or while a
// trust or relay card waited for the human (that card lived in the renderer only). It still holds its first message,
// or a checkout the attempt created, and nothing failed, so its tab would show no card and no way forward. It is
// marked failed as the quit left it, the phase the furthest its progress shows, so the tab's failure card offers Retry
// (which re-runs the guards and docks the trust or relay card again) and the retained checkout's two resolutions. An
// intent already failed keeps its own account. Runs at start before the bootstrap ids are forgotten, whose note is
// what shows a quit in the trust bootstrap.
export async function markInterrupted(s: Setup, intent: SetupIntent): Promise<void> {
  const p = intent.progress;
  const holds = intent.message !== null || p.worktree?.createdHere === true;
  if (!holds || p.send !== null || p.lastFailure !== null || s.sessions.get(intent.appSessionId) !== null) return;
  const phase = p.launch !== null ? 'launching' : p.bootstrap !== null || p.trustRecorded ? 'trusting' : 'worktree';
  const resources: SetupResources = { worktree: retainedWorktree(intent), record: 'none', transcript: 'none' };
  const next: SetupIntent = { ...intent, updatedAt: s.now(), progress: { ...p, lastFailure: { at: s.now(), phase, message: 'MAWS quit before the session started', resources } } };
  await s.intents.put(next);
  s.emit('session.intent.changed', { appSessionId: intent.appSessionId, intent: next });
}

async function queueHolds(s: Setup, appSessionId: AppSessionId): Promise<boolean> {
  try {
    return (await hostCall(s.dispatch, 'session.queue.list', { appSessionId })).entries.length > 0;
  } catch (error) {
    if (isUnknownSession(error)) return false; // no reservation and no store file: the app died before `session.launch`
    throw error;
  }
}
