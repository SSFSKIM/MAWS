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
//
// E10 (Design 5, "Startup recovery with kept sessions"): sessions no longer die with the app. A keep-quit leaves them
// running on the detached supervisor, so recovery reads the host's table first (`liveRows`): an intent whose row is
// live is handed off before any fact is read (its record stays as C4 bound it, and a first message C3 queued is the
// host's to deliver), and the boot stops a live bootstrap row before forgetting it (service.ts). One path serves both
// host modes: a utility host never holds a row at an app start, so there the live set is empty and nothing changes.
//
// E11 (tracker row E10 "setup intent's first message lost on a quit"): a keep-quit or crash between a row reaching
// `ready` and the setup's `session.send` leaves the first message in the intent alone. Before a live row is handed off,
// a first message with no recorded handoff is sent when the row is ready and idle (no turn, no host work), C3's queue
// holds nothing for it and the pin has no transcript, so the message never reached C3; the handoff is recorded before
// the intent goes, as the setup records it. A row still initializing cannot take a send (C3 refuses one before ready),
// and a fork with a rewind point would need its rewind first: both are handed off as before.
//
// E11 (tracker row E3 "quit before finishBinding leaves a side thread unrenamed"): a side thread's intent handed off
// here was never bound (the setup's `finishBinding` removes the intent after binding), so the hand-off binds it as the
// setup would have: the thread renamed through the engine (or in the index when the engine refuses, as for a thread
// whose process is gone) and its `opened` row recorded and shown in the parent's transcript. A bind the quit
// interrupted after its rename runs again harmlessly: the rename repeats and the row is inserted or ignored.
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SetupIntent } from '@shared/sessions/intent';
import type { SetupResources } from '@shared/sessions/setup';
import type { HostDispatch } from '../ipc/router';
import { hostCall, isUnknownSession, pathExists, transcriptPathOf } from './context';
import { reconcileWorktree } from './intent-rules';
import { bindSideThread, retainedWorktree, type Setup } from './setup';

export type Reconciled = 'none' | 'handed_off' | 'not_started';

// The host's live rows by app id (`process` not `exited`); throws when `engine.sessions` cannot be answered.
export type LiveRows = ReadonlyMap<AppSessionId, EngineSessionStatus>;

export async function liveRows(dispatch: HostDispatch): Promise<LiveRows> {
  const table = await hostCall(dispatch, 'engine.sessions', undefined);
  return new Map(table.filter((row) => row.process !== 'exited').map((row) => [row.appSessionId, row]));
}

export async function reconcileIntent(s: Setup, intent: SetupIntent, live: LiveRows): Promise<Reconciled> {
  const appSessionId = intent.appSessionId;
  const record = s.sessions.get(appSessionId);
  if (record === null) return 'none'; // nothing reached `launching`
  const row = live.get(appSessionId);
  if (row) {
    await sendUnsent(s, intent, record.directory, row); // E11
    return handOff(s, intent); // E10: the row ran on while the app was away
  }
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
    return handOff(s, intent);
  }

  s.sessions.remove(appSessionId);
  const resources: SetupResources = { worktree: retainedWorktree(intent), record: 'removed', transcript: 'none' };
  const next: SetupIntent = { ...intent, updatedAt: s.now(), progress: { ...intent.progress, lastFailure: { at: s.now(), phase: 'launching', message: 'MAWS quit before the session started', resources } } };
  await s.intents.put(next);
  s.emit('session.intent.changed', { appSessionId, intent: next });
  return 'not_started';
}

async function sendUnsent(s: Setup, intent: SetupIntent, directory: string, row: EngineSessionStatus): Promise<void> {
  const { appSessionId, message, progress } = intent;
  if (message === null || progress.send !== null) return;
  if (row.process !== 'ready' || row.turn !== null || row.busy) return;
  if (intent.kind === 'fork' && (intent.source?.rewindTo ?? null) !== null) return;
  const pin = progress.engineSessionId;
  if (pin !== null && (await pathExists(await transcriptPathOf(s.env, directory, pin)))) return;
  if (await queueHolds(s, appSessionId)) return;
  const sent = await hostCall(s.dispatch, 'session.send', { appSessionId, content: message.content });
  await s.intents.put({ ...intent, updatedAt: s.now(), progress: { ...progress, send: { queueId: sent.queueId, messageUuid: sent.messageUuid, disposition: sent.disposition, at: s.now() } } });
}

async function handOff(s: Setup, intent: SetupIntent): Promise<Reconciled> {
  const appSessionId = intent.appSessionId;
  if (intent.lineage?.kind === 'side-thread') await bindSideThread(s, appSessionId, intent.lineage); // E11
  await s.intents.remove(appSessionId);
  s.emit('session.intent.changed', { appSessionId, intent: null });
  return 'handed_off';
}

// An intent with no record whose start was cut short: the app quit in the `worktree` or `trusting` phase, or while a
// trust or relay card waited for the human (that card lived in the renderer only). It still holds its first message,
// or a checkout the attempt created, and nothing failed, so its tab would show no card and no way forward. It is
// marked failed as the quit left it, the phase the furthest its progress shows, so the tab's failure card offers Retry
// (which re-runs the guards and docks the trust or relay card again) and the retained checkout's two resolutions. An
// intent already failed keeps its own account. Runs at start before the bootstrap ids are forgotten, whose note is
// what shows a quit in the trust bootstrap.
export async function markInterrupted(s: Setup, intent: SetupIntent): Promise<void> {
  const worktree = await reconcileWorktree(s, intent);
  if (worktree !== intent.progress.worktree) {
    intent = { ...intent, updatedAt: s.now(), progress: { ...intent.progress, worktree } };
    await s.intents.put(intent);
    s.emit('session.intent.changed', { appSessionId: intent.appSessionId, intent });
  }
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
