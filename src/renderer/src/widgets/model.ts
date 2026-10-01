// The model widget's logic (C11 execution document, Interfaces "Model widget, the one with the most rules"), apart from
// its rendering: the catalogue in its two groups, which entry the engine is on and whether the next init frame has
// confirmed it, the effort levels an entry admits, fast mode's state in words, and the controls, each coded against
// C3's result values (`setModel`'s `{ ok, error, code }`, the void answers of `setEffort` and `applyFlagSettings`) with a
// rejected invoke as the separate transport branch. A control that the engine accepted is remembered until the status
// moves, so the widget (and a passively mounted one, whose controls the harness runs) shows it as pending.
import { create } from 'zustand';
import * as z from 'zod';
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { ListModelsResponse } from '@shared/wire/control';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { isGatewayModel } from '@shared/sessions/models';
import { MODEL } from './copy';
import { transportWords } from './read';

// A catalogue row: C3's `list_models` entry, or (unstarted) C10's catalogue entry through C7's setup-intent seam, where
// the capability keys may be absent.
export type ModelRow = Pick<ListModelsResponse['models'][number], 'value' | 'displayName'> & Partial<Pick<ListModelsResponse['models'][number], 'resolvedModel' | 'description' | 'supportedEffortLevels' | 'supportsFastMode' | 'supportsAutoMode'>>;

export interface ModelEntryView {
  value: string;
  displayName: string;
  description: string | null;
  oneM: boolean; // the resolved model is a 1M-context one
  cannotHoldAuto: boolean; // `supportsAutoMode !== true`: absent (Haiku) is not `false`, and the engine runs it in default
  fast: boolean;
  efforts: Effort[];
  gateway: boolean;
}

const EFFORTS = EffortSchema.options;

// The levels an entry admits (every entry that lists them lists all five on 2.1.283); none listed: the whole vocabulary.
// Parsed here, since C10's catalogue entries pass the field through untyped: anything but a list of strings is none.
const LevelsSchema = z.array(z.string()).optional();
export const effortsOf = (row: { supportedEffortLevels?: unknown } | undefined): Effort[] => {
  const levels = LevelsSchema.safeParse(row?.supportedEffortLevels);
  return levels.success && levels.data ? EFFORTS.filter((e) => levels.data!.includes(e)) : [...EFFORTS];
};

// W3: the levels the model selector's slider offers. An entry that lists levels admits those; one that says it supports
// effort and lists none, the whole vocabulary; one that says neither has none (Haiku: `supportsEffort` and the levels are
// absent on the live row, reads.jsonl seq 3, and `get_settings` applies no effort for it, seq 60). An unknown entry (the
// catalogue not read yet, or a model it does not list) offers the whole vocabulary, and the engine answers.
export const effortLevelsOf = (row: { supportedEffortLevels?: unknown; supportsEffort?: unknown } | undefined): Effort[] => {
  if (row === undefined) return [...EFFORTS];
  const levels = LevelsSchema.safeParse(row.supportedEffortLevels);
  if (levels.success && levels.data) return EFFORTS.filter((e) => levels.data!.includes(e));
  return row.supportsEffort === true ? [...EFFORTS] : [];
};

export function presentModels(models: readonly ModelRow[]): { claude: ModelEntryView[]; gateway: ModelEntryView[] } {
  const view = (m: ModelRow): ModelEntryView => ({
    value: m.value,
    displayName: m.displayName,
    description: m.description ?? null,
    oneM: (m.resolvedModel ?? m.value).endsWith('[1m]'),
    cannotHoldAuto: m.supportsAutoMode !== true,
    fast: m.supportsFastMode === true,
    efforts: effortsOf(m),
    gateway: isGatewayModel(m.value),
  });
  const all = models.map(view);
  return { claude: all.filter((m) => !m.gateway), gateway: all.filter((m) => m.gateway) };
}

// Whether the widget shows a gateway model's auto-mode note: C10's `autoModeNote` rule for its gateway arm (a gateway
// model when the mode is auto, or, on an unstarted intent, left to settings, whose default is auto for the owner, D-18),
// applied to the widget's own wording of the note (`MODEL.gatewayNote`, which names the routing account).
export const showsGatewayNote = (value: string, mode: string | null): boolean => isGatewayModel(value) && (mode === 'auto' || mode === null);

// The row a model id names: the alias itself, else the first row that resolves to it (`default` and `opus` share one).
export const rowOf = (models: readonly ModelRow[], id: string | null): ModelRow | undefined =>
  id === null ? undefined : (models.find((m) => m.value === id) ?? models.find((m) => m.resolvedModel === id));

// What the palette's argument names: a value, a display name or a resolved id, in any case.
export function rowNamed(models: readonly ModelRow[], name: string): ModelRow | undefined {
  const wanted = name.trim().toLowerCase();
  return models.find((m) => m.value.toLowerCase() === wanted) ?? models.find((m) => m.displayName.toLowerCase() === wanted) ?? models.find((m) => m.resolvedModel?.toLowerCase() === wanted);
}

// The engine's model for a live session: the one it accepted last (C3's requested, set only after `set_model`
// succeeded), else the init frame's; pending until an init frame reports it.
export function liveModel(models: readonly ModelRow[], model: EngineSessionStatus['model']): { row: ModelRow | undefined; id: string | null; pending: boolean } {
  const id = model.requested ?? model.resolved;
  const row = rowOf(models, id);
  const confirmed = model.resolved === null || model.requested === null || (row !== undefined && (row.value === model.resolved || row.resolvedModel === model.resolved)) || id === model.resolved;
  return { row, id, pending: !confirmed };
}

// Fast mode from the init frame (`fastMode.state`): `on` checked, `cooldown` checked and marked, `off` unchecked, and
// the reason in words when one is reported.
export interface FastView {
  checked: boolean;
  caption: string | null;
  disabled: string | null; // the current model has no fast mode
}
export function fastView(fast: EngineSessionStatus['fastMode'], row: ModelRow | undefined): FastView {
  const checked = fast.state === 'on' || fast.state === 'cooldown';
  const reason = fast.disabledReason === null ? null : (MODEL.fastReason[fast.disabledReason] ?? fast.disabledReason);
  return { checked, caption: fast.state === 'cooldown' ? MODEL.cooldown : checked ? null : reason, disabled: row?.supportsFastMode === true ? null : MODEL.fastForOpus };
}

// ---- the controls (the widget's, and the harness's `window.__maws_widgets.control`) --------------------------------------

// What the engine accepted and the status has not shown yet: `basis` is the status fact at the time, so any move of it
// (the request arriving, or anything else) ends the memory.
interface Requested<T> {
  value: T;
  basis: string | null;
}
interface ModelRequests {
  model: ReadonlyMap<AppSessionId, Requested<string | null>>;
  fast: ReadonlyMap<AppSessionId, Requested<boolean | null>>;
}
export const useModelRequests = create<ModelRequests>()(() => ({ model: new Map(), fast: new Map() }));
const rememberModel = (id: AppSessionId, entry: Requested<string | null>) => useModelRequests.setState((s) => ({ model: new Map(s.model).set(id, entry) }));
const rememberFast = (id: AppSessionId, entry: Requested<boolean | null>) => useModelRequests.setState((s) => ({ fast: new Map(s.fast).set(id, entry) }));
export const resetModelRequests = () => useModelRequests.setState({ model: new Map(), fast: new Map() });

// A memory ends as soon as its session's status moves off the basis, whether or not a widget is open, so a model asked
// for and later asked away from is never shown again from here.
const settled = <T>(held: ReadonlyMap<AppSessionId, Requested<T>>, fact: (status: EngineSessionStatus) => string | null, engine: ReadonlyMap<AppSessionId, EngineSessionStatus>) => {
  const kept = new Map([...held].filter(([id, entry]) => engine.has(id) && entry.basis === fact(engine.get(id)!)));
  return kept.size === held.size ? held : kept;
};
useSessions.subscribe(({ engine }) => {
  const { model, fast } = useModelRequests.getState();
  if (model.size === 0 && fast.size === 0) return;
  const next = { model: settled(model, (s) => s.model.requested, engine), fast: settled(fast, fastFact, engine) };
  if (next.model !== model || next.fast !== fast) useModelRequests.setState(next);
});

const statusOf = (id: AppSessionId): EngineSessionStatus | null => useSessions.getState().engine.get(id) ?? null;
// Fast mode's status fact is its state and its reason: behind the relay the init frame after the opt-in keeps `off` and
// moves the reason (`sdk_opt_in_required` to `preference`, live 2026-09-29), and that is the engine's answer too.
const fastFact = (status: EngineSessionStatus): string => `${status.fastMode.state}:${status.fastMode.disabledReason ?? ''}`;

export type ControlAnswer = { ok: true } | { ok: false; error: string; caption: string | null };

// `session.setModel`: `{ ok: false, code }` in words with `error` as the caption; the prior model stays.
export async function setModel(input: { appSessionId: AppSessionId; model: string | null }): Promise<ControlAnswer> {
  const basis = statusOf(input.appSessionId)?.model.requested ?? null;
  const result = await ipc.invoke('session.setModel', input);
  if (!result.ok) return { ok: false, error: transportWords(result.error), caption: null };
  if (!result.value.ok) return { ok: false, error: (result.value.code && MODEL.code[result.value.code]) || MODEL.refused, caption: result.value.error };
  // remembered only while the status has not moved: a status that arrived before the answer already shows the model
  if ((statusOf(input.appSessionId)?.model.requested ?? null) === basis) rememberModel(input.appSessionId, { value: input.model, basis });
  return { ok: true };
}

// `session.setEffort` (C3 writes `apply_flag_settings { effortLevel }`); null is the engine's default.
export async function setEffort(input: { appSessionId: AppSessionId; effort: Effort | null }): Promise<ControlAnswer> {
  const result = await ipc.invoke('session.setEffort', input);
  return result.ok ? { ok: true } : { ok: false, error: transportWords(result.error), caption: null };
}

// `session.applyFlagSettings` with the settings verbatim; a `fastMode` key is remembered until the init frame reports it.
export async function applyFlagSettings(input: { appSessionId: AppSessionId; settings: Record<string, unknown> }): Promise<ControlAnswer> {
  const before = statusOf(input.appSessionId);
  const basis = before ? fastFact(before) : null;
  const result = await ipc.invoke('session.applyFlagSettings', input);
  if (!result.ok) return { ok: false, error: transportWords(result.error), caption: null };
  const after = statusOf(input.appSessionId);
  if ('fastMode' in input.settings && (after ? fastFact(after) : null) === basis) rememberFast(input.appSessionId, { value: (input.settings.fastMode as boolean | null) ?? null, basis });
  return { ok: true };
}

// The accepted model while the status has not moved since (the gap before C3's status event), else nothing.
export const acceptedModel = (requests: ModelRequests, id: AppSessionId, status: EngineSessionStatus): string | null | undefined => {
  const held = requests.model.get(id);
  return held && held.basis === status.model.requested ? held.value : undefined;
};

// Whether fast mode was asked to change and the init frame has not reported the change.
export const fastPending = (requests: ModelRequests, id: AppSessionId, status: EngineSessionStatus): boolean => {
  const held = requests.fast.get(id);
  if (!held || held.basis !== fastFact(status)) return false;
  const on = status.fastMode.state === 'on' || status.fastMode.state === 'cooldown';
  return held.value === true ? !on : on;
};
