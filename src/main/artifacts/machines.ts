// Which machine an artifact is on, as main knows it (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Which machine an artifact is on"). An artifact id is a v4 UUID and the scheme's origin, so the id stays the key
// everywhere and the machine is a property of the artifact: this table records `artifactId → MachineRef` for every
// artifact-keyed request remote lane B dispatches to an RL2 machine and every row or record a link answers
// (src/main/lane-b/remote-artifacts.ts is its one writer). A local id never enters it: an id it doesn't hold is this
// Mac's. An id two machines answer keeps the later answer (a v4 collision doesn't happen; a copied profile could make one,
// and the artifact then opens from the machine that answered last, a known residual). It is the one predicate main reads
// an artifact's machine through (the copy rule here; M5b's scheme responder).
import type { MachineRef } from '@shared/machine/ref';

export class ArtifactMachines {
  readonly #machines = new Map<string, MachineRef>();

  /** `artifactId` is on `machine`, an RL2 machine: asked of it, or answered by it. */
  record(artifactId: string, machine: MachineRef): void {
    this.#machines.set(artifactId, machine);
  }

  /** The RL2 machine `artifactId` is on, or null for one this Mac holds (or none main has heard of). */
  machineOf(artifactId: string): MachineRef | null {
    return this.#machines.get(artifactId) ?? null;
  }
}
