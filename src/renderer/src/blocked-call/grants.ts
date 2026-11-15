// UX wave U1c, M3's tests first: a stub of the press's simplest form, which sends the sentence on every press and keeps
// nothing between the press and the record. The implementation replaces it.
import { create } from 'zustand';
import { consentMessage } from '@shared/engine/arrival';
import type { AppSessionId } from '@shared/graph/ids';
import type { HumanPromptOptions } from '../composer/submit/send-human-prompt';
import { sendToSession } from '../session/controls/controls-for';
import type { BlockedCall } from '../transcript/model/blocked';

export const SETTLE_MS = 5_000;
export const GRANT_DURING_TURN: 'after' | 'next' = 'after';
export type TerminalState = 'idle' | 'running' | 'stopped';
export const TERMINAL_OFFERED: Readonly<Record<TerminalState, boolean>> = { idle: false, running: false, stopped: false };
export type Gate = { state: 'open' } | { state: 'closed' } | { state: 'unavailable'; reason: string };

export const terminalStateOf = (appSessionId: AppSessionId): TerminalState => (void appSessionId, 'idle');
export const waitingGrants = (appSessionId: AppSessionId): ReadonlySet<string> => (void appSessionId, new Set());
export const terminalRefusal = (state: TerminalState, offered: Readonly<Record<TerminalState, boolean>>): string | null => (void state, void offered, null);
export const gateOf = (appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): Gate => (void appSessionId, void call, void grant, { state: 'open' });
export const grantOptions = (appSessionId: AppSessionId, during: 'after' | 'next' = GRANT_DURING_TURN): HumanPromptOptions => (void appSessionId, void during, { origin: 'answer' });
export async function approve(appSessionId: AppSessionId, call: BlockedCall): Promise<void> {
  await sendToSession(appSessionId, consentMessage(call.kind, call.subject), { origin: 'answer' }).catch(() => undefined);
}
export const useGrantsOut = create<{ out: ReadonlyMap<string, unknown>; notices: ReadonlyMap<string, string> }>()(() => ({ out: new Map(), notices: new Map() }));
export const resetGrantsOut = (): void => undefined;
export const useGrant = (appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): { gate: Gate; notice: string | null } => ({ gate: gateOf(appSessionId, call, grant), notice: null });
