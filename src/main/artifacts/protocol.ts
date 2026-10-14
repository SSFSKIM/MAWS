// The `maws-artifact:` scheme (docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 14 and 35e; ledger §1): the
// artifact store's byte-kind content and every artifact's assets, served to frames, images, fonts and media in the app
// and to the capture and export windows. `maws-artifact://<artifactId>/<revision | 'live'>/<path>`; main resolves a URL
// by asking the engine host (`artifacts.content`), never by opening the host's database or building a path from the
// URL, so it serves exactly the store's files. The serving is `./scheme-handler.ts` and the frame policies
// `./policies.ts` (E2's, which served `maws-deliverable:` the same way until P3-L's cutover): the shared headers, the
// sandboxing policy, byte ranges, the bridge script in an `html` artifact's page (an asset, and a `file` artifact's
// HTML, are served byte for byte). Its answers also carry `Access-Control-Allow-Origin: *`, since a font is a CORS load
// and a design system's faces load from the app's page; what may load from the scheme at all is the app's CSP's and
// each frame's own policy's to say.
import { protocol, type Session } from 'electron';
import { ARTIFACT_SCHEME, parseArtifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { createSchemeHandler, STORE_SCHEME_PRIVILEGES, type SchemeResolver } from './scheme-handler';

// Before `app.whenReady()`, once (Electron takes one call): the store's scheme (standard, secure, streamed, no fetch),
// CORS-enabled for its fonts. P3-L's cutover registers `maws-deliverable:` no more.
export function registerStoreSchemes(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ARTIFACT_SCHEME, privileges: { ...STORE_SCHEME_PRIVILEGES, corsEnabled: true } }]);
}

export type ContentLookup = (input: CommandInput<'artifacts.content'>) => Promise<CommandResult<'artifacts.content'>>;

// The artifact store's resolver: the file the host names for the URL's artifact, revision and path, or nothing (no such
// artifact, revision or file; the host away).
export function artifactResolver(content: ContentLookup): SchemeResolver {
  return async (url) => {
    const target = parseArtifactUrl(url);
    if (!target) return null;
    const answer = await content({ artifactId: target.artifactId, path: target.path, ...(target.revision !== 'live' && { revision: target.revision }) });
    if (!answer.ok) return null;
    return { path: answer.value.path, name: answer.value.name, bridge: answer.value.kind === 'html' && !target.path.startsWith('assets/') };
  };
}

export function createArtifactHandler(content: ContentLookup): (request: Request) => Promise<Response> {
  return createSchemeHandler(artifactResolver(content), { cors: true });
}

// The handler on a session: the window's default session and the capture partition get the same one.
export function serveArtifacts(session: Session, content: ContentLookup): void {
  session.protocol.handle(ARTIFACT_SCHEME, createArtifactHandler(content));
}
