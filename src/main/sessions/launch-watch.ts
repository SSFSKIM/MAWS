// One launch's statuses and exit, as the setup runner waits on them (C10 execution document, Interfaces "Session
// service": the setup is driven by a promise that resolves on the status or exit event), with the watchdog.
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { hostCall } from './context';
import type { Setup } from './setup-steps';

export type LaunchEnd = { kind: 'ready'; status: EngineSessionStatus } | { kind: 'exited'; errors: string[] } | { kind: 'timeout' };

// One launch's statuses and exit, from the moment before `session.launch` (so nothing it reports is missed). The
// watchdog restarts at every status: a launch that reports nothing for `watchdogMs` has timed out.
export class LaunchWatch {
  private last: EngineSessionStatus | null = null;
  private exited = false;
  private halted = false;
  private readonly errors: string[] = [];
  private readonly offs: (() => void)[];
  private wake: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly s: Setup,
    readonly appSessionId: AppSessionId,
  ) {
    s.watches.add(this);
    this.offs = [
      s.onEvent('session.status', ({ appSessionId: id, status }) => {
        if (id !== appSessionId) return;
        this.last = status;
        if (status.process === 'exited' || status.exit !== null) this.exited = true;
        this.poke();
      }),
      s.onEvent('session.eventBatch', ({ appSessionId: id, events }) => {
        if (id !== appSessionId) return;
        for (const event of events) {
          if (event.kind === 'error.raised' && event.scope === 'process') this.errors.push(event.message);
          if (event.kind === 'process.exited') this.exited = true;
        }
        this.poke();
      }),
    ];
  }

  async untilReady(): Promise<LaunchEnd> {
    for (;;) {
      if (this.exited) return { kind: 'exited', errors: await this.exitErrors() };
      if (this.last?.process === 'ready') return { kind: 'ready', status: this.last };
      if (await this.nextChange(this.s.watchdogMs)) return { kind: 'timeout' };
    }
  }

  // Whether the process exits within `ms`.
  async untilExit(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (this.exited) return true;
      const left = deadline - Date.now();
      if (left <= 0 || (await this.nextChange(left))) return this.exited;
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.s.watches.delete(this);
  }

  // The service was disposed (tests restart the app over the same disk): nothing here resolves again.
  halt(): void {
    this.halted = true;
    if (this.timer) clearTimeout(this.timer);
    this.dispose();
  }

  private poke(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  // Resolves true on timeout, false on a change; never while halted.
  private nextChange(ms: number): Promise<boolean> {
    if (this.halted) return new Promise(() => {});
    return new Promise((resolve) => {
      this.timer = setTimeout(() => {
        this.wake = null;
        if (!this.halted) resolve(true);
      }, ms);
      this.wake = () => {
        if (this.timer) clearTimeout(this.timer);
        if (!this.halted) resolve(false);
      };
    });
  }

  // The process-scope errors the exit came with: C3 batches events, so a snapshot of the session's ring fills in what
  // the batch has not delivered yet.
  private async exitErrors(): Promise<string[]> {
    if (this.errors.length > 0) return this.errors;
    try {
      const snapshot = await hostCall(this.s.dispatch, 'session.events', { appSessionId: this.appSessionId, afterSeq: null, limit: null });
      for (const event of snapshot.events) if (event.kind === 'error.raised' && event.scope === 'process') this.errors.push(event.message);
    } catch {
      // nothing more to learn
    }
    return this.errors;
  }
}
