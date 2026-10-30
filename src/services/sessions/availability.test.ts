// P2-A (X16, the execution document §5.2's table): availability, first match wins.
import { describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import { record, status, T0 } from '../../../test/support/builders';
import { availabilityOf, type AcquisitionMemory } from './availability';

const ID = 'a1';
const at = (process: EngineSessionStatus['process'], over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status(ID), process, ...over });
const inFlight: AcquisitionMemory = { inFlight: true, last: null };
const last = (kind: NonNullable<AcquisitionMemory['last']>['kind']): AcquisitionMemory => ({ inFlight: false, last: { kind, at: T0, message: kind === 'failed' ? 'the model is not available' : null } });
const terminal = record(ID, { holder: { kind: 'terminal', pid: 42 } });

describe('availabilityOf', () => {
  it('reads an archived record as archived before anything else', () => {
    expect(availabilityOf(record(ID, { archived: true }), at('ready'), inFlight)).toBe('archived');
  });

  it('reads a ready process as usable, W7’s contested self included', () => {
    expect(availabilityOf(record(ID), at('ready'), null)).toBe('usable');
    expect(availabilityOf(terminal, at('ready'), last('failed'))).toBe('usable'); // a terminal contending: MAWS's branch is pinned and live
  });

  it('reads an acquisition in flight, or a launching process, as starting', () => {
    expect(availabilityOf(record(ID), null, inFlight)).toBe('starting');
    expect(availabilityOf(record(ID), at('starting'), null)).toBe('starting');
    expect(availabilityOf(record(ID), at('initializing'), last('failed'))).toBe('starting');
    expect(availabilityOf(terminal, null, inFlight)).toBe('starting');
  });

  it('reads a terminal or background-job holder as foreign_held', () => {
    expect(availabilityOf(terminal, null, null)).toBe('foreign_held');
    expect(availabilityOf(record(ID, { holder: { kind: 'background_job', pid: 7, jobId: 'abcd' } }), at('exited'), last('needs_trust'))).toBe('foreign_held');
  });

  it('reads the last attempt’s answer when it did not end ready', () => {
    expect(availabilityOf(record(ID), null, last('needs_trust'))).toBe('needs_trust');
    expect(availabilityOf(record(ID), at('exited'), last('missing_directory'))).toBe('missing_directory');
    expect(availabilityOf(record(ID), null, last('failed'))).toBe('failed');
  });

  it('reads every other session with a record as resumable: never run, exited for any reason, evicted, exiting', () => {
    expect(availabilityOf(record(ID, { holder: { kind: 'none' } }), null, null)).toBe('resumable'); // discovered from disk, never run
    for (const reason of ['stop', 'crash', 'budget', 'idle', 'archive'] as const) {
      expect(availabilityOf(record(ID), at('exited', { exit: { code: null, signal: null, reason, at: T0, release: null } }), null), reason).toBe('resumable');
    }
    expect(availabilityOf(record(ID), null, { inFlight: false, last: null })).toBe('resumable'); // the exited row evicted
    expect(availabilityOf(record(ID), at('exiting'), null)).toBe('resumable');
  });
});
