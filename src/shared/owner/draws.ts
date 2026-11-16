// RED STUB (replaced by the implementation in the next commit)
import type { EngineSessionStatus } from '../engine/status';
import type { ContractSource } from './state';
export type DrawnBy = 'mod' | 'maws';
export type Advertisement = 9 | 8 | null;
export interface Reservation { launchId: string | null; number: Advertisement; plugin: boolean; at: string }
export type Known = { known: true; number: Advertisement; plugin: boolean | null } | { known: false };
const notBuilt = (): never => { throw new Error('not built'); };
export function declaresDrawing(_file: unknown, _at: number): boolean { return notBuilt(); }
export function advertisementFor(_lane: boolean, _installations: readonly { declares: boolean }[], _route?: boolean): Advertisement { return notBuilt(); }
export function advertisementOf(_row: { launchId: string | null; desired: ContractSource | null; advertised: Reservation | null } | null, _live: string): Known { return notBuilt(); }
export function drawnBy(_a: Known, _s: { launchId: string; process: EngineSessionStatus['process'] } | null, _l: { present: boolean; declares: boolean } | null): DrawnBy { return notBuilt(); }
