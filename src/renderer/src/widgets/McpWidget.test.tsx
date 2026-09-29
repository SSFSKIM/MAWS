import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, fixtureLine, syntheticFixture, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { McpWidget, toggleView } from './McpWidget';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
const DOCS = 'openaiDeveloperDocs';
let backend: WidgetBackend;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <McpWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );
const reads = () => backend.calls.filter((c) => c.subtype === 'mcp_status').length;
const row = async (name: string) => (await screen.findAllByRole('listitem')).find((li) => li.textContent?.includes(name))!;
const serverSwitch = async (name: string) => within(await row(name)).getByRole('switch');
const statusOf = async (name: string) => within(await row(name)).getByRole('status');
type McpAnswer = { mcpServers: { name: string; status: string; error?: string }[] };
const withServer = (name: string, patch: Record<string, unknown>): McpAnswer => {
  const answer = fixtureLine(ROOT, 'pass2/real-settings#63') as McpAnswer;
  return { ...answer, mcpServers: answer.mcpServers.map((s) => (s.name === name ? { ...s, ...patch } : s)) };
};

describe('mcp reconnect runs as an operation', () => {
  it('calls session.mcpReconnect for the server, shows Working…, and reads mcp_status again on completion', async () => {
    backend.holdOperations(true);
    mount();
    fireEvent.click(within(await row(DOCS)).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect((within(document.body).getAllByRole('status').find((s) => s.textContent === 'Working…'))).toBeTruthy());
    expect(backend.calls.find((c) => c.subtype === 'mcp_reconnect')?.input).toEqual({ appSessionId: ID, serverName: DOCS });
    expect(reads()).toBe(1);
    act(() => void backend.settleOperations());
    await waitFor(() => expect(reads()).toBe(2));
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Reconnected'));
  });
});

describe('mcp toggle discloses persistence and reads its state back after either outcome', () => {
  it('Toggle off: session.mcpToggle { enabled: false }, the persistence beside the switch, one mcp_status after the outcome, and the switch reads it', async () => {
    backend.holdOperations(true);
    mount();
    const docs = await serverSwitch(DOCS);
    expect(docs.getAttribute('aria-checked')).toBe('true');
    expect((await row(DOCS)).textContent).toContain('Recorded by the engine for this project in ~/.claude.json');
    fireEvent.click(docs);
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Working…'));
    expect(backend.calls.find((c) => c.subtype === 'mcp_toggle')?.input).toEqual({ appSessionId: ID, serverName: DOCS, enabled: false });
    expect(reads()).toBe(1);
    act(() => void backend.settleOperations());
    await waitFor(async () => expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('false'));
    await new Promise((r) => setTimeout(r, 20));
    expect(reads()).toBe(2); // exactly one read-back after the outcome
    expect((await statusOf(DOCS)).textContent).toBe('Done');
  });

  it('a refusal before the write (Server not found) leaves the switch where the read puts it, with the words', async () => {
    backend.scriptOutcome('session.mcpToggle', () => ({ ok: false, error: { code: 'engine_error', message: 'Server not found: x', engineCode: null } }));
    mount();
    fireEvent.click(await serverSwitch(DOCS));
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Server not found: x · engine_error'));
    expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('true');
    expect(reads()).toBe(2);
  });

  it('an enable that persisted and did not connect reads On · not connected · <error>, never off', async () => {
    const failed = syntheticFixture(ROOT, 'mcp-toggle-connect-failed.json') as { operation: never; mcp_status: McpAnswer };
    let answer: McpAnswer = withServer(DOCS, { status: 'disabled' });
    backend.script('session.mcpStatus', () => answer);
    backend.scriptOutcome('session.mcpToggle', () => {
      answer = failed.mcp_status;
      return failed.operation;
    });
    mount();
    const docs = await serverSwitch(DOCS);
    await waitFor(() => expect(docs.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(docs);
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('On · not connected · Connection failed'));
    expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('true');
    expect(backend.calls.find((c) => c.subtype === 'mcp_toggle')?.input).toEqual({ appSessionId: ID, serverName: DOCS, enabled: true });
  });

  it('when the read-back fails the switch reads Unconfirmed with the outcome’s words, and Read again reads once more', async () => {
    mount();
    fireEvent.click(await serverSwitch(DOCS));
    backend.script('session.mcpStatus', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'mcp_status unanswered after 8 s' });
    });
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Unconfirmed · Done'));
    expect((await serverSwitch(DOCS)).dataset.state).toBe('unconfirmed');
    const before = reads();
    fireEvent.click(within(await row(DOCS)).getByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(reads()).toBe(before + 1));
  });
});

describe('toggleView: the switch from the read, never from the outcome', () => {
  const ok = { ok: true as const, value: null };
  const failed = (message: string) => ({ ok: false as const, error: { code: 'engine_error' as const, message, engineCode: null } });
  it('reads disabled as off, any other status as on, failed as on and not connected', () => {
    expect(toggleView(false, ok, { status: 'disabled', error: null })).toEqual({ position: 'off', line: 'Done' });
    expect(toggleView(true, ok, { status: 'pending', error: null })).toEqual({ position: 'on', line: 'Done' });
    expect(toggleView(true, failed('Connection failed'), { status: 'failed', error: 'Connection failed' })).toEqual({ position: 'on', line: 'On · not connected · Connection failed' });
  });
  it('is unconfirmed when the read failed, the server is gone, or a disable that failed after its write still reads connected', () => {
    expect(toggleView(false, ok, 'unread')).toEqual({ position: 'unconfirmed', line: 'Unconfirmed · Done' });
    expect(toggleView(false, ok, null)).toEqual({ position: 'unconfirmed', line: 'Unconfirmed · Done' });
    expect(toggleView(false, failed('disconnect failed'), { status: 'connected', error: null })).toEqual({ position: 'unconfirmed', line: 'Unconfirmed · disconnect failed · engine_error' });
  });
  it('trusts the read after a refusal thrown before the write', () => {
    expect(toggleView(true, failed('MCP server x is blocked by enterprise managed policy'), { status: 'disabled', error: null })).toEqual({ position: 'off', line: 'MCP server x is blocked by enterprise managed policy · engine_error' });
  });
});
