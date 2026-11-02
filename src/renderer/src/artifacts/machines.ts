// Which machine an artifact is on, as the page knows it (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// M5, "Which machine an artifact is on"; main's twin is src/main/artifacts/machines.ts). An artifact id is a v4 UUID and
// the scheme's origin, so it stays the key everywhere and the machine is a property of the artifact: this table holds it
// for every artifact of another machine the page has heard of, and nothing else in the page decides it.
//
// - Its writers: the rows and records a machine answers (`heardArtifacts`, called by the renderer's client after each
//   answer), and a surface that carries the machine beside the id (a tab's ref or params, a session's address:
//   `recordArtifactMachine`).
// - Its reader: `artifactMachineOf`. The renderer's client asks it for every command whose input names an artifact
//   (`artifactId`, or the asset copy's `to`) and no machine, so every artifact-keyed invoke goes to the artifact's machine
//   (an explicit `opts.machine`, and a machine the input's addresses name, still win). A surface reads it for what
//   differs on another machine (Open externally opens a copy, Reveal is greyed).
// - A local id never enters: an answer from this Mac takes the id out, so an id two machines answered keeps the later
//   answer (a v4 collision does not happen; a copied profile directory could make one, the spec's known residual).
import type { CommandName } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';

const table = new Map<string, MachineRef>();
const listeners = new Set<() => void>();

const changed = () => {
  for (const listener of [...listeners]) listener();
};

/** The artifact's machine when it is another machine's; null for this Mac's (or an id the page has not heard of). */
export const artifactMachineOf = (artifactId: string): MachineRef | null => table.get(artifactId) ?? null;

/** The artifact is on `machine` (this Mac's when it is `local`): the later word wins. */
export function recordArtifactMachine(artifactId: string, machine: MachineRef, local: MachineRef): void {
  if (machine === local) {
    if (table.delete(artifactId)) changed();
    return;
  }
  if (table.get(artifactId) === machine) return;
  table.set(artifactId, machine);
  changed();
}

const idsOf = (records: readonly unknown[]): string[] =>
  records.flatMap((record) => {
    const id = typeof record === 'object' && record !== null ? (record as { id?: unknown }).id : undefined;
    return typeof id === 'string' ? [id] : [];
  });
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

// The artifacts an answer names as rows or records, by command (main's adapter records the same answers).
const ANSWERS: Partial<Record<CommandName, (value: Record<string, unknown>) => string[]>> = {
  'library.list': (value) => idsOf(list(value.rows)),
  'library.get': (value) => idsOf([value.row]),
  'artifacts.list': (value) => idsOf(list(value.artifacts)),
  'artifacts.get': (value) => idsOf([value.artifact]),
  'artifacts.create': (value) => idsOf([value.artifact]),
  'artifacts.duplicate': (value) => idsOf([value.artifact]),
};

/** What `machine` answered `name` with: the artifacts it named are on it. */
export function heardArtifacts(name: CommandName, value: unknown, machine: MachineRef, local: MachineRef): void {
  const read = ANSWERS[name];
  if (!read || typeof value !== 'object' || value === null) return;
  for (const artifactId of read(value as Record<string, unknown>)) recordArtifactMachine(artifactId, machine, local);
}

/** The machine a command goes to for the artifact its input names, when that is another machine's. */
export function artifactRouteOf(name: CommandName, input: unknown): MachineRef | null {
  if (typeof input !== 'object' || input === null) return null;
  const named = (input as Record<string, unknown>)[name === 'artifacts.copyAsset' ? 'to' : 'artifactId'];
  return typeof named === 'string' ? artifactMachineOf(named) : null;
}

/** For a render that reads the table (./use-artifact-machine.ts). */
export const subscribeArtifactMachines = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

// Tests.
export function resetArtifactMachines(): void {
  table.clear();
  changed();
}
