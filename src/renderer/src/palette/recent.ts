// UX wave U6b-5a M4: stub before the build (tests first).
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { MachineRef } from '@shared/machine/ref';
import type { Opened } from '../keymap/visits';

export const RECENT_MAX = 8;
export type RecentRow = { kind: 'session'; record: SessionRecord } | { kind: 'artifact'; artifactId: string; machine: MachineRef; row: LibraryRow };
export const artifactKey = (machine: MachineRef, artifactId: string): string => `${machine}/${artifactId}`;
export interface RecentInput {
  opened: readonly Opened[];
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  activity(record: SessionRecord): number;
  answered: ReadonlyMap<string, LibraryRow | null>;
}
export function recentRows(_input: RecentInput): { rows: RecentRow[]; ask: Extract<Opened, { kind: 'artifact' }>[] } {
  return { rows: [], ask: [] };
}
