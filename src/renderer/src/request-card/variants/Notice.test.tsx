// E11 F2b (plan 2.4; owner decision 1): an error's notice says what happened in words and when ("2 weeks ago"), offers
// Dismiss, and once shown in its opened session while the window is in front it counts as seen (out of Needs you).
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

  it('shown in its opened session with the window in front, it is seen', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await act(async () => void render(<NoticeBody item={error()} seenHere />));
    expect(acknowledged()).toEqual([{ appSessionId: APP, attentionId: `${APP}:error:e1`, how: 'seen' }]);
  });

  it('with the window behind, it waits until the window comes forward', async () => {
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    await act(async () => void render(<NoticeBody item={error()} seenHere />));
    expect(acknowledged()).toEqual([]);
    focused.mockReturnValue(true);
    await act(async () => void window.dispatchEvent(new Event('focus')));
    expect(acknowledged()).toEqual([{ appSessionId: APP, attentionId: `${APP}:error:e1`, how: 'seen' }]);
  });

  it('once seen it is not acknowledged again and still offers Dismiss; another kind offers neither and keeps its wait', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await act(async () => void render(<NoticeBody item={error({ state: 'confirmed' })} seenHere />));
    expect(acknowledged()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    cleanup();
    await act(async () => void render(<NoticeBody item={item(APP, 'auto_mode_unavailable', new Date(Date.now() - 5 * 60_000).toISOString())} seenHere />));
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByText('waiting 5m')).toBeTruthy();
    expect(acknowledged()).toEqual([]);
  });
});
