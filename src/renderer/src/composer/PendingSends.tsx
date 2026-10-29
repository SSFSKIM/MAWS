// The pending-send strip (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, "Send in the composer"): above
// a lane A composer, each send whose fate the bridge had not named when `laneA.send` answered, with its own text, so no
// words are lost and the draft typed since is never touched. An entry leaves once its words entered; a refused one shows
// the bridge's reason, and one whose stream went before it said shows "may not have arrived", each with Send again (a
// new key) and Dismiss. The lane A store keeps the entries (`pendingSends`), following the session's deliveries.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { sessionControls } from '../session/controls/controls-for';
import { dismissPendingSend, useLaneA, type PendingSend } from '../stores/lane-a';
import { toast } from '../stores/notices';

export const PENDING_SEND = {
  label: 'Messages not confirmed yet',
  sending: 'Sending…',
  refused: (reason: string | null) => (reason ? `Not entered: ${reason}` : 'Not entered'),
  unconfirmed: 'May not have arrived',
  again: 'Send again',
  dismiss: 'Dismiss',
};

const NONE: readonly PendingSend[] = [];
const BUTTON = 'shrink-0 rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';

async function sendAgain(appSessionId: AppSessionId, send: PendingSend, client: MawsBridge): Promise<void> {
  const controls = sessionControls(appSessionId, client);
  if (!controls) return;
  try {
    const result = await controls.send(send.text, { origin: 'composer' });
    if (result.disposition === 'refused') toast({ level: 'warning', text: result.reason ?? 'The message was not sent', actions: [], dismissible: true });
    else dismissPendingSend(appSessionId, send.key); // entered, or held again under its new key
  } catch (error) {
    toast({ level: 'warning', text: error instanceof Error ? error.message : String(error), actions: [], dismissible: true });
  }
}

export function PendingSends({ appSessionId, client = ipc }: { appSessionId: AppSessionId; client?: MawsBridge }) {
  const sends = useLaneA((s) => s.pendingSends.get(appSessionId) ?? NONE);
  if (sends.length === 0) return null;
  return (
    <ul aria-label={PENDING_SEND.label} className="m-0 flex list-none flex-col gap-1 p-0">
      {sends.map((send) => (
        <li key={`${send.key.writer}:${send.key.seq}`} data-pending-send={send.state} className="flex min-w-0 items-baseline gap-2 rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-ui-sm">
          <span className="min-w-0 flex-1 truncate text-fg" title={send.text}>
            {send.text}
          </span>
          <span className={`shrink-0 ${send.state === 'refused' ? 'text-danger' : 'text-fg-muted'}`}>
            {send.state === 'sending' ? PENDING_SEND.sending : send.state === 'refused' ? PENDING_SEND.refused(send.reason) : PENDING_SEND.unconfirmed}
          </span>
          {send.state !== 'sending' && (
            <>
              <button type="button" className={BUTTON} onClick={() => void sendAgain(appSessionId, send, client)}>
                {PENDING_SEND.again}
              </button>
              <button type="button" className={BUTTON} onClick={() => dismissPendingSend(appSessionId, send.key)}>
                {PENDING_SEND.dismiss}
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
