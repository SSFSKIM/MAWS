// P4-B5: the words of the Send to sheet and its header action (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7).
// What the owner reads is what happens: MAWS sends the artifact itself, with no session and no Claude turn; Notion goes
// through MAWS's own connection, Drive through the gws command-line tool, which keeps its own Google sign-in.
import type { DeliveryFailure, NotionStatus } from '@shared/ipc/schema/delivery';
import type { DeliveryTarget } from '@shared/delivery/destination';

export const SERVICE: Record<DeliveryTarget, string> = { notion: 'Notion', drive: 'Google Drive' };

export const GWS_INSTALL = 'npm install -g @googleworkspace/cli';
export const GWS_SETUP = 'gws auth setup --login';

const scopeWords = (scope: 'user' | 'local') => (scope === 'user' ? 'your user settings' : 'this project’s local settings');

export const SEND_TO_COPY = {
  item: (service: string) => `Send to ${service}…`, // the library's Export menu
  action: 'Send to…',
  actionSending: (target: DeliveryTarget) => `Sending to ${SERVICE[target]}…`,
  actionSent: (target: DeliveryTarget) => `Sent to ${SERVICE[target]}`,
  title: (title: string) => `Send “${title}”`,
  target: 'Send to',
  direct: 'MAWS sends it itself: no session, no Claude turn.',
  asPage: 'As a Notion page, its headings, lists and tables kept.',
  format: 'Format',
  where: 'Where',
  notionDefault: 'A private page in your workspace',
  driveDefault: 'My Drive',
  notionInside: 'Inside a page',
  driveInside: 'Inside a folder',
  notionInsidePlaceholder: 'Paste the page’s link',
  driveInsidePlaceholder: 'Paste the folder’s link',
  notionInsideInvalid: 'That isn’t a Notion page’s link.',
  driveInsideInvalid: 'That isn’t a Drive folder’s link.',
  send: 'Send',
  sendAgain: 'Send again',
  done: 'Done',
  close: 'Close',
  cancel: 'Cancel',
  checkAgain: 'Check again',
  open: (target: DeliveryTarget) => `Open in ${SERVICE[target]}`,
  sent: (target: DeliveryTarget, name: string) => `Sent to ${SERVICE[target]} as “${name}”.`,
  lastSent: (target: DeliveryTarget, ago: string) => `Last sent to ${SERVICE[target]} · ${ago}`,
  sending: (target: DeliveryTarget) => `Exporting and sending to ${SERVICE[target]}…`,
  checking: { notion: 'Looking for your Notion connector…', drive: 'Checking the gws command-line tool…' } satisfies Record<DeliveryTarget, string>,
  // Notion's connection
  notionReady: (source: Extract<NotionStatus, { state: 'ready' }>['source'], connection: 'connected' | 'local' | 'open') =>
    connection === 'connected' ? `Connected through MAWS: “${source.server}” in ${scopeWords(source.scope)}.` : `Through MAWS’s own connection: “${source.server}” in ${scopeWords(source.scope)}.`,
  notionSignIn: (server: string) => `MAWS needs your go-ahead to reach “${server}” once. Connect opens Notion in your browser; MAWS keeps its own sign-in.`,
  notionReconnect: (server: string) => `MAWS’s sign-in to “${server}” needs renewing.`,
  notionBusy: 'A Notion sign-in is under way. Finish it in your browser, then check again.',
  notionNoSession: 'MAWS finds your Notion connector through a running session. Open or start any session, then check again.',
  notionNotFound: 'None of your running sessions has a Notion connector MAWS can reach itself. Add Notion’s MCP server (https://mcp.notion.com/mcp) to your Claude Code user settings, start a session, then check again.',
  notionUnavailable: 'MAWS’s own connection isn’t available right now.',
  connect: 'Connect Notion',
  reconnect: 'Reconnect',
  connecting: 'Finish connecting in your browser…',
  // gws's state
  driveReady: (user: string | undefined) => (user ? `Signed in to Google as ${user} through gws.` : 'Signed in to Google through gws.'),
  driveAbsent: 'MAWS sends to Google Drive with Google’s gws command-line tool, which isn’t installed. Install it, then check again.',
  driveNeedsSetup: 'gws needs a Google Cloud OAuth client before it can sign in. Its own setup walks you through it in a terminal; then check again.',
  driveSignedOut: 'gws isn’t signed in to Google. Sign in opens Google in your browser; gws keeps the sign-in, MAWS stores nothing.',
  driveExpired: 'gws’s Google sign-in has expired. Sign in again; gws keeps the new one.',
  driveNoDrive: 'gws is signed in without access to Drive. Sign in again to add it.',
  driveFailed: (message: string | undefined) => `gws’s state couldn’t be read${message ? `: ${message}` : '.'}`,
  installInTerminal: 'Install in Terminal',
  setupInTerminal: 'Set up in Terminal',
  signIn: 'Sign in with Google',
  signInAgain: 'Sign in again',
  signingIn: 'Finish signing in in your browser. If you declined, cancel here.',
};

// Why a sign-in ended without one.
export const CONNECT_FAILURE: Record<string, string> = {
  cancelled: 'The sign-in was cancelled.',
  timeout: 'The sign-in didn’t finish in time.',
  refused: 'The sign-in was refused.',
  denied: 'The sign-in was declined in the browser.',
  busy: 'Another sign-in is under way.',
  absent: 'gws isn’t installed.',
  needsSetup: 'gws needs its setup first.',
  none: 'No Notion connector was found.',
  unavailable: 'MAWS’s own connection isn’t available right now.',
  failed: 'The sign-in failed.',
};

// Why a send ended without a delivery; `maybeSent` adds that the service may have it.
export const SEND_FAILURE: Record<DeliveryFailure, string> = {
  cancelled: 'Cancelled before anything was sent.',
  busy: 'This artifact is already being sent there.',
  export: 'The export failed',
  deleted: 'The artifact was deleted.',
  tooLarge: 'The artifact is too large to send as one page.',
  none: 'No Notion connector was found.',
  signIn: 'Notion needs you to connect MAWS first.',
  reconnect: 'MAWS’s Notion sign-in needs renewing.',
  unauthorized: 'Notion refused MAWS’s sign-in. Connect again.',
  source: 'Your Notion connector changed since it was found. Check again.',
  toolMissing: 'This Notion connector can’t make pages.',
  toolError: 'Notion refused the page',
  timeout: 'Notion didn’t answer in time.',
  transport: 'The exchange with Notion broke off.',
  unavailable: 'Notion couldn’t be reached.',
  absent: 'gws isn’t installed.',
  needsSetup: 'gws needs its setup first.',
  auth: 'gws isn’t signed in to Google. Sign in again.',
  notFound: 'That folder wasn’t found in your Drive.',
  forbidden: 'Google refused the upload.',
  api: 'Google refused the upload',
  discovery: 'gws couldn’t reach Google.',
  invalid: 'gws refused the request',
  failed: 'The send failed.',
};
export const MAYBE_SENT = (target: DeliveryTarget) => `${SERVICE[target]} may have received it: check there before sending again.`;
