import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput } from '@shared/ipc/schema';
import { status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { builder } from '../model/test-events';
import { renderRow, rowOf, storeWith } from '../view/rows/test-support';

const holder = vi.hoisted(() => ({ client: null as ReturnType<typeof fakeClient>['client'] | null }));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: Parameters<ReturnType<typeof fakeClient>['client']['invoke']>) => holder.client!.invoke(...args) } }));
let fake: ReturnType<typeof fakeClient>;
beforeEach(() => { resetSurfaceRegistry(); fake = fakeClient(); holder.client = fake.client; });
afterEach(() => { cleanup(); resetSurfaceRegistry(); });

async function mounted(text: string) {
  const b = builder(); b.turn('u'); b.text('a', 0, text); b.end(['u']);
  const store = await storeWith(b.events);
  const id = store.key as AppSessionId;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  act(() => useTranscriptStore.getState().setOwnerLane(store.key, true));
  const view = renderRow(rowOf(store.rows(), 'assistant_text'), { storeKey: store.key });
  return { store, view };
}
const asks = () => (fake.invoked('session.ui.render') as CommandInput<'session.ui.render'>[]).filter((ask) => ask.component === 'AssistantMessage');

it('the owner lane never preempts an attached mod drawing or rewrites the stored text', async () => {
  const source = '<message>Original answer.</message>';
  const { store, view } = await mounted(source);
  expect(asks()).toHaveLength(1);
  expect(asks()[0].props.text).toBe(source);
  await act(() => fake.reply('session.ui.render', { hooked: true, rewritten: false, props: asks()[0].props, tree: { type: 'Markdown', props: { text: 'The mod decides **this** drawing.' } } }));
  expect(view.container.querySelector('[data-plugin-drawn]')?.textContent).toBe('The mod decides this drawing.');
  expect(view.container.querySelector('[data-owner-card], [data-owner-report]')).toBeNull();
  expect(rowOf(store.rows(), 'assistant_text').markdown).toBe(source);
});

it.each([false, true])('a mod that passes through the native body gets unboxed message ink (hooked=%s)', async (hooked) => {
  const { store, view } = await mounted('Before <message>for **you**</message> after.');
  expect(asks()).toHaveLength(1);
  await act(() => fake.reply('session.ui.render', { hooked, rewritten: false, props: asks()[0].props, tree: { type: 'engine', ref: 0 } }));
  expect(view.container.textContent).toBe('Before for you after.');
  expect(view.container.querySelector('.owner-message-ink')?.textContent).toContain('for ');
  expect(view.container.querySelectorAll('p')).toHaveLength(1);
  expect(view.container.querySelector('[data-owner-card], [data-owner-report]')).toBeNull();
  expect(useTranscriptStore.getState().entries[store.key].state.ui.assistantInk.has(rowOf(store.rows(), 'assistant_text').id)).toBe(true);
});

it('an empty mod drawing conceals native message text and does not claim fallback ink', async () => {
  const { store, view } = await mounted('<message>Hidden by the mod.</message>');
  expect(asks()).toHaveLength(1);
  await act(() => fake.reply('session.ui.render', { hooked: true, rewritten: false, props: asks()[0].props, tree: { type: 'Box', props: {}, children: [] } }));
  expect(view.container.querySelector('[data-engine-native]')?.getAttribute('aria-hidden')).toBe('true');
  expect(useTranscriptStore.getState().entries[store.key].state.ui.assistantInk.size).toBe(0);
});
