// The grants of chosen files (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B and
// decisions 4 and 21): the daemon's record that the person chose one file, for one session, in the system's chooser.
// One real path per grant, for that session alone. The store is a file of the profile, `sessions/file-grants.json`
// (`{ version: 1, sessions: { <id>: [{ real, at }] } }`, oldest first), read once when opened and written whole and
// atomically before memory changes; a session keeps at most GRANTS_PER_SESSION_MAX, the oldest going first.
//
// The failures (decision 21): a file this build cannot read as its version holds nothing for the run, is logged once
// (its size, never its content) and is left as it is until the next change; an entry it does not take is read past. An
// add asks the view, in the same synchronous step as its write, whether the session is still known, and fails when it
// is not or the write fails, memory untouched. A drop and a reconcile change memory first, then write; a failure there
// is logged and never thrown (the view's `record` listeners run with no catch around them), and the next change
// writes the file again. Nothing is written when memory did not change.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';
import type { AppSessionId } from '@shared/graph/ids';
import type { SpineView } from '@shared/spine/view';

export const GRANTS_PER_SESSION_MAX = 256;

export interface FileGrants {
  add(appSessionId: AppSessionId, real: string): void; // throws for a session the view does not know, or when the file cannot be written
  has(appSessionId: AppSessionId, real: string): boolean;
  drop(appSessionId: AppSessionId): void; // never throws
  reconcile(): void; // drops the grants of every session the view no longer knows; never throws
}

export interface FileGrantsOptions {
  known(appSessionId: AppSessionId): boolean; // the spine's view: a record or an intent
  now?: () => number;
  log(line: string): void; // never handed a granted path
}

const VERSION = 1;
type Sessions = Map<AppSessionId, Map<string, number>>; // per session, real path → time, oldest first

const codeOf = (error: unknown): string => (error as NodeJS.ErrnoException | null)?.code ?? (error instanceof Error ? error.name : 'error');

// The file as this build's version, or why it is not one: absent (nothing to hold), or unreadable with its size
function read(file: string): { sessions: Sessions } | { absent: true } | { unreadable: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return codeOf(error) === 'ENOENT' ? { absent: true } : { unreadable: `the grants file cannot be read (${codeOf(error)})` };
  }
  const unreadable = { unreadable: `the grants file is not one this build reads (${Buffer.byteLength(text)} bytes): it holds no grant for this run, and is left as it is until the next change` };
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
    const grants = new Map<string, number>();
    for (const entry of entries as unknown[]) {
      const { real, at } = (entry ?? {}) as { real?: unknown; at?: unknown };
      if (typeof real !== 'string' || !isAbsolute(real) || typeof at !== 'number' || !Number.isFinite(at)) continue;
      grants.delete(real);
      grants.set(real, at);
    }
    capped(grants);
    if (grants.size > 0) sessions.set(id as AppSessionId, grants);
  }
  return { sessions };
}

function capped(grants: Map<string, number>): void {
  for (const real of grants.keys()) {
    if (grants.size <= GRANTS_PER_SESSION_MAX) return;
    grants.delete(real);
  }
}

export function openFileGrants(file: string, options: FileGrantsOptions): FileGrants {
  const now = options.now ?? Date.now;
  const opened = read(file);
  if ('unreadable' in opened) options.log(opened.unreadable);
  let sessions: Sessions = 'sessions' in opened ? opened.sessions : new Map();

  const write = (next: Sessions) => {
    const whole = { version: VERSION, sessions: Object.fromEntries([...next].map(([id, grants]) => [id, [...grants].map(([real, at]) => ({ real, at }))])) };
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    atomicWriteFileSync(file, JSON.stringify(whole));
  };
  // a drop's and a reconcile's: memory first, then the file, a failure logged
  const settle = (next: Sessions, why: string) => {
    sessions = next;
    try {
      write(next);
    } catch (error) {
      options.log(`the grants file could not be written at ${why} (${codeOf(error)}); the next change writes it again`);
    }
  };
  const without = (gone: (id: AppSessionId) => boolean): Sessions | null => {
    const next = new Map([...sessions].filter(([id]) => !gone(id)));
    return next.size === sessions.size ? null : next;
  };

  return {
    add(appSessionId, real) {
      if (!options.known(appSessionId)) throw new Error(`unknown app session: ${appSessionId}`);
      const grants = new Map(sessions.get(appSessionId));
      grants.delete(real);
      grants.set(real, now());
      capped(grants);
      const next = new Map(sessions).set(appSessionId, grants);
      write(next);
      sessions = next;
    },
    has: (appSessionId, real) => sessions.get(appSessionId)?.has(real) ?? false,
    drop(appSessionId) {
      const next = without((id) => id === appSessionId);
      if (next !== null) settle(next, 'a removal');
    },
    reconcile() {
      let next: Sessions | null;
      try {
        next = without((id) => !options.known(id));
      } catch (error) {
        options.log(`the grants could not be reconciled with the sessions (${codeOf(error)})`);
        return;
      }
      if (next !== null) settle(next, 'the reconcile');
    },
  };
}

// spine-root.ts's wiring (decision 21): reconcile once the view can be read (at once, else at its first availability),
// and drop the grants of each record the view removes. Answers the unsubscribe.
export function followView(grants: Pick<FileGrants, 'drop' | 'reconcile'>, view: Pick<SpineView, 'unavailable' | 'on'>): () => void {
  const offs: (() => void)[] = [];
  if (view.unavailable() === null) grants.reconcile();
  else {
    const off = view.on('availability', (reason) => {
      if (reason !== null) return;
      off();
      grants.reconcile();
    });
    offs.push(off);
  }
  offs.push(view.on('record', (appSessionId, record) => {
    if (record === null) grants.drop(appSessionId);
  }));
  return () => offs.forEach((off) => off());
}
