// P2-A M3's resource regression in the renderer (the execution document §6.2 M3 (b) and (c), acceptance 7; G5): with
// 200 indexed sessions, every registered slash widget, Session info, the panel's Plugins summary and the context ring
// mounted on exited sessions start nothing (no `session.acquire`, `session.start` or `session.launch`): not on mount,
// not when a mounted session is released by the memory budget, not on Session info's 30 s refetch, and not across a
// focused switch through 20 exited sessions. One Load now acquires exactly once.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { digest, record } from '../../../../test/support/builders';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { ContextRing } from '../composer/frame/ContextRing';
import { slashWidget, WIDGET_COMMANDS } from '../composer/mentions/widgets';
import { panelHost } from '../panel/host';
import type { PanelToolContext } from '../panel/tool';
import { Plugins } from '../panel/summary/Plugins';
import { resetCatalogStore } from '../stores/catalog';
import { useSessions } from '../stores/sessions';
import { sessionInfoTool } from '../tools/session-info';
import { INFO_REFRESH_MS } from '../tools/session-info/SessionInfoView';
import { registerAllWidgets } from '../widgets';
import { useReadLoads } from '../widgets/read';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
const STARTS = ['session.acquire', 'session.start', 'session.launch'];

let backend: WidgetBackend;
let off: () => void;
let records: SessionRecord[];
const starts = () => backend.calls.filter((c) => STARTS.includes(c.command));

beforeEach(() => {
  const scenario = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
  backend = createWidgetBackend({ root: ROOT, statuses: scenario.engine });
  backend.script('plugins.list', () => ({ plugins: [] }));
  backend.script('marketplaces.list', () => ({ marketplaces: [] }));
  backend.script('session.observedFacts', () => null);
  window.maws = backend.bridge();
  const filler = Array.from({ length: 200 - scenario.sessions.length }, (_, i) => record(`app-idx-${i}`));
  records = [...scenario.sessions, ...filler];
  // every status the app run knows has exited; the rest of the index never ran here
  const exited = new Map<AppSessionId, EngineSessionStatus>(scenario.engine.map((s) => [s.appSessionId, { ...s, process: 'exited', turn: null }]));
  useSessions.setState({ engine: exited, records: new Map(records.map((r) => [r.appId, r])), digests: new Map(records.map((r) => [r.appId, digest(r.appId, { availability: 'resumable' })])) });
  off = registerAllWidgets();
});
afterEach(() => {
  cleanup();
  off();
  resetCatalogStore();
  useSessions.setState({ engine: new Map(), records: new Map(), digests: new Map() });
  useReadLoads.setState({ loads: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
  vi.useRealTimers();
});

const ctxOf = (appSessionId: AppSessionId): PanelToolContext => ({
  appSessionId, session: useSessions.getState().records.get(appSessionId) ?? null, status: null, pinned: false, visible: true, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool,
});

// Every surface that mounts with a session: the slash widgets, Session info (shown, so its reads are enabled), the
// panel's Plugins summary and the composer's context ring.
function Surfaces({ appSessionId }: { appSessionId: AppSessionId }): ReactNode {
  const Info = sessionInfoTool.render;
  return (
    <>
      {WIDGET_COMMANDS.map(({ name }) => {
        const Widget = slashWidget(name)!.component;
        return <Widget key={name} appSessionId={appSessionId} args="" close={() => {}} />;
      })}
      <Info state={sessionInfoTool.createState({ appSessionId, session: ctxOf(appSessionId).session, instanceId: `session-info:${appSessionId}`, params: undefined })} ctx={ctxOf(appSessionId)} />
      <Plugins appSessionId={appSessionId} />
      <ContextRing appSessionId={appSessionId} />
    </>
  );
}
const mount = (appSessionId: AppSessionId) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (id: AppSessionId) => (
    <QueryClientProvider client={client}>
      <Surfaces key={id} appSessionId={id} />
    </QueryClientProvider>
  );
  const view = render(ui(appSessionId));
  return { switchTo: (id: AppSessionId) => view.rerender(ui(id)) };
};
const settle = (ms = 20) => act(async () => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe('mounted surfaces on exited sessions start nothing (G5)', () => {
  it('every widget, Session info, the Plugins summary and the ring mounted on an exited session: zero starts; one Load now: one acquisition', async () => {
    mount(ID);
    await settle();
    expect(starts()).toEqual([]);
    expect(screen.getAllByRole('button', { name: 'Load now' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Load now' })[0]);
    await settle();
    expect(starts().map((c) => [c.command, (c.input as { reason?: string }).reason])).toEqual([['session.acquire', 'read']]);
  });

  it('a mounted session the budget released is not relaunched by its widgets, nor by Session info’s 30 s refetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ready = { ...backend.status(ID), process: 'ready' as const };
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: ready }));
    mount(ID);
    await settle();
    const reads = backend.calls.length;
    expect(reads).toBeGreaterThan(0); // live: the widgets read
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...ready, process: 'exited', exit: { code: 0, signal: null, reason: 'budget', at: ready.launchedAt, release: { limitKiB: 1, totalKiB: 2 } } } }));
    await act(async () => void vi.advanceTimersByTime(INFO_REFRESH_MS * 2 + 1_000));
    await settle();
    expect(starts()).toEqual([]);
    const engineReads = backend.calls.slice(reads).filter((c) => c.subtype !== null);
    expect(engineReads).toEqual([]); // and no engine read issued over the released session
  });

  it('a focused switch across 20 exited sessions starts nothing', async () => {
    const ids = records.slice(0, 20).map((r) => r.appId);
    const view = mount(ids[0]);
    for (const id of ids.slice(1)) {
      view.switchTo(id);
      await settle(2);
    }
    await settle();
    expect(starts()).toEqual([]);
  });
});
