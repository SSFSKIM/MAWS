import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, fixtureLine, RESPONSES, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { accessibleDescription } from '../test-support/accessible-text';
import { PermissionsWidget } from './PermissionsWidget';
import { engineReadKey } from './read';

const ROOT = join(__dirname, '../../../..');
const RECORDED_GRANT = 'Bash(' + 'git log --oneline)'; // pass2/grant-askrule-start seq 65's session grant
// P5 O6 M2: the backend is main (bare ids); the page holds the address
const BARE = 'app-7412a115' as AppSessionId;
const ID = at(BARE);
const lifted = (status: EngineSessionStatus): EngineSessionStatus => ({ ...status, appSessionId: at(status.appSessionId) });
let backend: WidgetBackend;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: unknown }).maws;
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PermissionsWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );

describe('permissions widget shows effective mode and rules with sources', () => {
  // the word cut (P580, P582, P516): the segment's checked row is the effective mode, with no "Effective … · from the init
  // frame" line above it; the scope sentence is the segment's note, opened on focus and its description at rest
  it('reads the effective mode from the status, never the requested one, and the refusal in words', async () => {
    const status = lifted(backend.status(BARE));
    useSessions.setState({ engine: new Map([[ID, { ...status, permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' }, grants: ['Bash(git log --oneline)'] }]]) });
    mount();
    expect((await screen.findByRole('menuitemradio', { checked: true })).textContent).toMatch(/^Manual/); // the segment selects the effective mode
    const frame = document.querySelector<HTMLElement>('[data-widget="permissions"]')!;
    expect(frame.querySelector('h3')?.textContent).toBe('Permissions');
    expect(frame.textContent).not.toContain('from the init frame');
    expect(frame.textContent).not.toContain('Effective');
    expect(screen.getByText('This model does not support auto mode')).toBeTruthy();
    expect(screen.getByText('1 session grant · re-applied after a resume')).toBeTruthy();
    const segment = screen.getByRole('menu', { name: 'Permission mode' }).closest<HTMLElement>('[data-note-row]')!;
    expect(accessibleDescription(segment)).toBe('The mode applies to this session only');
    const note = segment.querySelector<HTMLElement>('[data-row-note]')!;
    expect(note.hidden).toBe(true);
    act(() => screen.getByRole('menuitemradio', { checked: true }).focus());
    expect(note.hidden).toBe(false);
    expect(frame.textContent).not.toContain('rules are edited in their settings files');
  });

  // C11 M6, live: a rules read cached before an approval card's session grant (fresh, so a mount does not refetch it)
  // listed no grant while the status already counted one; the list is read again when the status names more grants.
  it('reads the rules again when the status counts a session grant the cached list lacks', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...lifted(backend.status(BARE)), grants: [RECORDED_GRANT] }]]) });
    const recorded = fixtureLine(ROOT, RESPONSES.list_permission_rules) as { state: { rules: { source: string }[] } };
    const before = { ...recorded, state: { ...recorded.state, rules: recorded.state.rules.filter((r) => r.source !== 'session') } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(engineReadKey('session.listPermissionRules', { appSessionId: ID }), before);
    render(
      <QueryClientProvider client={client}>
        <PermissionsWidget appSessionId={ID} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    const allow = await screen.findByRole('list', { name: 'Allow rules' });
    expect(within(allow).getByRole('listitem').textContent).toContain('session');
  });

  // the word cut (P586, P587, P588): a rule's source is one word; no "original directory" on the first folder
  it("lists every rule under allow, ask and deny with the engine's phrasing and its source (pass2/grant-askrule-start seq 65)", async () => {
    useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
    mount();
    const allow = await screen.findByRole('list', { name: 'Allow rules' });
    const grant = within(allow).getByRole('listitem');
    expect(within(grant).getByText('Bash(git log --oneline)').tagName).toBe('CODE');
    expect(grant.querySelector('[data-rule-source]')?.textContent).toBe('session');
    expect(grant.textContent).toContain('The Bash command git log --oneline');
    expect(grant.textContent).toContain('this session'); // editability
    const ask = within(screen.getByRole('list', { name: 'Ask rules' })).getByRole('listitem');
    expect(ask.textContent).toContain('Bash(git:*)');
    expect(ask.querySelector('[data-rule-source]')?.textContent).toBe('startup');
    expect(ask.textContent).toContain('read-only here');
    expect(screen.queryByRole('list', { name: 'Deny rules' })).toBeNull(); // an empty group is not drawn
    const folder = within(screen.getByRole('list', { name: 'Workspace directories' })).getByRole('listitem');
    expect(folder.textContent).toBe('/private/tmp/maws-probe2-UVKiUq');
  });

  // the word cut (P586, P587, P584): a source that names a file takes the keyboard and has the file as its tooltip and
  // description; "in a settings file" leaves the rule's second line; an empty list reads "No rules"
  it('names a settings file under its source word, drops "in a settings file", and says No rules when there are none', async () => {
    useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
    backend.script('session.listPermissionRules', () => ({
      state: { rules: [{ behavior: 'deny', source: 'userSettings', rule: 'Read(.env)', editability: 'persistent', description: { prefix: 'Reading ', emphasis: '.env' } }], workspaceDirectories: [], originalCwd: '/w', managedOnly: false },
    }));
    mount();
    const deny = within(await screen.findByRole('list', { name: 'Deny rules' })).getByRole('listitem');
    const source = deny.querySelector<HTMLElement>('[data-rule-source]')!;
    expect(source.textContent).toBe('user');
    expect(source.tabIndex).toBe(0);
    expect(accessibleDescription(source)).toBe('Edited in ~/.claude/settings.json');
    expect(deny.textContent).not.toContain('in a settings file');
    expect(deny.textContent).toContain('Reading .env');
    cleanup();
    backend.script('session.listPermissionRules', () => ({ state: { rules: [], workspaceDirectories: [], originalCwd: '/w', managedOnly: false } }));
    mount();
    expect(await screen.findByText('No rules')).toBeTruthy();
  });

  // the word cut (P518): the rules read's wait is the quiet spinner, under the segment
  it('shows the quiet spinner while the rules are read', async () => {
    useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
    backend.script('session.listPermissionRules', () => new Promise(() => {}));
    mount();
    expect(await screen.findByRole('progressbar', { name: 'Reading…' })).toBeTruthy();
    expect(screen.queryByText('Reading…')).toBeNull();
  });
});

describe('permissions widget: the mode segment (C7’s mode menu) over session.setPermissionMode', () => {
  const follow = () => ipc.on('session.status', (event) => useSessions.getState().applyStatus(event, TEST_MACHINE)); // C3's status events, as the shell applies them
  const checked = () => screen.getByRole('menuitemradio', { checked: true }).textContent ?? '';
  const choose = (mode: string) => fireEvent.click(screen.getAllByRole('menuitemradio').find((item) => item.textContent?.startsWith(mode))!);

  it("a refusal (seq 156, as C3 maps it) shows the code in words and never moves the segment", async () => {
    useSessions.setState({ engine: new Map([[ID, { ...lifted(backend.status(BARE)), model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' }, permissionMode: { requested: 'default', effective: 'default', refusal: null } }]]) });
    // the backend holds the same session: haiku, default
    backend.emitStatus(BARE, { model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' }, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    const off = follow();
    mount();
    await screen.findByRole('menu', { name: 'Permission mode' });
    choose('Auto');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This model does not support auto mode'));
    expect(checked()).toMatch(/^Manual/);
    expect(backend.calls.find((c) => c.subtype === 'set_permission_mode')?.input).toEqual({ appSessionId: BARE, mode: 'auto' });
    off();
  });

  it('an accepted change selects the effective mode the engine answered (seq 165)', async () => {
    backend.emitStatus(BARE, { model: { requested: 'claude/astra', resolved: 'claude/astra' }, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
    const off = follow();
    mount();
    await screen.findByRole('menu', { name: 'Permission mode' });
    choose('Auto');
    await waitFor(() => expect(checked()).toMatch(/^Auto/));
    expect(screen.queryByRole('alert')).toBeNull();
    off();
  });

  it('a transport error (IpcError timeout) never moves the segment and says the engine did not answer', async () => {
    useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
    backend.script('session.setPermissionMode', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'set_permission_mode unanswered after 8 s' });
    });
    mount();
    await screen.findByRole('menu', { name: 'Permission mode' });
    choose('Plan');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The engine did not answer · showing the last value it reported'));
    expect(checked()).toMatch(/^Auto/);
    expect(screen.getAllByRole('menuitemradio').every((item) => !(item as HTMLButtonElement).disabled || item.textContent?.startsWith('Auto'))).toBe(true); // re-enabled
  });

  it('keeps the segment when the rules read fails: the mode is the status, not the read', async () => {
    useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
    backend.script('session.listPermissionRules', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'list_permission_rules refused' });
    });
    mount();
    await screen.findByText('list_permission_rules refused');
    expect(screen.getByRole('menu', { name: 'Permission mode' })).toBeTruthy();
    expect(checked()).toMatch(/^Auto/);
  });

  it('reads list_models for auto’s availability and list_permission_rules for the rules, each once', async () => {
    useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
    mount();
    await screen.findByRole('list', { name: 'Allow rules' });
    await waitFor(() => expect(backend.calls.filter((c) => c.subtype === 'list_models')).toHaveLength(1));
    expect(backend.calls.filter((c) => c.subtype === 'list_permission_rules')).toHaveLength(1);
  });
});
