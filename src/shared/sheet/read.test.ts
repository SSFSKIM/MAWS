// The reader's computation held to the pinned set (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §B,
// M1): for every state the set holds, `modelOf` is what sminos's own `show --json` prints, and the pitfalls a port of
// sminos's reader can miss are pinned one by one (sminos/tests/test_sheet_contract.py at the pin is the reference).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SheetModelSchema, SheetStateSchema, type SheetState } from './model';
import { lineError, modelOf, summaryOf } from './read';
import { codePoints } from './text';

const FIXTURES = join(__dirname, '../../../test/fixtures/sheet/set/fixtures');
const CASES = readdirSync(FIXTURES).sort();
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const sessionOf = (name: string): string => (readJson(join(FIXTURES, name, 'case.json')) as { session: string }).session;

// One side of a fixture, read as a reader reads it: the record's state, and its inbox from the recorded offset on.
function sideOf(name: string, side: 'before' | 'after'): { state: unknown; tail: Uint8Array } | null {
  const record = join(FIXTURES, name, side, 'sheet', sessionOf(name));
  if (!existsSync(record)) return null;
  const state = readJson(join(record, 'state.json')) as { inbox: { offset: number } };
  const inbox = join(record, 'inbox.jsonl');
  const tail = existsSync(inbox) ? new Uint8Array(readFileSync(inbox)).subarray(state.inbox.offset) : new Uint8Array();
  return { state, tail };
}

const modelOfJson = (state: unknown, tail: Uint8Array = new Uint8Array()) => modelOf(SheetStateSchema.parse(state), tail, () => true);
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const clone = <T>(value: T): T => structuredClone(value);

describe('modelOf over the pinned fixtures', () => {
  it('walks every fixture directory of the pin', () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  for (const name of CASES) {
    for (const side of ['before', 'after'] as const) {
      it(`${name}, ${side}: the model is show.${side}.json`, () => {
        const want = readJson(join(FIXTURES, name, `show.${side}.json`));
        const got = sideOf(name, side);
        if (got === null) {
          expect(want).toBeNull();
          return;
        }
        // The fixtures' referenced files exist on no machine, so every reference reads changed.
        const model = modelOfJson(got.state, got.tail);
        expect(model).toStrictEqual(want);
        expect(SheetModelSchema.safeParse(want).success).toBe(true);
      });
    }
  }
});

describe('modelOf, the pitfalls of a port', () => {
  const references = () => sideOf('references', 'before')!;

  it('writes a lone surrogate of the record as U+FFFD', () => {
    const { state, tail } = references();
    const text = JSON.stringify(state).replace('"label":"No"', '"label":"N\\ud83do"');
    const model = modelOfJson(JSON.parse(text), tail);
    expect(model.open[0].options.map((option) => option.label)).toEqual(['Yes', 'N\uFFFDo']);
    expect(SheetModelSchema.safeParse(model).success).toBe(true);
  });

  it('lists a queued answer without its time when the line has none', () => {
    const model = modelOfJson(references().state, bytes('{"v":1,"key":"maws-00000001","kind":"answer","id":"q1","revision":1,"picks":["No"],"by":"maws"}\n'));
    expect(model.open[0].queued).toEqual({ key: 'maws-00000001', kind: 'answer', picks: ['No'], text: '', images: [], revision: 1, by: 'maws' });
    expect(SheetModelSchema.safeParse(model).success).toBe(true);
  });

  it('drops each line a drain skips and reads the good one after them', () => {
    const good = '{"v":1,"key":"maws-00000002","kind":"answer","id":"q2","revision":1,"picks":["No"],"by":"maws"}\n';
    const bad = [
      '{"v":1e999,"key":"maws-00000001","kind":"dismiss","id":"q1","by":"maws"}\n', // not 1: an infinity
      '{"v":1,"key":"maws-00000003","kind":"dismiss","id":"q1","by":"maws","text":NaN}\n', // not JSON
      '{"v":1,"key":"maws-00000004","kind":"answer","id":"q2","revision":1,"text":"\\ud83d","by":"maws"}\n', // a lone surrogate
      '{"v":1,"key":"maws-0000005\\n","kind":"dismiss","id":"q1","by":"maws"}\n', // a key with a newline after it
      '{"v":1,"key":"maws-00000006","kind":"answer","id":"q2","revision":1,"picks":["Yes","No"],"by":"maws"}\n', // two picks, single-select
      '{"v":1,"key":"maws-00000009","kind":"answer","id":"q2","revision":1,"picks":["Maybe"],"by":"maws"}\n', // no label of q2
      `{"v":1,"key":"maws-00000007","kind":"dismiss","id":"q1","by":"maws","x":${'['.repeat(100000)}1${']'.repeat(100000)}}\n`,
      `{"v":1,"key":"maws-00000008","kind":"dismiss","id":"q1","by":"maws","x":[${'['.repeat(700)}"\\ud83d"${']'.repeat(700)}]}\n`,
      '\uFEFF{"v":1,"key":"maws-00000010","kind":"dismiss","id":"q1","by":"maws"}\n', // a byte order mark is not JSON
      '{"v":1,"key":"maws-00000011","kind":"dismiss","id":"q1","by":"maws"}\n'.replace('q1', 'q1\u0000'), // a raw control character
    ];
    const invalidUtf8 = new Uint8Array([...bytes('{"v":1,"key":"maws-00000012","kind":"dismiss","id":"q1","by":"maws","batch":"'), 0xc3, 0x28, ...bytes('"}\n')]);
    const tail = new Uint8Array([...bytes(bad.join('')), ...invalidUtf8, ...bytes(good)]);
    const model = modelOfJson(references().state, tail);
    expect(model.sent.map((entry) => entry.key)).toEqual(['maws-00000002']);
    expect(model.open[1].queued?.key).toBe('maws-00000002');
    expect(model.hidden).toEqual([]);
    expect(SheetModelSchema.safeParse(model).success).toBe(true);
  });

  it('lets a dropped line shadow no later line of its key, and keeps only the first of two good ones', () => {
    const lines = [
      '{"v":1,"key":"maws-00000001","kind":"answer","id":"q2","revision":1,"picks":["Maybe"],"by":"maws"}', // dropped
      '{"v":1,"key":"maws-00000001","kind":"answer","id":"q2","revision":1,"picks":["No"],"by":"maws"}',
      '{"v":1,"key":"maws-00000001","kind":"dismiss","id":"q2","by":"maws"}', // the same key again: set aside
    ];
    const model = modelOfJson(references().state, bytes(lines.join('\n') + '\n'));
    expect(model.sent).toEqual([{ key: 'maws-00000001', kind: 'answer', state: 'queued', id: 'q2' }]);
    expect(model.open[1].queued?.picks).toEqual(['No']);
  });

  it('stops at the inbox’s last newline', () => {
    const whole = '{"v":1,"key":"maws-00000001","kind":"dismiss","id":"q1","by":"maws"}';
    expect(modelOfJson(references().state, bytes(whole)).sent).toEqual([]);
    expect(modelOfJson(references().state, bytes(`${whole}\n${whole.replace('00000001', '00000002')}`)).sent.map((entry) => entry.key)).toEqual(['maws-00000001']);
  });

  it('sorts the keys with a verdict by code unit, not by locale and not integer-like keys first', () => {
    const { state } = sideOf('answer-applied', 'after')!;
    const record = clone(state) as { verdicts: Record<string, unknown> };
    const verdict = Object.values(record.verdicts)[0];
    record.verdicts = Object.fromEntries(['b-000001', 'a-000001', '12345678', 'A-000001'].map((key) => [key, verdict]));
    expect(modelOfJson(record).sent.map((entry) => entry.key)).toEqual(['12345678', 'A-000001', 'a-000001', 'b-000001']);
  });

  it('cuts a pending outcome in code points, with places read from the whole labels before any is cut', () => {
    const { state } = sideOf('answer-applied', 'after')!;
    const record = clone(state) as { pending: Record<string, unknown>[] };
    const emoji = '\u{1F600}';
    const long = emoji.repeat(87000);
    const outcome = record.pending[0] as { picks: string[]; question: Record<string, unknown> };
    outcome.picks = [`${long}2`];
    outcome.question = {
      ...outcome.question,
      question: emoji.repeat(2001), // the imported-legacy case's 2,001-character question
      header: long,
      options: [`${long}1`, `${long}2`, emoji.repeat(201)], // two labels that share their first 200 characters; a 201-character one
      asker: { agentId: 'a1b2c3', name: long },
    };
    const pending = modelOfJson(record).pending[0];
    if (pending.kind !== 'answer') throw new Error('an answer was pending');
    expect(pending.places).toEqual([2]);
    expect(pending.picks.map(codePoints)).toEqual([200]);
    expect(codePoints(pending.question.question)).toBe(2000);
    expect(codePoints(pending.question.header!)).toBe(60);
    expect(pending.question.options.map(codePoints)).toEqual([200, 200, 200]);
    expect(pending.question.asker).toEqual({ agentId: 'a1b2c3', name: emoji.repeat(200) });
    expect(pending.question.question).toBe(emoji.repeat(2000));
    expect(SheetModelSchema.safeParse(modelOfJson(record)).success).toBe(true);
  });

  it('keeps an open question whole: the input’s bounds are not the record’s', () => {
    const model = modelOfJson(sideOf('imported-legacy', 'after')!.state);
    expect(model.open.map((question) => codePoints(question.question))).toContain(2001);
    expect(model.open.flatMap((question) => question.options.map((option) => codePoints(option.label)))).toContain(201);
  });

  it('keeps a verdict under the key __proto__, which shadows a resent line of that key', () => {
    const { state } = sideOf('answer-applied', 'after')!;
    const text = JSON.stringify(state).replace('"page-0201a001":', '"__proto__":').replaceAll('"key":"page-0201a001"', '"key":"__proto__"');
    const record = JSON.parse(text) as SheetState;
    expect(Object.hasOwn(record.verdicts, '__proto__')).toBe(true);
    const resent = bytes('{"v":1,"key":"__proto__","kind":"dismiss","id":"q2","by":"page"}\n');
    const model = modelOfJson(record, resent);
    expect(model.sent).toEqual([expect.objectContaining({ key: '__proto__', state: 'accepted', verdict: 'applied' })]);
    expect(model.hidden).toEqual([]);
  });

  it('projects a queued line by its kind, whatever other field the line carried', () => {
    const lines = [
      '{"v":1,"key":"maws-00000001","kind":"answer","id":"q2","revision":1,"picks":["No"],"target":"maws-00000009","by":"maws"}',
      '{"v":1,"key":"maws-00000002","kind":"dismiss","id":"q1","target":"maws-00000009","by":"maws"}',
      '{"v":1,"key":"maws-00000003","kind":"retract","target":"maws-00000002","id":"q1","by":"maws"}',
      '{"v":1,"key":"maws-00000004","kind":"delivered","keys":["maws-00000008"],"id":"q1","target":"maws-00000009","by":"maws"}',
    ];
    const model = modelOfJson(references().state, bytes(lines.join('\n') + '\n'));
    expect(model.sent).toStrictEqual([
      { key: 'maws-00000001', kind: 'answer', state: 'queued', id: 'q2' },
      { key: 'maws-00000002', kind: 'dismiss', state: 'queued', id: 'q1', cancelled: true },
      { key: 'maws-00000003', kind: 'retract', state: 'queued', target: 'maws-00000002' },
      { key: 'maws-00000004', kind: 'delivered', state: 'queued' },
    ]);
    expect(SheetModelSchema.safeParse(model).success).toBe(true);
  });

  it('asks changedOf for each reference of a listed question, and carries its answer', () => {
    const { state, tail } = references();
    const asked: string[] = [];
    const model = modelOf(SheetStateSchema.parse(state), tail, (reference) => {
      asked.push(reference.path);
      return reference.kind === 'image' ? null : false;
    });
    expect(asked).toEqual(['src/auth.ts', 'README.md', 'docs/login.png']);
    expect(model.open[0].references.map((reference) => reference.changed)).toEqual([false, false, null]);
  });
});

describe('the record’s schema', () => {
  it('reads every state of the pin, and no state whose v is not 1', () => {
    for (const name of CASES) {
      for (const side of ['before', 'after'] as const) {
        const got = sideOf(name, side);
        if (got !== null) expect(SheetStateSchema.safeParse(got.state).success, `${name} ${side}`).toBe(true);
      }
    }
    const { state } = sideOf('references', 'before')!;
    expect(SheetStateSchema.safeParse({ ...(state as SheetState), v: 2 }).success).toBe(false);
  });

  it('keeps a field a later sminos adds', () => {
    const { state } = sideOf('references', 'before')!;
    const record = clone(state) as { questions: Record<string, unknown>[] };
    record.questions[0].later = { kept: true };
    expect((modelOfJson(record).open[0] as Record<string, unknown>).later).toEqual({ kept: true });
  });
});

describe('lineError', () => {
  const answer = { v: 1, key: 'maws-00000001', kind: 'answer', id: 'q1', revision: 1, picks: ['Yes'], by: 'maws' };

  it('takes every inbox line of the pin that a drain gave a verdict', () => {
    let read = 0;
    for (const name of CASES) {
      const record = join(FIXTURES, name, 'after', 'sheet', sessionOf(name));
      if (!existsSync(join(record, 'inbox.jsonl'))) continue;
      const verdicts = (readJson(join(record, 'state.json')) as { verdicts: Record<string, unknown> }).verdicts;
      for (const text of readFileSync(join(record, 'inbox.jsonl'), 'utf8').split('\n')) {
        let line: unknown;
        try {
          line = JSON.parse(text);
        } catch {
          continue;
        }
        const key = (line as { key?: unknown } | null)?.key;
        if (typeof key !== 'string' || !Object.hasOwn(verdicts, key)) continue;
        expect(lineError(line), `${name}: ${text}`).toBeNull();
        read += 1;
      }
    }
    expect(read).toBeGreaterThan(10);
  });

  it('takes a line of each kind a surface or a deliverer writes', () => {
    expect(lineError(answer)).toBeNull();
    expect(lineError({ v: 1, key: 'maws-00000002', kind: 'retract', target: 'maws-00000001', by: 'page' })).toBeNull();
    expect(lineError({ v: 1, key: 'maws-00000003', kind: 'delivered', keys: ['maws-00000001'], by: 'maws', at: '2026-11-23T10:00:00.000Z' })).toBeNull();
  });

  it('says why a line fails the line’s schema', () => {
    expect(lineError([answer])).toBe('a line is a JSON object');
    expect(lineError({ ...answer, extra: 1 })).toBe('unknown field extra');
    expect(lineError({ ...answer, v: 2 })).toBe('v is 1');
    expect(lineError({ ...answer, key: 'short' })).toBe('key is 8 to 128 of [A-Za-z0-9._:-]');
    expect(lineError({ ...answer, revision: 0 })).toBe('revision is an integer from 1');
    expect(lineError({ ...answer, picks: [], text: '' })).toBe('an answer has picks or text');
    expect(lineError({ ...answer, text: 'x'.repeat(20001) })).toBe('text is at most 20,000 characters');
    expect(lineError({ ...answer, text: '\u{1F600}'.repeat(20000) })).toBeNull(); // in code points
    expect(lineError({ ...answer, images: ['uploads/../x.png'] })).toMatch(/^images are at most 8/);
    expect(lineError({ ...answer, id: 'q1\n' })).toBe('id is q<n>, n at most 999999999');
    expect(lineError({ ...answer, text: '\ud83d' })).toBe('a string holds a lone UTF-16 surrogate');
    expect(lineError({ v: 1, key: 'maws-00000002', kind: 'retract', by: 'maws' })).toBe('a retract names target');
  });
});

describe('summaryOf', () => {
  it('counts what waits on the person, what is queued, pending and hidden', () => {
    const { state, tail } = sideOf('stopped-queue', 'before')!;
    const model = modelOfJson(state, tail);
    const summary = summaryOf(model, { appSessionId: null, title: null, live: false });
    expect(summary).toEqual({
      session: model.session,
      appSessionId: null,
      title: null,
      live: false,
      seq: model.seq,
      open: model.open.filter((question) => question.queued === undefined).length,
      queued: model.open.filter((question) => question.queued !== undefined).length,
      pending: model.pending.length,
      hidden: model.hidden.length,
      oldestAskedAt: model.open.filter((question) => question.queued === undefined).map((question) => question.askedAt).sort()[0] ?? null,
      unreadable: false,
    });
    expect(summary.queued + summary.hidden).toBeGreaterThan(0);
  });
});
