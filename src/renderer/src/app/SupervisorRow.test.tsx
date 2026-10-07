// E10 Task 3.3 (E10 execution document, §Design 11; Decision Log 90f959f4): the Diagnostics strip's supervisor row,
// read from main's `host.status`: mode, pid, build, sessions held, idle exit, orphans killed, socket, the last
// unexpected exit; Open log through `host.openLog`; while waiting on an incompatible supervisor it says so and offers
// Restart now.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import { useHosts } from '../stores/hosts';
import { useNotices } from '../stores/notices';
import { hostStatus, supervisorStatus, updatedStatus, waitingStatus } from '../test-support/host-status';
import { describeSupervisor, SupervisorRow } from './SupervisorRow';

const AT = new Date(2026, 9, 6, 14, 2).toISOString(); // 14:02 local
const crashed = (over: Partial<HostStatus> = {}) => hostStatus({ state: 'crashed', supervisor: null, matches: null, ...over });

describe('the supervisor row’s text', () => {
  it('says unknown until main answers', () => {
    expect(describeSupervisor(null)).toBe('supervisor · unknown');
  });

  it('reads a running supervisor of this build', () => {
    expect(describeSupervisor(hostStatus())).toBe(
      'supervisor · detached · pid 48213 · build matches · 3 sessions held · idle exit 10 min · orphans killed 0 · socket /u/supervisor/host.sock · no unexpected exit',
    );
  });

  it('reads an older build serving its sessions until they go idle, a never-exiting one, and the e2e seam in seconds', () => {
    expect(describeSupervisor(updatedStatus(1))).toBe(
      'supervisor · detached · pid 48213 · build differs · 1 session held · exits when its last session ends · orphans killed 0 · socket /u/supervisor/host.sock · no unexpected exit',
    );
    expect(describeSupervisor(hostStatus({ supervisor: supervisorStatus({ idleExitMs: null, orphansKilled: 2 }) }))).toContain('idle exit never · orphans killed 2');
    expect(describeSupervisor(hostStatus({ supervisor: supervisorStatus({ idleExitMs: 5_000 }) }))).toContain('idle exit 5 s');
  });

  it('reads the engine host inside the app (utility mode) with no socket', () => {
    const utility = hostStatus({ transport: 'utility', supervisor: supervisorStatus({ mode: 'utility', pid: 1111, liveSessions: 0, socketPath: null, logPath: null }) });
    expect(describeSupervisor(utility)).toBe('supervisor · utility · pid 1111 · build matches · 0 sessions held · ends with MAWS · orphans killed 0 · no unexpected exit');
  });

  it('says it waits on an incompatible supervisor, and why', () => {
    expect(describeSupervisor(waitingStatus(2))).toBe("supervisor · detached · waiting · the previous version's supervisor still runs 2 sessions · wire differs · no unexpected exit");
  });

  it('reads the states between and after supervisors, with the last unexpected exit', () => {
    expect(describeSupervisor(hostStatus({ state: 'starting', supervisor: null, matches: null }))).toBe('supervisor · detached · starting · no unexpected exit');
    expect(describeSupervisor(crashed({ reason: 'held_lock' }))).toBe('supervisor · detached · not running · another supervisor holds its lock and does not answer · no unexpected exit');
    expect(describeSupervisor(crashed({ lastExit: { code: 1, signal: null, at: AT, interrupted: 2 } }))).toBe('supervisor · detached · not running · last unexpected exit 14:02 (exit 1) · 2 interrupted');
    expect(describeSupervisor(hostStatus({ state: 'restarting', supervisor: null, matches: null, lastExit: { code: null, signal: 'SIGKILL', at: AT, interrupted: 1 } }))).toBe(
      'supervisor · detached · restarting · last unexpected exit 14:02 (SIGKILL) · 1 interrupted',
    );
    expect(describeSupervisor(hostStatus({ lastExit: { code: null, signal: null, at: AT, interrupted: 0 } }))).toContain('· last unexpected exit 14:02 · 0 interrupted');
  });
});

describe('the supervisor row', () => {
  let invoke: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    invoke = vi.fn(async () => ({ ok: true, value: undefined }));
    window.maws = { invoke, on: vi.fn(() => () => {}) } as unknown as MawsBridge;
    useNotices.setState({ notices: [] });
  });
  afterEach(() => {
    cleanup();
    useHosts.setState({ supervisor: null });
  });

  const show = (status: HostStatus | null) => {
    useHosts.setState({ supervisor: status });
    render(<SupervisorRow />);
  };

  it('shows the status and opens the log through main', async () => {
    show(hostStatus());
    expect(screen.getByRole('status', { name: 'supervisor' }).textContent).toBe(describeSupervisor(hostStatus()));
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Open log' })));
    expect(invoke).toHaveBeenCalledWith('host.openLog', undefined);
  });

  it('a log that does not open is a warning toast with the reason', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: '/u/supervisor/host.log could not be opened: gone' } });
    show(hostStatus());
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Open log' })));
    expect(useNotices.getState().notices.map((n) => [n.kind, n.level, n.text])).toEqual([['toast', 'warning', "The supervisor's log did not open · /u/supervisor/host.log could not be opened: gone"]]);
  });

  it('offers no log for the engine host inside the app', () => {
    show(hostStatus({ transport: 'utility', supervisor: supervisorStatus({ mode: 'utility', socketPath: null, logPath: null }) }));
    expect(screen.queryByRole('button', { name: 'Open log' })).toBeNull();
  });

  it('while waiting on an incompatible supervisor it offers Restart now, which restarts it', async () => {
    show(waitingStatus(2));
    expect(screen.getByRole('status', { name: 'supervisor' }).textContent).toContain('waiting');
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Restart now' })));
    expect(invoke).toHaveBeenCalledWith('host.restart', { stopSessions: true });
    expect(screen.getByRole('button', { name: 'Open log' })).toBeTruthy(); // the log still opens while it is not reachable
  });

  it('offers Restart now whenever no supervisor runs (a held lock, the crash limit)', () => {
    show(crashed({ reason: 'held_lock' }));
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
  });
});
