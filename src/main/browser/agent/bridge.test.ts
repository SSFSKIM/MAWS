import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { TabDebugger, type CommandPhase } from '../debugger';
import { startCdpBridge, type CdpBridge } from './bridge';

// G3 (E4c Acceptance): the bridge over E4a's real TabDebugger, itself over a fake `webContents.debugger`, driven by a raw
// `ws` client as Playwright would drive it. The bridge never holds the raw debugger: every command it forwards must go
// through `TabDebugger.send` (spied), which is what fills the in-flight table the input attribution reads.

class FakeElectronDebugger extends EventEmitter {
  attachedTo: string | null = null;
  readonly sent: { method: string; params: unknown; sessionId: string | undefined }[] = [];
  hold: ((method: string) => boolean) | null = null; // commands held until `release`
  private readonly held: (() => void)[] = [];

  attach(version: string) {
    this.attachedTo = version;
  }
  detach() {
    this.attachedTo = null;
  }
  isAttached() {
    return this.attachedTo !== null;
  }
  sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    if (!this.attachedTo) return Promise.reject(new Error('No target available'));
    if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: 'FRAME-MAIN' } } });
    this.sent.push({ method, params, sessionId });
    const answer = { echoed: method };
    if (this.hold?.(method)) return new Promise((resolve) => this.held.push(() => resolve(answer)));
    return Promise.resolve(answer);
  }
  release() {
    for (const go of this.held.splice(0)) go();
  }
  event(method: string, params: unknown, sessionId = '') {
    this.emit('message', {}, method, params, sessionId);
  }
}

interface Reply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

// A raw CDP client: numbered commands answered by id, events collected.
class Client {
  private nextId = 1;
  private readonly waiting = new Map<number, (reply: Reply) => void>();
  readonly events: Reply[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString()) as Reply;
      if (message.id !== undefined) this.waiting.get(message.id)?.(message);
      else this.events.push(message);
    });
  }

  static open(url: string): Promise<Client> {
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(new Client(ws)));
      ws.once('error', reject);
    });
  }

  call(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Reply> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve) => this.waiting.set(id, resolve));
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }

  get closed(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => this.ws.once('close', () => resolve()));
  }
}

// What an upgrade the bridge refuses answers: the status code `ws` reports from the server's response.
function refusedStatus(url: string, options: { origin?: string } = {}): Promise<number> {
  const ws = new WebSocket(url, options);
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      ws.terminate();
    });
    ws.once('error', (error) => {
      const match = /Unexpected server response: (\d+)/.exec(error.message);
      if (match) resolve(Number(match[1]));
      else reject(error);
    });
    ws.once('open', () => reject(new Error('the upgrade was accepted')));
  });
}

const page = { getTitle: () => 'Example', getURL: () => 'https://example.com/', getUserAgent: () => 'MAWS-UA', focus: vi.fn() };

const opened: { bridge: CdpBridge; clients: Client[] }[] = [];

async function harness() {
  const raw = new FakeElectronDebugger();
  const tabDebugger = new TabDebugger({ debugger: raw, isDestroyed: () => false } as never);
  const send = vi.spyOn(tabDebugger, 'send');
  const bridge = await startCdpBridge(tabDebugger, page);
  const record = { bridge, clients: [] as Client[] };
  opened.push(record);
  const connect = async () => {
    const client = await Client.open(bridge.wsUrl);
    record.clients.push(client);
    return client;
  };
  return { raw, tabDebugger, send, bridge, connect, PAGE: bridge.pageSessionId };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(async () => {
  for (const { bridge, clients } of opened.splice(0)) {
    await Promise.all(clients.map((client) => client.close()));
    await bridge.close({ detach: false });
  }
});

describe('startCdpBridge: the boundary (G3)', () => {
  it('refuses Target.getTargets on the page session', async () => {
    const { connect, PAGE, raw } = await harness();
    const client = await connect();
    const reply = await client.call('Target.getTargets', {}, PAGE);
    expect(reply.error?.code).toBe(-32601);
    expect(reply.error?.message).toContain('not available through the MAWS debugger bridge');
    expect(raw.sent).toEqual([]);
  });

  it('refuses Target.attachToTarget to another target at both levels', async () => {
    const { connect, PAGE, raw } = await harness();
    const client = await connect();
    const browserLevel = await client.call('Target.attachToTarget', { targetId: 'SOMEONE-ELSE', flatten: true });
    expect(browserLevel.error?.code).toBe(-32602);
    const onSession = await client.call('Target.attachToTarget', { targetId: 'SOMEONE-ELSE', flatten: true }, PAGE);
    expect(onSession.error?.code).toBe(-32601);
    expect(raw.sent).toEqual([]);
  });

  it('refuses a command on a session it never announced', async () => {
    const { connect, raw } = await harness();
    const client = await connect();
    const reply = await client.call('Runtime.evaluate', { expression: '1' }, 'INVENTED-SESSION');
    expect(reply.error?.code).toBe(-32001);
    expect(reply.error?.message).toContain('unknown session');
    expect(raw.sent).toEqual([]);
  });

  it.each(['Storage.getCookies', 'Browser.grantPermissions', 'SystemInfo.getInfo', 'Tethering.bind'])('refuses %s on the page session', async (method) => {
    const { connect, PAGE, raw } = await harness();
    const client = await connect();
    const reply = await client.call(method, {}, PAGE);
    expect(reply.error?.code).toBe(-32601);
    expect(raw.sent).toEqual([]);
  });

  it("forwards auto-attach's three Target methods (getTargetInfo for its own target only)", async () => {
    const { connect, PAGE, send } = await harness();
    const client = await connect();
    for (const [method, params] of [
      ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }],
      ['Target.detachFromTarget', { sessionId: 'CHILD' }],
      ['Target.getTargetInfo', {}],
      ['Target.getTargetInfo', { targetId: 'FRAME-MAIN' }],
    ] as const) {
      const reply = await client.call(method, params, PAGE);
      expect(reply.result).toEqual({ echoed: method });
      expect(reply.sessionId).toBe(PAGE);
    }
    expect(send.mock.calls.map(([method, , sessionId]) => [method, sessionId])).toEqual([
      ['Target.setAutoAttach', undefined],
      ['Target.detachFromTarget', undefined],
      ['Target.getTargetInfo', undefined],
      ['Target.getTargetInfo', undefined],
    ]);
    const other = await client.call('Target.getTargetInfo', { targetId: 'SOMEONE-ELSE' }, PAGE);
    expect(other.error?.code).toBe(-32601);
  });

  it('admits a child session Chromium announced and drops it when it detaches', async () => {
    const { connect, PAGE, raw, send } = await harness();
    const client = await connect();
    raw.event('Target.attachedToTarget', { sessionId: 'CHILD-1', targetInfo: { targetId: 'IFRAME-1', type: 'iframe' }, waitingForDebugger: false });
    await vi.waitFor(() => expect(client.events.at(-1)).toMatchObject({ method: 'Target.attachedToTarget', sessionId: PAGE, params: { sessionId: 'CHILD-1' } }));
    const admitted = await client.call('Runtime.evaluate', { expression: '1' }, 'CHILD-1');
    expect(admitted.result).toEqual({ echoed: 'Runtime.evaluate' });
    expect(admitted.sessionId).toBe('CHILD-1');
    expect(send).toHaveBeenLastCalledWith('Runtime.evaluate', { expression: '1' }, 'CHILD-1');
    raw.event('Runtime.consoleAPICalled', { type: 'log' }, 'CHILD-1');
    await vi.waitFor(() => expect(client.events.at(-1)).toMatchObject({ method: 'Runtime.consoleAPICalled', sessionId: 'CHILD-1' }));

    raw.event('Target.detachedFromTarget', { sessionId: 'CHILD-1' });
    await settle();
    const dropped = await client.call('Runtime.evaluate', { expression: '1' }, 'CHILD-1');
    expect(dropped.error?.code).toBe(-32001);
  });

  it('forwards a page-session command through TabDebugger.send, never anything else', async () => {
    const { connect, PAGE, raw, send } = await harness();
    const client = await connect();
    const reply = await client.call('Runtime.evaluate', { expression: 'document.title' }, PAGE);
    expect(reply).toMatchObject({ result: { echoed: 'Runtime.evaluate' }, sessionId: PAGE });
    expect(send).toHaveBeenCalledWith('Runtime.evaluate', { expression: 'document.title' }, undefined);
    // what reached Electron's debugger is exactly what went through `send` (the frame tree read is the attach's own)
    expect(raw.sent).toEqual([{ method: 'Runtime.evaluate', params: { expression: 'document.title' }, sessionId: undefined }]);
  });

  it('answers a forwarded command that fails with its message', async () => {
    const { connect, PAGE, raw } = await harness();
    const client = await connect();
    vi.spyOn(raw, 'sendCommand').mockRejectedValueOnce(new Error('Cannot find context with specified id'));
    const reply = await client.call('Runtime.evaluate', { expression: '1' }, PAGE);
    expect(reply.error).toEqual({ code: -32000, message: 'Cannot find context with specified id' });
  });

  it('shows every Input command to the TabDebugger observers in both phases, in flight between them', async () => {
    const { connect, PAGE, raw, tabDebugger } = await harness();
    const client = await connect();
    const phases: CommandPhase[] = [];
    tabDebugger.onCommand((phase) => phases.push(phase));
    raw.hold = (method) => method.startsWith('Input.');
    const press = client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1 }, PAGE);
    await vi.waitFor(() => expect(raw.sent).toHaveLength(1));
    expect(tabDebugger.inFlight('mousePressed')).toBe(true);
    raw.release();
    await press;
    const key = client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a' }, PAGE);
    await vi.waitFor(() => expect(raw.sent).toHaveLength(2));
    raw.release();
    await key;
    expect(tabDebugger.inFlight('mousePressed')).toBe(false);
    expect(phases.map(({ phase, method }) => `${phase} ${method}`)).toEqual([
      'send Input.dispatchMouseEvent',
      'reply Input.dispatchMouseEvent',
      'send Input.dispatchKeyEvent',
      'reply Input.dispatchKeyEvent',
    ]);
  });
});

describe('startCdpBridge: the browser-level answers', () => {
  it('announces the one page under its real main-frame id and relays its events under the synthetic session', async () => {
    const { connect, PAGE, raw } = await harness();
    const client = await connect();
    const version = await client.call('Browser.getVersion');
    expect(version.result).toMatchObject({ protocolVersion: '1.3', userAgent: 'MAWS-UA' });
    const attach = await client.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    expect(attach.result).toEqual({});
    await vi.waitFor(() => expect(client.events[0]).toEqual({
      method: 'Target.attachedToTarget',
      params: {
        sessionId: PAGE,
        targetInfo: { targetId: 'FRAME-MAIN', type: 'page', title: 'Example', url: 'https://example.com/', attached: true, canAccessOpener: false, browserContextId: 'maws-bridge-context' },
        waitingForDebugger: false,
      },
    }));
    raw.event('Page.loadEventFired', { timestamp: 1 });
    await vi.waitFor(() => expect(client.events.at(-1)).toEqual({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: PAGE }));
    expect((await client.call('Browser.setDownloadBehavior', { behavior: 'deny' })).result).toEqual({ cookies: [] });
    for (const method of ['Target.createTarget', 'Target.closeTarget', 'Target.attachToBrowserTarget', 'Target.exposeDevToolsProtocol']) {
      expect((await client.call(method, { url: 'about:blank' })).error?.code).toBe(-32601);
    }
    expect((await client.call('Target.attachToTarget', { targetId: 'FRAME-MAIN', flatten: true })).result).toEqual({ sessionId: PAGE });
    expect(raw.sent).toEqual([]);
  });

  it('reports the debugger going away as the page detaching, and forwards nothing after it', async () => {
    const { connect, PAGE, raw, tabDebugger } = await harness();
    const client = await connect();
    raw.detach();
    raw.emit('detach', {}, 'target closed');
    await settle();
    expect(tabDebugger.attached).toBe(false);
    await vi.waitFor(() => expect(client.events.at(-1)).toEqual({ method: 'Target.detachedFromTarget', params: { sessionId: PAGE, targetId: 'FRAME-MAIN', reason: 'target closed' } }));
    const reply = await client.call('Runtime.evaluate', { expression: '1' }, PAGE);
    expect(reply.error?.code).toBe(-32000);
    expect(tabDebugger.attached).toBe(false); // a stale connection never revives the attachment (M0's surprise)
    expect(raw.sent).toEqual([]);
  });
});

describe('startCdpBridge: the socket (G3)', () => {
  it('refuses an upgrade on any path but the token path (404)', async () => {
    const { bridge } = await harness();
    const wrong = bridge.wsUrl.replace(/\/devtools\/browser\/[0-9a-f]+$/, '/devtools/browser/guess');
    expect(await refusedStatus(wrong)).toBe(404);
    expect(bridge.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[0-9a-f]{32}$/);
    expect(bridge.stats.rejectedUpgrades).toBe(1);
  });

  it('refuses an upgrade that carries an Origin header (403)', async () => {
    const { bridge } = await harness();
    expect(await refusedStatus(bridge.wsUrl, { origin: 'https://evil.example' })).toBe(403);
  });

  it('refuses a second socket while one is open (409), and takes a new one once it closed', async () => {
    const { bridge, connect } = await harness();
    const first = await connect();
    expect(await refusedStatus(bridge.wsUrl)).toBe(409);
    await first.close();
    await vi.waitFor(() => expect(bridge.connected).toBe(false));
    const second = await connect();
    expect((await second.call('Browser.getVersion')).result).toBeDefined();
  });

  it('serves no /json/version (the token is never published)', async () => {
    const { bridge } = await harness();
    const http = bridge.wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/.*$/, '/json/version');
    expect((await fetch(http)).status).toBe(404);
  });
});

describe('startCdpBridge: waiting children while no socket is open', () => {
  it('resumes a child that waits for a debugger when no client is connected', async () => {
    const { raw, send } = await harness();
    raw.event('Target.attachedToTarget', { sessionId: 'CHILD-2', targetInfo: { targetId: 'IFRAME-2', type: 'iframe' }, waitingForDebugger: true });
    await settle();
    expect(send).toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger', undefined, 'CHILD-2');
    expect(raw.sent).toEqual([{ method: 'Runtime.runIfWaitingForDebugger', params: undefined, sessionId: 'CHILD-2' }]);
  });

  it('leaves the resume to the connected client', async () => {
    const { raw, connect, send } = await harness();
    const client = await connect();
    raw.event('Target.attachedToTarget', { sessionId: 'CHILD-3', targetInfo: { targetId: 'IFRAME-3', type: 'iframe' }, waitingForDebugger: true });
    await vi.waitFor(() => expect(client.events.at(-1)).toMatchObject({ method: 'Target.attachedToTarget', params: { sessionId: 'CHILD-3', waitingForDebugger: true } }));
    expect(send).not.toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger', undefined, 'CHILD-3');
  });

  it('resumes again once the client has gone', async () => {
    const { raw, connect, send, bridge } = await harness();
    const client = await connect();
    await client.close();
    await vi.waitFor(() => expect(bridge.connected).toBe(false));
    raw.event('Target.attachedToTarget', { sessionId: 'CHILD-4', targetInfo: { targetId: 'WORKER-4', type: 'worker' }, waitingForDebugger: true });
    await settle();
    expect(send).toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger', undefined, 'CHILD-4');
  });
});

describe('startCdpBridge: close', () => {
  it('closes the socket and the server and leaves the attachment unless told to detach', async () => {
    const { bridge, connect, tabDebugger, raw } = await harness();
    const client = await connect();
    await bridge.close({ detach: false });
    await client.closed;
    expect(tabDebugger.attached).toBe(true);
    expect(raw.isAttached()).toBe(true);
    await expect(Client.open(bridge.wsUrl)).rejects.toThrow();
    // closed: an event no longer reaches anyone and no waiting child is resumed by a dead bridge
    raw.event('Target.attachedToTarget', { sessionId: 'CHILD-5', waitingForDebugger: true });
    await settle();
    expect(raw.sent).toEqual([]);
  });

  it('detaches when told to', async () => {
    const { bridge, tabDebugger, raw } = await harness();
    await bridge.close({ detach: true });
    expect(tabDebugger.attached).toBe(false);
    expect(raw.isAttached()).toBe(false);
  });
});
