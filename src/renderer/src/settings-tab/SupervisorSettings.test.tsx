// E10 Task 3.2 (E10 execution document, §Design 11; Interfaces "Settings version 10"): the Background supervisor, under
// Settings › Supervisor since U11a M9. The status line reads main's `host.status`; the idle time writes settings version 10's `supervisor`
// section; Stop all asks inline, naming the live count, then calls `host.restart {stopSessions: true}`. P5 O15 M2: every
// status is the daemon's (main reports no other transport), and the group has no shape switch and no quit default.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge, Settings } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useHosts } from '../stores/hosts';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { daemonStatus, hostStatus as status, SUPERVISOR_STARTED, supervisorStatus as supervisor } from '../test-support/host-status';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { Section } from './parts';
import { SupervisorSection } from './SupervisorSection';
import { SupervisorSettings } from './SupervisorSettings';
import { formatClock } from '@shared/app/date-format';
import { escapeTaker } from '../destination/escape';

vi.mock('./engine-update', () => ({ openEngineUpdate: vi.fn() }));

const CLOCK = formatClock(Date.parse(SUPERVISOR_STARTED)); // L129: the display locale's clock

let b: SettingsBridge;
let unsubscribe = () => {};
const settings = () => useSettings.getState().state!.settings;

// The hosts store connects on mount and reads main's snapshot: the bridge answers it with `initialStatus`. U11a M9: the
// group is drawn in its section, whose heading takes the keyboard when a pressed control leaves.
async function renderGroup(initialStatus: HostStatus = status(), initial: Settings = SETTINGS_DEFAULTS_V21, whole = false) {
  b = settingsBridge(initial);
  b.answers['host.status'] = () => initialStatus;
  window.maws = b.bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <Section id="supervisor">{whole ? <SupervisorSection settings={settings()} /> : <SupervisorSettings settings={settings()} />}</Section>
    </QueryClientProvider>
  );
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
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the status line, from host.status', () => {
  it('reads running since, the pid, the live count and the idle exit the supervisor holds', async () => {
    await renderGroup();
    await statusLine(`Running since ${CLOCK} · pid 48213 · 3 sessions · exits 10 min after the last session ends`);
    expect(b.calls.map((c) => c.name)).toContain('host.status');
  });

  it('says one session, never for no idle exit, and when it exits with its last session (exit-when-idle armed)', async () => {
    await renderGroup(status({ supervisor: supervisor({ liveSessions: 1, idleExitMs: null }) }));
    await statusLine(`Running since ${CLOCK} · pid 48213 · 1 session · never exits on its own`);
    event(status({ supervisor: supervisor({ liveSessions: 0, exitWhenIdle: true }) }));
    await statusLine(`Running since ${CLOCK} · pid 48213 · no sessions · exits when its last session ends`);
    event(status({ supervisor: supervisor({ idleExitMs: 1_500 }) })); // the e2e seam pushes seconds
    await statusLine(`Running since ${CLOCK} · pid 48213 · 3 sessions · exits 2 s after the last session ends`);
  });

  it('reads Starting, Restarting and Not running', async () => {
    await renderGroup(status({ state: 'starting', supervisor: null, matches: null }));
    await statusLine('Starting');
    event(status({ state: 'restarting', supervisor: null, matches: null }));
    await statusLine('Restarting');
    event(status({ state: 'crashed', supervisor: null, matches: null }));
    await statusLine('Not running');
  });

  // P5 O16 M3c fix wave 2 (D63): an update that waits for MAWS tool calls, in the update copy, served or deferred
  it('while an update waits for tool calls says what it waits for', async () => {
    await renderGroup(status({ matches: 'build', handover: { inFlight: 2, tool: 'show_pane' } }));
    await statusLine('Waiting for show_pane to finish before updating the engine host (2 calls running).');
    event(status({ state: 'restarting', supervisor: null, matches: null, handover: { inFlight: 1 } }));
    await statusLine('Waiting for MAWS tool calls to finish before updating the engine host (1 call running).');
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
    await statusLine(`Running since ${CLOCK} · pid 48213 · 3 sessions · exits 10 min after the last session ends`);
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

  it('when Restart now leaves with the focus, the focus goes to the section’s heading', async () => {
    await renderGroup(status({ state: 'crashed', supervisor: null, matches: null, reason: 'held_lock' }));
    const button = within(row('Status')).getByRole('button', { name: 'Restart now' });
    button.focus();
    fireEvent.click(button);
    await vi.waitFor(() => expect(restarts()).toEqual([{ stopSessions: true }]));
    event(status({ state: 'starting', supervisor: null, matches: null })); // main starts afresh: the button goes
    expect(within(row('Status')).queryByRole('button')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Supervisor' }));
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
    const heading = screen.getByRole('heading', { name: 'Supervisor' });
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

  it('says what the background process is for once main answers, while starting too', async () => {
    await renderGroup();
    expect(within(row('Status')).getByText('Sessions run in this background process, so they can keep running after MAWS quits.')).toBeTruthy();
    event(status({ state: 'starting', supervisor: null, matches: null }));
    expect(within(row('Status')).getByText('Sessions run in this background process, so they can keep running after MAWS quits.')).toBeTruthy();
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

// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "Status"): the daemon line reads main's host.status:
// the daemon's kind, pid and machine ref.
describe('the machine daemon', () => {
  const daemonLine = () => row('Machine daemon').querySelector('[data-daemon-line]')!;

  it('reads the daemon at login, a private one and one not yet answering; the group’s one status stays the supervisor’s', async () => {
    await renderGroup(status({ daemon: daemonStatus({ kind: 'unit' }) }));
    expect(daemonLine().textContent).toBe('At login · pid 4100 · machine mRef0123456789abcdefAB');
    // the group's one status stays the supervisor's (its live line, which the e2e suites and the owner's reader read)
    expect(within(screen.getByRole('group', { name: 'Background supervisor' })).getAllByRole('status')).toHaveLength(1);
    event(status());
    expect(daemonLine().textContent).toBe('This profile only · pid 4100 · machine mRef0123456789abcdefAB');
    event(status({ daemon: null }));
    expect(daemonLine().textContent).toBe('Connecting');
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

  it('Escape cancels too, and is the question’s own, so the Settings dialog around it stays (UX wave U7b)', async () => {
    await renderGroup();
    fireEvent.click(stopAll());
    const question = ['Stop all', 'Cancel'].map((name) => within(row('Stop all')).getByRole('button', { name }));
    expect(question.map((button) => escapeTaker(button))).toEqual(['own', 'own']);
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

  it('confirmed, the question closes at once (its count frozen out of sight) and the focus goes to the section’s heading while it stops', async () => {
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
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Supervisor' }));
    await act(async () => answer());
    expect(await within(row('Stop all')).findByRole('button', { name: 'Stop all sessions and the supervisor…' })).toBeTruthy();
    expect(restarts()).toEqual([{ stopSessions: true }]);
  });
});

describe('inside Settings › Supervisor', () => {
  it('is the Background supervisor group, named but with no heading of its own, before the memory budget', async () => {
    await renderGroup(status(), SETTINGS_DEFAULTS_V21, true);
    const group = screen.getByRole('group', { name: 'Background supervisor' });
    expect(within(group).queryByRole('heading')).toBeNull();
    expect(screen.getAllByRole('heading').map((h) => h.getAttribute('aria-label'))).toEqual(['Supervisor']);
    expect(group.compareDocumentPosition(row('Memory budget')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // P5 O15 M2: its rows, in order; no shape switch and no quit default
    expect(within(group).getAllByRole('group').map((g) => g.firstElementChild?.textContent)).toEqual(['Status', 'Machine daemon', 'Exit when idle', 'Stop all']); // each row's label
    expect(within(group).queryByRole('switch')).toBeNull();
    expect(within(group).queryByRole('radiogroup')).toBeNull();
    await statusLine(`Running since ${CLOCK} · pid 48213 · 3 sessions · exits 10 min after the last session ends`);
  });
});
