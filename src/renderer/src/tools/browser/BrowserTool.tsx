// E4a (Task 3.1): the Browser tool (E4a execution document, Interfaces "The renderer"; X5): one single-instance,
// pinnable tool that shows the shown session's browser tabs (P-21): the session's selected tab under the chrome, or the
// empty state. The tabs are main's, so the tool's state is a small handle that only routes `open`:
//
// - a `target` (show_pane's URL) opens or reuses a tab of the named session through `browser.tabs.open` with
//   `reuse: 'url'` and the request's id (Decision Log 7). The session is named because `addTool` re-targets a pinned
//   tool showing another session, and the tab must land in the agent's (P-21);
// - a `tabId` selects that tab;
// - nothing leaves the session's own state.
//
// Closing the tool's panel tab closes no browser tab (they are the session's), and dispose sends nothing: the pane's
// unmount already let go of its placement.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { validateBrowserUrl } from '@shared/browser/url';
import { ipc } from '../../ipc/client';
import type { PanelTool, PanelToolContext } from '../../panel/tool';
import { BROWSER_COPY } from './copy';
import { BrowserIcon } from './icons';
import { BrowserView } from './View';

export interface BrowserParams {
  target?: string; // an http or https URL (show_pane checks it before; anything else is ignored here)
  tabId?: string;
  appSessionId?: AppSessionId; // the session the target or tab belongs to, else the one the tool shows
  requestId?: string; // show_pane's request: the same id from two windows reaches one tab in main
}

const warnRefused = (what: string) => (result: { ok: true } | { ok: false; error: { message: string } }) => {
  if (!result.ok) console.warn(`[browser] ${what} refused: ${result.error.message}`);
};

export class BrowserHandle {
  constructor(
    public appSessionId: AppSessionId | null,
    params: BrowserParams | undefined,
    private readonly client: MawsBridge = ipc,
  ) {
    this.open(params);
  }

  open = (params: BrowserParams | undefined): void => {
    if (params?.appSessionId !== undefined) this.appSessionId = params.appSessionId;
    const appSessionId = this.appSessionId;
    if (appSessionId === null) return;
    if (params?.target !== undefined) {
      const checked = validateBrowserUrl(params.target);
      if (!checked.ok) return;
      const request = { appSessionId, url: checked.url, select: true, reuse: 'url' as const, ...(params.requestId !== undefined && { requestId: params.requestId }) };
      void this.client.invoke('browser.tabs.open', request).then(warnRefused('opening a tab'));
    } else if (params?.tabId !== undefined) {
      void this.client.invoke('browser.tabs.select', { appSessionId, tabId: params.tabId }).then(warnRefused('selecting a tab'));
    }
  };
}

function BrowserBody({ ctx }: { state: BrowserHandle; ctx: PanelToolContext }) {
  if (ctx.appSessionId === null) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{BROWSER_COPY.noSession}</p>;
  }
  return <BrowserView key={ctx.appSessionId} appSessionId={ctx.appSessionId} surface="panel" />;
}

export const browserTool: PanelTool<BrowserHandle, BrowserParams> = {
  id: 'browser', // PANES.browser's tool
  title: BROWSER_COPY.title,
  icon: BrowserIcon,
  pinnable: true,
  multiInstance: false,
  menu: true,
  createState: (init) => new BrowserHandle(init.appSessionId, init.params),
  open: (state, params) => state.open(params),
  beforeClose: () => Promise.resolve(true), // the browser tabs are the session's; closing the tool closes none
  dispose: () => {},
  render: BrowserBody,
};
