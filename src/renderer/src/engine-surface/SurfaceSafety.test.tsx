import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { invalidateSession, resetSurfaceRegistry } from './registry';
import { SurfaceRow } from './SurfaceRow';
import { SurfaceSite } from './SurfaceSite';

// A downstream renderer fault, after a valid tree has passed the parser.
vi.mock('../transcript', () => ({ Markdown: ({ markdown }: { markdown: string }) => {
  if (markdown === 'fault') throw new Error('drawing failed');
  return <p>{markdown}</p>;
} }));
const ID = 'fx1-safety' as AppSessionId;
const props = { text: 'native', isFirstOfReply: true };
const answer = (tree: unknown) => ({ tree, props, hooked: true, rewritten: false });
const native = { type: 'engine', ref: 0 };
let fake: FakeClient;
beforeEach(() => {
  resetSurfaceRegistry();
  fake = fakeClient();
  useSessions.setState({ engine: new Map([[ID, { ...status(ID), uiSurface: { clientId: 'maws-main' } }]]) });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const reply = (tree: unknown) => act(() => fake.reply('session.ui.render', answer(tree)));
function Row({ id = 'a' }: { id?: string }) {
  return <SurfaceRow appSessionId={ID} component="AssistantMessage" instanceId={id} props={props} client={fake.client}>{() => <button>native</button>}</SurfaceRow>;
}

it.each(['render failed', 'render timed out after 8000ms'])('releases a withheld row when %s and recovers on invalidate', async (message) => {
  const first = render(<Row />);
  await reply(native);
  first.unmount();
  render(<Row id="failed" />);
  expect(screen.queryByRole('button')).toBeNull();
  await act(() => fake.fail('session.ui.render', message));
  expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
  expect(screen.queryByText('…')).toBeNull();
  act(() => invalidateSession(ID));
  await reply({ type: 'Text', children: ['recovered drawing'] });
  expect(screen.getByText('recovered drawing')).toBeTruthy();
});

it.each(['site', 'row'])('contains a %s drawing fault, exposes native content, reports once and recovers on a new answer', async (kind) => {
  render(<><p>window survives</p>{kind === 'row' ? <Row /> : <SurfaceSite appSessionId={ID} component="Pane" instanceId="pane" props={{}} client={fake.client} engine={<button>native</button>} />}</>);
  await reply({ type: 'Markdown', props: { text: 'fault' } });
  expect(screen.getByText('window survives')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
  expect(screen.getByRole('button').closest('[inert]')).toBeNull();
  expect(console.warn).toHaveBeenCalledTimes(1);
  act(() => invalidateSession(ID));
  await reply({ type: 'Text', children: ['recovered drawing'] });
  expect(screen.getByText('recovered drawing')).toBeTruthy();
  act(() => invalidateSession(ID));
  await reply({ type: 'Markdown', props: { text: 'fault' } });
  expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
  expect(console.warn).toHaveBeenCalledTimes(1);
});
