// `/model`, `/effort` and `/fast` as Codex's model selector (W3, charter §5.4 as amended 2026-10-01; r1-codex §5, shots
// 05 and 06), replacing C11's inline model widget: one 254px menu the composer's model chip anchors above itself (the
// `modelChip` placement), with two views on a sliding track. The effort view names the effort in the accent colour over
// the model's name (a row with a chevron into the model view), a stepped slider over the levels the engine lists for
// that model, Codex's lightning for fast mode (its auto-lane warning first, inline) and a reset that clears the effort
// override. The model view reads "Select model": a Default entry (Recommended set of models, no badge), then the catalogue with the current
// row checked, gateway aliases with their "From gateway" description. A choice applies at once and returns to the
// effort view; the engine's answer (C3's status, the next init frame) is what shows afterwards. A live session is C3's
// (`list_models`, `set_model`, `apply_flag_settings`), always for this session only; an unstarted one writes its setup
// intent through C7's seam and keeps D-19's Route segment at the top of the model view. The palette's argument proposes
// (`/model haiku`), sets the view (`/effort`), or opens the fast warning (`/fast on`).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Effort } from '@shared/engine/launch-spec';
import { EffortSchema } from '@shared/engine/launch-spec';
import type { PermissionMode } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import { isGatewayModel } from '@shared/sessions/models';
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';
import { useShownEffort } from '../composer/effective-effort';
import { intentBindings } from '../composer/frame/bindings';
import { aliasOf, DEFAULT_ROW, EFFORT_WORDS, rowFor } from '@shared/sessions/model-label';
import { useSetupIntent } from '../composer/setup-intent';
import { ROUTE, type Route } from '../gateway/copy';
import { pickDirectModel } from '../gateway/direct-model';
import { unstartedRoute } from '../gateway/routing-facts';
import { useCommand } from '../ipc/query';
import { patchIntent } from '../sessions/setup-actions';
import { useSetup } from '../sessions/store';
import { acquireSession, refusalWords } from '../sessions/acquire'; // P2-A
import { availabilityRefusal, useAvailability } from '../sessions/availability'; // P2-A
import { FRESHNESS, useObservedFacts } from '../sessions/observed'; // P2-A
import { NOT_YET } from '../composer/submit/submit-state'; // P2-A
import { routeOf, useModelCatalogue } from '../composer/list-models'; // P2-A
import { isStarting, listedModelsOf, rememberListedModels, useComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { useUsage } from '../stores/usage';
import { FRAME, MODEL, SELECTOR } from './copy';
import {
  acceptedModel,
  applyFlagSettings,
  effortLevelsOf,
  fastPending,
  fastView,
  presentModels,
  rowNamed,
  rowOf,
  setEffort,
  setModel,
  showsGatewayNote,
  useModelRequests,
  type ControlAnswer,
  type FastView,
  type ModelEntryView,
  type ModelRow,
} from './model';
import { useEngineRead } from './read';

type Name = 'model' | 'effort' | 'fast';
type View = 'effort' | 'model';

// What the selector reads and writes, from the live engine or the setup intent.
interface Binding {
  models: readonly ModelRow[];
  current: string | null; // the row the session asked for; null: its default
  shown: string | null; // the model id the session runs, or will start on (what the effort view names)
  pending: boolean; // a set_model accepted, not yet confirmed by an init frame
  effort: Effort | null; // the effort it runs at (or will start at)
  overridden: boolean; // an effort is set explicitly, so Reset has something to clear
  mode: PermissionMode | null;
  disabled: string | null;
  setModel(model: string | null): Promise<ControlAnswer>;
  setEffort(effort: Effort | null): Promise<ControlAnswer>;
  fast: { view: FastView; pending: boolean; set(on: boolean): Promise<ControlAnswer> } | null;
  unstarted: boolean;
  route: { value: Route; choices: Route[]; set(patch: { gateway: Route; model?: string | null; effort?: Effort | null }): Promise<ControlAnswer> } | null;
  observed?: { model: string; at: string } | null; // P2-A: a dormant session's model as the engine last reported it
}

const ok: ControlAnswer = { ok: true };

function useLiveBinding(appSessionId: AppSessionId, models: readonly ModelRow[]): Binding | null {
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const requests = useModelRequests();
  const effort = useShownEffort(appSessionId);
  return useMemo(() => {
    if (!status) return null;
    const accepted = acceptedModel(requests, appSessionId, status);
    const asked = accepted !== undefined ? accepted : status.model.requested;
    const row = rowOf(models, asked);
    const confirmed = asked === null || status.model.resolved === null || (row !== undefined && (row.value === status.model.resolved || row.resolvedModel === status.model.resolved));
    const pending = accepted !== undefined ? accepted !== null && !confirmed : !confirmed;
    const shownRow = pending ? row : (rowOf(models, status.model.resolved) ?? row); // fast mode follows the model asked for
    return {
      models,
      current: asked === null ? null : (row?.value ?? asked),
      shown: pending ? asked : (status.model.resolved ?? asked), // a model asked for and not confirmed yet is the one named, marked pending
      pending,
      effort,
      overridden: status.effort !== null,
      mode: status.permissionMode.effective,
      disabled: null, // P2-A: bound only over a ready process (a dormant one has its own binding)
      setModel: (model) => (model === asked || (model !== null && model === row?.value) ? Promise.resolve(ok) : setModel({ appSessionId, model })),
      setEffort: (next) => (next === status.effort ? Promise.resolve(ok) : setEffort({ appSessionId, effort: next })),
      fast: {
        view: fastView(status.fastMode, shownRow),
        pending: fastPending(requests, appSessionId, status),
        set: (on) => applyFlagSettings({ appSessionId, settings: { fastMode: on } }),
      },
      unstarted: false,
      route: null,
    };
  }, [appSessionId, models, status, requests, effort]);
}

// An unstarted session: C7's frame binding over C10's setup intent (the chip writes the same intent the same way), the
// user's own settings naming what the session's default runs.
function useIntentBinding(appSessionId: AppSessionId): Binding | null {
  const setup = useSetupIntent(appSessionId);
  const starting = useComposerStore((s) => isStarting(s, appSessionId));
  // C10's intent carries the route C7's hook type does not name; it is read from C10's store and written by its patch
  const gateway = useSetup((s) => s.intents.get(appSessionId)?.gateway ?? null);
  const settings = useSettings((s) => s.state?.settings) ?? SETTINGS_DEFAULTS_V11;
  const defaults = useCommand('settings.userEngineDefaults', undefined, { enabled: setup !== null, staleTime: 30_000 }).data ?? null;
  if (!setup) return null;
  const bound = intentBindings(setup, { starting }, defaults).model;
  const { model, effort } = bound.value;
  const write = async (next: { model: string | null; effort: Effort | null }): Promise<ControlAnswer> => {
    const result = await bound.set(next);
    return result.ok ? ok : { ok: false, error: result.error, caption: null };
  };
  return {
    models: bound.options,
    current: model,
    shown: model ?? defaults?.model ?? DEFAULT_ROW,
    pending: false,
    effort: effort ?? defaults?.effortLevel ?? null,
    overridden: effort !== null,
    mode: setup.intent.permissionMode,
    disabled: bound.disabled,
    // a model that does not admit the effort the intent holds takes none (the engine's own default for it)
    setModel: (next) => {
      const levels = effortLevelsOf(rowOf(bound.options, next ?? DEFAULT_ROW) ?? rowFor(bound.options, next ?? DEFAULT_ROW));
      return write({ model: next, effort: effort !== null && !levels.includes(effort) ? null : effort });
    },
    setEffort: (next) => write({ model, effort: next }),
    fast: null,
    unstarted: true,
    route:
      gateway === null
        ? null
        : {
            value: gateway,
            choices: unstartedRoute({ gateway }, settings).choices,
            async set(patch) {
              const result = await patchIntent(appSessionId, patch);
              return result.ok ? ok : { ok: false, error: result.error, caption: null };
            },
          },
  };
}

// P2-A start (2026-10-09; the execution document §5.6): a session with a record and no ready process. The options are
// the route's catalogue and the models the engine last listed for it; the row checked is the record's requested model,
// with the model the engine last ran named beside it. A choice is marked pending, starts the session (`chip`), then
// applies as a live session's does; the live binding's pending-until-confirmed takes over once the status is ready. An
// attempt that does not end ready clears the mark and says why. Fast mode and the route need the live status: hidden.
type DormantChoice = { model: string | null } | { effort: Effort | null };
function useDormantBinding(appSessionId: AppSessionId): (Binding & { choosing: boolean }) | null {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const availability = useAvailability(appSessionId);
  const listed = useComposerStore((s) => listedModelsOf(s, appSessionId));
  const catalogue = useModelCatalogue(routeOf(status, record), false, record?.directory ?? null);
  const { facts } = useObservedFacts(appSessionId, { enabled: record !== null && status?.process !== 'ready' });
  const [choice, setChoice] = useState<DormantChoice | null>(null);
  if (!record) return null;
  const models: readonly ModelRow[] = listed && listed.length > 0 ? listed : (catalogue ?? []);
  const asked = choice && 'model' in choice ? choice.model : record.model.requested;
  const effort = choice && 'effort' in choice ? choice.effort : (EffortSchema.safeParse(record.effort).data ?? null);
  const observed = facts?.model ?? null;
  const apply = async (next: DormantChoice, write: () => Promise<ControlAnswer>): Promise<ControlAnswer> => {
    setChoice(next);
    try {
      const outcome = await acquireSession(appSessionId, 'chip');
      if (outcome.status !== 'ready') return { ok: false, error: refusalWords(outcome) ?? outcome.status, caption: null };
      return await write();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), caption: null };
    } finally {
      setChoice(null);
    }
  };
  return {
    models,
    current: asked === null ? null : (rowOf(models, asked)?.value ?? asked),
    shown: asked ?? observed?.value ?? record.model.resolved,
    pending: choice !== null && 'model' in choice,
    effort,
    overridden: effort !== null,
    mode: record.permissionMode.effective,
    disabled: availabilityRefusal(availability, record.holder),
    setModel: (model) => apply({ model }, () => setModel({ appSessionId, model })),
    setEffort: (next) => apply({ effort: next }, () => setEffort({ appSessionId, effort: next })),
    fast: null,
    unstarted: false,
    route: null,
    observed: observed ? { model: observed.value, at: observed.at } : null,
    choosing: choice !== null,
  };
}
// P2-A end

// The account the gateway note names: the session's pinned account, else the relay's routing account.
function useRoutingAccount(appSessionId: AppSessionId): string {
  const engineSessionId = useSessions((s) => s.engine.get(appSessionId)?.engineSessionId ?? s.records.get(appSessionId)?.engineSessionId ?? null);
  return useUsage((s) => {
    const snapshot = s.snapshot?.available ? s.snapshot : null;
    const uuid = (engineSessionId === null ? undefined : s.pinsFor[engineSessionId]) ?? snapshot?.drainTarget;
    return snapshot?.accounts.find((a) => a.uuid === uuid)?.email ?? MODEL.routingAccount;
  });
}

const EFFORT_NAMES: readonly string[] = EffortSchema.options;
const ICON_BUTTON = 'flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';
const ROW = 'flex w-full min-w-0 cursor-default items-start gap-2 rounded-md px-2 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

// The stepped slider over the levels the model admits (Claude Desktop's "Faster … Smarter"); the arrows, Home and End
// move it, a click on a stop picks that level. Nothing on it while the effort is unknown.
function EffortSlider({ levels, value, disabled, onChange }: { levels: readonly Effort[]; value: Effort | null; disabled: boolean; onChange(level: Effort): void }) {
  const at = value === null ? -1 : levels.indexOf(value);
  const step = (to: number) => {
    const next = levels[Math.max(0, Math.min(levels.length - 1, to))];
    if (next !== undefined && next !== value && !disabled) onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: at - 1, ArrowDown: at - 1, ArrowRight: at + 1, ArrowUp: at + 1, Home: 0, End: levels.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    step(at === -1 && (event.key === 'ArrowLeft' || event.key === 'ArrowDown') ? 0 : moves[event.key]);
  };
  const percent = (i: number) => (levels.length === 1 ? 50 : (i / (levels.length - 1)) * 100);
  return (
    <div className="flex flex-col gap-1 px-4 pb-1">
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={SELECTOR.effort}
        aria-valuemin={0}
        aria-valuemax={levels.length - 1}
        aria-valuenow={at === -1 ? undefined : at}
        aria-valuetext={at === -1 ? SELECTOR.effortUnknown : SELECTOR.position(EFFORT_WORDS[levels[at]], at + 1, levels.length)}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="relative h-6 rounded-sm outline-accent focus-visible:outline-2"
      >
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-bg-active" />
        {at > 0 && <span aria-hidden className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${percent(at)}%` }} />}
        {levels.map((level, i) => (
          <span
            key={level}
            data-level={level}
            title={EFFORT_WORDS[level]}
            onClick={() => step(i)}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${i === at ? 'size-3.5 bg-accent ring-2 ring-bg-overlay' : `size-1.5 ${i < at ? 'bg-accent' : 'bg-fg-faint'}`} ${disabled ? '' : 'cursor-pointer'}`}
            style={{ left: `${percent(i)}%` }}
          />
        ))}
      </div>
      <div aria-hidden className="flex justify-between text-ui-sm text-fg-faint">
        <span>{SELECTOR.faster}</span>
        <span>{SELECTOR.smarter}</span>
      </div>
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`mt-0.5 w-3 shrink-0 text-accent ${on ? '' : 'invisible'}`}>
      ✓
    </span>
  );
}

// One menu item of the model list.
function ModelItem({ entry, checked, proposed, pending, locked, greyed, choose }: { entry: ModelEntryView; checked: boolean; proposed: boolean; pending: boolean; locked: boolean; greyed: boolean; choose(): void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} data-proposed={proposed || undefined} disabled={locked} onClick={choose} className={`${ROW} ${greyed ? 'text-fg-faint' : ''} ${proposed ? 'bg-bg-active' : ''}`}>
      <Check on={checked} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{entry.displayName}</span>
          {entry.oneM && <span className="shrink-0 rounded-sm border border-border px-1 text-ui-sm text-fg-muted">{MODEL.oneM}</span>}
          {checked && pending && <span className="ml-auto shrink-0 text-ui-sm text-fg-muted">{SELECTOR.setting}</span>}
        </span>
        {entry.description && <span className="truncate text-ui-sm text-fg-muted">{entry.description}</span>}
        {entry.cannotHoldAuto && <span className="text-ui-sm text-fg-faint">{MODEL.cannotHoldAuto}</span>}
      </span>
    </button>
  );
}

// The two views on one track: the inactive one is inert and out of the accessibility tree, and the frame's height
// follows the active one (Codex's 0.32 s track).
function Track({ view, effort, model }: { view: View; effort: ReactNode; model: ReactNode }) {
  // each ref its own statement: the React compiler memoizes an object literal, hook calls inside it included
  const effortPanel = useRef<HTMLDivElement>(null);
  const modelPanel = useRef<HTMLDivElement>(null);
  const panels = { effort: effortPanel, model: modelPanel };
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const panel = panels[view].current;
    if (!panel) return;
    const measure = () => setHeight(panel.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  });
  const panel = (name: View, children: ReactNode) => (
    <div ref={panels[name]} data-view={name} inert={view !== name} aria-hidden={view !== name || undefined} className="w-[254px] shrink-0 self-start">
      {children}
    </div>
  );
  return (
    <div className="overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none" style={height === null ? undefined : { height }}>
      <div className={`flex w-[508px] transition-transform duration-300 ease-out motion-reduce:transition-none ${view === 'model' ? '-translate-x-[254px]' : ''}`}>
        {panel('effort', effort)}
        {panel('model', model)}
      </div>
    </div>
  );
}

function SelectorBody({ name, args, binding, state, error, appSessionId }: { name: Name; args: string; binding: Binding; state: string; error: string | null; appSessionId: AppSessionId }) {
  const account = useRoutingAccount(appSessionId);
  const [view, setView] = useState<View>(name === 'model' ? 'model' : 'effort');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: string; caption: string | null } | null>(null);
  const [fastAsk, setFastAsk] = useState<'on' | null>(null);
  const [relayAsk, setRelayAsk] = useState<ModelEntryView | null>(null); // a gateway model picked under Direct
  const [proposed, setProposed] = useState<string | null>(null); // `/model <name>` that the typed path left for a look first
  const [unknown, setUnknown] = useState<string | null>(null);

  // the palette's argument, taken once the catalogue is known (state adjusted while rendering, as React advises)
  const [argsTaken, setArgsTaken] = useState(false);
  const arg = args.trim();
  if (!argsTaken && binding.models.length > 0) {
    setArgsTaken(true);
    if (arg !== '' && name === 'model') {
      const row = rowNamed(binding.models, arg);
      if (row) setProposed(row.value);
      else setUnknown(MODEL.unknownArg(arg));
    } else if (arg !== '' && name === 'effort' && !EFFORT_NAMES.includes(arg.toLowerCase()) && !['auto', 'default'].includes(arg.toLowerCase())) setUnknown(SELECTOR.unknownEffort(arg));
    else if (name === 'fast' && arg.toLowerCase() === 'on' && binding.fast && binding.fast.view.disabled === null && !binding.fast.view.checked) setFastAsk('on');
  }

  const locked = busy || binding.disabled !== null;
  const run = async (write: () => Promise<ControlAnswer>): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      const answer = await write();
      if (!answer.ok) setFailure({ error: answer.error, caption: answer.caption });
      return answer.ok;
    } finally {
      setBusy(false);
    }
  };

  const { claude, gateway } = presentModels(binding.models.filter((m) => m.value !== DEFAULT_ROW));
  const shownRow = rowFor(binding.models, binding.shown) ?? rowOf(binding.models, binding.shown);
  const levels = effortLevelsOf(shownRow);
  const modelName = shownRow?.displayName ?? aliasOf(binding.shown, binding.models) ?? SELECTOR.model;

  const choose = async (model: string | null) => {
    setProposed(null);
    if (await run(() => binding.setModel(model))) setView('effort'); // Codex: a choice returns to the effort view
  };
  const setFast = (on: boolean) => {
    setFastAsk(null);
    if (binding.fast) void run(() => binding.fast!.set(on));
  };

  // D-19 on an unstarted tab: Direct never holds a relay alias, so a gateway model asks for a Claude model first
  const route = binding.route;
  const direct = route?.value === 'direct';
  const goDirect = async () => {
    if (binding.current !== null && isGatewayModel(binding.current)) {
      const pick = await pickDirectModel(appSessionId);
      if (pick === null) return;
      await run(() => route!.set({ gateway: 'direct', model: pick.model, ...(pick.effort !== null && { effort: pick.effort }) }));
      return;
    }
    await run(() => route!.set({ gateway: 'direct' }));
  };
  const setRoute = (next: Route) => void (next === 'direct' ? goDirect() : run(() => route!.set({ gateway: next })));
  const startOnRelay = (entry: ModelEntryView) => {
    setRelayAsk(null);
    void run(async () => {
      const answer = await route!.set({ gateway: 'gateway', model: entry.value });
      if (answer.ok) setView('effort');
      return answer;
    });
  };

  const noteFor = binding.shown !== null && showsGatewayNote(proposed ?? binding.current ?? binding.shown, binding.mode);
  const gatewayNote = noteFor && (
    <p role="note" className="m-0 border-l-2 border-info px-2 text-ui-sm">
      <strong className="font-semibold">{MODEL.gatewayNote.lead}</strong> {MODEL.gatewayNote.body(account)}
    </p>
  );
  const alert = failure && (
    <p role="alert" className="m-0 px-2 text-ui-sm text-danger">
      {failure.error}
      {failure.caption && <span className="block text-fg-muted">{failure.caption}</span>}
    </p>
  );
  // P2-A: a dormant session's selector reads nothing of the engine (its options are the catalogue's); it says only why a
  // choice cannot start it
  const status = state === 'unavailable' ? error : state === 'starting' ? FRAME.starting : state === 'loading' ? SELECTOR.reading : state === 'error' ? error : null;
  const observedName = binding.observed ? (rowFor(binding.models, binding.observed.model)?.displayName ?? binding.observed.model) : null;

  const effortView = (
    <div role="group" aria-label={SELECTOR.effortView} className="flex flex-col gap-2 p-1.5">
      <div className="flex min-h-9 items-center gap-1">
        {binding.fast ? (
          <button
            type="button"
            role="switch"
            aria-checked={binding.fast.view.checked}
            aria-label={MODEL.fast}
            title={binding.fast.view.disabled ?? MODEL.fast}
            disabled={locked || binding.fast.view.disabled !== null}
            onClick={() => (binding.fast!.view.checked ? setFast(false) : setFastAsk('on'))}
            className={`${ICON_BUTTON} ${binding.fast.view.checked ? 'text-accent' : ''}`}
          >
            <span aria-hidden>⚡</span>
          </button>
        ) : (
          <span className="size-8 shrink-0" />
        )}
        <button type="button" aria-label={SELECTOR.openModels(modelName)} onClick={() => setView('model')} className="flex min-w-0 flex-1 flex-col items-center rounded-md px-1 py-0.5 outline-accent hover:bg-bg-hover focus-visible:outline-2">
          <span data-effort-title className={`text-ui font-medium ${binding.effort ? 'text-accent' : 'text-fg-muted'}`}>
            {levels.length === 0 ? SELECTOR.noEffort : binding.effort ? EFFORT_WORDS[binding.effort] : SELECTOR.effort}
          </span>
          <span className="flex max-w-full min-w-0 items-center gap-0.5 text-ui-sm text-fg-muted">
            <span className="truncate">{modelName}</span>
            <span aria-hidden>›</span>
          </span>
        </button>
        <button type="button" aria-label={SELECTOR.reset} title={SELECTOR.reset} disabled={locked || !binding.overridden} onClick={() => void run(() => binding.setEffort(null))} className={ICON_BUTTON}>
          <span aria-hidden>↺</span>
        </button>
      </div>
      {levels.length > 0 && <EffortSlider levels={levels} value={binding.effort !== null && levels.includes(binding.effort) ? binding.effort : null} disabled={locked} onChange={(level) => void run(() => binding.setEffort(level))} />}
      {unknown && view === 'effort' && <p className="m-0 px-2 text-ui-sm text-warning">{unknown}</p>}
      {binding.fast && fastAsk === 'on' && (
        <div role="group" aria-label={MODEL.fast} className="flex flex-col gap-1 border-l-2 border-warning px-2 text-ui-sm">
          <p className="m-0">{MODEL.fastWarning}</p>
          <span className="flex gap-2">
            <button type="button" className="text-fg-muted underline-offset-2 hover:underline" onClick={() => setFastAsk(null)}>
              {binding.mode === 'auto' ? MODEL.keepAuto : MODEL.cancel}
            </button>
            <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setFast(true)}>
              {MODEL.turnOn}
            </button>
          </span>
        </div>
      )}
      {binding.fast && (binding.fast.pending || binding.fast.view.caption) && (
        <p className="m-0 px-2 text-ui-sm text-fg-muted">
          {MODEL.fast} · {binding.fast.pending ? MODEL.pending : binding.fast.view.caption}
        </p>
      )}
      {binding.pending && <p className="m-0 px-2 text-ui-sm text-fg-muted">{MODEL.pending}</p>}
      {binding.observed && observedName && !binding.pending && (
        <p data-model-observed className="m-0 px-2 text-ui-sm text-fg-muted">
          {observedName} · {FRESHNESS.lastObserved(binding.observed.at)}
        </p>
      )}
      {view === 'effort' && gatewayNote}
      {status && <p className="m-0 px-2 text-ui-sm text-fg-muted">{status}</p>}
      {view === 'effort' && alert}
    </div>
  );

  const greyedGroup = (label: string, entries: ModelEntryView[], greyed: boolean) =>
    entries.length > 0 && (
      <div role="group" aria-label={MODEL.list(label)} className="flex flex-col border-t border-border pt-1">
        {greyed && <p className="m-0 px-2 pb-1 text-ui-sm text-fg-muted">{MODEL.directCannotServe}</p>}
        {entries.map((entry) => (
          <ModelItem
            key={entry.value}
            entry={entry}
            checked={binding.current !== null && entry.value === binding.current}
            proposed={entry.value === proposed}
            pending={binding.pending}
            locked={locked}
            greyed={greyed}
            choose={() => (greyed ? setRelayAsk(entry) : void choose(entry.value))}
          />
        ))}
        {greyed && relayAsk && (
          <div role="group" aria-label={MODEL.relayAskTitle} className="mx-2 my-1 flex flex-col gap-1 border-l-2 border-warning pl-2 text-ui-sm">
            <p className="m-0">{MODEL.relayAsk(relayAsk.displayName)}</p>
            <span className="flex gap-2">
              <button type="button" className="text-fg-muted underline-offset-2 hover:underline" onClick={() => setRelayAsk(null)}>
                {MODEL.keepDirect}
              </button>
              <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => startOnRelay(relayAsk)}>
                {MODEL.useRelay}
              </button>
            </span>
          </div>
        )}
      </div>
    );

  const modelView = (
    <div role="group" aria-label={SELECTOR.modelView} className="flex flex-col gap-1 p-1.5">
      <div className="flex min-h-8 items-center gap-1">
        <button type="button" aria-label={SELECTOR.back} onClick={() => setView('effort')} className={ICON_BUTTON}>
          <span aria-hidden>‹</span>
        </button>
        <h3 className="m-0 text-ui font-medium">{SELECTOR.selectModel}</h3>
      </div>
      {route && route.choices.length > 1 && (
        <div role="radiogroup" aria-label={MODEL.route} className="flex gap-1 px-2 pb-1">
          {route.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={choice === route.value}
              disabled={locked}
              onClick={() => choice !== route.value && setRoute(choice)}
              className="flex-1 rounded-sm border border-border px-2 py-0.5 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint aria-checked:bg-bg-active"
            >
              {ROUTE.choice[choice]}
            </button>
          ))}
        </div>
      )}
      {unknown && view === 'model' && <p className="m-0 px-2 text-ui-sm text-warning">{unknown}</p>}
      <div role="menu" aria-label={SELECTOR.models} className="flex max-h-[min(316px,50vh)] flex-col overflow-y-auto">
        <button type="button" role="menuitemradio" aria-checked={binding.current === null} disabled={locked} onClick={() => void choose(null)} className={ROW}>
          <Check on={binding.current === null} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{SELECTOR.default}</span>
            <span className="text-ui-sm text-fg-muted">{SELECTOR.recommended}</span>
          </span>
        </button>
        {binding.models.length === 0 && status === null && <p className="m-0 px-2 py-1 text-ui-sm text-fg-muted">{MODEL.none}</p>}
        {greyedGroup(MODEL.group.claude, claude, false)}
        {greyedGroup(MODEL.group.gateway, gateway, direct)}
      </div>
      {view === 'model' && gatewayNote}
      {view === 'model' && alert}
      <p className="m-0 px-2 pt-0.5 text-ui-sm text-fg-faint">{binding.unstarted ? MODEL.unstarted : SELECTOR.sessionOnly}</p>
    </div>
  );

  // Esc closes the whole menu (the chip's popover), as Codex's does
  return (
    <div data-widget={name} data-model-selector={view} className="w-[254px] text-ui">
      <Track view={view} effort={effortView} model={modelView} />
    </div>
  );
}

// `close` is the chip's: the menu stays open through a choice (Codex returns to the effort view) and closes on Esc or outside.
function ModelSelector({ name, appSessionId, args }: { name: Name; appSessionId: AppSessionId; args: string; close(): void }) {
  const intent = useIntentBinding(appSessionId);
  const read = useEngineRead('session.listModels', { appSessionId }, { enabled: intent === null });
  const listed = read.data?.models;
  useEffect(() => {
    if (listed) rememberListedModels(appSessionId, listed); // the composer's model chip names its model from these
  }, [appSessionId, listed]);
  const live = useLiveBinding(appSessionId, listed ?? []);
  // P2-A: a record with no ready process binds to its record; a choice in flight keeps that binding (and its pending
  // mark) until it has applied, then the live binding takes over
  const dormant = useDormantBinding(appSessionId);
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const binding = intent ?? (dormant && (!ready || dormant.choosing) ? dormant : ready ? live : null);
  if (!binding) return <p className="m-0 w-[254px] p-3 text-ui-sm text-fg-muted">{NOT_YET}</p>;
  const state = intent ? 'ready' : binding === dormant ? (read.state === 'unavailable' || read.state === 'starting' ? read.state : 'ready') : read.state;
  return <SelectorBody name={name} args={args} binding={binding} state={state} error={intent ? null : read.error} appSessionId={appSessionId} />;
}

// The three palette names, one selector opened at its view.
export function modelSelector(name: Name) {
  return function NamedModelSelector(props: { appSessionId: AppSessionId; args: string; close(): void }) {
    return <ModelSelector name={name} {...props} />;
  };
}
