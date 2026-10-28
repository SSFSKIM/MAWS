// The link's timing against the endpoint's own constants (P5 O7 M1, Interfaces §G): the direct bucket mirrors the
// listener's per-source handshake limit, the resume window its interest's RESUME_MS, the subscription cap its MAX_SUBS.
import { FRESH_MS } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { HANDSHAKE_LIMITS } from '../../../endpoint/direct-listener';
import { PING_MS } from '../../../endpoint/channels';
import { RESUME_MS } from '../../../endpoint/interest';
import { MAX_SUBS as ENDPOINT_MAX_SUBS } from '../../../endpoint/subscriptions';
import { MAX_SUBS, REMOTE_TIMING, TokenBucket } from './timing';

describe('the link’s timing', () => {
  it('mirrors the endpoint’s constants', () => {
    expect(REMOTE_TIMING.DIRECT_BUCKET).toEqual(HANDSHAKE_LIMITS.perSource);
    expect(REMOTE_TIMING.RESUME_WINDOW_MS).toBe(RESUME_MS);
    expect(REMOTE_TIMING.PING_SILENCE_MS).toEqual(PING_MS);
    expect(REMOTE_TIMING.ACT_FRESH_MS).toBe(FRESH_MS);
    expect(MAX_SUBS).toBe(ENDPOINT_MAX_SUBS);
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
});
