// The project registry's seams across `mawsd` (projects-seam.ts; docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §H): the endpoint's read of the index follows the lazy spine, null while it is not loaded and listened to
// while it is; the index's question of the endpoint answers `not-enrolled` until the module loads, then the module's.
import { describe, expect, it } from 'vitest';
import type { ProjectsSource, RegistrySeam, StatementsState } from '@shared/machine/registry';
import type { SpineRoot } from '../services/spine-root';
import { lazyRegistry, spineProjects } from './projects-seam';

/** An index's source with its listeners counted. */
function source(indexId: string): ProjectsSource & { change(): void; listening(): number; restored: unknown[] } {
  const listeners = new Set<() => void>();
  const restored: unknown[] = [];
  return {
    snapshot: () => ({ indexId, rows: [], statements: [] }),
    restore: (statements) => void restored.push(statements),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change: () => listeners.forEach((l) => l()),
    listening: () => listeners.size,
    restored,
  };
}

describe('spineProjects', () => {
  it('reads null until the spine loads, listens to the loaded index, and lets it go when the spine stops', () => {
    let root: SpineRoot | null = null;
    const seam = spineProjects(() => root);
    let heard = 0;
    seam.onChange(() => heard++);
    expect(seam.snapshot()).toBeNull();
    seam.restore([]); // no index: nothing to restore into, and no throw

    const first = source('index-1');
    root = { projects: () => first } as unknown as SpineRoot;
    seam.spineState('loading');
    expect([heard, first.listening()]).toEqual([0, 0]);
    seam.spineState('loaded');
    expect([heard, first.listening(), seam.snapshot()?.indexId]).toEqual([1, 1, 'index-1']); // the load is itself a change
    seam.spineState('loaded'); // the same root again: no second listener, no second telling
    expect([heard, first.listening()]).toEqual([1, 1]);
    first.change();
    expect(heard).toBe(2);
    seam.restore([]);
    expect(first.restored).toHaveLength(1);

    seam.spineState('releasing');
    expect([heard, first.listening()]).toEqual([3, 0]);
    root = null;
    expect(seam.snapshot()).toBeNull();

    const second = source('index-2');
    root = { projects: () => second } as unknown as SpineRoot;
    seam.spineState('loaded');
    first.change();
    expect([heard, second.listening(), seam.snapshot()?.indexId]).toEqual([4, 1, 'index-2']);
  });
});

describe('lazyRegistry', () => {
  it('answers not-enrolled until the module loads, then forwards to it, its listeners kept across the load', async () => {
    const seam = lazyRegistry();
    let heard = 0;
    seam.onStatements(() => heard++);
    expect([seam.statements(), seam.project('p'), seam.fits([]), await seam.published()]).toEqual([{ possible: false, reason: 'not-enrolled' }, null, true, { restated: false }]);

    let state: StatementsState = { possible: true };
    const listeners = new Set<() => void>();
    const module: RegistrySeam = {
      statements: () => state,
      onStatements: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      project: (id) => (id === 'p' ? { hub: true, nameRev: 2 } : null),
      fits: () => false,
      published: () => Promise.resolve({ restated: true }),
    };
    seam.loaded(module);
    expect(heard).toBe(1); // the load is told
    expect([seam.statements(), seam.project('p'), seam.fits([]), await seam.published()]).toEqual([{ possible: true }, { hub: true, nameRev: 2 }, false, { restated: true }]);
    state = { possible: false, reason: 'sminos-too-old' };
    listeners.forEach((l) => l());
    expect([heard, seam.statements()]).toEqual([2, { possible: false, reason: 'sminos-too-old' }]);

    seam.loaded(module); // the same module: nothing moves
    expect([heard, listeners.size]).toEqual([2, 1]);
    seam.loaded(undefined); // a module without a registry took its place: the old one let go
    expect([heard, listeners.size, seam.statements()]).toEqual([3, 0, { possible: false, reason: 'not-enrolled' }]);
  });
});
