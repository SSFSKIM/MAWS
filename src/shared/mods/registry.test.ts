import { describe, expect, it } from 'vitest';
import { TO_HUMAN_CONTRACT_VERSION } from '../owner/contract';
import { BUILT_IN_MODS, ModRowSchema } from './registry';

describe('the built-in mods registry (X20)', () => {
  it('holds one mod, to-human, at the contract’s version', () => {
    expect(BUILT_IN_MODS.map((mod) => [mod.id, mod.version])).toEqual([['maws.to-human', TO_HUMAN_CONTRACT_VERSION]]);
  });

  it('a row is the mod plus its state; a session’s row adds the override and what is pending', () => {
    const [mod] = BUILT_IN_MODS;
    expect(ModRowSchema.parse({ ...mod, enabled: true, source: 'maws-contract' })).toEqual({ ...mod, enabled: true, source: 'maws-contract' });
    const row = { ...mod, enabled: true, source: 'off', perSession: 'off', pending: 'next-launch', mismatch: { resolved: 'default', observed: 'doperpowers:to-human' } };
    expect(ModRowSchema.parse(row)).toEqual(row);
    expect(ModRowSchema.safeParse({ ...mod, id: 'maws.other', enabled: true, source: 'off' }).success).toBe(false);
  });
});
