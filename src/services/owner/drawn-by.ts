// Who draws each session's to-human view, as the owner service publishes it in the lane's `drawnBy` (the UX wave, U2b:
// docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, Interfaces §A, "Who draws: the table the code and its
// tests are checked against"). It follows each session's running launch through the engine host's statuses (the
// subscription, and a read of every live status at the service's start and at each reconnect) by table C, reads the
// to-human plugin's declaration at the path the engine reports for it at each new observation of the plugins, and
// computes the published value by tables A and B (`advertisementOf`, `drawnBy` in @shared/owner/draws). It calls
// `changed` when the value a session would publish moves from the one it gave out last.
// - The running launch (C): a status of it is applied; another launch's exit never puts it at rest; a launch not seen
//   before becomes the running one with a live process, unless the host's own start times (`launchedAt`, of its status
//   and of the running launch's, whose bind carries the one the host's launch answer gave) show it older; where the
//   running launch's start time is not known the order cannot be told, and the unseen live launch becomes the running
//   one (A4 reads it not known). The daemon's clock orders nothing. A read of the live statuses is not applied to a
//   session with a newer event since the read was sent.
// - The engine's state of it (B): at rest when its status says exiting or exited, or a read of the live statuses did not
//   list it; otherwise live, its plugins reported or not. A launch bound before its first status, and every session
//   before the first read, count as live with their plugins not reported. Before that read the running launch is the
//   row's recorded one; while a reservation waits unbound, the launch it was made for may run instead, unrecorded (A4),
//   so the session reads `mod`. A session at rest so read is drawn by the mirror all the same: no surface is attached
//   to it (§A, "What a window draws").
// - The declaration (B): read at each new observation of the plugins, replacing the read outstanding. Outstanding or
//   failed, it counts as declaring (B5); a missing file or another shape is "no".
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

export type DrawStatus = Pick<EngineSessionStatus, 'appSessionId' | 'launchId' | 'launchedAt' | 'process' | 'plugins' | 'pluginsObservedAt'>;

export interface WhoDrawsDeps {
  row: (appSessionId: AppSessionId) => DrawRow | null; // null: no row, or the row cannot be read
  declares: (installPath: string) => Promise<boolean | null>; // ./declaration.ts's declarationOf; null: the read failed
  changed: (appSessionId: AppSessionId) => void;
}

interface Running {
  launchId: string;
  launchedAt: string | null; // the host's start time; null for a launch bound with none known, until its first status
  process: EngineSessionStatus['process'];
}

interface Loaded {
  observedAt: string;
  present: boolean;
  declaration: 'yes' | 'no' | 'outstanding' | 'failed';
  token: number;
}

interface Session {
  running: Running | null;
  seen: Set<string>; // every launch id that was the running one
  loaded: Loaded | null; // the running launch's plugins at their latest observation
  touched: number; // the clock at the session's latest event applied (a status, a bind)
  published: DrawnBy; // the value given out last (a state read, or a change published)
}

const atRest = (process: EngineSessionStatus['process']) => process === 'exiting' || process === 'exited';
// Whether the host's start times of both show a launch started before the running one; either unknown, it cannot be told.
const olderThan = (launchedAt: string | null, running: Running) => launchedAt !== null && running.launchedAt !== null && launchedAt < running.launchedAt;

export class WhoDraws {
  private readonly sessions = new Map<AppSessionId, Session>();
  private isPrimed = false;
  private clock = 0;
  private token = 0;
  private readonly pending = new Set<Promise<unknown>>();
  private stopped = false;

  constructor(private readonly deps: WhoDrawsDeps) {}

  // Taken before a read of the live statuses is sent; the read's answer is applied against it (`listed`).
  mark(): number {
    return this.clock;
  }

  // The answer of a read of every live status sent at `since` (C4): applied to each session with no event since, and a
  // session it does not list is at rest. Returns the statuses applied.
  listed(statuses: readonly DrawStatus[], since: number): DrawStatus[] {
    if (this.stopped) return [];
    const listed = new Set<AppSessionId>();
    const applied: DrawStatus[] = [];
    for (const status of statuses) {
      const appSessionId = status.appSessionId as AppSessionId;
      listed.add(appSessionId);
      if ((this.sessions.get(appSessionId)?.touched ?? 0) > since) continue;
      if (this.apply(status)) applied.push(status);
    }
    for (const [appSessionId, session] of this.sessions) {
      if (listed.has(appSessionId) || session.touched > since || session.running === null || atRest(session.running.process)) continue;
      session.running.process = 'exited'; // the host has no live process for it
    }
    this.isPrimed = true;
    for (const appSessionId of this.sessions.keys()) this.publish(appSessionId);
    return applied;
  }

  // A status from the subscription.
  status(status: DrawStatus): void {
    if (this.stopped) return;
    if (this.apply(status)) this.sessionOf(status.appSessionId as AppSessionId).touched = ++this.clock;
  }

  // A decided launch the host accepted, with the start time the host's answer gave it (null: none known): the session's
  // running launch, live with its plugins not reported until its first status, unless it was already replaced (seen,
  // and not the running one) or the host's start times show the running launch started after it (an acknowledgement
  // that came late).
  bound(appSessionId: AppSessionId, launchId: string, launchedAt: string | null): void {
    if (this.stopped) return;
    const session = this.sessionOf(appSessionId);
    const running = session.running;
    if (running?.launchId === launchId) running.launchedAt ??= launchedAt;
    else if (session.seen.has(launchId)) return; // a launch the running one already replaced, whatever the times say
    else {
      session.seen.add(launchId);
      if (running !== null && olderThan(launchedAt, running)) return; // started before the running one by the host's times
      session.running = { launchId, launchedAt, process: 'starting' };
      session.loaded = null;
    }
    session.touched = ++this.clock; // an event applied (C4)
    this.publish(appSessionId);
  }

  // The value to publish now; the one given out last is what the next change is measured against.
  drawnBy(appSessionId: AppSessionId): DrawnBy {
    const now = this.compute(appSessionId);
    this.sessionOf(appSessionId).published = now;
    return now;
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

  private compute(appSessionId: AppSessionId): DrawnBy {
    const row = this.deps.row(appSessionId);
    const session = this.sessions.get(appSessionId);
    const running = session?.running ?? null;
    if (running !== null) {
      const loaded = session?.loaded ?? null;
      return drawnBy(advertisementOf(row, running.launchId), running, loaded === null ? null : { present: loaded.present, declares: loaded.declaration !== 'no' });
    }
    if (this.isPrimed) return 'maws'; // B1: the read of the live statuses listed none, and no status or bind since
    // not yet discovered: live with its plugins not reported, the recorded launch, or the unrecorded one a reservation
    // waiting unbound was made for (A4, B12)
    if (row !== null && row.advertised !== null && row.advertised.launchId === null) return 'mod';
    return drawnBy(advertisementOf(row, row?.launchId ?? ''), { launchId: row?.launchId ?? '', process: 'starting' }, null);
  }

  // Table C: whether the status counts for the session's running launch; when it does, it is applied.
  private apply(status: DrawStatus): boolean {
    const appSessionId = status.appSessionId as AppSessionId;
    const session = this.sessionOf(appSessionId);
    const running = session.running;
    if (running === null || running.launchId !== status.launchId) {
      if (running !== null) {
        if (atRest(status.process)) return false; // C2: another launch's exit
        if (session.seen.has(status.launchId) || olderThan(status.launchedAt, running)) return false; // C3: a launch replaced, or started before the running one by the host's times
      }
      session.seen.add(status.launchId);
      session.running = { launchId: status.launchId, launchedAt: status.launchedAt, process: status.process };
      session.loaded = null;
    } else {
      running.process = status.process; // C1
      running.launchedAt = status.launchedAt;
    }
    if (status.pluginsObservedAt !== null && status.pluginsObservedAt !== session.loaded?.observedAt) this.observe(appSessionId, session, status.launchId, status.pluginsObservedAt, status.plugins);
    this.publish(appSessionId);
    return true;
  }

  private sessionOf(appSessionId: AppSessionId): Session {
    let session = this.sessions.get(appSessionId);
    if (session === undefined) {
      session = { running: null, seen: new Set(), loaded: null, touched: 0, published: 'maws' };
      this.sessions.set(appSessionId, session);
    }
    return session;
  }

  // The plugins were reported at a new time: the to-human plugin's presence is known at once, and its declaration is read
  // at its reported path, replacing any read outstanding.
  private observe(appSessionId: AppSessionId, session: Session, launchId: string, observedAt: string, plugins: DrawStatus['plugins']): void {
    const plugin = plugins.find((entry) => entry.name === TO_HUMAN_PLUGIN);
    const token = ++this.token;
    if (plugin === undefined) {
      session.loaded = { observedAt, present: false, declaration: 'no', token };
      return;
    }
    session.loaded = { observedAt, present: true, declaration: 'outstanding', token };
    const read = this.deps.declares(plugin.path).then(
      (declares) => this.answered(appSessionId, launchId, token, declares === true ? 'yes' : declares === false ? 'no' : 'failed'),
      () => this.answered(appSessionId, launchId, token, 'failed'),
    );
    this.pending.add(read);
    void read.finally(() => this.pending.delete(read));
  }

  private answered(appSessionId: AppSessionId, launchId: string, token: number, declaration: Loaded['declaration']): void {
    const session = this.sessions.get(appSessionId);
    if (this.stopped || session === undefined || session.loaded?.token !== token || session.running?.launchId !== launchId) return; // replaced
    session.loaded.declaration = declaration;
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
