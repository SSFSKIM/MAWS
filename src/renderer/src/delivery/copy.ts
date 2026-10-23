// P4-B5: the words of the Send to sheet and its header action (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7).
// What the owner reads is what happens: MAWS sends the artifact itself, with no session and no Claude turn; Notion goes
// through MAWS's own connection, Drive through the gws command-line tool, which keeps its own Google sign-in.
import type { DeliveryConnectFailure, DeliveryFailure, NotionSource } from '@shared/ipc/schema/delivery';
import type { DeliveryTarget } from '@shared/delivery/destination';

export const SERVICE: Record<DeliveryTarget, string> = { notion: 'Notion', drive: 'Google Drive' };

export const GWS_INSTALL = 'npm install -g @googleworkspace/cli';
export const GWS_SETUP = 'gws auth setup --login';

const scopeWords = (scope: NotionSource['scope']) => (scope === 'app' ? 'MAWS settings' : scope === 'user' ? 'your user settings' : 'this project’s local settings');
const NOTION_NOT_FOUND = 'Add Notion’s MCP server (https://mcp.notion.com/mcp) in Settings › Engine › MCP servers, then check again. No session is needed.';

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
  checkFailed: { notion: 'MAWS couldn’t look for your Notion connector.', drive: 'MAWS couldn’t check the gws command-line tool.' } satisfies Record<DeliveryTarget, string>, // main didn't answer
  // a send's failure that came after its sheet closed (main had refused the cancel), as a toast
  closedFailure: (title: string, target: DeliveryTarget, words: string) => `Sending “${title}” to ${SERVICE[target]}: ${words}`,
  // Notion's connection
  notionReady: (source: NotionSource, connection: 'connected' | 'local' | 'open') =>
    connection === 'connected' ? `Connected through MAWS: “${source.server}” in ${scopeWords(source.scope)}.` : `Through MAWS’s own connection: “${source.server}” in ${scopeWords(source.scope)}.`,
  notionSignIn: (server: string) => `MAWS needs your go-ahead to reach “${server}” once. Connect opens Notion in your browser; MAWS keeps its own sign-in.`,
  notionReconnect: (server: string) => `MAWS’s sign-in to “${server}” needs renewing.`,
  notionBusy: 'A Notion sign-in is under way. Finish it in your browser, then check again.',
  notionNoSession: NOTION_NOT_FOUND,
  notionNotFound: NOTION_NOT_FOUND,
  notionUnavailable: 'MAWS’s own connection isn’t available right now.',
  connect: 'Connect Notion',
  reconnect: 'Reconnect',
  connecting: 'Finish connecting in your browser…',
  // gws's state
  driveReady: (user: string | undefined) => (user ? `Signed in to Google as ${user} through gws.` : 'Signed in to Google through gws.'),
  driveAbsent: 'MAWS sends to Google Drive with Google’s gws command-line tool, which isn’t installed. Install it, then check again.',
  driveNeedsSetup: 'gws needs a Google Cloud OAuth client before it can sign in. Its own setup walks you through it in a terminal; then check again.',
  // P4-B5 review: MAWS's sign-in is `gws auth login -s drive`, so the new sign-in covers Drive alone, in place of any other
  driveSignedOut: 'gws isn’t signed in to Google. Sign in opens Google in your browser; gws keeps the sign-in, MAWS stores nothing. The new sign-in covers Google Drive; add other services by signing gws in from a terminal.',
  driveExpired: 'gws’s Google sign-in has expired. Signing in again gives gws a new one that covers Google Drive alone, in place of the old; add other services by signing gws in from a terminal. gws keeps the sign-in, MAWS stores nothing.',
  driveNoDrive: 'gws is signed in without access to Drive. Sign in again to add it.',
  driveFailed: (message: string | undefined) => `gws’s state couldn’t be read${message ? `: ${message}` : '.'}`,
  installInTerminal: 'Install in Terminal',
  setupInTerminal: 'Set up in Terminal',
  signIn: 'Sign in with Google',
  signInAgain: 'Sign in again',
  signingIn: 'Finish signing in in your browser. If you declined, cancel here.',
};

// Why a sign-in ended without one.
export const CONNECT_FAILURE: Record<DeliveryConnectFailure, string> = {
  cancelled: 'The sign-in was cancelled.',
  timeout: 'The sign-in didn’t finish in time.',
  refused: 'The sign-in was refused.',
  denied: 'The sign-in was declined in the browser.',
  busy: 'Another sign-in is under way.',
  absent: 'gws isn’t installed.',
  needsSetup: 'gws needs its setup first.',
  none: 'No Notion connector was found.',
  source: 'Your Notion connector changed since it was found; MAWS looked it up again.',
  unavailable: 'MAWS’s own connection isn’t available right now.',
  failed: 'The sign-in failed.',
};

// Why a send ended without a delivery, in the target's service's name; `maybeSent` adds that the service may have it.
const SEND_FAILURE: Record<DeliveryFailure, (service: string, target: DeliveryTarget) => string> = {
  cancelled: () => 'Cancelled before anything was sent.',
  busy: (service) => `This artifact is already being sent to ${service}.`,
  export: () => 'The export failed',
  deleted: () => 'The artifact was deleted.',
  tooLarge: (service) => `The artifact is too large to send to ${service} as one page.`,
  none: (service) => `No ${service} connector was found.`,
  signIn: (service) => `${service} needs you to connect MAWS first.`,
  reconnect: (service) => `MAWS’s ${service} sign-in needs renewing.`,
  unauthorized: (service) => `${service} refused MAWS’s sign-in. Connect again.`,
  source: (service) => `Your ${service} connector changed since it was found; MAWS looked it up again.`,
  toolMissing: (service) => `This ${service} connector can’t make pages.`,
  toolError: (service) => `${service} refused the page`,
  timeout: (service) => `${service} didn’t answer in time.`,
  transport: (service) => `The exchange with ${service} broke off.`,
  unavailable: (service) => `MAWS couldn’t reach ${service} right now.`,
  absent: () => 'gws isn’t installed.',
  needsSetup: () => 'gws needs its setup first.',
  auth: () => 'gws isn’t signed in to Google. Sign in again.',
  notFound: () => 'That folder wasn’t found in your Drive.',
  forbidden: () => 'Google refused the upload.',
  api: () => 'Google refused the upload',
  discovery: () => 'gws couldn’t reach Google.',
  invalid: (service, target) => (target === 'drive' ? 'gws refused the request' : `${service} takes the artifact as Markdown only.`),
  failed: (service) => `The send to ${service} failed.`,
};
export const sendFailure = (why: DeliveryFailure, target: DeliveryTarget): string => SEND_FAILURE[why](SERVICE[target], target);
export const MAYBE_SENT = (target: DeliveryTarget) => `${SERVICE[target]} may have received it: check there before sending again.`;
