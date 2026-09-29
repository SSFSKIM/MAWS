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
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { directChoice, pickDirectModel } from './direct-model';
import { GatewayDialogs, SwitchSheet } from './SwitchSheet';
import type { SwitchConfirm } from './store';

const ROOT = join(__dirname, '../../../..');
const READY = 'app-7412a115' as AppSessionId;
const tasks: EngineSessionStatus['backgroundTasks'] = [
  { taskId: 't1' as never, taskType: 'local_agent', description: 'Sleep 120 s', ambient: false },
  { taskId: 't2' as never, taskType: 'local_workflow', description: 'Index the repository', ambient: false },
];
let backend: WidgetBackend;

beforeEach(() => {
  const s = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
  backend = createWidgetBackend({ root: ROOT, statuses: s.engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[READY, { ...backend.status(READY), effort: 'max', backgroundTasks: tasks }]]), records: new Map(s.sessions.map((r) => [r.appId, r])) });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
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
    wrap(<SwitchSheet appSessionId={READY} confirm={confirm} error={null} answer={answer} />);
    const sheet = await screen.findByRole('dialog', { name: 'Switch this session to Direct?' });
    expect(within(sheet).getByText('These stop with the process and do not resume:')).toBeTruthy();
    const disclosure = within(sheet).getByRole('note'); // C10's BackgroundWorkDisclosure, the archive dialog's words
    expect(disclosure.textContent).toContain('2 background tasks are still running and will be stopped');
    expect(within(disclosure).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sleep 120 s', 'Index the repository']);
    const models = await within(sheet).findByRole('radiogroup', { name: 'Claude models' });
    const names = within(models).getAllByRole('radio').map((r) => r.firstChild?.textContent);
    // pass2/auto-routed seq 143: the five Claude rows, none of the seven claude/… rows
    expect(names).toEqual(['Default (recommended)', 'Opus 5.5 (1M context)', 'Fable 5.1', 'Sonnet 5', 'Haiku']);
    const button = within(sheet).getByRole('button', { name: 'Stop them and switch' }) as HTMLButtonElement;
    expect(button.disabled, 'no model picked yet').toBe(true);
    fireEvent.click(within(models).getByRole('radio', { name: /^Sonnet/ }));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    // Sonnet admits every level on 2.1.283, so the current `max` needs no effort override; the answer carries the work
    // the disclosure showed, which the recheck compares against
    expect(answer).toHaveBeenCalledWith(READY, { model: 'sonnet', displayName: 'Sonnet 5', effort: null, backgroundTasks: tasks });
    expect(backend.calls.filter((c) => c.command === 'engine.models').map((c) => c.input), "the direct route's catalogue").toEqual([{ refresh: false, gateway: 'direct' }]);
  });

  it('Enter confirms a sheet that can be confirmed; Escape answers null', async () => {
    const answer = vi.fn(() => true);
    useSessions.setState((s) => ({ engine: new Map(s.engine).set(READY, { ...s.engine.get(READY)!, backgroundTasks: [] }) }));
    wrap(<SwitchSheet appSessionId={READY} confirm={{ target: 'direct', backgroundTasks: [], requiresModel: false, model: null, effort: null }} error={null} answer={answer} />);
    const sheet = await screen.findByRole('dialog', { name: 'Switch this session to Direct?' });
    const button = within(sheet).getByRole('button', { name: 'Restart direct' });
    fireEvent.submit(button.closest('form')!);
    expect(answer).toHaveBeenCalledWith(READY, { model: null, displayName: null, effort: null, backgroundTasks: [] });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(answer).toHaveBeenLastCalledWith(READY, null));
  });

  it('a switch to the gateway needs no model and reads Restart routed; Cancel answers null', async () => {
    const answer = vi.fn(() => true);
    wrap(<SwitchSheet appSessionId={READY} confirm={{ target: 'gateway', backgroundTasks: [], requiresModel: false, model: null, effort: null }} error={null} answer={answer} />);
    const sheet = await screen.findByRole('dialog', { name: 'Switch this session to the gateway?' });
    expect(within(sheet).queryByRole('radiogroup')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.calls.filter((c) => c.command === 'engine.models' || c.command === 'session.listModels'), 'no catalogue read without a model to choose').toEqual([]);
    expect(within(sheet).getByText('Gateway models become available')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(answer).toHaveBeenCalledWith(READY, null);
  });
});

describe('pickDirectModel', () => {
  it('opens the Claude group with default preselected and answers the choice, or null on cancel', async () => {
    wrap(<GatewayDialogs />);
    const picked = pickDirectModel(READY);
    const dialog = await screen.findByRole('dialog', { name: 'Choose a Claude model' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { checked: true }).firstChild?.textContent).toMatch(/^Default/));
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Opus/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this model' }));
    expect(await picked).toEqual({ model: 'opus', effort: null });

    const cancelled = pickDirectModel(READY);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(await cancelled).toBeNull();
  });
});
