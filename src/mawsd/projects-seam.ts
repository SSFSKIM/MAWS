// The project registry's seams across `mawsd` (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §H; M9):
// the endpoint and the spine's index each live in a chunk of their own that loads when it is needed, and each may be
// absent. Both seams are stable objects the daemon hands each side once:
//
// - `spineProjects`: what the endpoint reads of the index, following the lazy spine. While the spine is not loaded the
//   snapshot is null (unknown, never empty: the endpoint signs nothing and keeps what it last kept). Each load's index
//   is listened to while it is loaded, and a load is itself a change, so the endpoint reads the new index at once.
// - `lazyRegistry`: what the index asks of the endpoint, forwarded to the endpoint module once it is loaded. Unloaded,
//   nothing is enrolled here (an enrollment on disk loads it at the daemon's start), so statements are not possible
//   (`not-enrolled`); its listeners hear the module's turns once it loads, and the load itself.
import type { ProjectsSource, RegistrySeam } from '@shared/machine/registry';
import type { SpineRoot } from '../services/spine-root';
import type { SpineState } from './spine-seam';

export type SpineProjects = ProjectsSource & {
  /** The spine's state moved (the lazy spine's `onState`): a loaded spine's index listened to, another's let go. */
  spineState(state: SpineState): void;
};

export function spineProjects(root: () => SpineRoot | null): SpineProjects {
  const listeners = new Set<() => void>();
  let attached: { root: SpineRoot; off: () => void } | null = null;
  const tell = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[mawsd] a projects listener failed:', error instanceof Error ? error.message : error);
      }
    }
  };
  return {
    snapshot: () => root()?.projects?.().snapshot() ?? null,
    restore: (statements) => root()?.projects?.().restore(statements),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    spineState: (state) => {
      const now = state === 'loaded' ? root() : null;
      if (now === (attached?.root ?? null)) return;
      attached?.off();
      const source = now?.projects?.();
      attached = now === null || source === undefined ? null : { root: now, off: source.onChange(tell) };
      tell();
    },
  };
}

/** The endpoint module's registry seam as it is loaded now (`registry()`), its listeners kept across the load. */
export type LazyRegistry = RegistrySeam & {
  /** The module loaded (or another took its place): its turns forwarded from now on, and its answer told once. */
  loaded(module: RegistrySeam | undefined): void;
};

export function lazyRegistry(): LazyRegistry {
  let current: RegistrySeam | undefined;
  let off: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) listener();
  };
  return {
    statements: () => current?.statements() ?? { possible: false, reason: 'not-enrolled' },
    onStatements: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    project: (id) => current?.project(id) ?? null,
    fits: (rows) => current?.fits(rows) ?? true,
    published: () => current?.published() ?? Promise.resolve({ restated: false }),
    loaded: (module) => {
      if (module === current) return;
      off?.();
      current = module;
      off = module?.onStatements(tell) ?? null;
      tell();
    },
  };
}
