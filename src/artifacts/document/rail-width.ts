// P4-B1: P3-F1's threshold, moved out of editor/rail-layout.ts (a React hook, which re-exports it) so the margin's pure
// tiers (src/artifacts/comments/margin-tiers.ts) read the same number without reaching for React or the DOM.

/** The body width from which the rail sits beside the page (the P3-E inspector's threshold, the architect's ruling). */
export const RAIL_BESIDE_FROM_PX = 720;
