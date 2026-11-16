// The keys a document is stored under (X24; Decision Log 23e, S1's topology): an artifact's own document under its id,
// and its suggestion document, a gc-off doc that holds the main doc and, on top of it, the proposals written to it, under
// the id with this suffix. A module of its own so the storage (the agent-draft mark's upkeep, UX wave U10b) reads the
// pair as the document service does, without the service.
export const SUGGESTION_SUFFIX = ':suggest';
export const suggestionKey = (artifactId: string): string => `${artifactId}${SUGGESTION_SUFFIX}`;
// The main doc a key is the suggestion doc of, or null for a main doc's key.
export const mainOf = (key: string): string | null => (key.endsWith(SUGGESTION_SUFFIX) ? key.slice(0, -SUGGESTION_SUFFIX.length) : null);
