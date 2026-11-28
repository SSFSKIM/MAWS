// Where the page is (§P; T20): the path alone. `/` is the overview, `/s/<session>` that session's sheet, the session
// decoded once and passed on as it came (C3's service is the boundary that holds it to the engine's id form). No query
// parameter and no fragment does anything, so a link another site makes to the page can open a sheet and nothing more.
export type Place = { at: 'overview' } | { at: 'sheet'; session: string };

export function placeOf(pathname: string): Place {
  if (!pathname.startsWith('/s/')) return { at: 'overview' };
  const segment = pathname.slice('/s/'.length);
  try {
    return { at: 'sheet', session: decodeURIComponent(segment) };
  } catch {
    return { at: 'sheet', session: segment }; // a malformed escape names what it names; the server answers it
  }
}

export const pathOf = (place: Place): string => (place.at === 'overview' ? '/' : `/s/${encodeURIComponent(place.session)}`);
