// The renderer's git store over main's remote checkout (P5 O7 M4's milestone review): two sessions watching one
// checkout each hold their own watch, so when one session goes and the other's feed reopens on a new channel, main gives
// the remaining session's watch back to the machine, under that session, and the store keeps following.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef } from '@shared/ipc/client';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { addressOf, bareOf } from '@shared/machine/address';
import { FakeLink, MINI } from '../../../test/lane-b/fake-link';
import { createGitStore } from '../../renderer/src/stores/git';
import type { MainContext } from '../ipc/router';
import { createRemoteCheckout } from './remote-checkout';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const REPO = '/work/repo';
const status = { repoRoot: REPO, gitDir: `${REPO}/.git`, commonDir: `${REPO}/.git`, isWorktree: false, branch: 'main', head: 'abc', upstream: null, remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-31T00:00:00.000Z' };

it('gives the remaining session’s watch back when the first holder has gone and the other’s feed reopens', async () => {
  const link = new FakeLink();
  link.peers = ['rl2.executor.machine', 'rl2.call-session', 'rl2.feeds'];
  const holds = new Map<string, number>(); // the machine's count of git holds, by the session each was made under
  const held = (app: string) => holds.get(app) ?? 0;
  link.answers.set('git.watch', () => ({ ok: true, output: status }));
  link.answers.set('git.unwatch', () => ({ ok: true, output: null }));
  const call = link.call.bind(link);
  link.call = async (name, input, options) => {
    const app = options?.session?.id ?? '';
    if (name === 'git.watch') holds.set(app, held(app) + 1);
    if (name === 'git.unwatch') holds.set(app, Math.max(0, held(app) - 1));
    return call(name, input, options);
  };
  const checkout = createRemoteCheckout({ remote: () => link, emit: () => {}, log: () => {} });
  const page = endableClientRef('page-1');
  // the page's client as the preload envelope reaches main: the session a path read is made from, bare, beside its machine
  const client = {
    localMachine: 'LocalMachineRef0000000',
    on: () => () => {},
    invoke: (name: CommandName, input: Record<string, unknown>, opts?: { machine: string; session?: AppSessionId }) => {
      const ctx: MainContext = { client: page, target: MINI, ...(opts?.session !== undefined && { session: bareOf(opts.session) }) };
      return checkout.dispatch(link, name, input, ctx) as Promise<CommandResult<CommandName>>;
    },
  } as unknown as MawsBridge;
  const store = createGitStore(client, { diffDelayMs: 1 });
  const A = addressOf(MINI, 'app-a' as AppSessionId);
  const B = addressOf(MINI, 'app-b' as AppSessionId);
  for (const app of ['app-a', 'app-b']) {
    checkout.open(link, app);
    link.open().at(-1)!.sink.subbed('snapshot', { epoch: 'checkout:boot', seq: 0 });
  }
  const releaseA = store.getState().watch(MINI, REPO, A);
  store.getState().watch(MINI, REPO, B);
  await vi.advanceTimersByTimeAsync(0);
  expect([held('app-a'), held('app-b')]).toEqual([1, 1]);

  // A's tab closes: its panel lets the watch go, and its stream (with its feed) is let go after the linger
  releaseA();
  await vi.advanceTimersByTimeAsync(0);
  checkout.close(MINI, 'app-a');
  expect([held('app-a'), held('app-b')]).toEqual([0, 1]);

  // a new channel: the old channel's holds ended with it; B's feed reopens and main gives B's watch back
  holds.clear();
  for (const feed of link.open()) feed.sink.subbed('snapshot', { epoch: 'checkout:boot', seq: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(held('app-b')).toBe(1);
  expect(store.getState().entries.size).toBe(1); // the store still follows the checkout
});
