// P3-E2 M2 (ledger X25: `DOCUMENT_THREADS` by kind): B's `artifact_comments`, `artifact_reply` and `artifact_resolve` on
// a dashboard. A dashboard's threads are a document's (B's thread model in its one Y.Doc), so B's one helper serves them
// with B's ops under the dashboard kind; a call naming anything else goes to the tool as given (B's, or C's wrapper of
// it), the way C wraps B's tools for a deck (src/engine-host/presentations/threads.ts).
import { DOCUMENT_THREADS, threadTool, type DocumentToolDeps, type ThreadKindOps } from '../tool-server/documents';
import type { McpToolContext, McpToolDefinition } from '../tool-server/server';

type ThreadToolName = 'artifact_comments' | 'artifact_reply' | 'artifact_resolve';
const THREAD_TOOLS: readonly string[] = ['artifact_comments', 'artifact_reply', 'artifact_resolve'];

const DASHBOARD_THREADS: ThreadKindOps = { ...DOCUMENT_THREADS, kind: 'dashboard' };

async function namesDashboard(deps: DocumentToolDeps, args: unknown, ctx: McpToolContext): Promise<boolean> {
  const ref = (args as { artifact?: unknown } | null)?.artifact;
  const store = deps.artifacts?.() ?? null;
  if (typeof ref !== 'string' || !store) return false;
  return store.readCommitted(() => {
    const id = store.resolve(ref, [ctx.appSessionId, ...(deps.artifactScope ?? [])]);
    return id !== null && store.get(id)?.kind === 'dashboard';
  });
}

/** The tools in their order, B's three thread tools also answering a dashboard; every other tool as given. */
export function dashboardThreadTools(deps: DocumentToolDeps, tools: readonly McpToolDefinition[]): McpToolDefinition[] {
  return tools.map((tool) => {
    if (!THREAD_TOOLS.includes(tool.name)) return tool;
    const board = threadTool(tool.name as ThreadToolName, deps, DASHBOARD_THREADS);
    const call: McpToolDefinition['call'] = async (args, ctx) => ((await namesDashboard(deps, args, ctx)) ? board.call(args, ctx) : tool.call(args, ctx));
    return { ...tool, call };
  });
}
