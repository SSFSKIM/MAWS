// Lane A's answer mapping, shared by the local driver and the remote adapter (P5 O9 Interfaces §D): a card's
// `RequestAnswer` read as what lane A can carry, or refused.
import { describe, expect, it } from 'vitest';
import { inputSha256 } from 'desk-hub/protocol';
import type { RequestAnswer } from '@shared/engine/answers';
import { answerIntent, requestKind, suggestionSha256 } from './answers';

const controls = {
  'decide.scope': { available: true },
  'decide.interrupt': { available: false, reason: 'deny-and-interrupt is answered in the terminal' },
  'elicitation.answer': { available: false, reason: 'answer this form in the terminal' },
};
const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' };
const permission = { request: 'toolu_1', tool: 'Bash', input: { command: 'npm test' }, suggestions: [rule] };
const native = { request: 'toolu_q', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] } };
const asyncQ = { request: 'toolu_plugin_1', tool: 'mcp__sminos__AskUserQuestion', input: {}, async: true as const };
const plan = { request: 'toolu_p', tool: 'ExitPlanMode', input: { plan: 'do it' } };
const intent = (raised: Record<string, unknown>, answer: RequestAnswer, given = controls) => answerIntent({ raised, answer, controls: given });

describe('lane A answer intents', () => {
  it('reads a request kind by the bridge’s own rule', () => {
    expect([permission, native, asyncQ, plan].map(requestKind)).toEqual(['permission', 'question', 'question', 'plan']);
  });

  it('maps every carried variant', () => {
    expect(intent(permission, { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({ ok: true, intent: { kind: 'allow' } });
    expect(intent(permission, { kind: 'permission', decision: 'deny', message: 'not now' })).toEqual({ ok: true, intent: { kind: 'deny', message: 'not now' } });
    expect(intent(permission, { kind: 'permission', decision: 'deny', message: '' })).toEqual({ ok: true, intent: { kind: 'deny' } });
    expect(intent(native, { kind: 'question', answers: { 'Which?': 'left' } })).toEqual({ ok: true, intent: { kind: 'answers', answers: { 'Which?': 'left' } } });
    expect(intent(native, { kind: 'question', answers: {} })).toEqual({ ok: true, intent: { kind: 'deny' } });
    expect(intent(native, { kind: 'permission', decision: 'deny' })).toEqual({ ok: true, intent: { kind: 'deny' } });
    expect(intent(plan, { kind: 'plan', outcome: 'implement' } as RequestAnswer)).toEqual({ ok: true, intent: { kind: 'allow' } });
    expect(intent(plan, { kind: 'plan', outcome: 'keep_planning', feedback: 'smaller' } as RequestAnswer)).toEqual({ ok: true, intent: { kind: 'deny', message: 'smaller' } });
    expect(intent(plan, { kind: 'plan', outcome: 'keep_planning', feedback: null } as RequestAnswer)).toEqual({ ok: true, intent: { kind: 'deny' } });
    expect(intent(permission, { kind: 'permission', decision: 'allow', scope: 'local_settings' })).toEqual({ ok: true, intent: { kind: 'allow-scoped', suggestion: rule, destination: 'localSettings' } });
  });

  it('refuses what lane A can’t carry', () => {
    expect(intent(permission, { kind: 'permission', decision: 'deny_and_stop' })).toEqual({ ok: false, code: 'unsupported', message: 'deny-and-interrupt is answered in the terminal' });
    expect(intent(asyncQ, { kind: 'question', answers: {} })).toMatchObject({ ok: false, code: 'unsupported', message: 'an async question needs an answer' });
    expect(intent(asyncQ, { kind: 'permission', decision: 'deny' })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(intent(plan, { kind: 'plan', outcome: 'clear_and_implement' } as RequestAnswer)).toMatchObject({ ok: false, message: '/clear runs in the terminal' });
    expect(intent({ ...permission, suggestions: [rule, rule] }, { kind: 'permission', decision: 'allow', scope: 'session' })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(intent(permission, { kind: 'permission', decision: 'allow', scope: 'session' }, { ...controls, 'decide.scope': { available: false, reason: 'no scope here' } })).toEqual({ ok: false, code: 'unsupported', message: 'no scope here' });
    expect(intent(native, { kind: 'permission', decision: 'allow', scope: 'once' })).toMatchObject({ ok: false, code: 'bad-args' });
  });

  it('hashes a suggestion as DX6 does: the SHA-256 of its canonical JSON', async () => {
    expect(await suggestionSha256(rule)).toBe(await inputSha256(rule as never));
  });
});
