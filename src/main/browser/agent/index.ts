// The browser tools' side of main (E4c execution document, Design §1, §4; Interfaces "Main"; Decision Log 29, 36, 46),
// started inside `startBrowser`'s E4c block, where the tab store and E4a's Navigator are in scope. It takes every
// `maws.browser.request` the engine host emits, runs it on the session's tab one request at a time per tab (two
// sessions' tabs run side by side), and answers through `maws.browser.answer`; a wait on the person or a cover is
// reported through `maws.browser.waiting` (the host pauses its deadline) and `maws.browser.progress` (the row's line),
// for the request that waits and for every request queued behind it on that tab.
//
// Every request has an AbortController, aborted by the host's `maws.browser.cancel` (its call was abandoned or timed
// out), by the tab's close (the request answers `tabClosed`), and by the engine host's connection going (any state but
// `ready`): the host then settles its own calls `appNotOpen` and sends no cancel (Decision Log 46), so main stops every
// request it holds rather than click for a call the engine was already told failed. An aborted request answers nothing;
// one still queued never runs.
//
// Who drives each tab (control.ts), the parking of unplaced tabs the agent works on (visible.ts), the agent's cursor in the
// page (cursor.ts) and the `-run-dialog` wrap on every tab view (dialogs.ts) start here too, over the store's view hooks,
// so they cover every view, adopted pop-ups included, from the first.
//
// Under MAWS_E2E=1 the e2e's seam gains `agent` (`run`, `cancel`, `driverState`, `control`, `lastInputs`, `sendInput`,
// `cursorMessages`) on `globalThis.__maws_browser`, so the e2e drives the handlers without an engine.
import { randomUUID } from 'node:crypto';
import type { KeyboardInputEvent, MouseInputEvent, MouseWheelInputEvent } from 'electron';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { BROWSER_TOOL_ERRORS, type BrowserToolName, type BrowserWaitReason } from '@shared/maws/browser';
import type { MawsBrowserAnswerResult, MawsBrowserRequest } from '@shared/ipc/schema/maws';
import { parseToolArguments } from '@shared/maws/tools';
import type { HostSupervisor } from '../../hosts/supervisor';
import type { SessionStore } from '../../index/sessions';
import type { InputEmission } from '../input';
import type { Navigator } from '../navigation';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { ViewManager } from '../view';
import { TabControls } from './control';
import { AgentCursor } from './cursor';
import { PageDialogs } from './dialogs';
import { Drivers, type DriverState } from './driver';
import { answerOfError, refusal } from './errors';
import { BrowserHandlers, describeCall, reachedEntry, type AgentControl, type BrowserCall, type CallContext, type DownloadRefusal } from './handlers';
import { waitingReporter, type Via } from './progress';
import { Parking, type LeaseHolds } from './visible';

const LAST_INPUTS_KEPT = 32;

// Why a request's controller was aborted.
class RequestEnded extends Error {
  constructor(readonly why: 'cancelled' | 'host' | 'tabClosed') {
    super(`the browser request ended: ${why}`);
  }
}

// ---- the request lifecycle ------------------------------------------------------------------------------------------

export interface BrowserRequestsDeps {
  run(call: BrowserCall, ctx: CallContext): Promise<MawsBrowserAnswerResult | null>;
  answer(call: BrowserCall, result: MawsBrowserAnswerResult): void; // to the host (host requests only)
  report(call: BrowserCall, tabId: string, reason: BrowserWaitReason | null, via: Via): void;
  control: Pick<AgentControl, 'requestPending'>;
  store: Pick<TabStore, 'entry'>;
  // Whether the session reaches the tab (P-21, P-24): checked before a request joins the tab's queue, so another
  // session's tab is never queued on nor counted as pending
  reaches(appSessionId: AppSessionId, tabId: string): boolean;
  now(): number;
}

interface Pending {
  appSessionId: AppSessionId;
  tabId: string | null;
  controller: AbortController;
  call: BrowserCall;
  via: Via;
  started: boolean; // its turn has begun (it is no longer queued)
  mirrored: BrowserWaitReason | null; // while queued: the head's wait last told for it
}

export class BrowserRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly tails = new Map<string, Promise<unknown>>(); // per tab: the last request's end
  private readonly headWaits = new Map<string, BrowserWaitReason>(); // per tab: what its running request waits on

  constructor(private readonly deps: BrowserRequestsDeps) {}

  // Runs the request in its tab's turn; its answer (null: aborted, or nothing to say). A host request's answer goes to
  // the host; a seam request's only to its caller.
  async accept(request: MawsBrowserRequest, via: Via): Promise<MawsBrowserAnswerResult | null> {
    const { appSessionId, requestId, toolUseId, tool, deliverableId, path } = request;
    const parsed = parseToolArguments(tool, request.args);
    const base = { appSessionId, requestId, toolUseId, deliverableId, path };
    if (!parsed.ok) {
      const result = refusal(parsed.error);
      if (via === 'host') this.deps.answer({ ...base, tool, args: request.args } as BrowserCall, result);
      return result;
    }
    const call = { ...base, tool, args: parsed.data } as BrowserCall;
    const args = parsed.data as { tabId?: unknown };
    const tabId = typeof args.tabId === 'string' ? args.tabId : null;
    if (tabId !== null && !this.deps.reaches(appSessionId, tabId)) {
      const result = refusal(BROWSER_TOOL_ERRORS.tabNotFound(tool, tabId));
      if (via === 'host') this.deps.answer(call, result);
      return result;
    }
    const key = keyOf(appSessionId, requestId);
    const controller = new AbortController();
    const pending: Pending = { appSessionId, tabId, controller, call, via, started: false, mirrored: null };
    this.pending.set(key, pending);
    const entry = tabId === null ? undefined : this.deps.store.entry(tabId);
    if (entry) this.deps.control.requestPending(entry, 1);
    const headWait = tabId === null ? undefined : this.headWaits.get(tabId);
    if (headWait !== undefined) this.mirror(pending, headWait); // joins the queue of a tab whose request waits

    const turn = this.turnOf(tabId, async () => {
      if (controller.signal.aborted) return null; // cancelled while queued: never run
      pending.started = true;
      const ctx: CallContext = {
        signal: controller.signal,
        startedAt: this.deps.now(),
        waiting: (waitTab, reason) => {
          this.deps.report(call, waitTab, reason, via);
          if (tabId !== null) this.headWaiting(tabId, reason);
        },
      };
      try {
        return await this.deps.run(call, ctx);
      } catch (error) {
        if (controller.signal.aborted) return null;
        const [action, target] = describeCall(call);
        return answerOfError(error, call.tool, action, target);
      } finally {
        if (tabId !== null) this.headWaiting(tabId, null); // the next turn starts on its own deadline
      }
    });
    let result: MawsBrowserAnswerResult | null;
    try {
      result = await turn;
    } finally {
      this.pending.delete(key);
      if (entry && this.deps.store.entry(entry.tab.tabId) === entry) this.deps.control.requestPending(entry, -1);
    }
    const ended = controller.signal.aborted ? (controller.signal.reason as RequestEnded).why : null;
    if (ended === 'cancelled' || ended === 'host') return null; // the host already withdrew, timed out or went
    if (result === null && ended === 'tabClosed') result = refusal(BROWSER_TOOL_ERRORS.tabClosed(tool, tabId!));
    if (result !== null && via === 'host') this.deps.answer(call, result);
    return result;
  }

  // `maws.browser.cancel`: false when the session has no such request (answered, or never seen).
  cancel(appSessionId: AppSessionId, requestId: string): boolean {
    const pending = this.pending.get(keyOf(appSessionId, requestId));
    if (!pending || pending.controller.signal.aborted) return false;
    pending.controller.abort(new RequestEnded('cancelled'));
    return true;
  }

  // The tab closed: its running and queued requests answer `tabClosed`.
  abortTab(tabId: string): void {
    for (const pending of this.pending.values()) if (pending.tabId === tabId) pending.controller.abort(new RequestEnded('tabClosed'));
  }

  // The engine host's connection went: nothing is answered any more.
  abortAll(): void {
    for (const pending of this.pending.values()) pending.controller.abort(new RequestEnded('host'));
  }

  pendingFor(tabId: string, exceptSession?: AppSessionId): boolean {
    for (const pending of this.pending.values()) if (pending.tabId === tabId && pending.appSessionId !== exceptSession) return true;
    return false;
  }

  // The request running on the tab waits on the person or a cover, or no longer does: every request queued behind it
  // waits with it, so the host pauses their deadlines too and their rows read the same line (a side thread acting in
  // its parent's tab, or two calls the engine runs side by side on one tab). Time queued behind a head that works
  // still counts against a queued request's deadline.
  private headWaiting(tabId: string, reason: BrowserWaitReason | null): void {
    if (reason === null) this.headWaits.delete(tabId);
    else this.headWaits.set(tabId, reason);
    for (const pending of this.pending.values()) {
      if (pending.tabId === tabId && !pending.started && !pending.controller.signal.aborted) this.mirror(pending, reason);
    }
  }

  private mirror(pending: Pending, reason: BrowserWaitReason | null): void {
    if (pending.mirrored === reason) return; // a null to a request never told a wait would re-arm its deadline whole
    pending.mirrored = reason;
    this.deps.report(pending.call, pending.tabId!, reason, pending.via);
  }

  // A tab's requests run in order; a request with no tab (list, open) runs at once.
  private turnOf<T>(tabId: string | null, run: () => Promise<T>): Promise<T> {
    if (tabId === null) return run();
    const turn = (this.tails.get(tabId) ?? Promise.resolve()).then(run);
    const tail = turn.catch(() => {});
    this.tails.set(tabId, tail);
    void tail.then(() => {
      if (this.tails.get(tabId) === tail) this.tails.delete(tabId);
    });
    return turn;
  }
}

const keyOf = (appSessionId: string, requestId: string) => `${appSessionId}\u0000${requestId}`;

// ---- small pieces ---------------------------------------------------------------------------------------------------

// P-24 (Decision Log 29): a side thread reaches its own tabs and its parent session's; anything else, including an
// index that cannot be read, reaches itself only.
export function reachableSessions(sessions: Pick<SessionStore, 'get'>, appSessionId: AppSessionId): AppSessionId[] {
  try {
    const lineage = sessions.get(appSessionId)?.lineage;
    if (lineage?.kind === 'side-thread') return [appSessionId, lineage.parentAppSessionId];
  } catch {
    // the index is unavailable: self only
  }
  return [appSessionId];
}

// Design §13 (b), Decision Log 36: under MAWS_E2E=1 tab ids are `b_` and a zero-padded sequence, starting above any
// sequence-shaped id restored from tabs.json (E4a's minter skips an id in use), so a fresh scene's first open is
// b_000000000001 as the recording's stand-in minted it. Undefined otherwise (E4a's random ids).
export function e2eTabIds(env: NodeJS.ProcessEnv, restored: readonly { tabId: string }[]): (() => string) | undefined {
  if (env.MAWS_E2E !== '1') return undefined;
  let next = 1 + Math.max(0, ...restored.map(({ tabId }) => (/^b_\d{12}$/.test(tabId) ? Number(tabId.slice(2)) : 0)));
  return () => `b_${String(next++).padStart(12, '0')}`;
}

// ---- the wiring -----------------------------------------------------------------------------------------------------

export interface BrowserAgentSeam {
  run(appSessionId: AppSessionId, tool: BrowserToolName, args: unknown, options?: { requestId?: string; toolUseId?: string }): Promise<MawsBrowserAnswerResult | null>;
  cancel(appSessionId: AppSessionId, requestId: string): boolean; // as `maws.browser.cancel` would (case 9)
  driverState(tabId: string): DriverState;
  control(tabId: string): { control: TabEntry['tab']['control']; controlSince: string } | null;
  lastInputs(tabId: string): InputEmission[]; // E4a's classifier's last emissions for the tab
  // The person's stand-in (E4-0): an input event sent to the tab's page as the OS would, a mouse event's screen point
  // filled from the view's place on screen; false when the tab has no page
  sendInput(tabId: string, event: SeamInputEvent): boolean;
  cursorMessages(tabId: string): number; // how many `browser:cursor` messages the tab's pages were sent
}

export type SeamInputEvent = MouseInputEvent | MouseWheelInputEvent | KeyboardInputEvent;

declare module '../inspect' {
  interface BrowserInspector {
    agent?: BrowserAgentSeam; // E4c, under MAWS_E2E=1
  }
}

export interface BrowserAgentDeps {
  store: TabStore;
  navigator: Pick<Navigator, 'navigate'>;
  onDownloadRefused(listener: (refusal: DownloadRefusal) => void): () => void; // E4a's in-process hook (Decision Log 43)
  sessions: Pick<SessionStore, 'get'>;
  hosts: Pick<HostSupervisor, 'onEvent' | 'dispatch' | 'onState'>;
  emit: BrowserEmit;
  views: Pick<ViewManager, 'park'>; // E4a's view manager, for parking (visible.ts)
  userData: string; // main's own: browser_screenshot writes its file under the session's deliverables
  drivers?: Pick<Drivers, 'for' | 'state' | 'close' | 'retire' | 'stop'>; // tests: the drivers made here otherwise
  // The in-app browser spec of 2026-10-08: the tabs cua's primitive server holds a lease on are parked like the tools'
  // and refused to the tools (one automation owner per tab)
  cua?: LeaseHolds;
}

export interface BrowserAgent {
  seam: BrowserAgentSeam;
  stop(): Promise<void>;
}

export function startBrowserAgent(deps: BrowserAgentDeps): BrowserAgent {
  const { store, hosts, emit } = deps;
  const log = (line: string) => console.warn(`[browser] ${line}`);
  const control = new TabControls({ store });
  const parking = new Parking({ store, views: deps.views, controls: control, leases: deps.cua });
  const cursor = new AgentCursor({ store, controls: control });
  const dialogs = new PageDialogs({ store, emit, log });
  const drivers =
    deps.drivers ??
    new Drivers({
      busy: (entry) => entry.tab.control === 'agent' || requests.pendingFor(entry.tab.tabId),
      heldByCua: (entry) => deps.cua?.holds(entry.tab.tabId) === true, // one automation owner per tab
      log,
    });
  const reachable = (appSessionId: AppSessionId) => reachableSessions(deps.sessions, appSessionId);
  const handlers = new BrowserHandlers({
    store,
    navigator: deps.navigator,
    control,
    drivers,
    dialogs,
    cursor,
    userData: deps.userData,
    reachable,
    onDownloadRefused: deps.onDownloadRefused,
    emit,
  });
  const requests: BrowserRequests = new BrowserRequests({
    run: (call, ctx) => handlers.run(call, ctx),
    answer: ({ appSessionId, requestId }, result) => {
      hosts
        .dispatch('engine-host', 'maws.browser.answer', { appSessionId, requestId: requestId as RequestId, result })
        .catch((error: unknown) => console.error('[browser] could not answer a browser request', error));
    },
    report: waitingReporter({ hosts, emit }),
    control,
    store,
    reaches: (appSessionId, tabId) => reachedEntry(store, reachable, appSessionId, tabId) !== undefined,
    now: Date.now,
  });

  const inputs = new WeakMap<TabEntry, InputEmission[]>();
  const stops = [
    hosts.onEvent('maws.browser.request', (request) => void requests.accept(request, 'host')),
    hosts.onEvent('maws.browser.cancel', ({ appSessionId, requestId }) => void requests.cancel(appSessionId, requestId)),
    hosts.onState('engine-host', (state) => {
      if (state.state !== 'ready') requests.abortAll();
    }),
    // Design §4: a session's exit ends its tabs' drivers at once (the host has cancelled its requests, Decision Log 46);
    // a tab another session still has a request on (a side thread acting in its parent's tab) keeps its driver
    hosts.onEvent('session.status', ({ appSessionId, status }) => {
      if (status.process !== 'exited') return;
      for (const { tab } of store.all()) {
        if (tab.appSessionId === appSessionId && !requests.pendingFor(tab.tabId, appSessionId)) void drivers.retire(tab.tabId);
      }
    }),
    store.onViewCreated((entry) => {
      if (inputs.has(entry)) return; // the seam outlives a view: one subscription per tab
      const kept: InputEmission[] = [];
      inputs.set(entry, kept);
      entry.input.on((emission) => {
        kept.push(emission);
        if (kept.length > LAST_INPUTS_KEPT) kept.shift();
      });
    }),
    store.onViewDestroying((entry) => {
      const { tabId } = entry.tab;
      void drivers.close(tabId); // the page goes (closed, suspended, its session deleted): its connection with it
      // the store drops a closed tab's entry right after this hook; a suspended one stays
      queueMicrotask(() => {
        if (store.entry(tabId) !== entry) requests.abortTab(tabId);
      });
    }),
  ];

  let seamRequests = 0;
  const seam: BrowserAgentSeam = {
    // a screenshot's record id is the host's to mint; the seam has no host, so it mints one (Decision Log 77 (d))
    run: (appSessionId, tool, args, options = {}) =>
      requests.accept({
        appSessionId, requestId: (options.requestId ?? `seam-${++seamRequests}`) as RequestId, toolUseId: (options.toolUseId ?? null) as never, tool, args,
        ...(tool === 'browser_screenshot' && { deliverableId: randomUUID() }),
      }, 'seam'),
    cancel: (appSessionId, requestId) => requests.cancel(appSessionId, requestId),
    driverState: (tabId) => drivers.state(tabId),
    control: (tabId) => {
      const entry = store.entry(tabId);
      return entry ? { control: entry.tab.control, controlSince: entry.tab.controlSince } : null;
    },
    lastInputs: (tabId) => {
      const entry = store.entry(tabId);
      return entry ? [...(inputs.get(entry) ?? [])] : [];
    },
    sendInput: (tabId, event) => {
      const entry = store.entry(tabId);
      const contents = entry?.view?.webContents;
      if (!entry || !contents || contents.isDestroyed()) return false;
      contents.sendInputEvent('x' in event ? { ...screenPointOf(entry, event), ...event } : event);
      return true;
    },
    cursorMessages: (tabId) => {
      const entry = store.entry(tabId);
      return entry ? cursor.messages(entry) : 0;
    },
  };

  return {
    seam,
    stop: async () => {
      for (const stop of stops.splice(0)) stop();
      requests.abortAll();
      for (const part of [dialogs, cursor, parking, control]) part.dispose();
      await drivers.stop();
    },
  };
}

// Where a point of the tab's page is on screen (E4-0's stand-in for the person, `pass2/main.mjs` `screenPoint`): the
// window's content origin plus the view's offset; an unplaced view counts from the origin.
function screenPointOf(entry: TabEntry, { x, y }: { x: number; y: number }): { globalX: number; globalY: number } {
  const host = entry.host && !entry.host.isDestroyed() ? entry.host.getContentBounds() : { x: 0, y: 0 };
  const view = entry.view!.getBounds();
  return { globalX: host.x + view.x + x, globalY: host.y + view.y + y };
}
