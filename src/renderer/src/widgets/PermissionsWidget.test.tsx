import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
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
    const mode = await screen.findByText('default');
    expect(mode.closest('p')?.textContent).toBe('Effective default · from the init frame');
    expect(screen.getByText('This model does not support auto mode')).toBeTruthy();
    expect(screen.getByText('1 session grant · re-applied after a resume')).toBeTruthy();
    expect(screen.queryByText('auto')).toBeNull();
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
