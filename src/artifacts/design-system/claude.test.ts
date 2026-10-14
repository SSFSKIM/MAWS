import { describe, expect, it } from 'vitest';
import { ClaudeShapeError, fromClaude, isClaudeShape, toClaude } from './claude';
import { validateClaudeTokens } from './claude-grammar';
import { colorToCss } from './color';
import { edited } from './fixtures/edit';
import complete from './fixtures/complete.tokens.json';
import { TIDEWATER_FILES, TIDEWATER_TOKENS } from './fixtures/claude-tidewater';
import { resolveTokens, type ResolvedToken } from './resolve';
import { parseTokens, serializeTokens, validateTokenFile, type TokenSet } from './tokens';

const completeSet = parseTokens(complete).tokens!;
const LAW = '# Test system\n\n## 0. Stance commitment\n\nQuiet.\n';

/** Each resolved token as comparable text: colours in CSS, everything else as JSON. */
function values(set: TokenSet): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of resolveTokens(set).tokens.values()) out[token.path] = show(token);
  return out;
}
const show = (token: ResolvedToken) => (token.type === 'color' ? colorToCss(token.value) : JSON.stringify(token.value));

describe('Claude’s shape: the import (Acceptance 6)', () => {
  const imported = fromClaude(TIDEWATER_FILES);

  it('detects Claude’s shape, and not MAWS’s', () => {
    expect(isClaudeShape(TIDEWATER_FILES)).toBe(true);
    expect(isClaudeShape({ 'tokens.json': '{}', 'README.md': '' })).toBe(true);
    expect(isClaudeShape({ 'DESIGN.md': '', 'tokens.tokens.json': '{}' })).toBe(false);
    expect(isClaudeShape({ 'DESIGN.md': '', 'tokens.json': '{}' })).toBe(false);
  });

  it('imports to a token file that validates, its title kept', () => {
    expect(imported.title).toBe('Tidewater');
    const result = validateTokenFile(serializeTokens(imported.tokens));
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('maps Claude’s colours onto the roles, keeping each as an extra token the role aliases (the first theme’s values)', () => {
    const v = values(imported.tokens);
    expect(v['color.bg.$root']).toBe('#f7f5f0');
    expect(v['color.bg.raised']).toBe('#ffffff');
    expect(v['color.text.$root']).toBe('#1b2228');
    expect(v['color.text.muted']).toBe('#1b2228a3');
    expect(v['color.accent.$root']).toBe('oklch(0.48 0.12 240)');
    expect(v['color.accent.text']).toBe('#ffffff');
    expect(v['color.border']).toBe('hsl(40 12% 86%)');
    expect([v['color.status.ok'], v['color.status.warn'], v['color.status.error'], v['color.status.info']]).toEqual(['#1f7a4d', '#a35c00', '#b3261e', 'oklch(0.48 0.12 240)']);
    expect(imported.tokens.tokens.get('color.bg.$root')!.$value).toBe('{color.surface}');
    expect(imported.tokens.tokens.get('color.surface')!.$description).toBe('Page background.');
    expect(imported.tokens.groups.get('color')!.$description).toBe('Harbor neutrals with one sea-blue action colour.');
    expect(v['color.link']).toBe('#7bb6ea');
    expect(v['color.ink-2_5']).toBe('#3a434b');
    for (const dropped of ['color.named', 'color.ghost', 'color.bad name']) expect(v[dropped]).toBeUndefined();
  });

  it('maps the families and styles onto the font and type roles', () => {
    const v = values(imported.tokens);
    expect(imported.tokens.tokens.get('font.body')!.$value).toBe('{font.sans}');
    expect(imported.tokens.tokens.get('font.display')!.$value).toBe('{font.serif}');
    expect(imported.tokens.tokens.get('font.mono')!.$value).toBe('{font.code}');
    expect(v['font.sans']).toBe(JSON.stringify(['Tide Sans', 'system-ui', 'sans-serif']));
    const type = (path: string) => JSON.parse(v[path]!) as { fontFamily: unknown; fontSize: unknown; lineHeight: number; fontWeight: number; letterSpacing: unknown };
    expect(type('type.title')).toEqual({ fontFamily: ['Georgia', 'Times New Roman', 'serif'], fontSize: { value: 44, unit: 'px' }, fontWeight: 700, lineHeight: 1.1818, letterSpacing: { value: -0.44, unit: 'px' } });
    expect(imported.tokens.tokens.get('type.title')!.$value).toBe('{type.display}');
    expect(imported.tokens.tokens.get('type.display')!.$value).toMatchObject({ fontFamily: '{font.display}' });
    expect(type('type.subtitle').fontSize).toEqual({ value: 20, unit: 'px' });
    expect(type('type.h1')).toMatchObject({ fontSize: { value: 2, unit: 'rem' }, lineHeight: 1.2, fontWeight: 700 });
    expect(type('type.h3').fontWeight).toBe(500);
    expect(type('type.body')).toMatchObject({ fontSize: { value: 16, unit: 'px' }, lineHeight: 1.5, fontWeight: 400 });
    expect(type('type.caption')).toMatchObject({ fontSize: { value: 13, unit: 'px' }, letterSpacing: { value: 0.2, unit: 'px' } });
    expect(imported.tokens.tokens.get('type.quote')!.$value).toBe('{type.body}');
    expect(imported.tokens.tokens.get('type.label')!.$value).toMatchObject({ fontFamily: '{font.mono}' });
    expect(v['type.broken']).toBeUndefined();
  });

  it('maps spacing, radius, shadow and the further families, filling the role steps Claude’s scale skips', () => {
    const v = values(imported.tokens);
    const px = (path: string) => JSON.parse(v[path]!) as unknown;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => px(`space.${n}`))).toEqual([
      { value: 4, unit: 'px' },
      { value: 8, unit: 'px' },
      { value: 12, unit: 'px' },
      { value: 1, unit: 'rem' },
      { value: 20, unit: 'px' },
      { value: 24, unit: 'px' },
      { value: 28, unit: 'px' },
      { value: 32, unit: 'px' },
    ]);
    expect(px('space.12')).toEqual({ value: 48, unit: 'px' });
    expect(['sm', 'md', 'lg', 'full'].map((r) => px(`radius.${r}`))).toEqual([4, 8, 14, 999].map((value) => ({ value, unit: 'px' })));
    expect(imported.tokens.tokens.get('radius.full')!.$value).toBe('{radius.pill}');
    expect((px('shadow.md') as unknown[]).length).toBe(2);
    expect(px('opacity.disabled')).toBe(0.4);
    expect(px('size.control')).toEqual({ value: 40, unit: 'px' });
  });

  it('keeps every Claude file read-only under sources/claude/, and writes no law', () => {
    expect(imported.sources).toEqual({
      'sources/claude/design-system.json': TIDEWATER_FILES['project/design-system.json'],
      'sources/claude/README.md': TIDEWATER_FILES['project/README.md'],
      'sources/claude/tokens.json': TIDEWATER_FILES['project/tokens.json'],
      'sources/claude/components/Button/README.md': TIDEWATER_FILES['project/components/Button/README.md'],
      'sources/claude/fonts/TideSans-Regular.woff2': TIDEWATER_FILES['project/fonts/TideSans-Regular.woff2'],
    });
    expect(Object.keys(imported)).not.toContain('law');
  });

  it('names what it dropped, renamed, borrowed or filled', () => {
    expect(imported.warnings).toEqual([
      'color: themes after the first (dark) are kept only in sources/claude/tokens.json; a MAWS system has one theme',
      'color "link": no light value; the dark value is used',
      'color "named": "red" is not a colour Claude reads (named colours drop)',
      'color "ghost": the alias {nowhere} names no colour',
      'color "bad name": not a token name Claude reads',
      'type style "broken": fontSize "big" is not a length',
      'spacing "surface": the name is already used by another token',
      'color "ink-2.5" is written as color.ink-2_5 (a token name holds no ".")',
      'type.fonts: 1 font file is kept in sources/claude/fonts/ but not loaded; upload it as an asset to use it',
      'type.quote: no style for it; it follows type.body',
      'space.5, space.7: not in the source; filled from their neighbours',
    ]);
  });

  it('matches roles by name when Claude’s names are not MAWS’s, and fills the rest, naming each', () => {
    const files = {
      'tokens.json': JSON.stringify({
        name: 'Palette',
        color: {
          tokens: ['bg-000:#ffffff', 'bg-100:#f4f4f2', 'fg:#111111', 'fg-subtle:#555555', 'primary-100:#dde7ff', 'primary-500:#2255cc', 'on-primary:#ffffff', 'border-subtle:#e2e2e0'].map((t) => {
            const [name, value] = t.split(':');
            return { name, value };
          }),
        },
        type: { fonts: [], families: { inter: 'Inter, sans-serif' }, groups: [{ name: 'All', family: 'inter', styles: [{ name: 'text-md', fontSize: '15px' }] }] },
        spacing: { tokens: ['xs:4px', 'sm:8px', 'md:16px', 'lg:24px'].map((t) => ({ name: t.split(':')[0], value: t.split(':')[1] })) },
        shadow: { tokens: [{ name: 'elevation-100', value: '0 1px 2px #0000001a' }, { name: 'elevation-200', value: '0 4px 8px #0000001a' }] },
      }),
    };
    const result = fromClaude(files);
    expect(validateTokenFile(serializeTokens(result.tokens)).problems).toEqual([]);
    const at = (path: string) => result.tokens.tokens.get(path)!.$value;
    expect([at('color.bg.$root'), at('color.bg.raised'), at('color.text.$root'), at('color.text.muted')]).toEqual(['{color.bg-000}', '{color.bg-100}', '{color.fg}', '{color.fg-subtle}']);
    expect([at('color.accent.$root'), at('color.accent.text'), at('color.border')]).toEqual(['{color.primary-500}', '{color.on-primary}', '{color.border-subtle}']);
    expect(at('font.body')).toBe('{font.inter}');
    expect(at('type.body')).toBe('{type.text-md}');
    expect([1, 2, 3, 4].map((n) => at(`space.${n}`))).toEqual(['{space.xs}', '{space.sm}', '{space.md}', '{space.lg}']);
    expect(JSON.stringify(values(result.tokens)['space.8'])).toBe(JSON.stringify(JSON.stringify({ value: 56, unit: 'px' })));
    expect([at('shadow.sm'), at('shadow.md')]).toEqual(['{shadow.100}', '{shadow.200}']);
    expect(result.warnings).toEqual([
      'color.status.ok: no colour for it; it takes a neutral default',
      'color.status.warn: no colour for it; it takes a neutral default',
      'color.status.error: no colour for it; it takes a neutral default',
      'color.status.info: no colour for it; it follows color.accent.$root',
      'font.body: no family named for it; it follows the first family, inter',
      'font.display: no family for it; it follows font.body',
      'font.mono: no family for it; it takes the system monospace',
      'type.body: no style for it; it follows type.text-md, the nearest to 16px',
      'type.title: no style for it; it follows type.body',
      'type.subtitle: no style for it; it follows type.body',
      'type.h1: no style for it; it follows type.title',
      'type.h2: no style for it; it follows type.h1',
      'type.h3: no style for it; it follows type.h2',
      'type.caption: no style for it; it follows type.body',
      'type.quote: no style for it; it follows type.body',
      'space.5, space.6, space.7, space.8: not in the source; filled from their neighbours',
      'radius.sm, radius.md, radius.lg, radius.full: not in the source; derived from the other radii',
      'shadow.lg: not in the source; a neutral shadow',
    ]);
  });

  it('reads a system with no tokens.json into the default roles, saying so', () => {
    const bare = fromClaude({ 'README.md': '# Bare\n' });
    expect(validateTokenFile(serializeTokens(bare.tokens)).ok).toBe(true);
    expect(bare.title).toBeNull();
    expect(bare.warnings[0]).toBe('tokens.json is missing; every role takes a neutral default');
  });
});

describe('Claude’s shape: the export (Acceptance 6)', () => {
  const files = toClaude({ name: 'Test system', law: LAW, tokens: completeSet, fonts: [{ family: 'Iowan Old Style', file: 'iowan.woff2', weight: '300 800', style: 'italic' }] });
  const tokens = JSON.parse(files['tokens.json']!) as Record<string, { tokens?: { name: string; value: unknown }[] } & Record<string, unknown>>;

  it('writes tokens.json, with the faces given as type.fonts, and README.md from the law', () => {
    expect(Object.keys(files).sort()).toEqual(['README.md', 'tokens.json']);
    expect(files['README.md']).toBe(LAW);
    expect((tokens.type as { fonts: unknown }).fonts).toEqual([{ family: 'Iowan Old Style', file: 'iowan.woff2', weight: '300 800', style: 'italic' }]);
  });

  it('satisfies Claude’s grammar, in lists, never a DTCG map', () => {
    expect(validateClaudeTokens(tokens)).toEqual([]);
    expect(files['tokens.json']).not.toMatch(/"\$(value|type|extensions|description)"/);
    for (const [key, family] of Object.entries(tokens)) if (key !== 'name' && key !== 'version' && key !== 'type') expect(Array.isArray(family.tokens)).toBe(true);
  });

  it('writes the roles under Claude-style names, colours as hex, type as fonts, families and groups', () => {
    expect(tokens.name).toBe('Test system');
    expect(tokens.color!.themes).toEqual([{ id: 'light', name: 'Light' }]);
    expect(tokens.color!.tokens!.map((t) => [t.name, t.value])).toEqual([
      ['bg', '#faf9f6'],
      ['bg-raised', '#ffffff'],
      ['text', '#1f1e1b'],
      ['text-muted', '#1f1e1b9e'],
      ['accent', '#c9663f'],
      ['accent-text', '#ffffff'],
      ['border', '#14120e1a'],
      ['status-ok', '#1f8f55'],
      ['status-warn', '#b86a1a'],
      ['status-error', '#c93b3b'],
      ['status-info', '#3b6fd1'],
      ['highlight', expect.stringMatching(/^#[0-9a-f]{6}$/)],
    ]);
    const type = tokens.type as { fonts: unknown[]; families: Record<string, string>; groups: { name: string; styles: Record<string, unknown>[] }[] };
    expect(type.fonts).toHaveLength(1);
    expect(type.families).toEqual({ display: '"Iowan Old Style", Georgia, serif', body: 'Inter, "Apple SD Gothic Neo", sans-serif', mono: '"JetBrains Mono"', quote: '"Iowan Old Style", serif' });
    expect(type.groups.map((g) => [g.name, g.styles.map((s) => s.name)])).toEqual([
      ['Text', ['title', 'subtitle', 'h1', 'h2', 'h3', 'body', 'caption', 'quote', 'label']],
      ['Deck', ['deck-title', 'deck-subtitle']],
    ]);
    expect(type.groups[0]!.styles[0]).toEqual({ name: 'title', family: 'display', fontSize: '40px', lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.5px' });
    expect(type.groups[0]!.styles[5]).toMatchObject({ name: 'body', family: 'body', fontSize: '1rem' });
    expect(type.groups[1]!.styles[1]).toEqual({ name: 'deck-subtitle', family: 'body', fontSize: '48px', lineHeight: 1.35, fontWeight: 400, letterSpacing: '0px' });
    expect(tokens.spacing!.tokens!.map((t) => t.name)).toEqual(['space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-7', 'space-8', 'space-0']);
    expect(tokens.radius!.tokens!.map((t) => [t.name, t.value])).toEqual([
      ['radius-sm', '6px'],
      ['radius-md', '10px'],
      ['radius-lg', '14px'],
      ['radius-full', '9999px'],
    ]);
    expect(tokens.shadow!.tokens![0]).toEqual({ name: 'shadow-sm', value: '0px 1px 2px 0px rgb(0 0 0 / 0.08)' });
  });

  it('round-trips: importing the export gives back the system’s values', () => {
    const back = fromClaude(toClaude({ name: 'Test system', law: LAW, tokens: completeSet })); // no faces: an imported face is kept, not loaded
    expect(back.warnings).toEqual([]);
    const before = values(completeSet);
    const after = values(back.tokens);
    for (const path of Object.keys(before).filter((p) => /^(color|font|space|radius|shadow)\./.test(p) || /^type\.(title|subtitle|h[123]|body|caption|quote)$/.test(p))) {
      if (path === 'color.highlight') continue; // an oklch colour comes back as its hex
      expect([path, after[path]]).toEqual([path, before[path]]);
    }
    expect(back.tokens.tokens.get('type.title')!.$extensions?.['dev.maws.deck']).toEqual({ fontSize: { value: 96, unit: 'px' }, lineHeight: 1.05 });
  });
});

describe('Claude’s grammar: validateClaudeTokens', () => {
  it('passes the synthetic fixture save what it was written to drop', () => {
    expect(validateClaudeTokens(TIDEWATER_TOKENS)).toEqual([
      'color "named": "red" is not a colour Claude reads (named colours drop)',
      'color "ghost": the alias {nowhere} names no colour',
      'color "bad name": not a token name Claude reads',
      'type style "broken": fontSize "big" is not a length',
      'spacing "surface": the name is already used by another token',
    ]);
  });

  it('refuses a DTCG map and the values Claude drops', () => {
    expect(
      validateClaudeTokens({
        color: { brand: { $value: '#ff0000', $type: 'color' } },
        spacing: { tokens: [{ name: 'gap', value: 'var(--x)' }] },
        type: {
          fonts: [{ family: 'Inter', file: 'inter.woff2', weight: '100 900' }, { family: '"Inter"', file: 'a.woff2' }, { family: 'Inter' }, { family: 'Inter', file: 'a', weight: 'heavy' }, { family: 'Inter', file: 'a', weight: '0' }, { family: 'Inter', file: 'a', style: 'slanted' }],
          families: { Sans: 'a(b)' },
          groups: [{ name: 'T', family: 'nope', styles: [{ name: 'x', fontSize: '12px', lineHeight: 12 }] }],
        },
        shadow: { tokens: [{ name: 'deep', value: '0 1px var(--c)' }] },
        zIndex: { tokens: [{ name: 'top', value: 'url(x)' }] },
      }),
    ).toEqual([
      'color: a name-to-value map (DTCG); Claude reads only {"tokens": [...]} lists',
      'spacing "gap": "var(--x)" is not a length',
      'type.fonts[1]: family ""Inter"" is not a bare family name',
      'type.fonts[2]: file undefined is not a path',
      'type.fonts[3]: weight "heavy" is not a weight or a range',
      'type.fonts[4]: weight "0" is not a weight or a range',
      'type.fonts[5]: style "slanted" is not normal, italic or oblique',
      'type.families "Sans": a family key is lower-case',
      'type.families "Sans": a stack holds no ; { } < > \\ ( )',
      'type group "T": family "nope" is not in type.families',
      'type style "x": lineHeight 12 is not a length or a number below 10',
      'shadow "deep": "0 1px var(--c)" is not a box-shadow Claude reads',
      'zIndex "top": "url(x)" is not a plain CSS value',
    ]);
  });
});

describe('fix wave 1: the converter’s safety and its guarantees', () => {
  it('never writes through an inherited property: families named __proto__ or constructor stay ordinary groups', () => {
    const text = '{"name":"P","__proto__":{"tokens":[{"name":"polluted","value":"1"}]},"constructor":{"tokens":[{"name":"x","value":"2"}]},"type":{"fonts":[],"families":{"sans":"Inter"},"groups":[{"name":"T","family":"constructor","styles":[{"name":"body","fontSize":"16px","family":"tostring"}]}]}}';
    const result = fromClaude({ 'tokens.json': text });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    expect(validateTokenFile(serializeTokens(result.tokens)).problems).toEqual([]);
    const v = values(result.tokens);
    expect(v['__proto__.polluted']).toBe('1');
    expect(v['constructor.x']).toBe('2');
    expect(validateClaudeTokens(JSON.parse(text))).toEqual([
      'type group "T": family "constructor" is not in type.families',
      'type style "body": family "tostring" is not in type.families',
    ]);
  });

  it('resolves aliases against the namespace that survives deduplication, and the import always validates', () => {
    const json = { color: { tokens: [{ name: 'a', value: '{b}' }, { name: 'b', value: '{a}' }, { name: 'b', value: '#000000' }, { name: 'c', value: '{a}' }] } };
    expect(validateClaudeTokens(json)).toEqual([
      'color "a": the alias {b} is circular or deeper than 16',
      'color "b": the alias {a} is circular or deeper than 16',
      'color "b": the name is already used by another token',
      'color "c": the alias {a} names no colour',
    ]);
    const result = fromClaude({ 'tokens.json': JSON.stringify(json) });
    expect(validateTokenFile(serializeTokens(result.tokens)).ok).toBe(true);
  });

  it('refuses an export Claude’s caps cannot hold, naming why', () => {
    const groups = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`g${i}`, { n: { $type: 'number', $value: i } }]));
    const many = parseTokens({ ...complete, ...groups }).tokens!;
    expect(() => toClaude({ name: 'Many', law: LAW, tokens: many })).toThrow(ClaudeShapeError);
    expect(() => toClaude({ name: 'Many', law: LAW, tokens: many })).toThrow(/13 further families; Claude reads at most 12/);
    const wide = parseTokens({ ...complete, z: Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`n${i}`, { $type: 'number', $value: i }])) }).tokens!;
    expect(() => toClaude({ name: 'Wide', law: LAW, tokens: wide })).toThrow(/z: 61 tokens; Claude reads at most 60 in a further family/);
  });

  it('refuses an export of more than 12 type.families, and the grammar reader reports the overflow it does not read', () => {
    const font = (name: string) => ({ $type: 'fontFamily', $value: [name] });
    const extra = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`x${i}`, font(`Face ${i}`)]));
    const fonts = (complete as { font: object }).font;
    const crowded = parseTokens({ ...complete, font: { ...fonts, ...extra } }).tokens!;
    expect(() => toClaude({ name: 'Crowded', law: LAW, tokens: crowded })).toThrow(ClaudeShapeError);
    expect(() => toClaude({ name: 'Crowded', law: LAW, tokens: crowded })).toThrow(/\d+ type families; Claude reads at most 12/);
    const json = { type: { fonts: [], families: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`f${i}`, `Face${i}`])), groups: [] } };
    expect(validateClaudeTokens(json)).toEqual(['type.families: 14 families; a system holds at most 12 (f12, f13 are not read)']);
  });

  it('names styles in one namespace: an extra style never takes a role’s or a deck style’s name', () => {
    const typed = parseTokens({ ...complete, type: { ...(complete as { type: object }).type, 'deck-title': { $value: '{type.body}' } } }).tokens!;
    const exported = JSON.parse(toClaude({ name: 'T', law: LAW, tokens: typed })['tokens.json']!) as { type: { groups: { styles: { name: string }[] }[] } };
    const names = exported.type.groups.flatMap((g) => g.styles.map((s) => s.name));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('deck-title');
    expect(names).toContain('deck-title-2');
    expect(validateClaudeTokens(exported)).toEqual([]);
  });
});

describe('whole-branch review: a role found by identity (C1)', () => {
  // The model writes a role that gained a child as its group's `$root` (Decision Log 12): `type.title` becomes
  // `type.title.$root` beside `type.title.small`. It is still the title role, and its deck scale still travels.
  it('exports a rehomed type role under its role’s name, with its deck style', () => {
    const title = (complete as { type: { title: object } }).type.title;
    const rehomed = parseTokens(edited(complete, ['type/title', { $root: title, small: { $type: 'number', $value: 2 } }])).tokens!;
    expect(rehomed.tokens.has('type.title.$root')).toBe(true);
    const exported = JSON.parse(toClaude({ name: 'T', law: LAW, tokens: rehomed })['tokens.json']!) as { type: { groups: { name: string; styles: { name: string; fontSize: string }[] }[] } };
    const styles = exported.type.groups.flatMap((g) => g.styles);
    expect(styles.find((s) => s.name === 'title')).toMatchObject({ fontSize: '40px' });
    expect(styles.find((s) => s.name === 'deck-title')).toMatchObject({ fontSize: '96px' });
    expect(styles.map((s) => s.name)).not.toContain('title-2');
    expect(validateClaudeTokens(exported)).toEqual([]);
  });
});
