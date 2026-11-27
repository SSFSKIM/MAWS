// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8; M4): the deck editor's words.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): a word kept only as a control's name
// or tooltip is named `…Name` or `…Tip`; a refusal is said shortly (`refused`), the model's own reason its tooltip.
export const DECK_COPY = {
  filmstrip: 'Slides',
  slides: 'Slides in order',
  slideLabel: (n: number, hidden: boolean, held: boolean) => `Slide ${n}${hidden ? ', hidden' : ''}${held ? ', held' : ''}`,
  slideOptions: (n: number) => `Slide ${n} options`,
  // W1: a reorder as assistive technology hears it, the item by its position and title (an untitled one by position)
  reorderItem: (n: number, title: string) => (title ? `Slide ${n}, ${title}` : `Slide ${n}`),
  reorder: {
    start: (item: string) => `${item}, picked up.`,
    over: (item: string, to: number) => `${item}, moved to position ${to}.`,
    away: (item: string) => `${item}, not over the list.`,
    end: (item: string, to: number) => `${item}, dropped at position ${to}.`,
    cancel: (item: string, at: number) => `${item}, move cancelled, back at position ${at}.`,
  },
  newSlide: 'New slide',
  // G428: said once inside the slide's own menu
  duplicate: 'Duplicate',
  hide: 'Hide',
  show: 'Show',
  deleteSlide: 'Delete',
  addSection: 'New section here',
  newSection: 'New section',
  untitledSection: 'Untitled section',
  sectionName: 'Section name',
  renameSection: (name: string) => `Rename section ${name}`,
  removeSection: (name: string) => `Remove section ${name}`,
  held: 'Held',
  heldTitle: (reasons: readonly string[]) => `This slide’s file does not load: ${reasons.join('; ')}`,
  heldBanner: 'Showing the last good version (read-only). The agent’s next valid file fixes it.', // G431
  heldDetails: 'Details', // G432: the loader's reasons behind it
  stage: 'Slide',
  notes: 'Speaker notes',
  notesTooLong: (length: number, max: number) => `Too long to save: ${length.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`, // G437
  notesNotSaved: 'Not saved yet', // P3-F (L203); G438
  saveNotes: 'Save notes',
  // G423: New slide's and From layout's reason at the limit, on the greyed control
  deckFull: (max: number) => `A deck holds at most ${max} slides: delete one to add another.`,
  emptyDeck: 'No slides yet', // G433
  toolbar: 'Deck',
  undo: 'Undo',
  redo: 'Redo',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoom: 'Zoom',
  zoomControls: 'Zoom controls',
  fit: 'Fit', // G400: the first option's words while another zoom is chosen, and the select's tooltip while Fit is
  percent: (scale: number) => `${Math.round(scale * 100)}%`,
  // M5: the transform layer, the arrange buttons, Insert
  resizeHandle: (at: string) => `Resize ${({ n: 'top', s: 'bottom', e: 'right', w: 'left', ne: 'top right', nw: 'top left', se: 'bottom right', sw: 'bottom left' } as Record<string, string>)[at] ?? at}`,
  rotateHandle: 'Rotate',
  endHandle: (i: number) => (i === 0 ? 'Move the start' : 'Move the end'),
  arrange: 'Arrange',
  bringToFront: 'Bring to front',
  sendToBack: 'Send to back',
  bringForward: 'Bring forward',
  sendBackward: 'Send backward',
  group: 'Group',
  ungroup: 'Ungroup',
  detach: 'Detach',
  duplicateElements: 'Duplicate',
  deleteElements: 'Delete',
  inspector: 'Inspector', // G401: the glyph's name and tooltip
  historyName: 'Version history', // G402: the glyph's name and tooltip
  insert: 'Insert',
  insertText: 'Text box',
  insertHeading: 'Heading',
  insertBullets: 'Bulleted list',
  insertNumbers: 'Numbered list',
  insertShape: 'Shape',
  insertIcon: 'Icon',
  insertImage: 'Image…',
  insertTable: 'Table',
  insertLine: 'Line',
  insertConnector: 'Connector',
  tableSize: (rows: number, cols: number) => `${rows} × ${cols}`, // G411
  tableSizeName: (rows: number, cols: number) => `${rows} × ${cols} table`,
  shapeName: (kind: string) => ({ rect: 'Rectangle', rounded: 'Rounded rectangle', ellipse: 'Ellipse', diamond: 'Diamond', 'arrow-right': 'Arrow right', 'arrow-left': 'Arrow left', 'arrow-up': 'Arrow up', 'arrow-down': 'Arrow down', line: 'Line shape' })[kind] ?? kind,
  // P4-B2 (D15): the stage's elements as assistive technology reads them, and what the stage's status says
  items: (name: string, n: number) => `${name}, ${n} ${n === 1 ? 'item' : 'items'}`,
  iconName: (name: string) => {
    const words = name.replace(/([a-z])([A-Z])/g, '$1 $2');
    return `${words[0]}${words.slice(1).toLowerCase()} icon`;
  },
  selectedCount: (n: number) => `${n} elements selected`,
  position: (n: number, total: number) => `${n} of ${total}`,
  uploading: 'Uploading…', // G415
  // M6 (M5's review): Detach transform is named only where the inspector offers it (the token has a fallback); G414
  tokenTransform: (detachable: boolean) => (detachable ? 'Set by the design system: Detach it in the inspector' : 'Set by the design system: change it there'),
  uploadFailed: (reason: string) => `The image could not be uploaded: ${reason}`,
  uploadNotPlaced: 'Not placed: the deck became read-only', // G416
  // G413: what a gesture refused, said shortly; the model's own reason is the notice's tooltip
  refused: {
    insert: 'Can’t insert this here',
    group: 'These can’t be grouped',
    ungroup: 'This can’t be ungrouped',
    detach: 'This can’t be detached',
    duplicate: 'Can’t duplicate this',
    paste: 'Can’t paste this here',
    move: 'Can’t move this',
    layout: 'Can’t add this layout',
    textStyle: 'Can’t set this text style',
  },
  // P4-A2 G2.3 (G-R3): the label on a slide a publish is writing, as the document's layer names its author
  writing: (name: string) => `${name} is writing…`,
} as const;
