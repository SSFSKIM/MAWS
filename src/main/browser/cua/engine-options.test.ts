import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { connectFakeHost } from '../../../../test/support/cua-fake-host';
import { TabStore } from '../tabs';
import { startCuaBackend, type CuaBackend, type CuaBackendDeps } from './index';
import type { PeerAddon } from './peer';
import { fakeView, type FakeContents } from './server.fake';

// What the render host's tab engine asks of the primitive server beside the app's use (P5 O17 M4;
// docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M4, Interfaces §D, §H): its sockets in a directory of its own,
// `listening` before it tells mawsd a session is prepared, `closeSession` resolving only once every connection of the
// session has closed (each lease let go) before it tells mawsd the session is dropped, and `relay` saying whether the
// relay pass for the link holds. Real sockets; the uid boundary admits this process's fake host on any platform.

const A = 'A' as AppSessionId;
const uid = process.getuid!();
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function backend(peer: CuaBackendDeps['peer'] = { addon: null, platform: 'linux' }): { cua: CuaBackend; store: TabStore; dir: string } {
  const root = mkdtempSync('/tmp/mco-');
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store: TabStore = new TabStore({
    emit: () => {},
    createView: (_tab, adopted) => (adopted ? fakeView(adopted as unknown as FakeContents) : fakeView()) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
  });
  const dir = join(root, 'render-cua');
  const cua = startCuaBackend({ store, windows: () => [{ id: 1, focused: true }], reaches: (a, b) => a === b, userData: join(root, 'userData'), socketDir: dir, version: '1', peer, log: () => {} });
  cleanups.push(() => cua.dispose());
  return { cua, store, dir };
}

describe('the primitive server as the render host composes it', () => {
  it('listens in the socket directory it is given, owner-only, and says when', async () => {
    const { cua, dir } = backend();
    const path = cua.socketPathFor(A)!;
    expect(path).toBe(join(dir, 'A.sock'));
    await cua.listening(A);
    expect(statSync(path).isSocket()).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    await expect(cua.listening('B' as AppSessionId)).rejects.toThrow('no cua socket listens for B');
  });

  it('resolves closeSession once the session’s connections have closed, each lease let go', async () => {
    const { cua } = backend();
    const host = await connectFakeHost(cua.socketPathFor(A)!);
    cleanups.push(() => host.close());
    const created = await host.request<{ id: number }>('tabs.create', { url: 'http://127.0.0.1:4000/' });
    await host.request('debugger.attach', { tabId: created.id });
    const [tabId] = cua.inspect().sessions.A!.leased;
    expect(cua.holds(tabId!)).toBe(true);
    let closed = false;
    const closing = cua.closeSession(A).then(() => (closed = true));
    expect(closed).toBe(false);
    await closing;
    expect(cua.holds(tabId!), 'the lease was let go first').toBe(false);
    await host.closed;
    expect(await cua.closeSession(A), 'a session with no socket: at once').toBeUndefined();
  });

  it('says whether the relay pass holds: true once confirmed, false refused, superseded or with no link', async () => {
    const live = { pid: 4242, start: 77 };
    const addon: PeerAddon = { version: 1, peer: () => ({ pid: live.pid, uid }), process: (pid) => (pid === live.pid ? { ppid: 1, start: live.start } : null) };
    const { cua } = backend({ addon, platform: 'darwin' });
    expect(await cua.relay(null)).toBe(false);
    expect(await cua.relay({ fd: 3, confirm: async () => true })).toBe(true);
    expect(await cua.relay({ fd: 3, confirm: async () => false })).toBe(false);
    let answer!: (ok: boolean) => void;
    const superseded = cua.relay({ fd: 3, confirm: () => new Promise((resolve) => (answer = resolve)) });
    const latest = cua.relay({ fd: 3, confirm: async () => true });
    answer(true);
    expect(await superseded).toBe(false);
    expect(await latest).toBe(true);
  });
});
