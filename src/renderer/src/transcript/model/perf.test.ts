// The performance budget (C6 execution document, residue *Performance budget*; acceptance item 8): full derivation
// of a five-hundred-turn transcript under 300 ms and a hundred consecutive delta batches under 2 ms each (median).
// Skipped unless MAWS_PERF=1, so CI-style runs on slower machines do not flake; run explicitly in M6.
import type { SessionEvent } from '@shared/graph/events';
import type { ApiMessageId, EventId } from '@shared/graph/ids';
import { describe, expect, it } from 'vitest';
import { synthesise } from '../../../../../test/support/synth-transcript';
import { rowsOf } from './derive';
import { applyEvents, createState } from './reduce';

const enabled = process.env.MAWS_PERF === '1';

describe.skipIf(!enabled)('performance budget', () => {
  it('derives synthesise({ turns: 500 }) in under 300 ms and applies a hundred delta batches under 2 ms each (median)', () => {
    const events = synthesise({ turns: 500, seed: 1, streamLast: true });
    const lastDelta = events.findLast((event) => event.kind === 'assistant.block.delta')!;
    const firstStreamed = events.findIndex((event) => event.kind === 'assistant.block.delta' && event.apiMessageId === (lastDelta as { apiMessageId: ApiMessageId }).apiMessageId);
    const history = events.slice(0, firstStreamed);
    const stream = events.slice(firstStreamed);

    const startedDerive = performance.now();
    let state = applyEvents(createState(null, null), history);
    const rows = rowsOf(state);
    const deriveMs = performance.now() - startedDerive;

    const batchMs: number[] = [];
    for (let i = 0; i < 100 && i < stream.length; i += 1) {
      const batch: SessionEvent[] = [{ ...stream[i], id: `perf${i}` as EventId }];
      const started = performance.now();
      state = applyEvents(state, batch);
      rowsOf(state);
      batchMs.push(performance.now() - started);
    }
    const median = [...batchMs].sort((a, b) => a - b)[Math.floor(batchMs.length / 2)];
    console.log(`perf: events=${history.length} rows=${rows.length} deriveMs=${deriveMs.toFixed(1)} deltaBatchMedianMs=${median.toFixed(3)} deltaBatchMaxMs=${Math.max(...batchMs).toFixed(3)}`);
    expect(rows.length).toBeGreaterThan(1000);
    expect(deriveMs).toBeLessThan(300);
    expect(median).toBeLessThan(2);
  });
});
