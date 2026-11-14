import { act, cleanup, render, screen } from '@testing-library/react';
import { storedMain } from '@shared/ipc/schema/layout';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'; // C7: vi
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { item, record, remoteRow, T0 } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useAttention } from '../stores/attention';
import { registerSlot, resetSlots } from '../app/slots';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { SessionPane } from './SessionPane';
import { useMachines } from '../stores/machines';
import { useLayout } from '../stores/layout';
import { connectRemoteLaneB } from '../lane-b/remote-connect';
import { applyRemoteSession, resetRemoteLaneBStore } from '../lane-b/remote-session';
import { remoteSessionState } from '../lane-b/test-support/remote-session';
import { useEffect } from 'react'; // board 525
import { READ_REFUSED } from '@shared/org/reader'; // board 525
import { resetLaneAWatches, watchLaneA } from '../lane-a/watches'; // board 525
import { READER } from '../sessions/share/copy'; // board 525
import { resetReader } from '../sessions/share/reader'; // board 525
import { connectReaderGrades, resetReaderPanes } from '../sessions/share/reader-connect'; // board 525
import { useTranscriptStore } from '../stores/transcript'; // UX wave U12a
import { applyEvents, createState } from '../transcript/model/reduce'; // UX wave U12a
import { builder } from '../transcript/model/test-events'; // UX wave U12a
import { COMPUTER_USE_COPY } from '../computer-use/copy'; // UX wave U12a
import { COMPUTER_USE_SETTLE_MS } from '../computer-use/strip-state'; // UX wave U12a
import { openBtwCard, resetSideQuestions } from '../side/store'; // UX wave U4a

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => pageScenario(nine).sessions.find((r) => r.title.text === title)!.appId; // P5 O6 M2: the page's id
const A = at('app-a' as AppSessionId);

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  window.maws = fakeClient({ 'attention.request': { event: null } }).client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
  resetSlots();
  resetSideQuestions(); // UX wave U4a: the /btw cards too
  // C7 start: a failing assertion must not leave the fake clock or the windows to the next test
  vi.useRealTimers();
  useUsage.setState({ windows: null });
  // C7 end
});

describe('session pane', () => {
  // UX wave U12a: the computer-use strip is mounted in the full pane only, directly above the transcript's wrapper
  it('draws the computer-use line above the transcript in the full pane, and none in the compact one', () => {
    vi.useFakeTimers();
    const id = idOf('Fix sidebar drag');
    registerSlot('transcript', () => <p>transcript</p>);
    const b = builder();
    b.turn('u1');
    b.toolUse('j1', 'mcp__plugin_cua_cua_repl__js', { code: 'await cua.click()' });
    const state = applyEvents(createState(null, null), b.events);
    useTranscriptStore.setState({ entries: { [id]: { state, rows: [], phase: 'live', error: null, following: true, sendFollowRequest: 0, working: true, clock: null, jump: null } } });
    try {
      const { unmount } = render(<SessionPane appSessionId={id} paneIndex={0} />);
      act(() => void vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS));
      const line = screen.getByText(COMPUTER_USE_COPY.running);
      expect(line.compareDocumentPosition(screen.getByText('transcript')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      unmount();
      render(<SessionPane appSessionId={id} paneIndex={0} compact />);
      act(() => void vi.advanceTimersByTime(COMPUTER_USE_SETTLE_MS));
      expect(screen.queryByText(COMPUTER_USE_COPY.running)).toBeNull();
    } finally {
      useTranscriptStore.setState({ entries: {} });
    }
  });

  it('shows the transcript slot and the docked request above the composer, and nothing under it (W2: no status line)', () => {
    const id = idOf('Fix sidebar drag');
    registerSlot('transcript', ({ appSessionId, agentId, paneIndex }) => <p>transcript {`${appSessionId} ${agentId} ${paneIndex}`}</p>);
    registerSlot('requestCard', ({ item, placement, paneIndex }) => <p>request {`${item.kind} ${placement} ${paneIndex}`}</p>);
    // C7: no composer registered here (C5's stub composer registration removed): a registered composer docks the request itself (the C7 case below)
    render(<SessionPane appSessionId={id} paneIndex={1} />);
    expect(screen.getByText(`transcript ${id} null 1`)).toBeTruthy();
    const request = screen.getByText('request permission docked 1');
    const composer = screen.getByText('Composer unavailable'); // C7: the pane docks above C5's fallback composer only
    expect(request.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Session status' })).toBeNull();
  });

  // C7 start: a registered composer is the one docked swap: it docks the request in its own place, so the pane's slot
  // docks nothing (two docked placements of one request would take focus and bind Enter twice).
  it('leaves the docking to a registered composer', () => {
    const id = idOf('Fix sidebar drag');
    registerSlot('requestCard', ({ item, placement }) => <p>request {`${item.kind} ${placement}`}</p>);
    registerSlot('composer', ({ appSessionId, paneIndex }) => <p>composer {`${appSessionId} ${paneIndex}`}</p>);
    render(<SessionPane appSessionId={id} paneIndex={1} />);
    expect(screen.getByText(`composer ${id} 1`)).toBeTruthy();
    expect(screen.queryByText('request permission docked')).toBeNull();
  });
  // C7 end

  it('docks no request when nothing waits', () => {
    registerSlot('requestCard', () => <p>request</p>);
    render(<SessionPane appSessionId={idOf('Charter + research')} paneIndex={0} />);
    expect(screen.queryByText('request')).toBeNull();
    expect(screen.getByText('Composer unavailable')).toBeTruthy();
  });

  it('the docked fallback does not offer to open the session it is already in', () => {
    render(<SessionPane appSessionId={idOf('Fix sidebar drag')} paneIndex={0} />);
    expect(screen.getByText('Approval needed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open session' })).toBeNull();
  });

  it('replaces the composer of a foreign-live session with its holder, and docks no request', () => {
    const id = idOf('Somersault terminal run');
    registerSlot('requestCard', () => <p>request</p>);
    render(<SessionPane appSessionId={id} paneIndex={0} />);
    expect(screen.getByText('Live in Terminal · pid 7135 · read-only')).toBeTruthy();
    expect(screen.queryByText('Composer unavailable')).toBeNull();
    expect(screen.queryByText('request')).toBeNull();
  });

  // UX wave U4a (decision 12): where the pane mounts the composer, which draws a waiting message in its stack, the
  // transcript is told so; in place of the holder notice it is not, and draws its held bubbles as before.
  it('tells the transcript slot there is a stack where it mounts the composer, and not where the holder notice stands', () => {
    registerSlot('transcript', ({ waiting }) => <p>transcript waiting {waiting ?? 'none'}</p>);
    const { unmount } = render(<SessionPane appSessionId={idOf('Charter + research')} paneIndex={0} />);
    expect(screen.getByText('Composer unavailable')).toBeTruthy();
    expect(screen.getByText('transcript waiting stacked')).toBeTruthy();
    unmount();
    render(<SessionPane appSessionId={idOf('Somersault terminal run')} paneIndex={0} />);
    expect(screen.getByText('Live in Terminal · pid 7135 · read-only')).toBeTruthy();
    expect(screen.getByText('transcript waiting none')).toBeTruthy();
  });

  // UX wave U4a (M7; decision 26 a): the `/btw` card is a layer of the pane over the transcript's bottom right corner,
  // beside the transcript's scroller and never inside it; the compact pill, which draws no transcript, has it in the flow
  // directly above the composer's frame
  it('draws the session’s /btw card over the transcript’s corner, a layer of the pane and not of the scroller', () => {
    const id = idOf('Charter + research');
    registerSlot('transcript', () => <p>transcript</p>);
    act(() => openBtwCard(id));
    render(<SessionPane appSessionId={id} paneIndex={0} />);
    const card = document.querySelector<HTMLElement>('[data-btw-card]')!;
    expect(card.getAttribute('data-btw-card')).toBe('corner');
    const scroller = screen.getByText('transcript').parentElement!;
    expect(scroller.contains(card)).toBe(false);
    expect(card.parentElement).toBe(scroller.parentElement);
    expect(card.contains(screen.getByText('Composer unavailable'))).toBe(false);
  });

  it('in the compact pill, which draws no transcript, the /btw card stands directly above the composer’s frame', () => {
    const id = idOf('Charter + research');
    act(() => openBtwCard(id));
    render(<SessionPane appSessionId={id} paneIndex={0} compact />);
    const card = document.querySelector<HTMLElement>('[data-btw-card]')!;
    expect(card.getAttribute('data-btw-card')).toBe('flow');
    expect(card.compareDocumentPosition(screen.getByText('Composer unavailable')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // C10 (M5): the notice's actions are C10's HolderActions, pinned in `sessions/HolderActions.test.tsx`
  it('a background-job holder with a known id offers "Attach in a terminal tab"; one without an id only "Fork a copy"', () => {
    useSessions.setState({ records: new Map([[A, record(A, { holder: { kind: 'background_job', pid: 42, jobId: 'e6dcd828' } })]]) });
    const { unmount } = render(<SessionPane appSessionId={A} paneIndex={0} />);
    expect(screen.getByText('Live as background job · pid 42 · read-only')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Attach in a terminal tab' }) as HTMLButtonElement).disabled).toBe(false);
    unmount();
    useSessions.setState({ records: new Map([[A, record(A, { holder: { kind: 'background_job', pid: 42, jobId: null } })]]) });
    render(<SessionPane appSessionId={A} paneIndex={0} />);
    expect(screen.queryByRole('button', { name: 'Attach in a terminal tab' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
  });

  it('an unstarted session (no record) shows the newSession slot above the composer and nothing else', () => {
    const NEW = at('app-new-1' as AppSessionId);
    registerSlot('newSession', ({ appSessionId }) => <h2>setup {appSessionId}</h2>);
    render(<SessionPane appSessionId={NEW} paneIndex={0} />);
    const setup = screen.getByRole('heading', { name: `setup ${NEW}` });
    const composer = screen.getByText('Composer unavailable');
    expect(setup.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Transcript unavailable')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Session status' })).toBeNull();
  });

  it('C5’s newSession fallback renders nothing', () => {
    const { container } = render(<SessionPane appSessionId={at('app-new-2' as AppSessionId)} paneIndex={0} />);
    expect(container.textContent).toBe('Composer unavailable');
  });

  it('swaps to the ordinary pane when the record arrives', () => {
    const NEW = at('app-new-3' as AppSessionId);
    render(<SessionPane appSessionId={NEW} paneIndex={0} />);
    expect(screen.queryByText('Transcript unavailable')).toBeNull();
    act(() => void useSessions.getState().applyChanged({ record: record(NEW), cause: 'live', revision: 7 } as never, TEST_MACHINE));
    expect(screen.getByText('Transcript unavailable')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Session status' })).toBeNull();
  });

  // P5 O9 M9: another machine's terminal session is a listed lane A row with no record; it reads as started, its
  // composer the lane A port's (never the holder notice), and its pending request docked.
  it('shows another machine’s listed lane A session as started, with its composer and its docked request', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held' }), appId: REMOTE }]]) });
    registerSlot('transcript', ({ appSessionId }) => <p>transcript {appSessionId}</p>);
    registerSlot('newSession', () => <h2>setup</h2>);
    registerSlot('requestCard', ({ item, placement }) => <p>request {`${item.kind} ${placement}`}</p>);
    useAttention.setState({ bySession: new Map([[REMOTE, [item(REMOTE, 'permission', T0)]]]) });
    render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
    expect(screen.getByText(`transcript ${REMOTE}`)).toBeTruthy();
    expect(screen.getByText('Composer unavailable')).toBeTruthy();
    expect(screen.getByText('request permission docked')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'setup' })).toBeNull();
  });

  // P5 O7 M2: another machine's lane B session opens as "Opening on <machine>…" until main has read its record there, then
  // swaps to the started pane; one main can't place says so, with Try again, which makes main open it again.
  describe('another machine’s lane B session', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    let fake: ReturnType<typeof fakeClient>;
    let off: () => void = () => {};
    beforeEach(() => {
      resetRemoteLaneBStore();
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: T0, generation: 0, carrier: 'relay' }]);
      useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });
      fake = fakeClient({ 'session.get': null, 'layout.set': undefined });
      off = connectRemoteLaneB(fake.client);
      registerSlot('transcript', ({ appSessionId }) => <p>transcript {appSessionId}</p>);
      registerSlot('newSession', () => <h2>setup</h2>);
    });
    afterEach(() => off());

    it('reads “Opening on <machine>…” with no record, then swaps to the started pane when main says the record', () => {
      render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      expect(screen.getByRole('status').textContent).toBe('Opening on mini…');
      expect(screen.queryByRole('heading', { name: 'setup' })).toBeNull();
      expect(screen.queryByText('Composer unavailable')).toBeNull();
      expect(fake.invoked('session.get')).toEqual([{ appSessionId: REMOTE }]); // the pane's announcement
      act(() => void useSessions.getState().applyChanged({ record: record(REMOTE), cause: 'live', revision: 7 } as never, OTHER_MACHINE));
      expect(screen.getByText(`transcript ${REMOTE}`)).toBeTruthy();
      expect(screen.getByText('Composer unavailable')).toBeTruthy();
    });

    it('says main can’t place the session, with Try again, which writes the tabs again', () => {
      useLayout.setState({ hydrated: true });
      applyRemoteSession(remoteSessionState(REMOTE, { stream: 'ended', reason: 'mini can’t place this session' }));
      render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      expect(screen.getByRole('status').textContent).toContain('mini can’t place this session');
      act(() => screen.getByRole('button', { name: 'Try again' }).click());
      expect(fake.invoked('layout.set')).toEqual([{ key: 'main.tabs', value: storedMain(useLayout.getState().main) }]);
      useLayout.setState({ hydrated: false });
    });

    it('offers no Try again to a device the machine removed', () => {
      applyRemoteSession(remoteSessionState(REMOTE, { stream: 'ended', link: { state: 'down', carrier: null, refusal: 'removed', member: null, rights: [] }, reason: 'This Mac is no longer allowed on mini' }));
      render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      expect(screen.getByRole('status').textContent).toContain('This Mac is no longer allowed on mini');
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });
  });

  // Board 525: another member's session whose read its machine refused at the member's grade (Can message) says what the
  // member can do there and whom to ask for View, with no transcript and no composer, and asks nothing more of the machine
  // until a listing change, a sign-in or a reopen asks afresh. An owner's `grade` is the machine not holding the record
  // yet: their pane reads on.
  describe('a session the member can only message', () => {
    const ANA = { id: 'member-ana', email: 'ana@example.test', name: 'Ana' };
    const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    let fake: ReturnType<typeof fakeClient>;
    let off: () => void = () => {};
    const listA = (over: { mine?: boolean; revision?: number } = {}) =>
      useSessions.setState({
        listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', availability: 'foreign_held', owners: over.mine ? ['member-me'] : [ANA.id], mine: over.mine ?? false, revision: over.revision ?? 1 }), appId: REMOTE }]]),
        members: new Map([[ANA.id, ANA]]),
        member: 'member-me',
      });
    // the transcript slot holds the page's watch of the session, as the real one does
    function WatchingTranscript({ appSessionId }: { appSessionId: AppSessionId }) {
      useEffect(() => watchLaneA(appSessionId, () => {}, { client: fake.client }), [appSessionId]);
      return <p>transcript {appSessionId}</p>;
    }
    beforeEach(() => {
      fake = fakeClient({ 'laneA.watch': { watch: 'w1' }, 'laneA.unwatch': undefined, 'session.get': null, 'layout.set': undefined });
      registerSlot('transcript', WatchingTranscript);
      off = connectReaderGrades(() => {});
    });
    afterEach(() => {
      off();
      resetLaneAWatches();
      resetReader();
      resetReaderPanes();
      resetRemoteLaneBStore();
      useSessions.setState({ listed: new Map(), members: new Map(), member: null });
    });
    const refuse = async () => {
      await act(async () => {});
      act(() => fake.event('laneA.plane', { appSessionId: REMOTE, watch: 'w1', paused: 'grade' }, OTHER_MACHINE));
    };

    it('lane A: says the member can’t read it and whom to ask for View, lets the watch go and opens none', async () => {
      listA();
      render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      expect(screen.getByText(`transcript ${REMOTE}`)).toBeTruthy();
      await refuse();
      const notice = screen.getByRole('status', { name: 'Your access' });
      expect(notice.textContent).toContain(READER.cantRead);
      expect(notice.textContent).toContain('Ask Ana for View to read it.');
      expect(screen.queryByText(`transcript ${REMOTE}`)).toBeNull();
      expect(screen.queryByText('Composer unavailable')).toBeNull();
      expect(fake.invoked('laneA.unwatch')).toEqual([{ appSessionId: REMOTE, watch: 'w1' }]);
      await act(async () => {});
      expect(fake.invoked('laneA.watch')).toHaveLength(1);
    });

    it('lane A: reads on for an owner, whose `grade` is the machine not holding the record yet', async () => {
      listA({ mine: true });
      render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      await refuse();
      expect(screen.getByText(`transcript ${REMOTE}`)).toBeTruthy();
      expect(screen.queryByRole('status', { name: 'Your access' })).toBeNull();
      expect(fake.invoked('laneA.unwatch')).toEqual([]);
    });

    it('lane A: reads again when the session’s listing moves (a share raised), and at a reopen', async () => {
      listA();
      const pane = render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      await refuse();
      act(() => listA({ revision: 2 }));
      await act(async () => {});
      expect(screen.getByText(`transcript ${REMOTE}`)).toBeTruthy();
      expect(fake.invoked('laneA.watch')).toHaveLength(2);
      await refuse();
      expect(screen.getByRole('status', { name: 'Your access' })).toBeTruthy();
      pane.unmount();
      render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      await act(async () => {});
      expect(screen.getByText(`transcript ${REMOTE}`)).toBeTruthy();
      expect(fake.invoked('laneA.watch')).toHaveLength(3);
    });

    it('lane B: main’s refused read is the same notice for another member’s session, and placing words for an owner’s', () => {
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: T0, generation: 0, carrier: 'relay' }]);
      const others = { ...remoteRow(OTHER_MACHINE, 'eng-r', { owners: [ANA.id], mine: false }), appId: REMOTE };
      useSessions.setState({ listed: new Map([[REMOTE, others]]), listedMachines: new Set([OTHER_MACHINE]), members: new Map([[ANA.id, ANA]]), member: 'member-me' });
      applyRemoteSession(remoteSessionState(REMOTE, { stream: 'opening', reason: READ_REFUSED }));
      const pane = render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      expect(screen.getByRole('status', { name: 'Your access' }).textContent).toContain('Ask Ana for View to read it.');
      pane.unmount();
      act(() => useSessions.setState({ listed: new Map([[REMOTE, { ...others, owners: ['member-me'], mine: true }]]) }));
      render(<SessionPane appSessionId={REMOTE} paneIndex={0} />);
      expect(screen.getByRole('status').textContent).toBe('Opening on mini…');
      act(() => applyRemoteSession(remoteSessionState(REMOTE, { stream: 'ended', reason: READ_REFUSED })));
      expect(screen.getByRole('status').textContent).toContain('mini can’t place this session');
    });
  });
});
