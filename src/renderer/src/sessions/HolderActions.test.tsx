// Foreign-live in the renderer (C10 execution document, M5): the holder notice's actions, Attach in a terminal tab over
// C9's Terminal tool and C8a's panel host (the terminal registry mocked, so the pins stop where C9's `pty.spawn`
// begins), one attach tab per job (remembered across a reload through the layout key, re-run at an idle prompt), the
// row menu's Attach, and the Attach a `held` answer or the engine's own refusal offers.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { HostState, MawsBridge } from '@shared/ipc/schema';
import { record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { runSessionAction, sessionActionsFor } from '../app/session-actions';
import { instanceOf, panelHost, registerPanelTool, resetPanelHost } from '../panel/host';
import { HolderNotice } from '../session/HolderNotice';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import type { TerminalInfo } from '../terminal/registry';
import { resetPanelStores } from '../test-support/panel';
import { resetSetupStore } from '../test-support/setup-intents';

const registry = vi.hoisted(() => {
  let infos: TerminalInfo[] = [];
  let next = 0;
  const foreground = { busy: true }; // `claude attach` holds the terminal until the owner detaches
  const host: HostState = { state: 'ready', pid: 1, restarts: 0, revision: 1 };
  const listeners = new Set<(infos: TerminalInfo[], host: HostState | null) => void>();
  const notify = () => listeners.forEach((cb) => cb(infos, host));
  return {
    foreground,
    reset() {
      infos = [];
      next = 0;
      foreground.busy = true;
    },
    exit(id: string) {
      infos = infos.map((info) => (info.id === id ? { ...info, status: 'exited' } : info));
      notify();
    },
    // the page (re)gains the tab's terminal: re-adopted after a reload, or a fresh shell started after an app restart
    start(label: string, appSessionId: string) {
      const id = `t${++next}`;
      infos = [...infos, { id, appSessionId, label, cwd: '/work/repo', ptyId: `pty-${id}`, status: 'running' } as unknown as TerminalInfo];
      notify();
    },
    terminals: {
      list: () => infos,
      host: () => host,
      subscribe: (cb: (infos: TerminalInfo[], host: HostState | null) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      open: vi.fn((init: { appSessionId: string; label: string; cwd: string; command?: string }) => {
        const id = `t${++next}`;
        infos = [...infos, { id, appSessionId: init.appSessionId, label: init.label, cwd: init.cwd, ptyId: `pty-${id}`, status: 'running' } as unknown as TerminalInfo];
        notify();
        return id;
      }),
      get: (id: string) => {
        const info = infos.find((i) => i.id === id);
        return info ? { info, renderer: null, container: document.createElement('div') } : undefined;
      },
      foreground: vi.fn(async () => (foreground.busy ? { process: '2.1.283', busy: true } : { process: 'zsh', busy: false })),
      close: async (id: string) => void (infos = infos.filter((info) => info.id !== id)),
      adopt: vi.fn(async (): Promise<string[]> => []),
    },
  };
});
vi.mock('../terminal/registry', () => ({ terminals: registry.terminals }));

const { terminalTool } = await import('../tools/terminal');
const { connectSessions } = await import('./connect');
const { forgetAttachTabs } = await import('./attach');
const { registerSessionActions } = await import('./actions');
const { resumeSession } = await import('./setup-actions');

const A = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const ENGINE = 'e1111111-1111-4111-8111-111111111111' as SessionId;
const PINNED = '/Users/new/.local/share/claude/versions/2.1.283';
const COMMAND = `'${PINNED}' attach e6dcd828`;
const JOB = { kind: 'background_job', pid: 4242, jobId: 'e6dcd828' } as const;

let fake: FakeClient;
let holders: { sessionId: SessionId; appSessionId: AppSessionId | null; holder: SessionRecord['holder']; cwd: string | null }[];
let offs: (() => void)[] = [];
let persisted: unknown = null; // main's layout.json value of `sessions.attachTabs`

function held(holder: SessionRecord['holder'], over: Partial<SessionRecord> = {}): SessionRecord {
  const r = record(A, { engineSessionId: ENGINE, directory: '/work/repo', holder, ...over });
  useSessions.setState({ records: new Map([[A, r]]) });
  return r;
}
// Main and the hosts as these pins need them; `over` adds or replaces answers, and an answer given as `null` is left to
// the test (`fake.reply` / `fake.fail`).
function answerWith(over: Parameters<typeof fakeClient>[0] = {}): void {
  const answers: Parameters<typeof fakeClient>[0] = {
    'fs.holders': () => ({ refreshedAt: '2026-09-29T00:00:00.000Z', holders }),
    'engine.binaryInfo': { path: PINNED, expectedVersion: '2.1.283', version: '2.1.283', ok: true, error: null },
    'session.fork': { status: 'refused', appSessionId: 'f1111111-1111-4111-8111-111111111111', reason: 'busy', message: 'a turn is running' },
    'session.intent.list': { intents: [] },
    'session.deletions.list': { manifests: [] },
    'layout.get': ({ key }: { key: string }) => ({ value: key === 'sessions.attachTabs' ? persisted : null }),
    'layout.set': ({ key, value }: { key: string; value: unknown }) => void (key === 'sessions.attachTabs' && (persisted = value)),
    'pty.write': undefined,
    ...over,
  };
  for (const [name, answer] of Object.entries(over)) if (answer === null) delete answers[name as keyof typeof answers];
  fake = fakeClient(answers);
  window.maws = fake.client;
}
const renderNotice = (r: SessionRecord) => render(<HolderNotice appSessionId={A} holder={r.holder as Extract<SessionRecord['holder'], { kind: 'terminal' | 'background_job' }>} />);
const opened = () => registry.terminals.open.mock.calls.map(([init]) => init);
const toasts = () => useNotices.getState().notices;
const attachButton = () => screen.getByRole('button', { name: 'Attach in a terminal tab' });

beforeEach(() => {
  resetPanelStores();
  resetSetupStore();
  registry.reset();
  vi.clearAllMocks();
  useNotices.setState({ notices: [] });
  forgetAttachTabs();
  persisted = null;
  holders = [{ sessionId: ENGINE, appSessionId: A, holder: JOB, cwd: '/work/repo/.claude/worktrees/job' }];
  answerWith();
  offs = [registerPanelTool(terminalTool), registerSessionActions()];
});
afterEach(() => {
  cleanup();
  offs.forEach((off) => off());
  delete (window as { maws?: MawsBridge }).maws;
});

describe('held outcomes and the attach command', () => {
  it("a job holder's notice attaches in a terminal tab: the pinned binary's attach, in the job's cwd", async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    const [init] = opened();
    expect(init).toMatchObject({ appSessionId: A, cwd: '/work/repo/.claude/worktrees/job', command: COMMAND });
    expect(fake.invoked('fs.holders')).toEqual([{ sessionIds: [ENGINE], directories: null }]);
    const tabs = useLayout.getState().panelTabsOf(A);
    expect(tabs.map((t) => [t.id, t.toolId])).toEqual([[init!.label, 'terminal']]); // the pty's label is the tab id
    expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBe(init!.label);
  });

  it('starts in the session directory when the registry does not name the job’s cwd', async () => {
    holders[0]!.cwd = null;
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toMatchObject([{ cwd: '/work/repo', command: COMMAND }]));
  });

  it('a second Attach shows the tab while the attach holds its terminal, re-runs it at an idle prompt, and opens another once the shell has ended', async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    const first = opened()[0]!.label;
    act(() => panelHost.showSummary());
    expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBeNull();
    await userEvent.click(attachButton());
    await waitFor(() => expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBe(first));
    expect(opened(), 'no second attach while the first runs').toHaveLength(1);
    expect(fake.invoked('pty.write'), 'nothing typed into a busy terminal').toEqual([]);

    registry.foreground.busy = false; // the owner left the attach with the TUI's key: the shell's prompt
    act(() => panelHost.showSummary());
    await userEvent.click(attachButton());
    await waitFor(() => expect(fake.invoked('pty.write')).toEqual([{ ptyId: 'pty-t1', data: `\x15${COMMAND}\n` }])); // ^U first: whatever was half-typed at the prompt is dropped
    expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBe(first);
    expect(opened(), 'the attach re-ran in the same tab').toHaveLength(1);

    registry.exit(registry.terminals.list()[0]!.id);
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(2));
    expect(opened()[1]!.label).not.toBe(first);
  });

  it('types nothing when the foreground cannot be read: the tab is only shown', async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    registry.terminals.foreground.mockRejectedValueOnce(new Error('pty.foreground failed: host unavailable'));
    await userEvent.click(attachButton());
    await waitFor(() => expect(registry.terminals.foreground).toHaveBeenCalledTimes(1));
    expect(fake.invoked('pty.write')).toEqual([]);
    expect(opened()).toHaveLength(1);
  });

  it('after a reload (the page forgets, the layout keeps the tab and its shell) Attach finds the job’s tab instead of opening a second', async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    const first = opened()[0]!.label;
    expect(persisted).toEqual({ version: 1, tabs: [{ tabId: first, appSessionId: A, jobId: 'e6dcd828' }] });
    forgetAttachTabs(); // a reload: the key is read again from main
    act(() => panelHost.showSummary());
    await userEvent.click(attachButton());
    await waitFor(() => expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBe(first));
    expect(opened()).toHaveLength(1);
    expect(fake.invoked('layout.get')).toEqual([{ key: 'sessions.attachTabs' }, { key: 'sessions.attachTabs' }]);
  });

  it('after a reload, before the page has re-adopted the tab’s shell or shown the tab, Attach shows the listed tab rather than opening a second', async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    const first = opened()[0]!.label;
    // a reload: the page forgets the key, the panel host has no instance yet, and C9 has not re-adopted the pty
    forgetAttachTabs();
    resetPanelHost();
    offs.push(registerPanelTool(terminalTool));
    registry.reset();
    act(() => panelHost.showSummary());
    expect(instanceOf(first)).toBeUndefined();
    await userEvent.click(attachButton());
    await waitFor(() => expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBe(first));
    expect(opened(), 'no second attach tab').toHaveLength(1);
    // C9 re-adopts the pty, where `claude attach` still holds the terminal: shown, nothing typed
    act(() => registry.start(first, A));
    await waitFor(() => expect(registry.terminals.foreground).toHaveBeenCalled());
    expect(fake.invoked('pty.write')).toEqual([]);
  });

  // (carried to M4b from the M5 review) after an app restart the remembered tab comes back with no pty: the page starts
  // a fresh shell for it once it shows, and the one Attach runs there as soon as that shell is running
  it('after an app restart, one Attach shows the remembered tab and runs the attach in its fresh shell once it is running', async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    const first = opened()[0]!.label;
    forgetAttachTabs();
    resetPanelHost();
    offs.push(registerPanelTool(terminalTool));
    registry.reset();
    registry.foreground.busy = false; // a fresh login shell at its prompt
    act(() => panelHost.showSummary());
    await userEvent.click(attachButton());
    await waitFor(() => expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBe(first));
    expect(fake.invoked('pty.write'), 'no shell yet').toEqual([]);
    act(() => registry.start(first, A));
    await waitFor(() => expect(fake.invoked('pty.write')).toEqual([{ ptyId: 'pty-t1', data: `\x15${COMMAND}\n` }])); // the fresh shell (the registry's ids restarted with the page)
    expect(opened(), 'no second attach tab').toHaveLength(1);
  });

  it('a failed read of the key is not taken for "no tabs": a later Attach reads it again and keeps what it holds', async () => {
    const B = 'b2222222-2222-4222-8222-222222222222' as AppSessionId;
    persisted = { version: 1, tabs: [{ tabId: 'terminal:other', appSessionId: B, jobId: 'aaaa1111' }] };
    useLayout.getState().setPanelTabs(B, { tabs: [{ id: 'terminal:other', toolId: 'terminal', pinned: false }], activeTabId: null });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    answerWith({ 'layout.get': null });
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await fake.fail('layout.get', 'layout.json unreadable'); // the lookup's read
    await fake.fail('layout.get', 'layout.json unreadable'); // remember's own read: still unreadable, so nothing is written
    await waitFor(() => expect(opened()).toHaveLength(1));
    expect(fake.invoked('layout.set'), 'an unread key is never overwritten').toEqual([]);
    expect(error).toHaveBeenCalledWith('[sessions] layout.get sessions.attachTabs failed', expect.objectContaining({ message: 'layout.json unreadable' }));
    error.mockRestore();
    registry.exit(registry.terminals.list()[0]!.id);
    await userEvent.click(attachButton());
    await fake.reply('layout.get', { value: persisted }); // read again, not the cached failure
    await waitFor(() => expect(opened()).toHaveLength(2));
    expect(persisted).toEqual({
      version: 1,
      tabs: [
        { tabId: 'terminal:other', appSessionId: B, jobId: 'aaaa1111' },
        { tabId: opened()[1]!.label, appSessionId: A, jobId: 'e6dcd828' },
      ],
    });
  });

  it('two Attaches for different sessions at once both keep their tab in the key', async () => {
    const B = 'b2222222-2222-4222-8222-222222222222' as AppSessionId;
    const ENGINE_B = 'e2222222-2222-4222-8222-222222222222' as SessionId;
    holders.push({ sessionId: ENGINE_B, appSessionId: B, holder: { kind: 'background_job', pid: 4343, jobId: 'bbbb2222' }, cwd: '/work/b' });
    const a = record(A, { engineSessionId: ENGINE, directory: '/work/repo', holder: JOB });
    const b = record(B, { engineSessionId: ENGINE_B, directory: '/work/b', holder: { kind: 'background_job', pid: 4343, jobId: 'bbbb2222' } });
    useSessions.setState({ records: new Map([[A, a], [B, b]]) });
    const { attachToJob } = await import('./attach');
    const [ra, rb] = await act(() => Promise.all([attachToJob(A), attachToJob(B)]));
    expect([ra.ok, rb.ok]).toEqual([true, true]);
    const tabs = (persisted as { tabs: { appSessionId: string; jobId: string }[] }).tabs.map((t) => [t.appSessionId, t.jobId]).sort();
    expect(tabs).toEqual([[A, 'e6dcd828'], [B, 'bbbb2222']].sort());
  });

  it('opens a new tab once the one it opened was closed', async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    const first = opened()[0]!.label;
    registry.foreground.busy = false; // a close asks while a program runs; this one is at its prompt
    await act(async () => void (await panelHost.closeTab(first)));
    expect(instanceOf(first)).toBeUndefined();
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(2));
    expect((persisted as { tabs: { tabId: string }[] }).tabs.map((t) => t.tabId), 'the closed tab is forgotten').toEqual([opened()[1]!.label]);
  });

  it('shows the panel when it was collapsed', async () => {
    useLayout.getState().setPanel({ collapsed: true });
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    expect(useLayout.getState().regions.panel.collapsed).toBe(false);
  });

  it('says so, and opens nothing, when the fresh read finds no job holding the session any more', async () => {
    holders = [];
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(toasts().map((n) => n.text)).toEqual(['No background job holds this session now; nothing to attach to']));
    expect(opened()).toEqual([]);
  });

  it('an unreadable registry is said, unless a held answer already named the job', async () => {
    answerWith({ 'fs.holders': null });
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await fake.fail('fs.holders', 'holder registry unreadable: EACCES');
    await waitFor(() => expect(toasts().map((n) => n.text)).toEqual(['holder registry unreadable: EACCES']));
    expect(opened()).toEqual([]);
    const { attachToJob } = await import('./attach');
    const attaching = attachToJob(A, { jobId: 'e6dcd828', command: COMMAND });
    await fake.fail('fs.holders', 'holder registry unreadable: EACCES');
    expect(await attaching).toMatchObject({ ok: true, how: 'opened' });
    expect(opened()).toMatchObject([{ cwd: '/work/repo', command: COMMAND }]);
  });

  it('a terminal holder and a job with no known id get no Attach; every holder gets "Fork a copy"', async () => {
    const { unmount } = renderNotice(held({ kind: 'terminal', pid: 7 }));
    expect(screen.queryByRole('button', { name: 'Attach in a terminal tab' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Fork a copy' }));
    await waitFor(() => expect(fake.invoked('session.fork')).toEqual([{ appSessionId: A, target: { kind: 'inPlace' }, message: null, rewindTo: null }]));
    await waitFor(() => expect(toasts().map((n) => n.text)).toEqual(['a turn is running']));
    unmount();
    renderNotice(held({ kind: 'background_job', pid: 9, jobId: null }));
    expect(screen.queryByRole('button', { name: 'Attach in a terminal tab' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
  });

  it('names the version the job runs when it is not the pinned one', async () => {
    const { unmount } = renderNotice(held(JOB, { engineVersion: '2.1.284' }));
    expect(await screen.findByText('Job on 2.1.284; attach runs 2.1.283')).toBeTruthy();
    unmount();
    renderNotice(held(JOB));
    await waitFor(() => expect(fake.invoked('engine.binaryInfo').length).toBeGreaterThan(0));
    expect(screen.queryByText(/^Job on/)).toBeNull();
  });

  it('the row menu offers Open and Attach for a job holder with an id, and Attach attaches', async () => {
    expect(sessionActionsFor(held(JOB))).toEqual(['open', 'openInNewTab', 'attach']);
    expect(sessionActionsFor(held({ kind: 'background_job', pid: 1, jobId: null }))).toEqual(['open', 'openInNewTab']);
    expect(sessionActionsFor(held({ kind: 'terminal', pid: 1 }))).toEqual(['open', 'openInNewTab']);
    expect(sessionActionsFor(held({ kind: 'none' }))).not.toContain('attach');
    expect(sessionActionsFor(held({ kind: 'self' }))).not.toContain('attach');
    held(JOB);
    act(() => runSessionAction('attach', A));
    await waitFor(() => expect(opened()).toMatchObject([{ appSessionId: A, command: COMMAND }]));
  });

  it("Resume answered held offers the job's Attach in its toast, with the command main named", async () => {
    held({ kind: 'none' });
    answerWith({ 'session.start': { status: 'held', appSessionId: A, holder: JOB, attach: { jobId: 'e6dcd828', command: COMMAND } } });
    await act(() => resumeSession(A));
    const [toast] = toasts();
    expect(toast).toMatchObject({ level: 'warning', text: 'Held by bg · e6dcd828' });
    expect(toast!.actions.map((a) => a.label)).toEqual(['Attach']);
    act(() => toast!.actions[0]!.run());
    await waitFor(() => expect(opened()).toMatchObject([{ cwd: '/work/repo/.claude/worktrees/job', command: COMMAND }]));
    expect(fake.invoked('engine.binaryInfo'), 'the command is the one main answered').toEqual([]);
  });

  it('a terminal holder’s held answer toasts without an Attach', async () => {
    held({ kind: 'none' });
    answerWith({ 'session.start': { status: 'held', appSessionId: A, holder: { kind: 'terminal', pid: 7 }, attach: null } });
    await act(() => resumeSession(A));
    expect(toasts()).toMatchObject([{ text: 'Held by terminal · 7', actions: [] }]);
  });

  it("the engine's own refusal of a resume (a setup failed held) toasts the holder with Attach, before the registry has the job", async () => {
    held({ kind: 'none' });
    holders = []; // MAWS's read lost the race: the job's registry record is not there yet
    const disconnect = connectSessions(fake.client); // the composition, which hands the setup store the Attach toast
    await waitFor(() => expect(fake.invoked('session.intent.list')).toHaveLength(1));
    act(() =>
      fake.event('session.setup', { appSessionId: A, phase: 'failed', detail: null, outcome: { kind: 'held', holder: { kind: 'background_job', pid: null, jobId: 'e6dcd828' }, attach: { jobId: 'e6dcd828', command: COMMAND } } }),
    );
    const [toast] = toasts();
    expect(toast).toMatchObject({ level: 'warning', text: 'Held by bg · e6dcd828' });
    act(() => toast!.actions.find((a) => a.label === 'Attach')!.run());
    await waitFor(() => expect(opened()).toMatchObject([{ cwd: '/work/repo', command: COMMAND }]));
    disconnect();
  });
});

// W7 (charter D-12 as amended 2026-10-01): "Take over here" on the foreign-live notice.
const { useDialogs } = await import('./dialogs');
describe('take over a session another process holds', () => {
  const answerConfirm = async (yes: boolean) => {
    await waitFor(() => expect(useDialogs.getState().open?.kind).toBe('confirm'));
    const open = useDialogs.getState().open as { kind: 'confirm'; title: string; body: string; answer(yes: boolean): void };
    act(() => {
      open.answer(yes);
      useDialogs.setState({ open: null });
    });
    return open;
  };

  it('is offered for a terminal and a job with an id, not for a job MAWS cannot name', () => {
    const { unmount } = renderNotice(held({ kind: 'terminal', pid: 7 }));
    expect(screen.getByRole('button', { name: 'Take over here' })).toBeTruthy();
    unmount();
    const second = renderNotice(held(JOB));
    expect(screen.getByRole('button', { name: 'Take over here' })).toBeTruthy();
    second.unmount();
    renderNotice(held({ kind: 'background_job', pid: 9, jobId: null }));
    expect(screen.queryByRole('button', { name: 'Take over here' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
  });

  it('confirms naming the holder and the loss, asks main to end it, then resumes the session here', async () => {
    answerWith({ 'session.takeOver': { status: 'released' }, 'session.start': { status: 'starting', appSessionId: A } });
    renderNotice(held({ kind: 'terminal', pid: 7 }));
    await userEvent.click(screen.getByRole('button', { name: 'Take over here' }));
    const asked = await answerConfirm(true);
    expect(asked.title).toBe('Take over this session?');
    expect(asked.body).toBe('MAWS ends the terminal process that holds this session (pid 7) and resumes the session here. A turn in progress there is lost.');
    await waitFor(() => expect(fake.invoked('session.start')).toEqual([{ appSessionId: A, message: null, options: {} }]));
    expect(fake.invoked('session.takeOver')).toEqual([{ appSessionId: A, holder: { kind: 'terminal', pid: 7 } }]);
  });

  it('does nothing when the confirm is cancelled, and says a refusal without resuming', async () => {
    answerWith({ 'session.takeOver': { status: 'refused', reason: 'timeout', message: 'The terminal (pid 7) has not exited after 10 s.' } });
    renderNotice(held({ kind: 'terminal', pid: 7 }));
    await userEvent.click(screen.getByRole('button', { name: 'Take over here' }));
    await answerConfirm(false);
    expect(fake.invoked('session.takeOver')).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Take over here' }));
    const asked = await answerConfirm(true);
    expect(asked.body).toContain('A turn in progress there is lost.');
    await waitFor(() => expect(toasts().map((n) => n.text)).toEqual(['The terminal (pid 7) has not exited after 10 s.']));
    expect(fake.invoked('session.start')).toEqual([]);
  });

  it("names a job by its short id and `claude stop`", () => {
    renderNotice(held(JOB));
    void userEvent.click(screen.getByRole('button', { name: 'Take over here' }));
    return answerConfirm(false).then((asked) => expect(asked.body).toBe('MAWS stops the background job bg · e6dcd828 (claude stop) and resumes the session here. A turn in progress there is lost.'));
  });
});
