// The scm queries' invalidation (E11 W-D's app-level listener): it picks the sessions' queries by the key's third part,
// and a key under the same prefix without one (W-D review m2) is passed over rather than read through.
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { queryClient } from '../../ipc/query';
import type { MawsBridge } from '@shared/ipc/schema';
import { invalidateScmQueries, prStateKey, refreshPrState, refreshPublishedPrState, resetScmQueries, SCM_STATUS_QUERIES, scmStatusKey } from './queries';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const AT = '/work/app-a'; // A's working folder
const invalidated = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;

describe('invalidateScmQueries', () => {
  afterEach(() => queryClient.clear());

  it('invalidates the picked sessions’ queries and passes over a key without a session', () => {
    for (const key of [scmStatusKey(A), scmStatusKey(B), prStateKey(A, AT), [...SCM_STATUS_QUERIES]]) queryClient.setQueryData(key, {});
    expect(() => invalidateScmQueries((appSessionId) => appSessionId === A)).not.toThrow();
    expect(invalidated(scmStatusKey(A))).toBe(true);
    expect(invalidated(prStateKey(A, AT))).toBe(true);
    expect(invalidated(scmStatusKey(B))).toBe(false);
    expect(invalidated([...SCM_STATUS_QUERIES])).toBe(false);
  });
});

// UX wave U8c-2 (fix wave 1): a move resets both reads of the sessions that moved, and a published PR's lookup still out
// for one of them is not written over the reset.
describe('resetScmQueries', () => {
  afterEach(() => queryClient.clear());

  it('drops the picked sessions’ answers and passes over a key without a session', () => {
    for (const key of [scmStatusKey(A), scmStatusKey(B), prStateKey(A, AT), [...SCM_STATUS_QUERIES]]) queryClient.setQueryData(key, {});
    expect(() => resetScmQueries((appSessionId) => appSessionId === A)).not.toThrow();
    expect(queryClient.getQueryData(scmStatusKey(A))).toBeUndefined();
    expect(queryClient.getQueryData(prStateKey(A, AT))).toBeUndefined();
    expect(queryClient.getQueryData(scmStatusKey(B))).toEqual({});
    expect(queryClient.getQueryData([...SCM_STATUS_QUERIES])).toEqual({});
  });

  it('writes no published PR lookup asked before the move', async () => {
    queryClient.setQueryData(prStateKey(A, AT), { branch: 'main', pr: null }); // a surface holds the PR state
    let release!: () => void;
    const client = {
      invoke: () => new Promise((resolve) => (release = () => resolve({ ok: true, value: { branch: 'main', pr: { number: 1 } } }))),
    } as unknown as MawsBridge;
    refreshPublishedPrState(A, AT, { url: 'https://example.invalid/pr/1', action: 'created', at: new Date().toISOString() }, client);
    resetScmQueries((appSessionId) => appSessionId === A);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryClient.getQueryData(prStateKey(A, AT))).toBeUndefined();
  });
});

// UX wave U8c-2 (M6 fix wave 1): the summary's Refresh writes its answer as the published lookup does: an ordinary read
// of the PR state still out when it lands (the poll's, or one a ref move asked for), begun before the Refresh, is
// cancelled, so it cannot land after the Refresh and put the older state back.
describe('refreshPrState', () => {
  afterEach(() => queryClient.clear());

  it('keeps its answer over an ordinary read begun before it and answered after it', async () => {
    queryClient.setQueryData(prStateKey(A, AT), { branch: 'main', pr: null });
    let answerRead!: () => void;
    const read = queryClient
      .fetchQuery({ queryKey: prStateKey(A, AT), queryFn: () => new Promise((resolve) => (answerRead = () => resolve({ branch: 'main', pr: null }))) })
      .catch(() => undefined); // the cancelled read rejects
    const client = { invoke: () => Promise.resolve({ ok: true, value: { branch: 'main', pr: { number: 7 } } }) } as unknown as MawsBridge;
    await refreshPrState(A, AT, client);
    answerRead();
    await read;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryClient.getQueryData(prStateKey(A, AT))).toEqual({ branch: 'main', pr: { number: 7 } });
  });
});
