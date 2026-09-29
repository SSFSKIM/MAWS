// What the holder notice offers for a session held elsewhere (C10 execution document, Actions and Attach; M5): a
// background job with a known id attaches in a terminal tab (the engine's own `claude attach`), and any holder can be
// forked into a copy MAWS runs (the engine allows a fork beside a `--bg` holder, and reads another holder's file as a
// snapshot). Rendered by C5's `HolderNotice` in place of its placeholder button; never on the Overview card (§5.2).
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { attachOrSay } from './attach';
import { forkInPlace } from './record-ops';

type ForeignHolder = Extract<SessionRecord['holder'], { kind: 'terminal' | 'background_job' }>;

const BUTTON = 'rounded-sm border border-border px-2 py-0.5 whitespace-nowrap hover:bg-bg-hover disabled:text-fg-faint';

// The pinned binary's version, for the note beside Attach when the job runs another (the attach still uses the pinned one).
function usePinnedVersion(wanted: boolean): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void ipc.invoke('engine.binaryInfo', undefined).then((result) => {
      if (live && result.ok) setVersion(result.value.expectedVersion);
    });
    return () => {
      live = false;
    };
  }, [wanted]);
  return version;
}

export function HolderActions({ appSessionId, holder }: { appSessionId: AppSessionId; holder: ForeignHolder }) {
  const attachable = holder.kind === 'background_job' && holder.jobId !== null;
  // the version the job's transcript was last written with: the job's own binary
  const jobVersion = useSessions((s) => s.records.get(appSessionId)?.engineVersion ?? null);
  const pinned = usePinnedVersion(attachable);
  const [attaching, setAttaching] = useState(false);

  const attach = () => {
    setAttaching(true);
    void attachOrSay(appSessionId).finally(() => setAttaching(false));
  };

  return (
    <>
      {attachable && pinned !== null && jobVersion !== null && jobVersion !== pinned && (
        <span className="whitespace-nowrap text-fg-faint">
          Job on {jobVersion}; attach runs {pinned}
        </span>
      )}
      {attachable && (
        <button type="button" className={BUTTON} disabled={attaching} onClick={attach}>
          Attach in a terminal tab
        </button>
      )}
      <button type="button" className={BUTTON} onClick={() => void forkInPlace(appSessionId)}>
        Fork a copy
      </button>
    </>
  );
}
