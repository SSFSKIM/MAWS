// The title bar: no project chip left of the chrome's tab strips (the word cut, W4), a page's name drawn on the Projects
// page alone (W6), and the leading box's room at every zoom.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { Destination } from '@shared/ipc/schema/layout';
import { newChat, registerSessionCreator } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { shellGeometryOf } from './shell-view';
import { PAGE_TITLE_ID } from '../destination/DestinationPage';
import { useZoom } from '../stores/zoom'; // UX wave U6b-5b
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import { project, remoteRow } from '../../../../test/support/builders';
import { useSessions } from '../stores/sessions';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { Toolbar } from './Toolbar';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => pageScenario(nine).sessions.find((r) => r.title.text === title)!.appId; // P5 O6 M2: the page's ids
const NEW = at('app-new' as AppSessionId);
const offs: (() => void)[] = [];

const toolbar = () => screen.getByRole('banner');
const chip = () => toolbar().querySelector<HTMLElement>('[data-toolbar-project]');

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  useMachines.setState({ loaded: new Set([TEST_MACHINE]) }); // the current project is known once the session's machine has answered
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

describe('the title bar left of the tabs', () => {
  // the word cut (W4): no project chip left of the chrome tab strips; the tabs and the surface icons take its room
  it('draws no project chip, whatever is in front and however wide the window', () => {
    render(<Toolbar />);
    act(() => useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' }));
    expect(chip()).toBeNull();
    expect(within(toolbar()).queryByRole('button', { name: /in sidebar$/ })).toBeNull();
    expect(within(toolbar()).queryByText('MAWS')).toBeNull();
    act(() => useLayout.getState().openSession(idOf('Terminal workflow notes'), { how: 'tab' }));
    expect(within(toolbar()).queryByText('This Mac')).toBeNull();
  });

  // the branch review (finding 4): a lane A listing opened with no record read sits under its listing's row, as lane B's does
  it('New chat starts in the folder here of the row of a lane A session in front, read from its listing', async () => {
    const KEY = 'repo:lane-a-fixture' as OrgKey;
    const LOCAL = at('proj-lane-a' as ProjectId);
    const LISTED = addressOf(OTHER_MACHINE, 'lane-a-1' as AppSessionId);
    useSessions.setState((s) => ({
      projects: new Map(s.projects).set(LOCAL, project(LOCAL, 9, { name: 'lane-a-fixture', org: { key: KEY, name: 'lane-a-fixture', source: 'repository', smnsId: null } })),
      listed: new Map([[LISTED, { ...remoteRow(OTHER_MACHINE, 'eng-lane-a', { lane: 'A', orgKey: KEY, title: 'Remote work' }), appId: LISTED }]]),
    }));
    useMachines.setState({ loaded: new Set([TEST_MACHINE, OTHER_MACHINE]) });
    const asked: (ProjectId | null)[] = [];
    offs.push(registerSessionCreator(async (projectId) => (asked.push(projectId), NEW)));
    render(<Toolbar />);
    act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: LISTED }));
    await act(async () => void (await newChat()));
    expect(asked).toEqual([LOCAL]);
  });
});

// the word cut (W6, the owner's ruling of 2026-11-20): a page's name is drawn in the title bar on the Projects page alone;
// Customize and Artifacts keep it as a hidden heading, which still labels the page
describe('the title bar over a page', () => {
  it.each([
    [{ kind: 'projects' }, 'Projects', true],
    [{ kind: 'customize', view: 'mine', show: 'all' }, 'Customize', false],
    [{ kind: 'library' }, 'Artifacts', false],
  ] satisfies [Destination, string, boolean][])('on %o, its name %s is a level-1 heading, drawn: %s', (destination, name, drawn) => {
    render(<Toolbar />);
    act(() => useLayout.getState().openDestination(destination));
    const heading = within(toolbar()).getByRole('heading', { level: 1, name });
    expect(heading.id).toBe(PAGE_TITLE_ID);
    expect(heading.classList.contains('sr-only')).toBe(!drawn);
    expect(within(toolbar()).getByRole('button', { name: 'Back' })).toBeTruthy();
  });
});

// UX wave U6b-5b (placement 5; Decision Log 18): the traffic lights keep 78 points clear at every zoom, which is
// 78 ÷ the factor CSS pixels, so the box that holds that clearance, the two buttons and its padding (150 CSS pixels at
// 100 %) is never narrower than all three, the sidebar's width or not
describe('the title bar’s leading box at the window’s zoom', () => {
  const leading = () => toolbar().firstElementChild as HTMLElement;
  const sidebarWidth = () => shellGeometryOf(useLayout.getState(), window.innerWidth).sidebar;
  afterEach(() => useZoom.setState({ factor: 1 }));

  it('holds the lights’ clearance, the buttons and the padding at 50 %: 228 CSS pixels with the sidebar hidden', () => {
    act(() => useLayout.getState().setSidebar({ collapsed: true }));
    render(<Toolbar />);
    expect(sidebarWidth()).toBe(0);
    expect(leading().style.width).toBe('150px'); // the control: at 100 % the box is as wide as today
    act(() => useZoom.setState({ factor: 0.5 }));
    expect(leading().style.width).toBe('228px'); // 156 of clearance, 2 × 28 of buttons, 4 between, 12 of padding
    act(() => useZoom.setState({ factor: 2 }));
    expect(leading().style.width).toBe('150px'); // a larger factor never narrows it below today's
  });

  it('is the sidebar’s width at 100 %, and at 50 % not narrower than the clearance and the controls, the sidebar at its narrowest', () => {
    act(() => useLayout.getState().setSidebar({ collapsed: false, width: 200 }));
    render(<Toolbar />);
    const sidebar = sidebarWidth();
    expect(sidebar).toBeGreaterThan(0);
    expect(leading().style.width).toBe(`${sidebar}px`); // the control: the sidebar's width, as today
    act(() => useZoom.setState({ factor: 0.5 }));
    expect(leading().style.width).toBe(`${Math.max(sidebar, 228)}px`);
  });
});
