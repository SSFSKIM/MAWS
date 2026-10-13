// `artifact_screenshot` (P1 X9 and X12; E2 execution document, Design §6 and §7; kept by P3-A, X25): main renders an
// `html` artifact's X12 record offscreen and the PNG comes back as an image block before the text block. The artifact is
// named by its id or a handle the session's lineage holds (P3-A Decision Log 3); its record is the one the X12 mirror
// keeps under the session that created it (P3-A Decision Log 4; P2-E1: a side thread screenshots its parent's page, the
// result naming the owner in `ownerAppSessionId`). The capture bridge has a deadline. The other artifact tools are
// `./artifact-tools`, `./artifact-publish`, `./artifact-assets` and `./artifact-export`; `externalReferenceCount` is
// shared with them.
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import { ARTIFACT_SCREENSHOT_DEFAULT, parseToolArguments, TOOL_ERRORS, type ArtifactScreenshotResult } from '@shared/maws/tools';
import { answering, lineageOf, resolveArtifact, storeOf, type ArtifactToolDeps } from './artifact-context';
import type { HostBridge } from './bridge';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

// What the host asks main to render (`maws.artifact.capture`, the session adding its app session id). P2-E1:
// `ownerAppSessionId` when the record is an ancestor's (main reads it there; the answer still routes by the requester).
export interface ArtifactCaptureRequest {
  requestId: RequestId;
  deliverableId: string;
  version: number;
  width: number;
  height: number;
  ownerAppSessionId?: AppSessionId;
}
export type CaptureBridge = HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>;

// What a capture that settled without main's answer answers (never written when the call was withdrawn or ended).
const WITHDRAWN = 'artifact_screenshot: the request was withdrawn';
const ENDED = 'artifact_screenshot: the session ended';

export function artifactScreenshotTool(deps: Pick<ArtifactToolDeps, 'artifacts' | 'deliverables' | 'artifactScope' | 'log'> & { capture: CaptureBridge }): McpToolDefinition {
  return defineMawsTool('artifact_screenshot', (args, ctx) =>
    answering('artifact_screenshot', async () => {
      const parsed = parseToolArguments('artifact_screenshot', args);
      if (!parsed.ok) return toolError(parsed.error);
      const { id: ref } = parsed.data;
      const store = storeOf('artifact_screenshot', deps);
      const artifactId = await resolveArtifact('artifact_screenshot', deps, store, ref, lineageOf(ctx, deps));
      const creator = await store.readCommitted(() => store.links(artifactId).find((link) => link.role === 'created')?.appSessionId as AppSessionId | undefined);
      const record = creator === undefined ? null : await deps.deliverables.get(creator, artifactId);
      if (record === null || record.kind !== 'artifact') return toolError(TOOL_ERRORS.noArtifact('artifact_screenshot', ref));
      const owner: { ownerAppSessionId?: AppSessionId } = creator === ctx.appSessionId ? {} : { ownerAppSessionId: creator };
      const versions = record.versions.length;
      const version = parsed.data.version ?? versions;
      if (version > versions) return toolError(TOOL_ERRORS.noVersion(ref, version, versions));
      const width = parsed.data.width ?? ARTIFACT_SCREENSHOT_DEFAULT.width;
      const height = parsed.data.height ?? ARTIFACT_SCREENSHOT_DEFAULT.height;
      const outcome = await deps.capture.request({ requestId: ctx.requestId, deliverableId: record.id, version, width, height, ...owner }, ctx.signal);
      switch (outcome.kind) {
        case 'timeout':
          return toolError(TOOL_ERRORS.captureTimeout);
        case 'withdrawn':
          return toolError(WITHDRAWN);
        case 'ended':
          return toolError(ENDED);
        case 'noClient':
          return toolError(TOOL_ERRORS.appNotOpen('artifact_screenshot')); // E10
        case 'answered':
          break;
      }
      const answer = outcome.answer;
      if (!answer.ok) return toolError(TOOL_ERRORS.captureFailed(answer.error));
      const result: ArtifactScreenshotResult = {
        status: 'captured', id: ref, deliverableId: record.id, title: record.title ?? record.artifactId ?? record.id, version, width: answer.width, height: answer.height,
        bytes: Buffer.from(answer.png, 'base64').length, consoleErrors: answer.consoleErrors, ...owner,
      };
      return { content: [{ type: 'image', data: answer.png, mimeType: 'image/png' }, ...toolText(result).content] };
    }),
  );
}

// How many http(s) URLs the page names where a browser would fetch them: `src` and `href` attributes, each candidate of
// a `srcset`, CSS `url(` and a string `@import` (one in `url(` form is counted by the `url(` pattern). Advisory to the
// agent, a regex over the text: the frame loads none of them.
const ATTRIBUTE = /\b(?:src|href)\s*=\s*["']?\s*https?:\/\//gi;
const SRCSET = /\bsrcset\s*=\s*(["'])([\s\S]*?)\1/gi;
const CSS_URL = /url\(\s*["']?\s*https?:\/\//gi;
const CSS_IMPORT = /@import\s+["']\s*https?:\/\//gi;
const URL_START = /https?:\/\//gi;

export function externalReferenceCount(html: string): number {
  const count = (pattern: RegExp, text: string) => text.match(pattern)?.length ?? 0;
  let srcset = 0;
  for (const match of html.matchAll(SRCSET)) srcset += count(URL_START, match[2]!);
  return count(ATTRIBUTE, html) + srcset + count(CSS_URL, html) + count(CSS_IMPORT, html);
}
