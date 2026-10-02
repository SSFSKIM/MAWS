// The location chip's git facts (C7 execution document, "Composer frame" Location; M4 decisions): C4's `git.watch` on
// mount (its answer is the first status), `git.changed` after, `git.unwatch` on unmount; one watch per composer mount.
// Null until the first answer. W9 (H2): a refused watch is answered too, with C4's reason, so the chip can tell a folder
// that is no repository (no branch label) from one git has not answered yet (sessions/branch-label.ts).
import { useEffect, useState } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import type { GitStatus } from '@shared/ipc/schema/git';
import { ipc } from '../../ipc/client';

export type GitWatch = { status: GitStatus; error: null } | { status: null; error: string };

export function useGitWatch(directory: string | null, client: MawsBridge = ipc): GitWatch | null {
  const [watch, setWatch] = useState<{ directory: string; answer: GitWatch } | null>(null);
  useEffect(() => {
    if (!directory) return;
    let live = true;
    let repoRoot: string | null = null;
    const off = client.on('git.changed', (e) => {
      if (live && repoRoot !== null && e.repoRoot === repoRoot) setWatch({ directory, answer: { status: e.status, error: null } });
    });
    const landed = client.invoke('git.watch', { directory }).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setWatch({ directory, answer: { status: null, error: result.error.message } });
        return;
      }
      repoRoot = result.value.repoRoot;
      setWatch({ directory, answer: { status: result.value, error: null } });
    });
    return () => {
      live = false;
      off();
      // Main acquires ownership only after its asynchronous repository reads; release cannot overtake that acquire.
      void landed.then(() => client.invoke('git.unwatch', { directory }));
    };
  }, [directory, client]);
  return watch !== null && watch.directory === directory ? watch.answer : null;
}
