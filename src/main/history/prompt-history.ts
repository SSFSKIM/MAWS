// The composer's prompt history (C7 execution document, Interfaces "X2 additions", `session.history.*`): MAWS's own
// `<userData>/prompt-history.jsonl`, appended here in the terminal's record shape (`{ display, pastedContents,
// timestamp, project, sessionId }`), merged with the terminal's `<CLAUDE_CONFIG_DIR>/history.jsonl`, which is only ever
// read (D-12). The terminal's is read as its last 512 KiB, MAWS's (whose bodies are inline) as its last 8 MiB; a torn
// line is skipped. Rows are this project's (the session
// record's directory; every project's when the session has no record yet), merged oldest first by time, de-duplicated
// on the display and the pasted bodies (the newest copy stays), and capped at the newest `limit`.
// Pasted bodies: MAWS stores them inline; a terminal row carries its body inline (up to 1024 characters) or as a
// `contentHash`, which names `<CLAUDE_CONFIG_DIR>/paste-cache/<hash>.txt`, the terminal's own cache file (`bv`,
// cli.pretty.js:543740). A hash is used only when it is 16 lowercase hex digits (the engine's own check, `U1`, :543735),
// so a history row can never name a file outside the cache; an absent file or a bad hash leaves the body unresolved.
import { createHash } from 'node:crypto';
import { mkdir, open as openFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HistoryEntry, PastedContent } from '@shared/composer/history-entry';
import type { AppSessionId } from '@shared/graph/ids';
import { jsonLines, readTail, type OpenFile } from '../files/read-tail';

export const HISTORY_TAIL_BYTES = 512 * 1024; // the terminal's file: bodies past 1024 characters live in its paste cache
export const OWN_HISTORY_TAIL_BYTES = 8 * 1024 * 1024; // MAWS's own file keeps bodies inline (up to 1 MiB each)
const PASTE_HASH = /^[0-9a-f]{16}$/;

export function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude');
}

export interface PromptHistoryOptions {
  file: string; // <userData>/prompt-history.jsonl
  configDir: string; // the terminal's configuration directory (claudeConfigDir)
  session: (appSessionId: AppSessionId) => { directory: string; engineSessionId: string | null } | null;
  open?: OpenFile; // every file access goes through it (the suites spy on it)
  now?: () => number;
}

interface Row {
  display: string;
  timestamp: number;
  source: HistoryEntry['source'];
  sessionId: string | null;
  project: string | null;
  pastedContents: Record<string, PastedContent>;
}

export class PromptHistory {
  private readonly open: OpenFile;

  constructor(private readonly opts: PromptHistoryOptions) {
    this.open = opts.open ?? openFile;
  }

  async list(appSessionId: AppSessionId, limit: number): Promise<HistoryEntry[]> {
    const project = this.opts.session(appSessionId)?.directory ?? null;
    const [own, terminal] = await Promise.all([this.rows(this.opts.file, 'maws', OWN_HISTORY_TAIL_BYTES), this.rows(join(this.opts.configDir, 'history.jsonl'), 'terminal', HISTORY_TAIL_BYTES)]);
    const merged = [...terminal, ...own].filter((row) => project === null || row.project === project).sort((a, b) => a.timestamp - b.timestamp);
    const seen = new Set<string>();
    const kept: Row[] = [];
    for (const row of merged.reverse()) {
      if (row.source === 'terminal') await this.resolve(row); // newest first, only as far as the cap reaches
      const key = identity(row);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(row);
      if (kept.length === limit) break;
    }
    return kept.reverse().map((row) => ({ display: row.display, at: new Date(row.timestamp).toISOString(), source: row.source, sessionId: row.sessionId, pastedContents: row.pastedContents }));
  }

  // One line in the terminal's record shape; the terminal's own file and cache are never opened for writing. `project`
  // is the caller's for a session with no record yet (an unstarted session's intended directory); a record decides.
  async append(appSessionId: AppSessionId, display: string, pastedContents: Record<string, PastedContent>, project: string | null = null): Promise<void> {
    const record = this.opts.session(appSessionId);
    const line = `${JSON.stringify({ display, pastedContents, timestamp: (this.opts.now ?? Date.now)(), project: record?.directory ?? project, sessionId: record?.engineSessionId ?? null })}\n`;
    await mkdir(dirname(this.opts.file), { recursive: true });
    const handle = await this.open(this.opts.file, 'a');
    try {
      await handle.write(line);
    } finally {
      await handle.close();
    }
  }

  private async rows(path: string, source: Row['source'], tailBytes: number): Promise<Row[]> {
    const text = await readTail(path, tailBytes, this.open);
    return jsonLines(text ?? '').flatMap((value) => {
      const r = value as { display?: unknown; timestamp?: unknown; project?: unknown; sessionId?: unknown; pastedContents?: unknown };
      if (typeof r.display !== 'string' || typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp)) return [];
      return [{ display: r.display, timestamp: r.timestamp, source, sessionId: typeof r.sessionId === 'string' ? r.sessionId : null, project: typeof r.project === 'string' ? r.project : null, pastedContents: pastedOf(r.pastedContents) }];
    });
  }

  // A terminal row's hashed bodies, from the terminal's paste cache, read only.
  private async resolve(row: Row): Promise<void> {
    for (const pasted of Object.values(row.pastedContents)) {
      if (pasted.type !== 'text' || pasted.content !== null || pasted.contentHash === null || !PASTE_HASH.test(pasted.contentHash)) continue;
      try {
        const handle = await this.open(join(this.opts.configDir, 'paste-cache', `${pasted.contentHash}.txt`), 'r');
        try {
          pasted.content = await handle.readFile('utf8');
        } finally {
          await handle.close();
        }
      } catch {
        /* no cache file: unresolved */
      }
    }
  }
}

// The terminal's pasted-content records (`{ id, type, content }` or `{ id, type, contentHash }`) and MAWS's own, in the
// shape the composer reads; an image's bytes are never answered (history recalls images as unavailable).
function pastedOf(value: unknown): Record<string, PastedContent> {
  const out: Record<string, PastedContent> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, raw] of Object.entries(value)) {
    const p = raw as { id?: unknown; type?: unknown; content?: unknown; contentHash?: unknown; mediaType?: unknown; filename?: unknown } | null;
    if (!p || (p.type !== 'text' && p.type !== 'image')) continue;
    const id = typeof p.id === 'number' && Number.isInteger(p.id) ? p.id : Number(key);
    if (!Number.isInteger(id)) continue;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    out[key] = { id, type: p.type, content: p.type === 'text' ? str(p.content) : null, contentHash: str(p.contentHash), mediaType: str(p.mediaType), filename: str(p.filename) };
  }
  return out;
}

// Two rows are the same prompt when their displays and their pasted bodies (in placeholder order) are the same.
function identity(row: Row): string {
  const bodies = Object.entries(row.pastedContents)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, p]) => p.content);
  return `${row.display}\u0000${createHash('sha256').update(JSON.stringify(bodies)).digest('hex')}`;
}
