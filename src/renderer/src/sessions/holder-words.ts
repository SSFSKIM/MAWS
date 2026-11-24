// Who holds a session, in words (C10's refusals, toasts and the cleanup dialog's skipped list), and the toast that says
// so. Nothing here attaches, so the setup store can name a holder without importing the actions that attach to one.
import type { ForeignHolder, SessionRecord } from '@shared/graph/session';
import { toast, type Notice } from '../stores/notices';

// The holder "Take over here" can end: an interactive terminal (signalled), or a `--bg` job with the id `claude stop`
// takes. A job MAWS cannot name is left to "Fork a copy". Here rather than beside the take-over in `record-ops.ts`, whose
// imports reach the terminal registry and the settings store: the lane A port imports this, and desk-web imports the port
// through the agents store, so a page with no Electron bridge would otherwise load MAWS's terminal stack.
export const canTakeOver = (holder: ForeignHolder): boolean => holder.kind === 'terminal' || holder.jobId !== null;

export function holderWords(holder: SessionRecord['holder']): string {
  switch (holder.kind) {
    case 'terminal':
      return `terminal · ${holder.pid}`;
    case 'background_job':
      return holder.jobId === null ? 'a background job' : `bg · ${holder.jobId}`;
    case 'self':
      return 'Working in MAWS';
    case 'none':
      return 'no holder';
  }
}

// The toast's words (the word cut, W33): where the session runs, with no pid or job id; "Held by …" for any other holder.
function heldToastWords(holder: SessionRecord['holder']): string {
  if (holder.kind === 'terminal') return 'Running in Terminal';
  if (holder.kind === 'background_job') return 'Running as a background job';
  return `Held by ${holderWords(holder)}`;
}

// Where a session someone else holds runs, with the actions the caller offers (the job's Attach, from `sessions/attach.ts`).
export function toastHeld(holder: SessionRecord['holder'], actions: Notice['actions'] = [], id?: string /* P2-A: one notice per start */): void {
  toast({ ...(id !== undefined && { id }), level: 'warning', text: heldToastWords(holder), actions, dismissible: true });
}
