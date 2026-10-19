// @vitest-environment happy-dom
// The org view (smns org directory §8): every live session of every project on the grid, drawn from each project's own
// connection — its verified log and its live state, as the project view's sidebar reads them — merged: waiting on the
// owner first, then working, then idle, newest join first by the `joined` event's time; ended sessions not drawn. A
// project's connection is held while the view is mounted and let go when it leaves. Locked, the view draws the grid's
// counts and no session.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importOrgKey, seal, type LogEvent, type OrgKey, type ProjectSummary } from 'desk-hub/protocol';
import { VECTOR_KEY } from '../../../test/vectors';
import { useKeyHolder } from '../../key/holder';
import { memoryLogRecord } from '../../log/record';
import { ProjectConnection } from '../../project/connection';
import { parseRoute, routePath, useDeskLayout } from '../../shell/layout';
import { useGrid } from '../../state/grid';
import type { Me } from '../../hub/me';
import { QUIET_MS } from '../../depth/source/keeper';

const held = new Map<string, ProjectConnection>();
const acquired: string[] = [];
const released: string[] = [];
vi.mock('../../project/registry', () => ({
  useProjectConnection(project: string) {
    useEffect(() => {
      acquired.push(project);
      return () => void released.push(project);
    }, [project]);
    return held.get(project)!;
  },
}));
vi.mock('../key/UnlockForm', () => ({ UnlockForm: () => <form data-testid="unlock-form" /> }));

const { OrgView } = await import('./OrgView');

const P1 = '0d6c1f2e-6a43-4f43-9b1a-6f1d6a5b2c11'; // MAWS
const P2 = 'a5c3c1de-7a5e-5d2b-9f3a-2c6b7e1d4f20'; // the mini's machine project
const S = {
  asks: '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', // maws-45 on mini, MAWS, waiting, joined 08:00
  stray: '1ea561bc-a60d-4437-a6ac-fa7cd5eda54f', // mini-7c on mini, the mini's project, waiting, joined 09:00
  works: '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a', // maws-fe on macbook, MAWS, busy
  rests: '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a', // mini-02 on mini, the mini's project, idle
  gone: 'e0ad139c-18bc-45bd-9489-be8653145f80', // maws-1e on macbook, MAWS, retired
};
const me = { org: { id: 'org', name: 'org', created: '', key_check: null }, member: { id: 'm', email: 'o@example.com', role: 'admin', created: '' } } as unknown as Me;
const summary = (id: string, name: string, kind: ProjectSummary['kind'], waiting: number, working: number): ProjectSummary => ({ id, name, kind, machines: 1, machines_online: 1, waiting, working, live: 2 });

let key: OrgKey;
let seq = 0;
async function feed(connection: ProjectConnection, drafts: Array<Record<string, unknown> & { writer: string; kind: string; ts: string }>) {
  const entries = [];
  for (const draft of drafts) {
    seq++;
    entries.push({ offset: seq, event: (await seal(key, 'log', connection.project, { seq, ...draft })) as unknown as LogEvent });
  }
  connection.log.receive(entries);
  await connection.log.settled();
}
const joined = (session: string, alias: string, machine: string, ts: string) => ({ ts, writer: `${machine}/${session}`, kind: 'joined', session, alias, machine, cwd: '/w', worktree: '', seat: '', by: '' });
const presence = (connection: ProjectConnection, entries: Record<string, string>) =>
  connection.live.setState({ presence: Object.fromEntries(Object.entries(entries).map(([s, status]) => [s, { record: { status }, bridge: true }])) });

beforeEach(async () => {
  key = await importOrgKey(VECTOR_KEY);
  seq = 0;
  acquired.length = 0;
  released.length = 0;
  for (const project of [P1, P2]) {
    const connection = new ProjectConnection(project, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
    connection.setKey(key);
    connection.live.setState({ status: 'open', connected: true, caughtUp: true });
    held.set(project, connection);
  }
  await feed(held.get(P1)!, [
    joined(S.asks, 'maws-45', 'mini', '2026-10-18T08:00:00.000Z'),
    { ts: '2026-10-18T08:01:00.000Z', writer: `mini/${S.asks}`, kind: 'in-charge', session: S.asks, text: 'owner artifacts page', source: 'set' },
    joined(S.works, 'maws-fe', 'macbook', '2026-10-18T08:30:00.000Z'),
    joined(S.gone, 'maws-1e', 'macbook', '2026-10-18T10:00:00.000Z'),
    { ts: '2026-10-18T10:05:00.000Z', writer: `macbook/${S.gone}`, kind: 'retired', session: S.gone, by: '', reason: 'ended' },
  ]);
  await feed(held.get(P2)!, [joined(S.rests, 'mini-02', 'mini', '2026-10-18T07:00:00.000Z'), joined(S.stray, 'mini-7c', 'mini', '2026-10-18T09:00:00.000Z')]);
  presence(held.get(P1)!, { [S.asks]: 'waiting', [S.works]: 'busy' });
  presence(held.get(P2)!, { [S.stray]: 'waiting', [S.rests]: 'idle' });
  useGrid.setState({ projects: [summary(P1, 'MAWS', 'hub', 1, 1), summary(P2, 'mini', 'machine', 1, 0)], loaded: true });
  useKeyHolder.setState({ state: 'unlocked', key });
  useDeskLayout.setState({ route: { view: 'org' } });
});
afterEach(() => {
  cleanup();
  for (const connection of held.values()) connection.stop();
  held.clear();
});

it('lists every live session of every project, waiting first, then working, then idle, newest join first; ended ones not drawn', async () => {
  render(<OrgView me={me} />);
  await waitFor(() => expect(screen.getAllByTestId('org-session')).toHaveLength(4));
  const rows = screen.getAllByTestId('org-session');
  expect(rows.map((r) => [r.dataset.group, r.dataset.session])).toEqual([
    ['waiting', S.stray],
    ['waiting', S.asks],
    ['working', S.works],
    ['idle', S.rests],
  ]);
  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Waiting on you2', 'Working1', 'Idle1']);
  // Each row: the session's name, its machine, its project, and its in-charge line.
  const asks = rows[1];
  expect(asks.textContent).toContain('maws-45');
  expect(asks.textContent).toContain('@mini');
  expect(asks.querySelector('[data-testid="org-project"]')?.textContent).toBe('MAWS');
  expect(asks.querySelector('[data-testid="charge"]')?.textContent).toBe('owner artifacts page');
  expect(rows[0].querySelector('[data-testid="org-project"]')?.textContent).toBe('mini');
  expect(screen.queryByText('maws-1e')).toBeNull();
});

it('follows each project live: a presence change moves a session between groups', async () => {
  render(<OrgView me={me} />);
  await waitFor(() => expect(screen.getAllByTestId('org-session')).toHaveLength(4));
  act(() => presence(held.get(P1)!, { [S.asks]: 'busy', [S.works]: 'busy' }));
  await waitFor(() => expect(screen.getAllByTestId('org-session').map((r) => r.dataset.group)).toEqual(['waiting', 'working', 'working', 'idle']));
  expect(screen.getAllByTestId('org-session').filter((r) => r.dataset.group === 'working').map((r) => r.dataset.session)).toEqual([S.works, S.asks]);
});

it("opens a session's channel in its project on a click", async () => {
  render(<OrgView me={me} />);
  const row = await waitFor(() => screen.getAllByTestId('org-session').find((r) => r.dataset.session === S.stray)!);
  fireEvent.click(row);
  expect(useDeskLayout.getState().route).toEqual({ view: 'project', project: P2, channel: { kind: 'session', session: S.stray } });
});

it("holds every project's connection while mounted and lets each go when the view leaves", async () => {
  const { unmount } = render(<OrgView me={me} />);
  await waitFor(() => expect(acquired.sort()).toEqual([P1, P2].sort()));
  expect(released).toEqual([]);
  unmount();
  expect(released.sort()).toEqual([P1, P2].sort());
});

it("locked, draws the grid's counts and no session, and opens no project", () => {
  useKeyHolder.setState({ state: 'locked', key: null });
  render(<OrgView me={me} />);
  expect(screen.getByTestId('org-locked').textContent).toContain('2 waiting on you');
  expect(screen.getByTestId('org-locked').textContent).toContain('1 working');
  expect(screen.getByTestId('unlock-form')).toBeTruthy();
  expect(screen.queryAllByTestId('org-session')).toEqual([]);
  expect(acquired).toEqual([]);
});

// What the view says of its own completeness: a roster is drawn as current, and "no session" claimed, only from feeds
// that are connected, caught up and fully verified, as the project view reports its own (refusals named, staleness said).
async function emptyProjects() {
  for (const connection of held.values()) connection.stop();
  for (const project of [P1, P2]) {
    const connection = new ProjectConnection(project, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
    connection.setKey(key);
    connection.live.setState({ status: 'open', connected: true, caughtUp: true });
    held.set(project, connection);
  }
}

it('says no session runs only once every project is connected, caught up and verified', async () => {
  await emptyProjects();
  render(<OrgView me={me} />);
  await waitFor(() => expect(screen.getByTestId('org-empty')).toBeTruthy());
  expect(screen.queryByTestId('org-reading')).toBeNull();
});

it('while a project\'s log is still being verified, names it as being read and claims no empty roster', async () => {
  await emptyProjects();
  const original = crypto.subtle.verify.bind(crypto.subtle);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const spy = vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args: Parameters<SubtleCrypto['verify']>) => {
    await gate;
    return original(...args);
  });
  try {
    const event = (await seal(key, 'log', P2, { seq: 1, ...joined(S.stray, 'mini-7c', 'mini', '2026-10-18T09:00:00.000Z') })) as unknown as LogEvent;
    held.get(P2)!.log.receive([{ offset: 1, event }]);
    presence(held.get(P2)!, { [S.stray]: 'waiting' });
    render(<OrgView me={me} />);
    await waitFor(() => expect(screen.getByTestId('org-reading').textContent).toContain('mini'));
    expect(screen.getByTestId('org-reading').textContent).not.toContain('MAWS');
    expect(screen.queryByTestId('org-empty')).toBeNull();
    release();
    await act(() => held.get(P2)!.log.settled());
    await waitFor(() => expect(screen.getAllByTestId('org-session').map((r) => r.dataset.session)).toEqual([S.stray]));
    expect(screen.queryByTestId('org-reading')).toBeNull();
  } finally {
    release();
    spy.mockRestore();
  }
});

it('names a project whose membership event fails its code, and claims no empty roster', async () => {
  await emptyProjects();
  const genuine = (await seal(key, 'log', P2, { seq: 1, ...joined(S.stray, 'mini-7c', 'mini', '2026-10-18T09:00:00.000Z') })) as unknown as LogEvent;
  held.get(P2)!.log.receive([{ offset: 1, event: { ...genuine, alias: 'forged' } }]);
  await held.get(P2)!.log.settled();
  render(<OrgView me={me} />);
  const alert = await waitFor(() => screen.getByTestId('org-refused'));
  expect(alert.textContent).toContain('mini');
  expect(alert.textContent).toContain('One event');
  expect(alert.textContent).not.toContain('MAWS');
  expect(screen.queryByTestId('org-empty')).toBeNull();
  expect(screen.queryAllByTestId('org-session')).toEqual([]);
});

// The reader rule of #61 (the composite's "A machine's reconnect is invisible to the reader", MAWS #57): a project whose
// roster was current says nothing of a disruption shorter than `QUIET_MS` — a dropped socket, the backlog read again
// after the reconnect, a live event still being checked — and past it says the project is stale and marks its rows.
it('says nothing of a project socket gap shorter than the grace, its re-read after reconnecting included', async () => {
  render(<OrgView me={me} />);
  await waitFor(() => expect(screen.getAllByTestId('org-session')).toHaveLength(4));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    act(() => held.get(P1)!.live.setState({ status: 'connecting', connected: false })); // caughtUp stays true, as on a drop
    act(() => vi.advanceTimersByTime(QUIET_MS - 1));
    expect(screen.queryByTestId('org-stale')).toBeNull();
    expect(screen.queryByTestId('org-reading')).toBeNull();
    expect(screen.getAllByTestId('org-session').filter((r) => r.dataset.stale !== undefined)).toEqual([]);
    // The reconnect: welcomed, its backlog read again, then caught up — the gap closes inside one grace.
    act(() => held.get(P1)!.live.setState({ status: 'open', connected: true, caughtUp: false }));
    expect(screen.queryByTestId('org-reading')).toBeNull();
    act(() => held.get(P1)!.live.setState({ caughtUp: true }));
    act(() => vi.advanceTimersByTime(QUIET_MS));
    expect(screen.queryByTestId('org-stale')).toBeNull();
    expect(screen.queryByTestId('org-reading')).toBeNull();
    expect(screen.getAllByTestId('org-session')).toHaveLength(4);
  } finally {
    vi.useRealTimers();
  }
});

it('marks the sessions of a project whose socket stays dropped past the grace as last seen, and claims no empty roster', async () => {
  render(<OrgView me={me} />);
  await waitFor(() => expect(screen.getAllByTestId('org-session')).toHaveLength(4));
  expect(screen.queryByTestId('org-stale')).toBeNull();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    act(() => held.get(P1)!.live.setState({ status: 'connecting', connected: false }));
    act(() => vi.advanceTimersByTime(QUIET_MS));
    const stale = screen.getByTestId('org-stale');
    expect(stale.textContent).toContain('MAWS');
    expect(stale.textContent).not.toContain('mini');
    const rows = screen.getAllByTestId('org-session');
    expect(rows.filter((r) => r.dataset.stale !== undefined).map((r) => r.dataset.session).sort()).toEqual([S.asks, S.works].sort());
  } finally {
    vi.useRealTimers();
  }

  // A project never current (dropped before this view saw it whole) is said at once: there is no roster to keep.
  cleanup();
  await emptyProjects();
  held.get(P2)!.live.setState({ status: 'connecting', connected: false });
  render(<OrgView me={me} />);
  await waitFor(() => expect(screen.getByTestId('org-stale').textContent).toContain('mini'));
  expect(screen.queryByTestId('org-empty')).toBeNull();
});

it('is at /sessions', () => {
  expect(parseRoute('/sessions')).toEqual({ view: 'org' });
  expect(routePath({ view: 'org' })).toBe('/sessions');
  expect(parseRoute('/sessions/x')).toEqual({ view: 'grid' });
});
