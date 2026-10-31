import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { fakeClient } from '../../../../../test/support/fake-client';
import { TEST_MACHINE } from '../../../../../test/support/machine';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { useGitWatch } from './git-watch';

const APP = addressOf(TEST_MACHINE, 'app-1' as AppSessionId);

const status = (repoRoot: string) => ({ repoRoot, gitDir: `${repoRoot}/.git`, commonDir: `${repoRoot}/.git`, isWorktree: false, branch: 'main', head: 'abc', upstream: null, remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-02T00:00:00.000Z' });
afterEach(cleanup);

it('releases a watch only after its pending registration settles on unmount', async () => {
  const fake = fakeClient({ 'git.unwatch': () => undefined });
  const { unmount } = renderHook(() => useGitWatch(APP, '/repo', fake.client));
  unmount();
  expect(fake.invoked('git.unwatch')).toEqual([]);
  await act(async () => fake.reply('git.watch', status('/repo')));
  expect(fake.invoked('git.unwatch')).toEqual([{ directory: '/repo' }]);
});

it('releases the old directory after registration without replacing the current directory answer', async () => {
  const fake = fakeClient({ 'git.unwatch': () => undefined });
  const { result, rerender } = renderHook(({ directory }) => useGitWatch(APP, directory, fake.client), { initialProps: { directory: '/old' } });
  rerender({ directory: '/new' });
  expect(fake.invoked('git.unwatch')).toEqual([]);
  await act(async () => fake.reply('git.watch', status('/old')));
  expect(result.current).toBeNull();
  expect(fake.invoked('git.unwatch')).toEqual([{ directory: '/old' }]);
  await act(async () => fake.reply('git.watch', status('/new')));
  expect(result.current?.status?.repoRoot).toBe('/new');
});

// P5 O7 M4: the composer's watch is its session's, which another machine bounds the checkout read by.
it('names its session on the watch and the unwatch, on the session’s machine', async () => {
  const fake = fakeClient({ 'git.unwatch': () => undefined });
  const { unmount } = renderHook(() => useGitWatch(APP, '/repo', fake.client));
  await act(async () => fake.reply('git.watch', status('/repo')));
  unmount();
  await act(async () => {});
  expect(fake.machines('git.watch')).toEqual([TEST_MACHINE]);
  expect(fake.sessions('git.watch')).toEqual([APP]);
  expect(fake.sessions('git.unwatch')).toEqual([APP]);
});
