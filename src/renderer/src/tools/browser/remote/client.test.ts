// P5 O17 M10: one window's viewer of the agent's tabs on another machine's session, over main's bridge
// (`browser.remote.*`, Interfaces §K): the view opened for the session's address and closed at the end; this viewer's
// own choice of tab, followed across the machine's epochs; each frame acknowledged only once drawn or dropped (held
// while nothing draws it, so a hidden canvas costs the producer one frame); a closed stream resumed or waited out by its
// word; control taken only at the person's gesture and only while it stands; input in order with moves coalesced.
import { describe, expect, it, vi } from 'vitest';
import type { BrowserFrame, BrowserInventory } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../../../test/support/machine';
import { RemoteBrowserClient } from './client';

const R = addressOf(OTHER_MACHINE, 'app-r') as AppSessionId;
const tab = (tabId: string, title = tabId) => ({ tabId, title, url: `http://127.0.0.1:3000/${tabId}`, control: 'agent' as const });
const ready = (epoch: string, tabs: ReturnType<typeof tab>[], selected: string | null = null): BrowserInventory => ({ epoch, tabs, selected, state: 'ready' });
const frame = (seq: number, tabId = 't1', epoch = 'e1'): BrowserFrame => ({ epoch, tabId, seq, capturedAt: seq, width: 4, height: 2, viewport: { width: 8, height: 4 }, jpeg: new Uint8Array([1, 2, 3]) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const move = (x: number) => ({ kind: 'pointer' as const, type: 'move' as const, x, y: 1, button: 'left' as const, buttons: 0, clickCount: 0, modifiers: [] });
const click = { kind: 'pointer' as const, type: 'down' as const, x: 2, y: 2, button: 'left' as const, buttons: 1, clickCount: 1, modifiers: [] };

async function opened(inventory: BrowserInventory = ready('e1', [tab('t1'), tab('t2')], 't2')) {
  const fake = fakeClient({ 'browser.remote.select': undefined, 'browser.remote.ack': undefined, 'browser.remote.close': undefined, 'browser.remote.releaseControl': undefined });
  const client = new RemoteBrowserClient(R, fake.client);
  client.open();
  await fake.reply('browser.remote.open', { viewId: 'rv-1', inventory, view: { kind: 'live' } });
  const drawn: number[] = [];
  const draw = async (f: BrowserFrame) => void drawn.push(f.seq);
  const inventoryEvent = (next: BrowserInventory, kind: 'live' | 'lost' | 'connecting' = next.state === 'ready' ? 'live' : 'connecting', viewId = 'rv-1') => fake.event('browser.remote.inventory', { viewId, inventory: next, view: { kind } });
  const frameEvent = (f: BrowserFrame, viewId = 'rv-1') => fake.event('browser.remote.frame', { viewId, frame: f });
  const closedEvent = (reason: string, viewId = 'rv-1') => fake.event('browser.remote.closed', { viewId, reason });
  return { fake, client, drawn, draw, inventoryEvent, frameEvent, closedEvent };
}

describe('the remote view’s life', () => {
  it('opens for the session’s address, takes the answer and only its own view’s events, and closes at the end', async () => {
    const { fake, client, inventoryEvent } = await opened();
    expect(fake.invoked('browser.remote.open')).toEqual([{ appSessionId: R }]);
    expect(client.getState()).toMatchObject({ viewId: 'rv-1', view: { kind: 'live' }, inventory: { epoch: 'e1' } });
    inventoryEvent(ready('e9', []), 'live', 'rv-other');
    expect(client.getState().inventory?.epoch, 'another view’s inventory is not this one’s').toBe('e1');
    inventoryEvent({ epoch: 'e1', tabs: [], selected: null, state: 'unavailable', reason: 'the render service is unavailable on B: gone' }, 'connecting');
    expect(client.getState().view).toEqual({ kind: 'connecting' });
    client.close();
    expect(fake.invoked('browser.remote.close')).toEqual([{ viewId: 'rv-1' }]);
  });

  it('closes a view whose open answers after the window let it go', async () => {
    const fake = fakeClient({ 'browser.remote.close': undefined });
    const client = new RemoteBrowserClient(R, fake.client);
    client.open();
    client.close();
    await fake.reply('browser.remote.open', { viewId: 'rv-late', inventory: ready('e1', []), view: { kind: 'live' } });
    expect(fake.invoked('browser.remote.close')).toEqual([{ viewId: 'rv-late' }]);
    expect(client.getState().viewId).toBeNull();
  });

  it('reads a refused open as a view that ended, and opens anew at reopen', async () => {
    const fake = fakeClient({ 'browser.remote.close': undefined });
    const client = new RemoteBrowserClient(R, fake.client);
    client.open();
    await fake.fail('browser.remote.open', 'no', 'invalid_input');
    expect(client.getState().view).toEqual({ kind: 'ended', end: 'failed' });
    client.reopen();
    await fake.reply('browser.remote.open', { viewId: 'rv-2', inventory: ready('e1', []), view: { kind: 'live' } });
    expect(fake.invoked('browser.remote.open')).toHaveLength(2);
    expect(client.getState()).toMatchObject({ viewId: 'rv-2', view: { kind: 'live' } });
  });
});

describe('this viewer’s tab', () => {
  it('shows the agent’s own selected tab by default, and the tab the person picks, with the inventory’s epoch', async () => {
    const { fake, client } = await opened();
    client.showAgent();
    expect(fake.invoked('browser.remote.select')).toEqual([{ viewId: 'rv-1', epoch: 'e1', tabId: 't2' }]);
    client.show('t1');
    expect(fake.invoked('browser.remote.select')[1]).toEqual({ viewId: 'rv-1', epoch: 'e1', tabId: 't1' });
    client.show('t1');
    expect(fake.invoked('browser.remote.select'), 'the tab it shows goes on as it is').toHaveLength(2);
    expect(client.getState()).toMatchObject({ showing: true, shown: { tabId: 't1', epoch: 'e1' }, stream: 'opening' });
    client.hide();
    expect(client.getState().showing).toBe(false);
  });

  it('follows its tab into a new epoch, else moves to the agent’s selection there, and lets control go with the old epoch', async () => {
    const { fake, client, inventoryEvent } = await opened();
    client.show('t1');
    fake.event('browser.remote.inventory', { viewId: 'rv-1', inventory: ready('e2', [tab('t1')]), view: { kind: 'live' } });
    expect(fake.invoked('browser.remote.select').at(-1)).toEqual({ viewId: 'rv-1', epoch: 'e2', tabId: 't1' });
    inventoryEvent(ready('e3', [tab('a1'), tab('a2')], 'a2')); // the app took over: other tabs
    expect(fake.invoked('browser.remote.select').at(-1)).toEqual({ viewId: 'rv-1', epoch: 'e3', tabId: 'a2' });
    inventoryEvent(ready('e3', [tab('a1')])); // the shown tab closed
    expect(fake.invoked('browser.remote.select').at(-1)).toEqual({ viewId: 'rv-1', epoch: 'e3', tabId: 'a1' });
    inventoryEvent(ready('e3', []));
    expect(client.getState()).toMatchObject({ showing: true, shown: null, stream: 'none' });
    const selects = fake.invoked('browser.remote.select').length;
    inventoryEvent(ready('e3', [tab('a9')]));
    expect(fake.invoked('browser.remote.select'), 'a tab appearing while the agent’s browser is shown is shown').toHaveLength(selects + 1);
  });
});

describe('frames', () => {
  it('draws a frame and only then acknowledges it', async () => {
    const { fake, client, draw, drawn, frameEvent } = await opened();
    client.setDrawer(draw);
    client.show('t1');
    frameEvent(frame(1));
    await settle();
    expect(drawn).toEqual([1]);
    expect(fake.invoked('browser.remote.ack')).toEqual([{ viewId: 'rv-1', seq: 1 }]);
    expect(client.getState()).toMatchObject({ stream: 'live', frame: { seq: 1, tabId: 't1', width: 4, height: 2, viewport: { width: 8, height: 4 } } });
  });

  it('holds a frame while nothing draws it, so the producer waits on one frame, and draws it when the canvas comes', async () => {
    const { fake, client, draw, drawn, frameEvent } = await opened();
    client.show('t1');
    frameEvent(frame(1));
    await settle();
    expect(fake.invoked('browser.remote.ack'), 'not acknowledged: the producer sends nothing more').toEqual([]);
    client.setDrawer(draw);
    await settle();
    expect(drawn).toEqual([1]);
    expect(fake.invoked('browser.remote.ack')).toEqual([{ viewId: 'rv-1', seq: 1 }]);
  });

  it('drops (and acknowledges) a frame of another tab or epoch, and one that would not draw', async () => {
    const { fake, client, drawn, frameEvent } = await opened();
    client.setDrawer(async (f) => {
      if (f.seq === 3) throw new Error('not a JPEG');
      drawn.push(f.seq);
    });
    client.show('t1');
    frameEvent(frame(1, 't2'));
    frameEvent(frame(2, 't1', 'e0'));
    frameEvent(frame(3));
    frameEvent(frame(4), 'rv-other');
    await settle();
    expect(drawn).toEqual([]);
    expect(fake.invoked('browser.remote.ack')).toEqual([{ viewId: 'rv-1', seq: 1 }, { viewId: 'rv-1', seq: 2 }, { viewId: 'rv-1', seq: 3 }]);
  });
});

describe('a closed stream', () => {
  it('opens its tab again at a word that may pass, at most three times with no frame between, then stops for the person’s retry', async () => {
    const { fake, client, closedEvent, draw, frameEvent } = await opened();
    client.setDrawer(draw);
    client.show('t1');
    await settle();
    const selects = () => fake.invoked('browser.remote.select').length;
    for (let n = 2; n <= 4; n += 1) {
      closedEvent('producer-failed');
      expect(selects()).toBe(n);
      await settle();
    }
    closedEvent('producer-failed');
    expect(selects()).toBe(4);
    expect(client.getState().stream).toBe('stopped');
    client.retry();
    expect(selects()).toBe(5);
    frameEvent(frame(1));
    await settle();
    closedEvent('behind');
    expect(selects(), 'a drawn frame starts the count again').toBe(6);
  });

  it('waits for the inventory at a closed tab, an engine change or the carrier’s loss, and resumes once the view is live', async () => {
    const { fake, client, closedEvent, inventoryEvent } = await opened();
    client.show('t1');
    await settle();
    closedEvent('carrier');
    expect(client.getState().stream).toBe('waiting');
    inventoryEvent({ ...ready('e1', [tab('t1')]), state: 'unavailable', reason: 'the connection to B was lost' }, 'lost');
    expect(fake.invoked('browser.remote.select')).toHaveLength(1);
    inventoryEvent(ready('e1', [tab('t1')]));
    expect(fake.invoked('browser.remote.select')).toHaveLength(2);
    await settle();
    closedEvent('engine-changed');
    expect(client.getState().stream).toBe('waiting');
    inventoryEvent(ready('e2', [tab('x1')]));
    expect(fake.invoked('browser.remote.select').at(-1)).toEqual({ viewId: 'rv-1', epoch: 'e2', tabId: 'x1' });
  });

  it('opens a waiting stream again when the person picks its tab, as at Retry', async () => {
    const { fake, client, closedEvent } = await opened();
    client.show('t1');
    await settle();
    closedEvent('tab-closed');
    expect(client.getState().stream).toBe('waiting');
    client.show('t1');
    expect(fake.invoked('browser.remote.select')).toHaveLength(2);
    expect(client.getState().stream).toBe('opening');
  });

  it('forgets a close heard during a select that failed, so the next select’s answer reads no old close', async () => {
    const fake = fakeClient({ 'browser.remote.ack': undefined });
    const client = new RemoteBrowserClient(R, fake.client);
    client.open();
    await fake.reply('browser.remote.open', { viewId: 'rv-1', inventory: ready('e1', [tab('t1')]), view: { kind: 'live' } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    client.show('t1');
    fake.event('browser.remote.closed', { viewId: 'rv-1', reason: 'engine-changed' });
    await fake.fail('browser.remote.select', 'the view’s tab is gone');
    expect(client.getState().stream).toBe('stopped');
    client.retry();
    await fake.reply('browser.remote.select', undefined);
    expect(client.getState().stream, 'the failed select’s close is not this one’s').toBe('opening');
    vi.restoreAllMocks();
  });

  it('lets a select or a draw of the view before a reopen touch nothing of the new one', async () => {
    const fake = fakeClient({ 'browser.remote.close': undefined, 'browser.remote.ack': undefined });
    const client = new RemoteBrowserClient(R, fake.client);
    client.open();
    await fake.reply('browser.remote.open', { viewId: 'rv-1', inventory: ready('e1', [tab('t1')]), view: { kind: 'live' } });
    let finish = () => {};
    client.setDrawer(() => new Promise<void>((resolve) => (finish = resolve)));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    client.show('t1');
    await fake.reply('browser.remote.select', undefined);
    fake.event('browser.remote.frame', { viewId: 'rv-1', frame: frame(7) }); // drawing
    client.retry(); // a select on its way
    client.reopen();
    await fake.reply('browser.remote.open', { viewId: 'rv-2', inventory: ready('e1', [tab('t1')]), view: { kind: 'connecting' } });
    finish();
    await fake.fail('browser.remote.select', 'view rv-1 has ended');
    expect(fake.invoked('browser.remote.ack'), 'the old view’s frame is acknowledged to no other view').not.toContainEqual({ viewId: 'rv-2', seq: 7 });
    expect(client.getState(), 'the old select’s failure stops nothing of the new view').toMatchObject({ viewId: 'rv-2', stream: 'none', frame: null });
    vi.restoreAllMocks();
  });

  it('reads a close that reaches it while its own select is on its way once that select is answered (the close may be of the stream it replaced, or of the one it opened), and a frame after it as live', async () => {
    const fake = fakeClient({ 'browser.remote.ack': undefined });
    const client = new RemoteBrowserClient(R, fake.client);
    client.open();
    await fake.reply('browser.remote.open', { viewId: 'rv-1', inventory: ready('e1', [tab('t1')]), view: { kind: 'live' } });
    client.setDrawer(async () => {});
    client.show('t1');
    fake.event('browser.remote.closed', { viewId: 'rv-1', reason: 'engine-changed' });
    expect(client.getState().stream).toBe('opening');
    await fake.reply('browser.remote.select', undefined);
    expect(client.getState().stream).toBe('waiting');
    fake.event('browser.remote.frame', { viewId: 'rv-1', frame: frame(1) });
    await settle();
    expect(client.getState().stream, 'the stream it opened is live after all').toBe('live');
  });
});

describe('control and input', () => {
  it('takes control only at the person’s gesture, sends input in order with moves coalesced, and gives it back', async () => {
    const { fake, client } = await opened();
    client.show('t1');
    client.input(click);
    expect(fake.invoked('browser.remote.input'), 'no input before control').toEqual([]);
    const taking = client.takeControl();
    expect(client.getState().control).toBe('taking');
    await fake.reply('browser.remote.takeControl', { control: true });
    await taking;
    expect(client.getState().control).toBe('held');
    client.input(move(1));
    client.input(move(2)); // the first move still on its way: kept, the newest only
    client.input(move(3));
    expect(fake.invoked('browser.remote.input')).toEqual([{ viewId: 'rv-1', seq: 1, event: move(1) }]);
    client.input(click); // a press sends the move it follows first
    expect(fake.invoked('browser.remote.input').slice(1)).toEqual([
      { viewId: 'rv-1', seq: 2, event: move(3) },
      { viewId: 'rv-1', seq: 3, event: click },
    ]);
    await fake.reply('browser.remote.input', undefined);
    client.input(move(4));
    expect(fake.invoked('browser.remote.input')).toHaveLength(4);
    client.releaseControl();
    expect(fake.invoked('browser.remote.releaseControl')).toEqual([{ viewId: 'rv-1' }]);
    expect(client.getState().control).toBe('none');
  });

  it('says why control was not taken', async () => {
    const { fake, client } = await opened();
    client.show('t1');
    const taking = client.takeControl();
    await fake.reply('browser.remote.takeControl', { control: false, reason: 'expired' });
    await taking;
    expect(client.getState()).toMatchObject({ control: 'none', notice: { kind: 'refused', reason: 'expired' } });
  });

  it('loses control at a revocation and goes on read-only; at a refused controlling reopen it gives control back', async () => {
    const { fake, client, closedEvent } = await opened();
    client.show('t1');
    const taking = client.takeControl();
    await fake.reply('browser.remote.takeControl', { control: true });
    await taking;
    await settle();
    closedEvent('control-revoked');
    expect(client.getState()).toMatchObject({ control: 'none', notice: { kind: 'revoked' } });
    expect(fake.invoked('browser.remote.select'), 'opened again, read-only').toHaveLength(2);
    expect(fake.invoked('browser.remote.releaseControl')).toEqual([]);
    const again = client.takeControl();
    await fake.reply('browser.remote.takeControl', { control: true });
    await again;
    await settle();
    closedEvent('control-busy');
    expect(fake.invoked('browser.remote.releaseControl')).toEqual([{ viewId: 'rv-1' }]);
    expect(client.getState()).toMatchObject({ control: 'none', notice: { kind: 'refused', reason: 'control-busy' } });
  });

  it('sends a paste as text within the input queue, and refuses one past it with a notice', async () => {
    const { fake, client } = await opened();
    client.show('t1');
    const taking = client.takeControl();
    await fake.reply('browser.remote.takeControl', { control: true });
    await taking;
    client.paste('a'.repeat(16_384 * 2 + 1));
    expect(fake.invoked('browser.remote.input').map((call) => (call as { event: { text: string } }).event.text.length)).toEqual([16_384, 16_384, 1]);
    client.paste('a'.repeat(16_384 * 16 + 1));
    expect(fake.invoked('browser.remote.input'), 'nothing of a paste past the queue').toHaveLength(3);
    expect(client.getState().notice).toEqual({ kind: 'paste-too-long', kb: 256 });
  });

  it('logs an input the bridge refused', async () => {
    const { fake, client } = await opened();
    client.show('t1');
    const taking = client.takeControl();
    await fake.reply('browser.remote.takeControl', { control: true });
    await taking;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    client.input(click);
    await fake.fail('browser.remote.input', 'view rv-1 does not control its tab', 'invalid_input');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('view rv-1 does not control its tab'));
    vi.restoreAllMocks();
  });

  it('lets control go when the machine’s epoch moves (the grant died with it)', async () => {
    const { fake, client, inventoryEvent } = await opened();
    client.show('t1');
    const taking = client.takeControl();
    await fake.reply('browser.remote.takeControl', { control: true });
    await taking;
    inventoryEvent(ready('e2', [tab('t1')]));
    expect(client.getState().control).toBe('none');
  });
});
