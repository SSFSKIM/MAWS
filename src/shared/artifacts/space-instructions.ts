// A Space's instructions for agents (UX wave U10b, l8-settings-13; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md,
// §E.1): owner-written text that agents working in the Space are given. It is held beside the Space and not in it
// (`SpaceSchema` stays as it is, so builds that cross a process or the link never meet a new field); this is its bound.
export const SPACE_INSTRUCTIONS_MAX = 8000; // characters
