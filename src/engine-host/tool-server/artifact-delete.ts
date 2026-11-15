// `artifact_delete` (UX wave U10b, M4; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.1): the agent's
// delete of a draft it no longer needs. The store decides (`ArtifactStore.deleteOwnDraft`): an artifact this session, or
// the session a side thread was opened from, created and that only agents have written to; anything else is refused
// with its sentence, followed by the refusal's JSON with `reason: 'invalid'` and the `why` the transcript's row reads.
// Idempotent by tool-use id: a replayed call answers the first answer and deletes nothing twice.
import { TOOL_ERRORS, parseToolArguments, type ArtifactDeleteResult } from '@shared/maws/tools';
import { ArtifactStoreError } from '../documents/errors';
import { actorOf, answering, lineageOf, opIdOf, resolveArtifact, storeOf, ToolRefusal, type ArtifactToolDeps } from './artifact-context';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

const SENTENCES = { byUser: TOOL_ERRORS.deleteByUser, edited: TOOL_ERRORS.deleteEdited, otherSession: TOOL_ERRORS.deleteOtherSession, unknown: TOOL_ERRORS.deleteUnknown } as const;
type Why = keyof typeof SENTENCES;
const isWhy = (why: unknown): why is Why => typeof why === 'string' && Object.hasOwn(SENTENCES, why);

export function artifactDeleteTool(deps: ArtifactToolDeps): McpToolDefinition {
  return defineMawsTool('artifact_delete', (args, ctx) =>
    deps.session.joined(opIdOf(ctx), () => answering('artifact_delete', async () => {
      const parsed = parseToolArguments('artifact_delete', args);
      if (!parsed.ok) return toolError(parsed.error);
      const store = storeOf('artifact_delete', deps);
      // a repeated call answers what the first one did, before the artifact (deleted by then) is looked up again
      const replayed = await store.replayOf(opIdOf(ctx));
      if (replayed.found) return toolText(replayed.result);
      const lineage = lineageOf(ctx, deps);
      const artifactId = await resolveArtifact('artifact_delete', store, parsed.data.artifact, lineage);
      try {
        const result = await store.writeCommitted(() =>
          store.withOp(
            opIdOf(ctx),
            'artifact_delete',
            artifactId,
            async (op) => {
              let answer: ArtifactDeleteResult | null = null;
              await store.deleteOwnDraft(artifactId, lineage, () => {
                const row = store.get(artifactId, { includeDeleted: true })!;
                answer = { status: 'deleted', artifactId, kind: row.kind, title: row.title };
                op.record(answer);
              });
              return answer!;
            },
            { actor: actorOf(ctx) },
          ),
        );
        return toolText(result);
      } catch (error) {
        throw refusalOf(error);
      }
    })),
  );
}

// The store's refusals of an agent's delete as the agent reads them; any other error as it is.
function refusalOf(error: unknown): unknown {
  if (!(error instanceof ArtifactStoreError)) return error;
  if (error.code === 'designSystemInUse') return new ToolRefusal(TOOL_ERRORS.refused('artifact_delete', { reason: 'invalid', ...error.data, why: 'designSystemInUse' }, error.message));
  const { why, title } = error.data;
  if (error.code === 'invalid' && isWhy(why) && typeof title === 'string') return new ToolRefusal(`${SENTENCES[why](title)} ${JSON.stringify({ reason: 'invalid', why })}`);
  return error;
}
