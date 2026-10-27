// Lane B's request digest (O10 M7): DX6's `Digest`, drawn from a pending request's originating event in the shape lane A
// draws it from the tool call (desk-hub's `inputSha256`), so a device computes one digest the same way on either lane.
import { createHash } from 'node:crypto';
import { inputSha256 } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from './request-digest';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const event = (fields: Record<string, unknown>) => fields as unknown as SessionEvent;

// A question as lane B's event carries it (QuestionSchema: every field present, absent ones null).
const QUESTIONS = [
  { question: 'Which column do we keep?', header: 'Column', options: [{ label: 'user_id', description: 'what the API reads', preview: null }, { label: 'owner_id', description: null, preview: null }], multiSelect: false },
];

describe('requestDigestOf', () => {
  it('names a permission by its tool and hashes its input’s canonical JSON (keys sorted)', () => {
    const digest = requestDigestOf('app-1', event({ kind: 'permission.requested', requestId: 'rq-1', toolName: 'Bash', input: { command: 'ls', description: 'list' } }));
    expect(digest).toEqual({ session: 'app-1', request: 'rq-1', tool: 'Bash', input_sha256: sha('{"command":"ls","description":"list"}') });
  });

  it('names a question and a plan by the tool lane A names them by, hashing the tool input: `{questions}`, a plan’s `input`', () => {
    expect(requestDigestOf('app-1', event({ kind: 'question.requested', requestId: 'rq-2', questions: [{ question: 'q?' }] }))).toEqual({ session: 'app-1', request: 'rq-2', tool: 'AskUserQuestion', input_sha256: sha('{"questions":[{"question":"q?"}]}') });
    expect(requestDigestOf('app-1', event({ kind: 'plan.requested', requestId: 'rq-3', plan: '# p', input: { plan: '# p' } }))).toEqual({ session: 'app-1', request: 'rq-3', tool: 'ExitPlanMode', input_sha256: sha('{"plan":"# p"}') });
  });

  it('names a request with no lane A counterpart by its kind, hashing its payload', () => {
    expect(requestDigestOf('app-1', event({ kind: 'dialog.requested', requestId: 'rq-4', dialogKind: 'x', payload: { a: 1 } }))).toEqual({ session: 'app-1', request: 'rq-4', tool: 'dialog.requested', input_sha256: sha('{"a":1}') });
    expect(requestDigestOf('app-1', event({ kind: 'elicitation.requested', requestId: 'rq-5', mcpServerName: 's', payload: { b: 2 } }))?.tool).toBe('elicitation.requested');
  });

  it('draws the digest lane A draws for the same question and plan (desk-hub’s inputSha256 over the tool input)', async () => {
    const laneA = async (tool: string, input: Parameters<typeof inputSha256>[0]) => ({ session: 'app-1', request: 'toolu_q1', tool, input_sha256: await inputSha256(input) });
    expect(requestDigestOf('app-1', event({ kind: 'question.requested', requestId: 'toolu_q1', toolUseId: 'toolu_q1', questions: QUESTIONS }))).toEqual(await laneA('AskUserQuestion', { questions: QUESTIONS }));
    const plan = { plan: '# Plan\n\n1. keep `user_id`', allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }] };
    expect(requestDigestOf('app-1', event({ kind: 'plan.requested', requestId: 'toolu_q1', toolUseId: 'toolu_q1', plan: plan.plan, input: plan }))).toEqual(await laneA('ExitPlanMode', plan));
  });

  it('draws none from an event that opens no request', () => {
    expect(requestDigestOf('app-1', event({ kind: 'turn.started' }))).toBeNull();
  });
});
