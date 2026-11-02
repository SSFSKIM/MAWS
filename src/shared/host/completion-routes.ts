// Where a completion goes (P5 O16 M3b fix waves 2 and 3; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3): one
// host owner's record of which process raised each request a completion answers (host-supervisor.ts DRAIN_REPLIES), and
// of each process's links. A process is `open` while a link to it is open, `reconnecting` once its link closed while it
// may live on (a recycle, a quiet loss, a close whose verdict is not in yet), and gone once its supervisor knows it is
// (an exit, a handover's close, another process welcomed in its place). A completion goes on its raiser's open link, is
// held while its raiser reconnects, and is refused once its raiser is gone; one whose raiser this process never saw goes
// on the first open link the caller prefers, else is held for a reconnecting process, else refused.
//
// P5 O16 panel fix (scalpel-4#5): a process is its incarnation (`StartedAtKey`: its pid and the start it declared), never
// its pid alone, so a later process that reuses a gone one's pid is another process and never takes its completions.

// A process incarnation as a host declares it: its pid with its lock's `startedAt` (a welcome's and a status's), or for a
// utility host, its spawn's own mark. A string, to key the maps below. Not holder/stop-held.ts's `ProcStartKey` (a pid
// with `ps`'s start time, read off the machine the process runs on): a welcome or a status carries no procStart, and
// main cannot read one for a host it reaches through a relay or on another machine.
export type StartedAtKey = string;
export const startedAtKey = (pid: number, startedAt: string): StartedAtKey => `${pid}@${startedAt}`;
export const pidOfStartedAtKey = (incarnation: StartedAtKey): number => Number.parseInt(incarnation, 10);

export type CompletionRoute<L> = { link: L; process: StartedAtKey } | { hold: StartedAtKey } | null;

export class CompletionRoutes<L extends object> {
  private readonly issuers = new Map<string, StartedAtKey>(); // requestId -> the raising incarnation, newest last
  private readonly processes = new WeakMap<L, StartedAtKey>();
  private readonly open = new Map<StartedAtKey, L>();
  private readonly reconnecting = new Set<StartedAtKey>();

  constructor(private readonly kept = 1_024) {}

  // A link to `incarnation` was welcomed (or, a utility host's, spawned). Any other process still reconnecting is gone:
  // one process serves the owner's lock at a time. Answers the processes that became gone.
  opened(link: L, incarnation: StartedAtKey): StartedAtKey[] {
    this.processes.set(link, incarnation);
    this.open.set(incarnation, link);
    const gone = [...this.reconnecting].filter((other) => other !== incarnation);
    for (const other of gone) this.reconnecting.delete(other);
    this.reconnecting.delete(incarnation);
    return gone;
  }

  // A link closed: its process reconnects until it is known gone. Answers its process (null for a link never opened).
  closed(link: L): StartedAtKey | null {
    const incarnation = this.processes.get(link);
    if (incarnation === undefined) return null;
    if (this.open.get(incarnation) === link) {
      this.open.delete(incarnation);
      this.reconnecting.add(incarnation);
    }
    return incarnation;
  }

  gone(incarnation: StartedAtKey): void {
    this.open.delete(incarnation);
    this.reconnecting.delete(incarnation);
  }

  // Every process not open is gone (the owner unreachable, crashed); answers them.
  allReconnectingGone(): StartedAtKey[] {
    const gone = [...this.reconnecting];
    this.reconnecting.clear();
    return gone;
  }

  // A request announced on `link` (an event naming its `requestId`)
  raised(requestId: string, link: L): void {
    const incarnation = this.processes.get(link);
    if (incarnation === undefined) return;
    this.issuers.delete(requestId);
    this.issuers.set(requestId, incarnation);
    if (this.issuers.size > this.kept) this.issuers.delete(this.issuers.keys().next().value!);
  }

  route(requestId: string | null, preferred: readonly (L | null)[]): CompletionRoute<L> {
    const issuer = requestId === null ? undefined : this.issuers.get(requestId);
    if (issuer !== undefined) {
      const link = this.open.get(issuer);
      if (link) return { link, process: issuer };
      return this.reconnecting.has(issuer) ? { hold: issuer } : null;
    }
    for (const link of preferred) {
      const incarnation = link ? this.processes.get(link) : undefined;
      if (link && incarnation !== undefined && this.open.get(incarnation) === link) return { link, process: incarnation };
    }
    const waiting = [...this.reconnecting].at(-1);
    return waiting === undefined ? null : { hold: waiting };
  }
}
