// The one rule for a read that a plugin change can make stale (`plugins.changed`, sent when any CLI change ends): its
// answer is read again after the change. The read owed is the query's, kept for the query client's life rather than by
// a reader, since the read and its answer outlive any one reader: one listener per client counts the changes, and each
// read in flight carries the count it started at. A change marks every followed answer not being read stale and reads
// again those an enabled reader shows; a read in flight when it came is owed a read after it, since it may have read the
// state before the change (and TanStack Query lets an invalidation join a first flight, whose success then clears it:
// M2 review; U11a's branch panel, finding 3; its task review). Changes meanwhile coalesce into that one read. A reader
// that may not fetch now (the "+" menu closed, a passive harness) or is gone reads nothing; the answer stays stale until
// a reader is enabled or mounted again, which reads it. Followed: `usePluginsRead`'s reads (./read.ts) and Customize's
// inventory (customize/inventory.ts), by the command their keys name after 'maws'.
import { useQueryClient, type Query, type QueryClient } from '@tanstack/react-query';
import { ipc } from '../../ipc/client';

interface Followed {
  commands: Set<string>;
  changes: number; // the plugin changes seen so far
  startedAt: WeakMap<Query, number>; // a read's count at its start
}

const clients = new WeakMap<QueryClient, Followed>();

// The client's one listener and its cache's one subscription, made at its first follower; the event source holds them,
// and the client through them, for the window's life. Idempotent per client and command.
function follow(client: QueryClient, command: string): void {
  const known = clients.get(client);
  if (known) return void known.commands.add(command);
  const followed: Followed = { commands: new Set([command]), changes: 0, startedAt: new WeakMap() };
  clients.set(client, followed);
  const follows = (query: Query) => query.queryKey[0] === 'maws' && followed.commands.has(String(query.queryKey[1]));
  ipc.on('plugins.changed', () => {
    followed.changes += 1;
    void client.invalidateQueries({ predicate: (query) => follows(query) && query.state.fetchStatus === 'idle' });
  });
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || !follows(event.query)) return;
    const { query, action } = event;
    if (action.type === 'fetch') followed.startedAt.set(query, followed.changes);
    else if ((action.type === 'success' && action.manual !== true) || action.type === 'error') {
      if ((followed.startedAt.get(query) ?? followed.changes) >= followed.changes) return;
      // after the settling read's own bookkeeping, so the read again is a new flight rather than nested in this one
      queueMicrotask(() => void client.invalidateQueries({ queryKey: query.queryKey, exact: true }));
    }
  });
}

// Follows the reads of `command` in this client; a reader calls it as it renders, before its query can start a read.
export function useReadAgainAfterPluginsChange(command: string): void {
  follow(useQueryClient(), command);
}
