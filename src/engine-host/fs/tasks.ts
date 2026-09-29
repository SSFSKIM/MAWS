// Persisted task lists (C4 execution document, M3; SPEC 20.2.3, 20.2.4): `<configHome>/tasks/<listId>/<id>.json`,
// pretty-printed `PersistedTask` records the engine rewrites in place (read with retry; a torn read keeps the last
// whole value, a file that never read whole is left out as the engine's own reader leaves out a record that fails its
// schema). Tasks whose `metadata._internal` is truthy are hidden, as the engine's `TaskList` hides them. Read-only.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PersistedTaskSchema, type PersistedTask } from '@shared/wire/store';
import type { StorePaths } from './paths';
import { isMissing, noteReadable, noteUnreadable, readJsonWithRetry } from './sidecars';

export class TaskReader {
  private readonly tasks = new Map<string, PersistedTask>(); // last whole record, by path

  constructor(private readonly paths: StorePaths) {}

  async list(listId: string): Promise<PersistedTask[]> {
    const dir = join(this.paths.tasks, sanitizeListId(listId));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const read = await Promise.all(names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).map((name) => this.read(join(dir, name))));
    return read
      .filter((task): task is PersistedTask => task !== null && !task.metadata?._internal)
      .sort((a, b) => compareIds(a.id, b.id));
  }

  private async read(path: string): Promise<PersistedTask | null> {
    const read = await readJsonWithRetry(path, (raw) => PersistedTaskSchema.parse(raw));
    if (read.status === 'unreadable') noteUnreadable(path, read.code);
    else noteReadable(path);
    if (read.status === 'ok') this.tasks.set(path, read.value);
    else if (read.status === 'absent') this.tasks.delete(path);
    return this.tasks.get(path) ?? null;
  }
}

// The engine's `WA`: every character outside [a-zA-Z0-9_-] becomes '-' (SPEC 20.2.3), which also keeps a list id from
// naming a path outside `tasks/`.
export function sanitizeListId(listId: string): string {
  return listId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

// Ids are decimal strings; numeric order, with any non-numeric id after the numbers in string order.
function compareIds(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : Number.POSITIVE_INFINITY;
  const nb = /^\d+$/.test(b) ? Number(b) : Number.POSITIVE_INFINITY;
  return na !== nb ? na - nb : a.localeCompare(b);
}
