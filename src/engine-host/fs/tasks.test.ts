import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PersistedTask } from '@shared/wire/store';
import { StoreFixture } from '../../../test/support/store-fixture';
import { TaskReader } from './tasks';

const task = (id: string, extra: Partial<PersistedTask> = {}): PersistedTask => ({
  id, subject: `Task ${id}`, description: `Do ${id}`, status: 'pending', blocks: [], blockedBy: [], ...extra,
});

describe('task lists are read from tasks/<listId>/', () => {
  let fixture: StoreFixture;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  it('lists the tasks in id order, hides _internal ones as the engine does, and skips the lock and high-water mark', async () => {
    const listId = '11111111-1111-4111-8111-111111111111';
    for (const t of [task('10'), task('2', { status: 'in_progress', activeForm: 'Doing 2' }), task('1'), task('3', { metadata: { _internal: true } })]) await fixture.addTask(listId, t);
    await writeFile(join(fixture.paths.tasks, listId, '.lock'), '');
    await writeFile(join(fixture.paths.tasks, listId, '.highwatermark'), '10');
    const tasks = await new TaskReader(fixture.paths).list(listId);
    expect(tasks.map((t) => t.id)).toEqual(['1', '2', '10']);
    expect(tasks[1]).toMatchObject({ status: 'in_progress', activeForm: 'Doing 2' });
  });

  it('answers an empty list for a list that does not exist, and sanitises the id as the engine does', async () => {
    const reader = new TaskReader(fixture.paths);
    expect(await reader.list('no-such-list')).toEqual([]);
    await fixture.addTask('my-team', task('1'));
    // The engine writes tasks/<id with every character outside [a-zA-Z0-9_-] as '-'>/: a list id cannot leave tasks/.
    expect(await reader.list('my team')).toEqual([expect.objectContaining({ id: '1' })]);
    expect(await reader.list('../my-team')).toEqual([]);
  });

  it('keeps the last whole value of a task whose file is torn, and drops one that never read whole', async () => {
    const reader = new TaskReader(fixture.paths);
    const path = await fixture.addTask('list', task('1', { subject: 'Before' }));
    expect((await reader.list('list'))[0].subject).toBe('Before');
    await writeFile(path, '{"id":"1","subj');
    await fixture.addTask('list', task('2'));
    await writeFile(join(fixture.paths.tasks, 'list', '3.json'), '{"id":"3"'); // never whole
    expect((await reader.list('list')).map((t) => [t.id, t.subject])).toEqual([['1', 'Before'], ['2', 'Task 2']]);
  });
});
