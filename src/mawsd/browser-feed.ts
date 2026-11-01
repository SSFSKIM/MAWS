// The feed seam's subscriptions (P5 O17 M6; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M6, Interfaces §F, §G;
// D4, D7): `DaemonServices.browser.open`, a viewer's subscription to one tab the session's selected engine holds. A
// deferred chunk: the inventory and its watchers are the route's (browser-route.ts, eager), and only the first `open`
// loads this (daemon.ts), so no capability or inventory read, and no app's attachment, ever does.
//
// `open` refuses at once what the route already says: another epoch (`engine_changed`), a route with no engine serving
// (`unavailable`, with the inventory's reason: in `relay` the app is no producer before M9, D9), a tab the selected
// engine's inventory does not hold (`tab_closed`: it never creates a tab or starts a render host), past the viewer
// budgets (4 per session, 32 here: `viewers`), and a second controlling subscription of a tab (`control_busy`). Then it
// asks the selected engine connection (`browserEngine.request {open}`) and resolves at its answer. Subscription and
// request ids are `mawsd`'s; an answer is taken only for a request pending on the connection it arrives on.
//
// Frames (`browserEngine.frame`) are taken only from the subscription's own connection, for its own tab, one in flight:
// the frame's admission is no credit; the viewer's `ack` of the outstanding sequence is (a duplicate a no-op, a future
// sequence refused), and only then is the engine told. Every frame a viewer receives carries the route's epoch. An
// engine that sends a second frame in flight, or one over the bound, has broken the rule: the subscription ends
// `producer_failed` (`frame_too_large`).
//
// A controlling viewer's input is read here (the validators of §G, against the viewport of the frame it last received),
// a sequence taken once, then queued in order with one request in flight: a pointer's moves coalesce while they wait, a
// key or a button never drops silently; past 32 waiting, control ends (`input_overflow`), the engine told to close, which
// releases what is held down.
//
// The end (D4) is disposed exactly once, whichever comes first: the engine's `browserEngine.ended` (its reason), the
// viewer's `close` (nothing told the viewer), the engine connection's end (`engine_changed`) or the route's period end
// (`periodEnds`: `engine_changed` or `tab_closed`). Its pending input is refused then, an `open` still waiting is
// refused rather than resolved, and the engine is told to close unless the end was its own or its connection's.
import { BROWSER_LIMITS, BrowserRefused, BrowserSeqSchema, readBrowserInput, type BrowserEndReason, type BrowserFeed, type BrowserFrame, type BrowserInput, type BrowserRefusalReason, type BrowserSubscription } from '@shared/browser/screencast';
import { BrowserTabIdSchema } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput } from '@shared/ipc/schema';
import type { BrowserEngineOperation, BrowserEngineRequest, BrowserEngineResult } from '@shared/ipc/schema/browser-engine';
import type { BrowserRoute } from './browser-route';
import type { EngineConnection } from './browser-work';

export interface BrowserFeedOptions {
  machine: string;
  route: Pick<BrowserRoute, 'reading' | 'selection' | 'inventory' | 'periodEnds'>;
  post(engine: EngineConnection, request: BrowserEngineRequest): boolean; // to that connection alone; false when it is going
  log(line: string): void;
}

export interface BrowserFeedService {
  open: BrowserFeed['open'];
  answer(engine: EngineConnection, input: { id: string; result: BrowserEngineResult }): boolean; // false: no such request pending on it
  frame(engine: EngineConnection, input: CommandInput<'browserEngine.frame'>): boolean; // false: refused
  ended(engine: EngineConnection, input: CommandInput<'browserEngine.ended'>): boolean; // false: no subscription of that connection
  gone(engine: EngineConnection): void; // the connection ended
  inspect(): { subscriptions: number; pending: number };
  dispose(): void;
}

interface Waiter {
  resolve(): void;
  reject(error: Error): void;
}

interface Queued {
  seq: number;
  event: Extract<BrowserEngineOperation, { op: 'input' }>['event']; // read: the four modifier names
  waiters: Waiter[];
}

interface Subscription {
  id: string;
  appSessionId: AppSessionId;
  epoch: string;
  tabId: string;
  control: boolean;
  engine: EngineConnection;
  sink: Parameters<BrowserFeed['open']>[1];
  phase: 'opening' | 'open' | 'closed';
  opened: { resolve(subscription: BrowserSubscription): void; reject(error: Error): void };
  seq: number; // the last frame received
  outstanding: boolean; // that frame not yet acknowledged
  viewport: { width: number; height: number } | null; // the last frame's
  inputSeq: number;
  queue: Queued[];
  sending: Queued | null;
}

// The reasons an engine's refusal of `open` names (tab-engine.ts, screencast.ts), passed on as they are
const ENGINE_REASONS: ReadonlySet<string> = new Set<BrowserEndReason>(['tab_closed', 'view_gone', 'control_busy', 'producer_failed']);

export function createBrowserFeed(options: BrowserFeedOptions): BrowserFeedService {
  const { route, log } = options;
  const subscriptions = new Map<string, Subscription>();
  const pending = new Map<string, { engine: EngineConnection; settle(result: BrowserEngineResult | null): void }>(); // null: the connection ended unanswered
  let next = 0;

  // A request to the subscription's connection; `settle` hears its answer (null: none will come)
  const request = (subscription: Subscription, operation: BrowserEngineOperation, settle: (result: BrowserEngineResult | null) => void = () => {}) => {
    const id = `feed-${++next}`;
    pending.set(id, { engine: subscription.engine, settle });
    if (options.post(subscription.engine, { id, appSessionId: subscription.appSessionId, operation })) return;
    pending.delete(id);
    settle(null);
  };

  // The end, once: the waiters refused, the viewer told (`tell`), the engine told to close (`close`)
  function settle(subscription: Subscription, reason: string, how: { tell: boolean; close: boolean }): void {
    if (subscription.phase === 'closed') return;
    const wasOpening = subscription.phase === 'opening';
    subscription.phase = 'closed';
    subscriptions.delete(subscription.id);
    const refused = new BrowserRefused(reason);
    for (const queued of [...(subscription.sending ? [subscription.sending] : []), ...subscription.queue]) for (const waiter of queued.waiters) waiter.reject(refused);
    subscription.queue = [];
    subscription.sending = null;
    if (how.close) request(subscription, { op: 'close', subscriptionId: subscription.id });
    if (wasOpening) return subscription.opened.reject(refused);
    if (how.tell) {
      try {
        subscription.sink.closed(reason);
      } catch (error) {
        log(`[browser] a viewer's close of ${subscription.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const offPeriods = route.periodEnds((appSessionId, reason) => {
    for (const subscription of [...subscriptions.values()]) if (subscription.appSessionId === appSessionId) settle(subscription, reason, { tell: true, close: true });
  });

  // ---- input --------------------------------------------------------------------------------------------------------

  function send(subscription: Subscription): void {
    if (subscription.phase !== 'open' || subscription.sending) return;
    const queued = subscription.queue.shift();
    if (!queued) return;
    subscription.sending = queued;
    request(subscription, { op: 'input', subscriptionId: subscription.id, seq: queued.seq, event: queued.event }, (result) => {
      if (subscription.sending !== queued) return; // settled meanwhile: its waiters refused then
      subscription.sending = null;
      for (const waiter of queued.waiters) {
        if (result?.ok) waiter.resolve();
        else waiter.reject(result ? new Error(result.error) : new BrowserRefused('engine_changed'));
      }
      send(subscription);
    });
  }

  function takeInput(subscription: Subscription, seq: number, event: BrowserInput): Promise<void> {
    if (subscription.phase !== 'open') return Promise.reject(new BrowserRefused('closed'));
    if (!subscription.control) return Promise.reject(new BrowserRefused('read_only', 'this subscription views the tab and does not control it'));
    if (!BrowserSeqSchema.safeParse(seq).success) return Promise.reject(new BrowserRefused('invalid', `input sequence ${String(seq)} is not a positive safe integer`));
    const read = readBrowserInput(event, subscription.viewport);
    if ('refusal' in read) return Promise.reject(new BrowserRefused('invalid', read.refusal));
    if (seq <= subscription.inputSeq) return Promise.resolve(); // taken already
    subscription.inputSeq = seq;
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      const last = subscription.queue.at(-1);
      if (read.input.kind === 'pointer' && read.input.type === 'move' && last?.event.kind === 'pointer' && last.event.type === 'move') {
        last.seq = seq; // a move waiting is replaced by the newer one
        last.event = read.input;
        last.waiters.push(waiter);
        return;
      }
      if (subscription.queue.length + (subscription.sending ? 1 : 0) >= BROWSER_LIMITS.inputQueue) {
        log(`[browser] ${subscription.id}: its input passed ${BROWSER_LIMITS.inputQueue} waiting: control closed`);
        settle(subscription, 'input_overflow', { tell: true, close: true });
        return reject(new BrowserRefused('input_overflow'));
      }
      subscription.queue.push({ seq, event: read.input, waiters: [waiter] });
      send(subscription);
    });
  }

  // ---- open ---------------------------------------------------------------------------------------------------------

  const live = () => [...subscriptions.values()];

  function open(input: { appSessionId: AppSessionId; epoch: string; tabId: string; control: boolean }, sink: Parameters<BrowserFeed['open']>[1]): Promise<BrowserSubscription> {
    const { appSessionId, epoch, tabId, control } = input;
    if (typeof appSessionId !== 'string' || typeof epoch !== 'string' || typeof control !== 'boolean' || !BrowserTabIdSchema.safeParse(tabId).success) return Promise.reject(new BrowserRefused('invalid', 'an open names a session, an epoch, a tab and whether it controls'));
    if (route.reading(appSessionId).epoch !== epoch) return Promise.reject(new BrowserRefused('engine_changed'));
    const inventory = route.inventory(appSessionId);
    if (inventory.state !== 'ready') return Promise.reject(new BrowserRefused('unavailable', inventory.reason ?? `the agent's browser is unavailable on ${options.machine}`));
    const selection = route.selection(appSessionId);
    if (selection === null || selection.period !== epoch || !inventory.tabs.some((tab) => tab.tabId === tabId)) return Promise.reject(new BrowserRefused('tab_closed'));
    if (live().filter((subscription) => subscription.appSessionId === appSessionId).length >= BROWSER_LIMITS.viewers.session) return Promise.reject(new BrowserRefused('viewers', `the session already has its ${BROWSER_LIMITS.viewers.session} viewers`));
    if (subscriptions.size >= BROWSER_LIMITS.viewers.total) return Promise.reject(new BrowserRefused('viewers', `${options.machine} already has its ${BROWSER_LIMITS.viewers.total} viewers`));
    if (control && live().some((subscription) => subscription.control && subscription.appSessionId === appSessionId && subscription.tabId === tabId)) return Promise.reject(new BrowserRefused('control_busy'));
    return new Promise<BrowserSubscription>((resolve, reject) => {
      const subscription: Subscription = { id: `view-${++next}`, appSessionId, epoch, tabId, control, engine: selection.engine, sink, phase: 'opening', opened: { resolve, reject }, seq: 0, outstanding: false, viewport: null, inputSeq: 0, queue: [], sending: null };
      subscriptions.set(subscription.id, subscription);
      const handle: BrowserSubscription = {
        ack(seq) {
          if (subscription.phase !== 'open') return;
          if (!BrowserSeqSchema.safeParse(seq).success) throw new BrowserRefused('invalid', `ack ${String(seq)} is not a positive safe integer`);
          if (seq > subscription.seq) throw new BrowserRefused('invalid', `ack ${seq} is a future sequence (the last frame is ${subscription.seq})`);
          if (!subscription.outstanding || seq !== subscription.seq) return; // a duplicate
          subscription.outstanding = false;
          request(subscription, { op: 'ack', subscriptionId: subscription.id, seq });
        },
        input: (seq, event) => takeInput(subscription, seq, event),
        close: () => settle(subscription, 'closed', { tell: false, close: true }),
      };
      request(subscription, { op: 'open', subscriptionId: subscription.id, tabId, control }, (result) => {
        if (subscription.phase !== 'opening') return; // settled meanwhile: refused then
        if (result?.ok) {
          subscription.phase = 'open';
          return resolve(handle);
        }
        const reason: BrowserRefusalReason = result && ENGINE_REASONS.has(result.error) ? (result.error as BrowserEndReason) : result ? 'unavailable' : 'engine_changed';
        if (result && reason === 'unavailable') log(`[browser] ${appSessionId}: the engine refused a viewer's open: ${result.error}`);
        settle(subscription, reason, { tell: false, close: false });
      });
    });
  }

  return {
    open,
    answer(engine, { id, result }) {
      const asked = pending.get(id);
      if (!asked || asked.engine !== engine) return false;
      pending.delete(id);
      asked.settle(result);
      return true;
    },
    frame(engine, { subscriptionId, frame }) {
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription || subscription.engine !== engine || subscription.phase === 'closed' || frame.tabId !== subscription.tabId) return false;
      const jpeg = Buffer.from(frame.jpegBase64, 'base64');
      const broken = subscription.outstanding || frame.seq <= subscription.seq ? 'producer_failed' : jpeg.byteLength > BROWSER_LIMITS.frameBytes ? 'frame_too_large' : null;
      if (broken !== null) {
        log(`[browser] ${subscriptionId}: its engine's frame ${frame.seq} broke the rule (${broken})`);
        settle(subscription, broken, { tell: true, close: true });
        return false;
      }
      subscription.seq = frame.seq;
      subscription.outstanding = true;
      subscription.viewport = frame.viewport;
      const { tabId, seq, capturedAt, width, height, viewport } = frame;
      const delivered: BrowserFrame = { epoch: subscription.epoch, tabId, seq, capturedAt, width, height, viewport, jpeg: new Uint8Array(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength) };
      try {
        subscription.sink.frame(delivered);
      } catch (error) {
        log(`[browser] a viewer's frame of ${subscriptionId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    },
    ended(engine, { subscriptionId, reason }) {
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription || subscription.engine !== engine) return false;
      settle(subscription, reason, { tell: true, close: false }); // a reason this build does not know passes on as it came (additive)
      return true;
    },
    gone(engine) {
      for (const [id, asked] of [...pending]) {
        if (asked.engine !== engine) continue;
        pending.delete(id);
        asked.settle(null);
      }
      for (const subscription of live()) if (subscription.engine === engine) settle(subscription, 'engine_changed', { tell: true, close: false });
    },
    inspect: () => ({ subscriptions: subscriptions.size, pending: pending.size }),
    dispose() {
      offPeriods();
      for (const subscription of live()) settle(subscription, 'engine_changed', { tell: true, close: false });
    },
  };
}
