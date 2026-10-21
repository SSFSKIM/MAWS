// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D10; M6): the words of the design system's menus and
// panels: Theme, Text style, New slide from layout, and Check against the design system.
export const THEME_COPY = {
  panel: 'Theme',
  system: 'Design system',
  followDefault: 'Default',
  followDefaultDetail: 'The Space’s or your default',
  switchFailed: (reason: string) => `The design system could not be switched: ${reason}`,
  colours: 'Colours',
  faces: 'Faces',
  pick: (label: string) => `Pick ${label.toLowerCase()}`,
  reset: (label: string) => `Use the system’s ${label.toLowerCase()}`,
  resetAll: 'Use the system’s colours and faces',
  notAColour: (text: string) => `“${text}” is not a colour: write a hex (#1a1a1a), rgb() or a colour name`,
  systemFace: (family: string | null) => (family ? `System (${family})` : 'System'),
  deckFaces: 'This deck',
  basicFaces: 'Basic',
  // P4-B2 D19: each of the deck's own faces and what it draws from (a refusal is the face's own sentence, deck.ts's)
  faceList: 'This deck’s faces',
  faceUploaded: 'Uploaded font file',
  faceMissing: 'No font file in this deck: draws as its fallback',
  faceSaved: 'Saved in this deck (Google Fonts, OFL)',
  facePending: 'Draws as its fallback until MAWS reaches Google Fonts',
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
  loading: 'Reading the design system’s layouts…',
  none: 'This design system has no slide layouts.',
  failed: (reason: string) => `The layouts could not be read: ${reason}`,
  layout: (name: string) => `${name} layout`,
  // final fix wave (B5): a system's layout whose pictures are the system's assets
  noAssetCopy: 'This layout’s pictures belong to its design system, and this deck cannot copy them in',
  assetsFailed: (reason: string) => `The layout’s pictures could not be copied into the deck: ${reason}`,
  notPlaced: 'The layout was not added: the deck stopped taking edits here while its pictures were copied',
} as const;

export const CHECK_COPY = {
  panel: 'Check against the design system',
  loading: 'Reading the design system…',
  noDonts: (system: string) => `${system}’s law lists no hard don’ts to check.`,
  clean: (rules: number) => `The deck keeps every checked rule (${rules}).`,
  summary: (violations: number, rules: number) => `${violations} ${violations === 1 ? 'violation' : 'violations'} of ${rules} ${rules === 1 ? 'checked rule' : 'checked rules'}.`,
  slide: (n: number) => `Slide ${n}`,
  select: (where: string) => `Select ${where}`,
  manual: 'To judge by hand',
  unknown: 'Tags MAWS cannot run',
} as const;
