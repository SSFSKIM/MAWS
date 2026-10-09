// The loaded line's table (P2-B execution document §5.6): the facts and their freshness, then what the session's
// availability allows. `refresh` is A's `useLoadedPlugins().refresh` (acquire, then reload_plugins); it is passed in
// here, as A's M3 will pass it, so the table is proved before A lands.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useSessions } from '../../stores/sessions';
import { LoadedLine, type LoadedLineProps } from './LoadedLine';
import type { AcquireOutcome, LoadedPlugins } from './loaded';
import type { Reloads } from './reload';

const ID = 'app-line' as AppSessionId;
const NOW = Date.parse('2026-10-09T12:00:00Z');
const plugin = (name: string) => ({ name, path: `/cfg/plugins/cache/m/${name}/1.0.0`, source: `${name}@m`, version: '1.0.0' });
const NOW_FACTS: LoadedPlugins = { plugins: [plugin('a'), plugin('b')], errors: [], warnings: [], freshness: { kind: 'now' } };
const LAST: LoadedPlugins = { plugins: [plugin('a'), plugin('b'), plugin('c')], errors: [{ plugin: 'd', type: 'load', message: 'bad manifest', path: null }], warnings: [], freshness: { kind: 'last', at: new Date(NOW - 2 * 86_400_000).toISOString() } };
const UNKNOWN: LoadedPlugins = { plugins: [], errors: [], warnings: [], freshness: { kind: 'unknown' } };
const RELOADS: Reloads = { reloadMods: () => {}, reloadSkills: () => {}, line: null, failed: false, busy: false };

afterEach(() => {
  cleanup();
  useSessions.setState({ records: new Map() });
});

const line = (props: Partial<LoadedLineProps>) => {
  render(<LoadedLine appSessionId={ID} availability="resumable" loaded={LAST} refresh={null} reloads={null} onShowLoaded={() => {}} now={NOW} {...props} />);
  return document.querySelector<HTMLElement>('[data-plugins-loaded]')!;
};
const withRecord = (over: Partial<SessionRecord>) => useSessions.setState({ records: new Map([[ID, { appId: ID, directory: '/work/gone', ...over } as SessionRecord]]) });

describe('the loaded line', () => {
  it('usable: the count, Loaded now, and the reloads', () => {
    const el = line({ availability: 'usable', loaded: NOW_FACTS, reloads: RELOADS });
    expect(el.textContent).toContain('2 plugins loaded in this session');
    expect(el.textContent).toContain('Loaded now');
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload skills' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('resumable or failed with observed facts: Loaded last time, its age, the problems, and Refresh', () => {
    for (const availability of ['resumable', 'failed', 'needs_trust'] as const) {
      const el = line({ availability, refresh: async () => ({ status: 'ready', appSessionId: ID, launched: true, joined: false }) });
      expect(el.textContent).toContain('3 plugins loaded in this session');
      expect(el.textContent).toContain('Loaded last time, 2 days ago');
      expect(screen.getByRole('button', { name: '1 problem' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
      cleanup();
    }
  });

  it('no facts observed: Not observed yet, and Refresh; the count and the problems open Loaded in this session', () => {
    line({ loaded: UNKNOWN, refresh: async () => ({ status: 'ready', appSessionId: ID, launched: true, joined: false }) });
    expect(screen.getByText('Not observed yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    cleanup();
    const onShowLoaded = vi.fn();
    line({ onShowLoaded });
    fireEvent.click(screen.getByRole('button', { name: '3 plugins loaded in this session' }));
    fireEvent.click(screen.getByRole('button', { name: '1 problem' }));
    expect(onShowLoaded).toHaveBeenCalledTimes(2);
  });

  it('Refresh calls refresh once from its click, shows Starting… while it runs, and nothing calls it on mount', async () => {
    let answer: (outcome: AcquireOutcome) => void = () => {};
    const refresh = vi.fn(() => new Promise<AcquireOutcome>((resolve) => (answer = resolve)));
    line({ refresh });
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    await act(async () => answer({ status: 'ready', appSessionId: ID, launched: true, joined: false }));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal shows its words on the line; a docked trust card is pointed at', async () => {
    line({ refresh: async () => ({ status: 'missing_directory', appSessionId: ID, directory: '/work/gone' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Directory not found: /work/gone'));
    cleanup();
    line({ refresh: async () => ({ status: 'needs_trust', appSessionId: ID, trust: {} as never }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Trust this folder in the session to continue'));
  });

  it('starting: Starting… in place of Refresh', () => {
    line({ availability: 'starting', refresh: async () => ({ status: 'ready', appSessionId: ID, launched: false, joined: true }) });
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('foreign-held: the holder’s actions in place of Refresh', () => {
    withRecord({ holder: { kind: 'terminal', pid: 4242 } as SessionRecord['holder'] });
    line({ availability: 'foreign_held', refresh: async () => ({ status: 'ready', appSessionId: ID, launched: true, joined: false }) });
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.getByRole('button', { name: /Fork/ })).toBeTruthy();
  });

  it('archived or missing its directory: the facts and the state in words, no Refresh', () => {
    withRecord({});
    line({ availability: 'archived', refresh: async () => ({ status: 'ready', appSessionId: ID, launched: true, joined: false }) });
    expect(screen.getByText('Archived · unarchive it to continue')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    cleanup();
    line({ availability: 'missing_directory', refresh: async () => ({ status: 'ready', appSessionId: ID, launched: true, joined: false }) });
    expect(screen.getByText('Directory not found: /work/gone')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(document.querySelector('[data-plugins-loaded]')!.textContent).toContain('Loaded last time, 2 days ago');
  });

  it('a still-pending Refresh keeps Starting… once the process is ready, until its outcome lands', async () => {
    let answer: (outcome: AcquireOutcome) => void = () => {};
    const refresh = vi.fn(() => new Promise<AcquireOutcome>((resolve) => (answer = resolve)));
    const props: LoadedLineProps = { appSessionId: ID, availability: 'resumable', loaded: LAST, refresh, reloads: null, onShowLoaded: () => {}, now: NOW };
    const view = render(<LoadedLine {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    view.rerender(<LoadedLine {...props} availability="usable" loaded={NOW_FACTS} reloads={RELOADS} />);
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload plugins' })).toBeNull();
    await act(async () => answer({ status: 'ready', appSessionId: ID, launched: true, joined: false }));
    expect(screen.queryByText('Starting…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toBeTruthy();
  });

  it('a list with no freshness to say (a status that outlived its process, the stand-in) draws the count and the problems, no freshness word', () => {
    const el = line({ loaded: { ...LAST, freshness: { kind: 'unknown' } } });
    expect(el.textContent).toContain('3 plugins loaded in this session');
    expect(screen.getByRole('button', { name: '1 problem' })).toBeTruthy();
    expect(el.textContent).not.toContain('Loaded now');
    expect(el.textContent).not.toContain('Loaded last time');
    expect(el.textContent).not.toContain('Not observed yet');
  });

  it('without A’s refresh (the stand-in), a session that is not ready offers no Refresh', () => {
    line({ availability: 'resumable', refresh: null });
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });
});
