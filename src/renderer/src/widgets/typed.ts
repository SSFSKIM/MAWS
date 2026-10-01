// A typed `/<widget> <args>` that says everything (the architect's correction of 2026-09-29, C11 execution document's
// M3 Decision Log entry, "Amended"): `/model opus`, `/effort high`, `/permissions acceptEdits`, `/fast off` apply at
// Enter through the widget's own control path (the same validation and result branches), and the outcome is a toast in
// the widget's words. The widget opens with its argument instead (the answer is false) when the argument is missing,
// ambiguous or invalid, or when the widget's own rule asks for a step first: `/fast on` shows its lane warning, a
// gateway model in auto shows its local-lane note, `bypassPermissions` asks before switching, and a session without a
// ready process has nothing to apply to. The editor waits a short bound for the decision and then opens the widget; its
// `tooLate` signal says so, and a decision reached after it applies nothing and answers false.
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { PermissionMode } from '@shared/graph/enums';
import type { WidgetCommandName } from '../composer';
import { ipc } from '../ipc/client';
import { autoUnavailableReason, MODE_OPTIONS } from '../statusline';
import { listedModelsOf, rememberListedModels, useComposerStore, type ListedModel } from '../stores/composer';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { isGatewayModel } from '@shared/sessions/models';
import { TYPED } from './copy';
import { applyFlagSettings, effortLevelsOf, rowNamed, rowOf, setEffort, setModel, type ControlAnswer } from './model';
import { setPermissionMode } from './PermissionsWidget';

export type TypedApply = (appSessionId: AppSessionId, args: string, tooLate?: AbortSignal) => Promise<boolean>;

const ready = (id: AppSessionId) => {
  const status = useSessions.getState().engine.get(id);
  return status?.process === 'ready' ? status : null;
};

// The session's catalogue: what C7 last listed for it, else one `session.listModels` (remembered for the chip).
async function catalogue(id: AppSessionId): Promise<readonly ListedModel[] | null> {
  const held = listedModelsOf(useComposerStore.getState(), id);
  if (held) return held;
  const result = await ipc.invoke('session.listModels', { appSessionId: id });
  if (!result.ok) return null;
  rememberListedModels(id, result.value.models);
  return result.value.models;
}

// The control run in the background once the argument resolved; the outcome as a toast in the widget's words.
function report(write: Promise<ControlAnswer | { ok: true } | { ok: false; error: string }>, done: string): void {
  void write.then(
    (answer) => {
      if (answer.ok) toast({ level: 'info', text: done, actions: [], dismissible: true });
      else toast({ level: 'warning', text: 'caption' in answer && answer.caption ? `${answer.error} · ${answer.caption}` : answer.error, actions: [], dismissible: true });
    },
    (error: unknown) => toast({ level: 'warning', text: error instanceof Error ? error.message : String(error), actions: [], dismissible: true }),
  );
}

const applyModel: TypedApply = async (id, args, tooLate) => {
  const status = ready(id);
  const models = status && (await catalogue(id));
  const row = models ? rowNamed(models, args) : undefined;
  if (!status || !row || tooLate?.aborted) return false;
  const auto = status.permissionMode.effective === 'auto';
  if (isGatewayModel(row.value) && auto) return false; // the local-lane note first
  // in auto, a model that cannot hold it says so, as the widget's caption does (absent `supportsAutoMode` is not `false`)
  report(setModel({ appSessionId: id, model: row.value }), TYPED.model(row.displayName, auto && row.supportsAutoMode !== true));
  return true;
};

const EFFORTS: readonly string[] = EffortSchema.options;
const applyEffort: TypedApply = async (id, args, tooLate) => {
  const status = ready(id);
  const word = args.toLowerCase();
  // the terminal's `/effort auto` clears the override (the selector's Reset)
  const level: Effort | null | undefined = word === 'auto' || word === 'default' ? null : EFFORTS.includes(word) ? (word as Effort) : undefined;
  if (!status || level === undefined) return false;
  if (level !== null) {
    const models = await catalogue(id);
    const row = models ? rowOf(models, status.model.requested ?? status.model.resolved) : undefined;
    if (!effortLevelsOf(row).includes(level)) return false; // the model does not admit it: the selector shows what it does
  }
  if (tooLate?.aborted) return false;
  report(setEffort({ appSessionId: id, effort: level }), TYPED.effort(level));
  return true;
};

const applyFast: TypedApply = async (id, args, tooLate) => {
  const status = ready(id);
  if (!status || args.toLowerCase() !== 'off') return false; // `on` shows the lane warning first
  const models = await catalogue(id);
  const row = models ? rowOf(models, status.model.requested ?? status.model.resolved) : undefined;
  if (row?.supportsFastMode !== true || tooLate?.aborted) return false; // the widget says fast mode is for Opus
  report(applyFlagSettings({ appSessionId: id, settings: { fastMode: false } }), TYPED.fastOff);
  return true;
};

const applyPermissions: TypedApply = async (id, args, tooLate) => {
  const status = ready(id);
  const option = MODE_OPTIONS.find((o) => o.mode.toLowerCase() === args.toLowerCase());
  if (!status || !option || option.confirm) return false; // bypassPermissions asks first, as the chip does
  const mode: PermissionMode = option.mode;
  if (mode === 'auto' && autoUnavailableReason(await catalogue(id), status.model) !== null) return false; // the segment says why
  if (tooLate?.aborted) return false;
  report(setPermissionMode({ appSessionId: id, mode }), TYPED.mode(mode));
  return true;
};

export const TYPED_APPLY: Partial<Record<WidgetCommandName, TypedApply>> = { model: applyModel, effort: applyEffort, fast: applyFast, permissions: applyPermissions };
