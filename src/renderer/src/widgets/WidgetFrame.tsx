// C11's chrome inside every widget (C11 execution document, Terms "Widget frame"; mockup 06 vignette 05): a head with
// the title and the `/name`, and a body that scrolls inside its cap (W3: the floating dialog's, up to 60% of the window).
// E11's sitting (owner-notes 00-consolidated-plan §2.2) removed the provenance foot C11 and E8 D-12 required: what a
// change writes, its scope and any lock are said beside its control or in its sheet. The body gives way to the loading line,
// the error, or C7's not-running sentence for a read that needs a ready process. C7 places it (W3: the app's floating
// dialog); the frame owns no position. It takes focus when it opens, and Esc closes it and hands the keyboard back to
// the session's composer.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { WidgetSize } from '../composer/WidgetDialog'; // P2-B (2026-10-09)
import { NOT_RUNNING } from '../statusline/mode-menu';
import { useComposerStore } from '../stores/composer';
import { FRAME } from './copy';
import type { ReadState } from './read';

export interface WidgetFrameProps {
  appSessionId: AppSessionId;
  title: string;
  command: string; // the palette name, shown as `/name`
  state: ReadState;
  error: string | null; // in place of the body when state is 'error'; above the kept body when 'ready' (a later read failed)
  close(): void;
  children?: ReactNode;
  // P2-B start (2026-10-09): X19 (the P2-B execution document §5.2). `library`: the frame fills the dialog's fixed box,
  // its head carries `heading` after the title (My items | Browse) and `toolbar` before the `/name` (Search, Filter, Sort,
  // Add or Reload), and its body takes the remaining height without scrolling itself (the list pane and the detail
  // inside it scroll). `utility`, the default, is the frame as it was.
  size?: WidgetSize;
  heading?: ReactNode;
  toolbar?: ReactNode;
  // P2-B end
}

// P2-B start (2026-10-09)
const isTextField = (el: Element | null): boolean => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
// `/` (no modifier, the keyboard not in a text field) focuses the library's search field (Desktop,
// readable/app-2.16120.0/web/app/v1/c13348442-Cgf_p4WP.js:266-277): a key handler on the frame, not a global listener.
function focusSearch(event: KeyboardEvent<HTMLDivElement>): boolean {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTextField(event.target as Element)) return false;
  const field = event.currentTarget.querySelector<HTMLInputElement>('[data-widget-search]');
  if (!field) return false;
  event.preventDefault();
  field.focus();
  return true;
}
// P2-B end

export function WidgetFrame({ appSessionId, title, command, state, error, close, children, size = 'utility', heading, toolbar }: WidgetFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) root.current?.focus();
  }, []);

  let body: ReactNode;
  if (state === 'not_running') body = <p className="m-0 text-fg-muted">{NOT_RUNNING}</p>;
  else if (state === 'loading') body = <p className="m-0 text-fg-muted">{FRAME.reading}</p>;
  else if (state === 'error')
    body = (
      <p role="alert" className="m-0 text-danger">
        {error}
      </p>
    );
  else
    body = (
      <>
        {error !== null && (
          <p role="status" className="m-0 mb-1 text-ui-sm text-warning">
            {error}
          </p>
        )}
        {children}
      </>
    );

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-widget={command}
      data-widget-size={size} // P2-B (2026-10-09)
      className={`flex min-w-0 flex-col text-ui outline-none ${size === 'library' ? 'min-h-0 flex-1' : ''}`}
      onKeyDown={(event) => {
        // P2-B start (2026-10-09): `/` focuses the search field; an Escape a field or an inner layer already handled
        // (a non-empty search cleared, E8 D-16's sheet), or one bubbling through React from a layer portalled outside
        // this frame's DOM (the Filter, Sort and Add menus), is not the frame's
        if (focusSearch(event)) return;
        if (event.key === 'Escape' && (event.defaultPrevented || !event.currentTarget.contains(event.target as Node))) return;
        // P2-B end
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
        useComposerStore.getState().focusTargets.get(appSessionId)?.focusEditor();
      }}
    >
      {/* P2-B start (2026-10-09): the library's head: title and heading at the left, the toolbar at the right */}
      <header className={size === 'library' ? 'flex min-h-9 items-center gap-3 border-b border-border px-2 pb-2' : 'flex items-baseline justify-between gap-3 border-b border-border px-2 pb-2'}>
        <h3 className="m-0 shrink-0 text-ui font-semibold">{title}</h3>
        {size === 'library' && heading}
        <span className={size === 'library' ? 'ml-auto flex min-w-0 items-center gap-2' : 'flex items-baseline gap-2'}>
          {size === 'library' && toolbar}
          {/* P2-B end */}
          <code className="font-mono text-ui-sm text-fg-muted">/{command}</code>
          <button type="button" aria-label={FRAME.close(title)} onClick={close} className="rounded-sm px-1 text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
            ×
          </button>
        </span>
      </header>
      {/* P2-B (2026-10-09): the library's body takes the remaining height; its panes scroll */}
      <div data-widget-body className={size === 'library' ? 'flex min-h-0 flex-1 flex-col pt-2' : 'max-h-[60vh] overflow-y-auto px-2 py-2'}>
        {body}
      </div>
    </div>
  );
}
