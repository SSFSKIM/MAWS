// The policy cache's rebuild (P5 O18 D7, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md): each project sminos
// opens that the cache hasn't read back is asked of sminos with `snapshots? {id, project, after?}`, one project at a
// time and a page at a time, until sminos's answer `snapshots {id, project, events, next, done}` marks the project's last
// page `done`; each page's events are verified and taken (log-relay.ts's `snapshots`), and the project is kept done in
// the cache. The rebuild is incomplete while an open project isn't done. A link that drops mid-project starts that
// project again from its first page at the next connection, from the first project not done; a page unanswered within
// `ANSWER_MS` is asked again. Only an sminos whose hello advertises `audience` holds the responder; with any other, the
// rebuild never starts and nothing waits on it (the hub's registry is the backstop).
import { randomUUID } from 'node:crypto';
import type { PolicyCache } from './policy-cache';

/** How long a page waits for sminos's answer before it is asked again. */
export const PAGE_MS = 10_000;

export type RebuildContext = {
  cache: PolicyCache;
  /** A frame down RL10. */
  send(frame: { t: string } & Record<string, unknown>): void;
  /** A page's events verified and taken into the cache. */
  take(project: string, events: unknown): Promise<void>;
  /** The projects sminos opened on this connection. */
  projects(): readonly string[];
  /** Whether sminos advertised `audience` (it answers `snapshots?`). */
  enabled(): boolean;
  /** A project was read back whole: what waited on the cache may be decided now. */
  progressed(): void;
  log(line: string): void;
  pageMs?: number;
};

export class Rebuild {
  readonly #ctx: RebuildContext;
  #asking: { id: string; project: string; after: string | undefined; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(ctx: RebuildContext) {
    this.#ctx = ctx;
  }

  /** Whether an open project's snapshots are still to be read back. */
  get incomplete(): boolean {
    return this.#ctx.enabled() && this.#ctx.projects().some((project) => !this.#ctx.cache.done(project));
  }

  /** Asks for the first project not done, unless a page is being asked already. */
  kick(): void {
    if (this.#asking !== null || !this.#ctx.enabled()) return;
    const project = this.#ctx.projects().find((p) => !this.#ctx.cache.done(p));
    if (project !== undefined) this.#ask(project, undefined);
  }

  /** sminos's `snapshots`: the page taken, then the next one asked, or the project marked done and the next begun. */
  async answer(frame: Record<string, unknown>): Promise<void> {
    const asking = this.#asking;
    if (asking === null || frame.id !== asking.id || frame.project !== asking.project) return;
    clearTimeout(asking.timer);
    this.#asking = null;
    await this.#ctx.take(asking.project, frame.events);
    if (frame.done === true) {
      this.#ctx.cache.markDone(asking.project);
      this.#ctx.log(`endpoint: the policy cache read project ${asking.project} back from sminos's log`);
      this.#ctx.progressed();
      return this.kick();
    }
    if (typeof frame.next === 'string' && frame.next !== '' && frame.next.length <= 1024) return this.#ask(asking.project, frame.next);
    this.#ctx.log(`endpoint: sminos answered a snapshots? page of project ${asking.project} with no next page and no done; asked again`);
    this.#ask(asking.project, asking.after, this.#ctx.pageMs ?? PAGE_MS);
  }

  /** The connection ended: the project being read starts over at the next. */
  ended(): void {
    if (this.#asking !== null) clearTimeout(this.#asking.timer);
    this.#asking = null;
  }

  /** A page asked now, or, with `delay`, after it; unanswered within the page wait, it is asked again. */
  #ask(project: string, after: string | undefined, delay = 0): void {
    const id = randomUUID();
    const timer = setTimeout(
      () => {
        if (this.#asking?.id !== id) return;
        this.#asking = null;
        this.#ask(project, after);
      },
      delay > 0 ? delay : (this.#ctx.pageMs ?? PAGE_MS),
    );
    timer.unref?.();
    this.#asking = { id, project, after, timer };
    if (delay === 0) this.#ctx.send({ t: 'snapshots?', id, project, ...(after === undefined ? {} : { after }) });
  }
}
