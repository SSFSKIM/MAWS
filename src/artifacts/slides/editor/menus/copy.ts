// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D10; M6): the words of the design system's menus and
// panels: Theme, Text style, New slide from layout, and Check against the design system.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): a word kept only as a name is `…Name`.
export const THEME_COPY = {
  panel: 'Theme',
  system: 'Design system',
  followDefault: 'Default',
  switchFailed: (reason: string) => `The design system could not be switched: ${reason}`,
  colours: 'Colours',
  faces: 'Faces',
  pick: (label: string) => `Pick ${label.toLowerCase()}`,
  reset: (label: string) => `Use the system’s ${label.toLowerCase()}`,
  resetAll: 'Reset all', // G468
  notAColour: (text: string) => `“${text}” is not a colour: write a hex (#1a1a1a), rgb() or a colour name`,
  systemFace: (family: string | null) => (family ? `System (${family})` : 'System'),
  deckFaces: 'This deck',
  basicFaces: 'Basic',
  // P4-B2 D19: each of the deck's own faces and what it draws from (a refusal is the face's own sentence, deck.ts's)
  faceList: 'This deck’s faces',
  // G465, G466: a face that draws (uploaded, saved) is its family alone; only an exception carries words
  faceMissing: 'No font file',
  facePending: 'Waiting for Google Fonts',
} as const;

export const TEXT_STYLE_COPY = {
  menu: 'Text style',
  notText: (id: string) => `${id} is not text: a text style sets a heading, a paragraph or a list`,
} as const;

export const LAYOUTS_COPY = {
  menu: 'New slide from layout',
  // the trigger's name: not "New slide …", which New slide's own name would no longer find alone
  button: 'From layout',
  open: 'From layout…',
  loading: 'Loading…', // G421: the quiet spinner's name
  none: 'No layouts',
  failed: (reason: string) => `Layouts could not be read: ${reason}`,
  layout: (name: string) => `${name} layout`,
  // final fix wave (B5): a system's layout whose pictures are the system's assets
  // the reasons behind the toolbar's short "Can’t add this layout" (G413), its tooltip
  noAssetCopy: 'This layout’s pictures belong to its design system, and this deck cannot copy them in',
  assetsFailed: (reason: string) => `The layout’s pictures could not be copied into the deck: ${reason}`,
  notPlaced: 'Not added: the deck became read-only', // G416
} as const;

export const CHECK_COPY = {
  panel: 'Check', // G471
  panelName: 'Check design', // the header action that opens it (T636) names the panel too
  loading: 'Checking…', // G476: the quiet spinner's name
  noDonts: 'Nothing to check', // G472
  unread: 'Couldn’t read the design system', // a system the check cannot read settles in words, never a spinner
  clean: (rules: number) => `No issues · ${rules} ${rules === 1 ? 'rule' : 'rules'}`,
  summary: (issues: number) => `${issues} ${issues === 1 ? 'issue' : 'issues'}`,
  slide: (n: number) => `Slide ${n}`,
  select: (where: string) => `Select ${where}`,
  manual: 'By hand', // G475, the design system page's words (G586)
  unknown: 'Unknown checks',
} as const;
