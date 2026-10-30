// Answers and decisions (P5 O9 M2, Interfaces §D): each `RequestAnswer` a card can make, mapped to the bridge's decision
// body from typed fields, or refused when lane A can't carry it; a scope only from the request's own one suggestion,
// checked by its SHA-256 against the raised record the driver holds.
import { describe, expect, it } from 'vitest';
import type { RequestAnswer } from '@shared/engine/answers';
import { decisionFor, requestKind } from './decisions';

const controls = {
  'decide.scope': { available: true },
  'decide.interrupt': { available: false, reason: 'deny-and-interrupt is answered in the terminal' },
  'elicitation.answer': { available: false, reason: 'answer this form in the terminal' },
};
const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' };
const permission = { request: 'toolu_1', tool: 'Bash', input: { command: 'npm test' }, suggestions: [rule] };
const native = { request: 'toolu_q', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] } };
const asyncQ = { request: 'toolu_plugin_1', tool: 'mcp__sminos__AskUserQuestion', input: { questions: [{ question: 'Which?' }] }, async: true as const };
const plan = { request: 'toolu_p', tool: 'ExitPlanMode', input: { plan: 'do it' } };

const decide = (current: Record<string, unknown>, answer: RequestAnswer, held: Record<string, unknown> | null = current) => decisionFor({ current, held, answer, controls });

describe('lane A decisions', () => {
  it('reads a request kind by the bridge’s own rule', () => {
    expect(requestKind(permission)).toBe('permission');
    expect(requestKind(native)).toBe('question');
    expect(requestKind(asyncQ)).toBe('question');
    expect(requestKind(plan)).toBe('plan');
  });

  it('maps a permission’s allow once, deny and deny with a message', async () => {
    expect(await decide(permission, { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({ ok: true, body: { behavior: 'allow' } });
    expect(await decide(permission, { kind: 'permission', decision: 'deny' })).toEqual({ ok: true, body: { behavior: 'deny' } });
    expect(await decide(permission, { kind: 'permission', decision: 'deny', message: '' })).toEqual({ ok: true, body: { behavior: 'deny' } });
    expect(await decide(permission, { kind: 'permission', decision: 'deny', message: 'not now' })).toEqual({ ok: true, body: { behavior: 'deny', message: 'not now' } });
  });

  it('refuses deny-and-stop with decide.interrupt’s reason, and an edited input', async () => {
    expect(await decide(permission, { kind: 'permission', decision: 'deny_and_stop' })).toEqual({ ok: false, code: 'unsupported', message: 'deny-and-interrupt is answered in the terminal' });
    expect(await decide(permission, { kind: 'permission', decision: 'allow', scope: 'once', updatedInput: { command: 'ls' } })).toEqual({ ok: false, code: 'unsupported', message: 'an edited input is answered in the terminal' });
  });

  it('allows for the session or local settings with the request’s one suggestion, its destination set', async () => {
    expect(await decide(permission, { kind: 'permission', decision: 'allow', scope: 'session' })).toEqual({ ok: true, body: { behavior: 'allow', updatedPermissions: [{ ...rule, destination: 'session' }] } });
    expect(await decide(permission, { kind: 'permission', decision: 'allow', scope: 'local_settings' })).toEqual({ ok: true, body: { behavior: 'allow', updatedPermissions: [{ ...rule, destination: 'localSettings' }] } });
  });

  it('refuses a scope with two suggestions, none, a mode, a suggestion that changed, local settings it did not name, or the control unavailable', async () => {
    const allow = { kind: 'permission', decision: 'allow', scope: 'session' } as const;
    expect(await decide({ ...permission, suggestions: [rule, rule] }, allow)).toMatchObject({ ok: false, code: 'unsupported' });
    expect(await decide({ ...permission, suggestions: undefined }, allow)).toMatchObject({ ok: false, code: 'unsupported' });
    expect(await decide({ ...permission, suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }, allow)).toMatchObject({ ok: false, code: 'unsupported' });
    const changed = { ...rule, rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }] };
    expect(await decide({ ...permission, suggestions: [changed] }, allow, permission)).toEqual({ ok: false, code: 'not-pending', message: 'the suggestions changed: the request no longer offers the one shown' });
    expect(await decide(permission, allow, null)).toMatchObject({ ok: false, code: 'not-pending' });
    const sessionRule = { ...rule, destination: 'session' };
    expect(await decide({ ...permission, suggestions: [sessionRule] }, { kind: 'permission', decision: 'allow', scope: 'local_settings' })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(await decisionFor({ current: permission, held: permission, answer: allow, controls: { 'decide.scope': { available: false, reason: 'no scope here' } } })).toEqual({ ok: false, code: 'unsupported', message: 'no scope here' });
    const dirs = { type: 'addDirectories', directories: ['/tmp/x'], destination: 'session' };
    expect(await decide({ ...permission, suggestions: [dirs] }, allow)).toEqual({ ok: true, body: { behavior: 'allow', updatedPermissions: [dirs] } });
  });

  it('answers a question, declines a native one skipped or denied, and refuses either for an async one', async () => {
    expect(await decide(native, { kind: 'question', answers: { 'Which?': 'A' } })).toEqual({ ok: true, body: { behavior: 'allow', updatedInput: { answers: { 'Which?': 'A' } } } });
    expect(await decide(asyncQ, { kind: 'question', answers: { 'Which?': 'A' } })).toEqual({ ok: true, body: { behavior: 'allow', updatedInput: { answers: { 'Which?': 'A' } } } });
    expect(await decide(native, { kind: 'question', answers: {} })).toEqual({ ok: true, body: { behavior: 'deny' } });
    expect(await decide(native, { kind: 'permission', decision: 'deny' })).toEqual({ ok: true, body: { behavior: 'deny' } });
    expect(await decide(asyncQ, { kind: 'question', answers: {} })).toEqual({ ok: false, code: 'unsupported', message: 'an async question needs an answer' });
    expect(await decide(asyncQ, { kind: 'permission', decision: 'deny' })).toEqual({ ok: false, code: 'unsupported', message: 'an async question is answered, never declined' });
  });

  it('approves a plan, keeps planning with or without feedback, and refuses clear-and-implement', async () => {
    expect(await decide(plan, { kind: 'plan', outcome: 'implement', feedback: null })).toEqual({ ok: true, body: { behavior: 'allow' } });
    expect(await decide(plan, { kind: 'plan', outcome: 'keep_planning', feedback: 'smaller' })).toEqual({ ok: true, body: { behavior: 'deny', message: 'smaller' } });
    expect(await decide(plan, { kind: 'plan', outcome: 'keep_planning', feedback: null })).toEqual({ ok: true, body: { behavior: 'deny' } });
    expect(await decide(plan, { kind: 'plan', outcome: 'clear_and_implement', feedback: null })).toEqual({ ok: false, code: 'unsupported', message: '/clear runs in the terminal' });
  });

  it('refuses dialogs and elicitations with elicitation.answer’s reason, and an answer that does not fit its request', async () => {
    expect(await decide(permission, { kind: 'dialog', behavior: 'completed' })).toEqual({ ok: false, code: 'unsupported', message: 'answer this form in the terminal' });
    expect(await decide(permission, { kind: 'elicitation', action: 'accept' })).toEqual({ ok: false, code: 'unsupported', message: 'answer this form in the terminal' });
    expect(await decide(permission, { kind: 'question', answers: { 'Which?': 'A' } })).toMatchObject({ ok: false, code: 'bad-args' });
    expect(await decide(native, { kind: 'plan', outcome: 'implement', feedback: null })).toMatchObject({ ok: false, code: 'bad-args' });
    expect(await decide(native, { kind: 'permission', decision: 'allow', scope: 'once' })).toMatchObject({ ok: false, code: 'bad-args' });
  });
});
