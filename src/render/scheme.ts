// The `maws-artifact:` scheme on an Electron process's sessions (P5 O5 M2; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// Interfaces §C, §D): the Electron half of the scheme, whose answers are the plain-Node library's
// (src/services/artifacts/scheme/). Its privileges are registered once before `ready` (the entry's shared bootstrap); a
// session then answers the scheme one of two ways:
// - the store's files, resolved through the engine host's `artifacts.content` in this process (`serveArtifacts`): the
//   embedded root's handler, and the daemon shape's while its daemon serves no artifact endpoint;
// - the scheme proxy (`fetchOverSocket`): each request's URL, method and `Range` to `mawsd`'s artifact endpoint on
//   `artifacts.sock`, its answer streamed back as received, 503 in one line when nothing answers there. The daemon
//   shape's app proxies while its daemon's welcome lists `machine.artifacts` (`serveArtifacts`' `endpoint`, read per
//   request, so the app follows the daemon it is attached to); the render host proxies alone (`serveArtifactsThrough`,
//   M3). Chromium never sees the socket: the scheme keeps its privileges, and each artifact its own origin.
// The presenter's live embeds answer first in the app either way (`first`), since they are the app's own.
// P5 O7 M5b (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5's "The `http` stream"): the app's `first` is a
// chain (`inOrder`): the presenter's embeds, then the remote responder (src/main/artifacts/remote-scheme.ts: an artifact
// of another machine's session, fetched over its RL2 link), then the local path above; and (`notFound`, b3's review) a
// responder asked only when the local path answers 404 (the remote responder's referrer stage), so this Mac's store
// answers an id before any referrer can take it elsewhere.
import { protocol, type Session } from 'electron';
import { ARTIFACT_SCHEME } from '@shared/artifacts/scheme';
import { answerFirst, artifactResolver, type ContentLookup, type SchemeHandler, type SchemeResponder } from '../services/artifacts/scheme/artifact-handler';
import { fetchOverSocket } from '../services/artifacts/scheme/http';
import { createSchemeHandler, STORE_SCHEME_PRIVILEGES } from '../services/artifacts/scheme/scheme-handler';

export type { ContentLookup, SchemeResponder };

export interface ArtifactEndpoint {
  socketPath: string; // mawsd's artifacts.sock
}

// Before `app.whenReady()`, once (Electron takes one call): the store's scheme (standard, secure, streamed, no fetch),
// CORS-enabled for its fonts. P3-L's cutover registers `maws-deliverable:` no more.
export function registerStoreSchemes(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ARTIFACT_SCHEME, privileges: { ...STORE_SCHEME_PRIVILEGES, corsEnabled: true } }]);
}

// The store's files through `content`, behind `first` (P3-C M6); a request made while `endpoint` names an artifact
// endpoint goes through the scheme proxy to it instead.
// P5 O7 M5b: `notFound`, asked only when the local path answers 404; its answer, when it has one, stands in its place.
export function artifactSchemeHandler(content: ContentLookup, first?: SchemeResponder, endpoint: () => ArtifactEndpoint | null = () => null, notFound?: SchemeResponder): SchemeHandler {
  const files = createSchemeHandler(artifactResolver(content), { cors: true });
  const local: SchemeHandler = (request) => {
    const at = endpoint();
    return at === null ? files(request) : fetchOverSocket(at.socketPath, request);
  };
  return answerFirst(first, notFound === undefined ? local : async (request) => {
    const answer = await local(request);
    if (answer.status !== 404) return answer;
    const instead = await notFound(request);
    if (instead === null) return answer;
    await answer.body?.cancel().catch(() => {});
    return instead;
  });
}

// P5 O7 M5b: responders asked in turn, the first answer taken; none answering is null ("not mine"), the next path's.
export function inOrder(...responders: ReadonlyArray<SchemeResponder | undefined>): SchemeResponder {
  return async (request) => {
    for (const responder of responders) {
      const answer = await responder?.(request);
      if (answer) return answer;
    }
    return null;
  };
}

// The handler on a session: the window's default session and the capture partition get the same one.
export function serveArtifacts(session: Session, content: ContentLookup, first?: SchemeResponder /* P3-C M6 */, endpoint?: () => ArtifactEndpoint | null /* P5 O5 M2 */, notFound?: SchemeResponder /* P5 O7 M5b */): void {
  session.protocol.handle(ARTIFACT_SCHEME, artifactSchemeHandler(content, first, endpoint, notFound));
}

// The scheme proxy alone, for a process that serves no store of its own (the render host).
export function serveArtifactsThrough(session: Session, endpoint: ArtifactEndpoint, first?: SchemeResponder): void {
  session.protocol.handle(ARTIFACT_SCHEME, answerFirst(first, (request) => fetchOverSocket(endpoint.socketPath, request)));
}
