// The frame's chips and their two sources (C7 execution document, "Composer public surface" Frame bindings, "Composer
// frame", "Unstarted sessions"): every chip takes a binding (value, options, why it is disabled, and a set that
// answers the engine's or the intent's verdict), so the chips never know which store is behind them. An unstarted
// session binds to C10's setup intent, every chip writing through the hook's `patch` and all of them disabled with one
// reason while the first send is starting or C10 holds the message. A live session binds to C3: model and effort
// through `session.setModel` and `session.setEffort`, the mode through the shared mode menu's binding (M5), additional
// directories through `session.applyFlagSettings` (`/add-dir` is gated to remote entrypoints headless, SPEC 28 §22);
// location and branch are read-only under a live engine in P0 (switching is C10's worktree concern).
import type { Effort } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ListModelsResponse } from '@shared/wire/control';
import { ipc } from '../../ipc/client';
import { liveModeBinding, MODE_OPTIONS, MODE_REFUSAL_WORDS, NOT_RUNNING, type ModeBinding } from '../../statusline';
import type { HookResult, Location, ModelInfo, SetupIntentHook } from '../setup-intent';
import { ENDED, MESSAGE_HELD, STARTING } from '../submit/submit-state';

export interface ChipBinding<V, O = never> {
  value: V;
  options: O[];
  disabled: string | null;
  set: (v: V) => Promise<HookResult>;
}

export interface ModelChoice {
  model: string | null;
  effort: Effort | null;
}

export interface FrameBindings {
  location: ChipBinding<Location, Location>; // the chip row's LocationChip
  branch: ChipBinding<string | null, string>; // inside the location chip's popover
  model: ChipBinding<ModelChoice, ModelInfo> & { names?: readonly ModelInfo[] }; // the toolbar's ModelChip (effort inside); names: the session's last listed models, for the chip's label before this mount has read them
  mode: ModeBinding; // the toolbar's ModeChip, on the shared mode menu (M5)
  directories: ChipBinding<string[]>; // AddDirChip
}

export const ARRIVES_WITH_C10 = 'Arrives with C10';
export const NEW_WORKTREE_BRANCH = 'Choose New worktree to pick a branch';

const refused = (error: string) => async (): Promise<HookResult> => ({ ok: false, error });

// Whether a model option is the model named: a live session reports the resolved id, which C3's list names as an
// option's value or its `resolvedModel`. The chip shows and checks through it; the binding switches only when it differs.
export const modelMatches = (option: ModelInfo, model: string | null): boolean => model !== null && (option.value === model || (option as { resolvedModel?: string }).resolvedModel === model);

// ---- unstarted: C10's setup intent ------------------------------------------------------------------------------

export function intentBindings(hook: SetupIntentHook, gate: { starting: boolean }): FrameBindings {
  const { intent, options } = hook;
  const gated = gate.starting ? STARTING : intent.message !== null ? MESSAGE_HELD : null;
  const through = <V>(write: (v: V) => Parameters<SetupIntentHook['patch']>[0]) => (gated === null ? (v: V) => hook.patch(write(v)) : refused(gated));
  const location = intent.location;
  const chosen = options.models.find((m) => m.value === intent.model);
  return {
    location: { value: location, options: options.locations, disabled: gated, set: through((l: Location) => ({ location: l })) },
    branch: {
      value: location.kind === 'newWorktree' ? location.branch.name : null,
      options: options.branches,
      disabled: gated ?? (location.kind === 'newWorktree' ? null : NEW_WORKTREE_BRANCH),
      set:
        gated === null && location.kind === 'newWorktree'
          ? (name) => {
              // a listed branch is checked out as it is; a new name creates it from the worktree's base
              const branch = name !== null && options.branches.includes(name) ? { kind: 'existing' as const, name } : { kind: 'new' as const, name: name ?? location.branch.name, base: location.branch.kind === 'new' ? location.branch.base : 'HEAD' };
              return hook.patch({ location: { ...location, branch } });
            }
          : refused(gated ?? NEW_WORKTREE_BRANCH),
    },
    model: { value: { model: intent.model, effort: intent.effort }, options: options.models, disabled: gated, set: through((m: ModelChoice) => ({ model: m.model, effort: m.effort })) },
    mode: {
      value: intent.permissionMode,
      options: MODE_OPTIONS.map((o) => o.mode),
      disabled: gated,
      refusal: null,
      autoUnavailable: chosen?.supportsAutoMode === false ? MODE_REFUSAL_WORDS.auto_mode_model : null,
      set: through((permissionMode) => ({ permissionMode })),
    },
    directories: { value: intent.additionalDirectories, options: [], disabled: gated, set: through((additionalDirectories: string[]) => ({ additionalDirectories })) },
  };
}

// ---- live: C3's session ---------------------------------------------------------------------------------------

type ModelOption = ListModelsResponse['models'][number];

// What the live chips read beside the status and the record: C3's `listModels`, the engine's workspace directories,
// C4's branch and branch list, and a refresh of the rules after a directory was added. The two engine reads are control
// requests, so the composer makes them only when a chip that shows them opens (never per mount: many open sessions
// would each ask the engine, and a replayed engine refuses any request its journal did not record).
export interface LiveReads {
  models?: readonly ModelOption[] | null;
  modelNames?: readonly ModelOption[] | null; // the session's last listed models, remembered past any read
  directories?: readonly string[] | null;
  branch?: string | null;
  branches?: readonly string[];
  refresh?: () => void;
}

// `list_permission_rules`'s workspace directories as paths (the wire types them loosely: a path, or an object naming one).
export function workspaceDirectoriesOf(raw: readonly unknown[]): string[] {
  return raw.flatMap((d) => (typeof d === 'string' ? [d] : typeof d === 'object' && d !== null && typeof (d as { path?: unknown }).path === 'string' ? [(d as { path: string }).path] : []));
}

export function liveBindings(status: EngineSessionStatus | null, record: SessionRecord | null, reads: LiveReads = {}, client: MawsBridge = ipc): FrameBindings {
  const appSessionId = status?.appSessionId ?? record!.appId;
  const ready = status?.process === 'ready';
  const writable = ready ? null : NOT_RUNNING;
  const current: ModelChoice = { model: status?.model.resolved ?? status?.model.requested ?? record?.model.resolved ?? record?.model.requested ?? null, effort: status?.effort ?? null };
  const directories = [...(reads.directories ?? record?.additionalDirectories ?? [])];
  const location: Location = { kind: 'directory', path: status?.cwd ?? record?.directory ?? '' };
  return {
    location: { value: location, options: [location], disabled: ARRIVES_WITH_C10, set: refused(ARRIVES_WITH_C10) },
    branch: { value: reads.branch ?? record?.worktree?.branch ?? record?.branch ?? null, options: [...(reads.branches ?? [])], disabled: ARRIVES_WITH_C10, set: refused(ARRIVES_WITH_C10) },
    model: {
      value: current,
      options: [...(reads.models ?? [])],
      names: reads.modelNames ?? undefined,
      disabled: writable,
      set: async (next) => {
        if (!ready) return { ok: false, error: NOT_RUNNING };
        const picked = reads.models?.find((m) => m.value === next.model);
        if (next.model !== current.model && !(picked && modelMatches(picked, current.model))) {
          const result = await client.invoke('session.setModel', { appSessionId, model: next.model });
          if (!result.ok) return { ok: false, error: result.error.message };
          if (!result.value.ok) return { ok: false, error: result.value.error ?? 'The engine refused the model' };
        }
        if (next.effort !== current.effort) {
          const result = await client.invoke('session.setEffort', { appSessionId, effort: next.effort });
          if (!result.ok) return { ok: false, error: result.error.message };
        }
        return { ok: true };
      },
    },
    mode: liveModeBinding({ appId: appSessionId, permissionMode: status?.permissionMode ?? record!.permissionMode, model: status?.model ?? record!.model }, status, reads.models ?? null, client),
    directories: {
      value: directories,
      options: [],
      disabled: writable,
      // The engine's own list is read at the moment of the change (the chip's value may be the record's, or stale), and
      // the new directories are added to it: flag settings replace the list, so nothing the engine holds is dropped.
      set: async (next) => {
        if (!ready) return { ok: false, error: NOT_RUNNING };
        const rules = await client.invoke('session.listPermissionRules', { appSessionId });
        if (!rules.ok) return { ok: false, error: rules.error.message };
        const held = workspaceDirectoriesOf(rules.value.state.workspaceDirectories);
        const additionalDirectories = [...held, ...next.filter((d) => !held.includes(d))];
        const result = await client.invoke('session.applyFlagSettings', { appSessionId, settings: { permissions: { additionalDirectories } } });
        if (!result.ok) return { ok: false, error: result.error.message };
        reads.refresh?.();
        return { ok: true };
      },
    },
  };
}

// ---- neither: no intent, no status, no record (a session nothing knows yet, e.g. a scenario's new tab) ------------

export function endedBindings(reason: string = ENDED): FrameBindings {
  const location: Location = { kind: 'directory', path: '' };
  const none = refused(reason);
  return {
    location: { value: location, options: [], disabled: reason, set: none },
    branch: { value: null, options: [], disabled: reason, set: none },
    model: { value: { model: null, effort: null }, options: [], disabled: reason, set: none },
    mode: { value: null, options: MODE_OPTIONS.map((o) => o.mode), disabled: reason, refusal: null, autoUnavailable: null, set: none },
    directories: { value: [], options: [], disabled: reason, set: none },
  };
}
