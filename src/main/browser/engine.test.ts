// The app as a tab engine (P5 O17 M9b; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M9's Decisions, Interfaces §F,
// §G): `mawsd` asks the attached app for a session's agent tabs and opens viewers on them, and the app answers from its
// own TabStore with M6's producer. Only the agent's tabs (those a live cua connection reserves or leases) enter an
// inventory or take a viewer; a tab leaving that set ends its viewers `tab_closed`. A viewed tab paints while hidden: its
// background throttling is off while a viewer subscribes, as it is while the agent holds it. Over a real TabStore whose
// views are stand-ins, a fake frame source and encoder, and a recording link (the real frame subscription on a hidden app
// tab is e2e/browser-cua.spec.ts's).
import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserEngineOperation } from '@shared/ipc/schema/browser-engine';
import { startAppEngine, type AppEngine, type EngineCallName } from './engine';
import type { FrameSource } from './screencast';
import { TabStore, type TabEntry } from './tabs';

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;

class Contents extends EventEmitter {
  destroyed = false;
  throttled: boolean[] = [];
  loadURL() {
    return Promise.resolve();
  }
  getURL() {
    return '';
  }
  close() {
    this.destroyed = true;
  }
  isDestroyed() {
    return this.destroyed;
  }
  setWindowOpenHandler() {}
  setBackgroundThrottling(on: boolean) {
    this.throttled.push(on);
  }
  sendInputEvent() {}
}
const view = () => {
  const webContents = new Contents();
  let bounds = { x: 0, y: 0, width: 1280, height: 800 };
  return { webContents, setBounds: (next: typeof bounds) => void (bounds = { ...next }), setVisible() {}, getBounds: () => ({ ...bounds }) };
};

// The cua server's agent-tab set, as the producer reads it
class Agents {
  readonly tabs = new Set<string>();
  private readonly listeners = new Set<(tabId: string) => void>();
  agentTab = (tabId: string) => this.tabs.has(tabId);
  onAgentTabs = (listener: (tabId: string) => void) => (this.listeners.add(listener), () => void this.listeners.delete(listener));
  set(tabId: string, on: boolean) {
    if (on) this.tabs.add(tabId);
    else this.tabs.delete(tabId);
    for (const listener of [...this.listeners]) listener(tabId);
  }
}

class Source implements FrameSource<number> {
  paint: ((image: number) => void) | null = null;
  stops = 0;
  start(paint: (image: number) => void) {
    this.paint = paint;
  }
  stop() {
    this.stops += 1;
    this.paint = null;
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const done of cleanup.splice(0)) done();
});

function stand(options: { refuseFrames?: boolean } = {}) {
  const store = new TabStore({ emit: () => {}, createView: () => view() as unknown as WebContentsView, resolvePartition: () => DEFAULT_PARTITION, schedule: (fn) => queueMicrotask(fn) });
  const agents = new Agents();
  const calls: [EngineCallName, unknown][] = [];
  const sources = new Map<string, Source>();
  const sized: string[] = [];
  const engine: AppEngine = startAppEngine({
    store,
    agents,
    call: async (name, input) => {
      calls.push([name, input]);
      if (name === 'browserEngine.frame' && options.refuseFrames) return { ok: false, error: { code: 'forbidden_sender', message: 'settled' } };
      return { ok: true };
    },
    frames: {
      source: (entry: TabEntry) => {
        const source = new Source();
        sources.set(entry.tab.tabId, source);
        return source;
      },
      encode: async (image) => ({ jpeg: new Uint8Array([image as number]), width: 640, height: 400 }),
    },
    size: (entry) => void sized.push(entry.tab.tabId),
    log: () => {},
  });
  cleanup.push(() => engine.dispose());
  const tab = (appSessionId: AppSessionId = A, url = 'http://127.0.0.1:4000/'): TabEntry => store.entry(store.open({ appSessionId, url, select: false }).tab.tabId)!;
  let next = 0;
  const ask = async (appSessionId: AppSessionId, operation: BrowserEngineOperation) => {
    const id = `r${++next}`;
    engine.request({ id, appSessionId, operation });
    await tick();
    return (calls.find(([name, input]) => name === 'browserEngine.answer' && (input as { id: string }).id === id)?.[1] as { result: unknown } | undefined)?.result;
  };
  const of = (name: EngineCallName) => calls.filter(([called]) => called === name).map(([, input]) => input);
  const contents = (entry: TabEntry) => entry.view!.webContents as unknown as Contents;
  return { store, agents, calls, sources, sized, engine, tab, ask, of, contents };
}

describe('the app’s inventory: the agent’s tabs only (M9’s Decisions)', () => {
  it('answers a session’s agent tabs, never the person’s nor another session’s, and pushes each change once asked', async () => {
    const t = stand();
    const agent = t.tab(A, 'http://127.0.0.1:5173/');
    const person = t.tab(A, 'http://127.0.0.1:8080/');
    const other = t.tab(B);
    t.agents.set(agent.tab.tabId, true);
    t.agents.set(other.tab.tabId, true);
    await tick();
    expect(t.of('browserEngine.state'), 'nothing pushed for a session mawsd has not asked about').toEqual([]);
    const answered = (await t.ask(A, { op: 'inventory' })) as { ok: true; value: { tabs: { tabId: string; url: string }[]; state: string } };
    expect(answered.ok).toBe(true);
    expect(answered.value.state).toBe('ready');
    expect(answered.value.tabs.map((tab) => tab.tabId)).toEqual([agent.tab.tabId]);
    expect(answered.value.tabs[0]!.url).toBe('http://127.0.0.1:5173/');

    t.agents.set(person.tab.tabId, true); // the agent leases the person's tab: an agent's while it lasts
    await tick();
    expect(t.of('browserEngine.state').map((pushed) => (pushed as { inventory: { tabs: { tabId: string }[] } }).inventory.tabs.map((tab) => tab.tabId))).toEqual([[agent.tab.tabId, person.tab.tabId]]);
    t.agents.set(person.tab.tabId, false);
    await tick();
    expect(t.of('browserEngine.state')).toHaveLength(2);
    expect((t.of('browserEngine.state')[1] as { appSessionId: string; inventory: { tabs: unknown[] } }).inventory.tabs).toHaveLength(1);
    t.store.update(person.tab.tabId, { title: 'not an agent tab' }); // the person's tab changed: the inventory did not
    await tick();
    expect(t.of('browserEngine.state')).toHaveLength(2);
    t.store.update(agent.tab.tabId, { title: 'dev server' });
    await tick();
    expect((t.of('browserEngine.state')[2] as { inventory: { tabs: { title: string }[] } }).inventory.tabs[0]!.title).toBe('dev server');
    expect(t.of('browserEngine.state').every((pushed) => (pushed as { appSessionId: string }).appSessionId === A)).toBe(true);
  });

  it('refuses the render host’s own operations', async () => {
    const t = stand();
    expect(await t.ask(A, { op: 'prepare' })).toMatchObject({ ok: false });
    expect(await t.ask(A, { op: 'drop' })).toMatchObject({ ok: false });
  });
});

describe('the app’s viewers (M6’s producer over the app’s TabStore)', () => {
  it('opens a viewer on an agent tab only: its frames go to mawsd, its view painting while hidden until the last viewer leaves', async () => {
    const t = stand();
    const agent = t.tab();
    const person = t.tab();
    t.agents.set(agent.tab.tabId, true);
    expect(await t.ask(A, { op: 'open', subscriptionId: 's0', tabId: person.tab.tabId, control: false })).toEqual({ ok: false, error: 'tab_closed' });
    expect(await t.ask(B, { op: 'open', subscriptionId: 's0', tabId: agent.tab.tabId, control: false }), 'another session’s').toEqual({ ok: false, error: 'tab_closed' });
    expect(await t.ask(A, { op: 'open', subscriptionId: 's1', tabId: agent.tab.tabId, control: false })).toEqual({ ok: true, value: null });
    expect(t.contents(agent).throttled, 'painting while hidden').toEqual([false]);
    t.sources.get(agent.tab.tabId)!.paint!(7);
    await tick();
    const [frame] = t.of('browserEngine.frame') as { subscriptionId: string; frame: { tabId: string; seq: number; width: number; viewport: unknown; jpegBase64: string } }[];
    expect(frame).toMatchObject({ subscriptionId: 's1', frame: { tabId: agent.tab.tabId, seq: 1, width: 640, viewport: { width: 1280, height: 800 } } });
    expect(Buffer.from(frame!.frame.jpegBase64, 'base64')).toEqual(Buffer.from([7]));
    expect(await t.ask(A, { op: 'ack', subscriptionId: 's1', seq: 1 })).toEqual({ ok: true, value: null });
    // a navigation (any patch of the tab) re-asserts it, as the agent's control does
    t.store.update(agent.tab.tabId, { title: 'moved' });
    expect(t.contents(agent).throttled).toEqual([false, false]);
    expect(await t.ask(A, { op: 'close', subscriptionId: 's1' })).toEqual({ ok: true, value: null });
    expect(t.contents(agent).throttled.at(-1), 'throttled again with no viewer and no agent holding it').toBe(true);
    expect(t.sources.get(agent.tab.tabId)!.stops).toBe(1);
  });

  it('leaves throttling off at the last viewer’s close while the agent holds the tab', async () => {
    const t = stand();
    const agent = t.tab();
    t.agents.set(agent.tab.tabId, true);
    t.store.setControl(agent.tab.tabId, 'agent');
    await t.ask(A, { op: 'open', subscriptionId: 's1', tabId: agent.tab.tabId, control: false });
    await t.ask(A, { op: 'close', subscriptionId: 's1' });
    expect(t.contents(agent).throttled.at(-1)).toBe(false);
  });

  it('sizes an agent tab no pane placed and that has no size yet, so it can paint', async () => {
    const t = stand();
    const agent = t.tab();
    t.agents.set(agent.tab.tabId, true);
    agent.view!.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    await t.ask(A, { op: 'open', subscriptionId: 's1', tabId: agent.tab.tabId, control: false });
    expect(t.sized).toEqual([agent.tab.tabId]);
  });

  it('ends a tab’s viewers `tab_closed` once when it leaves the agent’s set, and once when it closes', async () => {
    const t = stand();
    const left = t.tab();
    const closed = t.tab();
    t.agents.set(left.tab.tabId, true);
    t.agents.set(closed.tab.tabId, true);
    await t.ask(A, { op: 'open', subscriptionId: 's1', tabId: left.tab.tabId, control: true });
    await t.ask(A, { op: 'open', subscriptionId: 's2', tabId: closed.tab.tabId, control: false });
    t.agents.set(left.tab.tabId, false);
    await tick();
    expect(t.of('browserEngine.ended')).toEqual([{ subscriptionId: 's1', reason: 'tab_closed' }]);
    expect(t.sources.get(left.tab.tabId)!.stops).toBe(1);
    expect(await t.ask(A, { op: 'ack', subscriptionId: 's1', seq: 1 })).toMatchObject({ ok: false });
    t.store.close(closed.tab.tabId);
    t.agents.set(closed.tab.tabId, false); // the cua server forgets it after the view goes
    await tick();
    await tick();
    expect(t.of('browserEngine.ended')).toEqual([
      { subscriptionId: 's1', reason: 'tab_closed' },
      { subscriptionId: 's2', reason: 'tab_closed' },
    ]);
  });

  it('closes a viewer whose frame mawsd refused, and every viewer when the machine link changes', async () => {
    const t = stand({ refuseFrames: true });
    const agent = t.tab();
    t.agents.set(agent.tab.tabId, true);
    await t.ask(A, { op: 'open', subscriptionId: 's1', tabId: agent.tab.tabId, control: false });
    t.sources.get(agent.tab.tabId)!.paint!(1);
    await tick();
    await tick();
    expect(t.sources.get(agent.tab.tabId)!.stops).toBe(1);
    expect(t.engine.inspect().subscriptions).toBe(0);

    await t.ask(A, { op: 'inventory' });
    await t.ask(A, { op: 'open', subscriptionId: 's2', tabId: agent.tab.tabId, control: false });
    expect(t.engine.inspect()).toMatchObject({ subscriptions: 1, sessions: 1 });
    t.engine.linkChanged();
    expect(t.engine.inspect()).toMatchObject({ subscriptions: 0, sessions: 0 });
    expect(t.of('browserEngine.ended'), 'mawsd ended them with the connection: no one is told').toEqual([]);
    const pushed = t.of('browserEngine.state').length;
    t.store.update(agent.tab.tabId, { title: 'after the link changed' });
    await tick();
    expect(t.of('browserEngine.state'), 'no push for a session the new link has not asked about').toHaveLength(pushed);
  });
});
