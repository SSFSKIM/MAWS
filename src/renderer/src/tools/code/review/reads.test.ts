// Whether a machine serves the three reads, and what a failed read was (UX wave U5b-2,
// docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §E and §H's "Refusals told apart").
import { describe, expect, it } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { readFailure, servesReads } from './reads';

describe('servesReads (UX wave U5b-2)', () => {
  it('is true where the machine lists rl2.git-reads, false where it lists capabilities without it, null while it lists none or the window holds no roster', () => {
    const machines = new Map<MachineRef, { capabilities?: string[] }>([
      [TEST_MACHINE, { capabilities: ['rl2.project-acts', 'rl2.git-reads'] }],
      [OTHER_MACHINE, { capabilities: ['rl2.session-acts'] }],
    ]);
    expect(servesReads(TEST_MACHINE, machines)).toBe(true);
    expect(servesReads(OTHER_MACHINE, machines)).toBe(false);
    expect(servesReads(OTHER_MACHINE, new Map([[OTHER_MACHINE, {}]]))).toBeNull(); // its link has listed none yet
    expect(servesReads(TEST_MACHINE, new Map())).toBeNull(); // no roster
  });
});

describe('readFailure (UX wave U5b-2)', () => {
  it('tells an older machine, an offline one, a refusal and git’s failure apart', () => {
    expect(readFailure({ message: 'no such command', code: 'unknown_command' }, false)).toEqual({ kind: 'older' });
    expect(readFailure({ message: 'not offered', refusal: 'not-offered' }, false)).toEqual({ kind: 'older' });
    expect(readFailure({ message: 'the link dropped', code: 'host_unavailable' }, false)).toEqual({ kind: 'offline' });
    expect(readFailure({ message: 'no answer in 10 s', code: 'timeout' }, false)).toEqual({ kind: 'offline' });
    expect(readFailure({ message: 'fatal: bad object' }, true)).toEqual({ kind: 'offline' }); // the machine's phase is offline
    expect(readFailure({ message: 'refused', refusal: 'no-target' }, false)).toEqual({ kind: 'refused', refusal: 'no-target' });
    expect(readFailure({ message: 'fatal: bad object 3f9a1c2' }, false)).toEqual({ kind: 'failed', message: 'fatal: bad object 3f9a1c2' });
  });
});
