// The frame's chips and their two sources (C7 execution document, "Composer public surface" Frame bindings, "Composer
// frame", "Unstarted sessions"): every chip takes a binding (value, options, why it is disabled, and a set that
// answers the engine's or the intent's verdict), so the chips never know which store is behind them. An unstarted
// session binds to C10's setup intent, every chip writing through the hook's `patch` and all of them disabled with one
// reason while the first send is starting or C10 holds the message. A live session binds to C3: model and effort
// through `session.setModel` and `session.setEffort`, the mode through the shared mode menu's binding (M5), additional
// directories through `session.applyFlagSettings` (`/add-dir` is gated to remote entrypoints headless, SPEC 28 §22);
// location and branch are read-only under a live engine: where a session runs is fixed once it starts (§19, the C8
// recomposition entry). New chat (2026-10-01, the owner's ruling after Codex's new-thread composer): an unstarted
// tab chooses where it runs in the project row above the box (the project chip with its read-only branch, and the
// Worktree checkbox), so the toolbar's location chip is a started session's and only reads.
import type { Effort } from '@shared/engine/launch-spec';
import { EffortSchema } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { UserEngineDefaults } from '@shared/ipc/schema/settings';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ListModelsResponse } from '@shared/wire/control';
import { ipc } from '../../ipc/client';
import { liveModeBinding, MODE_OPTIONS, MODE_REFUSAL_WORDS, NOT_RUNNING, type ModeBinding } from '../../statusline';
import { locationPath, type HookResult, type ModelInfo, type SetupIntentHook, type SetupProject } from '../setup-intent';
import { ENDED, MESSAGE_HELD, STARTING } from '../submit/submit-state';
import { aliasOf, chipLabel, DEFAULT_ROW } from './model-label';

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

// W3: the model chip's binding carries its words, `<alias> <effort>` (model-label.ts), worked out here from the
// session's source: the intent with the user's own settings while unstarted, the engine's status and effective effort once live.
export type ModelBinding = ChipBinding<ModelChoice, ModelInfo> & { label: string };

// The toolbar's location chip (W2), read-only: where a started session runs, its branch, and why it cannot move.
export interface LocationView {
  path: string;
  branch: string | null;
  note: string;
}

// New chat: the unstarted tab's project row, the hook's project facts with their writes gated as every chip's are.
export type ProjectRowBinding = SetupProject & { disabled: string | null };

export interface FrameBindings {
  location: LocationView; // the toolbar's LocationChip (W2), shown once the session has started
  project: ProjectRowBinding | null; // New chat: the row above the box on an unstarted tab (null once started)
  model: ModelBinding; // the toolbar's ModelChip; the selector C11 registers opens from it (W3)
  mode: ModeBinding; // the toolbar's ModeChip, on the shared mode menu (M5)
  directories: ChipBinding<string[]>; // AddDirChip
}

export const LOCATION_FIXED = 'The location is fixed once the session starts';

const refused = (error: string) => async (): Promise<HookResult> => ({ ok: false, error });

// Whether a model option is the model named: a live session reports the resolved id, which C3's list names as an
// option's value or its `resolvedModel`. The chip shows and checks through it; the binding switches only when it differs.
export const modelMatches = (option: ModelInfo, model: string | null): boolean => model !== null && (option.value === model || (option as { resolvedModel?: string }).resolvedModel === model);

// ---- unstarted: C10's setup intent ------------------------------------------------------------------------------

// What an unstarted tab's chip names (W3): what the engine will use, the intent's own choice first, then the user's
// settings (`model`, `effortLevel`; read only), then the catalogue's `default` row resolved to its model.
export function intentModelLabel(intent: Pick<SetupIntentHook['intent'], 'model' | 'effort'>, models: readonly ModelInfo[], defaults: UserEngineDefaults | null): string {
  return chipLabel(aliasOf(intent.model ?? defaults?.model ?? DEFAULT_ROW, models), intent.effort ?? defaults?.effortLevel ?? null);
}

export function intentBindings(hook: SetupIntentHook, gate: { starting: boolean }, defaults: UserEngineDefaults | null = null): FrameBindings {
  const { intent, options } = hook;
  const gated = gate.starting ? STARTING : intent.message !== null ? MESSAGE_HELD : null;
  const through = <V>(write: (v: V) => Parameters<SetupIntentHook['patch']>[0]) => (gated === null ? (v: V) => hook.patch(write(v)) : refused(gated));
  const chosen = options.models.find((m) => m.value === (intent.model ?? defaults?.model ?? DEFAULT_ROW));
  const project = hook.project ?? null;
  return {
    // a hook without project facts (the harness's stub) keeps the toolbar's chip, naming the intent's location
    location: { path: intent.location === null ? '' : locationPath(intent.location), branch: null, note: gated ?? 'Where this session will run' },
    project:
      project === null
        ? null
        : {
            ...project,
            disabled: gated,
            choose: gated === null ? (projectId) => project.choose(projectId) : refused(gated),
            newProject: gated === null ? () => project.newProject() : refused(gated),
            setWorktree: gated === null ? (on) => project.setWorktree(on) : refused(gated),
          },
    model: {
      value: { model: intent.model, effort: intent.effort },
      label: intentModelLabel(intent, options.models, defaults),
      options: options.models,
      disabled: gated,
      set: through((m: ModelChoice) => ({ model: m.model, effort: m.effort })),
    },
    mode: {
      value: intent.permissionMode ?? defaults?.defaultMode ?? 'auto', // W3: what the launch passes for an intent that chose none
      options: MODE_OPTIONS.map((o) => o.mode),
      disabled: gated,
      refusal: null,
      autoUnavailable: chosen !== undefined && chosen.supportsAutoMode !== true ? MODE_REFUSAL_WORDS.auto_mode_model : null, // W3: absent is not auto
      set: through((permissionMode) => ({ permissionMode })),
    },
    directories: { value: intent.additionalDirectories, options: [], disabled: gated, set: through((additionalDirectories: string[]) => ({ additionalDirectories })) },
  };
}

// ---- live: C3's session ---------------------------------------------------------------------------------------

type ModelOption = ListModelsResponse['models'][number];

// What the live chips read beside the status and the record: C3's `listModels`, the engine's workspace directories,
// C4's branch, and a refresh of the rules after a directory was added. The two engine reads are control
// requests, so the composer makes them only when a chip that shows them opens (never per mount: many open sessions
// would each ask the engine, and a replayed engine refuses any request its journal did not record).
export interface LiveReads {
  models?: readonly ModelOption[] | null;
  modelNames?: readonly ModelInfo[] | null; // the route's model catalogue (`engine.models`), naming the model before any list is read
  effort?: Effort | null; // W3: the effort the engine runs at (`get_settings.applied.effort`), when known
  directories?: readonly string[] | null;
  branch?: string | null;
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
  // W3: named from the options this mount listed, else the route's catalogue; the effort the engine runs at, else the requested one
  const names = reads.models && reads.models.length > 0 ? reads.models : (reads.modelNames ?? []);
  const shownEffort = reads.effort !== undefined ? reads.effort : status ? status.effort : (EffortSchema.safeParse(record?.effort).data ?? null);
  const directories = [...(reads.directories ?? record?.additionalDirectories ?? [])];
  return {
    location: { path: status?.cwd ?? record?.directory ?? '', branch: reads.branch ?? record?.worktree?.branch ?? record?.branch ?? null, note: LOCATION_FIXED },
    project: null,
    model: {
      value: current,
      label: chipLabel(aliasOf(current.model, names), shownEffort),
      options: [...(reads.models ?? [])],
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
  const none = refused(reason);
  return {
    location: { path: '', branch: null, note: reason },
    project: null,
    model: { value: { model: null, effort: null }, label: chipLabel(null, null), options: [], disabled: reason, set: none },
    mode: { value: null, options: MODE_OPTIONS.map((o) => o.mode), disabled: reason, refusal: null, autoUnavailable: null, set: none },
    directories: { value: [], options: [], disabled: reason, set: none },
  };
}
