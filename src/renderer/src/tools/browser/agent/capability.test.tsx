// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §I): the Browser tool reads whether the
// session's agent has a browser on its machine from the session's capabilities, and follows their changes; a machine
// that answers none (an older mawsd) shows what it showed before: nothing.
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { at } from '../../../../../../test/support/machine';
import { AgentBrowserNotice, useAgentBrowser } from './capability';

const A = at('app-a' as AppSessionId);
const B = at('app-b' as AppSessionId);
const NONE = { available: false, reason: 'no browser is attached on mini' };

afterEach(cleanup);

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
