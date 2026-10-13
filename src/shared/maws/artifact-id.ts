// E2's artifact id (P1 X9): the short name an agent gives an artifact, unique among its session's (P3-A Decision Log 3:
// kept as the artifact's handle; a host UUID matches it too, so one pattern names an artifact either way). A leaf module,
// so the artifact entity's schemas (`@shared/artifacts/entity`) and the tools' (`./tools`) both import it without a cycle.
export const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
