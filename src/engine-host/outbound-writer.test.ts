import { describe, expect, it } from 'vitest';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { JournalClosed, OutboundWriter } from './outbound-writer';
import type { EngineTransport } from './transport';

const frame: StdinFrame = { type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: {} } };

function harness(opts: { write?: () => Promise<void>; throwOn?: (direction: string, frame: unknown) => Error | null } = {}) {
  const rows: JournalRow[] = [];
  const failures: Error[] = [];
  const transport = { write: opts.write ?? (() => Promise.resolve()) } as unknown as EngineTransport;
  const writer = new OutboundWriter(transport, {
    row(direction, f) {
      const error = opts.throwOn?.(direction, f) ?? null;
      if (error) throw error;
      const row = { seq: rows.length + 1, direction, at: 'T', frame: f };
      rows.push(row);
      return row;
    },
  });
  writer.onJournalFailure((e) => failures.push(e));
  return { writer, rows, failures };
}

describe('outbound writer: journal after the flush, failures surfaced', () => {
  it('a journal-closed error after the exit is suppressed; the write still resolves', async () => {
    const { writer, rows, failures } = harness({ throwOn: () => new JournalClosed('out') });
    await expect(writer.write(frame)).resolves.toBeUndefined();
    expect(rows).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('any other journal failure while live surfaces: a journal_failed transport_error row, the write rejects, the failure handler runs', async () => {
    let once = true;
    const { writer, rows, failures } = harness({
      throwOn: (direction) => {
        if (direction !== 'out' || !once) return null;
        once = false;
        return new Error('ENOSPC: no space left on device');
      },
    });
    let flushed = false;
    await expect(writer.write(frame, { flushed: () => (flushed = true) })).rejects.toThrow('ENOSPC');
    expect(rows.map((r) => r.frame)).toEqual([{ event: 'transport_error', code: 'journal_failed', message: 'journal write failed: ENOSPC: no space left on device' }]);
    expect(failures.map((e) => e.message)).toEqual(['ENOSPC: no space left on device']);
    expect(flushed).toBe(false);
    expect(writer.busy).toBe(false);
  });

  it('failPending settles every unsettled write as write_failed once; a late transport answer changes nothing', async () => {
    let release!: () => void;
    const { writer, rows } = harness({ write: () => new Promise<void>((r) => (release = r)) });
    const writing = writer.write(frame);
    expect(writer.busy).toBe(true);
    let idle = false;
    void writer.whenIdle().then(() => (idle = true));
    writer.failPending('the process exited');
    await expect(writing).rejects.toThrow('the process exited');
    release();
    await new Promise((r) => setImmediate(r));
    expect(rows.map((r) => [r.direction, (r.frame as { event?: string }).event])).toEqual([['meta', 'write_failed']]);
    expect(idle).toBe(true);
  });
});
