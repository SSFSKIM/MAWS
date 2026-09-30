import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { registerFocusTarget } from '../stores/composer';
import { CompactWidget } from './CompactWidget';
import { ContextWidget } from './ContextWidget';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
let backend: WidgetBackend;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
});
afterEach(() => {
  cleanup();
  resetQueueStore();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = (args = '', close = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompactWidget appSessionId={ID} args={args} close={close} />
    </QueryClientProvider>,
  );
  return close;
};
const compactNow = () => screen.getByRole('button', { name: 'Compact now' });

describe('compact widget', () => {
  it("shows the context numbers from get_context_usage's summary", async () => {
    mount();
    await screen.findByText('30,433 of 200,000 · 15% · autocompact at 167,000');
    expect(backend.calls.find((c) => c.subtype === 'get_context_usage')?.input).toEqual({ appSessionId: ID, detail: 'summary' });
  });

  it('sends /compact with the typed instructions as the next session.send, and closes', async () => {
    const close = mount();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Instructions' }), { target: { value: 'focus on tests' } });
    fireEvent.click(compactNow());
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(backend.calls.filter((c) => c.command === 'session.send').map((c) => c.input)).toEqual([{ appSessionId: ID, content: '/compact focus on tests' }]);
  });

  it('`/compact focus on tests` fills the field; with nothing typed it sends a bare /compact', async () => {
    mount('focus on tests');
    expect(((await screen.findByRole('textbox', { name: 'Instructions' })) as HTMLTextAreaElement).value).toBe('focus on tests');
    cleanup();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Compact now' }));
    await waitFor(() => expect(backend.calls.find((c) => c.command === 'session.send')?.input).toEqual({ appSessionId: ID, content: '/compact' }));
  });

  it('refuses while a turn is open: the control reads Wait for the turn', async () => {
    act(() => void backend.emitTurnStarted(ID));
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    await screen.findByRole('textbox', { name: 'Instructions' });
    expect(compactNow()).toHaveProperty('disabled', true);
    expect(screen.getByText('Wait for the turn')).toBeTruthy();
  });

  it('refuses behind queued messages, and names why a paused queue paused', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), queue: { length: 1, paused: false } }]]) });
    mount();
    await screen.findByText('Queued messages go first');
    expect(compactNow()).toHaveProperty('disabled', true);
    cleanup();
    resetQueueStore();
    backend.script('session.queue.list', () => ({ entries: [], paused: true, pauseReason: 'interrupt' }));
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), queue: { length: 1, paused: true } }]]) });
    mount();
    await screen.findByText('Queue paused because you interrupted');
    expect(compactNow()).toHaveProperty('disabled', true);
  });

  it("the context widget's Compact… closes it and opens this widget over the session's composer", async () => {
    const target = { focusEditor: vi.fn(), focusFrame: vi.fn(), insertText: vi.fn(), openWidget: vi.fn(() => true) };
    const off = registerFocusTarget(ID, target);
    const close = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ContextWidget appSessionId={ID} args="" close={close} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Compact…' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(target.openWidget).toHaveBeenCalledWith('compact', '');
    off();
  });

  it('an unanswered send says the command may still run and holds Compact now until the status moves', async () => {
    backend.script('session.send', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'session.send unanswered after 10 s' });
    });
    const close = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Compact now' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The engine did not answer · the command may still run; check the transcript before sending again'));
    expect(compactNow()).toHaveProperty('disabled', true); // no immediate second /compact
    expect(close).not.toHaveBeenCalled();
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: backend.emitStatus(ID, { engineState: 'running' }) }));
    await waitFor(() => expect(compactNow()).toHaveProperty('disabled', false));
  });

  it('keeps the widget open with the reason when the host refuses the send', async () => {
    backend.script('session.send', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'the session is not ready' });
    });
    const close = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Compact now' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('the session is not ready'));
    expect(close).not.toHaveBeenCalled();
  });
});
