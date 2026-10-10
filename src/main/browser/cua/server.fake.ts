// The primitive server's test stand (the in-app browser spec of 2026-10-08, M2 and M3): a real socket per app session,
// MAWS's real TabStore and TabDebugger over fake views whose webContents.debugger records every command, and the fake
// host of test/support/cua-fake-host.ts on the other end, as cua's host would be. With `presence`, MAWS's real control
// and cursor (agent/control.ts, agent/cursor.ts) take part; `emitted` keeps what the server told the windows. Every
// socket checks its peer (the socket peer authentication spec of 2026-10-09, M2): by default with the committed addon and
// the test process as a trusted root, so the fake host this process runs is accepted; `peer` replaces both.
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { WebContentsView } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { MawsDownloadRecorded } from '@shared/ipc/schema/maws';
import { connectFakeHost, type FakeHost } from '../../../../test/support/cua-fake-host';
import { TabControls } from '../agent/control';
import { AgentCursor } from '../agent/cursor';
import { TabStore, type TabEntry } from '../tabs';
import { startCuaBackend, type CuaBackend, type CuaBackendDeps } from './index';
import { loadPeerAddon, peerAddonPath, rootOf, type ProcessRoot } from './peer';

export const A = 'A' as AppSessionId;
export const B = 'B' as AppSessionId;
export const S = 'S' as AppSessionId; // a side thread of A: reaches A's tabs (P-24)

export class FakeCdp extends EventEmitter {
  attached = false;
  detachCalls = 0;
  readonly sent: { method: string; params: unknown; sessionId: string | undefined }[] = [];
  readonly hang = new Set<string>();
  readonly replies: Record<string, unknown> = {}; // a method's canned reply, else `{echoed: method}`
  constructor(readonly frameId: string) {
    super();
  }
  attach() {
    if (this.attached) throw new Error('Debugger is already attached to the target');
    this.attached = true;
  }
  detach() {
    this.detachCalls++;
    this.attached = false;
  }
  isAttached() {
    return this.attached;
  }
  sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    if (!this.attached) return Promise.reject(new Error('No target available'));
    if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: this.frameId } } });
    this.sent.push({ method, params, sessionId });
    if (this.hang.has(method)) return new Promise(() => {});
    if (Object.hasOwn(this.replies, method)) return Promise.resolve(this.replies[method]);
    return Promise.resolve({ echoed: method });
  }
  methods() {
    return this.sent.map((c) => c.method);
  }
  event(method: string, params: unknown, sessionId = '') {
    this.emit('message', {}, method, params, sessionId);
  }
}

export class FakeContents extends EventEmitter {
  readonly debugger: FakeCdp;
  url = '';
  destroyed = false;
  constructor(frameId: string) {
    super();
    this.debugger = new FakeCdp(frameId);
  }
  loadURL(url: string) {
    this.url = url;
    return Promise.resolve();
  }
  getURL() {
    return this.url;
  }
  reload() {} // the person's Reload (navigation.ts), whose commit a case raises as the page's event
  close() {
    this.destroyed = true;
  }
  isDestroyed() {
    return this.destroyed;
  }
  setWindowOpenHandler() {}
  readonly sentToPage: { channel: string; message: unknown }[] = []; // what main sent the page (the cursor's messages)
  send(channel: string, message: unknown) {
    this.sentToPage.push({ channel, message });
  }
  throttling = true;
  setBackgroundThrottling(on: boolean) {
    this.throttling = on;
  }
}

let frames = 0;
export const fakeView = (contents = new FakeContents(`FRAME-${++frames}`)) => ({ webContents: contents, setBounds() {}, setVisible() {}, getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }) });

const roots: string[] = [];
const backends: CuaBackend[] = [];
const hosts: FakeHost[] = [];
const disposables: { dispose(): void }[] = [];
// What a case made by hand, taken down with the stands.
export const tracked = { roots, backends, hosts };

// Every stand made since the last call, taken down (the suites' afterEach).
export async function takeDown(): Promise<void> {
  for (const host of hosts.splice(0)) await host.close();
  for (const backend of backends.splice(0)) backend.dispose();
  for (const part of disposables.splice(0)) part.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

// The committed addon (vitest runs from the repository root) with this test process as a trusted root.
export function testPeer(): NonNullable<CuaBackendDeps['peer']> {
  const addon = loadPeerAddon(peerAddonPath({ packaged: false, resourcesPath: '', appRoot: process.cwd() }));
  if (!addon) throw new Error('the peer identity addon did not load (run scripts/build-peer-auth.sh)');
  return { addon, trustedRoots: new Set<ProcessRoot>([rootOf(process.pid, addon)!]) };
}

// `peer: null` starts the backend without the option at all.
export function harness({ presence = false, peer = testPeer() }: { presence?: boolean; peer?: CuaBackendDeps['peer'] | null } = {}) {
  const root = mkdtempSync('/tmp/mcua-');
  roots.push(root);
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  const store: TabStore = new TabStore({
    emit,
    createView: (_tab, adopted) => (adopted ? fakeView(adopted as unknown as FakeContents) : fakeView()) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
  });
  const reaches = (appSessionId: AppSessionId, tabSession: AppSessionId) => tabSession === appSessionId || (appSessionId === S && tabSession === A);
  const changes: string[] = [];
  const controls = presence ? new TabControls({ store }) : null;
  const cursor = controls ? new AgentCursor({ store, controls }) : null;
  if (controls && cursor) disposables.push(cursor, controls);
  const recorded: MawsDownloadRecorded[] = [];
  const logs: string[] = [];
  const backend = startCuaBackend({
    store, windows: () => [{ id: 7, focused: true }], reaches, userData: root, version: '1.2.3', log: (line) => void logs.push(line), ...(peer && { peer }),
    ...(controls && cursor && { presence: { controls, cursor }, emit, recordDownload: async (download: MawsDownloadRecorded) => void recorded.push(download) }),
  });
  backend.onChange((tabId) => changes.push(tabId));
  backends.push(backend);
  const host = async (appSessionId: AppSessionId = A) => {
    const connected = await connectFakeHost(backend.socketPathFor(appSessionId)!);
    hosts.push(connected);
    return connected;
  };
  const personTab = (appSessionId: AppSessionId = A, url = 'https://person.test/') => {
    const { tab } = store.open({ appSessionId, url, select: true });
    return store.entry(tab.tabId)!;
  };
  const cdp = (entry: TabEntry) => (entry.view!.webContents as unknown as FakeContents).debugger;
  const idOf = async (h: FakeHost, entry: TabEntry) => {
    const tabs = await h.request<{ id: number; url: string }[]>('tabs.query');
    const found = tabs.find((t) => t.url === (entry.view!.webContents as unknown as FakeContents).url);
    if (!found) throw new Error(`tab ${entry.tab.tabId} not listed`);
    return found.id;
  };
  const activities = () => emitted.filter((e) => e.name === 'browser.agent.activity').map((e) => e.payload as { appSessionId: string; tabId: string; at: string; activity: { kind: string } & Record<string, unknown> });
  const page = (entry: TabEntry) => entry.view!.webContents as unknown as FakeContents;
  return { root, store, backend, host, personTab, cdp, idOf, changes, emitted, activities, recorded, controls, page, logs };
}

