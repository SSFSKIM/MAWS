// A fake engine host behind `mawsd`'s host supervisor, as the services front reaches it (P5 O3-D M4): its journal rows as
// the real one keeps them (one row yields several events under one `seq`, each event's id
// `<appSessionId>:<launchId>:<seq>:<i>`; `session.events` answers whole rows after `afterSeq`, from the ring, or the
// journal for a range the ring dropped, or, the journal lost, the ring alone marked `historyUnavailable`), its statuses
// with `lastEventSeq`, and the link: live events reach `onRaw` only while it is up, and each reconnect is a streaming.
// test/endpoint/sub-harness.ts's fake is the endpoint's twin of this one.
import type { SessionEvent } from '@shared/graph/events';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { HostResponse } from '@shared/ipc/host-protocol';

export type HostSession = {
  appSessionId: string;
  launchId: string;
  rows: SessionEvent[][];
  /** The ring's oldest kept event is after this one (null: it holds every row). */
  evicted: { seq: number; idx: number } | null;
  /** The journal can be read back. */
  journal: boolean;
  process: 'ready' | 'exited';
  queue: Record<string, unknown>;
  items: unknown[];
  catalog: Record<string, unknown>;
};

type Raw = (message: { name: string; payload: unknown }) => void;

export class FakeEngineHost {
  readonly sessions = new Map<string, HostSession>();
  readonly calls: Array<{ name: string; input: unknown }> = [];
  parkedNow = false;
  #linked = true;
  #launches = 0;
  readonly #raw = new Set<Raw>();
  readonly #streaming = new Set<() => void>();

  /** The supervisor's slice the front takes. */
  readonly hosts: Pick<HostSupervisor, 'forward' | 'onRaw' | 'onStreaming' | 'parked'> = {
    forward: async (_owner, request) => this.answer(request.name, request.input),
    onRaw: (_owner, listener) => (this.#raw.add(listener), () => void this.#raw.delete(listener)),
    onStreaming: (_owner, listener) => (this.#streaming.add(listener), () => void this.#streaming.delete(listener)),
    parked: () => this.parkedNow,
  };

  add(appSessionId: string): HostSession {
    const session: HostSession = {
      appSessionId,
      launchId: `launch-${++this.#launches}`,
      rows: [],
      evicted: null,
      journal: true,
      process: 'ready',
      queue: { entries: [], paused: false, pauseReason: null },
      items: [],
      catalog: { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 1 },
    };
    this.sessions.set(appSessionId, session);
    this.emit('session.status', { appSessionId, status: this.status(session) });
    return session;
  }

  session(appSessionId: string): HostSession {
    const s = this.sessions.get(appSessionId);
    if (s === undefined) throw new Error(`no host session ${appSessionId}`);
    return s;
  }

  /** A new launch of the session: a new launchId, its journal from row 1, its first status published. */
  relaunch(appSessionId: string): HostSession {
    const s = this.session(appSessionId);
    s.launchId = `launch-${++this.#launches}`;
    s.rows = [];
    s.evicted = null;
    s.journal = true;
    this.emit('session.status', { appSessionId, status: this.status(s) });
    return s;
  }

  /** Writes one journal row of `count` events and returns them; emitted live now unless `live: false`, cut into batches at `cut`. */
  row(appSessionId: string, count = 1, options: { live?: boolean; cut?: number[] } = {}): SessionEvent[] {
    const s = this.session(appSessionId);
    const seq = s.rows.length + 1;
    const events = Array.from({ length: count }, (_, i) => this.event(s, seq, i));
    s.rows.push(events);
    if (options.live !== false) {
      let from = 0;
      for (const at of [...(options.cut ?? []), events.length]) {
        if (at > from) this.emit('session.eventBatch', { appSessionId, events: events.slice(from, at) });
        from = at;
      }
    }
    return events;
  }

  /** An event to the front, as the supervisor's onRaw hands it: only while the link is up. */
  emit(name: string, payload: unknown): void {
    if (!this.#linked) return;
    for (const listener of [...this.#raw]) listener({ name, payload });
  }

  /** The link drops (both processes alive): what the host writes meanwhile reaches no one. */
  drop(): void {
    this.#linked = false;
  }

  /** The link is back and streams. */
  reconnect(): void {
    this.#linked = true;
    for (const listener of [...this.#streaming]) listener();
  }

  answer(name: string, input: unknown): HostResponse {
    this.calls.push({ name, input });
    const ok = (value: unknown): HostResponse => ({ t: 'res', id: 'x', ok: true, value });
    const no: HostResponse = { t: 'res', id: 'x', ok: false, error: { code: 'internal', message: `unknown session (${name})` } };
    if (name === 'engine.sessions') return ok([...this.sessions.values()].map((s) => this.status(s)));
    const { appSessionId, afterSeq, limit } = (input ?? {}) as { appSessionId?: string; afterSeq?: number | null; limit?: number | null };
    const s = appSessionId === undefined ? undefined : this.sessions.get(appSessionId);
    if (s === undefined) return no;
    switch (name) {
      case 'session.status':
        return ok(this.status(s));
      case 'session.events':
        return ok(this.events(s, afterSeq ?? null, limit ?? null));
      case 'session.queue.list':
        return ok(s.queue);
      case 'session.pendingItems':
        return ok({ items: s.items });
      case 'session.catalog':
        return ok(s.catalog);
      default:
        return { t: 'res', id: 'x', ok: false, error: { code: 'unknown_command', message: name } };
    }
  }

  status(s: HostSession): Record<string, unknown> {
    return { appSessionId: s.appSessionId, launchId: s.launchId, engineSessionId: `eng-${s.appSessionId}`, process: s.process, lastEventSeq: s.rows.length };
  }

  events(s: HostSession, afterSeq: number | null, limit: number | null): { events: SessionEvent[]; lastSeq: number; complete: boolean; historyUnavailable?: true } {
    const all = s.rows.flat();
    const ev = s.evicted;
    const inRing = (e: SessionEvent) => ev === null || e.seq! > ev.seq || (e.seq === ev.seq && Number(e.id.split(':').at(-1)) > ev.idx);
    let source = all.filter(inRing);
    let complete = true;
    let lost = false;
    if (ev !== null && (afterSeq === null || afterSeq < ev.seq)) {
      if (s.journal) source = all;
      else {
        complete = false;
        lost = true;
      }
    }
    let events = source.filter((e) => afterSeq === null || e.seq! > afterSeq);
    if (limit !== null && events.length > limit) {
      let end = limit;
      while (end < events.length && events[end].seq === events[end - 1].seq) end += 1;
      if (end < events.length) {
        events = events.slice(0, end);
        complete = false;
      }
    }
    return { events, lastSeq: events.at(-1)?.seq ?? afterSeq ?? 0, complete, ...(lost ? { historyUnavailable: true as const } : {}) };
  }

  event(s: HostSession, seq: number, i: number): SessionEvent {
    return { id: `${s.appSessionId}:${s.launchId}:${seq}:${i}`, sessionId: `eng-${s.appSessionId}`, at: new Date().toISOString(), seq, agentId: null, parentToolUseId: null, kind: 'note', text: `row ${seq} event ${i}` } as unknown as SessionEvent;
  }
}
