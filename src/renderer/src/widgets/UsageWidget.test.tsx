import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../test/support/builders';
import { at } from '../../../../test/support/machine';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { useReadLoads } from './read';
import { USAGE } from './copy';
import { UsageWidget } from './UsageWidget';

const ID = at('app-direct-1' as AppSessionId);

afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map() });
  useUsage.setState({ direct: new Map() });
  useReadLoads.setState({ loads: new Map() });
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UsageWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );

describe('UsageWidget', () => {
  // The word cut moved a Direct session's windows out of Session info: once its process exits, `/usage` is where the
  // reading Session info's poll held still reads, dated, without a restart.
  it('shows the held Direct reading when its own read has no answer', () => {
    const live = status(ID, { process: 'exited' });
    useSessions.setState({
      engine: new Map([[ID, { ...live, gateway: { ...live.gateway, mode: 'direct', verified: 'direct', baseUrl: null } }]]),
      records: new Map([[ID, record(ID, { gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } })]]),
    });
    const readAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const resetsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    useUsage.getState().setDirect(ID, { windows: { fiveHour: { percent: 42, resetsAt, recordedAt: readAt }, sevenDay: null, scoped: [] }, readAt });
    mount();
    expect(screen.getByText(USAGE.direct)).toBeTruthy();
    expect(screen.getByText(USAGE.fiveHour)).toBeTruthy();
    expect(document.body.textContent).toContain('42');
    expect(document.body.textContent).toContain('Read ');
  });

  it('says it has not read yet when nothing is held', () => {
    const live = status(ID, { process: 'exited' });
    useSessions.setState({
      engine: new Map([[ID, { ...live, gateway: { ...live.gateway, mode: 'direct', verified: 'direct', baseUrl: null } }]]),
      records: new Map([[ID, record(ID, { gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } })]]),
    });
    mount();
    expect(screen.queryByText(USAGE.direct)).toBeNull();
    expect(screen.getByText('Not read yet.')).toBeTruthy();
  });
});
