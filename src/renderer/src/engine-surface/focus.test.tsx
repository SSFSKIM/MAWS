import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { invalidateSession, resetSurfaceRegistry } from './registry';
import { SurfaceSite } from './SurfaceSite';

const ID = 'fx1-focus' as AppSessionId;
const press = { plugin: 'mod', handle: 1 };
const tree = { type: 'Box', children: [
  { type: 'Input', props: { key: 'first', label: 'First', autoFocus: true }, press },
  { type: 'Button', props: { key: 'second', label: 'Second', autoFocus: true }, press },
] };
let fake: FakeClient;
beforeEach(() => {
  resetSurfaceRegistry();
  fake = fakeClient({ 'session.ui.render': { tree, props: {}, rewritten: false, hooked: true } });
  useSessions.setState({ engine: new Map([[ID, { ...status(ID), uiSurface: { clientId: 'maws-main' } }]]) });
});
afterEach(cleanup);
async function mount() {
  const view = render(<><button>Outside</button><div data-plugin-pane="pane" tabIndex={-1}><SurfaceSite appSessionId={ID} component="Pane" instanceId="pane" props={{}} client={fake.client} /></div></>);
  await act(async () => {});
  return view.container.querySelector<HTMLElement>('[data-plugin-pane]')!;
}
const focus = (name: string) => act(() => screen.getByRole(name === 'First' ? 'textbox' : 'button', { name }).focus());
const reply = (key: string | null, moved = true, deny: string | null = null) => act(() => fake.reply('session.ui.focus', { moved, element: key === null ? null : { plugin: 'mod', key }, deny }));
const push = (key: string) => act(() => fake.event('session.eventBatch', { appSessionId: ID, events: [{ kind: 'plugin.focus', component: 'Pane', instanceId: 'pane', plugin: 'mod', key }] }));

it('applies a focus redirect and a denial without echoing either back as another gesture', async () => {
  await mount();
  focus('First');
  await reply('second');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  expect(fake.invoked('session.ui.focus')).toHaveLength(1);
  focus('First');
  await reply('second', false, 'kept');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  expect(fake.invoked('session.ui.focus')).toHaveLength(2);
});

it('does not echo a plugin focus push or let a pending gesture overwrite it', async () => {
  await mount();
  focus('First');
  push('second');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  expect(fake.invoked('session.ui.focus')).toHaveLength(1);
  await reply('first');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
});

it('starts at the first autofocus element when the pane body takes the keyboard, by auto, not on mount or redraw', async () => {
  const host = await mount();
  expect(fake.invoked('session.ui.focus')).toHaveLength(0);
  act(() => host.focus());
  expect(fake.invoked('session.ui.focus')).toEqual([{ appSessionId: ID, component: 'Pane', instanceId: 'pane', isHeld: true, element: { plugin: 'mod', key: 'first' }, by: 'auto' }]);
  await reply('first');
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
  focus('Second');
  await reply('second');
  await act(async () => invalidateSession(ID));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  expect(fake.invoked('session.ui.focus')).toHaveLength(2);
});

it('restores an outside stop on denied entry and ignores an answer after the person leaves', async () => {
  await mount();
  focus('Outside');
  focus('First');
  await reply(null, false, 'no');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
  focus('First');
  focus('Outside');
  await reply('second');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
});
