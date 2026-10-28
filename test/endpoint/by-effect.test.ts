// The endpoint's by-effect table (O10 M5; RL §5.5): one row for every by-effect command of the composed registry, a rule
// or an explicit `no-rule`, so a by-effect name the registry gains fails here until its effect has been read for remote
// use. The rules themselves are pure over the command's input (and, for an answer, the pending request's kind), so they
// are checked here directly; grades.test.ts drives them through a real channel.
import { describe, expect, it } from 'vitest';
import { gradeOf } from '@shared/ipc/grades';
import { REGISTRY } from '@shared/ipc/registry';
import { BY_EFFECT, NO_RULE, slashGrade, textGrade, type EffectReads } from '../../src/endpoint/by-effect';

const registryByEffect = Object.keys(REGISTRY.commands).filter((name) => {
  const spec = gradeOf(name);
  return typeof spec === 'object' && spec.byEffect;
});

/** Reads that answer the pending request's kind from a fixed table. */
const pending = (kinds: Record<string, string | null>): EffectReads => ({ pendingKind: async (_session, request) => kinds[request] ?? null });
const none = pending({});

async function grade(name: string, input: Record<string, unknown>, reads: EffectReads = none) {
  const rule = BY_EFFECT[name];
  if (rule === undefined || rule === NO_RULE) return rule;
  return rule(input, reads);
}

describe('the table', () => {
  it('holds a row for every by-effect command the registry declares', () => {
    expect(registryByEffect.length).toBeGreaterThan(0);
    const missing = registryByEffect.filter((name) => !Object.hasOwn(BY_EFFECT, name));
    expect(missing).toEqual([]);
  });

  it('holds no row for a registry command that is not by effect', () => {
    const stale = Object.keys(BY_EFFECT).filter((name) => Object.hasOwn(REGISTRY.commands, name) && !registryByEffect.includes(name));
    expect(stale).toEqual([]);
  });

  it('says `no-rule` for the commands whose effect nobody has read for remote use yet', () => {
    for (const name of ['session.ui.press', 'session.ui.input', 'session.ui.select', 'session.applyFlagSettings', 'session.update']) expect(BY_EFFECT[name], name).toBe(NO_RULE);
  });
});

describe('words and slash commands', () => {
  it('grades text by its slash command: plain text and the session-only and read-only commands converse, everything else manage', () => {
    expect(textGrade('hello')).toBe('converse');
    expect(textGrade('a / in the middle')).toBe('converse');
    for (const command of ['/model opus', '/effort high', '/fast', '/cost', '/context', '/status', '/help']) expect(textGrade(command), command).toBe('converse');
    for (const command of ['/compact', '/clear', '/rewind', '/resume', '/mcp', '/permissions', '/unknown-thing', '/Model x']) expect(textGrade(command), command).toBe('manage');
  });

  it('reads a command behind leading whitespace, and in any text block of a structured message', () => {
    expect(textGrade('  /clear')).toBe('manage');
    expect(textGrade('\n/compact keep it')).toBe('manage');
    expect(textGrade([{ type: 'text', text: 'see this' }, { type: 'text', text: '/clear' }])).toBe('manage');
    expect(textGrade([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }, { type: 'text', text: 'what is it?' }])).toBe('converse');
  });

  it('grades send, steer, a queue edit and a side thread’s send to main by their text', async () => {
    for (const name of ['session.send', 'session.steer', 'session.queue.edit', 'side.sendToMain']) {
      expect(await grade(name, { content: 'hi' }), name).toBe('converse');
      expect(await grade(name, { content: '/clear' }), name).toBe('manage');
      expect(await grade(name, { content: '/model sonnet' }), name).toBe('converse');
    }
  });

  it('grades lane A’s `command` as the slash command it names, a leading slash or none', async () => {
    expect(slashGrade('model')).toBe('converse');
    expect(await grade('sminos.command', { session: 's', name: 'model', args: 'opus' })).toBe('converse');
    expect(await grade('sminos.command', { session: 's', name: '/clear' })).toBe('manage');
    expect(await grade('sminos.command', { session: 's', name: 'compact', args: 'keep the plan' })).toBe('manage');
  });

  it('grades lane A’s `send` by its text, as `session.send`’s: plain text converse, a slash command by its own grade', async () => {
    expect(await grade('sminos.send', { session: 's', text: 'please look at the tests' })).toBe('converse');
    expect(await grade('sminos.send', { session: 's', text: '/model sonnet' })).toBe('converse');
    expect(await grade('sminos.send', { session: 's', text: '/clear' })).toBe('manage');
    expect(await grade('sminos.send', { session: 's', text: ' /clear' })).toBe('manage');
    expect(await grade('sminos.send', { session: 's', text: '\n/compact keep the plan' })).toBe('manage');
    // A text that is no string is no message sminos takes: it is graded as the most it could be.
    expect(await grade('sminos.send', { session: 's' })).toBe('manage');
    expect(await grade('sminos.send', { session: 's', text: [{ type: 'text', text: 'hi' }] })).toBe('manage');
  });
});

describe('the other rows', () => {
  it('takes manage for a promote and an unpause, which release queued entries, and converse for a pause', async () => {
    expect(await grade('session.queue.promote', { queueId: 'q' })).toBe('manage');
    expect(await grade('session.queue.setPaused', { paused: false })).toBe('manage');
    expect(await grade('session.queue.setPaused', { paused: true })).toBe('converse');
  });

  it('grades an answer by the pending request’s kind: a question converse, a permission, plan, dialog or elicitation approve', async () => {
    const reads = pending({ q: 'question.requested', ask: 'maws.ask.opened', p: 'permission.requested', plan: 'plan.requested', d: 'dialog.requested', e: 'elicitation.requested' });
    const question = { kind: 'question', answers: { 'Which?': 'A' } };
    expect(await grade('session.answer', { requestId: 'q', answer: question }, reads)).toBe('converse');
    expect(await grade('session.answer', { requestId: 'ask', answer: question }, reads)).toBe('converse');
    for (const id of ['p', 'plan', 'd', 'e']) expect(await grade('session.answer', { requestId: id, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }, reads), id).toBe('approve');
    // An answer that calls a pending permission a question is graded by what is pending.
    expect(await grade('session.answer', { requestId: 'p', answer: question }, reads)).toBe('approve');
    // Nothing pending: the answer's own kind (the host will answer `not_pending`).
    expect(await grade('session.answer', { requestId: 'gone', answer: question }, reads)).toBe('converse');
    expect(await grade('session.answer', { requestId: 'gone', answer: { kind: 'dialog', behavior: 'completed' } }, reads)).toBe('approve');
  });

  // P5 O9 M2: main's local lane A rows (the driver refuses an answer that does not fit its request's kind).
  it('grades lane A’s answer by its kind, agreeing with lane B on a decline, and its command as its slash command', async () => {
    const answers = { kind: 'question', answers: { 'Which?': 'A' } };
    const skipped = { kind: 'question', answers: {} }; // every question skipped: a native question's decline (§D)
    const deny = { kind: 'permission', decision: 'deny' }; // a question's decline, and lane B's
    expect(await grade('laneA.answer', { appSessionId: 'a', request: 'q', answer: answers })).toBe('converse');
    expect(await grade('laneA.answer', { appSessionId: 'a', request: 'q', answer: skipped })).toBe('converse');
    expect(await grade('laneA.answer', { appSessionId: 'a', request: 'q', answer: deny })).toBe('approve');
    expect(await grade('laneA.answer', { appSessionId: 'a', request: 'p', answer: { kind: 'permission', decision: 'allow', scope: 'once' } })).toBe('approve');
    expect(await grade('laneA.answer', { appSessionId: 'a', request: 'plan', answer: { kind: 'plan', outcome: 'implement', feedback: null } })).toBe('approve');
    // lane B gives the same answers the same grades on a pending question
    const reads = pending({ q: 'question.requested' });
    expect(await grade('session.answer', { requestId: 'q', answer: skipped }, reads)).toBe('converse');
    expect(await grade('session.answer', { requestId: 'q', answer: deny }, reads)).toBe('approve');

    expect(await grade('laneA.command', { appSessionId: 'a', name: 'model', args: 'opus' })).toBe(slashGrade('model'));
    expect(await grade('laneA.command', { appSessionId: 'a', name: 'model', args: 'opus' })).toBe('converse');
    expect(await grade('laneA.command', { appSessionId: 'a', name: '/clear', args: '' })).toBe('manage');
    expect(await grade('laneA.command', { appSessionId: 'a', args: '' })).toBe('manage');
  });

  it('grades an acquire by what its options change: the model or effort converse, anything else manage', async () => {
    expect(await grade('session.acquire', { reason: 'send' })).toBe('converse');
    expect(await grade('session.acquire', { reason: 'resume', options: { model: 'opus', effort: 'high' } })).toBe('converse');
    expect(await grade('session.acquire', { reason: 'resume', options: { gateway: 'direct' } })).toBe('manage');
    expect(await grade('session.acquire', { reason: 'resume', options: { trust: { decision: 'trust' } } })).toBe('manage');
  });

  it('grades a memory append by its target: a project or a path manage, the user’s machine-wide memory machine-admin', async () => {
    expect(await grade('session.memoryAppend', { text: 'x', target: { kind: 'project', path: null } })).toBe('manage');
    expect(await grade('session.memoryAppend', { text: 'x', target: { kind: 'path', path: '/p/CLAUDE.md' } })).toBe('manage');
    expect(await grade('session.memoryAppend', { text: 'x', target: { kind: 'user', path: null } })).toBe('machine-admin');
  });

  it('takes a text-only prompt edit at its floor and has no rule for a keyed one', async () => {
    expect(await grade('session.ui.promptEdit', { text: 'abc', cursor: 3, by: 'person' })).toBe('converse');
    expect(await grade('session.ui.promptEdit', { text: 'abc', cursor: 3, by: 'person', key: { key: 'Enter' } })).toBe(NO_RULE);
  });
});
