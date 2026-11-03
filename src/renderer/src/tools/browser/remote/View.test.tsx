// P5 O17 M10 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M10; the Decision Log's "the remote Browser view's
// shape"): the Browser tool on another machine's session. The agent's tabs there are a group after the person's own in
// the one strip; one of them shown is its live picture with a labelled focus target; Take control is the person's
// gesture, and only then do pointer and keys reach the page, mapped through the fitted image; every state is worded from
// main's view kind; the view lives while the tool is shown and open.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserInventory } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { RemoteViewState } from '@shared/ipc/schema/browser';
import { addressOf } from '@shared/machine/address';
import { at, OTHER_MACHINE } from '../../../../../../test/support/machine';
import { useMachines } from '../../../stores/machines';
import { browserTab, T1, T2, T3 } from '../../../test-support/browser';
import { installFakeMain, ok } from '../../../test-support/code';
import { BROWSER_COPY } from '../copy';
import { connectBrowser, resetBrowser } from '../store';
import { BrowserView } from '../View';
import { remoteStatus } from './View';

const C = BROWSER_COPY.remote;
const BARE = 'app-r' as AppSessionId;
const R = addressOf(OTHER_MACHINE, BARE) as AppSessionId;
const summary = (tabId: string, title: string, control: 'idle' | 'agent' | 'human' = 'agent') => ({ tabId, title, url: `http://127.0.0.1:5173/${title}`, control });
const ready = (epoch: string, tabs: ReturnType<typeof summary>[], selected: string | null = null): BrowserInventory => ({ epoch, tabs, selected, state: 'ready' });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

let main: ReturnType<typeof installFakeMain>;
let opened: { inventory: BrowserInventory; view: RemoteViewState };
let localTabs: ReturnType<typeof browserTab>[];
let take: { control: boolean; reason?: string };

beforeEach(() => {
  resetBrowser();
  opened = { inventory: ready('e1', [summary(T1, 'dev server'), summary(T2, 'docs')], T1), view: { kind: 'live' } };
  localTabs = [];
  take = { control: true };
  main = installFakeMain((name) => {
    if (name === 'browser.tabs.list') return ok({ tabs: localTabs, selected: { [BARE]: localTabs[0]?.tabId ?? null } });
    if (name === 'browser.remote.open') return ok({ viewId: 'rv-1', ...opened });
    if (name === 'browser.remote.takeControl') return ok(take);
    if (name === 'session.capabilities') return ok({ browser: { available: false, reason: 'the MAWS on studio predates the agent’s browser' } });
    return ok();
  });
  act(() => useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'studio', local: false, state: 'up', since: '2026-11-03T00:00:00.000Z', generation: 1 }]));
  // happy-dom draws nothing: a canvas with a 2d context that takes the image, a decoder that yields one, a laid-out box
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1280, height: 800, close() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, clearRect() {} } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON() {} } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

const frameOf = (seq: number, tabId = T1, epoch = 'e1') => ({ viewId: 'rv-1', frame: { epoch, tabId, seq, capturedAt: seq, width: 1280, height: 800, viewport: { width: 1280, height: 800 }, jpeg: new Uint8Array([0xff, 0xd8, 0xff]) } });
const surfaceOf = () => document.querySelector<HTMLElement>('[data-remote-browser]');
const focusTarget = () => screen.getByRole('textbox', { name: /The agent’s page on studio/ });
const sentInputs = () => main.callsOf('browser.remote.input').map((call) => call.event);
const sentTexts = () => sentInputs().filter((event) => event.kind === 'text');
// happy-dom's CompositionEvent and InputEvent carry no data: the fields a real one has, set on a plain event
function dispatch(target: HTMLElement, type: 'compositionend' | 'input', fields: Record<string, unknown>) {
  const event = new Event(type, { bubbles: true });
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
  act(() => void target.dispatchEvent(event));
}
async function controlled() {
  await shown();
  act(() => main.emit('browser.remote.frame', frameOf(1)));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: C.takeControl }));
  await settle();
  act(() => focusTarget().focus());
}

async function shown() {
  render(<BrowserView appSessionId={R} surface="panel" />);
  await settle();
  await settle();
}

describe('the agent’s tabs on another machine’s session', () => {
  it('lists them as a group after the person’s own, and shows the agent’s own tab when the person has none of theirs shown', async () => {
    await shown();
    expect(main.callsOf('browser.remote.open')).toEqual([{ appSessionId: BARE }]);
    const group = screen.getByRole('group', { name: C.group('studio') });
    expect(within(group).getByRole('tab', { name: /dev server/ }).getAttribute('aria-selected')).toBe('true');
    expect(within(group).getByRole('tab', { name: /docs/ })).toBeTruthy();
    expect(main.callsOf('browser.remote.select')).toEqual([{ viewId: 'rv-1', epoch: 'e1', tabId: T1 }]);
    expect(surfaceOf()).not.toBeNull();
    expect(document.querySelector('[data-browser-pane]'), 'the picture in place of the pane').toBeNull();
    expect(screen.getByText('http://127.0.0.1:5173/dev server')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: BROWSER_COPY.address }), 'no address field, find or comments on a screencast tab').toBeNull();
    expect(document.querySelector('[data-browser-agent-unavailable]'), 'the view’s states, not the capability’s notice').toBeNull();
  });

  it('keeps the person’s own tab when one is shown, and shows the agent’s tab picked from the group; a chip of the person’s goes back', async () => {
    localTabs = [browserTab(T3, BARE, { title: 'Mine' })];
    await shown();
    expect(document.querySelector('[data-browser-pane]'), 'the person’s tab').not.toBeNull();
    expect(main.callsOf('browser.remote.select')).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: /docs/ }));
    await settle();
    expect(main.callsOf('browser.remote.select')).toEqual([{ viewId: 'rv-1', epoch: 'e1', tabId: T2 }]);
    expect(surfaceOf()?.dataset.remoteTab).toBe(T2);
    fireEvent.click(screen.getByRole('tab', { name: /Mine/ }));
    await settle();
    expect(surfaceOf()).toBeNull();
    expect(document.querySelector('[data-browser-pane]')).not.toBeNull();
  });

  it('shows the person’s tab when a new one of theirs is selected (a forwarded link, the agent’s show_pane), after an agent tab was picked', async () => {
    const disconnect = connectBrowser();
    await shown();
    fireEvent.click(screen.getByRole('tab', { name: /docs/ }));
    await settle();
    expect(surfaceOf()?.dataset.remoteTab).toBe(T2);
    act(() => main.emit('browser.tabs.changed', { appSessionId: BARE, tabs: [browserTab(T3, BARE, { title: 'Forwarded' })], selected: T3 }, OTHER_MACHINE));
    await settle();
    disconnect();
    expect(surfaceOf(), 'the agent’s picture gives way').toBeNull();
    expect(document.querySelector('[data-browser-pane]')).not.toBeNull();
    expect(screen.getByRole('tab', { name: /Forwarded/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps both groups in reach of the keyboard: a tab stop in each, and arrow keys along the agent’s', async () => {
    localTabs = [browserTab(T3, BARE, { title: 'Mine' })];
    await shown();
    const agentTab = (name: RegExp) => within(screen.getByRole('group', { name: C.group('studio') })).getByRole('tab', { name });
    expect(agentTab(/dev server/).tabIndex, 'nothing of the agent’s shown: its first chip is the group’s stop').toBe(0);
    expect(agentTab(/docs/).tabIndex).toBe(-1);
    fireEvent.click(agentTab(/docs/));
    await settle();
    expect(screen.getByRole('tab', { name: /Mine/ }).tabIndex, 'none of the person’s shown: their first chip is their stop').toBe(0);
    expect(agentTab(/docs/).tabIndex).toBe(0);
    act(() => agentTab(/docs/).focus());
    fireEvent.keyDown(agentTab(/docs/), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(agentTab(/dev server/));
    fireEvent.keyDown(agentTab(/dev server/), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(agentTab(/docs/));
  });

  it('draws each frame and only then acknowledges it', async () => {
    await shown();
    act(() => main.emit('browser.remote.frame', frameOf(1)));
    await settle();
    expect(main.callsOf('browser.remote.ack')).toEqual([{ viewId: 'rv-1', seq: 1 }]);
    expect(surfaceOf()?.dataset).toMatchObject({ remoteStream: 'live', remoteSeq: '1', remoteViewport: '1280x800' });
    expect(document.querySelector('[data-remote-overlay]'), 'a live picture has nothing over it').toBeNull();
  });

  it('dims a picture that is no longer live under what is wrong, never showing it as live', async () => {
    await shown();
    act(() => main.emit('browser.remote.frame', frameOf(1)));
    await settle();
    act(() => main.emit('browser.remote.inventory', { viewId: 'rv-1', inventory: { ...opened.inventory, state: 'unavailable', reason: 'the connection to studio was lost' }, view: { kind: 'lost' } }));
    await settle();
    expect(screen.getAllByText(C.lost).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-remote-browser] canvas')?.className).toContain('opacity-40');
  });

  it('words a stream that closed with its tab from the view’s kind, with Retry, and an opening one as loading', async () => {
    await shown();
    act(() => main.emit('browser.remote.frame', frameOf(1)));
    await settle();
    act(() => main.emit('browser.remote.closed', { viewId: 'rv-1', reason: 'tab-closed' }));
    expect(within(surfaceOf()!).getByRole('status').textContent).toContain(C.waiting);
    expect(screen.queryByText(C.lost), 'the connection is not lost').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: C.retry }));
    await settle();
    expect(main.callsOf('browser.remote.select')).toHaveLength(2);
    expect(within(surfaceOf()!).getByRole('status').textContent, 'the kept picture, dimmed, says it is opening').toContain(C.loading);
  });

  it('takes control only at the person’s gesture; then a click inside the image reaches the page at the viewport’s point, and keys and text go once', async () => {
    await shown();
    act(() => main.emit('browser.remote.frame', frameOf(1)));
    await settle();
    expect(screen.getByText(C.viewOnly)).toBeTruthy();
    fireEvent.pointerDown(surfaceOf()!, { button: 0, buttons: 1, clientX: 200, clientY: 200, pointerId: 1 });
    expect(main.callsOf('browser.remote.input'), 'view only: nothing reaches the page').toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: C.takeControl }));
    await settle();
    expect(main.callsOf('browser.remote.takeControl')).toEqual([{ viewId: 'rv-1' }]);
    expect(screen.getByText(C.youControl)).toBeTruthy();
    expect(screen.getByRole('button', { name: C.giveBack })).toBeTruthy();
    // 1280×800 fitted in 400×400: the image is 400×250 from y 75; (200, 200) is the viewport's (640, 400)
    fireEvent.pointerDown(surfaceOf()!, { button: 0, buttons: 1, clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(surfaceOf()!, { button: 0, buttons: 0, clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerDown(surfaceOf()!, { button: 0, buttons: 1, clientX: 200, clientY: 20, pointerId: 1 }); // the letterbox
    const sent = () => main.callsOf('browser.remote.input').map((call) => call.event);
    expect(sent()).toEqual([
      { kind: 'pointer', type: 'down', x: 640, y: 400, button: 'left', buttons: 1, clickCount: 1, modifiers: [] },
      { kind: 'pointer', type: 'up', x: 640, y: 400, button: 'left', buttons: 0, clickCount: 1, modifiers: [] },
    ]);
    expect(document.activeElement, 'the labelled focus target has the keyboard').toBe(focusTarget());
    fireEvent.keyDown(focusTarget(), { key: 'q', code: 'KeyQ' });
    fireEvent.keyUp(focusTarget(), { key: 'q', code: 'KeyQ' });
    fireEvent.keyDown(focusTarget(), { key: 'w', code: 'KeyW', metaKey: true }); // the app's
    const committed = new Event('compositionend', { bubbles: true }); // happy-dom's CompositionEvent carries no data
    Object.defineProperty(committed, 'data', { value: '한' });
    act(() => void focusTarget().dispatchEvent(committed));
    expect(sent().slice(2)).toEqual([
      { kind: 'key', type: 'down', key: 'q', code: 'KeyQ', repeat: false, modifiers: [] },
      { kind: 'text', text: 'q' },
      { kind: 'key', type: 'up', key: 'q', code: 'KeyQ', repeat: false, modifiers: [] },
      { kind: 'text', text: '한' },
    ]);
    const seqs = main.callsOf('browser.remote.input').map((call) => call.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    fireEvent.keyDown(focusTarget(), { key: 'Escape', code: 'Escape' });
    expect(document.activeElement, 'Escape gives the keyboard back').not.toBe(focusTarget());
    expect(sent().at(-1)).toEqual({ kind: 'blur' });
    fireEvent.click(screen.getByRole('button', { name: C.giveBack }));
    expect(main.callsOf('browser.remote.releaseControl')).toEqual([{ viewId: 'rv-1' }]);
    expect(screen.getByText(C.viewOnly)).toBeTruthy();
  });

  it('says why control was not taken, a machine’s word in words and main’s sentence as it is', async () => {
    const said = async (reason: string) => {
      take = { control: false, reason };
      fireEvent.click(screen.getByRole('button', { name: C.takeControl }));
      await settle();
      const notice = document.querySelector('[data-remote-control-notice]')?.textContent ?? '';
      fireEvent.click(screen.getByRole('button', { name: BROWSER_COPY.dismiss }));
      return notice;
    };
    await shown();
    expect(await said('control-busy')).toContain(C.controlRefused.busy);
    expect(await said('grade')).toContain(C.controlRefused.noRight('studio'));
    expect(await said('read-only')).toContain(C.controlRefused.viewOnly('studio'));
    expect(await said('expired')).toContain(C.controlRefused.expired);
    expect(await said('producer-failed'), 'any other word of the machine’s').toContain(C.controlRefused.unavailable('studio'));
    expect(await said('studio did not admit control in time')).toContain(C.controlRefused.said('studio did not admit control in time'));
    expect(screen.getByText(C.viewOnly)).toBeTruthy();
  });

  it('types text that reaches the target outside a composition once, whatever brought it', async () => {
    await controlled();
    // the Korean IME: a composing key, its syllable committed, then the word space it inserts outside the composition
    fireEvent.keyDown(focusTarget(), { key: 'Process', code: 'Space', keyCode: 229 });
    dispatch(focusTarget(), 'compositionend', { data: '한' });
    dispatch(focusTarget(), 'input', { data: ' ', isComposing: false, inputType: 'insertText' });
    fireEvent.keyUp(focusTarget(), { key: ' ', code: 'Space', keyCode: 229 });
    expect(sentTexts()).toEqual([
      { kind: 'text', text: '한' },
      { kind: 'text', text: ' ' },
    ]);
    // the Character Viewer: an input with no key at all
    dispatch(focusTarget(), 'input', { data: '😀', isComposing: false, inputType: 'insertText' });
    expect(sentTexts().at(-1)).toEqual({ kind: 'text', text: '😀' });
    // a printable key sent its text at its press: the input that may follow it is not sent again
    fireEvent.keyDown(focusTarget(), { key: 'q', code: 'KeyQ' });
    dispatch(focusTarget(), 'input', { data: 'q', isComposing: false, inputType: 'insertText' });
    fireEvent.keyUp(focusTarget(), { key: 'q', code: 'KeyQ' });
    expect(sentTexts()).toEqual([
      { kind: 'text', text: '한' },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: '😀' },
      { kind: 'text', text: 'q' },
    ]);
    // a composition's own text, which its end sends
    dispatch(focusTarget(), 'input', { data: '글', isComposing: true, inputType: 'insertCompositionText' });
    expect(sentTexts()).toHaveLength(4);
  });

  it('leaves a key an app binding took to the app, and lets a cancelled press go', async () => {
    await controlled();
    const take = (event: KeyboardEvent) => event.key === 'k' && event.ctrlKey && event.preventDefault();
    window.addEventListener('keydown', take, true); // the keymap's dispatcher listens in the capture phase
    fireEvent.keyDown(focusTarget(), { key: 'k', code: 'KeyK', ctrlKey: true });
    window.removeEventListener('keydown', take, true);
    expect(sentInputs().filter((event) => event.kind === 'key')).toEqual([]);
    fireEvent.pointerDown(surfaceOf()!, { button: 0, buttons: 1, clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerCancel(surfaceOf()!, { button: -1, buttons: 0, clientX: 200, clientY: 200, pointerId: 1 });
    expect(sentInputs().filter((event) => event.kind === 'pointer').map((event) => event.type), 'what was pressed is released').toEqual(['down', 'up']);
    expect(sentInputs().at(-1)).toMatchObject({ kind: 'pointer', type: 'up', button: 'left', buttons: 0 });
  });

  it('refuses a paste past the input queue, saying so', async () => {
    await controlled();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'a'.repeat(16_384 * 16 + 1) } });
    act(() => void focusTarget().dispatchEvent(paste));
    expect(sentTexts()).toEqual([]);
    expect(screen.getByText(C.pasteTooLong(256))).toBeTruthy();
  });

  it('collapses the agent’s tabs to a picker in a narrow panel, keeping the picture', async () => {
    await shown();
    const picker = screen.getByRole('combobox', { name: C.pick('studio') });
    expect(picker.className).toContain('@[26rem]:hidden');
    fireEvent.change(picker, { target: { value: T2 } });
    await settle();
    expect(main.callsOf('browser.remote.select').at(-1)).toEqual({ viewId: 'rv-1', epoch: 'e1', tabId: T2 });
  });

  it('closes the view when the tool is let go, and opens none while the panel is collapsed', async () => {
    const { unmount } = render(<BrowserView appSessionId={R} surface="panel" />);
    await settle();
    unmount();
    expect(main.callsOf('browser.remote.close')).toEqual([{ viewId: 'rv-1' }]);
    render(<BrowserView appSessionId={R} surface="panel" visible={false} />);
    await settle();
    expect(main.callsOf('browser.remote.open')).toHaveLength(1);
  });

  it('opens no remote view for this Mac’s own session, nor in a main tab', async () => {
    render(<BrowserView appSessionId={at(BARE)} surface="panel" />);
    render(<BrowserView appSessionId={R} surface="main" />);
    await settle();
    expect(main.callsOf('browser.remote.open')).toEqual([]);
  });

  it('an older MAWS there: the reasoned unsupported state, with its capabilities’ notice', async () => {
    opened = { inventory: { epoch: '-', tabs: [], selected: null, state: 'unavailable', reason: 'the MAWS on studio is too old to show the agent’s browser here' }, view: { kind: 'unsupported' } };
    await shown();
    expect(screen.getByText(C.unsupported('studio'))).toBeTruthy();
    expect(document.querySelector('[data-browser-agent-unavailable]')).not.toBeNull();
  });

  it('a view that ended offers Reconnect, which opens it anew', async () => {
    opened = { inventory: { epoch: '-', tabs: [], selected: null, state: 'unavailable', reason: 'you can no longer view this session on studio' }, view: { kind: 'ended', end: 'removed' } };
    await shown();
    expect(screen.getByText(C.ended.removed)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: C.reconnect }));
    await settle();
    expect(main.callsOf('browser.remote.open')).toHaveLength(2);
  });
});

describe('the view’s words', () => {
  const unavailable = (reason: string): BrowserInventory => ({ epoch: '-', tabs: [], selected: null, state: 'unavailable', reason });
  it('words each kind, the machine’s reason only for its own unavailable reading', () => {
    expect(remoteStatus({ kind: 'live' }, ready('e1', []), 'B')).toBe(C.noTabs);
    expect(remoteStatus({ kind: 'live' }, ready('e1', [summary(T1, 'x')]), 'B')).toBeNull();
    expect(remoteStatus({ kind: 'connecting' }, unavailable('connecting to B'), 'B')).toBe(C.connecting('B'));
    expect(remoteStatus({ kind: 'lost' }, unavailable('the connection to B was lost'), 'B')).toBe(C.lost);
    expect(remoteStatus({ kind: 'unavailable' }, unavailable('the render service is unavailable on B: absent'), 'B')).toBe(C.unavailable('the render service is unavailable on B: absent'));
    expect(remoteStatus({ kind: 'unsupported' }, unavailable('main’s words'), 'B')).toBe(C.unsupported('B'));
    expect(remoteStatus({ kind: 'ended', end: 'class' }, unavailable('main’s words'), 'B')).toBe(C.ended.class);
    expect(remoteStatus({ kind: 'ended', end: 'closed' }, unavailable('main’s words'), 'B')).toBe(C.ended.closed('B'));
    expect(remoteStatus({ kind: 'ended', end: 'no-link' }, unavailable('main’s words'), 'B')).toBe(C.ended.noLink('B'));
    expect(remoteStatus({ kind: 'ended', end: 'failed' }, unavailable('main’s words'), 'B')).toBe(C.ended.failed('B'));
  });
});
