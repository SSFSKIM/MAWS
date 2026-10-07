// The six browser tools in main (E4c execution document, Design §6, §8, §11, §12): one call, already parsed with its
// tool's input schema, run against the calling session's tab and answered as the host writes it. `browser_tabs` and
// `browser_navigate` work through E4a's TabStore and Navigator alone (no Playwright: a navigation goes where the chrome's
// own would, through `will-navigate`, the history and the load-error lifecycle); `browser_snapshot`, `browser_act` and
// `browser_eval` work through the tab's Playwright driver (driver.ts); Task 2.5 adds the screenshot as a case of `run`.
//
// The rules every handler keeps: a tab is reachable when it is the calling session's or, for a side thread, its parent's
// (P-21, P-24); an action shows its tab (selects it unless the person is using the session's selected tab, and says
// `browser.agent.acting`), passes the pause point (`AgentControl.pause`, control.ts) and marks the tab the
// agent's before its first page-changing command; a load (a tab that has no page yet) is marked the agent's in the tick
// it starts, before any network event, so E4a's download handler refuses for the agent (A-31), and has no pause point;
// reads touch neither control nor the selection (Decision Log 5, 6, 15). An aborted request answers nothing (null).
// A page dialog MAWS answered for the agent (dialogs.ts, the `-run-dialog` wrap) reaches the next successful result naming its
// tab (Decision Log 33, 35, 37): `run` drains the tab's dialogs into it.
import type { WebContents } from 'electron';
import type { Locator } from 'playwright-core';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_HANDBACK_IDLE_MS, type BrowserTab } from '@shared/browser/tab';
import { cutSnapshot } from '@shared/browser/snapshot';
import { validateBrowserUrl } from '@shared/browser/url';
import type { MawsBrowserAnswerResult } from '@shared/ipc/schema/maws';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_DIALOGS_MAX,
  BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT,
  BROWSER_TOOL_ERRORS,
  browserTargetText,
  type BrowserActResult,
  type BrowserDialog,
  type BrowserEvalResult,
  type BrowserSnapshotResult,
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
import { dispatch, waitUntilReady } from './act';
import type { AgentCursor } from './cursor';
import type { Driver, Drivers } from './driver';
import { answerOfError, BrowserToolError, firstLine } from './errors';
import { evalValueOf } from './evaluate';
import { isTimeout, locate, RefBook } from './locate';
import { EVAL_NAVIGATION_START_MS, SETTLE_DEADLINE_MS, waitForSettled, watchCallNavigation, type DownloadRefusal } from './navigate';
import { takeSnapshot } from './snapshot';

export type { DownloadRefusal } from './navigate';

// How long an action waited for the person at its pause point (Design §6 step 3; Decision Log 27).
export interface Waited {
  waitedFor: BrowserWaitReason | null;
  waitedMs: number | null;
}

// Who drives the page (Design §8), as the handlers and the request queue use it; control.ts's TabControls implements it.
export interface AgentControl {
  // The pause point: resolves when the action may dispatch, after any wait on the person (reported through `report`
  // while it lasts); rejects with the signal's reason when the request is aborted meanwhile.
  pause(entry: TabEntry, signal: AbortSignal, report: (reason: BrowserWaitReason | null) => void): Promise<Waited>;
  markActing(entry: TabEntry): void; // an action passed its pause point, or a load starts: `control: 'agent'`
  actionEnded(entry: TabEntry): void; // the agent-idle timer runs from here
  requestPending(entry: TabEntry, delta: 1 | -1): void; // a request for the tab was queued (1) or finished (-1)
}

// The page dialogs the `-run-dialog` wrap (dialogs.ts) answered for the agent, per tab, until a result reports them: `take`
// returns them (at most BROWSER_DIALOGS_MAX, each message already cut) and forgets them.
export interface AgentDialogs {
  take(tabId: string): BrowserDialog[];
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
  drivers: Pick<Drivers, 'for'>;
  dialogs?: AgentDialogs;
  cursor?: Pick<AgentCursor, 'aim'>; // the agent's pointer shown in the page before each act (Design §9)
  reachable(appSessionId: AppSessionId): AppSessionId[]; // the session itself first, then its parent for a side thread
  onDownloadRefused(listener: (refusal: DownloadRefusal) => void): () => void;
  emit: BrowserEmit;
  now?(): number;
}

const AIM_TIMEOUT_MS = 1_000; // the element is ready by then: its box answers at once

const ok = (result: object): MawsBrowserAnswerResult => ({ ok: true, result: result as Record<string, unknown> });

export class BrowserHandlers {
  private readonly now: () => number;
  private readonly refBooks = new WeakMap<WebContents, RefBook>();

  constructor(private readonly deps: BrowserHandlerDeps) {
    this.now = deps.now ?? Date.now;
  }

  // The call's answer, or null when the request was aborted (nothing is written for it).
  async run(call: BrowserCall, ctx: CallContext): Promise<MawsBrowserAnswerResult | null> {
    try {
      ctx.signal.throwIfAborted();
      return this.withDialogs(await this.answer(call, ctx));
    } catch (error) {
      if (ctx.signal.aborted) return null;
      // the page's renderer died during the call: whatever Playwright threw (a closed page, a timeout), that is the answer
      const crashed = this.crashedDuring(call);
      if (crashed) return { ok: false, error: BROWSER_TOOL_ERRORS.tabCrashed(call.tool, crashed) };
      const [action, target] = describeCall(call);
      return answerOfError(error, call.tool, action, target);
    }
  }

  // The tab of a snapshot, act or eval whose page crashed (E4a's `crashed`; requirePage refused one crashed before).
  private crashedDuring(call: BrowserCall): string | null {
    if (call.tool !== 'browser_snapshot' && call.tool !== 'browser_act' && call.tool !== 'browser_eval') return null;
    const entry = reachedEntry(this.deps.store, this.deps.reachable, call.appSessionId, call.args.tabId);
    return entry?.tab.crashed ? entry.tab.tabId : null;
  }

  private answer(call: BrowserCall, ctx: CallContext): Promise<MawsBrowserAnswerResult> {
    switch (call.tool) {
      case 'browser_tabs':
        return this.tabs(call, ctx);
      case 'browser_navigate':
        return this.navigate(call, ctx);
      case 'browser_snapshot':
        return this.snapshot(call, ctx);
      case 'browser_act':
        return this.act(call, ctx);
      case 'browser_eval':
        return this.evaluate(call, ctx);
      case 'browser_screenshot':
        return Promise.resolve({ ok: false, error: BROWSER_TOOL_ERRORS.actionFailed(call.tool, 'screenshot', '', 'not available in this build of MAWS') });
    }
  }

  // The dialogs answered on the result's tab since its last result (Decision Log 37: the action's, else the tab's next).
  private withDialogs(answer: MawsBrowserAnswerResult): MawsBrowserAnswerResult {
    if (!answer.ok || !this.deps.dialogs || typeof answer.result.tabId !== 'string') return answer;
    const dialogs = this.deps.dialogs.take(answer.result.tabId).slice(-BROWSER_DIALOGS_MAX);
    return dialogs.length === 0 ? answer : { ...answer, result: { ...answer.result, dialogs } };
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

  // ---- browser_snapshot (a read) ----------------------------------------------------------------------------------------

  private async snapshot(call: CallOf<'browser_snapshot'>, ctx: CallContext): Promise<MawsBrowserAnswerResult> {
    const { appSessionId, args } = call;
    const tool = 'browser_snapshot';
    const entry = this.reach(tool, appSessionId, args.tabId);
    this.requirePage(entry, tool);
    const refs = this.refsOf(entry);
    const { page } = await this.driverOf(entry, tool, 'snapshot', args.root ?? '', ctx.signal);
    const taken = await takeSnapshot(page, args.root, ctx.signal);
    refs.record(taken.text);
    const { text, ...cut } = cutSnapshot(taken.text, { maxChars: args.maxChars ?? BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT });
    const { tabId, url, title } = entry.tab;
    const result: BrowserSnapshotResult = { status: 'ok', tabId, url, title, ms: this.ms(ctx), root: args.root ?? null, rootMatches: taken.rootMatches, ...cut };
    return { ok: true, result, text };
  }

  // ---- browser_act ------------------------------------------------------------------------------------------------------

  // Design §6's four steps: the acting tab; the target resolved and waited for without input (suspended under a cover);
  // the pause point; the dispatch, then a short wait for a navigation it started.
  private async act(call: CallOf<'browser_act'>, ctx: CallContext): Promise<MawsBrowserAnswerResult> {
    const { appSessionId, args } = call;
    const { control } = this.deps;
    const tool = 'browser_act';
    const target = browserTargetText(args.target);
    const entry = this.reach(tool, appSessionId, args.tabId);
    this.requirePage(entry, tool);
    const refs = this.refsOf(entry);
    const downloads = this.watchDownloads(entry, tool);
    try {
      this.show(entry);
      const { page } = await this.driverOf(entry, tool, args.action, target, ctx.signal);
      const { locator, resolved } = await locate(page, args.target, { tool, signal: ctx.signal, refs });
      let coveredMs = 0;
      let waited: Waited = { waitedFor: null, waitedMs: null };
      do {
        try {
          coveredMs += (await waitUntilReady(entry, locator, args.action, { store: this.deps.store, signal: ctx.signal, report: (reason) => ctx.waiting(entry.tab.tabId, reason), now: this.now })).coveredMs;
        } catch (error) {
          if (isTimeout(error) && !ctx.signal.aborted) throw new BrowserToolError(BROWSER_TOOL_ERRORS.actionTimeout(tool, args.action, target, BROWSER_ACTION_TIMEOUT_MS));
          throw error;
        }
        const paused = await this.pause(entry, ctx);
        if (paused.waitedFor !== null) waited = { waitedFor: paused.waitedFor, waitedMs: (waited.waitedMs ?? 0) + (paused.waitedMs ?? 0) };
      } while (entry.tab.covered); // a sheet came up while the person held the page: wait it out again
      if (waited.waitedFor === null && coveredMs > 0) waited = { waitedFor: 'cover', waitedMs: Math.round(coveredMs) };

      control.markActing(entry);
      let navigated: boolean;
      const navigation = watchCallNavigation(entry, ctx.signal);
      try {
        await this.aim(entry, locator, ctx.signal);
        const before = page.url();
        await dispatch(page, locator, args.action, args.value, ctx.signal);
        // a navigation the action started: its load, briefly; a download it started answers at once
        await navigation.settle(downloads.refused);
        navigated = page.url() !== before;
      } finally {
        navigation.stop();
        control.actionEnded(entry);
      }
      downloads.throwIfRefused();
      const { tabId, url, title } = entry.tab;
      const result: BrowserActResult = { status: 'ok', tabId, url, title, ms: this.ms(ctx), action: args.action, target: resolved, navigated, ...waited };
      return ok(result);
    } finally {
      downloads.stop();
    }
  }

  // ---- browser_eval (an action: it can change the page) -------------------------------------------------------------------

  private async evaluate(call: CallOf<'browser_eval'>, ctx: CallContext): Promise<MawsBrowserAnswerResult> {
    const { appSessionId, args } = call;
    const { control } = this.deps;
    const tool = 'browser_eval';
    const entry = this.reach(tool, appSessionId, args.tabId);
    this.requirePage(entry, tool);
    const downloads = this.watchDownloads(entry, tool);
    try {
      this.show(entry);
      const { page } = await this.driverOf(entry, tool, 'eval', '', ctx.signal);
      await this.pause(entry, ctx);
      control.markActing(entry);
      let value: unknown;
      const navigation = watchCallNavigation(entry, ctx.signal);
      try {
        // a string is evaluated as an expression and a promise awaited; once sent it runs to its end (Decision Log 3), so
        // an abort or a promise that never settles only stops the waiting for it
        const evaluation = page.evaluate(args.expression);
        evaluation.catch(() => {});
        try {
          value = await abortable(evaluation, ctx.signal, { ms: SETTLE_DEADLINE_MS, text: BROWSER_TOOL_ERRORS.evalFailed(`the expression did not settle within ${SETTLE_DEADLINE_MS / 1000} s`) });
        } catch (error) {
          if (ctx.signal.aborted || error instanceof BrowserToolError) throw error;
          throw new BrowserToolError(BROWSER_TOOL_ERRORS.evalFailed(firstLine(error)));
        }
        // `location = …` returns at once and its navigation (or download) follows: the start gets a short window
        await navigation.settle(downloads.refused, { startWindowMs: EVAL_NAVIGATION_START_MS });
      } finally {
        navigation.stop();
        control.actionEnded(entry);
      }
      downloads.throwIfRefused();
      const { tabId, url, title } = entry.tab;
      const result: BrowserEvalResult = { status: 'ok', tabId, url, title, ms: this.ms(ctx), ...evalValueOf(value) };
      return ok(result);
    } finally {
      downloads.stop();
    }
  }

  // ---- shared steps -----------------------------------------------------------------------------------------------------

  // The tab, when the calling session reaches it (P-21, P-24); else `tabNotFound`, as for an id that names nothing.
  private reach(tool: BrowserToolName, appSessionId: AppSessionId, tabId: string): TabEntry {
    const entry = reachedEntry(this.deps.store, this.deps.reachable, appSessionId, tabId);
    if (!entry) throw new BrowserToolError(BROWSER_TOOL_ERRORS.tabNotFound(tool, tabId));
    return entry;
  }

  // A read or an act needs the tab's page: a suspended tab is loaded only by `reload` or `select` (Decision Log 15).
  private requirePage(entry: TabEntry, tool: BrowserToolName): void {
    const { tabId, url, crashed } = entry.tab;
    if (crashed) throw new BrowserToolError(BROWSER_TOOL_ERRORS.tabCrashed(tool, tabId));
    if (!entry.view) throw new BrowserToolError(BROWSER_TOOL_ERRORS.tabNotLoaded(tool, tabId, url));
  }

  // The tab's Playwright driver, connected on first use; a connection that fails is the action's failure (Design §11),
  // and an abort stops waiting for it (the connection, once made, serves the next call).
  private async driverOf(entry: TabEntry, tool: BrowserToolName, action: string, target: string, signal: AbortSignal): Promise<Driver> {
    try {
      return await abortable(this.deps.drivers.for(entry), signal);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new BrowserToolError(BROWSER_TOOL_ERRORS.actionFailed(tool, action, target, `MAWS could not attach to the tab: ${firstLine(error)}`));
    }
  }

  // The refs this tab's snapshots named (per page: a new view is a new book).
  private refsOf(entry: TabEntry): RefBook {
    const contents = entry.view!.webContents;
    let book = this.refBooks.get(contents);
    if (!book) this.refBooks.set(contents, (book = new RefBook(contents)));
    return book;
  }

  // A-31, Decision Log 22: a download the tab refuses for the agent while this call runs is the call's answer.
  private watchDownloads(entry: TabEntry, tool: BrowserToolName) {
    const { tabId } = entry.tab;
    let refusal: DownloadRefusal | null = null;
    let wake: () => void = () => {};
    const refused = new Promise<void>((resolve) => (wake = resolve));
    const stop = this.deps.onDownloadRefused((download) => {
      if (download.tabId !== tabId || refusal) return;
      refusal = download;
      wake();
    });
    return {
      refused, // resolves when one comes
      throwIfRefused: () => {
        if (refusal) throw new BrowserToolError(BROWSER_TOOL_ERRORS.downloadRefused(tool, refusal.url, refusal.filename));
      },
      stop,
    };
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

  // The pause point (Design §6 step 3): the abort checked before it and again right before dispatch (Decision Log 3).
  private pause(entry: TabEntry, ctx: CallContext): Promise<Waited> {
    ctx.signal.throwIfAborted();
    return this.deps.control.pause(entry, ctx.signal, (reason) => ctx.waiting(entry.tab.tabId, reason)).then((waited) => {
      ctx.signal.throwIfAborted(); // checked again right before dispatch (Decision Log 3)
      return waited;
    });
  }

  // Design §9: the agent's pointer moves to the element and outlines it before the action (fill and press move no mouse),
  // between the mark and the dispatch (Decision Log 68). Cosmetic: a box that cannot be read shows nothing. The abort is
  // checked again after it, right before dispatch (Decision Log 3).
  private async aim(entry: TabEntry, locator: Locator, signal: AbortSignal): Promise<void> {
    if (this.deps.cursor) {
      const box = await locator.boundingBox({ timeout: AIM_TIMEOUT_MS }).catch(() => null);
      if (box) this.deps.cursor.aim(entry, box);
    }
    signal.throwIfAborted();
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
    case 'browser_snapshot':
      return ['snapshot', call.args.root ?? ''];
    case 'browser_act':
      return [call.args.action, browserTargetText(call.args.target)];
    case 'browser_eval':
      return ['eval', ''];
    case 'browser_screenshot':
      return ['screenshot', call.args.target === undefined ? '' : browserTargetText(call.args.target)];
  }
}

// The tab, when the calling session reaches it (P-21; P-24: a side thread reaches its parent's tabs too).
export function reachedEntry(store: Pick<TabStore, 'entry'>, reachable: (appSessionId: AppSessionId) => AppSessionId[], appSessionId: AppSessionId, tabId: string): TabEntry | undefined {
  const entry = store.entry(tabId);
  return entry && reachable(appSessionId).includes(entry.tab.appSessionId) ? entry : undefined;
}

// A promise's value, unless the signal aborts first (its reason) or a deadline passes first (its refusal).
function abortable<T>(promise: Promise<T>, signal: AbortSignal, deadline?: { ms: number; text: string }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => finish(() => reject(signal.reason));
    const timer = deadline && setTimeout(() => finish(() => reject(new BrowserToolError(deadline.text))), deadline.ms);
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
