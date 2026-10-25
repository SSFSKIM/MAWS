// Customize › Connectors' words (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding",
// "Signing in", "My items", "Failure handling"). Plain and literal: a state says only what MAWS observed.
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';

type Step = Exclude<ConnectorSignInChanged['state'], 'done' | 'failed' | 'cancelled'>;
type Reason = NonNullable<ConnectorSignInChanged['reason']>;

export const CONNECTORS = {
  tab: 'Connectors',
  configured: 'Configured on disk',
  none: 'No connectors are configured here.',
  live: 'Live in the attached session',
  noLive: 'Connection state and tools are unavailable without a running session in this project.',
  refresh: 'Refresh',
  remove: 'Remove',
  removeName: (name: string) => `Remove ${name}`,
  scopeOf: (scope: string) => `${scope} scope`,
  // the sheet
  addTitle: (name: string) => `Add ${name}?`,
  removeTitle: (name: string) => `Remove ${name}?`,
  name: 'Name',
  url: 'URL',
  instanceUrl: 'Your instance’s URL',
  pattern: (pattern: string) => `It must match ${pattern}`,
  urlChoice: 'Server',
  transport: 'Transport',
  transportName: { http: 'HTTP (streamable)', sse: 'SSE' } as const,
  noSignIn: 'No sign-in needed',
  signInAfter: 'After adding, sign in from Connectors › My items.',
  writes: 'Changes',
  takesEffect: 'Sessions started from now on load it; running sessions do not.',
  removesFrom: 'Running sessions keep it until they end.',
  exists: (scope: string, path: string) => `This name is already configured here (${scope} scope, ${path}).`,
  // field problems
  nameRequired: 'Enter a name.',
  nameRule: 'Use letters, digits, hyphens and underscores only.',
  urlRequired: 'Enter the server’s URL.',
  urlScheme: 'Enter an http or https URL.',
  urlPattern: (pattern: string) => `The URL must match ${pattern}`,
  // sign-in
  signIn: 'Sign in',
  signInName: (name: string) => `Sign in to ${name}`,
  cancel: 'Cancel',
  openSession: (place: string | null) => (place === null ? 'Open a session, then sign in' : `Open a session in ${place}, then sign in`),
  connected: 'Connected',
  needed: 'Sign in needed',
  noneNeeded: 'No sign-in needed',
  connecting: 'Connecting…',
  failed: (message: string | null) => (message ? `Failed: ${message}` : 'Failed'),
  status: (status: string) => status,
  step: {
    starting: 'Starting sign-in…',
    waiting_browser: 'Opening your browser…',
    waiting_callback: 'Finish signing in in your browser…',
    submitting: 'Finishing sign-in…',
    watching_status: 'Waiting for the server to connect…',
  } satisfies Record<Step, string>,
  signedIn: { here: 'Signed in · connected here', new_sessions: 'Signed in · available in new sessions' } as const,
  didntFinish: (why: string) => `Sign-in didn’t finish: ${why}`,
  reason: {
    no_session: 'no session is ready',
    timeout: 'the browser didn’t return within 5 minutes',
    denied: 'the sign-in was declined',
    engine: 'the engine refused it',
    session_exited: 'the session ended',
  } satisfies Record<Reason, string>,
  cancelled: 'cancelled',
  // Discover
  unavailable: 'Anthropic’s directory is unavailable.',
  retry: 'Retry',
  asksInstanceUrl: 'Asks for your instance’s URL',
} as const;
