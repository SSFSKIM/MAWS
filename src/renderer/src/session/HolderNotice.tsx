// In place of the composer for a foreign-live session (D-12): who holds it and that MAWS only reads it, with what can be
// done about it (C10's actions: attach to a background job in a terminal tab, fork a copy). P5 O9 M5: a session whose
// sminos bridge answered but can't be driven (it is starting, it observes, or its sminos predates MAWS's controls) adds
// one line with the bridge's reason; a session with no bridge reads exactly as before.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { HolderActions } from '../sessions/HolderActions'; // C10

export function HolderNotice({ appSessionId, holder, reason = null }: { appSessionId: AppSessionId; holder: Extract<SessionRecord['holder'], { kind: 'terminal' | 'background_job' }>; reason?: string | null }) {
  const pid = holder.pid === null ? '' : ` · pid ${holder.pid}`;
  const text = holder.kind === 'terminal' ? `Live in Terminal${pid} · read-only` : `Live as background job${pid} · read-only`;
  const line = (
    <>
      <span aria-hidden className="text-info">
        ⌁
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {/* C10 start: Attach in a terminal tab (a job with a known id) and Fork a copy (any holder) */}
      <HolderActions appSessionId={appSessionId} holder={holder} />
      {/* C10 end */}
    </>
  );
  if (reason === null) {
    return (
      <div role="note" className="flex items-center gap-3 rounded-lg border border-border bg-bg-raised px-3 py-2.5 text-ui-sm text-fg-muted">
        {line}
      </div>
    );
  }
  // P5 O9 M5: the same line, and under it why the session's bridge can't drive it
  return (
    <div role="note" className="flex flex-col gap-1 rounded-lg border border-border bg-bg-raised px-3 py-2.5 text-ui-sm text-fg-muted">
      <div className="flex items-center gap-3">{line}</div>
      <p data-bridge-reason className="m-0 pl-6 text-fg-faint">
        {reason.charAt(0).toUpperCase() + reason.slice(1)}
      </p>
    </div>
  );
}
