// The connectors' bounds the spine's command budgets sum (../command-budgets.ts, P5 O4 Interfaces §H), defined here so
// the table reads them without loading the services that run them (acceptance 9). Each module that runs one re-exports
// it beside its use.

// Route D: the host's own bounds, 8 s to resolve and 180 s for a call or discovery from its start; main takes or
// withdraws at these, so no lost event leaves a caller waiting (./direct-route.ts).
export const DIRECT_RESOLVE_DEADLINE_MS = 8_000;
export const DIRECT_OPERATION_DEADLINE_MS = 180_000;
// MAWS's own OAuth: the owner's consent to its callback (./oauth-flow.ts), one bounded request (./oauth-http.ts), and
// the host's acknowledgment of a credential close, past which it counts as unconfirmed (./oauth-provider.ts).
export const CONNECT_CALLBACK_TIMEOUT_MS = 120_000;
export const OAUTH_REQUEST_TIMEOUT_MS = 15_000;
export const OAUTH_HOST_CLOSE_TIMEOUT_MS = 10_000;
// The owner's rows: a query answers with what it has at this deadline (./owner.ts).
export const OWNER_QUERY_DEADLINE_MS = 15_000;
