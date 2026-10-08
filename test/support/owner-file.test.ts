// The A-15 comparison every live sitting shares (E11 M6, Decision Log 30's fix round): a key under the run's own scratch
// that appears or vanishes fails; any other key added or removed (another owner session's) is recorded and passes.
import { describe, expect, it } from 'vitest';
import { a15DeltaText, compareA15 } from './owner-file';

const before = ['/private/tmp/cua-accept', '/tmp/maws-e2-x'];
const ours = ['/private/tmp/maws-e11-p1live-r1', '/private/tmp/maws-e11-s1-config-abc'];

describe('compareA15', () => {
  it('passes identical readings', () => {
    expect(compareA15(before, [...before], ours)).toEqual({ identical: true, added: [], removed: [], breach: [] });
  });

  it('records a key another owner session added and one the owner removed, without a breach', () => {
    expect(compareA15(before, ['/private/tmp/cua-accept', '/tmp/other-session'], ours)).toEqual({ identical: false, added: ['/tmp/other-session'], removed: ['/tmp/maws-e2-x'], breach: [] });
  });

  it('fails a key under the run’s own scratch that appears, in either spelling of /tmp', () => {
    expect(compareA15(before, [...before, '/tmp/maws-e11-p1live-r1/s3/repo'], ours).breach).toEqual(['/tmp/maws-e11-p1live-r1/s3/repo']);
    expect(compareA15(before, [...before, '/private/tmp/maws-e11-p1live-r1'], ours).breach).toEqual(['/private/tmp/maws-e11-p1live-r1']);
    expect(compareA15(before, [...before, '/tmp/maws-e11-s1-config-abc'], ours).breach).toEqual(['/tmp/maws-e11-s1-config-abc']);
    expect(compareA15(before, [...before, '/private/tmp/x'], ['/tmp/x']).breach, 'a root given as /tmp, the key as /private/tmp').toEqual(['/private/tmp/x']);
  });

  it('fails a key under the run’s own scratch that vanishes', () => {
    const withOurs = [...before, '/tmp/maws-e11-p1live-r1/s4/repo'];
    expect(compareA15(withOurs, before, ours)).toEqual({ identical: false, added: [], removed: ['/tmp/maws-e11-p1live-r1/s4/repo'], breach: ['/tmp/maws-e11-p1live-r1/s4/repo'] });
  });

  it('takes a sibling sharing a root’s prefix as another’s, not the run’s', () => {
    expect(compareA15(before, [...before, '/private/tmp/maws-e11-p1live-r10'], ours).breach).toEqual([]);
  });
});

describe('a15DeltaText', () => {
  it('words identical, recorded and breaching deltas', () => {
    expect(a15DeltaText(compareA15(before, [...before], ours))).toBe('identical');
    expect(a15DeltaText(compareA15(before, [...before, '/tmp/other-session'], ours))).toBe('added ["/tmp/other-session"], removed []; none the sitting’s own (recorded, not a breach)');
    expect(a15DeltaText(compareA15(before, [...before, '/tmp/maws-e11-p1live-r1/repo'], ours))).toBe('added ["/tmp/maws-e11-p1live-r1/repo"], removed []; BREACH (the sitting’s own): ["/tmp/maws-e11-p1live-r1/repo"]');
  });
});
