import { describe, expect, it } from 'vitest';
import { validateCommandInput } from '../validate';
import { SessionDigestSchema, SessionPatchSchema } from './session';

describe('session read side and the entries C5 consumes', () => {
  it('accepts the hover card’s two answers and nothing with a null message', () => {
    const answer = (a: unknown) => validateCommandInput('session.answer', { appSessionId: 's1', requestId: 'r1', answer: a }).ok;
    expect(answer({ kind: 'permission', decision: 'allow', scope: 'once' })).toBe(true);
    expect(answer({ kind: 'permission', decision: 'deny' })).toBe(true);
    expect(answer({ kind: 'permission', decision: 'deny', message: null })).toBe(false);
    expect(answer({ kind: 'permission', decision: 'deny', scope: 'once' })).toBe(false); // a denial has no scope
    expect(answer({ kind: 'permission', decision: 'allow' })).toBe(false); // an allowance needs one
  });

  it('requires a session patch to set at least one field', () => {
    expect(SessionPatchSchema.safeParse({}).success).toBe(false);
    expect(SessionPatchSchema.safeParse({ pinned: true }).success).toBe(true);
    expect(SessionPatchSchema.safeParse({ unread: false, lastSeen: { messageUuid: null, at: '2026-09-28T10:00:00Z' } }).success).toBe(true);
    expect(SessionPatchSchema.safeParse({ title: { text: 'x', source: 'generated' } }).success).toBe(false);
  });

  it('validates a digest and refuses an unknown phase', () => {
    const digest = {
      appSessionId: 's1', phase: 'working', activity: 'Thinking', lastAssistantLine: null, turnStartedAt: null, lastTurnEndedAt: null,
      context: null, cost: null, childAgents: { active: 0, done: 0 }, pendingRequests: 0, revision: 1,
    };
    expect(SessionDigestSchema.safeParse(digest).success).toBe(true);
    expect(SessionDigestSchema.safeParse({ ...digest, phase: 'sleeping' }).success).toBe(false);
  });
});
