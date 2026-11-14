// E11 F2b (plan 2.4; owner decision 1): an error's notice says what happened in words and when ("2 weeks ago"), offers
// Dismiss, and once shown in its opened session for two continuous seconds while the window is in front it counts as
// seen (out of Needs you; L102's dwell, the owner's ruling at P2-F's sitting).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { item, remoteRow } from '../../../../../test/support/builders';
import { at, OTHER_MACHINE } from '../../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import { SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import { useMachines } from '../../stores/machines';
import { useSessions } from '../../stores/sessions';
import { NoticeBody } from './Notice';
import { REL } from '../../test-support/relative-time';

const APP = 'app-notice'; // main's (bare): what the fake bridge is asked; the item the page holds is addressed
const DAY = 86_400_000;
let fake: FakeClient;

beforeEach(() => {
  fake = fakeClient({ 'attention.acknowledge': undefined });
  window.maws = fake.client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { maws?: PreloadBridge }).maws;
});

const error = (over: Partial<AttentionItem> = {}) =>
  item(at(APP), 'error', new Date(Date.now() - 14 * DAY).toISOString(), { id: at(`${APP}:error:e1`) as never, summary: 'The turn ended with an error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null }, ...over });
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

  // P5 O7 M8 declared `attention.acknowledge` not offered on another machine; the UX wave, U9 (M1, M4) offers it behind
  // `rl2.session-acts`: on a machine whose build doesn't list it Dismiss is greyed with the update sentence (A14) and
  // nothing is acknowledged (a lane A session there too: the helper reads the machine, not the lane); on one that lists
  // it, a lane B session's Dismiss acknowledges there.
  const studio = (capabilities: string[]) => useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-11-13T10:00:00Z', generation: 1, capabilities, owner: true }]);
  const onStudio = (lane: 'A' | 'B') => {
    const remote = addressOf(OTHER_MACHINE, APP);
    useSessions.setState({ listed: new Map([[remote as never, { ...remoteRow(OTHER_MACHINE, APP, { lane }), appId: remote as never }]]), listedMachines: new Set([OTHER_MACHINE]) });
    return error({ appSessionId: remote as never, id: addressOf(OTHER_MACHINE, `${APP}:error:e1`) as never });
  };
  afterEach(() => {
    useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    useMachines.setState({ roster: 'unread', machines: new Map() });
  });

  it.each(['B', 'A'] as const)('for a lane %s session on a machine that doesn’t serve the acts, greys Dismiss with the update sentence and acknowledges nothing', async (lane) => {
    studio(['rl2.project-acts']);
    render(<NoticeBody item={onStudio(lane)} seenHere />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toHaveProperty('disabled', true);
    expect(dismiss.title).toBe('Can’t dismiss on Studio yet. Update MAWS on Studio and try again.');
    await act(async () => fireEvent.click(dismiss));
    expect(acknowledged()).toEqual([]);
  });

  it('for a lane B session on a machine that serves the acts, dismisses there', async () => {
    studio([SESSION_ACTS_CAPABILITY]);
    render(<NoticeBody item={onStudio('B')} seenHere />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toHaveProperty('disabled', false);
    await act(async () => fireEvent.click(dismiss));
    expect(acknowledged()).toEqual([{ appSessionId: APP, attentionId: `${APP}:error:e1`, how: 'dismissed' }]);
    expect(fake.machines('attention.acknowledge')).toEqual([OTHER_MACHINE]);
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

    // UC-1 (A17): only a waiting item is seen; one in any other state waits nowhere and is told nothing
    it('an item that no longer waits (its state delivered) is not counted as seen', async () => {
      await act(async () => void render(<NoticeBody item={error({ state: 'delivered' })} seenHere />));
      await advance(5_000);
      expect(acknowledged()).toEqual([]);
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
    await act(async () => void render(<NoticeBody item={item(at(APP), 'auto_mode_unavailable', new Date(Date.now() - 5 * 60_000).toISOString(), { id: at('att-auto') as never })} seenHere />));
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByText(`waiting ${REL.amount(5, 'minute')}`)).toBeTruthy();
    expect(acknowledged()).toEqual([]);
  });
});
