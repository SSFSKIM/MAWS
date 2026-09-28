// The process table (charter §4.4; C3 execution document, Interfaces "Process table and status"), keyed by
// `appSessionId`. A row is a reservation: taken when a launch is accepted and released only when the OS reports the
// exit (the session reads `exited`), never at an error, so a retry after a failed handshake cannot start a second
// writer on one engine session while the first is still dying. M3 holds the reservation rule; M4 adds keep-alive,
// memory sampling and change notification.
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSession } from './session';

export type ReserveOutcome = { status: 'launching'; session: EngineSession } | { status: 'refused'; reason: 'already_live'; message: string };

export class ProcessTable {
  private readonly rows = new Map<AppSessionId, EngineSession>();

  // Creates and starts a session unless the id holds one that has not exited. `create` runs only when accepted.
  reserve(appSessionId: AppSessionId, create: () => EngineSession): ReserveOutcome {
    const existing = this.rows.get(appSessionId);
    if (existing) {
      const state = existing.status().process;
      if (state !== 'exited') return { status: 'refused', reason: 'already_live', message: `process is ${state}` };
    }
    const session = create();
    this.rows.set(appSessionId, session);
    void session.start();
    return { status: 'launching', session };
  }

  get(appSessionId: AppSessionId): EngineSession | undefined {
    return this.rows.get(appSessionId);
  }

  list(): EngineSession[] {
    return [...this.rows.values()];
  }
}
