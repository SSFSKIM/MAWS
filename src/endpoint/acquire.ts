// A remote acquisition's deadline (P5 O7 M5c review 1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "O4's
// surfaces"). `artifacts.holdAssets` and `connectors.open` take something on this machine for the asking channel (a
// snapshot hold on the engine host, a page's lease on the machine's services) and answer its id, which only the device
// can let go of. A device gives up on a call at its link's deadline (src/main/machines/remote/timing.ts' CALL_TIMEOUT_MS,
// 10 s; neither command carries a budget, src/services/command-budgets.ts) and forgets it, so an id answered after that
// reaches no one, and what it names would live, unreleasable, until the channel ends, spending the channel's bound.
//
// So the endpoint bounds the acquisition itself, from the call's arrival at the gate (its authorization counted), at
// ACQUIRE_WITHIN_MS: ACQUIRE_MARGIN_MS under the device's deadline, for the call's way here and its answer's way back (the
// margin src/mawsd/discovery-wake.ts leaves under the same deadline). Past it the call answers `timeout` (the device's
// own word at its deadline), and what the host answers after it is let go of here, at once, under the channel's ref. Past it is
// judged by the clock at the answer's arrival as well as by a timer, since a stalled event loop runs the answer first.
export const ACQUIRE_WITHIN_MS = 8_000;
export const ACQUIRE_MARGIN_MS = 2_000;

/** What `within` answers for an acquisition its bound passed: the answer, when it comes, is `late`'s. */
export const LATE = Symbol('late');

/**
 * `ask`'s answer if it settles by `by` (a time on `now`'s clock), else LATE, decided once: from that step on the answer is
 * `late`'s, whenever it comes, null for one that failed or was never asked (`by` passed before it could be). A rejection
 * within the bound rejects. The bound is judged by the clock at the moment the answer arrives as well as by the timer: an
 * event loop that stalled across `by` runs the answer's continuation ahead of the overdue timer, and an answer then is
 * late (the device's deadline has passed with it) whichever of the two runs first.
 */
export function within<T>(by: number, now: () => number, ask: () => Promise<T>, late: (answer: T | null) => void): Promise<T | typeof LATE> {
  if (now() >= by) {
    late(null);
    return Promise.resolve(LATE);
  }
  const asked = ask();
  return new Promise((resolve, reject) => {
    let decided = false;
    const timer = setTimeout(() => {
      decided = true;
      resolve(LATE);
      asked.then(late, () => late(null));
    }, by - now());
    timer.unref?.();
    asked.then(
      (answer) => {
        if (decided) return;
        decided = true;
        clearTimeout(timer);
        if (now() >= by) {
          resolve(LATE);
          late(answer);
        } else resolve(answer);
      },
      (error: unknown) => {
        if (decided) return;
        decided = true;
        clearTimeout(timer);
        if (now() >= by) {
          resolve(LATE);
          late(null);
        } else reject(error);
      },
    );
  });
}
