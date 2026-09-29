// The location chip's git facts (C7 execution document, "Composer frame" Location; M4 decisions): C4's `git.watch` on
// mount (its answer is the first status), `git.changed` after, `git.unwatch` on unmount; one watch per composer mount.
// Null until the first answer (the chip's branch reads `—`) and for a directory that is not a repository.
import { useEffect, useState } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import type { GitStatus } from '@shared/ipc/schema/git';
import { ipc } from '../../ipc/client';

export function useGitWatch(directory: string | null, client: MawsBridge = ipc): GitStatus | null {
  const [status, setStatus] = useState<{ directory: string; status: GitStatus } | null>(null);
  useEffect(() => {
    if (!directory) return;
    let live = true;
    let repoRoot: string | null = null;
    const off = client.on('git.changed', (e) => {
      if (live && repoRoot !== null && e.repoRoot === repoRoot) setStatus({ directory, status: e.status });
    });
    void client.invoke('git.watch', { directory }).then((result) => {
      if (!live || !result.ok) return;
      repoRoot = result.value.repoRoot;
      setStatus({ directory, status: result.value });
    });
    return () => {
      live = false;
      off();
      void client.invoke('git.unwatch', { directory });
    };
  }, [directory, client]);
  return status !== null && status.directory === directory ? status.status : null;
}
