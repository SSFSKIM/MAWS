// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector"): the inspector's words. The control
// names are the accessible names the e2e drives it by.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): a caption under its section's heading
// drops the section's word (G442), the full words staying the field's name; a list names a weight or a fit in plain words
// (G445, G446); a greyed field's reason is its tooltip (G449, G450).
export const INSPECTOR_COPY = {
  panel: 'Inspector',
  close: 'Close inspector', // G439: the card's ×
  slide: 'Slide',
  group: 'Group',
  selected: (n: number) => `${n} selected`,
  mixed: 'Mixed',
  none: 'None',
  auto: 'Auto',
  inherited: 'Inherited',
  notANumber: 'Enter a number',
  swatches: (label: string) => `${label} swatches`,
  // sections
  arrange: 'Arrange',
  fill: 'Fill',
  border: 'Border',
  shadow: 'Shadow',
  text: 'Text',
  image: 'Image',
  shape: 'Shape',
  icon: 'Icon',
  connector: 'Connector',
  table: 'Table',
  // arrange
  x: 'X',
  y: 'Y',
  width: 'Width',
  height: 'Height',
  rotation: 'Rotation',
  detachTransform: 'Detach transform',
  // M6 (M5's review): what Detach does, said only where it is offered; a token with no fallback has nothing to detach to.
  // G449: the greyed Rotation's reason and Detach transform's tooltip, no longer a note under them
  tokenTransform: (fallback: string | null) =>
    fallback === null
      ? 'This transform is a design-system token with no fallback value, so it is not rotated here: give it a fallback in the slide (var(--ds-…, value)) or change it in the design system.'
      : `This transform is a design-system token. Detach transform replaces the token with its fallback value, ${fallback}, which can then be rotated.`,
  tokenTransforms: (detachable: boolean) =>
    detachable
      ? 'These transforms are design-system tokens. Detach transform replaces each token with its fallback value, which can then be rotated.'
      : 'Some of these transforms are design-system tokens with no fallback value, so they are not rotated here: give each a fallback in the slide (var(--ds-…, value)) or change it in the design system.',
  opacity: 'Opacity',
  // fill
  fillKind: 'Fill',
  fillColour: 'Fill colour',
  colour: 'Colour',
  gradient: 'Gradient',
  other: 'Other', // G446
  gradientAngle: 'Gradient angle',
  angleCaption: 'Angle', // G442
  stopColour: (n: number) => `Stop ${n} colour`,
  stopPosition: (n: number) => `Stop ${n} position`,
  positionCaption: 'Position',
  removeStop: (n: number) => `Remove stop ${n}`,
  addStop: 'Add stop',
  // border
  borderWidth: 'Border width',
  borderStyle: 'Border style',
  widthCaption: 'Width', // G442: Border width's and Line width's caption
  styleCaption: 'Style',
  borderColour: 'Border colour',
  radius: 'Corner radius',
  // shadow
  shadowX: 'Shadow X',
  shadowY: 'Shadow Y',
  shadowBlur: 'Shadow blur',
  shadowColour: 'Shadow colour',
  shadowSpread: 'Shadow spread',
  shadowCaptions: { x: 'X', y: 'Y', blur: 'Blur', spread: 'Spread' } as Record<string, string>, // G442
  shadowInset: 'Inset shadow',
  outlineShadow: 'This shape’s shadow is drawn from its outline, which casts no inset shadow and no spread.', // G450: Spread's and Inset's reason
  // text
  font: 'Font',
  fontSize: 'Font size',
  fontWeight: 'Font weight',
  sizeCaption: 'Size', // G442
  weightCaption: 'Weight',
  textColour: 'Text colour',
  alignment: 'Alignment',
  align: { left: 'Align left', center: 'Align center', right: 'Align right', justify: 'Justify' },
  lineHeight: 'Line height',
  letterSpacing: 'Letter spacing',
  textFit: 'Text fit',
  fitCaption: 'Fit', // G442: Text fit's and Image fit's caption
  fit: { '': 'Auto', none: 'Clip', shrink: 'Shrink to fit', grow: 'Grow to fit' } as Record<string, string>, // G446
  weights: { '100': 'Thin', '200': 'Extra light', '300': 'Light', '400': 'Regular', '500': 'Medium', '600': 'Semibold', '700': 'Bold', '800': 'Extra bold', '900': 'Black' } as Record<string, string>,
  // image
  imageFit: 'Image fit',
  cover: 'Fill', // G446
  contain: 'Fit',
  cropZoom: 'Crop zoom',
  cropX: 'Crop X',
  cropY: 'Crop Y',
  resetCrop: 'Reset crop',
  replace: 'Replace', // G453
  replaceName: 'Replace image',
  imageFile: 'Image file',
  uploading: 'Uploading…', // Replace's wait, a quiet spinner beside its word
  notAnAsset: 'The image could not be replaced', // G455
  replaceNotPlaced: 'Not placed: the deck became read-only', // G416
  altText: 'Alt text',
  altPlaceholder: 'What the picture shows',
  // shape, icon, connector
  shapeKind: 'Shape',
  shapes: { rect: 'Rectangle', rounded: 'Rounded rectangle', ellipse: 'Ellipse', diamond: 'Diamond', 'arrow-right': 'Arrow right', 'arrow-left': 'Arrow left', 'arrow-up': 'Arrow up', 'arrow-down': 'Arrow down', line: 'Line' } as Record<string, string>,
  iconName: 'Icon',
  iconColour: 'Icon colour',
  startHead: 'Start head',
  endHead: 'End head',
  heads: { none: 'None', open: 'Open', filled: 'Filled' } as Record<string, string>,
  route: 'Route',
  routes: { straight: 'Straight', hv: 'Across, then down', vh: 'Down, then across', elbow: 'Elbow' } as Record<string, string>,
  lineColour: 'Line colour',
  lineWidth: 'Line width',
  lineStyle: 'Line style',
  // table
  addRow: 'Add row',
  removeRow: 'Remove row',
  addColumn: 'Add column',
  removeColumn: 'Remove column',
  tableSize: (rows: number, columns: number) => `${rows} × ${columns}`,
} as const;
