// P2-D (the P2 spec, child P2-D, G1 to G5): the chooser over the real session store — an empty list, a selection that
// holds while the store reorders and drops rows, and the folder badges by the scope shown.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { project, record } from '../../../../test/support/builders';
import { formatDateTime } from '../app/date-format';
import { useSessions } from '../stores/sessions';
import { RESUME_COPY } from './copy';
import { clearPreviewCache, SETTLE_MS } from './preview';
import { ResumeChooser } from './ResumeChooser';

const P = project('p', 0, { name: 'maws' });
const Q = project('q', 1, { name: 'usage' });
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 12, minutes)).toISOString();
const base: SessionRecord[] = [
  record('alpha', { projectId: P.id, updatedAt: at(9) }),
  record('beta', { projectId: P.id, updatedAt: at(5) }),
  record('gamma', { projectId: P.id, updatedAt: at(1) }),
  record('elsewhere', { projectId: Q.id, updatedAt: at(3) }),
];

const fill = (records: SessionRecord[]) => useSessions.setState({ records: new Map(records.map((r) => [r.appId, r])), digests: new Map(), projects: new Map([P, Q].map((p) => [p.id, p])) });
// a store write as main's `session.changed` lands one: the record replaced, the rest kept
const change = (appId: string, over: Partial<SessionRecord>) =>
  act(() => {
    const records = new Map(useSessions.getState().records);
    const current = [...records.values()].find((r) => r.appId === appId)!;
    records.set(current.appId, { ...current, ...over });
    useSessions.setState({ records });
  });

beforeEach(() => {
  clearPreviewCache();
  window.maws = fakeClient({
    'git.worktree.list': { repoRoot: P.directory, commonDir: `${P.directory}/.git`, worktrees: [] },
    'session.recentTurns': { turns: [], earlier: false, source: 'transcript' },
  }).client;
});
afterEach(() => {
  cleanup();
  useSessions.setState({ records: new Map(), digests: new Map(), projects: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = (projectId: ProjectId | null = P.id as ProjectId) => render(<ResumeChooser context={{ projectId, exclude: null }} close={vi.fn()} />);
const selected = () => screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')?.querySelector('[data-title]')?.textContent;
const titles = () => screen.queryAllByRole('option').map((o) => o.querySelector('[data-title]')!.textContent);

describe('the resume chooser', () => {
  it('an empty project says so in the list and the preview', () => {
    fill(base.filter((r) => r.projectId !== P.id));
    mount();
    expect(screen.getByRole('listbox').textContent).toContain(RESUME_COPY.none);
    expect(screen.getByRole('region', { name: 'Preview' }).textContent).toBe(RESUME_COPY.nothing);
  });

  it('a search that matches nothing says so in the list and the preview', async () => {
    const user = userEvent.setup();
    fill(base);
    mount();
    await user.keyboard('nothing-like-it');
    expect(titles()).toEqual([]);
    expect(screen.getByRole('listbox').textContent).toContain(RESUME_COPY.noMatch);
    expect(screen.getByRole('region', { name: 'Preview' }).textContent).toBe(RESUME_COPY.nothing);
  });

  it('the opening selection stays on its session when another becomes the newest', () => {
    fill(base);
    mount();
    expect(selected()).toBe('alpha');
    change('gamma', { updatedAt: at(30) });
    expect(titles()).toEqual(['gamma', 'alpha', 'beta']);
    expect(selected()).toBe('alpha');
  });

  it('a search’s first row stays selected when another match becomes the newest', async () => {
    const user = userEvent.setup();
    fill(base);
    mount();
    await user.keyboard('a'); // alpha, beta, gamma
    expect(selected()).toBe('alpha');
    change('beta', { updatedAt: at(30) });
    expect(titles()[0]).toBe('beta');
    expect(selected()).toBe('alpha');
  });

  it('a selection that leaves the list falls back to the first row, which keeps it when the other returns', () => {
    fill(base);
    mount();
    expect(selected()).toBe('alpha');
    change('alpha', { archived: true });
    expect(titles()).toEqual(['beta', 'gamma']);
    expect(selected()).toBe('beta');
    change('alpha', { archived: false });
    expect(titles()).toEqual(['alpha', 'beta', 'gamma']);
    expect(selected()).toBe('beta');
  });

  it('a fallback after the opening selection reads its preview once the selection settles, not at once', async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeClient({ 'git.worktree.list': { repoRoot: P.directory, commonDir: `${P.directory}/.git`, worktrees: [] }, 'session.recentTurns': { turns: [], earlier: false, source: 'transcript' } });
      window.maws = fake.client;
      const read = () => fake.invoked('session.recentTurns').map((input) => (input as { appSessionId: string }).appSessionId);
      fill(base);
      mount();
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(read(), 'the opening selection at once').toEqual(['alpha']);
      change('alpha', { archived: true });
      expect(selected()).toBe('beta');
      await act(async () => void (await vi.advanceTimersByTimeAsync(SETTLE_MS - 1)));
      expect(read()).toEqual(['alpha']);
      change('beta', { archived: true });
      expect(selected()).toBe('gamma');
      await act(async () => void (await vi.advanceTimersByTimeAsync(SETTLE_MS)));
      expect(read(), 'the fallbacks settle like a move: only the one that stays is read').toEqual(['alpha', 'gamma']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a conversation whose turns all lie before the read window says earlier messages are not shown, not that it has none', async () => {
    window.maws = fakeClient({ 'git.worktree.list': { repoRoot: P.directory, commonDir: `${P.directory}/.git`, worktrees: [] }, 'session.recentTurns': { turns: [], earlier: true, source: 'transcript' } }).client;
    fill(base);
    mount();
    const turns = screen.getByTestId('resume-turns');
    expect(await within(turns).findByText(RESUME_COPY.earlier)).toBeTruthy();
    expect(turns.textContent).not.toContain(RESUME_COPY.empty);
  });

  it('a row’s time and the preview’s last activity carry the date and time in the system locale, as the rest of MAWS', () => {
    fill(base);
    mount();
    const full = formatDateTime(Date.parse(at(9)));
    const alpha = screen.getAllByRole('option').find((o) => o.querySelector('[data-title]')!.textContent === 'alpha')!;
    expect(alpha.querySelector(`[title="${full}"]`)).not.toBeNull();
    expect(within(screen.getByTestId('resume-preview')).getByTitle(full)).toBeTruthy();
  });

  it('badges the opened project’s rows only once All projects widens past it', async () => {
    const user = userEvent.setup();
    fill(base);
    mount();
    expect(screen.queryAllByTestId('row-folder')).toEqual([]);
    await user.click(screen.getByRole('button', { name: /^All projects/ }));
    const badge = (title: string) => within(screen.getAllByRole('option').find((o) => o.querySelector('[data-title]')!.textContent === title)!).queryByTestId('row-folder')?.textContent;
    expect(badge('alpha')).toBe('maws');
    expect(badge('elsewhere')).toBe('usage');
  });

  // P2-F W-V (L131): Claude Desktop's picker (cc43287c9-ua-2O55p.js:34271-34273, 34393-34399, 34519-34525, 34487-34495)
  it('draws the 100 newest, loads 100 more when the list scrolls near its end or ArrowDown passes the last row, and a new search starts over', async () => {
    const user = userEvent.setup();
    const t0 = Date.UTC(2026, 9, 1, 12);
    fill(Array.from({ length: 250 }, (_, k) => record(`s${String(k).padStart(3, '0')}`, { projectId: P.id, updatedAt: new Date(t0 - k * 60_000).toISOString() })));
    mount();
    const list = screen.getByRole('listbox');
    expect(titles()).toHaveLength(100);
    expect(list.textContent).toContain('Showing 100 of 250. Scroll for more, or type to narrow the list.');
    const scrollTo = (top: number) => {
      Object.defineProperties(list, { scrollHeight: { value: 3600, configurable: true }, clientHeight: { value: 400, configurable: true } });
      list.scrollTop = top;
      act(() => void list.dispatchEvent(new Event('scroll')));
    };
    scrollTo(2800); // 400 px from the end: not yet
    expect(titles()).toHaveLength(100);
    scrollTo(2900); // 300 px from the end
    expect(titles()).toHaveLength(200);
    expect(list.textContent).toContain('Showing 200 of 250.');
    await user.click(screen.getAllByRole('option')[199]);
    await user.keyboard('{ArrowDown}');
    expect(titles()).toHaveLength(250);
    expect(selected()).toBe('s200');
    expect(list.textContent).not.toContain('Scroll for more');
    await user.keyboard('s'); // every session matches: the first page again
    expect(titles()).toHaveLength(100);
    expect(selected()).toBe('s000');
  });
});
