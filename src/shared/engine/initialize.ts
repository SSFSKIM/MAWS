import type { InitializeRequest } from '../wire/control';

export const DECLARED_DIALOG_KINDS: readonly string[] = Object.freeze(['auto_mode_server_fallback', 'refusal_fallback_prompt']);

// Shared by the app and recordings made with its client capabilities. Trust always belongs to this launch's cwd.
export function appInitialize(trust: InitializeRequest['workspaceTrust'] = undefined): InitializeRequest {
  return {
    supportedDialogKinds: [...DECLARED_DIALOG_KINDS],
    perTaskStopAffordance: true,
    ...(trust ? { workspaceTrust: trust } : {}),
  };
}
