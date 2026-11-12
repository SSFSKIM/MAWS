// The link's timing against the endpoint's own constants (P5 O7 M1, Interfaces §G): the direct bucket mirrors the
// listener's per-source handshake limit, the resume window its interest's RESUME_MS, the subscription cap its MAX_SUBS.
import { FRESH_MS } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { HANDSHAKE_LIMITS } from '../../../endpoint/direct-listener';
import { PING_MS } from '../../../endpoint/channels';
import { RESUME_MS } from '../../../endpoint/interest';
import { MAX_SUBS as ENDPOINT_MAX_SUBS } from '../../../endpoint/subscriptions';
import { WAKE_DROP_MS } from '../../net/wake';
import { MAX_SUBS, REMOTE_TIMING, TokenBucket } from './timing';

describe('the link’s timing', () => {
  it('mirrors the endpoint’s constants', () => {
    expect(REMOTE_TIMING.DIRECT_BUCKET).toEqual(HANDSHAKE_LIMITS.perSource);
    expect(REMOTE_TIMING.RESUME_WINDOW_MS).toBe(RESUME_MS);
    expect(REMOTE_TIMING.PING_SILENCE_MS).toEqual(PING_MS);
    expect(REMOTE_TIMING.ACT_FRESH_MS).toBe(FRESH_MS);
    expect(MAX_SUBS).toBe(ENDPOINT_MAX_SUBS);
  });

  it('drops a channel at a wake of twice the endpoint’s shortest ping period (P5 O15 M2b §D)', () => {
    expect(WAKE_DROP_MS).toBe(2 * PING_MS[0]);
  });

  it('holds a burst of 3 and refills 5 a minute', () => {
    let now = 0;
    const bucket = new TokenBucket(REMOTE_TIMING.DIRECT_BUCKET, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    now += 11_999;
    expect(bucket.take()).toBe(false);
    now += 1;
    expect(bucket.take()).toBe(true);
    now += 10 * 60_000;
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
  });

  it('says whether a whole token is there, refilled, without taking it', () => {
    let now = 0;
    const bucket = new TokenBucket(REMOTE_TIMING.DIRECT_BUCKET, () => now);
    expect([bucket.holds(), bucket.holds(), bucket.holds(), bucket.holds()]).toEqual([true, true, true, true]);
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true]);
    expect(bucket.holds()).toBe(false);
    now += 11_999;
    expect(bucket.holds()).toBe(false);
    now += 1;
    expect([bucket.holds(), bucket.holds()]).toEqual([true, true]);
    expect([bucket.take(), bucket.holds(), bucket.take()]).toEqual([true, false, false]);
  });

  // P5 O15 M2b §F: a lane dials only while the bucket would keep a token after it, the last one being today's attempt's
  it('says whether two tokens are there, refilled, without taking them', () => {
    let now = 0;
    const bucket = new TokenBucket(REMOTE_TIMING.DIRECT_BUCKET, () => now);
    expect(bucket.holds(2)).toBe(true);
    bucket.take();
    expect(bucket.holds(2)).toBe(true);
    bucket.take();
    expect([bucket.holds(2), bucket.holds()]).toEqual([false, true]);
    now += 11_999;
    expect(bucket.holds(2)).toBe(false);
    now += 1;
    expect(bucket.holds(2)).toBe(true);
  });

  it('gives a lane’s attempt the window’s deadlines, its backoff and its count (P5 O15 M2b §F)', () => {
    expect(REMOTE_TIMING.WINDOW_OPEN_MS).toBe(2_000);
    expect(REMOTE_TIMING.WINDOW_HANDSHAKE_MS).toBe(2_000);
    expect(REMOTE_TIMING.LANE_BACKOFF_MS).toEqual([100, 250, 500, 1_000, 2_000]);
    expect(REMOTE_TIMING.LANE_ATTEMPTS).toBe(6);
  });
});
