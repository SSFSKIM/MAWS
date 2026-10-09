// `/reload-plugins` (E11's sitting, owner-notes 00-consolidated-plan §2.2): the engine lists it as a terminal-only command,
// and MAWS runs it as its own action over the existing `reload_plugins` control: choosing it reloads at once and says
// what the reload did; a session with no ready process is told so and nothing is asked of the engine.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { record } from '../../../../test/support/builders';
import { useSessions } from '../stores/sessions';
import { ReloadPluginsWidget } from './ReloadPluginsWidget';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
let backend: WidgetBackend;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReloadPluginsWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );
const reloads = () => backend.calls.filter((c) => c.subtype === 'reload_plugins');

describe('/reload-plugins', () => {
  it('reloads once on opening, says Working… and then what the reload loaded; Reload plugins runs it again', async () => {
    backend.holdOperations(true);
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    expect(document.querySelector('[data-widget="reload-plugins"] h3')?.textContent).toBe('Reload plugins');
    await waitFor(() => expect(screen.getByText('Working…')).toBeTruthy());
    expect(reloads()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toHaveProperty('disabled', true);
    act(() => void backend.settleOperations());
    await waitFor(() => expect(screen.getByText('Reloaded · 52 commands · 5 agents · 11 plugins · 0 errors')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Reload plugins' }));
    await waitFor(() => expect(reloads()).toHaveLength(2));
  });

  // P2-A (2026-10-09; the execution document §5.6): no ready process offers Load now; opening starts and asks nothing
  it('without a ready process offers Load now and asks nothing of the engine; Load now starts it, then the reload runs', async () => {
    const offStatus = backend.bridge().on('session.status', (event) => useSessions.getState().applyStatus(event));
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]), records: new Map([[ID, record(ID)]]) });
    act(() => void backend.emitStatus(ID, { process: 'exited' })); // the backend's engine and the store alike
    mount();
    expect(screen.getByText('Not read yet.')).toBeTruthy();
    expect(screen.queryByText(/not running/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload plugins' })).toBeNull();
    expect(reloads()).toEqual([]);
    expect(backend.calls.filter((c) => c.command === 'session.acquire')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Load now' }));
    await waitFor(() => expect(reloads()).toHaveLength(1));
    expect(backend.calls.filter((c) => c.command === 'session.acquire').map((c) => c.input)).toEqual([{ appSessionId: ID, reason: 'read' }]);
    offStatus();
    useSessions.setState({ records: new Map() });
  });
});
