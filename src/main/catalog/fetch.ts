// The Discover catalog's network fetches (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Fetching"); M2 implements this module. M1 fixes the name of its one test seam: when this environment variable names a
// directory, each source is read from `<dir>/<source-key>.json` instead of the network (`e2e/fixtures/catalog/`, recorded
// by scripts/catalog-fixtures.mjs as `{key, recordedAt, pages}`), a missing file being that source failing.
export const CATALOG_FIXTURES_ENV = 'MAWS_CATALOG_FIXTURES';
