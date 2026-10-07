// The six browser tools in main (E4c execution document, Design §6, §8, §11, §12): one call, already parsed with its
// tool's input schema, run against the calling session's tab and answered as the host writes it. `browser_tabs` and
// `browser_navigate` work through E4a's TabStore and Navigator alone (no Playwright: a navigation goes where the chrome's
// own would, through `will-navigate`, the history and the load-error lifecycle); Task 2.3 adds snapshot, act and eval
// over the driver, Task 2.5 the screenshot, each as a case of `run`.
//
// The rules every handler keeps: a tab is reachable when it is the calling session's or, for a side thread, its parent's
// (P-21, P-24); an action shows its tab (selects it unless the person is using the session's selected tab, and says
// `browser.agent.acting`), passes the pause point (`AgentControl.pause`, Task 2.4's control.ts) and marks the tab the
// agent's before its first page-changing command; a load (a tab that has no page yet) is marked the agent's in the tick
// it starts, before any network event, so E4a's download handler refuses for the agent (A-31), and has no pause point;
// reads touch neither control nor the selection (Decision Log 5, 6, 15). An aborted request answers nothing (null).
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_HANDBACK_IDLE_MS, type BrowserTab } from '@shared/browser/tab';
import { validateBrowserUrl } from '@shared/browser/url';
import type { MawsBrowserAnswerResult } from '@shared/ipc/schema/maws';
import {
  BROWSER_TOOL_ERRORS,
  type BrowserEvalInput,
  type BrowserActInput,
  type BrowserNavigateInput,
  type BrowserNavigateResult,
  type BrowserScreenshotInput,
  type BrowserSnapshotInput,
  type BrowserTabsInput,
  type BrowserTabsResult,
  type BrowserTabSummary,
  type BrowserToolName,
  type BrowserWaitReason,
} from '@shared/maws/browser';
import { TOOL_ERRORS } from '@shared/maws/tools';
import type { NavigateTo, Navigator } from '../navigation';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import { answerOfError, BrowserToolError } from './errors';
import { waitForSettled, type DownloadRefusal } from './navigate';

export type { DownloadRefusal } from './navigate';

// How long an action waited for the person at its pause point (Design §6 step 3; Decision Log 27).
export interface Waited {
  waitedFor: BrowserWaitReason | null;
  waitedMs: number | null;
}

// Who drives the page (Design §8), as the handlers and the request queue use it. Task 2.4's control.ts implements it;
// until then index.ts supplies a provisional one.
export interface AgentControl {
  // The pause point: resolves when the action may dispatch, after any wait on the person (reported through `report`
  // while it lasts); rejects with the signal's reason when the request is aborted meanwhile.
  pause(entry: TabEntry, signal: AbortSignal, report: (reason: BrowserWaitReason | null) => void): Promise<Waited>;
  markActing(entry: TabEntry): void; // an action passed its pause point, or a load starts: `control: 'agent'`
  actionEnded(entry: TabEntry): void; // the agent-idle timer runs from here
  requestPending(entry: TabEntry, delta: 1 | -1): void; // a request for the tab was queued (1) or finished (-1)
}

interface ToolArgs {
  browser_tabs: BrowserTabsInput;
  browser_navigate: BrowserNavigateInput;
  browser_snapshot: BrowserSnapshotInput;
  browser_act: BrowserActInput;
  browser_eval: BrowserEvalInput;
  browser_screenshot: BrowserScreenshotInput;
}

interface CallBase {
  appSessionId: AppSessionId;
  requestId: string;
  toolUseId: string | null;
  deliverableId?: string; // browser_screenshot: the record's id the host minted
  path?: string;
}

export type BrowserCall = { [N in BrowserToolName]: CallBase & { tool: N; args: ToolArgs[N] } }[BrowserToolName];
type CallOf<N extends BrowserToolName> = Extract<BrowserCall, { tool: N }>;

export interface CallContext {
  signal: AbortSignal; // the request's controller (index.ts): the host's cancel, the tab's close, the host's going
  startedAt: number; // epoch ms, when main took the request: `ms` counts from here
  waiting(tabId: string, reason: BrowserWaitReason | null): void; // the host's deadline and the row's waiting line
}

export interface BrowserHandlerDeps {
  store: TabStore;
  navigator: Pick<Navigator, 'navigate'>;
  control: AgentControl;
  reachable(appSessionId: AppSessionId): AppSessionId[]; // the session itself first, then its parent for a side thread
  onDownloadRefused(listener: (refusal: DownloadRefusal) => void): () => void;
  emit: BrowserEmit;
  now?(): number;
}

// The noun a not-yet-built tool's refusal names.
const UNBUILT: Partial<Record<BrowserToolName, string>> = { browser_snapshot: 'snapshot', browser_act: 'act', browser_eval: 'eval', browser_screenshot: 'screenshot' };

const ok = (result: object): MawsBrowserAnswerResult => ({ ok: true, result: result as Record<string, unknown> });

export class BrowserHandlers {
  private readonly now: () => number;

  constructor(private readonly deps: BrowserHandlerDeps) {
    this.now = deps.now ?? Date.now;
  }

  // The call's answer, or null when the request was aborted (nothing is written for it).
  async run(call: BrowserCall, ctx: CallContext): Promise<MawsBrowserAnswerResult | null> {
    try {
      switch (call.tool) {
        case 'browser_tabs':
          return await this.tabs(call, ctx);
        case 'browser_navigate':
          return await this.navigate(call, ctx);
        default:
          return { ok: false, error: BROWSER_TOOL_ERRORS.actionFailed(call.tool, UNBUILT[call.tool]!, '', 'not available in this build of MAWS') };
      }
    } catch (error) {
      if (ctx.signal.aborted) return null;
      const [action, target] = describeCall(call);
      return answerOfError(error, call.tool, action, target);
    }
  }

  // ---- browser_tabs -----------------------------------------------------------------------------------------------------

  private async tabs(call: CallOf<'browser_tabs'>, ctx: CallContext): Promise<MawsBrowserAnswerResult> {
    const { appSessionId, args } = call;
    const { store } = this.deps;
    const answer = (tab: Pick<BrowserTab, 'tabId' | 'url' | 'title'> | null): BrowserTabsResult => ({
      status: 'ok',
      action: args.action,
      tabId: tab?.tabId ?? null,
      url: tab?.url ?? null,
      title: tab?.title ?? null,
      tabs: this.summaries(appSessionId),
      ms: this.ms(ctx),
    });
    switch (args.action) {
      case 'list':
        return ok(answer(null));
      case 'open': {
        const url = this.checkedUrl(args.url!, 'browser_tabs');
        // the calling session's own tab (a side thread's opens in the thread), selected unless the person is using the
        // session's selected tab; E4a has started the load by the time `open` returns
        const { tab } = store.open({ appSessionId, url, select: !this.personHoldsSelection(appSessionId) });
        const entry = store.require(tab.tabId);
        this.deps.emit('browser.agent.acting', { appSessionId, tabId: tab.tabId });
        await this.loaded(entry, 'browser_tabs', ctx);
        return ok(answer(entry.tab));
      }
      case 'close': {
        const entry = this.reach('browser_tabs', appSessionId, args.tabId!);
        if (this.personHolds(entry)) await this.pause(entry, ctx);
        const { tab } = entry;
        store.close(tab.tabId);
        return ok(answer(tab));
      }
      case 'select': {
        const entry = this.reach('browser_tabs', appSessionId, args.tabId!);
        this.show(entry);
        // a suspended tab is loaded, so a following snapshot works (Decision Log 15)
        if (!entry.view && entry.tab.url !== '') {
          if (this.deps.navigator.navigate(entry.tab.tabId, 'reload')) await this.loaded(entry, 'browser_tabs', ctx);
          else this.notLoaded(entry, 'browser_tabs', 'select', entry.tab.tabId);
        }
        return ok(answer(entry.tab));
      }
    }
  }

  // ---- browser_navigate -------------------------------------------------------------------------------------------------

  private async navigate(call: CallOf<'browser_navigate'>, ctx: CallContext): Promise<MawsBrowserAnswerResult> {
    const { appSessionId, args } = call;
    const { control, navigator } = this.deps;
    const tool = 'browser_navigate';
    const entry = this.reach(tool, appSessionId, args.tabId);
    const { tabId } = entry.tab;
    let to: NavigateTo;
    if (args.url === 'back' || args.url === 'forward') {
      if (!entry.view) throw new BrowserToolError(BROWSER_TOOL_ERRORS.tabNotLoaded(tool, tabId, entry.tab.url));
      const history = entry.view.webContents.navigationHistory;
      if (!(args.url === 'back' ? history.canGoBack() : history.canGoForward())) {
        throw new BrowserToolError(BROWSER_TOOL_ERRORS.actionFailed(tool, args.url, '', `no page to go ${args.url} to`));
      }
      to = args.url;
    } else if (args.url === 'reload') {
      to = 'reload';
    } else {
      to = { url: this.checkedUrl(args.url, tool), typed: false };
    }
    const [action, target] = describeCall(call);
    this.show(entry);

    let waited: Waited = { waitedFor: null, waitedMs: null };
    if (!entry.view) {
      // a load: a suspended or never-loaded tab has no holder, so no pause point (Decision Log 15)
      if (!navigator.navigate(tabId, to)) this.notLoaded(entry, tool, action, target);
      await this.loaded(entry, tool, ctx);
    } else {
      waited = await this.pause(entry, ctx);
      control.markActing(entry);
      try {
        if (!navigator.navigate(tabId, to)) this.notLoaded(entry, tool, action, target);
        await waitForSettled(entry, tool, ctx.signal, this.deps);
      } finally {
        control.actionEnded(entry);
      }
    }
    const result: BrowserNavigateResult = { status: 'ok', tabId, url: entry.tab.url, title: entry.tab.title, ms: this.ms(ctx), ...waited };
    return ok(result);
  }

  // ---- shared steps -----------------------------------------------------------------------------------------------------

  // The tab, when the calling session reaches it (P-21, P-24); else `tabNotFound`, as for an id that names nothing.
  private reach(tool: BrowserToolName, appSessionId: AppSessionId, tabId: string): TabEntry {
    const entry = this.deps.store.entry(tabId);
    if (!entry || !this.deps.reachable(appSessionId).includes(entry.tab.appSessionId)) throw new BrowserToolError(BROWSER_TOOL_ERRORS.tabNotFound(tool, tabId));
    return entry;
  }

  // Main refuses again what the schema refused (Design §12), and loads the normalised URL.
  private checkedUrl(url: string, tool: BrowserToolName): string {
    const checked = validateBrowserUrl(url);
    if (!checked.ok) throw new BrowserToolError(TOOL_ERRORS.navigationRefused(url, tool));
    return checked.url;
  }

  // Design §6 step 1: the acting tab comes forward in its session's panel, unless the person is using the selected tab
  // (moving the panel would send their keys to a hidden page); the renderer opens the Browser tool once.
  private show(entry: TabEntry): void {
    const { appSessionId, tabId } = entry.tab;
    if (this.selectedOf(appSessionId) !== tabId && !this.personHoldsSelection(appSessionId)) this.deps.store.select(appSessionId, tabId);
    this.deps.emit('browser.agent.acting', { appSessionId, tabId });
  }

  private pause(entry: TabEntry, ctx: CallContext): Promise<Waited> {
    return this.deps.control.pause(entry, ctx.signal, (reason) => ctx.waiting(entry.tab.tabId, reason)).then((waited) => {
      ctx.signal.throwIfAborted(); // checked again right before dispatch (Decision Log 3)
      return waited;
    });
  }

  // A load E4a has just started (Design §6 "Loads"): the agent's in this same tick, then waited for. A tab E4a could not
  // load (the cap left it suspended, its view failed) is answered as it is.
  private async loaded(entry: TabEntry, tool: BrowserToolName, ctx: CallContext): Promise<void> {
    if (!entry.view) {
      if (entry.tab.failed) throw new BrowserToolError(BROWSER_TOOL_ERRORS.actionFailed(tool, 'load', entry.tab.url, entry.tab.failed.message));
      return; // suspended by the cap: the answer lists it `loaded: false`
    }
    this.deps.control.markActing(entry);
    try {
      await waitForSettled(entry, tool, ctx.signal, this.deps);
    } finally {
      this.deps.control.actionEnded(entry);
    }
  }

  private notLoaded(entry: TabEntry, tool: BrowserToolName, action: string, target: string): never {
    const { failed, suspended } = entry.tab;
    const why = failed ? failed.message : suspended ? 'MAWS has too many tabs loaded; close one with browser_tabs {action: "close"}' : 'the tab has no page to load';
    throw new BrowserToolError(BROWSER_TOOL_ERRORS.actionFailed(tool, action, target, why));
  }

  // The person is using the tab: they hold it, or touched it within the hand-back window though no agent held it
  // (Design §6 step 3, §8).
  private personHolds(entry: TabEntry): boolean {
    const { lastHumanAt } = entry.input;
    return entry.tab.control === 'human' || (lastHumanAt !== null && this.now() - lastHumanAt < BROWSER_HANDBACK_IDLE_MS);
  }

  private personHoldsSelection(appSessionId: AppSessionId): boolean {
    const selected = this.selectedOf(appSessionId);
    const entry = selected === null ? undefined : this.deps.store.entry(selected);
    return entry !== undefined && this.personHolds(entry);
  }

  private selectedOf(appSessionId: AppSessionId): string | null {
    return this.deps.store.list(appSessionId).selected[appSessionId] ?? null;
  }

  private summaries(appSessionId: AppSessionId): BrowserTabSummary[] {
    return this.deps.reachable(appSessionId).flatMap((session, index) => {
      const { tabs, selected } = this.deps.store.list(session);
      return tabs.map(
        (tab): BrowserTabSummary => ({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          selected: selected[session] === tab.tabId,
          loaded: this.deps.store.entry(tab.tabId)?.view != null,
          control: tab.control,
          owner: index === 0 ? 'self' : 'parent',
        }),
      );
    });
  }

  private ms(ctx: CallContext): number {
    return Math.max(0, Math.round(this.now() - ctx.startedAt)); // integers (Decision Log 44 (b))
  }
}

// The action and target an unexpected error's `actionFailed` names.
export function describeCall(call: BrowserCall): [action: string, target: string] {
  switch (call.tool) {
    case 'browser_tabs':
      return [call.args.action, call.args.url ?? call.args.tabId ?? ''];
    case 'browser_navigate': {
      const { url } = call.args;
      return url === 'back' || url === 'forward' || url === 'reload' ? [url, ''] : ['load', url];
    }
    default:
      return [UNBUILT[call.tool]!, ''];
  }
}
