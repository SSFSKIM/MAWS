// The route switch's confirm sheet (C11 execution document, Interfaces "Gateway", *The switch*; mockup 06 vignette 02's
// confirm as a small confirmation dialog of the kind C10 uses, D-20): what restarts and what is kept, the background work
// that stops with the process (C10's disclosure; the button then reads `Stop them and switch`), and, for a Direct target
// on a gateway model, the Claude model the restart needs before it can be confirmed. Rendered by the gateway's dialog
// host for the one session whose switch is asking; the answer goes to the switch's state machine.
import { AlertDialog } from 'radix-ui';
import { useShallow } from 'zustand/react/shallow';
import type { AppSessionId } from '@shared/graph/ids';
import { BackgroundWorkDisclosure } from './c10-seam';
import { SWITCH } from './copy';
import { DIALOG, DirectModelDialog, DirectModelList, useDirectChoice } from './DirectModelSheet';
import { useGateway, type SwitchConfirm } from './store';
import { answerSwitch, switchButtonLabel, type SwitchAnswer } from './switch-route';

const NO_MODEL: SwitchAnswer = { model: null, displayName: null, effort: null };

export function SwitchSheet({ appSessionId, confirm, error, answer = answerSwitch }: { appSessionId: AppSessionId; confirm: SwitchConfirm; error: string | null; answer?: typeof answerSwitch }) {
  const direct = useDirectChoice(appSessionId, confirm.model, false, confirm.requiresModel); // no catalogue read without a model to choose
  const reply = confirm.requiresModel ? direct.answer : NO_MODEL;
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && answer(appSessionId, null)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={DIALOG.overlay} />
        <AlertDialog.Content aria-describedby={undefined} data-switch-sheet={appSessionId} className={DIALOG.content}>
          <AlertDialog.Title className="m-0 text-ui font-semibold">{SWITCH.title(confirm.target)}</AlertDialog.Title>
          <div className="flex flex-col gap-1 text-fg-muted">
            <p className="m-0">{SWITCH.body}</p>
            <p className="m-0">{SWITCH.effect[confirm.target]}</p>
          </div>
          {error && (
            <p role="alert" className="m-0 text-ui-sm text-warning">
              {error}
            </p>
          )}
          {confirm.backgroundTasks.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="m-0 font-medium">{SWITCH.backgroundLead}</p>
              <BackgroundWorkDisclosure tasks={confirm.backgroundTasks} />
            </div>
          )}
          {confirm.requiresModel && <DirectModelList models={direct.models} chosen={direct.row?.value ?? null} pick={direct.pick} />}
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel className={DIALOG.cancel}>{SWITCH.cancel}</AlertDialog.Cancel>
            <AlertDialog.Action
              className={DIALOG.action}
              disabled={reply === null || (confirm.requiresModel && reply.model === null)}
              onClick={(event) => {
                // the machine refuses an answer it cannot use; the sheet then stays open
                if (reply === null || !answer(appSessionId, reply)) event.preventDefault();
              }}
            >
              {switchButtonLabel(confirm)}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// The gateway's dialogs, mounted once by the app: the switch that is asking (one at a time) and `pickDirectModel`'s.
export function GatewayDialogs() {
  const asking = useGateway(
    useShallow((s) => {
      for (const [appSessionId, state] of s.switching) if (state.phase === 'confirming' && state.confirm) return { appSessionId, confirm: state.confirm, error: state.error };
      return { appSessionId: null, confirm: null, error: null };
    }),
  );
  return (
    <>
      {asking.appSessionId !== null && asking.confirm !== null && <SwitchSheet key={`${asking.appSessionId}:${asking.confirm.backgroundTasks.map((t) => t.taskId).join(',')}`} appSessionId={asking.appSessionId} confirm={asking.confirm} error={asking.error} />}
      <DirectModelDialog />
    </>
  );
}
