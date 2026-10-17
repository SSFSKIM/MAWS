// Held legacy dashboards on the `maws` server (P3-E2 M2 fix waves; parent Decision Log 16): a dashboard A's generic create
// made from files before E2 (a `files` root, no tab; src/artifacts/dashboard/legacy.ts) is never migrated. Its
// `artifact_read` answers its files raw, through A's generic reader, each named in `held` with the reason. Its writes are
// refused by each writer itself, after the operation's replay lookup and at the write (`artifact_edit`'s batch,
// `artifact_dataset`'s final check, `artifact_publish`'s dashboard refusal), so a replayed tool-use id still answers its
// first result and a dashboard that became held while a write read its input is refused with nothing written.
import { legacyDashboardFiles, legacyDashboardReason } from '@artifacts/dashboard/legacy';
import type { ArtifactReadResult } from '@shared/maws/tools';
import type { ArtifactToolDeps } from '../tool-server/artifact-context';
import { toolText, type McpToolContext, type McpToolDefinition } from '../tool-server/server';

/** The held legacy dashboard a call's `artifact` names in the session's lineage, with its files; null for anything else. */
async function heldNamed(deps: Pick<ArtifactToolDeps, 'artifacts' | 'artifactScope'>, args: unknown, ctx: McpToolContext): Promise<string[] | null> {
  const ref = (args as { artifact?: unknown } | null)?.artifact;
  const store = deps.artifacts?.() ?? null;
  if (typeof ref !== 'string' || !store) return null;
  return store.readCommitted(() => {
    const id = store.resolve(ref, [ctx.appSessionId, ...(deps.artifactScope ?? [])]);
    if (id === null || store.get(id)?.kind !== 'dashboard') return null;
    return legacyDashboardFiles(store.service.live(id));
  });
}

/** `tools` with a held legacy dashboard's `artifact_read` answered raw by `genericRead` (A's reader). */
export function legacyDashboardTools(deps: Pick<ArtifactToolDeps, 'artifacts' | 'artifactScope'>, tools: readonly McpToolDefinition[], genericRead: McpToolDefinition): McpToolDefinition[] {
  return tools.map((tool) => {
    if (tool.name !== 'artifact_read') return tool;
    const call: McpToolDefinition['call'] = async (args, ctx) => {
      const held = await heldNamed(deps, args, ctx);
      if (!held) return tool.call(args, ctx);
      const answer = await genericRead.call(args, ctx);
      if (answer.isError) return answer;
      const read = JSON.parse((answer.content[0] as { text: string }).text) as ArtifactReadResult;
      const reasons = [legacyDashboardReason(held)];
      return toolText({ ...read, held: [...(read.held ?? []), ...held.map((path) => ({ path, reasons }))] });
    };
    return { ...tool, call };
  });
}
