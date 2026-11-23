// The command palette's words (CommandPalette.tsx).
// U6b-5a M4: the words of its new groups and its last row (the execution document, "The sentences a person reads").
// The word cut (W113, W116 to W119): the input's placeholder, the search's wait (the quiet spinner's name) and the lines
// above the results, each in its shortest plain form; the empty word, said only for an answered query.
export const PALETTE = {
  placeholder: 'Search',
  placeholderConversations: 'Search in conversations',
  searching: 'Searching conversations',
  indexing: 'Indexing…',
  incomplete: 'Some conversations are not indexed; results may be incomplete.',
  firstShown: (limit: number) => `First ${limit} shown`,
  nothing: 'Nothing matches',
  recent: 'Recent',
  artifacts: 'Artifacts',
  artifactsOn: (machine: string) => `Artifacts · ${machine}`,
  searchLibrary: (text: string) => `Search the Library for “${text}”`,
} as const;
