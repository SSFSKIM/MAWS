// The routing footer in C7's usage popover (C11 execution document, Interfaces "Gateway", *Routing facts*; M4 refresh
// task "the popover footer as C7 asked"), rendered through C7's own popover body and seam; and (the architect's ruling of
// 2026-09-29, from C10's review) an unstarted session's route chosen on its intent, restarting nothing.
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
import { useSetup } from '../sessions/store';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { intent as intentOf } from '../test-support/setup-intents';
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
  backend = createWidgetBackend({ root: ROOT, statuses: scenario.engine, records: scenario.sessions });
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
  useSetup.setState({ intents: new Map(), phases: new Map(), invoking: new Set() });
  useSettings.setState({ state: null });
  delete (window as { maws?: MawsBridge }).maws;
  vi.restoreAllMocks();
});

const popover = (status: EngineSessionStatus | null = useSessions.getState().engine.get(READY) ?? null) => {
  render(<UsagePopoverBody record={useSessions.getState().records.get(READY)!} status={status} />);
  return screen.getByText((_, el) => el?.hasAttribute('data-routing-footer') ?? false);
};

describe('routingFacts names the account and the switch — the footer', () => {
  it('a routed session: the relay sentence, the hand-off, Accounts, Session info, and Switch to Direct…', () => {
    const footer = popover();
    expect(footer.textContent).toContain("Routed through ClaudeUsage's relay");
    for (const name of ['Open ClaudeUsage ↗', 'Accounts', 'Session info']) expect(within(footer).getByRole('button', { name })).toBeTruthy();
    const change = within(footer).getByRole('button', { name: 'Switch to Direct…' }) as HTMLButtonElement;
    expect(change.disabled).toBe(false);
  });

  it('the switch opens its confirm; Accounts and Session info open their surfaces', async () => {
    const accounts = vi.fn();
    offs.push(registerAction('accounts.open', accounts));
    const addTool = vi.spyOn(panelHost, 'addTool').mockReturnValue('session-info:x');
    const footer = popover();
    fireEvent.click(within(footer).getByRole('button', { name: 'Accounts' }));
    expect(accounts).toHaveBeenCalledTimes(1);
    fireEvent.click(within(footer).getByRole('button', { name: 'Session info' }));
    expect(addTool).toHaveBeenCalledWith('session-info', { appSessionId: READY });
    fireEvent.click(within(footer).getByRole('button', { name: 'Switch to Direct…' }));
    await vi.waitFor(() => expect(useGateway.getState().switching.get(READY)).toMatchObject({ phase: 'confirming', confirm: expect.anything() }));
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

  it('while the switch reads the status before its sheet, the footer says it is checking, not waiting for an answer', () => {
    useGateway.setState({ switching: new Map([[READY, { target: 'direct', phase: 'confirming', confirm: null, error: null }]]) });
    const footer = popover();
    expect(within(footer).getByRole('status').textContent).toBe('Checking the session…');
    cleanup();
    useGateway.setState({ switching: new Map([[READY, { target: 'direct', phase: 'confirming', confirm: { target: 'direct', backgroundTasks: [], requiresModel: false, model: null, effort: null }, error: null }]]) });
    expect(within(popover()).getByRole('status').textContent).toBe('Waiting for your answer');
  });

  it('an exited session whose route was never recorded names the default and offers both', () => {
    useSessions.setState({ engine: new Map(), records: new Map([[READY, { ...record, gateway: { ...record.gateway, routed: null } }]]) });
    const footer = popover(null);
    expect(footer.textContent).toContain('Route not recorded · a resume uses the default route (gateway)');
    expect(within(footer).getAllByRole('button', { name: /^Switch to/ }).map((b) => b.textContent)).toEqual(['Switch to gateway…', 'Switch to Direct…']);
  });
});

// An unstarted session (C10's setup intent, and no process yet: a provisional record while its first launch runs, or
// any host of C7's footer before the record exists) chooses its route on the intent and restarts nothing (the
// architect's ruling of 2026-09-29; D-19's per-session Direct). Branching before routingFacts is what keeps its
// unrecorded route from reading "Route not recorded" with a restart offered.
describe('an unstarted session chooses its route and restarts nothing — the footer', () => {
  const unstarted = (over: Parameters<typeof intentOf>[0] = {}) => {
    const held = intentOf({ appSessionId: READY, ...over });
    useSetup.setState({ intents: new Map([[READY, held]]) });
    useSessions.setState({ engine: new Map(), records: new Map([[READY, { ...record, gateway: { ...record.gateway, routed: null } }]]) });
    backend.script('session.intent.patch', (input) => ({ ...held, ...(input as { patch: object }).patch }));
    return popover(null);
  };

  it('names the intent’s route and offers the relay and Direct, with no switch', () => {
    const footer = unstarted();
    expect(footer.textContent).toContain("Starts routed through ClaudeUsage's relay");
    expect(footer.textContent).toContain('Applies at the first send · nothing restarts');
    const choice = within(footer).getByRole('group', { name: 'Route for this session' });
    expect(within(choice).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['ClaudeUsage relay', 'true'],
      ['Direct', 'false'],
    ]);
    expect(within(footer).queryByRole('button', { name: /^Switch to/ })).toBeNull();
    expect(footer.textContent).not.toContain('Route not recorded');
  });

  it('Direct patches the intent’s gateway and never starts or stops anything', async () => {
    const footer = unstarted();
    fireEvent.click(within(footer).getByRole('button', { name: 'Direct' }));
    await vi.waitFor(() => expect(useSetup.getState().intents.get(READY)?.gateway).toBe('direct'));
    expect(backend.calls.map((c) => [c.command, c.input])).toEqual([['session.intent.patch', { appSessionId: READY, patch: { gateway: 'direct' } }]]);
  });

  it('while its start runs, or its first message waits behind a card, the choice is disabled', () => {
    useSetup.setState({ invoking: new Set([READY]) });
    for (const button of within(within(unstarted()).getByRole('group')).getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    useSetup.setState({ invoking: new Set() });
    for (const button of within(within(unstarted({ message: { content: 'Reply OK', display: 'Reply OK' } })).getByRole('group')).getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('offerDirect false leaves a routed intent without the choice, and without the note about one', () => {
    settingsWith({ offerDirect: false });
    const footer = unstarted();
    expect(within(footer).queryByRole('group', { name: 'Route for this session' })).toBeNull();
    expect(footer.textContent).toContain("Starts routed through ClaudeUsage's relay");
    expect(footer.textContent).not.toContain('Applies at the first send');
  });
});
