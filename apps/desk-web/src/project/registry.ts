// The projects open in this tab, one connection each, shared by every view of the project and closed shortly after
// the last view leaves it (a remount — React's development double mount, a route change back — keeps it), or once the
// hub has acknowledged every send it holds, whichever is later. The org key reaches every open connection from the key
// holder.
import { useEffect } from 'react';
import { idbLogRecord, type LogRecord } from '../log/record';
import { useKeyHolder } from '../key/holder';
import { heldSends } from '../hub/access';
import { hubBase } from '../hub/base';
import { ProjectConnection } from './connection';

type Held = { connection: ProjectConnection; refs: number; closing: ReturnType<typeof setTimeout> | null };
const open = new Map<string, Held>();
let record: LogRecord | null = null;


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

export function acquireProject(project: string): void {
  const h = held(project);
  h.refs++;
  if (h.closing) clearTimeout(h.closing);
  h.closing = null;
  void h.connection.start();
}

export function releaseProject(project: string): void {
  const h = open.get(project);
  if (!h) return;
  h.refs--;
  if (h.refs > 0) return;
  h.closing = setTimeout(() => close(project, h), 1_000);
}

/**
 * Closes an unreferenced connection — once it holds no send the hub has not acknowledged: such a send (and its status in
 * the outbox) lives only in the connection, so it stays open, sending it again after each reconnect, until the hub has it.
 */
function close(project: string, h: Held): void {
  h.closing = null;
  if (h.refs > 0 || open.get(project) !== h) return;
  if (h.connection.client.holdsHumans()) {
    h.connection.client.whenHumansSent(() => close(project, h));
    return;
  }
  open.delete(project);
  h.connection.stop();
}

// Signing in again reloads the page, which loses a send the hub has not acknowledged: such a send is reported to it.
heldSends(() => [...open.values()].some((h) => h.connection.client.holdsHumans()));

/** The project's connection, opened if it is not. */
export const projectConnection = (project: string): ProjectConnection => held(project).connection;

/** The project's connection, open while any view that asked for it is mounted. */
export function useProjectConnection(project: string): ProjectConnection {
  useEffect(() => {
    acquireProject(project);
    return () => releaseProject(project);
  }, [project]);
  return held(project).connection;
}

useKeyHolder.subscribe((state, prev) => {
  if (state.key === prev.key) return;
  for (const { connection } of open.values()) connection.setKey(state.key);
});
