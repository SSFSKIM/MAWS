// A test world for the artifact tools (imported by tests only): a working directory, a userData directory, the real
// artifact store over a fresh SQLite file (the storage, the document service and the store, as `openDocuments` makes
// them), one session's `ArtifactSession`, and call helpers.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { ArtifactSession, type ArtifactToolDeps } from './artifact-context';
import type { McpToolContext, McpToolResult } from './server';

export const SELF = 'app-self' as AppSessionId;
export const HUMAN: Actor = { kind: 'human' };

export interface World {
  cwd: string;
  userData: string;
  storage: SqliteDocumentStorage;
  service: DocumentService;
  store: ArtifactStore;
  logs: string[];
  session: ArtifactSession;
  deps(over?: Partial<ArtifactToolDeps>): ArtifactToolDeps;
  ctx(over?: Partial<McpToolContext>): McpToolContext;
  close(): void;
}

let calls = 0;

export function openWorld(): World {
  const cwd = mkdtempSync(join(tmpdir(), 'maws-tools-cwd-'));
  const userData = mkdtempSync(join(tmpdir(), 'maws-tools-data-'));
  const logs: string[] = [];
  const storage = SqliteDocumentStorage.open(join(userData, 'artifacts', 'store.sqlite'), { log: (line) => logs.push(line) });
  const service = new DocumentService(storage, { kindOf: (id) => storage.kindOf(id), log: (line) => logs.push(line) });
  const store = new ArtifactStore(service, storage, { root: join(userData, 'artifacts'), log: (line) => logs.push(line) });
  const session = new ArtifactSession();
  return {
    cwd, userData, storage, service, store, logs, session,
    deps: (over = {}) => ({ artifacts: () => store, session, log: (line) => logs.push(line), ...over }),
    ctx: (over = {}) => ({ appSessionId: SELF, cwd, toolUseId: `toolu_${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, ...over }),
    close: () => {
      store.close();
      service.close();
      storage.close();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

export const textOf = (result: McpToolResult): string => (result.content.find((block) => block.type === 'text') as { text: string }).text;
export const jsonOf = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${textOf(result)}`);
  return JSON.parse(textOf(result)) as T;
};
