// P3-H H4: every sentence of an HTML artifact's Connectors action and sheet. A refusal's reason is a closed word
// (P3 Decision Log 84), so each has its sentence here; no server's or route's own words are shown.
import { formatClock } from '@shared/app/date-format';
import type { ConnectorCallOutcome, ConnectorRefusal } from '@shared/artifacts/connectors';
import type { ConnectorOwnerFailure, ConnectorServerRow } from '@shared/ipc/schema/connectors';

const FAILED: Record<Extract<ConnectorRefusal, { state: 'failed' }>['reason'], string> = {
  toolError: 'The last call failed: the tool reported an error',
  malformed: 'The last call failed: its answer could not be read',
  tooLarge: 'The last call failed: its answer was too large',
  routeFailed: 'The last call failed: MAWS couldn’t reach the session',
};

export const CONNECTORS_COPY = {
  action: 'Connectors',
  title: 'Connectors',
  intro: 'This page asks to use these tools. An allowed tool runs through a live session’s connection while the page is on screen, and never while it is hidden or closed.',
  none: 'This page has asked for no tools.',
  allow: 'Allow',
  allowOnce: 'Allow once',
  allowAgain: 'Allow again',
  revoke: 'Revoke',
  done: 'Done',
  toolName: (server: string, tool: string) => `${server} · ${tool}`,
  allowLabel: (name: string) => `Allow ${name} to read`,
  allowOnceLabel: (name: string) => `Allow ${name} once`,
  allowAgainLabel: (name: string) => `Allow ${name} again`,
  revokeLabel: (name: string) => `Revoke ${name}`,
  allowedRead: 'Allowed to read',
  allowedOnce: 'Allowed once',
  notAllowed: 'Not allowed',
  changed: 'Changed since you allowed it',
  readAt: (at: number) => `Read at ${formatClock(at)}`,
  // the detail under a tool's state: a gesture's refusal or the page's latest outcome; null: nothing to add
  detail(outcome: ConnectorCallOutcome | null): string | null {
    if (outcome === null) return null;
    if (outcome.ok) return CONNECTORS_COPY.readAt(outcome.fetchedAt);
    switch (outcome.state) {
      case 'paused':
        return outcome.reason === 'noRoute' ? 'No live session for this artifact has this server' : outcome.reason === 'unavailable' ? 'The session lost this server' : null;
      case 'revoked':
        return outcome.reason === 'wrongMode' ? 'A tool that may change data runs only when allowed once' : outcome.reason === 'revoked' ? 'Revoked' : null;
      case 'invalid':
        return outcome.reason === 'notReadOnly' ? 'This tool may change data: allow it once instead' : outcome.reason === 'watchLimit' ? 'Too many live tools are open in MAWS' : null;
      case 'failed':
        return FAILED[outcome.reason];
    }
  },
  noSession: 'No live session has these tools’ server. Start the artifact’s session to read live data; no message is sent.',
  start: 'Start session',
  asking: 'Starting…',
  starting: 'Starting the session…',
  ready: 'The session is ready',
  openSession: 'Open session',
} as const;

// P3-HD M3c2 start: the sheet where route D exists (the owner's dependency supplied): a tool runs through a live
// session or MAWS's own connection, so no sentence names a session alone; and every sentence of MAWS's server rows.
type SourceRow = Extract<ConnectorServerRow, { kind: 'source' }>;
type Connection = NonNullable<SourceRow['connection']>;
type Last = NonNullable<SourceRow['last']>;

const ENGINE_ONLY: Record<Extract<ConnectorServerRow, { kind: 'engineOnly' }>['why'], string> = {
  unobserved: 'No session has reported this server since MAWS started. Start the artifact’s session once and MAWS can reach it directly afterwards.',
  ambiguous: 'Sessions reported this server differently, so only a session uses it',
  engineOnly: 'Its configuration needs something only a session has (a ${…} reference, or a source MAWS doesn’t read)',
  unidentified: 'MAWS couldn’t tell which configuration file defines it',
  changed: 'Its configuration changed since a session reported it',
  unattested: 'MAWS couldn’t confirm how the session launched it',
  unresolved: 'MAWS couldn’t tell which command it runs', // P3-HD panel correction: also a PATH whose search depends on the session’s directory
  unavailable: 'MAWS couldn’t check this server just now',
  toolMissing: 'The session’s report doesn’t list these tools',
  taskRequired: 'These tools run as tasks, which MAWS’s own connection doesn’t support', // P3-HD panel correction
};

const FAILURE: Partial<Record<ConnectorOwnerFailure, string>> = {
  cancelled: 'it was cancelled',
  timeout: 'it took too long',
  network: 'the server couldn’t be reached',
  insecure: 'the server’s sign-in isn’t over HTTPS',
  discovery: 'the server doesn’t offer a sign-in MAWS can use',
  resource: 'the server’s sign-in names another address',
  issuer: 'the sign-in server didn’t identify itself correctly',
  unsupported: 'the server’s sign-in needs a client ID MAWS can’t register',
  listener: 'MAWS couldn’t receive the browser’s answer',
  registration: 'the sign-in server refused MAWS’s registration',
  browser: 'the browser couldn’t be opened',
  denied: 'the sign-in was declined',
  state: 'the browser’s answer didn’t match the request',
  exchange: 'the sign-in server refused the code',
  token: 'the sign-in server’s answer couldn’t be used',
  rejected: 'the sign-in is no longer accepted',
  busy: 'another sign-in for it is running',
  needsReconnect: 'its saved sign-in can’t be used: reconnect it',
  unavailable: 'MAWS couldn’t read its saved connections',
  capacity: 'too many MAWS connections are busy',
  stale: 'its configuration changed: try again',
  unauthorized: 'the server asked for a sign-in',
  credential: 'its sign-in was withdrawn meanwhile',
  connection: 'the server couldn’t be started or reached',
  source: 'its configuration changed: try again',
};
const failureWords = (why: ConnectorOwnerFailure) => FAILURE[why] ?? 'it failed';

export const SERVERS_COPY = {
  intro: 'This page asks to use these tools. An allowed tool runs through a live session’s connection, or MAWS’s own connection to a server a session reported, while the page is on screen, and never while it is hidden or closed.',
  detail(outcome: ConnectorCallOutcome | null): string | null {
    if (outcome?.ok === false && outcome.state === 'paused' && outcome.reason === 'noRoute') return 'No live session or MAWS connection reaches this server';
    if (outcome?.ok === false && outcome.state === 'paused' && outcome.reason === 'unavailable') return 'The connection lost this server';
    if (outcome?.ok === false && outcome.state === 'failed' && outcome.reason === 'routeFailed') return 'The last call failed: MAWS couldn’t reach the server';
    return CONNECTORS_COPY.detail(outcome);
  },
  noSession: 'Neither a live session nor MAWS’s own connection reaches these tools’ server. Start the artifact’s session to read live data; no message is sent.',
  heading: 'Servers',
  headingNote: 'MAWS’s own connections. Disconnect affects MAWS only: sessions keep their own sign-in, and allowed tools stay allowed.',
  reading: 'Reading MAWS’s connections…',
  readFailed: 'MAWS couldn’t read its connections just now.',
  savedUnavailable: 'MAWS couldn’t read its saved connections (its encrypted storage isn’t available).',
  withdrawnUnattributed: 'An unreadable saved MAWS connection was forgotten, so until MAWS relaunches it won’t reach a server without its own MAWS sign-in. Connect signs a server in now; one that needs no sign-in works again after a relaunch.',
  transport: (transport: 'stdio' | 'http') => (transport === 'http' ? 'HTTP' : 'local command'),
  origin: (scope: 'user' | 'local' | 'app', path: string) => `${scope === 'app' ? 'MAWS' : scope === 'user' ? 'User' : 'Project-local'} config · ${path}`,
  engineOnly: (why: Extract<ConnectorServerRow, { kind: 'engineOnly' }>['why']) => `Session only: ${ENGINE_ONLY[why]}`,
  // `unattributed`: the answer's withdrawnUnattributed (a withdrawn row may be paused by it rather than Disconnected)
  connection(row: SourceRow, unattributed = false): string {
    if (row.action === 'connecting') return row.connection?.state === 'connecting' ? 'Connecting… finish signing in in your browser' : 'Connecting…';
    if (row.action === 'reconnecting') return 'Reconnecting… finish signing in in your browser';
    if (row.connection?.disconnecting === 'pending') return SERVERS_COPY.disconnecting;
    const words = row.connection?.state === 'withdrawn' && unattributed ? 'Not used by MAWS until you Connect or MAWS relaunches' : row.connection ? CONNECTION[row.connection.state](row.connection) : row.needsDiscovery ? 'MAWS hasn’t listed its tools yet' : 'MAWS can reach it directly';
    return row.connection?.disconnecting === 'unconfirmed' ? `${words} · ${SERVERS_COPY.unconfirmed}` : words;
  },
  unconfirmed: 'MAWS couldn’t confirm the disconnect with its connector process, and won’t use it meanwhile',
  last(last: Last): string {
    if ('local' in last) {
      if (last.local === 'failed') return 'MAWS couldn’t forget it: disconnect again';
      return last.host === 'unconfirmed' ? 'Forgotten; the disconnect is unconfirmed' : last.revocation === 'revoked' ? 'Disconnected and revoked' : 'Disconnected';
    }
    const verb = last.action === 'reconnect' ? 'Reconnect' : 'Connect';
    if (last.ok) return `${last.credential === 'none' ? 'Reached without a MAWS sign-in' : 'Connected'} · ${last.tools === 1 ? '1 tool' : `${last.tools} tools`} listed`;
    return `${verb} didn’t finish: ${failureWords(last.why)}`;
  },
  refused: (why: 'stale' | 'busy' | 'capacity' | 'stopped') => (why === 'busy' ? 'Already in progress' : why === 'capacity' ? 'Too many MAWS connections are busy; try again' : why === 'stopped' ? 'MAWS is quitting' : 'This row changed; it was read again'),
  disconnecting: 'Disconnecting…',
  forgetting: 'Forgetting…',
  savedRow: 'Saved MAWS connection, not currently available to this page',
  unreadableRow: 'Unreadable saved MAWS connection',
  unreadableNote: 'It can’t be read, so MAWS won’t guess whose it is. Forget it to remove it.',
  retiringRow: (server: string | undefined) => (server === undefined ? 'MAWS connection being disconnected' : `${server} · MAWS connection being disconnected`),
  connect: 'Connect',
  reconnect: 'Reconnect',
  disconnect: 'Disconnect',
  forget: 'Forget',
  retry: 'Retry disconnect',
  cancel: 'Cancel',
  connectLabel: (server: string) => `Connect MAWS to ${server}`,
  reconnectLabel: (server: string) => `Reconnect MAWS to ${server}`,
  disconnectLabel: (server: string) => `Disconnect MAWS from ${server}`,
  cancelLabel: (server: string) => `Cancel connecting MAWS to ${server}`,
  forgetLabel: 'Forget the unreadable saved MAWS connection',
  retryLabel: (server: string | undefined) => `Retry disconnecting MAWS${server === undefined ? '' : ` from ${server}`}`,
} as const;

const CONNECTION: Record<Connection['state'], (connection: Connection) => string> = {
  none: () => 'No MAWS sign-in saved',
  connecting: () => 'Connecting…',
  connected: () => 'Connected through MAWS',
  needsReconnect: () => 'MAWS’s sign-in can’t be used anymore: reconnect to keep reading',
  withdrawn: () => 'Disconnected from MAWS: Connect to sign in again',
  needsConnect: () => 'This server needs a sign-in: Connect to sign in through MAWS',
  unavailable: ({ why }) =>
    why === 'unknown' ? 'A saved MAWS connection can’t be read, so MAWS won’t guess: forget it below or relaunch MAWS' : why === 'duplicate' ? 'Two saved MAWS connections match it: disconnect one' : 'MAWS couldn’t read its saved connections',
};
// P3-HD M3c2 end
