// P5 O7 M3 ("Forwarding"): a loopback link out of another machine's session is a forward. The rule's edges (whose
// session, which link), the open through `remote.forward.open` (this app's own command: no machine to invoke it on) and
// the page on the local listener's port, the mark a tab on that port carries, and what a refused open says.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { IpcError } from '@shared/ipc/errors';
import { addressOf } from '@shared/machine/address';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at, OTHER_MACHINE } from '../../../../../test/support/machine';
import { browserTab, T1 } from '../../test-support/browser';
import { forwardErrorWords, forwardMarkOf, forwardOf, forwards, loopbackElsewhere, openForward, resetForwards, retryForward } from './forward';
import { browser, resetBrowser } from './store';

const LOCAL = at('session-l' as AppSessionId);
const R = addressOf(OTHER_MACHINE, 'session-r' as AppSessionId);
const FORWARD = { machine: OTHER_MACHINE, port: 5173 };

beforeEach(() => {
  resetForwards();
  resetBrowser();
});
afterEach(() => {
  resetForwards();
  resetBrowser();
});

describe('forwardOf', () => {
  it('forwards a loopback link with its port out of another machine’s session', () => {
    expect(forwardOf(R, 'http://localhost:5173/app')).toEqual(FORWARD);
    expect(forwardOf(R, 'http://127.0.0.1:8000/')).toEqual({ machine: OTHER_MACHINE, port: 8000 });
    expect(forwardOf(R, 'https://0.0.0.0:8443/x?y#z')).toEqual({ machine: OTHER_MACHINE, port: 8443 });
  });

  it('forwards a loopback link with no port written at its scheme’s default', () => {
    expect(forwardOf(R, 'http://localhost/')).toEqual({ machine: OTHER_MACHINE, port: 80 });
  });

  // M3b fix wave 1's split: a loopback link that is no forward is the machine's all the same, and opens nowhere
  it('names the machine of a loopback link that cannot be forwarded, and of no other', () => {
    for (const url of ['http://[::1]:3000/', 'http://127.0.0.2:3000/', 'ws://localhost:3000/']) {
      expect(forwardOf(R, url), url).toBeNull();
      expect(loopbackElsewhere(R, url), url).toBe(OTHER_MACHINE);
    }
    expect(loopbackElsewhere(R, 'http://localhost:5173/'), 'a forward').toBeNull();
    expect(loopbackElsewhere(R, 'https://example.com/')).toBeNull();
    expect(loopbackElsewhere(LOCAL, 'http://[::1]:3000/'), 'this Mac’s own').toBeNull();
  });

  it('leaves every other link, and every link of this machine’s sessions', () => {
    expect(forwardOf(LOCAL, 'http://localhost:5173/app'), 'a local session’s localhost is this Mac’s').toBeNull();
    expect(forwardOf(R, 'https://example.com:8443/')).toBeNull();
    expect(forwardOf(R, 'mailto:someone@example.com')).toBeNull();
    expect(forwardOf(R, 'not a url')).toBeNull();
    expect(forwardOf('bare-id' as AppSessionId, 'http://localhost:5173/'), 'a bare id is no other machine’s').toBeNull();
  });
});

describe('openForward', () => {
  let fake: FakeClient;
  beforeEach(() => {
    fake = fakeClient({ 'browser.tabs.open': { tab: browserTab(T1, R), reused: false } });
  });

  it('opens the forward on this app, then the page on its local port in the session, selected; a tab there is marked', async () => {
    const done = openForward(fake.client, R, 'http://localhost:5173/app?x=1#top', FORWARD, 'r1');
    expect(fake.invoked('remote.forward.open')).toEqual([FORWARD]);
    expect(fake.machines('remote.forward.open'), 'the input names the machine; the command is this app’s').toEqual([undefined]);
    await fake.reply('remote.forward.open', { localPort: 54321 });
    await done;
    expect(fake.invoked('browser.tabs.open')).toEqual([{ appSessionId: R, url: 'http://127.0.0.1:54321/app?x=1#top', select: true, reuse: 'url', requestId: 'r1' }]);
    const { ports } = forwards.getState();
    expect(forwardMarkOf('http://127.0.0.1:54321/elsewhere', ports)).toEqual(FORWARD);
    expect(forwardMarkOf('http://127.0.0.1:54322/', ports)).toBeNull();
    expect(forwardMarkOf('http://localhost:54321/', ports), 'only the listener’s own address').toBeNull();
    expect(forwardMarkOf('', ports)).toBeNull();
  });

  it('a port reopened on another local port moves its mark there', async () => {
    const first = openForward(fake.client, R, 'http://localhost:5173/', FORWARD);
    await fake.reply('remote.forward.open', { localPort: 54321 });
    await first;
    const second = openForward(fake.client, R, 'http://localhost:5173/', FORWARD);
    await fake.reply('remote.forward.open', { localPort: 60000 });
    await second;
    const { ports } = forwards.getState();
    expect(forwardMarkOf('http://127.0.0.1:54321/', ports)).toBeNull();
    expect(forwardMarkOf('http://127.0.0.1:60000/', ports)).toEqual(FORWARD);
  });

  it('a refused open opens no tab and is kept for the session’s browser, with the tab then selected; a retry that opens clears it', async () => {
    browser.setState({ sessions: new Map([[R, { tabs: [browserTab(T1, R)], selected: T1 }]]) });
    const done = openForward(fake.client, R, 'http://localhost:5173/', FORWARD);
    await fake.fail('remote.forward.open', 'remote.forward.open: machine OtherMachineRef0000000 is not reachable', 'host_unavailable');
    await done;
    expect(fake.invoked('browser.tabs.open')).toEqual([]);
    expect(forwards.getState().failures.get(R)).toMatchObject({ url: 'http://localhost:5173/', forward: FORWARD, error: { code: 'host_unavailable' }, selected: T1 });
    const retried = retryForward(fake.client, R);
    expect(fake.invoked('remote.forward.open')).toEqual([FORWARD, FORWARD]);
    await fake.reply('remote.forward.open', { localPort: 54321 });
    await retried;
    expect(forwards.getState().failures.has(R)).toBe(false);
    expect(fake.invoked('browser.tabs.open')).toHaveLength(1);
  });
});

describe('forwardErrorWords', () => {
  const words = (error: IpcError) => forwardErrorWords(error, 'mini');
  it('says each refusal of the contract in the machine’s name, and a timeout’s pending words as main gave them', () => {
    expect(words({ code: 'host_unavailable', message: 'x' })).toBe('mini isn’t reachable from this Mac right now');
    expect(words({ code: 'internal', message: 'x', issues: { refusal: 'grade' } })).toBe('This Mac isn’t allowed to open ports on mini');
    expect(words({ code: 'internal', message: 'x', issues: { refusal: 'not-offered' } })).toBe('mini runs a version of MAWS that can’t forward ports');
    expect(words({ code: 'internal', message: 'x', issues: { refusal: 'step-up-cancelled' } })).toBe('Opening the port was cancelled');
    expect(words({ code: 'timeout', message: 'Waiting for mini to confirm' })).toBe('Waiting for mini to confirm');
    expect(words({ code: 'internal', message: 'something else' })).toBe('something else');
  });
});

describe('the kept forwards', () => {
  it('outlive a reload of the page through its session storage', async () => {
    const fake = fakeClient({ 'browser.tabs.open': { tab: browserTab(T1, R), reused: false } });
    const done = openForward(fake.client, R, 'http://localhost:5173/', FORWARD);
    await fake.reply('remote.forward.open', { localPort: 54321 });
    await done;
    vi.resetModules();
    const reloaded = await import('./forward');
    expect(reloaded.forwardMarkOf('http://127.0.0.1:54321/', reloaded.forwards.getState().ports)).toEqual(FORWARD);
  });
});
