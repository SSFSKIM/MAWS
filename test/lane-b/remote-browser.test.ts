// The agent's browser across machines through a real link against a real endpoint (P5 O17 M9a;
// docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M9, Interfaces §K): main's RL2 link (`createRemoteLink`, under the
// profile's real device keys, endorsed on the org's head) to the endpoint's own harness on its direct listener, its feed
// seam the suite's fake browser. The seam M9b's bridge consumes, end to end: the session's `browser.inventory` feed through
// `RemoteLink.subscribe`, a screencast through `openBrowserStream` (a maximum frame whole within the opening credit, frame
// credit only by `ack`), the grant through `RemoteLink.act`; and O10's pins 1 and 4 as a device meets them: a non-owner's
// step-up once per grant and again per epoch, the owner's never, and control revoked at a record change reaching the
// device as `control-revoked`, view's loss as `removed`. An endpoint that lists no `rl2.browser-screencast` is offered
// neither the feed nor the stream: both end `not-offered`, nothing sent.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryOrgView, SCREENCAST_JPEG_MAX, type SignedOrgState } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BrowserFrame, BrowserInventory } from '@shared/browser/screencast';
import type { MachineRef } from '@shared/machine/ref';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import { openBrowserStream, type BrowserStreamSink } from '../../src/main/machines/remote/browser-stream';
import { DEVICE_CAPABILITIES } from '../../src/main/machines/remote/capabilities';
import { dialDirect } from '../../src/main/machines/remote/carriers';
import { createRemoteLink, type RemoteLink, type SubscriptionSink } from '../../src/main/machines/remote/link';
import { heldOrgSession, watchedView, type SignedIn } from '../../src/main/org/session';
import { fakeBrowser } from '../endpoint/fake-services';
import { endorsed, iso, successor } from '../endpoint/org-fixtures';
import { makeOrg, openRemote, ORG, startEndpoint, stopAll, until, type Fixture, type Org } from '../endpoint/sub-harness';

// The endpoint's `h2` list, the build's own unless a case narrows it to an endpoint of an earlier build.
const endpointCaps = vi.hoisted(() => ({ list: [] as string[], full: [] as string[] }));
vi.mock('../../src/endpoint/capabilities', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/endpoint/capabilities')>();
  endpointCaps.full = [...real.ENDPOINT_CAPABILITIES];
  endpointCaps.list.splice(0, Infinity, ...endpointCaps.full);
  return { ENDPOINT_CAPABILITIES: endpointCaps.list };
});

let org: Org;
const started: Fixture[] = [];
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  endpointCaps.list.splice(0, Infinity, ...endpointCaps.full);
  await stopAll(started);
});
afterAll(() => stopAll(started));

const OPEN = { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } };
const TAB = 'b_000000000001';
const OTHER = 'b_000000000002';

type Lab = { f: Fixture; browser: ReturnType<typeof fakeBrowser>; chain: SignedOrgState[]; engine: string };
type App = { link: RemoteLink; signs: () => number };

/** The endpoint with the suite's fake browser, and `app-1`, owned by the machine's owners, B holding `grade` on it. */
async function lab(grade: 'view' | 'approve' = 'approve'): Promise<Lab> {
  const f = await startEndpoint(org, started, { limits: OPEN });
  const s = f.host.add('app-1');
  f.spine.set('app-1', s.engineSessionId);
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'], access: 'private', shares: [{ member: org.B, grade }] }, 'app-1');
  return { f, browser: fakeBrowser(f.services), chain: [...f.chain], engine: s.engineSessionId! };
}

/** The session's agent tabs under `epoch`. */
const tabs = (l: Lab, epoch = 'ep-1'): BrowserInventory =>
  l.browser.set('app-1', {
    epoch,
    selected: TAB,
    tabs: [
      { tabId: TAB, title: 'dev server', url: 'http://127.0.0.1:5173/', control: 'agent' },
      { tabId: OTHER, title: 'docs', url: 'http://127.0.0.1:8080/', control: 'idle' },
    ],
  });

/** One MAWS app of `member`'s (A, the machine's owner; B, a member who owns nothing there): its device listed, its link up. */
async function app(l: Lab, member: 'A' | 'B', id: string): Promise<App> {
  const profile = mkdtempSync(join(tmpdir(), `maws-o17-browser-${id}-`));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => true });
  const [who, by] = member === 'B' ? [org.B, org.b1] : [org.A, org.a1];
  const mac = await endorsed(ORG, who, { device: { id, class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub }, channel: keys.channel, stepUp: keys.stepUp }, by);
  const listed = await successor(l.chain.at(-1)!, [org.a1], (st) => void st.members.find((m) => m.id === who)!.devices.push(mac.device));
  const admin = await openRemote(l.f, org.a1, org.A);
  await admin.channel.send({ t: 'state', states: [listed], transitions: [] });
  await until(() => (l.f.endpoint.status().stateVersion ?? 0) >= listed.state.version, 'the endpoint adopting the head');
  admin.channel.close('closed');
  l.chain.push(listed);
  const session = heldOrgSession();
  let signs = 0;
  const signedIn: SignedIn = {
    identity: { org: ORG, member: who, device: id, clientClass: 'native-mac', channelKey: keys.channel, build: 'o17-m9a', capabilities: [...DEVICE_CAPABILITIES] },
    view: watchedView(memoryOrgView({ chain: [...l.chain] }), () => session.changed()),
    stepUp: createStepUp({ device: { org: ORG, device: id }, key: keys.stepUp, confirm: async () => (signs++, { ok: true }) }),
    hub: null,
  };
  session.set(signedIn);
  const link = createRemoteLink({
    machine: { ref: l.f.ref as MachineRef, name: 'mini' },
    session,
    records: { resolve: async () => ({ body: { org: ORG, machine: l.f.ref, addresses: ['ws://100.101.102.108:47830'], issued: iso(Date.now()) }, sig: { kid: 'k', alg: 'ES256', value: 'v' } }) as never },
    dialDirect: (_url, timeoutMs) => dialDirect(`ws://127.0.0.1:${l.f.port()}`, timeoutMs),
    openRelay: async () => {
      throw new Error('no hub');
    },
    timing: { DIRECT_BUCKET: OPEN.perSource },
    log: () => {},
  });
  cleanups.push(() => link.close());
  await until(() => link.state() === 'up', `${id}'s link up`, 10_000);
  return { link, signs: () => signs };
}

/** A recording screencast sink, acknowledging nothing on its own. */
function viewer() {
  const heard: Array<[string, unknown]> = [];
  const sink: BrowserStreamSink = { opened: (view) => void heard.push(['opened', view]), frame: (frame) => void heard.push(['frame', frame]), closed: (reason) => void heard.push(['closed', reason]) };
  const frames = () => heard.filter(([kind]) => kind === 'frame').map(([, f]) => f as BrowserFrame);
  const closed = () => until(() => heard.find(([kind]) => kind === 'closed')?.[1] as string | undefined, 'the stream closed');
  const opened = () => until(() => heard.find(([kind]) => kind === 'opened')?.[1] as { control: boolean } | undefined, 'the stream opened');
  return { heard, sink, frames, closed, opened };
}

/** A recording subscription sink. */
function feedSink() {
  const heard: Array<[string, ...unknown[]]> = [];
  const sink: SubscriptionSink = {
    subbed: (mode, at) => void heard.push(['subbed', mode, at]),
    snapshot: (_at, value) => void heard.push(['snapshot', value]),
    event: (_at, body) => void heard.push(['event', body]),
    paused: (reason) => void heard.push(['paused', reason]),
    resumed: () => void heard.push(['resumed']),
    ended: (reason) => void heard.push(['ended', reason]),
  };
  return { heard, sink };
}

/** The grant of control on `app-1` for `epoch`, as M9b's bridge asks it: its outcome. */
const grant = (a: App, epoch: string) => a.link.act({ action: 'machine.browserControl', args: { appSessionId: 'app-1', epoch }, executor: 'endpoint' });

describe('the agent’s browser over a real link', { timeout: 30_000 }, () => {
  it('follows the session’s tabs on its feed, and views one: a maximum frame whole within the opening credit, the next only after its `ack`', async () => {
    const l = await lab();
    const first = tabs(l);
    const a = await app(l, 'A', 'mac1');
    const feed = feedSink();
    a.link.subscribe({ session: { lane: 'B', id: 'app-1' }, feed: 'browser.inventory' }, feed.sink);
    await until(() => feed.heard.some(([kind]) => kind === 'snapshot') || undefined, 'the inventory');
    expect(feed.heard.find(([kind]) => kind === 'snapshot')).toEqual(['snapshot', first]);
    const second = l.browser.set('app-1', { selected: OTHER });
    await until(() => feed.heard.some(([kind]) => kind === 'event') || undefined, 'the change');
    expect(feed.heard.filter(([kind]) => kind === 'event')).toEqual([['event', second]]);

    const v = viewer();
    const stream = openBrowserStream(a.link, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB }, v.sink);
    expect(await v.opened()).toEqual({ epoch: 'ep-1', tabId: TAB, control: false });
    const producer = l.browser.views.at(-1)!;
    const sent = producer.frame(1, SCREENCAST_JPEG_MAX);
    await until(() => v.frames().length === 1 || undefined, 'the maximum frame', 10_000);
    expect(v.frames()[0]).toEqual(sent);
    expect(producer.acks).toEqual([]);
    stream.ack(1);
    await until(() => producer.acks.length === 1 || undefined, 'the ack');
    producer.frame(2, 1000);
    await until(() => v.frames().length === 2 || undefined, 'the next frame');
    stream.close();
    await until(() => producer.closed || undefined, 'the subscription closed');
  });

  it('asks a non-owner’s step-up once per grant and again after a new epoch, and the owner’s never (O10’s pin 1)', async () => {
    const l = await lab('approve');
    tabs(l);
    const b = await app(l, 'B', 'mac-b');
    const granted = grant(b, 'ep-1');
    expect(await granted.outcome).toEqual({ state: 'done', result: { appSessionId: 'app-1', epoch: 'ep-1' } });
    expect(b.signs()).toBe(1);
    const v = viewer();
    const stream = openBrowserStream(b.link, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: granted.opId } }, v.sink);
    expect(await v.opened()).toEqual({ epoch: 'ep-1', tabId: TAB, control: true });
    const producer = l.browser.views.at(-1)!;
    producer.frame(1);
    stream.input(1, { kind: 'key', type: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: [] });
    await until(() => producer.inputs.length === 1 || undefined, 'the input');
    // Another tab under the same grant: no second step-up.
    const w = viewer();
    openBrowserStream(b.link, { appSessionId: 'app-1', epoch: 'ep-1', tabId: OTHER, control: { op: granted.opId } }, w.sink);
    expect((await w.opened()).control).toBe(true);
    expect(b.signs()).toBe(1);
    // A handover's new epoch: the old grant opens nothing, a new one asks again.
    tabs(l, 'ep-2');
    const stale = viewer();
    openBrowserStream(b.link, { appSessionId: 'app-1', epoch: 'ep-2', tabId: TAB, control: { op: granted.opId } }, stale.sink);
    expect(await stale.closed()).toBe('grade');
    expect(await grant(b, 'ep-2').outcome).toMatchObject({ state: 'done' });
    expect(b.signs()).toBe(2);
    const a = await app(l, 'A', 'mac-a');
    expect(await grant(a, 'ep-2').outcome).toMatchObject({ state: 'done' });
    expect(a.signs()).toBe(0);
  });

  it('closes a controlling stream `control-revoked` once a record change leaves view only, and the viewer’s feed and stream `removed` once view goes (O10’s pin 4)', async () => {
    const l = await lab('approve');
    tabs(l);
    const b = await app(l, 'B', 'mac-b');
    const granted = grant(b, 'ep-1');
    await granted.outcome;
    const controller = viewer();
    openBrowserStream(b.link, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: granted.opId } }, controller.sink);
    await controller.opened();
    const reader = viewer();
    openBrowserStream(b.link, { appSessionId: 'app-1', epoch: 'ep-1', tabId: OTHER }, reader.sink);
    await reader.opened();
    const feed = feedSink();
    b.link.subscribe({ session: { lane: 'B', id: 'app-1' }, feed: 'browser.inventory' }, feed.sink);
    await until(() => feed.heard.some(([kind]) => kind === 'snapshot') || undefined, 'the inventory');
    l.f.records.set({ lane: 'B', session: l.engine, owners: ['@machine'], access: 'private', shares: [{ member: org.B, grade: 'view' }] }, 'app-1');
    expect(await controller.closed()).toBe('control-revoked');
    expect(reader.heard.some(([kind]) => kind === 'closed')).toBe(false);
    l.f.records.set({ lane: 'B', session: l.engine, owners: ['@machine'], access: 'private' }, 'app-1');
    expect(await reader.closed()).toBe('removed');
    await until(() => feed.heard.some(([kind]) => kind === 'ended') || undefined, 'the feed ended');
    expect(feed.heard.at(-1)).toEqual(['ended', 'removed']);
  });

  it('offers neither the feed nor a stream on an endpoint that lists no `rl2.browser-screencast`: each ends `not-offered`, nothing sent', async () => {
    endpointCaps.list.splice(0, Infinity, ...endpointCaps.full.filter((c) => c !== 'rl2.browser-screencast'));
    const l = await lab();
    tabs(l);
    const a = await app(l, 'A', 'mac1');
    const feed = feedSink();
    a.link.subscribe({ session: { lane: 'B', id: 'app-1' }, feed: 'browser.inventory' }, feed.sink);
    const v = viewer();
    openBrowserStream(a.link, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB }, v.sink);
    expect(await v.closed()).toBe('not-offered');
    await until(() => feed.heard.length > 0 || undefined, 'the feed’s end');
    expect(feed.heard).toEqual([['ended', 'not-offered']]);
    expect(l.browser.views).toEqual([]);
    expect(l.browser.watchers('app-1')).toBe(0);
  });
});
