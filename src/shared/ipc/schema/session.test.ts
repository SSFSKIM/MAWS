import { describe, expect, it } from 'vitest';
import { validateCommandInput, validateCommandOutput } from '../validate';
import { SessionDigestSchema, SessionPatchSchema } from './session';
import { ArchiveOutcomeSchema, commands, DeleteOutcomeSchema, events } from './session'; // C10

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

// C10 start: the lifecycle commands and the setup events (C10 execution document, "X2 additions")
describe('C10 session lifecycle entries', () => {
  const ID = '0b6a2d3e-8f1c-4a57-9b2e-1d3c4e5f6a7b';
  it('registers every C10 name with its owner, and the two events', () => {
    const main = [
      'session.archive', 'session.create', 'session.delete', 'session.fork', 'session.intent.discard', 'session.intent.get', 'session.intent.list',
      'session.intent.patch', 'session.intent.release', 'session.intent.resolveWorktree', 'session.rename', 'session.revealPath', 'session.start', 'session.trust.check',
      'session.deletions.list', 'session.deletions.keep',
    ] as const;
    for (const name of main) expect(commands[name].owner, name).toBe('main');
    expect(commands['session.forget'].owner).toBe('engine-host');
    expect(Object.hasOwn(events, 'session.setup')).toBe(true);
    expect(Object.hasOwn(events, 'session.intent.changed')).toBe(true);
  });

  it('takes a start with a first message and resume overrides, and nothing else in options', () => {
    const start = (input: unknown) => validateCommandInput('session.start', input).ok;
    expect(start({ appSessionId: ID, message: { content: 'hi', display: 'hi' }, options: {} })).toBe(true);
    expect(start({ appSessionId: ID, message: null, options: { gateway: 'direct', trust: 'accepted', model: null, effort: 'high' } })).toBe(true);
    expect(start({ appSessionId: ID, message: null, options: { trust: 'maybe' } })).toBe(false);
    expect(start({ appSessionId: ID, message: null, options: { cwd: '/x' } })).toBe(false);
  });

  it('answers a release with the intent, or null for a record whose resume message it handed back', () => {
    expect(validateCommandOutput('session.intent.release', null).ok).toBe(true);
    expect(validateCommandOutput('session.intent.release', { appSessionId: ID }).ok).toBe(false);
  });

  it('resolves a retained worktree by discarding or keeping it, nothing else', () => {
    const resolve = (resolution: unknown) => validateCommandInput('session.intent.resolveWorktree', { appSessionId: ID, resolution }).ok;
    expect(resolve('discard')).toBe(true);
    expect(resolve('keep')).toBe(true);
    expect(resolve('force')).toBe(false);
  });

  it('bounds a rename to a non-empty title of at most 200 characters', () => {
    const rename = (title: string) => validateCommandInput('session.rename', { appSessionId: ID, title }).ok;
    expect(rename('A title')).toBe(true);
    expect(rename('   ')).toBe(false);
    expect(rename('x'.repeat(201))).toBe(false);
  });

  it('never patches message or progress from the renderer', () => {
    const patch = (p: unknown) => validateCommandInput('session.intent.patch', { appSessionId: ID, patch: p }).ok;
    expect(patch({ model: 'sonnet', trust: 'declined' })).toBe(true);
    expect(patch({ message: { content: 'x', display: 'x' } })).toBe(false);
    expect(patch({ progress: {} })).toBe(false);
  });

  it('shapes archive and delete outcomes', () => {
    expect(ArchiveOutcomeSchema.safeParse({ archived: true }).success).toBe(true);
    expect(ArchiveOutcomeSchema.safeParse({ status: 'skipped_live', holder: { kind: 'self' } }).success).toBe(true);
    expect(DeleteOutcomeSchema.safeParse({ status: 'partial', trashed: ['/a'], failed: { path: '/b', error: 'EPERM' } }).success).toBe(true);
    expect(DeleteOutcomeSchema.safeParse({ status: 'stop_unconfirmed', detail: 'still exiting' }).success).toBe(true);
    expect(DeleteOutcomeSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});
// C10 end
