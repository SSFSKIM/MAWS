// Subagent sidecars (C4 execution document, M3; SPEC 18.25.1, 35.11): a session's child agents are the
// `agent-<agentId>.jsonl` files under `<sessionId>/subagents/`, directly or in a transcript subdirectory — a workflow
// run's agents live under `subagents/workflows/<runId>/` — each with an `agent-<agentId>.meta.json` beside it, written
// without an atomic rename and patched in place, so it is read with retry and a torn read keeps the last whole value.
// The listing also answers the backfill's `SubagentLookup`: the parent's `Agent` tool use finds its child by the
// meta's `toolUseId`, and the child's first user record is the prompt. A listing is kept current from the agent files
// the watcher reports changed (`update`), so a session with thousands of agents is walked whole only when a caller asks
// for it or a change is one only a walk can settle. Read-only: files are opened with flag 'r' only.
import type { Stats } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { AgentId } from '@shared/graph/ids';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import { SubagentMetaSchema, type SubagentMeta } from '@shared/wire/store';
import { AgentMetaSchema, TranscriptRecordSchema } from '@shared/wire/transcript';
import type { SubagentLookup } from './backfill';
import { isMissing, noteReadable, noteUnreadable, readJsonWithRetry } from './sidecars';
import { HEAD_TAIL_BYTES } from './summarize';

const AGENT_TRANSCRIPT = /^agent-(.+)\.jsonl$/;
const AGENT_META = /^agent-(.+)\.meta\.json$/;
const MAX_DEPTH = 3; // subagents/<subdir>/<runId>/: deeper directories are not the engine's layout
const WORKFLOW_RUN = /^workflows\/([^/]+)$/; // the subdirectory that names a workflow run

// One agent transcript's place: its directory, that directory relative to `subagents/` ('' for `subagents/` itself),
// the agent id and the file's name.
interface AgentFile {
  dir: string;
  rel: string;
  agentId: string;
  name: string;
}

// The walk's order: by directory, then by name.
const byPlace = (a: Pick<AgentFile, 'rel' | 'name'>, b: Pick<AgentFile, 'rel' | 'name'>) => (a.rel === b.rel ? a.name.localeCompare(b.name) : a.rel.localeCompare(b.rel));

export class SubagentReader {
  private readonly metas = new Map<string, SubagentMeta>(); // last whole meta, by meta path
  private readonly prompts = new Map<string, string>(); // first user text, by agent transcript path, once found

  // Every agent transcript under `<sessionDir>/subagents/`, ordered by path; an empty list when there is none.
  async list(sessionDir: string): Promise<SubagentEntry[]> {
    const found: AgentFile[] = [];
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (depth < MAX_DEPTH) await walk(join(dir, entry.name), rel === '' ? entry.name : `${rel}/${entry.name}`, depth + 1);
          continue;
        }
        const agentId = AGENT_TRANSCRIPT.exec(entry.name)?.[1];
        if (agentId !== undefined) found.push({ dir, rel, agentId, name: entry.name });
      }
    };
    await walk(join(sessionDir, 'subagents'), '', 0);
    found.sort(byPlace);

    const agents = await Promise.all(
      found.map(async (file): Promise<SubagentEntry | null> => {
        const info = await statOrNull(join(file.dir, file.name));
        return info === null ? null : this.entry(file, info); // null: gone between listing and stat
      }),
    );
    return agents.filter((agent) => agent !== null);
  }

  // The listing `list` would answer now, read from the agent files named changed alone: `listing` is what `list` (or
  // this) last answered for `sessionDir`, `changed` the changed files' paths relative to it (the watcher's sidecar
  // `rel`, `subagents/…/agent-<id>.jsonl` or `….meta.json`). Each named agent is read again as the walk reads it, gone
  // when its transcript is; every other entry stands. Null when a change is one only a walk can settle: a path that
  // names no agent file, a transcript's name that is a directory's, a read that failed, or a place the walk's order
  // cannot tell from a neighbour's.
  async update(sessionDir: string, listing: readonly SubagentEntry[], changed: Iterable<string>): Promise<SubagentEntry[] | null> {
    const root = join(sessionDir, 'subagents');
    const touched = new Map<string, AgentFile>(); // by transcript path
    for (const path of changed) {
      const parts = path.split('/');
      const name = parts.at(-1)!;
      const agentId = AGENT_TRANSCRIPT.exec(name)?.[1] ?? AGENT_META.exec(name)?.[1];
      if (parts[0] !== 'subagents' || parts.length < 2 || agentId === undefined) return null;
      const subdirs = parts.slice(1, -1);
      if (subdirs.length > MAX_DEPTH) continue; // deeper than the walk looks: never listed
      const dir = join(root, ...subdirs);
      const file = { dir, rel: subdirs.join('/'), agentId, name: `agent-${agentId}.jsonl` };
      touched.set(join(dir, file.name), file);
    }
    let read: (readonly [AgentFile, SubagentEntry | null])[];
    try {
      read = await Promise.all(
        [...touched.values()].map(async (file) => {
          const info = await statOrNull(join(file.dir, file.name));
          if (info?.isDirectory()) throw new Error('a directory under an agent transcript\'s name');
          return [file, info === null ? null : await this.entry(file, info)] as const;
        }),
      );
    } catch {
      return null;
    }
    const next = listing.filter((agent) => !touched.has(agent.transcriptPath));
    const placeOf = (agent: SubagentEntry) => {
      const parts = relative(root, agent.transcriptPath).split(sep);
      return { rel: parts.slice(0, -1).join('/'), name: parts.at(-1)! };
    };
    for (const [file, entry] of read) {
      if (entry === null) continue;
      let low = 0;
      let high = next.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const order = byPlace(placeOf(next[middle]), file);
        if (order === 0) return null; // two places the walk's order does not tell apart: its sort keeps readdir's order
        if (order < 0) low = middle + 1;
        else high = middle;
      }
      next.splice(low, 0, entry);
    }
    return next;
  }

  // One agent as the walk reads it, its transcript stat'ed as `info`.
  private async entry({ dir, rel, agentId, name }: AgentFile, info: Stats): Promise<SubagentEntry> {
    const transcriptPath = join(dir, name);
    const [meta] = await Promise.all([this.readMeta(join(dir, `agent-${agentId}.meta.json`)), this.promptOf(transcriptPath)]);
    return {
      agentId: agentId as AgentId,
      meta,
      transcriptPath,
      size: info.size,
      mtimeMs: info.mtimeMs,
      runId: WORKFLOW_RUN.exec(rel)?.[1] ?? null,
    };
  }

  // The child's first user text, read from the first 64 KiB of its transcript and kept once found.
  private async promptOf(transcriptPath: string): Promise<string | null> {
    const known = this.prompts.get(transcriptPath);
    if (known !== undefined) return known;
    let head: Buffer;
    try {
      const file = await open(transcriptPath, 'r');
      try {
        const buffer = Buffer.alloc(HEAD_TAIL_BYTES);
        const { bytesRead } = await file.read(buffer, 0, HEAD_TAIL_BYTES, 0);
        head = buffer.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    const prompt = firstUserText(head);
    if (prompt !== null) this.prompts.set(transcriptPath, prompt);
    return prompt;
  }

  // The prompt as of the last listing: the synchronous view the backfill's lookup reads.
  cachedPrompt(transcriptPath: string): string | null {
    return this.prompts.get(transcriptPath) ?? null;
  }

  private async readMeta(path: string): Promise<SubagentMeta | null> {
    const read = await readJsonWithRetry(path, (raw) => SubagentMetaSchema.parse(raw));
    if (read.status === 'unreadable') noteUnreadable(path, read.code);
    else noteReadable(path);
    if (read.status === 'ok') this.metas.set(path, read.value);
    else if (read.status === 'absent') this.metas.delete(path);
    return this.metas.get(path) ?? null;
  }
}

// The backfill's lookup over the current listing: only metas that are an `AgentMeta` (an `Agent` tool call's, which
// names the tool use and a description) resolve; a workflow agent's meta names no tool use.
export function subagentLookup(agents: () => readonly SubagentEntry[], reader: SubagentReader): SubagentLookup {
  return {
    byToolUseId(toolUseId) {
      const agent = agents().find((candidate) => candidate.meta?.toolUseId === toolUseId);
      if (agent === undefined) return null;
      const meta = AgentMetaSchema.safeParse(agent.meta);
      if (!meta.success) return null;
      return { agentId: agent.agentId, meta: meta.data, prompt: reader.cachedPrompt(agent.transcriptPath) };
    },
  };
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function firstUserText(head: Buffer): string | null {
  for (const line of head.toString('utf8').split('\n')) {
    let record;
    try {
      record = TranscriptRecordSchema.safeParse(JSON.parse(line.replace(/^\0+/, '')));
    } catch {
      continue; // a torn last line of the window, or garbage
    }
    if (!record.success || record.data.type !== 'user') continue;
    const content = (record.data.message as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block): block is { type: 'text'; text: string } => typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      if (text.length > 0) return text;
    }
  }
  return null;
}
