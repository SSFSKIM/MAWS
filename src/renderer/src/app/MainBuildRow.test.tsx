// E11's sitting (owner-notes 00-consolidated-plan §2.7): Diagnostics names the build main is running (its commit and
// build time, from main's `host.status`), on a row of its own, apart from the supervisor's bundle and pid.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useHosts } from '../stores/hosts';
import { hostStatus, MAIN_BUILT } from '../test-support/host-status';
import { describeMainBuild, MainBuildRow } from './MainBuildRow';

afterEach(() => {
  cleanup();
  useHosts.setState({ supervisor: null });
});

describe("Diagnostics' app build row", () => {
  it('says unknown until main answers, then the version, commit and local build time', () => {
    expect(describeMainBuild(null)).toBe('MAWS · build unknown');
    expect(describeMainBuild(hostStatus())).toBe('MAWS 0.0.0 · build ac8724a6 · built Oct 8, 02:05');
    expect(MAIN_BUILT).toBe(new Date(2026, 9, 8, 2, 5).toISOString());
  });

  it('renders as its own output, labelled apart from the supervisor', () => {
    useHosts.setState({ supervisor: hostStatus() });
    render(<MainBuildRow />);
    expect(screen.getByRole('status', { name: 'MAWS build' }).textContent).toBe('MAWS 0.0.0 · build ac8724a6 · built Oct 8, 02:05');
  });
});
