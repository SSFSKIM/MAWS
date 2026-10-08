// After this long asked with the turn clause shown, a relay's line reads the long-wait clause instead: the session
// reaches no tool boundary while one call runs. Shared by the drill-in's relay (tools/agents) and the transcript's peer
// composer, so neither imports the other's module for it (W-D review m3).
export const RELAY_LONG_WAIT_MS = 30_000;
