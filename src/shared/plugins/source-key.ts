// What a marketplace entry's source names (P2-B execution document §5.4, §5.8): the key Browse folds two listings of the
// same plugin by, and the test for Anthropic's default marketplace. Pure and zod-free: the renderer imports it.
//
// The key is the engine's own (2.1.292 `Sb` and `Gze`, cli.pretty.js:832348-832470; U3 F5): a repository, spelled
// `owner/repo` (GitHub), `git@host:path` or `https://host/path`, reduced to `host/path` (the host lowercased, `www.`
// dropped on GitHub, the path lowercased on GitHub only, repeated and trailing slashes and `.git` dropped), then `#` and
// the entry's path inside it with `.` segments dropped and `..` applied (no key when it climbs out). A relative entry
// (`./plugins/x`) is resolved against its marketplace's repository (a `github` or `git` marketplace; a folder one has
// none). Anything else has no key, and no key never folds.
import type { PluginSourceRef } from '../ipc/schema/plugins';

const GITHUB = 'github.com';
const SEGMENT = '[A-Za-z0-9._-]+';
const SHORTHAND = new RegExp(`^${SEGMENT}/${SEGMENT}$`);
const SCP = new RegExp(`^git@([A-Za-z0-9.-]+):(${SEGMENT}(?:/${SEGMENT})*)/?$`);
const HTTPS = /^https:\/\/(?:[A-Za-z0-9._~-]+(?::[A-Za-z0-9._~-]*)?@)?([A-Za-z0-9.-]+)(:[1-9][0-9]{0,4})?(\/[^?#]*)?$/;

// `host/path` for a repository locator, or null when it names none.
function repositoryOf(locator: string): string | null {
  const trimmed = locator.trim();
  let host: string;
  let port = '';
  let path: string;
  const scp = SCP.exec(trimmed);
  const https = HTTPS.exec(trimmed);
  if (SHORTHAND.test(trimmed)) [host, path] = [GITHUB, `/${trimmed}`];
  else if (scp) [host, path] = [scp[1], `/${scp[2]}`];
  else if (https) [host, port, path] = [https[1], https[2] ?? '', https[3] ?? '/'];
  else return null;
  host = host.toLowerCase().replace(/\.$/, '');
  if (host === `www.${GITHUB}`) host = GITHUB;
  if (path.split('/').some((segment) => /^\.{1,2}$/.test(segment))) return null;
  const folded = host === GITHUB && port === '' ? path.toLowerCase() : path;
  const reduced = folded.replace(/\/{2,}/g, '/').replace(/\/+$/, '').replace(/\/?\.git$/i, '');
  return `${host}${port}${reduced}`;
}

// The path inside the repository, `.` dropped and `..` applied; null when it climbs out.
function subpathOf(path: string | null): string | null {
  const segments: string[] = [];
  for (const segment of (path ?? '').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') segments.push(segment);
    else if (segments.pop() === undefined) return null;
  }
  return segments.join('/');
}

function keyOf(locator: string | null, path: string | null): string | null {
  if (locator === null) return null;
  const repository = repositoryOf(locator);
  const subpath = subpathOf(path);
  return repository === null || subpath === null ? null : `${repository}#${subpath}`;
}

export function sourceKey(source: PluginSourceRef | null, marketplace: { source: string; locator: string | null } | null): string | null {
  if (source === null) return null;
  if (typeof source === 'string') {
    if (marketplace === null || (marketplace.source !== 'github' && marketplace.source !== 'git')) return null;
    return keyOf(marketplace.locator, source);
  }
  switch (source.kind) {
    case 'github':
      return keyOf(source.repo, source.path);
    case 'url':
    case 'git-subdir':
      return keyOf(source.url, source.path);
    default:
      return null;
  }
}

// Desktop's rule (readable/app-2.16120.0/main-process/index.chunk-kXuYPTnM.js:163839-163854 `G2t`/`EE`, :348250
// `isDefaultMarketplaceSource`): the locator, trimmed, trailing slashes and `.git` dropped and lowercased, is the default
// repository or its GitHub URL.
const DEFAULT_REPOSITORY = 'anthropics/claude-plugins-official';
export function isAnthropicDefaultMarketplace(marketplace: { source: string; locator: string | null }): boolean {
  if (marketplace.locator === null) return false;
  const reduced = marketplace.locator.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
  return reduced === DEFAULT_REPOSITORY || reduced === `https://${GITHUB}/${DEFAULT_REPOSITORY}`;
}
