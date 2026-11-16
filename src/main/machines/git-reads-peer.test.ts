// Whether this Mac's machine serves the git reads (UX wave U5b-2, M8; docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md
// §D, "This Mac's daemon"): its daemon may be of an older build than the window, so the local machine lists
// `rl2.git-reads` by its daemon's welcome, as another machine lists it in its handshake, beside the project acts.
import { describe, expect, it } from 'vitest';
import { GIT_READS_CAPABILITY } from '@shared/ipc/schema/git';
import { PROJECT_ACTS_CAPABILITY } from '@shared/ipc/schema/session';
import { WIRE_MINOR, type WirePeer } from '@shared/ipc/wire';
import { GIT_READS_MINOR, joinCapabilitySources, localGitReads, localGitReadsSource } from './git-reads-peer';
import { localProjectActsSource, PROJECT_ACTS_MINOR } from './project-acts-peer';

const peer = (minor: number): WirePeer => ({ major: 3, minor, build: 'theirs', capabilities: [] });

/** The machine host as main reads it: the welcomed daemon's minor (null: none welcomed), and its state's changes. */
function hostsOf() {
  let minor: number | null = null;
  const listeners = new Set<() => void>();
  return {
    hosts: { peer: () => (minor === null ? null : peer(minor)), onState: (_owner: 'machine', listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)) },
    welcome(next: number | null) {
      minor = next;
      for (const listener of [...listeners]) listener();
    },
    listeners,
  };
}

describe('this Mac’s machine and the git reads', () => {
  it('lists `rl2.git-reads` while its daemon’s wire is the reads’ minor or later, none below it, unknown before its welcome', () => {
    expect(localGitReads(peer(GIT_READS_MINOR))).toEqual([GIT_READS_CAPABILITY]);
    expect(localGitReads(peer(GIT_READS_MINOR + 1))).toEqual([GIT_READS_CAPABILITY]);
    expect(localGitReads(peer(GIT_READS_MINOR - 1))).toEqual([]);
    expect(localGitReads(null)).toBeNull();
  });

  it('takes the reads’ minor no later than the wire this build speaks, so its own daemon lists them', () => {
    expect(GIT_READS_MINOR).toBeLessThanOrEqual(WIRE_MINOR);
    expect(localGitReads(peer(WIRE_MINOR))).toEqual([GIT_READS_CAPABILITY]);
  });

  it('reads the attached daemon, and hears its state', () => {
    const h = hostsOf();
    const source = localGitReadsSource(h.hosts);
    expect(source.read()).toBeNull();
    let told = 0;
    const off = source.onChange(() => void told++);
    h.welcome(GIT_READS_MINOR - 1);
    expect([told, source.read()]).toEqual([1, []]);
    h.welcome(GIT_READS_MINOR);
    expect([told, source.read()]).toEqual([2, [GIT_READS_CAPABILITY]]);
    off();
    expect(h.listeners.size).toBe(0);
  });

  it('joins the project acts’ source: one list of what the daemon serves, unknown before its welcome, and lets go of both', () => {
    const h = hostsOf();
    const source = joinCapabilitySources(localProjectActsSource(h.hosts), localGitReadsSource(h.hosts));
    expect(source.read()).toBeNull();
    let told = 0;
    const off = source.onChange(() => void told++);
    // each source hears the daemon's state, so a change is told at least once (once a source)
    const welcomed = (minor: number | null) => {
      const before = told;
      h.welcome(minor);
      expect(told).toBeGreaterThan(before);
      return source.read();
    };
    expect(welcomed(PROJECT_ACTS_MINOR - 1)).toEqual([]);
    expect(welcomed(GIT_READS_MINOR - 1)).toEqual([PROJECT_ACTS_CAPABILITY]);
    expect(welcomed(GIT_READS_MINOR)).toEqual([PROJECT_ACTS_CAPABILITY, GIT_READS_CAPABILITY]);
    expect(welcomed(null)).toBeNull();
    off();
    expect(h.listeners.size).toBe(0);
  });
});
