// X1's `assistant.block.complete.thinkingDurationMs` between builds a version apart (UX wave U2, X1's amendment; the U2a
// execution document, Acceptance 14; P5 O1 M6's rule for builds a minor apart). A build that does not know the field
// drops it and keeps the event; this build reads an older one's events, which have no field.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { readTolerant } from '../ipc/tolerant';
import { REGISTRY } from '../ipc/registry';
import { codecOf } from '../ipc/validate';
import { ContentBlockSchema, EventBaseSchema, SessionEventSchema } from './events';
import { ApiMessageIdSchema, AppSessionIdSchema, MessageUuidSchema } from './ids';

// `assistant.block.complete` as build F (`f1852de3a`) has it, copied literally from F's `events.ts`.
const BUILD_F_BLOCK_COMPLETE = z.strictObject({
  ...EventBaseSchema.shape,
  kind: z.literal('assistant.block.complete'),
  messageUuid: MessageUuidSchema, apiMessageId: ApiMessageIdSchema, blockIndex: z.number(), block: ContentBlockSchema, model: z.string(),
  supersedes: z.array(MessageUuidSchema), aborted: z.boolean(), userMessageUuids: z.array(MessageUuidSchema),
  isApiErrorMessage: z.boolean().optional(), error: z.string().optional(),
});

const base = { id: 'e1', sessionId: 's1', at: '2026-11-13T10:00:00.000Z', seq: 7, agentId: null, parentToolUseId: null };
const complete = (fields: Record<string, unknown> = {}) => ({
  ...base, kind: 'assistant.block.complete', messageUuid: 'm-1', apiMessageId: 'msg_1', blockIndex: 0,
  block: { type: 'thinking', thinking: 'Weighing the two layouts first.', signature: 'sig' }, model: 'claude-test', supersedes: [], aborted: false, userMessageUuids: [], ...fields,
});

describe('assistant.block.complete’s recorded duration, between builds', () => {
  it('an older build (F) reads this build’s event with the field dropped and the rest kept', () => {
    const sent = complete({ thinkingDurationMs: 12_400 });
    expect(BUILD_F_BLOCK_COMPLETE.safeParse(sent).success).toBe(false); // strict: F refuses the field outright
    expect(readTolerant(BUILD_F_BLOCK_COMPLETE, sent)).toEqual({ ok: true, value: complete(), dropped: ['thinkingDurationMs'] });
  });

  it('a window of build F receives it across the link without the field', () => {
    const buildFEvents = SessionEventSchema.options.map((option) => (option.shape.kind.value === 'assistant.block.complete' ? BUILD_F_BLOCK_COMPLETE : option));
    const BUILD_F_EVENT = z.discriminatedUnion('kind', buildFEvents as unknown as [typeof BUILD_F_BLOCK_COMPLETE]);
    const buildFLink = codecOf({ ...REGISTRY, commands: {}, events: { 'session.eventBatch': z.strictObject({ appSessionId: AppSessionIdSchema, events: z.array(BUILD_F_EVENT).max(500) }) } });
    const sent = { appSessionId: 'app-1', events: [complete({ thinkingDurationMs: 12_400 })] };
    expect(buildFLink.readEventPayload('session.eventBatch', sent)).toEqual({ ok: true, value: { appSessionId: 'app-1', events: [complete()] }, dropped: ['events.0.thinkingDurationMs'] });
  });

  it('this build reads an older build’s event, which has no field, and the field as a number that is not negative', () => {
    expect(SessionEventSchema.parse(complete())).toEqual(complete());
    expect(SessionEventSchema.parse(complete({ thinkingDurationMs: 0 }))).toEqual(complete({ thinkingDurationMs: 0 }));
    expect(SessionEventSchema.parse(complete({ thinkingDurationMs: 10_192 }))).toEqual(complete({ thinkingDurationMs: 10_192 }));
    expect(SessionEventSchema.safeParse(complete({ thinkingDurationMs: -1 })).success).toBe(false);
    expect(SessionEventSchema.safeParse(complete({ thinkingDurationMs: '10192' })).success).toBe(false);
  });
});
