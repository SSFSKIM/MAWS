import type { PermissionMode } from '../graph/enums';

// Display words only: records, settings and controls retain the engine's mode ids.
export const PERMISSION_MODE_LABELS: Readonly<Record<PermissionMode, string>> = {
  default: 'Manual',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  bypassPermissions: 'Bypass permissions',
  dontAsk: "Don't ask",
};
