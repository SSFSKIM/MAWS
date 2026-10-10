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
//
// P2-E1 (M3, D7): a thread a comment on an artifact element opened has "Show in deliverable" beside Open as tab: the
// parent's Deliverables tool opens on the record at its latest version (the thread may have written versions since the
// comment, and a viewer on the latest follows its next ones), and a card on this thread opens for that panel's viewer to
// claim and pin at the element, found again by its selector. Opening the tool takes the panel from this pane, so the
// pane stops drawing the thread and the card's host may claim it (CardHost.tsx). Hidden while a main tab shows the
// thread, where the card's own close rule would shut it at once.
//
// P2-F L146: a thread a comment on a page element opened has "Show in browser" while a pane of this window holds a tab
// on its page (the browser's dock, `comment/dock.ts`): a card on the thread opens for that pane's strip to claim by the
// page's URL (the host's `accepts`), with no caret (no pick position is stored). The Side pane cannot hand its panel to
// that pane as the deliverable's re-dock does (the page shows in the main area), so while a browser card draws the
// thread the pane says so with Show here, which closes the card and draws the thread here again, as Go to tab does for a
// main tab.
import { useEffect } from 'react';
import type { Anchor } from '@shared/anchor/anchor';
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
// P2-E1 start (2026-10-09)
import { openDeliverable } from '../tools/maws/actions';
import { closeCard, openCard, targetOf, useCommentCard } from './card/store';
// P2-E1 end
import { usePageDock } from '../tools/browser/comment/dock'; // P2-F L146

const COPY = SIDE_COPY.pane;

// P2-E1 start (2026-10-09): the re-dock (D7)
function showInDeliverable(parent: AppSessionId, child: AppSessionId, anchor: Anchor): void {
  const target = targetOf(anchor);
  if (target?.kind !== 'deliverable') return;
  openDeliverable(target.appSessionId, target.deliverableId); // no version: the latest; activated, so this pane yields the panel
  openCard(anchor, { appSessionId: parent, phase: { kind: 'thread', child, echo: null }, claimMode: 'panel' });
}
// P2-E1 end

// P2-F L146: the card opens unclaimed, for the browser pane on its page to claim
const showInBrowser = (parent: AppSessionId, child: AppSessionId, anchor: Anchor): void =>
  openCard(anchor, { appSessionId: parent, phase: { kind: 'thread', child, echo: null } });

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
  // P2-F L146: a browser card draws the thread (the re-dock's, or a pick's card left open)
  const inCard = useCommentCard((s) => s.open !== null && s.open.host === 'browser' && s.open.phase.kind === 'thread' && s.open.phase.child === child);
  const drawn = visible && !inMain && !inCard;
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
  const redocks = anchor !== null && targetOf(anchor)?.kind === 'deliverable'; // P2-E1: an artifact element whose page names a deliverable
  const pageDock = usePageDock(pageUrl ?? null); // P2-F L146: a pane of this window on the thread's page

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
        {!inMain && !inCard && (questionsOpen || asked) && (
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
        {/* P2-E1 start (2026-10-09) */}
        {!inMain && redocks && (
          <button type="button" className={`${QUIET} text-ui-sm`} onClick={() => showInDeliverable(parent, child, anchor)}>
            {COPY.showInDeliverable}
          </button>
        )}
        {/* P2-E1 end */}
        {!inMain && !inCard && pageDock !== null && anchor !== null && (
          <button type="button" className={`${QUIET} text-ui-sm`} onClick={() => showInBrowser(parent, child, anchor)}>
            {COPY.showInBrowser}
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
      ) : inCard ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="m-0 text-ui text-fg-muted">{COPY.shownInCard}</p>
          <button type="button" className={SECONDARY} onClick={() => closeCard()}>
            {COPY.showHere}
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
