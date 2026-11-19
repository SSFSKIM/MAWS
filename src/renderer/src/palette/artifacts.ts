// UX wave U6b-5a M4: stub before the build (tests first).
import type { MawsBridge } from '@shared/ipc/schema';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { MachineRef } from '@shared/machine/ref';

export interface ArtifactSearch { query: string; groups: { machine: MachineRef; rows: LibraryRow[] }[] }
export async function searchArtifacts(_client: MawsBridge, query: string, _machines: readonly MachineRef[]): Promise<ArtifactSearch> {
  return { query, groups: [] };
}
export function openPaletteArtifact(_artifactId: string, _machine: MachineRef): void {}
