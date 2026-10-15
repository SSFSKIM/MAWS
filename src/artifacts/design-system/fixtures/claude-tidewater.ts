// A synthetic design system in Claude's shape (U1, research/p3-claude-type-formats.md §"Design System"), written to
// that grammar for the converter's tests: list-shaped families, a colour theme map, aliases, a type block with families
// and grouped styles, and the further families the grammar allows. It also carries what the grammar drops (a named
// colour, an alias of a missing token, a bad name, a duplicate name), so the import's warnings have something to name.

export const TIDEWATER_TOKENS = {
  name: 'Tidewater',
  version: 1,
  color: {
    note: 'Harbor neutrals with one sea-blue action colour.',
    themes: [
      { id: 'light', name: 'Light' },
      { id: 'dark', name: 'Dark' },
    ],
    tokens: [
      { name: 'surface', value: { light: '#f7f5f0', dark: '#14171a' }, usage: 'Page background.' },
      { name: 'surface-raised', value: { light: '#ffffff', dark: '#1d2125' }, usage: 'Cards and panels.' },
      { name: 'ink', value: { light: '#1b2228', dark: '#eef1f3' }, usage: 'Body text.' },
      { name: 'ink-muted', value: { light: 'rgb(27 34 40 / 0.64)', dark: '#a9b1b8' } },
      { name: 'brand', value: { light: 'oklch(0.48 0.12 240)', dark: '#5aa2e0' }, usage: 'The one action per view.' },
      { name: 'on-brand', value: '#ffffff' },
      { name: 'line', value: 'hsl(40 12% 86%)' },
      { name: 'success', value: '#1f7a4d' },
      { name: 'warning', value: '#a35c00' },
      { name: 'danger', value: '#b3261e' },
      { name: 'info', value: '{brand}' },
      { name: 'link', value: { dark: '#7bb6ea' } }, // only in a later theme: borrowed for the first
      { name: 'ink-2.5', value: '#3a434b' },
      { name: 'named', value: 'red' },
      { name: 'ghost', value: '{nowhere}' },
      { name: 'bad name', value: '#000000' },
    ],
  },
  type: {
    fonts: [{ family: 'Tide Sans', file: 'fonts/TideSans-Regular.woff2', weight: '400' }],
    families: { sans: '"Tide Sans", system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', code: 'ui-monospace, Menlo, monospace' },
    groups: [
      {
        name: 'Headings',
        family: 'serif',
        styles: [
          { name: 'display', fontSize: '44px', lineHeight: '52px', fontWeight: 700, letterSpacing: '-0.01em' },
          { name: 'heading-1', fontSize: '2rem', lineHeight: 1.2, fontWeight: 'bold' },
          { name: 'heading-2', fontSize: '24px', lineHeight: '30px', fontWeight: 600 },
          { name: 'heading-3', fontSize: '19px', lineHeight: 1.3, fontWeight: '500 700' },
        ],
      },
      {
        name: 'Text',
        family: 'sans',
        styles: [
          { name: 'lead', fontSize: '20px', lineHeight: '28px', fontWeight: 400 },
          { name: 'body', fontSize: '16px', lineHeight: '24px', fontWeight: 'normal' },
          { name: 'small', fontSize: '13px', lineHeight: '18px', fontWeight: 400, letterSpacing: '0.2px' },
          { name: 'label', family: 'code', fontSize: '12px', lineHeight: 1.3, fontWeight: 500 },
          { name: 'broken', fontSize: 'big' },
        ],
      },
    ],
  },
  spacing: {
    note: '4px base.',
    tokens: [
      { name: 'space-1', value: '4px', usage: 'Icon to label.' },
      { name: 'space-2', value: '8px' },
      { name: 'space-3', value: '12px' },
      { name: 'space-4', value: '1rem' },
      { name: 'space-6', value: 24 },
      { name: 'space-8', value: '32px' },
      { name: 'space-12', value: '48px' },
      { name: 'surface', value: '2px' }, // a duplicate of a colour's name: drops
    ],
  },
  radius: {
    tokens: [
      { name: 'radius-sm', value: '4px' },
      { name: 'radius-md', value: '8px' },
      { name: 'radius-lg', value: '14px' },
      { name: 'radius-pill', value: '999px' },
    ],
  },
  shadow: {
    tokens: [
      { name: 'shadow-sm', value: '0 1px 2px rgba(0,0,0,0.08)' },
      { name: 'shadow-md', value: '0 4px 12px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)' },
      { name: 'shadow-lg', value: '0 16px 40px #0000001f' },
    ],
  },
  opacity: { tokens: [{ name: 'disabled', value: '0.4' }] },
  size: { tokens: [{ name: 'control', value: '40px', usage: 'Buttons and inputs.' }] },
};

export const TIDEWATER_FILES: Record<string, string> = {
  'project/design-system.json': JSON.stringify({ v: 3, layout: 'files', title: 'Tidewater', namespace: 'Tidewater' }),
  'project/README.md': '# Tidewater\n\nA harbor-town brand book.\n',
  'project/tokens.json': JSON.stringify(TIDEWATER_TOKENS, null, 2),
  'project/components/Button/README.md': '# Button\n\nOne primary per view.\n',
  'project/fonts/TideSans-Regular.woff2': 'data:font/woff2;base64,d09GMgABAAAAAA==',
};
