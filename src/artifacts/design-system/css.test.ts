import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { generateTokensCss } from './css';
import complete from './fixtures/complete.tokens.json';
import { edited } from './fixtures/edit';
import lenient from './fixtures/lenient.tokens.json';
import { cssNamesOf, parseTokens, ROLES, type TokenSet } from './tokens';

const set = (input: unknown): TokenSet => {
  const result = parseTokens(input);
  expect(result.problems).toEqual([]);
  return result.tokens!;
};

// The stylesheet as rules: selector → declarations in order. The generator writes one declaration per line.
function rules(css: string): Map<string, [string, string][]> {
  const out = new Map<string, [string, string][]>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.replace(/\/\*[^]*?\*\//g, '').trim();
    const declarations = match[2]!
      .split(';')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf(':');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as [string, string];
      });
    expect(out.has(selector)).toBe(false);
    out.set(selector, declarations);
  }
  return out;
}
const props = (css: string, scope: string) => new Map(rules(css).get(scope));

const LEDGER_NAMES = ROLES.flatMap((role) => cssNamesOf(role.path, role.type));
const TYPE_ROLES = ['title', 'subtitle', 'h1', 'h2', 'h3', 'body', 'caption', 'quote'];

describe('tokens.css (Acceptance 2)', () => {
  it('defines exactly the ledger’s names plus the extra tokens as --ds-<path>, on the default :root scope', () => {
    const css = generateTokensCss(set(complete));
    const names = [...props(css, ':root').keys()];
    const extras = ['--ds-color-highlight', '--ds-line-focus', '--ds-line-hairline', '--ds-line-ramp', '--ds-motion-ease', '--ds-motion-enter',
      '--ds-motion-fast', '--ds-space-0', '--ds-type-label-size', '--ds-type-label-line', '--ds-type-label-weight'];
    expect(names).toEqual([...LEDGER_NAMES, ...extras]);
  });

  it('writes each value in CSS, with aliases resolved', () => {
    const p = props(generateTokensCss(set(complete)), ':root');
    expect(p.get('--ds-color-bg')).toBe('#faf9f6');
    expect(p.get('--ds-color-accent-text')).toBe('#ffffff'); // {color.bg.raised}
    expect(p.get('--ds-color-text-muted')).toBe('#1f1e1b9e'); // alpha 0.62
    expect(p.get('--ds-color-highlight')).toBe('oklch(0.86 0.12 90)');
    expect(p.get('--ds-font-display')).toBe('"Iowan Old Style", Georgia, serif');
    expect(p.get('--ds-font-body')).toBe('Inter, "Apple SD Gothic Neo", sans-serif');
    expect(p.get('--ds-font-mono')).toBe('"JetBrains Mono"');
    expect(p.get('--ds-type-title-size')).toBe('40px');
    expect(p.get('--ds-type-title-line')).toBe('1.15');
    expect(p.get('--ds-type-title-weight')).toBe('700');
    expect(p.get('--ds-type-h1-weight')).toBe('600'); // "semi-bold"
    expect(p.get('--ds-type-body-size')).toBe('1rem');
    expect(p.get('--ds-space-8')).toBe('4rem');
    expect(p.get('--ds-radius-full')).toBe('9999px');
    expect(p.get('--ds-shadow-sm')).toBe('0px 1px 2px 0px #00000014');
    expect(p.get('--ds-shadow-md')).toBe('0px 4px 12px 0px #14120e1a'); // color {color.border}, offsetY {space.1}
    expect(p.get('--ds-shadow-lg')).toBe('inset 0px 0px 0px 1px #0000000a, 0px 8px 24px 0px #0000001a');
    expect(p.get('--ds-motion-fast')).toBe('120ms');
    expect(p.get('--ds-motion-ease')).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(p.get('--ds-motion-enter')).toBe('120ms cubic-bezier(0.2, 0, 0, 1) 0ms');
    expect(p.get('--ds-line-hairline')).toBe('1px solid #14120e1a');
    expect(p.get('--ds-line-focus')).toBe('dashed'); // CSS cannot draw a dash array: the format's own fallback
    expect(p.get('--ds-line-ramp')).toBe('#c9663f 0%, #ffffff 100%'); // positions clamped to [0, 1]
  });

  it('writes the eight type classes inside the scope, reading the custom properties, with keep-all', () => {
    const css = generateTokensCss(set(complete), { scope: '[data-ds-scope="s1"]' });
    const r = rules(css);
    expect([...r.keys()]).toEqual(['[data-ds-scope="s1"]', ...TYPE_ROLES.map((role) => `[data-ds-scope="s1"] .ds-type-${role}`)]);
    expect(Object.fromEntries(r.get('[data-ds-scope="s1"] .ds-type-title')!)).toEqual({
      'font-family': 'var(--ds-font-display)',
      'font-size': 'var(--ds-type-title-size)',
      'line-height': 'var(--ds-type-title-line)',
      'font-weight': 'var(--ds-type-title-weight)',
      'letter-spacing': '-0.5px',
      'word-break': 'keep-all',
    });
    const body = Object.fromEntries(r.get('[data-ds-scope="s1"] .ds-type-body')!);
    expect(body['font-family']).toBe('var(--ds-font-body)');
    expect(body['letter-spacing']).toBe('var(--ds-space-0)'); // a reference stays a reference
    const quote = Object.fromEntries(r.get('[data-ds-scope="s1"] .ds-type-quote')!);
    expect(quote['font-family']).toBe('"Iowan Old Style", serif'); // a literal family stays literal
  });

  it('keeps a class’s references through a whole-typography alias, so overriding the font or the spacing restyles it', () => {
    const file = edited(
      complete,
      ['type/body/$value', '{type.base}'],
      ['type/base', { $value: { fontFamily: '{font.body}', fontSize: { value: 16, unit: 'px' }, fontWeight: 400, lineHeight: 1.6, letterSpacing: '{space.0}' } }],
      ['type/caption/$value', '{type.body}'], // two links: caption → body → base
    );
    const r = rules(generateTokensCss(set(file)));
    for (const role of ['body', 'caption']) {
      const declarations = Object.fromEntries(r.get(`:root .ds-type-${role}`)!);
      expect(declarations['font-family']).toBe('var(--ds-font-body)');
      expect(declarations['letter-spacing']).toBe('var(--ds-space-0)');
    }
    // Rendered: an override of the font and the spacing after the system restyles both aliased classes.
    const window = new Window();
    const { document } = window;
    document.head.innerHTML = `<style>${generateTokensCss(set(file))}</style><style>:root { --ds-font-body: Override; --ds-space-0: 3px; }</style>`;
    document.body.innerHTML = '<p class="ds-type-body">b</p><p class="ds-type-caption">c</p>';
    for (const role of ['body', 'caption']) {
      const style = window.getComputedStyle(document.querySelector(`.ds-type-${role}`)!);
      expect(style.fontFamily).toBe('Override');
      expect(style.letterSpacing).toBe('3px');
    }
    // An alias whose composite holds literals keeps the literals.
    const literal = edited(complete, ['type/h3/$value', '{type.quote}']);
    expect(Object.fromEntries(rules(generateTokensCss(set(literal))).get(':root .ds-type-h3')!)['font-family']).toBe('"Iowan Old Style", serif');
  });

  it('lets a system switch the Hangul rule off', () => {
    const file = edited(complete, ['$extensions/dev.maws.css', { wordBreak: 'normal' }]);
    const r = rules(generateTokensCss(set(file)));
    expect(new Map(r.get(':root .ds-type-body')).get('word-break')).toBe('normal');
  });

  it('writes the deck scale only in a deck scope, falling back to the document value per property', () => {
    const tokens = set(complete);
    const doc = props(generateTokensCss(tokens, { medium: 'document' }), ':root');
    const deck = props(generateTokensCss(tokens, { medium: 'deck' }), ':root');
    expect(doc.get('--ds-type-title-size')).toBe('40px');
    expect(deck.get('--ds-type-title-size')).toBe('96px');
    expect(deck.get('--ds-type-title-line')).toBe('1.05');
    expect(deck.get('--ds-type-subtitle-size')).toBe('48px');
    expect(deck.get('--ds-type-subtitle-line')).toBe('1.35'); // no deck lineHeight: the document's
    expect(deck.get('--ds-type-body-size')).toBe('1rem'); // no deck scale at all
  });

  it('resolves the lenient fixture the same way (an $extends group, pointers, lenient forms)', () => {
    const p = props(generateTokensCss(set(lenient)), ':root');
    expect(p.get('--ds-radius-sm')).toBe('6px');
    expect(p.get('--ds-radius-lg')).toBe('20px');
    expect(p.get('--ds-color-status-info')).toBe('#3b6fd1');
    expect(p.get('--ds-corner-sm')).toBe('6px');
  });

  it('escapes what could leave a declaration or the <style> element', () => {
    const p = props(
      generateTokensCss(set({ ...structuredClone(complete), font: { ...structuredClone(complete.font), mono: { $value: 'Evil"; } body { x: </style>' } }, 'odd name': { $type: 'number', $value: 1 } })),
      ':root',
    );
    expect(p.get('--ds-font-mono')).toBe('"Evil\\22 \\3b  \\7d  body \\7b  x\\3a  \\3c /style\\3e "');
    expect(p.get('--ds-odd\\20 name')).toBe('1');
  });

  it('is byte-stable for equal input and skips tokens that do not resolve', () => {
    const shuffled = Object.fromEntries(Object.entries(structuredClone(complete)).reverse());
    expect(generateTokensCss(set(shuffled))).toBe(generateTokensCss(set(complete)));
    const broken = edited(complete, ['motion/fast/$value', '{motion.missing}']);
    const p = props(generateTokensCss(set(broken)), ':root');
    expect(p.has('--ds-motion-fast')).toBe(false);
    expect(p.has('--ds-motion-enter')).toBe(false);
    expect(p.get('--ds-color-bg')).toBe('#faf9f6');
  });
});
