// Main's handlers for `deliverables.*` (E2 execution document, Interfaces "IPC"; Design §2): the store's three reads,
// answered by the reader on every call (no cache). A record id that is not a uuid never reaches a handler: the input
// schema refuses it as `invalid_input`. An app session id that is not one path component reaches the reader, whose path
// helpers (`deliverablesDir`, `recordPath`) throw their `invalid_input` HostCommandError; the router answers a handler's
// throw that is not a CommandFailure as `internal`, carrying that message ("invalid appSessionId").
import type { AppSessionId } from '@shared/graph/ids';
import type { registerMainHandler } from '../ipc/router';
import type { DeliverableReader } from './reader';

export function registerDeliverablesHandlers(reader: Pick<DeliverableReader, 'list' | 'listAll' | 'get'>, register: typeof registerMainHandler): void {
  const session = (id: string) => id as AppSessionId;
  register('deliverables.list', async ({ appSessionId }) => ({ records: await reader.list(session(appSessionId)) }));
  register('deliverables.listAll', async ({ limit }) => ({ records: await reader.listAll(limit) }));
  register('deliverables.get', ({ appSessionId, id }) => reader.get(session(appSessionId), id));
}
