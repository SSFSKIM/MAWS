// What a marketplace entry's source names (P2-B execution document §5.4, §5.8): the key Browse folds two listings of the
// same plugin by, and the test for Anthropic's default marketplace. Pure and zod-free: the renderer imports it.
//
// The key is the engine's own (2.1.292 `Sb`, `W` and `Gze`, cli.pretty.js:832348-832470; U3 F5): a repository, spelled
// `owner/repo` (GitHub), `git@host:path` or `https://[user@]host[:port]/path`, read as a URL reads it (so `:443` is no
// port), then reduced to `host[:port]/path`: the host lowercased, `www.` and `ssh.` dropped on GitHub (an `https`
// spelling of `ssh.github.com` is refused), unreserved percent escapes decoded (any other escape refused), the path
// lowercased on GitHub without a port only, repeated and trailing slashes and `.git` dropped; then `#` and the entry's
// path inside it with `.` segments dropped and `..` applied (no key when it climbs out, or holds a backslash). A
// relative entry (`./plugins/x`) is resolved against its marketplace's repository (a `github` or `git` marketplace; a
// folder one has none), and has no key when that marketplace is pinned to a branch or tag. A source pinned to a branch
// or tag (`ref`) has no key, whatever the ref looks like: the engine excepts only a full commit sha given separately
// (`sha`), and the host reduces a ref such a sha pins beside it to none (`cli-result.ts`). Anything else has no key,
// and no key never folds.
import type { PluginSourceRef } from '../ipc/schema/plugins';

const GITHUB = 'github.com';
const SEGMENT = '[A-Za-z0-9._-]+';
const HOST = '[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*\\.?';
const UNRESERVED = '[A-Za-z0-9._~-]';
const SHORTHAND = new RegExp(`^${SEGMENT}/${SEGMENT}$`);
const SCP = new RegExp(`^git@(${HOST}):(${SEGMENT}(?:/${SEGMENT})*)/?$`);
const HTTPS = new RegExp(`^https://(?:${UNRESERVED}+(?::${UNRESERVED}*)?@)?(${HOST})(?::[1-9][0-9]{0,4})?((?:/(?:${UNRESERVED}|%[0-9A-Fa-f]{2})*)*)$`);

// `host[:port]/path` for a repository locator, or null when it names none.
function repositoryOf(locator: string): string | null {
  const shorthand = SHORTHAND.test(locator);
  const scp = SCP.exec(locator);
  const https = HTTPS.exec(locator);
  const host = shorthand ? GITHUB : (scp?.[1] ?? https?.[1]);
  if (host === undefined) return null;
  const lowered = host.toLowerCase().replace(/\.$/, '');
  if (host.endsWith('.') && lowered !== GITHUB && lowered !== `www.${GITHUB}`) return null;
  const path = shorthand ? `/${locator}` : scp ? `/${scp[2]}` : https?.[2] || '/';
  if (path.split('/').some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment) || (shorthand && /^\.git$/i.test(segment)))) return null;
  let url: URL;
  try {
    url = new URL(https ? locator : `https://${host}${path}`);
  } catch {
    return null;
  }
  if (url.hostname !== host.toLowerCase() || url.pathname !== path) return null;
  const hostname = url.hostname.replace(/\.$/, '');
  if (hostname === `ssh.${GITHUB}` && scp === null) return null;
  const site = hostname === `www.${GITHUB}` || hostname === `ssh.${GITHUB}` ? GITHUB : hostname;
  const decoded = url.pathname.replace(/%([0-9a-f]{2})/gi, (escape, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return /^[A-Za-z0-9._~-]$/.test(ch) ? ch : escape;
  });
  if (decoded.includes('%')) return null;
  const folded = site === GITHUB && url.port === '' ? decoded.toLowerCase() : decoded;
  return `${site}${url.port === '' ? '' : `:${url.port}`}${folded.replace(/\/{2,}/g, '/').replace(/\/+$/, '').replace(/\/?\.git$/, '')}`;
}

// The path inside the repository, `.` dropped and `..` applied; null when it climbs out.
function subpathOf(path: string | null): string | null {
  if (path?.includes('\\')) return null;
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

export function sourceKey(source: PluginSourceRef | null, marketplace: { source: string; locator: string | null; ref?: string | null } | null): string | null {
  if (source === null) return null;
  if (typeof source === 'string') {
    if (marketplace === null || (marketplace.source !== 'github' && marketplace.source !== 'git')) return null;
    if (typeof marketplace.ref === 'string') return null; // the marketplace is pinned to a branch or tag
    return keyOf(marketplace.locator, source);
  }
  if (typeof source.ref === 'string') return null; // pinned to a branch or tag
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
