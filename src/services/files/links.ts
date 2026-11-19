// The link records of followed files (UX wave U6b-4c, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md,
// R5, Interfaces §B, decision 2): the daemon's record that a link the session may read, in a Markdown file or in one of its
// subagents' transcripts, names one file, found by the daemon itself (`files.follow`). One real path per record, for that
// session alone, with the time, where the link stood (`from`, as the request gave it: kept for a person or a later build
// to read, and asked by nothing) and, when the file admits no save, why (`result`: a tool's output names it in a
// subagent's transcript; `linked`: the file that links it admits no save itself). The store is a file of the profile,
// `sessions/file-links.json` (`{ version: 1, sessions: { <id>: [{ real, at, from, why? }] } }`, oldest first), read once when
// opened and written whole and atomically before memory changes; a session keeps at most LINKS_PER_SESSION_MAX, the oldest
// going first, and a path followed again becomes the newest. A record that admits a save is never lowered by a later follow
// that finds less, and a read-only one is raised by one that finds more, so `from` is always the source of the strength
// the record has.
//
// Built as `grants.ts` is built, and sharing with it only the options' type and `followView`: every entry of the grants
// file stays one main made after the chooser, and a fault in one store cannot lose the other's entries. The failures are
// the grants' (U6e's decision 21): a file this build cannot read as its version holds nothing for the run, is logged once
// (its size, never its content) and is left as it is until the next change; an entry it does not take is read past, and a
// `why` it does not know is read as `linked`, admitting no save. An add asks the view, in the same synchronous step as its
// write, whether the session is still known, and fails when it is not or the write fails, memory untouched. A drop and a
// reconcile change memory first, then write; a failure there is logged and never thrown, and the next change writes the
// file again. Nothing is written when memory did not change.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';
import type { AppSessionId } from '@shared/graph/ids';
import type { FileGrantsOptions } from './grants';

export const LINKS_PER_SESSION_MAX = 256;
export type LinkWhy = 'result' | 'linked'; // why a followed file admits no save; absent, it admits one
export type LinkSource = { file: string } | { agent: string };

export interface FileLinks {
  /** Records the real path for the session, as the newest, with where the link stood. Throws for a session the view
      does not know, or when the file cannot be written (memory untouched). A record that admits a save is not lowered: a
      follow that finds less makes it the newest and changes neither its `why` nor its `from`, so `from` is always the
      source that proved the strength the record has. */
  add(appSessionId: AppSessionId, real: string, from: LinkSource, why?: LinkWhy): void;
  get(appSessionId: AppSessionId, real: string): { why: LinkWhy | null } | null;
  drop(appSessionId: AppSessionId): void; // never throws
  reconcile(): void; // drops the records of every session the view no longer knows; never throws
}

const VERSION = 1;
// `from` as it was read or given, never asked for; `why` null: the file admits a save
interface Entry {
  at: number;
  from: unknown;
  why: LinkWhy | null;
}
type Sessions = Map<AppSessionId, Map<string, Entry>>; // per session, real path → its record, oldest first

const codeOf = (error: unknown): string => (error as NodeJS.ErrnoException | null)?.code ?? (error instanceof Error ? error.name : 'error');

// The file as this build's version, or why it is not one: absent (nothing to hold), or unreadable with its size
function read(file: string): { sessions: Sessions } | { absent: true } | { unreadable: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return codeOf(error) === 'ENOENT' ? { absent: true } : { unreadable: `the links file cannot be read (${codeOf(error)})` };
  }
  const unreadable = { unreadable: `the links file is not one this build reads (${Buffer.byteLength(text)} bytes): it holds no link for this run, and is left as it is until the next change` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unreadable;
  }
  const fields = parsed as { version?: unknown; sessions?: unknown } | null;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields) || fields.version !== VERSION) return unreadable;
  if (fields.sessions === null || typeof fields.sessions !== 'object' || Array.isArray(fields.sessions)) return unreadable;
  const sessions: Sessions = new Map();
  for (const [id, entries] of Object.entries(fields.sessions as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const links = new Map<string, Entry>();
    for (const entry of entries as unknown[]) {
      if (entry === null || typeof entry !== 'object') continue;
      const { real, at, from } = entry as { real?: unknown; at?: unknown; from?: unknown };
      if (typeof real !== 'string' || !isAbsolute(real) || typeof at !== 'number' || !Number.isFinite(at)) continue;
      // absent, a save; `result` as written; anything else, a reason of another build, admits no save
      const why: LinkWhy | null = !Object.hasOwn(entry, 'why') ? null : (entry as { why?: unknown }).why === 'result' ? 'result' : 'linked';
      links.delete(real);
      links.set(real, { at, from, why });
    }
    capped(links);
    if (links.size > 0) sessions.set(id as AppSessionId, links);
  }
  return { sessions };
}

function capped(links: Map<string, Entry>): void {
  for (const real of links.keys()) {
    if (links.size <= LINKS_PER_SESSION_MAX) return;
    links.delete(real);
  }
}

export function openFileLinks(file: string, options: FileGrantsOptions): FileLinks {
  const now = options.now ?? Date.now;
  const opened = read(file);
  if ('unreadable' in opened) options.log(opened.unreadable);
  let sessions: Sessions = 'sessions' in opened ? opened.sessions : new Map();

  const write = (next: Sessions) => {
    const whole = {
      version: VERSION,
      sessions: Object.fromEntries([...next].map(([id, links]) => [id, [...links].map(([real, { at, from, why }]) => ({ real, at, from, ...(why === null ? {} : { why }) }))])),
    };
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    atomicWriteFileSync(file, JSON.stringify(whole));
  };
  // a drop's and a reconcile's: memory first, then the file, a failure logged
  const settle = (next: Sessions, why: string) => {
    sessions = next;
    try {
      write(next);
    } catch (error) {
      options.log(`the links file could not be written at ${why} (${codeOf(error)}); the next change writes it again`);
    }
  };
  const without = (gone: (id: AppSessionId) => boolean): Sessions | null => {
    const next = new Map([...sessions].filter(([id]) => !gone(id)));
    return next.size === sessions.size ? null : next;
  };

  return {
    add(appSessionId, real, from, why) {
      if (!options.known(appSessionId)) throw new Error(`unknown app session: ${appSessionId}`);
      const links = new Map(sessions.get(appSessionId));
      const before = links.get(real);
      // never lowered: a record that admits a save keeps its strength and the source that proved it
      const kept = before !== undefined && before.why === null && why !== undefined;
      links.delete(real);
      links.set(real, { at: now(), from: kept ? before.from : from, why: kept ? null : (why ?? null) });
      capped(links);
      const next = new Map(sessions).set(appSessionId, links);
      write(next);
      sessions = next;
    },
    get(appSessionId, real) {
      const entry = sessions.get(appSessionId)?.get(real);
      return entry === undefined ? null : { why: entry.why };
    },
    drop(appSessionId) {
      const next = without((id) => id === appSessionId);
      if (next !== null) settle(next, 'a removal');
    },
    reconcile() {
      let next: Sessions | null;
      try {
        next = without((id) => !options.known(id));
      } catch (error) {
        options.log(`the links could not be reconciled with the sessions (${codeOf(error)})`);
        return;
      }
      if (next !== null) settle(next, 'the reconcile');
    },
  };
}
