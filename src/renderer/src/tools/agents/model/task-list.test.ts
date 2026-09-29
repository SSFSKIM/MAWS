import { describe, expect, it } from 'vitest';
import type { SessionId } from '@shared/graph/ids';
import type { PersistedTask } from '@shared/wire/store';
import { record, status } from '../../../../../../test/support/builders';
import { checklistOf, listIdFor, sanitiseListId } from './task-list';

const task = (id: string, taskStatus: PersistedTask['status'], over: Partial<PersistedTask> = {}): PersistedTask => ({
  id, subject: `Task ${id}`, description: '', status: taskStatus, blocks: [], blockedBy: [], ...over,
});

describe('task list', () => {
  it('sanitises a list id as the engine does', () => {
    expect(sanitiseListId('a/b c')).toBe('a-b-c');
    expect(sanitiseListId('team_list-2')).toBe('team_list-2');
    expect(sanitiseListId('../x')).toBe('---x');
  });

  it('takes a live session’s list from the status, never a guess', () => {
    expect(listIdFor({ ...status('A'), taskListId: 'sess 1' }, record('A'))).toEqual({ listId: 'sess-1', label: 'list' });
    expect(listIdFor({ ...status('A'), taskListId: null }, record('A'))).toEqual({ listId: null, reason: 'no id yet' });
  });

  it('takes a disk-only session’s list from its engine session id, labelled session list', () => {
    expect(listIdFor(null, record('A', { engineSessionId: 'e1/x' as SessionId }))).toEqual({ listId: 'e1-x', label: 'session list' });
    expect(listIdFor(null, record('A', { engineSessionId: null }))).toEqual({ listId: null, reason: 'no session' });
    expect(listIdFor(null, null)).toEqual({ listId: null, reason: 'no session' });
  });

  it('orders in-progress before pending, each in id order, and folds the completed ones', () => {
    const tasks = [task('10', 'pending'), task('2', 'completed'), task('3', 'in_progress'), task('1', 'completed'), task('4', 'pending'), task('11', 'in_progress', { activeForm: 'Writing' })];
    const list = checklistOf(tasks);
    expect(list.total).toBe(6);
    expect(list.completed).toBe(2);
    expect(list.open.map((t) => t.id)).toEqual(['3', '11', '4', '10']);
    expect(list.earlier.map((t) => t.id)).toEqual(['1', '2']);
    expect(checklistOf([])).toEqual({ total: 0, completed: 0, open: [], earlier: [] });
  });
});
