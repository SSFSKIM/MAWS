// `/model`, `/effort` and `/fast` (C11 execution document, Interfaces "Model widget, the one with the most rules"; mockup
// 04 vignette 4 and 06 vignette 03): one component opened at its row. The engine's catalogue in a Claude and a Gateway
// group (1M marked, `Cannot hold auto mode` where the entry does not say it can), the model the engine is on checked and
// marked pending until an init frame confirms it, the chosen gateway model's local-lane note when the session is in auto
// mode, the effort levels the chosen entry admits with `Engine default`, one Apply for both, and the fast switch, whose
// lane warning comes first, inline. A live session is C3's (`list_models`, `set_model`, `apply_flag_settings`); an
// unstarted one is its setup intent's through C7's seam (C10 registers the hook; the catalogue and the patch are C10's),
// with no fast switch, since fast mode needs a process, and with the session's route at its top (the architect's ruling
// of 2026-09-29, the D-19 surface on an unstarted tab): `Route · ClaudeUsage relay | Direct` writes the intent's
// `gateway`; under Direct the Gateway group greys, and picking one of its models asks before flipping back to the
// relay. The palette's argument preselects (`/model haiku`, `/effort high`, `/effort auto` for the default) or opens
// the fast confirmation (`/fast on`, `/fast off`).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { PermissionMode } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import { isGatewayModel } from '@shared/sessions/models';
import { SETTINGS_DEFAULTS_V5 } from '@shared/settings/defaults';
import { intentBindings } from '../composer/frame/bindings';
import { useSetupIntent } from '../composer/setup-intent';
import { ROUTE, type Route } from '../gateway/copy';
import { directChoice, pickDirectModel } from '../gateway/direct-model';
import { unstartedRoute } from '../gateway/routing-facts';
import { patchIntent } from '../sessions/setup-actions';
import { useSetup } from '../sessions/store';
import { NOT_RUNNING } from '../statusline/mode-menu';
import { isStarting, rememberListedModels, useComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { useUsage } from '../stores/usage';
import { MODEL, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import {
  acceptedModel,
  applyFlagSettings,
  effortsOf,
  fastPending,
  fastView,
  liveModel,
  presentModels,
  rowNamed,
  rowOf,
  setEffort,
  showsGatewayNote,
  setModel,
  useModelRequests,
  type ControlAnswer,
  type FastView,
  type ModelEntryView,
  type ModelRow,
} from './model';
import { Group, TextButton } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

type Name = 'model' | 'effort' | 'fast';

// What the widget reads and writes, from the live engine or the setup intent.
interface Binding {
  models: readonly ModelRow[];
  current: string | null; // the model the engine is on (or the intent holds)
  pending: boolean; // accepted, not yet confirmed by an init frame
  effort: Effort | null;
  mode: PermissionMode | null;
  disabled: string | null;
  apply(model: string | null | undefined, effort: Effort | null | undefined): Promise<ControlAnswer>;
  fast: { view: FastView; pending: boolean; set(on: boolean): Promise<ControlAnswer> } | null;
  unstarted: boolean;
  // an unstarted session's route (its intent's `gateway`): the segment's options, empty when there is nothing to choose
  // `set` writes the route, with the model and effort it needs, in one intent patch
  route: { value: Route; choices: Route[]; set(patch: { gateway: Route; model?: string | null; effort?: Effort | null }): Promise<ControlAnswer> } | null;
}

function useLiveBinding(appSessionId: AppSessionId, models: readonly ModelRow[]): Binding | null {
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const requests = useModelRequests();
  return useMemo(() => {
    if (!status) return null;
    const live = liveModel(models, status.model);
    const accepted = acceptedModel(requests, appSessionId, status);
    const current = accepted !== undefined ? accepted : live.id;
    const row = rowOf(models, current);
    const confirmed = row !== undefined && (row.value === status.model.resolved || row.resolvedModel === status.model.resolved);
    return {
      models,
      current: row?.value ?? current,
      pending: accepted !== undefined ? !confirmed : live.pending,
      effort: status.effort,
      mode: status.permissionMode.effective,
      disabled: status.process === 'ready' ? null : NOT_RUNNING,
      async apply(model, effort) {
        if (model !== undefined && model !== (row?.value ?? current)) {
          const answer = await setModel({ appSessionId, model });
          if (!answer.ok) return answer;
        }
        if (effort !== undefined && effort !== status.effort) return setEffort({ appSessionId, effort });
        return { ok: true };
      },
      fast: {
        view: fastView(status.fastMode, row),
        pending: fastPending(requests, appSessionId, status),
        set: (on) => applyFlagSettings({ appSessionId, settings: { fastMode: on } }),
      },
      unstarted: false,
      route: null,
    };
  }, [appSessionId, models, status, requests]);
}

// An unstarted session: C7's frame binding over C10's setup intent (the chips write the same intent the same way).
function useIntentBinding(appSessionId: AppSessionId): Binding | null {
  const setup = useSetupIntent(appSessionId);
  const starting = useComposerStore((s) => isStarting(s, appSessionId));
  // C10's intent carries the route C7's hook type does not name; it is read from C10's store and written by its patch
  const gateway = useSetup((s) => s.intents.get(appSessionId)?.gateway ?? null);
  const settings = useSettings((s) => s.state?.settings) ?? SETTINGS_DEFAULTS_V5;
  if (!setup) return null;
  const bound = intentBindings(setup, { starting }).model;
  const { model, effort } = bound.value;
  return {
    models: bound.options,
    current: model,
    pending: false,
    effort,
    mode: setup.intent.permissionMode,
    disabled: bound.disabled,
    async apply(nextModel, nextEffort) {
      const result = await bound.set({ model: nextModel === undefined ? model : nextModel, effort: nextEffort === undefined ? effort : nextEffort });
      return result.ok ? { ok: true } : { ok: false, error: result.error, caption: null };
    },
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
              return result.ok ? { ok: true } : { ok: false, error: result.error, caption: null };
            },
          },
  };
}

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

// `greyed`: shown and choosable, but not what the session's route serves (a gateway model under Direct): choosing it asks.
function ModelRadio({ entry, checked, current, pending, disabled, greyed = false, choose }: { entry: ModelEntryView; checked: boolean; current: boolean; pending: boolean; disabled: boolean; greyed?: boolean; choose(): void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={greyed || undefined}
      disabled={disabled}
      onClick={choose}
      className={`flex w-full flex-col items-start rounded-sm px-2 py-1 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint aria-checked:bg-bg-active ${greyed ? 'text-fg-faint' : ''}`}
    >
      <span className="flex w-full items-baseline gap-2">
        <span>{entry.displayName}</span>
        {entry.oneM && <span className="rounded-sm border border-border px-1 text-ui-sm text-fg-muted">{MODEL.oneM}</span>}
        {current && <span className="ml-auto text-ui-sm text-fg-muted">{pending ? MODEL.pending : MODEL.current}</span>}
      </span>
      {entry.description && <span className="text-ui-sm text-fg-muted">{entry.description}</span>}
      {entry.cannotHoldAuto && <span className="text-ui-sm text-fg-faint">{MODEL.cannotHoldAuto}</span>}
    </button>
  );
}

function Radios({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col">
      {children}
    </div>
  );
}

function ModelBody({ name, args, binding, appSessionId }: { name: Name; args: string; binding: Binding; appSessionId: AppSessionId }) {
  const account = useRoutingAccount(appSessionId);
  const [chosenModel, setChosenModel] = useState<string | undefined>(undefined);
  const [chosenEffort, setChosenEffort] = useState<Effort | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: string; caption: string | null } | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [fastAsk, setFastAsk] = useState<'on' | 'off' | null>(null);
  const [relayAsk, setRelayAsk] = useState<ModelEntryView | null>(null); // a gateway model picked under Direct
  const effortRow = useRef<HTMLDivElement>(null);
  const fastRow = useRef<HTMLDivElement>(null);

  // the palette's argument, taken once the catalogue is known (state adjusted while rendering, as React advises)
  const [argsTaken, setArgsTaken] = useState(false);
  const arg = args.trim();
  if (!argsTaken && binding.models.length > 0) {
    setArgsTaken(true);
    if (arg !== '' && name === 'model') {
      const row = rowNamed(binding.models, arg);
      if (row) setChosenModel(row.value);
      else setUnknown(MODEL.unknownArg(arg));
    } else if (arg !== '' && name === 'effort') {
      const level = arg.toLowerCase();
      if (level === 'auto') setChosenEffort(null); // the terminal's `/effort auto` clears the override
      else if (EFFORT_NAMES.includes(level)) setChosenEffort(level as Effort);
    } else if (arg !== '' && binding.fast && binding.fast.view.disabled === null) {
      if (arg === 'on' && !binding.fast.view.checked) setFastAsk('on');
      if (arg === 'off' && binding.fast.view.checked) setFastAsk('off');
    }
  }
  useEffect(() => {
    (name === 'effort' ? effortRow : name === 'fast' ? fastRow : null)?.current?.scrollIntoView?.({ block: 'nearest' });
  }, [name]);

  const { claude, gateway } = presentModels(binding.models);
  const selected = chosenModel ?? binding.current;
  const selectedRow = rowOf(binding.models, selected);
  const effort = chosenEffort !== undefined ? chosenEffort : binding.effort;
  const changed = (chosenModel !== undefined && chosenModel !== binding.current) || (chosenEffort !== undefined && chosenEffort !== binding.effort);
  const locked = busy || binding.disabled !== null;

  const run = async (write: () => Promise<ControlAnswer>) => {
    setBusy(true);
    setFailure(null);
    try {
      const answer = await write();
      if (!answer.ok) setFailure({ error: answer.error, caption: answer.caption });
    } finally {
      setBusy(false);
    }
  };
  const apply = () =>
    run(async () => {
      const answer = await binding.apply(chosenModel, chosenEffort);
      setChosenModel(undefined); // what shows next is the engine's (or the intent's) answer, never the choice
      setChosenEffort(undefined);
      return answer;
    });
  const setFast = (on: boolean) => {
    setFastAsk(null);
    if (binding.fast) void run(() => binding.fast!.set(on));
  };

  const route = binding.route;
  const direct = route?.value === 'direct';
  // Direct never saves the route alone while the model the session would start on is a relay alias (the direct route
  // cannot serve one), as the switch sheet and the relay card's Run direct ask first: a pending Claude choice is the
  // pick and goes with the route in one patch; otherwise pickDirectModel asks, and its cancel changes nothing. On an
  // intent already holding a Claude model Direct is the route alone, and a choice not yet applied stays pending.
  const written = (answer: ControlAnswer) => {
    if (answer.ok) {
      setChosenModel(undefined);
      setChosenEffort(undefined);
    }
    return answer;
  };
  const onRelayAlias = binding.current !== null && isGatewayModel(binding.current);
  const goDirect = async () => {
    if (onRelayAlias && chosenModel !== undefined && chosenModel !== null && !isGatewayModel(chosenModel) && selectedRow) {
      const lowered = directChoice(selectedRow, effort).effort;
      const chosen = lowered ?? (chosenEffort !== undefined ? chosenEffort : undefined);
      await run(async () => written(await route!.set({ gateway: 'direct', model: chosenModel, ...(chosen !== undefined && { effort: chosen }) })));
      return;
    }
    if (selected !== null && isGatewayModel(selected)) {
      const pick = await pickDirectModel(appSessionId);
      if (pick === null) return;
      await run(async () => written(await route!.set({ gateway: 'direct', model: pick.model, ...(pick.effort !== null && { effort: pick.effort }) })));
      return;
    }
    await run(() => route!.set({ gateway: 'direct' }));
  };
  const setRoute = (next: Route) => void (next === 'direct' ? goDirect() : run(() => route!.set({ gateway: next })));
  const startOnRelay = (entry: ModelEntryView) => {
    setRelayAsk(null);
    void run(async () => {
      const answer = await route!.set({ gateway: 'gateway' });
      if (answer.ok) setChosenModel(entry.value);
      return answer;
    });
  };

  const group = (label: string, entries: ModelEntryView[], greyed = false) =>
    entries.length > 0 && (
      <Group label={label} count={entries.length}>
        {greyed && <p className="m-0 mb-1 text-ui-sm text-fg-muted">{MODEL.directCannotServe}</p>}
        <Radios label={MODEL.list(label)}>
          {entries.map((entry) => (
            <ModelRadio
              key={entry.value}
              entry={entry}
              checked={entry.value === selected}
              current={entry.value === binding.current}
              pending={binding.pending}
              disabled={locked}
              greyed={greyed}
              choose={() => (greyed ? setRelayAsk(entry) : setChosenModel(entry.value))}
            />
          ))}
        </Radios>
        {greyed && relayAsk && (
          <div role="group" aria-label={MODEL.relayAskTitle} className="mt-1 flex flex-col gap-1 border-l-2 border-warning pl-2 text-ui-sm">
            <p className="m-0">{MODEL.relayAsk(relayAsk.displayName)}</p>
            <span className="flex gap-2">
              <TextButton onClick={() => setRelayAsk(null)}>{MODEL.keepDirect}</TextButton>
              <TextButton onClick={() => startOnRelay(relayAsk)}>{MODEL.useRelay}</TextButton>
            </span>
          </div>
        )}
      </Group>
    );

  return (
    <div className="flex flex-col gap-2">
      {route && route.choices.length > 0 && (
        <Group label={MODEL.route}>
          <Radios label={MODEL.route}>
            <div className="flex flex-wrap gap-1">
              {route.choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={choice === route.value}
                  disabled={locked}
                  onClick={() => choice !== route.value && setRoute(choice)}
                  className="rounded-sm border border-border px-2 py-0.5 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint aria-checked:bg-bg-active"
                >
                  {ROUTE.choice[choice]}
                </button>
              ))}
            </div>
          </Radios>
        </Group>
      )}
      {binding.models.length === 0 && <p className="m-0 text-ui-sm text-fg-muted">{MODEL.none}</p>}
      {unknown && <p className="m-0 text-ui-sm text-warning">{unknown}</p>}
      {group(MODEL.group.claude, claude)}
      {group(MODEL.group.gateway, gateway, direct)}
      {selected !== null && showsGatewayNote(selected, binding.mode) && (
        <p role="note" className="m-0 border-l-2 border-info pl-2 text-ui-sm">
          <strong className="font-semibold">{MODEL.gatewayNote.lead}</strong> {MODEL.gatewayNote.body(account)}
        </p>
      )}
      <div ref={effortRow}>
        <Group label={MODEL.effort}>
          <Radios label={MODEL.effortList}>
            <div className="flex flex-wrap gap-1">
              {[...effortsOf(selectedRow), null].map((level) => (
                <button
                  key={level ?? 'default'}
                  type="button"
                  role="radio"
                  aria-checked={level === effort}
                  disabled={locked}
                  onClick={() => setChosenEffort(level)}
                  className="rounded-sm border border-border px-2 py-0.5 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint aria-checked:bg-bg-active"
                >
                  {level ?? MODEL.engineDefault}
                </button>
              ))}
            </div>
          </Radios>
        </Group>
      </div>
      <div className="flex items-baseline gap-2">
        <button type="button" disabled={!changed || locked} onClick={() => void apply()} className="rounded-sm bg-accent px-2 py-0.5 text-ui-sm text-bg outline-accent focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint">
          {MODEL.apply}
        </button>
        {binding.unstarted && <span className="text-ui-sm text-fg-muted">{MODEL.unstarted}</span>}
        {binding.disabled && <span className="text-ui-sm text-fg-muted">{binding.disabled}</span>}
      </div>
      {binding.fast && (
        <div ref={fastRow}>
          <Group label={MODEL.fast}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={binding.fast.view.checked}
                aria-label={MODEL.fast}
                disabled={locked || binding.fast.view.disabled !== null}
                onClick={() => (binding.fast!.view.checked ? setFast(false) : setFastAsk('on'))}
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-border outline-accent focus-visible:outline-2 disabled:opacity-50 ${binding.fast.view.checked ? 'bg-accent' : 'bg-bg-active'}`}
              >
                <span aria-hidden className={`absolute size-3 rounded-full bg-bg-raised ${binding.fast.view.checked ? 'right-0.5' : 'left-0.5'}`} />
              </button>
              <span className="text-ui-sm text-fg-muted">{binding.fast.view.disabled ?? (binding.fast.pending ? MODEL.pending : binding.fast.view.caption)}</span>
            </div>
            {fastAsk === 'on' && (
              <div className="mt-1 flex flex-col gap-1 border-l-2 border-warning pl-2 text-ui-sm">
                <p className="m-0">{MODEL.fastWarning}</p>
                <span className="flex gap-2">
                  <TextButton onClick={() => setFastAsk(null)}>{binding.mode === 'auto' ? MODEL.keepAuto : MODEL.cancel}</TextButton>
                  <TextButton onClick={() => setFast(true)}>{MODEL.turnOn}</TextButton>
                </span>
              </div>
            )}
            {fastAsk === 'off' && (
              <span className="mt-1 flex gap-2 text-ui-sm">
                <TextButton onClick={() => setFastAsk(null)}>{MODEL.cancel}</TextButton>
                <TextButton onClick={() => setFast(false)}>{MODEL.turnOff}</TextButton>
              </span>
            )}
          </Group>
        </div>
      )}
      {failure && (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {failure.error}
          {failure.caption && <span className="block text-fg-muted">{failure.caption}</span>}
        </p>
      )}
    </div>
  );
}

function ModelWidget({ name, appSessionId, args, close }: { name: Name; appSessionId: AppSessionId; args: string; close(): void }) {
  const intent = useIntentBinding(appSessionId);
  const read = useEngineRead('session.listModels', { appSessionId });
  const listed = read.data?.models;
  useEffect(() => {
    if (listed) rememberListedModels(appSessionId, listed); // the composer's model chip names its model from these
  }, [appSessionId, listed]);
  const live = useLiveBinding(appSessionId, listed ?? []);
  const binding = intent ?? live;
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE[name]} command={name} foot={WIDGET_FOOT[name]} state={intent ? 'ready' : read.state} error={intent ? null : read.error} close={close}>
      {binding && (intent || read.data) && <ModelBody name={name} args={args} binding={binding} appSessionId={appSessionId} />}
    </WidgetFrame>
  );
}

// The three palette names, one component opened at its row.
export function modelWidget(name: Name) {
  return function NamedModelWidget(props: { appSessionId: AppSessionId; args: string; close(): void }) {
    return <ModelWidget name={name} {...props} />;
  };
}
