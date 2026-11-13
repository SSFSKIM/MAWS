// UX wave U13a (its section's "How a tab names its place"; A9): a session tab names its place, the sidebar row it sits
// under and, for a session on another machine, that machine, only while the strip's session tabs are in more than one
// place. A tab with no place counts as none.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import { project, record } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { TabStrip } from './TabStrip';

const nine = pageScenario(scenarioFile('nine-sessions'));
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const MAWS = at('proj-maws' as ProjectId);

const names = (strip = 'Open tabs') => within(screen.getByRole('tablist', { name: strip })).queryAllByRole('tab').map((t) => t.getAttribute('aria-label'));
const tabOf = (appSessionId: AppSessionId) => document.querySelector<HTMLElement>(`[data-tab-id="session:${appSessionId}"]`)!;
const open = (appSessionId: AppSessionId) => act(() => useLayout.getState().openSession(appSessionId, { how: 'tab' }));

beforeEach(() => {
  resetShellStores();
  fillStores(scenarioFile('nine-sessions'));
  useMachines.setState({ loaded: new Set([TEST_MACHINE]) }); // a session's row is known once its machine has answered
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

describe('a tab’s place', () => {
  it('is not drawn while every session tab is in one place; the first tab of a second place draws every one, and the last one’s close takes them away', () => {
    render(<TabStrip pane={0} split={false} idPrefix="place" />);
    open(idOf('Charter + research'));
    open(idOf('Fix sidebar drag'));
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' })); // a tab of no session has no place
    expect(names()).toEqual(['Charter + research', 'Fix sidebar drag', 'Diagnostics']);
    expect(tabOf(idOf('Charter + research')).querySelector('[data-tab-place]')).toBeNull();

    open(idOf('Quota reset recovery'));
    expect(names()).toEqual(['Charter + research · MAWS', 'Fix sidebar drag · MAWS', 'Diagnostics', 'Quota reset recovery · codex_somersault']);
    const charter = tabOf(idOf('Charter + research'));
    expect(charter.title).toBe('Charter + research · MAWS'); // the tooltip carries both
    expect(charter.querySelector('[data-tab-place]')?.textContent).toBe('MAWS');

    act(() => useLayout.getState().closeTab(`session:${idOf('Quota reset recovery')}`));
    expect(names()).toEqual(['Charter + research', 'Fix sidebar drag', 'Diagnostics']);
  });

  it('counts the session tabs of both panes together', () => {
    open(idOf('Charter + research'));
    open(idOf('Quota reset recovery'));
    act(() => useLayout.getState().splitWithActive());
    render(<><TabStrip pane={0} split idPrefix="left" /><TabStrip pane={1} split idPrefix="right" /></>);
    expect(names('Left pane tabs')).toEqual(['Charter + research · MAWS']);
    expect(names('Right pane tabs')).toEqual(['Quota reset recovery · codex_somersault']);
  });

  it('of a session in no listed project is its machine’s row, this Mac’s named as the sidebar names it', () => {
    render(<TabStrip pane={0} split={false} idPrefix="place" />);
    open(idOf('Charter + research'));
    open(idOf('Terminal workflow notes')); // no project
    expect(names()).toEqual(['Charter + research · MAWS', 'Terminal workflow notes · This Mac']);
  });

  it('of an unstarted chat is the project chosen in it; one with no project names none and is no place', () => {
    const chosen = at('app-chosen' as AppSessionId);
    const bare = at('app-bare' as AppSessionId);
    useSessions.setState({ unstarted: new Map([[chosen, { projectId: MAWS, createdAt: '2026-11-12T10:00:00Z' }], [bare, { projectId: null, createdAt: '2026-11-12T10:00:00Z' }]]) });
    render(<TabStrip pane={0} split={false} idPrefix="place" />);
    open(idOf('Charter + research'));
    open(bare);
    expect(names()).toEqual(['Charter + research', 'New chat']); // the chat with no project counts as no place
    open(chosen);
    expect(names()).toEqual(['Charter + research', 'New chat', 'New chat']); // both in MAWS: one place
    open(idOf('Quota reset recovery'));
    expect(names()).toEqual(['Charter + research · MAWS', 'New chat', 'New chat · MAWS', 'Quota reset recovery · codex_somersault']);
  });

  it('reserves no room in the tab’s minimum width', () => {
    render(<TabStrip pane={0} split={false} idPrefix="place" />);
    open(idOf('Fix sidebar drag'));
    open(idOf('Charter + research'));
    act(() => useLayout.getState().activateTab(`session:${idOf('Fix sidebar drag')}`));
    const bare = tabOf(idOf('Charter + research')).style.minWidth;
    open(idOf('Quota reset recovery'));
    act(() => useLayout.getState().activateTab(`session:${idOf('Fix sidebar drag')}`));
    expect(tabOf(idOf('Charter + research')).querySelector('[data-tab-place]')).not.toBeNull();
    expect(tabOf(idOf('Charter + research')).style.minWidth).toBe(bare);
  });

  // The architect's ruling of 2026-11-13: a place is drawn readable or not at all. happy-dom lays nothing out, so the
  // one-strip e2e scene measures it; here the classes it hangs on: a one-line box that clips what wraps, and a place
  // that asks the line for its whole text or 5em, whichever is less.
  it('sits in a one-line box that clips what wraps, asking for its whole text or 5em', () => {
    render(<TabStrip pane={0} split={false} idPrefix="place" />);
    open(idOf('Charter + research'));
    open(idOf('Quota reset recovery'));
    const place = tabOf(idOf('Charter + research')).querySelector<HTMLElement>('[data-tab-place]')!;
    expect(place.className.split(' ')).toEqual(expect.arrayContaining(['basis-[5em]', 'grow', 'max-w-max', 'min-w-0', 'truncate']));
    expect(place.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'h-[1lh]', 'overflow-hidden', 'gap-x-1.5']));
    expect(place.previousElementSibling!.className.split(' ')).toEqual(expect.arrayContaining(['max-w-full', 'shrink-0', 'truncate']));
  });

  it('is in the All tabs menu’s line with the title', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180);
    render(<TabStrip pane={0} split={false} idPrefix="place" />);
    open(idOf('Charter + research'));
    open(idOf('Quota reset recovery'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'All tabs' }));
    const lines = screen.getAllByRole('menuitemradio');
    expect(lines.map((line) => line.getAttribute('aria-label'))).toEqual(['Charter + research · MAWS', 'Quota reset recovery · codex_somersault']);
    expect(within(lines[0]).getByText('MAWS')).toBeTruthy();
  });
});

// P5 O6 M5's two machines: a project checked out here and on Studio is one row; Studio's own row holds its sessions in
// no listed project.
describe('a tab’s place on another machine', () => {
  const studio = (id: string) => addressOf(OTHER_MACHINE, id);
  const maws = { key: 'repo:maws' as OrgKey, name: 'MAWS', source: 'remote' as const, smnsId: null };
  const projects: ProjectRecord[] = [project(at('maws'), 0, { name: 'MAWS', org: maws }), project(studio('maws-b'), 0, { name: 'maws-b', org: maws })];
  const HERE = at('here' as AppSessionId);
  const THERE = studio('there') as AppSessionId;
  const HOME = studio('home') as AppSessionId;
  beforeEach(() => {
    useSessions.setState({
      projects: new Map(projects.map((p) => [p.id, p])),
      records: new Map([
        record(HERE, { projectId: at('maws') as ProjectId, title: { text: 'Sidebar pass', source: 'user' } }),
        record(THERE, { projectId: studio('maws-b') as ProjectId, title: { text: 'Studio build', source: 'user' } }),
        record(HOME, { projectId: null, title: { text: 'Home errand', source: 'user' } }),
      ].map((r) => [r.appId, r])),
    });
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-12T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-11-12T10:00:00Z', generation: 0 },
    ]);
  });

  it('names its row and its machine, and its machine alone before that machine has answered', () => {
    render(<TabStrip pane={0} split={false} idPrefix="remote" />);
    open(HERE);
    open(THERE);
    expect(names()).toEqual(['Sidebar pass · MAWS', 'Studio build · @Studio']); // Studio not answered yet: its row is not known
    act(() => useMachines.getState().setLoaded(OTHER_MACHINE));
    expect(names()).toEqual(['Sidebar pass · MAWS', 'Studio build · MAWS @Studio']);
    expect(tabOf(THERE).querySelector('[data-tab-place]')?.textContent).toBe('MAWS @Studio');
  });

  it('of a session in no listed project there is its machine, marked as another machine', () => {
    useMachines.getState().setLoaded(OTHER_MACHINE);
    render(<TabStrip pane={0} split={false} idPrefix="remote" />);
    open(HERE);
    open(HOME);
    expect(names()).toEqual(['Sidebar pass · MAWS', 'Home errand · @Studio']);
  });
});
