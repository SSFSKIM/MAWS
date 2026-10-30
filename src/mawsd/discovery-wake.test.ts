// The discovery wake (P5 O3-D M6 fix round 2): its joins, its freshness, and its end, heard or given up, on fake
// timers with the spine's signal and the host's park as fakes. The clocks' side of the park (admission, interest, an
// ask not sent) is clocks.test.ts's; process-discovery-wake.test.ts runs it all over the real daemon and host.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCOVERY_FRESH_MS, DISCOVERY_WAKE_BOUND_MS, DISCOVERY_WAKE_GIVE_UP_MS, discoveryWake } from './discovery-wake';

let parked: boolean;
let listeners: Set<() => void>;
let wakes: number;
let parks: number;
let waking: number;
let lines: string[];
let before: ReturnType<typeof discoveryWake>;

const pass = () => {
  for (const listener of [...listeners]) listener();
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-30T08:00:00.000Z') });
  parked = true;
  listeners = new Set();
  wakes = 0;
  parks = 0;
  waking = 0;
  lines = [];
  before = discoveryWake({
    discovery: () => ({ onApplied: (listener) => (listeners.add(listener), () => void listeners.delete(listener)) }),
    parked: () => parked,
    wake: () => void ((wakes += 1), (parked = false)),
    waking: () => void (waking += 1),
    parkNow: () => void (parks += 1),
    log: (line) => void lines.push(line),
  });
});
afterEach(() => vi.useRealTimers());

describe('the discovery wake', () => {
  it('wakes once for concurrent reads, answers them at the pass, asks the park, and a fresh read wakes nothing', async () => {
    let answered = 0;
    const reads = [before('session.list', false), before('session.projects.list', false)].map((read) => read.then(() => void (answered += 1)));
    await vi.advanceTimersByTimeAsync(1_000);
    expect([wakes, waking, answered], 'the clocks told a wake is out, before the host is woken').toEqual([1, 1, 0]);
    pass();
    await Promise.all(reads);
    expect([answered, parks, listeners.size]).toEqual([2, 1, 0]);
    parked = true; // it parked
    await before('session.list', false);
    expect(wakes, 'within DISCOVERY_FRESH_MS').toBe(1);
    await vi.advanceTimersByTimeAsync(DISCOVERY_FRESH_MS);
    void before('session.list', false);
    expect(wakes).toBe(2);
  });

  it('a read answers at the pass without waiting for the host it asked to park, which here never exits', async () => {
    // The park is an ask the clocks send: a read that waited on it would hold every cold read for the host's exit
    let asked = 0;
    const read = discoveryWake({
      discovery: () => ({ onApplied: (listener) => (listeners.add(listener), () => void listeners.delete(listener)) }),
      parked: () => parked,
      wake: () => void (parked = false),
      waking: () => {},
      parkNow: () => {
        asked += 1;
        return new Promise<void>(() => {}); // the host never exits: a read that awaited this would never settle
      },
      log: () => {},
    })('session.list', false);
    let settled = false;
    void read.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(100);
    pass();
    await vi.advanceTimersByTimeAsync(0); // microtasks only: far inside DISCOVERY_WAKE_BOUND_MS
    expect([asked, settled], 'the park asked, and the read answered at the pass').toEqual([1, true]);
  });

  it('the app, and reads that need no discovery, never wait', async () => {
    await before('session.list', true);
    await before('session.rename', false);
    expect(wakes).toBe(0);
  });

  it('a failed discovery: the reads answer at their bound, and the give-up asks the park so a later read wakes again', async () => {
    const read = before('session.list', false);
    await vi.advanceTimersByTimeAsync(DISCOVERY_WAKE_BOUND_MS);
    await read;
    expect(lines.at(-1)).toContain('answers what the index holds');
    expect(parks, 'still waiting for its pass').toBe(0);
    const joined = before('session.list', false); // joins the wake still out
    await vi.advanceTimersByTimeAsync(DISCOVERY_WAKE_GIVE_UP_MS);
    await joined;
    expect(parks, 'the host the failed wake left up is asked to park').toBe(1);
    expect(listeners.size).toBe(0);
    await before('session.list', false);
    expect(wakes, 'not parked yet: nothing to wake, and no pass is waited for').toBe(1);
    parked = true;
    void before('session.list', false);
    expect(wakes, 'parked again: the next read wakes it').toBe(2);
  });

  it('a pass after the give-up changes nothing: no second park, no freshness', async () => {
    void before('session.list', false);
    await vi.advanceTimersByTimeAsync(DISCOVERY_WAKE_GIVE_UP_MS);
    expect(parks).toBe(1);
    pass(); // the scan's late answer
    expect(parks).toBe(1);
    parked = true;
    void before('session.list', false);
    expect(wakes, 'a late pass is no heard pass').toBe(2);
  });
});
