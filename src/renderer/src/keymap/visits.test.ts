// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M3; Interfaces §D; S2; B7): the
// record's one reader over the layout store, the step Back and Forward take, and their two handlers. Every layout change
// here goes through the store's own acts (or `setState` for a split's start), and the reader is read after a whole turn.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { EMPTY_STRIP, type Destination, type TabRef } from '@shared/ipc/schema/layout';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { ARTIFACTS_TOOL_ID } from '@shared/maws/panes';
import { isActionEnabled, runAction } from './actions-runtime';
import { frontOf, quietly, useLayout } from '../stores/layout';
import { resetShellStores } from '../test-support/shell-stores';
import { EMPTY_RECORD, type Place, type Under } from './places';
import { connectVisits, useVisits, type Opened } from './visits';

const S = (id: string) => at(id) as AppSessionId;
const tabOf = (id: string) => `session:${S(id)}`;
const T = (id: string): Under => ({ kind: 'tab', id: tabOf(id) });
const CUSTOMIZE: Destination = { kind: 'customize', view: 'mine', show: 'all' };
const P: Under = { kind: 'page', destination: CUSTOMIZE };
const over = (place: Under): Place => ({ kind: 'overview', over: place });
const ref = (id: string): TabRef => ({ id: tabOf(id), kind: 'session', appSessionId: S(id), pinned: false });
const opened = (id: string): Opened => ({ kind: 'session', appSessionId: S(id) });

const layout = () => useLayout.getState();
const open = (id: string, opts?: { activate?: boolean }) => layout().openTab({ kind: 'session', appSessionId: S(id) }, opts);
// The reader reads once per turn, in a microtask after the first change: a macrotask later it has read.
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const record = () => useVisits.getState().record;
const shown = () => ({ front: frontOf(layout()), page: layout().destination, overview: layout().overviewOpen, settings: layout().settings });
async function visit(...ids: string[]) {
  for (const id of ids) {
    open(id);
    await turn();
  }
}

let off: () => void;
beforeEach(() => {
  resetShellStores();
  useVisits.setState({ record: EMPTY_RECORD, opened: [] });
  off = connectVisits();
});
afterEach(() => {
  off();
  vi.unstubAllGlobals();
});

describe('Back and Forward over the layout', () => {
  it('walk A11: A, B, Customize; back twice, forward; each step records nothing', async () => {
    await visit('a', 'b');
    layout().openDestination(CUSTOMIZE);
    await turn();
    expect(record()).toEqual({ entries: [T('a'), T('b'), P], at: 2 });
    runAction('go.back');
    expect(shown()).toMatchObject({ front: tabOf('b'), page: null });
    await turn();
    runAction('go.back');
    expect(shown()).toMatchObject({ front: tabOf('a'), page: null });
    await turn();
    expect(record()).toEqual({ entries: [T('a'), T('b'), P], at: 0 });
    runAction('go.forward');
    await turn();
    expect(shown()).toMatchObject({ front: tabOf('b'), page: null });
    runAction('go.forward');
    await turn();
    expect(shown()).toMatchObject({ front: tabOf('b'), page: CUSTOMIZE }); // the page opened as it was left
    expect(record()).toEqual({ entries: [T('a'), T('b'), P], at: 2 });
  });

  it('sets the position before it writes the layout', async () => {
    await visit('a', 'b');
    const ats: number[] = [];
    const stop = useLayout.subscribe(() => ats.push(record().at));
    runAction('go.back');
    stop();
    expect(ats.length).toBeGreaterThan(0);
    expect(ats.every((at) => at === 0)).toBe(true);
  });

  it('closes the Settings dialog and shows the place before', async () => {
    await visit('a', 'b');
    layout().openSettings();
    await turn();
    expect(record()).toEqual({ entries: [T('a'), T('b')], at: 1 }); // the dialog is no place
    runAction('go.back');
    expect(shown()).toMatchObject({ front: tabOf('a'), settings: null });
  });

  it('has a handler for go.back exactly while there is an entry before, and for go.forward while there is one after', async () => {
    const enabled = () => [isActionEnabled('go.back'), isActionEnabled('go.forward')];
    expect(enabled()).toEqual([false, false]);
    await visit('a');
    expect(enabled()).toEqual([false, false]);
    await visit('b', 'c');
    expect(enabled()).toEqual([true, false]);
    runAction('go.back');
    await turn();
    expect(enabled()).toEqual([true, true]);
    runAction('go.back');
    await turn();
    expect(enabled()).toEqual([false, true]);
    off();
    expect(enabled()).toEqual([false, false]); // disconnected, the two are gone
    off = () => {};
  });

  it('takes a closed tab out: Back never reopens it (K1, the strip decides what a close shows)', async () => {
    await visit('a');
    open('c', { activate: false }); // in the strip, never looked at
    await visit('b');
    layout().closeTab(tabOf('b'));
    await turn();
    expect(frontOf(layout())).toBe(tabOf('c')); // the strip's neighbour
    expect(record()).toEqual({ entries: [T('a'), T('c')], at: 1 });
    runAction('go.back');
    await turn();
    expect(frontOf(layout())).toBe(tabOf('a'));
    expect(record().entries).toContainEqual(T('a')); // the control: the same read finds a tab that stayed
  });

  it('shows nothing and moves nothing for a step whose tab left the strip in the same turn, and drops the entry at the next read', async () => {
    await visit('a', 'b', 'c');
    layout().closeTab(tabOf('b')); // not in front: the strip still shows c
    runAction('go.back');
    expect(frontOf(layout())).toBe(tabOf('c'));
    await turn();
    expect(record()).toEqual({ entries: [T('a'), T('c')], at: 1 }); // still on what the strip shows
    runAction('go.back'); // the control: a step to a tab that stayed shows it
    expect(frontOf(layout())).toBe(tabOf('a'));
  });
});

describe('a step and the Overview, both ways (finding 5)', () => {
  it('from the Overview over a tab, Back shows the tab with the Overview closed, and Forward opens it again over the same tab', async () => {
    await visit('x', 'a');
    layout().setOverviewOpen(true);
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('a'), over(T('a'))], at: 2 });
    runAction('go.back');
    expect(shown()).toMatchObject({ front: tabOf('a'), overview: false, page: null });
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('a'), over(T('a'))], at: 1 });
    runAction('go.forward');
    expect(shown()).toMatchObject({ front: tabOf('a'), overview: true, page: null });
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('a'), over(T('a'))], at: 2 });
  });

  it('the same over a page', async () => {
    await visit('a');
    layout().openDestination(CUSTOMIZE);
    await turn();
    layout().setOverviewOpen(true);
    await turn();
    expect(record()).toEqual({ entries: [T('a'), P, over(P)], at: 2 });
    runAction('go.back');
    expect(shown()).toMatchObject({ page: CUSTOMIZE, overview: false });
    await turn();
    expect(record().at).toBe(1);
    runAction('go.forward');
    expect(shown()).toMatchObject({ page: CUSTOMIZE, overview: true });
    await turn();
    expect(record()).toEqual({ entries: [T('a'), P, over(P)], at: 2 });
  });

  it('Back onto an Overview entry from a tab shows what it was over and opens it', async () => {
    await visit('a');
    layout().setOverviewOpen(true);
    await turn();
    open('b');
    layout().setOverviewOpen(false);
    await turn();
    expect(record()).toEqual({ entries: [T('a'), over(T('a')), T('b')], at: 2 });
    runAction('go.back');
    expect(shown()).toMatchObject({ front: tabOf('a'), overview: true, page: null });
    await turn();
    expect(record()).toEqual({ entries: [T('a'), over(T('a')), T('b')], at: 1 });
  });

  it('Back onto an Overview entry from a page shows what it was over, the page closed, and opens it', async () => {
    await visit('a');
    layout().setOverviewOpen(true);
    await turn();
    layout().setOverviewOpen(false);
    layout().openDestination(CUSTOMIZE);
    await turn();
    expect(record()).toEqual({ entries: [T('a'), over(T('a')), P], at: 2 });
    runAction('go.back');
    expect(shown()).toMatchObject({ front: tabOf('a'), overview: true, page: null });
    await turn();
    expect(record().at).toBe(1);
  });
});

describe('the reader', () => {
  it('reads an act inside the Overview that changes the strip and closes the Overview in two writes as one visit', async () => {
    // As the Overview's own subscriber does: a change of the strip while it is open closes it in a second write.
    const closer = useLayout.subscribe((state, previous) => {
      if (state.overviewOpen && state.main !== previous.main) state.setOverviewOpen(false);
    });
    try {
      await visit('a');
      layout().setOverviewOpen(true);
      await turn();
      open('b');
      expect(layout().overviewOpen).toBe(false);
      await turn();
      expect(record()).toEqual({ entries: [T('a'), over(T('a')), T('b')], at: 2 }); // no entry for the Overview over b
    } finally {
      closer();
    }
  });

  it('reads a page closed onto the tab before it as a step back, so Forward opens the page again (card K2: Esc was a step back)', async () => {
    await visit('x', 'a');
    layout().openDestination(CUSTOMIZE);
    await turn();
    layout().closeDestination(); // Esc, or the page's own Back
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('a'), P], at: 1 });
    expect(isActionEnabled('go.forward')).toBe(true);
    runAction('go.forward');
    expect(shown()).toMatchObject({ front: tabOf('a'), page: CUSTOMIZE });
    runAction('go.back');
    await turn();
    runAction('go.back');
    expect(frontOf(layout())).toBe(tabOf('x')); // ⌘[ then shows what was looked at before a
  });

  it('records a tab brought forward quietly behind a page when the page closes', async () => {
    await visit('a');
    layout().openDestination(CUSTOMIZE);
    await turn();
    quietly(() => open('b'));
    await turn();
    expect(layout().destination).toEqual(CUSTOMIZE);
    expect(record()).toEqual({ entries: [T('a'), P], at: 1 });
    expect(useVisits.getState().opened).toEqual([opened('a')]);
    layout().closeDestination();
    await turn();
    expect(record()).toEqual({ entries: [T('a'), P, T('b')], at: 2 });
    expect(useVisits.getState().opened).toEqual([opened('b'), opened('a')]);
  });

  it('records nothing before the layout is hydrated; the first entry is the restored place, which opens nothing', async () => {
    off();
    useVisits.setState({ record: EMPTY_RECORD, opened: [] });
    useLayout.setState({ hydrated: false });
    off = connectVisits();
    open('a');
    open('b');
    await turn();
    expect(record()).toEqual(EMPTY_RECORD);
    useLayout.setState({ hydrated: true });
    await turn();
    expect(record()).toEqual({ entries: [T('b')], at: 0 });
    expect(useVisits.getState().opened).toEqual([]);
    await visit('a');
    expect(record()).toEqual({ entries: [T('b'), T('a')], at: 1 }); // the control: after it, a tab shown is a visit
    expect(useVisits.getState().opened).toEqual([opened('a')]);
  });

  it('lists the sessions and artifacts that came to be in front, newest first, each once; a page opens nothing', async () => {
    await visit('a');
    layout().openTab({ kind: 'artifact', artifactId: 'doc-1', machine: TEST_MACHINE });
    await turn();
    layout().openDestination(CUSTOMIZE);
    await turn();
    await visit('a');
    expect(useVisits.getState().opened).toEqual([opened('a'), { kind: 'artifact', artifactId: 'doc-1', machine: TEST_MACHINE }]);
  });
});

// UX wave U6b-5a M4 (decision 18; Decision Log 11 (iii)): the opened list's second source, an artifact shown beside the
// chat, read from the Artifacts tool's `{ target, machine }` under its side tab's `panelParams` after hydration.
describe('an artifact shown beside the chat', () => {
  const SIDE = 'panel-artifacts-a';
  const artifact = (id: string, machine = TEST_MACHINE): Opened => ({ kind: 'artifact', artifactId: id, machine });
  const sideTabs = (...tabs: { id: string; toolId: string }[]) =>
    useLayout.setState({ panelBySession: new Map([[S('a'), { tabs: tabs.map((t) => ({ ...t, pinned: false })), activeTabId: tabs[0]?.id ?? null }]]) });

  it('is not an opening when its side tab is restored at hydration; the same tab shown a second artifact after hydration is', async () => {
    off();
    useVisits.setState({ record: EMPTY_RECORD, opened: [] });
    useLayout.setState({ hydrated: false });
    off = connectVisits();
    // stored before a record named its machine: the restored tool writes it back with this Mac's
    useLayout.setState({ main: { ...EMPTY_STRIP, panes: [{ tabs: [ref('a')], activeTabId: tabOf('a') }], focusedPane: 0 } });
    sideTabs({ id: SIDE, toolId: ARTIFACTS_TOOL_ID });
    useLayout.setState({ panelParams: { [SIDE]: { target: 'doc-1' } }, hydrated: true });
    await turn();
    layout().setPanelParams(SIDE, { target: 'doc-1', machine: TEST_MACHINE });
    await turn();
    expect(useVisits.getState().opened).toEqual([]);
    layout().setPanelParams(SIDE, { target: 'doc-2', machine: TEST_MACHINE }); // the control
    await turn();
    expect(useVisits.getState().opened).toEqual([artifact('doc-2')]);
  });

  it('lists each artifact a side tab comes to show, newest first beside the main tabs; the list, and another tool’s params, open nothing', async () => {
    await visit('a');
    sideTabs({ id: SIDE, toolId: ARTIFACTS_TOOL_ID }, { id: 'panel-files-a', toolId: 'files' });
    await turn();
    layout().setPanelParams(SIDE, { target: 'doc-1', machine: TEST_MACHINE });
    await turn();
    expect(useVisits.getState().opened).toEqual([artifact('doc-1'), opened('a')]);
    layout().setPanelParams(SIDE, null); // back to the list
    await turn();
    layout().setPanelParams('panel-files-a', { target: 'doc-9', machine: TEST_MACHINE });
    await turn();
    expect(useVisits.getState().opened).toEqual([artifact('doc-1'), opened('a')]);
    layout().setPanelParams(SIDE, { target: 'doc-9', machine: TEST_MACHINE }); // the control: the same value on the Artifacts tab
    await turn();
    expect(useVisits.getState().opened).toEqual([artifact('doc-9'), artifact('doc-1'), opened('a')]);
    layout().setPanelParams(SIDE, { target: 'doc-1', machine: OTHER_MACHINE }); // another machine's artifact of the same id
    await turn();
    layout().setPanelParams(SIDE, { target: 'doc-1', machine: TEST_MACHINE });
    await turn();
    expect(useVisits.getState().opened).toEqual([artifact('doc-1'), artifact('doc-1', OTHER_MACHINE), artifact('doc-9'), opened('a')]);
    expect(record()).toEqual({ entries: [T('a')], at: 0 }); // a side tab is no place
  });
});

describe('the projection: a move between the panes of a split (finding 6)', () => {
  // x and a in pane 0, b and c in pane 1; the record holds x, then a.
  async function split() {
    useLayout.setState({ main: { ...EMPTY_STRIP, panes: [{ tabs: [ref('x'), ref('a')], activeTabId: tabOf('x') }, { tabs: [ref('b'), ref('c')], activeTabId: tabOf('b') }], focusedPane: 0 } });
    await turn();
    layout().activateTab(tabOf('a'));
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('a')], at: 1 });
    expect(useVisits.getState().opened).toEqual([opened('a'), opened('x')]);
  }

  it('adds no entry and opens nothing when the keyboard moves to the other pane, nor at a later unrelated write', async () => {
    await split();
    layout().focusPane(1);
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('b')], at: 1 }); // the entry it is at is the tab now in front
    expect(useVisits.getState().opened).toEqual([opened('a'), opened('x')]);
    layout().setPanelParams('side-tab', { target: 'anything' });
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('b')], at: 1 });
    expect(useVisits.getState().opened).toEqual([opened('a'), opened('x')]);
    layout().activateTab(tabOf('c')); // the control: a tab activated in that pane, by the same store, is recorded
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('b'), T('c')], at: 2 });
    expect(useVisits.getState().opened).toEqual([opened('c'), opened('a'), opened('x')]);
  });

  it('adds none when the focus move and an unrelated write come in one turn', async () => {
    await split();
    layout().focusPane(1);
    layout().setPanelParams('side-tab', { target: 'anything' });
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('b')], at: 1 });
    layout().activateTab(tabOf('c')); // the control, in one turn with an unrelated write as well
    layout().setPanelParams('side-tab', { target: 'another' });
    await turn();
    expect(record()).toEqual({ entries: [T('x'), T('b'), T('c')], at: 2 });
  });

  it('after the move, Back shows the place before, not a tab already in view', async () => {
    await split();
    layout().focusPane(1);
    await turn();
    runAction('go.back');
    expect(frontOf(layout())).toBe(tabOf('x'));
  });
});

// M3's re-review: the step's hand-off of the keyboard yields to anything but a return of the keyboard to another pane.
describe('the step’s hand-off of the keyboard', () => {
  // Frames held until the test lets them run: the hand-off lasts until a task after the step's frame.
  function holdFrames() {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++next, callback);
      return next;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    return () => {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    };
  }

  it('gives a pane that only took the keyboard back to the step’s, and yields to a tab activated by a store act before the frame', async () => {
    const release = holdFrames();
    useLayout.setState({ main: { ...EMPTY_STRIP, panes: [{ tabs: [ref('a')], activeTabId: tabOf('a') }, { tabs: [ref('b'), ref('c')], activeTabId: tabOf('b') }], focusedPane: 0 } });
    await turn();
    layout().focusPane(1);
    await turn();
    useVisits.setState({ record: { entries: [T('a'), T('b')], at: 1 } });
    runAction('go.back'); // to A, on the left
    await turn();
    expect(record()).toEqual({ entries: [T('a'), T('b')], at: 0 });
    // the control: the keyboard only returned to the right pane (the Overview's return of it, an opener there)
    layout().focusPane(1);
    await turn();
    expect(layout().main.focusedPane).toBe(0);
    expect(record()).toEqual({ entries: [T('a'), T('b')], at: 0 });
    // an act that shows another tab, made with no key and no press of the person's (an agent's, a store act)
    layout().activateTab(tabOf('c'));
    await turn();
    expect(frontOf(layout())).toBe(tabOf('c'));
    expect(layout().main.focusedPane).toBe(1);
    expect(record()).toEqual({ entries: [T('a'), T('c')], at: 1 });
    release();
    await turn();
    expect(frontOf(layout())).toBe(tabOf('c'));
    expect(record()).toEqual({ entries: [T('a'), T('c')], at: 1 });
  });
});

// The branch panel's fix wave (group G4): a close classified against the record as it stood, and a step that brings
// back a tab under a maximized side column.
describe('history after the branch panel', () => {
  it('reads a close of the tab in front as a new visit to what the strip then shows, not as Back from a page (scalpel-2#2)', async () => {
    const LIBRARY: Destination = { kind: 'library' };
    await visit('a');
    layout().openDestination(CUSTOMIZE);
    await turn();
    await visit('b');
    layout().openDestination(LIBRARY);
    await turn();
    runAction('go.back'); // on B, the Library ahead
    await turn();
    expect(record()).toEqual({ entries: [T('a'), P, T('b'), { kind: 'page', destination: LIBRARY }], at: 2 });
    layout().closeTab(tabOf('b')); // the strip shows A
    await turn();
    expect(frontOf(layout())).toBe(tabOf('a'));
    expect(record()).toEqual({ entries: [T('a'), P, T('a')], at: 2 });
    expect(isActionEnabled('go.forward')).toBe(false); // the abandoned branch is gone
    runAction('go.back');
    expect(shown()).toMatchObject({ page: CUSTOMIZE });
  });

  it('reveals the main area when a step brings back a tab under a maximized side column (scalpel-2#4)', async () => {
    await visit('a', 'b');
    layout().setPanel({ maximized: true, collapsed: false });
    await turn();
    expect(layout().regions.panel.maximized).toBe(true); // the control: reading the layout leaves the column as it is
    runAction('go.back');
    expect(frontOf(layout())).toBe(tabOf('a'));
    expect(layout().regions.panel.maximized).toBe(false);
  });
});

