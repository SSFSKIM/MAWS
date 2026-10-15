// A browser's reading of one DX4 subscription, as DX4 says a consumer draws it, for the suites to check the fake
// machine's stream against: the snapshot, then the live part numbered from 1 with no gap; rows by uuid, each once;
// each streaming block's partial text, applied above its message's watermark, kept until the row its `block-row` named
// arrives (at once in a main-scope subscription for a subagent's block, whose row that subscription never carries) or
// dropped at its step's end. It records what a consumer must never see: a gap in `n`, a row twice, a chunk at or below
// the watermark or out of order.
import type { SessionMessage, Streaming } from '../../src/protocol/session';

type Block = { text: string; settledBy: string | null };
const msgKey = (m: { turnId: string; agentId: string | null; step: number }) => `${m.turnId}/${m.agentId ?? ''}/${m.step}`;

export class Dx4Reader {
  /** The transcript as drawn: rows in arrival order (the snapshot's oldest first). */
  readonly rows: Array<Record<string, unknown>> = [];
  /** Partial text drawn now, per `message key#block index`. */
  readonly partial = new Map<string, Block>();
  /** Every block's text as this reader assembled it (snapshot text, then its chunks), kept after it settles. */
  readonly assembled = new Map<string, string>();
  readonly faults: string[] = [];
  ended: { reason: string; n: number } | null = null;
  kinds: string[] = [];
  private next = 0;
  private readonly marks = new Map<string, number>();
  private readonly settled = new Set<string>();

  constructor(readonly agentId: string | null) {}

  read(message: SessionMessage): void {
    if (this.ended) return void this.faults.push(`a ${message.kind} after the end`);
    const n = message.n as number;
    if (n !== this.next) this.faults.push(`n ${n} where ${this.next} was next (${message.kind})`);
    this.next = n + 1;
    this.kinds.push(message.kind);
    switch (message.kind) {
      case 'snapshot':
        for (const row of [...message.body.rows].reverse()) this.row(row);
        for (const m of message.body.streaming) this.stream(m);
        return;
      case 'row':
        return this.row(message.body.row);
      case 'chunk': {
        const { chunk, chunkIndex } = message.body;
        const key = msgKey(message.body);
        const mark = this.marks.get(key);
        if (mark !== undefined && chunkIndex <= mark) return void this.faults.push(`chunk ${chunkIndex} of ${key} at or below its watermark ${mark}`);
        if (mark !== undefined && chunkIndex !== mark + 1) this.faults.push(`chunk ${chunkIndex} of ${key} after ${mark}: a gap`);
        if (mark === undefined && chunkIndex !== 0) this.faults.push(`chunk ${chunkIndex} of ${key} with no start`);
        this.marks.set(key, chunkIndex);
        const index = chunk.index;
        if (typeof index !== 'number' || chunk.kind === 'stop') return;
        const id = `${key}#${index}`;
        const text = chunk.kind === 'input' ? String(chunk.json ?? '') : chunk.kind === 'tool' ? '' : String(chunk.text ?? '');
        this.assembled.set(id, (this.assembled.get(id) ?? '') + text);
        if (this.settled.has(id)) return; // chunks of a settled block are ignored
        const block = this.partial.get(id) ?? { text: '', settledBy: null };
        block.text += text;
        this.partial.set(id, block);
        return;
      }
      case 'block-row': {
        const id = `${msgKey(message.body)}#${message.body.index}`;
        this.settled.add(id);
        const block = this.partial.get(id);
        // A subagent's block in a main-scope subscription settles at once: its row is drawn by the agent's own.
        if (this.agentId === null && message.body.agentId !== null) return void this.partial.delete(id);
        if (this.rows.some((r) => r.uuid === message.body.uuid)) return void this.partial.delete(id);
        if (block) block.settledBy = message.body.uuid;
        return;
      }
      case 'step-end':
        // A block of the step without a block-row never gets one: dropped. A paired block waits for its row.
        for (const [id, block] of this.partial) if (id.startsWith(`${msgKey(message.body)}#`) && block.settledBy === null) this.partial.delete(id);
        return;
      case 'end':
        this.ended = { reason: message.body.reason, n };
        return;
      default:
        return;
    }
  }

  private stream(m: Streaming): void {
    const key = msgKey(m);
    this.marks.set(key, m.upTo);
    for (const b of m.blocks) {
      const id = `${key}#${b.index}`;
      this.partial.set(id, { text: b.text, settledBy: null });
      this.assembled.set(id, b.text);
    }
  }

  private row(row: Record<string, unknown>): void {
    if (this.rows.some((r) => r.uuid === row.uuid)) return void this.faults.push(`row ${String(row.uuid)} twice`);
    this.rows.push(row);
    for (const [id, block] of this.partial) if (block.settledBy === row.uuid) this.partial.delete(id);
  }

  get uuids(): string[] {
    return this.rows.map((r) => String(r.uuid));
  }
}
