// P3-E1 M2 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's §1 "Comments"): the agent's comment
// tools on a design. A design's threads are C's (the same `threads` root and `{slideId, elementId}` anchors, a board-level
// thread anchored at the board's ROOT, `elementId: ''`), so B's `artifact_comments`, `artifact_reply` and
// `artifact_resolve` are wrapped exactly as C wraps them for a deck: B's one helper (`threadTool`) over C's thread model,
// answering in B's names and shapes with `slideId` naming the board; a call naming anything else passes to the tool it
// wraps. The design is brought into its model first (an earlier build's shape migrated as the calling session, or the
// call refused naming why) before the helper reads or writes it.
import type { McpToolDefinition } from '../tool-server/server';
import { actorOf, answering, lineageOf } from '../tool-server/artifact-context';
import { threadTool, type DocumentToolDeps, type ThreadKindOps } from '../tool-server/documents';
import { DECK_THREADS } from '../presentations/threads';

type ThreadToolName = 'artifact_comments' | 'artifact_reply' | 'artifact_resolve';
const THREAD_TOOLS: readonly string[] = ['artifact_comments', 'artifact_reply', 'artifact_resolve'];

/** The design's thread model, as B's helper takes it: C's, for the `design` kind. */
export const DESIGN_THREADS: ThreadKindOps = { ...DECK_THREADS, kind: 'design' };

/** The tools in their order, the three thread tools answering a design from its threads; every other call as given. */
export function designThreadTools(deps: DocumentToolDeps, tools: readonly McpToolDefinition[]): McpToolDefinition[] {
  return tools.map((tool) => {
    if (!THREAD_TOOLS.includes(tool.name)) return tool;
    const name = tool.name as ThreadToolName;
    const design = threadTool(name, deps, DESIGN_THREADS);
    const call: McpToolDefinition['call'] = async (args, ctx) => {
      const ref = (args as { artifact?: unknown } | null)?.artifact;
      const store = deps.artifacts?.() ?? null;
      if (typeof ref !== 'string' || !store) return tool.call(args, ctx);
      const id = await store.readCommitted(() => {
        const found = store.resolve(ref, lineageOf(ctx, deps));
        return found !== null && store.get(found)?.kind === 'design' ? found : null;
      });
      if (id === null) return tool.call(args, ctx);
      return answering(name, async () => {
        await store.ensureMigrated(id, actorOf(ctx));
        return design.call(args, ctx);
      });
    };
    return { ...tool, call };
  });
}
