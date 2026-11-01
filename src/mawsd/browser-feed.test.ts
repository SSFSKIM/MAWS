// The feed seam's subscriptions in `mawsd` (P5 O17 M6; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M6's Proves,
// Interfaces §F, §G; D4): a viewer's subscription to a tab the session's selected engine holds, its frames stamped with
// the route's epoch, one in flight until the viewer's ack, its controlling input ordered and bounded, and its end
// disposed exactly once whichever of the engine's `ended`, the viewer's close, the connection's end or the route's
// period end comes first. Over a stand-in route and engine connection (the daemon-level scene is daemon-browser.test.ts).
import { describe, expect, it } from 'vitest';
import { BrowserRefused, type BrowserFrame, type BrowserInput, type BrowserInventory } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserEngineRequest, BrowserEngineResult } from '@shared/ipc/schema/browser-engine';
import { createBrowserFeed } from './browser-feed';
import type { PeriodEnd } from './browser-route';
import type { BrowserRouteState } from './cua-broker';

const S = 'S' as AppSessionId;
const T = 'T' as AppSessionId;
const TAB = 'b_000000000001';
const OTHER_TAB = 'b_000000000002';
const JPEG = Buffer.from([0xff, 0xd8, 0xff]).toString('base64');
const click = (x = 10, y = 10): BrowserInput => ({ kind: 'pointer', type: 'down', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: [] });
const move = (x: number): BrowserInput => ({ kind: 'pointer', type: 'move', x, y: 1, button: 'left', buttons: 0, clickCount: 0, modifiers: [] });

function stand(options: { state?: BrowserRouteState; tabs?: string[] } = {}) {
  const engine = { name: 'render host' };
  const other = { name: 'another connection' };
  const route = { state: options.state ?? 'headless', epoch: 'e.1', tabs: options.tabs ?? [TAB, OTHER_TAB], reason: 'the agent’s browser is in the MAWS app on mini' };
  const ends = new Set<(appSessionId: AppSessionId, reason: PeriodEnd) => void>();
  const posted: { engine: object; request: BrowserEngineRequest }[] = [];
  const logs: string[] = [];
  const feed = createBrowserFeed({
    machine: 'mini',
    route: {
      reading: () => ({ state: route.state, epoch: route.epoch }),
      selection: () => (route.state === 'headless' ? { engine, period: route.epoch } : null),
      inventory: (): BrowserInventory =>
        route.state === 'relay' ? { epoch: route.epoch, tabs: [], selected: null, state: 'unavailable', reason: route.reason } : { epoch: route.epoch, tabs: route.tabs.map((tabId) => ({ tabId, title: '', url: 'http://127.0.0.1:4000/', control: 'idle' as const })), selected: null, state: 'ready' },
      periodEnds: (listener) => (ends.add(listener), () => void ends.delete(listener)),
    },
    post: (to, request) => (posted.push({ engine: to, request }), true),
    log: (line) => void logs.push(line),
  });
  // A viewer's sink, and what it heard
  const sink = () => {
    const frames: BrowserFrame[] = [];
    const closed: string[] = [];
    return { frames, closed, sinkOf: { frame: (frame: BrowserFrame) => void frames.push(frame), closed: (reason: string) => void closed.push(reason) } };
  };
  const ops = () => posted.map(({ request }) => request.operation.op);
  const last = (op: string) => posted.filter(({ request }) => request.operation.op === op).at(-1)!.request;
  const answer = (request: BrowserEngineRequest, result: BrowserEngineResult = { ok: true, value: null }, from: object = engine) => feed.answer(from, { id: request.id, result });
  const frameOf = (subscriptionId: string, seq: number, patch: Record<string, unknown> = {}, from: object = engine) =>
    feed.frame(from, { subscriptionId, frame: { tabId: TAB, seq, capturedAt: 5, width: 640, height: 400, viewport: { width: 1280, height: 800 }, jpegBase64: JPEG, ...patch } });
  // A subscription opened and answered
  const opened = async (control = false, tabId = TAB) => {
    const viewer = sink();
    const opening = feed.open({ appSessionId: S, epoch: route.epoch, tabId, control }, viewer.sinkOf);
    const request = last('open');
    answer(request);
    const subscription = await opening;
    const id = (request.operation as { subscriptionId: string }).subscriptionId;
    return { viewer, subscription, id };
  };
  const endPeriod = (reason: PeriodEnd, appSessionId: AppSessionId = S) => {
    route.epoch = `${route.epoch}+`;
    for (const listener of [...ends]) listener(appSessionId, reason);
  };
  return { feed, engine, other, route, posted, ops, last, answer, frameOf, opened, sink, endPeriod, logs };
}

const refusal = (promise: Promise<unknown>) => promise.then(
  () => null,
  (error: unknown) => (error instanceof BrowserRefused ? error.reason : `not a refusal: ${String(error)}`),
);

describe('opening a subscription (§G)', () => {
  it('opens on the session’s selected engine, never creating a tab, and stamps every frame with the route’s epoch', async () => {
    const t = stand();
    const { viewer, id } = await t.opened();
    expect(t.posted[0]).toMatchObject({ engine: t.engine, request: { appSessionId: S, operation: { op: 'open', subscriptionId: id, tabId: TAB, control: false } } });
    expect(t.frameOf(id, 1)).toBe(true);
    expect(viewer.frames).toEqual([{ epoch: 'e.1', tabId: TAB, seq: 1, capturedAt: 5, width: 640, height: 400, viewport: { width: 1280, height: 800 }, jpeg: new Uint8Array([0xff, 0xd8, 0xff]) }]);
  });

  it('refuses another epoch (engine_changed), a tab the engine does not hold, a route with no engine, and past the viewer budgets', async () => {
    const t = stand();
    const viewer = t.sink();
    expect(await refusal(t.feed.open({ appSessionId: S, epoch: 'e.0', tabId: TAB, control: false }, viewer.sinkOf))).toBe('engine_changed');
    expect(await refusal(t.feed.open({ appSessionId: S, epoch: 'e.1', tabId: 'b_00000000000f', control: false }, viewer.sinkOf))).toBe('tab_closed');
    expect(await refusal(t.feed.open({ appSessionId: S, epoch: 'e.1', tabId: 'not a tab', control: false }, viewer.sinkOf))).toBe('invalid');
    const relay = stand({ state: 'relay' });
    const refused = await relay.feed.open({ appSessionId: S, epoch: 'e.1', tabId: TAB, control: false }, viewer.sinkOf).catch((error: BrowserRefused) => error);
    expect(refused).toMatchObject({ reason: 'unavailable', message: 'the agent’s browser is in the MAWS app on mini' });
    expect(t.posted, 'nothing sent for a refusal').toEqual([]);
    for (let i = 0; i < 4; i += 1) await t.opened();
    expect(await refusal(t.feed.open({ appSessionId: S, epoch: 'e.1', tabId: TAB, control: false }, viewer.sinkOf)), 'four per session').toBe('viewers');
  });

  it('holds 32 viewers on the machine at most', async () => {
    const t = stand();
    const viewer = t.sink();
    for (let i = 0; i < 32; i += 1) void t.feed.open({ appSessionId: (`s${i % 8}`) as AppSessionId, epoch: 'e.1', tabId: TAB, control: false }, viewer.sinkOf);
    expect(await refusal(t.feed.open({ appSessionId: T, epoch: 'e.1', tabId: TAB, control: false }, viewer.sinkOf))).toBe('viewers');
  });

  it('lets one subscription control a tab: a second gets control_busy, from mawsd or from the engine', async () => {
    const t = stand();
    await t.opened(true);
    expect(await refusal(t.feed.open({ appSessionId: S, epoch: 'e.1', tabId: TAB, control: true }, t.sink().sinkOf))).toBe('control_busy');
    const other = t.feed.open({ appSessionId: S, epoch: 'e.1', tabId: OTHER_TAB, control: true }, t.sink().sinkOf);
    t.answer(t.last('open'), { ok: false, error: 'control_busy' });
    expect(await refusal(other)).toBe('control_busy');
    expect(t.feed.inspect().subscriptions).toBe(1);
  });
});

describe('frames and acks (§F, §G)', () => {
  it('takes one frame in flight; the ack of it is the credit, a duplicate a no-op, a future sequence refused', async () => {
    const t = stand();
    const { subscription, id } = await t.opened();
    expect(t.frameOf(id, 1)).toBe(true);
    expect(() => subscription.ack(2)).toThrow(BrowserRefused);
    subscription.ack(1);
    subscription.ack(1);
    expect(t.ops()).toEqual(['open', 'ack']);
    expect(t.last('ack').operation).toEqual({ op: 'ack', subscriptionId: id, seq: 1 });
    expect(t.frameOf(id, 2)).toBe(true);
  });

  it('refuses a frame for a settled subscription, from another connection, for another tab, and a second one in flight (the engine broke the rule: producer_failed)', async () => {
    const t = stand();
    const { viewer, subscription, id } = await t.opened();
    expect(t.frameOf(id, 1, {}, t.other)).toBe(false);
    expect(t.frameOf(id, 1, { tabId: OTHER_TAB })).toBe(false);
    expect(t.frameOf(id, 1)).toBe(true);
    expect(t.frameOf(id, 2)).toBe(false);
    expect(viewer.closed).toEqual(['producer_failed']);
    expect(t.last('close').operation).toEqual({ op: 'close', subscriptionId: id });
    subscription.close();
    expect(t.frameOf(id, 3), 'settled').toBe(false);
    expect(viewer.frames).toHaveLength(1);
  });
});

describe('a controlling viewer’s input (§G)', () => {
  it('refuses input on a read-only subscription, a point before any frame and outside the viewport, and an invalid event', async () => {
    const t = stand();
    const { subscription } = await t.opened();
    expect(await refusal(subscription.input(1, click()))).toBe('read_only');
    const controlling = await t.opened(true, OTHER_TAB);
    expect(await refusal(controlling.subscription.input(1, click())), 'no frame seen').toBe('invalid');
    t.frameOf(controlling.id, 1, { tabId: OTHER_TAB });
    expect(await refusal(controlling.subscription.input(1, click(1281, 1)))).toBe('invalid');
    expect(await refusal(controlling.subscription.input(1, { kind: 'key', type: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: ['Hyper'] }))).toBe('invalid');
    expect(await refusal(controlling.subscription.input(0, { kind: 'blur' }))).toBe('invalid');
  });

  it('sends input in order, one in flight, a sequence once, moves coalesced while queued', async () => {
    const t = stand();
    const { subscription, id } = await t.opened(true);
    t.frameOf(id, 1);
    const first = subscription.input(1, click());
    void subscription.input(1, click()); // taken once
    const moves = [subscription.input(2, move(1)), subscription.input(3, move(2)), subscription.input(4, move(3))];
    const key = subscription.input(5, { kind: 'key', type: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: [] });
    const inputs = () => t.posted.filter(({ request }) => request.operation.op === 'input').map(({ request }) => request);
    expect(inputs()).toHaveLength(1);
    t.answer(inputs()[0]!);
    await first;
    expect(inputs()).toHaveLength(2);
    expect(inputs()[1]!.operation).toMatchObject({ seq: 4, event: { x: 3 } }); // three moves, the last sent
    t.answer(inputs()[1]!);
    await Promise.all(moves);
    t.answer(inputs()[2]!, { ok: false, error: 'view_gone' });
    await expect(key).rejects.toThrow('view_gone');
    expect(inputs().map((request) => (request.operation as { seq: number }).seq)).toEqual([1, 4, 5]);
  });

  it('closes control at an overflow past 32 queued inputs: the viewer told input_overflow, the engine told to close (releasing held keys and buttons), every pending input refused', async () => {
    const t = stand();
    const { viewer, subscription, id } = await t.opened(true);
    t.frameOf(id, 1);
    const pending = Array.from({ length: 32 }, (_, at) => subscription.input(at + 1, { kind: 'key', type: at % 2 ? 'up' : 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: [] }));
    expect(viewer.closed).toEqual([]);
    const over = subscription.input(33, click());
    expect(await refusal(over)).toBe('input_overflow');
    expect(viewer.closed).toEqual(['input_overflow']);
    expect(t.ops().at(-1)).toBe('close');
    const outcomes = await Promise.all(pending.map(refusal));
    expect(outcomes.every((reason) => reason === 'input_overflow')).toBe(true);
  });
});

describe('a subscription’s end, disposed exactly once (D4)', () => {
  it('ends at the engine’s ended: the viewer told once, pending input refused once, nothing after counts', async () => {
    const t = stand();
    const { viewer, subscription, id } = await t.opened(true);
    t.frameOf(id, 1);
    const pending = subscription.input(1, click());
    let refusals = 0;
    pending.catch(() => (refusals += 1));
    expect(t.feed.ended(t.other, { subscriptionId: id, reason: 'view_gone' }), 'from another connection').toBe(false);
    expect(t.feed.ended(t.engine, { subscriptionId: id, reason: 'producer_failed' })).toBe(true);
    expect(t.feed.ended(t.engine, { subscriptionId: id, reason: 'producer_failed' }), 'a second time').toBe(false);
    subscription.close();
    t.endPeriod('engine_changed');
    t.feed.gone(t.engine);
    await new Promise((resolve) => setImmediate(resolve));
    expect(viewer.closed).toEqual(['producer_failed']);
    expect(refusals).toBe(1);
    expect(t.ops().filter((op) => op === 'close'), 'the engine ended it: nothing to close there').toEqual([]);
    expect(t.feed.inspect(), 'the connection’s end settled the input’s request').toEqual({ subscriptions: 0, pending: 0 });
  });

  it('ends at the route’s period end with its reason, the engine told to close, and at the connection’s end engine_changed', async () => {
    const t = stand();
    const tabClosed = await t.opened();
    const elsewhere = stand();
    const changed = await elsewhere.opened();
    t.endPeriod('tab_closed');
    expect(tabClosed.viewer.closed).toEqual(['tab_closed']);
    expect(t.last('close').operation).toEqual({ op: 'close', subscriptionId: tabClosed.id });
    t.endPeriod('engine_changed', T); // another session's period: nothing here
    expect(tabClosed.viewer.closed).toHaveLength(1);
    elsewhere.feed.gone(elsewhere.engine);
    expect(changed.viewer.closed).toEqual(['engine_changed']);
    expect(elsewhere.ops()).toEqual(['open']);
  });

  it('refuses an open still waiting for its answer when the period ends, the viewer never handed a subscription', async () => {
    const t = stand();
    const viewer = t.sink();
    const opening = t.feed.open({ appSessionId: S, epoch: 'e.1', tabId: TAB, control: true }, viewer.sinkOf);
    const request = t.last('open');
    t.endPeriod('engine_changed');
    expect(await refusal(opening)).toBe('engine_changed');
    expect(viewer.closed, 'never opened: no close to tell').toEqual([]);
    expect(t.ops()).toEqual(['open', 'close']); // the engine may have opened it: closed there, after the open
    expect(t.answer(request), 'its late answer taken and ignored').toBe(true);
    void t.feed.open({ appSessionId: S, epoch: 'e.1+', tabId: TAB, control: true }, viewer.sinkOf);
    expect(t.ops(), 'the tab’s control is free again').toEqual(['open', 'close', 'open']);
  });

  it('passes an engine’s reason this build does not know on as it came (a string, so a new reason stays additive)', async () => {
    const t = stand();
    const { viewer, id } = await t.opened();
    expect(t.feed.ended(t.engine, { subscriptionId: id, reason: 'renderer_crashed' })).toBe(true);
    expect(viewer.closed).toEqual(['renderer_crashed']);
  });

  it('ends at the viewer’s own close without telling it, the engine told to close; a later ended from the engine finds nothing', async () => {
    const t = stand();
    const { viewer, subscription, id } = await t.opened();
    subscription.close();
    subscription.close();
    expect(t.ops()).toEqual(['open', 'close']);
    expect(viewer.closed).toEqual([]);
    expect(t.feed.ended(t.engine, { subscriptionId: id, reason: 'tab_closed' })).toBe(false);
    subscription.ack(1);
    expect(t.ops(), 'an ack after the close is nothing').toEqual(['open', 'close']);
  });
});
