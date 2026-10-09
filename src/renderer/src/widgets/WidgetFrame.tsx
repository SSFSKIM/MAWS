// C11's chrome inside every widget (C11 execution document, Terms "Widget frame"; mockup 06 vignette 05): a head with
// the title and the `/name`, and a body that scrolls inside its cap (W3: the floating dialog's, up to 60% of the window).
// E11's sitting (owner-notes 00-consolidated-plan §2.2) removed the provenance foot C11 and E8 D-12 required: what a
// change writes, its scope and any lock are said beside its control or in its sheet. The body gives way to the loading line,
// the error, or C7's not-running sentence for a read that needs a ready process. C7 places it (W3: the app's floating
// dialog); the frame owns no position. It takes focus when it opens, and Esc closes it and hands the keyboard back to
// the session's composer.
import { useEffect, useRef, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
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
}

export function WidgetFrame({ appSessionId, title, command, state, error, close, children }: WidgetFrameProps) {
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
      className="flex min-w-0 flex-col text-ui outline-none"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
        useComposerStore.getState().focusTargets.get(appSessionId)?.focusEditor();
      }}
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-2 pb-2">
        <h3 className="m-0 text-ui font-semibold">{title}</h3>
        <span className="flex items-baseline gap-2">
          <code className="font-mono text-ui-sm text-fg-muted">/{command}</code>
          <button type="button" aria-label={FRAME.close(title)} onClick={close} className="rounded-sm px-1 text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
            ×
          </button>
        </span>
      </header>
      <div className="max-h-[60vh] overflow-y-auto px-2 py-2">{body}</div>
    </div>
  );
}
