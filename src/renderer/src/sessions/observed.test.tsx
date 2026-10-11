// X17 in the renderer (P2-A §5.5): the freshness of a fact and its words, the loaded plugins' precedence (live and
// reported in this launch, over observed and labelled, over unknown; never a record default), and the read's
// rereading rule (a fresh answer stays until the launch or the process moves; a null or partial answer is read again
// at the surface's next open).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyObservedFacts, type ObservedFactsAnswer } from '@shared/engine/observed-facts';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { freshness, FRESHNESS, loadedPluginsOf, useLoadedPlugins, useObservedFacts } from './observed';
import { REL } from '../test-support/relative-time';

const A = 'app-a' as AppSessionId;
const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const TWO_DAYS_AGO = '2026-10-07T12:00:00.000Z';
const PLUGIN = { name: 'p1', path: '/p1', source: 'p1@m', version: '1' };
const answer = (over: Partial<ObservedFactsAnswer> = {}): ObservedFactsAnswer => ({ ...emptyObservedFacts(A, TWO_DAYS_AGO, 'live'), complete: true, ...over });
const pluginsFact = (plugins = [PLUGIN], at = TWO_DAYS_AGO) => ({ value: { plugins, errors: [], warnings: [] }, at, launchId: 'L1' });

describe('freshness and its words', () => {
  it('live is now; an observed fact is last, with when; nothing is unknown', () => {
    expect(freshness(pluginsFact(), true)).toEqual({ kind: 'now' });
    expect(freshness(pluginsFact(), false)).toEqual({ kind: 'last', at: TWO_DAYS_AGO });
    expect(freshness(null, false)).toEqual({ kind: 'unknown' });
  });

  it('says when in the person’s words', () => {
    expect(FRESHNESS.loadedNow).toBe('Loaded now');
    expect(FRESHNESS.loadedLast(TWO_DAYS_AGO, NOW)).toBe(`Loaded last time, ${REL.ago(2, 'day')}`);
    expect(FRESHNESS.lastReading('2026-10-09T09:00:00.000Z', NOW)).toBe(`Last reading, ${REL.ago(3, 'hour')}`);
    expect(FRESHNESS.lastObserved(TWO_DAYS_AGO, NOW)).toBe(`Last observed ${REL.ago(2, 'day')}`);
    expect(FRESHNESS.notObserved).toBe('Not observed yet');
  });
});

describe('loadedPluginsOf: live now > observed last > unknown', () => {
  it('a ready session whose launch reported its plugins reads them as loaded now', () => {
    const live = { ...status('app-a'), plugins: [PLUGIN], pluginsObservedAt: '2026-10-09T11:59:00.000Z' };
    expect(loadedPluginsOf(live, answer({ plugins: pluginsFact([]) }))).toEqual({ plugins: [PLUGIN], errors: [], warnings: [], freshness: { kind: 'now' } });
  });

  it('a ready session whose launch has not reported them yet (a no-prompt start) reads the observed list, never an empty one', () => {
    const fresh = { ...status('app-a'), plugins: [], pluginsObservedAt: null };
    expect(loadedPluginsOf(fresh, answer({ plugins: pluginsFact() }))).toMatchObject({ plugins: [PLUGIN], freshness: { kind: 'last', at: TWO_DAYS_AGO } });
    expect(loadedPluginsOf(fresh, null)).toEqual({ plugins: [], errors: [], warnings: [], freshness: { kind: 'unknown' } });
  });

  it('an exited status’s own report counts as observed when it is the later one', () => {
    const exited = { ...status('app-a', { process: 'exited' }), plugins: [PLUGIN], pluginsObservedAt: '2026-10-09T11:00:00.000Z' };
    expect(loadedPluginsOf(exited, answer({ plugins: pluginsFact([]) }))).toMatchObject({ plugins: [PLUGIN], freshness: { kind: 'last', at: '2026-10-09T11:00:00.000Z' } });
    expect(loadedPluginsOf(exited, answer({ plugins: pluginsFact([], '2026-10-09T11:30:00.000Z') }))).toMatchObject({ plugins: [], freshness: { kind: 'last', at: '2026-10-09T11:30:00.000Z' } });
  });

  it('no status and no facts (a terminal-only session) is unknown', () => {
    expect(loadedPluginsOf(null, null).freshness).toEqual({ kind: 'unknown' });
  });
});

describe('useObservedFacts', () => {
  let fake: FakeClient;
  let client: QueryClient;
  beforeEach(() => {
    resetShellStores();
    fake = fakeClient();
    window.maws = fake.client;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    cleanup();
    delete (window as { maws?: MawsBridge }).maws;
  });
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  function Probe({ enabled = true }: { enabled?: boolean }) {
    const { facts, loading } = useObservedFacts(A, { enabled });
    return <p>{loading ? 'loading' : (facts?.model?.value ?? 'none')}</p>;
  }

  it('reads nothing while disabled', () => {
    render(wrap(<Probe enabled={false} />));
    expect(fake.invoked('session.observedFacts')).toEqual([]);
  });

  it('keeps a complete answer until the launch or the process moves, then reads again', async () => {
    const view = render(wrap(<Probe />));
    await act(() => fake.reply('session.observedFacts', answer({ model: { value: 'm1', at: TWO_DAYS_AGO, launchId: 'L1' } })));
    expect(await screen.findByText('m1')).toBeTruthy();
    view.unmount();
    render(wrap(<Probe />)); // the surface opened again
    expect(fake.invoked('session.observedFacts')).toHaveLength(1);
    act(() => useSessions.setState({ engine: new Map([[A, status('app-a', { process: 'exited' })]]) }));
    expect(fake.invoked('session.observedFacts')).toHaveLength(2);
  });

  it('reads a null or partial answer again at the surface’s next open (a recovery its budget cut short continues)', async () => {
    const first = render(wrap(<Probe />));
    await act(() => fake.reply('session.observedFacts', answer({ complete: false, model: { value: 'partial', at: TWO_DAYS_AGO, launchId: 'L1' } })));
    first.unmount();
    const second = render(wrap(<Probe />));
    expect(fake.invoked('session.observedFacts')).toHaveLength(2);
    await act(() => fake.reply('session.observedFacts', null));
    second.unmount();
    render(wrap(<Probe />));
    expect(fake.invoked('session.observedFacts')).toHaveLength(3);
  });

  it('useLoadedPlugins reads no facts while the live status has reported its plugins', () => {
    useSessions.setState({ engine: new Map([[A, { ...status('app-a'), plugins: [PLUGIN], pluginsObservedAt: '2026-10-09T11:59:00.000Z' }]]) });
    function Plugins() {
      const loaded = useLoadedPlugins(A);
      return <p>{`${loaded.plugins.length} ${loaded.freshness.kind}`}</p>;
    }
    render(wrap(<Plugins />));
    expect(screen.getByText('1 now')).toBeTruthy();
    expect(fake.invoked('session.observedFacts')).toEqual([]);
  });
});
