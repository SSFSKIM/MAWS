// Who started a task, on the wire (the UX wave's U8b document, M5 decision 1): `parentTaskId`, optional, on three shapes:
// the `task.started` event, each entry of `tasks.snapshot` and each entry of the status's `backgroundTasks`. Both
// directions within the major: an older reader (these shapes as they were before the key, read tolerantly as the
// codec reads a peer of another minor) drops the key and refuses nothing; this build reads a value an older producer
// wrote, without the key.
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { status } from '../../../test/support/builders';
import { EngineSessionStatusSchema } from '../engine/status';
import { readTolerant } from '../ipc/tolerant';
import { EventBaseSchema, SessionEventSchema } from './events';
import { TaskIdSchema, ToolUseIdSchema } from './ids';

// The three shapes at wire minor 36, before the key.
const OLDER_ENTRY = z.strictObject({ taskId: TaskIdSchema, taskType: z.string(), description: z.string(), ambient: z.boolean() });
const OLDER_TASK_STARTED = z.strictObject({
  ...EventBaseSchema.shape, kind: z.literal('task.started'),
  taskId: TaskIdSchema, toolUseId: ToolUseIdSchema.nullable(), taskType: z.string(), description: z.string(), isBackground: z.boolean(), workflowName: z.string().nullable(),
});
const OLDER_TASKS_SNAPSHOT = z.strictObject({ ...EventBaseSchema.shape, kind: z.literal('tasks.snapshot'), tasks: z.array(OLDER_ENTRY) });
const OLDER_STATUS = EngineSessionStatusSchema.extend({ backgroundTasks: z.array(OLDER_ENTRY) });

const base = { id: 'app:launch:7:0', sessionId: 'sess-1', at: '2026-11-12T10:00:00.000Z', seq: 7, agentId: null, parentToolUseId: null };
const started = { ...base, kind: 'task.started', taskId: 'b-shell', toolUseId: 'toolu_shell', taskType: 'local_bash', description: 'sleep 30', isBackground: true, workflowName: null };
const entry = { taskId: 'b-shell', taskType: 'local_bash', description: 'sleep 30', ambient: false };
const snapshot = { ...base, kind: 'tasks.snapshot', tasks: [{ taskId: 'a-agent', taskType: 'local_agent', description: 'Probe', ambient: false }, entry] };
const statusOf = (backgroundTasks: unknown[]) => ({ ...status('app-1'), backgroundTasks });

describe('a task’s starter on the wire', () => {
  it('this build reads the key on each of the three shapes', () => {
    expect(SessionEventSchema.parse({ ...started, parentTaskId: 'a-agent' })).toMatchObject({ parentTaskId: 'a-agent' });
    expect(SessionEventSchema.parse({ ...snapshot, tasks: [snapshot.tasks[0], { ...entry, parentTaskId: 'a-agent' }] })).toMatchObject({ tasks: [{}, { parentTaskId: 'a-agent' }] });
    expect(EngineSessionStatusSchema.parse(statusOf([{ ...entry, parentTaskId: 'a-agent' }])).backgroundTasks).toEqual([{ ...entry, parentTaskId: 'a-agent' }]);
  });

  it('an older reader drops the key from each shape and refuses nothing', () => {
    const readStarted = readTolerant(OLDER_TASK_STARTED, { ...started, parentTaskId: 'a-agent' });
    expect(readStarted).toMatchObject({ ok: true, value: started, dropped: ['parentTaskId'] });
    const readSnapshot = readTolerant(OLDER_TASKS_SNAPSHOT, { ...snapshot, tasks: [snapshot.tasks[0], { ...entry, parentTaskId: 'a-agent' }] });
    expect(readSnapshot).toMatchObject({ ok: true, value: snapshot, dropped: ['tasks.1.parentTaskId'] });
    const readStatus = readTolerant(OLDER_STATUS, statusOf([{ ...entry, parentTaskId: 'a-agent' }]));
    expect(readStatus).toMatchObject({ ok: true, dropped: ['backgroundTasks.0.parentTaskId'] });
    expect(readStatus.ok && readStatus.value.backgroundTasks).toEqual([entry]);
  });

  it('this build reads each shape an older producer wrote, without the key', () => {
    expect(SessionEventSchema.parse(started)).not.toHaveProperty('parentTaskId');
    expect(SessionEventSchema.parse(snapshot)).toEqual(snapshot);
    expect(EngineSessionStatusSchema.parse(statusOf([entry])).backgroundTasks).toEqual([entry]);
  });

  it('refuses a starter that is no string', () => {
    expect(SessionEventSchema.safeParse({ ...started, parentTaskId: 7 }).success).toBe(false);
    expect(EngineSessionStatusSchema.safeParse(statusOf([{ ...entry, parentTaskId: null }])).success).toBe(false);
  });
});
