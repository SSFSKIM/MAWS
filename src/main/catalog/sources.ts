// The Discover catalog's sources (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Sources"); M2
// implements this module. M1 fixes the name of its one test seam (Sources, 3a): when this environment variable names a
// JSON file, each descriptor in it, `{key, label, ownership: 'added', marketplaceName, marketplaceSource, manifestPath}`,
// is one more source (the e2e launch writes it for the local test marketplace).
export const CATALOG_TEST_SOURCES_ENV = 'MAWS_CATALOG_TEST_SOURCES';
