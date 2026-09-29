// Holder authority (C10 execution document, Interfaces "Holder authority"; residue *Holder authority*): who holds a
// session, or who is in a directory, decided at the moment an exclusive or destructive boundary needs it (resume,
// archive, delete, worktree cleanup), never read from `SessionRecord.holder`, which C4 projects asynchronously. Two
// fresh reads: C3's process table (`engine.sessions`; an entry is MAWS's own until the OS reports its exit, and each
// status carries its launch spec's `cwd`, so a record-less trust bootstrap counts) and C4's registry read (`fs.holders`,
// which refreshes under C4's liveness rule and fails closed). A reservation wins over a registry holder. A registry
// that cannot be read, or a process table that cannot be answered, rejects the guarded operation with that message:
// it is never read as "no holders". Every path is compared as an NFC realpath.
import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { normalizePath } from '@shared/sessions/trust';
import type { WorktreeOccupancy } from '@shared/sessions/worktree';
import type { HostDispatch } from '../ipc/router';

export interface HolderDeps {
  dispatch: HostDispatch; // the engine host's `engine.sessions` and `fs.holders`
  sessions: { list(opts?: { includeArchived?: boolean }): SessionRecord[] }; // the index's records (occupancy only)
}

type SessionHolder = SessionRecord['holder'];
export type HolderVerdict = { holder: SessionHolder; live: 'self' | 'foreign' | 'none'; source: 'reservation' | 'registry' | 'none' };

const SELF: HolderVerdict = { holder: { kind: 'self' }, live: 'self', source: 'reservation' };
const NONE: HolderVerdict = { holder: { kind: 'none' }, live: 'none', source: 'none' };

// One session. A reservation under the app id, or under another app id for the same engine session, is MAWS's own
// (`already_live`); else the first live registry holder of the engine session (`held`); else none.
export async function holderAuthority(deps: HolderDeps, q: { engineSessionId: SessionId | null; appSessionId: AppSessionId }): Promise<HolderVerdict> {
  const reserved = (await reservations(deps)).some(
    (s) => s.appSessionId === q.appSessionId || (q.engineSessionId !== null && s.engineSessionId === q.engineSessionId),
  );
  if (reserved) return SELF;
  if (q.engineSessionId === null) return NONE; // no engine id: nothing the registry could name
  const { holders } = await ask(deps.dispatch, 'fs.holders', { sessionIds: [q.engineSessionId], directories: null });
  const first = holders[0];
  return first ? { holder: first.holder, live: 'foreign', source: 'registry' } : NONE;
}

// One directory (the worktree cleanup's `occupancy`). Records "here" are the index's records whose `directory` or
// `worktree.path` is the directory; they are stored as realpaths (C4), so only the directory asked about is resolved.
export async function occupancyOf(deps: HolderDeps, directory: string): Promise<WorktreeOccupancy> {
  const dir = await canonicalPath(directory);
  const all = deps.sessions.list({ includeArchived: true });
  const here = all.filter((r) => isHere(r.directory, dir) || (r.worktree !== null && isHere(r.worktree.path, dir)));
  const hereIds = new Set<string>(here.map((r) => r.appId));
  const known = new Set<string>(all.flatMap((r) => (r.engineSessionId === null ? [] : [r.engineSessionId])));
  const hereEngineIds = new Set<string>(here.flatMap((r) => (r.engineSessionId === null ? [] : [r.engineSessionId])));

  const [live, registry] = await Promise.all([
    reservations(deps),
    ask(deps.dispatch, 'fs.holders', { sessionIds: [...hereEngineIds], directories: [dir] }),
  ]);
  const cwds = await Promise.all(live.map((s) => canonicalPath(s.cwd)));
  const reserved = live.filter((s, i) => cwds[i] === dir || hereIds.has(s.appSessionId));
  const reservedIds = new Set<string>(live.flatMap((s) => (s.engineSessionId === null ? [s.appSessionId] : [s.appSessionId, s.engineSessionId])));

  let foreign = 0;
  let unbound = 0;
  const heldEngineIds = new Set<string>();
  for (const row of registry.holders) {
    const inDirectory = row.cwd !== null && normalizePath(row.cwd) === dir;
    if (!inDirectory && !hereEngineIds.has(row.sessionId)) continue;
    heldEngineIds.add(row.sessionId);
    if (row.appSessionId !== null || known.has(row.sessionId)) foreign += 1;
    else unbound += 1;
  }

  const isLive = (r: SessionRecord) => reservedIds.has(r.appId) || (r.engineSessionId !== null && (reservedIds.has(r.engineSessionId) || heldEngineIds.has(r.engineSessionId)));
  const idleAppSessionIds = here.filter((r) => !r.archived && !isLive(r)).map((r) => r.appId);
  const liveAppSessionIds = here.filter((r) => !r.archived && isLive(r)).map((r) => r.appId);
  const archived = here.filter((r) => r.archived && !isLive(r)).length;
  return { self: reserved.length, foreign, unbound, idle: idleAppSessionIds.length, archived, idleAppSessionIds, liveAppSessionIds };
}

// The path as the engine and the registry compare it: the realpath, NFC, no trailing separator. A path that does not
// exist (a worktree removed by hand) resolves through its nearest existing ancestor, so `/tmp/x` and `/private/tmp/x`
// still name one directory after `x` is gone.
export async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return normalizePath(await realpath(absolute));
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return normalizePath(absolute);
    return normalizePath(join(await canonicalPath(parent), basename(absolute)));
  }
}

function isHere(path: string, dir: string): boolean {
  return normalizePath(path) === dir;
}

// The live reservations: every process-table entry whose process the OS has not yet reported exited.
async function reservations(deps: HolderDeps) {
  return (await ask(deps.dispatch, 'engine.sessions', undefined)).filter((s) => s.process !== 'exited');
}

async function ask<N extends CommandName>(dispatch: HostDispatch, name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  const result = await dispatch('engine-host', name, input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value as CommandOutput<N>;
}
