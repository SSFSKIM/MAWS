// The inbound index (O10 M6; Interfaces §E's `inbound/<project id>.idx`): every arriving v2 event's signed content, by
// SHA-256 of its signing input (which binds the org and the project), with the first position it arrived at. The v2
// signature covers a `hub/<member>` event's body and `created` but not the position the hub gives it, so a hostile hub
// could post a person's signed words again at the next sequence as a new instruction; a copy of held content at another
// position is `replayed` and never reaches sminos. It replaces sminos's DX1 nonce index, which leaves with the codes.
//
// The index keeps 30 days (a line older is dropped when its project's file is read), and a `human` event whose signed
// `created` is more than 24 hours old is never delivered as words (words.ts), so the window bounds both. Lines are
// `{content, writer, seq, at}`, appended and fsynced before the event goes down to sminos: a page's new contents are
// staged as it is judged (`stage`; `seen` meets them at once, so a copy later in the page is a replay) and written in
// one append (`commit`) before any of its events leaves, since an fsync an event held a first download to a few events
// a second on a slow disk.
import { appendLines, readLines, writeAtomic } from '../state/files';
import { isProjectFileName } from './signature-ledger';

export const INBOUND_KEPT_MS = 30 * 86_400_000;

type Entry = { content: string; writer: string; seq: number; at: number };

export type Seen = { kind: 'new' } | { kind: 'same' } | { kind: 'replayed'; writer: string; seq: number };

/**
 * Content `stage` holds for its project, from the index's generation then (`forget` begins another): on disk once a
 * `commit` took it, let go when its batch was abandoned or its write failed.
 */
export type Staged = { readonly project: string; readonly entry: Entry; readonly generation: number; state: 'staged' | 'committed' | 'dropped'; first: boolean };

export class InboundIndex {
  readonly #dir: () => string;
  readonly #now: () => number;
  readonly #projects = new Map<string, { byContent: Map<string, Entry>; byPosition: Map<string, string> }>();
  /** Advanced by `forget`: a batch staged before it is stale, never written into what is read after it. */
  #generation = 0;

  constructor(dir: () => string, now: () => number) {
    this.#dir = dir;
    this.#now = now;
  }

  /** Whether `content` is new to `project`, held already at this position, or held at another (`replayed`). */
  seen(project: string, content: string, writer: string, seq: number): Seen {
    const held = this.#load(project).byContent.get(content);
    if (held === undefined) return { kind: 'new' };
    return held.writer === writer && held.seq === seq ? { kind: 'same' } : { kind: 'replayed', writer: held.writer, seq: held.seq };
  }

  /** The content first seen at `(writer, seq)` in `project`, or null. */
  at(project: string, writer: string, seq: number): string | null {
    return this.#load(project).byPosition.get(`${writer}\n${seq}`) ?? null;
  }

  /** Drops what was read: `inbound/` was moved aside (an enrollment under another authority), and is read anew. */
  forget(): void {
    this.#projects.clear();
    this.#generation++;
  }

  /** Records content new to `project` at its position, on disk before it returns. */
  record(project: string, content: string, writer: string, seq: number): void {
    const staged = this.stage(project, content, writer, seq);
    if (staged !== null) this.commit([staged]);
  }

  /**
   * Content new to `project` at its position, held now (`seen` meets it) and on disk once a `commit` takes it; null
   * when the content is held already (on disk, or staged earlier in the batch). One batch of a project at a time
   * stages (the relay judges a project's pages in order), so the first content staged at a position is the first
   * written there, and a restart reads the position as it was judged.
   */
  stage(project: string, content: string, writer: string, seq: number): Staged | null {
    const held = this.#load(project);
    if (held.byContent.has(content)) return null;
    const staged: Staged = { project, entry: { content, writer, seq, at: this.#now() }, generation: this.#generation, state: 'staged', first: false };
    held.byContent.set(content, staged.entry);
    const key = `${writer}\n${seq}`;
    staged.first = !held.byPosition.has(key);
    if (staged.first) held.byPosition.set(key, content);
    return staged;
  }

  /**
   * Writes the batch's staged entries, one append (one fsync) a project, before it returns true. A batch staged in an
   * earlier generation (`forget` came since), or holding an entry let go, is stale: nothing is written, the batch is
   * abandoned, and false is answered, so its events are judged again rather than sent. A write that fails abandons the
   * batch, as a failed write per event left the index without it, and throws.
   */
  commit(staged: readonly Staged[]): boolean {
    const pending = staged.filter((s) => s.state !== 'committed');
    if (pending.some((s) => s.state === 'dropped' || s.generation !== this.#generation)) {
      this.abandon(staged);
      return false;
    }
    const byProject = new Map<string, Staged[]>();
    for (const s of pending) byProject.set(s.project, [...(byProject.get(s.project) ?? []), s]);
    for (const [project, entries] of byProject) {
      try {
        appendLines(this.#dir(), `${project}.idx`, entries.map((s) => JSON.stringify(s.entry)));
      } catch (error) {
        this.abandon(staged);
        throw error;
      }
      for (const s of entries) s.state = 'committed';
    }
    return true;
  }

  /** Lets go of what the batch staged and didn't write: its contents are new again (in this generation). */
  abandon(staged: readonly Staged[]): void {
    for (const s of staged) {
      if (s.state !== 'staged') continue;
      s.state = 'dropped';
      if (s.generation !== this.#generation) continue;
      const held = this.#load(s.project);
      if (held.byContent.get(s.entry.content) === s.entry) held.byContent.delete(s.entry.content);
      const key = `${s.entry.writer}\n${s.entry.seq}`;
      if (s.first && held.byPosition.get(key) === s.entry.content) held.byPosition.delete(key);
    }
  }

  #load(project: string) {
    if (!isProjectFileName(project)) throw new Error(`no index for a project id that is no file name (${project.slice(0, 64)})`);
    let held = this.#projects.get(project);
    if (held !== undefined) return held;
    held = { byContent: new Map(), byPosition: new Map() };
    const since = this.#now() - INBOUND_KEPT_MS;
    let dropped = 0;
    for (const raw of readLines(this.#dir(), `${project}.idx`)) {
      const e = raw as Partial<Entry> | null;
      if (typeof e?.content !== 'string' || typeof e.writer !== 'string' || !Number.isSafeInteger(e.seq) || typeof e.at !== 'number') continue;
      if (e.at < since) {
        dropped++;
        continue;
      }
      if (!held.byContent.has(e.content)) held.byContent.set(e.content, e as Entry);
      if (!held.byPosition.has(`${e.writer}\n${e.seq}`)) held.byPosition.set(`${e.writer}\n${e.seq}`, e.content);
    }
    // The file is written again without what aged out, once, as its project is first read.
    if (dropped > 0) writeAtomic(this.#dir(), `${project}.idx`, [...held.byContent.values()].map((e) => `${JSON.stringify(e)}\n`).join(''));
    this.#projects.set(project, held);
    return held;
  }
}
