// Shared by the index's tests (C4 M4): temporary directories for index files and project trees, and synthetic
// transcript summaries shaped as discovery produces them. Never the owner's userData or store.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionId } from '@shared/graph/ids';
import type { TranscriptSummary } from '@shared/wire/store';

// A fresh directory under the system temp dir, realpathed (macOS: /var → /private/var) so it compares equal to what the
// index stores, with a remover for afterEach.
export function tempDir(prefix = 'maws-index-'): { path: string; dispose(): void } {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  return { path, dispose: () => rmSync(path, { recursive: true, force: true }) };
}

export function sessionIdFor(n: number): SessionId {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}` as SessionId;
}

let counter = 0;

// A summary as discovery would produce it; the directory defaults to one that does not exist.
export function summary(over: Partial<TranscriptSummary> = {}): TranscriptSummary {
  const sessionId = over.sessionId ?? sessionIdFor(0x100000 + ++counter);
  return {
    sessionId,
    transcriptPath: `/cfg/projects/-nowhere/${sessionId}.jsonl`,
    slug: '-nowhere',
    directory: '/nowhere/at/all',
    relocatedCwd: null,
    size: 100,
    mtimeMs: 1_000,
    firstRecordAt: '2026-09-28T10:00:00.000Z',
    lastRecordAt: '2026-09-28T10:00:00.000Z',
    customTitle: null,
    aiTitle: null,
    firstPrompt: 'hello',
    lastAssistantText: null,
    gitBranch: null,
    engineVersion: '2.1.283',
    entrypoint: 'cli',
    sessionKind: null,
    hasMessages: true,
    leafUuid: null,
    rootUuid: null, // E3
    birthtimeMs: 0, // E3
    ...over,
  };
}
