// The routing footer in C7's usage popover (C11 execution document, Interfaces "Gateway", *Routing facts*; M4 refresh
// task "the popover footer as C7 asked"), rendered through C7's own popover body and seam.
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V3 } from '@shared/settings/defaults';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { registerAction } from '../keymap/actions-runtime';
import { panelHost } from '../panel/host';
import { registerUsagePopoverFooter } from '../statusline';
import { UsagePopoverBody } from '../statusline/UsagePopover';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { provideSessionStart } from './c10-seam';
import { useGateway } from './store';
import { answerSwitch } from './switch-route';
import { UsageFooter } from './UsageFooter';

const ROOT = join(__dirname, '../../../..');
const READY = 'app-7412a115' as AppSessionId; // routed, idle
const scenario = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
const record = scenario.sessions.find((r) => r.appId === READY)!;
let backend: WidgetBackend;
const offs: (() => void)[] = [];

const settingsWith = (gateway: Partial<Settings['gateway']>) => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V3, gateway: { ...SETTINGS_DEFAULTS_V3.gateway, ...gateway } }, resolvedTheme: 'light' } as never });

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: scenario.engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[READY, backend.status(READY)]]), records: new Map([[READY, record]]) });
  settingsWith({});
  offs.push(registerUsagePopoverFooter(UsageFooter));
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  useSessions.setState({ engine: new Map(), records: new Map() });
  useGateway.setState({ switching: new Map(), directLogin: new Map() });
  useSettings.setState({ state: null });
  delete (window as { maws?: MawsBridge }).maws;
  vi.restoreAllMocks();
});

const popover = (status: EngineSessionStatus | null = useSessions.getState().engine.get(READY) ?? null) => {
  render(<UsagePopoverBody record={useSessions.getState().records.get(READY)!} status={status} />);
  return screen.getByText((_, el) => el?.hasAttribute('data-routing-footer') ?? false);
};

describe('routingFacts names the account and the switch — the footer', () => {
  it('a routed session: the relay sentence, the hand-off, Accounts, Session info, and Switch to Direct… disabled until C10', () => {
    const footer = popover();
    expect(footer.textContent).toContain("Routed through ClaudeUsage's relay");
    for (const name of ['Open ClaudeUsage ↗', 'Accounts', 'Session info']) expect(within(footer).getByRole('button', { name })).toBeTruthy();
    const change = within(footer).getByRole('button', { name: 'Switch to Direct…' }) as HTMLButtonElement;
    expect(change.disabled).toBe(true);
    expect(change.title).toBe('Switching routes arrives with C10');
  });

  it('with a start, the switch opens its confirm; Accounts and Session info open their surfaces', async () => {
    offs.push(provideSessionStart({ start: async () => ({ status: 'starting' }), onSetupFailure: () => () => {} }));
    const accounts = vi.fn();
    offs.push(registerAction('accounts.open', accounts));
    const addTool = vi.spyOn(panelHost, 'addTool').mockReturnValue('session-info:x');
    const footer = popover();
    fireEvent.click(within(footer).getByRole('button', { name: 'Accounts' }));
    expect(accounts).toHaveBeenCalledTimes(1);
    fireEvent.click(within(footer).getByRole('button', { name: 'Session info' }));
    expect(addTool).toHaveBeenCalledWith('session-info', { appSessionId: READY });
    fireEvent.click(within(footer).getByRole('button', { name: 'Switch to Direct…' }));
    await vi.waitFor(() => expect(useGateway.getState().switching.get(READY)?.phase).toBe('confirming'));
    expect(answerSwitch(READY, null)).toBe(true);
  });

  it('offerDirect false hides Switch to Direct…; a direct session offers Switch to gateway… with its login', () => {
    settingsWith({ offerDirect: false });
    const routed = popover();
    expect(within(routed).queryByRole('button', { name: 'Switch to Direct…' })).toBeNull();
    cleanup();

    const direct = { ...backend.status(READY), gateway: { mode: 'direct' as const, baseUrl: null, verified: 'direct' as const, autoModeServer: 'unknown' as const, localLane: null } };
    useSessions.setState({ engine: new Map([[READY, direct]]) });
    useGateway.setState({ directLogin: new Map([[READY, { login: 'Expired — log in again', email: null, organization: null }]]) });
    const footer = popover(direct);
    expect(footer.textContent).toContain("Direct · engine's own login · Expired — log in again · no gateway models · usage windows from the engine");
    expect(within(footer).getByRole('button', { name: 'Switch to gateway…' })).toBeTruthy();
    expect(within(footer).queryByRole('button', { name: 'Open ClaudeUsage ↗' })).toBeNull();
  });

  it('an exited session whose route was never recorded names the default and offers both', () => {
    useSessions.setState({ engine: new Map(), records: new Map([[READY, { ...record, gateway: { ...record.gateway, routed: null } }]]) });
    const footer = popover(null);
    expect(footer.textContent).toContain('Route not recorded · a resume uses the default route (gateway)');
    expect(within(footer).getAllByRole('button', { name: /^Switch to/ }).map((b) => b.textContent)).toEqual(['Switch to gateway…', 'Switch to Direct…']);
  });
});
