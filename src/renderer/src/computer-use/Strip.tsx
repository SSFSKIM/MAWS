// The computer-use strip (the UX wave's U12a, l9-browser-delivery-07; Interfaces §E, §G): one line across the top of a
// session's full pane while the agent runs a computer-use call, "Computer use running" with Stop, and after a Stop
// that withdrew a running call, "Computer use may still be finishing a step" with Dismiss. Its form follows Claude
// Desktop's banner; its words claim only what MAWS can see, that a cell runs. The element has no height: its line lies
// over the transcript's top edge, so nothing below it moves. Law 2's later step (the plugin drawing its own state as a
// mod surface) replaces this mount.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable';
import { useSessionControls } from '../session/controls/controls-for';
import type { SessionControls } from '../session/controls/types';
import { toast } from '../stores/notices';
import { COMPUTER_USE_COPY } from './copy';
import { useComputerUse } from './strip-state';

const BUTTON = 'ml-auto h-6 shrink-0 rounded-sm border border-border px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

export function ComputerUseStrip({ appSessionId }: { appSessionId: AppSessionId }) {
  const { state, dismiss } = useComputerUse(appSessionId);
  const controls = useSessionControls(appSessionId);
  const unavailable = useRemoteUnavailable(appSessionId, 'session.interrupt');
  if (state.kind === 'absent') return null;
  const running = state.kind === 'running';
  const capability = running && controls !== null ? controls.capability('interrupt') : null;
  const reason = unavailable ?? (capability !== null && !capability.available ? capability.reason : null);
  return (
    <div className="relative z-10 h-0 shrink-0" data-computer-use-strip={state.kind}>
      <div role="status" className="absolute inset-x-0 top-0 flex min-h-8 items-center gap-2 border-b border-border bg-bg-raised px-4 py-1 text-ui-sm text-fg">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full bg-accent ${running ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
        <span className="min-w-0 truncate">{running ? COMPUTER_USE_COPY.running : COMPUTER_USE_COPY.lingering}</span>
        {running ? (
          // its press belongs to this turn's running line, and goes with it
          controls !== null && <StopButton key={state.turnId} controls={controls} reason={reason} />
        ) : (
          <button type="button" onClick={dismiss} className={BUTTON}>
            {COMPUTER_USE_COPY.dismiss}
          </button>
        )}
      </div>
    </div>
  );
}

// The composer's Stop: the turn's interrupt, holding what is queued. Disabled with the sentence that says why when it
// cannot work; once pressed, busy until its line goes, unless refused, which enables it again and says why.
function StopButton({ controls, reason }: { controls: SessionControls; reason: string | null }) {
  const [busy, setBusy] = useState(false);
  const stop = () => {
    setBusy(true);
    void controls.interrupt({ cancelEngineQueued: false, holdEngineQueued: true }).then((result) => {
      if (result.ok) return;
      setBusy(false);
      toast({ level: 'warning', text: result.error.message, actions: [], dismissible: true });
    });
  };
  return (
    <button type="button" onClick={stop} disabled={busy || reason !== null} aria-busy={busy || undefined} title={reason ?? undefined} aria-description={reason ?? undefined} className={BUTTON}>
      {COMPUTER_USE_COPY.stop}
    </button>
  );
}
