// What the holder notice offers for a session held elsewhere (C10 execution document, Actions and Attach; M5): a
// background job with a known id attaches in a terminal tab (the engine's own `claude attach`), and any holder can be
// forked into a copy MAWS runs (the engine allows a fork beside a `--bg` holder, and reads another holder's file as a
// snapshot). Rendered by C5's `HolderNotice` in place of its placeholder button; never on the Overview card (§5.2).
// Ticket 627: for a session on another machine over RL2, Take over is drawn disabled with the window's helper's sentence,
// before any confirmation: that machine takes no `session.takeOver` from here; board ticket 815: greyed, it keeps Tab and
// its sentence is its tip and its description.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable';
import { attachOrSay } from './attach';
import { canTakeOver, forkInPlace, takeOverSession } from './record-ops';
import { Tip, UNAVAILABLE_LOOK, UnavailableButton } from '../ui/tip';

type ForeignHolder = Extract<SessionRecord['holder'], { kind: 'terminal' | 'background_job' }>;

const BUTTON = 'rounded-sm border border-border px-2 py-0.5 whitespace-nowrap hover:bg-bg-hover disabled:text-fg-faint';

// The installed binary's version (W13: what attach runs), for Attach's note when the job runs another: the
// session's machine's, where the attach runs (P5 O6).
function useInstalledVersion(wanted: boolean, machine: MachineRef): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void ipc.invoke('engine.binaryInfo', undefined, { machine }).then((result) => {
      if (live && result.ok) setVersion(result.value.version);
    });
    return () => {
      live = false;
    };
  }, [wanted, machine]);
  return version;
}

export function HolderActions({ appSessionId, holder }: { appSessionId: AppSessionId; holder: ForeignHolder }) {
  const attachable = holder.kind === 'background_job' && holder.jobId !== null;
  // the version the job's transcript was last written with: the job's own binary
  const jobVersion = useSessions((s) => s.records.get(appSessionId)?.engineVersion ?? null);
  const installed = useInstalledVersion(attachable, machineOf(appSessionId));
  const [attaching, setAttaching] = useState(false);
  const [takingOver, setTakingOver] = useState(false); // W7
  const takeOverUnavailable = useRemoteUnavailable(appSessionId, 'session.takeOver');
  const versionNote = attachable && installed !== null && jobVersion !== null && jobVersion !== installed ? `Job on ${jobVersion}; attach runs the installed ${installed}` : null;

  const attach = () => {
    setAttaching(true);
    void attachOrSay(appSessionId).finally(() => setAttaching(false));
  };

  return (
    <>
      {/* the word cut (W101): a version mismatch is Attach's tooltip and description, not a line before it */}
      {attachable && (
        <Tip content={versionNote} description={versionNote}>
          <button type="button" className={BUTTON} disabled={attaching} onClick={attach}>
            Attach in a terminal tab
          </button>
        </Tip>
      )}
      {/* W7: end the holder after a confirm, then resume here (D-12 as amended 2026-10-01) */}
      {canTakeOver(holder) && (
        <UnavailableButton reason={takeOverUnavailable}>
          <button
            type="button"
            className={`${BUTTON} ${UNAVAILABLE_LOOK}`}
            disabled={takingOver}
            onClick={() => {
              setTakingOver(true);
              void takeOverSession(appSessionId, holder).finally(() => setTakingOver(false));
            }}
          >
            Take over here
          </button>
        </UnavailableButton>
      )}
      <button type="button" className={BUTTON} onClick={() => void forkInPlace(appSessionId)}>
        Fork a copy
      </button>
    </>
  );
}
