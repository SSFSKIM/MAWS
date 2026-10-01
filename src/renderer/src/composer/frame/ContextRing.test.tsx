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
