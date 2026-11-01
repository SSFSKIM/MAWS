// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §I): the Browser tool reads whether the
// session's agent has a browser on its machine from the session's capabilities, and follows their changes; a machine
// that answers none (an older mawsd) shows what it showed before: nothing.
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { at, OTHER_MACHINE } from '../../../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import type { MachineState } from '@shared/ipc/schema/machines';
import { useMachines } from '../../../stores/machines';
import { AgentBrowserNotice, useAgentBrowser } from './capability';

const A = at('app-a' as AppSessionId);
const B = at('app-b' as AppSessionId);
const NONE = { available: false, reason: 'no browser is attached on mini' };

afterEach(() => {
  cleanup();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

const R = addressOf(OTHER_MACHINE, 'app-r') as AppSessionId; // a session on another machine, reached over its link
const other = (state: MachineState['state'], generation: number) =>
  act(() => useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'studio', local: false, state, since: '2026-11-01T00:00:00.000Z', generation }]));

describe('the agent\'s browser capability', () => {
  it('reads the session\'s browser entry, then follows its changes and no other session\'s', async () => {
    const fake = fakeClient();
    const { result } = renderHook(() => useAgentBrowser(A, fake.client));
    expect(result.current).toBeNull();
    expect(fake.invoked('session.capabilities')).toEqual([{ appSessionId: A }]);
    await act(() => fake.reply('session.capabilities', { artifact_screenshot: { available: true }, browser: NONE }));
    expect(result.current).toEqual(NONE);
    act(() => fake.event('session.capabilitiesChanged', { appSessionId: B, capabilities: { browser: { available: true } } }));
    expect(result.current).toEqual(NONE);
    act(() => fake.event('session.capabilitiesChanged', { appSessionId: A, capabilities: { browser: { available: true } } }));
    expect(result.current).toEqual({ available: true });
  });

  it('a view that moves A, B, then back to A takes A\'s fresh answer, not the reading it had of A before', async () => {
    const fake = fakeClient();
    const { result, rerender } = renderHook(({ id }) => useAgentBrowser(id, fake.client), { initialProps: { id: A } });
    await act(() => fake.reply('session.capabilities', { browser: NONE }));
    rerender({ id: B });
    rerender({ id: A });
    await act(() => fake.reply('session.capabilities', { browser: { available: true } }, 1)); // A's second asking
    expect(result.current).toEqual({ available: true });
    await act(() => fake.reply('session.capabilities', { browser: NONE })); // B's, answered late: not A's
    expect(result.current).toEqual({ available: true });
  });

  // The panel's scalpel-4#1: the machine's link replays no event it missed while it was down, so a reading is asked again
  // at each new generation of the session's machine link, and a refused one is asked again there
  it('asks again when the session\'s machine link comes back as a new generation, and shows the fresh answer', async () => {
    other('up', 1);
    const fake = fakeClient();
    const { result } = renderHook(() => useAgentBrowser(R, fake.client));
    await act(() => fake.reply('session.capabilities', { browser: NONE }));
    expect(result.current).toEqual(NONE);
    other('down', 1); // the browser attaches over there meanwhile: its event is not heard here
    expect(fake.pending('session.capabilities'), 'nothing is asked while the link is down').toBe(0);
    other('up', 2);
    expect(fake.invoked('session.capabilities')).toEqual([{ appSessionId: R }, { appSessionId: R }]);
    await act(() => fake.reply('session.capabilities', { browser: { available: true } }));
    expect(result.current).toEqual({ available: true });
  });

  it('a first asking refused while the session\'s machine link is down is asked again when it comes up', async () => {
    other('connecting', 0);
    const fake = fakeClient();
    const { result } = renderHook(() => useAgentBrowser(R, fake.client));
    expect(fake.pending('session.capabilities'), 'nothing is asked before the link is up').toBe(0);
    other('up', 1);
    await act(() => fake.fail('session.capabilities', 'the machine is unreachable', 'host_unavailable'));
    expect(result.current).toBeNull();
    other('down', 1);
    other('up', 2);
    await act(() => fake.reply('session.capabilities', { browser: NONE }));
    expect(result.current).toEqual(NONE);
  });

  it('asks again each time the local machine\'s host is heard (its daemon back), a refused asking included', async () => {
    const fake = fakeClient();
    const { result } = renderHook(() => useAgentBrowser(A, fake.client));
    await act(() => fake.fail('session.capabilities', 'mawsd is restarting', 'host_unavailable'));
    expect(result.current).toBeNull();
    act(() => fake.event('host.status', {}, OTHER_MACHINE)); // another machine's host: not this session's
    expect(fake.pending('session.capabilities')).toBe(0);
    act(() => fake.event('host.status', {}));
    await act(() => fake.reply('session.capabilities', { browser: NONE }));
    expect(result.current).toEqual(NONE);
    act(() => fake.event('host.status', {})); // a missed attachment while it was away
    await act(() => fake.reply('session.capabilities', { browser: { available: true } }));
    expect(result.current).toEqual({ available: true });
    expect(fake.invoked('session.capabilities')).toHaveLength(3);
  });

  it('is unknown where the machine answers no capabilities', async () => {
    const fake = fakeClient();
    const { result } = renderHook(() => useAgentBrowser(A, fake.client));
    await act(() => fake.fail('session.capabilities', 'unknown command: session.capabilities', 'unknown_command'));
    expect(result.current).toBeNull();
  });

  it('a notice says why the agent has no browser, and nothing shows while it has one or it is unknown', async () => {
    const fake = fakeClient();
    render(<AgentBrowserNotice appSessionId={A} client={fake.client} />);
    expect(screen.queryByRole('status')).toBeNull();
    await act(() => fake.reply('session.capabilities', { browser: NONE }));
    expect(screen.getByRole('status').textContent).toBe('The agent has no browser here: no browser is attached on mini');
    act(() => fake.event('session.capabilitiesChanged', { appSessionId: A, capabilities: { browser: { available: true } } }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
