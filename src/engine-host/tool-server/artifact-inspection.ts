// Structured artifacts reuse main's export snapshot and sandboxed renderers for visual inspection.
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtifactStore } from '../documents/store';
import { ARTIFACT_SCREENSHOT_MAX_BYTES, type ArtifactScreenshotInput } from '@shared/maws/tools';
import type { ExportBridge } from './artifact-export';
import { toolError, toolText, type McpToolContext, type McpToolResult } from './server';

export async function inspectStructuredArtifact(store: ArtifactStore, artifactId: string, input: ArtifactScreenshotInput, ctx: McpToolContext, exporter?: ExportBridge): Promise<McpToolResult> {
  if (!exporter) return toolError('artifact_screenshot: the export service is unavailable');
  const target = await store.readCommitted(() => {
    const artifact = store.get(artifactId);
    if (!artifact) throw new Error(`no artifact ${artifactId}`);
    const version = input.version === undefined ? undefined : store.versions.version(artifactId, input.version);
    if (input.version !== undefined && !version) throw new Error(`no retained version ${input.version}; artifact_read lists versions`);
    return { artifact, revision: version?.seq ?? store.revision(artifactId), versionId: version?.id };
  });
  if (target.artifact.kind === 'presentation' && !input.slide) return toolError('artifact_screenshot: name the slide id from artifact_read in slide');
  if (target.artifact.kind !== 'presentation' && input.slide !== undefined) return toolError('artifact_screenshot: slide is only for presentations');
  if (target.artifact.kind !== 'document' && input.offsetY !== undefined) return toolError('artifact_screenshot: offsetY is only for documents');
  const path = join(store.files.dirOf(artifactId), 'exports', `inspect-${randomUUID()}.png`);
  await mkdir(dirname(path), { recursive: true });
  const outcome = await exporter.request({
    requestId: ctx.requestId, appSessionId: ctx.appSessionId, artifactId, kind: target.artifact.kind,
    format: 'png', revision: target.revision, ...(target.versionId !== undefined && { versionId: target.versionId }), path,
    inspection: true, width: input.width ?? 1280, height: input.height ?? 800,
    ...(input.slide !== undefined && { slide: input.slide }), ...(input.offsetY !== undefined && { offsetY: input.offsetY }),
  }, ctx.signal);
  if (outcome.kind !== 'answered') return toolError(`artifact_screenshot: export ${outcome.kind}`);
  if (!outcome.answer.ok) return toolError(`artifact_screenshot: ${outcome.answer.error}`);
  const answer = outcome.answer;
  if (dirname(answer.path) !== dirname(path)) return toolError('artifact_screenshot: export returned a file outside the artifact’s export directory');
  try {
    const png = await readFile(answer.path);
    if (png.length > ARTIFACT_SCREENSHOT_MAX_BYTES) return toolError('artifact_screenshot: image too large; ask for a smaller viewport');
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return toolError('artifact_screenshot: exporter did not return a PNG');
    const result = { status: 'captured', id: input.id, deliverableId: artifactId, title: target.artifact.title,
      kind: target.artifact.kind, revision: answer.revision, ...(target.versionId !== undefined && { version: target.versionId }),
      width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length, consoleErrors: [],
      ...(input.slide !== undefined && { slide: input.slide }), ...(input.offsetY !== undefined && { offsetY: input.offsetY }) };
    return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, ...toolText(result).content] };
  } finally {
    await rm(answer.path, { force: true });
  }
}
