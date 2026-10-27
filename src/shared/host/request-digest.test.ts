// Lane B's request digest (O10 M7): the four fields of DX6's `Digest`, drawn from a pending request's originating event.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from './request-digest';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const event = (fields: Record<string, unknown>) => fields as unknown as SessionEvent;

describe('requestDigestOf', () => {
  it('names a permission by its tool and hashes its input’s canonical JSON (keys sorted)', () => {
    const digest = requestDigestOf('app-1', event({ kind: 'permission.requested', requestId: 'rq-1', toolName: 'Bash', input: { command: 'ls', description: 'list' } }));
    expect(digest).toEqual({ session: 'app-1', request: 'rq-1', tool: 'Bash', input_sha256: sha('{"command":"ls","description":"list"}') });
  });

  it('names any other request by its kind, and hashes what it asks (questions, a plan’s input, a payload)', () => {
    expect(requestDigestOf('app-1', event({ kind: 'question.requested', requestId: 'rq-2', questions: [{ question: 'q?' }] }))).toEqual({ session: 'app-1', request: 'rq-2', tool: 'question.requested', input_sha256: sha('[{"question":"q?"}]') });
    expect(requestDigestOf('app-1', event({ kind: 'plan.requested', requestId: 'rq-3', plan: '# p', input: { plan: '# p' } }))?.input_sha256).toBe(sha('{"plan":"# p"}'));
    expect(requestDigestOf('app-1', event({ kind: 'dialog.requested', requestId: 'rq-4', dialogKind: 'x', payload: { a: 1 } }))?.input_sha256).toBe(sha('{"a":1}'));
  });

  it('draws none from an event that opens no request', () => {
    expect(requestDigestOf('app-1', event({ kind: 'turn.started' }))).toBeNull();
  });
});
