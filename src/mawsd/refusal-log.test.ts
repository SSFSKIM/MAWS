// The refusal log's limit (P5 O4 M4, D45; refusal-log.ts): one line a minute per app and socket, the refusals between
// counted on the next line.
import { describe, expect, it } from 'vitest';
import { REFUSAL_LOG_EVERY_MS, refusalLog } from './refusal-log';

function limited() {
  const lines: string[] = [];
  let now = 1_000_000;
  const log = refusalLog((line) => void lines.push(line), () => now);
  return { lines, log, advance: (ms: number) => void (now += ms) };
}

describe('refusalLog', () => {
  it('logs a key’s first refusal as it is, and none of its repeats within the minute', () => {
    const { lines, log, advance } = limited();
    log('engine-host.sock 41', 'refuse wire to appPid 41');
    for (let i = 0; i < 11; i++) {
      advance(5_000);
      log('engine-host.sock 41', 'refuse wire to appPid 41');
    }
    expect(lines).toEqual(['refuse wire to appPid 41']);
  });

  it('logs the next refusal past the minute with the count of those it held back', () => {
    const { lines, log, advance } = limited();
    log('k', 'refused');
    advance(20_000);
    log('k', 'refused');
    advance(20_000);
    log('k', 'refused');
    advance(REFUSAL_LOG_EVERY_MS - 40_000);
    log('k', 'refused');
    advance(1_000);
    log('k', 'refused');
    expect(lines).toEqual(['refused', 'refused (refused 2 more times since the last line)']);
  });

  it('logs a refusal past the minute with no count when none came between', () => {
    const { lines, log, advance } = limited();
    log('k', 'refused');
    advance(REFUSAL_LOG_EVERY_MS);
    log('k', 'refused');
    expect(lines).toEqual(['refused', 'refused']);
  });

  it('limits each key apart: another socket or another app is logged at once', () => {
    const { lines, log } = limited();
    log('engine-host.sock 41', 'a');
    log('machine.sock 41', 'b');
    log('engine-host.sock 42', 'c');
    log('engine-host.sock 41', 'a');
    expect(lines).toEqual(['a', 'b', 'c']);
  });
});
