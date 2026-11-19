// The `file:` form of a link (UX wave U6b-4b, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R1 and
// Interfaces §A): one reading, shared by the window (`remarkTranscriptSources`, which draws the path link) and the rule of
// a file the transcript names (`clickPath` in ./named.ts), so the two cannot drift. A `file:` URL whose host is empty
// names exactly the path a scheme-less destination names; every other `file:` form names nothing. The scheme is matched
// in any letter case, as the window's gate lower-cases a scheme before it compares; the rest is taken byte for byte,
// with no URL parser of its own. Imports nothing: the desk's web app loads the Markdown pipeline that reads it.

const EMPTY_HOST = /^file:\/\/(?=\/)/i;

/** What follows `file://` in a `file:` URL whose host is empty: a string that begins with `/`. Null for every other string. */
export function fileUrlRest(url: string): string | null {
  return EMPTY_HOST.test(url) ? url.slice(7) : null;
}
