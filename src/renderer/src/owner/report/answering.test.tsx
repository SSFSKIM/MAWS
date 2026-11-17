// Mark all read (the P2-C document, Design §8; UX wave U2b, ruling R9): with the bar above the transcript gone, the
// legacy items a session holds unread are marked read by the palette's command "Mark all read", the action
// `transcript.markAllRead`, on the focused pane's session: one `ownerChannel.markRead` for them all, nothing with none
// unread, and a failure (main's envelope or a rejected invoke) said in a toast whose Retry asks again.
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { markIdOf } from '@shared/owner/marks';
import type { OwnerChannelState, OwnerMark } from '@shared/owner/state';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { resetSlots } from '../../app/slots';
import { runAction } from '../../keymap/actions-runtime';
import { useLayout } from '../../stores/layout';
import { useNotices } from '../../stores/notices';
import { resetOwnerChannelStore, useOwnerChannelStore } from '../../stores/owner-channel';
import { mainShowing } from '../../test-support/panel';
import { resetShellStores } from '../../test-support/shell-stores';
import { connectTranscript } from '../../transcript/shell';

// the page's `ipc` answers before a case sets its client: a module the transcript's shell imports reads `localMachine`
// as it loads (the terminals store reads the registry's host; the shell reaches it since U3b), before any machine is known
const hold = vi.hoisted(() => ({ client: null as ReturnType<typeof import('../../../../../test/support/fake-client').fakeClient>['client'] | null }));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: unknown[]) => (hold.client!.invoke as (...a: unknown[]) => unknown)(...args), on: (...args: unknown[]) => (hold.client!.on as (...a: unknown[]) => unknown)(...args), get localMachine() { return hold.client?.localMachine ?? null; } } }));

// P5 O6 M2: `ipc` is mocked at the page's level, so the session is its address; main's mark ids are built on the bare id
const MAIN_APP = 'app-answer' as AppSessionId;
const APP = at(MAIN_APP);
const anchor = { messageUuid: 'm-1' as MessageUuid, blockIndex: 0 };
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const essential = (span: number, state: 'unread' | 'read' = 'unread'): OwnerMark => ({ id: markIdOf(MAIN_APP, 'essential', { ...anchor, span }), kind: 'essential', anchor: { ...anchor, span }, head: 'x', at: '2026-11-15T10:00:00.000Z', item: true, essential: { state, readAt: state === 'read' ? '2026-11-15T10:01:00.000Z' : null } });

let fake: ReturnType<typeof fakeClient>;
let disconnect: () => void;
beforeEach(() => {
  fake = fakeClient({ 'ownerChannel.markRead': undefined });
  hold.client = fake.client;
  act(() => useLayout.setState({ main: mainShowing(APP) }));
  disconnect = connectTranscript();
});
afterEach(() => {
  disconnect();
  resetSlots();
  cleanup();
  resetOwnerChannelStore();
  resetShellStores();
  useNotices.setState({ notices: [] });
});

function withMarks(marks: OwnerMark[]) {
  const state: OwnerChannelState = { appSessionId: APP, lane: { on: true, override: 'inherit', applied: 'maws-contract', pending: null, mismatch: null }, marks };
  useOwnerChannelStore.setState({ bySession: new Map([[APP, state]]) });
}
// The next invocation of `name` fails: main's failure envelope, or the bridge's rejected invoke.
function failing(name: CommandName, how: 'envelope' | 'reject', message = 'the index is unavailable') {
  let left = 1;
  hold.client = {
    ...fake.client,
    invoke: (n: CommandName, input: unknown) => {
      const answered = (fake.client.invoke as (n: CommandName, i: unknown) => Promise<unknown>)(n, input);
      if (n !== name || left <= 0) return answered;
      left -= 1;
      return how === 'reject' ? Promise.reject(new Error(message)) : Promise.resolve({ ok: false, error: { code: 'internal', message } });
    },
  } as MawsBridge;
}

describe('Mark all read, the palette’s command', () => {
  it('marks every unread legacy item of the focused pane’s session read, and with none unread does nothing', async () => {
    withMarks([essential(0, 'read')]);
    runAction('transcript.markAllRead');
    await settle();
    expect(fake.invoked('ownerChannel.markRead')).toEqual([]);
    withMarks([essential(0), essential(1, 'read')]);
    runAction('transcript.markAllRead');
    await settle();
    expect(fake.invoked('ownerChannel.markRead')).toEqual([{ appSessionId: APP, markIds: 'all' }]);
    expect(useNotices.getState().notices).toEqual([]);
  });

  it.each(['envelope', 'reject'] as const)('a failure is a toast with Retry, which asks again (%s)', async (how) => {
    withMarks([essential(0), essential(1)]);
    failing('ownerChannel.markRead', how);
    runAction('transcript.markAllRead');
    await settle();
    const [notice] = useNotices.getState().notices;
    expect(notice).toMatchObject({ kind: 'toast', text: 'Items not marked read: the index is unavailable', actions: [{ label: 'Retry' }] });
    await act(async () => notice!.actions[0]!.run());
    await settle();
    expect(fake.invoked('ownerChannel.markRead')).toEqual([{ appSessionId: APP, markIds: 'all' }, { appSessionId: APP, markIds: 'all' }]);
  });
});
