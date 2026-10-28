// P5 O2 M2: main's interest report to the engine host (interest.ts): the set, its coalescing, the resend at streaming.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { INTEREST_COALESCE_MS, interestSet, startInterest, type InterestDeps } from './interest';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as AppSessionId;
const tab = (kind: 'session' | 'agent' | 'diff', appSessionId: AppSessionId) => ({ id: `${kind}:${appSessionId}`, kind, appSessionId, pinned: false, ...(kind === 'agent' && { agentId: 'a1' }), ...(kind === 'diff' && { ref: 'HEAD' }) });
const tabs = (...list: ReturnType<typeof tab>[]) => ({ version: 2, current: NO_PROJECT, sets: { [NO_PROJECT]: { panes: [{ tabs: list, activeTabId: '' }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] });
// P5 O6: version 3 holds addresses; the engine host is this machine's, so the set is the local machine's bare ids
const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
const tabsV3 = (...list: ReturnType<typeof tab>[]) => ({ ...tabs(...list), version: 3 });

describe('the interest set', () => {
  it('is the open session and agent tabs of every project with the sessions on screen, each once, sorted', () => {
    expect(interestSet(tabs(tab('session', id(3)), tab('agent', id(1)), tab('diff', id(4))), [id(2), id(3)], LOCAL)).toEqual([id(1), id(2), id(3)]);
    expect(interestSet('not a layout', [id(5)], LOCAL)).toEqual([id(5)]);
  });

  it('keeps the local machine’s tabs, by their bare ids, and leaves another machine’s out', () => {
    const value = tabsV3(tab('session', addressOf(LOCAL, id(1))), tab('agent', addressOf(OTHER, id(2))));
    expect(interestSet(value, [], LOCAL)).toEqual([id(1)]);
  });
});

describe('startInterest', () => {
  let current: AppSessionId[];
  let streaming: boolean;
  let change: () => void;
  let streamed: () => void;
  let sent: AppSessionId[][];
  let answer: () => Promise<{ ok: true; value: undefined } | { ok: false; error: unknown }>;
  const deps = (): InterestDeps => ({
    sessions: () => current,
    onChange: (l) => ((change = l), () => {}),
    streaming: () => streaming,
    onStreaming: (l) => ((streamed = l), () => {}),
    dispatch: (input) => (sent.push(input.sessions as AppSessionId[]), answer() as never),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    current = [id(1)];
    streaming = true;
    sent = [];
    answer = async () => ({ ok: true, value: undefined });
  });
  afterEach(() => vi.useRealTimers());

  it('sends the set at its start while the host streams, then each change, coalesced to one send per 250 ms', async () => {
    startInterest(deps());
    expect(sent).toEqual([[id(1)]]);
    current = [id(1), id(2)];
    change();
    current = [id(2)];
    change();
    await vi.advanceTimersByTimeAsync(INTEREST_COALESCE_MS - 1);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([[id(1)], [id(2)]]);
  });

  it('sends nothing for a change that leaves the set as it was, or while the host is not streaming', async () => {
    startInterest(deps());
    change();
    await vi.advanceTimersByTimeAsync(INTEREST_COALESCE_MS);
    expect(sent).toHaveLength(1);
    streaming = false;
    current = [id(3)];
    change();
    await vi.advanceTimersByTimeAsync(INTEREST_COALESCE_MS);
    expect(sent).toHaveLength(1);
  });

  it('resends the whole set at every streaming, the same set included: a new host (or a restarted one) holds none', async () => {
    streaming = false;
    startInterest(deps());
    expect(sent).toEqual([]);
    streaming = true;
    streamed();
    streamed(); // a reconnect to a host that may be another
    expect(sent).toEqual([[id(1)], [id(1)]]);
  });

  it('a send the host refused is sent again at the next change, though the set is the same', async () => {
    answer = async () => ({ ok: false, error: { code: 'internal' } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    startInterest(deps());
    await vi.advanceTimersByTimeAsync(0);
    answer = async () => ({ ok: true, value: undefined });
    change();
    await vi.advanceTimersByTimeAsync(INTEREST_COALESCE_MS);
    expect(sent).toEqual([[id(1)], [id(1)]]);
  });

  it('stops: no send after its stop', async () => {
    const stop = startInterest(deps());
    current = [id(2)];
    change();
    stop();
    await vi.advanceTimersByTimeAsync(INTEREST_COALESCE_MS);
    expect(sent).toHaveLength(1);
  });
});
