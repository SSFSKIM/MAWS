// `mawsd`'s own refusal of an app's hello, logged at most once a minute per app and socket (P5 O4 M4;
// docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D45). A refused app keeps asking on each socket for as long as it
// runs (its transport waits on the refusal and says hello again every few seconds, src/shared/host/detached-transport.ts),
// so a line per refusal would grow mawsd.log without end. A key's first refusal is logged as it is; those within the
// minute after a logged line are counted, and the next one past the minute is logged with that count.
export const REFUSAL_LOG_EVERY_MS = 60_000;
const FORGOTTEN_AFTER_MS = 10 * REFUSAL_LOG_EVERY_MS; // a key this quiet is an app gone: its entry goes

export function refusalLog(log: (line: string) => void, now: () => number = Date.now): (key: string, line: string) => void {
  const logged = new Map<string, { at: number; held: number }>();
  return (key, line) => {
    const at = now();
    const last = logged.get(key);
    if (last && at - last.at < REFUSAL_LOG_EVERY_MS) {
      last.held += 1;
      return;
    }
    for (const [other, entry] of logged) if (at - entry.at >= FORGOTTEN_AFTER_MS) logged.delete(other);
    log(last && last.held > 0 ? `${line} (refused ${last.held} more times since the last line)` : line);
    logged.set(key, { at, held: 0 });
  };
}
