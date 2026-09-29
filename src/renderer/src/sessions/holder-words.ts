// Who holds a session, in words (C10's refusals, toasts and the cleanup dialog's skipped list), and the toast that says
// so. Nothing here attaches, so the setup store can name a holder without importing the actions that attach to one.
import type { SessionRecord } from '@shared/graph/session';
import { toast, type Notice } from '../stores/notices';

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

// "Held by …", with the actions the caller offers (the job's Attach, from `sessions/attach.ts`).
export function toastHeld(holder: SessionRecord['holder'], actions: Notice['actions'] = []): void {
  toast({ level: 'warning', text: `Held by ${holderWords(holder)}`, actions, dismissible: true });
}
