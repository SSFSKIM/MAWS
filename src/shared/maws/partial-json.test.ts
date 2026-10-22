// P4-A2 (X35, R9): the partial-JSON reader over every cut of a recorded `artifact_edit` input and the awkward cuts
// (inside an escape, inside a key, after a colon, after a comma, inside a literal, in nested arrays).
import { describe, expect, it } from 'vitest';
import { isWhole, openPath, readPartialJson } from './partial-json';

const INPUT = JSON.stringify({
  artifact: 'brief',
  baseRevision: 12,
  ops: [
    { op: 'replace_text', block: 'p1', old: 'the review is on Friday', new: 'the review is on Monday, with "quotes" and a \\ backslash and 한글' },
    { op: 'insert', after: 'h2', markdown: '### Approvals\n\nFinance approves by Thursday.' },
    { op: 'set_cell', table: 'tb1', row: 2, col: 1, markdown: '250' },
    { op: 'delete', id: 'p9' },
  ],
  mode: 'direct',
  answering: 't1',
});

// What a prefix of the input may show: every array element and object member it carries is a prefix of the whole's.
function consistent(partial: unknown, whole: unknown): boolean {
  if (typeof partial === 'string') return typeof whole === 'string' && whole.startsWith(partial);
  if (Array.isArray(partial)) return Array.isArray(whole) && partial.length <= whole.length && partial.every((item, i) => consistent(item, whole[i]));
  if (partial !== null && typeof partial === 'object') {
    if (whole === null || typeof whole !== 'object' || Array.isArray(whole)) return false;
    return Object.entries(partial).every(([key, value]) => key in (whole as Record<string, unknown>) && consistent(value, (whole as Record<string, unknown>)[key]));
  }
  // a number cut short is a prefix of its digits, not of its value: a cut literal is dropped, so a number read is the whole number
  return partial === whole;
}

describe('readPartialJson', () => {
  it('reads every cut of a recorded edit input as a prefix-consistent value, and the whole as itself', () => {
    const whole = JSON.parse(INPUT) as unknown;
    for (let n = 1; n <= INPUT.length; n += 1) {
      const value = readPartialJson(INPUT.slice(0, n));
      if (value === undefined) continue;
      expect(consistent(value, whole), `cut at ${n}: ${INPUT.slice(0, n)}`).toBe(true);
    }
    expect(readPartialJson(INPUT)).toEqual(whole);
  });

  it('answers the artifact key from the first characters that hold it', () => {
    expect(readPartialJson('{"artifact": "bri')).toEqual({ artifact: 'bri' });
    expect(readPartialJson('{"artifact": "brief", "baseRevision": 1')).toEqual({ artifact: 'brief' }); // `1` may be `12` cut: dropped until a delimiter follows
    expect(readPartialJson('{"artifact": "brief", "baseRevision": 12,')).toEqual({ artifact: 'brief', baseRevision: 12 });
    expect(readPartialJson('{"artifact": "brief", "baseRevision": 12, "ops": [{"op": "replace_text", "old": "x", "new": "the re')).toEqual({ artifact: 'brief', baseRevision: 12, ops: [{ op: 'replace_text', old: 'x', new: 'the re' }] });
  });

  it('drops a cut key, a key without its value, a trailing comma and a cut literal', () => {
    expect(readPartialJson('{"artifact": "brief", "base')).toEqual({ artifact: 'brief' });
    expect(readPartialJson('{"artifact": "brief", "baseRevision":')).toEqual({ artifact: 'brief' });
    expect(readPartialJson('{"artifact": "brief", "baseRevision": ')).toEqual({ artifact: 'brief' });
    expect(readPartialJson('{"artifact": "brief",')).toEqual({ artifact: 'brief' });
    expect(readPartialJson('{"ops": [{"op": "delete", "id": "p9"}, {"op": "move", "after": nul')).toEqual({ ops: [{ op: 'delete', id: 'p9' }, { op: 'move' }] });
    expect(readPartialJson('{"ops": [{"row": 2, "col": 1')).toEqual({ ops: [{ row: 2 }] });
    expect(readPartialJson('{"ops": [{"row": 2, "col": 1}')).toEqual({ ops: [{ row: 2, col: 1 }] });
    expect(readPartialJson('{"ops": [{"force": true')).toEqual({ ops: [{ force: true }] });
    expect(readPartialJson('{"ops": [{"row": 2, "col": -')).toEqual({ ops: [{ row: 2 }] });
    expect(readPartialJson('{"ops": [1, 2,')).toEqual({ ops: [1, 2] });
    expect(readPartialJson('{"ops": [')).toEqual({ ops: [] });
    expect(readPartialJson('{')).toEqual({});
  });

  it('closes a cut string, dropping a cut escape', () => {
    expect(readPartialJson('{"new": "a line\\')).toEqual({ new: 'a line' });
    expect(readPartialJson('{"new": "a line\\n')).toEqual({ new: 'a line\n' });
    expect(readPartialJson('{"new": "a \\"quoted')).toEqual({ new: 'a "quoted' });
    expect(readPartialJson('{"new": "han \\ud55c')).toEqual({ new: 'han 한' });
    expect(readPartialJson('{"new": "han \\ud5')).toEqual({ new: 'han ' });
    expect(readPartialJson('{"new": "han \\u')).toEqual({ new: 'han ' });
    // an escaped backslash at the cut is whole, and a literal `u12` after one is text, not a cut escape
    expect(readPartialJson('{"new": "abc\\\\')).toEqual({ new: 'abc\\' });
    expect(readPartialJson('{"new": "a\\\\u12')).toEqual({ new: 'a\\u12' });
    expect(readPartialJson('{"new": "a\\\\\\u12')).toEqual({ new: 'a\\' });
    expect(readPartialJson('{"new": "C:\\\\Users\\\\')).toEqual({ new: 'C:\\Users\\' });
  });

  it('answers undefined for nothing and for a broken input', () => {
    expect(readPartialJson('')).toBeUndefined();
    expect(readPartialJson('   ')).toBeUndefined();
    expect(readPartialJson('{"a": tru e}')).toBeUndefined();
  });
});

// G2 (G-R2): which values of a partial parse are whole, for the deck's and the design's indexes as a publish streams them
// (the emitter's reading of the call's input, beside the reader so the renderer's core reads the same).
describe('openPath and isWhole', () => {
  it('name the member the text ends inside, down to the innermost open container; null once whole', () => {
    expect(openPath('{"artifact":"pla')).toEqual(['artifact']);
    expect(openPath('{"artifact":"plan"')).toEqual([]);
    expect(openPath('{"artifact":"plan","ops":[{"op":"replace_text","old":"ab')).toEqual(['ops', 0, 'old']);
    expect(openPath('{"ops":[{"op":"x"},{"old":"a\\"b"')).toEqual(['ops', 1]);
    expect(openPath('{"ops":[{"op":"x"}')).toEqual(['ops']);
    expect(openPath('{"ops":[{"op":"x"}],"baseRevision":12')).toEqual(['baseRevision']);
    expect(openPath('{"ops":[[1,2],[3')).toEqual(['ops', 1, 0]);
    expect(openPath('{"a":{"b":"c"}}')).toBeNull();
  });

  it('tell a value off the open path whole, and one on it (or above it) open', () => {
    const order = openPath('{"order":["s1","s2","s3');
    expect(isWhole(order, ['order', 1])).toBe(true);
    expect(isWhole(order, ['order', 2])).toBe(false);
    expect(isWhole(order, ['order'])).toBe(false);
    const boards = openPath('{"boards":{"b1":{"x":0,"y":0,"w":800,"h":600},"b2":{"x":900,"y":0,"w":80');
    expect(isWhole(boards, ['boards', 'b1'])).toBe(true);
    expect(isWhole(boards, ['boards', 'b2'])).toBe(false);
    expect(isWhole(boards, ['boards', 'b2', 'x'])).toBe(true);
    expect(isWhole(openPath('{"boards":{"b2":{"x":900,"y":0,"w":800,"h":600}'), ['boards', 'b2'])).toBe(true);
    expect(isWhole(null, ['anything', 3])).toBe(true);
  });
});
