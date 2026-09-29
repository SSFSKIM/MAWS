import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import type { ProjectId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { createSession, isSessionCreatorRegistered } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { connectScenarioSessionCreator } from './scenario-session-creator';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the scenario’s session creator', () => {
  afterEach(() => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    useSessions.setState({ unstarted: new Map(), records: new Map() });
  });

  it('registers in launch mode scenario and allocates a fresh id with no record each time', async () => {
    const off = connectScenarioSessionCreator(fakeClient({ 'session.launchMode': { mode: 'scenario' } }).client);
    await settle();
    expect(isSessionCreatorRegistered()).toBe(true);
    await createSession('proj-maws' as ProjectId);
    await createSession(null);
    const ids = [...useSessions.getState().unstarted.keys()];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(useSessions.getState().records.size).toBe(0);
    off();
    expect(isSessionCreatorRegistered()).toBe(false);
  });

  it('registers nothing in launch mode index, or when main does not answer', async () => {
    const index = connectScenarioSessionCreator(fakeClient({ 'session.launchMode': { mode: 'index' } }).client);
    await settle();
    expect(isSessionCreatorRegistered()).toBe(false);
    index();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = fakeClient();
    const off = connectScenarioSessionCreator(failing.client);
    await failing.fail('session.launchMode');
    expect(isSessionCreatorRegistered()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    off();
    warn.mockRestore();
  });

  it('a disconnect before main answers registers nothing', async () => {
    const fake = fakeClient();
    const off = connectScenarioSessionCreator(fake.client);
    off();
    await fake.reply('session.launchMode', { mode: 'scenario' });
    expect(isSessionCreatorRegistered()).toBe(false);
  });
});
