// The location chip's git facts (C7 execution document, "Composer frame" Location; M4 decisions): C4's `git.watch` on
// mount (its answer is the first status), `git.changed` after, `git.unwatch` on unmount; one watch per composer mount.
// Null until the first answer. W9 (H2): a refused watch is answered too, with C4's reason, so the chip can tell a folder
// that is no repository (no branch label) from one git has not answered yet (sessions/branch-label.ts).
// P5 O6 M4: the directory is the session's machine's, which every call names and whose `git.changed` alone it takes.
// P5 O7 M4: and every call names the session, by which another machine bounds the checkout read (the checkout rule).
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { GitStatus } from '@shared/ipc/schema/git';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../../ipc/client';
import { pathTarget } from '../../ipc/machine';

export type GitWatch = { status: GitStatus; error: null } | { status: null; error: string };

export function useGitWatch(appSessionId: AppSessionId, directory: string | null, client: MawsBridge = ipc): GitWatch | null {
  const machine = machineOf(appSessionId);
  const [watch, setWatch] = useState<{ machine: MachineRef; directory: string; answer: GitWatch } | null>(null);
  useEffect(() => {
    if (!directory) return;
    let live = true;
    let repoRoot: string | null = null;
    const off = client.on('git.changed', (e, from) => {
      if (live && repoRoot !== null && from.machine === machine && e.repoRoot === repoRoot) setWatch({ machine, directory, answer: { status: e.status, error: null } });
    });
    const landed = client.invoke('git.watch', { directory }, pathTarget(machine, appSessionId)).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setWatch({ machine, directory, answer: { status: null, error: result.error.message } });
        return;
      }
      repoRoot = result.value.repoRoot;
      setWatch({ machine, directory, answer: { status: result.value, error: null } });
    });
    return () => {
      live = false;
      off();
      // Main acquires ownership only after its asynchronous repository reads; release cannot overtake that acquire.
      void landed.then(() => client.invoke('git.unwatch', { directory }, pathTarget(machine, appSessionId)));
    };
  }, [machine, appSessionId, directory, client]);
  return watch !== null && watch.machine === machine && watch.directory === directory ? watch.answer : null;
}
