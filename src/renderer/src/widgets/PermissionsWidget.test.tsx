import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { PermissionsWidget } from './PermissionsWidget';

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
      <PermissionsWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );

describe('permissions widget shows effective mode and rules with sources', () => {
  it('reads the effective mode from the status, never the requested one, and the refusal in words', async () => {
    const status = backend.status(ID);
    useSessions.setState({ engine: new Map([[ID, { ...status, permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' }, grants: ['Bash(git log --oneline)'] }]]) });
    mount();
    const mode = await screen.findByText('default', { selector: 'strong' });
    expect(mode.closest('p')?.textContent).toBe('Effective default · from the init frame');
    expect(screen.getByText('This model does not support auto mode')).toBeTruthy();
    expect(screen.getByText('1 session grant · re-applied after a resume')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { checked: true }).textContent).toMatch(/^default/); // the segment selects the effective mode
  });

  it("lists every rule under allow, ask and deny with the engine's phrasing and its source (pass2/grant-askrule-start seq 65)", async () => {
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    const allow = await screen.findByRole('list', { name: 'Allow rules' });
    const grant = within(allow).getByRole('listitem');
    expect(within(grant).getByText('Bash(git log --oneline)').tagName).toBe('CODE');
    expect(grant.textContent).toContain('this session · grant');
    expect(grant.textContent).toContain('The Bash command git log --oneline');
    expect(grant.textContent).toContain('this session'); // editability
    const ask = within(screen.getByRole('list', { name: 'Ask rules' })).getByRole('listitem');
    expect(ask.textContent).toContain('Bash(git:*)');
    expect(ask.textContent).toContain('startup settings');
    expect(ask.textContent).toContain('read-only here');
    expect(screen.queryByRole('list', { name: 'Deny rules' })).toBeNull(); // an empty group is not drawn
    expect(within(screen.getByRole('list', { name: 'Workspace directories' })).getByRole('listitem').textContent).toContain('/private/tmp/maws-probe2-UVKiUq');
  });
});

describe('permissions widget: the mode segment (C7’s mode menu) over session.setPermissionMode', () => {
  const follow = () => backend.bridge().on('session.status', (event) => useSessions.getState().applyStatus(event)); // C3's status events, as the shell applies them
  const checked = () => screen.getByRole('menuitemradio', { checked: true }).textContent ?? '';
  const choose = (mode: string) => fireEvent.click(screen.getAllByRole('menuitemradio').find((item) => item.textContent?.startsWith(mode))!);

  it("a refusal (seq 156, as C3 maps it) shows the code in words and never moves the segment", async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' }, permissionMode: { requested: 'default', effective: 'default', refusal: null } }]]) });
    // the backend holds the same session: haiku, default
    backend.emitStatus(ID, { model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' }, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    const off = follow();
    mount();
    await screen.findByRole('menu', { name: 'Permission mode' });
    choose('auto');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This model does not support auto mode'));
    expect(checked()).toMatch(/^default/);
    expect(backend.calls.find((c) => c.subtype === 'set_permission_mode')?.input).toEqual({ appSessionId: ID, mode: 'auto' });
    off();
  });

  it('an accepted change selects the effective mode the engine answered (seq 165)', async () => {
    backend.emitStatus(ID, { model: { requested: 'claude/astra', resolved: 'claude/astra' }, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    const off = follow();
    mount();
    await screen.findByRole('menu', { name: 'Permission mode' });
    choose('auto');
    await waitFor(() => expect(checked()).toMatch(/^auto/));
    expect(screen.queryByRole('alert')).toBeNull();
    off();
  });

  it('a transport error (IpcError timeout) never moves the segment and says the engine did not answer', async () => {
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    backend.script('session.setPermissionMode', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'set_permission_mode unanswered after 8 s' });
    });
    mount();
    await screen.findByRole('menu', { name: 'Permission mode' });
    choose('plan');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The engine did not answer · showing the last value it reported'));
    expect(checked()).toMatch(/^auto/);
    expect(screen.getAllByRole('menuitemradio').every((item) => !(item as HTMLButtonElement).disabled || item.textContent?.startsWith('auto'))).toBe(true); // re-enabled
  });

  it('reads list_models for auto’s availability and list_permission_rules for the rules, each once', async () => {
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    await screen.findByRole('list', { name: 'Allow rules' });
    await waitFor(() => expect(backend.calls.filter((c) => c.subtype === 'list_models')).toHaveLength(1));
    expect(backend.calls.filter((c) => c.subtype === 'list_permission_rules')).toHaveLength(1);
  });
});
