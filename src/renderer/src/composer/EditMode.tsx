// Edit mode's chrome (C7 execution document, "Edit-and-resubmit and the fork seam"): the state line above the frame,
// which says where the resubmit stands and carries its explicit controls, and the confirm the explicit rewind asks
// before it acts. What each control does is `resubmit-seam.ts`'s; the Composer wires them.
import { AlertDialog } from 'radix-ui';
import type { Resubmit } from '../stores/composer';

const BUTTON = 'rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint';

export interface EditModeLineProps {
  resubmit: Resubmit;
  onLeave(): void; // Esc's twin: leaves edit mode, the text kept
  onRetry(): void; // rewound, the send failed: sends again, never rewinds
  onRewindAgain(): void;
  onSendWithoutRewinding(): void;
  onKeepEditing(): void;
}

// What the line says in each state; `warn` states read in the warning tone.
function lineCopy({ state, exited, sendFailed }: Resubmit): { text: string; warn: boolean } {
  switch (state) {
    case 'rewinding':
      return { text: 'Rewinding this session to that message…', warn: false };
    case 'rewind_uncertain':
      return { text: 'Rewind unconfirmed · checking the transcript…', warn: true };
    case 'rewind_unresolved':
      return { text: 'The rewind could not be confirmed', warn: true };
    case 'rewound_awaiting_send':
      return sendFailed ? { text: 'Rewound · the message was not sent', warn: true } : { text: 'Rewound · send your edited message', warn: false };
    default:
      return exited
        ? { text: 'The engine exited before the rewind was confirmed · your edited text is kept', warn: true }
        : { text: 'Editing an earlier message · sending forks this session from here', warn: false };
  }
}

export function EditModeLine({ resubmit, onLeave, onRetry, onRewindAgain, onSendWithoutRewinding, onKeepEditing }: EditModeLineProps) {
  const { text, warn } = lineCopy(resubmit);
  const leavable = resubmit.state !== 'rewinding' && resubmit.state !== 'rewind_uncertain';
  return (
    <div data-edit-mode={resubmit.state} className={`mx-auto flex w-full max-w-[720px] min-w-0 items-center gap-1 rounded-md border-l-2 bg-bg-raised px-2.5 py-1 text-ui-sm ${warn ? 'border-warning' : 'border-accent'}`}>
      <span role="status" className={`min-w-0 flex-1 truncate ${warn ? 'text-warning' : 'text-fg-muted'}`}>
        {text}
      </span>
      {resubmit.state === 'rewound_awaiting_send' && resubmit.sendFailed && (
        <button type="button" className={BUTTON} onClick={onRetry}>
          Retry
        </button>
      )}
      {resubmit.state === 'rewind_unresolved' && (
        <>
          <button type="button" className={BUTTON} onClick={onRewindAgain}>
            Rewind again
          </button>
          <button type="button" className={BUTTON} onClick={onSendWithoutRewinding}>
            Send without rewinding
          </button>
          <button type="button" className={BUTTON} onClick={onKeepEditing}>
            Keep editing
          </button>
        </>
      )}
      {leavable && resubmit.state !== 'rewind_unresolved' && (
        <button type="button" aria-label="Leave edit mode" title="Leave edit mode (Esc)" className={BUTTON} onClick={onLeave}>
          ×
        </button>
      )}
    </div>
  );
}

export interface RewindConfirmProps {
  newerTurn: boolean; // the transcript's newest message is no longer the seen cursor
  onConfirm(): void;
  onCancel(): void;
}

// Asked on every Send in edit mode while no fork provider is registered: the explicit rewind is the human's decision.
export function RewindConfirm({ newerTurn, onConfirm, onCancel }: RewindConfirmProps) {
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-bg opacity-60" />
        <AlertDialog.Content className="fixed top-[24%] left-1/2 z-50 flex w-[min(440px,90vw)] -translate-x-1/2 flex-col gap-3 rounded-lg border border-border-strong bg-bg-overlay p-4 text-ui text-fg">
          <AlertDialog.Title className="m-0 text-ui font-semibold">{newerTurn ? 'Rewind past a newer turn?' : 'Rewind and resend?'}</AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-fg-muted">
            {newerTurn ? 'A newer turn started after you began editing. Rewinding discards it too. Rewind anyway?' : 'Forking arrives with C10. Rewind this session to that message and resend instead?'}
          </AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel className="rounded-sm border border-border px-2 py-0.5 text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">Cancel</AlertDialog.Cancel>
            <AlertDialog.Action className="rounded-sm bg-accent px-2 py-0.5 text-bg outline-accent hover:opacity-90 focus-visible:outline-2" onClick={onConfirm}>
              {newerTurn ? 'Rewind anyway' : 'Rewind and resend'}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
