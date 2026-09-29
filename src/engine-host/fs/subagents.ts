// Subagent sidecars (C4 execution document, M3; SPEC 18.25.1, 35.11): a session's child agents are the
// `agent-<agentId>.jsonl` files under `<sessionId>/subagents/`, directly or in a transcript subdirectory — a workflow
// run's agents live under `subagents/workflows/<runId>/` — each with an `agent-<agentId>.meta.json` beside it, written
// without an atomic rename and patched in place, so it is read with retry and a torn read keeps the last whole value.
// The listing also answers the backfill's `SubagentLookup`: the parent's `Agent` tool use finds its child by the
// meta's `toolUseId`, and the child's first user record is the prompt. Read-only: files are opened with flag 'r' only.
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId } from '@shared/graph/ids';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import { SubagentMetaSchema, type SubagentMeta } from '@shared/wire/store';
import { AgentMetaSchema, TranscriptRecordSchema } from '@shared/wire/transcript';
import type { SubagentLookup } from './backfill';
import { isMissing, noteReadable, noteUnreadable, readJsonWithRetry } from './sidecars';
import { HEAD_TAIL_BYTES } from './summarize';

const AGENT_TRANSCRIPT = /^agent-(.+)\.jsonl$/;
const MAX_DEPTH = 3; // subagents/<subdir>/<runId>/: deeper directories are not the engine's layout
const WORKFLOW_RUN = /^workflows\/([^/]+)$/; // the subdirectory that names a workflow run

export class SubagentReader {
  private readonly metas = new Map<string, SubagentMeta>(); // last whole meta, by meta path
  private readonly prompts = new Map<string, string>(); // first user text, by agent transcript path, once found

  // Every agent transcript under `<sessionDir>/subagents/`, ordered by path; an empty list when there is none.
  async list(sessionDir: string): Promise<SubagentEntry[]> {
    const found: { dir: string; rel: string; agentId: string; name: string }[] = [];
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
    found.sort((a, b) => (a.rel === b.rel ? a.name.localeCompare(b.name) : a.rel.localeCompare(b.rel)));

    const agents = await Promise.all(
      found.map(async ({ dir, rel, agentId, name }): Promise<SubagentEntry | null> => {
        const transcriptPath = join(dir, name);
        let info;
        try {
          info = await stat(transcriptPath);
        } catch (error) {
          if (isMissing(error)) return null; // gone between listing and stat
          throw error;
        }
        const [meta] = await Promise.all([this.readMeta(join(dir, `agent-${agentId}.meta.json`)), this.promptOf(transcriptPath)]);
        return {
          agentId: agentId as AgentId,
          meta,
          transcriptPath,
          size: info.size,
          mtimeMs: info.mtimeMs,
          runId: WORKFLOW_RUN.exec(rel)?.[1] ?? null,
        };
      }),
    );
    return agents.filter((agent) => agent !== null);
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
