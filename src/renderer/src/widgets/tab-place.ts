// Where an unstarted tab's dialogs read from (UX wave U11a, §D, l8-settings-03): a New chat with nothing sent has no
// session record and no engine, but its setup intent holds the location the person chose. The Plugins, Connectors and
// Skills dialogs branch on this before the frame's own read (which would say "Available once the session starts").
// `started`: the dialogs read the session, as before. `remote`: the tab is set to start on another machine (the machine
// menu's spawn target, as composer/Composer.tsx computes it, or an id another machine holds); this Mac's configuration is
// not that machine's, so nothing is read. `local`: the folder whose configuration a launch here would read
// (`settingsDirectoryOf`: the folder itself, or the repository's root for a worktree not yet made), null with no location
// chosen (the user configuration), and the place the dialogs name.
import { useEffect, useMemo, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { useSpawnTarget } from '../sessions/remote-spawn';
import { useSetup } from '../sessions/store';
import { intentProjectName, settingsDirectoryOf } from '../sessions/useSetupIntent';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { homeAbbreviated } from '../tools/session-info/model';
import { BEFORE_START } from './copy';

export type TabPlace =
  | { kind: 'started' } // the dialogs read the session, as today
  | { kind: 'remote'; machine: string } // an unstarted tab set to another machine: that machine's name
  | { kind: 'local'; folder: string | null; place: string }; // an unstarted tab on this Mac

const STARTED: TabPlace = { kind: 'started' };

// Unstarted is `useSetupIntent(appSessionId) !== null`: an intent, and not both a record and an engine status. It is read
// here from the same two stores rather than through the hook, whose option reads (the model catalogue, the trust check)
// would run again for every dialog. A menu drawn with no session id is `started` and reads nothing.
export function useTabPlace(appSessionId: AppSessionId | undefined): TabPlace {
  const intent = useSetup((s) => (appSessionId === undefined ? null : (s.intents.get(appSessionId) ?? null)));
  const started = useSessions((s) => appSessionId !== undefined && s.records.has(appSessionId) && s.engine.has(appSessionId));
  const unstarted = intent !== null && !started;
  const project = useSessions((s) => (unstarted && intent.projectId !== null ? (s.projects.get(intent.projectId) ?? null) : null));
  // the org project the machine menu chose a place for: the intent's project once a location is chosen (Composer's key)
  const key = unstarted && intent.location !== null ? (project?.org?.key ?? null) : null;
  const target = useSpawnTarget(unstarted ? appSessionId : undefined, key);
  const elsewhere = unstarted && machineOf(appSessionId!) !== ipc.localMachine ? machineOf(appSessionId!) : null;
  const elsewhereName = useMachines((s) => (elsewhere === null ? null : machineName(s.machines, elsewhere, ipc.localMachine)));
  return useMemo((): TabPlace => {
    if (!unstarted) return STARTED;
    if (target !== null) return { kind: 'remote', machine: target.name };
    if (elsewhereName !== null) return { kind: 'remote', machine: elsewhereName };
    const folder = intent.location === null ? null : settingsDirectoryOf(intent.location);
    return { kind: 'local', folder, place: intentProjectName(intent, project) ?? (folder === null ? BEFORE_START.userConfiguration : homeAbbreviated(folder)) };
  }, [unstarted, target, elsewhereName, intent, project]);
}

// A dialog open while its tab moves to another machine closes: what it listed is this Mac's (§D).
export function useCloseOnLeavingForRemote(place: TabPlace, close: () => void): void {
  const was = useRef(place.kind);
  useEffect(() => {
    const before = was.current;
    was.current = place.kind;
    if (before !== 'remote' && place.kind === 'remote') close();
  }, [place.kind, close]);
}
