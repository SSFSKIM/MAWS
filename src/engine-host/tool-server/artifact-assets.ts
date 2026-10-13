// `artifact_upload_asset` and `artifact_list_assets` (X25; the P3-A document's M6): a file under the session's working
// directory added to an artifact's assets (content-addressed, at most 16 MiB, named by the ref a format uses,
// `assets/<name>`), idempotent by tool-use id; and the artifact's assets as the agent reads them.
import { basename } from 'node:path';
import { mimeOf } from '@shared/files/mime';
import { parseToolArguments, type ArtifactListAssetsResult, type ArtifactUploadAssetResult } from '@shared/maws/tools';
import { actorOf, answering, lineageOf, opIdOf, pathUnderCwd, readSourceFile, resolveArtifact, storeOf, type ArtifactToolDeps } from './artifact-context';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

export function artifactUploadAssetTool(deps: ArtifactToolDeps): McpToolDefinition {
  return defineMawsTool('artifact_upload_asset', (args, ctx) =>
    answering('artifact_upload_asset', async () => {
      const parsed = parseToolArguments('artifact_upload_asset', args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const store = storeOf('artifact_upload_asset', deps);
      const source = pathUnderCwd('artifact_upload_asset', ctx.cwd, input.path);
      const bytes = await readSourceFile('artifact_upload_asset', source);
      const name = input.name ?? basename(source);
      const artifactId = await resolveArtifact('artifact_upload_asset', store, input.artifact, lineageOf(ctx, deps));
      const actor = actorOf(ctx);
      const result = await store.writeCommitted(() =>
        store.withOp(
          opIdOf(ctx),
          'artifact_upload_asset',
          artifactId,
          async (op) => {
            const answer = (asset: { assetId: string; ref: string }): ArtifactUploadAssetResult => ({ status: 'uploaded', artifactId, ...asset, name: asset.ref.slice('assets/'.length), size: bytes.length });
            const linked = store.link(artifactId, ctx.appSessionId, 'edited');
            linked.catch(() => {}); // awaited below; a write that fails first reports the batch's failure itself
            const uploaded = await store.uploadAsset(artifactId, bytes, { name, mime: mimeOf(name) }, actor, (asset) => op.record(answer(asset)));
            await linked;
            return answer(uploaded);
          },
          { actor },
        ),
      );
      return toolText(result);
    }),
  );
}

export function artifactListAssetsTool(deps: ArtifactToolDeps): McpToolDefinition {
  return defineMawsTool('artifact_list_assets', (args, ctx) =>
    answering('artifact_list_assets', async () => {
      const parsed = parseToolArguments('artifact_list_assets', args);
      if (!parsed.ok) return toolError(parsed.error);
      const store = storeOf('artifact_list_assets', deps);
      const artifactId = await resolveArtifact('artifact_list_assets', store, parsed.data.artifact, lineageOf(ctx, deps));
      const assets = await store.readCommitted(() =>
        store.listAssets(artifactId).map(({ assetId, ref, name, mime, size, createdAt }) => ({ assetId, ref, name, mime, size, createdAt: new Date(createdAt).toISOString() })),
      );
      const result: ArtifactListAssetsResult = { status: 'listed', artifactId, assets };
      return toolText(result);
    }),
  );
}
