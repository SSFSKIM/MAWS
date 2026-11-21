// The context popover's words that the word cut touched (docs/doperpowers/specs/2026-11-16-word-cut-design.md, C46 and
// C49), kept here as the spec's build constraint asks.
export const CONTEXT_POPOVER = {
  figures: (used: string, max: string, threshold: string | null) => `${used} of ${max}${threshold === null ? '' : ` · compacts at ${threshold}`}`,
  // not drawn at rest: the figures line's tooltip and description
  usedOnPointing: (percentage: string, left: string | null) => `${percentage}% used${left === null ? '' : ` · ${left} until compaction`}`,
  compact: 'Compact',
};
