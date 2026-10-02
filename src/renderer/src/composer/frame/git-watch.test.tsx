import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { fakeClient } from '../../../../../test/support/fake-client';
import { useGitWatch } from './git-watch';

const status = (repoRoot: string) => ({ repoRoot, gitDir: `${repoRoot}/.git`, commonDir: `${repoRoot}/.git`, isWorktree: false, branch: 'main', head: 'abc', upstream: null, remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-02T00:00:00.000Z' });
afterEach(cleanup);

it('releases a watch only after its pending registration settles on unmount', async () => {
  const fake = fakeClient({ 'git.unwatch': () => undefined });
  const { unmount } = renderHook(() => useGitWatch('/repo', fake.client));
  unmount();
  expect(fake.invoked('git.unwatch')).toEqual([]);
  await act(async () => fake.reply('git.watch', status('/repo')));
  expect(fake.invoked('git.unwatch')).toEqual([{ directory: '/repo' }]);
});

it('releases the old directory after registration without replacing the current directory answer', async () => {
  const fake = fakeClient({ 'git.unwatch': () => undefined });
  const { result, rerender } = renderHook(({ directory }) => useGitWatch(directory, fake.client), { initialProps: { directory: '/old' } });
  rerender({ directory: '/new' });
  expect(fake.invoked('git.unwatch')).toEqual([]);
  await act(async () => fake.reply('git.watch', status('/old')));
  expect(result.current).toBeNull();
  expect(fake.invoked('git.unwatch')).toEqual([{ directory: '/old' }]);
  await act(async () => fake.reply('git.watch', status('/new')));
  expect(result.current?.status?.repoRoot).toBe('/new');
});
