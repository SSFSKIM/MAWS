// E4a (Task 3.3): the chrome's notice lines between the rows and the pane (Design §4 "Notice banners"; Decision Log 28:
// never app toasts, whose viewport sits where a panel's page is). Two sources:
//
// - the shown tab's own state, each dismissed through `browser.tabs.dismiss`: the permission requests main denied (one
//   line per site and permission), the download (no dismissing while it runs), the unresponsive page with Stop page
//   (`navigate 'stop'`, which main turns into a kill and reload, Decision Log 42), the pop-ups the gate blocked;
// - the session's transient notices from the store, main's `browser.notice` and the chrome's own (Copy URL, a refused
//   address), routed by session (Decision Log 44 (f)) and gone after 4 s or on Dismiss.
//   E4d: comment mode's refused pick and unconfirmed arm come this way too (E4d execution document, Decision Log 35).
//
// Each line sits on whole px (a 24 px text line in 4 px padding, Decision Log 48), so the pane under the chrome starts on
// an integral edge.
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { dismiss, navigate, revealDownload } from '../actions';
import { BROWSER_COPY } from '../copy';
import { CloseIcon } from '../icons';
import { dismissNotice, useBrowser, type ChromeNotice } from '../store';
// E4d start
import { COMMENT_COPY } from '../comment/copy';
// E4d end

type Edge = 'info' | 'warning' | 'danger';
const EDGE: Record<Edge, string> = { info: 'border-l-info', warning: 'border-l-warning', danger: 'border-l-danger' };
const ACTION = 'h-6 shrink-0 rounded-sm px-2 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2';

interface Action {
  label: string;
  run(): void;
}

export function Notices({ appSessionId, tab }: { appSessionId: AppSessionId; tab: BrowserTab | null }) {
  const notices = useBrowser(useShallow((s) => s.notices.filter((notice) => notice.appSessionId === appSessionId)));
  return (
    <>
      {tab && <TabLines tab={tab} />}
      {notices.map((notice) => (
        <Line key={notice.id} kind={notice.kind} edge={NOTICE_EDGE[notice.kind]} onDismiss={() => dismissNotice(notice.id)}>
          {noticeText(notice)}
        </Line>
      ))}
    </>
  );
}

const NOTICE_EDGE: Record<ChromeNotice['kind'], Edge> = {
  tabsCap: 'info',
  profileMissing: 'warning',
  partitionFallback: 'warning',
  downloadRefusedAgent: 'warning',
  tabsFileBroken: 'warning',
  refusedScheme: 'danger',
  urlCopied: 'info',
  // E4d start: comment mode's lines (E4d execution document, Decision Log 35)
  commentUnavailable: 'warning',
  commentCannotName: 'warning',
  // E4d end
  dialogAnswered: 'info', // E4c
  extensionPopupFailed: 'warning', // cua #90
  extensionPageClosed: 'info', // cua #90
};

export function noticeText(notice: Pick<ChromeNotice, 'kind' | 'name' | 'count' | /* E4c */ 'dialogType' | 'excerpt'>): string {
  switch (notice.kind) {
    case 'tabsCap':
      if (notice.count !== undefined && notice.name !== undefined) return BROWSER_COPY.tabsCapOptions(notice.count, notice.name); // cua #90
      return notice.count === undefined ? BROWSER_COPY.tabsCapMemory : BROWSER_COPY.tabsCap(notice.count);
    case 'profileMissing':
      return BROWSER_COPY.profileMissing(notice.name);
    case 'partitionFallback':
      return BROWSER_COPY.partitionFallback(notice.name);
    case 'downloadRefusedAgent':
      return BROWSER_COPY.downloadRefusedAgent;
    case 'tabsFileBroken':
      return BROWSER_COPY.tabsFileBroken;
    case 'refusedScheme':
      return BROWSER_COPY.refusedScheme(notice.name ?? '');
    case 'urlCopied':
      return BROWSER_COPY.urlCopied;
    // E4d start: comment mode's sentences live in its own copy (E4d execution document, Design §14)
    case 'commentUnavailable':
      return COMMENT_COPY.unavailable;
    case 'commentCannotName':
      return COMMENT_COPY.cannotName;
    // E4d end
    // E4c start
    case 'dialogAnswered':
      return BROWSER_COPY.dialogAnswered(notice.dialogType ?? 'alert', notice.excerpt ?? '');
    // E4c end
    // cua #90 start: an extension's popup or options tab closed by main
    case 'extensionPopupFailed':
      return BROWSER_COPY.extensions.popupFailed(notice.name);
    case 'extensionPageClosed':
      return BROWSER_COPY.extensions.pageClosed(notice.name);
    // cua #90 end
  }
}

function TabLines({ tab }: { tab: BrowserTab }) {
  const { tabId, denied, download, unresponsive, blockedPopups } = tab;
  return (
    <>
      {denied.length > 0 && (
        <Line kind="denied" edge="warning" onDismiss={() => dismiss(tabId, 'denied')}>
          {denied.map(({ host, permission }) => (
            <span key={`${host} ${permission}`} className="block truncate">
              {BROWSER_COPY.permissionDenied(host, permission)}
            </span>
          ))}
        </Line>
      )}
      {download && (
        <Line
          kind="download"
          edge="info"
          actions={download.state === 'done' && download.path !== null ? [{ label: BROWSER_COPY.revealInFinder, run: () => revealDownload(tabId) }] : []}
          onDismiss={download.state === 'progressing' ? undefined : () => dismiss(tabId, 'download')}
        >
          {downloadText(download)}
        </Line>
      )}
      {unresponsive && (
        <Line kind="unresponsive" edge="warning" actions={[{ label: BROWSER_COPY.stopPage, run: () => navigate(tabId, 'stop') }]} onDismiss={() => dismiss(tabId, 'unresponsive')}>
          {BROWSER_COPY.unresponsive}
        </Line>
      )}
      {blockedPopups > 0 && (
        <Line kind="popups" edge="warning" onDismiss={() => dismiss(tabId, 'popups')}>
          {BROWSER_COPY.popupsBlocked(blockedPopups)}
        </Line>
      )}
    </>
  );
}

function downloadText({ name, state, received, total }: NonNullable<BrowserTab['download']>): string {
  switch (state) {
    case 'progressing':
      return BROWSER_COPY.downloading(name, total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : null);
    case 'done':
      return BROWSER_COPY.downloadDone(name);
    case 'cancelled':
      return BROWSER_COPY.downloadCancelled(name);
    case 'failed':
      return BROWSER_COPY.downloadFailed(name);
  }
}

function Line({ kind, edge, actions = [], onDismiss, children }: { kind: string; edge: Edge; actions?: Action[]; onDismiss?: () => void; children: ReactNode }) {
  return (
    <div
      role="status"
      data-browser-notice={kind}
      className={`flex shrink-0 items-start gap-2 border-t border-l-2 border-t-border bg-bg-raised py-1 pr-1 pl-2.5 text-ui-sm leading-6 text-fg ${EDGE[edge]}`}
    >
      <div className="min-w-0 flex-1">{typeof children === 'string' ? <span className="block truncate">{children}</span> : children}</div>
      {actions.map((action) => (
        <button key={action.label} type="button" onClick={action.run} className={ACTION}>
          {action.label}
        </button>
      ))}
      {onDismiss && (
        <button
          type="button"
          aria-label={BROWSER_COPY.dismiss}
          title={BROWSER_COPY.dismiss}
          onClick={onDismiss}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
        >
          <CloseIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
