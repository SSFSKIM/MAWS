// In place of the composer for a foreign-live session (D-12): who holds it and that MAWS only reads it, with what can be
// done about it (C10's actions: attach to a background job in a terminal tab, fork a copy).
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { HolderActions } from '../sessions/HolderActions'; // C10

export function HolderNotice({ appSessionId, holder }: { appSessionId: AppSessionId; holder: Extract<SessionRecord['holder'], { kind: 'terminal' | 'background_job' }> }) {
  const pid = holder.pid === null ? '' : ` · pid ${holder.pid}`;
  const text = holder.kind === 'terminal' ? `Live in Terminal${pid} · read-only` : `Live as background job${pid} · read-only`;
  return (
    <div role="note" className="flex items-center gap-3 rounded-lg border border-border bg-bg-raised px-3 py-2.5 text-ui-sm text-fg-muted">
      <span aria-hidden className="text-info">
        ⌁
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {/* C10 start: Attach in a terminal tab (a job with a known id) and Fork a copy (any holder) */}
      <HolderActions appSessionId={appSessionId} holder={holder} />
      {/* C10 end */}
    </div>
  );
}
