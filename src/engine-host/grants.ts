// The grant snapshot (charter §4.4, §4.6; C3 execution document, Interfaces "Queue, steer, interrupt" `GrantSnapshot`):
// the session-scoped allow rules MAWS issued by answering a permission with `updatedPermissions` whose destination is
// `session`. The engine forgets them on `--resume` (pass 2 `grant-reapply`), so the snapshot is kept app-side and
// re-applied through `apply_flag_settings { settings: { permissions: { allow } } }` before the first user frame of a
// resumed launch (`pass2/grant-reapply-resume` seq 7). The snapshot persists through the SessionStateStore port, which
// owns its type.
import type { GrantSnapshot } from '@shared/engine/session-state-store';
import { PermissionUpdateSchema } from '@shared/wire/control';
import { applyFlagSettings, type RequestOptions } from './controls';
import type { ControlClient } from './rpc';

export type { GrantSnapshot } from '@shared/engine/session-state-store';

export const EMPTY_GRANTS: GrantSnapshot = Object.freeze({ allow: Object.freeze([]) as unknown as string[] });

// `pass1/permission-roundtrip` seq 282: a tool-wide rule renders as `Bash`, a scoped one as `Bash(git status --short)`.
export function grantRuleString(rule: { toolName: string; ruleContent?: string }): string {
  return rule.ruleContent === undefined ? rule.toolName : `${rule.toolName}(${rule.ruleContent})`;
}

// The snapshot after we sent `updatedPermissions`: every `addRules` allow rule with destination `session` appended
// once; other destinations persist in the engine's own settings files, and other update types are not grants.
export function recordFromResponse(snapshot: GrantSnapshot, updatedPermissions: readonly unknown[]): GrantSnapshot {
  const allow = [...snapshot.allow];
  for (const raw of updatedPermissions) {
    const parsed = PermissionUpdateSchema.safeParse(raw);
    if (!parsed.success) continue;
    const update = parsed.data;
    if (update.type !== 'addRules' || update.behavior !== 'allow' || update.destination !== 'session') continue;
    for (const rule of update.rules) {
      const text = grantRuleString(rule);
      if (!allow.includes(text)) allow.push(text);
    }
  }
  return allow.length === snapshot.allow.length ? snapshot : { allow };
}

// Re-applies the snapshot to a resumed process; true when a request was written and answered, false for an empty
// snapshot (nothing is written). Rejects as the control client does.
export async function reapply(client: ControlClient, snapshot: GrantSnapshot, opts?: RequestOptions): Promise<boolean> {
  if (snapshot.allow.length === 0) return false;
  await applyFlagSettings(client, { settings: { permissions: { allow: [...snapshot.allow] } } }, opts);
  return true;
}
