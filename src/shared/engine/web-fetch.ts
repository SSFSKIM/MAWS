// UX wave U3b (ticket 146; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, M5,
// decision 18, Interfaces §F): whether a call is a web fetch, asked in one place. The engine's own `WebFetch` and the
// web plugin's `mcp__web__fetch` (Engine facts 11: its input is `{ url }` or `{ url, prompt }`, its result a string)
// fetch a page alike, so every reader that draws, groups, captions, digests or allows a fetch asks here, and none
// compares a tool's name itself.
export const WEB_FETCH_TOOLS = ['WebFetch', 'mcp__web__fetch'] as const;

const WEB_FETCH = new Set<string>(WEB_FETCH_TOOLS);

export function isWebFetch(toolName: string): boolean {
  return WEB_FETCH.has(toolName);
}

/** The page a web fetch asked for, or null. */
export function webFetchUrl(input: unknown): string | null {
  const url = input !== null && typeof input === 'object' ? (input as { url?: unknown }).url : undefined;
  return typeof url === 'string' ? url : null;
}
