// What the endpoint knows of the engine host's hidden pins (ticket 851, docs/doperpowers/plans/2026-11-24-prestart-engine.md,
// R4-6): the engine sessions of prestarts not yet committed, each as the host last told it (`engine.prestart`, and the
// whole set `engine.prestarts` answers at each link), the latest sminos `member` frame of each, held unprocessed, and the
// engine sessions whose prestart ended, so that a frame arriving after the end leaves no trace. Members (members.ts)
// decides what each means; this is its state alone.
//
// A read of the whole set is older than an event heard while it is out: an engine session told of meanwhile keeps what
// the event said. A pin the read no longer names, and no event settled, is left to Members to settle by the host's live
// rows; its stamp (the count of what was told of it) lets that deferred decision see a word that came first.
//
// The prestart panel (scalpel-4#6): a first lane B member whose engine session is not yet known as public is held
// **early** while the endpoint asks the host about it, and, when the host cannot say, until a word, a whole-set read that
// answers, or Members' bound. Its frame is held as a hidden pin's is; a word of it ends the early hold.

/** The ended pins kept, newest last: a prestart's frames arrive within moments of its end, and at most one runs at once. */
export const ENDED_KEPT = 64;

export class HiddenPins {
  /** Each hidden engine session, with the stamp of the last word told of it. */
  readonly #hidden = new Map<string, number>();
  /** The latest member frame of a hidden engine session, unprocessed. */
  readonly #held = new Map<string, Record<string, unknown>>();
  /** The engine sessions whose prestart ended, oldest first. */
  readonly #ended = new Set<string>();
  /** The engine sessions whose first frame is held early (not yet known as public, nor as a hidden pin's), each with the count of whole-set reads begun before it was. */
  readonly #early = new Map<string, number>();
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

  /** Whether `session`'s first frame is held early (the prestart panel, scalpel-4#6). */
  isEarly(session: string): boolean {
    return this.#early.has(session);
  }

  /** The engine sessions whose first frame was held early before the whole-set read `read` began (`beginRead`'s number). */
  earlyBefore(read: number): string[] {
    return [...this.#early].flatMap(([session, reads]) => (reads < read ? [session] : []));
  }

  /** Whether anything is hidden or held (a read that fails is worth a line only then). */
  get empty(): boolean {
    return this.#hidden.size === 0 && this.#held.size === 0;
  }

  /** The engine host holds `session` hidden. */
  hide(session: string): void {
    this.#since?.add(session);
    this.#ended.delete(session);
    this.#early.delete(session);
    this.#hidden.set(session, ++this.#stamp);
  }

  /**
   * `session` was committed: no longer hidden. Its held frame stays held until the replay takes it in its turn (`take`),
   * so a departure heard before that turn still drops it (M4's review, finding 3).
   */
  reveal(session: string): void {
    this.#since?.add(session);
    this.#hidden.delete(session);
    this.#early.delete(session);
  }

  /** The frame held for `session`, taken out (an early hold ends with it); null with none. */
  take(session: string): Record<string, unknown> | null {
    const frame = this.#held.get(session) ?? null;
    this.#held.delete(session);
    this.#early.delete(session);
    return frame;
  }

  /** Whether a frame is held for `session`. */
  isHeld(session: string): boolean {
    return this.#held.has(session);
  }

  /** `session`'s prestart ended: forgotten, its held frame dropped, a frame of it from now on dropped. */
  end(session: string): void {
    this.#since?.add(session);
    this.#hidden.delete(session);
    this.#held.delete(session);
    this.#early.delete(session);
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

  /** `frame`, the first of `session`, held early (the prestart panel, scalpel-4#6). */
  holdEarly(session: string, frame: Record<string, unknown>): void {
    this.#held.set(session, frame);
    this.#early.set(session, this.#reads);
  }

  /** Whether a frame was held for `session`; it is dropped. */
  drop(session: string): boolean {
    this.#early.delete(session);
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
