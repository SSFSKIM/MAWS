// Last 32 sessions, isolated by project/session. A disk copy is a hint until this connection's snapshot/push confirms it.
import { useSyncExternalStore } from 'react';
import type { Catalog } from 'desk-hub/protocol';
export type CatalogState = { catalog: Catalog | null; stale: boolean; asOf: number | null };
const EMPTY: CatalogState = { catalog: null, stale: true, asOf: null };
const KEY = 'desk.catalogs';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export class CatalogCache {
  private entries = new Map<string, CatalogState>();
  private listeners = new Set<() => void>();
  constructor(private storage?: StorageLike) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
      if (Array.isArray(saved)) for (const row of saved.slice(-32)) {
        if (Array.isArray(row) && typeof row[0] === 'string' && validCatalog(row[1]?.catalog) && typeof row[1]?.asOf === 'number') this.entries.set(row[0], { ...row[1], stale: true });
      }
    } catch { /* storage denied or corrupt: memory still works */ }
  }
  get = (session: string): CatalogState => this.entries.get(session) ?? EMPTY;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  accept(session: string, catalog: Catalog, at = Date.now()): void {
    if (!validCatalog(catalog)) return;
    this.entries.delete(session);
    this.entries.set(session, { catalog, stale: false, asOf: at });
    while (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);
    try { this.storage?.setItem(KEY, JSON.stringify([...this.entries])); } catch { /* quota: keep the memory copy */ }
    this.changed();
  }
  invalidate(session: string): void {
    const old = this.entries.get(session);
    if (old && !old.stale) { this.entries.set(session, { ...old, stale: true }); this.changed(); }
  }
  invalidateProject(project: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(`${project}/`)) this.invalidate(key);
  }
  private changed(): void { for (const listener of this.listeners) listener(); }
}
function validCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== 'object') return false;
  const c = value as Catalog;
  if (c.skills !== undefined && (!Array.isArray(c.skills) || !c.skills.every((name) => typeof name === 'string'))) return false;
  return typeof c.fingerprint === 'string' && typeof c.measured === 'string' && Array.isArray(c.commands) && c.commands.every((entry) => typeof entry.name === 'string' && typeof entry.description === 'string' && typeof entry.source === 'string' && entry.route && typeof entry.route.class === 'string' && typeof entry.route.enabled === 'boolean') && !!c.models && Array.isArray(c.models.options) && !!c.models.aliases;
}
function storage(): StorageLike | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export const catalogs = new CatalogCache(storage());
export const catalogKey = (project: string, session: string): string => `${project}/${session}`;
export function useCatalog(session: string): CatalogState { return useSyncExternalStore(catalogs.subscribe, () => catalogs.get(session)); }
