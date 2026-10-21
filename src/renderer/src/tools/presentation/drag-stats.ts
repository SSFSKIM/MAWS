// The drag probe's summary (P4-B2 M0, docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D17), pure so its tests
// run without a page: what the presentations e2e seam's `dragProbe` records over one drag, summed up. S7b's measure
// (a pointer move's timeStamp to the editor's transaction it caused, then to the next animation frame) split in three:
//   queue    the move's timeStamp to its first listener (the probe's, capturing on the window): the wait before any
//            handler runs, which includes the browser holding a continuous event for the next frame
//   handler  that listener to the editor's transaction (the session's update)
//   paint    the transaction to the next animation frame
// and set beside the updates of other origins the session's doc applied (an agent's publishes, through the host): their
// count during the moves and after the drop, and the moves that one of them or its following frame overlapped.
// P4-B2 M6 (D17's gesture hold): the drag holds the replica's remote frames, so beside them, the frames the hold had
// buffered as the drop came (its flush applies them, merged, as one update), each time the hold's 5 s cap cleared it
// first (its buffer then applied mid-drag, and the frames after it arrive unheld), and the frames the hold released at
// either (the provider's count: a cap over an empty buffer releases none, so only this shows a frame held and let go).
// Every time is on the page's clock (ms; an event's timeStamp is on it too).

/** p50, p95 and max of a set of times (ms, to 0.1). */
export interface Spread {
  p50: number;
  p95: number;
  max: number;
}

/** One pointer move with a button down. */
export interface DragMove {
  tIn: number; // the event's timeStamp
  tDispatch: number; // its first listener ran
  tTx?: number; // the editor's transaction it caused
  tFrame?: number; // the animation frame after that transaction
}

/** One update of another origin than the session's, applied to its doc. */
export interface RemoteApply {
  tStart: number; // its transaction began
  tEnd: number; // its update was emitted, after its observers
  tFrame?: number; // the animation frame after it
  tFrameEnd?: number; // the frame after that one: the end of its following frame
}

export interface DragRecord {
  moves: DragMove[];
  remotes: RemoteApply[];
  /**
   * The pointerup that ended the drag: its timeStamp and when its first listener ran. M6: and the remote frames the
   * replica's hold had buffered then (absent: none).
   */
  drop?: { tIn: number; tDispatch: number; held?: number };
  longTasks: number;
  /** M6: when the probe saw each clearance of the hold by its 5 s cap (the cap's own apply, else the next move or the stop). */
  caps?: number[];
  /** M6: the buffered frames the hold released over the probe, at its cap or at the drop (absent: none). */
  released?: number;
}

export interface DragStats {
  moves: number;
  /** The moves that wrote (a move held where the last one was by a snap writes nothing). */
  withTransaction: number;
  inputToTxMs: Spread;
  inputToFrameMs: Spread;
  /** Over the moves that wrote. */
  queueMs: Spread;
  handlerMs: Spread;
  /** Over the moves that wrote and whose frame came. */
  paintMs: Spread;
  remote: {
    /** Applied before the drop's listener ran (from the probe's start). */
    duringMoves: number;
    afterDrop: number;
    /** Each apply's transaction, its start to its update. */
    applyMs: Spread;
  };
  /** Moves whose timeStamp-to-frame overlapped a remote apply's start to the end of its following frame. */
  touched: number;
  /** Move to frame over the moves that wrote, whose frame came, and that no remote apply touched. */
  untouchedToFrameMs: Spread;
  /** The first move's timeStamp to the drop's (to the last move's when no drop came). */
  durationMs: number;
  longTasks: number;
  /** M6: the gesture hold. */
  hold: {
    /** The remote frames it had buffered as the drop came, which the drop's flush applies merged. */
    heldAtDrop: number;
    /** Each clearance by its 5 s cap, ms after the first move. */
    capsMs: number[];
    /** The buffered frames it released, at its cap or at the drop: a frame held and let go (a cap alone proves none). */
    released: number;
  };
}

const tenth = (ms: number) => Math.round(ms * 10) / 10;

export function spread(values: number[]): Spread {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => tenth(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
  return { p50: at(0.5), p95: at(0.95), max: tenth(sorted[sorted.length - 1]!) };
}

type Written = DragMove & { tTx: number };
type Framed = Written & { tFrame: number };

export function summarizeDrag({ moves, remotes, drop, longTasks, caps = [], released = 0 }: DragRecord): DragStats {
  const written = moves.filter((m): m is Written => m.tTx !== undefined);
  const framed = written.filter((m): m is Framed => m.tFrame !== undefined);
  const footprints = remotes.map((r) => ({ from: r.tStart, to: r.tFrameEnd ?? r.tFrame ?? r.tEnd }));
  const isTouched = (m: Framed) => footprints.some((f) => f.from <= m.tFrame && f.to >= m.tIn);
  const untouched = framed.filter((m) => !isTouched(m));
  const duringMoves = drop === undefined ? remotes.length : remotes.filter((r) => r.tEnd < drop.tDispatch).length;
  const first = moves[0];
  const last = moves[moves.length - 1];
  return {
    moves: moves.length,
    withTransaction: written.length,
    inputToTxMs: spread(written.map((m) => m.tTx - m.tIn)),
    inputToFrameMs: spread(framed.map((m) => m.tFrame - m.tIn)),
    queueMs: spread(written.map((m) => m.tDispatch - m.tIn)),
    handlerMs: spread(written.map((m) => m.tTx - m.tDispatch)),
    paintMs: spread(framed.map((m) => m.tFrame - m.tTx)),
    remote: { duringMoves, afterDrop: remotes.length - duringMoves, applyMs: spread(remotes.map((r) => r.tEnd - r.tStart)) },
    touched: framed.length - untouched.length,
    untouchedToFrameMs: spread(untouched.map((m) => m.tFrame - m.tIn)),
    durationMs: first && last ? tenth((drop?.tIn ?? last.tIn) - first.tIn) : 0,
    longTasks,
    hold: { heldAtDrop: drop?.held ?? 0, capsMs: caps.map((at) => tenth(at - (first?.tIn ?? at))), released },
  };
}
