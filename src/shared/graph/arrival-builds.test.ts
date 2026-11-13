// X1's `user.message.arrival` between builds a version apart (UX wave U3, UC-2; the U3a execution document, Acceptance 9,
// the child's check 7; P5 O1 M6's rule for builds a minor apart). A build that does not know the field drops it and keeps
// the event; this build reads an older one's events, which have no field; and a later build's entries of a class this
// build does not know are ignored while a class it knows is held to its schema.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { readTolerant } from '../ipc/tolerant';
import { codecOf } from '../ipc/validate';
import { carriedOf } from '../engine/arrival';
import { ContentBlockSchema, EventBaseSchema, SessionEventSchema } from './events';
import { AppSessionIdSchema, MessageUuidSchema, TaskIdSchema, ToolUseIdSchema } from './ids';

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

// `task.notification`'s `arrivals` mark (the whole-branch review's finding 3, the architect's ruling of 2026-11-13): the
// modern normaliser's word that the task's end is told by an arrival, so the event draws no line of its own. A window
// of an earlier minor receives a later build's events at main, through the tolerant codec (`codecOf(registry)`, OX1):
// another machine's events cross its link there (`src/main/machines/socket-link.ts`, `readEventPayload` and, for a
// `session.events` answer, `readCommandOutput`), and an engine host's reach main's supervisor the same way
// (`src/shared/host/host-supervisor.ts`). Both read with `readTolerant`, so the mark is dropped as any unknown key is.
describe('task.notification’s arrivals mark, between builds', () => {
  // `task.notification` and `session.eventBatch` as build F (`f1852de3a`) has them, copied literally: unchanged from F to
  // this branch's base. F's union is this build's with that one event in its own form.
  const BUILD_F_TASK_NOTIFICATION = z.strictObject({
    ...EventBaseSchema.shape,
    kind: z.literal('task.notification'),
    taskId: TaskIdSchema, toolUseId: ToolUseIdSchema.nullable(), status: z.enum(['completed', 'failed', 'stopped']), summary: z.string(), outputFile: z.string().nullable(), reason: z.string().nullable(),
  });
  const buildFEvents = SessionEventSchema.options.map((option) => (option.shape.kind.value === 'task.notification' ? BUILD_F_TASK_NOTIFICATION : option));
  const BUILD_F_EVENT = z.discriminatedUnion('kind', buildFEvents as unknown as [typeof BUILD_F_TASK_NOTIFICATION]);
  const buildFLink = codecOf({ commands: {}, events: { 'session.eventBatch': z.strictObject({ appSessionId: AppSessionIdSchema, events: z.array(BUILD_F_EVENT).max(500) }) } });
  const notification = (fields: Record<string, unknown> = {}) => ({ ...base, kind: 'task.notification', taskId: 'b-1', toolUseId: 'toolu_a', status: 'failed', summary: 'Background command "build" failed with exit code 1', outputFile: '/tmp/demo/b-1.output', reason: null, ...fields });

  it('a window of build F receives the marked event across the link without the mark, and it parses under F’s schema', () => {
    const sent = { appSessionId: 'app-1', events: [notification({ arrivals: true })] };
    expect(buildFLink.validateEventPayload('session.eventBatch', sent).ok).toBe(false); // strict: F refuses the field outright
    const read = buildFLink.readEventPayload('session.eventBatch', sent);
    expect(read).toEqual({ ok: true, value: { appSessionId: 'app-1', events: [notification()] }, dropped: ['events.0.arrivals'] });
    expect(read.ok && BUILD_F_TASK_NOTIFICATION.parse(read.value.events[0])).toEqual(notification());
  });

  it('this build reads an older build’s event, which has no mark, and the mark only as true', () => {
    expect(SessionEventSchema.parse(notification())).toEqual(notification());
    expect(SessionEventSchema.parse(notification({ arrivals: true }))).toEqual(notification({ arrivals: true }));
    expect(SessionEventSchema.safeParse(notification({ arrivals: false })).success).toBe(false);
  });
});
