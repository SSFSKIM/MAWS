// C11's chrome inside every widget (C11 execution document, Terms "Widget frame"; mockup 06 vignette 05): a head with
// the title and the `/name`, a body that scrolls inside a 420 px cap, and a foot naming the read or control the widget
// used and what it will not edit. The body gives way to the loading line, the error, or C7's not-running sentence for
// a read that needs a ready process. C7 places the popover; the frame owns no position. It takes focus when it opens,
// and Esc closes it and hands the keyboard back to the session's composer.
import { useEffect, useRef, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { NOT_RUNNING } from '../statusline';
import { useComposerStore } from '../stores/composer';
import { READING, type WidgetFoot } from './copy';
import type { ReadState } from './read';

// A sentence with `code` spans in backticks, rendered with the spans in mono.
export function Sentence({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="font-mono text-ui-sm">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export interface WidgetFrameProps {
  appSessionId: AppSessionId;
  title: string;
  command: string; // the palette name, shown as `/name`
  foot: WidgetFoot;
  state: ReadState;
  error: string | null;
  close(): void;
  children?: ReactNode;
}

export function WidgetFrame({ appSessionId, title, command, foot, state, error, close, children }: WidgetFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) root.current?.focus();
  }, []);

  let body: ReactNode;
  if (state === 'not_running') body = <p className="m-0 text-fg-muted">{NOT_RUNNING}</p>;
  else if (state === 'loading') body = <p className="m-0 text-fg-muted">{READING}</p>;
  else if (state === 'error')
    body = (
      <p role="alert" className="m-0 text-danger">
        {error}
      </p>
    );
  else body = children;

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
          <button type="button" aria-label={`Close ${title}`} onClick={close} className="rounded-sm px-1 text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
            ×
          </button>
        </span>
      </header>
      <div className="max-h-[420px] overflow-y-auto px-2 py-2">{body}</div>
      <footer className="border-t border-border px-2 pt-2 text-ui-sm text-fg-muted">
        Read with <code className="font-mono text-ui-sm">{foot.readWith}</code>
        {foot.editedWhere !== null && (
          <>
            {' · '}
            <Sentence text={foot.editedWhere} />
          </>
        )}
      </footer>
    </div>
  );
}
