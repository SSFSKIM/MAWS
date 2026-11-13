// X1's `user.message.arrival` between builds a version apart (UX wave U3, UC-2; the U3a execution document, Acceptance 9,
// the child's check 7; P5 O1 M6's rule for builds a minor apart). A build that does not know the field drops it and keeps
// the event; this build reads an older one's events, which have no field; and a later build's entries of a class this
// build does not know are ignored while a class it knows is held to its schema.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { readTolerant } from '../ipc/tolerant';
import { carriedOf } from '../engine/arrival';
import { ContentBlockSchema, EventBaseSchema, SessionEventSchema } from './events';
import { MessageUuidSchema } from './ids';

// `user.message` as build F (`f1852de3a`) has it, copied literally: `events.ts`, its base and ids, and `ipc/tolerant.ts`
// are unchanged from F to this branch's base, so the copy is F's own schema.
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

const base = { id: 'e1', sessionId: 's1', at: '2026-11-12T10:00:00.000Z', seq: 7, agentId: null, parentToolUseId: null };
const TASK = { class: 'task', taskId: 'b-1', toolUseId: 'toolu_a', runId: 'r-1', outcome: 'failed', summary: 'Background command "build" failed with exit code 1', durationMs: null, outputFile: '/tmp/demo/b-1.output', detail: null } as const;
const message = (fields: Record<string, unknown> = {}) => ({ ...base, kind: 'user.message', messageUuid: 'm-1', content: '', isReplay: false, isSynthetic: true, origin: 'task-notification', bash: null, ...fields });

describe('user.message’s arrival, between builds', () => {
  it('an older build (F) reads the wave’s event with the field dropped and the rest kept', () => {
    const sent = message({ arrival: [TASK] });
    expect(BUILD_F_USER_MESSAGE.safeParse(sent).success).toBe(false); // strict: F refuses the field outright
    expect(readTolerant(BUILD_F_USER_MESSAGE, sent)).toEqual({ ok: true, value: message(), dropped: ['arrival'] });
  });

  it('the wave’s build reads an older build’s event, which has no field, and a list that is empty', () => {
    expect(SessionEventSchema.parse(message())).toEqual(message());
    expect(SessionEventSchema.safeParse(message({ arrival: [] })).success).toBe(true);
    expect(SessionEventSchema.parse(message({ arrival: [TASK] }))).toEqual(message({ arrival: [TASK] }));
  });

  it('a later build’s entry of a class this build does not know is accepted and ignored, beside a known one', () => {
    const later = { class: 'command', run: { command: 'rename', args: 'x' }, stdout: 'Session renamed to: x', stderr: '' };
    const read = SessionEventSchema.parse(message({ arrival: [TASK, later] }));
    expect(read.kind === 'user.message' && read.arrival).toEqual([TASK, later]);
    expect(read.kind === 'user.message' && carriedOf(read.arrival)).toEqual([TASK]);
  });

  it('a list that holds only entries this build does not know is not the empty list: none of it is read', () => {
    const read = SessionEventSchema.parse(message({ arrival: [{ class: 'command', stdout: 'x', stderr: '' }] }));
    expect(read.kind === 'user.message' && read.arrival?.length).toBe(1);
    expect(read.kind === 'user.message' && carriedOf(read.arrival)).toEqual([]);
    expect(carriedOf(undefined)).toEqual([]);
  });

  it('an entry of a class this build knows is held to its schema, field for field', () => {
    expect(SessionEventSchema.safeParse(message({ arrival: [{ ...TASK, outcome: 'done' }] })).success).toBe(false);
    expect(SessionEventSchema.safeParse(message({ arrival: [{ class: 'schedule' }] })).success).toBe(false);
    expect(SessionEventSchema.safeParse(message({ arrival: [{ ...TASK, extra: 1 }] })).success).toBe(false);
    expect(SessionEventSchema.safeParse(message({ arrival: [{ class: 7 }] })).success).toBe(false);
    // Across the machine link, a later build's new field on a known class is dropped as any unknown key is.
    expect(readTolerant(SessionEventSchema, message({ arrival: [{ ...TASK, extra: 1 }] }))).toEqual({ ok: true, value: message({ arrival: [TASK] }), dropped: ['arrival.0.extra'] });
  });
});
