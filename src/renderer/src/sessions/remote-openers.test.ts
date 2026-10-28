import { describe, expect, it, vi } from 'vitest';
import { registerRemoteOpener, remoteOpenerFor } from './remote-openers';

// P5 O8 M2: a lane's opener, registered by the lane's owner.
describe('remote openers', () => {
  it('answers each lane’s registered opener, none before one registers, and none after it unregisters', () => {
    expect(remoteOpenerFor('A')).toBeNull();
    const openB = vi.fn();
    const off = registerRemoteOpener('B', openB);
    expect(remoteOpenerFor('B')).toBe(openB);
    expect(remoteOpenerFor('A')).toBeNull();
    off();
    expect(remoteOpenerFor('B')).toBeNull();
  });

  it('a later registration replaces the earlier, whose unregister then leaves the later in place', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerRemoteOpener('A', first);
    const offSecond = registerRemoteOpener('A', second);
    offFirst();
    expect(remoteOpenerFor('A')).toBe(second);
    offSecond();
    expect(remoteOpenerFor('A')).toBeNull();
  });
});
