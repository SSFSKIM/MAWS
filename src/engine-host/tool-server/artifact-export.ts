// `artifact_export` (X25 and X31; the P3-A document's M6 and M7): an artifact's live state or a retained version exported
// as a file by main's export service, asked over the host bridge as `artifact_screenshot`'s capture is
// (`maws.artifact.export`, answered by `maws.artifact.exported`; EXPORT_ANSWER_MS, `noClient` when no app is connected:
// the export needs the app open, and nothing is queued). The host names the output's path,
// `<userData>/artifacts/<id>/exports/<revision>-<format>.<ext>`, where main writes it; `to` (under the working
// directory) gets a copy. Which kinds export to which formats is main's registry's to say (B and C register DOCX and
// PPTX; M7 serves `html` as PDF and PNG): a pair it lacks answers `exportUnavailable`. Without a bridge (a host with no
// session wiring, as in some tests) every export answers `exportUnavailable`.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import { artifactExportName, parseToolArguments, TOOL_ERRORS, type ArtifactExportResult } from '@shared/maws/tools';
import { answering, lineageOf, messageOf, pathUnderCwd, refuse, resolveArtifact, storeOf, ToolRefusal, type ArtifactToolDeps } from './artifact-context';
import type { HostBridge } from './bridge';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

// What the host asks main to export (`maws.artifact.export`), and main's answer (`maws.artifact.exported`): the file is
// at the request's path, or why not (`unavailable`: no exporter for this kind and format).
export type ArtifactExportRequest = MawsArtifactExport;
export type ArtifactExportAnswer = MawsArtifactExportAnswer;
export type ExportBridge = HostBridge<ArtifactExportRequest, ArtifactExportAnswer>;


export function artifactExportTool(deps: ArtifactToolDeps & { exporter?: ExportBridge }): McpToolDefinition {
  return defineMawsTool('artifact_export', (args, ctx) =>
    answering('artifact_export', async () => {
      const parsed = parseToolArguments('artifact_export', args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const store = storeOf('artifact_export', deps);
      const to = input.to === undefined ? null : pathUnderCwd('artifact_export', ctx.cwd, input.to);
      const artifactId = await resolveArtifact('artifact_export', store, input.artifact, lineageOf(ctx, deps));
      const target = await store.readCommitted(() => {
        const artifact = store.get(artifactId);
        if (!artifact) throw new ToolRefusal(TOOL_ERRORS.noArtifact('artifact_export', input.artifact));
        if (input.version === undefined) return { kind: artifact.kind, revision: store.revision(artifactId) };
        const version = store.versions.version(artifactId, input.version);
        if (!version) throw refuse('artifact_export', { reason: 'notFound', version: input.version }, `version ${input.version} does not exist; artifact_read lists the versions it has`);
        return { kind: artifact.kind, revision: version.seq, versionId: version.id };
      });
      const unavailable = (why: string) => refuse('artifact_export', { reason: 'exportUnavailable', format: input.format, kind: target.kind }, why);
      if (!deps.exporter) throw unavailable(`this build of MAWS cannot export a ${target.kind} artifact as ${input.format}`);
      const path = join(store.files.dirOf(artifactId), 'exports', artifactExportName(target.revision, input.format));
      await mkdir(dirname(path), { recursive: true });
      const outcome = await deps.exporter.request({ requestId: ctx.requestId, appSessionId: ctx.appSessionId, artifactId, format: input.format, ...target, path, ...(input.pageSize !== undefined && { pageSize: input.pageSize }) }, ctx.signal);
      switch (outcome.kind) {
        case 'timeout':
          throw new ToolRefusal('artifact_export: MAWS did not answer in time');
        case 'withdrawn':
          throw new ToolRefusal('artifact_export: the request was withdrawn');
        case 'ended':
          throw new ToolRefusal('artifact_export: the session ended');
        case 'noClient':
          throw new ToolRefusal(TOOL_ERRORS.appNotOpen('artifact_export'));
        case 'answered':
          break;
      }
      const answer = outcome.answer;
      if (!answer.ok) throw answer.unavailable ? unavailable(answer.error) : new ToolRefusal(`artifact_export: MAWS could not export the artifact: ${answer.error}`);
      // the snapshot main exported (a document that moved since names a later revision), in the directory named here
      if (dirname(answer.path) !== dirname(path)) throw new ToolRefusal(`artifact_export: MAWS wrote the export outside ${dirname(path)}`);
      const exported = answer.path;
      if (to !== null) {
        try {
          await mkdir(dirname(to), { recursive: true });
          await copyFile(exported, to);
        } catch (error) {
          throw new ToolRefusal(`artifact_export: exported to ${exported}, but the copy to ${to} failed: ${messageOf(error)}`);
        }
      }
      const result: ArtifactExportResult = {
        status: 'exported', artifactId, format: input.format, revision: answer.revision, path: exported, ...(to !== null && { copiedTo: to }),
        ...(answer.blockedRequests !== undefined && { blockedRequests: answer.blockedRequests }),
      };
      return toolText(result);
    }),
  );
}
