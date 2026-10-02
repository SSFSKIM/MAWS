import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { registerSetupIntentHook, type SetupIntentHook } from '../composer';
import { effortBasis, resetEffectiveEfforts, useEffectiveEfforts } from '../composer/effective-effort';
import { GatewayDialogs } from '../gateway/SwitchSheet';
import { useSetup } from '../sessions/store';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { ID as INTENT_ID, intent } from '../test-support/setup-intents';
import { effortLevelsOf, resetModelRequests } from './model';
import { modelSelector } from './ModelSelector';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId; // routed, idle, sonnet, effective auto (pass2/auto-routed's catalogue, seq 143)
let backend: WidgetBackend;
let offs: (() => void)[] = [];

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
  offs = [backend.bridge().on('session.status', (event) => useSessions.getState().applyStatus(event))];
});
afterEach(() => {
  cleanup();
  offs.forEach((off) => off());
  resetModelRequests();
  resetEffectiveEfforts();
  useSessions.setState({ engine: new Map() });
  useUsage.setState({ snapshot: null, windows: null, pinsFor: {} });
  delete (window as { maws?: MawsBridge }).maws;
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
const setStatus = (patch: Partial<EngineSessionStatus>) => act(() => void backend.emitStatus(ID, patch));
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
    expect(calls('apply_flag_settings')[0].input).toEqual({ appSessionId: ID, effort: 'xhigh' });
  });

  it('Reset clears an effort set explicitly, and is off while none is', async () => {
    knowEffort('high');
    mount('effort');
    const reset = screen.getByRole('button', { name: "Reset effort to the model's default" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true); // nothing requested: the effort is the engine's own
    setStatus({ effort: 'max' });
    await waitFor(() => expect(reset.disabled).toBe(false));
    fireEvent.click(reset);
    await waitFor(() => expect(calls('apply_flag_settings').map((c) => c.input)).toEqual([{ appSessionId: ID, effort: null }]));
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

  it('the lightning asks first: the lane warning, then Turn on fast mode sends apply_flag_settings once', async () => {
    setStatus({ model: { requested: 'opus', resolved: 'claude-opus-5-5[1m]' } });
    mount('fast', 'on');
    const fast = await screen.findByRole('switch', { name: 'Fast mode' });
    await waitFor(() => expect(screen.getByText('Fast mode disables the auto-mode server lane: reviews then run locally on Sonnet 5 and count against usage')).toBeTruthy());
    expect(fast.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on fast mode' }));
    await waitFor(() => expect(calls('apply_flag_settings').map((c) => c.input)).toEqual([{ appSessionId: ID, settings: { fastMode: true } }]));
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
    expect(item(/^Haiku/).textContent).toContain('Cannot hold auto mode');
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
    await waitFor(() => expect(calls('set_model').map((c) => c.input)).toEqual([{ appSessionId: ID, model: 'opus' }]));
    await waitFor(() => expect(view()).toBe('effort'));
    expect(screen.getByText('set · the next init frame confirms it')).toBeTruthy(); // until an init frame reports it
    fireEvent.click(screen.getByRole('button', { name: 'Opus 5.5 (1M context) · Select model' }));
    expect(view()).toBe('model');
    expect(item(/^Opus/).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(item(/Default/));
    await waitFor(() => expect(calls('set_model').map((c) => c.input)).toEqual([{ appSessionId: ID, model: 'opus' }, { appSessionId: ID, model: null }]));
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

describe('an unstarted session writes its intent, with D-19’s route', () => {
  let offHook: () => void;
  afterEach(() => {
    offHook?.();
    useSetup.setState({ intents: new Map() });
  });

  function stub(over: Partial<SetupIntentHook['intent']> = {}) {
    const patches: unknown[] = [];
    let current: SetupIntentHook['intent'] = { location: { kind: 'directory', path: '/repo' }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null, ...over };
    const models = [
      { value: 'default', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'opus', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
      { value: 'claude/sol', resolvedModel: 'claude/sol', displayName: 'sol', description: 'From gateway', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    ];
    offHook = registerSetupIntentHook((id) =>
      id === INTENT_ID
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
    useSetup.setState({ intents: new Map([[INTENT_ID, intent({ gateway: 'gateway' })]]) });
    return patches;
  }

  it('a model choice drops an effort the model does not admit; the effort slider writes the intent', async () => {
    const patches = stub({ model: 'opus', effort: 'high' });
    mount('model', '', INTENT_ID);
    expect(screen.getByRole('radiogroup', { name: 'Route' })).toBeTruthy();
    fireEvent.click(item(/^Haiku/));
    await waitFor(() => expect(patches).toEqual([{ model: 'haiku', effort: null }]));
    expect(screen.getByText('Applies when the session starts')).toBeTruthy();
  });

  it('Direct on a gateway model asks for a Claude model first (pickDirectModel)', async () => {
    stub({ model: 'claude/sol' });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <GatewayDialogs />
      </QueryClientProvider>,
    );
    mount('model', '', INTENT_ID);
    fireEvent.click(screen.getByRole('radio', { name: /Direct/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });
});
