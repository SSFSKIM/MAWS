// P5 O1 M6: the tolerant reader (OX1), against the pinned zod's own issue shapes. The first block pins what zod 4.6.5
// reports, since the reader's rule is built on it; the rest drives readTolerant.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { readTolerant, TOLERANT_LOG_CAP, tolerantLog } from './tolerant';

const issuesOf = (schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error('expected a failure');
  return JSON.parse(JSON.stringify(parsed.error.issues)) as unknown;
};

// Two options that both accept `{x}` up to its unknown keys (`y` optional), so neither aborts and zod reports the union
// as an `invalid_union` rather than the one surviving option's issues.
const Inner = z.union([z.strictObject({ x: z.number() }), z.strictObject({ x: z.number(), y: z.number().optional() })]);
const Outer = z.union([z.strictObject({ kind: z.literal('a'), inner: Inner }), z.strictObject({ kind: z.literal('a'), inner: Inner, note: z.string().optional() })]);
const Nested = z.strictObject({ wrap: Outer });

describe('zod 4.6.5’s issue shapes the reader relies on', () => {
  it('a union with one option still standing reports that option’s issues flat, at full paths', () => {
    const flat = z.strictObject({ wrap: z.union([z.strictObject({ kind: z.literal('a'), inner: z.union([z.strictObject({ x: z.number() }), z.strictObject({ y: z.number() })]) }), z.strictObject({ kind: z.literal('b') })]) });
    expect(issuesOf(flat, { wrap: { kind: 'a', inner: { x: 1, newField: 2 } } })).toEqual([
      { code: 'unrecognized_keys', keys: ['newField'], path: ['wrap', 'inner'], message: 'Unrecognized key: "newField"' },
    ]);
  });

  it('a union with several options standing nests their issues, each path relative to the union’s own', () => {
    expect(issuesOf(Nested, { wrap: { kind: 'a', inner: { x: 1, newField: 2 } } })).toEqual([
      {
        code: 'invalid_union',
        path: ['wrap'],
        message: 'Invalid input',
        errors: [
          [{ code: 'invalid_union', path: ['inner'], message: 'Invalid input', errors: [[{ code: 'unrecognized_keys', keys: ['newField'], path: [], message: 'Unrecognized key: "newField"' }], [{ code: 'unrecognized_keys', keys: ['newField'], path: [], message: 'Unrecognized key: "newField"' }]] }],
          [{ code: 'invalid_union', path: ['inner'], message: 'Invalid input', errors: [[{ code: 'unrecognized_keys', keys: ['newField'], path: [], message: 'Unrecognized key: "newField"' }], [{ code: 'unrecognized_keys', keys: ['newField'], path: [], message: 'Unrecognized key: "newField"' }]] }],
        ],
      },
    ]);
  });
});

describe('readTolerant', () => {
  it('returns a value with no unknown keys unchanged, dropping nothing', () => {
    const value = { a: 1, list: [{ b: 'x' }] };
    expect(readTolerant(z.strictObject({ a: z.number(), list: z.array(z.strictObject({ b: z.string() })) }), value)).toEqual({ ok: true, value, dropped: [] });
  });

  it('drops unknown keys of nested objects, array items and record values, leaving the input untouched', () => {
    const schema = z.strictObject({
      top: z.strictObject({ deep: z.strictObject({ k: z.number() }) }),
      list: z.array(z.strictObject({ a: z.number() })),
      byId: z.record(z.string(), z.strictObject({ a: z.number() })),
    });
    const sent = { top: { deep: { k: 1, newDeep: true }, newTop: 1 }, list: [{ a: 1 }, { a: 2, newItem: 'x' }], byId: { s1: { a: 3, newValue: null } }, newRoot: [] };
    const before = structuredClone(sent);
    const read = readTolerant(schema, sent);
    expect(read).toEqual({
      ok: true,
      value: { top: { deep: { k: 1 } }, list: [{ a: 1 }, { a: 2 }], byId: { s1: { a: 3 } } },
      dropped: expect.arrayContaining(['top.deep.newDeep', 'top.newTop', 'list.1.newItem', 'byId.s1.newValue', 'newRoot']),
    });
    expect(read.ok && read.dropped).toHaveLength(5);
    expect(sent).toEqual(before);
  });

  it('follows a discriminated union into the branch that matches', () => {
    const schema = z.strictObject({ d: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('a'), v: z.number() }), z.strictObject({ kind: z.literal('b') })]) });
    expect(readTolerant(schema, { d: { kind: 'a', v: 1, extra: 1 } })).toEqual({ ok: true, value: { d: { kind: 'a', v: 1 } }, dropped: ['d.extra'] });
  });

  it('follows a plain union with several options standing, rebasing their relative paths', () => {
    const schema = z.strictObject({ w: z.strictObject({ u: z.union([z.strictObject({ a: z.number(), deep: z.strictObject({ k: z.number() }) }), z.strictObject({ a: z.number(), b: z.number(), deep: z.strictObject({ k: z.number() }) })]) }) });
    expect(readTolerant(schema, { w: { u: { a: 1, b: 2, deep: { k: 1, extra: 1 } } } })).toEqual({ ok: true, value: { w: { u: { a: 1, b: 2, deep: { k: 1 } } } }, dropped: ['w.u.deep.extra'] });
  });

  it('reads the nested-union case: an option whose own issue is an invalid_union', () => {
    expect(readTolerant(Nested, { wrap: { kind: 'a', inner: { x: 1, newField: 2 } } })).toEqual({ ok: true, value: { wrap: { kind: 'a', inner: { x: 1 } } }, dropped: ['wrap.inner.newField'] });
  });

  it('of the options standing, follows the one that drops the fewest keys, so a key another option knows is kept', () => {
    const schema = z.union([z.strictObject({ x: z.number() }), z.strictObject({ x: z.number(), y: z.number() })]);
    expect(readTolerant(schema, { x: 1, y: 2, z: 3 })).toEqual({ ok: true, value: { x: 1, y: 2 }, dropped: ['z'] });
  });

  it('keeps the strict failure when anything but an unknown key is wrong', () => {
    const schema = z.strictObject({ a: z.number() });
    const read = readTolerant(schema, { a: 'x', extra: 1 });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.issues.map((issue) => issue.code)).toEqual(['invalid_type', 'unrecognized_keys']);
    const union = readTolerant(z.union([z.strictObject({ a: z.number() }), z.strictObject({ b: z.number() })]), { c: 1 });
    expect(union.ok).toBe(false);
  });

  it('keeps the strict failure when a value that is fine once stripped still fails (a required key missing)', () => {
    const read = readTolerant(z.strictObject({ a: z.number(), b: z.string() }), { a: 1, extra: 1 });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.issues.map((issue) => issue.code)).toEqual(['invalid_type', 'unrecognized_keys']);
  });
});

describe('tolerantLog', () => {
  const lineOf = (path: string, message: string) => `dropped ${path} from ${message}, a field this build does not know (logged once per message and path)`;

  it('logs a dropped field once per message and structural path: array indices fold together, distinct paths stay distinct', () => {
    const lines: string[] = [];
    const log = tolerantLog((line) => void lines.push(line));
    log('event session.status', ['list.0.newField', 'list.1.newField', 'left.extra', 'right.extra']);
    log('event session.status', ['list.7.newField', 'right.extra', 'list.2.inner.3.deep']);
    log('event session.status', ['list.4.inner.0.deep']);
    log('event session.queue', ['list.0.newField']);
    log('event session.queue', []);
    expect(lines).toEqual([
      lineOf('list.0.newField', 'event session.status'),
      lineOf('left.extra', 'event session.status'),
      lineOf('right.extra', 'event session.status'),
      lineOf('list.2.inner.3.deep', 'event session.status'),
      lineOf('list.0.newField', 'event session.queue'),
    ]);
  });

  it('stays bounded when record keys multiply the paths: past its cap it says so once and logs no more', () => {
    const lines: string[] = [];
    const log = tolerantLog((line) => void lines.push(line));
    for (let i = 0; i < TOLERANT_LOG_CAP + 50; i++) log('event session.status', [`byId.session-${i}.extra`]);
    log('event session.queue', ['newField']);
    expect(lines).toHaveLength(TOLERANT_LOG_CAP + 1);
    expect(lines[0]).toBe(lineOf('byId.session-0.extra', 'event session.status'));
    expect(lines.at(-1)).toBe(`dropped fields past the first ${TOLERANT_LOG_CAP} distinct paths go unlogged from here on`);
  });
});
