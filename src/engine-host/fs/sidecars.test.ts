import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('reads a whole file on the first attempt', async () => {
    const path = join(fixture.configHome, 'title.json');
    await writeFile(path, '{"customTitle":"Named","extra":1}');
    const started = Date.now();
    expect(await readJsonWithRetry(path, asTitle)).toEqual({ status: 'ok', value: 'Named' });
    expect(Date.now() - started).toBeLessThan(20);
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

  it('answers absent at once for a file that does not exist: a missing file is an answer, not a torn write', async () => {
    const started = Date.now();
    expect(await readJsonWithRetry(join(fixture.configHome, 'absent.json'), asTitle)).toEqual({ status: 'absent' });
    expect(Date.now() - started).toBeLessThan(20);
  });
});
