// The `maws-artifact:` scheme (docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 14 and 35e; ledger §1): the
// artifact store's byte-kind content and every artifact's assets, served to frames, images, fonts and media in the app
// and to the capture and export windows. `maws-artifact://<artifactId>/<revision | 'live'>/<path>`; a URL is resolved
// by asking the engine host (`artifacts.content`), never by opening the host's database or building a path from the
// URL, so the scheme serves exactly the store's files. The serving is `./scheme-handler.ts` and the frame policies
// main's `artifacts/policies.ts` (E2's, which served `maws-deliverable:` the same way until P3-L's cutover): the shared
// headers, the sandboxing policy, byte ranges, the bridge script in an `html` artifact's page (an asset, and a `file`
// artifact's HTML, are served byte for byte). Its answers also carry `Access-Control-Allow-Origin: *`, since a font is a
// CORS load and a design system's faces load from the app's page; what may load from the scheme at all is the app's
// CSP's and each frame's own policy's to say.
//
// P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C, §D): the resolver and the responder
// chain moved here from main's `protocol.ts`, with no Electron, so `mawsd`'s artifact endpoint
// (src/mawsd/artifacts-endpoint.ts) serves the answers the embedded root's `protocol.handle` serves (src/render/scheme.ts),
// and the scheme proxy asks the presenter's embeds first through the same chain.
import { parseArtifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { createSchemeHandler, type SchemeResolver } from './scheme-handler';

export type ContentLookup = (input: CommandInput<'artifacts.content'>) => Promise<CommandResult<'artifacts.content'>>;
export type SchemeHandler = (request: Request) => Promise<Response>;

// The artifact store's resolver: the file the host names for the URL's artifact, revision and path, or nothing (no such
// artifact, revision or file; the host away). A URL that is not exactly the scheme's shape names nothing, and the host
// is not asked.
export function artifactResolver(content: ContentLookup): SchemeResolver {
  return async (url) => {
    const target = parseArtifactUrl(url);
    if (!target) return null;
    const answer = await content({ artifactId: target.artifactId, path: target.path, ...(target.revision !== 'live' && { revision: target.revision }) });
    if (!answer.ok) return null;
    return { path: answer.value.path, name: answer.value.name, bridge: answer.value.kind === 'html' && !target.path.startsWith('assets/') };
  };
}

// P3-C M6: a responder asked first, answering the URLs that are its own and null ("not mine") for the rest (the
// presenter's live embeds, src/main/presentations/present-embeds.ts, which answer under the embed's own policy). A
// responder that fails is logged and answered 500, never taken for "not mine" (fix wave 1).
export type SchemeResponder = (request: Request) => Promise<Response | null>;

// `rest` behind `first`, when there is one. P5 O5 M2: `rest` is the store's files here, the artifact endpoint's answers
// through the scheme proxy (src/render/scheme.ts).
export function answerFirst(first: SchemeResponder | undefined, rest: SchemeHandler): SchemeHandler {
  if (!first) return rest;
  return async (request) => {
    let answer: Response | null;
    try {
      answer = await first(request);
    } catch (error) {
      console.warn(`[artifacts] ${request.url} failed: ${error instanceof Error ? error.message : String(error)}`);
      return new Response('the request failed', { status: 500, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
    return answer ?? rest(request);
  };
}

export function createArtifactHandler(content: ContentLookup, first?: SchemeResponder): SchemeHandler {
  return answerFirst(first, createSchemeHandler(artifactResolver(content), { cors: true }));
}
