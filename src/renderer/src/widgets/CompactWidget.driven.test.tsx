// The word cut (P174): a terminal session driven through its bridge whose usage the bridge has not reported reads a dash
// in the compact widget, as Session info's values do, not "Not observed yet". Its own file: the session's port is mocked
// for every test in it.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { resetQueueStore } from '../stores/queue';
import { preloadOf } from '../test-support/preload-of';
import { CompactWidget } from './CompactWidget';

vi.mock('../session/controls/controls-for', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session/controls/controls-for')>()),
  useSessionControls: () => ({ turn: () => ({}), capability: () => ({ available: true }) }),
}));

const ID = at('app-0c4a1d2e' as AppSessionId);
beforeEach(() => {
  window.maws = preloadOf(fakeClient());
});
afterEach(() => {
  cleanup();
  resetQueueStore();
  delete (window as { maws?: unknown }).maws;
});

describe('the compact widget of a driven terminal session', () => {
  it('reads a dash while the bridge has reported no usage', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CompactWidget appSessionId={ID} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Compact now' })).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('Not observed yet')).toBeNull();
  });
});
