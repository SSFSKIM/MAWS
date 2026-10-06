// The Source control tool's notice line (E6 execution document, Design §5): the last refusal or failed call of a
// mutation, in main's words, with what git printed (both streams, a failing hook's included) behind a disclosure.
// It stays until the next mutation succeeds or the owner dismisses it.
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { SCM_COPY } from './copy';
import type { ScmNotice, ScmUi } from './view-state';

export function noticeText(notice: ScmNotice): string {
  if (notice.kind === 'error') return SCM_COPY.failed(notice.text);
  if (notice.kind === 'git_failed') return SCM_COPY.gitFailed(notice.text);
  return notice.text;
}

export function Notice({ ui }: { ui: StoreApi<ScmUi> }) {
  const notice = useStore(ui, (s) => s.notice);
  if (notice === null) return null;
  return (
    <div role="alert" data-scm-notice={notice.kind} className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-1.5">
      <div className="flex items-start gap-2">
        <span data-scm-notice-text className="min-w-0 flex-1 text-ui-sm break-words text-danger">
          {noticeText(notice)}
        </span>
        <button type="button" aria-label={SCM_COPY.dismiss} title={SCM_COPY.dismiss} onClick={() => ui.setState({ notice: null })} className="shrink-0 rounded-sm px-1 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg">
          ×
        </button>
      </div>
      {notice.output !== '' ? <PrintedOutput text={notice.output} /> : null}
    </div>
  );
}

// What a command printed, monospace and wrapped, closed until asked for.
export function PrintedOutput({ text }: { text: string }) {
  return (
    <details className="text-ui-sm text-fg-muted">
      <summary className="cursor-default select-none hover:text-fg">{SCM_COPY.showOutput}</summary>
      <pre className="mt-1 max-h-48 overflow-y-auto rounded-sm border border-border bg-bg-raised px-2 py-1 font-mono text-ui-sm break-words whitespace-pre-wrap text-fg">{text}</pre>
    </details>
  );
}
