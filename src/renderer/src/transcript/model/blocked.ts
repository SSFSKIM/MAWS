// UX wave U1c, M2: a stub for the red run of blocked.test.ts, answering what today's code reads (the whole result text
// as the reason, no name, no state). The next commit replaces it.
import type { CellId, Row, TurnId } from './rows';

export const STAND_IN_REASONS: ReadonlySet<string> = new Set();
export const classifierReason = (resultText: string): string | null => resultText.trim() || null;
export interface BlockedCall { kind: 'command' | 'call'; subject: string }
export const blockedCallOf = (_toolName: string, _input: unknown): BlockedCall | null => null;
export const blockedKey = (call: BlockedCall): string => `${call.kind}\u0000${call.subject}`;
export interface BlockedState { call: BlockedCall; again: boolean; grant: 'none' | 'waiting' | 'read' }
export const readsApproved = (state: BlockedState): boolean => state.grant === 'read';
export const blockedStates = (_rows: readonly Row[], _hidden: readonly TurnId[]): ReadonlyMap<CellId, BlockedState> => new Map();
export const approvalsFor = (_rows: readonly Row[], _hidden: readonly TurnId[], _key: string): number => 0;
