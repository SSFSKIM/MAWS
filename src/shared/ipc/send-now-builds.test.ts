// What the UX wave's U4a sends that build F can meet (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md,
// Acceptance 19 and Interfaces J; the root's UC-14). Two optional keys on X1 events, `turn.ended.endedForMessage` and
// `user.message.joined`: a build that does not know them drops the key and keeps the event (`readTolerant`), and this
// build reads F's events, which never carry them. The commands F's window sends for the same acts take F's inputs
// unchanged.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { ContentBlockSchema, EventBaseSchema, SessionEventSchema, TokenUsageSchema } from '../graph/events';
import { MessageUuidSchema, ToolUseIdSchema } from '../graph/ids';
import { commands } from './schema';
import { readTolerant } from './tolerant';

// The two members as build F (`f1852de3a`) has them, copied literally: `events.ts`, its base and ids, and
// `ipc/tolerant.ts` are unchanged from F to this branch's base, so each copy is F's own schema.
const BUILD_F_TURN_ENDED = z.strictObject({
  ...EventBaseSchema.shape,
  kind: z.literal('turn.ended'),
  result: z.string(), isError: z.boolean(), terminalReason: z.string().nullable(), resultText: z.string().nullable(),
  durationMs: z.number(), numTurns: z.number(), costUsd: z.number(), usage: TokenUsageSchema,
  permissionDenials: z.array(z.strictObject({ toolName: z.string(), toolUseId: ToolUseIdSchema, toolInput: z.unknown() })),
  errors: z.array(z.string()), userMessageUuids: z.array(MessageUuidSchema),
  origin: z.string().nullable(),
  resultIndex: z.number().nullable(),
  isEchoReceipt: z.boolean(),
});
const BUILD_F_USER_MESSAGE = z.strictObject({
  ...EventBaseSchema.shape,
  kind: z.literal('user.message'),
  messageUuid: MessageUuidSchema.nullable(), content: z.union([z.string(), z.array(ContentBlockSchema)]), isReplay: z.boolean(),
  isSynthetic: z.boolean(), origin: z.string().nullable(),
  bash: z.discriminatedUnion('part', [
    z.strictObject({ part: z.literal('input'), command: z.string() }),
    z.strictObject({ part: z.literal('output'), stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
  ]).nullable(),
});

const base = { id: 'e1', sessionId: 's1', at: '2026-11-13T10:00:00.000Z', seq: 46, agentId: null, parentToolUseId: null };
const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null };
const ended = (fields: Record<string, unknown> = {}) => ({
  ...base, kind: 'turn.ended', result: 'success', isError: false, terminalReason: 'aborted_tools', resultText: '', durationMs: 13_146, numTurns: 2, costUsd: 0.001,
  usage, permissionDenials: [], errors: [], userMessageUuids: ['m-cut'], origin: 'human', resultIndex: 0, isEchoReceipt: false, ...fields,
});
const replay = (fields: Record<string, unknown> = {}) => ({
  ...base, seq: 60, kind: 'user.message', messageUuid: 'm-second', content: 'Reply PINEAPPLE.\nReply MANGO.', isReplay: true, isSynthetic: false, origin: 'human', bash: null, ...fields,
});

describe('turn.ended’s endedForMessage, between builds', () => {
  it('build F reads the marked end with the key dropped: the end reads as a stop there, as it does today', () => {
    const sent = ended({ endedForMessage: true });
    expect(BUILD_F_TURN_ENDED.safeParse(sent).success).toBe(false); // strict: F refuses the key outright
    expect(readTolerant(BUILD_F_TURN_ENDED, sent)).toEqual({ ok: true, value: ended(), dropped: ['endedForMessage'] });
  });

  it('this build reads F’s end, which has no key, and the key only as true', () => {
    expect(SessionEventSchema.parse(ended())).toEqual(ended());
    expect(SessionEventSchema.parse(ended({ endedForMessage: true }))).toEqual(ended({ endedForMessage: true }));
    expect(SessionEventSchema.safeParse(ended({ endedForMessage: false })).success).toBe(false);
  });
});

describe('user.message’s joined, between builds', () => {
  it('build F reads the joined replay with the key dropped (its reader then adds nothing for a prompt already placed)', () => {
    const sent = replay({ joined: ['m-first'] });
    expect(BUILD_F_USER_MESSAGE.safeParse(sent).success).toBe(false);
    expect(readTolerant(BUILD_F_USER_MESSAGE, sent)).toEqual({ ok: true, value: replay(), dropped: ['joined'] });
  });

  it('this build reads F’s message, which has no key, and the key as a list of message uuids', () => {
    expect(SessionEventSchema.parse(replay())).toEqual(replay());
    expect(SessionEventSchema.parse(replay({ joined: ['m-first'] }))).toEqual(replay({ joined: ['m-first'] }));
    expect(SessionEventSchema.safeParse(replay({ joined: 'm-first' })).success).toBe(false);
  });
});

describe('the commands build F’s window sends for the same acts take F’s inputs, unchanged', () => {
  const app = { appSessionId: 'app-f' };
  it.each([
    ['session.interrupt', { ...app, cancelEngineQueued: false, holdEngineQueued: true }], // F's Stop
    ['session.interrupt', { ...app, cancelEngineQueued: false }], // F's Esc and Send now on a next-step row
    ['session.queue.promote', { ...app, queueId: 'q-1', priority: 'now' }], // F's Send now on an after-the-turn row
    ['session.steer.cancel', { ...app, messageUuid: 'm-1' }],
    ['session.queue.hold', { ...app, messageUuid: 'm-1' }],
  ] as const)('%s with %j', (name, input) => {
    expect(commands[name].input.safeParse(input).success).toBe(true);
  });
});
