// In place of the composer for a foreign-live session (D-12): who holds it and that MAWS only reads it. A background
// job can later be attached in a terminal tab (C10); until then the button is disabled.
import type { SessionRecord } from '@shared/graph/session';

export function HolderNotice({ holder }: { holder: Extract<SessionRecord['holder'], { kind: 'terminal' | 'background_job' }> }) {
  const pid = holder.pid === null ? '' : ` · pid ${holder.pid}`;
  const text = holder.kind === 'terminal' ? `Live in Terminal${pid} · read-only` : `Live as background job${pid} · read-only`;
  return (
    <div role="note" className="flex items-center gap-3 rounded-lg border border-border bg-bg-raised px-3 py-2.5 text-ui-sm text-fg-muted">
      <span aria-hidden className="text-info">
        ⌁
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {holder.kind === 'background_job' && (
        <button type="button" disabled title="Arrives with C10" className="rounded-sm border border-border px-2 py-0.5 whitespace-nowrap disabled:text-fg-faint">
          Attach in a terminal tab
        </button>
      )}
    </div>
  );
}
