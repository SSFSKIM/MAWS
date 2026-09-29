import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ListModelsResponse } from '@shared/wire/control';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, fixtureLine, RESPONSES, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { registerSetupIntentHook, type SetupIntentHook } from '../composer';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { acceptedModel, effortsOf, fastView, liveModel, presentModels, resetModelRequests, setModel, useModelRequests } from './model';
import { modelWidget } from './ModelWidget';
import { GatewayDialogs } from '../gateway/SwitchSheet';
import { useSetup } from '../sessions/store';
import { useSetupIntent as useC10SetupIntent } from '../sessions/useSetupIntent';
import { ID as INTENT_ID, intent } from '../test-support/setup-intents';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId; // routed, idle, sonnet, effective auto
const CATALOGUE = (fixtureLine(ROOT, RESPONSES.list_models) as ListModelsResponse).models; // pass2/auto-routed, seq 143
let backend: WidgetBackend;
let offs: (() => void)[] = [];

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
  offs = [backend.bridge().on('session.status', (event) => useSessions.getState().applyStatus(event))]; // C3's status events, as the shell applies them
});
afterEach(() => {
  cleanup();
  offs.forEach((off) => off());
  resetModelRequests();
  useSessions.setState({ engine: new Map() });
  useUsage.setState({ snapshot: null, windows: null, pinsFor: {} });
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = (name: 'model' | 'effort' | 'fast' = 'model', args = '') => {
  const Widget = modelWidget(name);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Widget appSessionId={ID} args={args} close={() => {}} />
    </QueryClientProvider>,
  );
};
const radio = (group: string, name: string) => within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio').find((r) => r.textContent?.startsWith(name))!;
const checkedIn = (group: string) => within(screen.getByRole('radiogroup', { name: group })).queryAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')?.textContent ?? null;
const setStatus = (patch: Partial<EngineSessionStatus>) => act(() => void backend.emitStatus(ID, patch));
const calls = (subtype: string) => backend.calls.filter((c) => c.subtype === subtype);

describe('model widget groups gateway models, greys auto mode and warns on fast mode', () => {
  it('presents the auto-routed catalogue as five Claude and seven Gateway entries (seq 143)', () => {
    const { claude, gateway } = presentModels(CATALOGUE);
    expect(claude.map((m) => m.value)).toEqual(['default', 'opus', 'fable', 'sonnet', 'haiku']);
    expect(gateway.map((m) => m.value)).toEqual(['claude/astra', 'claude/sol', 'claude/luna', 'claude/terra', 'claude/deepseek/deepseek-v4.1-flash[1m]', 'claude/~z-ai/glm-flash-latest[1m]', 'claude/google/gemini-3.8-flash[1m]']);
    expect(claude.filter((m) => m.fast).map((m) => m.value)).toEqual(['default', 'opus']);
    expect(claude.find((m) => m.value === 'haiku')).toMatchObject({ cannotHoldAuto: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] });
    expect(claude.filter((m) => m.cannotHoldAuto).map((m) => m.value)).toEqual(['haiku']); // absent, not false
    expect(claude.find((m) => m.value === 'opus')?.oneM).toBe(true);
    expect(claude.find((m) => m.value === 'haiku')?.oneM).toBe(false);
  });

  it('renders the groups, the 1M mark, the captions and the current model checked', async () => {
    mount();
    await screen.findByRole('radiogroup', { name: 'Claude models' });
    expect(within(screen.getByRole('radiogroup', { name: 'Claude models' })).getAllByRole('radio')).toHaveLength(5);
    expect(within(screen.getByRole('radiogroup', { name: 'Gateway models' })).getAllByRole('radio')).toHaveLength(7);
    expect(radio('Claude models', 'Haiku').textContent).toContain('Cannot hold auto mode · runs in default');
    expect(radio('Claude models', 'Opus').textContent).toContain('1M');
    expect(checkedIn('Claude models')).toMatch(/^Sonnet 5/);
    expect(radio('Gateway models', 'astra').textContent).toContain('From gateway');
    expect(calls('list_models')).toHaveLength(1);
  });

  it('choosing claude/astra with the effective mode auto shows the local-lane note naming the routing account', async () => {
    useUsage.getState().applySnapshot({
      available: true,
      dataDir: '/tmp/cu',
      readAt: '2026-09-29T12:00:00.000Z',
      error: null,
      drainTarget: 'u-3',
      drainTargetIsManual: false,
      accounts: [{ uuid: 'u-3', email: '3@example.test', displayName: 'Three', planLabel: null, rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 0, credentialOwnership: null, windows: { fiveHour: null, sevenDay: null, scoped: [] } }],
      pinsFor: {},
    });
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: /^astra/ }));
    const note = screen.getByRole('note');
    expect(note.textContent).toBe(
      'Auto-mode reviews for this model run locally. A GPT route carries no Anthropic verdict, so the engine reviews each tool call itself on Sonnet 5 through 3@example.test. Those requests count against usage.',
    );
    expect(calls('set_model')).toHaveLength(0); // choosing is not applying
    setStatus({ permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull()); // the note is about auto mode
  });

  it('the fast switch on opus shows the lane warning first; Turn on fast mode sends apply_flag_settings exactly once', async () => {
    setStatus({ model: { requested: 'opus', resolved: 'claude-opus-5-5[1m]' } });
    mount('fast');
    const fast = await screen.findByRole('switch', { name: 'Fast mode' });
    expect(fast.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off until turned on here')).toBeTruthy(); // sdk_opt_in_required
    fireEvent.click(fast);
    expect(screen.getByText('Fast mode disables the auto-mode server lane: reviews then run locally on Sonnet 5 and count against usage')).toBeTruthy();
    expect(calls('apply_flag_settings')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Keep auto mode' }));
    expect(screen.queryByText(/disables the auto-mode server lane/)).toBeNull();
    fireEvent.click(fast);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on fast mode' }));
    await waitFor(() => expect(calls('apply_flag_settings')).toHaveLength(1));
    expect(calls('apply_flag_settings')[0].input).toEqual({ appSessionId: ID, settings: { fastMode: true } });
    await waitFor(() => expect(screen.getByText('set · the next init frame confirms it')).toBeTruthy()); // pending until the init frame
    setStatus({ fastMode: { state: 'on', disabledReason: null } });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Fast mode' }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByText('set · the next init frame confirms it')).toBeNull();
  });

  it('the fast switch is off on a model without fast mode, and says so', () => {
    expect(fastView({ state: 'off', disabledReason: null }, CATALOGUE.find((m) => m.value === 'sonnet'))).toEqual({ checked: false, caption: null, disabled: 'Fast mode is for Opus' });
    expect(fastView({ state: 'cooldown', disabledReason: null }, CATALOGUE.find((m) => m.value === 'opus'))).toEqual({ checked: true, caption: 'on · cooling down', disabled: null });
  });
});

describe('mutations render C3’s result branches and ipc errors separately', () => {
  it('set_model refused: the current model stays checked and the code shows in words, the error as the caption', async () => {
    backend.script('session.setModel', () => ({ ok: false, error: 'Model not found: claude/nope', code: 'catalog_unknown' }));
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: /^astra/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Not in the engine's catalogue"));
    expect(screen.getByRole('alert').textContent).toContain('Model not found: claude/nope');
    expect(checkedIn('Claude models')).toMatch(/^Sonnet 5/);
    expect(checkedIn('Gateway models')).toBeNull();
  });

  it('set_model accepted: the row is pending until a status reports the new resolved model', async () => {
    mount('model', 'haiku'); // `/model haiku` preselects
    await screen.findByRole('radiogroup', { name: 'Claude models' });
    await waitFor(() => expect(checkedIn('Claude models')).toMatch(/^Haiku/));
    expect(calls('set_model')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(radio('Claude models', 'Haiku').textContent).toContain('set · the next init frame confirms it'));
    expect(calls('set_model')[0].input).toEqual({ appSessionId: ID, model: 'haiku' });
    setStatus({ model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' } }); // the next system/init
    await waitFor(() => expect(radio('Claude models', 'Haiku').textContent).not.toContain('set · the next init frame confirms it'));
    expect(checkedIn('Claude models')).toMatch(/^Haiku/);
  });

  it('a transport error on set_model keeps the prior model, says the engine did not answer, and re-enables the control', async () => {
    backend.script('session.setModel', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'set_model unanswered after 8 s' });
    });
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: /^Opus/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The engine did not answer · showing the last value it reported'));
    expect(checkedIn('Claude models')).toMatch(/^Sonnet 5/);
    expect(radio('Claude models', 'Opus')).toHaveProperty('disabled', false);
  });

  it('`/effort high` preselects high and Apply sends setEffort high; Engine default sends null', async () => {
    mount('effort', 'high');
    await screen.findByRole('radiogroup', { name: 'Effort levels' });
    await waitFor(() => expect(checkedIn('Effort levels')).toBe('high'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls('apply_flag_settings')).toHaveLength(1));
    expect(calls('apply_flag_settings')[0]).toMatchObject({ command: 'session.setEffort', input: { appSessionId: ID, effort: 'high' } });
    await waitFor(() => expect(checkedIn('Effort levels')).toBe('high')); // the status now reports it
    fireEvent.click(radio('Effort levels', 'Engine default'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls('apply_flag_settings')).toHaveLength(2));
    expect(calls('apply_flag_settings')[1].input).toEqual({ appSessionId: ID, effort: null });
  });

  it('`/model` with a name the catalogue lacks says so and preselects nothing', async () => {
    mount('model', 'gpt-9');
    await screen.findByRole('radiogroup', { name: 'Claude models' });
    await waitFor(() => expect(screen.getByText("No model named gpt-9 in the engine's catalogue")).toBeTruthy());
    expect(checkedIn('Claude models')).toMatch(/^Sonnet 5/);
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
  });

  it('`/fast on` opens with the warning shown', async () => {
    setStatus({ model: { requested: 'opus', resolved: 'claude-opus-5-5[1m]' } });
    mount('fast', 'on');
    await screen.findByRole('switch', { name: 'Fast mode' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on fast mode' })).toBeTruthy());
  });
});

describe('an accepted control is remembered only until the status moves', () => {
  it('bridges the gap before C3’s status event, then gives way to the status, even when the status later returns to the old model', async () => {
    backend.script('session.setModel', () => ({ ok: true, error: null, code: null })); // accepted, with no status event yet
    expect(await setModel({ appSessionId: ID, model: 'haiku' })).toEqual({ ok: true });
    const status = () => useSessions.getState().engine.get(ID)!;
    expect(acceptedModel(useModelRequests.getState(), ID, status())).toBe('haiku');
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...status(), model: { requested: 'haiku', resolved: 'claude-sonnet-5[1m]' } } }));
    expect(acceptedModel(useModelRequests.getState(), ID, status())).toBeUndefined();
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...status(), model: { requested: 'sonnet', resolved: 'claude-sonnet-5[1m]' } } }));
    expect(acceptedModel(useModelRequests.getState(), ID, status())).toBeUndefined(); // the memory is gone, not revived
  });
});

describe('an accepted control whose status arrived before its answer', () => {
  it('is not remembered, so a status returning to the old model never revives it', async () => {
    // the backend emits C3's status (requested: haiku) inside the command, before the answer resolves
    expect(await setModel({ appSessionId: ID, model: 'haiku' })).toEqual({ ok: true });
    const status = () => useSessions.getState().engine.get(ID)!;
    expect(status().model.requested).toBe('haiku');
    expect(useModelRequests.getState().model.has(ID)).toBe(false);
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...status(), model: { requested: 'sonnet', resolved: 'claude-sonnet-5[1m]' } } }));
    expect(acceptedModel(useModelRequests.getState(), ID, status())).toBeUndefined();
  });
});

describe('effortsOf', () => {
  it('keeps the known levels an entry lists, and reads anything but a list of strings as none listed', () => {
    expect(effortsOf({ supportedEffortLevels: ['low', 'bogus', 'max'] })).toEqual(['low', 'max']);
    expect(effortsOf({})).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortsOf({ supportedEffortLevels: 'lowhigh' as never })).toEqual(['low', 'medium', 'high', 'xhigh', 'max']); // no substring match
    expect(effortsOf({ supportedEffortLevels: [1, 'high'] as never })).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortsOf(undefined)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('liveModel', () => {
  it('names the accepted model, pending until the init frame resolves it, and reads default and opus apart', () => {
    expect(liveModel(CATALOGUE, { requested: 'sonnet', resolved: 'claude-sonnet-5[1m]' })).toMatchObject({ id: 'sonnet', pending: false });
    expect(liveModel(CATALOGUE, { requested: 'haiku', resolved: 'claude-sonnet-5[1m]' })).toMatchObject({ id: 'haiku', pending: true });
    expect(liveModel(CATALOGUE, { requested: 'opus', resolved: 'claude-opus-5-5[1m]' }).row?.value).toBe('opus');
    expect(liveModel(CATALOGUE, { requested: null, resolved: 'claude-opus-5-5[1m]' }).row?.value).toBe('default');
    expect(liveModel(CATALOGUE, { requested: 'claude/astra', resolved: 'claude/astra' })).toMatchObject({ pending: false });
  });
});

describe('the model widget on an unstarted session binds to the setup intent', () => {
  it('lists the intent’s catalogue, writes a choice through the intent, notes a gateway model under an unset mode, and has no fast switch', async () => {
    const UNSTARTED = 'app-new' as AppSessionId;
    const patches: unknown[] = [];
    const hook: SetupIntentHook = {
      intent: { location: { kind: 'directory', path: '/repo' }, additionalDirectories: [], model: 'sonnet', effort: null, permissionMode: null, message: null, draft: null },
      options: { locations: [], branches: [], models: [{ value: 'sonnet', displayName: 'Sonnet 5', supportsAutoMode: true }, { value: 'claude/astra', displayName: 'astra', supportsAutoMode: true }], autoModeNote: null },
      patch: async (p) => (patches.push(p), { ok: true }),
      start: async () => ({ ok: true }),
    };
    offs.push(registerSetupIntentHook((id) => (id === UNSTARTED ? hook : null)));
    const Widget = modelWidget('model');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Widget appSessionId={UNSTARTED} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    expect(checkedIn('Claude models')).toMatch(/^Sonnet 5/);
    fireEvent.click(radio('Gateway models', 'astra'));
    expect(screen.getByRole('note').textContent).toMatch(/^Auto-mode reviews for this model run locally\./);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(patches).toEqual([{ model: 'claude/astra', effort: null }]));
    expect(screen.queryByRole('switch', { name: 'Fast mode' })).toBeNull();
    expect(screen.getByText('Applies when the session starts')).toBeTruthy();
    expect(backend.calls).toHaveLength(0); // nothing asked of an engine that is not running
  });
});

// The C10 integration (C11 task 5, held piece 5): the same widget with C10's own hook registered, as the app registers it,
// over an intent in C10's setup store: the catalogue is C10's `engine.models`, and a choice is C10's
// `session.intent.patch`, the write C7's chips make; nothing is asked of an engine.
describe("the model widget on an unstarted session, with C10's registered hook", () => {
  it('lists engine.models in its groups and writes the choice through session.intent.patch', async () => {
    const held = intent({ appSessionId: INTENT_ID, model: 'sonnet', permissionMode: 'auto' });
    useSetup.setState({ intents: new Map([[INTENT_ID, held]]) });
    backend.script('session.intent.patch', (input) => ({ ...held, ...(input as { patch: object }).patch }));
    offs.push(registerSetupIntentHook(useC10SetupIntent));
    const Widget = modelWidget('model');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Widget appSessionId={INTENT_ID} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    // the cache's relay aliases (auto-routed seq 143) beside the Claude group
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Gateway models' })).getAllByRole('radio')).toHaveLength(7));
    expect(checkedIn('Claude models')).toMatch(/^Sonnet 5/);
    fireEvent.click(radio('Gateway models', 'astra'));
    expect(screen.getByRole('note').textContent).toMatch(/^Auto-mode reviews for this model run locally\./);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(useSetup.getState().intents.get(INTENT_ID)?.model).toBe('claude/astra'));
    expect(backend.calls.filter((c) => c.command === 'session.intent.patch').map((c) => c.input)).toEqual([{ appSessionId: INTENT_ID, patch: { model: 'claude/astra', effort: null } }]);
    const engineCalls = backend.calls.map((c) => c.command).filter((c) => c !== 'engine.models' && c !== 'session.intent.patch' && c !== 'session.trust.check');
    expect(engineCalls, 'nothing asked of an engine').toEqual([]);
    useSetup.setState({ intents: new Map() });
  });
});

// The architect's ruling (2026-09-29, "the D-19 surface on an unstarted tab"): the route choice lives in the model widget
// while the session is unstarted, one segment at its top writing `session.intent.patch { patch: { gateway } }`; under
// Direct the Gateway group greys, and picking a claude/* model there asks before flipping the route back to the relay.
describe('the model widget on an unstarted session carries its route', () => {
  // every state the intent passed through, so a case can assert it never held Direct with a relay alias
  let history: { gateway: string; model: string | null }[] = [];
  const mountUnstarted = (over: Parameters<typeof intent>[0] = {}) => {
    let held = intent({ appSessionId: INTENT_ID, model: 'sonnet', permissionMode: 'default', ...over });
    history = [];
    useSetup.setState({ intents: new Map([[INTENT_ID, held]]) });
    backend.script('session.intent.patch', (input) => {
      held = { ...held, ...(input as { patch: object }).patch };
      history.push({ gateway: held.gateway, model: held.model });
      return held;
    });
    offs.push(registerSetupIntentHook(useC10SetupIntent));
    const Widget = modelWidget('model');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Widget appSessionId={INTENT_ID} args="" close={() => {}} />
        <GatewayDialogs />
      </QueryClientProvider>,
    );
  };
  const neverDirectOnAlias = () => expect(history.filter((h) => h.gateway === 'direct' && h.model !== null && h.model.startsWith('claude/'))).toEqual([]);
  const route = () => within(screen.getByRole('radiogroup', { name: 'Route' }));
  const patches = () => backend.calls.filter((c) => c.command === 'session.intent.patch').map((c) => (c.input as { patch: unknown }).patch);
  afterEach(() => useSetup.setState({ intents: new Map() }));

  it('opens with a Route segment on the intent’s route, and Direct writes the intent’s gateway and greys the Gateway group', async () => {
    mountUnstarted();
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Gateway models' })).getAllByRole('radio')).toHaveLength(7));
    expect(route().getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['ClaudeUsage relay', 'true'],
      ['Direct', 'false'],
    ]);
    expect(within(screen.getByRole('radiogroup', { name: 'Gateway models' })).getAllByRole('radio').every((r) => r.getAttribute('aria-disabled') !== 'true')).toBe(true);
    fireEvent.click(route().getByRole('radio', { name: 'Direct' }));
    await waitFor(() => expect(route().getByRole('radio', { name: 'Direct' }).getAttribute('aria-checked')).toBe('true'));
    expect(patches()).toEqual([{ gateway: 'direct' }]);
    const gateway = screen.getByRole('region', { name: 'Gateway' });
    expect(within(gateway).getAllByRole('radio').every((r) => r.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(gateway.textContent).toContain('The direct route cannot serve these');
  });

  it('a claude/* model picked on Direct asks first: Keep Direct changes nothing, Use the relay flips the route and picks it', async () => {
    mountUnstarted({ gateway: 'direct' });
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Gateway models' })).getAllByRole('radio')).toHaveLength(7));
    fireEvent.click(radio('Gateway models', 'astra'));
    const ask = screen.getByRole('group', { name: 'Start on the relay?' });
    expect(ask.textContent).toContain('astra runs through ClaudeUsage’s relay');
    expect(checkedIn('Gateway models')).toBeNull();
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep Direct' }));
    expect(screen.queryByRole('group', { name: 'Start on the relay?' })).toBeNull();
    expect(patches()).toEqual([]);
    fireEvent.click(radio('Gateway models', 'astra'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Start on the relay?' })).getByRole('button', { name: 'Use the relay' }));
    await waitFor(() => expect(route().getByRole('radio', { name: 'ClaudeUsage relay' }).getAttribute('aria-checked')).toBe('true'));
    expect(patches()).toEqual([{ gateway: 'gateway' }]);
    expect(checkedIn('Gateway models')).toMatch(/^astra/);
  });

  // Re-review of fix H: Direct on a gateway model never saves the route alone. A pending Claude choice counts as the pick
  // and is written with the route in one patch; otherwise pickDirectModel asks, and cancelling it changes nothing.
  it('a Claude model chosen without Apply goes with Direct in one patch, and the intent never holds Direct on an alias', async () => {
    mountUnstarted({ model: 'claude/astra' });
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Claude models' })).getAllByRole('radio').length).toBeGreaterThan(0));
    fireEvent.click(radio('Claude models', 'Sonnet 5')); // chosen, not applied
    fireEvent.click(route().getByRole('radio', { name: 'Direct' }));
    await waitFor(() => expect(route().getByRole('radio', { name: 'Direct' }).getAttribute('aria-checked')).toBe('true'));
    expect(patches()).toEqual([{ gateway: 'direct', model: 'sonnet' }]);
    expect(screen.queryByRole('dialog', { name: 'Choose a Claude model' })).toBeNull();
    neverDirectOnAlias();
  });

  it('Direct on an intent holding a gateway model asks for a Claude model first; Cancel changes nothing, a pick writes all three at once', async () => {
    mountUnstarted({ model: 'claude/astra' });
    await waitFor(() => expect(route().getByRole('radio', { name: 'Direct' })).toBeTruthy());
    fireEvent.click(route().getByRole('radio', { name: 'Direct' }));
    const pick = await screen.findByRole('dialog', { name: 'Choose a Claude model' });
    fireEvent.click(within(pick).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose a Claude model' })).toBeNull());
    expect(patches()).toEqual([]);
    expect(route().getByRole('radio', { name: 'ClaudeUsage relay' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(route().getByRole('radio', { name: 'Direct' }));
    const again = await screen.findByRole('dialog', { name: 'Choose a Claude model' });
    fireEvent.click(await within(again).findByRole('radio', { name: /^Opus/ }));
    fireEvent.click(within(again).getByRole('button', { name: 'Use this model' }));
    await waitFor(() => expect(patches()).toEqual([{ gateway: 'direct', model: 'opus' }]));
    neverDirectOnAlias();
  });

  it('a live session has no Route segment (its route changes by a restart, from the status line)', async () => {
    mount('model');
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Claude models' })).toBeTruthy());
    expect(screen.queryByRole('radiogroup', { name: 'Route' })).toBeNull();
  });
});
