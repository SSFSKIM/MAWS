// `artifact_screenshot` (P1 X9 and X12; E2 execution document, Design §6 and §7; kept by P3-A, X25): main renders a
// version of an `html` artifact offscreen and the PNG comes back as an image block before the text block. The artifact
// is named by its id or a handle the session's lineage holds (P3-A Decision Log 3); its version by its place, from 1,
// among the artifact's versions in the order of their revisions (the viewers' `v1 … vN`, P3-L's Decision Log 4), the
// latest by default; main renders that version's revision on `maws-artifact:` (P3-L's cutover; X12's record is no
// longer read). The answer keeps E2's fields (`deliverableId` the artifact's id; P2-E1's `ownerAppSessionId` naming
// the session that made the page when another). The capture bridge has a deadline. The other artifact tools are
// `./artifact-tools`, `./artifact-publish`, `./artifact-assets` and `./artifact-export`; `externalReferenceCount` is
// shared with them.
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import { ARTIFACT_SCREENSHOT_DEFAULT, parseToolArguments, TOOL_ERRORS, type ArtifactScreenshotResult } from '@shared/maws/tools';
import { answering, lineageOf, resolveArtifact, storeOf, type ArtifactToolDeps } from './artifact-context';
import type { HostBridge } from './bridge';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

// What the host asks main to render (`maws.artifact.capture`, the session adding its app session id): the artifact's
// page at a revision (P3-L's cutover: main resolves it through the store's scheme, whichever session made it).
export interface ArtifactCaptureRequest {
  requestId: RequestId;
  artifactId: string;
  revision: number;
  width: number;
  height: number;
}
export type CaptureBridge = HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>;

// What a capture that settled without main's answer answers (never written when the call was withdrawn or ended).
const WITHDRAWN = 'artifact_screenshot: the request was withdrawn';
const ENDED = 'artifact_screenshot: the session ended';

export function artifactScreenshotTool(deps: Pick<ArtifactToolDeps, 'artifacts' | 'artifactScope' | 'log'> & { capture: CaptureBridge }): McpToolDefinition {
  return defineMawsTool('artifact_screenshot', (args, ctx) =>
    answering('artifact_screenshot', async () => {
      const parsed = parseToolArguments('artifact_screenshot', args);
      if (!parsed.ok) return toolError(parsed.error);
      const { id: ref } = parsed.data;
      const store = storeOf('artifact_screenshot', deps);
      const artifactId = await resolveArtifact('artifact_screenshot', store, ref, lineageOf(ctx, deps));
      const page = await store.readCommitted(() => {
        const artifact = store.get(artifactId);
        if (artifact?.kind !== 'html') return null;
        const creator = (store.links(artifactId).find((link) => link.role === 'created')?.appSessionId as AppSessionId | undefined) ?? null;
        return { artifact, versions: store.listVersions(artifactId), creator };
      });
      if (page === null || page.versions.length === 0) return toolError(TOOL_ERRORS.noArtifact('artifact_screenshot', ref));
      const owner: { ownerAppSessionId?: AppSessionId } = page.creator === null || page.creator === ctx.appSessionId ? {} : { ownerAppSessionId: page.creator };
      const versions = page.versions.length;
      const version = parsed.data.version ?? versions;
      if (version > versions) return toolError(TOOL_ERRORS.noVersion(ref, version, versions));
      const width = parsed.data.width ?? ARTIFACT_SCREENSHOT_DEFAULT.width;
      const height = parsed.data.height ?? ARTIFACT_SCREENSHOT_DEFAULT.height;
      const outcome = await deps.capture.request({ requestId: ctx.requestId, artifactId, revision: page.versions[version - 1]!.seq, width, height }, ctx.signal);
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
        status: 'captured', id: ref, deliverableId: artifactId, title: page.artifact.title, version, width: answer.width, height: answer.height,
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
