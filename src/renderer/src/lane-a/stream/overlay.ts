// A local terminal session's reply as it is written (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md,
// "Streaming without the trap"): the streaming layer (M3's `StreamingLayer`) fed by the pane's own watch, drawn as the
// transcript's tail rows beside the disk source's rows, never fed to the transcript store (the session source drops
// disk-form events once it sees one with a `seq`). Only the main loop's blocks are drawn: a subagent's pane draws none.
//
// The watch's first message is its snapshot, loaded; a `reset` makes the next snapshot a resume (`StreamingLayer.resume`,
// with no landing row: locally the rows come from disk, never from the snapshot, so a named row always lands by itself);
// an `ended` watch draws nothing. A block leaves once the row its `block-row` named is in the store (`landed`, read on
// each batch and whenever the store moves, `settleLanded`), its unnamed blocks at its `step-end`, and a named block
// whose row has not landed NAMED_ROW_WAIT_MS after its step ended (DX5's consumer rule), so no streamed text outlives
// its reply. A step a reset's fresh snapshot no longer streams ended while the stream was down: its named blocks get the
// same wait from the resume, its row landing still settling them sooner.
//
// The M8 sitting: a block still unnamed at its step's end is what an interrupt cut before the engine wrote it, and no
// row will ever carry it. So its words leave the stream as kept rows (`keep`), settled, as lane B keeps a stopped
// reply's partial text: an aborted reply leaves no streaming text behind and loses none of what was shown. A cut
// carries the bridge's time of its step's end (main's reshaper keeps the bridge's `t`), which names its disk turn:
// the engine stamps that turn's rows on the same clock, so the turn running then is the latest that started at or
// before it, and it is known once the store holds a turn started after it (`placeCuts`). Until then the rows wait, last
// and in no turn: they are never frozen under whatever turn was latest when the step-end was heard, which a replay
// (a mount opened later, on a watch another holds) or a disk read still behind the stream would make the wrong one.
import type { BlockRow, SessionBodies, StepEnd, Streaming } from 'desk-hub/protocol';
import type { Row, TurnId } from '../../transcript/model/rows';
import type { TranscriptState } from '../../transcript/model/reduce';
import { streamingRows } from '../view/streaming-rows';
import type { PlaneEvent } from '../watches';
import { StreamingLayer, type StreamBlock } from './layer';

export const NAMED_ROW_WAIT_MS = 5_000;

const stepKey = (s: { turnId: string; agentId?: string | null; step: number }) => `${s.turnId}\u0000${s.agentId ?? ''}\u0000${s.step}`;
const blockKey = (b: Pick<StreamBlock, 'turnId' | 'agentId' | 'step' | 'index'>) => `${b.turnId}\u0000${b.agentId ?? ''}\u0000${b.step}\u0000${b.index}`;

/** A reply cut before its rows: its kept rows, in no turn, and the bridge's time of its step's end (null: none said). */
export interface Cut {
  rows: Row[];
  at: number | null;
}

/** Where a reply cut before its rows goes. */
export interface Keeping {
  keep: (cut: Cut) => void;
}

const NO_KEEPING: Keeping = { keep: () => {} };

/** The cuts' rows, each under the disk turn running at its time once the store shows which that is, else in none. */
export function placeCuts(state: TranscriptState | undefined, cuts: readonly Cut[]): Row[] {
  return cuts.flatMap((cut) => {
    const turn = turnAt(state, cut.at);
    return turn === null ? cut.rows : cut.rows.map((row) => ({ ...row, turnId: turn }));
  });
}

function turnAt(state: TranscriptState | undefined, at: number | null): TurnId | null {
  if (state === undefined || at === null) return null;
  let running: { id: TurnId; started: number } | null = null;
  let later = false;
  for (const id of state.order) {
    const started = Date.parse(state.turns.get(id)?.startedAt ?? '');
    if (Number.isNaN(started)) continue;
    if (started > at) later = true;
    else if (running === null || started >= running.started) running = { id, started };
  }
  return later && running !== null ? running.id : null;
}

export class LaneAOverlay {
  private layer = new StreamingLayer();
  private loaded = false;
  private resuming = false;
  private readonly since = new Map<string, string>(); // when each block was first drawn: its row's time
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly landed: (uuid: string) => boolean,
    private readonly changed: () => void,
    private readonly keeping: Keeping = NO_KEEPING,
  ) {}

  receive(event: PlaneEvent): void {
    if (event.kind === 'reset') {
      this.resuming = this.loaded;
      return;
    }
    if (event.kind === 'ended') {
      this.clear();
      this.changed();
      return;
    }
    let changed = false;
    for (const message of event.messages) {
      if (message.kind === 'snapshot') {
        const streaming = ((message.body as { streaming?: Streaming[] }).streaming ?? []) as Streaming[];
        if (this.resuming) {
          const streams = new Set(streaming.map((s) => stepKey(s)));
          const drawn = new Map(this.layer.allBlocks().filter((b) => b.settledBy !== null).map((b) => [stepKey(b), { turnId: b.turnId, agentId: b.agentId, step: b.step }]));
          this.layer.resume(streaming, null, () => true);
          for (const [key, ended] of drawn) if (!streams.has(key)) this.expireNamed(ended);
        } else this.layer.load(streaming);
        this.loaded = true;
        this.resuming = false;
        changed = true;
      } else if (!this.loaded) {
        continue; // before the first snapshot nothing is drawn from
      } else if (message.kind === 'chunk') {
        changed = this.layer.chunk(message.body as SessionBodies['chunk']) || changed;
      } else if (message.kind === 'block-row') {
        this.layer.blockRow(message.body as BlockRow);
        changed = true;
      } else if (message.kind === 'step-end') {
        const body = message.body as StepEnd;
        this.keepCut(body);
        changed = this.layer.stepEnd(body) || changed;
        this.expireNamed(body);
      }
    }
    changed = this.settleLanded() || changed;
    if (changed) this.changed();
  }

  // Drops the blocks whose named row is in the store now; true when any was.
  settleLanded(): boolean {
    let changed = false;
    for (const uuid of this.layer.awaited()) if (this.landed(uuid)) changed = this.layer.settle(uuid) || changed;
    return changed;
  }

  // The main loop's blocks as tail rows, under `turn` (the turn the model is answering, for the report's bridge).
  rows(turn: TurnId | null): Row[] {
    const blocks = this.layer.blocks(null);
    const now = new Date().toISOString();
    const drawn = new Set(blocks.map(blockKey));
    for (const key of this.since.keys()) if (!drawn.has(key)) this.since.delete(key);
    for (const key of drawn) if (!this.since.has(key)) this.since.set(key, now);
    return streamingRows(blocks, (block) => this.since.get(blockKey(block)) ?? now, { turn });
  }

  // The main loop's blocks of the step `end` closes that no row named: kept, settled, with the time the step ended.
  private keepCut(end: StepEnd): void {
    if ((end.agentId ?? null) !== null) return;
    const cut = this.layer.blocks(null).filter((b) => b.turnId === end.turnId && b.step === end.step && b.settledBy === null);
    if (cut.length === 0) return;
    const now = new Date().toISOString();
    const rows = streamingRows(cut, (block) => this.since.get(blockKey(block)) ?? now, { kept: true });
    const at = (end as StepEnd & { t?: unknown }).t;
    if (rows.length > 0) this.keeping.keep({ rows, at: typeof at === 'number' && Number.isFinite(at) ? at : null });
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private expireNamed(end: StepEnd): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      let changed = false;
      for (const block of this.layer.blocks(end.agentId ?? null)) {
        if (block.turnId !== end.turnId || block.step !== end.step || block.settledBy === null) continue;
        changed = this.layer.settle(block.settledBy) || changed;
      }
      if (changed) this.changed();
    }, NAMED_ROW_WAIT_MS);
    this.timers.add(timer);
  }

  private clear(): void {
    this.dispose();
    this.layer = new StreamingLayer();
    this.since.clear();
    this.loaded = false;
    this.resuming = false;
  }
}
