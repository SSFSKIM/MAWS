// The derivation budget's lane-on case (UX wave U2b; the execution document, Concrete Steps 4 and "Cost on a long
// transcript"): `transcript/model/perf.test.ts`'s session of five hundred turns with a message in each, the lane on and
// the view in force, so no turn folds and every turn's rows are in the flat list; the mirror runs over them once per
// change of the rows, as its callers memoise it. Read by hand and compared base against head, not bounded here: it lives
// beside the mirror, since the node project typechecks the model's directory and lists no file of this one. Skipped
// unless MAWS_PERF=1. From M7 (Concrete Steps 4) the mirror is handed five hundred stored runs as its labels, one for
// each turn's work, bounded by the turn's first and last call as the to-human mod's tracker bounds a run, and the labels
// are made at each change of the rows, as `Transcript` makes them.
import type { SessionEvent } from '@shared/graph/events';
import type { StoredRun } from '@shared/owner/folds';
import type { ApiMessageId, EventId } from '@shared/graph/ids';
import { describe, expect, it } from 'vitest';
import { synthesise } from '../../../../../test/support/synth-transcript';
import { rowsOf } from '../../transcript/model/derive';
import { applyEvents, createState, withUi } from '../../transcript/model/reduce';
import type { Row } from '../../transcript/model/rows';
import { labelsOf } from './label';
import { liveMarkedRowIds, mirrorRows } from './mirror';

const enabled = process.env.MAWS_PERF === '1';

// Every completed text a message, so each turn holds one; the streaming deltas are left as they are.
const asMessage = (event: SessionEvent): SessionEvent =>
  event.kind === 'assistant.block.complete' && event.block.type === 'text' ? { ...event, block: { ...event.block, text: `<message>${event.block.text}</message>` } } : event;

describe.skipIf(!enabled)('performance budget, the lane on', () => {
  it('derives synthesise({ turns: 500 }) with a message in each turn, no turn folded, and mirrors it; then a hundred delta batches', () => {
    const events = synthesise({ turns: 500, seed: 1, streamLast: true }).map(asMessage);
    const lastDelta = events.findLast((event) => event.kind === 'assistant.block.delta')!;
    const firstStreamed = events.findIndex((event) => event.kind === 'assistant.block.delta' && event.apiMessageId === (lastDelta as { apiMessageId: ApiMessageId }).apiMessageId);
    const history = events.slice(0, firstStreamed);
    const stream = events.slice(firstStreamed);
    // five hundred stored runs, each a turn's calls from its first to its last (invented summaries)
    const turnsCalls: string[][] = [];
    for (const event of history) {
      if (event.kind === 'turn.started') turnsCalls.push([]);
      else if (event.kind === 'tool.use') turnsCalls.at(-1)?.push(event.toolUseId);
    }
    const stored: StoredRun[] = turnsCalls.filter((calls) => calls.length > 0).slice(0, 500).map((calls, i) => ({ first: calls[0]!, last: calls.at(-1)!, summary: `Did the work of turn ${i + 1}` }));
    while (stored.length < 500) stored.push({ first: `toolu_unheld_${stored.length}`, last: `toolu_unheld_${stored.length}`, summary: 'A run this window holds no row of' });
    const labelled = (state: ReturnType<typeof createState>, rows: Row[]) => labelsOf(rows, { stored, running: state.current !== null, turns: state.turns });

    const startedDerive = performance.now();
    let state = applyEvents(createState(null, null), history);
    state = withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 });
    let rows = rowsOf(state);
    let drawn = mirrorRows(rows, {}, liveMarkedRowIds(state), labelled(state, rows));
    const deriveMs = performance.now() - startedDerive;

    const batchMs: number[] = [];
    for (let i = 0; i < 100 && i < stream.length; i += 1) {
      const batch: SessionEvent[] = [{ ...stream[i], id: `perf${i}` as EventId }];
      const started = performance.now();
      state = applyEvents(state, batch);
      const next: Row[] = rowsOf(state);
      if (next !== rows) drawn = mirrorRows(next, {}, liveMarkedRowIds(state), labelled(state, next)); // memoised on the rows, as its callers do
      rows = next;
      batchMs.push(performance.now() - started);
    }
    const median = [...batchMs].sort((a, b) => a - b)[Math.floor(batchMs.length / 2)];
    console.log(`perf (lane on, mirrored, ${stored.length} stored runs as labels, ${drawn.filter((row) => row.kind === 'record_fold' && row.label !== undefined).length} lines labelled): events=${history.length} rows=${rows.length} drawn=${drawn.length} deriveMs=${deriveMs.toFixed(1)} deltaBatchMedianMs=${median.toFixed(3)} deltaBatchMaxMs=${Math.max(...batchMs).toFixed(3)}`);
    expect(rows.length).toBeGreaterThan(1000);
    expect(drawn.length).toBeLessThan(rows.length);
  });
});
