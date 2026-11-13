// The proposed change of a file prompt as the card draws it (UX wave U1a, §I): the path relative to the session's working
// folder, the diff in the transcript's own lines under a capped height with "Show all", which lifts the cap and
// `EditDiff`'s own budget so every line of the change can be read whole, and the input alone where no diff is drawn.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record } from '../../../../../test/support/builders';
import { at } from '../../../../../test/support/machine';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import type { Hunk } from '../../transcript/model/rows';
import { EditDiff } from '../../transcript/view/cells/EditDetail';
import { permission, type PermissionEvent } from '../test-requests';
import type { Proposed } from './proposed';
import { COLLAPSED_LINES, LIFTS_INNER_BOUND, ProposedChange } from './ProposedChange';

const APP = at('app-proposed' as AppSessionId);
const BUDGET = 64 * 1024; // EditDiff's own bound on line text (TRUNCATE_OVER)

beforeEach(() => {
  resetShellStores();
  useSessions.setState((s) => ({ records: new Map(s.records).set(APP, record(APP, { directory: '/work/proj' })), recordsVersion: s.recordsVersion + 1 }));
});
afterEach(cleanup);

const edit = (file_path = '/work/proj/src/list.txt', over: Partial<PermissionEvent> = {}) =>
  permission({ toolName: 'Edit', displayName: 'Edit', input: { file_path, old_string: 'alpha\nbeta', new_string: 'gamma' }, ...over });
const added = (lines: string[]): Hunk => ({ oldStart: 1, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((l) => `+${l}`) });
const diff = (hunks: Hunk[], change: 'create' | 'update' = 'update'): Proposed => ({ kind: 'diff', change, hunks });
const draw = (proposed: Proposed, request = edit()) => render(<ProposedChange request={request} proposed={proposed} appSessionId={APP} />);
const diffLines = () => document.querySelectorAll('[data-diff]');
const omitted = () => document.querySelector('[data-omitted]');
const showAll = () => screen.queryByRole('button', { name: 'Show all' });

describe('the path', () => {
  it('reads relative to the working folder, and whole in its title', () => {
    draw({ kind: 'input' });
    const path = screen.getByTestId('request-input');
    expect(path.textContent).toBe('src/list.txt');
    expect(path.querySelector('[title]')?.getAttribute('title')).toBe('/work/proj/src/list.txt');
  });

  it('reads whole outside the working folder, and where this window holds no record of the session', () => {
    draw({ kind: 'input' }, edit('/elsewhere/list.txt'));
    expect(screen.getByTestId('request-input').textContent).toBe('/elsewhere/list.txt');
    cleanup();
    draw({ kind: 'input' }, edit('/work/project-two/list.txt')); // a sibling folder whose name starts the same
    expect(screen.getByTestId('request-input').textContent).toBe('/work/project-two/list.txt');
    cleanup();
    act(() => useSessions.setState((s) => ({ records: new Map(), recordsVersion: s.recordsVersion + 1 })));
    draw({ kind: 'input' });
    expect(screen.getByTestId('request-input').textContent).toBe('/work/proj/src/list.txt');
  });
});

describe('the diff', () => {
  it('is the transcript’s numbered lines, added and removed, with no "Show all" when it fits', async () => {
    draw(diff([{ oldStart: 4, oldLines: 3, newStart: 4, newLines: 3, lines: [' three', '-four', '+FOUR', ' five'] }]));
    await screen.findByText('FOUR');
    expect([...diffLines()].map((line) => (line as HTMLElement).dataset.diff)).toEqual(['context', 'del', 'add', 'context']);
    expect([...document.querySelectorAll('[data-line-number]')].map((n) => n.textContent)).toEqual(['4', '5', '5', '6']);
    expect(showAll()).toBeNull();
  });

  it('offers "Show all" once the change is taller than its capped height: twelve lines fit, thirteen do not', async () => {
    expect(COLLAPSED_LINES).toBe(12);
    draw(diff([added(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`))], 'create'));
    await screen.findByText('line 12');
    expect(showAll()).toBeNull();
    cleanup();
    draw(diff([added(Array.from({ length: 13 }, (_, i) => `line ${i + 1}`))], 'create'));
    await screen.findByText('line 13');
    expect(showAll()).not.toBeNull();
  });

  it('holds the bound in its own region, lifting the transcript’s 240 px with important utilities, collapsed and expanded', async () => {
    // happy-dom computes no cascade: this pins the classes; the computed values are M7's Electron scene
    expect(LIFTS_INNER_BOUND.split(' ')).toEqual(['[&_.transcript-diff]:max-h-none!', '[&_.transcript-diff]:overflow-visible!']);
    draw(diff([added(Array.from({ length: 13 }, (_, i) => `line ${i + 1}`))], 'create'));
    await screen.findByText('line 13');
    const region = document.querySelector<HTMLElement>('[data-proposed-diff]')!;
    expect(region.dataset.proposedDiff).toBe('collapsed');
    expect(region.className.split(' ')).toEqual(expect.arrayContaining([...LIFTS_INNER_BOUND.split(' '), 'overflow-y-hidden']));
    expect(region.style.maxHeight).toBe('calc(12 * 1.75 * var(--text-code) + 2px)');
    await userEvent.setup().click(showAll()!);
    expect(region.dataset.proposedDiff).toBe('whole');
    expect(region.className.split(' ')).toEqual(expect.arrayContaining([...LIFTS_INNER_BOUND.split(' '), 'max-h-[60vh]', 'overflow-auto']));
    expect(region.style.maxHeight).toBe('');
  });

  it('a change past EditDiff’s budget leaves lines out while collapsed, and holds every line after "Show all"', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i} ${'x'.repeat(1000)}`);
    draw(diff([added(lines)], 'create'));
    await screen.findByText(/^0 x/);
    expect(omitted()).not.toBeNull();
    expect(diffLines().length).toBeLessThan(100);
    await userEvent.setup().click(showAll()!);
    expect(omitted()).toBeNull();
    expect([...diffLines()].map((line) => line.lastElementChild!.textContent)).toEqual(lines);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
  });

  it('a line longer than the budget is cut while collapsed and whole after "Show all"', async () => {
    const long = `start ${'y'.repeat(BUDGET + 10_000)} end`;
    draw(diff([added(['before', long, 'after'])], 'create'));
    await screen.findByText('before');
    const text = () => diffLines()[1]!.lastElementChild!.textContent!;
    expect(text().length).toBeLessThan(long.length);
    await userEvent.setup().click(showAll()!);
    expect(text()).toBe(long);
    expect(omitted()).toBeNull();
  });

  it('says so when a new file is empty, or the change leaves the text as it is', () => {
    draw(diff([], 'create'));
    expect(screen.getByText('An empty file')).toBeTruthy();
    cleanup();
    draw(diff([], 'update'));
    expect(screen.getByText('The file’s text stays as it is')).toBeTruthy();
  });
});

describe('the input alone', () => {
  it('draws the old and new text whole, as removed and added blocks without numbers', () => {
    const old_string = Array.from({ length: 20 }, (_, i) => `old ${i}`).join('\n');
    const new_string = Array.from({ length: 20 }, (_, i) => `new ${i}`).join('\n');
    draw({ kind: 'input' }, permission({ toolName: 'Edit', displayName: 'Edit', input: { file_path: '/work/proj/a.txt', old_string, new_string } }));
    expect(screen.getByText(/^old 0/).textContent).toBe(old_string);
    expect(screen.getByText(/^new 0/).textContent).toBe(new_string);
    expect(document.querySelector('[data-line-number]')).toBeNull();
  });
});

describe('EditDiff without `whole`', () => {
  it('draws as it does today: past its budget, lines left out and a long line cut', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i} ${'x'.repeat(1000)}`);
    render(<EditDiff hunks={[added(lines)]} cell={null} />);
    expect(document.querySelector('[data-omitted]')?.textContent).toMatch(/lines omitted/);
    cleanup();
    const long = 'z'.repeat(BUDGET + 10_000);
    render(<EditDiff hunks={[added([long])]} cell={null} />);
    expect(document.querySelector('[data-diff]')!.lastElementChild!.textContent!.length).toBeLessThan(long.length);
  });

  it('with `whole`, leaves out no line and cuts none', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i} ${'x'.repeat(1000)}`);
    const long = 'z'.repeat(BUDGET + 10_000);
    render(<EditDiff hunks={[added([...lines, long])]} cell={null} whole />);
    expect(document.querySelector('[data-omitted]')).toBeNull();
    expect([...document.querySelectorAll('[data-diff]')].map((line) => line.lastElementChild!.textContent)).toEqual([...lines, long]);
  });
});
