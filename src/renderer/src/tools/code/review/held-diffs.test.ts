// The held-diff cache Review's and Source control's stores share (P4 W2-B, tracker 2026-10-06 E6 · C8c): its one hook,
// `overtaken`, asked as a read goes out and checked when the answer lands. Source control's untracked rule (E11) rides
// on it; the two stores' own suites cover the rest of the cache through their stores.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createHeldDiffs, diffKeys, type HeldDiffState } from './held-diffs';
import { deferred, installFakeMain, ok } from '../../../test-support/code';

interface Target {
  directory: string;
  scope: 'worktree';
}
const TARGET: Target = { directory: '/repo', scope: 'worktree' };
const keys = diffKeys<Target>((t) => `${t.directory}\0${t.scope}`, '\0');
const listing = (path: string) => ({ patch: '', files: [{ path, oldPath: null, insertions: 1, deletions: 0, binary: false }] });

afterEach(() => vi.useRealTimers());

describe('createHeldDiffs: the overtaken hook', () => {
  it('drops an answer a change since its read went out overtook, keeps what the diff showed, and still runs the re-read asked meanwhile', async () => {
    const answers: ((value: unknown) => void)[] = [];
    const main = installFakeMain(async () => {
      const answer = deferred<unknown>();
      answers.push(answer.resolve);
      return ok(await answer.promise);
    });
    // The hook's owner counts its changes; a read is overtaken when one went out after it was asked.
    let changes = 0;
    let lastChange = -1;
    const change = () => {
      lastChange = changes;
      changes++;
    };
    const asked: number[] = [];
    const state = createStore<HeldDiffState>()(() => ({ diffs: new Map(), files: new Map() }));
    const cache = createHeldDiffs<Target>(main.bridge, state.setState, {
      keys,
      input: (t) => ({ directory: t.directory, scope: t.scope }),
      overtaken() {
        const at = changes;
        asked.push(at);
        return () => lastChange >= at;
      },
    });
    const diff = () => state.getState().diffs.get(keys.diff(TARGET));

    const off = cache.hold(TARGET);
    expect(asked).toEqual([0]); // asked as the first read goes out, before it answers
    answers[0](listing('one'));
    await vi.waitFor(() => expect(diff()).toMatchObject({ status: 'ok', files: [{ path: 'one' }] }));

    cache.refresh(TARGET); // a read in flight when the change goes out
    cache.refresh(TARGET); // and a re-read asked while it is
    change();
    answers[1](listing('stale'));
    await vi.waitFor(() => expect(answers).toHaveLength(3)); // the re-read runs though the answer was dropped
    expect(diff()).toMatchObject({ status: 'ok', files: [{ path: 'one' }] }); // the earlier answer stands
    answers[2](listing('fresh')); // asked after the change: not overtaken
    await vi.waitFor(() => expect(diff()).toMatchObject({ status: 'ok', files: [{ path: 'fresh' }] }));
    expect(asked).toEqual([0, 0, 1]);

    cache.refresh(TARGET); // with no change since it was asked, the answer lands
    answers[3](listing('last'));
    await vi.waitFor(() => expect(diff()).toMatchObject({ status: 'ok', files: [{ path: 'last' }] }));
    expect(main.callsOf('git.diff')).toHaveLength(4);
    off();
    expect(diff()).toBeUndefined();
  });
});
