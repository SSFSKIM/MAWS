import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { PluginsWidget } from './PluginsWidget';

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
      <PluginsWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );

describe('plugins widget', () => {
  it('lists what a ready process loaded, with no caption', () => {
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    expect(screen.getAllByRole('listitem')).toHaveLength(11);
    expect(screen.queryByText(/last reported/)).toBeNull();
  });

  it('operations show working, outcome and late correction: Reload shows Working… from the receipt, then the reload summarised', async () => {
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    backend.holdOperations(true);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Working…'));
    expect(backend.calls.filter((c) => c.subtype === 'reload_plugins')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveProperty('disabled', true);
    act(() => void backend.settleOperations());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Reloaded · 52 commands · 5 agents · 11 plugins · 0 errors'));
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveProperty('disabled', false);
  });

  it('shows a failed reload in its words with the list as it was, and a late success corrects it to Applied after all', async () => {
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    backend.scriptOutcome('session.reloadPlugins', () => ({ ok: false, error: { code: 'timeout', message: 'reload_plugins unanswered after 60 s', engineCode: null } }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('reload_plugins unanswered after 60 s · timeout'));
    expect(screen.getAllByRole('listitem')).toHaveLength(11);
    const opId = 'op-1'; // the backend's first operation
    act(() => backend.emitOperation({ appSessionId: ID, opId, command: 'session.reloadPlugins', late: true, outcome: { ok: true, value: { commands: [], agents: [], plugins: [], mcpServers: [], error_count: 0 } } }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Applied after all'));
  });

  it('refuses a reload the host would not start as the transport branch, asking nothing of the engine', async () => {
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    backend.script('session.reloadPlugins', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'the host did not answer' });
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The engine did not answer · showing the last value it reported'));
  });

  it('keeps an exited session’s last list and says it is what the session last reported', () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'exited' }]]) });
    mount();
    expect(screen.getAllByRole('listitem')).toHaveLength(11);
    expect(screen.getByText('The session is not running · the plugins it last reported')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull(); // nothing to reload without a process
  });
});
