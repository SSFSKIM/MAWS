// The search for a file the transcript names, its memory and its queue (UX wave U6c,
// docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §B). A stub that names nothing: the suite is
// written first.
import type { AppSessionId } from '@shared/graph/ids';
import type { OpenFile } from '@shared/fs/read-tail';

export const NAMED_SCAN_BYTES = 1024 ** 3; // read back from the transcript's end, at most: completeness, not cost
export const NAMED_CHUNK_BYTES = 1024 * 1024; // one read
export const NAMED_ROW_BYTES = 4 * 1024 * 1024; // a longer line is passed over, its bytes not kept
export const NAMED_CACHE_ENTRIES = 256;
export const NAMED_WAITING_MAX = 8; // distinct jobs waiting behind the running one
export const NAMED_WAIT_MS = 8_000; // a waiter's patience, inside a host request's ten seconds
export const NAMED_FINGERPRINT_BYTES = 4096; // as the engine host's search

export interface NamedPathsOptions {
  transcript: (appSessionId: AppSessionId) => Promise<string | null>;
  open?: OpenFile;
  bounds?: { scan?: number; chunk?: number; row?: number; entries?: number; waiting?: number; waitMs?: number };
  hooks?: { at?(point: 'opened' | 'searched', appSessionId: AppSessionId): Promise<void> };
}
export interface NamedPaths {
  names(appSessionId: AppSessionId, path: string, signal?: AbortSignal): Promise<boolean>;
}
export function createNamedPaths(_options: NamedPathsOptions): NamedPaths {
  return { names: () => Promise.resolve(false) };
}
