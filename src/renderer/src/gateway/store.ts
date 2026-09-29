// The gateway store (C11 execution document, Interfaces "Gateway"): what the renderer knows about the route sessions
// take through ClaudeUsage's relay. The relay's health (read by the monitor and by Retry, Refresh and the Settings tab),
// ClaudeUsage's own status, and, from M4, each Direct session's last known login and the per-session route switch. The
// settings (the launch policy, the Direct option, the near-limit threshold) are read from the settings store where they
// are used, never mirrored here. Nothing here is persisted.
import { create } from 'zustand';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { Effort } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClaudeUsageStatus, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';

export type SwitchConfirm = { target: 'gateway' | 'direct'; backgroundTasks: EngineSessionStatus['backgroundTasks']; requiresModel: boolean; model: string | null; effort: Effort | null };
export type SwitchState = { target: 'gateway' | 'direct'; phase: 'confirming' | 'interrupting' | 'rechecking' | 'stopping' | 'starting' | 'done' | 'failed'; confirm: SwitchConfirm | null; error: string | null };

export interface GatewayState {
  relay: RelayHealth | null; // carries its own checkedAt
  claudeUsage: ClaudeUsageStatus | null;
  directLogin: Map<AppSessionId, { login: string; email: string | null; organization: string | null }>; // from a Direct session's get_status (M4)
  switching: Map<AppSessionId, SwitchState>; // the route switch in flight (M4)
  refreshRelay(force: boolean): Promise<RelayHealth>; // engine.relayHealth { force }; rejects when the command fails
  refreshClaudeUsage(): Promise<ClaudeUsageStatus>; // settings.claudeUsage.status; rejects when the command fails
}

export function createGatewayStore(client: MawsBridge) {
  return create<GatewayState>()((set) => ({
    relay: null,
    claudeUsage: null,
    directLogin: new Map(),
    switching: new Map(),
    async refreshRelay(force) {
      const result = await client.invoke('engine.relayHealth', { force });
      if (!result.ok) throw new Error(`engine.relayHealth failed: ${result.error.message}`);
      set({ relay: result.value });
      return result.value;
    },
    async refreshClaudeUsage() {
      const result = await client.invoke('settings.claudeUsage.status', undefined);
      if (!result.ok) throw new Error(`settings.claudeUsage.status failed: ${result.error.message}`);
      set({ claudeUsage: result.value });
      return result.value;
    },
  }));
}

export const useGateway = createGatewayStore(ipc);
export type GatewayStore = ReturnType<typeof createGatewayStore>;
