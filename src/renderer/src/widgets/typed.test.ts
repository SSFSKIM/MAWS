// A typed `/<widget> <args>` at Enter (the architect's correction of 2026-09-29): a fully resolved argument applies
// through the widget's own control and toasts the outcome in the widget's words; anything else answers false, and the
// editor opens the widget with its argument. Model, effort, permissions and fast, both cases each.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useComposerStore } from '../stores/composer';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { resetModelRequests } from './model';
import { TYPED_APPLY } from './typed';

const ROOT = join(__dirname, '../../../..');
const READY = 'app-7412a115' as AppSessionId; // ready, idle, routed, auto, on Sonnet
let backend: WidgetBackend;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
  // the sessions store follows the backend's statuses, as connectShell does in the app
  useSessions.setState({ engine: new Map([[READY, backend.status(READY)]]) });
  window.maws.on('session.status', (event) => useSessions.getState().applyStatus(event));
});
afterEach(() => {
  delete (window as { maws?: MawsBridge }).maws;
  useSessions.setState({ engine: new Map() });
  useComposerStore.setState({ models: new Map() });
  useNotices.setState({ notices: [] });
  resetModelRequests();
});

const controls = (command: string) => backend.calls.filter((c) => c.command === command).map((c) => c.input);
const toasts = () => useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => [n.level, n.text]);
const toastSoon = () => expect.poll(toasts);
const setStatus = (patch: Partial<EngineSessionStatus>) => useSessions.setState({ engine: new Map([[READY, backend.emitStatus(READY, patch)]]) });

describe('model', () => {
  it('/model opus applies set_model and toasts the widget’s words', async () => {
    expect(await TYPED_APPLY.model!(READY, 'opus')).toBe(true);
    await toastSoon().toEqual([['info', 'Model · Opus 5.5 (1M context) · set · the next init frame confirms it']]);
    expect(controls('session.setModel')).toEqual([{ appSessionId: READY, model: 'opus' }]);
  });

  it('opens instead for an unknown name, a gateway model in auto (its local-lane note first), or no ready process', async () => {
    expect(await TYPED_APPLY.model!(READY, 'hiaku')).toBe(false);
    expect(await TYPED_APPLY.model!(READY, 'claude/astra')).toBe(false);
    setStatus({ process: 'exited' });
    expect(await TYPED_APPLY.model!(READY, 'opus')).toBe(false);
    expect(controls('session.setModel')).toEqual([]);
  });

  // M4 fix wave re-review, carried Minor: applied in auto, a model that cannot hold it says so, as the widget's caption does
  it('/model haiku in auto appends the widget’s Cannot hold auto mode caption to its toast', async () => {
    setStatus({ permissionMode: { requested: 'auto', effective: 'auto', refusal: null } });
    expect(await TYPED_APPLY.model!(READY, 'haiku')).toBe(true);
    await toastSoon().toEqual([['info', 'Model · Haiku · set · the next init frame confirms it · Cannot hold auto mode · runs in default']]);
    useNotices.setState({ notices: [] });
    setStatus({ permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    expect(await TYPED_APPLY.model!(READY, 'haiku')).toBe(true);
    await toastSoon().toEqual([['info', 'Model · Haiku · set · the next init frame confirms it']]);
  });

  // M4 fix wave re-review, carried Minor: the editor stops waiting after a short bound and opens the widget, so a
  // decision that arrives later is too late and applies nothing
  it('a decision the editor stopped waiting for applies nothing and answers false', async () => {
    const late = new AbortController();
    const deciding = TYPED_APPLY.model!(READY, 'opus', late.signal); // the catalogue is not held: one list_models first
    late.abort();
    expect(await deciding).toBe(false);
    expect(controls('session.setModel')).toEqual([]);
    const done = new AbortController();
    done.abort();
    for (const [name, args] of [['effort', 'high'], ['fast', 'off'], ['permissions', 'acceptEdits']] as const) expect(await TYPED_APPLY[name]!(READY, args, done.signal), name).toBe(false);
    expect(backend.calls.map((c) => c.command).filter((c) => c !== 'session.listModels')).toEqual([]);
  });

  it('a refused set_model toasts the code in words with the engine’s error', async () => {
    backend.script('session.setModel', () => ({ ok: false, error: 'not here', code: 'catalog_unknown' }));
    expect(await TYPED_APPLY.model!(READY, 'haiku')).toBe(true);
    await toastSoon().toEqual([['warning', "Not in the engine's catalogue · not here"]]);
  });
});

describe('effort', () => {
  it('/effort high applies set_effort; /effort auto clears to the engine default', async () => {
    expect(await TYPED_APPLY.effort!(READY, 'high')).toBe(true);
    expect(await TYPED_APPLY.effort!(READY, 'auto')).toBe(true);
    await toastSoon().toEqual([
      ['info', 'Effort · high · set · the next init frame confirms it'],
      ['info', 'Effort · Engine default · set · the next init frame confirms it'],
    ]);
    expect(controls('session.setEffort')).toEqual([{ appSessionId: READY, effort: 'high' }, { appSessionId: READY, effort: null }]);
  });

  it('opens instead for a level that is not one', async () => {
    expect(await TYPED_APPLY.effort!(READY, 'extreme')).toBe(false);
    expect(controls('session.setEffort')).toEqual([]);
  });

  it('a rejected invoke toasts the transport words', async () => {
    useComposerStore.setState({ models: new Map([[READY, []]]) }); // the catalogue held, so the one invoke is the control's
    window.maws = { ...window.maws, invoke: async () => ({ ok: false, error: { code: 'timeout', message: 'late' } }) } as unknown as MawsBridge;
    expect(await TYPED_APPLY.effort!(READY, 'low')).toBe(true);
    await toastSoon().toEqual([['warning', 'The engine did not answer · showing the last value it reported']]);
  });
});

describe('permissions', () => {
  it('/permissions acceptEdits applies set_permission_mode and toasts the mode', async () => {
    expect(await TYPED_APPLY.permissions!(READY, 'acceptEdits')).toBe(true);
    await toastSoon().toEqual([['info', 'Permission mode · acceptEdits']]);
    expect(controls('session.setPermissionMode')).toEqual([{ appSessionId: READY, mode: 'acceptEdits' }]);
  });

  it('a refusal toasts its words (auto on Haiku, auto-routed seq 156)', async () => {
    setStatus({ model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' }, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    expect(await TYPED_APPLY.permissions!(READY, 'auto')).toBe(true);
    await toastSoon().toEqual([['warning', 'This model does not support auto mode']]);
  });

  it('opens instead for bypassPermissions (it asks first) and for a word that is no mode', async () => {
    expect(await TYPED_APPLY.permissions!(READY, 'bypassPermissions')).toBe(false);
    expect(await TYPED_APPLY.permissions!(READY, 'yolo')).toBe(false);
    expect(controls('session.setPermissionMode')).toEqual([]);
  });
});

describe('fast', () => {
  it('/fast off on Opus applies apply_flag_settings { fastMode: false }', async () => {
    setStatus({ model: { requested: 'opus', resolved: 'claude-opus-5-5[1m]' } });
    expect(await TYPED_APPLY.fast!(READY, 'off')).toBe(true);
    await toastSoon().toEqual([['info', 'Fast mode · off · set · the next init frame confirms it']]);
    expect(controls('session.applyFlagSettings')).toEqual([{ appSessionId: READY, settings: { fastMode: false } }]);
  });

  it('opens instead for /fast on (its lane warning first) and on a model without fast mode', async () => {
    setStatus({ model: { requested: 'opus', resolved: 'claude-opus-5-5[1m]' } });
    expect(await TYPED_APPLY.fast!(READY, 'on')).toBe(false);
    setStatus({ model: { requested: 'sonnet', resolved: 'claude-sonnet-5[1m]' } });
    expect(await TYPED_APPLY.fast!(READY, 'off')).toBe(false);
    expect(controls('session.applyFlagSettings')).toEqual([]);
  });
});
