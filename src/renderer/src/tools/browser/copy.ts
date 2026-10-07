// Every sentence the Browser tool, its main tab and its pane show (E4a execution document, Design §4, §5, §13 and §16).
// Codex's words where the document quotes them (`browserSidebar.*` and `thread.browser.*` in its readable source), MAWS's
// own elsewhere. The chrome's own sentences join this object in the chrome's task; the Settings section keeps its own.
import type { LoadErrorKind } from '@shared/browser/errors';

export const BROWSER_COPY = {
  title: 'Browser',
  newTab: 'New tab',
  noSession: 'Open a session to browse beside it',
  tabGone: 'That tab was closed',
  empty: { title: 'Start browsing', body: 'Enter a URL to open a page' },
  suspended: { open: (url: string) => `Open ${url}`, note: 'Tabs are restored unloaded' },
  shownElsewhere: 'Shown in another pane',
  showHere: 'Show here',
  reload: 'Reload',
  retry: 'Retry',
  // Codex's error page (`browserSidebar.loadError.*`), with MAWS as the app's name.
  loadError: {
    heading: "This site can't be reached",
    summary: {
      dns: (host: string) => `${host}'s server IP address could not be found`,
      offline: (host: string) => `${host} could not be loaded because the computer is offline`,
      refused: (host: string) => `${host} refused to connect`,
      timeout: (host: string) => `${host} took too long to respond`,
      certificate: (host: string) => `${host}'s certificate could not be verified`,
      generic: (host: string) => `${host} could not be loaded`,
    } satisfies Record<LoadErrorKind, (host: string) => string>,
    try: 'Try:',
    checkConnection: 'Checking the connection',
    checkProxy: 'Checking the proxy, firewall, and DNS configuration',
    details: [
      { header: 'Check your Internet connection', body: 'Check any cables and restart any routers, modems, or other network devices you may be using' },
      { header: 'Check your DNS settings', body: 'Contact your network administrator if you are not sure what this means' },
      {
        header: 'Allow MAWS to access the network in your firewall or security settings',
        body: 'If MAWS is already listed as an allowed app, try removing it from the list and adding it again',
      },
      { header: 'If you use a proxy server', body: 'Open your system network settings and check whether a proxy has been configured for the active network' },
    ],
    // Chromium's error name, or Codex's fallback when the description is empty.
    code: (code: number, description: string) => (description !== '' ? description : code === 0 ? 'ERR_FAILED' : `ERR_FAILED (${code})`),
  },
  crashedHeading: 'This page crashed',
  crashed: (reason: string) =>
    reason === 'oom' ? 'The page ran out of memory' : reason === 'killed' ? 'The page’s process was ended' : `The page’s process stopped (${reason})`,
  viewFailedHeading: 'This page could not be opened',
  viewFailed: (message: string) => message,
} as const;
