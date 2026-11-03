// The remote view's bridge (P5 O17 M9b; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K, "The app's
// bridge"; M9's Decisions): a window's own viewers of the agent's tabs on another machine's session, over a stand-in of
// that machine's RL2 link (its subscriptions, streams and acts) and the real device half of a screencast
// (browser-stream.ts). The feed's inventory to the window; one stream per view, replaced by `select`; frame credit only by
// the window's `ack` of the frame it drew; control under a done `machine.browserControl` act, the controlling stream
// opened beside the read-only one and taking its place once admitted; a window's views its own, ended with it.
import { encodeScreencastFrame, type StreamBrowserOpen } from 'org-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import type { BrowserInventory } from '@shared/browser/screencast';
import type { MachineRef } from '@shared/machine/ref';
import type { ActOutcome, ActRequest } from '../machines/remote/link';
import type { StreamRequest, StreamSink } from '../machines/remote/streams';
import type { SubscribeRequest, SubscriptionSink } from '../machines/remote/subs';
import { createRemoteViews, type RemoteViewLink, type RemoteViews, type RemoteViewsTiming } from './remote-view';

const LOCAL = 'mac-local' as MachineRef;
const MINI = 'mac-mini' as MachineRef;
const TAB = 'b_000000000001';
const OTHER = 'b_000000000002';
const inventory = (epoch = 'e.1', tabs = [TAB, OTHER]): BrowserInventory => ({ epoch, tabs: tabs.map((tabId) => ({ tabId, title: tabId, url: 'http://127.0.0.1:5173/', control: 'agent' as const })), selected: null, state: 'ready' });

interface FakeStream {
  request: StreamRequest & { browser: StreamBrowserOpen };
  sink: StreamSink;
  controls: Record<string, unknown>[];
  closed: string | null;
  offset: number;
}

class Link implements RemoteViewLink {
  readonly name = 'mini';
  current = true;
  readonly subs: { request: SubscribeRequest; sink: SubscriptionSink; closed: boolean }[] = [];
  readonly streams: FakeStream[] = [];
  readonly acts: { request: ActRequest; settle(outcome: ActOutcome): void }[] = [];
  carrier = () => (this.current ? ('direct' as const) : null);
  subscribe(request: SubscribeRequest, sink: SubscriptionSink) {
    const sub = { request, sink, closed: false };
    this.subs.push(sub);
    return { id: `sub-${this.subs.length}`, cursor: () => null, close: () => void (sub.closed = true) };
  }
  openStream(request: StreamRequest, sink: StreamSink) {
    const stream: FakeStream = { request: request as FakeStream['request'], sink, controls: [], closed: null, offset: 0 };
    this.streams.push(stream);
    return { id: `st-${this.streams.length}`, send() {}, control: (control: Record<string, unknown>) => void stream.controls.push(control), credit() {}, close: (reason = 'closed') => void (stream.closed = reason), queued: () => 0 };
  }
  act(request: ActRequest) {
    let settle!: (outcome: ActOutcome) => void;
    const outcome = new Promise<ActOutcome>((resolve) => (settle = resolve));
    this.acts.push({ request, settle });
    return { opId: `op-${this.acts.length}`, opCreated: 'now', progress: () => 'sent' as never, onProgress: () => () => {}, outcome };
  }
  // the endpoint's side
  snapshot(value: BrowserInventory, at = 0) {
    this.subs[at]!.sink.snapshot({ epoch: 's', seq: 0 }, value);
  }
  opened(at: number, control: boolean) {
    const { browser } = this.streams[at]!.request;
    this.streams[at]!.sink.opened({ credit: 0, browser: { epoch: browser.epoch, tabId: browser.tabId, control } } as never);
  }
  frame(at: number, seq: number, width = 640) {
    const stream = this.streams[at]!;
    const bytes = encodeScreencastFrame({ epoch: stream.request.browser.epoch, tabId: stream.request.browser.tabId, seq, capturedAt: seq, width, height: 400, viewport: { width: 1280, height: 800 }, jpeg: new Uint8Array([0xff, 0xd8, seq]) });
    stream.sink.data(stream.offset, bytes);
    stream.offset += bytes.byteLength;
  }
}

const views: RemoteViews[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.stop();
  vi.useRealTimers();
});

function stand(options: { link?: Link | null; timing?: Partial<RemoteViewsTiming> } = {}) {
  const link = options.link === undefined ? new Link() : options.link;
  const told: { client: string; name: string; payload: Record<string, unknown> }[] = [];
  const logged: string[] = [];
  const bridge = createRemoteViews({
    local: LOCAL,
    remote: (machine) => (machine === MINI ? link : null),
    emit: (client, name, payload) => void told.push({ client: client.id, name, payload: payload as Record<string, unknown> }),
    log: (line) => void logged.push(line),
    ...(options.timing && { timing: options.timing }),
  });
  views.push(bridge);
  const window = endableClientRef('page:1.1');
  const ctx = (client: ClientRef = window, target: MachineRef = MINI) => ({ client, target });
  const of = (name: string) => told.filter((event) => event.name === name).map((event) => event.payload);
  const opened = async (value = inventory()) => {
    const opening = bridge.open({ appSessionId: 'app-1' }, ctx());
    link!.snapshot(value);
    return opening;
  };
  return { link: link!, bridge, told, logged, window, ctx, of, opened };
}

describe('browser.remote.open: the feed and whether the view is possible', () => {
  it('subscribes to the session’s browser.inventory feed and answers its first snapshot, each later one an event to the window', async () => {
    const t = stand();
    const { viewId, inventory: first } = await t.opened();
    expect(t.link.subs[0]!.request).toEqual({ session: { lane: 'B', id: 'app-1' }, feed: 'browser.inventory' });
    expect(first).toEqual(inventory());
    t.link.subs[0]!.sink.event({ epoch: 's', seq: 1 }, inventory('e.1', [TAB]));
    expect(t.of('browser.remote.inventory')).toEqual([{ viewId, inventory: inventory('e.1', [TAB]) }]);
    expect(t.told.every((event) => event.client === t.window.id)).toBe(true);
    t.link.subs[0]!.sink.event({ epoch: 's', seq: 2 }, { not: 'an inventory' });
    expect(t.of('browser.remote.inventory'), 'an inventory out of shape is dropped').toHaveLength(1);
  });

  it('answers at once, unavailable, when no channel is current, then tells the snapshot as it comes', async () => {
    const link = new Link();
    link.current = false;
    const t = stand({ link });
    const { viewId, inventory: first } = await t.bridge.open({ appSessionId: 'app-1' }, t.ctx());
    expect(first).toMatchObject({ state: 'unavailable', reason: 'connecting to mini' });
    t.link.snapshot(inventory());
    expect(t.of('browser.remote.inventory')).toEqual([{ viewId, inventory: inventory() }]);
  });

  it('answers with what it has when the endpoint has not answered by the open’s bound, the feed going on', async () => {
    vi.useFakeTimers();
    const t = stand();
    const opening = t.bridge.open({ appSessionId: 'app-1' }, t.ctx());
    await vi.advanceTimersByTimeAsync(10_000);
    const { viewId, inventory: first } = await opening;
    expect(first).toMatchObject({ state: 'unavailable', reason: 'mini has not answered yet' });
    t.link.snapshot(inventory());
    expect(t.of('browser.remote.inventory')).toEqual([{ viewId, inventory: inventory() }]);
  });

  it('reads a machine whose endpoint does not offer the feed as too old, and one with no link as unreachable', async () => {
    const t = stand();
    const opening = t.bridge.open({ appSessionId: 'app-1' }, t.ctx());
    t.link.subs[0]!.sink.ended('not-offered');
    expect((await opening).inventory).toMatchObject({ state: 'unavailable', reason: 'the MAWS on mini is too old to show the agent’s browser here' });
    const other = await t.bridge.open({ appSessionId: 'app-1' }, t.ctx(t.window, 'mac-elsewhere' as MachineRef));
    expect(other.inventory).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('no link reaches') });
    await expect(t.bridge.open({ appSessionId: 'app-1' }, t.ctx(t.window, LOCAL))).rejects.toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('tells the connection’s loss as unavailable, resubscribes a feed that fell behind, and ends the view with a feed that ended', async () => {
    const t = stand();
    const { viewId } = await t.opened();
    t.link.subs[0]!.sink.paused('offline');
    expect(t.of('browser.remote.inventory').at(-1)).toMatchObject({ viewId, inventory: { state: 'unavailable', reason: 'the connection to mini was lost' } });
    t.link.subs[0]!.sink.ended('behind');
    expect(t.link.subs).toHaveLength(2);
    expect(t.link.subs[1]!.request).toEqual(t.link.subs[0]!.request);
    t.link.snapshot(inventory(), 1);
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    t.link.opened(0, false);
    t.link.subs[1]!.sink.ended('removed');
    expect(t.link.streams[0]!.closed).toBe('closed');
    expect(t.of('browser.remote.closed')).toEqual([{ viewId, reason: 'removed' }]);
    expect(t.of('browser.remote.inventory').at(-1)).toMatchObject({ inventory: { state: 'unavailable', reason: 'you can no longer view this session on mini' } });
    expect(() => t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx())).toThrow(/ended/);
  });
});

describe('browser.remote.select, .ack and .close: one stream per view, frame credit by the window', () => {
  it('opens a read-only stream for the selected tab; a frame to the window, its ack only of the frame it was sent', async () => {
    const t = stand();
    const { viewId } = await t.opened();
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    expect(t.link.streams[0]!.request).toMatchObject({ kind: 'browser.screencast', browser: { appSessionId: 'app-1', epoch: 'e.1', tabId: TAB } });
    expect(t.link.streams[0]!.request.browser.control).toBeUndefined();
    t.link.opened(0, false);
    t.link.frame(0, 1);
    expect(t.of('browser.remote.frame')).toEqual([{ viewId, frame: expect.objectContaining({ epoch: 'e.1', tabId: TAB, seq: 1, jpeg: new Uint8Array([0xff, 0xd8, 1]) }) }]);
    expect(t.link.streams[0]!.controls, 'no credit on receipt').toEqual([]);
    t.bridge.ack({ viewId, seq: 2 }, t.ctx());
    expect(t.link.streams[0]!.controls, 'a frame not sent: no ack').toEqual([]);
    t.bridge.ack({ viewId, seq: 1 }, t.ctx());
    t.bridge.ack({ viewId, seq: 1 }, t.ctx());
    expect(t.link.streams[0]!.controls).toEqual([{ ack: { seq: 1 } }]);
    // another tab: this view's stream replaced, telling the window nothing of the old one
    t.bridge.select({ viewId, epoch: 'e.1', tabId: OTHER }, t.ctx());
    expect(t.link.streams[0]!.closed).toBe('closed');
    expect(t.link.streams[1]!.request.browser.tabId).toBe(OTHER);
    expect(t.of('browser.remote.closed')).toEqual([]);
    t.link.streams[1]!.sink.closed('tab-closed');
    expect(t.of('browser.remote.closed')).toEqual([{ viewId, reason: 'tab-closed' }]);
    expect(() => t.bridge.input({ viewId, seq: 1, event: { kind: 'blur' } }, t.ctx())).toThrow(/control/);
    t.bridge.close({ viewId }, t.ctx());
    expect(t.link.subs[0]!.closed).toBe(true);
    t.bridge.close({ viewId }, t.ctx()); // once more: nothing
  });

  it('closes the stream producer-failed at a frame out of shape, telling the window, never a silent stall', async () => {
    const t = stand();
    const { viewId } = await t.opened();
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    t.link.opened(0, false);
    t.link.frame(0, 1, 4000); // the wire's codec takes it; browser.remote.frame's schema, bounded at 1280 wide, refuses it
    expect(t.of('browser.remote.frame')).toEqual([]);
    expect(t.link.streams[0]!.closed, 'the stream closed, not left waiting on an ack the window cannot send').not.toBeNull();
    expect(t.of('browser.remote.closed')).toEqual([{ viewId, reason: 'producer-failed' }]);
    expect(t.logged.some((line) => /out of shape/.test(line))).toBe(true);
    t.bridge.ack({ viewId, seq: 1 }, t.ctx());
    expect(t.link.streams[0]!.controls, 'no credit for a frame never shown').toEqual([]);
    // the window selects again to go on
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    t.link.opened(1, false);
    t.link.frame(1, 1);
    expect(t.of('browser.remote.frame')).toEqual([{ viewId, frame: expect.objectContaining({ seq: 1 }) }]);
  });

  it('keeps a window’s views its own, and ends them with the window, an open answered after it disposed at once', async () => {
    const t = stand();
    const { viewId } = await t.opened();
    const other = endableClientRef('page:2.1');
    expect(() => t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx(other))).toThrow(/no view/);
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    const late = t.bridge.open({ appSessionId: 'app-1' }, t.ctx());
    t.window.end();
    expect(t.link.subs[0]!.closed).toBe(true);
    expect(t.link.streams[0]!.closed).toBe('closed');
    t.link.snapshot(inventory(), 1);
    await late;
    expect(t.link.subs[1]!.closed, 'an open answered after its window ended').toBe(true);
  });
});

describe('browser.remote.takeControl and .releaseControl: control under a done machine.browserControl act', () => {
  it('asks the act for the selected tab’s epoch, opens a controlling stream beside the read-only one, which it replaces once admitted', async () => {
    const t = stand();
    const { viewId } = await t.opened();
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    t.link.opened(0, false);
    const taking = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.acts).toHaveLength(1));
    expect(t.link.acts[0]!.request).toMatchObject({ action: 'machine.browserControl', args: { appSessionId: 'app-1', epoch: 'e.1' }, executor: 'endpoint' });
    t.link.acts[0]!.settle({ state: 'done', result: { appSessionId: 'app-1', epoch: 'e.1' } });
    await vi.waitFor(() => expect(t.link.streams).toHaveLength(2));
    expect(t.link.streams[1]!.request.browser).toEqual({ appSessionId: 'app-1', epoch: 'e.1', tabId: TAB, control: { op: 'op-1' } });
    expect(t.link.streams[0]!.closed, 'the read-only stream kept until the controlling one is admitted').toBeNull();
    t.link.opened(1, true);
    expect(await taking).toEqual({ control: true });
    expect(t.link.streams[0]!.closed).toBe('closed');
    t.link.frame(1, 1);
    t.bridge.input({ viewId, seq: 1, event: { kind: 'text', text: 'hi' } }, t.ctx());
    expect(t.link.streams[1]!.controls).toEqual([{ input: { seq: 1, event: { kind: 'text', text: 'hi' } } }]);
    // another tab under the same grant: controlling, no second act
    t.bridge.select({ viewId, epoch: 'e.1', tabId: OTHER }, t.ctx());
    expect(t.link.streams[2]!.request.browser.control).toEqual({ op: 'op-1' });
    expect(t.link.acts).toHaveLength(1);
    // released: input stops at once, the view goes on read-only
    t.bridge.releaseControl({ viewId }, t.ctx());
    expect(t.link.streams[2]!.closed).toBe('closed');
    expect(t.link.streams[3]!.request.browser.control).toBeUndefined();
    expect(() => t.bridge.input({ viewId, seq: 2, event: { kind: 'blur' } }, t.ctx())).toThrow(/control/);
  });

  it('answers a refused act or a refused controlling open with its reason, the read-only stream kept', async () => {
    const t = stand();
    const { viewId } = await t.opened();
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    t.link.opened(0, false);
    const refused = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.acts).toHaveLength(1));
    t.link.acts[0]!.settle({ state: 'refused', reason: 'step-up-cancelled' });
    expect(await refused).toEqual({ control: false, reason: 'step-up-cancelled' });
    const busy = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.acts).toHaveLength(2));
    t.link.acts[1]!.settle({ state: 'done', result: { appSessionId: 'app-1', epoch: 'e.1' } });
    await vi.waitFor(() => expect(t.link.streams).toHaveLength(2));
    t.link.streams[1]!.sink.closed('control-busy');
    expect(await busy).toEqual({ control: false, reason: 'control-busy' });
    expect(t.link.streams[0]!.closed).toBeNull();
    expect(t.of('browser.remote.closed')).toEqual([]);
    expect(await t.bridge.takeControl({ viewId: 'nope' }, t.ctx()).catch((error: { error: { code: string } }) => error.error.code)).toBe('invalid_input');
  });

  // P5 O17 M9b fix wave: the window's belief and the stream agree
  it('a select while a take waits on its controlling stream answers the take not taken, and opens the new tab read-only', async () => {
    const t = stand();
    const { viewId } = await t.opened();
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    t.link.opened(0, false);
    const taking = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.acts).toHaveLength(1));
    t.link.acts[0]!.settle({ state: 'done', result: { appSessionId: 'app-1', epoch: 'e.1' } });
    await vi.waitFor(() => expect(t.link.streams).toHaveLength(2));
    t.bridge.select({ viewId, epoch: 'e.1', tabId: OTHER }, t.ctx());
    expect(await taking).toEqual({ control: false, reason: 'the view’s stream was replaced' });
    expect(t.link.streams[1]!.closed).toBe('closed');
    expect(t.link.streams[2]!.request.browser, 'read-only, as the window was told').toEqual({ appSessionId: 'app-1', epoch: 'e.1', tabId: OTHER });
    // the grant stays for its epoch: the next take asks no new act
    const again = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.streams).toHaveLength(4));
    expect(t.link.acts).toHaveLength(1);
    t.link.opened(3, true);
    expect(await again).toEqual({ control: true });
  });

  it('bounds the wait for the controlling stream’s admission as the act’s: unanswered, the take is not taken and the stream closed', async () => {
    const t = stand({ timing: { controlAnswerMs: 50 } });
    const { viewId } = await t.opened();
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    t.link.opened(0, false);
    const taking = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.acts).toHaveLength(1));
    t.link.acts[0]!.settle({ state: 'done', result: { appSessionId: 'app-1', epoch: 'e.1' } });
    await vi.waitFor(() => expect(t.link.streams).toHaveLength(2));
    expect(await taking).toEqual({ control: false, reason: 'mini did not admit control in time' });
    expect(t.link.streams[1]!.closed).toBe('closed');
    expect(t.link.streams[0]!.closed, 'the read-only stream goes on').toBeNull();
    t.link.opened(1, true); // too late: nothing changes
    expect(() => t.bridge.input({ viewId, seq: 1, event: { kind: 'blur' } }, t.ctx())).toThrow(/control/);
    t.bridge.select({ viewId, epoch: 'e.1', tabId: OTHER }, t.ctx());
    expect(t.link.streams[2]!.request.browser.control, 'the window was told read-only').toBeUndefined();
  });

  it('lets go of control at a revocation and at a new epoch: the next take asks a new act', async () => {
    const t = stand();
    const { viewId } = await t.opened();
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    const taking = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.acts).toHaveLength(1));
    t.link.acts[0]!.settle({ state: 'done', result: { appSessionId: 'app-1', epoch: 'e.1' } });
    await vi.waitFor(() => expect(t.link.streams).toHaveLength(2));
    t.link.opened(1, true);
    await taking;
    t.link.streams[1]!.sink.closed('control-revoked');
    expect(t.of('browser.remote.closed')).toEqual([{ viewId, reason: 'control-revoked' }]);
    t.bridge.select({ viewId, epoch: 'e.1', tabId: TAB }, t.ctx());
    expect(t.link.streams[2]!.request.browser.control, 'read-only after the revocation').toBeUndefined();
    const again = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.acts).toHaveLength(2));
    t.link.acts[1]!.settle({ state: 'done', result: { appSessionId: 'app-1', epoch: 'e.1' } });
    await vi.waitFor(() => expect(t.link.streams).toHaveLength(4));
    t.link.opened(3, true);
    await again;
    t.link.subs[0]!.sink.event({ epoch: 's', seq: 1 }, inventory('e.2')); // a handover: the grant dies with its epoch
    t.bridge.select({ viewId, epoch: 'e.2', tabId: TAB }, t.ctx());
    expect(t.link.streams[4]!.request.browser).toEqual({ appSessionId: 'app-1', epoch: 'e.2', tabId: TAB });
    const third = t.bridge.takeControl({ viewId }, t.ctx());
    await vi.waitFor(() => expect(t.link.acts).toHaveLength(3));
    expect(t.link.acts[2]!.request.args).toEqual({ appSessionId: 'app-1', epoch: 'e.2' });
    t.link.acts[2]!.settle({ state: 'unknown', reason: 'expired' });
    expect(await third).toEqual({ control: false, reason: 'expired' });
  });
});
