// P5 O6 M4 (the task review): the plugin CLI runs on this machine until O4 spans machines, so a session of another machine
// never has its directory read or changed here as if it were this machine's.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { useSessions } from '../stores/sessions';
import { preloadOf } from '../test-support/preload-of';
import { forgetKeptOperations } from './plugins/operation';
import { PluginsWidget } from './PluginsWidget';
import { SkillsWidget } from './SkillsWidget';

const B = addressOf(OTHER_MACHINE, 'session-b' as AppSessionId);
let fake: FakeClient;
beforeEach(() => {
  fake = fakeClient({ 'plugins.env': { binary: null, binaryError: 'Unavailable', configHome: '/config', globalConfig: '/config/.claude.json' } });
  window.maws = preloadOf(fake);
  useSessions.setState({ records: new Map([[B, { ...record('session-b', { directory: '/same' }), appId: B }]]), engine: new Map([[B, { ...status('session-b'), appSessionId: B, cwd: '/same' }]]) });
});
afterEach(() => {
  cleanup();
  forgetKeptOperations();
  useSessions.setState({ records: new Map(), engine: new Map() });
});
const mount = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

it('/plugins of another machine’s session reads nothing here and says why', async () => {
  mount(<PluginsWidget appSessionId={B} args="" close={() => {}} />);
  expect(await screen.findByText('This session runs on another machine; its plugins can’t be managed here yet.')).toBeTruthy();
  expect(fake.invoked('plugins.list')).toEqual([]);
  expect(fake.invoked('marketplaces.list')).toEqual([]);
});

it('/skills of another machine’s session reads no plugin listing of its directory here', () => {
  mount(<SkillsWidget appSessionId={B} args="" close={() => {}} />);
  expect(fake.invoked('plugins.list')).toEqual([]);
  expect(fake.invoked('marketplaces.list')).toEqual([]);
});
