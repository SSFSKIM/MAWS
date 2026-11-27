// Every sentence the Browser tool, its main tab and its pane show (E4a execution document, Design §4, §5, §13 and §16).
// Codex's words where the document quotes them (`browserSidebar.*` and `thread.browser.*` in its readable source), MAWS's
// own elsewhere. The Settings section keeps its own (`settings-tab/copy.ts`).
import type { LoadErrorKind } from '@shared/browser/errors';

const UNREADABLE = 'Couldn’t read Chrome’s bookmarks file'; // cua #90: the profile popover's line for a failed bookmarks read

export const BROWSER_COPY = {
  title: 'Browser',
  newTab: 'New tab',
  noSession: 'Open a session to browse beside it',
  // P5 O5 M5: the session's agent has no browser on its machine (the session's capabilities), with mawsd's reason
  agentUnavailable: (reason: string | null) => (reason === null ? 'The agent has no browser here' : `The agent has no browser here: ${reason}`),
  tabGone: 'That tab was closed',
  // the word cut: a tab that never navigated shows the globe alone (T409, T410); a restored one's button reads Load, its
  // address its tooltip (T412), with no note under it (T413)
  load: 'Load',
  shownElsewhere: 'Shown in another pane',
  showHere: 'Show here',
  reload: 'Reload',
  retry: 'Retry',
  // Codex's error page (`browserSidebar.loadError.*`), with MAWS as the app's name.
  loadError: {
    // the word cut (T415): the summary is the heading; the tips under it stay (T417, T418)
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
  closeTabNamed: (title: string) => `Close ${title}`, // a tab's ×'s accessible name
  close: 'Close', // the word cut (T426): its tooltip
  back: 'Back',
  forward: 'Forward',
  reloadPage: 'Reload page', // Codex's `thread.browser.reload`
  stop: 'Stop loading',
  // ticket 815: why Back, Forward and Reload page are greyed
  noBack: 'No page to go back to',
  noForward: 'No page to go forward to',
  noReload: 'No page to reload',
  address: 'Address',
  addressPlaceholder: 'Search or enter a URL', // Codex's `thread.browser.addressPlaceholder`
  addressSuggestions: 'Address suggestions', // Codex's `thread.browser.addressSuggestions`
  // the word cut (T433): the typed rows' accessible names; the row shows the address or the query beside its glyph
  goTo: (url: string) => `Go to ${url}`,
  searchFor: (text: string) => `Search for “${text}”`,
  notSecure: 'Not secure', // Codex's `thread.browser.notSecure`
  partition: { default: 'Default', browsingAs: (label: string) => `Browsing as ${label}` },
  control: { agentBrowsing: 'Agent is browsing', humanHasPage: 'You have the page', handBack: 'Hand back' },
  options: 'Browser options', // Codex's `thread.browser.options`
  menu: {
    openExternal: 'Open in external browser',
    find: 'Find in page',
    // the word cut (T444): one row, "Zoom" with − level +, the level resetting; Close tab is the tab's × (T446)
    zoom: 'Zoom',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Reset zoom',
    resetZoomAt: (level: string) => `Reset zoom, ${level}`,
    openInTab: 'Open in tab',
    showInPanel: 'Show in side surface',
    copyUrl: 'Copy URL',
    inspect: 'Inspect',
    viewport: 'Viewport', // U12a
    copyScreenshot: 'Copy screenshot', // U12a
  },
  // U12a (the UX wave's U12, Interfaces §G): the Viewport submenu's three choices, a size's hint, and the chip
  viewport: {
    responsive: 'Responsive',
    mobile: 'Mobile',
    tablet: 'Tablet',
    tooWide: 'Wider than this pane',
    size: (width: number, height: number) => `${width} × ${height}`,
    chip: (width: number, height: number) => `Viewport: ${width} × ${height}`, // the chip's accessible name; its tooltip is `menu.viewport` (the word cut, T441)
  },
  // Codex's `browserSidebar.zoomBanner.*` and `thread.browser.zoomPercent`; the word cut (T452): no banner, a chip with
  // the level in the navigation row, Page zoom its tooltip, opening − Reset +
  zoom: { label: 'Page zoom', level: (percent: number) => `${percent}%`, chip: (level: string) => `Page zoom: ${level}`, reset: 'Reset' },
  // Codex's `codex.threadFindBar.*` for a browser page; the word cut (T454, T455): the count is its numbers, with its
  // words for a screen reader
  find: {
    label: 'Find in page',
    placeholder: 'Find in page…',
    results: (active: number, matches: number) => `${active} / ${matches}`,
    noResults: '0',
    resultsSpoken: (active: number, matches: number) => `${active} of ${matches} results`,
    noResultsSpoken: 'No results',
    unavailable: 'Couldn’t search this page',
    previous: 'Previous result',
    next: 'Next result',
    nothingToFind: 'Type text to find', // ticket 815: why Previous and Next are greyed
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
  // main's transient notices (`browser.notice`) and the chrome's own `urlCopied` (Decision Log 37, 44 (b)). The word cut:
  // a tab left unloaded at the page cap draws no line, its chip already greyed (T462); the refused options keep the fact
  // (T463); an agent's refused download is what happened (T467); both copies read Copied (T464)
  tabsCapOptions: (name: string) => `Too many pages are loaded to open ${name}’s options`, // cua #90
  // the word cut (T462, split): an extension's options tab the cap closed, so no greyed chip shows what happened
  tabsCapClosed: 'Closed: too many pages open',
  tabsCapClosedMemory: 'Closed: pages use too much memory',
  tabsCapRefused: 'Not loaded: too many pages open', // a page the count cap left suspended, nothing being free to unload for it
  profileMissing: (name: string | undefined) => `${profileNamed(name)} was not found; this tab browses with the default profile`,
  partitionFallback: (name: string | undefined) => `${profileNamed(name)} could not be opened; this tab browses with the default profile`,
  downloadRefusedAgent: 'Blocked a download the agent started',
  urlCopied: 'Copied', // Codex's `thread.browser.url.copied`
  screenshotCopied: 'Copied', // U12a: Copy screenshot
  screenshotFailed: 'Couldn’t copy a screenshot of this page', // U12a: nothing could be captured
  tabsFileBroken: 'The saved browser tabs could not be read; the file was set aside',
  // E4c start: a dialog a never-placed tab's page raised, which MAWS answered with the page's default (A-42)
  dialogAnswered: (type: 'alert' | 'confirm', excerpt: string) =>
    type === 'confirm'
      ? `While this tab was hidden the page asked ${excerpt === '' ? 'for a confirmation' : `“${excerpt}”`}; MAWS answered Cancel`
      : `While this tab was hidden the page showed an alert, which MAWS closed${excerpt === '' ? '' : `: “${excerpt}”`}`,
  // the acting dot on the chip of the tab the agent holds (Design §9)
  acting: 'The agent is using this tab',
  agentBadge: 'Opened by an agent', // E13: the badge on a tab an agent created through cua
  // P5 O7 M3: a loopback page of another machine's session, through a port forwarded over the machine's link
  forwarded: {
    // the word cut (T429): the badge reads the machine's name, "forwarded from" before it for a screen reader alone
    markLead: 'forwarded from ',
    mark: (machine: string) => machine,
    markTitle: (machine: string, port: number) => `Port ${port} on ${machine}, forwarded to this Mac`,
    failedHeading: (port: number, machine: string) => `Couldn’t open port ${port} on ${machine}`,
    unreachable: (machine: string) => `${machine} isn’t reachable from this Mac right now`,
    notAllowed: (machine: string) => `This Mac isn’t allowed to open ports on ${machine}`,
    notOffered: (machine: string) => `${machine} runs a version of MAWS that can’t forward ports`,
    cancelled: 'Opening the port was cancelled',
    refused: (machine: string) => `This link is local to ${machine} and can’t be opened from here`, // the word cut (T470)
    tryAgain: 'Try again',
    dismiss: 'Dismiss',
  },
  // E4c end

  // P5 O17 M10 start: the agent's tabs on another machine's session, seen by screencast (remote/View.tsx). Each state is
  // worded from main's view kind (and its end), never from prose; the machine's own reason shows only when it is the
  // machine's reading (`unavailable`).
  remote: {
    group: (machine: string) => `Agent on ${machine}`,
    pick: (machine: string) => `Agent tab on ${machine}`,
    noTabs: 'No agent browser tabs',
    connecting: (machine: string) => `Connecting to ${machine}`, // the word cut (T491): the spinner's name beside the dimmed label
    lost: 'Connection lost',
    unavailable: (reason: string | null) => (reason === null || reason === '' ? 'The agent has no browser' : `The agent has no browser: ${reason}`),
    unsupported: (machine: string) => `${machine} runs a version of MAWS that can’t show the agent’s browser here`,
    ended: {
      removed: 'You can no longer view this session’s browser',
      class: 'This device can’t view the agent’s browser',
      closed: (machine: string) => `The connection to ${machine} closed`,
      noLink: (machine: string) => `${machine} isn’t reachable from this Mac`,
      window: 'The view was closed',
      failed: (machine: string) => `The agent’s browser on ${machine} stopped`,
    },
    reconnect: 'Reconnect',
    loading: 'Waiting for the agent’s page…', // the word cut (T498): the spinner's name over the picture
    waiting: 'The agent’s tab isn’t available right now', // its stream closed with the tab or the engine; the next listing or Retry
    stopped: 'The picture stopped',
    retry: 'Retry',
    page: (title: string, machine: string) => `The agent’s page on ${machine}: ${title}`,
    viewOnlyHint: 'View only; take control to use the page', // the word cut (T493): no View only badge beside Take control
    youControl: 'You have control',
    youControlHint: 'You have control; Escape gives the keyboard back to this window',
    takeControl: 'Take control',
    taking: 'Taking control…',
    giveBack: 'Give back',
    // why control was not taken: a machine's or the link's word, named (remote/View.tsx's `controlRefusedWords`); main's own
    // sentence as it says it
    controlRefused: {
      plain: 'Couldn’t take control',
      said: (reason: string) => `Couldn’t take control: ${reason}`,
      busy: 'Couldn’t take control: someone else is using this tab',
      noRight: (machine: string) => `Couldn’t take control: you don’t have the right to use the agent’s browser on ${machine}`,
      viewOnly: (machine: string) => `Couldn’t take control: you can only view on ${machine}`,
      tabGone: 'Couldn’t take control: the tab is no longer open',
      changed: 'Couldn’t take control: the agent’s browser changed, so try again',
      cancelled: 'Couldn’t take control: the confirmation was cancelled',
      expired: 'Couldn’t take control: the request expired',
      notOffered: (machine: string) => `Couldn’t take control: ${machine} doesn’t offer it`,
      unreachable: (machine: string) => `Couldn’t take control: ${machine} isn’t reachable`,
      unavailable: (machine: string) => `Couldn’t take control: the agent’s browser on ${machine} is unavailable`,
    },
    controlRevoked: 'Control was taken back',
    pasteTooLong: (kb: number) => `That paste is too long to send to the agent’s page (at most ${kb} KB)`,
  },
  // P5 O17 M10 end

  // cua #90 start: the bookmarks bar (Chrome's words) and the address field's bookmark rows
  bookmarks: {
    bar: 'Bookmarks bar',
    more: 'More bookmarks', // the » slot (Chrome's tooltip names the hidden ones "bookmarks")
    suggestion: 'Bookmark', // the star's label on an address suggestion
  },
  // the pill's avatar and its popover (Chrome's profile bubble); in English like the rest of MAWS (the owner,
  // 2026-10-21: "영어로 통일", one language on the popover; P4 Decision Log 4)
  profile: {
    label: (name: string) => `Profile: ${name}`, // the popover's accessible name
    defaultName: 'Default profile', // the Default partition's popover heading
    defaultRow: 'Default', // the Default partition in the list of other profiles
    // the word cut: the account's names alone, and no line for a profile signed in to none (T478, T479); the list headed
    // "New tabs as", with no caption (T480), a switch setting the profile new tabs open in while this tab keeps its own;
    // its rows named in full, with no tooltip (T481); the popover's Sync bookmarks over the age alone (T483, T484);
    // Re-import… (T486). Settings › Browser's row menu and note keep Sync bookmarks now and Last synced.
    account: (parts: string[]) => parts.join(' · '),
    newTabsAs: 'New tabs as',
    switchTo: (name: string) => `Open a new tab as ${name}`,
    sync: 'Sync bookmarks',
    syncNow: 'Sync bookmarks now',
    syncing: 'Syncing bookmarks…',
    lastSynced: (age: string) => `Last synced ${age}`,
    unreadableShort: UNREADABLE,
    unreadable: (age: string | null) => `${UNREADABLE} · ${age === null ? 'Never synced' : `Last synced ${age}`}`, // the record's error, with the last good read
    indexUnavailable: 'Unavailable in this build',
    syncFailed: (why: string) => `Bookmarks could not be synced: ${why}`,
    reimport: 'Re-import…',
    settings: 'Browser settings',
  },
  // the extensions action bar (Chrome's words) and its notices
  extensions: {
    bar: 'Extensions',
    puzzle: 'Extensions', // Chrome's puzzle button
    noPopup: 'This extension has no popup here',
    popupFailed: (name: string | undefined) => `${name || 'An extension'}’s popup could not be shown`,
    pageClosed: (name: string | undefined) => `${name || 'An extension'} is no longer loaded, so its options tab closed`,
  },
  // cua #90 end

  // ---- Session info (Task 3.4; Design §12): the app's loaded pages beside the engine's memory budget ----
  sessionInfoLabel: 'Browser tabs',
  // the word cut: "3 loaded · 120 MB" (T539), where the pages stand its tooltip (P162); no row while none is loaded (T540)
  sessionInfo: (loaded: number, mib: number | null) => `${loaded} loaded${mib === null ? '' : ` · ${mib} MB`}`,
  sessionInfoSource: 'outside the engine budget',
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
