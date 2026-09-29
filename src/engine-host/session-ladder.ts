// The termination ladder that ends an engine process (C3 execution document, Interfaces "Process table", Exit policy;
// moved out of session.ts in debt wave 3, unchanged): `end_session` and its grace when the handshake is done, then
// SIGTERM, then SIGKILL, each rung ending as soon as the process has exited. One ladder per process, memoised. The
// session owns the process state and the exit bookkeeping; the ladder asks it through `LadderHost`.
import type { EngineTransport } from './transport';

// The termination ladder's waits (Exit policy): the end_session grace, then SIGTERM, then SIGKILL; 7 s worst case.
export const LADDER_MS = { endSession: 3_000, term: 3_000, kill: 1_000 } as const;

export type ExitReason = 'quit' | 'stop' | 'archive' | 'crash' | 'unknown';
export interface ExitSummary { code: number | null; signal: string | null; reason: ExitReason; lostAttentionCount: number }
export interface StopResult { exited: boolean; code: number | null; signal: string | null }

export interface LadderHost {
  readonly exited: Promise<unknown>; // settles at the process's exit
  hasExited(): boolean;
  markExiting(): void;
  // Writes end_session when the handshake is done (the exit is the answer that matters); false when there is no one to ask.
  endSession(): boolean;
  stopResult(): StopResult;
}

export class TerminationLadder {
  private ladder: Promise<StopResult> | null = null;
  private reachedKill = false;

  constructor(private readonly host: LadderHost) {}

  // True once the ladder had to send SIGKILL.
  get killed(): boolean {
    return this.reachedKill;
  }

  // One ladder per process, memoised; with no process yet there is nothing to memoise (whole-branch review).
  terminate(transport: EngineTransport | null, endSessionFirst: boolean, graceMs: number = LADDER_MS.endSession): Promise<StopResult> {
    if (!transport) return Promise.resolve(this.host.stopResult());
    this.ladder ??= this.run(transport, endSessionFirst, graceMs);
    return this.ladder;
  }

  private async run(transport: EngineTransport, endSessionFirst: boolean, graceMs: number): Promise<StopResult> {
    if (this.host.hasExited()) return this.host.stopResult();
    this.host.markExiting();
    if (endSessionFirst && this.host.endSession()) {
      if (await this.waitExit(graceMs)) return this.host.stopResult();
    }
    transport.endInput();
    transport.kill('SIGTERM');
    if (await this.waitExit(LADDER_MS.term)) return this.host.stopResult();
    this.reachedKill = true;
    transport.kill('SIGKILL');
    await this.waitExit(LADDER_MS.kill);
    return this.host.stopResult();
  }

  private waitExit(ms: number): Promise<boolean> {
    return Promise.race([
      this.host.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  }
}
