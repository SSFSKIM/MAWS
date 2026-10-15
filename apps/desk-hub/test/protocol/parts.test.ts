import { describe, expect, it } from 'vitest';
import { FRAME_LIMIT, PartAssembler, toWire } from '../../src/protocol/parts';

const utf8 = (s: string) => new TextEncoder().encode(s).length;

describe('frames over the 1 MiB bound travel as numbered parts', () => {
  it('sends a frame within the bound as itself', () => {
    const frame = { t: 'hb' };
    expect(toWire(frame)).toEqual([JSON.stringify(frame)]);
  });

  it('splits a larger frame into parts each within the bound, which reassemble in any order', () => {
    // Quotes and backslashes double when a part carries them, and Korean and astral text are 3 and 4 bytes a character.
    const text = '한국어 "quoted" \\ 🙂 '.repeat(120_000);
    const frame = { t: 'session', body: { rows: [{ text }] } };
    const wire = toWire(frame);
    expect(wire.length).toBeGreaterThan(1);
    for (const line of wire) expect(utf8(line)).toBeLessThanOrEqual(FRAME_LIMIT);
    const assembler = new PartAssembler();
    const shuffled = [...wire].reverse().map((line) => JSON.parse(line));
    const out = shuffled.map((part) => assembler.add(part));
    expect(out.slice(0, -1).every((x) => x === undefined)).toBe(true);
    expect(out.at(-1)).toEqual(frame);
  });

  it('honours a smaller bound, and never splits a surrogate pair', () => {
    const frame = { t: 'x', s: '🙂'.repeat(50) };
    const wire = toWire(frame, 120);
    for (const line of wire) {
      expect(utf8(line)).toBeLessThanOrEqual(120);
      expect(JSON.parse(line).data).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/);
    }
    const assembler = new PartAssembler();
    expect(wire.map((line) => assembler.add(JSON.parse(line))).at(-1)).toEqual(frame);
  });

  it('refuses a part that disagrees with its set', () => {
    const assembler = new PartAssembler();
    assembler.add({ t: 'part', id: 'p', index: 0, count: 2, data: '{"t":' });
    expect(() => assembler.add({ t: 'part', id: 'p', index: 1, count: 3, data: '"x"}' })).toThrow(TypeError);
    expect(() => assembler.add({ t: 'part', id: 'q', index: 2, count: 2, data: '' })).toThrow(TypeError);
  });
});
