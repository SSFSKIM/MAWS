// R2: the render instances' registry and its React hook (registry.ts, site.ts): a site asks only while its session is
// attached, asks again when its props change and when the engine invalidates the session's trees, keeps one ask in
// flight, stops asking a site no plugin hooks until the next invalidate, and forgets a session's answers when its
// surface goes.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { resetSurfaceRegistry } from './registry';
import { connectEngineSurface, useSurfaceSite } from './site';
import { textOf } from './tree';

const ID = 'app-r2' as AppSessionId;
const band = (presses: number) => ({ tree: { type: 'Text', children: [`MODS_PROBE_BAND presses=${presses}`] }, props: {}, rewritten: false, hooked: true });
const UNHOOKED = { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: false };

function Band({ client, isWorking = false }: { client: FakeClient['client']; isWorking?: boolean }) {
  const answer = useSurfaceSite({ appSessionId: ID, component: 'AbovePrompt', instanceId: 'above-prompt', props: { isWorking }, client });
  return <p data-testid="band">{answer ? textOf(answer.tree) || (answer.hooked ? '' : 'unhooked') : 'none'}</p>;
}

const attach = (on: boolean) => act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...status(ID), ...(on && { uiSurface: { clientId: 'maws-main' } }) } }));
const invalidate = (fake: FakeClient) => act(() => fake.event('session.eventBatch', { appSessionId: ID, events: [{ id: `${ID}:L:9:0`, sessionId: 's', at: '2026-10-02T00:00:00.000Z', seq: 9, agentId: null, parentToolUseId: null, kind: 'plugin.invalidate', event: 'ui.render' } as SessionEvent] }));

let fake: FakeClient;
let disconnect: () => void;
beforeEach(() => {
  resetSurfaceRegistry();
  useSessions.setState({ engine: new Map() });
  fake = fakeClient();
  disconnect = connectEngineSurface(fake.client);
});
afterEach(() => {
  disconnect();
  cleanup();
});

describe('the render registry (R2)', () => {
  it('asks nothing while the session is not attached, then asks once it is', async () => {
    render(<Band client={fake.client} />);
    expect(fake.pending('session.ui.render')).toBe(0);
    attach(true);
    expect(fake.invoked('session.ui.render')).toEqual([{ appSessionId: ID, component: 'AbovePrompt', instanceId: 'above-prompt', props: { isWorking: false } }]);
    await act(() => fake.reply('session.ui.render', band(0)));
    expect(screen.getByTestId('band').textContent).toBe('MODS_PROBE_BAND presses=0');
  });

  it('re-asks every mounted instance of the session on plugin.invalidate, and draws the new answer', async () => {
    attach(true);
    render(<Band client={fake.client} />);
    await act(() => fake.reply('session.ui.render', band(0)));
    invalidate(fake);
    expect(fake.invoked('session.ui.render')).toHaveLength(2);
    await act(() => fake.reply('session.ui.render', band(1)));
    expect(screen.getByTestId('band').textContent).toBe('MODS_PROBE_BAND presses=1');
  });

  it('asks again when the props change, one ask in flight at a time, the last answer for the latest props', async () => {
    attach(true);
    const view = render(<Band client={fake.client} />);
    view.rerender(<Band client={fake.client} isWorking />);
    view.rerender(<Band client={fake.client} isWorking={false} />);
    view.rerender(<Band client={fake.client} isWorking />);
    expect(fake.pending('session.ui.render')).toBe(1); // the first ask is still in flight
    await act(() => fake.reply('session.ui.render', band(0)));
    expect(fake.invoked('session.ui.render').map((i) => (i as { props: unknown }).props)).toEqual([{ isWorking: false }, { isWorking: true }]);
    await act(() => fake.reply('session.ui.render', band(2)));
    expect(screen.getByTestId('band').textContent).toBe('MODS_PROBE_BAND presses=2');
  });

  it('stops asking a site no plugin hooks until the next invalidate', async () => {
    attach(true);
    const view = render(<Band client={fake.client} />);
    await act(() => fake.reply('session.ui.render', UNHOOKED));
    expect(screen.getByTestId('band').textContent).toBe('unhooked');
    view.rerender(<Band client={fake.client} isWorking />);
    expect(fake.invoked('session.ui.render')).toHaveLength(1);
    invalidate(fake);
    expect(fake.invoked('session.ui.render')).toHaveLength(2);
    await act(() => fake.reply('session.ui.render', band(0)));
    expect(screen.getByTestId('band').textContent).toBe('MODS_PROBE_BAND presses=0');
  });

  it('forgets the session’s answers when its status no longer carries the surface, and asks afresh at the next attach', async () => {
    attach(true);
    render(<Band client={fake.client} />);
    await act(() => fake.reply('session.ui.render', band(0)));
    act(() => fake.event('session.status', { appSessionId: ID, status: status(ID, { process: 'exited' }) }));
    attach(false);
    expect(screen.getByTestId('band').textContent).toBe('none');
    act(() => fake.event('session.status', { appSessionId: ID, status: { ...status(ID), uiSurface: { clientId: 'maws-main' } } }));
    attach(true);
    expect(fake.invoked('session.ui.render')).toHaveLength(2);
  });
});
