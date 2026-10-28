// The switch sheet and the Direct model choice (C11 execution document, Interfaces "Gateway", *The switch* and
// `pickDirectModel`): the background work named with `Stop them and switch`, the Claude group only, the confirm disabled
// until a model is picked on a gateway alias, the effort a chosen entry admits, and `pickDirectModel`'s dialog. The
// background work is C10's own disclosure over the live status; the catalogue is C10's `engine.models`; both sheets are
// small confirmation sheets in C10's geometry (Enter confirms when it can, Escape and Cancel answer null).
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { REGISTRY } from '@shared/ipc/registry';
import { addressingOf } from '@shared/machine/address';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { pageScenario } from '../test-support/shell-stores';
import { useSetup } from '../sessions/store';
import { useSessions } from '../stores/sessions';
import { intent } from '../test-support/setup-intents';
import { directChoice, pickDirectModel } from './direct-model';
import { GatewayDialogs, SwitchSheet } from './SwitchSheet';
import type { SwitchConfirm } from './store';

const ROOT = join(__dirname, '../../../..');
// P5 O6 M2: the backend (`window.maws`) is main, over the bare `READY`; the stores and the sheets hold the page's `ID`.
const READY = 'app-7412a115' as AppSessionId;
const ID = at(READY);
const addressing = addressingOf(REGISTRY);
const tasks: EngineSessionStatus['backgroundTasks'] = [
  { taskId: 't1' as never, taskType: 'local_agent', description: 'Sleep 120 s', ambient: false },
  { taskId: 't2' as never, taskType: 'local_workflow', description: 'Index the repository', ambient: false },
];
let backend: WidgetBackend;

beforeEach(() => {
  const s = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
  backend = createWidgetBackend({ root: ROOT, statuses: s.engine });
  window.maws = backend.bridge();
  const status = addressing.output('engine.sessions').lift([backend.status(READY)], TEST_MACHINE)[0]!;
  useSessions.setState({ engine: new Map([[ID, { ...status, effort: 'max', backgroundTasks: tasks }]]), records: new Map(pageScenario(s).sessions.map((r) => [r.appId, r])) });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map() });
  delete (window as { maws?: PreloadBridge }).maws;
});

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

describe('directChoice', () => {
  it('passes an effort only when the entry does not admit the current one: the highest admitted at or below it', () => {
    const sonnet = { value: 'sonnet', displayName: 'Sonnet 5', supportedEffortLevels: ['low', 'medium', 'high'] };
    expect(directChoice(sonnet, 'max')).toEqual({ model: 'sonnet', displayName: 'Sonnet 5', effort: 'high' });
    expect(directChoice(sonnet, 'medium')).toEqual({ model: 'sonnet', displayName: 'Sonnet 5', effort: null });
    expect(directChoice({ value: 'haiku', displayName: 'Haiku' }, 'max').effort, 'no levels listed: the whole vocabulary').toBeNull();
    expect(directChoice(sonnet, null).effort).toBeNull();
  });
});

describe('the switch sheet', () => {
  it('names the background work, lists the Claude group only, and enables Stop them and switch once a model is picked', async () => {
    const answer = vi.fn(() => true);
    const confirm: SwitchConfirm = { target: 'direct', backgroundTasks: tasks, requiresModel: true, model: null, effort: null };
    wrap(<SwitchSheet appSessionId={ID} confirm={confirm} error={null} answer={answer} />);
    const sheet = await screen.findByRole('dialog', { name: 'Switch this session to Direct?' });
    expect(within(sheet).getByText('These stop with the process and do not resume:')).toBeTruthy();
    const disclosure = within(sheet).getByRole('note'); // C10's BackgroundWorkDisclosure, the archive dialog's words
    expect(disclosure.textContent).toContain('2 background tasks are still running and will be stopped');
    expect(within(disclosure).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sleep 120 s', 'Index the repository']);
    const models = await within(sheet).findByRole('radiogroup', { name: 'Claude models' });
    const names = within(models).getAllByRole('radio').map((r) => r.firstChild?.textContent);
    // pass2/auto-routed seq 143: the five Claude rows, none of the seven claude/… rows
    expect(names).toEqual(['Opus 5.5 (1M context)Default', 'Opus 5.5 (1M context)', 'Fable 5.1', 'Sonnet 5', 'Haiku']); // W3: `default` named by what it runs, with its badge
    const button = within(sheet).getByRole('button', { name: 'Stop them and switch' }) as HTMLButtonElement;
    expect(button.disabled, 'no model picked yet').toBe(true);
    fireEvent.click(within(models).getByRole('radio', { name: /^Sonnet/ }));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    // Sonnet admits every level on 2.1.283, so the current `max` needs no effort override; the answer carries the work
    // the disclosure showed, which the recheck compares against
    expect(answer).toHaveBeenCalledWith(ID, { model: 'sonnet', displayName: 'Sonnet 5', effort: null, backgroundTasks: tasks });
    expect(backend.calls.filter((c) => c.command === 'engine.models').map((c) => c.input), "the direct route's catalogue for the session's directory").toEqual([{ refresh: false, gateway: 'direct', cwd: useSessions.getState().engine.get(ID)!.cwd }]);
  });

  it('opens on Cancel (a switch stops a process), answers the reply when its form is submitted, and null on Escape', async () => {
    const answer = vi.fn(() => true);
    useSessions.setState((s) => ({ engine: new Map(s.engine).set(ID, { ...s.engine.get(ID)!, backgroundTasks: [] }) }));
    wrap(<SwitchSheet appSessionId={ID} confirm={{ target: 'direct', backgroundTasks: [], requiresModel: false, model: null, effort: null }} error={null} answer={answer} />);
    const sheet = await screen.findByRole('dialog', { name: 'Switch this session to Direct?' });
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: 'Cancel' })));
    const button = within(sheet).getByRole('button', { name: 'Restart direct' });
    fireEvent.submit(button.closest('form')!);
    expect(answer).toHaveBeenCalledWith(ID, { model: null, displayName: null, effort: null, backgroundTasks: [] });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(answer).toHaveBeenLastCalledWith(ID, null));
  });

  it('a switch to the gateway needs no model and reads Restart routed; Cancel answers null', async () => {
    const answer = vi.fn(() => true);
    wrap(<SwitchSheet appSessionId={ID} confirm={{ target: 'gateway', backgroundTasks: [], requiresModel: false, model: null, effort: null }} error={null} answer={answer} />);
    const sheet = await screen.findByRole('dialog', { name: 'Switch this session to the gateway?' });
    expect(within(sheet).queryByRole('radiogroup')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.calls.filter((c) => c.command === 'engine.models' || c.command === 'session.listModels'), 'no catalogue read without a model to choose').toEqual([]);
    expect(within(sheet).getByText('Gateway models become available')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(answer).toHaveBeenCalledWith(ID, null);
  });
});

describe('pickDirectModel', () => {
  it('opens the Claude group with default preselected and answers the choice, or null on cancel', async () => {
    wrap(<GatewayDialogs />);
    const picked = pickDirectModel(ID);
    const dialog = await screen.findByRole('dialog', { name: 'Choose a Claude model' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { checked: true }).firstChild?.textContent).toBe('Opus 5.5 (1M context)Default')); // `default`, preselected
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Opus 5.5 \(1M context\)$/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this model' }));
    expect(await picked).toEqual({ model: 'opus', effort: null });

    const cancelled = pickDirectModel(ID);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(await cancelled).toBeNull();
  });

  // An unstarted session has neither a status nor a record: its current effort is its intent's, and a level the chosen
  // model does not admit is lowered as it is for a record (C10's relay card, Run direct on a gateway model).
  it("on an intent-only session, lowers the intent's effort the chosen model does not admit", async () => {
    const UNSTARTED = at(intent().appSessionId as AppSessionId);
    useSetup.setState({ intents: new Map([[UNSTARTED, intent({ appSessionId: UNSTARTED, model: 'claude/astra', effort: 'max' })]]) });
    backend.script('engine.models', () => ({ models: [{ value: 'sonnet', displayName: 'Sonnet 5', supportsAutoMode: true, supportedEffortLevels: ['low', 'medium', 'high'] }], source: 'cached', at: null }));
    wrap(<GatewayDialogs />);
    const picked = pickDirectModel(UNSTARTED);
    const dialog = await screen.findByRole('dialog', { name: 'Choose a Claude model' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { checked: true }).firstChild?.textContent).toBe('Sonnet 5'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this model' }));
    expect(await picked).toEqual({ model: 'sonnet', effort: 'high' });
    useSetup.setState({ intents: new Map() });
  });

  // L99 (P2-F): a model's auto verdict is the engine's alone. The built-in list (no engine has answered yet) claims none,
  // as the setup intent's conversion does; an engine-answered list keeps its own.
  it.each([
    { source: 'builtin' as const, caption: false },
    { source: 'cached' as const, caption: true },
    { source: 'live' as const, caption: true },
  ])("captions Haiku 'Cannot hold auto mode' only from an engine-answered list ($source)", async ({ source, caption }) => {
    backend.script('engine.models', () => ({
      models: [
        { value: 'sonnet', displayName: 'Sonnet 5', supportsAutoMode: true },
        { value: 'haiku', displayName: 'Haiku 4.5', supportsAutoMode: false },
      ],
      source,
      at: null,
    }));
    wrap(<GatewayDialogs />);
    const picked = pickDirectModel(ID);
    const dialog = await screen.findByRole('dialog', { name: 'Choose a Claude model' });
    const haiku = await within(dialog).findByRole('radio', { name: /^Haiku 4\.5/ });
    expect(haiku.textContent).toBe(caption ? 'Haiku 4.5Cannot hold auto mode' : 'Haiku 4.5');
    expect(within(dialog).getByRole('radio', { name: /^Sonnet 5/ }).textContent).toBe('Sonnet 5');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await picked).toBeNull();
  });
});
