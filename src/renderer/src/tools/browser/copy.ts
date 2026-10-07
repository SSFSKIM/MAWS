// Every sentence the Browser tool, its main tab and its pane show (E4a execution document, Design §4, §5, §13 and §16).
// Codex's words where the document quotes them (`browserSidebar.*` and `thread.browser.*` in its readable source), MAWS's
// own elsewhere. The Settings section keeps its own (`settings-tab/copy.ts`).
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

  // ---- the chrome (Task 3.3; Design §4) ----
  tabs: 'Browser tabs',
  newTabAction: 'New tab',
  closeTabNamed: (title: string) => `Close ${title}`,
  back: 'Back',
  forward: 'Forward',
  reloadPage: 'Reload page', // Codex's `thread.browser.reload`
  stop: 'Stop loading',
  address: 'Address',
  addressPlaceholder: 'Search or enter a URL', // Codex's `thread.browser.addressPlaceholder`
  addressSuggestions: 'Address suggestions', // Codex's `thread.browser.addressSuggestions`
  goTo: (url: string) => `Go to ${url}`,
  searchFor: (text: string) => `Search for “${text}”`,
  notSecure: 'Not secure', // Codex's `thread.browser.notSecure`
  partition: { default: 'Default', browsingAs: (label: string) => `Browsing as ${label}` },
  control: { agentBrowsing: 'Agent is browsing', humanHasPage: 'You have the page', handBack: 'Hand back' },
  options: 'Browser options', // Codex's `thread.browser.options`
  menu: {
    openExternal: 'Open in external browser',
    find: 'Find in page',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Reset zoom',
    openInTab: 'Open in tab',
    showInPanel: 'Show in panel',
    copyUrl: 'Copy URL',
    inspect: 'Inspect',
    closeTab: 'Close tab',
  },
  // Codex's `browserSidebar.zoomBanner.*` and `thread.browser.zoomPercent`
  zoom: { label: 'Page zoom', level: (percent: number) => `${percent}%`, out: 'Zoom out', in: 'Zoom in', reset: 'Reset' },
  // Codex's `codex.threadFindBar.*` for a browser page
  find: {
    label: 'Find in page',
    placeholder: 'Find in page…',
    results: (active: number, matches: number) => `${active} / ${matches} results`,
    noResults: '0 results',
    unavailable: 'Couldn’t search this page',
    previous: 'Previous result',
    next: 'Next result',
    matchCase: 'Match case',
    matchCaseGlyph: 'Aa',
    close: 'Close find',
  },
  dismiss: 'Dismiss',
  permissionDenied: (host: string, permission: string) => `${host} asked to ${permissionName(permission)} · blocked`,
  downloading: (name: string, percent: number | null) => (percent === null ? `Downloading ${name}…` : `Downloading ${name} · ${percent}%`),
  downloadDone: (name: string) => `Downloaded ${name}`,
  downloadCancelled: (name: string) => `Download of ${name} cancelled`,
  downloadFailed: (name: string) => `${name} could not be downloaded`,
  revealInFinder: 'Reveal in Finder',
  unresponsive: 'This page is not responding',
  stopPage: 'Stop page',
  popupsBlocked: (n: number) => `${n} ${n === 1 ? 'pop-up' : 'pop-ups'} blocked`,
  refusedScheme: (scheme: string) => `Can’t open ${scheme || 'that'} addresses here; the browser opens http and https only`,
  // main's transient notices (`browser.notice`) and the chrome's own `urlCopied` (Decision Log 37, 44 (b))
  tabsCap: (n: number) => `At most ${n} pages stay loaded at once, so a tab was left unloaded`,
  tabsCapMemory: 'Loaded pages passed the browser’s memory limit, so a tab was unloaded',
  profileMissing: (name: string | undefined) => `${profileNamed(name)} was not found; this tab browses with the default profile`,
  partitionFallback: (name: string | undefined) => `${profileNamed(name)} could not be opened; this tab browses with the default profile`,
  downloadRefusedAgent: 'A download the agent started was refused; downloads are yours to start',
  urlCopied: 'URL copied to clipboard', // Codex's `thread.browser.url.copied`
  tabsFileBroken: 'The saved browser tabs could not be read; the file was set aside',
  // E4c start: a dialog a never-placed tab's page raised, which MAWS answered with the page's default (A-42)
  dialogAnswered: (type: 'alert' | 'confirm', excerpt: string) =>
    type === 'confirm'
      ? `While this tab was hidden the page asked ${excerpt === '' ? 'for a confirmation' : `“${excerpt}”`}; MAWS answered Cancel`
      : `While this tab was hidden the page showed an alert, which MAWS closed${excerpt === '' ? '' : `: “${excerpt}”`}`,
  // the acting dot on the chip of the tab the agent holds (Design §9)
  acting: 'The agent is using this tab',
  // E4c end

  // ---- Session info (Task 3.4; Design §12): the app's loaded pages beside the engine's memory budget ----
  sessionInfoLabel: 'Browser tabs',
  sessionInfo: (loaded: number, mib: number | null) => `${loaded} loaded${mib === null ? '' : ` · ${mib} MB`} · outside the engine budget`,
  sessionInfoNone: 'No tabs loaded',
} as const;

// A permission as the denied-permission line names it: Codex's capability phrases (`browser.permission.capability.*`)
// for Electron's permission names, else the raw name.
const PERMISSION_NAMES: Readonly<Record<string, string>> = {
  notifications: 'show notifications',
  geolocation: 'know your location',
  'geolocation-approximate': 'know your approximate location',
  media: 'use your camera or microphone',
  'clipboard-read': 'see text and images copied to the clipboard',
  'clipboard-sanitized-write': 'copy text and images to the clipboard',
  'display-capture': 'capture your screen',
  fullscreen: 'enter fullscreen',
  pointerLock: 'lock and use your mouse',
  keyboardLock: 'override some keys on your keyboard',
  midi: 'use your MIDI devices',
  midiSysex: 'control and reprogram your MIDI devices',
  'idle-detection': 'know when you’re actively using this device',
  'local-fonts': 'use the fonts on your computer',
  'local-network-access': 'access other devices on your local network',
  'storage-access': 'access cookies and site data',
  'top-level-storage-access': 'access cookies and site data for another site',
  'speaker-selection': 'select audio output devices',
  'screen-wake-lock': 'keep the screen awake',
  'window-management': 'manage windows on all your displays',
  sensors: 'use your motion sensors',
  openExternal: 'open an app on this Mac',
};

export const permissionName = (permission: string): string => PERMISSION_NAMES[permission] ?? `use ${permission}`;

const profileNamed = (name: string | undefined) => (name === undefined || name === '' ? 'The imported profile' : `The profile ${name}`);
