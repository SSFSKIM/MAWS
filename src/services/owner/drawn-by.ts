// Who draws each session's to-human view, as the owner service publishes it in the lane's `drawnBy` (the UX wave, U2b:
// docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, Interfaces §A, decisions 3 and 4; M4's sequences).
// It follows each session's running launch through the engine host's statuses (the subscription, and one read of every
// live status at the service's start and at each reconnect), reads the to-human plugin's declaration at the path the
// engine reports for it when a status first shows the plugins observed at a new time, and computes the published value
// from those facts and the stored row (`advertisementOf`, `drawnBy` in @shared/owner/draws). It calls `changed` when the
// value a session would publish moves from the one it gave out last, so the owner service publishes its state again.
// - A status of a launch older than the session's newest known launch (seen in a status, or bound by a decided launch)
//   is ignored.
// - A declaration's read in flight when a later observation of the plugins arrives is dropped; until a read answers, the
//   earlier fact stands (for a launch's first report: nothing reported yet).
// - Until the live statuses have been read once, a session with no status reads as if the row's newest launch ran with
//   its plugins not yet reported: an advertisement that cannot be known is never read as "MAWS draws". A session at
//   rest that so reads `mod` is drawn by the mirror all the same: no surface is attached to it (§A, "What a window
//   draws").
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { TO_HUMAN_PLUGIN } from '@shared/owner/contract';
import { advertisementOf, drawnBy, type DrawnBy, type Reservation } from '@shared/owner/draws';
import type { ContractSource } from '@shared/owner/state';

export interface DrawRow {
  launchId: string | null;
  desired: ContractSource | null;
  advertised: Reservation | null;
}

export type DrawStatus = Pick<EngineSessionStatus, 'appSessionId' | 'launchId' | 'process' | 'plugins' | 'pluginsObservedAt'>;

export interface WhoDrawsDeps {
  row: (appSessionId: AppSessionId) => DrawRow | null; // null: no row, or the row cannot be read
  declares: (installPath: string) => Promise<boolean>; // ./declaration.ts
  changed: (appSessionId: AppSessionId) => void;
}

interface Loaded {
  observedAt: string;
  present: boolean;
  declares: boolean;
}

interface Session {
  launches: string[]; // every launch id seen, in the order first seen; the last is the newest
  status: { launchId: string; process: EngineSessionStatus['process'] } | null; // the newest launch's last status
  loaded: Loaded | null; // the newest launch's plugins, once reported and read
  reading: { observedAt: string; token: number } | null; // the declaration's read in flight
  published: DrawnBy; // the value given out last (a state read, or a change published)
}

// A provisional launch id for a row whose reservation is not bound: no host launch id is empty.
const UNBOUND = '';

export class WhoDraws {
  private readonly sessions = new Map<AppSessionId, Session>();
  private isPrimed = false;
  private token = 0;
  private readonly pending = new Set<Promise<unknown>>();
  private stopped = false;

  constructor(private readonly deps: WhoDrawsDeps) {}

  // The live statuses were read once: from here a session with no status is at rest.
  primed(): void {
    if (this.isPrimed) return;
    this.isPrimed = true;
    for (const appSessionId of this.sessions.keys()) this.publish(appSessionId);
  }

  // A status of a session's process, from the subscription or from the read of every live status.
  status(status: DrawStatus): void {
    if (this.stopped) return;
    const appSessionId = status.appSessionId as AppSessionId;
    const session = this.sessionOf(appSessionId);
    const known = session.launches.indexOf(status.launchId);
    if (known !== -1 && known < session.launches.length - 1) return; // an older launch's, after a newer one
    if (known === -1) {
      session.launches.push(status.launchId);
      session.loaded = null;
      session.reading = null;
    }
    session.status = { launchId: status.launchId, process: status.process };
    if (status.pluginsObservedAt !== null && status.pluginsObservedAt !== session.loaded?.observedAt && status.pluginsObservedAt !== session.reading?.observedAt) {
      this.observe(appSessionId, session, status.launchId, status.pluginsObservedAt, status.plugins);
    }
    this.publish(appSessionId);
  }

  // A decided launch was bound to its id: it is the session's newest, and a status of an earlier one is stale.
  bound(appSessionId: AppSessionId, launchId: string): void {
    if (this.stopped) return;
    const session = this.sessionOf(appSessionId);
    if (session.launches.includes(launchId)) return;
    session.launches.push(launchId);
    session.status = null;
    session.loaded = null;
    session.reading = null;
    this.publish(appSessionId);
  }

  // The value to publish now; the one given out last is what the next change is measured against.
  drawnBy(appSessionId: AppSessionId): DrawnBy {
    const now = this.compute(appSessionId);
    this.sessionOf(appSessionId).published = now;
    return now;
  }

  private compute(appSessionId: AppSessionId): DrawnBy {
    const row = this.deps.row(appSessionId);
    const session = this.sessions.get(appSessionId);
    if (session?.status) return drawnBy(advertisementOf(row, session.status.launchId), session.status, session.loaded);
    if (this.isPrimed || row === null) return 'maws';
    // not yet read: the row's newest launch, as if it ran with nothing reported
    const live = row.advertised !== null ? (row.advertised.launchId ?? UNBOUND) : row.launchId;
    return live === null ? 'maws' : drawnBy(advertisementOf(row, live), { launchId: live, process: 'ready' }, null);
  }

  busy(): boolean {
    return this.pending.size > 0;
  }

  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  stop(): void {
    this.stopped = true;
  }

  private sessionOf(appSessionId: AppSessionId): Session {
    let session = this.sessions.get(appSessionId);
    if (session === undefined) {
      session = { launches: [], status: null, loaded: null, reading: null, published: 'maws' };
      this.sessions.set(appSessionId, session);
    }
    return session;
  }

  // The plugins were reported at a new time: the to-human plugin's declaration is read at its reported path.
  private observe(appSessionId: AppSessionId, session: Session, launchId: string, observedAt: string, plugins: DrawStatus['plugins']): void {
    const plugin = plugins.find((entry) => entry.name === TO_HUMAN_PLUGIN);
    if (plugin === undefined) {
      session.reading = null;
      session.loaded = { observedAt, present: false, declares: false };
      return;
    }
    const token = ++this.token;
    session.reading = { observedAt, token };
    const read = this.deps.declares(plugin.path).then(
      (declares) => this.read(appSessionId, launchId, token, observedAt, declares),
      () => this.read(appSessionId, launchId, token, observedAt, false),
    );
    this.pending.add(read);
    void read.finally(() => this.pending.delete(read));
  }

  private read(appSessionId: AppSessionId, launchId: string, token: number, observedAt: string, declares: boolean): void {
    const session = this.sessions.get(appSessionId);
    if (this.stopped || session === undefined || session.reading?.token !== token || session.status?.launchId !== launchId) return; // dropped
    session.reading = null;
    session.loaded = { observedAt, present: true, declares };
    this.publish(appSessionId);
  }

  private publish(appSessionId: AppSessionId): void {
    const session = this.sessionOf(appSessionId);
    const now = this.compute(appSessionId);
    if (now === session.published) return;
    session.published = now;
    this.deps.changed(appSessionId);
  }
}
