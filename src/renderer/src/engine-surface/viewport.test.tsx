import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { registerSlot, resetSlots } from '../app/slots';
import { PluginBand } from '../composer/frame/PluginSites';
import { SessionPane } from '../session/SessionPane';
import { useSessions } from '../stores/sessions';
import { resetSurfaceRegistry } from './registry';
import { SurfaceRow } from './SurfaceRow';
import { A, resetPanelStores, TestHost } from '../test-support/panel';
import { connectPluginPanes, resetPaneRosters } from './panes';

const ID = 'fx1-viewport' as AppSessionId;
let fake: FakeClient;
let width = 600;
let height = 360;
const observers = new Set<() => void>();
const frames = new Map<number, FrameRequestCallback>();
let serial = 0;
const resize = () => act(() => { for (const callback of observers) callback(); });
const frame = () => act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); });
const asks = () => fake.invoked('session.ui.render') as { component: string; viewport?: unknown }[];
beforeEach(() => {
  resetSurfaceRegistry();
  resetPanelStores();
  resetPaneRosters();
  width = 600; height = 360; frames.clear(); observers.clear();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { observers.add(callback); }
    observe() {}
    disconnect() { observers.delete(this.callback); }
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.style.width === '1ch' ? 10 : width, height: this.style.width === '1ch' ? 18 : height } as DOMRect;
  });
  fake = fakeClient({ 'session.ui.render': { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: true }, 'session.ui.panes': { panes: [{ id: 'pane', title: 'Pane', plugin: 'mod', closeOnEscape: false, holdToasts: false, rows: null, columns: null }], shownId: 'pane', focusedId: null, focusRequestedId: null } });
  window.maws = fake.client;
});
afterEach(() => { cleanup(); resetSlots(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('supplies the session envelope to transcript and band asks, coalescing burst resizes to whole cells', async () => {
  useSessions.setState({ records: new Map([[ID, record(ID)]]), engine: new Map([[ID, { ...status(ID), uiSurface: { clientId: 'maws-main' } }]]) });
  registerSlot('transcript', () => <SurfaceRow appSessionId={ID} component="AssistantMessage" instanceId="message" props={{ text: 'native', isFirstOfReply: true }} client={fake.client}>{() => <p>native</p>}</SurfaceRow>);
  registerSlot('composer', () => <PluginBand appSessionId={ID} working={false} />);
  render(<SessionPane appSessionId={ID} paneIndex={0} />);
  await act(async () => {});
  resize(); await frame();
  for (const component of ['AssistantMessage', 'AbovePrompt']) expect(asks().filter((ask) => ask.component === component).at(-1)?.viewport).toEqual({ columns: 60, rows: 20, isFullscreen: true });
  const before = asks().length;
  width = 700; resize(); width = 800; resize(); height = 540; resize();
  expect(asks()).toHaveLength(before);
  await frame();
  expect(asks()).toHaveLength(before + 2);
  expect(asks().slice(-2).map((ask) => ask.viewport)).toEqual([{ columns: 80, rows: 30, isFullscreen: true }, { columns: 80, rows: 30, isFullscreen: true }]);
  width = 809; resize(); await frame();
  expect(asks()).toHaveLength(before + 2);
});

it('passes the measured docked pane viewport, not merely bodyColumns props', async () => {
  const disconnect = connectPluginPanes(fake.client);
  try {
    render(<TestHost />);
    await act(async () => useSessions.getState().applyStatus({ appSessionId: A, status: { ...status(A), uiSurface: { clientId: 'maws-main' } } }));
    resize(); await frame();
    expect(asks().filter((ask) => ask.component === 'Pane').at(-1)?.viewport).toEqual({ columns: 60, rows: 20, isFullscreen: true });
  } finally { disconnect(); }
});
