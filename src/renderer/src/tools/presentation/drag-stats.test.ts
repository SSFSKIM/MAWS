// P4-B2 M0 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D17): the drag probe's summary. Each written move's
// time is split into its queue (the event's timeStamp to its first listener), its handler (that listener to the editor's
// transaction) and its paint (the transaction to the next frame); the updates of other origins are counted during the
// moves and after the drop, and the moves a remote apply or its following frame overlapped are set apart from the rest.
import { describe, expect, it } from 'vitest';
import { spread, summarizeDrag, type DragMove, type RemoteApply } from './drag-stats';

const move = (tIn: number, queue: number, handler?: number, paint?: number): DragMove => ({
  tIn,
  tDispatch: tIn + queue,
  ...(handler !== undefined && { tTx: tIn + queue + handler }),
  ...(handler !== undefined && paint !== undefined && { tFrame: tIn + queue + handler + paint }),
});

describe('spread', () => {
  it('reads p50, p95 and max at the index floor(q × n) of the sorted values, to 0.1 ms', () => {
    const values = Array.from({ length: 20 }, (_, i) => 20 - i + 0.04); // 20.04 … 1.04, unsorted
    expect(spread(values)).toEqual({ p50: 11, p95: 20, max: 20 });
    expect(spread([3.26])).toEqual({ p50: 3.3, p95: 3.3, max: 3.3 });
  });

  it('answers zeros for no values, so a record stays numeric', () => {
    expect(spread([])).toEqual({ p50: 0, p95: 0, max: 0 });
  });
});

describe('summarizeDrag', () => {
  it('splits each written move into queue, handler and paint, beside the move-to-transaction and move-to-frame totals', () => {
    const stats = summarizeDrag({ moves: [move(0, 10, 2, 3), move(16, 12, 1, 4), move(32, 4, 6, 1)], remotes: [], longTasks: 0 });
    expect(stats.moves).toBe(3);
    expect(stats.withTransaction).toBe(3);
    expect(stats.queueMs).toEqual({ p50: 10, p95: 12, max: 12 });
    expect(stats.handlerMs).toEqual({ p50: 2, p95: 6, max: 6 });
    expect(stats.paintMs).toEqual({ p50: 3, p95: 4, max: 4 });
    expect(stats.inputToTxMs).toEqual({ p50: 12, p95: 13, max: 13 });
    expect(stats.inputToFrameMs).toEqual({ p50: 15, p95: 17, max: 17 });
  });

  it('counts a move that wrote nothing (held by a snap) as a move, and leaves it out of every split', () => {
    const stats = summarizeDrag({ moves: [move(0, 10, 2, 3), move(16, 30)], remotes: [], longTasks: 2 });
    expect(stats.moves).toBe(2);
    expect(stats.withTransaction).toBe(1);
    expect(stats.queueMs).toEqual({ p50: 10, p95: 10, max: 10 });
    expect(stats.longTasks).toBe(2);
  });

  it('leaves a written move whose frame has not come out of the paint and move-to-frame figures only', () => {
    const stats = summarizeDrag({ moves: [move(0, 10, 2, 3), move(16, 5, 1)], remotes: [], longTasks: 0 });
    expect(stats.handlerMs.max).toBe(2);
    expect(stats.queueMs).toEqual({ p50: 10, p95: 10, max: 10 });
    expect(stats.paintMs).toEqual({ p50: 3, p95: 3, max: 3 });
    expect(stats.inputToFrameMs).toEqual({ p50: 15, p95: 15, max: 15 });
    expect(stats.inputToTxMs).toEqual({ p50: 12, p95: 12, max: 12 });
  });

  it('counts the remote applies before the drop was handled as during the moves, the rest as after it', () => {
    const remotes: RemoteApply[] = [
      { tStart: 10, tEnd: 14, tFrame: 20, tFrameEnd: 36 },
      { tStart: 90, tEnd: 99, tFrame: 110 },
      { tStart: 100, tEnd: 103 },
    ];
    const stats = summarizeDrag({ moves: [move(0, 10, 2, 3)], remotes, drop: { tIn: 95, tDispatch: 100 }, longTasks: 0 });
    expect(stats.remote.duringMoves).toBe(2);
    expect(stats.remote.afterDrop).toBe(1);
    expect(stats.remote.applyMs).toEqual({ p50: 4, p95: 9, max: 9 });
    // without a drop every remote apply fell during the moves
    expect(summarizeDrag({ moves: [move(0, 10, 2, 3)], remotes, longTasks: 0 }).remote).toMatchObject({ duringMoves: 3, afterDrop: 0 });
  });

  it('sets apart the moves whose input-to-frame a remote apply or its following frame overlapped, with the rest’s move-to-frame', () => {
    const moves = [
      move(0, 10, 2, 3), // 0..15: before the remote apply
      move(16, 10, 2, 3), // 16..31: the apply (20..24) lands while it waits
      move(32, 10, 2, 9), // 32..53: inside the apply's following frame (its frame at 30, that frame ending at 46)
      move(48, 10, 2, 3), // 48..63: after the following frame ended
      move(64, 20, 2, 3), // 64..89: a slow move no remote touched
    ];
    const stats = summarizeDrag({ moves, remotes: [{ tStart: 20, tEnd: 24, tFrame: 30, tFrameEnd: 46 }], longTasks: 0 });
    expect(stats.touched).toBe(2);
    expect(stats.untouchedToFrameMs).toEqual({ p50: 15, p95: 25, max: 25 });
  });

  it('bounds a remote apply whose frames have not come by its own end', () => {
    const moves = [move(0, 10, 2, 3), move(16, 10, 2, 3)];
    expect(summarizeDrag({ moves, remotes: [{ tStart: 14, tEnd: 15 }], longTasks: 0 }).touched).toBe(1);
    expect(summarizeDrag({ moves, remotes: [{ tStart: 14, tEnd: 15, tFrame: 17 }], longTasks: 0 }).touched).toBe(2);
  });

  it('(M6) reads the gesture hold: the frames it held as the drop came, each clearance by its 5 s cap in ms after the first move, and the frames it released', () => {
    const moves = [move(100, 10, 2, 3), move(116, 10, 2, 3)];
    expect(summarizeDrag({ moves, remotes: [], drop: { tIn: 150, tDispatch: 160, held: 3 }, caps: [5100.04], released: 5, longTasks: 0 }).hold).toEqual({ heldAtDrop: 3, capsMs: [5000], released: 5 });
    // a cap that cleared an empty hold released nothing
    expect(summarizeDrag({ moves, remotes: [], drop: { tIn: 150, tDispatch: 160 }, caps: [5100], released: 0, longTasks: 0 }).hold).toEqual({ heldAtDrop: 0, capsMs: [5000], released: 0 });
    // nothing held at the drop, the cap never reached, nothing released
    expect(summarizeDrag({ moves, remotes: [], drop: { tIn: 150, tDispatch: 160 }, longTasks: 0 }).hold).toEqual({ heldAtDrop: 0, capsMs: [], released: 0 });
  });

  it('times the drag from its first move’s timeStamp to the drop’s, or to its last move’s when no drop came', () => {
    const moves = [move(100, 10, 2, 3), move(116, 10, 2, 3), move(132.34, 10, 2, 3)];
    expect(summarizeDrag({ moves, remotes: [], drop: { tIn: 150.26, tDispatch: 160 }, longTasks: 0 }).durationMs).toBe(50.3);
    expect(summarizeDrag({ moves, remotes: [], longTasks: 0 }).durationMs).toBe(32.3);
    expect(summarizeDrag({ moves: [], remotes: [], longTasks: 0 }).durationMs).toBe(0);
  });
});
