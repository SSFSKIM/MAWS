import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreFixture } from '../../../test/support/store-fixture';
import { readJsonWithRetry, RETRY_SCHEDULE_MS } from './sidecars';

describe('whole-file sidecars are parsed with retry', () => {
  let fixture: StoreFixture;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  const asTitle = (raw: unknown) => {
    const title = (raw as { customTitle?: unknown }).customTitle;
    if (typeof title !== 'string') throw new Error('no customTitle');
    return title;
  };

  it('attempts at 0, 20, 50, 100, 250 and 500 ms after the change', () => {
    expect(RETRY_SCHEDULE_MS).toEqual([0, 20, 50, 100, 250, 500]);
  });

  // "At once" without a clock: the schedule waits only through setTimeout, so under fake timers a read that waits for
  // a later attempt schedules a timer that never fires. The read's answer arriving with no timer ever scheduled is the
  // proof, whatever the machine's load (no wall-clock bound to overrun); a scheduled timer fails the case at once.
  const withoutWaiting = async <T>(read: () => Promise<T>): Promise<T> => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      let answer: { value: T } | null = null;
      const reading = read().then((value) => { answer = { value }; });
      while (answer === null) {
        if (vi.getTimerCount() > 0) throw new Error('the read waited for a scheduled attempt');
        await new Promise((resolve) => setImmediate(resolve)); // the real fs read settles across event-loop turns
      }
      await reading;
      return (answer as { value: T }).value;
    } finally {
      vi.useRealTimers();
    }
  };

  it('reads a whole file on the first attempt', async () => {
    const path = join(fixture.configHome, 'title.json');
    await writeFile(path, '{"customTitle":"Named","extra":1}');
    const parse = vi.fn(asTitle);
    expect(await withoutWaiting(() => readJsonWithRetry(path, parse))).toEqual({ status: 'ok', value: 'Named' });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('keeps retrying a half-written file until the writer finishes', async () => {
    const path = join(fixture.configHome, 'title.json');
    await writeFile(path, '{"customTi');
    setTimeout(() => void writeFile(path, '{"customTitle":"Later"}'), 60);
    expect(await readJsonWithRetry(path, asTitle)).toEqual({ status: 'ok', value: 'Later' });
  });

  it('retries a parsed value the acceptance predicate refuses (a registry record before its sessionId)', async () => {
    const path = join(fixture.configHome, '123.json');
    await writeFile(path, '{"pid":123}');
    setTimeout(() => void writeFile(path, '{"pid":123,"sessionId":"s"}'), 60);
    const record = await readJsonWithRetry(
      path,
      (raw) => raw as { sessionId?: string },
      (value) => value.sessionId !== undefined,
    );
    expect(record).toEqual({ status: 'ok', value: { pid: 123, sessionId: 's' } });
  });

  it('gives up after the sixth failure as unparseable, distinct from absence, so the caller keeps its previous value', async () => {
    const path = join(fixture.configHome, 'broken.json');
    await writeFile(path, 'not json');
    const started = Date.now();
    expect(await readJsonWithRetry(path, asTitle)).toEqual({ status: 'unparseable' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(490);
  });

  it('answers unreadable with the errno for a persistent filesystem error, distinct from unparseable content', async () => {
    const path = join(fixture.configHome, 'locked.json');
    await writeFile(path, '{"customTitle":"Named"}');
    await chmod(path, 0o000); // the fixture's own temp file
    try {
      expect(await readJsonWithRetry(path, asTitle)).toEqual({ status: 'unreadable', code: 'EACCES' });
    } finally {
      await chmod(path, 0o644);
    }
  });

  it('answers unreadable, not absent, for a path through a regular file (ENOTDIR)', async () => {
    const file = join(fixture.configHome, 'a-file');
    await writeFile(file, 'x');
    expect(await readJsonWithRetry(join(file, 'x.json'), asTitle)).toEqual({ status: 'unreadable', code: 'ENOTDIR' });
  });

  it('answers absent at once for a file that does not exist: a missing file is an answer, not a torn write', async () => {
    const read = () => readJsonWithRetry(join(fixture.configHome, 'absent.json'), asTitle);
    expect(await withoutWaiting(read)).toEqual({ status: 'absent' });
  });
});
