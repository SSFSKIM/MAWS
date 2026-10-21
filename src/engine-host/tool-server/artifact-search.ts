// `artifact_search` (X33; P4-B4: docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "`artifact_search`"): the
// library searched by the words in its artifacts' titles and text, over the host store's full-text mirror
// (`../documents/search.ts`). Every hit is `artifact_list`'s row (`ListedArtifact`) with a snippet around the match and,
// for a document or a file model, the place `artifact_read` opens it at. Read-only: nothing is linked or recorded.
import { parseQuery } from '@shared/artifacts/search-query';
import { ARTIFACT_SEARCH_DEFAULTS, SEARCH_REFUSALS, searchHint, type ArtifactSearchHit, type ArtifactSearchResult } from '@shared/maws/search-tools';
import { parseToolArguments } from '@shared/maws/tools';
import { artifactSearchOf } from '../documents/search';
import { answering, editorOf, lineageOf, storeOf, type ArtifactToolDeps } from './artifact-context';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

const iso = (ms: number) => new Date(ms).toISOString();

export function artifactSearchTool(deps: ArtifactToolDeps): McpToolDefinition {
  return defineMawsTool('artifact_search', (args, ctx) =>
    answering('artifact_search', async () => {
      const parsed = parseToolArguments('artifact_search', args);
      if (!parsed.ok) return toolError(parsed.error);
      const { query, kind, spaceId, scope = ARTIFACT_SEARCH_DEFAULTS.scope, limit = ARTIFACT_SEARCH_DEFAULTS.limit } = parsed.data;
      const { terms } = parseQuery(query);
      if (terms.length === 0) return toolError(SEARCH_REFUSALS.noTerms(query));
      const store = storeOf('artifact_search', deps);
      const found = await artifactSearchOf(store).search({ terms, kind, spaceId, linkedTo: scope === 'session' ? lineageOf(ctx, deps) : undefined, limit });
      const hits = found.hits.map(
        (hit): ArtifactSearchHit => ({
          id: hit.id, ...(hit.handle !== null && { handle: hit.handle }), kind: hit.kind, title: hit.title,
          revision: hit.revision, updatedAt: iso(hit.updatedAt), lastEditor: editorOf(hit.lastWrite, ctx.appSessionId),
          ...(hit.spaceId !== null && { spaceId: hit.spaceId, spaceName: hit.spaceName }),
          ...(hit.snippet !== undefined && { snippet: hit.snippet }), ...(hit.read !== undefined && { read: hit.read }),
        }),
      );
      const hint = searchHint({ scope, hits: hits.length, searchedAsBefore: found.searchedAsBefore });
      const result: ArtifactSearchResult = { status: 'found', hits, more: found.more, ...(hint !== undefined && { hint }) };
      return toolText(result);
    }),
  );
}
