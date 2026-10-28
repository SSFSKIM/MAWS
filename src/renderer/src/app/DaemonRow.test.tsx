// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "Status"): the Diagnostics strip's daemon row, read
// from main's `host.status`: the machine daemon this launch runs under (its kind, pid, build, machine ref, role and
// hosts), or why it runs none.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useHosts } from '../stores/hosts';
import { daemonShapeStatus, daemonStatus, hostStatus } from '../test-support/host-status';
import { DaemonRow, describeDaemon } from './DaemonRow';

describe('the daemon row’s text', () => {
  it('says unknown until main answers', () => {
    expect(describeDaemon(null)).toBe('mawsd · unknown');
  });

  it('reads the daemon this launch runs under, its hosts and its machine ref', () => {
    expect(describeDaemon(daemonShapeStatus())).toBe(
      'mawsd · private · pid 4100 · build ac8724a6 (a1b2c3d4e5f60718) · machine mRef0123456789abcdefAB · laptop · engine host ready pid 48213 · pty host ready pid 48300',
    );
    const unit = daemonStatus({ kind: 'unit', role: 'server', hosts: { 'engine-host': { state: 'parked', pid: null, build: null, liveSessions: null }, 'pty-host': { state: 'parked', pid: null, build: null, liveSessions: null } } });
    expect(describeDaemon(daemonShapeStatus({ daemon: unit }))).toBe('mawsd · at login · pid 4100 · build ac8724a6 (a1b2c3d4e5f60718) · machine mRef0123456789abcdefAB · server · engine host parked · pty host parked');
  });

  it('reads a daemon not yet answering', () => {
    expect(describeDaemon(daemonShapeStatus({ daemon: null }))).toBe('mawsd · connecting');
  });

  it('says why a launch the setting asks for the daemon runs embedded, and when the shape is embedded', () => {
    expect(describeDaemon(hostStatus({ daemonUnavailable: 'no LaunchAgent is installed' }))).toBe('mawsd · not in use this launch · no LaunchAgent is installed');
    expect(describeDaemon(hostStatus())).toBe('mawsd · not in use · MAWS runs its hosts itself');
  });
});

describe('the daemon row', () => {
  afterEach(() => {
    cleanup();
    useHosts.setState({ supervisor: null });
  });

  it('is an output named mawsd, with a dot for the daemon’s state', () => {
    useHosts.setState({ supervisor: daemonShapeStatus() });
    render(<DaemonRow />);
    const row = screen.getByRole('status', { name: 'mawsd' });
    expect(row.textContent).toContain('mawsd · private · pid 4100');
    expect(row.querySelector('[aria-hidden] span')?.className).toContain('bg-success');
  });

  it('dims its dot while no daemon runs this launch', () => {
    useHosts.setState({ supervisor: hostStatus({ daemonUnavailable: 'no LaunchAgent is installed' }) });
    render(<DaemonRow />);
    expect(screen.getByRole('status', { name: 'mawsd' }).querySelector('[aria-hidden] span')?.className).toContain('bg-fg-faint');
  });
});
