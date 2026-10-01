import { describe, expect, it } from 'vitest';
import { record } from '../../../../../test/support/builders';
import { heldByRow } from './model';

// W7 (charter §4.3 as amended 2026-10-01): Session info names who holds the session through the glyph's derivation.
describe("Session info's Held by row", () => {
  it('reads MAWS, MAWS and the contesting process, the foreign holder alone, or no process', () => {
    expect(heldByRow(record('s', { holder: { kind: 'self' } }))).toEqual({ label: 'Held by', value: 'MAWS' });
    expect(heldByRow(record('s', { holder: { kind: 'self', contestedBy: { kind: 'terminal', pid: 96367 } } }))).toEqual({
      label: 'Held by',
      value: 'MAWS and Terminal · pid 96367',
      note: 'Contested: MAWS yields once the other process writes',
    });
    expect(heldByRow(record('s', { holder: { kind: 'background_job', pid: 4, jobId: 'abcd1234' } }))).toEqual({ label: 'Held by', value: 'bg · abcd1234', note: 'Read-only here' });
    expect(heldByRow(record('s', { holder: { kind: 'none' } }))).toEqual({ label: 'Held by', value: 'No process' });
  });
});
