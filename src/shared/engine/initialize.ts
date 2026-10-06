import type { InitializeRequest } from '../wire/control';

export const DECLARED_DIALOG_KINDS: readonly string[] = Object.freeze(['auto_mode_server_fallback', 'refusal_fallback_prompt']);

// Shared by the app and recordings made with its client capabilities. Trust always belongs to this launch's cwd.
// E1: every launch declares the host's `maws` server (P1 X9's MAWS_SERVER_NAME, written out so this module keeps no
// runtime import and stays loadable by the probes' plain-node scripts), which the engine handshakes over `mcp_message`.
export function appInitialize(trust: InitializeRequest['workspaceTrust'] = undefined): InitializeRequest {
  return {
    supportedDialogKinds: [...DECLARED_DIALOG_KINDS],
    perTaskStopAffordance: true,
    ...(trust ? { workspaceTrust: trust } : {}),
    sdkMcpServers: ['maws'], // E1
  };
}
