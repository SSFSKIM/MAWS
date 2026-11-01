import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEventScope } from './event-scope';
import { harness, takeDown } from './server.fake';

// The event scope (P5 O17 M2, condition 6; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md §J): a cua lease is told
// only the CDP events its own commands asked for, per CDP session. The first half drives the scope alone; the second
// drives it through MAWS's primitive server over a real socket, with a second consumer on the same TabDebugger and cua's
// recorded screenshot sequence. The server's stands here take the uid boundary (M2's Linux policy), so they run on every
// platform without the darwin addon.

afterEach(takeDown);

// Target.attachedToTarget's params, as Chromium sends them
const attachedTo = (sessionId: string, targetId: string) => ({ sessionId, targetInfo: { targetId, type: 'iframe', title: '', url: 'https://x.test/' }, waitingForDebugger: false });

describe('the scope', () => {
  it('a domain enable admits that domain\'s events on that session alone; its disable ends them at once', () => {
    const scope = createEventScope();
    expect(scope.admits(null, 'Network.requestWillBeSent')).toBe(false);
    const enable = scope.willSend(null, 'Network.enable', {});
    expect(scope.admits(null, 'Network.requestWillBeSent')).toBe(true); // before the answer: an enable can emit first
    enable(true);
    expect(scope.admits(null, 'Network.requestWillBeSent')).toBe(true);
    expect(scope.admits(null, 'Runtime.consoleAPICalled')).toBe(false);
    expect(scope.admits('C1', 'Network.requestWillBeSent')).toBe(false); // a child session is a scope of its own
    const disable = scope.willSend(null, 'Network.disable', {});
    expect(scope.admits(null, 'Network.requestWillBeSent')).toBe(false); // before its answer
    disable(true);
    expect(scope.admits(null, 'Network.requestWillBeSent')).toBe(false);
  });

  it('a failed enable is rolled back, a failed disable restores the enable, and a settled send settles nothing again', () => {
    const scope = createEventScope();
    scope.willSend(null, 'Runtime.enable', {})(false);
    expect(scope.admits(null, 'Runtime.executionContextCreated')).toBe(false);
    scope.willSend(null, 'Runtime.enable', {})(true);
    const disable = scope.willSend(null, 'Runtime.disable', {});
    expect(scope.admits(null, 'Runtime.executionContextCreated')).toBe(false);
    disable(false);
    expect(scope.admits(null, 'Runtime.executionContextCreated')).toBe(true);
    disable(true); // a second answer to the same send changes nothing
    expect(scope.admits(null, 'Runtime.executionContextCreated')).toBe(true);
  });

  it('send order wins whatever order the answers come in: a later disable answered first is not undone by the earlier enable', () => {
    const scope = createEventScope();
    const enable = scope.willSend(null, 'Page.enable', {});
    const disable = scope.willSend(null, 'Page.disable', {});
    expect(scope.admits(null, 'Page.frameNavigated')).toBe(false);
    disable(true); // the disable answers while the enable is still deferred
    expect(scope.admits(null, 'Page.frameNavigated')).toBe(false);
    enable(true);
    expect(scope.admits(null, 'Page.frameNavigated')).toBe(false);
    // the same method sent twice with opposite values, the later failing and the earlier answering last
    const on = scope.willSend(null, 'Target.setAutoAttach', { autoAttach: true });
    const off = scope.willSend(null, 'Target.setAutoAttach', { autoAttach: false });
    off(false);
    expect(scope.admits(null, 'Target.attachedToTarget')).toBe(true);
    on(true);
    expect(scope.admits(null, 'Target.attachedToTarget')).toBe(true);
  });

  it('Page.enable alone never admits frames, the file chooser or lifecycle events: each follows its own command', () => {
    const scope = createEventScope();
    scope.willSend(null, 'Page.enable', {})(true);
    expect(scope.admits(null, 'Page.frameNavigated')).toBe(true);
    for (const event of ['Page.screencastFrame', 'Page.screencastVisibilityChanged', 'Page.fileChooserOpened', 'Page.lifecycleEvent']) expect(scope.admits(null, event)).toBe(false);
    const start = scope.willSend(null, 'Page.startScreencast', { format: 'jpeg' });
    expect(scope.admits(null, 'Page.screencastFrame')).toBe(true);
    expect(scope.admits(null, 'Page.screencastVisibilityChanged')).toBe(true);
    start(true);
    const stop = scope.willSend(null, 'Page.stopScreencast', {});
    expect(scope.admits(null, 'Page.screencastFrame')).toBe(false); // the stop takes effect before later frames
    stop(true);
    scope.willSend(null, 'Page.setInterceptFileChooserDialog', { enabled: true });
    expect(scope.admits(null, 'Page.fileChooserOpened')).toBe(true);
    scope.willSend(null, 'Page.setInterceptFileChooserDialog', { enabled: false });
    expect(scope.admits(null, 'Page.fileChooserOpened')).toBe(false);
    scope.willSend(null, 'Page.setLifecycleEventsEnabled', { enabled: true });
    expect(scope.admits(null, 'Page.lifecycleEvent')).toBe(true);
    // a screencast started on its own admits its frames without Page.enable, and nothing else of Page
    const bare = createEventScope();
    bare.willSend(null, 'Page.startScreencast', {});
    expect(bare.admits(null, 'Page.screencastFrame')).toBe(true);
    expect(bare.admits(null, 'Page.frameNavigated')).toBe(false);
  });

  it('Fetch interception follows its own enable: paused requests, and auth challenges only when it asked to handle them', () => {
    const scope = createEventScope();
    expect(scope.admits(null, 'Fetch.requestPaused')).toBe(false);
    scope.willSend(null, 'Fetch.enable', { patterns: [{ requestStage: 'Response', resourceType: 'Document' }] });
    expect(scope.admits(null, 'Fetch.requestPaused')).toBe(true);
    expect(scope.admits(null, 'Fetch.authRequired')).toBe(false);
    scope.willSend(null, 'Fetch.enable', { handleAuthRequests: true });
    expect(scope.admits(null, 'Fetch.authRequired')).toBe(true);
    scope.willSend(null, 'Fetch.disable', {});
    expect(scope.admits(null, 'Fetch.requestPaused')).toBe(false);
    expect(scope.admits(null, 'Fetch.authRequired')).toBe(false);
  });

  it('target attach events follow auto-attach on the session that asked; a failed explicit attach admits nothing', () => {
    const scope = createEventScope();
    expect(scope.admits(null, 'Target.attachedToTarget')).toBe(false);
    scope.willSend(null, 'Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false });
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C1', 'T1'))).toBe(true);
    expect(scope.admits(null, 'Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' })).toBe(true);
    expect(scope.admits('C1', 'Target.attachedToTarget', attachedTo('C2', 'T2'))).toBe(false); // a child's own auto-attach is the child's
    scope.willSend(null, 'Target.setAutoAttach', { autoAttach: false });
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C1', 'T1'))).toBe(false);
    const attach = scope.willSend(null, 'Target.attachToTarget', { targetId: 'T1', flatten: true });
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C1', 'T1'))).toBe(true);
    attach(false);
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C3', 'T1'))).toBe(false);
  });

  it('an explicit attach ends with its own child\'s detach, keeping any other live explicit attach', () => {
    const scope = createEventScope();
    scope.willSend(null, 'Target.attachToTarget', { targetId: 'T1', flatten: true })(true);
    scope.willSend(null, 'Target.attachToTarget', { targetId: 'T2', flatten: true })(true);
    scope.detached('C1', 'T1');
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C1', 'T1'))).toBe(false);
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C2', 'T2'))).toBe(true); // T2's attach is still live
    scope.detached('C2', 'T2');
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C4', 'T2'))).toBe(false); // another consumer's attaches are not the lease's
    expect(scope.admits(null, 'Target.detachedFromTarget', { sessionId: 'C4', targetId: 'T2' })).toBe(false);
    // a detach while the attach's answer is still out ends it too: the late answer does not bring it back
    const late = scope.willSend(null, 'Target.attachToTarget', { targetId: 'T3', flatten: true });
    scope.detached('C3', 'T3');
    late(true);
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C5', 'T3'))).toBe(false);
  });

  it('a binding\'s calls follow the lease\'s own Runtime.addBinding, not Runtime.enable, until its last binding is removed', () => {
    const scope = createEventScope();
    scope.willSend(null, 'Runtime.enable', {});
    expect(scope.admits(null, 'Runtime.bindingCalled', { name: 'one' })).toBe(false);
    scope.willSend(null, 'Runtime.addBinding', { name: 'one' });
    scope.willSend(null, 'Runtime.addBinding', { name: 'two' });
    expect(scope.admits(null, 'Runtime.bindingCalled', { name: 'one' })).toBe(true);
    scope.willSend(null, 'Runtime.removeBinding', { name: 'one' });
    expect(scope.admits(null, 'Runtime.bindingCalled', { name: 'one' })).toBe(false);
    expect(scope.admits(null, 'Runtime.bindingCalled', { name: 'two' })).toBe(true);
    scope.willSend(null, 'Runtime.removeBinding', { name: 'two' });
    expect(scope.admits(null, 'Runtime.bindingCalled', { name: 'two' })).toBe(false);
  });

  it('a binding\'s calls are admitted by the binding\'s name: a second consumer on the attachment hears nothing of the first\'s', () => {
    const first = createEventScope();
    const second = createEventScope();
    first.willSend(null, 'Runtime.addBinding', { name: 'own' })(true);
    second.willSend(null, 'Runtime.addBinding', { name: 'other' })(true);
    const call = (name: string) => ({ name, payload: '{"secret":1}', executionContextId: 1 });
    expect(first.admits(null, 'Runtime.bindingCalled', call('own'))).toBe(true);
    expect(first.admits(null, 'Runtime.bindingCalled', call('other'))).toBe(false);
    expect(second.admits(null, 'Runtime.bindingCalled', call('own'))).toBe(false);
    expect(second.admits(null, 'Runtime.bindingCalled', call('other'))).toBe(true);
    expect(first.admits(null, 'Runtime.bindingCalled', {})).toBe(false); // no name, no binding
  });

  it('with auto-attach off, an explicit attach admits its own target\'s attach and that child\'s detach alone', () => {
    const first = createEventScope();
    const second = createEventScope();
    first.willSend(null, 'Target.attachToTarget', { targetId: 'T1', flatten: true })(true);
    second.willSend(null, 'Target.attachToTarget', { targetId: 'T2', flatten: true })(true);
    expect(first.admits(null, 'Target.attachedToTarget', attachedTo('C1', 'T1'))).toBe(true);
    expect(first.admits(null, 'Target.attachedToTarget', attachedTo('C2', 'T2'))).toBe(false);
    expect(second.admits(null, 'Target.attachedToTarget', attachedTo('C1', 'T1'))).toBe(false);
    expect(second.admits(null, 'Target.attachedToTarget', attachedTo('C2', 'T2'))).toBe(true);
    expect(first.admits(null, 'Target.detachedFromTarget', { sessionId: 'C2', targetId: 'T2' })).toBe(false);
    expect(second.admits(null, 'Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' })).toBe(false);
    expect(first.admits(null, 'Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' })).toBe(true);
    expect(second.admits(null, 'Target.detachedFromTarget', { sessionId: 'C2' })).toBe(true); // targetId is deprecated: the session decides
  });

  it('turning auto-attach off keeps the detach of each child it announced, which Chromium sends as it detaches them', () => {
    const scope = createEventScope();
    scope.willSend(null, 'Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false })(true);
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C1', 'T1'))).toBe(true);
    scope.willSend(null, 'Target.setAutoAttach', { autoAttach: false, flatten: true, waitForDebuggerOnStart: false })(true);
    expect(scope.admits(null, 'Target.attachedToTarget', attachedTo('C2', 'T2'))).toBe(false);
    expect(scope.admits(null, 'Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' })).toBe(true);
    expect(scope.admits(null, 'Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' }), 'once').toBe(false);
    expect(scope.admits(null, 'Target.detachedFromTarget', { sessionId: 'C2', targetId: 'T2' }), 'never announced').toBe(false);
  });

  it('Page.enable\'s enableFileChooserOpenedEvent admits the file chooser\'s event until a Page.enable without it or Page.disable', () => {
    const scope = createEventScope();
    scope.willSend(null, 'Page.enable', { enableFileChooserOpenedEvent: true })(true);
    expect(scope.admits(null, 'Page.fileChooserOpened')).toBe(true);
    expect(scope.admits(null, 'Page.frameNavigated')).toBe(true);
    scope.willSend(null, 'Page.enable', {})(true); // Chromium sets the switch to each enable's value
    expect(scope.admits(null, 'Page.fileChooserOpened')).toBe(false);
    scope.willSend(null, 'Page.enable', { enableFileChooserOpenedEvent: true })(true);
    scope.willSend(null, 'Page.disable', {})(true);
    expect(scope.admits(null, 'Page.fileChooserOpened')).toBe(false);
    expect(scope.admits(null, 'Page.frameNavigated')).toBe(false);
  });

  it('tracing is the lease\'s from its start until its completion is told, past its end', () => {
    const scope = createEventScope();
    expect(scope.admits(null, 'Tracing.dataCollected')).toBe(false);
    scope.willSend(null, 'Tracing.start', {})(true);
    scope.willSend(null, 'Tracing.end', {})(true);
    expect(scope.admits(null, 'Tracing.dataCollected')).toBe(true);
    expect(scope.admits(null, 'Tracing.tracingComplete')).toBe(true);
    expect(scope.admits(null, 'Tracing.dataCollected')).toBe(false);
  });

  it('a completion told before its start\'s answer ends that trace: the start\'s late answer does not bring it back', () => {
    const scope = createEventScope();
    const start = scope.willSend(null, 'Tracing.start', {});
    expect(scope.admits(null, 'Tracing.dataCollected')).toBe(true);
    expect(scope.admits(null, 'Tracing.tracingComplete')).toBe(true);
    expect(scope.admits(null, 'Tracing.dataCollected')).toBe(false);
    start(true);
    expect(scope.admits(null, 'Tracing.dataCollected')).toBe(false);
    // the next start is a new trace
    scope.willSend(null, 'Tracing.start', {})(true);
    expect(scope.admits(null, 'Tracing.dataCollected')).toBe(true);
  });

  it('DOM.getDocument turns DOM\'s events on, as Chromium does', () => {
    const scope = createEventScope();
    expect(scope.admits(null, 'DOM.setChildNodes')).toBe(false);
    scope.willSend(null, 'DOM.getDocument', { depth: 1 });
    expect(scope.admits(null, 'DOM.setChildNodes')).toBe(true);
  });

  it('a child\'s detach discards its scope, the lease\'s end discards every scope, and an answer for a discarded one settles nothing', () => {
    const scope = createEventScope();
    scope.willSend(null, 'Runtime.enable', {});
    const child = scope.willSend('C1', 'Runtime.enable', {});
    scope.willSend('C2', 'Runtime.enable', {});
    scope.detached('C1', 'T1');
    expect(scope.admits('C1', 'Runtime.executionContextCreated')).toBe(false);
    expect(scope.admits('C2', 'Runtime.executionContextCreated')).toBe(true);
    child(true);
    expect(scope.admits('C1', 'Runtime.executionContextCreated')).toBe(false);
    scope.released();
    expect(scope.admits(null, 'Runtime.executionContextCreated')).toBe(false);
    expect(scope.admits('C2', 'Runtime.executionContextCreated')).toBe(false);
  });

  it('an event of a domain with no enable and no rule of its own is never admitted', () => {
    const scope = createEventScope();
    scope.willSend(null, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    expect(scope.admits(null, 'Emulation.virtualTimeBudgetExpired')).toBe(false);
    expect(scope.admits(null, 'Inspector.targetCrashed')).toBe(false);
  });
});

// cua's host, as recorded: the attach preamble at a tab's first CDP use, then a screenshot (a screencast's first frame)
interface Recorded {
  method?: string;
  params?: Record<string, unknown>;
  awaitEvent?: string;
}
const recording = JSON.parse(readFileSync(join(__dirname, '../../../../test/fixtures/browser/cua-screenshot-sequence.json'), 'utf8')) as {
  attachPreamble: Recorded[];
  screenshot: Recorded[];
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function uidStand() {
  const h = harness({ peer: { addon: null, platform: 'linux' } });
  const host = await h.host();
  const created = await host.request<{ id: number }>('tabs.create', { url: 'about:blank' });
  const entry = h.store.all().at(-1)!;
  const cdp = h.cdp(entry);
  const attach = () => host.request('debugger.attach', { tabId: created.id });
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    host.request<T>('debugger.sendCommand', { debuggee: { tabId: created.id }, method, params, ...(sessionId && { sessionId }) });
  // what the host was told, as [method, sessionId] pairs, from the given count on
  const told = (from = 0) =>
    host.notifications
      .slice(from)
      .filter((n) => n.method === 'debugger.event')
      .map((n) => [n.params.method as string, (n.params.sessionId as string | undefined) ?? null]);
  return { h, host, id: created.id, entry, cdp, attach, send, told };
}

describe('through the primitive server', () => {
  it('two consumers on one TabDebugger: what another holder enabled or started never reaches the lease; what the lease enabled does', async () => {
    const t = await uidStand();
    await t.attach();
    // another holder of the attachment (an import, a crop, a screencast of MAWS's own) turns on Network and Runtime and
    // starts a screencast, on the same attachment the lease shares
    const dbg = t.entry.debugger!;
    await dbg.attach('shared');
    await dbg.send('Network.enable');
    await dbg.send('Runtime.enable');
    await dbg.send('Page.startScreencast', { format: 'jpeg' });
    t.cdp.event('Network.requestWillBeSent', { requestId: '1' });
    t.cdp.event('Runtime.consoleAPICalled', { type: 'log' });
    t.cdp.event('Page.screencastFrame', { data: 'AAAA', sessionId: 1, metadata: {} });
    await settle();
    expect(t.told()).toEqual([]);
    // the lease asks for Network: Network's events reach it, the other holder's Runtime and frames still do not
    await t.send('Network.enable');
    t.cdp.event('Network.requestWillBeSent', { requestId: '2' });
    t.cdp.event('Runtime.consoleAPICalled', { type: 'log' });
    t.cdp.event('Page.screencastFrame', { data: 'AAAA', sessionId: 2, metadata: {} });
    await t.host.waitFor('debugger.event', (p) => p.method === 'Network.requestWillBeSent');
    await settle();
    expect(t.told()).toEqual([['Network.requestWillBeSent', null]]);
  });

  it('cua\'s recorded screenshot at a tab\'s first use gets its frame from its own screencast, and no frame of another consumer\'s', async () => {
    const t = await uidStand();
    await t.attach();
    const dbg = t.entry.debugger!;
    await dbg.attach('shared');
    const frame = (sessionId: number) => t.cdp.event('Page.screencastFrame', { data: `FRAME-${sessionId}`, sessionId, metadata: { timestamp: Date.now() / 1000 } });
    for (const step of recording.attachPreamble) await t.send(step.method!, step.params ?? {});
    // the page's own events under the preamble's enables reach it; another consumer's frame does not (Page.enable alone)
    t.cdp.event('Page.frameNavigated', { frame: { id: t.cdp.frameId } });
    frame(7);
    await t.host.waitFor('debugger.event', (p) => p.method === 'Page.frameNavigated');
    await settle();
    expect(t.told()).toEqual([['Page.frameNavigated', null]]);
    const before = t.host.notifications.length;
    for (const step of recording.screenshot) {
      if (step.awaitEvent) {
        frame(1);
        const got = await t.host.waitFor('debugger.event', (p) => p.method === step.awaitEvent);
        expect((got.params.params as { data: string }).data).toBe('FRAME-1');
        continue;
      }
      await t.send(step.method!, step.params ?? {});
    }
    frame(8); // a frame after the screenshot's stop: no longer the lease's
    await settle();
    expect(t.told(before)).toEqual([['Page.screencastFrame', null]]);
    expect(t.cdp.methods()).toEqual([...recording.attachPreamble, ...recording.screenshot].flatMap((step) => (step.method ? [step.method] : [])));
  });

  it('a failed enable forwards nothing after its failure; a disable stops forwarding', async () => {
    const t = await uidStand();
    await t.attach();
    t.cdp.failures.set('Network.enable', 'Network is not available');
    await expect(t.send('Network.enable')).rejects.toThrow('Network is not available');
    t.cdp.event('Network.requestWillBeSent', { requestId: '1' });
    await settle();
    expect(t.told()).toEqual([]);
    t.cdp.failures.clear();
    await t.send('Network.enable');
    t.cdp.event('Network.requestWillBeSent', { requestId: '2' });
    await t.host.waitFor('debugger.event', (p) => p.method === 'Network.requestWillBeSent');
    await t.send('Network.disable');
    t.cdp.event('Network.requestWillBeSent', { requestId: '3' });
    await settle();
    expect(t.told()).toEqual([['Network.requestWillBeSent', null]]);
  });

  it('a deferred enable answered after a later disable leaves the lease told nothing, as sent', async () => {
    const t = await uidStand();
    await t.attach();
    const answerEnable = t.cdp.defer('Page.enable');
    const enabling = t.send('Page.enable');
    await t.send('Page.disable');
    answerEnable();
    await enabling;
    t.cdp.event('Page.frameNavigated', { frame: { id: t.cdp.frameId } });
    await settle();
    expect(t.cdp.timeline).toEqual(['send Page.enable', 'send Page.disable', 'reply Page.disable', 'reply Page.enable']);
    expect(t.told()).toEqual([]);
  });

  it('a detach ends the lease\'s scope: after a re-attach nothing is forwarded until the new lease asks again', async () => {
    const t = await uidStand();
    await t.attach();
    await t.entry.debugger!.attach('focus'); // MAWS's focus emulation keeps the attachment, and Chromium's Page stays on
    await t.send('Page.enable');
    await t.host.request('debugger.detach', { tabId: t.id });
    await t.attach();
    t.cdp.event('Page.frameNavigated', { frame: { id: t.cdp.frameId } });
    await settle();
    expect(t.told()).toEqual([]);
    await t.send('Page.enable');
    t.cdp.event('Page.frameNavigated', { frame: { id: t.cdp.frameId } });
    await t.host.waitFor('debugger.event', (p) => p.method === 'Page.frameNavigated');
    expect(t.told()).toEqual([['Page.frameNavigated', null]]);
  });

  it('auto-attach and child sessions: each child is scoped apart, tracked whatever is told, and its scope ends at its detach', async () => {
    const t = await uidStand();
    await t.attach();
    const attached = (sessionId: string, targetId: string) =>
      t.cdp.event('Target.attachedToTarget', { sessionId, targetInfo: { targetId, type: 'iframe', title: '', url: 'https://x.test/' }, waitingForDebugger: false });
    // another consumer's auto-attach announces a child the lease never asked for: tracked, not told
    attached('C0', 'T0');
    await settle();
    expect(t.told()).toEqual([]);
    expect((await t.host.request<{ targetId: string }[]>('debugger.getTargets')).map((target) => target.targetId)).toContain('T0');
    await t.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    attached('C1', 'T1');
    attached('C2', 'T2');
    await t.host.waitFor('debugger.event', (p) => (p.params as { sessionId?: string }).sessionId === 'C2');
    // the frame session init of cua's CDP controller (src/browser-service/cdp.mjs) on C1 alone
    await t.send('Page.enable', {}, 'C1');
    await t.send('Runtime.enable', {}, 'C1');
    const before = t.host.notifications.length;
    for (const session of ['C1', 'C2']) {
      t.cdp.event('Runtime.executionContextCreated', { context: { id: 1 } }, session);
      t.cdp.event('Page.frameNavigated', { frame: { id: 'F' } }, session);
    }
    t.cdp.event('Runtime.executionContextCreated', { context: { id: 2 } }); // the page's own session asked for nothing
    await settle();
    expect(t.told(before)).toEqual([
      ['Runtime.executionContextCreated', 'C1'],
      ['Page.frameNavigated', 'C1'],
    ]);
    // C1 detached: told (auto-attach is on), and a later session reusing its id starts with nothing
    t.cdp.event('Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' });
    attached('C1', 'T3');
    await t.host.waitFor('debugger.event', (p) => p.method === 'Target.attachedToTarget' && (p.params as { targetInfo: { targetId: string } }).targetInfo.targetId === 'T3');
    const after = t.host.notifications.length;
    t.cdp.event('Runtime.executionContextCreated', { context: { id: 3 } }, 'C1');
    await settle();
    expect(t.told(after)).toEqual([]);
  });

  it('a second consumer on the attachment: its binding\'s calls and its explicit attach never reach the lease; the lease\'s own do', async () => {
    const t = await uidStand();
    await t.attach();
    const dbg = t.entry.debugger!;
    await dbg.attach('shared');
    // two children auto-attach announced to no one: tracked, so the lease may attach one of them
    t.cdp.event('Target.attachedToTarget', attachedTo('A1', 'T1'));
    t.cdp.event('Target.attachedToTarget', attachedTo('A2', 'T2'));
    await t.send('Runtime.addBinding', { name: 'own' });
    await dbg.send('Runtime.addBinding', { name: 'other' });
    await t.send('Target.attachToTarget', { targetId: 'T1' });
    await dbg.send('Target.attachToTarget', { targetId: 'T2', flatten: true });
    const before = t.host.notifications.length;
    t.cdp.event('Runtime.bindingCalled', { name: 'other', payload: 'theirs', executionContextId: 1 });
    t.cdp.event('Runtime.bindingCalled', { name: 'own', payload: 'ours', executionContextId: 1 });
    t.cdp.event('Target.attachedToTarget', attachedTo('C2', 'T2'));
    t.cdp.event('Target.attachedToTarget', attachedTo('C1', 'T1'));
    t.cdp.event('Target.detachedFromTarget', { sessionId: 'C2', targetId: 'T2' });
    t.cdp.event('Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' });
    await t.host.waitFor('debugger.event', (p) => p.method === 'Target.detachedFromTarget');
    await settle();
    const told = t.host.notifications.slice(before).filter((n) => n.method === 'debugger.event').map((n) => n.params.params);
    expect(told).toEqual([
      { name: 'own', payload: 'ours', executionContextId: 1 },
      attachedTo('C1', 'T1'),
      { sessionId: 'C1', targetId: 'T1' },
    ]);
  });

  it('auto-attach turned off: the host is told the detach of each child it was told of, so its session ends with it', async () => {
    const t = await uidStand();
    await t.attach();
    await t.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    t.cdp.event('Target.attachedToTarget', attachedTo('C1', 'T1'));
    await t.host.waitFor('debugger.event', (p) => p.method === 'Target.attachedToTarget');
    await t.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
    const before = t.host.notifications.length;
    t.cdp.event('Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' }); // Chromium detaches what auto-attach attached
    await settle();
    expect(t.told(before)).toEqual([['Target.detachedFromTarget', null]]);
  });

  it('Fetch continuation: the lease\'s interception is told its paused requests and continues them; after its disable nothing pauses for it', async () => {
    const t = await uidStand();
    await t.attach();
    t.cdp.event('Fetch.requestPaused', { requestId: 'other-1' }); // another consumer's interception
    await t.send('Fetch.enable', { patterns: [{ requestStage: 'Response', resourceType: 'Document' }] });
    t.cdp.event('Fetch.requestPaused', { requestId: 'r1' });
    const paused = await t.host.waitFor('debugger.event', (p) => p.method === 'Fetch.requestPaused');
    expect((paused.params.params as { requestId: string }).requestId).toBe('r1');
    expect(await t.send('Fetch.continueRequest', { requestId: 'r1' })).toEqual({ echoed: 'Fetch.continueRequest' });
    t.cdp.event('Fetch.authRequired', { requestId: 'r2' });
    await t.send('Fetch.disable');
    t.cdp.event('Fetch.requestPaused', { requestId: 'r3' });
    await settle();
    expect(t.told()).toEqual([['Fetch.requestPaused', null]]);
  });
});
