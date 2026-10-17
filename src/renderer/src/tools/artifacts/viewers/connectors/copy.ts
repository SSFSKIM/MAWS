// P3-H H4: every sentence of an HTML artifact's Connectors action and sheet. A refusal's reason is a closed word
// (P3 Decision Log 84), so each has its sentence here; no server's or route's own words are shown.
import type { ConnectorCallOutcome, ConnectorRefusal } from '@shared/artifacts/connectors';

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
  readAt: (at: number) => `Read at ${new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
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
