// The widget's plugin-management operations (E8 execution document, M2; M1's D-15), keyed by the row that started each:
// the X2 command answers a receipt `{ opId }`, then `plugins.operation` carries `started` (when it leaves the host's
// queue), the CLI's `output` lines, `reloading` and `done` with the outcome and the reload report. The sibling of
// `../operation.ts`'s `useOperation` (which follows `session.operation`), held by the widget rather than by a row: an
// uninstall or a marketplace removal takes its row out of the list at `plugins.changed`, before `done`, and its words
// must outlive the row. It listens before it asks so no event that outruns its receipt is lost, follows only the opIds
// it started, and only while mounted. A rejected invoke is the transport branch: nothing ran.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CommandName } from '@shared/ipc/schema';
import type { PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import type { RunnerAction } from '@shared/plugins/cli';
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
  'mcp-add': 'connectors.add', // P4-AGG M4: Customize › Connectors
  'mcp-remove': 'connectors.remove',
} as const satisfies Record<RunnerAction, CommandName>;

export interface PluginOperationEntry {
  request: PluginsRequest;
  opId: string | null; // null until the receipt
  state: PluginOpState;
}

export interface PluginOperations {
  entries: ReadonlyMap<string, PluginOperationEntry>; // by key (the row that started it)
  // Runs the request in `cwd` with the binary its sheet named under `key`; answers its `done` event (null when the
  // invoke was refused or the widget closed).
  run(key: string, request: PluginsRequest, cwd: string, binary: string): Promise<PluginsOperationEvent | null>;
  cancel(key: string): void; // asks the host to stop the CLI or drop the queued operation; `done` follows as `cancelled`
}

function next(state: PluginOpState, event: PluginsOperationEvent): PluginOpState {
  if (event.phase === 'done') return { phase: 'done', event };
  const line = state.phase === 'working' ? state.line : null;
  if (event.phase === 'output') return { phase: 'working', opId: event.opId, line: event.line ?? line, reloading: false };
  return { phase: 'working', opId: event.opId, line, reloading: event.phase === 'reloading' };
}

// One set of operations and what follows them. A widget's own (the session's `/plugins`) follows only while mounted: its
// unmount answers every run still waiting with null and forgets its opIds. A kept one (`usePluginOperations(keep)`: a
// Customize page's, by its section and directory) outlives the views that show it, since the page unmounts whenever
// another project is shown: it listens while a run waits or a view shows it, so a run's answer (and an add-then-install's
// second step) arrives with no view mounted, and its entries are there when the page shows again (scalpel-5#1).
class OperationBook {
  entries: ReadonlyMap<string, PluginOperationEntry> = new Map();
  private readonly keyOf = new Map<string, string>(); // opId → key
  private asking = 0; // invokes whose receipt has not come back
  private early: PluginsOperationEvent[] = []; // events that arrived meanwhile
  private readonly waiting = new Map<string, (event: PluginsOperationEvent | null) => void>(); // opId → its run's answer
  private readonly subscribers = new Set<() => void>();
  private off: (() => void) | null = null;
  private views = 0;
  private alive = true;

  constructor(private readonly kept: boolean) {}

  readonly subscribe = (subscriber: () => void): (() => void) => {
    this.subscribers.add(subscriber);
    return () => void this.subscribers.delete(subscriber);
  };

  private set(update: (prior: ReadonlyMap<string, PluginOperationEntry>) => ReadonlyMap<string, PluginOperationEntry>): void {
    const next = update(this.entries);
    if (next === this.entries) return;
    this.entries = next;
    this.subscribers.forEach((subscriber) => subscriber());
  }

  private listen(): void {
    this.off ??= ipc.on('plugins.operation', (event) => {
      if (this.keyOf.has(event.opId)) this.apply(event);
      else if (this.asking > 0) this.early.push(event);
    });
  }

  private quiet(): void {
    if (!this.kept || this.views > 0 || this.asking > 0 || this.waiting.size > 0) return;
    this.off?.();
    this.off = null;
  }

  // A view shows the book; the returned function is its leaving.
  show(): () => void {
    this.views += 1;
    this.alive = true;
    this.listen();
    return () => {
      this.views -= 1;
      if (this.kept) return this.quiet();
      this.off?.();
      this.off = null;
      this.alive = false;
      this.waiting.forEach((resolve) => resolve(null));
      this.waiting.clear();
      this.keyOf.clear();
    };
  }

  forget(): void {
    this.off?.();
    this.off = null;
    this.waiting.clear();
    this.keyOf.clear();
  }

  private apply(event: PluginsOperationEvent): void {
    const key = this.keyOf.get(event.opId);
    if (key === undefined) return;
    this.set((prior) => {
      const entry = prior.get(key);
      if (!entry || entry.opId !== event.opId) return prior; // a newer operation took the key
      return new Map(prior).set(key, { ...entry, state: next(entry.state, event) });
    });
    if (event.phase === 'done') {
      this.waiting.get(event.opId)?.(event);
      this.waiting.delete(event.opId);
      this.keyOf.delete(event.opId);
      this.quiet();
    }
  }

  readonly run = async (key: string, request: PluginsRequest, cwd: string, binary: string): Promise<PluginsOperationEvent | null> => {
    this.set((prior) => new Map(prior).set(key, { request, opId: null, state: { phase: 'working', opId: null, line: null, reloading: false } }));
    if (this.kept) this.listen(); // a kept book listens before it asks, shown or not
    this.asking += 1;
    const result = await ipc.invoke(COMMAND_OF[request.action], { cwd, binary, ...request.input } as never);
    this.asking -= 1;
    const held = this.early;
    if (this.asking === 0) this.early = [];
    if (!this.alive) return null;
    if (!result.ok) {
      this.set((prior) => new Map(prior).set(key, { request, opId: null, state: { phase: 'unsent', error: transportWords(result.error) } }));
      this.quiet();
      return null;
    }
    const { opId } = result.value as { opId: string };
    this.keyOf.set(opId, key);
    const completed = new Promise<PluginsOperationEvent | null>((resolve) => this.waiting.set(opId, resolve));
    this.set((prior) => new Map(prior).set(key, { request, opId, state: { phase: 'working', opId, line: null, reloading: false } }));
    held.filter((event) => event.opId === opId).forEach((event) => this.apply(event));
    return completed;
  };

  readonly cancel = (key: string): void => {
    const opId = this.entries.get(key)?.opId;
    if (opId) void ipc.invoke('plugins.cancel', { opId });
  };
}

const KEPT = new Map<string, OperationBook>();
const keptBook = (keep: string): OperationBook => {
  let book = KEPT.get(keep);
  if (!book) KEPT.set(keep, (book = new OperationBook(true)));
  return book;
};
/** Tests: forget every kept book (a fresh window). */
export function forgetKeptOperations(): void {
  KEPT.forEach((book) => book.forget());
  KEPT.clear();
}

// The operations a view shows: its own (`keep` undefined), or the kept book named `keep`.
export function usePluginOperations(keep?: string): PluginOperations {
  const [own] = useState(() => new OperationBook(false));
  const book = keep === undefined ? own : keptBook(keep);
  useEffect(() => book.show(), [book]);
  const entries = useSyncExternalStore(book.subscribe, () => book.entries);
  return useMemo(() => ({ entries, run: book.run, cancel: book.cancel }), [entries, book]);
}
