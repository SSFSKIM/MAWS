// Delete conversation, whole or not at all (C10 execution document, Interfaces "Session service", `session.delete`): a
// conversation's files enumerated and persisted before the first Trash move, so a failure half-way is reported and
// resumable. The files are the store's (SPEC §35): recordings `<sessionId>-<stamp>.cast` beside the transcript (flat,
// project-level), the siblings `<sessionId>.precompact.json` and `<sessionId>.ccr-tip.json`, the sidecar directory
// `<sessionId>/`, and the transcript `<sessionId>.jsonl`, in that order, the transcript last: until it moves, the
// conversation stays discoverable and its record intact. This Trash move is the only write C10 makes under `~/.claude`.
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { fileOf, readAll, writeWhole } from './json-files';

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The conversation's existing paths under its project directory, in move order.
export async function enumerateConversation(projectDir: string, sessionId: SessionId): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(projectDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const recording = new RegExp(`^${escapeRegExp(sessionId)}-[^/]+\\.cast$`);
  const recordings = names.filter((name) => recording.test(name)).sort().map((name) => join(projectDir, name));
  const rest: string[] = [];
  for (const path of [`${sessionId}.precompact.json`, `${sessionId}.ccr-tip.json`, sessionId, `${sessionId}.jsonl`].map((name) => join(projectDir, name))) {
    if (await exists(path)) rest.push(path);
  }
  return [...recordings, ...rest];
}

// What the delete sheet names before anything moves: the transcript (null when it is already gone), the subagent
// transcripts in its sidecar (`<sessionId>/subagents/*.jsonl`), the recordings, and the number of paths in all.
export async function describeConversation(projectDir: string, sessionId: SessionId): Promise<{ transcript: string | null; subagents: number; recordings: number; paths: number }> {
  const paths = await enumerateConversation(projectDir, sessionId);
  let subagents = 0;
  try {
    subagents = (await readdir(join(projectDir, sessionId, 'subagents'))).filter((name) => name.endsWith('.jsonl')).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const transcript = join(projectDir, `${sessionId}.jsonl`);
  return { transcript: paths.includes(transcript) ? transcript : null, subagents, recordings: paths.filter((p) => p.endsWith('.cast')).length, paths: paths.length };
}

// `<userData>/sessions/deletions/<appSessionId>.json`: what a delete meant to move and what it has moved.
export interface DeletionManifest {
  appSessionId: AppSessionId;
  engineSessionId: SessionId | null;
  paths: string[];
  trashed: string[];
  createdAt: string;
}

export class DeletionManifests {
  constructor(
    readonly dir: string,
    private readonly warn: (message: string) => void = (message) => console.warn(`[sessions deletions] ${message}`),
  ) {}

  put(manifest: DeletionManifest): Promise<void> {
    return writeWhole(this.dir, manifest.appSessionId, manifest);
  }

  async get(appSessionId: AppSessionId): Promise<DeletionManifest | null> {
    return (await this.list()).find((m) => m.appSessionId === appSessionId) ?? null;
  }

  async remove(appSessionId: AppSessionId): Promise<void> {
    await rm(fileOf(this.dir, appSessionId), { force: true });
  }

  // Every manifest on disk: a delete interrupted half-way (found at start, offered as "Finish deleting" or "Keep").
  async list(): Promise<DeletionManifest[]> {
    return (await readAll(this.dir, this.warn)).map(({ value }) => value as DeletionManifest);
  }
}
