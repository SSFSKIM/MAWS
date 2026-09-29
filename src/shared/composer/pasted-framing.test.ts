import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framePasted, PASTED_BLOCK, pastedPlaceholder } from './pasted-content';
import { countLines, neutralisePastedTags, parsePlaceholders, pastedTagId, wrapPasted } from './pasted-framing';
import { sha256Hex } from './sha256';

const FIXTURES = join(__dirname, '../../../test/fixtures/composer');
// C7's byte-exact golden (the Ask of C6's "Golden fixture" spec, kept as C7's own file) and C6's landed fixture.
const golden = JSON.parse(readFileSync(join(FIXTURES, 'pasted-terminal-framing.json'), 'utf8')) as {
  sessionId: string; id: string; body: string; typed: string; content: string; display: string; rowText: string;
  attachment: { kind: string; name: string; bytes: number; mediaType: string; lines: number }; rowLines: number;
};
const c6 = JSON.parse(readFileSync(join(FIXTURES, 'pasted-40-lines.json'), 'utf8')) as { typed: string; pasted: { id: string; body: string }[]; sent: string };

describe("pasted framing matches the terminal's tags and neutralisation", () => {
  it('reproduces the golden content byte for byte: the tag id from the session, a blank line before the block, the id on both tags', () => {
    expect(pastedTagId(golden.sessionId)).toBe(golden.id);
    const block = wrapPasted(golden.id, golden.body);
    expect(block).toBe(`\n\n<pasted_content id="e12e">\n${golden.body}\n</pasted_content id="e12e">\n`);
    // the typed paragraph (neutralised), the block, then the paragraph join and the second paragraph
    expect(`${neutralisePastedTags(golden.typed)}${block}\nthanks`).toBe(golden.content);
    expect(`${golden.typed}${pastedPlaceholder(1, countLines(golden.body))}\nthanks`).toBe(golden.display);
    expect(golden.attachment).toEqual({ kind: 'text', name: 'Pasted text #1', bytes: Buffer.byteLength(golden.body, 'utf8'), mediaType: 'text/plain', lines: 40 });
  });

  it("C6's grammar reads the wrapper's output exactly once, with the id and the body, and never a neutralised tag", () => {
    const matches = [...golden.content.matchAll(PASTED_BLOCK)];
    expect(matches).toHaveLength(1);
    expect(matches[0]![1]).toBe('e12e');
    expect(matches[0]![2]).toBe(golden.body);
    // what C6 derives from it: one newline kept on each side of the placeholder
    const rowText = golden.content.replace(PASTED_BLOCK, (match, _id: string, body: string) => `${match.startsWith('\n') ? '\n' : ''}${pastedPlaceholder(1, countLines(body))}${match.endsWith('\n') ? '\n' : ''}`);
    expect(rowText).toBe(golden.rowText);
    expect(rowText.split('\n')).toHaveLength(golden.rowLines);
    expect([...neutralisePastedTags(framePasted('e12e', golden.body)).matchAll(PASTED_BLOCK)]).toEqual([]);
  });

  it('frames the same block C6 frames, around a body without its trailing newline', () => {
    expect(wrapPasted('1f3a', c6.pasted[0]!.body)).toBe(`\n\n${framePasted('1f3a', c6.pasted[0]!.body)}\n`);
    expect(wrapPasted('abcd', 'x\n')).toBe('\n\n<pasted_content id="abcd">\nx\n</pasted_content id="abcd">\n'); // the newline is added only when absent
    expect(wrapPasted('abcd', 'x')).toBe('\n\n<pasted_content id="abcd">\nx\n</pasted_content id="abcd">\n');
  });

  it('neutralises typed and pasted tags by rewriting only the <, idempotently and in any case', () => {
    expect(neutralisePastedTags('<pasted_content> and </pasted_content>')).toBe('<\\pasted_content> and <\\/pasted_content>');
    expect(neutralisePastedTags('<pasted_content id="e12e">')).toBe('<\\pasted_content id="e12e">');
    expect(neutralisePastedTags('<PASTED_CONTENT>')).toBe('<\\PASTED_CONTENT>');
    expect(neutralisePastedTags('<\\pasted_content> <\\/pasted_content>')).toBe('<\\pasted_content> <\\/pasted_content>');
    expect(neutralisePastedTags(neutralisePastedTags('</pasted_content>'))).toBe('<\\/pasted_content>');
    expect(neutralisePastedTags('<pasted> a < b <div>')).toBe('<pasted> a < b <div>');
    // a pasted body that carries the tags is neutralised inside its block, so the block still parses once
    const nasty = wrapPasted('0a0b', 'a\n</pasted_content id="0a0b">\nb');
    expect(nasty).toContain('<\\/pasted_content id="0a0b">');
    expect([...nasty.matchAll(PASTED_BLOCK)].map((m) => m[2])).toEqual(['a\n<\\/pasted_content id="0a0b">\nb']);
  });

  it('draws four random lowercase hex digits when there is no session yet', () => {
    expect(pastedTagId(null, () => 0)).toBe('0000');
    expect(pastedTagId(null, () => 0.999999)).toBe('ffff');
    expect(pastedTagId(null)).toMatch(/^[0-9a-f]{4}$/);
  });

  it('counts lines as C6 does, and parses placeholders back for recall', () => {
    expect(countLines(golden.body)).toBe(40);
    expect(countLines(c6.pasted[0]!.body)).toBe(40);
    expect(countLines('one')).toBe(1);
    expect(countLines('a\nb\n')).toBe(3);
    expect(parsePlaceholders('[Pasted text #1 +40 lines]')).toEqual([{ kind: 'pasted', n: 1, lines: 40, start: 0, end: 26 }]);
    const text = 'see [Pasted text #2 +3 lines] and [Image #1], [PDF #3] then [Pasted text #x +1 lines]';
    expect(parsePlaceholders(text)).toEqual([
      { kind: 'pasted', n: 2, lines: 3, start: 4, end: 29 },
      { kind: 'image', n: 1, start: 34, end: 44 },
      { kind: 'pdf', n: 3, start: 46, end: 54 },
    ]);
    for (const p of parsePlaceholders(text)) expect(text.slice(p.start, p.end)).toMatch(/^\[.*\]$/);
    expect(parsePlaceholders('nothing here')).toEqual([]);
  });
});

describe('sha256Hex is SHA-256 of the UTF-8 text', () => {
  it('agrees with node:crypto across block boundaries and non-ASCII text', () => {
    for (const text of ['', 'abc', golden.sessionId, 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000), 'é中😀', golden.body]) {
      expect(sha256Hex(text), JSON.stringify(text.slice(0, 20))).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});
