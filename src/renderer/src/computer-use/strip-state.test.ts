// The strip's states (the UX wave's U12a, Interfaces §E, the table and the evidence), on this window's clock: when the
// line appears, how long it stays through a pause, the line that lingers after a withdrawn call with no clock of its
// own, and what resolves it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { TurnId } from '../transcript/model/rows';
import type { ComputerUseCall, ComputerUseReading } from './reading';
import { COMPUTER_USE_PAUSE_MS, COMPUTER_USE_SETTLE_MS, StripTracker, type StripState } from './strip-state';

const A = 'app-cu-a' as AppSessionId;
const B = 'app-cu-b' as AppSessionId;
const T1 = 't1' as TurnId;
const T2 = 't2' as TurnId;
const T3 = 't3' as TurnId;
const id = (s: string) => s as ToolUseId;
const js = (toolUseId: string, state: ComputerUseCall['state']): ComputerUseCall => ({ toolUseId: id(toolUseId), tool: 'js', state });
const reset = (toolUseId: string, state: ComputerUseCall['state']): ComputerUseCall => ({ toolUseId: id(toolUseId), tool: 'reset', state });
const end = (toolUseId: string, state: ComputerUseCall['state']): ComputerUseCall => ({ toolUseId: id(toolUseId), tool: 'end', state });
const reading = (turn: TurnId | null, running: boolean, ...calls: ComputerUseCall[]): ComputerUseReading => ({ turn, running, calls });

let tracker: StripTracker;
const see = (r: ComputerUseReading, facts: { appSessionId?: AppSessionId; processGone?: boolean; serverGone?: boolean } = {}) =>
  tracker.observe({ appSessionId: facts.appSessionId ?? A, reading: r, processGone: facts.processGone ?? false, serverGone: facts.serverGone ?? false });
const state = (): StripState => tracker.snapshot();
const kind = () => state().kind;

const RUNNING: StripState = { kind: 'running', turnId: T1 };
const lingering = (toolUseId: string): StripState => ({ kind: 'lingering', toolUseId: id(toolUseId) });

// A call the strip showed and then lost to a Stop: in flight long enough to show, then withdrawn as its turn closed.
function withdrawnAfterShowing(call = 'j1', turn = T1) {
  see(reading(turn, true, js(call, 'flight')));
  vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
  expect(state()).toEqual({ kind: 'running', turnId: turn });
  see(reading(turn, false, js(call, 'withdrawn')));
  expect(state()).toEqual(lingering(call));
}

beforeEach(() => {
  vi.useFakeTimers();
  tracker = new StripTracker();
});
afterEach(() => {
  tracker.stop();
  vi.useRealTimers();
});

describe('the strip while a call runs', () => {
  it('is absent at the start, absent at 249 ms of a call in flight, and running at 250', () => {
    expect(kind()).toBe('absent');
    see(reading(T1, true, js('j1', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS - 1);
    expect(kind()).toBe('absent');
    vi.advanceTimersByTime(1);
    expect(state()).toEqual(RUNNING);
  });

  it('tells its subscribers when its state changes', () => {
    const heard = vi.fn();
    const unsubscribe = tracker.subscribe(heard);
    see(reading(T1, true, js('j1', 'flight')));
    expect(heard).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    expect(heard).toHaveBeenCalledTimes(1);
    unsubscribe();
    see(reading(T1, false, js('j1', 'done')));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('stays through the pause after a result until 9,999 ms and is gone at 10,000', () => {
    see(reading(T1, true, js('j1', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    see(reading(T1, true, js('j1', 'done')));
    vi.advanceTimersByTime(COMPUTER_USE_PAUSE_MS - 1);
    expect(state()).toEqual(RUNNING);
    vi.advanceTimersByTime(1);
    expect(kind()).toBe('absent');
  });

  it('keeps the line without a gap when the next call starts inside the pause, and counts the pause again from its result', () => {
    see(reading(T1, true, js('j1', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    see(reading(T1, true, js('j1', 'done')));
    vi.advanceTimersByTime(5_000);
    see(reading(T1, true, js('j1', 'done'), js('j2', 'flight')));
    expect(state()).toEqual(RUNNING); // no settling wait for a line already up
    vi.advanceTimersByTime(8_000);
    see(reading(T1, true, js('j1', 'done'), js('j2', 'done')));
    vi.advanceTimersByTime(COMPUTER_USE_PAUSE_MS - 1);
    expect(state()).toEqual(RUNNING);
    vi.advanceTimersByTime(1);
    expect(kind()).toBe('absent');
  });

  it('leaves at once when the turn ends normally', () => {
    see(reading(T1, true, js('j1', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    see(reading(T1, true, js('j1', 'done')));
    see(reading(T1, false, js('j1', 'done')));
    expect(kind()).toBe('absent');
  });

  it('turns to the lingering line when the turn is interrupted while a call it showed ran', () => {
    withdrawnAfterShowing();
  });

  it('never shows a call that waited for permission, and a denied one never lingers', () => {
    see(reading(T1, true, js('j1', 'flight')));
    vi.advanceTimersByTime(100);
    see(reading(T1, true, js('j1', 'waiting')));
    vi.advanceTimersByTime(60_000);
    expect(kind()).toBe('absent');
    see(reading(T1, true, js('j1', 'withdrawn')));
    see(reading(T1, false, js('j1', 'withdrawn')));
    vi.advanceTimersByTime(60_000);
    expect(kind()).toBe('absent');
  });

  it('leaves while a call of the turn waits for permission and none is in flight, and comes back after the answer', () => {
    see(reading(T1, true, js('j1', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    see(reading(T1, true, js('j1', 'waiting')));
    expect(kind()).toBe('absent');
    see(reading(T1, true, js('j1', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS - 1);
    expect(kind()).toBe('absent');
    vi.advanceTimersByTime(1);
    expect(state()).toEqual(RUNNING);
  });

  it('draws nothing for js_reset or end_task in flight', () => {
    see(reading(T1, true, reset('r1', 'flight'), end('e1', 'flight')));
    vi.advanceTimersByTime(60_000);
    expect(kind()).toBe('absent');
  });

  it('clears every timer when stopped (the pane unmounted)', () => {
    see(reading(T1, true, js('j1', 'flight')));
    expect(vi.getTimerCount()).toBe(1);
    tracker.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(kind()).toBe('absent');
  });

  it('resets everything for another session’s id', () => {
    withdrawnAfterShowing();
    see(reading(null, false), { appSessionId: B });
    expect(kind()).toBe('absent');
    see(reading(T1, false, js('j1', 'withdrawn')));
    expect(kind()).toBe('absent'); // nothing remembered of A's call
  });
});

describe('the lingering line', () => {
  it('has no clock: a call withdrawn seventy seconds after it was first seen still lingers an hour later', () => {
    see(reading(T1, true, js('j1', 'flight'))); // its `timeout_ms` was 30,000, and an approval suspended its budget for forty
    vi.advanceTimersByTime(70_000);
    expect(state()).toEqual(RUNNING);
    see(reading(T1, false, js('j1', 'withdrawn')));
    vi.advanceTimersByTime(60 * 60_000);
    expect(state()).toEqual(lingering('j1'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads running for a call queued behind the withdrawn one, and lingers for that call when it is withdrawn too', () => {
    withdrawnAfterShowing('j1', T1);
    see(reading(T2, true, js('j2', 'flight')));
    expect(state()).toEqual(lingering('j1'));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    expect(state()).toEqual({ kind: 'running', turnId: T2 });
    see(reading(T2, false, js('j2', 'withdrawn')));
    expect(state()).toEqual(lingering('j2'));
    see(reading(T2, false, js('j2', 'withdrawn')));
    expect(state()).toEqual(lingering('j2'));
  });

  // A later withdrawal is no evidence for an earlier one: both calls the line showed stay unresolved, the line naming the
  // latest, until evidence that holds for each comes (the review's case: j2 shown past the 250 ms, then withdrawn too).
  const bothWithdrawn = () => {
    withdrawnAfterShowing('j1', T1);
    withdrawnAfterShowing('j2', T2);
    expect(state()).toEqual(lingering('j2'));
  };
  const afterBoth = (...calls: ComputerUseCall[]) => reading(T2, false, js('j2', 'withdrawn'), ...calls);

  it('keeps every withdrawn call it showed: after j1 and then j2 are withdrawn the line lingers, and a later call’s done takes it away', () => {
    bothWithdrawn();
    see(afterBoth(js('j3', 'failed')));
    expect(state()).toEqual(lingering('j2'));
    see(afterBoth(js('j3', 'done')));
    expect(kind()).toBe('absent');
    see(afterBoth(js('j3', 'withdrawn'))); // read differently: neither call has its evidence any more
    expect(state()).toEqual(lingering('j2'));
  });

  it('after two withdrawn calls, leaves when the process exits, when the server goes, or at Dismiss, and none comes back', () => {
    for (const leave of ['process', 'server', 'dismiss'] as const) {
      tracker.stop();
      tracker = new StripTracker();
      bothWithdrawn();
      if (leave === 'dismiss') tracker.dismiss();
      else see(afterBoth(), leave === 'process' ? { processGone: true } : { serverGone: true });
      expect(kind(), leave).toBe('absent');
      see(afterBoth(js('j3', 'withdrawn')));
      see(reading(T1, false, js('j1', 'withdrawn')));
      expect(kind(), leave).toBe('absent');
    }
  });

  it('when a result resolves the earlier call but not the later one, the line stays for the later one', () => {
    withdrawnAfterShowing('j1', T1);
    see(reading(T2, true, js('jx', 'done'))); // after j1: its evidence
    expect(kind()).toBe('absent');
    see(reading(T2, true, js('jx', 'done'), js('j2', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    expect(state()).toEqual({ kind: 'running', turnId: T2 });
    see(reading(T2, false, js('jx', 'done'), js('j2', 'withdrawn'))); // jx came before j2: no evidence for it
    expect(state()).toEqual(lingering('j2'));
  });

  it('is resolved by a later js call’s ordinary result, in a later turn, and goes back to running and then to the pause', () => {
    withdrawnAfterShowing('j1', T1);
    see(reading(T2, true, js('j2', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    see(reading(T2, true, js('j2', 'done')));
    expect(state()).toEqual({ kind: 'running', turnId: T2 });
    vi.advanceTimersByTime(COMPUTER_USE_PAUSE_MS);
    expect(kind()).toBe('absent');
  });

  it('is resolved at once by a later call’s result even when the strip never showed that call', () => {
    withdrawnAfterShowing('j1', T1);
    see(reading(T2, false, js('j2', 'done')));
    expect(kind()).toBe('absent');
  });

  it('is resolved by an end_task result and by a js_reset result, in the same turn', () => {
    withdrawnAfterShowing('j1', T1);
    see(reading(T1, false, js('j1', 'withdrawn'), end('e1', 'done')));
    expect(kind()).toBe('absent');

    tracker = new StripTracker();
    withdrawnAfterShowing('j1', T1);
    see(reading(T1, false, js('j1', 'withdrawn'), reset('r1', 'done')));
    expect(kind()).toBe('absent');
  });

  it('is not resolved by a result that came before the withdrawn call, nor by a later call still unanswered or withdrawn', () => {
    see(reading(T1, true, js('j0', 'done'), js('j1', 'flight')));
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS);
    see(reading(T1, false, js('j0', 'done'), js('j1', 'withdrawn')));
    expect(state()).toEqual(lingering('j1'));
    see(reading(T1, false, js('j0', 'done'), js('j1', 'withdrawn'), reset('r1', 'withdrawn')));
    expect(state()).toEqual(lingering('j1'));
  });

  it('is not resolved for good by a result that is then read differently: a later call read done and then withdrawn brings the line back', () => {
    withdrawnAfterShowing('j1', T1);
    see(reading(T2, true, js('j2', 'flight'))); // queued behind the withdrawn cell
    vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS - 1); // never shown
    see(reading(T2, true, js('j2', 'done')));
    expect(kind()).toBe('absent');
    see(reading(T2, false, js('j2', 'withdrawn'))); // the marker's row arrived after the result's
    expect(state()).toEqual(lingering('j1'));
  });

  it('keeps a later call’s result as evidence while the reading moves on to a turn with no call', () => {
    withdrawnAfterShowing('j1', T1);
    see(reading(T2, false, js('j2', 'done')));
    expect(kind()).toBe('absent');
    see(reading(T3, true));
    see(reading(T3, false));
    expect(kind()).toBe('absent');
  });

  it('is not resolved by a later call’s error result (a call the plugin answered before queuing a cell, or one that ran and threw)', () => {
    withdrawnAfterShowing('j1', T1);
    see(reading(T2, false, js('j2', 'failed'), reset('r1', 'failed'), end('e1', 'failed')));
    expect(state()).toEqual(lingering('j1'));
  });

  it('is resolved when the session’s process is known gone', () => {
    withdrawnAfterShowing();
    see(reading(T1, false, js('j1', 'withdrawn')), { processGone: true });
    expect(kind()).toBe('absent');
  });

  it('is resolved when the session’s status lists no connected computer-use server, and not while it lists one', () => {
    withdrawnAfterShowing();
    see(reading(T1, false, js('j1', 'withdrawn')), { serverGone: false });
    expect(state()).toEqual(lingering('j1'));
    see(reading(T1, false, js('j1', 'withdrawn')), { serverGone: true });
    expect(kind()).toBe('absent');
  });

  it('leaves at Dismiss and does not come back for that call', () => {
    withdrawnAfterShowing();
    tracker.dismiss();
    expect(kind()).toBe('absent');
    see(reading(T1, false, js('j1', 'withdrawn')));
    vi.advanceTimersByTime(60_000);
    expect(kind()).toBe('absent');
  });

  it('is never entered for a withdrawn call the strip did not show (a pane mounted after it)', () => {
    see(reading(T1, false, js('j1', 'withdrawn')));
    expect(kind()).toBe('absent');
  });
});
