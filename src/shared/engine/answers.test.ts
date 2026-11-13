import { describe, expect, it } from 'vitest';
import { RequestAnswerSchema } from './answers';

describe('RequestAnswerSchema', () => {
  it("accepts C5's deny payload verbatim (ledger d.17) and an allow with a scope", () => {
    expect(RequestAnswerSchema.parse({ kind: 'permission', decision: 'deny' })).toEqual({ kind: 'permission', decision: 'deny' });
    expect(RequestAnswerSchema.parse({ kind: 'permission', decision: 'allow', scope: 'session' })).toEqual({ kind: 'permission', decision: 'allow', scope: 'session' });
    expect(RequestAnswerSchema.safeParse({ kind: 'permission', decision: 'deny_and_stop', message: 'no' }).success).toBe(true);
  });

  it('requires scope for allow and forbids it for a denial, at path scope', () => {
    for (const answer of [{ kind: 'permission', decision: 'allow' }, { kind: 'permission', decision: 'deny', scope: 'once' }, { kind: 'permission', decision: 'deny_and_stop', scope: 'session' }]) {
      const parsed = RequestAnswerSchema.safeParse(answer);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((i) => i.path)).toEqual([['scope']]);
    }
  });

  it('preserves every own question key, including __proto__, through repeated parsing and JSON', () => {
    const answers = { constructor: 'Red', toString: 'Blue', ['__proto__']: 'Green' };
    const once = RequestAnswerSchema.parse({ kind: 'question', answers });
    const twice = RequestAnswerSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual({ kind: 'question', answers });
    if (twice.kind !== 'question') throw new Error('question');
    expect(Object.hasOwn(twice.answers, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(twice.answers)).toBe(Object.prototype);
  });

  it.each([null, [], [['Which?', 'Red']], 'Red', { Which: 1 }, { ['__proto__']: 1 }])('rejects malformed question answers %j', (answers) => {
    expect(RequestAnswerSchema.safeParse({ kind: 'question', answers }).success).toBe(false);
  });

  it('types the other four kinds strictly', () => {
    expect(RequestAnswerSchema.safeParse({ kind: 'question', answers: { 'Which?': 'Red' } }).success).toBe(true);
    expect(RequestAnswerSchema.safeParse({ kind: 'plan', outcome: 'clear_and_implement', feedback: null }).success).toBe(true);
    expect(RequestAnswerSchema.safeParse({ kind: 'plan', outcome: 'ship_it', feedback: null }).success).toBe(false);
    expect(RequestAnswerSchema.safeParse({ kind: 'dialog', behavior: 'completed', result: { choice: 1 } }).success).toBe(true);
    expect(RequestAnswerSchema.safeParse({ kind: 'elicitation', action: 'accept', content: { color: 'teal' } }).success).toBe(true);
    expect(RequestAnswerSchema.safeParse({ kind: 'elicitation', action: 'accept', extra: 1 }).success).toBe(false);
  });

  // UX wave U1a §F: an approved plan may name the mode the session is in afterwards; nothing else names one
  it('takes a plan answer with no mode as today, and a mode only with implement, at path mode', () => {
    expect(RequestAnswerSchema.parse({ kind: 'plan', outcome: 'implement', feedback: null })).toEqual({ kind: 'plan', outcome: 'implement', feedback: null });
    expect(RequestAnswerSchema.parse({ kind: 'plan', outcome: 'implement', feedback: null, mode: 'acceptEdits' })).toEqual({ kind: 'plan', outcome: 'implement', feedback: null, mode: 'acceptEdits' });
    for (const outcome of ['keep_planning', 'clear_and_implement']) {
      const parsed = RequestAnswerSchema.safeParse({ kind: 'plan', outcome, feedback: null, mode: 'default' });
      expect([outcome, parsed.success]).toEqual([outcome, false]);
      expect(parsed.error?.issues.map((i) => i.path)).toEqual([['mode']]);
    }
    expect(RequestAnswerSchema.safeParse({ kind: 'plan', outcome: 'implement', feedback: null, mode: 'turbo' }).success).toBe(false);
  });
});
