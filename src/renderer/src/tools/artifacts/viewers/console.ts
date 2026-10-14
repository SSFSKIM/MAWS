// The console of an artifact's frames (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b): the last CONSOLE_KEPT
// errors and warnings main attributed to an artifact's frame (`artifacts.console`, P3-A M7), per artifact and revision
// shown, for the HTML viewer's chip; E2's Deliverables store's ring buffer for the `maws-artifact:` scheme. Renderer
// memory only: a frame mounting clears its revision's, since every load logs afresh, so the chip counts one load.
//
// M6b: the transcript's artifact row names a version by its place (`v2`), not a revision; a viewer that read the
// artifact's versions notes which revision each place is (`noteArtifactVersions`), so the row's chip reads the console of
// the revision its place names (`useArtifactConsoleAt`). Only a viewer frames a revision, so a revision with entries is
// always one a viewer placed.
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { ArtifactConsole } from '@shared/ipc/schema/artifacts';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { placeOfNumber } from './model';

export const CONSOLE_KEPT = 50;

export interface ConsoleLine {
  level: ArtifactConsole['level'];
  message: string;
  line: number | null;
}

// `revision` null: a frame on the live content (the viewers always name a revision, so theirs never is).
export const consoleKey = (artifactId: string, revision: number | null) => `${artifactId}/${revision ?? 'live'}`;

type Placed = Pick<ArtifactVersion, 'seq' | 'kind' | 'label'>;
const store = createStore<{ lines: ReadonlyMap<string, ConsoleLine[]>; places: ReadonlyMap<string, readonly Placed[]> }>()(() => ({ lines: new Map(), places: new Map() }));
const NONE: ConsoleLine[] = [];

export const useArtifactConsole = (artifactId: string, revision: number): ConsoleLine[] => useStore(store, (s) => s.lines.get(consoleKey(artifactId, revision)) ?? NONE);

// M6b: an artifact's versions in their order (place n is `versions[n - 1]`), as a viewer read them.
export function noteArtifactVersions(artifactId: string, versions: readonly Placed[]): void {
  const known = store.getState().places.get(artifactId);
  if (known && known.length === versions.length && known.every((v, i) => v.seq === versions[i]!.seq && v.kind === versions[i]!.kind && v.label === versions[i]!.label)) return;
  store.setState((s) => ({ places: new Map(s.places).set(artifactId, versions.map(({ seq, kind, label }) => ({ seq, kind, label }))) }));
}

// M6b: the console of version number `version`'s revision, the number found as the viewer finds it (`placeOfNumber`,
// fix wave 1: X12's on an imported page); none while no viewer has placed the versions.
export const useArtifactConsoleAt = (artifactId: string, version: number): ConsoleLine[] =>
  useStore(store, (s) => {
    const placed = s.places.get(artifactId);
    const revision = placed?.[placeOfNumber(placed, version) - 1]?.seq;
    return revision === undefined ? NONE : (s.lines.get(consoleKey(artifactId, revision)) ?? NONE);
  });

export function applyArtifactConsole({ artifactId, revision, level, message, line }: ArtifactConsole): void {
  const key = consoleKey(artifactId, revision);
  store.setState((s) => ({ lines: new Map(s.lines).set(key, [...(s.lines.get(key) ?? []), { level, message, line }].slice(-CONSOLE_KEPT)) }));
}

export function clearArtifactConsole(artifactId: string, revision: number): void {
  const key = consoleKey(artifactId, revision);
  if (!store.getState().lines.has(key)) return;
  store.setState((s) => {
    const lines = new Map(s.lines);
    lines.delete(key);
    return { lines };
  });
}

// App.tsx's P3-L block: main's attribution of an artifact frame's console.
export const startArtifactConsole = (client: MawsBridge = ipc): (() => void) => client.on('artifacts.console', applyArtifactConsole);

export const resetArtifactConsole = (): void => store.setState({ lines: new Map(), places: new Map() });
