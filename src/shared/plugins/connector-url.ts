// A connector's URL against Anthropic's directory (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Adding"; M4 fix wave). Shared by the connector sheet (an instance URL held to the record's url_regex) and main's catalog
// (a configured server's sign-in posture, matched by its endpoint, never by its name).
// - A url_regex is tested as the directory writes it (RegExp.test): of the live walk's 52 patterns (2026-10-25, 1,011
//   records) all start with `^`, 35 also end with `$`, the rest are prefixes such as `…snowflakecomputing\.com(/|$)`; all
//   compile as JavaScript patterns without flags. One without `^` is anchored at the start. One JavaScript cannot read is
//   `unreadable`, which no caller treats as a pass.
// - An endpoint is compared by origin and path, a trailing slash aside; a query (which may carry a token) and a fragment
//   are not part of it.

export type PatternCheck = 'match' | 'no_match' | 'unreadable';

export function patternCheck(url: string, pattern: string): PatternCheck {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern.startsWith('^') ? pattern : `^(?:${pattern})`);
  } catch {
    return 'unreadable';
  }
  return regex.test(url) ? 'match' : 'no_match';
}

/** The endpoint a URL names: origin and path, without a trailing slash; null when it is not an http or https URL. */
export function endpointOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

export interface DirectoryEndpoints {
  url: string | null;
  urlPattern: string | null;
  urlOptions: readonly { url: string }[];
}

/** Whether a configured URL is the one a directory record describes: its URL, one of its url_options, or its pattern. */
export function endpointMatches(url: string | null, route: DirectoryEndpoints): boolean {
  const endpoint = url === null ? null : endpointOf(url);
  if (endpoint === null) return false;
  for (const known of [route.url, ...route.urlOptions.map((option) => option.url)]) if (known !== null && endpointOf(known) === endpoint) return true;
  return route.urlPattern !== null && patternCheck(endpoint, route.urlPattern) === 'match';
}
