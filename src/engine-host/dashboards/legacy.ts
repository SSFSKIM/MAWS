// Held legacy dashboards on the `maws` server (P3-E2 M2 fix wave; parent Decision Log 16): a dashboard A's generic create
// made from files before E2 (a `files` root, no tab; src/artifacts/dashboard/legacy.ts) is never migrated. Its
// `artifact_read` answers its files raw, through A's generic reader, each named in `held` with the reason; its
// `artifact_edit`, `artifact_publish` and `artifact_dataset` are refused by name and path with the way forward, before
// anything is written. Every other artifact, and every other tool, goes to the tool as given.
import { legacyDashboardFiles, legacyDashboardReason } from '@artifacts/dashboard/legacy';
import { TOOL_ERRORS, type ArtifactReadResult, type ArtifactToolName } from '@shared/maws/tools';
import type { ArtifactToolDeps } from '../tool-server/artifact-context';
import { toolError, toolText, type McpToolContext, type McpToolDefinition } from '../tool-server/server';

const WRITERS: readonly string[] = ['artifact_edit', 'artifact_publish', 'artifact_dataset'];

/** The held legacy dashboard a call's `artifact` names in the session's lineage, with its files; null for anything else. */
async function heldNamed(deps: Pick<ArtifactToolDeps, 'artifacts' | 'artifactScope'>, args: unknown, ctx: McpToolContext): Promise<{ ref: string; paths: string[] } | null> {
  const ref = (args as { artifact?: unknown } | null)?.artifact;
  const store = deps.artifacts?.() ?? null;
  if (typeof ref !== 'string' || !store) return null;
  return store.readCommitted(() => {
    const id = store.resolve(ref, [ctx.appSessionId, ...(deps.artifactScope ?? [])]);
    if (id === null || store.get(id)?.kind !== 'dashboard') return null;
    const paths = legacyDashboardFiles(store.service.live(id));
    return paths && { ref, paths };
  });
}

/** `tools` with a held legacy dashboard read raw by `genericRead` (A's reader) and its writes refused. */
export function legacyDashboardTools(deps: Pick<ArtifactToolDeps, 'artifacts' | 'artifactScope'>, tools: readonly McpToolDefinition[], genericRead: McpToolDefinition): McpToolDefinition[] {
  return tools.map((tool) => {
    if (tool.name === 'artifact_read') {
      const call: McpToolDefinition['call'] = async (args, ctx) => {
        const held = await heldNamed(deps, args, ctx);
        if (!held) return tool.call(args, ctx);
        const answer = await genericRead.call(args, ctx);
        if (answer.isError) return answer;
        const read = JSON.parse((answer.content[0] as { text: string }).text) as ArtifactReadResult;
        const reasons = [legacyDashboardReason(held.paths)];
        return toolText({ ...read, held: [...(read.held ?? []), ...held.paths.map((path) => ({ path, reasons }))] });
      };
      return { ...tool, call };
    }
    if (!WRITERS.includes(tool.name)) return tool;
    const name = tool.name as ArtifactToolName;
    const call: McpToolDefinition['call'] = async (args, ctx) => {
      const held = await heldNamed(deps, args, ctx);
      if (!held) return tool.call(args, ctx);
      return toolError(TOOL_ERRORS.refused(name, { reason: 'invalid', kind: 'dashboard', held: held.paths }, `${held.ref}: ${legacyDashboardReason(held.paths)}; nothing was written`));
    };
    return { ...tool, call };
  });
}
