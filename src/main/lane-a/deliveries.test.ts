// The delivery lane (P5 O9 M2, Interfaces §B "The delivery lane"): one ordered lane per session, one `deliver` in flight,
// each send's seq written before its post, retried under its own key, and each send's fate tracked by its key.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeliveryLane, fileSeqStore, type PostResult } from './deliveries';

const scratch: string[] = [];
afterEach(() => {
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});
const userData = () => {
  const d = mkdtempSync(join(tmpdir(), 'o9l-'));
  scratch.push(d);
  return d;
};

const timing = { retryDelaysMs: [20, 40], answerMs: 300, keepMs: 200, capacity: 8 };
const submitted: PostResult = { kind: 'answer', status: 200, body: { ok: true, result: { submitted: true } } };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

function laneWith(post: (body: Record<string, unknown>) => Promise<PostResult>, data = userData()) {
  const seqs = fileSeqStore(join(data, 'lane-a', 'deliveries.json'));
  let changes = 0;
  const lane = new DeliveryLane({ writer: 'maws/ref', session: 'sess-1', seqs, post, changed: () => void (changes += 1), timing });
  return { lane, data, changes: () => changes };
}

describe('the delivery lane', () => {
  it('posts sends in arrival order, the second only once the first has its answer', async () => {
    const first = deferred<PostResult>();
    const posted: number[] = [];
    const { lane } = laneWith(async (body) => {
      const seq = (body.key as { seq: number }).seq;
      posted.push(seq);
      return seq === 1 ? first.promise : submitted;
    });
    const a = lane.send('one');
    const b = lane.send('two');
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toEqual([1]);
    expect(lane.entries().map((d) => [d.key.seq, d.state])).toEqual([[1, 'queued'], [2, 'queued']]);
    lane.fate({ writer: 'maws/ref', seq: 1 }, 'entered', 'row-1'); // the stream may name the fate before the post answers
    expect(await a).toEqual({ key: { writer: 'maws/ref', seq: 1 }, state: 'entered', uuid: 'row-1' });
    expect(posted).toEqual([1]); // the next still waits for the first post's answer
    first.resolve(submitted);
    await expect.poll(() => posted).toEqual([1, 2]);
    lane.fate({ writer: 'maws/ref', seq: 2 }, 'entered', 'row-2');
    expect(await b).toEqual({ key: { writer: 'maws/ref', seq: 2 }, state: 'entered', uuid: 'row-2' });
  });

  it('writes the seq before its post, so the file names it when the post goes', async () => {
    const data = userData();
    const file = join(data, 'lane-a', 'deliveries.json');
    const seen: unknown[] = [];
    const { lane } = laneWith(async () => {
      seen.push(JSON.parse(readFileSync(file, 'utf8')));
      return submitted;
    }, data);
    void lane.send('one');
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toEqual({ version: 1, seq: { 'sess-1': 1 } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = fileSeqStore(file); // a restart goes on from the file
    expect(again.allocate('sess-1')).toBe(2);
  });

  it('retries a timed-out post under the same key, and reads duplicate to a retry as taken', async () => {
    const bodies: Record<string, unknown>[] = [];
    const { lane } = laneWith(async (body) => {
      bodies.push(body);
      if (bodies.length === 1) return { kind: 'answer', status: 504, body: { error: 'the session did not answer' } };
      return { kind: 'answer', status: 200, body: { ok: true, result: { duplicate: true } } };
    });
    const answer = lane.send('one');
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies.map((b) => b.key)).toEqual([{ writer: 'maws/ref', seq: 1 }, { writer: 'maws/ref', seq: 1 }]);
    expect(bodies[0]).toEqual({ op: 'deliver', key: { writer: 'maws/ref', seq: 1 }, text: 'one' });
    await expect.poll(() => lane.entries()[0]?.state).toBe('submitted');
    lane.fate({ writer: 'maws/ref', seq: 1 }, 'entered', 'row-1');
    expect(await answer).toMatchObject({ state: 'entered', uuid: 'row-1' });
  });

  it('ends a send unconfirmed after three lost posts, and the next send goes under the next seq', async () => {
    const seqs: number[] = [];
    const { lane } = laneWith(async (body) => {
      const seq = (body.key as { seq: number }).seq;
      seqs.push(seq);
      return seq === 1 ? { kind: 'lost' } : submitted;
    });
    expect(await lane.send('one')).toEqual({ key: { writer: 'maws/ref', seq: 1 }, state: 'unconfirmed', reason: 'the bridge did not answer its post' });
    const next = lane.send('two');
    await expect.poll(() => seqs).toEqual([1, 1, 1, 2]);
    lane.fate({ writer: 'maws/ref', seq: 2 }, 'entered', 'row-2');
    expect(await next).toMatchObject({ key: { seq: 2 }, state: 'entered' });
  });

  it('reads duplicate to a first copy as refused, never a success', async () => {
    const { lane } = laneWith(async () => ({ kind: 'answer', status: 200, body: { ok: true, result: { duplicate: true } } }));
    expect(await lane.send('one')).toEqual({ key: { writer: 'maws/ref', seq: 1 }, state: 'refused', reason: 'the bridge had already taken this key' });
  });

  it('ends a send refused with the bridge’s reason, whether its post or its entry is refused', async () => {
    const { lane } = laneWith(async (body) =>
      (body.key as { seq: number }).seq === 1
        ? { kind: 'answer', status: 200, body: { ok: false, error: 'MAWS controls this session', code: 'lane-b' } }
        : submitted);
    expect(await lane.send('one')).toEqual({ key: { writer: 'maws/ref', seq: 1 }, state: 'refused', reason: 'MAWS controls this session', code: 'lane-b' });
    const idle = lane.send('two');
    await expect.poll(() => lane.entries().find((d) => d.key.seq === 2)?.state).toBe('submitted');
    lane.fate({ writer: 'maws/ref', seq: 2 }, 'refused', undefined, 'the prompt was dropped: queue full');
    expect(await idle).toEqual({ key: { writer: 'maws/ref', seq: 2 }, state: 'refused', reason: 'the prompt was dropped: queue full' });
  });

  it('answers a send still submitted at its bound, its later fate arriving in the entries', async () => {
    const { lane } = laneWith(async () => submitted);
    expect(await lane.send('one')).toEqual({ key: { writer: 'maws/ref', seq: 1 }, state: 'submitted' });
    lane.fate({ writer: 'maws/ref', seq: 1 }, 'entered', 'row-1');
    expect(lane.entries()).toMatchObject([{ key: { seq: 1 }, state: 'entered', uuid: 'row-1' }]);
  });

  it('makes a send still submitted when its stream is lost unconfirmed once the fresh snapshot arrives', async () => {
    const { lane } = laneWith(async () => submitted);
    const answer = lane.send('one');
    await expect.poll(() => lane.entries()[0]?.state).toBe('submitted');
    lane.streamLost();
    expect(lane.entries()[0]?.state).toBe('submitted');
    lane.snapshotArrived();
    expect(await answer).toEqual({ key: { writer: 'maws/ref', seq: 1 }, state: 'unconfirmed', reason: 'the bridge’s stream was lost before it said whether this entered' });
  });

  it('holds at most eight sends, and keeps settled ones only a while', async () => {
    const gate = deferred<PostResult>();
    const { lane } = laneWith(() => gate.promise);
    const sends = Array.from({ length: 8 }, (_, i) => lane.send(`m${i}`));
    expect(await lane.send('ninth')).toEqual({ key: null, state: 'refused', reason: 'too many messages waiting for this session', code: 'busy' });
    gate.resolve({ kind: 'answer', status: 200, body: { ok: false, error: 'no' } });
    await Promise.all(sends);
    expect(lane.entries()).toHaveLength(8);
    await expect.poll(() => lane.entries().length, { timeout: 2000 }).toBe(0);
  });

  it('refuses what is queued when the lane closes', async () => {
    const gate = deferred<PostResult>();
    const { lane } = laneWith(() => gate.promise);
    void lane.send('one');
    const queued = lane.send('two');
    lane.close('the session’s bridge went away');
    expect(await queued).toMatchObject({ key: { seq: 2 }, state: 'refused', reason: 'the session’s bridge went away' });
    gate.resolve(submitted);
  });

  it('starts above the clock when its file does not parse, so no key falls below a mark already taken', () => {
    const data = userData();
    const file = join(data, 'deliveries.json');
    writeFileSync(file, '{not json');
    const before = Date.now();
    expect(fileSeqStore(file, () => {}).allocate('sess-1')).toBeGreaterThanOrEqual(before);
  });
});
