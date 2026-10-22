import { describe, expect, it } from 'vitest';
import { BROWSER_SET_LIMIT, BROWSER_SET_PARTS } from '../../src/protocol/browser';
import { FRAME_LIMIT, PART_ID_LIMIT, PartAssembler, PARTS_MAX_SETS, PartsBudgetError, toWire } from '../../src/protocol/parts';

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

describe("an assembler's unfinished sets are bounded (panel finding scalpel-5#2)", () => {
  const part = (id: string, index: number, count: number, size: number) => ({ t: 'part' as const, id, index, count, data: 'x'.repeat(size) });

  it('in total: a part that would hold more than the budget is refused and its set dropped; a finished set frees its share', () => {
    const assembler = new PartAssembler({ maxBytes: 1000 });
    // Each set's first part opens a JSON string, which its second part closes.
    const first = (id: string, size: number) => ({ ...part(id, 0, 2, size - 1), data: '"' + 'x'.repeat(size - 1) });
    for (let i = 0; i < 9; i++) assembler.add(first(`s${i}`, 100)); // 900 held, none finished
    expect(() => assembler.add(first('big', 200))).toThrow(PartsBudgetError);
    // The refused set is gone: its next part starts it again, and is refused again while the budget is spent.
    expect(() => assembler.add(part('big', 1, 2, 200))).toThrow(PartsBudgetError);
    expect(assembler.add({ t: 'part', id: 's0', index: 1, count: 2, data: '"' })).toBe('x'.repeat(99)); // s0 joins, freeing its 100
    expect(() => assembler.add(first('big', 100))).not.toThrow();
    expect(() => assembler.add(first('s9', 101))).toThrow(PartsBudgetError); // 900 held again: one byte too many
  });

  it('in time: a set that waits longer than its age for its other parts is dropped', () => {
    let now = 0;
    const assembler = new PartAssembler({ maxBytes: 1000, maxAgeMs: 60_000, now: () => now });
    for (let i = 0; i < 9; i++) assembler.add(part(`old${i}`, 0, 2, 100));
    now = 60_001;
    expect(() => assembler.add(part('new', 0, 2, 900))).not.toThrow(); // the old sets' 900 were let go
    // A late part of an expired set starts a set of its own, which never finishes the old frame.
    expect(assembler.add(part('old0', 1, 2, 50))).toBeUndefined();
  });

  it('in what the sets themselves cost: the open sets are counted, and an id is short, whatever their data (zero-size and tiny parts)', () => {
    let now = 0;
    const assembler = new PartAssembler({ now: () => now });
    for (let i = 0; i < PARTS_MAX_SETS; i++) assembler.add(part(`empty${i}`, 0, 2, i % 2)); // empty and one-byte data
    expect(() => assembler.add(part('one-more', 0, 2, 0))).toThrow(PartsBudgetError);
    // A part of a set already open is still taken.
    expect(() => assembler.add(part('empty1', 0, 2, 1))).not.toThrow();
    // An id longer than the bound is malformed, data or not.
    expect(() => assembler.add(part('i'.repeat(PART_ID_LIMIT + 1), 0, 2, 0))).toThrow(TypeError);
    expect(() => assembler.add(part('i'.repeat(64 * 1024), 0, 2, 0))).toThrow(TypeError);
    // Expired sets free their places.
    now = 60_001;
    expect(() => assembler.add(part('one-more', 0, 2, 0))).not.toThrow();
  });
});

describe("a browser's part set is bounded in its parts and in what it joins to", () => {
  const browser = () => new PartAssembler({ maxSetBytes: BROWSER_SET_LIMIT, maxSetParts: BROWSER_SET_PARTS });
  /** A frame whose JSON text is `bytes` long, all backslashes but its shell: each doubles as a part carries it, so the
   * frame takes the most parts a frame of its size can. */
  const escaping = (bytes: number) => ({ t: 'x', s: '\\'.repeat((bytes - JSON.stringify({ t: 'x', s: '' }).length) / 2) });

  it('joins a frame of the bound cut at the wire bound, however its text escapes, and refuses one a byte larger', () => {
    const frame = escaping(BROWSER_SET_LIMIT);
    expect(utf8(JSON.stringify(frame))).toBe(BROWSER_SET_LIMIT);
    const wire = toWire(frame);
    expect(wire.length).toBe(BROWSER_SET_PARTS);
    const assembler = browser();
    expect(wire.map((line) => assembler.add(JSON.parse(line))).at(-1)).toEqual(frame);

    const parts = toWire({ ...frame, s: `${frame.s}x` }).map((line) => JSON.parse(line));
    const refusing = browser();
    expect(() => parts.forEach((p) => refusing.add(p))).toThrow(PartsBudgetError);
    // The refused set is dropped: its last part alone starts a set of its own, which never finishes the frame.
    expect(refusing.add(parts.at(-1))).toBeUndefined();
  });

  it('refuses a set of more parts at its first, whatever its data, and joins one of as many', () => {
    expect(() => browser().add({ t: 'part', id: 'p', index: 0, count: BROWSER_SET_PARTS + 1, data: '' })).toThrow(PartsBudgetError);
    expect(() => browser().add({ t: 'part', id: 'p', index: 0, count: 2 ** 32, data: '' })).toThrow(PartsBudgetError);
    const last = BROWSER_SET_PARTS - 1;
    const parts = Array.from({ length: BROWSER_SET_PARTS }, (_, index) => ({ t: 'part' as const, id: 'p', index, count: BROWSER_SET_PARTS, data: index === 0 || index === last ? '"' : 'y' }));
    const assembler = browser();
    expect(parts.map((p) => assembler.add(p)).at(-1)).toBe('y'.repeat(BROWSER_SET_PARTS - 2));
  });

  it('leaves an assembler not given them as it was: a set of any count, joined past the browser bound', () => {
    const frame = escaping(BROWSER_SET_LIMIT + 2);
    const assembler = new PartAssembler();
    expect(toWire(frame).map((line) => assembler.add(JSON.parse(line))).at(-1)).toEqual(frame);
    expect(() => new PartAssembler().add({ t: 'part', id: 'p', index: 0, count: 1000, data: '' })).not.toThrow();
  });
});
