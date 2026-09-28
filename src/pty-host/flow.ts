// Output flow control for one pty (C9 Residue *PTY stream and flow control*; the transition table of Interfaces
// "PTY host internals"). Credit by offset: the host counts the bytes it has emitted (`total`) and the offset the
// renderer has acknowledged as parsed (`acked`); it pauses the pty when the difference reaches the high watermark and
// resumes it once an acknowledgement brings it down to the low one. Pure, so the watermark logic is pinned without a
// pty; `table.ts` applies the effect to node-pty.

export const HIGH_WATERMARK = 256 * 1024;
export const LOW_WATERMARK = 64 * 1024;

export type FlowMode = 'flowing' | 'paused';
export interface Flow {
  total: number; // bytes emitted since spawn; the offset of the next chunk
  acked: number; // the highest offset the renderer acknowledged, never above `total`
  mode: FlowMode;
}

export type FlowInput =
  | { kind: 'data'; bytes: number } // a chunk was emitted
  | { kind: 'ack'; offset: number } // the renderer has parsed everything below `offset`
  | { kind: 'attach' }; // a renderer (re)attached: everything emitted counts as delivered through the replay

export interface FlowStep {
  flow: Flow;
  effect: 'pause' | 'resume' | null; // what to do to the pty
  clamped: boolean; // the ack named an offset above `total` (a renderer bug; logged by the caller)
}

export const INITIAL_FLOW: Flow = { total: 0, acked: 0, mode: 'flowing' };

export function stepFlow(flow: Flow, input: FlowInput): FlowStep {
  switch (input.kind) {
    case 'data': {
      const total = flow.total + input.bytes;
      if (flow.mode === 'flowing' && total - flow.acked >= HIGH_WATERMARK) {
        return { flow: { ...flow, total, mode: 'paused' }, effect: 'pause', clamped: false };
      }
      return { flow: { ...flow, total }, effect: null, clamped: false };
    }
    case 'ack': {
      const clamped = input.offset > flow.total;
      const acked = Math.max(flow.acked, Math.min(input.offset, flow.total));
      if (flow.mode === 'paused' && flow.total - acked <= LOW_WATERMARK) {
        return { flow: { ...flow, acked, mode: 'flowing' }, effect: 'resume', clamped };
      }
      return { flow: { ...flow, acked }, effect: null, clamped };
    }
    case 'attach':
      return { flow: { total: flow.total, acked: flow.total, mode: 'flowing' }, effect: flow.mode === 'paused' ? 'resume' : null, clamped: false };
  }
}
