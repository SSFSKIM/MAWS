// UX wave U3b (M4): the red step's stub; the store follows in the next commit.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';

export type CompactingSource = { kind: 'engine' } | { kind: 'bridge'; rpc: string };
export const useCompacting = create<{ held: ReadonlyMap<AppSessionId, { since: number; source: CompactingSource }> }>(() => ({ held: new Map() }));
export function noteCompacting(_appSessionId: AppSessionId, _source: CompactingSource, _on: boolean): void {}
export function clearCompacting(_appSessionId: AppSessionId): void {}
export function useCompactingSince(_appSessionId: AppSessionId | null): number | null {
  return null;
}
export function connectCompacting(): () => void {
  return () => {};
}
