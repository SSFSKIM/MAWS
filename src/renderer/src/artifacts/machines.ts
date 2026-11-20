// Open views and rows carry their machine. These observations are only route hints for callers that have no
// machine (for example, a bare link); no answer or open can overwrite the machine of another copy.
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName } from '@shared/ipc/schema';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';

const LOCAL = null;
const table = new Map<string, Set<MachineRef | null>>();
const listeners = new Set<() => void>();

const changed = () => {
  for (const listener of [...listeners]) listener();
};

/** A unique remote route hint, or null for local, unknown or multiple copies. */
export function artifactMachineOf(artifactId: string): MachineRef | null {
  const machines = table.get(artifactId);
  return machines?.size === 1 ? (machines.values().next().value ?? null) : null;
}

// Machine refs cannot contain a colon; keep the artifact id intact.
export const artifactKey = (artifactId: string, machine: MachineRef): string => `${machine}:${artifactId}`;

/**
 * The machine a session's view reads the artifact on (P5 O7 M5a): the session's when it is another machine's, else the
 * table's, else this Mac. UX wave U6d: the side column's open (`openArtifactInPanel`) and the look for the main tab that
 * already shows the artifact (`showOpenArtifactTab`) both ask it, so the tab found is a view of what the side column
 * would have opened.
 */
export function sessionArtifactMachine(appSessionId: AppSessionId | null, artifactId: string, local: MachineRef): MachineRef {
  const remote = appSessionId !== null && isAddress(appSessionId) && machineOf(appSessionId) !== local ? machineOf(appSessionId) : null;
  return remote ?? artifactMachineOf(artifactId) ?? local;
}

/** Remember each copy separately, including this Mac's: it makes an id-only route ambiguous. */
export function recordArtifactMachine(artifactId: string, machine: MachineRef, local: MachineRef): void {
  const machines = table.get(artifactId) ?? new Set<MachineRef | null>();
  // Null is the local hint's representation; retain the fact it was seen without returning it as a remote route.
  const route = machine === local ? LOCAL : machine;
  if (machines.has(route)) return;
  machines.add(route);
  table.set(artifactId, machines);
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
