// What the endpoint knows of the engine host's hidden pins (ticket 851, docs/doperpowers/plans/2026-11-24-prestart-engine.md,
// R4-6): the engine sessions of prestarts not yet committed, each as the host last told it (`engine.prestart`, and the
// whole set `engine.prestarts` answers at each link), the latest sminos `member` frame of each, held unprocessed, and the
// engine sessions whose prestart ended, so that a frame arriving after the end leaves no trace. Members (members.ts)
// decides what each means; this is its state alone.
//
// A read of the whole set is older than an event heard while it is out: an engine session told of meanwhile keeps what
// the event said. A pin the read no longer names, and no event settled, is left to Members to settle by the host's live
// rows; its stamp (the count of what was told of it) lets that deferred decision see a word that came first.

/** The ended pins kept, newest last: a prestart's frames arrive within moments of its end, and at most one runs at once. */
export const ENDED_KEPT = 64;

export class HiddenPins {
  /** Each hidden engine session, with the stamp of the last word told of it. */
  readonly #hidden = new Map<string, number>();
  /** The latest member frame of a hidden engine session, unprocessed. */
  readonly #held = new Map<string, Record<string, unknown>>();
  /** The engine sessions whose prestart ended, oldest first. */
  readonly #ended = new Set<string>();
  /** The engine sessions told of since the latest whole-set read began; null with none out. */
  #since: Set<string> | null = null;
  #reads = 0;
  #stamp = 0;

  isHidden(session: string): boolean {
    return this.#hidden.has(session);
  }

  isEnded(session: string): boolean {
    return this.#ended.has(session);
  }

  /** The stamp of the last word told of a hidden engine session; undefined when it is not hidden. */
  stamp(session: string): number | undefined {
    return this.#hidden.get(session);
  }

  /** Whether anything is hidden or held (a read that fails is worth a line only then). */
  get empty(): boolean {
    return this.#hidden.size === 0 && this.#held.size === 0;
  }

  /** The engine host holds `session` hidden. */
  hide(session: string): void {
    this.#since?.add(session);
    this.#ended.delete(session);
    this.#hidden.set(session, ++this.#stamp);
  }

  /** `session` was committed: no longer hidden; its held frame, taken out, or null. */
  reveal(session: string): Record<string, unknown> | null {
    this.#since?.add(session);
    this.#hidden.delete(session);
    const frame = this.#held.get(session) ?? null;
    this.#held.delete(session);
    return frame;
  }

  /** `session`'s prestart ended: forgotten, its held frame dropped, a frame of it from now on dropped. */
  end(session: string): void {
    this.#since?.add(session);
    this.#hidden.delete(session);
    this.#held.delete(session);
    this.#ended.delete(session);
    this.#ended.add(session);
    for (const old of this.#ended) {
      if (this.#ended.size <= ENDED_KEPT) break;
      this.#ended.delete(old);
    }
  }

  /** `frame` held for the hidden `session`, in place of any held before. */
  hold(session: string, frame: Record<string, unknown>): void {
    this.#held.set(session, frame);
  }

  /** Whether a frame was held for `session`; it is dropped. */
  drop(session: string): boolean {
    return this.#held.delete(session);
  }

  /** The engine sessions a frame is held for. */
  held(): string[] {
    return [...this.#held.keys()];
  }

  /** A read of the whole set begins; its number, which `settle` names. */
  beginRead(): number {
    this.#since = new Set();
    return ++this.#reads;
  }

  /**
   * The read `read` answered `hidden` (null: it failed). Null when a newer read began or it failed; else the engine sessions
   * it names that nothing told of (`added`, hidden from now) and the hidden ones it leaves out that no event settled since
   * it began (`unsettled`, each with its stamp).
   */
  settle(read: number, hidden: readonly string[] | null): { added: string[]; unsettled: Array<[string, number]> } | null {
    if (read !== this.#reads) return null;
    const since = this.#since ?? new Set<string>();
    this.#since = null;
    if (hidden === null) return null;
    const named = new Set(hidden);
    const added = [...named].filter((session) => !this.#hidden.has(session) && !this.#ended.has(session) && !since.has(session));
    const unsettled = [...this.#hidden].filter(([session]) => !named.has(session) && !since.has(session));
    return { added, unsettled };
  }
}
