// Foreign-live in the renderer (C10 execution document, M5): the holder notice's actions, Attach in a terminal tab over
// C9's Terminal tool and C8a's panel host (the terminal registry mocked, so the pins stop where C9's `pty.spawn`
// begins), the de-duplication by the tab the attach opened, the row menu's Attach, and the Attach a `held` answer or
// the engine's own refusal offers.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { HostState, MawsBridge } from '@shared/ipc/schema';
import { record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { runSessionAction, sessionActionsFor } from '../app/session-actions';
import { instanceOf, panelHost, registerPanelTool } from '../panel/host';
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
  const host: HostState = { state: 'ready', pid: 1, restarts: 0, revision: 1 };
  return {
    reset() {
      infos = [];
      next = 0;
    },
    exit(id: string) {
      infos = infos.map((info) => (info.id === id ? { ...info, status: 'exited' } : info));
    },
    terminals: {
      list: () => infos,
      host: () => host,
      subscribe: () => () => {},
      open: vi.fn((init: { appSessionId: string; label: string; cwd: string; command?: string }) => {
        const id = `t${++next}`;
        infos = [...infos, { id, appSessionId: init.appSessionId, label: init.label, cwd: init.cwd, status: 'running' } as unknown as TerminalInfo];
        return id;
      }),
      get: (id: string) => {
        const info = infos.find((i) => i.id === id);
        return info ? { info, renderer: null, container: document.createElement('div') } : undefined;
      },
      foreground: async () => ({ process: 'zsh', busy: false }),
      close: async (id: string) => void (infos = infos.filter((info) => info.id !== id)),
      adopt: vi.fn(async (): Promise<string[]> => []),
    },
  };
});
vi.mock('../terminal/registry', () => ({ terminals: registry.terminals }));

const { terminalTool } = await import('../tools/terminal');
const { connectSetup } = await import('./store');
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

  it('focuses the tab it opened while that terminal runs, and opens another once it has ended', async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    const first = opened()[0]!.label;
    act(() => panelHost.showSummary());
    expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBeNull();
    await userEvent.click(attachButton());
    await waitFor(() => expect(useLayout.getState().panelBySession.get(A)?.activeTabId).toBe(first));
    expect(opened(), 'no second attach while the first runs').toHaveLength(1);
    registry.exit(registry.terminals.list()[0]!.id);
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(2));
    expect(opened()[1]!.label).not.toBe(first);
  });

  it('opens a new tab once the one it opened was closed', async () => {
    renderNotice(held(JOB));
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(1));
    const first = opened()[0]!.label;
    await act(async () => void (await panelHost.closeTab(first)));
    expect(instanceOf(first)).toBeUndefined();
    await userEvent.click(attachButton());
    await waitFor(() => expect(opened()).toHaveLength(2));
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
    expect(await attaching).toMatchObject({ ok: true, reused: false });
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
    expect(sessionActionsFor(held(JOB))).toEqual(['open', 'attach']);
    expect(sessionActionsFor(held({ kind: 'background_job', pid: 1, jobId: null }))).toEqual(['open']);
    expect(sessionActionsFor(held({ kind: 'terminal', pid: 1 }))).toEqual(['open']);
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
    const setup = connectSetup(fake.client);
    await setup.ready;
    act(() =>
      fake.event('session.setup', { appSessionId: A, phase: 'failed', detail: null, outcome: { kind: 'held', holder: { kind: 'background_job', pid: null, jobId: 'e6dcd828' }, attach: { jobId: 'e6dcd828', command: COMMAND } } }),
    );
    const [toast] = toasts();
    expect(toast).toMatchObject({ level: 'warning', text: 'Held by bg · e6dcd828' });
    act(() => toast!.actions.find((a) => a.label === 'Attach')!.run());
    await waitFor(() => expect(opened()).toMatchObject([{ cwd: '/work/repo', command: COMMAND }]));
    setup.disconnect();
  });
});
