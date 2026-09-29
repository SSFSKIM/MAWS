// Who holds a session, in words (C10's refusals, toasts and the cleanup dialog's skipped list). Pure, so the setup
// store can name a holder without importing the actions that attach to one.
import type { SessionRecord } from '@shared/graph/session';

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
