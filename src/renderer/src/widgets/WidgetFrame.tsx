// C11's chrome inside every widget (C11 execution document, Terms "Widget frame"; mockup 06 vignette 05): a head with
// the title and the `/name`, and a body that scrolls inside its cap (W3: the floating dialog's, up to 60% of the window).
// E11's sitting (owner-notes 00-consolidated-plan §2.2) removed the provenance foot C11 and E8 D-12 required: what a
// change writes, its scope and any lock are said beside its control or in its sheet. The body gives way to the loading
// line or the error. C7 places it (W3: the app's floating dialog); the frame owns no position. It takes focus when it
// opens, and Esc closes it and hands the keyboard back to the session's composer.
// P2-A (2026-10-09; the execution document §5.6): on a session with a record and no ready process the frame owns three
// states for every widget, from its `appSessionId`: dormant ("Not read yet." with Load now; or, when the consumer
// passes when its cached answer was read, the body under "Read <relative>" with Refresh), starting ("Starting…" above
// any body) and unavailable (the words; a terminal or a job holding the session offers the holder's actions in place of
// the button). Load now and Refresh are the owner's gesture that starts the engine; opening the frame starts nothing.
import { useEffect, useRef, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { relativeAge } from '../app/relative-age';
import { useComposerStore } from '../stores/composer';
import { FRAME } from './copy';
import { DormantGesture } from './DormantGesture';
import type { ReadState } from './read';

export interface WidgetFrameProps {
  appSessionId: AppSessionId;
  title: string;
  command: string; // the palette name, shown as `/name`
  state: ReadState;
  error: string | null; // in place of the body when state is 'error'; above the kept body when 'ready' (a later read failed); unavailable: why
  readAt?: number | null; // P2-A: when the body's answer was read; a dormant frame shows that body, dated, only when given
  close(): void;
  children?: ReactNode;
}

// P2-A start (2026-10-09): the body on a session with no ready process; the line is every surface's (`DormantGesture`)
function dormantBody(appSessionId: AppSessionId, state: 'dormant' | 'starting' | 'unavailable', error: string | null, readAt: number | null | undefined, children: ReactNode): ReactNode {
  const cached = typeof readAt === 'number';
  const lead = state !== 'dormant' ? null : cached ? FRAME.readAgo(relativeAge(Math.max(0, Date.now() - readAt))) : FRAME.notRead;
  return (
    <>
      <DormantGesture appSessionId={appSessionId} label={cached ? FRAME.refresh : FRAME.loadNow} lead={lead} words={state === 'unavailable' ? error : null} starting={state === 'starting'} />
      {cached ? children : null}
    </>
  );
}
// P2-A end

export function WidgetFrame({ appSessionId, title, command, state, error, readAt, close, children }: WidgetFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) root.current?.focus();
  }, []);
  let body: ReactNode;
  if (state === 'dormant' || state === 'starting' || state === 'unavailable') body = dormantBody(appSessionId, state, error, readAt, children);
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
