// The engine's catalogue per session (C7 execution document, "Catalogue protocol"): C3's `session.catalog` snapshot and
// C7's `session.catalogChanged` events, projected to typed items (an entry that does not parse is dropped, never
// guessed) and reconciled by launch and revision. Hydration follows C6's pattern: subscribe and buffer, read the
// session's `launchId` from `session.status`, then the snapshot, apply it under that id, drain the buffer, go live. A
// payload is applied when its `launchId` differs from the one held or its revision is greater, and dropped otherwise,
// so a race is settled by revision, never by arrival. Before any process both reads are refused, which leaves the empty
// catalogue (`launchId: ''`, revision 0); the first event after the handshake fills it. Neither `session.init` nor
// `session.commands` is read.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { CatalogSchema } from '@shared/ipc/schema/session';
import type * as z from 'zod';
import { useEffect } from 'react';
import { ipc } from '../ipc/client';

export interface SessionCatalog {
  launchId: string; // '' before any process; a new launch starts a new revision sequence
  revision: number; // C3's: 0 = nothing received for this launch
  commands: Array<{ name: string; description: string; argumentHint: string | null; builtin: boolean }>;
  agents: Array<{ name: string; description: string }>;
  skills: string[];
  terminalOnly: string[];
}

export const EMPTY_CATALOG: SessionCatalog = Object.freeze({ launchId: '', revision: 0, commands: [], agents: [], skills: [], terminalOnly: [] }) as SessionCatalog;

type RawCatalog = z.infer<typeof CatalogSchema>;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (values: unknown[]) => values.filter((v): v is string => typeof v === 'string');

export function projectCatalog(launchId: string, raw: RawCatalog): SessionCatalog {
  const commands = raw.commands.flatMap((c) =>
    isRecord(c) && typeof c.name === 'string' && typeof c.description === 'string'
      ? [{ name: c.name, description: c.description, argumentHint: typeof c.argumentHint === 'string' && c.argumentHint !== '' ? c.argumentHint : null, builtin: c.builtin === true }]
      : [],
  );
  const agents = raw.agents.flatMap((a) => (isRecord(a) && typeof a.name === 'string' ? [{ name: a.name, description: typeof a.description === 'string' ? a.description : '' }] : []));
  return { launchId, revision: raw.revision, commands, agents, skills: strings(raw.skills), terminalOnly: strings(raw.terminalSlashCommands) };
}

// Whether `next` replaces `held`: another launch's catalogue, or a later revision of the same launch.
export const supersedes = (held: SessionCatalog | undefined, next: SessionCatalog): boolean => held === undefined || next.launchId !== held.launchId || next.revision > held.revision;

interface CatalogState {
  bySession: ReadonlyMap<AppSessionId, SessionCatalog>;
  apply(appSessionId: AppSessionId, next: SessionCatalog): void;
}

export const useCatalogStore = create<CatalogState>()((set, get) => ({
  bySession: new Map(),
  apply(appSessionId, next) {
    if (!supersedes(get().bySession.get(appSessionId), next)) return;
    set((s) => ({ bySession: new Map(s.bySession).set(appSessionId, next) }));
  },
}));

const attachments = new Map<AppSessionId, { count: number; off: () => void }>();

// Hydrates a session's catalogue and keeps it live while anything is attached; the disposer releases one attachment.
export function attachCatalog(appSessionId: AppSessionId, client: MawsBridge = ipc): () => void {
  const held = attachments.get(appSessionId);
  if (held) held.count += 1;
  else {
    let buffer: SessionCatalog[] | null = [];
    let live = true;
    const apply = (c: SessionCatalog) => useCatalogStore.getState().apply(appSessionId, c);
    const off = client.on('session.catalogChanged', (e) => {
      if (!live || e.appSessionId !== appSessionId) return;
      const next = projectCatalog(e.launchId, e.catalog);
      if (buffer) buffer.push(next);
      else apply(next);
    });
    void (async () => {
      const status = await client.invoke('session.status', { appSessionId });
      const snapshot = await client.invoke('session.catalog', { appSessionId });
      if (!live) return;
      const launchId = status.ok ? status.value.launchId : '';
      apply(snapshot.ok ? projectCatalog(launchId, snapshot.value) : { ...EMPTY_CATALOG, launchId: snapshot.ok ? launchId : '' });
      const drained = buffer ?? [];
      buffer = null;
      drained.forEach(apply);
    })();
    attachments.set(appSessionId, {
      count: 1,
      off: () => {
        live = false;
        off();
      },
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = attachments.get(appSessionId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    entry.off();
    attachments.delete(appSessionId);
  };
}

export function resetCatalogStore(): void {
  for (const entry of attachments.values()) entry.off();
  attachments.clear();
  useCatalogStore.setState({ bySession: new Map() });
}

// The session's catalogue, hydrated while the calling component is mounted.
export function useSessionCatalog(appSessionId: AppSessionId | null, client: MawsBridge = ipc): SessionCatalog {
  useEffect(() => (appSessionId === null ? undefined : attachCatalog(appSessionId, client)), [appSessionId, client]);
  return useCatalogStore((s) => (appSessionId === null ? EMPTY_CATALOG : (s.bySession.get(appSessionId) ?? EMPTY_CATALOG)));
}
