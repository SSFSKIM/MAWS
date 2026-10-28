// The inbound index (O10 M6; Interfaces §E's `inbound/<project id>.idx`): every arriving v2 event's signed content, by
// SHA-256 of its signing input (which binds the org and the project), with the first position it arrived at. The v2
// signature covers a `hub/<member>` event's body and `created` but not the position the hub gives it, so a hostile hub
// could post a person's signed words again at the next sequence as a new instruction; a copy of held content at another
// position is `replayed` and never reaches sminos. It replaces sminos's DX1 nonce index, which leaves with the codes.
//
// The index keeps 30 days (a line older is dropped when its project's file is read), and a `human` event whose signed
// `created` is more than 24 hours old is never delivered as words (words.ts), so the window bounds both. Lines are
// `{content, writer, seq, at}`, appended and fsynced before the event goes down to sminos.
import { appendLines, readLines, writeAtomic } from '../state/files';
import { isProjectFileName } from './signature-ledger';

export const INBOUND_KEPT_MS = 30 * 86_400_000;

type Entry = { content: string; writer: string; seq: number; at: number };

export type Seen = { kind: 'new' } | { kind: 'same' } | { kind: 'replayed'; writer: string; seq: number };

export class InboundIndex {
  readonly #dir: () => string;
  readonly #now: () => number;
  readonly #projects = new Map<string, { byContent: Map<string, Entry>; byPosition: Map<string, string> }>();

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
    const entry: Entry = { content, writer, seq, at: this.#now() };
    appendLines(this.#dir(), `${project}.idx`, [JSON.stringify(entry)]);
    const held = this.#load(project);
    held.byContent.set(content, entry);
    if (!held.byPosition.has(`${writer}\n${seq}`)) held.byPosition.set(`${writer}\n${seq}`, content);
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
