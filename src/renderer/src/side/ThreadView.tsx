// One side thread in its parent's Side pane (E3 execution document, Design §6): a header naming what the thread is
// about (a file or PR line opens its file at the line in the parent's context; a page URL is text until E4's browser
// exists) with Open as tab, then the thread itself as `SessionPane` draws any session: its transcript, docked request,
// holder notice, setup state and composer, no second implementation of any. One `SessionPane` per session: while a main
// tab shows the thread (Open as tab), the pane says so with Go to tab instead, and closing that tab brings it back.
// While the pane draws the thread on screen it is published as shown, so the thread's unread mark clears as a main
// tab's would. A thread continued from side questions has no anchor to name: its header shows the opening question,
// read from the thread's own first prompt (the promotion message, whose tag parses to the `none` anchor `btw`). A `/btw`
// typed in the thread's composer answers under the thread, in this pane (the architect's ruling): the thread's own
// question view (`BtwView`, keyed by the thread) opens beneath it, and the header's toggle hides and shows it while the
// thread has side questions.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { tabId } from '@shared/ipc/schema/layout';
import { SessionPane } from '../session/SessionPane';
import { QUIET, SECONDARY } from '../sessions/ui';
import { useLayout } from '../stores/layout';
import { isOpen } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../transcript';
import type { Row } from '../transcript/model/rows';
import { BtwView } from './BtwView';
import { SIDE_COPY } from './copy';
import { hideSideChild, setInlineQuestions, showSideChild, sidePaneOf, useSidePane } from './store';
// E4d start
import { openBrowserUrl } from '../tools/browser/comment/actions';
import { COMMENT_COPY } from '../tools/browser/comment/copy';
// E4d end

const COPY = SIDE_COPY.pane;

// The first question of a promoted thread: the first `Q:` line of its promotion prompt (the user row whose anchor is
// the promotion's), wherever the prompt sits (a thread read from disk begins with the parent's copied history). The
// last such prompt is the thread's own: one promoted inside a promoted thread copies its parent's promotion first.
export function promotionQuestionOf(rows: readonly Row[]): string | null {
  const prompt = rows.findLast((row) => row.kind === 'user' && row.anchor?.kind === 'none' && row.anchor.locator === 'btw');
  if (prompt?.kind !== 'user') return null;
  const line = prompt.text.split('\n').find((l) => l.startsWith('Q: '));
  return line === undefined ? null : line.slice(3).trim() || null;
}

export function ThreadView({ parent, child, visible }: { parent: AppSessionId; child: AppSessionId; visible: boolean }) {
  const lineage = useSessions((s) => s.records.get(child)?.lineage ?? null);
  const promoted = lineage?.openedBy === 'btw';
  const question = useTranscriptStore((s) => (promoted ? promotionQuestionOf(s.entries[child]?.rows ?? []) : null));
  const childTab = tabId({ kind: 'session', appSessionId: child });
  const inMain = useLayout((s) => isOpen(s.main, childTab));
  const drawn = visible && !inMain;
  const questionsOpen = useSidePane((s) => sidePaneOf(s, child).inlineQuestions);
  const asked = useSidePane((s) => (sidePaneOf(s, child).exchanges?.length ?? 0) > 0);

  useEffect(() => {
    if (!drawn) return;
    showSideChild(parent, child);
    return () => hideSideChild(parent, child);
  }, [drawn, parent, child]);

  const anchor = lineage?.anchor ?? null;
  const label = SIDE_COPY.label(anchor?.label ?? null, lineage?.openedBy ?? null);
  const path = anchor?.path;
  // E4d start
  const pageUrl = anchor?.kind === 'browser-element' ? anchor.pageUrl : undefined;
  // E4d end

  return (
    <div data-side-thread-view={child} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          {path !== undefined ? (
            <button
              type="button"
              title={anchor?.locator}
              onClick={() => useLayout.getState().openTab({ kind: 'file', path, line: anchor?.line ?? null, appSessionId: parent })}
              className="max-w-full truncate rounded-sm font-mono text-ui-sm text-fg outline-accent hover:underline focus-visible:outline-2"
              aria-label={COPY.openFile(label)}
            >
              {label}
            </button>
          ) : (
            <p className="m-0 truncate font-mono text-ui-sm text-fg">{label}</p>
          )}
          {/* E4d start: a page element's URL is a button opening the page in the parent's browser, where the commented tab
              lives (E4d execution document, Design §10): `child` maps to its own parent there, as the chip in its transcript
              does, even when `parent` is itself a thread; E3's text line for any other anchor's URL, moved inside the block */}
          {pageUrl !== undefined ? (
            <button
              type="button"
              title={COMMENT_COPY.openInBrowser}
              onClick={() => openBrowserUrl(child, pageUrl)}
              className="block max-w-full truncate rounded-sm text-left text-ui-sm text-fg-muted outline-accent hover:text-fg hover:underline focus-visible:outline-2"
            >
              {pageUrl}
            </button>
          ) : (
            anchor?.pageUrl !== undefined && <p className="m-0 truncate text-ui-sm text-fg-muted" title={anchor.pageUrl}>{anchor.pageUrl}</p>
          )}
          {/* E4d end */}
          {question !== null && (
            <p data-side-question="" className="m-0 truncate text-ui-sm text-fg-muted" title={question}>
              {question}
            </p>
          )}
        </div>
        {!inMain && (questionsOpen || asked) && (
          <button
            type="button"
            aria-pressed={questionsOpen}
            title={COPY.questionsTitle}
            aria-label={COPY.questionsLabel}
            className={`${QUIET} font-mono text-ui-sm aria-pressed:bg-bg-active aria-pressed:text-fg`}
            onClick={() => setInlineQuestions(child, !questionsOpen)}
          >
            {COPY.questions}
          </button>
        )}
        {!inMain && (
          <button type="button" className={`${QUIET} text-ui-sm`} onClick={() => useLayout.getState().openTab({ kind: 'session', appSessionId: child })}>
            {COPY.openAsTab}
          </button>
        )}
      </header>
      {inMain ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="m-0 text-ui text-fg-muted">{COPY.shownInMain}</p>
          <button type="button" className={SECONDARY} onClick={() => useLayout.getState().activateTab(childTab)}>
            {COPY.goToTab}
          </button>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <SessionPane appSessionId={child} paneIndex={1} />
          </div>
          {questionsOpen && (
            <div className="flex h-[45%] min-h-[180px] shrink-0 flex-col border-t border-border">
              <BtwView parent={child} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
