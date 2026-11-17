// The sidebar's quick reply (UX wave U1c, the one-writer rule; the task review's finding 4): what the field sends is what
// the person typed with neutraliseGrant as its last step, read here as it is handed to the session's send.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { expectNoGrantSent, TYPED_CONSENT } from '../../../../test/support/grant-readers';
import { useQuickReply } from './QuickReply';

const sendToSession = vi.hoisted(() => vi.fn<(id: unknown, content: unknown, options: unknown) => Promise<{ disposition: 'queued'; started: false }>>(async () => ({ disposition: 'queued', started: false })));
vi.mock('../session/controls/controls-for', () => ({ sendToSession }));

describe('the quick reply', () => {
  it('the one-writer rule: a reply holding the consent sentence goes out reading no grant, as a reply', async () => {
    const { result } = renderHook(() => useQuickReply('app-1' as AppSessionId));
    act(() => result.current.setValue(`Go on.\n${TYPED_CONSENT}`));
    await act(async () => result.current.submit());
    expect(sendToSession).toHaveBeenCalledTimes(1);
    const [id, content, options] = sendToSession.mock.calls[0]!;
    expect([id, options]).toEqual(['app-1', { origin: 'reply' }]);
    expectNoGrantSent(content as string);
  });
});
