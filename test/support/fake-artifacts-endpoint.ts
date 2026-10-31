// An `artifacts.sock` stand-in for the render host's e2e (P5 O5 M3; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// M3 "Touches"): `mawsd`'s artifact endpoint as M2 shaped it, the artifact scheme's handler over HTTP on the profile's
// unix socket (src/services/artifacts/scheme/http.ts's `serveOverHttp`), its files the test's fixtures. The handler is
// the endpoint's own (`createArtifactHandler`: `artifactResolver` under `createSchemeHandler`, the shared headers and
// the bridge script), so a page the render host's scheme proxy loads is answered as the real endpoint answers it; only
// the lookup is the test's, the same one its fake front answers `artifacts.content` with.
import { createServer, type Server } from 'node:http';
import { rmSync } from 'node:fs';
import { createArtifactHandler, type ContentLookup } from '../../src/services/artifacts/scheme/artifact-handler';
import { serveOverHttp } from '../../src/services/artifacts/scheme/http';

export interface FakeArtifactsEndpoint {
  requests: string[]; // every URL asked, in order
  close(): Promise<void>;
}

export async function startFakeArtifactsEndpoint(socketPath: string, content: ContentLookup): Promise<FakeArtifactsEndpoint> {
  const requests: string[] = [];
  const handle = createArtifactHandler(content);
  const server: Server = createServer(
    serveOverHttp((request) => {
      requests.push(request.url);
      return handle(request);
    }),
  );
  rmSync(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  return {
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
