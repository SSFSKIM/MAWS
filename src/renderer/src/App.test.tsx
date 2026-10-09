import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostState, MawsBridge, SettingsState } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';
import { SUPERVISOR_NOTICES } from './app/copy';
import { updatedStatus } from './test-support/host-status';

const HOSTS: Record<'engine.hostState' | 'pty.hostState', HostState> = {
  'engine.hostState': { state: 'ready', pid: 1111, restarts: 0, revision: 1 },
  'pty.hostState': { state: 'ready', pid: 2222, restarts: 0, revision: 1 },
};

const GIT_STATUS = {
  repoRoot: '/private/tmp/maws-accept',
  gitDir: '/private/tmp/maws-accept/.git',
  commonDir: '/private/tmp/maws-accept/.git',
  isWorktree: false,
  branch: 'main',
  head: 'abcdef0123456789abcdef0123456789abcdef01',
  upstream: 'origin/main',
  remoteUrl: null,
  ahead: 1,
  behind: 0,
  dirty: true,
  files: [{ path: 'src/a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }],
  stashCount: 0,
  checkedAt: '2026-09-28T10:00:00.000Z',
};

// The page against a fake `window.maws` that behaves like main: `settings.set` answers the new state and emits
// `settings.changed` first, as the router does; both hosts are ready; the PTY host records a write to its shell and
// answers nothing until the test calls `answerEcho()`, which delivers the terminal's echo of the line and then the
// command's output and resolves `echoed`. No timer is involved, so "not yet answered" cannot race the delivery.
function fakeMain(initial: SettingsState['settings']['theme']) {
  let theme = initial;
  let markEchoed!: () => void;
  const echoed = new Promise<void>((resolve) => (markEchoed = resolve));
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const send = (name: string, payload: unknown) => listeners.get(name)?.forEach((l) => l(payload));
  let written = '';
  const answerEcho = () => {
    // Since C9 the stream is binary: each chunk is bytes stamped with its stream offset.
    const line = new TextEncoder().encode(`${written}\n`);
    send('pty.data', { ptyId: 'p1', offset: 0, data: line });
    send('pty.data', { ptyId: 'p1', offset: line.byteLength, data: new TextEncoder().encode('MAWS_ECHO_OK\r\n$ ') });
    markEchoed();
  };
  const state = () => ({ settings: { ...SETTINGS_DEFAULTS_V11, theme }, resolvedTheme: theme === 'dark' ? 'dark' : 'light' });
  const answer = (name: string, input: { theme: typeof theme; data: string }) => {
    switch (name) {
      case 'settings.set':
        theme = input.theme;
        send('settings.changed', state());
        return state();
      case 'settings.get':
        return state();
      case 'engine.hostState':
      case 'pty.hostState':
        return HOSTS[name];
      // E10: the supervisor's status the hosts store reads at connect (the engine host in the app, as under the harness)
      case 'host.status':
        return { transport: 'utility', state: 'ready', supervisor: null, appBuildId: 'b', appWire: 'w', mainBuild: { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' }, matches: null, reason: null, waitingLiveSessions: null, lastExit: null };
      case 'fs.state':
        return {
          configHome: '/Users/new/.claude',
          watching: true,
          projects: 1,
          sessions: 1,
          bound: 0,
          followed: [],
          holders: [],
          lastScanAt: '2026-09-28T10:00:01.000Z',
          lastScan: { projects: 3, sessions: 1, changed: 1, durationMs: 1234 },
        };
      case 'session.list':
        return { sessions: [], revision: 1 };
      case 'session.projects.list':
        return { projects: [{ id: 'p1', name: 'maws-accept', directory: '/private/tmp/maws-accept', order: 0, createdAt: '2026-09-28T10:00:00.000Z' }], revision: 1 };
      case 'session.replay.fixtures':
        return { fixtures: [{ id: 'f1', name: 'workflow', kind: 'journal', path: '/repo/spikes/protocol-probe/fixtures/pass2/workflow.jsonl', sessionId: null, addedAt: '2026-09-28T10:00:00.000Z', lastPlayedAt: null }] };
      case 'git.watch':
        return GIT_STATUS;
      case 'git.unwatch':
        return undefined;
      // C5 start: the shell's snapshots (the record side above is C4's)
      case 'session.digests':
        return { digests: [] };
      case 'engine.sessions': // the engine table at connect (debt wave 3)
        return [];
      case 'session.launchMode':
        return { mode: 'index' };
      case 'attention.list':
        return [];
      case 'attention.pendingNavigate':
        return { navigate: null };
      case 'layout.list':
        return { keys: [] };
      case 'layout.get':
        return { value: null };
      case 'layout.set':
      case 'layout.setEnabledActions':
      case 'session.setVisible':
        return undefined;
      // C5 end
      // C7 start: the status line's shared ClaudeUsage read (none installed here); its dismissed banners come through
      // `layout.get` above. The composer's slot and key registrations make no call on mount (no session is open).
      case 'settings.usage':
        return { available: false, dataDir: '/nowhere', readAt: '2026-09-28T10:00:00.000Z', error: 'absent', drainTarget: null, drainTargetIsManual: false, accounts: [], pinsFor: {}, gateway: null, codex: null, activity: null };
      // C7 end
      // C9 start: the page's terminal re-adoption reads the host's ptys on mount (none here), so no mount call reaches
      // the rejecting default (C7 M4a review)
      case 'pty.list':
        return { ptys: [] };
      // C9 end
      // C10 start: no unstarted sessions, no interrupted deletes
      case 'session.intent.list':
        return { intents: [] };
      case 'session.deletions.list':
        return { manifests: [] };
      // C10 end
      // C12 start: the memory budget's snapshot at connect (under budget, nothing held)
      case 'engine.budget':
        return { enabled: true, limitKiB: 8_388_608, totalKiB: 0, sampledAt: null, over: false, overWithoutCandidate: false, candidates: 0, settling: 0, releasing: null, blocked: [], lastRelease: null };
      // M4: Quit when idle's snapshot at connect (main is not waiting)
      case 'layout.quitWait':
        return { waiting: null };
      // C12 end
      // E4a start: the browser store's first list at connect (no tabs)
      case 'browser.tabs.list':
        return { tabs: [], selected: {} };
      // E4a end
      // E4b start: the import store's records at connect (none imported)
      case 'browser.import.list':
        return { profiles: [], fileBroken: false, running: null };
      // E4b end
      case 'pty.spawn':
        return { ptyId: 'p1', pid: 3333 };
      case 'pty.write':
        written = input.data;
        return undefined;
      default:
        throw new Error(`unexpected ${name}`);
    }
  };
  window.maws = {
    invoke: vi.fn(async (name: string, input: { theme: typeof theme; data: string }) => ({ ok: true, value: answer(name, input) })),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }),
  } as unknown as MawsBridge;
  current = { send };
  return { send, echoed, answerEcho };
}

let current: { send(name: string, payload: unknown): void } | null = null;

// The strip lives in the Diagnostics tab (C5 M4): the app opens, then Help › Diagnostics arrives from the menu.
async function renderApp() {
  vi.resetModules(); // a fresh settings store per test
  const { App } = await import('./App');
  await act(async () => void render(<App />));
  await act(async () => current!.send('layout.action', { action: 'diagnostics.open', arg: null }));
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
}

describe('theme in the page', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light';
  });
  afterEach(() => {
    cleanup();
    delete (window as { maws?: MawsBridge }).maws;
  });

  it('mirrors the persisted theme onto <html data-theme>', async () => {
    fakeMain('dark');
    await renderApp();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches through settings.set when a theme is chosen in the diagnostics strip', async () => {
    fakeMain('light');
    await renderApp();
    expect(document.documentElement.dataset.theme).toBe('light');
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Dark' })));
    expect(window.maws.invoke).toHaveBeenCalledWith('settings.set', { theme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('renders the strip inside the main region', async () => {
    fakeMain('light');
    await renderApp();
    const strip = screen.getByRole('region', { name: 'Diagnostics' });
    expect(strip.closest('[data-region]')?.getAttribute('data-region')).toBe('main');
  });
});

describe('hosts in the diagnostics strip', () => {
  afterEach(() => {
    cleanup();
    delete (window as { maws?: MawsBridge }).maws;
  });

  it('reads both hosts ready with their pids from the snapshots', async () => {
    fakeMain('light');
    await renderApp();
    expect(screen.getByRole('status', { name: 'engine host' }).textContent).toBe('engine host · ready · pid 1111');
    expect(screen.getByRole('status', { name: 'pty host' }).textContent).toBe('pty host · ready · pid 2222');
  });

  it('follows a host through crashed, restarting and ready', async () => {
    const main = fakeMain('light');
    await renderApp();
    const pty = () => screen.getByRole('status', { name: 'pty host' }).textContent;
    act(() => main.send('pty.hostState', { state: 'crashed', pid: 2222, restarts: 0, revision: 2 }));
    expect(pty()).toBe('pty host · crashed · pid 2222');
    act(() => main.send('pty.hostState', { state: 'restarting', pid: null, restarts: 1, revision: 3 }));
    expect(pty()).toBe('pty host · restarting');
    act(() => main.send('pty.hostState', { state: 'ready', pid: 4444, restarts: 1, revision: 4 }));
    expect(pty()).toBe('pty host · ready · pid 4444');
  });

  // E10: the root connects the hosts store, so the supervisor's banners show wherever the window is.
  it('shows the supervisor row, and the update banner when an older build serves live sessions', async () => {
    const main = fakeMain('light');
    await renderApp();
    expect(screen.getByRole('status', { name: 'supervisor' }).textContent).toBe('supervisor · utility · starting · no unexpected exit');
    act(() => main.send('host.status', updatedStatus(2)));
    expect(screen.getByText(SUPERVISOR_NOTICES.updated(2))).toBeTruthy();
    expect(screen.getByRole('status', { name: 'supervisor' }).textContent).toContain('build differs · 2 sessions held');
  });

  it('shows the shell data counts once the stores have loaded (C5 M1)', async () => {
    fakeMain('light');
    await renderApp();
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    expect(screen.getByRole('status', { name: 'shell data' }).textContent).toBe('sessions · 0 · needs you · 0 · layout · hydrated');
  });

  it('runs the echo test and shows the output line with the shell’s pid', async () => {
    const main = fakeMain('light');
    await renderApp();
    const echo = () => screen.getByRole('status', { name: 'echo test' }).textContent;
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Spawn echo test' })));
    // Until the shell answers, nothing in the strip may contain the marker a reader (or the smoke) looks for.
    expect(echo()).not.toBe('');
    expect(echo()).not.toContain('MAWS_ECHO_OK');
    // The shell answers only now: the store settles synchronously inside the second `pty.data` delivery, so its
    // state is set before `echoed` resumes this callback and act renders it.
    await act(async () => {
      main.answerEcho();
      await main.echoed;
    });
    expect(window.maws.invoke).toHaveBeenCalledWith('pty.spawn', expect.objectContaining({ shell: '/bin/sh' }));
    expect(echo()).toBe('MAWS_ECHO_OK · shell pid 3333');
  });
});

describe('store section of the diagnostics strip', () => {
  afterEach(() => {
    cleanup();
    delete (window as { maws?: MawsBridge }).maws;
  });

  it('shows the watched config home, the counts (projects from the index), and each record with its title, source, directory, pin and holder badge', async () => {
    const main = fakeMain('light');
    await renderApp();
    expect(screen.getByRole('status', { name: 'store' }).textContent).toBe('store · /Users/new/.claude · watching');
    expect(screen.getByRole('status', { name: 'store scan' }).textContent).toBe('projects 1 · sessions 1 · scan 1.2 s');
    // Replay (M5): the fixtures the index lists, ready to start.
    expect(within(screen.getByRole('combobox', { name: 'Replay fixture' })).getByRole('option').textContent).toBe('workflow · journal');

    const record = {
      appId: 'aaaaaaaa-1111-4111-8111-111111111111',
      engineSessionId: '11111111-1111-4111-8111-111111111111',
      projectId: 'p1',
      directory: '/private/tmp/maws-accept',
      additionalDirectories: [],
      worktree: null,
      branch: null,
      title: { text: 'Remembering fruit', source: 'generated' },
      pinned: false,
      archived: false,
      holder: { kind: 'terminal', pid: 78212 },
      lastSeen: { messageUuid: null, at: null },
      unread: false,
      engineVersion: '2.1.283',
      gateway: { routed: true, baseUrl: null, autoModeServer: 'unknown' },
      model: { requested: null, resolved: null },
      effort: null,
      permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
      lineage: null,
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
    };
    await act(async () => {
      main.send('session.changed', { record, cause: 'discovered', revision: 2 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const row = within(screen.getByRole('list', { name: 'Discovered sessions' })).getByRole('listitem');
    expect(row.textContent).toBe('Remembering fruitgenerated/private/tmp/maws-acceptterminal · 78212FollowGit');

    await act(async () => {
      main.send('session.changed', { record: { ...record, pinned: true, holder: { kind: 'none' } }, cause: 'holder', revision: 3 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(row.textContent).toBe('pinRemembering fruitgenerated/private/tmp/maws-acceptFollowGit');

    // Git (M6): the row's Git button watches its directory; the detail reads branch, ahead/behind and the dirty count,
    // lists the files, and follows git.changed.
    await act(async () => void fireEvent.click(within(row).getByRole('button', { name: 'Git' })));
    expect(window.maws.invoke).toHaveBeenCalledWith('git.watch', { directory: '/private/tmp/maws-accept' });
    expect(screen.getByRole('status', { name: 'git status' }).textContent).toBe('main · ahead 1 / behind 0 · dirty · 1 file');
    const untracked = { path: '.c4-accept', oldPath: null, index: '?', worktree: '?', untracked: true };
    act(() => main.send('git.changed', { repoRoot: GIT_STATUS.repoRoot, status: { ...GIT_STATUS, files: [...GIT_STATUS.files, untracked] }, reason: 'worktree' }));
    expect(screen.getByRole('status', { name: 'git status' }).textContent).toBe('main · ahead 1 / behind 0 · dirty · 2 files');
    expect(within(screen.getByRole('list', { name: 'Changed files' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['.M src/a.ts', '?? .c4-accept']);
    await act(async () => void fireEvent.click(within(row).getByRole('button', { name: 'Git' })));
    expect(window.maws.invoke).toHaveBeenCalledWith('git.unwatch', { directory: '/private/tmp/maws-accept' });
    expect(screen.queryByRole('status', { name: 'git status' })).toBeNull();
  });
});

// C7 start
describe("C7's registrations from the app", () => {
  afterEach(() => {
    cleanup();
    delete (window as { maws?: MawsBridge }).maws;
  });

  it("registers the composer's edit-and-resubmit adapter as the transcript's editAndResubmit", async () => {
    fakeMain('light');
    await renderApp();
    const [{ registeredActions }, { editAndResubmitRow }] = await Promise.all([import('./transcript'), import('./composer')]);
    expect(registeredActions().editAndResubmit).toBe(editAndResubmitRow);
  });
});
// C7 end
