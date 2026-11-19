// UX wave U6b-5a (M3; Interfaces §D): the record's one reader, the step and the two handlers. Stub until the build.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { EMPTY_RECORD, type PlaceRecord } from './places';

export type Opened = { kind: 'session'; appSessionId: AppSessionId } | { kind: 'artifact'; artifactId: string; machine: MachineRef };
export const useVisits = create<{ record: PlaceRecord; opened: readonly Opened[] }>()(() => ({ record: EMPTY_RECORD, opened: [] }));
export function connectVisits(): () => void {
  return () => {};
}
