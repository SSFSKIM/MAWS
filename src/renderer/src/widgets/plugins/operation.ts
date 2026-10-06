// The widget's plugin-management operations (E8 execution document, M2; M1's D-15), keyed by the row that started each:
// the X2 command answers a receipt `{ opId }`, then `plugins.operation` carries `started` (when it leaves the host's
// queue), the CLI's `output` lines, `reloading` and `done` with the outcome and the reload report. The sibling of
// `../operation.ts`'s `useOperation` (which follows `session.operation`), held by the widget rather than by a row: an
// uninstall or a marketplace removal takes its row out of the list at `plugins.changed`, before `done`, and its words
// must outlive the row. It listens before it asks so no event that outruns its receipt is lost, follows only the opIds
// it started, and only while mounted. A rejected invoke is the transport branch: nothing ran.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandName } from '@shared/ipc/schema';
import type { PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import type { PluginsAction } from '@shared/plugins/cli';
import { ipc } from '../../ipc/client';
import { transportWords } from '../read';
import type { PluginOpState, PluginsRequest } from './present';

const COMMAND_OF = {
  install: 'plugins.install',
  update: 'plugins.update',
  uninstall: 'plugins.uninstall',
  enable: 'plugins.enable',
  disable: 'plugins.disable',
  'marketplace-add': 'marketplaces.add',
  'marketplace-update': 'marketplaces.update',
  'marketplace-remove': 'marketplaces.remove',
} as const satisfies Record<PluginsAction, CommandName>;

export interface PluginOperationEntry {
  request: PluginsRequest;
  opId: string | null; // null until the receipt
  state: PluginOpState;
}

export interface PluginOperations {
  entries: ReadonlyMap<string, PluginOperationEntry>; // by key (the row that started it)
  // Runs the request in `cwd` under `key`; answers its `done` event (null when the invoke was refused or the widget closed).
  run(key: string, request: PluginsRequest, cwd: string): Promise<PluginsOperationEvent | null>;
  cancel(key: string): void; // asks the host to stop the CLI or drop the queued operation; `done` follows as `cancelled`
}

function next(state: PluginOpState, event: PluginsOperationEvent): PluginOpState {
  if (event.phase === 'done') return { phase: 'done', event };
  const line = state.phase === 'working' ? state.line : null;
  if (event.phase === 'output') return { phase: 'working', opId: event.opId, line: event.line ?? line, reloading: false };
  return { phase: 'working', opId: event.opId, line, reloading: event.phase === 'reloading' };
}

export function usePluginOperations(): PluginOperations {
  const [entries, setEntries] = useState<ReadonlyMap<string, PluginOperationEntry>>(new Map());
  const keyOf = useRef(new Map<string, string>()); // opId → key
  const asking = useRef(0); // invokes whose receipt has not come back
  const early = useRef<PluginsOperationEvent[]>([]); // events that arrived meanwhile
  const waiting = useRef(new Map<string, (event: PluginsOperationEvent | null) => void>()); // opId → its run's answer
  const alive = useRef(true);

  const apply = useCallback((event: PluginsOperationEvent) => {
    const key = keyOf.current.get(event.opId);
    if (key === undefined) return;
    setEntries((prior) => {
      const entry = prior.get(key);
      if (!entry || entry.opId !== event.opId) return prior; // a newer operation took the key
      return new Map(prior).set(key, { ...entry, state: next(entry.state, event) });
    });
    if (event.phase === 'done') {
      waiting.current.get(event.opId)?.(event);
      waiting.current.delete(event.opId);
      keyOf.current.delete(event.opId);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const keys = keyOf.current; // both maps live as long as the hook; only their entries change
    const waits = waiting.current;
    const off = ipc.on('plugins.operation', (event) => {
      if (keys.has(event.opId)) apply(event);
      else if (asking.current > 0) early.current.push(event);
    });
    return () => {
      off();
      alive.current = false;
      waits.forEach((resolve) => resolve(null));
      waits.clear();
      keys.clear();
    };
  }, [apply]);

  const run = useCallback(
    async (key: string, request: PluginsRequest, cwd: string) => {
      setEntries((prior) => new Map(prior).set(key, { request, opId: null, state: { phase: 'working', opId: null, line: null, reloading: false } }));
      asking.current += 1;
      const result = await ipc.invoke(COMMAND_OF[request.action], { cwd, ...request.input } as never);
      asking.current -= 1;
      const held = early.current;
      if (asking.current === 0) early.current = [];
      if (!alive.current) return null;
      if (!result.ok) {
        setEntries((prior) => new Map(prior).set(key, { request, opId: null, state: { phase: 'unsent', error: transportWords(result.error) } }));
        return null;
      }
      const { opId } = result.value as { opId: string };
      keyOf.current.set(opId, key);
      const completed = new Promise<PluginsOperationEvent | null>((resolve) => waiting.current.set(opId, resolve));
      setEntries((prior) => new Map(prior).set(key, { request, opId, state: { phase: 'working', opId, line: null, reloading: false } }));
      held.filter((event) => event.opId === opId).forEach(apply);
      return completed;
    },
    [apply],
  );

  const cancel = useCallback(
    (key: string) => {
      const opId = entries.get(key)?.opId;
      if (opId) void ipc.invoke('plugins.cancel', { opId });
    },
    [entries],
  );

  return { entries, run, cancel };
}
