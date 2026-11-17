// Go to file's action and the request for the keyboard (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md,
// M1; decisions 10 and 11, R5, sequence S2): `files.goToFile` is registered exactly while it can end with the keyboard in
// the field (a session for the side column, no Settings dialog, no Overview); its handler leaves an open page, shows
// Files, marks the tab it lands in as finding and asks for the keyboard for that tab's field; the request is one at most,
// taken once by the taker it names, replaced by a later one and dropped by the next key or pointer press anywhere.
// M2 (decisions 1 to 5 and 8, S1, S4, S5; B2, B6, B7): the query read from the field's text, and the search one hook owns:
// each ask carries its generation and only the current generation's answer or failure is taken, a held Enter opens only
// on the answer of the generation it was pressed in, and an open filter is asked again (⌘P, the field taking the keyboard
// again, the working folder's status changing its set of entries) at once and once more past the daemon's ten seconds.
// Every ask is held by the test and every wait is a clock the test moves. Invented paths.
import { act, cleanup, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import { record, remoteRow } from '../../../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { checkoutKey } from '../../../ipc/machine';
import { isActionEnabled, runAction } from '../../../keymap/actions-runtime';
import { resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { registerPanelTool } from '../../../panel/host';
import { surfaceSession } from '../../../panel/surface-model';
import { useWorkingFolder } from '../../../sessions/working-folder';
import { useGit } from '../../../stores/git';
import { useLayout } from '../../../stores/layout';
import { useMachines } from '../../../stores/machines';
import { useSessions } from '../../../stores/sessions';
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { A, B, mainShowing, panelOf, resetPanelStores } from '../../../test-support/panel';
import { registerEditor } from '../editor/register';
import { resetKeptOpens } from '../open-file';
import { filesTool } from './FilesTool';
import {
  canGoToFile,
  connectGoToFile,
  FINDER_AGAIN_MS,
  FINDER_ASK,
  FINDER_LIMIT,
  FINDER_WAIT_MS,
  goToFile,
  parseQuery,
  requestKeyboard,
  takeKeyboard,
  useFinder,
  useKeyboardRequest,
  type FinderState,
  type KeyboardRequest,
} from './finder';
import { fileKey, fileOfTab } from './tabs';
import { resetTreeState, treeOf, useTreeState } from './tree-state';

const offs: (() => void)[] = [];
const filesOf = (id: typeof A) => (panelOf(id)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
const filter = (tabId: string): KeyboardRequest => ({ into: 'filter', tabId });

beforeEach(() => {
  resetPanelStores();
  resetKeptOpens();
  resetTreeState();
  installFakeMain(async (name) => {
    if (name === 'files.watch' || name === 'files.unwatch' || name === 'layout.set') return ok();
    if (name === 'layout.get') return ok({ value: null });
    return fail(`unexpected ${name}`);
  });
  offs.push(registerPanelTool(filesTool));
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); // no request held over into the next case
});

describe('canGoToFile (decision 11; R5)', () => {
  it('holds with a session for the side column and neither the Settings dialog nor the Overview open; a page open does not stop it', () => {
    expect(canGoToFile(useLayout.getState())).toBe(true); // the panel stores' reset shows session A
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main }));
    expect(surfaceSession(useLayout.getState())).toBeNull();
    expect(canGoToFile(useLayout.getState())).toBe(false);
    act(() => useLayout.setState({ main: mainShowing(A) }));
    act(() => useLayout.getState().openSettings());
    expect(canGoToFile(useLayout.getState())).toBe(false);
    act(() => useLayout.getState().closeSettings());
    act(() => useLayout.getState().setOverviewOpen(true));
    expect(canGoToFile(useLayout.getState())).toBe(false);
    act(() => useLayout.getState().setOverviewOpen(false));
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(canGoToFile(useLayout.getState())).toBe(true);
  });
});

describe('files.goToFile (connectGoToFile)', () => {
  beforeEach(() => offs.push(connectGoToFile()));

  it('is registered exactly while canGoToFile holds, following the layout store', () => {
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main }));
    expect(isActionEnabled('files.goToFile')).toBe(false);
    act(() => useLayout.setState({ main: mainShowing(A) }));
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => useLayout.getState().openSettings());
    expect(isActionEnabled('files.goToFile')).toBe(false);
    act(() => useLayout.getState().closeSettings());
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => useLayout.getState().setOverviewOpen(true));
    expect(isActionEnabled('files.goToFile')).toBe(false);
    act(() => useLayout.getState().setOverviewOpen(false));
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(isActionEnabled('files.goToFile')).toBe(true); // a page open: the handler leaves it
  });

  it('with a page open leaves the page, shows the side column’s session’s Files, marks that tab as finding and asks the keyboard for its field', () => {
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(filesOf(A)).toEqual([]);
    act(() => runAction('files.goToFile'));
    expect(useLayout.getState().destination).toBeNull();
    expect(useLayout.getState().regions.panel.collapsed).toBe(false);
    const [tab] = filesOf(A);
    expect(tab).toBeDefined();
    expect(treeOf(useTreeState.getState(), A).finding).toBe(tab.id);
    expect(filesOf(B)).toEqual([]);
    expect(takeKeyboard(filter('files:another'))).toBe(false); // the request names the tab it landed in, and no other
    expect(takeKeyboard(filter(tab.id))).toBe(true);
  });

  it('a second press lands in the same tab and asks again', () => {
    act(() => runAction('files.goToFile'));
    const [tab] = filesOf(A);
    expect(takeKeyboard(filter(tab.id))).toBe(true);
    expect(takeKeyboard(filter(tab.id))).toBe(false); // taken once
    act(() => runAction('files.goToFile'));
    expect(filesOf(A)).toEqual([tab]);
    expect(takeKeyboard(filter(tab.id))).toBe(true);
  });

  it('does nothing when called while it cannot end in the field; once it can, it shows Files', () => {
    act(() => useLayout.getState().openSettings());
    act(() => goToFile());
    expect(filesOf(A)).toEqual([]);
    expect(useLayout.getState().settings).not.toBeNull();
    act(() => useLayout.getState().closeSettings());
    act(() => goToFile()); // the control: the same call where canGoToFile holds
    expect(filesOf(A)).toHaveLength(1);
    expect(treeOf(useTreeState.getState(), A).finding).toBe(filesOf(A)[0].id);
  });

  it('is mounted by the editor’s registrations', () => {
    offs.splice(0).forEach((off) => off()); // this suite's own connection and the tool
    expect(isActionEnabled('files.goToFile')).toBe(false);
    const off = registerEditor();
    expect(isActionEnabled('files.goToFile')).toBe(true);
    off();
    expect(isActionEnabled('files.goToFile')).toBe(false);
  });
});

describe('the request for the keyboard (S2)', () => {
  it('is taken once, by the taker it names alone', () => {
    requestKeyboard(filter('files:one'));
    expect(takeKeyboard(filter('files:two'))).toBe(false);
    expect(takeKeyboard({ into: 'file', key: 'files:one' })).toBe(false); // a file's taker is another taker
    expect(takeKeyboard(filter('files:one'))).toBe(true);
    expect(takeKeyboard(filter('files:one'))).toBe(false);
  });

  it('a second request replaces the first', () => {
    requestKeyboard(filter('files:one'));
    requestKeyboard(filter('files:two'));
    expect(takeKeyboard(filter('files:one'))).toBe(false);
    expect(takeKeyboard(filter('files:two'))).toBe(true);
  });

  it.each([
    ['a key pressed', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))],
    ['a pointer pressed', () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))],
  ])('%s anywhere drops it; with nothing pressed between it is taken', (_name, press) => {
    requestKeyboard(filter('files:one'));
    press();
    expect(takeKeyboard(filter('files:one'))).toBe(false);
    requestKeyboard(filter('files:one')); // the control: the same request, nothing pressed
    expect(takeKeyboard(filter('files:one'))).toBe(true);
    requestKeyboard(filter('files:two')); // and a press after a request was taken drops nothing later
    expect(takeKeyboard(filter('files:two'))).toBe(true);
    press();
    requestKeyboard(filter('files:three'));
    expect(takeKeyboard(filter('files:three'))).toBe(true);
  });

  it('tells a drawn taker of a request for it, and of no other', () => {
    const one = renderHook(() => useKeyboardRequest(filter('files:one')));
    const two = renderHook(() => useKeyboardRequest(filter('files:two')));
    const none = renderHook(() => useKeyboardRequest(null));
    const before = [one.result.current, two.result.current, none.result.current];
    act(() => requestKeyboard(filter('files:one')));
    const first = one.result.current;
    expect(first).not.toBe(before[0]);
    expect([two.result.current, none.result.current]).toEqual([before[1], before[2]]);
    act(() => void takeKeyboard(filter('files:one')));
    act(() => requestKeyboard(filter('files:one')));
    expect(one.result.current).not.toBe(first); // a new request for the same taker is told again
    expect(two.result.current).toBe(before[1]);
  });
});

describe('parseQuery (decision 2)', () => {
  it.each([
    ['a plain name', 'tree', { query: 'tree', line: null }],
    ['name:42', 'store.ts:42', { query: 'store.ts', line: 42 }],
    ['name:42:7, the column read and dropped', 'store.ts:42:7', { query: 'store.ts', line: 42 }],
    [':42 alone, the whole text the query', ':42', { query: ':42', line: null }],
    ['name:0, the line at least 1', 'store.ts:0', { query: 'store.ts', line: 1 }],
    ['a colon with no digits', 'store.ts:', { query: 'store.ts:', line: null }],
    ['a 300-character text, cut at the schema’s 256', 'a'.repeat(300), { query: 'a'.repeat(256), line: null }],
    ['a 300-character name with a line', `${'a'.repeat(300)}:9`, { query: 'a'.repeat(256), line: 9 }],
  ])('%s', (_name, text, expected) => {
    expect(parseQuery(text)).toEqual(expected);
  });
});

// ---- the search (M2) ------------------------------------------------------------------------------------------------------

type Answer = ReturnType<typeof ok>;
const listed = (...paths: string[]): Answer => ok({ paths, truncated: false, source: 'git' });
const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);

function statusOf(paths: readonly string[], checkedAt = '2026-11-17T10:00:00.000Z'): GitStatus {
  return {
    repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git', isWorktree: false, branch: 'main', head: 'c0ffee', upstream: null, remoteUrl: null,
    ahead: 0, behind: 0, dirty: paths.length > 0, files: paths.map((path) => ({ path, oldPath: null, index: '?', worktree: '?', untracked: true })), stashCount: 0, checkedAt,
  };
}
const putStatus = (status: GitStatus | null) =>
  act(() => useGit.setState({ entries: status === null ? new Map() : new Map([[checkoutKey(TEST_MACHINE, '/r'), { root: '/r', status, uncommitted: null, error: null }]]) }));

// A key as the field's handler is given it: `composing` as the input method has it (isComposing, or key code 229).
function keyOf(key: string, init: { composing?: 'flag' | 'code'; shift?: boolean } = {}) {
  const event = {
    key,
    keyCode: init.composing === 'code' ? 229 : key === 'Enter' ? 13 : 0,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: init.shift === true, repeat: false,
    nativeEvent: { isComposing: init.composing === 'flag' },
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event;
}

describe('useFinder (S1, S4, S5; B2, B6, B7)', () => {
  let asks: { input: Record<string, unknown>; target: unknown; reply: ReturnType<typeof deferred<Answer>> }[];
  // Each git.lsFiles is held until the test answers it; the rest is what Files and the layout need.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    asks = [];
    const main = installFakeMain(async (name, input) => {
      if (name === 'git.lsFiles') {
        const reply = deferred<Answer>();
        asks.push({ input, target: main.targetsOf('git.lsFiles').at(-1), reply });
        return reply.promise;
      }
      if (name === 'files.watch' || name === 'files.unwatch' || name === 'layout.set' || name === 'git.unwatch') return ok();
      if (name === 'layout.get') return ok({ value: null });
      return fail(`unexpected ${name}`);
    });
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r' })) })));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    act(() => useGit.setState({ entries: new Map() }));
    resetRemoteLaneBStore();
    act(() => useMachines.getState().applyRoster([]));
    act(() => useSessions.setState({ listedMachines: new Set() }));
  });

  // The ipc client's validation and the hook's handlers run in microtasks; the clock is the test's.
  const flush = () => act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  const reply = async (index: number, answer: Answer) => {
    asks[index].reply.resolve(answer);
    await flush();
  };
  const wait = (ms = FINDER_WAIT_MS) => act(() => vi.advanceTimersByTime(ms));
  const queries = () => asks.map((ask) => ask.input.query);
  // The files opened beside A's chat, with their line and whether the tab is kept.
  const opened = () =>
    (panelOf(A)?.tabs ?? []).flatMap((tab) => {
      const held = fileOfTab(useLayout.getState().panelParams[tab.id]);
      return held ? [{ file: held.file, line: held.line, kept: held.preview !== true }] : [];
    });
  function mount(text = '', appSessionId: AppSessionId = A) {
    const view = renderHook((props: { text: string }) => useFinder(appSessionId, useWorkingFolder(appSessionId)?.path ?? null, props.text), { initialProps: { text } });
    const state = (): FinderState => view.result.current.state;
    const press = (key: string, init: Parameters<typeof keyOf>[1] = {}) => {
      const event = keyOf(key, init);
      act(() => view.result.current.onKey(event as unknown as KeyboardEvent<HTMLInputElement>));
      return event;
    };
    const type = (next: string) => view.rerender({ text: next });
    return { view, state, press, type };
  }

  it('asks git.lsFiles with the three keys, 80 ms after the last keystroke, on the session’s machine; drops folders and shows the first 50 files', async () => {
    const { state, type } = mount();
    type('t');
    type('tr');
    wait(FINDER_WAIT_MS - 1);
    expect(asks).toHaveLength(0); // the wait runs from the last keystroke
    type('tre');
    wait(FINDER_WAIT_MS - 1);
    expect(asks).toHaveLength(0);
    wait(1);
    expect(asks).toHaveLength(1);
    expect(asks[0].input).toStrictEqual({ directory: '/r', query: 'tre', limit: FINDER_ASK });
    expect(asks[0].target).toEqual({ machine: TEST_MACHINE, session: 'app-a' });
    expect(FINDER_ASK).toBe(200);
    expect(FINDER_LIMIT).toBe(50);
    // 200 paths, 60 of them files, a submodule's folder among the folders
    const paths = Array.from({ length: 200 }, (_, i) => (i % 10 < 3 ? `src/f${i}.ts` : i === 4 ? 'vendor/sub/' : `dir${i}/`));
    expect(paths.filter((path) => !path.endsWith('/'))).toHaveLength(60);
    await reply(0, listed(...paths));
    const files = paths.filter((path) => !path.endsWith('/')).slice(0, 50).map((path) => `/r/${path}`);
    expect(state()).toEqual({ status: 'answered', rows: files, at: 0, refreshing: false });
  });

  it('an empty text is no ask; the text becoming empty drops what is on its way', async () => {
    const { state, type } = mount();
    wait(60_000);
    expect(asks).toHaveLength(0);
    expect(state()).toEqual({ status: 'empty' });
    type('tide');
    wait();
    type('');
    expect(state()).toEqual({ status: 'empty' });
    await reply(0, listed('tide.md'));
    expect(state()).toEqual({ status: 'empty' });
  });

  describe('an answer is taken only for the request that asked (decision 3; the review’s finding 3)', () => {
    // a, b, a: three asks on their way, Enter pressed after the last
    async function aba() {
      const finder = mount();
      finder.type('a');
      wait();
      finder.type('b');
      wait();
      finder.type('a');
      wait();
      expect(queries()).toEqual(['a', 'b', 'a']);
      finder.press('Enter');
      expect(finder.state()).toEqual({ status: 'waiting', shown: null, held: true });
      return finder;
    }

    it('a, b, a with Enter after the last: the first ask’s answer, landing first, opens nothing and draws nothing; the last ask’s opens its own first row', async () => {
      const { state } = await aba();
      await reply(0, listed('first-a.ts'));
      expect(state()).toEqual({ status: 'waiting', shown: null, held: true });
      expect(opened()).toEqual([]);
      await reply(1, listed('b.ts'));
      expect(opened()).toEqual([]);
      await reply(2, listed('last-a.ts', 'other-a.ts')); // the control: the ask that was asked for
      expect(state()).toEqual({ status: 'answered', rows: ['/r/last-a.ts', '/r/other-a.ts'], at: 0, refreshing: false });
      expect(opened()).toEqual([{ file: '/r/last-a.ts', line: null, kept: true }]);
    });

    it('a, b, a in the other order: the last ask’s answer opens its row, and the first ask’s, landing after, changes nothing', async () => {
      const { state } = await aba();
      await reply(2, listed('last-a.ts'));
      expect(opened()).toEqual([{ file: '/r/last-a.ts', line: null, kept: true }]);
      const after = state();
      await reply(0, listed('first-a.ts'));
      await reply(1, fail('b failed'));
      expect(state()).toBe(after);
      expect(opened()).toEqual([{ file: '/r/last-a.ts', line: null, kept: true }]);
    });

    // A failure of the text's ask, a retry by ⌘P, and an earlier ask of the same text that settles late.
    async function retried() {
      const finder = mount();
      finder.type('tide');
      wait();
      finder.type('tid');
      wait();
      finder.type('tide');
      wait();
      await reply(2, fail('git could not read the repository'));
      expect(finder.state()).toEqual({ status: 'failed' });
      act(() => finder.view.result.current.refresh());
      expect(queries()).toEqual(['tide', 'tid', 'tide', 'tide']);
      expect(finder.state()).toEqual({ status: 'waiting', shown: null, held: false });
      return finder;
    }

    it.each([
      ['late success', listed('stale.ts')],
      ['late failure', fail('an earlier failure')],
    ])('a retry of an unchanged text after a failure: the earlier ask’s %s, landing before the retry’s answer, replaces nothing', async (_name, late) => {
      const { state } = await retried();
      await reply(0, late);
      expect(state()).toEqual({ status: 'waiting', shown: null, held: false });
      await reply(3, listed('retry.ts')); // the control: the retry's own answer
      expect(state()).toEqual({ status: 'answered', rows: ['/r/retry.ts'], at: 0, refreshing: false });
    });

    it.each([
      ['late success', listed('stale.ts')],
      ['late failure', fail('an earlier failure')],
    ])('a retry of an unchanged text after a failure: the earlier ask’s %s, landing after the retry’s answer, replaces nothing', async (_name, late) => {
      const { state } = await retried();
      await reply(3, listed('retry.ts'));
      const answered = state();
      expect(answered).toEqual({ status: 'answered', rows: ['/r/retry.ts'], at: 0, refreshing: false });
      await reply(0, late);
      await reply(1, listed('tid.ts'));
      expect(state()).toBe(answered);
    });

    it('offline and back: nothing is asked while offline, the text is asked again when the link is back, and the earlier ask landing after is dropped', async () => {
      const roster = (state: 'up' | 'down') =>
        act(() => useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state, since: '2026-11-15T09:00:00.000Z', generation: 0 }]));
      act(() =>
        useSessions.setState((s) => ({
          records: new Map(s.records).set(REMOTE, record(REMOTE, { directory: '/b' })),
          listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: REMOTE }]]),
          listedMachines: new Set([OTHER_MACHINE]),
        })),
      );
      roster('up');
      const { state, type } = mount('', REMOTE);
      type('tide');
      wait();
      expect(asks).toHaveLength(1);
      expect(asks[0].target).toEqual({ machine: OTHER_MACHINE, session: 'app-r' }); // that machine's files (B7)
      expect(asks[0].input).toStrictEqual({ directory: '/b', query: 'tide', limit: FINDER_ASK });
      roster('down');
      expect(state()).toEqual({ status: 'offline', words: 'File search is unavailable while mini is offline.' });
      type('tides');
      wait(60_000);
      expect(asks).toHaveLength(1); // nothing is asked while offline
      expect(state()).toEqual({ status: 'offline', words: 'File search is unavailable while mini is offline.' });
      roster('up'); // the control: the same hook asks when the phase is up
      expect(queries()).toEqual(['tide', 'tides']);
      expect(state()).toEqual({ status: 'waiting', shown: null, held: false });
      await reply(0, listed('stale.ts'));
      expect(state()).toEqual({ status: 'waiting', shown: null, held: false });
      await reply(1, listed('tides.md'));
      expect(state()).toEqual({ status: 'answered', rows: ['/b/tides.md'], at: 0, refreshing: false });
    });

    it('S5: the working folder moves under an open filter with an ask on its way: the new folder is asked at once and the answer for the folder left is dropped', async () => {
      const { state, type } = mount();
      type('tide');
      wait();
      expect(asks[0].input.directory).toBe('/r');
      act(() =>
        useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r', agentFolder: { checkout: '/w', cwd: '/w', branch: 'wt', linked: true } })) })),
      );
      expect(asks).toHaveLength(2);
      expect(asks[1].input).toStrictEqual({ directory: '/w', query: 'tide', limit: FINDER_ASK });
      expect(state()).toEqual({ status: 'waiting', shown: null, held: false });
      await reply(0, listed('left.md'));
      expect(state()).toEqual({ status: 'waiting', shown: null, held: false });
      await reply(1, listed('tide.md'));
      expect(state()).toEqual({ status: 'answered', rows: ['/w/tide.md'], at: 0, refreshing: false });
    });
  });

  describe('the keys (decision 5)', () => {
    async function answered(...paths: string[]) {
      const finder = mount();
      finder.type('r');
      wait();
      await reply(0, listed(...paths));
      return finder;
    }

    it('↓ and ↑ move the highlight among the rows and stop at the ends', async () => {
      const { state, press } = await answered('a.ts', 'b.ts', 'c.ts');
      expect(press('ArrowUp').defaultPrevented).toBe(true);
      expect(state()).toMatchObject({ at: 0 });
      press('ArrowDown');
      press('ArrowDown');
      press('ArrowDown');
      expect(state()).toMatchObject({ at: 2 });
      press('ArrowUp');
      expect(state()).toMatchObject({ at: 1 });
      expect(press('ArrowDown', { shift: true }).defaultPrevented).toBe(false); // a modified arrow is the text's
      expect(state()).toMatchObject({ at: 1 });
    });

    it('Enter opens the highlighted row as a kept tab at the line the text names, asks the keyboard for the file and ends finding', async () => {
      const finder = mount();
      act(() => useTreeState.getState().setFinding(A, 'files:one'));
      finder.type('store.ts:40');
      wait();
      expect(queries()).toEqual(['store.ts']);
      await reply(0, listed('src/store.ts', 'lib/store.ts'));
      finder.press('ArrowDown');
      expect(finder.press('Enter').defaultPrevented).toBe(true);
      expect(opened()).toEqual([{ file: '/r/lib/store.ts', line: 40, kept: true }]);
      expect(treeOf(useTreeState.getState(), A).finding).toBeNull();
      expect(takeKeyboard({ into: 'file', key: fileKey(TEST_MACHINE, '/r/src/store.ts') })).toBe(false); // the request names the file opened
      expect(takeKeyboard({ into: 'file', key: fileKey(TEST_MACHINE, '/r/lib/store.ts') })).toBe(true);
      expect(finder.state()).toMatchObject({ status: 'answered', at: 1 }); // the field keeps its text and the list stays (decision 7)
    });

    it('an Enter that commits an input method’s composition opens nothing, nor holds; a plain Enter opens', async () => {
      const { state, press, type } = await answered('tide.md');
      expect(press('Enter', { composing: 'flag' }).defaultPrevented).toBe(false);
      press('Enter', { composing: 'code' });
      press('ArrowDown', { composing: 'flag' });
      expect(opened()).toEqual([]);
      press('Enter'); // the control
      expect(opened()).toEqual([{ file: '/r/tide.md', line: null, kept: true }]);
      type('tides'); // while the answer is awaited, a composing Enter holds nothing
      wait();
      press('Enter', { composing: 'flag' });
      expect(state()).toEqual({ status: 'waiting', shown: ['/r/tide.md'], held: false });
      await reply(1, listed('tides.md'));
      expect(opened()).toEqual([{ file: '/r/tide.md', line: null, kept: true }]);
    });

    it.each([
      ['an arrow', (f: ReturnType<typeof mount>) => f.press('ArrowDown')],
      ['the field losing the keyboard', (f: ReturnType<typeof mount>) => act(() => f.view.result.current.left())],
      ['a change of the text', (f: ReturnType<typeof mount>) => f.type('tides')],
    ])('a held Enter is ended by %s and opens nothing; held alone it opens (the control)', async (_name, between) => {
      for (const end of [true, false]) {
        cleanup();
        asks = [];
        act(() => useLayout.setState({ panelBySession: new Map(), panelParams: {} }));
        const finder = mount();
        finder.type('tide');
        wait();
        finder.press('Enter');
        if (end) between(finder);
        await reply(0, listed('tide.md'));
        if (asks.length > 1) await reply(1, listed('tides.md'));
        expect(opened()).toEqual(end ? [] : [{ file: '/r/tide.md', line: null, kept: true }]);
      }
    });

    it('Enter does nothing with no row, after a failure, or with an empty field', async () => {
      const finder = await answered();
      expect(finder.state()).toEqual({ status: 'answered', rows: [], at: 0, refreshing: false });
      finder.press('Enter');
      finder.type('tide');
      wait();
      await reply(1, fail('git could not read the repository'));
      finder.press('Enter');
      finder.type('');
      finder.press('Enter');
      expect(opened()).toEqual([]);
    });

    it('a click on a row opens the preview tab, a double-click keeps it, ⌘ opens a main tab, each at the text’s line, and asks no keyboard', async () => {
      const finder = mount();
      finder.type('tide:7');
      wait();
      await reply(0, listed('tide.md', 'tide.ts'));
      act(() => void finder.view.result.current.choose(0, { keep: false, main: false }));
      expect(opened()).toEqual([{ file: '/r/tide.md', line: 7, kept: false }]);
      expect(takeKeyboard({ into: 'file', key: fileKey(TEST_MACHINE, '/r/tide.md') })).toBe(false);
      act(() => void finder.view.result.current.choose(0, { keep: true, main: false }));
      expect(opened()).toEqual([{ file: '/r/tide.md', line: 7, kept: true }]);
      act(() => void finder.view.result.current.choose(1, { keep: false, main: true }));
      expect(useLayout.getState().main.panes.flatMap((pane) => pane.tabs).filter((tab) => tab.kind === 'file')).toEqual([expect.objectContaining({ path: '/r/tide.ts', line: 7 })]);
    });
  });

  describe('an open filter is asked again (decision 8; S1’s refresh rows, S4)', () => {
    async function answered(...paths: string[]) {
      const finder = mount();
      finder.type('r');
      wait();
      await reply(0, listed(...paths));
      return finder;
    }
    const refresh = (finder: ReturnType<typeof mount>) => act(() => finder.view.result.current.refresh());

    it('a refresh asks at once and once more FINDER_AGAIN_MS later; its answer keeps the highlight on its path, and on the first row when the path is gone', async () => {
      const finder = await answered('a.ts', 'b.ts');
      finder.press('ArrowDown');
      refresh(finder);
      expect(asks).toHaveLength(2);
      expect(finder.state()).toEqual({ status: 'answered', rows: ['/r/a.ts', '/r/b.ts'], at: 1, refreshing: true });
      await reply(1, listed('new.ts', 'a.ts', 'b.ts'));
      expect(finder.state()).toEqual({ status: 'answered', rows: ['/r/new.ts', '/r/a.ts', '/r/b.ts'], at: 2, refreshing: false });
      wait(FINDER_AGAIN_MS - 1);
      expect(asks).toHaveLength(2);
      wait(1);
      expect(asks).toHaveLength(3);
      expect(queries()).toEqual(['r', 'r', 'r']);
      await reply(2, listed('a.ts', 'c.ts'));
      expect(finder.state()).toEqual({ status: 'answered', rows: ['/r/a.ts', '/r/c.ts'], at: 0, refreshing: false });
      wait(60_000);
      expect(asks).toHaveLength(3); // one later ask, no timer after it
      expect(FINDER_AGAIN_MS).toBe(10_500);
    });

    it('while a refresh runs the rows are usable: Enter opens at once and is not held', async () => {
      const finder = await answered('a.ts', 'b.ts');
      refresh(finder);
      finder.press('ArrowDown');
      finder.press('Enter');
      expect(opened()).toEqual([{ file: '/r/b.ts', line: null, kept: true }]);
    });

    it('a refresh’s failure leaves the rows and says nothing', async () => {
      const finder = await answered('a.ts', 'b.ts');
      finder.press('ArrowDown');
      refresh(finder);
      await reply(1, fail('git could not read the repository'));
      expect(finder.state()).toEqual({ status: 'answered', rows: ['/r/a.ts', '/r/b.ts'], at: 1, refreshing: false });
    });

    it('a new refresh moves the later ask, and a change of the text drops it', async () => {
      const finder = await answered('a.ts');
      refresh(finder);
      await reply(1, listed('a.ts'));
      wait(5_000);
      refresh(finder);
      await reply(2, listed('a.ts'));
      wait(FINDER_AGAIN_MS - 1);
      expect(asks).toHaveLength(3);
      wait(1);
      expect(asks).toHaveLength(4);
      await reply(3, listed('a.ts'));
      refresh(finder);
      finder.type('rr');
      wait(FINDER_AGAIN_MS * 2);
      expect(queries()).toEqual(['r', 'r', 'r', 'r', 'r', 'rr']);
    });

    it.each([
      ['answered', listed('tide.md')],
      ['failed', fail('git could not read the repository')],
    ])('a refresh while the text’s answer is awaited sends nothing and keeps a held Enter bound; when that answer settles (%s) the owed refresh asks', async (how, answer) => {
      const finder = mount();
      finder.type('tide');
      wait();
      finder.press('Enter');
      refresh(finder);
      expect(asks).toHaveLength(1);
      expect(finder.state()).toEqual({ status: 'waiting', shown: null, held: true });
      wait(FINDER_AGAIN_MS + 1); // past the daemon's ten seconds before the original ask is resolved
      expect(asks).toHaveLength(1);
      await reply(0, answer);
      expect(queries()).toEqual(['tide', 'tide']); // the owed refresh
      if (how === 'answered') {
        expect(opened()).toEqual([{ file: '/r/tide.md', line: null, kept: true }]);
        expect(finder.state()).toEqual({ status: 'answered', rows: ['/r/tide.md'], at: 0, refreshing: true });
        wait(FINDER_AGAIN_MS);
        expect(asks).toHaveLength(3); // issued as a refresh: its later ask too
      } else {
        expect(opened()).toEqual([]);
        expect(finder.state()).toEqual({ status: 'waiting', shown: null, held: false });
      }
    });

    it.each([
      ['a change of the text between clears what was owed', true],
      ['with no change between, the owed refresh asks (the control)', false],
    ])('%s', async (_name, changed) => {
      const finder = mount();
      finder.type('tide');
      wait();
      refresh(finder);
      if (changed) finder.type('tides');
      wait();
      await reply(0, listed('tide.md'));
      if (changed) {
        expect(queries()).toEqual(['tide', 'tides']);
        await reply(1, listed('tides.md'));
        expect(queries()).toEqual(['tide', 'tides']);
      } else expect(queries()).toEqual(['tide', 'tide']);
    });

    it('a refresh after a failure asks again at once; with the field empty a refresh asks nothing', async () => {
      const finder = mount();
      refresh(finder);
      expect(asks).toHaveLength(0);
      finder.type('tide');
      wait();
      await reply(0, fail('git could not read the repository'));
      refresh(finder);
      expect(queries()).toEqual(['tide', 'tide']);
      expect(finder.state()).toEqual({ status: 'waiting', shown: null, held: false });
    });

    it('S4: with no act nothing is asked; a status whose set changed asks at once and once more later, the second ask bringing the new file under the highlight’s row', async () => {
      putStatus(statusOf(['src/rates.ts']));
      const finder = mount();
      finder.type('rat');
      wait();
      await reply(0, listed('src/rates.ts', 'src/ratio.ts'));
      finder.press('ArrowDown');
      wait(60_000); // a minute with the list on screen and nobody acting
      putStatus(statusOf(['src/rates.ts'], '2026-11-17T10:05:00.000Z')); // the same entries checked again: the same set
      expect(asks).toHaveLength(1);
      putStatus(statusOf(['src/rates.ts', 'src/pirate.md'])); // the control: a file appeared
      expect(asks).toHaveLength(2);
      await reply(1, listed('src/rates.ts', 'src/ratio.ts')); // answered from the list the daemon kept
      expect(finder.state()).toEqual({ status: 'answered', rows: ['/r/src/rates.ts', '/r/src/ratio.ts'], at: 1, refreshing: false });
      wait(FINDER_AGAIN_MS);
      expect(asks).toHaveLength(3);
      await reply(2, listed('src/pirate.md', 'src/rates.ts', 'src/ratio.ts'));
      expect(finder.state()).toEqual({ status: 'answered', rows: ['/r/src/pirate.md', '/r/src/rates.ts', '/r/src/ratio.ts'], at: 2, refreshing: false });
    });

    it('the first status the hook sees asks nothing; a status of no repository asks nothing', async () => {
      const finder = mount();
      finder.type('rat');
      wait();
      await reply(0, listed('src/rates.ts'));
      putStatus(statusOf(['src/rates.ts']));
      putStatus(null);
      expect(asks).toHaveLength(1);
      putStatus(statusOf(['src/ratio.ts'])); // the control: a set that differs from the one it saw
      expect(asks).toHaveLength(2);
    });
  });
});
