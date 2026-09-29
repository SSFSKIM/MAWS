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

  it('types the other four kinds strictly', () => {
    expect(RequestAnswerSchema.safeParse({ kind: 'question', answers: { 'Which?': 'Red' } }).success).toBe(true);
    expect(RequestAnswerSchema.safeParse({ kind: 'plan', outcome: 'clear_and_implement', feedback: null }).success).toBe(true);
    expect(RequestAnswerSchema.safeParse({ kind: 'plan', outcome: 'ship_it', feedback: null }).success).toBe(false);
    expect(RequestAnswerSchema.safeParse({ kind: 'dialog', behavior: 'completed', result: { choice: 1 } }).success).toBe(true);
    expect(RequestAnswerSchema.safeParse({ kind: 'elicitation', action: 'accept', content: { color: 'teal' } }).success).toBe(true);
    expect(RequestAnswerSchema.safeParse({ kind: 'elicitation', action: 'accept', extra: 1 }).success).toBe(false);
  });
});
