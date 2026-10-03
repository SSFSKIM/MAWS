import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { invalidateSession, resetSurfaceRegistry } from '../engine-surface/registry';
import { connectKeys } from '../keymap/dispatcher';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { RequestCard, type Placement } from './RequestCard';
import { fixtureRequest, itemFor } from './test-requests';

const APP = 'app-question-surface' as AppSessionId;
const question: Extract<SessionEvent, { kind: 'question.requested' }> = {
  ...(fixtureRequest('pass1', 'question-roundtrip', 137) as Extract<SessionEvent, { kind: 'question.requested' }>),
  questions: [{ question: 'Where should we deploy?', header: 'Deployment', multiSelect: false, options: [
    { label: 'Local', description: null, preview: null },
    { label: 'Cloud', description: 'Managed service', preview: null },
  ] }],
};
const rewritten = [{ question: 'Which region?', header: 'Region', multiSelect: false, options: [
  { label: 'Europe', description: 'EU region' }, { label: 'America', description: 'US region' },
] }];
let fake: FakeClient;
let drawing: unknown;
let disconnect: () => void;
beforeEach(() => {
  resetShellStores();
  resetSurfaceRegistry();
  drawing = { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: false };
  fake = fakeClient({ 'session.ui.render': () => drawing, 'session.answer': () => ({ outcome: 'delivered' }) });
  window.maws = fake.client;
  useSessions.getState().applyStatus({ appSessionId: APP, status: { ...status(APP), uiSurface: { clientId: 'maws-main' } } });
  disconnect = connectKeys();
});
afterEach(() => {
  cleanup();
  disconnect();
  resetSurfaceRegistry();
});
function mount(placement: Placement = 'inline') {
  return render(<article tabIndex={0}><RequestCard item={itemFor(question, APP)} request={question} placement={placement} paneIndex={0} /></article>);
}
const asks = () => fake.invoked('session.ui.render');
const answers = () => fake.invoked('session.answer');

it('asks with the tool-use identity and engine question shape, while an unhooked card still submits normally', async () => {
  mount();
  await waitFor(() => expect(asks()).toHaveLength(1));
  expect(asks()[0]).toMatchObject({ appSessionId: APP, component: 'AskUserQuestion', instanceId: question.toolUseId,
    props: { tool: 'AskUserQuestion', questions: [{ question: 'Where should we deploy?', header: 'Deployment', multiSelect: false, options: [
      { label: 'Local' }, { label: 'Cloud', description: 'Managed service' },
    ] }] },
  });
  expect(JSON.stringify(asks()[0])).not.toContain('"preview":null');
  expect(JSON.stringify(asks()[0])).not.toContain('"description":null');
  fireEvent.click(screen.getByRole('radio', { name: 'Local' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(answers()).toEqual([{ appSessionId: APP, requestId: question.requestId,
    answer: { kind: 'question', answers: { 'Where should we deploy?': 'Local' } },
  }]));
});

it('an engine slot renders rewritten questions and submits answers against those questions', async () => {
  drawing = { tree: { type: 'engine', ref: 0 }, props: { tool: 'AskUserQuestion', questions: rewritten }, rewritten: true, hooked: true };
  mount();
  await screen.findByRole('radio', { name: 'Europe' });
  expect(screen.queryByRole('radio', { name: 'Local' })).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Europe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(answers()).toEqual([{ appSessionId: APP, requestId: question.requestId,
    answer: { kind: 'question', answers: { 'Which region?': 'Europe' } },
  }]));
});

it('rewritten option sets cannot submit a previously picked option that is no longer displayed', async () => {
  drawing = { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: true };
  mount();
  await waitFor(() => expect(asks()).toHaveLength(1));
  fireEvent.click(screen.getByRole('radio', { name: 'Local' }));
  drawing = { tree: { type: 'engine', ref: 0 }, props: { tool: 'AskUserQuestion', questions: [{ ...rewritten[0], question: 'Where should we deploy?' }] }, rewritten: true, hooked: true };
  act(() => invalidateSession(APP));
  await screen.findByRole('radio', { name: 'Europe' });
  expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'America' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(answers()[0]).toMatchObject({ answer: { kind: 'question', answers: { 'Where should we deploy?': 'America' } } }));
});

it('a replacement tree replaces the whole card and concealed native controls cannot answer through ancestor shortcuts', async () => {
  drawing = { tree: { type: 'Text', children: ['Question handled by the mod'] }, props: {}, rewritten: false, hooked: true };
  mount('card');
  await screen.findByText('Question handled by the mod');
  expect(screen.queryByRole('heading', { name: 'Question' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  const owner = screen.getByRole('article');
  act(() => owner.focus());
  fireEvent.keyDown(owner, { key: '1' });
  fireEvent.keyDown(owner, { key: 'Enter' });
  fireEvent.keyDown(owner, { key: 'Escape' });
  await act(async () => {});
  expect(answers()).toEqual([]);
});

it('a native docked card takes pane focus, then relinquishes it when a mod conceals the card', async () => {
  drawing = { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: true };
  const scene = (card: boolean) => <section data-pane={0}>
    <button type="button">Composer</button>
    {card && <RequestCard item={itemFor(question, APP)} request={question} placement="docked" paneIndex={0} />}
  </section>;
  const view = render(scene(false));
  const composer = screen.getByRole('button', { name: 'Composer' });
  act(() => composer.focus());
  view.rerender(scene(true));
  expect(document.activeElement).toBe(view.container.querySelector('[data-docked-frame]'));
  await waitFor(() => expect(asks()).toHaveLength(1));
  drawing = { tree: { type: 'Text', children: ['Mod is asking instead'] }, props: {}, rewritten: false, hooked: true };
  act(() => invalidateSession(APP));
  await screen.findByText('Mod is asking instead');
  expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(composer));
});

it.each(['option', 'free text'])('preserves a valid %s answer through a header-only rewrite', async (kind) => {
  drawing = { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: true };
  mount();
  await waitFor(() => expect(asks()).toHaveLength(1));
  if (kind === 'option') fireEvent.click(screen.getByRole('radio', { name: 'Local' }));
  else {
    fireEvent.click(screen.getByRole('radio', { name: 'Other…' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private datacenter' } });
  }
  drawing = { tree: { type: 'engine', ref: 0 }, props: { tool: 'AskUserQuestion', questions: [{
    question: 'Where should we deploy?', header: 'Choose deployment', multiSelect: false,
    options: [{ label: 'Local' }, { label: 'Cloud', description: 'Managed service' }],
  }] }, rewritten: true, hooked: true };
  act(() => invalidateSession(APP));
  await screen.findByText('Choose deployment');
  if (kind === 'option') expect(screen.getByRole('radio', { name: 'Local' }).getAttribute('aria-checked')).toBe('true');
  else expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Private datacenter');
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(answers()[0]).toMatchObject({ answer: {
    kind: 'question', answers: { 'Where should we deploy?': kind === 'option' ? 'Local' : 'Private datacenter' },
  } }));
});

it('a hover preview never registers an interactive question surface', async () => {
  mount('hover');
  await act(async () => {});
  expect(asks()).toEqual([]);
});

it('a detached session uses the native card without asking for a surface', async () => {
  useSessions.getState().applyStatus({ appSessionId: APP, status: status(APP, { process: 'exited' }) });
  mount();
  await act(async () => {});
  expect(asks()).toEqual([]);
  expect(screen.getByRole('radio', { name: 'Local' })).toBeTruthy();
});
