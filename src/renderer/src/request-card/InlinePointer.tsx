// The transcript's compact row for a request its session's composer has docked (C7 execution document, Placements):
// the card lives below, so the transcript points at it; a click puts focus on the docked frame (the pane's own first,
// else any frame of the session).
import type { AppSessionId } from '@shared/graph/ids';

export function InlinePointer({ appSessionId, what }: { appSessionId: AppSessionId; what: string }) {
  const focusDocked = (from: HTMLElement) => {
    const selector = `[data-docked-frame="${CSS.escape(appSessionId)}"]`;
    const frame = from.closest('[data-pane]')?.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector);
    frame?.focus();
  };
  return (
    <button
      type="button"
      onClick={(event) => focusDocked(event.currentTarget)}
      className="flex w-full items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-left text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2"
    >
      <span aria-hidden className="text-warning">
        ◐
      </span>
      Waiting for you · {what} · answer below ↓
    </button>
  );
}
