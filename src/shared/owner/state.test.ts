import { describe, expect, it } from 'vitest';
import { OwnerChannelStateSchema, QuestionStateSchema } from './state';

const question = (state: unknown) => ({
  id: 'app-1:u-1:0:q0', kind: 'need-input', anchor: { messageUuid: 'u-1', blockIndex: 0, span: 0 }, head: 'Which backend?',
  at: '2026-10-09T10:00:00.000Z', item: true, question: state,
});

describe('the owner channel’s state (Interfaces X18)', () => {
  it('carries the lane and every mark state main reports', () => {
    const state = {
      appSessionId: 'app-1',
      lane: { on: true, override: 'inherit', applied: 'off', pending: 'next-compaction', mismatch: { resolved: 'default', observed: 'Explanatory' } },
      marks: [
        question({ state: 'unanswered', failed: { reason: 'The session has exited.' } }),
        question({ state: 'queued', text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [{ kind: 'entry', id: 'q-1', life: 'alive' }] }),
        question({ state: 'unconfirmed', text: 'Answering "Which backend?": x', origin: 'reply', members: [{ kind: 'uuid', id: 'u-9', life: 'unknown' }] }),
        question({ state: 'delivered', answer: { text: 'Answering "Which backend?": Postgres', origin: 'legacy', at: '2026-10-09T10:01:00.000Z' } }),
        question({ state: 'retired' }),
        { id: 'app-1:u-1:0:e0', kind: 'essential', anchor: { messageUuid: 'u-1', blockIndex: 0, span: 0 }, head: 'Read this.', at: '2026-10-09T10:00:00.000Z', item: false, essential: { state: 'read', readAt: '2026-10-09T10:02:00.000Z' } },
      ],
    };
    expect(OwnerChannelStateSchema.parse(state)).toEqual(state);
  });

  it('only a delivered answer may be legacy, and a member’s life is one of four', () => {
    expect(QuestionStateSchema.safeParse({ state: 'queued', text: 't', origin: 'legacy', members: [] }).success).toBe(false);
    expect(QuestionStateSchema.safeParse({ state: 'queued', text: 't', origin: 'answer', members: [{ kind: 'uuid', id: 'u', life: 'gone' }] }).success).toBe(false);
  });
});
