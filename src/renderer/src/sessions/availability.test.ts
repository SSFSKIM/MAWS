// P2-A (X16, the execution document §5.2): the renderer's accessor over main's digest.
import { describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { digest, record, status } from '../../../../test/support/builders';
import { availabilityIn } from './availability';

const A = 'app-a' as AppSessionId;
const state = (over: { process?: EngineSessionStatus['process']; digest?: Partial<SessionDigest>; record?: boolean } = {}) => ({
  engine: new Map(over.process === undefined ? [] : [[A, { ...status(A), process: over.process }]]),
  digests: new Map(over.digest === undefined ? [] : [[A, digest(A, over.digest)]]),
  records: new Map(over.record === false ? [] : [[A, record(A)]]),
});

describe('availabilityIn', () => {
  it('answers usable for a ready status, whatever the digest still says', () => {
    expect(availabilityIn(state({ process: 'ready', digest: { availability: 'resumable' } }), A)).toBe('usable');
  });

  it('answers starting for a launching status before the digest follows, an archive excepted', () => {
    expect(availabilityIn(state({ process: 'initializing', digest: { availability: 'resumable' } }), A)).toBe('starting');
    expect(availabilityIn(state({ process: 'starting' }), A)).toBe('starting');
    expect(availabilityIn(state({ process: 'starting', digest: { availability: 'archived' } }), A)).toBe('archived');
  });

  it('answers the digest’s availability otherwise', () => {
    for (const availability of ['resumable', 'foreign_held', 'archived', 'needs_trust', 'missing_directory', 'failed', 'starting'] as const) {
      expect(availabilityIn(state({ process: 'exited', digest: { availability } }), A), availability).toBe(availability);
    }
  });

  it('answers resumable for a known record with no digest yet, and null for an id with neither (an unstarted intent)', () => {
    expect(availabilityIn(state(), A)).toBe('resumable');
    expect(availabilityIn(state({ record: false }), A)).toBeNull();
  });
});
