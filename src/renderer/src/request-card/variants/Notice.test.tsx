// E11 F2b (plan 2.4; owner decision 1): an error's notice says what happened in words and when ("2 weeks ago"), offers
// Dismiss, and once shown in its opened session for two continuous seconds while the window is in front it counts as
// seen (out of Needs you; L102's dwell, the owner's ruling at P2-F's sitting).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { item } from '../../../../../test/support/builders';
import { NoticeBody } from './Notice';
import { REL } from '../../test-support/relative-time';

const APP = 'app-notice';
const DAY = 86_400_000;
let fake: FakeClient;

beforeEach(() => {
  fake = fakeClient({ 'attention.acknowledge': undefined });
  window.maws = fake.client;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { maws?: MawsBridge }).maws;
});

const error = (over: Partial<AttentionItem> = {}) =>
  item(APP, 'error', new Date(Date.now() - 14 * DAY).toISOString(), { id: `${APP}:error:e1` as never, summary: 'The turn ended with an error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null }, ...over });
const acknowledged = () => fake.invoked('attention.acknowledge');

describe('an error notice', () => {
  it('says what happened and when, not how long it has waited, and Dismiss retires it', async () => {
    render(<NoticeBody item={error()} />);
    expect(screen.getByText('The turn ended with an error')).toBeTruthy();
    expect(screen.getByText(REL.ago(2, 'week'))).toBeTruthy();
    expect(screen.queryByText(/waiting/)).toBeNull();
    expect(acknowledged(), 'a card elsewhere is not seeing it in its session').toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })));
    expect(acknowledged()).toEqual([{ appSessionId: APP, attentionId: `${APP}:error:e1`, how: 'dismissed' }]);
  });

  // L102 (P2-F wave S; the owner at the sitting, B6: "2초 확인 후 해제"): seen only after two continuous seconds in
  // front; the window going behind or the document hiding restarts the count.
  describe('the two-second dwell', () => {
    let visibility: DocumentVisibilityState;
    let focused: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      vi.useFakeTimers();
      visibility = 'visible';
      vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
      focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    });
    afterEach(() => vi.useRealTimers());
    const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
    const SEEN = [{ appSessionId: APP, attentionId: `${APP}:error:e1`, how: 'seen' }];

    it('shown in its opened session with the window in front, it is seen after two seconds, not at 1.9', async () => {
      await act(async () => void render(<NoticeBody item={error()} seenHere />));
      await advance(1_900);
      expect(acknowledged()).toEqual([]);
      await advance(100);
      expect(acknowledged()).toEqual(SEEN);
      await advance(5_000);
      expect(acknowledged(), 'once').toEqual(SEEN);
    });

    it('a hide at 1.5 s restarts the count when the document shows again', async () => {
      await act(async () => void render(<NoticeBody item={error()} seenHere />));
      await advance(1_500);
      visibility = 'hidden';
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
      await advance(3_000);
      expect(acknowledged(), 'nothing counts while hidden').toEqual([]);
      visibility = 'visible';
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
      await advance(1_900);
      expect(acknowledged()).toEqual([]);
      await advance(100);
      expect(acknowledged()).toEqual(SEEN);
    });

    it('the window going behind at 1.5 s restarts the count when it comes forward', async () => {
      await act(async () => void render(<NoticeBody item={error()} seenHere />));
      await advance(1_500);
      focused.mockReturnValue(false);
      await act(async () => void window.dispatchEvent(new Event('blur')));
      await advance(3_000);
      expect(acknowledged()).toEqual([]);
      focused.mockReturnValue(true);
      await act(async () => void window.dispatchEvent(new Event('focus')));
      await advance(1_900);
      expect(acknowledged()).toEqual([]);
      await advance(100);
      expect(acknowledged()).toEqual(SEEN);
    });

    it('with the window behind at mount, it counts from when the window comes forward', async () => {
      focused.mockReturnValue(false);
      await act(async () => void render(<NoticeBody item={error()} seenHere />));
      await advance(5_000);
      expect(acknowledged()).toEqual([]);
      focused.mockReturnValue(true);
      await act(async () => void window.dispatchEvent(new Event('focus')));
      await advance(2_000);
      expect(acknowledged()).toEqual(SEEN);
    });

    it('the same item re-read from the store (a new object) does not restart the count', async () => {
      const view = await act(async () => render(<NoticeBody item={error()} seenHere />));
      await advance(1_500);
      await act(async () => void view.rerender(<NoticeBody item={error()} seenHere />));
      await advance(500);
      expect(acknowledged()).toEqual(SEEN);
    });

    it('a notice that unmounts before two seconds is not seen', async () => {
      await act(async () => void render(<NoticeBody item={error()} seenHere />));
      await advance(1_500);
      cleanup();
      await advance(5_000);
      expect(acknowledged()).toEqual([]);
    });
  });

  it('once seen it is not acknowledged again and still offers Dismiss; another kind offers neither and keeps its wait', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await act(async () => void render(<NoticeBody item={error({ state: 'confirmed' })} seenHere />));
    expect(acknowledged()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    cleanup();
    await act(async () => void render(<NoticeBody item={item(APP, 'auto_mode_unavailable', new Date(Date.now() - 5 * 60_000).toISOString())} seenHere />));
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByText(`waiting ${REL.amount(5, 'minute')}`)).toBeTruthy();
    expect(acknowledged()).toEqual([]);
  });
});
