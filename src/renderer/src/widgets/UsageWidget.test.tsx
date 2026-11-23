import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { AccountUsage, UsageSnapshot } from '@shared/usage/types';
import type { GetUsageResponse } from '@shared/wire/control';
import { accessibleText } from '../test-support/accessible-text';
import { record, status } from '../../../../test/support/builders';
import { at } from '../../../../test/support/machine';
import { useSessions } from '../stores/sessions';
import { connectUsage, useUsage } from '../stores/usage';
import { useLayout } from '../stores/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { useReadLoads } from './read';
import { USAGE } from './copy';
import { present, UsageBody, UsageWidget } from './UsageWidget';

const ID = at('app-direct-1' as AppSessionId);

afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map() });
  useUsage.setState({ direct: new Map(), snapshot: null, windows: null, pinsFor: {}, readError: null });
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

// The word cut (P592 to P599) on a routed session: the account line, its windows and the session's cost at rest; the
// rest of the engine's accounting behind Details; nothing of the engine's own windows.
describe('UsageBody on a routed session', () => {
  const ROUTED = at('app-routed-1' as AppSessionId);
  const ANSWER: GetUsageResponse = {
    session: { total_cost_usd: 0.5, total_api_duration_ms: 1700, total_duration_ms: 1500, total_lines_added: 3, total_lines_removed: 1, model_usage: { 'claude-x': { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } },
    subscription_type: null,
    rate_limits_available: false,
    rate_limits: null,
    behaviors: null,
  };
  const account = (uuid: string, resetsAt: string): AccountUsage => ({
    uuid, email: `${uuid}@example.test`, displayName: uuid, planLabel: 'Max', rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 0,
    credentialOwnership: null, windows: { fiveHour: { percent: 40, resetsAt, recordedAt: '2026-09-29T07:34:17Z' }, sevenDay: null, scoped: [] },
  });
  const snapshot = (accounts: AccountUsage[]): UsageSnapshot => ({
    available: true, dataDir: '/cu', readAt: '2026-09-29T07:35:00Z', error: null, drainTarget: 'drain', drainTargetIsManual: false, accounts, pinsFor: {}, gateway: null, codex: null, activity: null,
  });
  const mountBody = () => {
    useSessions.setState({ records: new Map([[ROUTED, record(ROUTED)]]), engine: new Map() });
    return render(<UsageBody view={present(ANSWER)} answer={ANSWER} appSessionId={ROUTED} />);
  };

  it('shows the cost at rest and keeps the times, lines and tokens per model behind Details', () => {
    useUsage.getState().applySnapshot(snapshot([account('drain', new Date(Date.now() + 3_600_000).toISOString())]));
    const { container } = mountBody();
    const session = screen.getByRole('region', { name: USAGE.session });
    expect(within(session).getByText('Cost')).toBeTruthy();
    expect(within(session).queryByText('API time')).toBeNull();
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Details');
    expect(within(details).getByText('API time')).toBeTruthy();
    expect(within(details).getByText('Lines')).toBeTruthy();
    expect(within(details).getByRole('region', { name: USAGE.models })).toBeTruthy();
    expect(accessibleText(container)).not.toMatch(/rate_limits_available|reports no windows/);
  });

  it('reads a window just past its reset as 0% alone', () => {
    useUsage.getState().applySnapshot(snapshot([account('drain', new Date(Date.now() - 60_000).toISOString())]));
    mountBody();
    expect(screen.getByText(USAGE.fiveHour).nextElementSibling!.textContent).toBe('0%');
  });

  // the review of task 2: a failed first read settles the line on its failure, never a spinner nothing will end
  it('settles the account line on a failed read, and on the answer that follows it', async () => {
    const fake = fakeClient();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const off = connectUsage(fake.client, { usage: useUsage, sessions: useSessions, layout: useLayout });
    mountBody();
    expect(await screen.findByRole('progressbar', { name: 'Reading ClaudeUsage' })).toBeTruthy();
    await act(() => fake.fail('settings.usage', 'pins.json unreadable'));
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(USAGE.readFailed)).toBeTruthy();
    act(() => fake.event('settings.usageChanged', snapshot([account('drain', new Date(Date.now() + 3_600_000).toISOString())])));
    expect(screen.queryByText(USAGE.readFailed)).toBeNull();
    expect(screen.getByText(/^drain@example\.test/)).toBeTruthy();
    off();
    vi.restoreAllMocks();
  });

  it('shows a quiet spinner for the account while ClaudeUsage has not answered, and says so when it names no account', async () => {
    mountBody();
    expect(screen.queryByText(/Reading ClaudeUsage/)).toBeNull();
    expect(await screen.findByRole('progressbar', { name: 'Reading ClaudeUsage' })).toBeTruthy();
    cleanup();
    useUsage.getState().applySnapshot(snapshot([]));
    mountBody();
    expect(screen.getByText(USAGE.noAccount)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
