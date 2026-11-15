// A Space's instructions in the artifact store (UX wave U10b, M9; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md,
// §E.1 and §G): one key of the `meta` table holds every Space's, as `{ [spaceId]: { text, at } }`. Not a column and not a
// migration: an older build never reads the key, so its store stays writable (`user_version` stays 4), a Space renamed
// there keeps its text, and a Space deleted there leaves an entry that the next write here drops. `at` stamps the text,
// so a session given the text knows when it changed (M10).
export const SPACE_INSTRUCTIONS_KEY = 'spaceInstructions';

export interface SpaceInstructions {
  text: string;
  at: number;
}
export type SpaceInstructionsTable = Record<string, SpaceInstructions>;

// The stored table; an absent key is no instructions.
export function readInstructions(raw: string | null): SpaceInstructionsTable {
  return raw === null ? {} : (JSON.parse(raw) as SpaceInstructionsTable);
}

// The table after one Space's text is set at `now`, keeping only the Spaces that still exist. An empty text removes the
// Space's entry; the same text keeps its stamp; a changed one is stamped after the one it replaces, even within one
// millisecond, so its stamp always differs.
export function withInstructions(table: SpaceInstructionsTable, spaceId: string, text: string, now: number, exists: (spaceId: string) => boolean): SpaceInstructionsTable {
  const next: SpaceInstructionsTable = {};
  for (const [id, entry] of Object.entries(table)) if (id !== spaceId && exists(id)) next[id] = entry;
  const before = table[spaceId];
  if (text !== '') next[spaceId] = before?.text === text ? before : { text, at: Math.max(now, (before?.at ?? -1) + 1) };
  return next;
}
