// E10 Task 3.2 (E10 execution document, §Design 11; Interfaces "Settings version 10"): Settings › Engine › Background
// supervisor. The status line reads main's `host.status`; the idle time and the quit default write settings version
// 10's `supervisor` section; Stop all asks inline, naming the live count, then calls `host.restart {stopSessions: true}`.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import type { HostStatus, SupervisorStatus } from '@shared/ipc/schema/host';
import { SETTINGS_DEFAULTS_V13 } from '@shared/settings/defaults';
import { useHosts } from '../stores/hosts';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { EngineSection } from './EngineSection';
import { SupervisorSettings } from './SupervisorSettings';

vi.mock('./engine-update', () => ({ openEngineUpdate: vi.fn() }));

const STARTED = new Date(2026, 9, 6, 14, 2).toISOString(); // 14:02 local
const supervisor = (over: Partial<SupervisorStatus> = {}): SupervisorStatus => ({
  mode: 'detached',
  pid: 48213,
  startedAt: STARTED,
  buildId: 'b',
  protocol: 1,
  wire: 'w',
  liveSessions: 3,
  rows: 4,
  idleExitMs: 600_000,
  idleExitAt: null,
  exitWhenIdle: false,
  socketPath: '/u/supervisor/host.sock',
  logPath: '/u/supervisor/host.log',
  orphansKilled: 0,
  ...over,
});
const status = (over: Partial<HostStatus> = {}): HostStatus => ({
  transport: 'detached',
  state: 'ready',
  supervisor: supervisor(),
  appBuildId: 'b',
  appWire: 'w',
  mainBuild: { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' },
  matches: 'same',
  reason: null,
  waitingLiveSessions: null,
  lastExit: null,
  ...over,
});

let b: SettingsBridge;
let unsubscribe = () => {};
const settings = () => useSettings.getState().state!.settings;

// The hosts store connects on mount and reads main's snapshot: the bridge answers it with `initialStatus`.
async function renderGroup(initialStatus: HostStatus = status(), initial: Settings = SETTINGS_DEFAULTS_V13, whole = false) {
  b = settingsBridge(initial);
  b.answers['host.status'] = () => initialStatus;
  window.maws = b.bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (whole ? <QueryClientProvider client={client}><EngineSection settings={settings()} /></QueryClientProvider> : <SupervisorSettings settings={settings()} />);
  const rendered = render(view());
  unsubscribe = useSettings.subscribe((state) => {
    if (state.state) rendered.rerender(view());
  });
  await vi.waitFor(() => expect(useHosts.getState().supervisor).toEqual(initialStatus)); // main's snapshot has landed
}
const row = (label: string) => screen.getByRole('group', { name: label });
const statusLine = async (text: string) => expect(await within(row('Status')).findByText(text)).toBeTruthy();
const event = (next: HostStatus) => act(() => useHosts.setState({ supervisor: next })); // as main's host.status event lands
const restarts = () => b.calls.filter((c) => c.name === 'host.restart').map((c) => c.input);
const toasts = () => useNotices.getState().notices.map((n) => n.text);

afterEach(() => {
  unsubscribe();
  cleanup();
  useSettings.setState({ state: null });
  useHosts.setState({ supervisor: null, hosts: { engine: null, pty: null } });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('the status line, from host.status', () => {
  it('reads running since, the pid, the live count and the idle exit the supervisor holds', async () => {
    await renderGroup();
    await statusLine('Running since 14:02 · pid 48213 · 3 sessions · exits 10 min after the last session ends');
    expect(b.calls.map((c) => c.name)).toContain('host.status');
  });

  it('says one session, never for no idle exit, and when it exits with its last session (exit-when-idle armed)', async () => {
    await renderGroup(status({ supervisor: supervisor({ liveSessions: 1, idleExitMs: null }) }));
    await statusLine('Running since 14:02 · pid 48213 · 1 session · never exits on its own');
    event(status({ supervisor: supervisor({ liveSessions: 0, exitWhenIdle: true }) }));
    await statusLine('Running since 14:02 · pid 48213 · no sessions · exits when its last session ends');
    event(status({ supervisor: supervisor({ idleExitMs: 1_500 }) })); // the e2e seam pushes seconds
    await statusLine('Running since 14:02 · pid 48213 · 3 sessions · exits 2 s after the last session ends');
  });

  it('reads Starting, Restarting and Not running, and inside the app in utility mode', async () => {
    await renderGroup(status({ state: 'starting', supervisor: null, matches: null }));
    await statusLine('Starting');
    event(status({ state: 'restarting', supervisor: null, matches: null }));
    await statusLine('Restarting');
    event(status({ state: 'crashed', supervisor: null, matches: null }));
    await statusLine('Not running');
    event(status({ transport: 'utility', supervisor: supervisor({ mode: 'utility', socketPath: null, logPath: null }) }));
    await statusLine('Runs inside MAWS · pid 48213 · 3 sessions · stops when MAWS quits');
  });

  it('while waiting on an incompatible supervisor says so and offers Restart now, which stops its sessions', async () => {
    await renderGroup(status({ state: 'crashed', supervisor: null, matches: 'wire', reason: 'incompatible', waitingLiveSessions: 2 }));
    await statusLine("Waiting · the previous version's supervisor still runs 2 sessions; MAWS moves to a new one when they become idle");
    fireEvent.click(within(row('Status')).getByRole('button', { name: 'Restart now' }));
    await vi.waitFor(() => expect(restarts()).toEqual([{ stopSessions: true }]));
  });

  it('a supervisor that holds the lock and does not answer is named, with Restart now; a running one offers none', async () => {
    await renderGroup(status({ state: 'crashed', supervisor: null, matches: null, reason: 'held_lock' }));
    await statusLine('Not running · another supervisor holds its lock and does not answer');
    expect(within(row('Status')).getByRole('button', { name: 'Restart now' })).toBeTruthy();
    event(status());
    await statusLine('Running since 14:02 · pid 48213 · 3 sessions · exits 10 min after the last session ends');
    expect(within(row('Status')).queryByRole('button')).toBeNull();
  });

  it('a refused Restart now is a warning toast', async () => {
    await renderGroup(status({ state: 'crashed', supervisor: null, matches: 'wire', reason: 'incompatible', waitingLiveSessions: 2 }));
    b.answers['host.restart'] = () => {
      throw new Error('the engine host is not available');
    };
    fireEvent.click(within(row('Status')).getByRole('button', { name: 'Restart now' }));
    await vi.waitFor(() => expect(toasts()).toEqual(['The supervisor was not restarted · the engine host is not available']));
  });

  it('when Restart now leaves with the focus, the focus goes to the group’s heading', async () => {
    await renderGroup(status({ state: 'crashed', supervisor: null, matches: null, reason: 'held_lock' }));
    const button = within(row('Status')).getByRole('button', { name: 'Restart now' });
    button.focus();
    fireEvent.click(button);
    await vi.waitFor(() => expect(restarts()).toEqual([{ stopSessions: true }]));
    event(status({ state: 'starting', supervisor: null, matches: null })); // main starts afresh: the button goes
    expect(within(row('Status')).queryByRole('button')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Background supervisor' }));
  });

  // E11 W-D (tracker row E10 "Restart now acted flag strands focus"): the heading held the focus only while the button
  // was disabled; a refusal leaves the button offered, so the focus goes back to it and the row forgets the press
  it('a refused Restart now returns the focus from the heading to the button once it is enabled again', async () => {
    await renderGroup(status({ state: 'crashed', supervisor: null, matches: null, reason: 'held_lock' }));
    let refuse: () => void = () => {};
    const invoke = vi.mocked(b.bridge.invoke);
    const answer = invoke.getMockImplementation()!;
    invoke.mockImplementation((name, input) =>
      name === 'host.restart' ? new Promise((resolve) => (refuse = () => resolve({ ok: false, error: { code: 'internal', message: 'the engine host is not available' } }))) : answer(name, input),
    );
    const heading = screen.getByRole('heading', { name: 'Background supervisor' });
    const button = within(row('Status')).getByRole('button', { name: 'Restart now' }) as HTMLButtonElement;
    button.focus();
    fireEvent.click(button);
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    expect(document.activeElement).toBe(heading);
    await act(async () => refuse());
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(document.activeElement).toBe(button);
    expect(toasts()).toEqual(['The supervisor was not restarted · the engine host is not available']);
    // the press is forgotten: a later status that takes the button away leaves a focus moved elsewhere alone
    const field = within(row('Exit when idle')).getByRole('textbox');
    field.focus();
    event(status({ state: 'starting', supervisor: null, matches: null }));
    expect(document.activeElement).toBe(field);
  });

  it('says what the background process is for only while the engine host is one (detached)', async () => {
    await renderGroup();
    expect(within(row('Status')).getByText('Sessions run in this background process, so they can keep running after MAWS quits.')).toBeTruthy();
    event(status({ transport: 'utility', supervisor: supervisor({ mode: 'utility', socketPath: null, logPath: null }) }));
    expect(within(row('Status')).queryByText('Sessions run in this background process, so they can keep running after MAWS quits.')).toBeNull();
  });
});

describe('the idle time', () => {
  const field = () => within(row('Exit when idle')).getByRole('textbox', { name: 'Minutes before the supervisor exits when idle' }) as HTMLInputElement;

  it('shows the setting in minutes and writes whole minutes on Enter, and null (never) when emptied', async () => {
    await renderGroup();
    expect(field().value).toBe('10');
    fireEvent.change(field(), { target: { value: '30' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await vi.waitFor(() => expect(b.sets).toEqual([{ supervisor: { idleExitMinutes: 30 } }]));
    expect(field().value).toBe('30');
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ supervisor: { idleExitMinutes: null } }));
    expect(field().placeholder).toBe('never');
    expect(within(row('Exit when idle')).getByText('Never · the supervisor keeps running after its last session ends, even with MAWS closed.')).toBeTruthy();
  });

  it('refuses anything but whole minutes from 1 to 1440 with a warning, writes nothing and shows the setting again', async () => {
    await renderGroup();
    for (const typed of ['0', '1441', '2.5', 'soon']) {
      fireEvent.change(field(), { target: { value: typed } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      await vi.waitFor(() => expect(field().value).toBe('10'));
    }
    expect(b.sets).toEqual([]);
    expect(toasts()).toEqual(Array(4).fill('Enter whole minutes from 1 to 1440, or leave the field empty for never'));
    fireEvent.change(field(), { target: { value: ' 1440 ' } });
    fireEvent.blur(field());
    await vi.waitFor(() => expect(b.sets).toEqual([{ supervisor: { idleExitMinutes: 1440 } }]));
  });
});

describe('the quit default', () => {
  it('shows Keep sessions running by default and writes keepRunningDefault', async () => {
    await renderGroup();
    const group = screen.getByRole('radiogroup', { name: 'When quitting with work in flight' });
    expect((within(group).getByRole('radio', { name: 'Keep sessions running' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: 'Stop them' }));
    await vi.waitFor(() => expect(b.sets).toEqual([{ supervisor: { keepRunningDefault: false } }]));
    expect((within(group).getByRole('radio', { name: 'Stop them' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('Stop all', () => {
  const stopAll = () => within(row('Stop all')).getByRole('button', { name: 'Stop all sessions and the supervisor…' });

  it('asks inline naming the live count; Cancel asks nothing of main', async () => {
    await renderGroup();
    fireEvent.click(stopAll());
    expect(within(row('Stop all')).getByText('Stop 3 sessions and the supervisor?')).toBeTruthy();
    event(status({ supervisor: supervisor({ liveSessions: 1 }) })); // the count follows the status while asked
    expect(within(row('Stop all')).getByText('Stop 1 session and the supervisor?')).toBeTruthy();
    fireEvent.click(within(row('Stop all')).getByRole('button', { name: 'Cancel' }));
    expect(stopAll()).toBeTruthy();
    expect(restarts()).toEqual([]);
  });

  it('Escape cancels too', async () => {
    await renderGroup();
    fireEvent.click(stopAll());
    fireEvent.keyDown(within(row('Stop all')).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(stopAll()).toBeTruthy();
  });

  it('confirmed, calls host.restart with stopSessions and closes the question', async () => {
    await renderGroup();
    fireEvent.click(stopAll());
    fireEvent.click(within(row('Stop all')).getByRole('button', { name: 'Stop all' }));
    await vi.waitFor(() => expect(restarts()).toEqual([{ stopSessions: true }]));
    expect(await within(row('Stop all')).findByRole('button', { name: 'Stop all sessions and the supervisor…' })).toBeTruthy();
  });

  it('with no live session asks to stop the supervisor alone', async () => {
    await renderGroup(status({ supervisor: supervisor({ liveSessions: 0 }) }));
    fireEvent.click(stopAll());
    expect(within(row('Stop all')).getByText('No session is running. Stop the supervisor and start a fresh one?')).toBeTruthy();
  });

  it('a refusal from main is a warning toast', async () => {
    await renderGroup();
    b.answers['host.restart'] = () => {
      throw new Error('the engine host is not available');
    };
    fireEvent.click(stopAll());
    fireEvent.click(within(row('Stop all')).getByRole('button', { name: 'Stop all' }));
    await vi.waitFor(() => expect(toasts()).toEqual(['The supervisor was not stopped · the engine host is not available']));
  });

  it('is unavailable while the supervisor is not running', async () => {
    await renderGroup(status({ state: 'starting', supervisor: null, matches: null }));
    await statusLine('Starting');
    expect((stopAll() as HTMLButtonElement).disabled).toBe(true);
  });

  it('a question the supervisor’s restart interrupted does not come back when it is ready again', async () => {
    await renderGroup();
    fireEvent.click(stopAll());
    expect(within(row('Stop all')).getByText('Stop 3 sessions and the supervisor?')).toBeTruthy();
    event(status({ state: 'restarting', supervisor: null, matches: null }));
    expect(within(row('Stop all')).queryByText('Stop 3 sessions and the supervisor?')).toBeNull();
    event(status());
    expect(stopAll()).toBeTruthy();
    expect(within(row('Stop all')).queryByText('Stop 3 sessions and the supervisor?')).toBeNull();
    expect(within(row('Stop all')).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('names the question on both its buttons', async () => {
    await renderGroup();
    fireEvent.click(stopAll());
    const question = within(row('Stop all')).getByText('Stop 3 sessions and the supervisor?');
    for (const name of ['Stop all', 'Cancel']) expect(within(row('Stop all')).getByRole('button', { name }).getAttribute('aria-describedby')).toBe(question.id);
  });

  it('moves the focus to Cancel when it asks and back to the action when cancelled', async () => {
    await renderGroup();
    stopAll().focus();
    fireEvent.click(stopAll());
    expect(document.activeElement).toBe(within(row('Stop all')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(row('Stop all')).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(stopAll());
  });

  it('confirmed, the question closes at once (its count frozen out of sight) and the focus goes to the heading while it stops', async () => {
    await renderGroup();
    let answer = () => {};
    b.answers['host.restart'] = () => undefined;
    const invoke = b.bridge.invoke as unknown as { getMockImplementation(): (name: string, input: unknown) => Promise<unknown>; mockImplementation(f: (name: string, input: unknown) => Promise<unknown>): void };
    const real = invoke.getMockImplementation();
    invoke.mockImplementation((name, input) => (name === 'host.restart' ? new Promise((resolve) => (answer = () => resolve(real(name, input)))) : real(name, input)));
    fireEvent.click(stopAll());
    fireEvent.click(within(row('Stop all')).getByRole('button', { name: 'Stop all' }));
    expect(within(row('Stop all')).queryByText('Stop 3 sessions and the supervisor?')).toBeNull();
    const stopping = within(row('Stop all')).getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement;
    expect(stopping.disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Background supervisor' }));
    await act(async () => answer());
    expect(await within(row('Stop all')).findByRole('button', { name: 'Stop all sessions and the supervisor…' })).toBeTruthy();
    expect(restarts()).toEqual([{ stopSessions: true }]);
  });
});

describe('inside Settings › Engine', () => {
  it('is a Background supervisor group of the Engine section, after the engine rows', async () => {
    await renderGroup(status(), SETTINGS_DEFAULTS_V13, true);
    const group = screen.getByRole('group', { name: 'Background supervisor' });
    expect(within(group).getByRole('group', { name: 'Status' })).toBeTruthy();
    expect(within(group).getByRole('group', { name: 'Exit when idle' })).toBeTruthy();
    expect(within(group).getByRole('group', { name: 'When quitting with work in flight' })).toBeTruthy();
    expect(within(group).getByRole('group', { name: 'Stop all' })).toBeTruthy();
    await statusLine('Running since 14:02 · pid 48213 · 3 sessions · exits 10 min after the last session ends');
  });
});
