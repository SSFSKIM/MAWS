import { describe, expect, it } from 'vitest';
import { LAW_LIMIT_BYTES, parseLaw } from './law';

// A synthetic law in the designer skill's nine sections (guidelines-authoring.md), with the forms parseLaw must read:
// free title words, a `persona:` line, tagged and untagged don'ts, continuation lines, a nested bullet, a fenced block
// whose `##` lines are not headings, and an extra section after 8.
const LAW = `# Harbor — Design system

The committed visual law for Harbor's handouts and decks.

## 0. Stance commitment

\`persona: quiet-editorial\`

Quiet print on warm paper. If a decision is ever ambiguous, choose the more legible option.

## 1. Palette, with usage rules

- \`color.accent\` marks the one action per view.

\`\`\`md
## 2. Not a heading inside a fence
\`\`\`

## 2 — Type roles

Display for titles only.

### 2.1 A numbered sub-heading stays in its section

## 3) Canvas

Flat paper.

## 4. Layout

## 5. Component canon

- layouts/title.html, components/callout.html

## Notes inside five

Unnumbered headings before §8 stay in the section they sit in.

## 6. Voice

## 7. Motion

## 8. Hard don'ts

- No colour literal in canon. [check: literal-color]
- No gradient,
  anywhere. [check: no-gradient] [check: no-shadow]
* At most one accent per slide [check: accent-max:1, max-words:40]
- No pastel fills.
  - not even for charts
1. No made-up check. [check: sparkle]

A paragraph after the list is not a don't.

## 9. Imagery

Photographs only.

## Appendix

Kept as an extra section.
`;

describe('the law: parseLaw (Acceptance 4)', () => {
  const law = parseLaw(LAW);

  it('splits the nine sections in order by their heading numbers, the title words free', () => {
    expect(law.problems).toEqual([]);
    expect(law.sections.map((s) => s.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(law.sections.map((s) => s.title)).toEqual([
      'Stance commitment',
      'Palette, with usage rules',
      'Type roles',
      'Canvas',
      'Layout',
      'Component canon',
      'Voice',
      'Motion',
      "Hard don'ts",
    ]);
    expect(law.title).toBe('Harbor — Design system');
    expect(law.preamble).toContain("The committed visual law for Harbor's handouts and decks.");
  });

  it('keeps a fenced block, numbered sub-headings and unnumbered headings inside their section', () => {
    const [, palette, type, , , canon] = law.sections;
    expect(palette!.body).toContain('## 2. Not a heading inside a fence');
    expect(type!.body).toContain('### 2.1 A numbered sub-heading stays in its section');
    expect(canon!.body).toContain('## Notes inside five');
    expect(canon!.body).toContain('Unnumbered headings before §8');
  });

  it('records each section heading line and body', () => {
    const stance = law.sections[0]!;
    expect(stance.line).toBe(5);
    expect(stance.heading).toBe('## 0. Stance commitment');
    expect(stance.body).toContain('If a decision is ever ambiguous');
  });

  it('reads the persona: line in §0', () => {
    expect(law.persona).toBe('quiet-editorial');
    expect(parseLaw('## 0. Stance\n\n**persona:** noir\n').persona).toBe('noir');
    expect(parseLaw('## 0. Stance\n\n- persona: `swiss`\n').persona).toBe('swiss');
    expect(parseLaw('## 0. Stance\n\nNo persona governs.\n').persona).toBeNull();
    // A persona line outside §0 is not the record.
    expect(parseLaw('## 0. Stance\n\n## 1. Palette\n\npersona: noir\n').persona).toBeNull();
  });

  it('makes each top-level bullet of §8 one hard don’t, with its [check: …] tags', () => {
    expect(law.donts.map((d) => d.text)).toEqual([
      'No colour literal in canon.',
      'No gradient, anywhere.',
      'At most one accent per slide',
      'No pastel fills. - not even for charts',
      'No made-up check.',
    ]);
    expect(law.donts.map((d) => d.tags.map((t) => t.raw))).toEqual([['literal-color'], ['no-gradient', 'no-shadow'], ['accent-max:1', 'max-words:40'], [], ['sparkle']]);
    expect(law.donts[2]!.tags).toEqual([
      { raw: 'accent-max:1', name: 'accent-max', param: '1' },
      { raw: 'max-words:40', name: 'max-words', param: '40' },
    ]);
    expect(law.donts[0]!.tags[0]).toEqual({ raw: 'literal-color', name: 'literal-color', param: null });
    expect(law.donts.map((d) => d.index)).toEqual([0, 1, 2, 3, 4]);
    expect(law.donts[1]!.line).toBe(46);
  });

  it('keeps the sections after 8 as extra sections', () => {
    expect(law.extras.map((s) => [s.number, s.title])).toEqual([
      [9, 'Imagery'],
      [null, 'Appendix'],
    ]);
    expect(law.sections[8]!.body).not.toContain('Photographs only.');
    expect(law.extras[1]!.body).toContain('Kept as an extra section.');
  });

  it('reports a missing section, a section out of order, a repeated one and an empty §8', () => {
    const broken = parseLaw('## 0. Stance\n\n## 2. Type\n\n## 1. Palette\n\n## 1. Palette again\n\n## 8. Hard don’ts\n\nNone yet.\n');
    expect(broken.problems.map((p) => p.message)).toEqual([
      'section 1 (Palette) comes after section 2; the sections run 0 to 8 in order',
      'section 1 appears twice; the second is kept as an extra section',
      'section 3 (Canvas, texture and material) is missing',
      'section 4 (Layout system) is missing',
      'section 5 (Component canon) is missing',
      'section 6 (Voice) is missing',
      'section 7 (Motion) is missing',
      'section 8 lists no hard don’ts; each bullet there is one forbidden rule',
    ]);
    expect(broken.problems[0]!.line).toBe(5);
    expect(broken.sections.map((s) => s.number)).toEqual([0, 2, 1, 8]);
    expect(broken.extras.map((s) => s.title)).toEqual(['Palette again']);
  });

  it('reports every section missing for a law without numbered sections, and an oversized law', () => {
    const empty = parseLaw('# Just a title\n\nSome words.\n');
    expect(empty.sections).toEqual([]);
    expect(empty.problems).toHaveLength(9);
    expect(empty.problems[0]!.message).toBe('section 0 (Stance commitment) is missing');
    expect(empty.title).toBe('Just a title');

    const big = parseLaw(LAW + 'x'.repeat(LAW_LIMIT_BYTES));
    expect(big.problems.map((p) => p.message)).toContain(`the law is ${new TextEncoder().encode(LAW + 'x'.repeat(LAW_LIMIT_BYTES)).length} bytes; a law holds at most ${LAW_LIMIT_BYTES}`);
  });

  it('reads CRLF line endings and a § in the heading', () => {
    const law2 = parseLaw('## §0 Stance\r\n\r\npersona: noir\r\n\r\n## §8 Hard don’ts\r\n\r\n- No shadow. [check: no-shadow]\r\n');
    expect(law2.sections.map((s) => s.number)).toEqual([0, 8]);
    expect(law2.persona).toBe('noir');
    expect(law2.donts[0]!.tags[0]!.name).toBe('no-shadow');
  });
});
