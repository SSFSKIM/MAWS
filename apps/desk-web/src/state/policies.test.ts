// The member's policy rows as the registry socket gives them (P5 O18 M2b): a `policies` frame replaces the set whole,
// a `policy` frame sets or drops one row, and a row that isn't one (an audience unsorted or empty, a revision that
// isn't a count) is never taken.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPolicyRows, policyRows, takePolicies } from './policies';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

beforeEach(() => clearPolicyRows());

describe('the policy rows', () => {
  it('are replaced whole by each connection’s set, then follow each change', () => {
    takePolicies({ t: 'policies', rows: [{ session: 's1', audience: [A, B], policyRev: 1 }, { session: 's2', audience: [A], policyRev: 3 }] });
    expect([...policyRows()]).toEqual([['s1', { audience: [A, B], policyRev: 1 }], ['s2', { audience: [A], policyRev: 3 }]]);
    takePolicies({ t: 'policy', session: 's1', policy: { audience: [A], policyRev: 2 } });
    takePolicies({ t: 'policy', session: 's2', policy: null });
    expect([...policyRows()]).toEqual([['s1', { audience: [A], policyRev: 2 }]]);
    takePolicies({ t: 'policies', rows: [{ session: 's3', audience: [B], policyRev: 1 }] });
    expect([...policyRows().keys()]).toEqual(['s3']);
  });

  it('take no row that is not one', () => {
    takePolicies({ t: 'policies', rows: [{ session: 's1', audience: [B, A], policyRev: 1 }, { session: 's2', audience: [], policyRev: 1 }, { session: 's3', audience: [A], policyRev: -1 }, { session: 's4', audience: [A], policyRev: 1 }] });
    expect([...policyRows().keys()]).toEqual(['s4']);
    takePolicies({ t: 'policy', session: 's4', policy: { audience: ['nobody'], policyRev: 2 } });
    expect(policyRows().get('s4')).toEqual({ audience: [A], policyRev: 1 });
  });
});
