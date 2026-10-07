import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TabDebugger, type CommandPhase } from './debugger';

// webContents.debugger as Electron 44 has it: attach, detach, isAttached, sendCommand, the `message` and `detach` events.
// Every command answers when the test says so, so the in-flight table can be read between the send and the reply.
class FakeDebugger extends EventEmitter {
  attachedTo: string | null = null;
  attachCalls = 0;
  detachCalls = 0;
  readonly sent: { method: string; params: unknown; sessionId: string | undefined; resolve(value: unknown): void; reject(error: Error): void }[] = [];
  autoFrameTree = true;

  attach(version: string) {
    if (this.attachedTo) throw new Error('Debugger is already attached to the target');
    this.attachCalls++;
    this.attachedTo = version;
  }
  detach() {
    this.detachCalls++;
    this.attachedTo = null;
  }
  isAttached() {
    return this.attachedTo !== null;
  }
  sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    if (!this.attachedTo) return Promise.reject(new Error('No target available'));
    if (method === 'Page.getFrameTree' && this.autoFrameTree) return Promise.resolve({ frameTree: { frame: { id: 'FRAME-1' } } });
    return new Promise((resolve, reject) => this.sent.push({ method, params, sessionId, resolve, reject }));
  }
  last() {
    return this.sent.at(-1)!;
  }
}

function harness() {
  const dbg = new FakeDebugger();
  let destroyed = false;
  let clock = 1000;
  const webContents = { debugger: dbg, isDestroyed: () => destroyed };
  const tabDebugger = new TabDebugger(webContents as never, () => clock);
  return { dbg, tabDebugger, destroy: () => void (destroyed = true), tick: (ms: number) => void (clock += ms) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('TabDebugger: the attachment (E4a Design §10)', () => {
  it('attaches once at protocol 1.3, however many ask at once, and reads the main frame id once', async () => {
    const h = harness();
    const getFrameTree = vi.spyOn(h.dbg, 'sendCommand');
    expect(h.tabDebugger.attached).toBe(false);
    await Promise.all([h.tabDebugger.attach(), h.tabDebugger.attach()]);
    await h.tabDebugger.attach();
    expect(h.dbg.attachCalls).toBe(1);
    expect(h.dbg.attachedTo).toBe('1.3');
    expect(getFrameTree.mock.calls.map((call) => call[0])).toEqual(['Page.getFrameTree']);
    expect(h.tabDebugger.attached).toBe(true);
    expect(h.tabDebugger.mainFrameId).toBe('FRAME-1');
  });

  it('send attaches first when nothing is attached yet, and passes the root session as no session id', async () => {
    const h = harness();
    const reply = h.tabDebugger.send('Runtime.evaluate', { expression: '1' }, '');
    await settle();
    expect(h.dbg.attachCalls).toBe(1);
    expect(h.dbg.last()).toMatchObject({ method: 'Runtime.evaluate', params: { expression: '1' }, sessionId: undefined });
    h.dbg.last().resolve({ result: { value: 1 } });
    await expect(reply).resolves.toEqual({ result: { value: 1 } });
    void h.tabDebugger.send('Runtime.enable', undefined, 'CHILD-1');
    await settle();
    expect(h.dbg.last().sessionId).toBe('CHILD-1');
  });

  it('an attach that fails leaves it detached, and the next ask tries again', async () => {
    const h = harness();
    h.dbg.autoFrameTree = false;
    expect(h.tabDebugger.attaching).toBe(false);
    const attaching = h.tabDebugger.attach();
    await settle();
    expect([h.tabDebugger.attaching, h.tabDebugger.attached]).toEqual([true, false]);
    h.dbg.last().reject(new Error('target closed'));
    await expect(attaching).rejects.toThrow('target closed');
    expect(h.tabDebugger.attaching).toBe(false);
    expect(h.tabDebugger.attached).toBe(false);
    expect(h.dbg.isAttached()).toBe(false);
    h.dbg.autoFrameTree = true;
    await h.tabDebugger.attach();
    expect(h.tabDebugger.attached).toBe(true);
  });

  it('detach is idempotent, harmless on a destroyed or never-attached webContents, and the next send attaches again', async () => {
    const h = harness();
    h.tabDebugger.detach(); // never attached: touches nothing
    expect(h.dbg.detachCalls).toBe(0);
    await h.tabDebugger.attach();
    h.tabDebugger.detach();
    h.tabDebugger.detach();
    expect(h.dbg.detachCalls).toBe(1);
    expect(h.tabDebugger.attached).toBe(false);
    expect(h.tabDebugger.mainFrameId).toBeNull();
    await h.tabDebugger.attach();
    expect(h.dbg.attachCalls).toBe(2);
    h.destroy();
    expect(() => h.tabDebugger.detach()).not.toThrow();
  });

  it('forwards Chromium\'s detach with its reason, and forgets the attachment and what was in flight', async () => {
    const h = harness();
    const reasons: string[] = [];
    h.tabDebugger.onDetach((reason) => reasons.push(reason));
    void h.tabDebugger.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 }).catch(() => {});
    await settle();
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(true);
    h.dbg.attachedTo = null;
    h.dbg.emit('detach', {}, 'Render process gone.');
    expect(reasons).toEqual(['Render process gone.']);
    expect(h.tabDebugger.attached).toBe(false);
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(false);
    h.tabDebugger.detach(); // already detached: told once
    expect(reasons).toHaveLength(1);
  });
});

describe('TabDebugger: the in-flight table (A-33; Decision Log 19)', () => {
  it('an Input command is in flight from before its send until its reply', async () => {
    const h = harness();
    await h.tabDebugger.attach();
    const pressed = h.tabDebugger.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left' });
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(true); // entered before the send reaches Chromium
    expect(h.tabDebugger.inFlight('mouseReleased')).toBe(false);
    await settle();
    h.dbg.last().resolve({});
    await pressed;
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(false);
  });

  it('an Input command whose reply is an error leaves the table too, so it cannot absorb a later human press', async () => {
    const h = harness();
    await h.tabDebugger.attach();
    const pressed = h.tabDebugger.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5 });
    await settle();
    h.dbg.last().reject(new Error('Invalid parameters'));
    await expect(pressed).rejects.toThrow('Invalid parameters');
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(false);
    expect(h.tabDebugger.consume('mousePressed')).toBe(false);
  });

  it('consume takes one unconsumed command of the kind at a time, oldest first, and says when there was none', async () => {
    const h = harness();
    await h.tabDebugger.attach();
    void h.tabDebugger.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 });
    h.tick(1);
    void h.tabDebugger.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 2, y: 2 });
    void h.tabDebugger.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2 });
    expect(h.tabDebugger.consume('mousePressed')).toBe(true);
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(true); // the second is still unconsumed
    expect(h.tabDebugger.consume('mousePressed')).toBe(true);
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(false); // in flight, but both consumed
    expect(h.tabDebugger.consume('mousePressed')).toBe(false);
    expect(h.tabDebugger.inFlight('mouseReleased')).toBe(true);
  });

  it('only Input commands enter the table, keyed by their params\' type', async () => {
    const h = harness();
    await h.tabDebugger.attach();
    void h.tabDebugger.send('Runtime.evaluate', { expression: '1', type: 'mousePressed' });
    void h.tabDebugger.send('Input.insertText', { text: 'filled' }); // no type: in the table, matches no mouse kind
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(false);
    void h.tabDebugger.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a' });
    expect(h.tabDebugger.inFlight('mousePressed')).toBe(false);
  });
});

describe('TabDebugger: observers and events', () => {
  it('onCommand sees every command\'s send and reply, enters nothing, and stops when unsubscribed', async () => {
    const h = harness();
    await h.tabDebugger.attach();
    const seen: CommandPhase[] = [];
    const stop = h.tabDebugger.onCommand((phase) => {
      seen.push(phase);
      if (phase.method.startsWith('Input.')) expect(h.tabDebugger.inFlight('mouseReleased')).toBe(phase.phase === 'send'); // the table is already updated
    });
    const released = h.tabDebugger.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1 }, 'S1');
    await settle();
    h.tick(2);
    h.dbg.last().resolve({});
    await released;
    const failing = h.tabDebugger.send('Page.navigate', { url: 'https://a.test/' });
    await settle();
    h.dbg.last().reject(new Error('nope'));
    await expect(failing).rejects.toThrow('nope');
    expect(seen.map((p) => [p.phase, p.method, p.sessionId, p.phase === 'reply' ? p.ok : null])).toEqual([
      ['send', 'Input.dispatchMouseEvent', 'S1', null],
      ['reply', 'Input.dispatchMouseEvent', 'S1', true],
      ['send', 'Page.navigate', '', null],
      ['reply', 'Page.navigate', '', false],
    ]);
    expect(seen[0]).toMatchObject({ id: seen[1]!.id, at: 1000, params: { type: 'mouseReleased', x: 1, y: 1 } });
    expect(seen[1]).toMatchObject({ at: 1002 });
    stop();
    void h.tabDebugger.send('Page.reload');
    expect(seen).toHaveLength(4);
  });

  it('routes events by method, the root session as \'\', every event to \'*\', until unsubscribed', async () => {
    const h = harness();
    const loads: [unknown, string][] = [];
    const all: string[] = [];
    const stop = h.tabDebugger.on('Page.loadEventFired', (params, sessionId) => loads.push([params, sessionId]));
    h.tabDebugger.on('*', (_params, sessionId, method) => all.push(`${method}@${sessionId}`));
    await h.tabDebugger.attach(); // listeners registered before the attachment hear what follows it
    h.dbg.emit('message', {}, 'Page.loadEventFired', { timestamp: 1 }, undefined);
    h.dbg.emit('message', {}, 'Page.loadEventFired', { timestamp: 2 }, 'CHILD-1');
    h.dbg.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'CHILD-2' }, '');
    stop();
    h.dbg.emit('message', {}, 'Page.loadEventFired', { timestamp: 3 }, '');
    expect(loads).toEqual([
      [{ timestamp: 1 }, ''],
      [{ timestamp: 2 }, 'CHILD-1'],
    ]);
    expect(all).toEqual(['Page.loadEventFired@', 'Page.loadEventFired@CHILD-1', 'Target.attachedToTarget@', 'Page.loadEventFired@']);
  });

  it('a listener that throws neither stops the others nor escapes into Electron', async () => {
    const h = harness();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const heard: string[] = [];
    h.tabDebugger.on('Page.frameNavigated', () => {
      throw new Error('listener bug');
    });
    h.tabDebugger.on('Page.frameNavigated', () => heard.push('second'));
    await h.tabDebugger.attach();
    expect(() => h.dbg.emit('message', {}, 'Page.frameNavigated', {}, '')).not.toThrow();
    expect(heard).toEqual(['second']);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
