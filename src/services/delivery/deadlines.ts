// Delivery's bounds the spine's command budgets sum (../command-budgets.ts, P5 O4 Interfaces §H), defined here so the
// table reads them without loading the service or the gws driver (acceptance 9). ./index.ts and ./gws.ts re-export them.

export const DELIVERY_STATUS_DEADLINE_MS = 30_000; // the sheet's read of a target
export const GWS_STATUS_TIMEOUT_MS = 30_000; // `auth status` refreshes the token and may ask gcloud for the project's APIs
export const GWS_LOGIN_DEADLINE_MS = 5 * 60_000; // a refused consent never ends the 0.22.5 login on its own
export const GWS_UPLOAD_TIMEOUT_MS = 10 * 60_000;
export const KILL_GRACE_MS = 2_000; // SIGTERM to SIGKILL
export const GONE_WAIT_MS = 3_000; // after SIGKILL, for the group to leave the process table
