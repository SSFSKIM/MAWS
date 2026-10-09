// The toolbar's context ring (W2, C3; §5.4 and §5.5 as amended 2026-10-01): the digest's percent of the window, amber
// at the autocompact threshold, and the context window's popover (the engine's full reading on open, Compact when the
// catalogue lists it headless). The popover's reads and Compact were the status line's ctx field's, ported here.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, SessionDigest } from '@shared/ipc/schema';
import { digest, record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { resetCatalogStore } from '../../stores/catalog';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { useReadLoads } from '../../widgets/read';
import { ContextRing, contextRingOf } from './ContextRing';

const A = 'app-a' as AppSessionId;
const CONTEXT = {
  categories: [
    { name: 'System prompt', tokens: 6810, kind: 'used' },
    { name: 'Messages', tokens: 40_000, kind: 'used' },
    { name: 'Free space', tokens: 153_190, kind: 'free' },
  ],
  totalTokens: 46_810, maxTokens: 200_000, percentage: 23.4, autoCompactThreshold: 167_000, isAutoCompactEnabled: true, model: 'claude-opus',
};
const catalog = (names: string[], terminalOnly: string[] = []) => ({
  commands: names.map((name) => ({ name, description: name, argumentHint: '' })), agents: [], skills: [], terminalSlashCommands: terminalOnly, revision: 1,
});

let fake: FakeClient;

function mount(answers: Parameters<typeof fakeClient>[0] = {}, context: SessionDigest['context'] = null) {
  fake = fakeClient({ 'session.status': status('app-a'), ...answers });
  window.maws = fake.client;
  useSessions.setState({ records: new Map([[A, record('app-a')]]), engine: new Map([[A, status('app-a')]]), digests: new Map([[A, digest('app-a', { context })]]) });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ContextRing appSessionId={A} />
    </QueryClientProvider>,
  );
}
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const ring = () => screen.getByRole('button', { name: /^Context window/ });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  resetShellStores();
});
afterEach(() => {
  cleanup();
  resetCatalogStore();
  useReadLoads.setState({ loads: new Map() }); // P2-A: a Refresh a case left unanswered
  delete (window as { maws?: MawsBridge }).maws;
  vi.useRealTimers();
});

describe('the context ring', () => {
  it('reads the percent of the window, and turns amber at the autocompact threshold', () => {
    expect(contextRingOf(null)).toEqual({ percent: null, near: false, label: 'Context window · no reading yet' });
    expect(contextRingOf({ percent: 41.4, maxTokens: 200_000, autoCompactThreshold: 167_000 })).toEqual({ percent: 41, near: false, label: 'Context window 41% full of 200k' });
    expect(contextRingOf({ percent: 91, maxTokens: 1_000_000, autoCompactThreshold: 900_000 })).toEqual({ percent: 91, near: true, label: 'Context window 91% full of 1M · autocompacts soon' });
    expect(contextRingOf({ percent: 95, maxTokens: 200_000, autoCompactThreshold: null }).near).toBe(false);
  });

  it('draws the digest’s sample on the toolbar, and nothing for a session with no record', () => {
    mount({}, { percent: 91, totalTokens: 910_000, maxTokens: 1_000_000, autoCompactThreshold: 900_000 });
    expect(ring().getAttribute('data-context-ring')).toBe('91');
    expect(ring().querySelector('circle.stroke-warning')).not.toBeNull();
    cleanup();
    useSessions.setState({ records: new Map() });
    render(<ContextRing appSessionId={A} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the context window: get_context_usage read on open, no Compact unless the catalogue lists it headless', async () => {
    mount({ 'session.getContextUsage': CONTEXT, 'session.catalog': catalog(['model', 'cost']) });
    fireEvent.click(ring());
    await settle();
    const popover = screen.getByRole('dialog', { name: 'Context window' });
    expect(within(popover).getByText('47k of 200k · autocompact at 167k')).toBeTruthy();
    expect(within(popover).getByText('23.4% used · 120k until compaction')).toBeTruthy();
    expect(within(popover).queryByRole('button', { name: 'Compact now' })).toBeNull();
    expect(fake.invoked('session.getContextUsage')).toEqual([{ appSessionId: A, detail: 'full' }]);
  });

  it('Compact now sends /compact when the catalogue lists it and it is not terminal-only', async () => {
    mount({ 'session.getContextUsage': CONTEXT, 'session.catalog': catalog(['compact']), 'session.send': { messageUuid: null, disposition: 'queued', queueId: 'q1' } });
    fireEvent.click(ring());
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compact now' }));
    await settle();
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: A, content: '/compact' }]);
    expect(screen.queryByRole('dialog', { name: 'Context window' })).toBeNull(); // closed first
    cleanup();
    resetCatalogStore();
    mount({ 'session.getContextUsage': CONTEXT, 'session.catalog': catalog(['compact'], ['compact']) });
    fireEvent.click(ring());
    await settle();
    expect(screen.queryByRole('button', { name: 'Compact now' })).toBeNull();
  });
});

// P2-A start (2026-10-09; X17): with no live process and no sample in the digest, the last reading the host kept, with
// when; "Not observed yet" where there is none; nothing is read from the engine
describe('the context ring of a session with no live process', () => {
  const observed = (contextUsage: unknown) => ({
    version: 1, appSessionId: A, engineSessionId: null, writtenAt: '2026-10-09T09:00:00.000Z', source: 'live', launches: ['L1'],
    engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: null, contextUsage, complete: true,
  });
  function mountExited(facts: unknown) {
    fake = fakeClient({ 'session.observedFacts': facts });
    window.maws = fake.client;
    useSessions.setState({ records: new Map([[A, record('app-a')]]), engine: new Map([[A, status('app-a', { process: 'exited' })]]), digests: new Map([[A, digest('app-a', { context: null })]]) });
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ContextRing appSessionId={A} />
      </QueryClientProvider>,
    );
  }

  it('draws the last reading, its label saying when, and the popover says the same with no engine read', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000 - 60_000).toISOString();
    mountExited(observed({ value: { percent: 41, totalTokens: 82_000, maxTokens: 200_000, autoCompactThreshold: 167_000 }, at: threeHoursAgo, launchId: 'L1' }));
    await settle();
    expect(ring().getAttribute('data-context-ring')).toBe('41');
    expect(ring().getAttribute('aria-label')).toBe('Context window 41% full of 200k · Last reading, 3 hours ago');
    fireEvent.click(ring());
    await settle();
    const popover = screen.getByRole('dialog', { name: 'Context window' });
    expect(within(popover).getByText('41% of 200k used')).toBeTruthy();
    expect(within(popover).getByText('Last reading, 3 hours ago')).toBeTruthy();
    expect(fake.invoked('session.getContextUsage')).toEqual([]);
  });

  it('says "Not observed yet" for a session MAWS never ran (a terminal-only one)', async () => {
    mountExited(null);
    await settle();
    expect(ring().getAttribute('aria-label')).toBe('Context window · no reading yet');
    fireEvent.click(ring());
    await settle();
    expect(within(screen.getByRole('dialog', { name: 'Context window' })).getByText('Not observed yet')).toBeTruthy();
  });

  // M3: the popover's Refresh is the owner's gesture that starts the session; opening the popover starts nothing
  it('the popover offers Refresh, which acquires the session for a read; opening it acquired nothing', async () => {
    mountExited(null);
    await settle();
    fireEvent.click(ring());
    await settle();
    expect(fake.invoked('session.acquire')).toEqual([]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Context window' })).getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: A, reason: 'read' }]);
  });

  // M3 review (§10 Q7, acceptance 6): a terminal holding the session: the holder's actions where Refresh would be
  it('the popover of a session a terminal holds names the holder and offers its actions in place of Refresh', async () => {
    mountExited(null);
    act(() => useSessions.setState({ records: new Map([[A, record('app-a', { holder: { kind: 'terminal', pid: 4711 } })]]), digests: new Map([[A, digest('app-a', { context: null, availability: 'foreign_held' })]]) }));
    await settle();
    fireEvent.click(ring());
    await settle();
    const popover = screen.getByRole('dialog', { name: 'Context window' });
    expect(within(popover).getByText('Held by terminal · 4711')).toBeTruthy();
    expect(within(popover).getByRole('button', { name: 'Take over here' })).toBeTruthy();
    expect(within(popover).getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
    expect(within(popover).queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(fake.invoked('session.acquire')).toEqual([]);
  });

  // the review's fix: a dormant ring always says when its reading was taken, when the host kept it
  const twelve = { percent: 12, totalTokens: 24_000, maxTokens: 200_000, autoCompactThreshold: null };
  function mountWith(process: 'ready' | 'exited', answers: Parameters<typeof fakeClient>[0]) {
    fake = fakeClient(answers);
    window.maws = fake.client;
    useSessions.setState({ records: new Map([[A, record('app-a')]]), engine: new Map([[A, status('app-a', { process })]]), digests: new Map([[A, digest('app-a', { context: twelve })]]) });
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ContextRing appSessionId={A} />
      </QueryClientProvider>,
    );
  }

  it('an exited ring with a digest sample draws the host’s dated reading, labelled with when', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000 - 60_000).toISOString();
    mountWith('exited', { 'session.observedFacts': observed({ value: { ...twelve, percent: 14 }, at: twoHoursAgo, launchId: 'L1' }) });
    await settle();
    expect(ring().getAttribute('aria-label')).toBe('Context window 14% full of 200k · Last reading, 2 hours ago');
  });

  it('an exited ring whose host kept no reading keeps the digest’s sample; a live one reads no facts', async () => {
    mountWith('exited', { 'session.observedFacts': null });
    await settle();
    expect(ring().getAttribute('aria-label')).toBe('Context window 12% full of 200k');
    cleanup();
    mountWith('ready', {});
    await settle();
    expect(ring().getAttribute('aria-label')).toBe('Context window 12% full of 200k');
    expect(fake.invoked('session.observedFacts')).toEqual([]);
  });

  it('a popover opened live keeps no cached full read once the session exits: the dated reading replaces it', async () => {
    const hourAgo = new Date(Date.now() - 3_600_000 - 60_000).toISOString();
    mountWith('ready', { 'session.getContextUsage': CONTEXT, 'session.catalog': catalog([]), 'session.observedFacts': observed({ value: { ...twelve, percent: 31 }, at: hourAgo, launchId: 'L1' }) });
    fireEvent.click(ring());
    await settle();
    const popover = () => screen.getByRole('dialog', { name: 'Context window' });
    expect(within(popover()).getByText('47k of 200k · autocompact at 167k')).toBeTruthy();
    act(() => useSessions.setState({ engine: new Map([[A, status('app-a', { process: 'exited' })]]) }));
    await settle();
    expect(within(popover()).queryByText('47k of 200k · autocompact at 167k')).toBeNull();
    expect(within(popover()).getByText('31% of 200k used')).toBeTruthy();
    expect(within(popover()).getByText('Last reading, 1 hour ago')).toBeTruthy();
    expect(ring().getAttribute('aria-label')).toBe('Context window 31% full of 200k · Last reading, 1 hour ago');
  });
});
// P2-A end
