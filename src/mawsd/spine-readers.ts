// The apps whose hello listed `machine.spine` (P5 O3-D M5a, D21; daemon.ts): a pid in it, at the same start, is no
// SingletonLock signal. Each entry is the pid's start time as announced. P5 O3-D M6 (fix round 1): pruned at every
// client change of mawsd's sockets, an entry whose app has gone (its pid dead, or alive at another start: reused) going,
// so the set holds the live apps and none of a long-running daemon's past ones.
export class SpineReaders {
  private readonly starts = new Map<number, string | null>();

  constructor(private readonly procStartOf: (pid: number) => string | null) {}

  announce(pid: number): void {
    this.starts.set(pid, this.procStartOf(pid));
  }

  reads(pid: number): boolean {
    return this.starts.has(pid) && this.starts.get(pid) === this.procStartOf(pid);
  }

  // Drops every app gone since it announced: a start `ps` no longer gives (null: the pid is dead) or gives otherwise
  prune(): void {
    for (const [pid, start] of this.starts) {
      const now = this.procStartOf(pid);
      if (now === null || now !== start) this.starts.delete(pid);
    }
  }

  get size(): number {
    return this.starts.size;
  }
}
