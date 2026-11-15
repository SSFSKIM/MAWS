// UX wave U10b (M5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.4, §C.5): Undo of an agent's delete,
// the one control the transcript's row and an editor's notice share. What either shows is read, not remembered: whether
// the library of the artifact's machine lists the artifact (null until that read has answered), and the sentence Undo is
// disabled with on another machine (UC-7's `disabledWords`). The act is disabled while it runs, so a second press sends
// nothing; an act that ends without its effect leaves its sentence until the next press.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { disabledWords } from '@shared/ipc/remote-unavailable';
import type { MachineRef } from '@shared/machine/ref';
import { useLinkPhase } from '../app/machine-mark';
import { subscribeDeletedReplicas, unsentWhileDeleted } from '../artifacts/deleted-replicas';
import { recordArtifactMachine, sessionArtifactMachine } from '../artifacts/machines';
import { ipc } from '../ipc/client';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { useLibraryRow } from './store';

export interface UndoAct {
  busy: boolean; // the act is in flight
  failure: string | null; // the sentence of the last act that ended without its effect
  press(): void;
}

/** The act behind Undo. `undo` resolves null once the artifact is live again, else the sentence to show. */
export function useUndoAct(undo: () => Promise<string | null>): UndoAct {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const running = useRef(false); // a second press in the same tick sends nothing either
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const press = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    void undo().then((sentence) => {
      running.current = false;
      if (!mounted.current) return;
      setBusy(false);
      setFailure(sentence);
    });
  }, [undo]);
  return { busy, failure, press };
}

/** Whether the library of the artifact's machine lists it: null until the read has answered. */
export function useListed(artifactId: string): boolean | null {
  const read = useLibraryRow(artifactId);
  // fix wave 4 (the ruling's predicate): a row is restoration only as a successful read's answer; a read refused since
  // keeps its last good row (library/store.ts), which proves nothing, so it is not known (a read under way keeps the last
  // successful answer: nothing has contradicted it yet)
  if (read.status === 'error' || read.value === undefined) return null;
  return read.value !== null;
}

/**
 * For the row of a session's call: the artifact's machine recorded as the side column's open records it
 * (`sessionArtifactMachine`), so the library is read there, also for an artifact the window has never listed. The record
 * is the effect declared first, so it runs before the library's watch reads the machine.
 */
export function useSessionArtifactListed(appSessionId: AppSessionId | null, artifactId: string): boolean | null {
  useEffect(() => recordArtifactMachine(artifactId, sessionArtifactMachine(appSessionId, artifactId, ipc.localMachine), ipc.localMachine), [appSessionId, artifactId]);
  return useListed(artifactId);
}

/** Why the row's Undo is disabled for a session on another machine (the one helper every session control reads). */
export const useSessionUndoUnavailable = (appSessionId: AppSessionId | null): string | null => useRemoteUnavailable(appSessionId, 'artifacts.undelete');

/**
 * The same sentence for an editor's notice, which knows the artifact's machine and no session: `disabledWords` for that
 * machine's standing as the roster and the link's phase say it; null for this Mac's artifact.
 */
export function useMachineUndoUnavailable(machine: MachineRef): string | null {
  const local = machine === ipc.localMachine;
  const name = useMachines((s) => machineName(s.machines, machine, ipc.localMachine));
  const phase = useLinkPhase(machine);
  const listed = useMachines((s) => s.machines.get(machine)?.capabilities?.join('\n'));
  const owner = useMachines((s) => s.machines.get(machine)?.owner ?? null);
  if (local) return null;
  return disabledWords('artifacts.undelete', { machine: name, phase, capabilities: listed === undefined ? null : listed.split('\n').filter(Boolean), owner });
}

/** Whether a replica of the artifact waiting for its restore holds an edit the host never acknowledged (the notice's
 * "Your last edit is not saved"); the store's own snapshot, so a compiled render follows it. */
export function useUnsentWhileDeleted(artifactId: string): boolean {
  return useSyncExternalStore(subscribeDeletedReplicas, () => unsentWhileDeleted(artifactId));
}
