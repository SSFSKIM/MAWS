// The scm queries' invalidation (E11 W-D's app-level listener): it picks the sessions' queries by the key's third part,
// and a key under the same prefix without one (W-D review m2) is passed over rather than read through.
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { queryClient } from '../../ipc/query';
import { invalidateScmQueries, prStateKey, SCM_STATUS_QUERIES, scmStatusKey } from './queries';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const invalidated = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;

describe('invalidateScmQueries', () => {
  afterEach(() => queryClient.clear());

  it('invalidates the picked sessions’ queries and passes over a key without a session', () => {
    for (const key of [scmStatusKey(A), scmStatusKey(B), prStateKey(A), [...SCM_STATUS_QUERIES]]) queryClient.setQueryData(key, {});
    expect(() => invalidateScmQueries((appSessionId) => appSessionId === A)).not.toThrow();
    expect(invalidated(scmStatusKey(A))).toBe(true);
    expect(invalidated(prStateKey(A))).toBe(true);
    expect(invalidated(scmStatusKey(B))).toBe(false);
    expect(invalidated([...SCM_STATUS_QUERIES])).toBe(false);
  });
});
