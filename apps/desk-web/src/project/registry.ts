// The projects open in this tab, one connection each, shared by every view of the project and closed shortly after
// the last view leaves it (a remount — React's development double mount, a route change back — keeps it). The org key
// reaches every open connection from the key holder.
import { useEffect } from 'react';
import { idbLogRecord, type LogRecord } from '../log/record';
import { useKeyHolder } from '../key/holder';
import { ProjectConnection } from './connection';

type Held = { connection: ProjectConnection; refs: number; closing: ReturnType<typeof setTimeout> | null };
const open = new Map<string, Held>();
let record: LogRecord | null = null;

export const hubBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

function held(project: string): Held {
  let h = open.get(project);
  if (!h) {
    record ??= idbLogRecord();
    const connection = new ProjectConnection(project, { base: hubBase(), record });
    connection.setKey(useKeyHolder.getState().key);
    h = { connection, refs: 0, closing: null };
    open.set(project, h);
  }
  return h;
}

function acquire(project: string): void {
  const h = held(project);
  h.refs++;
  if (h.closing) clearTimeout(h.closing);
  h.closing = null;
  void h.connection.start();
}

function release(project: string): void {
  const h = open.get(project);
  if (!h) return;
  h.refs--;
  if (h.refs > 0) return;
  h.closing = setTimeout(() => {
    if (h.refs > 0) return;
    open.delete(project);
    h.connection.stop();
  }, 1_000);
}

/** The project's connection, open while any view that asked for it is mounted. */
export function useProjectConnection(project: string): ProjectConnection {
  useEffect(() => {
    acquire(project);
    return () => release(project);
  }, [project]);
  return held(project).connection;
}

useKeyHolder.subscribe((state, prev) => {
  if (state.key === prev.key) return;
  for (const { connection } of open.values()) connection.setKey(state.key);
});
