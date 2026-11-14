import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { SessionRecordSchema } from '@shared/graph/session';
import { compileAddressing } from '@shared/machine/address';
import { digest, remoteRow } from '../../../../test/support/builders';
import { addressOf } from '@shared/machine/address';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { registerSetupIntentHook, type SetupIntentHook } from '../composer';
import { effortBasis, resetEffectiveEfforts, useEffectiveEfforts } from '../composer/effective-effort';
import { GatewayDialogs } from '../gateway/SwitchSheet';
import { ipc } from '../ipc/client';
import { useSetup } from '../sessions/store';
import { useComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { ID as INTENT_ID, intent } from '../test-support/setup-intents';
import { effortLevelsOf, resetModelRequests } from './model';
import { modelSelector } from './ModelSelector';
import { emptyObservedFacts } from '@shared/engine/observed-facts';
import type { SetupIntent } from '@shared/sessions/intent';
import { machineSettingsDefaults } from '@shared/settings/defaults';
import { GATEWAY } from '../settings-tab/copy';
import { REL } from '../test-support/relative-time';

const SELECTOR_BACK = 'Back to effort';

const ROOT = join(__dirname, '../../../..');
// P5 O6 M2: the backend is main (bare ids); the page holds the address
const BARE = 'app-7412a115' as AppSessionId; // routed, idle, sonnet, effective auto (pass2/auto-routed's catalogue, seq 143)
const ID = at(BARE);
const lifted = (status: EngineSessionStatus): EngineSessionStatus => ({ ...status, appSessionId: at(status.appSessionId) });
const RECORD_ADDRESSING = compileAddressing(SessionRecordSchema);
const INTENT = at(INTENT_ID); // the setup builders' id is main's
let backend: WidgetBackend;
let offs: (() => void)[] = [];

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  // the machine's default route, as main answers it (the intent binding reads it on every mount); unanswered, each
  // mount warned on stderr
  backend.script('machineSettings.get', () => ({ settings: machineSettingsDefaults(), version: 1, defaultRoute: 'machine' }));
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
  offs = [ipc.on('session.status', (event) => useSessions.getState().applyStatus(event, TEST_MACHINE))];
});
afterEach(() => {
  cleanup();
  offs.forEach((off) => off());
  resetModelRequests();
  resetEffectiveEfforts();
  useSessions.setState({ engine: new Map() });
  useUsage.setState({ snapshot: null, windows: null, pinsFor: {} });
  delete (window as { maws?: unknown }).maws;
});

const mount = (name: 'model' | 'effort' | 'fast' = 'effort', args = '', id: AppSessionId = ID) => {
  const Selector = modelSelector(name);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Selector appSessionId={id} args={args} close={() => {}} />
    </QueryClientProvider>,
  );
};
// the effort the composer read for this status through get_settings (effective-effort.ts)
const knowEffort = (effort: EngineSessionStatus['effort']) => {
  const status = useSessions.getState().engine.get(ID)!;
  useEffectiveEfforts.setState({ known: new Map([[ID, { basis: effortBasis(status)!, effort }]]) });
};
const setStatus = (patch: Partial<EngineSessionStatus>) => act(() => void backend.emitStatus(BARE, patch));
const calls = (subtype: string) => backend.calls.filter((c) => c.subtype === subtype);
const view = () => document.querySelector('[data-model-selector]')?.getAttribute('data-model-selector');
const item = (name: RegExp) => screen.getByRole('menuitemradio', { name });
const names = (group: HTMLElement) => within(group).getAllByRole('menuitemradio').map((r) => r.querySelector('.truncate')?.textContent);

describe('the effort view: the effort in words over the model, a slider over its levels, a reset', () => {
  it('names the effort get_settings applied and the model, and slides to set the effort for this session', async () => {
    knowEffort('high');
    mount('effort');
    expect(view()).toBe('effort');
    expect(document.querySelector('[data-effort-title]')?.textContent).toBe('High');
    const slider = screen.getByRole('slider', { name: 'Effort' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sonnet 5 · Select model' })).toBeTruthy()); // once list_models answered
    expect(slider.getAttribute('aria-valuetext')).toBe('High, 3 of 5');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await waitFor(() => expect(calls('apply_flag_settings')).toHaveLength(1));
    expect(calls('apply_flag_settings')[0].input).toEqual({ appSessionId: BARE, effort: 'xhigh' });
  });

  it('Reset clears an effort set explicitly, and is off while none is', async () => {
    knowEffort('high');
    mount('effort');
    const reset = screen.getByRole('button', { name: "Reset effort to the model's default" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true); // nothing requested: the effort is the engine's own
    setStatus({ effort: 'max' });
    await waitFor(() => expect(reset.disabled).toBe(false));
    fireEvent.click(reset);
    await waitFor(() => expect(calls('apply_flag_settings').map((c) => c.input)).toEqual([{ appSessionId: BARE, effort: null }]));
  });

  it('offers no slider for a model without effort levels (Haiku’s live row lists none)', async () => {
    setStatus({ model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' } });
    mount('effort');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Haiku · Select model' })).toBeTruthy());
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText('No effort setting')).toBeTruthy();
    expect(effortLevelsOf({ value: 'haiku' } as never)).toEqual([]);
    expect(effortLevelsOf(undefined)).toHaveLength(5);
  });

  // UX wave U4a (O-32, decision 20): no lightning; where the model offers fast mode, a "Fast mode" row at the foot of the
  // effort view, its state in a muted line and a switch at the right; turning it on still asks first
  it('the fast-mode row asks first: the lane warning, then Turn on fast mode sends apply_flag_settings once', async () => {
    setStatus({ model: { requested: 'opus', resolved: 'claude-opus-5-5[1m]' } });
    mount('fast', 'on');
    const fast = await screen.findByRole('switch', { name: 'Fast mode' });
    await waitFor(() => expect(screen.getByText('Fast mode disables the auto-mode server lane: reviews then run locally on Sonnet 5 and count against usage')).toBeTruthy());
    expect(fast.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on fast mode' }));
    await waitFor(() => expect(calls('apply_flag_settings').map((c) => c.input)).toEqual([{ appSessionId: BARE, settings: { fastMode: true } }]));
  });

  it('draws no lightning; the row sits at the foot with its state in words, and is absent for a model without fast mode', async () => {
    setStatus({ model: { requested: 'opus', resolved: 'claude-opus-5-5[1m]' }, fastMode: { state: 'off', disabledReason: null } });
    mount('effort');
    const fast = await screen.findByRole('switch', { name: 'Fast mode' });
    expect(document.body.textContent).not.toContain('⚡');
    const row = fast.closest('[data-fast-row]') as HTMLElement;
    expect(row.textContent).toBe('Fast modeOff');
    const view = screen.getByRole('group', { name: 'Effort' });
    expect(view.lastElementChild).toBe(row); // the foot of the effort view
    setStatus({ fastMode: { state: 'on', disabledReason: null } });
    await waitFor(() => expect(row.textContent).toBe('Fast modeOn'));
    expect(fast.getAttribute('aria-checked')).toBe('true');
    setStatus({ fastMode: { state: 'cooldown', disabledReason: null } });
    await waitFor(() => expect(row.textContent).toBe('Fast modeon · cooling down'));
    setStatus({ fastMode: { state: 'off', disabledReason: 'sdk_opt_in_required' } });
    await waitFor(() => expect(row.textContent).toBe('Fast modeOff until turned on here'));
    fireEvent.click(fast);
    expect(screen.getByRole('button', { name: 'Turn on fast mode' })).toBeTruthy(); // the switch still asks first
    cleanup();
    setStatus({ model: { requested: 'sonnet', resolved: 'claude-sonnet-5[1m]' }, fastMode: { state: 'off', disabledReason: null } });
    mount('effort');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sonnet 5 · Select model' })).toBeTruthy());
    expect(screen.queryByRole('switch')).toBeNull(); // Sonnet has no fast mode: no row
    expect(document.querySelector('[data-fast-row]')).toBeNull();
  });

  // P5 O7 M8: `session.applyFlagSettings` is declared not offered on another machine (REMOTE_UNAVAILABLE): the row's
  // switch is closed with the declared words, which its line says too, and `/fast on` opens no warning
  it('closes the fast-mode row for a session on another machine, with the declared reason', async () => {
    const remote = addressOf(OTHER_MACHINE, BARE);
    useSessions.setState({ engine: new Map([[remote, { ...backend.status(BARE), model: { ...backend.status(BARE).model, requested: 'opus', resolved: 'claude-opus-5-5[1m]' }, appSessionId: remote }]]), listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, BARE), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]) });
    try {
      mount('fast', 'on', remote);
      const fast = await screen.findByRole('switch', { name: 'Fast mode' });
      expect(fast).toHaveProperty('disabled', true);
      expect(fast.title).toBe(REMOTE_UNAVAILABLE['session.applyFlagSettings']);
      expect(fast.closest('[data-fast-row]')?.textContent).toBe(`Fast mode${REMOTE_UNAVAILABLE['session.applyFlagSettings']}`);
      expect(screen.queryByRole('button', { name: 'Turn on fast mode' })).toBeNull();
    } finally {
      useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    }
  });

  // UX wave U4a (O-32, decision 20): the track is the target; a press picks the nearest level and a drag follows it,
  // committing once where it is released; the dots stay marks
  describe('the effort track takes the pointer', () => {
    const track = () => {
      const slider = screen.getByRole('slider', { name: 'Effort' });
      slider.getBoundingClientRect = () => ({ left: 100, width: 200, right: 300, top: 0, bottom: 28, height: 28, x: 100, y: 0, toJSON: () => ({}) });
      return slider;
    };
    const press = (slider: HTMLElement, x: number) => fireEvent.pointerDown(slider, { clientX: x, pointerId: 1, button: 0 });

    it('is 28 px tall, keeps its dots as marks, and a press between two dots picks the nearer at release', async () => {
      knowEffort('high');
      mount('effort');
      const slider = track();
      expect(slider.className).toContain('h-7');
      expect([...slider.querySelectorAll('[data-level]')].map((d) => d.getAttribute('data-level'))).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      press(slider, 160); // 30 % along: nearer medium (25 %) than high (50 %)
      expect(slider.getAttribute('aria-valuetext')).toBe('Medium, 2 of 5');
      expect(calls('apply_flag_settings')).toHaveLength(0); // not before release
      fireEvent.pointerUp(slider, { clientX: 160, pointerId: 1 });
      await waitFor(() => expect(calls('apply_flag_settings').map((c) => c.input)).toEqual([{ appSessionId: BARE, effort: 'medium' }]));
    });

    it('a drag follows the pointer and commits once, where it is released; a press on the current level sends nothing', async () => {
      knowEffort('high');
      mount('effort');
      const slider = track();
      press(slider, 105);
      expect(slider.getAttribute('aria-valuetext')).toBe('Low, 1 of 5');
      fireEvent.pointerMove(slider, { clientX: 255, pointerId: 1 });
      expect(slider.getAttribute('aria-valuetext')).toBe('Extra high, 4 of 5');
      fireEvent.pointerMove(slider, { clientX: 320, pointerId: 1 }); // past the end: the last level
      expect(slider.getAttribute('aria-valuetext')).toBe('Max, 5 of 5');
      fireEvent.pointerUp(slider, { clientX: 320, pointerId: 1 });
      await waitFor(() => expect(calls('apply_flag_settings').map((c) => c.input)).toEqual([{ appSessionId: BARE, effort: 'max' }]));
      cleanup();
      backend.calls.length = 0;
      knowEffort('high');
      mount('effort');
      const again = track();
      press(again, 200);
      fireEvent.pointerUp(again, { clientX: 200, pointerId: 1 });
      fireEvent.pointerMove(again, { clientX: 290, pointerId: 1 }); // no press held: nothing follows
      expect(again.getAttribute('aria-valuetext')).toBe('High, 3 of 5');
      await act(async () => void (await Promise.resolve()));
      expect(calls('apply_flag_settings')).toHaveLength(0);
    });

    it('the keyboard moves it as before', async () => {
      knowEffort('high');
      mount('effort');
      const slider = track();
      fireEvent.keyDown(slider, { key: 'Home' });
      await waitFor(() => expect(calls('apply_flag_settings').map((c) => c.input)).toEqual([{ appSessionId: BARE, effort: 'low' }]));
    });
  });

  // UX wave U4a (decision 21): ⇧⌘E asks for the effort view with the keyboard on the slider
  it('puts the keyboard on the slider when the request asks for it, and only then', async () => {
    knowEffort('high');
    useComposerStore.setState({ chipWidgets: new Map([[ID, { name: 'effort', args: '', nonce: 1, focus: 'slider' }]]) });
    try {
      mount('effort');
      expect(document.activeElement).toBe(screen.getByRole('slider', { name: 'Effort' }));
      cleanup();
      useComposerStore.setState({ chipWidgets: new Map([[ID, { name: 'effort', args: '', nonce: 2 }]]) });
      mount('effort');
      expect(document.activeElement).not.toBe(screen.getByRole('slider', { name: 'Effort' }));
    } finally {
      useComposerStore.setState({ chipWidgets: new Map() });
    }
  });
});

// UX wave U4a (l3-input-12, decision 21): in the open model list a digit 1 to 9 picks the row drawn at that place,
// Default first; a disabled row is not picked
describe('the digits in the model list', () => {
  it('a digit picks the row at that place; none while the rows are disabled, none with a modifier, none in the effort view', async () => {
    mount('model');
    await screen.findByRole('group', { name: 'Claude models' });
    const back = screen.getByRole('button', { name: SELECTOR_BACK });
    fireEvent.keyDown(back, { key: '3', metaKey: true });
    fireEvent.keyDown(back, { key: '0' });
    expect(calls('set_model')).toHaveLength(0);
    fireEvent.keyDown(back, { key: '3' }); // Default, Opus, then Fable
    fireEvent.keyDown(back, { key: '4' }); // the rows are disabled while that change is with the engine
    await waitFor(() => expect(calls('set_model').map((c) => c.input)).toEqual([{ appSessionId: BARE, model: 'fable' }]));
    await waitFor(() => expect(view()).toBe('effort')); // a choice returns to the effort view, as a click's does
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Effort' }), { key: '1' });
    await act(async () => void (await Promise.resolve()));
    expect(calls('set_model')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Select model/ }));
    fireEvent.keyDown(screen.getByRole('button', { name: SELECTOR_BACK }), { key: '1' }); // Default
    await waitFor(() => expect(calls('set_model').map((c) => c.input)).toEqual([{ appSessionId: BARE, model: 'fable' }, { appSessionId: BARE, model: null }]));
  });
});

describe('the model view: Select model, Default with its recommendation, the catalogue with the current row checked', () => {
  it('lists Default as a recommended set, then the catalogue without `default`, gateway aliases from the gateway', async () => {
    mount('model');
    expect(view()).toBe('model');
    expect(screen.getByRole('heading', { name: 'Select model' })).toBeTruthy();
    const claude = await screen.findByRole('group', { name: 'Claude models' });
    expect(names(claude)).toEqual(['Opus 5.5 (1M context)', 'Fable 5.1', 'Sonnet 5', 'Haiku']); // `default` is the entry above, not a row
    expect(within(screen.getByRole('group', { name: 'Gateway models' })).getAllByRole('menuitemradio')).toHaveLength(7);
    expect(item(/^astra/).textContent).toContain('From gateway');
    expect(within(item(/^Haiku/)).getByText('Cannot hold auto mode')).toBeTruthy(); // L99: the mode it runs in is the chip's and the note's, not the caption's
    const fallback = item(/Default/);
    expect(fallback.querySelector('.truncate')?.textContent).toBe('Default');
    expect(within(fallback).getByText('Recommended set of models')).toBeTruthy();
    expect(within(fallback).getAllByText('Default')).toHaveLength(1); // no second Default badge
    expect(fallback.getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByRole('menuitemradio', { checked: true }).map((r) => r.querySelector('.truncate')?.textContent)).toEqual(['Sonnet 5']); // the model the session asked for
    expect(screen.queryByText(/Default \(recommended\)|Engine default|Default model/)).toBeNull();
    expect(screen.getByText('For this session only')).toBeTruthy();
  });

  it('a choice applies at once with set_model and returns to the effort view; Default sends null', async () => {
    mount('model');
    await screen.findByRole('group', { name: 'Claude models' });
    fireEvent.click(item(/^Opus/));
    await waitFor(() => expect(calls('set_model').map((c) => c.input)).toEqual([{ appSessionId: BARE, model: 'opus' }]));
    await waitFor(() => expect(view()).toBe('effort'));
    expect(screen.getByText('set · the next init frame confirms it')).toBeTruthy(); // until an init frame reports it
    fireEvent.click(screen.getByRole('button', { name: 'Opus 5.5 (1M context) · Select model' }));
    expect(view()).toBe('model');
    expect(item(/^Opus/).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(item(/Default/));
    await waitFor(() => expect(calls('set_model').map((c) => c.input)).toEqual([{ appSessionId: BARE, model: 'opus' }, { appSessionId: BARE, model: null }]));
    await waitFor(() => expect(view()).toBe('effort'));
    fireEvent.click(screen.getByRole('button', { name: /Select model/ }));
    expect(item(/^Default/).getAttribute('aria-checked')).toBe('true');
  });

  it('`/model claude/astra` in auto proposes it with the local-lane note and applies nothing until chosen', async () => {
    mount('model', 'claude/astra');
    await waitFor(() => expect(item(/^astra/).getAttribute('data-proposed')).toBe('true'));
    expect(screen.getByRole('note').textContent).toContain('Auto-mode reviews for this model run locally.');
    expect(calls('set_model')).toHaveLength(0);
    cleanup();
    mount('model', 'nonesuch');
    await waitFor(() => expect(screen.getByText("No model named nonesuch in the engine's catalogue")).toBeTruthy());
  });

  it('a refused set_model keeps the current row and says why in words', async () => {
    backend.script('session.setModel', () => ({ ok: false, error: 'not available', code: 'unavailable_for_account' }));
    mount('model');
    await screen.findByRole('group', { name: 'Claude models' });
    fireEvent.click(item(/^Fable/));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Not available for this accountnot available'));
    expect(view()).toBe('model');
    expect(item(/^Sonnet/).getAttribute('aria-checked')).toBe('true');
  });
});

// P2-A (2026-10-09; the execution document §5.6): a record with no ready process binds to its record; a choice is marked
// pending, starts the session (`chip`), then applies; the live binding confirms it; a start that fails clears the mark.
describe('a session with a record and no ready process', () => {
  const scenario = () => loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
  const dormant = () => {
    const record = RECORD_ADDRESSING.lift(scenario().sessions.find((s) => s.appId === BARE)!, TEST_MACHINE);
    useSessions.setState({ engine: new Map([[ID, { ...lifted(backend.status(BARE)), process: 'exited' }]]), records: new Map([[ID, record]]) });
    const facts = { ...emptyObservedFacts(BARE, '2026-10-09T00:00:00.000Z', 'live'), model: { value: 'claude-opus-5-5', at: new Date(Date.now() - 2 * 86_400_000).toISOString(), launchId: 'l-1' }, complete: true };
    backend.script('session.observedFacts', () => facts);
  };
  const acquires = () => backend.calls.filter((c) => c.command === 'session.acquire').map((c) => c.input);
  afterEach(() => useSessions.setState({ records: new Map() }));

  it('names the observed model, starts nothing on open, and a choice is pending through the start, then set_model', async () => {
    dormant();
    mount('model');
    await screen.findByRole('group', { name: 'Claude models' });
    expect(acquires()).toEqual([]);
    expect(calls('list_models')).toHaveLength(0); // the catalogue is the host's, no engine read
    fireEvent.click(screen.getByRole('button', { name: SELECTOR_BACK }));
    await waitFor(() => expect(document.querySelector('[data-model-observed]')?.textContent).toMatch(new RegExp(`· Last observed ${REL.ago(2, 'day')}$`)));
    fireEvent.click(screen.getByRole('button', { name: /Select model/ }));
    fireEvent.click(item(/^Opus/));
    expect(screen.getByText('set · the next init frame confirms it')).toBeTruthy(); // pending from the choice
    await waitFor(() => expect(calls('set_model').map((c) => c.input)).toEqual([{ appSessionId: BARE, model: 'opus' }]));
    expect(acquires()).toEqual([{ appSessionId: BARE, reason: 'chip' }]);
    expect(useSessions.getState().engine.get(ID)?.process).toBe('ready');
    await waitFor(() => expect(view()).toBe('effort'));
    expect(screen.getByText('set · the next init frame confirms it')).toBeTruthy(); // the live binding keeps it until an init confirms
  });

  it('a start that fails clears the pending mark, applies nothing and says why', async () => {
    dormant();
    backend.script('session.acquire', () => ({ status: 'failed', appSessionId: BARE, message: 'The session did not become ready.', resources: { worktree: null, record: 'kept', transcript: 'kept' } }));
    mount('model');
    await screen.findByRole('group', { name: 'Claude models' });
    fireEvent.click(item(/^Opus/));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The session did not become ready.'));
    expect(screen.queryByText('set · the next init frame confirms it')).toBeNull();
    expect(calls('set_model')).toHaveLength(0);
    expect(item(/^Sonnet/).getAttribute('aria-checked')).toBe('true'); // the record's requested model, still
  });

  it('a terminal holding the session refuses a choice in words, and starts nothing', async () => {
    dormant();
    const record = RECORD_ADDRESSING.lift(scenario().sessions.find((s) => s.appId === BARE)!, TEST_MACHINE);
    useSessions.setState({ records: new Map([[ID, { ...record, holder: { kind: 'terminal', pid: 4711 } }]]), digests: new Map([[ID, digest(ID, { availability: 'foreign_held' })]]) });
    mount('model');
    await screen.findByRole('group', { name: 'Claude models' });
    expect((item(/^Opus/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Held by terminal · 4711').length).toBeGreaterThan(0);
    expect(acquires()).toEqual([]);
  });
});

// main's answers for the route segment: the machine's default route (`null`: its daemon predates the machine route, and
// answers none), and the intent as a patch leaves it
const routeAnswers = (held: SetupIntent, defaultRoute: 'machine' | 'gateway' | null) => async (name: string, input: unknown) => {
  if (name === 'machineSettings.get') return { ok: true, value: { settings: machineSettingsDefaults(), version: 1, ...(defaultRoute !== null && { defaultRoute }) } };
  if (name !== 'session.intent.patch') return { ok: false, error: { code: 'internal', message: `unexpected ${name}` } };
  const { patch } = input as { patch: { route: 'machine' | 'gateway' | 'direct' } };
  return { ok: true, value: { ...held, route: patch.route, gateway: patch.route === 'machine' ? held.gateway : patch.route } };
};

describe('an unstarted session writes its intent, with D-19’s route', () => {
  let offHook: () => void;
  afterEach(() => {
    offHook?.();
    useSetup.setState({ intents: new Map() });
  });

  function stub(over: Partial<SetupIntentHook['intent']> = {}, tab: AppSessionId = INTENT) {
    const patches: unknown[] = [];
    let current: SetupIntentHook['intent'] = { location: { kind: 'directory', path: '/repo' }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null, ...over };
    const models = [
      { value: 'default', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'opus', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
      { value: 'claude/sol', resolvedModel: 'claude/sol', displayName: 'sol', description: 'From gateway', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    ];
    offHook = registerSetupIntentHook((id) =>
      id === tab
        ? {
            intent: current,
            options: { models, autoModeNote: null },
            patch: async (p) => {
              patches.push(p);
              current = { ...current, ...p };
              return { ok: true };
            },
            start: async () => ({ ok: true }),
          }
        : null,
    );
    useSetup.setState({ intents: new Map([[INTENT, intent({ appSessionId: INTENT, gateway: 'gateway' })]]) });
    return patches;
  }

  it('a model choice drops an effort the model does not admit; the effort slider writes the intent', async () => {
    const patches = stub({ model: 'opus', effort: 'high' });
    mount('model', '', INTENT);
    expect(screen.getByRole('radiogroup', { name: 'Route' })).toBeTruthy();
    fireEvent.click(item(/^Haiku/));
    await waitFor(() => expect(patches).toEqual([{ model: 'haiku', effort: null }]));
    expect(screen.getByText('Applies when the session starts')).toBeTruthy();
  });

  // P5 O7 M9: the machine's own route is the intent's `route`, offered beside Gateway and Direct, and always one to go back to
  it('names the machine’s own route the intent holds, and writes each choice as the intent’s route', async () => {
    stub();
    const held = intent({ appSessionId: INTENT, gateway: 'direct', route: 'machine' });
    useSetup.setState({ intents: new Map([[INTENT, held]]) });
    const invoke = vi.spyOn(ipc, 'invoke').mockImplementation(routeAnswers(held, 'machine') as never);
    mount('model', '', INTENT);
    const segment = screen.getByRole('radiogroup', { name: 'Route' });
    expect(within(segment).getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['Machine’s own', 'true'],
      ['ClaudeUsage relay', 'false'],
      ['Direct', 'false'],
    ]);
    // the legacy field beside `route` for the two legacy choices: a daemon that predates the machine route still applies it
    fireEvent.click(within(segment).getByRole('radio', { name: 'ClaudeUsage relay' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('session.intent.patch', { appSessionId: INTENT, patch: { route: 'gateway', gateway: 'gateway' } }));
    await waitFor(() => expect(within(segment).getByRole('radio', { name: 'ClaudeUsage relay' }).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(within(segment).getByRole('radio', { name: 'Machine’s own' }));
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('session.intent.patch', { appSessionId: INTENT, patch: { route: 'machine' } }));
    invoke.mockRestore();
  });

  // the intent's own machine answers for it: a tab on another machine (its project's) is read there, not here
  it('greys Machine’s own for a tab whose machine’s daemon predates it, though this machine’s is current', async () => {
    const TARGET = addressOf(OTHER_MACHINE, INTENT_ID);
    stub({}, TARGET);
    const held = intent({ appSessionId: TARGET, gateway: 'gateway' });
    useSetup.setState({ intents: new Map([[TARGET, held]]) });
    const local = routeAnswers(held, 'gateway');
    const older = routeAnswers(held, null);
    const invoke = vi.spyOn(ipc, 'invoke').mockImplementation(((name: string, input: unknown, opts?: { machine?: string }) => (opts?.machine === OTHER_MACHINE ? older : local)(name, input)) as never);
    mount('model', '', TARGET);
    const machine = within(screen.getByRole('radiogroup', { name: 'Route' })).getByRole('radio', { name: 'Machine’s own' }) as HTMLButtonElement;
    await waitFor(() => expect(machine.disabled).toBe(true));
    expect(machine.title).toBe(GATEWAY.routeDropped);
    expect(invoke.mock.calls.filter(([name]) => name === 'machineSettings.get').map(([, , opts]) => (opts as { machine?: string }).machine)).toEqual([OTHER_MACHINE]);
    invoke.mockRestore();
  });

  it('on a daemon that predates the machine route: Machine’s own greyed with the mirror’s words, and Gateway and Direct still applied through the legacy field', async () => {
    stub();
    const held = intent({ appSessionId: INTENT, gateway: 'gateway' });
    useSetup.setState({ intents: new Map([[INTENT, held]]) });
    const invoke = vi.spyOn(ipc, 'invoke').mockImplementation(routeAnswers(held, null) as never);
    mount('model', '', INTENT);
    const segment = screen.getByRole('radiogroup', { name: 'Route' });
    const machine = within(segment).getByRole('radio', { name: 'Machine’s own' }) as HTMLButtonElement;
    await waitFor(() => expect(machine.disabled).toBe(true));
    expect(machine.title).toBe(GATEWAY.routeDropped);
    fireEvent.click(within(segment).getByRole('radio', { name: 'Direct' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('session.intent.patch', { appSessionId: INTENT, patch: { route: 'direct', gateway: 'direct' } }));
    invoke.mockRestore();
  });

  it('Direct on a gateway model asks for a Claude model first (pickDirectModel)', async () => {
    stub({ model: 'claude/sol' });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <GatewayDialogs />
      </QueryClientProvider>,
    );
    mount('model', '', INTENT);
    fireEvent.click(screen.getByRole('radio', { name: /Direct/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });
});
