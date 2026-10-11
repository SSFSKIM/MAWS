// The loaded line's table (P2-B execution document §5.6): the facts and their freshness (A's observed facts), then what
// the session's availability allows through A's line (`DormantGesture`). `refresh` is A's `useLoadedPlugins().refresh`
// in shape: here it acquires through A's real `loadForRead` over a fake bridge, so the refusal words, "Starting…" and
// the holder's actions come from the session's state as they do in the app.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Availability } from '@shared/ipc/schema/session';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { digest, record } from '../../../../../test/support/builders';
import type { LoadedPlugins } from '../../sessions/observed';
import { useSessions } from '../../stores/sessions';
import { loadForRead, useReadLoads } from '../read';
import { LoadedLine, type LoadedLineProps, type SessionPlugins } from './LoadedLine';
import type { Reloads } from './reload';
import { REL } from '../../test-support/relative-time';

const ID = 'app-line' as AppSessionId;
const NOW = Date.parse('2026-10-09T12:00:00Z');
const plugin = (name: string) => ({ name, path: `/cfg/plugins/cache/m/${name}/1.0.0`, source: `${name}@m`, version: '1.0.0' });
const NOW_FACTS: LoadedPlugins = { plugins: [plugin('a'), plugin('b')], errors: [], warnings: [], freshness: { kind: 'now' } };
const LAST: LoadedPlugins = { plugins: [plugin('a'), plugin('b'), plugin('c')], errors: [{ plugin: 'd', type: 'load', message: 'bad manifest', path: null }], warnings: [], freshness: { kind: 'last', at: new Date(NOW - 2 * 86_400_000).toISOString() } };
const UNKNOWN: LoadedPlugins = { plugins: [], errors: [], warnings: [], freshness: { kind: 'unknown' } };
const RELOADS: Reloads = { reloadMods: () => {}, reloadSkills: () => {}, line: null, failed: false, busy: false };
const READY: AcquireOutcome = { status: 'ready', appSessionId: ID, launched: true, joined: false };

// what main answers `session.acquire` in a case
let acquire: () => Promise<AcquireOutcome> = async () => READY;
const invoke = vi.fn(async (name: string) => (name === 'session.acquire' ? { ok: true, value: await acquire() } : { ok: true, value: null }));
const acquires = () => invoke.mock.calls.filter(([name]) => name === 'session.acquire');

// A's refresh in shape: acquire for a read, then (ready) reload; the reload's line as the case gives it
const session = (facts: LoadedPlugins, reload: SessionPlugins['reload'] = { line: null, failed: false }): SessionPlugins => ({ ...facts, refresh: () => loadForRead(ID), reload });
const withSession = (availability: Availability, over: Partial<SessionRecord> = {}) =>
  useSessions.setState({ records: new Map([[ID, record(ID, { directory: '/work/gone', ...over })]]), digests: new Map([[ID, digest(ID, { availability })]]) });

beforeEach(() => {
  acquire = async () => READY;
  invoke.mockClear();
  window.maws = { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge;
});
afterEach(() => {
  cleanup();
  useSessions.setState({ records: new Map(), digests: new Map(), engine: new Map() });
  useReadLoads.setState({ loads: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

const line = (props: Partial<LoadedLineProps>, availability: Availability = props.availability ?? 'resumable') => {
  if (!useSessions.getState().records.has(ID)) withSession(availability);
  render(<LoadedLine appSessionId={ID} availability={availability} loaded={session(LAST)} reloads={null} onShowLoaded={() => {}} now={NOW} {...props} />);
  return document.querySelector<HTMLElement>('[data-plugins-loaded]')!;
};

describe('the loaded line', () => {
  it('usable: the count, Loaded now, and the reloads', () => {
    const el = line({ availability: 'usable', loaded: session(NOW_FACTS), reloads: RELOADS });
    expect(el.textContent).toContain('2 plugins loaded in this session');
    expect(el.textContent).toContain('Loaded now');
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload skills' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('resumable, failed or needing trust with observed facts: Loaded last time, its age, the problems, and Refresh', () => {
    for (const availability of ['resumable', 'failed', 'needs_trust'] as const) {
      withSession(availability);
      const el = line({ availability });
      expect(el.textContent).toContain('3 plugins loaded in this session');
      expect(el.textContent).toContain(`Loaded last time, ${REL.ago(2, 'day')}`);
      expect(screen.getByRole('button', { name: '1 problem' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
      cleanup();
    }
    expect(acquires()).toEqual([]);
  });

  it('no facts observed: Not observed yet, and Refresh; the count and the problems open Loaded in this session', () => {
    line({ loaded: session(UNKNOWN) });
    expect(document.querySelector('[data-plugins-loaded]')!.firstElementChild!.textContent).toBe('Not observed yet');
    expect(screen.queryByText(/loaded in this session/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    cleanup();
    const onShowLoaded = vi.fn();
    line({ onShowLoaded });
    fireEvent.click(screen.getByRole('button', { name: '3 plugins loaded in this session' }));
    fireEvent.click(screen.getByRole('button', { name: '1 problem' }));
    expect(onShowLoaded).toHaveBeenCalledTimes(2);
  });

  it('Refresh acquires for a read once, from its click, with Starting… while it runs; nothing acquires on mount', async () => {
    let answer: (outcome: AcquireOutcome) => void = () => {};
    acquire = () => new Promise((resolve) => (answer = resolve));
    line({});
    expect(acquires()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(acquires()).toEqual([['session.acquire', { appSessionId: ID, reason: 'read' }]]);
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    await act(async () => answer(READY));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(acquires()).toHaveLength(1);
  });

  it('a refusal shows its words on the line and Refresh stays; a docked trust card is pointed at', async () => {
    acquire = async () => ({ status: 'refused', appSessionId: ID, reason: 'busy', message: 'The session is busy elsewhere' }) as AcquireOutcome;
    const el = line({});
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(el.textContent).toContain('The session is busy elsewhere'));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    cleanup();
    useReadLoads.setState({ loads: new Map() });
    acquire = async () => ({ status: 'needs_trust', appSessionId: ID, trust: { directory: '/work/gone', trustKey: '/work/gone', keyKind: 'directory', configPath: '/cfg/.claude.json', trusted: false, source: null, isHome: false, found: [] } }) as AcquireOutcome;
    const again = line({}, 'needs_trust');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(again.textContent).toContain('Trust this folder in the session to continue'));
  });

  it('an acquisition that cannot be asked at all (main or the host unreachable) says so on the line', async () => {
    acquire = async () => {
      throw new Error('unused');
    };
    invoke.mockImplementationOnce(async () => ({ ok: false, error: { code: 'host_unavailable', message: 'the engine host is not running' } }) as never);
    const el = line({});
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(el.textContent).toContain('the engine host is not running'));
  });

  it('a reload that failed after the start says so; a reload from the line’s own controls supersedes Refresh’s line', () => {
    const el = line({ availability: 'usable', loaded: session(NOW_FACTS, { line: 'reload_plugins unanswered after 60 s · timeout', failed: true }), reloads: RELOADS });
    expect(screen.getByRole('alert').textContent).toBe('reload_plugins unanswered after 60 s · timeout');
    expect(el.querySelector('[data-loaded-reload="failed"]')).toBeTruthy();
    cleanup();
    line({ availability: 'usable', loaded: session(NOW_FACTS, { line: 'Reloaded · 1 command', failed: false }), reloads: { ...RELOADS, line: 'Reloaded · 2 skills' } });
    expect(screen.queryByText('Reloaded · 1 command')).toBeNull();
    expect(screen.getByText('Reloaded · 2 skills')).toBeTruthy();
  });

  it('starting: Starting… in place of Refresh', () => {
    line({ availability: 'starting' });
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('foreign-held: the facts read-only, the holder named and its actions in place of Refresh', () => {
    withSession('foreign_held', { holder: { kind: 'terminal', pid: 4242 } });
    const el = line({ availability: 'foreign_held' });
    expect(el.textContent).toContain('3 plugins loaded in this session');
    expect(screen.getByText('Held by terminal · 4242')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take over here' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('archived: the facts and the state in words, no Refresh; a missing directory names it and lets Refresh try again', () => {
    withSession('archived', { archived: true });
    line({ availability: 'archived' });
    expect(screen.getByText('Archived · unarchive it to continue')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    cleanup();
    withSession('missing_directory');
    const el = line({ availability: 'missing_directory' });
    expect(screen.getByText('Directory not found: /work/gone')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy(); // main forgets the state at the next attempt
    expect(el.textContent).toContain(`Loaded last time, ${REL.ago(2, 'day')}`);
  });

  it('a still-pending Refresh keeps Starting… once the process is ready, until its outcome lands', async () => {
    let answer: (outcome: AcquireOutcome) => void = () => {};
    acquire = () => new Promise((resolve) => (answer = resolve));
    withSession('resumable');
    const loaded = session(LAST);
    const props: LoadedLineProps = { appSessionId: ID, availability: 'resumable', loaded, reloads: null, onShowLoaded: () => {}, now: NOW };
    const view = render(<LoadedLine {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    view.rerender(<LoadedLine {...props} availability="usable" loaded={{ ...loaded, ...NOW_FACTS }} reloads={RELOADS} />);
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload plugins' })).toBeNull();
    await act(async () => answer(READY));
    expect(screen.queryByText('Starting…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toBeTruthy();
  });
});
