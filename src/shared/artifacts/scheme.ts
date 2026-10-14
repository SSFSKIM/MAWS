// The `maws-artifact:` scheme's URLs (docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 14 and 35e; ledger
// §1): `maws-artifact://<artifactId>/<revision | 'live'>/<path>`, where the path is a byte kind's content file (its
// name, e.g. `index.html`) or one of the artifact's assets (`assets/<name>`). Main's handler resolves a URL by asking the
// engine host (`artifacts.content`), never by building a file path from it; the parse below refuses anything that is
// not exactly that shape (a dot segment, an empty or encoded-slash segment), so no URL can name a file outside them.

export const ARTIFACT_SCHEME = 'maws-artifact';

export type ArtifactUrlRevision = number | 'live';

export interface ArtifactUrlTarget {
  artifactId: string;
  revision: ArtifactUrlRevision;
  path: string; // decoded, `/`-separated
}

export const ARTIFACT_URL_PATH_MAX = 1_000; // `artifacts.content`'s bound on a path

// A URL the scheme serves: each path segment URI-encoded.
export function artifactUrl(artifactId: string, revision: ArtifactUrlRevision, path: string): string {
  return `${ARTIFACT_SCHEME}://${artifactId}/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ARTIFACT_URL = /^maws-artifact:\/\/([^/?#]+)\/(live|0|[1-9][0-9]*)\/([^?#]+)(?:[?#].*)?$/;

// What a URL names, or null for anything that is not exactly that shape. A query or a fragment (a page that moved within
// itself) still names its file.
export function parseArtifactUrl(url: string): ArtifactUrlTarget | null {
  const match = ARTIFACT_URL.exec(url);
  if (!match) return null;
  const artifactId = match[1]!.toLowerCase(); // a standard scheme's host: Chromium lowercases it
  if (!UUID.test(artifactId)) return null;
  const revision = match[2] === 'live' ? 'live' : Number(match[2]);
  if (revision !== 'live' && !Number.isSafeInteger(revision)) return null;
  const segments: string[] = [];
  for (const raw of match[3]!.split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[/\\\0]/.test(segment)) return null;
    segments.push(segment);
  }
  const path = segments.join('/');
  return path.length > ARTIFACT_URL_PATH_MAX ? null : { artifactId, revision, path };
}
