// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "Status"): the Diagnostics strip's daemon row, read
// from main's `host.status`: the machine daemon this launch runs under (its kind, pid, build, machine ref, role and
// hosts). P5 O15 M2: every launch that reaches the app runs under it, so no case reads a launch without it.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useHosts } from '../stores/hosts';
import { daemonStatus, hostStatus } from '../test-support/host-status';
import { DaemonRow, describeDaemon, describeSpine, SpineRow } from './DaemonRow';

describe('the daemon row’s text', () => {
  it('says unknown until main answers', () => {
    expect(describeDaemon(null)).toBe('mawsd · unknown');
  });

  it('reads the daemon this launch runs under, its hosts and its machine ref', () => {
    expect(describeDaemon(hostStatus())).toBe(
      'mawsd · private · pid 4100 · build ac8724a6 (a1b2c3d4e5f60718) · machine mRef0123456789abcdefAB · laptop · engine host ready pid 48213 · pty host ready pid 48300',
    );
    const unit = daemonStatus({ kind: 'unit', role: 'server', hosts: { 'engine-host': { state: 'parked', pid: null, build: null, liveSessions: null }, 'pty-host': { state: 'parked', pid: null, build: null, liveSessions: null } } });
    expect(describeDaemon(hostStatus({ daemon: unit }))).toBe('mawsd · at login · pid 4100 · build ac8724a6 (a1b2c3d4e5f60718) · machine mRef0123456789abcdefAB · server · engine host parked · pty host parked');
  });

  it('reads a daemon not yet answering', () => {
    expect(describeDaemon(hostStatus({ daemon: null }))).toBe('mawsd · connecting');
  });
});

describe('the daemon row', () => {
  afterEach(() => {
    cleanup();
    useHosts.setState({ supervisor: null });
  });

  it('is an output named mawsd, with a dot for the daemon’s state', () => {
    useHosts.setState({ supervisor: hostStatus() });
    render(<DaemonRow />);
    const row = screen.getByRole('status', { name: 'mawsd' });
    expect(row.textContent).toContain('mawsd · private · pid 4100');
    expect(row.querySelector('[aria-hidden] span')?.className).toContain('bg-success');
  });

  it('warns with its dot while the daemon does not answer yet, and dims it until main answers', () => {
    useHosts.setState({ supervisor: hostStatus({ daemon: null }) });
    const { unmount } = render(<DaemonRow />);
    expect(screen.getByRole('status', { name: 'mawsd' }).querySelector('[aria-hidden] span')?.className).toContain('bg-warning');
    unmount();
    useHosts.setState({ supervisor: null });
    render(<DaemonRow />);
    const row = screen.getByRole('status', { name: 'mawsd' });
    expect(row.textContent).toBe('mawsd · unknown');
    expect(row.querySelector('[aria-hidden] span')?.className).toContain('bg-fg-faint');
  });
});

// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §2): a run refused the spine names the holder in Diagnostics
describe('the machine data row', () => {
  const refused = 'spine.lock is held by pid 4242 (build 1.0.0+abc), so this run starts none of the machine’s services and writes none of its files';
  afterEach(() => {
    cleanup();
    useHosts.setState({ supervisor: null });
  });

  it('says nothing while this run holds the lock, or a build before the lock answers', () => {
    expect(describeSpine(null)).toBeNull();
    expect(describeSpine(hostStatus({ spineRefused: null }))).toBeNull();
    expect(describeSpine(hostStatus())).toBeNull();
    useHosts.setState({ supervisor: hostStatus({ spineRefused: null }) });
    render(<SpineRow />);
    expect(screen.queryByRole('status', { name: 'machine data' })).toBeNull();
  });

  it('names the holder when refused, with a warning dot', () => {
    expect(describeSpine(hostStatus({ spineRefused: refused }))).toBe(`machine data · refused this launch · ${refused}`);
    useHosts.setState({ supervisor: hostStatus({ spineRefused: refused }) });
    render(<SpineRow />);
    const row = screen.getByRole('status', { name: 'machine data' });
    expect(row.textContent).toContain('pid 4242 (build 1.0.0+abc)');
    expect(row.querySelector('[aria-hidden] span')?.className).toContain('bg-warning');
  });
});
