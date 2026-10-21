// @vitest-environment happy-dom
// The grid's default (smns remote identity §5): the projects with a live session or waiting on the owner, in the grid's
// order over every project; below them, "Show all (N)" reveals the rest, N counting every project, and becomes "Show
// active"; the choice is this browser's, kept across a reload.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ProjectSummary } from 'desk-hub/protocol';
import { GRID_ALL_KEY, sortForGrid, useGrid } from '../../state/grid';
import { GridView } from './GridView';

const summary = (id: string, over: Partial<ProjectSummary> = {}): ProjectSummary => ({ id, name: id, kind: 'hub', machines: 1, machines_online: 1, working: 0, waiting: 0, live: 0, ...over });

const PROJECTS = [
  summary('ci-kit', { live: 1 }),
  summary('acceptance-scratch'),
  summary('MAWS', { live: 3, working: 2 }),
  // A stopped seat's open question: no process, still the owner's to answer.
  summary('arkho', { waiting: 1 }),
  summary('mini', { kind: 'machine' }),
  // Its machine asleep: offline, its sessions still live there.
  summary('doperpowers', { live: 2, machines_online: 0 }),
];

const tiles = () => screen.queryAllByRole('button').map((b) => b.dataset.project).filter((id) => id !== undefined);
const toggle = () => screen.getByTestId('grid-show');

beforeEach(() => {
  localStorage.clear();
  useGrid.setState({ projects: PROJECTS, loaded: true, status: 'open', asOf: Date.now() });
});
afterEach(cleanup);

it('shows the projects with a live session or waiting on you, in the order the grid sorts every project', () => {
  render(<GridView onEnroll={() => {}} />);
  expect(tiles()).toEqual(['arkho', 'MAWS', 'ci-kit', 'doperpowers']);
  expect(tiles()).toEqual(sortForGrid(PROJECTS).map((p) => p.id).filter((id) => !['acceptance-scratch', 'mini'].includes(id)));
  expect(toggle().textContent).toBe('Show all (6)');
  // "All sessions" counts the org's waiting either way.
  expect(screen.getByTestId('all-sessions').textContent).toContain('1 waiting on you');
});

it('reveals every project on Show all, hides the quiet ones again on Show active, and keeps the choice across a reload', () => {
  render(<GridView onEnroll={() => {}} />);
  fireEvent.click(toggle());
  expect(tiles()).toEqual(sortForGrid(PROJECTS).map((p) => p.id));
  expect(toggle().textContent).toBe('Show active');
  expect(localStorage.getItem(GRID_ALL_KEY)).toBe('true');

  cleanup(); // a reload: the grid mounts again and reads the kept choice
  render(<GridView onEnroll={() => {}} />);
  expect(tiles()).toHaveLength(6);
  fireEvent.click(toggle());
  expect(tiles()).toEqual(['arkho', 'MAWS', 'ci-kit', 'doperpowers']);
  expect(localStorage.getItem(GRID_ALL_KEY)).toBe('false');
  cleanup();
  render(<GridView onEnroll={() => {}} />);
  expect(toggle().textContent).toBe('Show all (6)');
});

it('drops a project behind Show all once its last session ends, and offers no toggle while nothing is hidden', () => {
  useGrid.setState({ projects: [summary('MAWS', { live: 1 }), summary('arkho', { waiting: 2 })] });
  render(<GridView onEnroll={() => {}} />);
  expect(tiles()).toEqual(['arkho', 'MAWS']);
  expect(screen.queryByTestId('grid-show')).toBeNull();

  act(() => useGrid.setState({ projects: [summary('MAWS'), summary('arkho', { waiting: 2 })] }));
  expect(tiles()).toEqual(['arkho']);
  expect(toggle().textContent).toBe('Show all (2)');
});

it("shows a project whose summary carries no live count, as a Registry on the version before it sends", () => {
  const older = { ...summary('arkho'), live: undefined } as unknown as ProjectSummary;
  useGrid.setState({ projects: [older, summary('scratch')] });
  render(<GridView onEnroll={() => {}} />);
  expect(tiles()).toEqual(['arkho']);
});

// The desk's one display locale (P4 Decision Log 4): this project runs under a Korean system locale (vitest.config.ts),
// where a formatter on the default locale writes "PM 02:05" (a Korean browser, "오후 02:05").
it('says how old the held counts are in English while it reconnects', () => {
  useGrid.setState({ status: 'connecting', asOf: new Date(2026, 9, 6, 14, 5).getTime() });
  render(<GridView onEnroll={() => {}} />);
  expect(screen.getByTestId('grid-stale').textContent!.replace(/\s/g, ' ')).toContain('Counts as of 2:05 PM.');
});

it('says no project has a live session when none is active, with every project one tap away', () => {
  useGrid.setState({ projects: [summary('MAWS'), summary('mini', { kind: 'machine' })] });
  render(<GridView onEnroll={() => {}} />);
  expect(tiles()).toEqual([]);
  expect(screen.getByTestId('grid-quiet').textContent).toBe('No project has a live session.');
  expect(screen.queryByTestId('grid-empty')).toBeNull();
  fireEvent.click(toggle());
  expect(tiles()).toEqual(['MAWS', 'mini']);
});
