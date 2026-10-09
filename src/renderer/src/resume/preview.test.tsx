// P2-D (the P2 spec, child P2-D, G4): the preview reads the settled selection only, after its debounce, drops a stale
// answer and reads a session once per half minute.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { CACHE_MS, clearPreviewCache, SETTLE_MS, useRecentTurns } from './preview';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const turns = (text: string) => ({ turns: [{ prompt: { text, at: '2026-10-09T10:00:00.000Z' }, answer: null, toolCalls: 0 }], earlier: false, source: 'transcript' as const });

let fake: FakeClient;
beforeEach(() => {
  vi.useFakeTimers();
  clearPreviewCache();
  fake = fakeClient();
});
afterEach(() => vi.useRealTimers());

const settle = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
// the fake client lets its answer settle on a timer, which the fake clock has to move
const answer = async (reply: () => Promise<void>) =>
  act(async () => {
    const done = reply();
    await vi.advanceTimersByTimeAsync(1);
    await done;
  });
const hook = (id: AppSessionId | null, immediate = false) => renderHook(({ id, immediate }) => useRecentTurns(id, immediate, fake.client), { initialProps: { id, immediate } });

describe('useRecentTurns', () => {
  it('reads the opening selection at once, and nothing for no selection', async () => {
    expect(hook(null).result.current).toEqual({ status: 'idle' });
    const { result } = hook(A, true);
    await settle(0);
    expect(fake.invoked('session.recentTurns')).toEqual([{ appSessionId: A, limit: 6 }]);
    expect(result.current).toEqual({ status: 'loading' });
    await answer(() => fake.reply('session.recentTurns', turns('a')));
    expect(result.current).toEqual({ status: 'ready', value: turns('a') });
  });

  it('a selection passed over within the debounce is never read', async () => {
    const { rerender, result } = hook(A);
    await settle(SETTLE_MS - 10);
    rerender({ id: B, immediate: false });
    await settle(SETTLE_MS);
    expect(fake.invoked('session.recentTurns')).toEqual([{ appSessionId: B, limit: 6 }]);
    expect(result.current.status).toBe('loading');
  });

  it('an answer for a selection left before it came is dropped', async () => {
    const { rerender, result } = hook(A, true);
    await settle(0);
    rerender({ id: B, immediate: false });
    await settle(SETTLE_MS);
    await answer(() => fake.reply('session.recentTurns', turns('a')));
    expect(result.current).toEqual({ status: 'loading' }); // B's, not A's
    await answer(() => fake.reply('session.recentTurns', turns('b')));
    expect(result.current).toEqual({ status: 'ready', value: turns('b') });
  });

  it('a session read in the last half minute is shown from the cache, then read again after it', async () => {
    const { rerender, result } = hook(A, true);
    await settle(0);
    await answer(() => fake.reply('session.recentTurns', turns('a')));
    rerender({ id: B, immediate: false });
    rerender({ id: A, immediate: false });
    expect(result.current).toEqual({ status: 'ready', value: turns('a') });
    await settle(SETTLE_MS);
    expect(fake.invoked('session.recentTurns')).toHaveLength(1);
    rerender({ id: B, immediate: false });
    await settle(CACHE_MS);
    rerender({ id: A, immediate: false });
    await settle(SETTLE_MS);
    expect(fake.invoked('session.recentTurns').map((i) => (i as { appSessionId: string }).appSessionId)).toEqual([A, B, A]);
  });

  it('a refused read says so', async () => {
    const { result } = hook(A, true);
    await settle(0);
    await answer(() => fake.fail('session.recentTurns', 'no transcript'));
    expect(result.current).toEqual({ status: 'error' });
  });
});
