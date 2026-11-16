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
import { forgetSession, invalidateSession, resetSurfaceRegistry } from './registry';
import { connectEngineSurface, useSurfaceSite } from './site';
import { textOf } from './tree';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { remoteRow } from '../../../../test/support/builders';
import { addressOf } from '@shared/machine/address';

const ID = 'app-r2' as AppSessionId;
const band = (presses: number) => ({ tree: { type: 'Text', children: [`MODS_PROBE_BAND presses=${presses}`] }, props: {}, rewritten: false, hooked: true });
const UNHOOKED = { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: false };

function Band({ client, isWorking = false, instanceId = 'above-prompt', appSessionId = ID }: { client: FakeClient['client']; isWorking?: boolean; instanceId?: string; appSessionId?: AppSessionId }) {
  const answer = useSurfaceSite({ appSessionId, component: 'AbovePrompt', instanceId, props: { isWorking }, client });
  return <p data-testid="band">{answer ? textOf(answer.tree) || (answer.hooked ? '' : 'unhooked') : 'none'}</p>;
}

const attach = (on: boolean) => act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...status(ID), ...(on && { uiSurface: { clientId: 'maws-main' } }) } }, TEST_MACHINE));
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

  it('an invalidate while an ask is in flight outranks that ask’s unhooked answer: the queued re-ask runs and draws', async () => {
    attach(true);
    render(<Band client={fake.client} />);
    invalidate(fake); // a plugin loaded while the first ask was out
    await act(() => fake.reply('session.ui.render', UNHOOKED));
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

// R3 shares component hook knowledge across virtualized instances, not their answers.
describe('row registry lifecycle', () => {
  it('new instances of an unhooked component draw native without asking until invalidation', async () => {
    attach(true);
    const first = render(<Band client={fake.client} />);
    await act(() => fake.reply('session.ui.render', UNHOOKED));
    first.unmount();
    render(<Band client={fake.client} instanceId="later" />);
    expect(screen.getByTestId('band').textContent).toBe('unhooked');
    expect(fake.invoked('session.ui.render')).toHaveLength(1);
    invalidate(fake);
    expect(fake.invoked('session.ui.render')).toHaveLength(2);
  });

  it('keeps a non-row site’s accepted drawing mounted while changed props are being answered', async () => {
    attach(true);
    const view = render(<Band client={fake.client} />);
    await act(() => fake.reply('session.ui.render', band(1)));
    view.rerender(<Band client={fake.client} isWorking />);
    expect(screen.getByTestId('band').textContent).toBe('MODS_PROBE_BAND presses=1');
    await act(() => fake.reply('session.ui.render', band(2)));
    expect(screen.getByTestId('band').textContent).toBe('MODS_PROBE_BAND presses=2');
  });

  it('never publishes the response for old props while the latest ask is pending', async () => {
    attach(true);
    const view = render(<Band client={fake.client} />);
    view.rerender(<Band client={fake.client} isWorking />);
    await act(() => fake.reply('session.ui.render', band(1)));
    expect(screen.getByTestId('band').textContent).toBe('none');
    await act(() => fake.reply('session.ui.render', band(2)));
    expect(screen.getByTestId('band').textContent).toBe('MODS_PROBE_BAND presses=2');
  });

  it('process loss discards an outstanding answer and its queued ask even before a ready status was observed', async () => {
    attach(true);
    render(<Band client={fake.client} />);
    act(() => invalidateSession(ID));
    act(() => fake.event('session.status', { appSessionId: ID, status: status(ID, { process: 'exited' }) }));
    await act(() => fake.reply('session.ui.render', band(9)));
    expect(screen.getByTestId('band').textContent).toBe('none');
    expect(fake.invoked('session.ui.render')).toHaveLength(1);
    act(() => forgetSession(ID));
  });
});

// P5 O7 M8 review ("The offer audit and its contract"): `session.ui.render` is declared not offered on another machine
// reached over RL2, so a site of such a session asks nothing and draws as no plugin hooked it (the stock rendering)
describe('a site of a session on another machine', () => {
  it('asks nothing and draws unhooked', async () => {
    const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
    try {
      act(() => useSessions.getState().applyStatus({ appSessionId: R, status: { ...status(R), uiSurface: { clientId: 'maws-main' } } }, OTHER_MACHINE));
      render(<Band client={fake.client} appSessionId={R} />);
      invalidate(fake);
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(fake.invoked('session.ui.render')).toEqual([]);
      expect(screen.getByTestId('band').textContent).toBe('unhooked');
    } finally {
      useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    }
  });
});

// UX wave U2b, M5 (the execution document, §E and §F): a site the wire's closed set does not name, the turn's line, is
// asked through `session.ui.renderSite`; an engine host of an earlier build answers `unknown_command`, and the session's
// such sites draw MAWS's own from then on, asking nothing again until its surface goes. A status whose plugins were
// observed anew re-asks the session's mounted sites as an invalidation does (check 1's C4: a reload may push nothing).
describe('the second command, and the re-ask after a reload (M5)', () => {
  function Line({ client, instanceId = 'u1~turn' }: { client: FakeClient['client']; instanceId?: string }) {
    const answer = useSurfaceSite({ appSessionId: ID, component: 'TurnDuration', instanceId, props: { word: 'Worked', durationMs: 1000, isExpanded: true }, client });
    return <p data-testid={instanceId}>{answer ? (answer.hooked ? textOf(answer.tree) || 'empty' : 'unhooked') : 'none'}</p>;
  }
  // what main reports, to the store and to the connection: the surface on or gone, and when the plugins were observed
  const report = (on: boolean, at: string | null = null) => act(() => {
    const event = { appSessionId: ID, status: { ...status(ID), ...(on && { uiSurface: { clientId: 'maws-main' } }), pluginsObservedAt: at } };
    useSessions.getState().applyStatus(event, TEST_MACHINE);
    fake.event('session.status', event);
  });
  const observed = (at: string) => report(true, at);

  it('asks the turn’s line through session.ui.renderSite, never session.ui.render', async () => {
    attach(true);
    render(<Line client={fake.client} />);
    expect(fake.invoked('session.ui.renderSite')).toEqual([{ appSessionId: ID, component: 'TurnDuration', instanceId: 'u1~turn', props: { word: 'Worked', durationMs: 1000, isExpanded: true } }]);
    expect(fake.invoked('session.ui.render')).toEqual([]);
    await act(() => fake.reply('session.ui.renderSite', { tree: { type: 'Text', children: ['line'] }, props: {}, rewritten: false, hooked: true }));
    expect(screen.getByTestId('u1~turn').textContent).toBe('line');
  });

  it('an earlier engine host’s unknown_command draws MAWS’s own for every such site of the session, asked no more until its surface goes', async () => {
    attach(true);
    render(<><Line client={fake.client} /><Line client={fake.client} instanceId="u2~turn" /></>);
    await act(() => fake.fail('session.ui.renderSite', 'unknown command', 'unknown_command'));
    expect(screen.getByTestId('u1~turn').textContent).toBe('unhooked');
    await act(() => fake.fail('session.ui.renderSite', 'unknown command', 'unknown_command'));
    invalidate(fake);
    expect(fake.pending('session.ui.renderSite')).toBe(0);
    expect(screen.getByTestId('u2~turn').textContent).toBe('unhooked');
    report(false);
    report(true); // a surface again: it may be another engine host's
    expect(fake.pending('session.ui.renderSite')).toBe(2);
  });

  // Fix wave 1 (review Important 2): a session already running when the window opened is read into the sessions store
  // from `engine.sessions` (`applyStatuses`), no `session.status` event among it. Its first reload is still a reload.
  it('a session hydrated from the snapshot alone: its first reload, which pushes nothing, re-asks the mounted sites', async () => {
    act(() => useSessions.getState().applyStatuses([{ ...status(ID), uiSurface: { clientId: 'maws-main' }, pluginsObservedAt: '2026-11-16T10:00:00.000Z' }], TEST_MACHINE));
    render(<Line client={fake.client} />);
    await act(() => fake.reply('session.ui.renderSite', { tree: { type: 'Text', children: ['before'] }, props: {}, rewritten: false, hooked: true }));
    expect(fake.pending('session.ui.renderSite')).toBe(0);
    observed('2026-11-16T10:05:00.000Z'); // the reload: a status with the plugins observed anew, and no invalidation
    expect(fake.pending('session.ui.renderSite')).toBe(1);
    await act(() => fake.reply('session.ui.renderSite', { tree: { type: 'Text', children: ['after'] }, props: {}, rewritten: false, hooked: true }));
    expect(screen.getByTestId('u1~turn').textContent).toBe('after');
  });

  it('a status whose plugins were observed anew re-asks the mounted sites; the same report asks nothing', async () => {
    observed('2026-11-16T10:00:00.000Z');
    render(<Line client={fake.client} />);
    await act(() => fake.reply('session.ui.renderSite', { tree: { type: 'Text', children: ['before'] }, props: {}, rewritten: false, hooked: true }));
    observed('2026-11-16T10:00:00.000Z');
    expect(fake.pending('session.ui.renderSite')).toBe(0);
    observed('2026-11-16T10:05:00.000Z');
    expect(fake.pending('session.ui.renderSite')).toBe(1);
    await act(() => fake.reply('session.ui.renderSite', { tree: { type: 'Text', children: ['after'] }, props: {}, rewritten: false, hooked: true }));
    expect(screen.getByTestId('u1~turn').textContent).toBe('after');
  });
});
