// The browser's record of each project's log, by offset (the DC5 plan's M1: a reload resumes from it, never from the
// start). Events are kept as the hub sent them, code and all, and verified again whenever they are read for drawing.
import type { LogEvent } from 'desk-hub/protocol';
import { committed, DESK_DB, done, openDesk } from '../store/idb';

export type LogEntry = { offset: number; event: LogEvent };

export interface LogRecord {
  /** The project's entries in offset order. */
  load(project: string): Promise<LogEntry[]>;
  append(project: string, entries: LogEntry[]): Promise<void>;
  clear(project: string): Promise<void>;
}

const range = (project: string) => IDBKeyRange.bound([project, -Infinity], [project, Infinity]);

export function idbLogRecord(): LogRecord {
  return {
    async load(project) {
      const store = (await openDesk()).transaction(DESK_DB.log).objectStore(DESK_DB.log);
      const [events, keys] = await Promise.all([done(store.getAll(range(project))), done(store.getAllKeys(range(project)))]);
      return keys.map((k, i) => ({ offset: (k as [string, number])[1], event: events[i] as LogEvent }));
    },
    async append(project, entries) {
      const tx = (await openDesk()).transaction(DESK_DB.log, 'readwrite');
      const store = tx.objectStore(DESK_DB.log);
      for (const { offset, event } of entries) store.put(event, [project, offset]);
      await committed(tx);
    },
    async clear(project) {
      const tx = (await openDesk()).transaction(DESK_DB.log, 'readwrite');
      tx.objectStore(DESK_DB.log).delete(range(project));
      await committed(tx);
    },
  };
}

export function memoryLogRecord(): LogRecord {
  const projects = new Map<string, Map<number, LogEvent>>();
  const of = (project: string) => projects.get(project) ?? projects.set(project, new Map()).get(project)!;
  return {
    load: async (project) => [...of(project)].sort(([a], [b]) => a - b).map(([offset, event]) => ({ offset, event })),
    append: async (project, entries) => {
      for (const { offset, event } of entries) of(project).set(offset, event);
    },
    clear: async (project) => void projects.delete(project),
  };
}
