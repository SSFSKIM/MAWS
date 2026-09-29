// The permission-mode menu's logic, shared by the status line's mode popover and the composer toolbar's Mode chip (C7
// execution document, "Composer frame" Mode and "Status line popovers and usage" mode: "the same menu"). The chip and
// the popover show only the engine's effective mode, with a refusal code in words; every change is
// `session.setPermissionMode`, and what shows afterwards is the engine's answer, never the optimistic choice.
import type { AutoModeRefusalCode, PermissionMode } from '@shared/graph/enums';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ListModelsResponse } from '@shared/wire/control';
import { ipc } from '../ipc/client';

type ModelOption = ListModelsResponse['models'][number]; // C3's `session.listModels` entry

export interface ModeOption {
  mode: PermissionMode;
  description: string;
  confirm: boolean; // asks before switching
}

export const MODE_OPTIONS: readonly ModeOption[] = [
  { mode: 'default', description: 'Asks before each tool that needs approval', confirm: false },
  { mode: 'acceptEdits', description: 'File edits are approved; other tools ask', confirm: false },
  { mode: 'plan', description: 'Reads and plans; changes nothing', confirm: false },
  { mode: 'auto', description: 'A classifier approves what is safe and asks for the rest', confirm: false },
  { mode: 'bypassPermissions', description: 'Every tool runs without asking', confirm: true },
];

export const BYPASS_CONFIRM = 'Bypass permissions runs every tool without asking, file edits and shell commands included.';

// The refusal codes of `set_permission_mode` in words (X6 requires the UI to surface them).
export const MODE_REFUSAL_WORDS: Record<AutoModeRefusalCode, string> = {
  auto_mode_settings: 'Auto mode is disabled by settings',
  auto_mode_circuit_breaker: 'Auto mode paused by its circuit breaker',
  auto_mode_fast_mode: 'Auto mode is unavailable with fast mode',
  auto_mode_model: 'This model does not support auto mode',
  auto_mode_unavailable: 'Auto mode is unavailable',
};

const CYCLE: readonly PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

// ⇧Tab's order: default → acceptEdits → plan → auto → default, skipping auto when it cannot be chosen; any other mode
// (bypass, dontAsk, unknown) cycles to default.
export function nextMode(current: PermissionMode | null, autoAvailable: boolean): PermissionMode {
  const cycle = autoAvailable ? CYCLE : CYCLE.filter((m) => m !== 'auto');
  const at = current === null ? -1 : cycle.indexOf(current);
  return at === -1 ? 'default' : cycle[(at + 1) % cycle.length];
}

// Why auto cannot be chosen: `session.listModels` marks the session's model `supportsAutoMode: false`. An unknown model
// (the list not read yet, or the model not in it) is offered; the engine then refuses in words.
export function autoUnavailableReason(models: readonly Pick<ModelOption, 'value' | 'resolvedModel' | 'supportsAutoMode'>[] | null, model: EngineSessionStatus['model']): string | null {
  const names = [model.resolved, model.requested].filter((n): n is string => n !== null);
  const option = models?.find((m) => names.includes(m.value) || names.includes(m.resolvedModel));
  return option?.supportsAutoMode === false ? MODE_REFUSAL_WORDS.auto_mode_model : null;
}

// The menu's input: the frame's binding fields (value, options, disabled, set) with the two facts only the mode menu
// reads. It is its own type, not assignable to M4's ChipBinding; M4 types `FrameBindings.mode: ModeBinding`.
export interface ModeBinding {
  value: PermissionMode | null; // the effective mode; null while nothing is known (an unstarted session's default)
  options: PermissionMode[];
  disabled: string | null; // why no mode can be chosen now
  set: (mode: PermissionMode) => Promise<{ ok: true } | { ok: false; error: string }>;
  refusal: AutoModeRefusalCode | null; // why the requested mode was refused, shown in words
  autoUnavailable: string | null; // why auto is disabled in the list
}

export const NOT_RUNNING = 'The session is not running';

// A started session's binding: the effective mode from C3's status (the record's when no process is live) and
// `session.setPermissionMode` for a ready process.
export function liveModeBinding(record: Pick<SessionRecord, 'appId' | 'permissionMode' | 'model'>, status: EngineSessionStatus | null, models: readonly ModelOption[] | null, client: MawsBridge = ipc): ModeBinding {
  const mode = status?.permissionMode ?? record.permissionMode;
  return {
    value: mode.effective,
    options: MODE_OPTIONS.map((o) => o.mode),
    disabled: status?.process === 'ready' ? null : NOT_RUNNING,
    refusal: mode.refusal,
    autoUnavailable: autoUnavailableReason(models, status?.model ?? record.model),
    async set(next) {
      const result = await client.invoke('session.setPermissionMode', { appSessionId: record.appId, mode: next });
      if (!result.ok) return { ok: false, error: result.error.message };
      // C3's host answers a refusal with the control error's message beside its code: the code's words come first
      if (result.value.refusal !== null) return { ok: false, error: MODE_REFUSAL_WORDS[result.value.refusal] };
      if (result.value.error !== null) return { ok: false, error: result.value.error };
      return { ok: true };
    },
  };
}
