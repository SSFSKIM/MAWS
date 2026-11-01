// Where a completion goes (P5 O16 M3b fix waves 2 and 3; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3): one
// host owner's record of which process raised each request a completion answers (host-supervisor.ts DRAIN_REPLIES), and
// of each process's links. A process is `open` while a link to it is open, `reconnecting` once its link closed while it
// may live on (a recycle, a quiet loss, a close whose verdict is not in yet), and gone once its supervisor knows it is
// (an exit, a handover's close, another process welcomed in its place). A completion goes on its raiser's open link, is
// held while its raiser reconnects, and is refused once its raiser is gone; one whose raiser this process never saw goes
// on the first open link the caller prefers, else is held for a reconnecting process, else refused.
export type CompletionRoute<L> = { link: L; pid: number } | { hold: number } | null;

export class CompletionRoutes<L extends object> {
  private readonly issuers = new Map<string, number>(); // requestId -> the raising pid, newest last
  private readonly pids = new WeakMap<L, number>();
  private readonly open = new Map<number, L>();
  private readonly reconnecting = new Set<number>();

  constructor(private readonly kept = 1_024) {}

  // A link to `pid` was welcomed (or, a utility host's, spawned). Any other process still reconnecting is gone: one
  // process serves the owner's lock at a time. Answers the pids that became gone.
  opened(link: L, pid: number): number[] {
    this.pids.set(link, pid);
    this.open.set(pid, link);
    const gone = [...this.reconnecting].filter((other) => other !== pid);
    for (const other of gone) this.reconnecting.delete(other);
    this.reconnecting.delete(pid);
    return gone;
  }

  // A link closed: its process reconnects until it is known gone. Answers its pid (null for a link never opened).
  closed(link: L): number | null {
    const pid = this.pids.get(link);
    if (pid === undefined) return null;
    if (this.open.get(pid) === link) {
      this.open.delete(pid);
      this.reconnecting.add(pid);
    }
    return pid;
  }

  gone(pid: number): void {
    this.open.delete(pid);
    this.reconnecting.delete(pid);
  }

  // Every process not open is gone (the owner unreachable, crashed); answers them.
  allReconnectingGone(): number[] {
    const gone = [...this.reconnecting];
    this.reconnecting.clear();
    return gone;
  }

  pidOf(link: L): number | undefined {
    return this.pids.get(link);
  }

  // A request announced on `link` (an event naming its `requestId`)
  raised(requestId: string, link: L): void {
    const pid = this.pids.get(link);
    if (pid === undefined) return;
    this.issuers.delete(requestId);
    this.issuers.set(requestId, pid);
    if (this.issuers.size > this.kept) this.issuers.delete(this.issuers.keys().next().value!);
  }

  route(requestId: string | null, preferred: readonly (L | null)[]): CompletionRoute<L> {
    const issuer = requestId === null ? undefined : this.issuers.get(requestId);
    if (issuer !== undefined) {
      const link = this.open.get(issuer);
      if (link) return { link, pid: issuer };
      return this.reconnecting.has(issuer) ? { hold: issuer } : null;
    }
    for (const link of preferred) {
      const pid = link ? this.pids.get(link) : undefined;
      if (link && pid !== undefined && this.open.get(pid) === link) return { link, pid };
    }
    const waiting = [...this.reconnecting].at(-1);
    return waiting === undefined ? null : { hold: waiting };
  }
}
