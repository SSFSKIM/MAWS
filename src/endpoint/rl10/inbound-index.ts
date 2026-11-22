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

/** Content `stage` holds for its project: on disk once a `commit` took it, let go when the commit failed. */
export type Staged = { readonly project: string; readonly entry: Entry; state: 'staged' | 'committed' | 'dropped'; first: boolean };

export class InboundIndex {
  readonly #dir: () => string;
  readonly #now: () => number;
  readonly #projects = new Map<string, { byContent: Map<string, Entry>; byPosition: Map<string, string> }>();
  /** The entry each stage made, by the entry. */
  readonly #stages = new WeakMap<Entry, Staged>();

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
  }

  /** Records content new to `project` at its position, on disk before it returns. */
  record(project: string, content: string, writer: string, seq: number): void {
    const staged = this.stage(project, content, writer, seq);
    if (staged !== null) this.commit([staged]);
  }

  /**
   * Content at its position, held now (`seen` meets it) and on disk once a `commit` takes it; null when it is on disk
   * already. Content another caller staged and hasn't committed yet is answered as that caller's entry, so whoever
   * delivers on it commits it first, whichever commit runs (or fails) first.
   */
  stage(project: string, content: string, writer: string, seq: number): Staged | null {
    const held = this.#load(project);
    const at = held.byContent.get(content);
    if (at !== undefined) {
      const staged = this.#stages.get(at);
      return staged === undefined || staged.state === 'committed' ? null : staged;
    }
    const entry: Entry = { content, writer, seq, at: this.#now() };
    const staged: Staged = { project, entry, state: 'staged', first: false };
    this.#stages.set(entry, staged);
    this.#hold(staged);
    return staged;
  }

  /**
   * Writes what `staged` holds that isn't on disk, in one append (one fsync) a project, before it returns. A write that
   * fails lets go of what it would have written, as a write that fails per event left the index without it, and throws.
   */
  commit(staged: Iterable<Staged>): void {
    const byProject = new Map<string, Set<Staged>>();
    for (const s of staged) if (s.state !== 'committed') byProject.set(s.project, (byProject.get(s.project) ?? new Set()).add(s));
    for (const [project, entries] of byProject) {
      for (const s of entries) if (s.state === 'dropped') this.#hold(s);
      try {
        appendLines(this.#dir(), `${project}.idx`, [...entries].map((s) => JSON.stringify(s.entry)));
      } catch (error) {
        for (const s of entries) this.#drop(s);
        throw error;
      }
      for (const s of entries) s.state = 'committed';
    }
  }

  #hold(staged: Staged): void {
    const held = this.#load(staged.project);
    const { entry } = staged;
    staged.state = 'staged';
    held.byContent.set(entry.content, entry);
    const key = `${entry.writer}\n${entry.seq}`;
    staged.first = !held.byPosition.has(key);
    if (staged.first) held.byPosition.set(key, entry.content);
  }

  #drop(staged: Staged): void {
    const held = this.#load(staged.project);
    const { entry } = staged;
    staged.state = 'dropped';
    if (held.byContent.get(entry.content) === entry) held.byContent.delete(entry.content);
    const key = `${entry.writer}\n${entry.seq}`;
    if (staged.first && held.byPosition.get(key) === entry.content) held.byPosition.delete(key);
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
