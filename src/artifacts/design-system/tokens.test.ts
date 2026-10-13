import { describe, expect, it } from 'vitest';
import complete from './fixtures/complete.tokens.json';
import { edited } from './fixtures/edit';
import lenient from './fixtures/lenient.tokens.json';
import { resolveTokens } from './resolve';
import { cssNamesOf, parseTokens, ROLES, serializeTokens, validateTokenFile, type TokenProblem, type TokenSet } from './tokens';

const clone = <T>(value: T): T => structuredClone(value);
const parsed = (input: unknown): TokenSet => {
  const result = parseTokens(input);
  expect(result.problems).toEqual([]);
  return result.tokens!;
};
const problemsAt = (problems: readonly TokenProblem[], path: string) => problems.filter((p) => p.path === path).map((p) => p.message);
const resolvedValue = (input: unknown, path: string) => resolveTokens(parsed(input)).tokens.get(path)?.value;
// Each object's keys in written order, by the dotted path of the object: the serializer writes one key per line wherever
// an object does not fit on one line, and always for groups and tokens.
function keyOrder(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>([['', []]]);
  const stack: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^( *)"((?:[^"\\]|\\.)*)": (.*)$/.exec(line);
    if (!match) continue;
    const depth = match[1]!.length / 2 - 1;
    stack.length = depth;
    const parent = stack.join('.');
    out.set(parent, [...(out.get(parent) ?? []), match[2]!]);
    stack.push(match[2]!);
  }
  return out;
}

describe('the token file: validation (Acceptance 1)', () => {
  it('accepts a DTCG 2025.10 file that defines every role, in the object forms and in the lenient ones', () => {
    for (const file of [complete, lenient]) {
      const result = validateTokenFile(file);
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('accepts the file as JSON text too, and names a syntax error', () => {
    expect(validateTokenFile(JSON.stringify(complete)).ok).toBe(true);
    const broken = validateTokenFile('{"color": ');
    expect(broken.ok).toBe(false);
    expect(broken.problems).toHaveLength(1);
    expect(broken.problems[0]!.path).toBe('');
    expect(broken.problems[0]!.message).toMatch(/JSON/);
  });

  it('refuses a missing role, a cycle, a bad colour and an unknown $type in one pass, each named by its path', () => {
    const file = edited(
      complete,
      ['color/status/info', undefined], // a missing role
      ['color/text/muted/$value', '{color.border}'], // a cycle: muted → border → muted
      ['color/border/$value', '{color.text.muted}'],
      ['color/bg/raised/$value', { colorSpace: 'srgb', components: [1.2, 0, 0] }], // a bad colour
      ['motion/fast/$type', 'time'], // an unknown $type
    );
    const { ok, problems } = validateTokenFile(file);
    expect(ok).toBe(false);
    expect(problemsAt(problems, 'color.status.info').join()).toMatch(/missing role.*--ds-color-status-info/);
    expect(problemsAt(problems, 'color.text.muted').join()).toMatch(/circular reference: color\.text\.muted → color\.border → color\.text\.muted/);
    expect(problemsAt(problems, 'color.border').join()).toMatch(/circular reference/);
    expect(problemsAt(problems, 'color.bg.raised').join()).toMatch(/\$value\.components\[0\].*between 0 and 1/);
    expect(problemsAt(problems, 'motion.fast').join()).toMatch(/unknown \$type "time"/);
    // A role that is present but broken is reported once, as broken, not again as missing.
    expect(problemsAt(problems, 'color.bg.raised').join()).not.toMatch(/missing role/);
    // The token that leans on a broken one says so (motion.enter's duration is motion.fast).
    expect(problemsAt(problems, 'motion.enter').join()).toMatch(/motion\.fast/);
  });

  it('refuses a role of the wrong type, a group in a role’s place, and a reference to a group', () => {
    const file = edited(
      complete,
      ['space/3', { $type: 'number', $value: 12 }],
      ['color/accent', { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 1] } }], // a token where the group with $root goes
      ['line/hairline/$value/color', '{color.status}'],
    );
    const { problems } = validateTokenFile(file);
    expect(problemsAt(problems, 'space.3').join()).toMatch(/role .* must be a dimension, not a number/);
    expect(problemsAt(problems, 'color.accent.$root').join()).toMatch(/missing role.*color\.accent is a token; the role needs color\.accent\.\$root/);
    expect(problemsAt(problems, 'color.accent.text').join()).toMatch(/missing role/);
    expect(problemsAt(problems, 'line.hairline').join()).toMatch(/\{color\.status\} names a group, not a token/);
  });

  it('refuses a reference to a group’s base token without $root, and suggests it', () => {
    const file = edited(complete, ['color/accent/text/$value', '{color.bg}']);
    expect(problemsAt(validateTokenFile(file).problems, 'color.accent.text').join()).toMatch(/did you mean \{color\.bg\.\$root\}/);
  });

  it('refuses the structural mistakes the format names', () => {
    const { problems } = validateTokenFile({
      ...clone(complete),
      both: { $value: 1, $type: 'number', child: { $value: 2, $type: 'number' } }, // a token with children
      'a.b': { $value: 1, $type: 'number' }, // a period in a name
      untyped: { $value: 4 }, // no type anywhere
      typo: { $type: 'number', $valeu: 1 }, // an unknown $ property
      weight: { $type: 'fontWeight', $value: '700' }, // a numeric string is not a weight (the format: MUST be rejected)
    });
    expect(problemsAt(problems, 'both').join()).toMatch(/both \$value and child/);
    expect(problems.some((p) => /"a\.b".*must not contain/.test(p.message))).toBe(true);
    expect(problemsAt(problems, 'untyped').join()).toMatch(/no \$type/);
    expect(problemsAt(problems, 'typo').join()).toMatch(/unknown property "\$valeu"/);
    expect(problemsAt(problems, 'weight').join()).toMatch(/font weight/);
  });

  it('refuses two tokens that would write the same CSS name', () => {
    const { problems } = validateTokenFile({ ...clone(complete), 'color-bg': { $type: 'color', $value: '#000000' } });
    expect(problemsAt(problems, 'color-bg').join()).toMatch(/--ds-color-bg.*color\.bg\.\$root/);
  });

  it('holds a system to the limits: 512 tokens, 64 tokens in a group', () => {
    const wide: Record<string, unknown> = { $type: 'number' };
    for (let i = 0; i < 65; i++) wide[`n${i}`] = { $value: i };
    expect(problemsAt(validateTokenFile({ ...clone(complete), wide }).problems, 'wide').join()).toMatch(/65 tokens.*64/);
    const many: Record<string, unknown> = {};
    for (let g = 0; g < 9; g++) {
      const group: Record<string, unknown> = { $type: 'number' };
      for (let i = 0; i < 60; i++) group[`n${i}`] = { $value: i };
      many[`g${g}`] = group;
    }
    expect(problemsAt(validateTokenFile({ ...clone(complete), ...many }).problems, '').join()).toMatch(/at most 512/);
  });
});

describe('the token file: the model', () => {
  it('inherits $type from the closest group, and a reference takes its target’s type', () => {
    const resolved = resolveTokens(parsed(complete)).tokens;
    expect(resolved.get('space.3')?.type).toBe('dimension');
    expect(resolved.get('color.accent.text')?.type).toBe('color'); // an alias under a color group
    expect(resolveTokens(parsed({ a: { $type: 'number', $value: 2 }, g: { $type: 'color', b: { $value: '{a}' } } })).tokens.get('g.b')?.type).toBe('number');
  });

  it('resolves aliases, chained and inside composites', () => {
    expect(resolvedValue(complete, 'color.accent.text')).toEqual({ colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' });
    const title = resolvedValue(complete, 'type.title') as Record<string, unknown>;
    expect(title.fontFamily).toEqual(['Iowan Old Style', 'Georgia', 'serif']);
    expect(title.fontWeight).toBe(700);
    const enter = resolvedValue(complete, 'motion.enter') as Record<string, unknown>;
    expect(enter.duration).toEqual({ value: 120, unit: 'ms' });
    expect(enter.timingFunction).toEqual([0.2, 0, 0, 1]);
    const chain = { a: { $type: 'dimension', $value: 4 }, b: { $value: '{a}' }, c: { $value: '{b}' } };
    expect(resolvedValue(chain, 'c')).toEqual({ value: 4, unit: 'px' });
  });

  it('resolves weights given by name to their numbers', () => {
    expect((resolvedValue(complete, 'type.h1') as Record<string, unknown>).fontWeight).toBe(600);
    expect((resolvedValue(complete, 'type.body') as Record<string, unknown>).fontWeight).toBe(400);
  });

  it('reads $ref pointers: a whole-token pointer becomes the alias it equals, a property pointer resolves in place', () => {
    const set = parsed(lenient);
    expect(set.tokens.get('color.accent.text')?.$value).toBe('{color.bg.raised}');
    expect(resolvedValue(lenient, 'color.status.info')).toEqual({ colorSpace: 'srgb', components: [0.2314, 0.4353, 0.8196], hex: '#3b6fd1' });
    // The format's own example (§7.3.2): a pointer into a dimension's parts.
    const parts = {
      base: { spacing: { $type: 'dimension', $value: { value: 16, unit: 'px' } } },
      layout: {
        $type: 'dimension',
        small: { $value: { value: { $ref: '#/base/spacing/$value/value' }, unit: 'rem' } },
        large: { $value: { value: 32, unit: { $ref: '#/base/spacing/$value/unit' } } },
      },
    };
    expect(resolvedValue(parts, 'layout.small')).toEqual({ value: 16, unit: 'rem' });
    expect(resolvedValue(parts, 'layout.large')).toEqual({ value: 32, unit: 'px' });
    // A pointer to a whole token object is an alias; a pointer to a group is $extends (§6.4.1).
    const objects = { base: { $type: 'number', $value: 3 }, alias: { $ref: '#/base' }, g: { $type: 'number', x: { $value: 1 } }, h: { $ref: '#/g', y: { $value: 2 } } };
    const set2 = parsed(objects);
    expect(set2.tokens.get('alias')?.$value).toBe('{base}');
    expect(set2.groups.get('h')?.$extends).toBe('{g}');
    expect(resolveTokens(set2).tokens.get('h.x')?.value).toBe(1);
  });

  it('extends a group: inherited tokens appear, local ones override, and cycles are refused', () => {
    const resolved = resolveTokens(parsed(lenient)).tokens;
    expect(resolved.get('radius.sm')).toMatchObject({ value: { value: 6, unit: 'px' }, inherited: true });
    expect(resolved.get('radius.lg')).toMatchObject({ value: { value: 20, unit: 'px' }, inherited: false });
    const { problems } = resolveTokens(parsed({ a: { $extends: '{b}' }, b: { $extends: '{c}' }, c: { $extends: '{a}' } }));
    expect(problems.map((p) => p.path).sort()).toEqual(['a', 'b', 'c']);
    expect(problems[0]!.message).toMatch(/circular \$extends/);
    // A nested group takes the type its counterpart in the extended group has; a local token hides what is beneath it.
    const nested = resolveTokens(
      parsed({
        base: { $type: 'dimension', inner: { $type: 'number', a: { $value: 1 } }, solid: { x: { $value: 2 } } },
        ext: { $extends: '{base}', inner: { b: { $value: 2 } }, solid: { $type: 'number', $value: 3 } },
      }),
    );
    expect(nested.problems).toEqual([]);
    expect(nested.tokens.get('ext.inner.b')).toMatchObject({ type: 'number', value: 2 });
    expect(nested.tokens.get('ext.inner.a')).toMatchObject({ type: 'number', value: 1, inherited: true });
    expect(nested.tokens.get('ext.solid')).toMatchObject({ type: 'number', value: 3 });
    expect(nested.tokens.has('ext.solid.x')).toBe(false);
    const self = resolveTokens(parsed({ button: { $type: 'number', size: { $value: 1 }, secondary: { $extends: '{button}' } } }));
    expect(problemsAt(self.problems, 'button.secondary').join()).toMatch(/circular \$extends/);
  });

  it('inherits through a nested group’s own $extends, whichever group sorts first', () => {
    // `a` extends `z`, whose nested `inner` extends `mix`: a.inner.x comes from mix through two extensions.
    const forward = resolveTokens(parsed({ mix: { $type: 'number', x: { $value: 7 } }, z: { inner: { $extends: '{mix}' } }, a: { $extends: '{z}' } }));
    expect(forward.problems).toEqual([]);
    expect(forward.tokens.get('z.inner.x')).toMatchObject({ type: 'number', value: 7, inherited: true });
    expect(forward.tokens.get('a.inner.x')).toMatchObject({ type: 'number', value: 7, inherited: true });
    // The same with the extended group sorting after the one that extends it.
    const backward = resolveTokens(parsed({ mix: { $type: 'number', x: { $value: 7 } }, b: { $extends: '{z}' }, z: { inner: { $extends: '{mix}' } } }));
    expect(backward.problems).toEqual([]);
    expect(backward.tokens.get('b.inner.x')).toMatchObject({ type: 'number', value: 7, inherited: true });
    // A local override beneath the nested extension still wins.
    const local = resolveTokens(parsed({ mix: { $type: 'number', x: { $value: 7 } }, z: { inner: { $extends: '{mix}' } }, a: { $extends: '{z}', inner: { x: { $value: 8 } } } }));
    expect(local.tokens.get('a.inner.x')).toMatchObject({ value: 8, inherited: false });
  });

  it('tracks pointer cycles by value location: a token may point into its own value, a real loop is refused', () => {
    const acyclic = resolveTokens(parsed({ a: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.5, { $ref: '#/a/$value/components/0' }, 0] } } }));
    expect(acyclic.problems).toEqual([]);
    expect(acyclic.tokens.get('a')?.value).toEqual({ colorSpace: 'srgb', components: [0.5, 0.5, 0], hex: '#808000' });
    const loop = resolveTokens(
      parsed({ a: { $type: 'color', $value: { colorSpace: 'srgb', components: [{ $ref: '#/a/$value/components/1' }, { $ref: '#/a/$value/components/0' }, 0] } } }),
    );
    expect(loop.tokens.has('a')).toBe(false);
    expect(problemsAt(loop.problems, 'a').join()).toMatch(/circular reference/);
    // Across tokens: b points into a, whose component points back into b.
    const across = resolveTokens(
      parsed({
        a: { $type: 'color', $value: { colorSpace: 'srgb', components: [{ $ref: '#/b/$value/components/0' }, 0, 0] } },
        b: { $type: 'color', $value: { colorSpace: 'srgb', components: [{ $ref: '#/a/$value/components/0' }, 0, 0] } },
      }),
    );
    expect(across.tokens.size).toBe(0);
    expect(problemsAt(across.problems, 'a').join()).toMatch(/circular reference/);
    expect(problemsAt(across.problems, 'b').join()).toMatch(/circular reference/);
    // Pointing into another token's resolved value is still fine.
    const other = resolveTokens(parsed({ a: { $type: 'number', $value: 3 }, b: { $type: 'dimension', $value: { value: { $ref: '#/a/$value' }, unit: 'px' } } }));
    expect(other.problems).toEqual([]);
    expect(other.tokens.get('b')?.value).toEqual({ value: 3, unit: 'px' });
  });

  it('keeps $description, $deprecated and every $extensions entry, ours and others’', () => {
    const set = parsed(complete);
    expect(set.groups.get('')?.$extensions?.['com.example.tool']).toEqual({ z: 1, a: [2, 1] });
    expect(set.tokens.get('color.highlight')?.$deprecated).toBe('Use color.accent for emphasis.');
    expect(set.tokens.get('color.accent.text')?.$description).toBe('Text on an accent ground.');
    const reparsed = JSON.parse(serializeTokens(set));
    expect(reparsed.$extensions['com.example.tool']).toEqual({ a: [2, 1], z: 1 });
    expect(reparsed.type.title.$extensions['dev.maws.deck']).toEqual({ fontSize: { value: 96, unit: 'px' }, lineHeight: 1.05 });
  });

  it('validates MAWS’s own extensions', () => {
    const file = edited(
      complete,
      ['$extensions/dev.maws.office/theme/dk1', 'black'],
      ['$extensions/dev.maws.office/theme/accent7', '#000000'],
      ['$extensions/dev.maws.office/fonts/major', { latin: 3 }],
      ['$extensions/dev.maws.css', { wordBreak: 'sometimes' }],
      ['type/h1/$extensions', { 'dev.maws.deck': { fontSize: 'huge' } }],
    );
    const { problems } = validateTokenFile(file);
    const root = problemsAt(problems, '').join('\n');
    expect(root).toMatch(/dev\.maws\.office.*theme\.dk1/);
    expect(root).toMatch(/dev\.maws\.office.*accent7/);
    expect(root).toMatch(/dev\.maws\.office.*fonts\.major\.latin/);
    expect(root).toMatch(/dev\.maws\.css.*wordBreak/);
    expect(problemsAt(problems, 'type.h1').join()).toMatch(/dev\.maws\.deck.*fontSize/);
  });

  it('names the CSS properties of each role exactly as the ledger fixes them', () => {
    const names = ROLES.flatMap((role) => cssNamesOf(role.path, role.type));
    expect(names).toEqual([
      '--ds-color-bg', '--ds-color-bg-raised', '--ds-color-text', '--ds-color-text-muted', '--ds-color-accent', '--ds-color-accent-text', '--ds-color-border',
      '--ds-color-status-ok', '--ds-color-status-warn', '--ds-color-status-error', '--ds-color-status-info',
      '--ds-font-display', '--ds-font-body', '--ds-font-mono',
      ...['title', 'subtitle', 'h1', 'h2', 'h3', 'body', 'caption', 'quote'].flatMap((r) => [`--ds-type-${r}-size`, `--ds-type-${r}-line`, `--ds-type-${r}-weight`]),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--ds-space-${n}`),
      '--ds-radius-sm', '--ds-radius-md', '--ds-radius-lg', '--ds-radius-full',
      '--ds-shadow-sm', '--ds-shadow-md', '--ds-shadow-lg',
    ]);
  });
});

describe('the token file: canonical writing', () => {
  it('writes the lenient forms as the object forms', () => {
    const written = JSON.parse(serializeTokens(parsed(lenient)));
    expect(written.color.bg.$root.$value).toEqual({ colorSpace: 'srgb', components: [0.9804, 0.9765, 0.9647], hex: '#faf9f6' });
    expect(written.color.text.muted.$value).toEqual({ colorSpace: 'srgb', components: [0.1216, 0.1176, 0.1059], alpha: 0.6196, hex: '#1f1e1b' });
    expect(written.color.status.warn.$value.hex).toBe('#b86a1a'); // hex added to an srgb value
    expect(written.color.status.error.$value.hex).toBe('#c93b3b'); // a hex that disagrees with the components is rewritten from them
    expect(written.space['1'].$value).toEqual({ value: 4, unit: 'px' });
    expect(written.space['8'].$value).toEqual({ value: 4, unit: 'rem' });
    expect(written.motion.fast.$value).toEqual({ value: 120, unit: 'ms' });
    expect(written.motion.slow.$value).toEqual({ value: 400, unit: 'ms' });
    expect(written.font.display.$value).toEqual(['Iowan Old Style', 'Georgia', 'serif']);
    expect(written.font.body.$value).toEqual(['Inter', 'Apple SD Gothic Neo', 'sans-serif']);
    expect(written.font.mono.$value).toBe('Menlo');
    // typography: lenient sizes become dimensions, and an absent letterSpacing is written as 0px (the format lists all five)
    expect(written.type.title.$value).toEqual({
      fontFamily: '{font.display}', fontSize: { value: 40, unit: 'px' }, fontWeight: 'bold', lineHeight: 1.15, letterSpacing: { value: 0, unit: 'px' },
    });
    expect(written.shadow.sm.$value.color).toEqual({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.0784, hex: '#000000' });
    expect(written.shadow.sm.$value.offsetY).toEqual({ value: 1, unit: 'px' });
    // a property pointer is kept as written
    expect(written.color.status.info.$value.components[0]).toEqual({ $ref: '#/color/status/error/$value/components/1' });
  });

  it('orders keys canonically: the roles in the ledger’s order, then the other paths alphabetically, $ properties first', () => {
    const shuffled = Object.fromEntries(Object.entries(clone(complete)).reverse());
    const text = serializeTokens(parsed(shuffled));
    expect(text).toBe(serializeTokens(parsed(complete)));
    const keys = keyOrder(text); // read off the text: JSON.parse would move integer-like keys ("1") first
    expect(keys.get('')).toEqual(['$description', '$extensions', 'color', 'font', 'type', 'space', 'radius', 'shadow', 'line', 'motion']);
    expect(keys.get('color')).toEqual(['$type', 'bg', 'text', 'accent', 'border', 'status', 'highlight']);
    expect(keys.get('color.bg')).toEqual(['$root', 'raised']);
    expect(keys.get('space')).toEqual(['$type', '1', '2', '3', '4', '5', '6', '7', '8', '0']);
    expect(keys.get('type')).toEqual(['$type', ...['title', 'subtitle', 'h1', 'h2', 'h3', 'body', 'caption', 'quote'], 'label']);
    expect(keys.get('type.title')).toEqual(['$value', '$extensions']);
    expect(keys.get('color.highlight')).toEqual(['$value', '$deprecated']);
    expect(keys.get('motion.fast')).toEqual(['$type', '$value']);
    expect(keys.get('$extensions')).toEqual(['com.example.tool', 'dev.maws.office']);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('is a fixed point after one pass, over the fixtures and every lenient form', () => {
    const forms: unknown[] = [
      complete,
      lenient,
      { a: { $type: 'color', $value: '#ABC' } },
      { a: { $type: 'color', $value: '#aabbcc80' } },
      { a: { $type: 'color', $value: '#ffff' } }, // opaque alpha written in hex: dropped on the first pass, as an object's is
      { a: { $type: 'color', $value: '#ffffffff' } },
      { a: { $type: 'dimension', $value: 3 }, b: { $type: 'dimension', $value: '1.5rem' } },
      { a: { $type: 'duration', $value: 200 }, b: { $type: 'duration', $value: '0.2s' } },
      { a: { $type: 'fontFamily', $value: 'A, "B C", serif' } },
      { a: { $type: 'typography', $value: { fontFamily: 'X', fontSize: 12, fontWeight: 400, lineHeight: 1 } } },
      { a: { $type: 'shadow', $value: { color: '#0003', offsetX: 0, offsetY: 1, blur: 2, spread: 0 } } },
      { a: { $type: 'number', $value: 1 }, b: { $ref: '#/a/$value' }, g: { $type: 'number', x: { $value: 1 } }, h: { $ref: '#/g' } },
      { a: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.5, 0.5, 0.5], hex: '#FFFFFF' } } },
      { e: { $description: 'empty group', $extensions: { 'org.x': { b: 1, a: 2 } } } },
    ];
    for (const form of forms) {
      const once = serializeTokens(parsed(form));
      const twice = serializeTokens(parsed(once));
      expect(twice).toBe(once);
    }
  });

  it('keeps meaning: the resolved values of a file equal those of its canonical rewrite', () => {
    for (const file of [complete, lenient]) {
      const before = resolveTokens(parsed(file)).tokens;
      const after = resolveTokens(parsed(serializeTokens(parsed(file)))).tokens;
      expect([...after.entries()].map(([k, v]) => [k, v.type, v.value])).toEqual([...before.entries()].map(([k, v]) => [k, v.type, v.value]));
    }
  });
});
