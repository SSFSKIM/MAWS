// A Stop on its way, and a Stop that failed (the UX wave, U9: S-01; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-
// machines.md, M3). The composer's Stop and Esc and the app's ⌘. (composer/ComposerAppKeys.tsx) each make one interrupt
// through the session's controls port and hand it here, on every route. A Stop still out after 300 ms makes the button
// read "Stopping…", disabled, until every Stop out for the session has settled: on another machine an act made while the
// link is down waits under the link's hold for up to a minute, and a button that kept reading Stop would invite more
// presses, each another held act. A failed one shows one notice per session, the mechanism End and Resume use: for a
// session on another machine main's own sentence (UC-7.5, worded by main for the lane's interrupt, the pending sentence
// included), on this Mac and on a socket-linked machine "Not stopped: " and the error. One decision closes every Stop,
// the button's and the shortcuts' alike: none is made while one is out for the session, or while its machine is offline
// (the button reads so; Esc and ⌘. send nothing).
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import { toast } from '../stores/notices';
import { isOverRl2 } from './remote-session';
import { offlineActs, remoteStandingOf } from './remote-standing';

export const STOPPING_AFTER_MS = 300;

const useStops = create<{ stopping: ReadonlySet<AppSessionId> }>()(() => ({ stopping: new Set() }));
const out = new Map<AppSessionId, number>(); // the Stops out per session

const shown = (appSessionId: AppSessionId, on: boolean) =>
  useStops.setState((s) => {
    if (s.stopping.has(appSessionId) === on) return s;
    const stopping = new Set(s.stopping);
    if (on) stopping.add(appSessionId);
    else stopping.delete(appSessionId);
    return { stopping };
  });

/** A failed Stop's sentence on the session's route. */
export const stopFailedWords = (appSessionId: AppSessionId, message: string): string => (isOverRl2(appSessionId) ? message : `Not stopped: ${message}`);

/** Whether a Stop may go now: none out for the session, and its machine not offline. */
export const stopOpen = (appSessionId: AppSessionId): boolean => !out.has(appSessionId) && offlineActs(remoteStandingOf(appSessionId)) === null;

/**
 * Makes one Stop, if one may go now (`stopOpen`), and follows it: "Stopping…" past 300 ms, one notice if it fails.
 * `interrupt` makes it through the session's controls port.
 */
export function followStop(appSessionId: AppSessionId, interrupt: () => Promise<CommandResult<'session.interrupt'>> | undefined): void {
  if (!stopOpen(appSessionId)) return;
  const act = interrupt();
  if (act === undefined) return;
  out.set(appSessionId, (out.get(appSessionId) ?? 0) + 1);
  const timer = setTimeout(() => (out.has(appSessionId) ? shown(appSessionId, true) : undefined), STOPPING_AFTER_MS);
  const settled = (failure: string | null) => {
    clearTimeout(timer);
    const left = (out.get(appSessionId) ?? 1) - 1;
    if (left > 0) out.set(appSessionId, left);
    else {
      out.delete(appSessionId);
      shown(appSessionId, false);
    }
    if (failure !== null) toast({ id: `stop-failed:${appSessionId}`, level: 'warning', text: stopFailedWords(appSessionId, failure), actions: [], dismissible: true });
  };
  void act.then(
    (result) => settled(result.ok ? null : result.error.message),
    (error: unknown) => settled(error instanceof Error ? error.message : String(error)),
  );
}

/** Whether a Stop for the session has been out for more than 300 ms and has not settled. */
export const useStopping = (appSessionId: AppSessionId): boolean => useStops((s) => s.stopping.has(appSessionId));

/** For tests: no Stop out. */
export function resetStops(): void {
  out.clear();
  useStops.setState({ stopping: new Set() });
}
