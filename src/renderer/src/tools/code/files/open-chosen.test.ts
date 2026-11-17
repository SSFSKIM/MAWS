// Open File… in the window (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, M3; §D,
// decisions 14 to 16, sequence W1): `openChosen` asks main's chooser for a session and opens the chosen file beside the
// chat as a kept tab, says a refusal or an error as a notice, and opens nothing for a cancel or a session the page no
// longer knows; `file.open` is registered exactly while a session's chat of this Mac is in front. Invented paths.
// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; sequences C3, C4, C6
// and R10): `openChosenFor` opens the chooser MAWS draws for a session that takes the remote route, and `file.open` is
// registered for such a chat while the window's helper has no sentence for `files.chooseOutside`.
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf, bareOf } from '@shared/machine/address';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { OTHER_MACHINE } from '../../../../../../test/support/machine';
import { isActionEnabled, runAction } from '../../../keymap/actions-runtime';
import { registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useNotices } from '../../../stores/notices';
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { A, mainShowing, panelOf, resetPanelStores } from '../../../test-support/panel';
import { registerEditor } from '../editor/register';
import { resetKeptOpens } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { connectOpenFile, openChosen, openChosenFor } from './open-chosen';
import { resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { leaveRl2, overRl2, rosterSays } from '../../../test-support/code-disk';
import { forgetOpenedThere } from './elsewhere';
import { forgetStarts } from './remote-chooser';

// The branch review (scalpel-4#1; Decision Log 33 (4)): the chooser's model as it stands in the window the sheet's passive
// effect leaves, having not yet heard the offer go (`blind`), so the check open-chosen.ts makes itself is seen alone
const blind = vi.hoisted(() => ({ on: false }));
vi.mock('./remote-chooser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./remote-chooser')>();
  return {
    ...actual,
    createRemoteChooser: (...[appSessionId, deps]: Parameters<typeof actual.createRemoteChooser>) => {
      const chooser = actual.createRemoteChooser(appSessionId, { ...deps, unoffered: () => (blind.on ? null : (deps.unoffered?.() ?? null)) });
      return { ...chooser, withdraw: (words: string) => (blind.on ? undefined : chooser.withdraw(words)) };
    },
  };
});

const OUT = '/elsewhere/chosen.txt';
const R = addressOf(OTHER_MACHINE, 'app-remote') as AppSessionId; // a session of another machine
const NOT_A_FILE = 'Open File opens one file. A folder or an app’s package cannot be opened here.';
const UNAVAILABLE = 'MAWS could not open the file just now. Try Open File again in a moment.';

type Answer = ReturnType<typeof ok>;
let answer: () => Answer | Promise<Answer>;
let main: ReturnType<typeof installFakeMain>;
const offs: (() => void)[] = [];
const filesOf = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
const paramsOf = (tabId: string) => useLayout.getState().panelParams[tabId];
const notices = () => useNotices.getState().notices.map(({ kind, level, text }) => ({ kind, level, text }));
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  resetPanelStores();
  resetKeptOpens();
  useViewer.getState().reset();
  useNotices.setState({ notices: [] });
  answer = () => ok({ status: 'cancelled' });
  main = installFakeMain(async (name) => {
    if (name === 'layout.openFile') return answer();
    if (name === 'files.watch' || name === 'files.unwatch' || name === 'layout.set') return ok();
    if (name === 'layout.get') return ok({ value: null });
    return fail(`unexpected ${name}`);
  });
  offs.push(registerPanelTool(filesTool));
});
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  resetKeptOpens();
});

describe('openChosen', () => {
  it('opened: asks main for the session, then opens the granted path beside the chat as a kept tab, once', async () => {
    answer = () => ok({ status: 'opened', path: OUT });
    await act(() => openChosen(A));
    expect(main.callsOf('layout.openFile')).toEqual([{ appSessionId: bareOf(A) }]);
    expect(filesOf(A)).toHaveLength(1);
    expect(paramsOf(filesOf(A)[0].id)).toEqual({ file: OUT, line: null });
    expect(notices()).toEqual([]);
  });

  it('cancelled: nothing opens and nothing is said', async () => {
    await act(() => openChosen(A));
    expect(main.callsOf('layout.openFile')).toHaveLength(1);
    expect(filesOf(A)).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it.each([
    ['not-a-file', NOT_A_FILE],
    ['unavailable', UNAVAILABLE],
  ] as const)('refused %s: its sentence as a notice at level danger, and nothing opens', async (reason, text) => {
    answer = () => ok({ status: 'refused', reason });
    await act(() => openChosen(A));
    expect(filesOf(A)).toEqual([]);
    expect(notices()).toEqual([{ kind: 'toast', level: 'danger', text }]);
  });

  it('an error of the command (a daemon of an older build, the router’s refusal): the unavailable sentence, and nothing opens', async () => {
    answer = () => fail('unknown command: files.grant');
    await act(() => openChosen(A));
    expect(filesOf(A)).toEqual([]);
    expect(notices()).toEqual([{ kind: 'toast', level: 'danger', text: UNAVAILABLE }]);
  });

  it('W1: an answer that lands after its session left the page’s records opens nothing and says nothing', async () => {
    const gate = deferred<void>();
    answer = async () => {
      await gate.promise;
      return ok({ status: 'opened', path: OUT });
    };
    const asked = openChosen(A);
    await waitFor(() => expect(main.callsOf('layout.openFile')).toHaveLength(1));
    useLayout.setState({ knownSession: () => false }); // the session was removed meanwhile
    gate.resolve();
    await act(() => asked);
    await settle();
    expect(filesOf(A)).toEqual([]);
    expect(notices()).toEqual([]);
  });
});

describe('file.open (connectOpenFile)', () => {
  beforeEach(() => offs.push(connectOpenFile()));

  it('is registered while a session’s chat of this Mac is in front, and runs Open File… for that session', async () => {
    expect(isActionEnabled('file.open')).toBe(true); // the panel stores' reset shows session A
    runAction('file.open');
    await waitFor(() => expect(main.callsOf('layout.openFile')).toEqual([{ appSessionId: bareOf(A) }]));
  });

  it('is removed with no session in front, with a page open over the session’s tab, with a session of another machine or one the page does not know, and back', () => {
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main }));
    expect(isActionEnabled('file.open')).toBe(false);
    act(() => useLayout.setState({ main: mainShowing(A) }));
    expect(isActionEnabled('file.open')).toBe(true);
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(isActionEnabled('file.open')).toBe(false);
    act(() => useLayout.getState().closeDestination());
    expect(isActionEnabled('file.open')).toBe(true);
    act(() => useLayout.setState({ main: mainShowing(R) }));
    expect(isActionEnabled('file.open')).toBe(false);
    act(() => useLayout.setState({ main: mainShowing(A), knownSession: (id) => id !== A }));
    expect(isActionEnabled('file.open')).toBe(false);
    act(() => useLayout.setState({ knownSession: () => true }));
    expect(isActionEnabled('file.open')).toBe(true);
  });

  it('is removed while the Overview is open over a session’s chat of this Mac, and registered again once it closes (decision 15)', () => {
    expect(isActionEnabled('file.open')).toBe(true);
    act(() => useLayout.getState().setOverviewOpen(true));
    expect(isActionEnabled('file.open')).toBe(false);
    act(() => useLayout.getState().setOverviewOpen(false));
    expect(isActionEnabled('file.open')).toBe(true);
  });

  it('is mounted by the editor’s registrations', () => {
    offs.splice(0).forEach((off) => off()); // this suite's own connection and the tool
    expect(isActionEnabled('file.open')).toBe(false);
    const off = registerEditor();
    expect(isActionEnabled('file.open')).toBe(true);
    off();
    expect(isActionEnabled('file.open')).toBe(false);
  });
});

// ---- UX wave U6f: a session on another machine -------------------------------------------------------------------------

describe('Open File… for a session on another machine (U6f)', () => {
  const T = addressOf(OTHER_MACHINE, 'app-there') as AppSessionId; // a lane B session main runs there over RL2
  const TERMINAL = addressOf(OTHER_MACHINE, 'app-terminal') as AppSessionId;
  const HOME = '/home/someone';
  const LISTING = { status: 'listed', path: HOME, parent: '/home', home: HOME, entries: [{ name: 'notes.txt', path: `${HOME}/notes.txt`, kind: 'file', protected: false }], cursor: null };
  let choice: () => Answer | Promise<Answer>;
  const sheets = () => document.querySelectorAll('[data-remote-chooser]');
  const sheet = () => document.querySelector<HTMLElement>('[data-remote-chooser]');
  const chooseNotes = async () => {
    await waitFor(() => expect(sheet()?.querySelector('[data-entry]')).not.toBeNull());
    fireEvent.click(sheet()!.querySelector('[data-entry]')!);
    fireEvent.click(within(sheet()!).getByRole('button', { name: 'Open' }));
  };

  beforeEach(() => {
    resetRemoteLaneBStore();
    forgetOpenedThere();
    forgetStarts();
    overRl2(T);
    choice = () => ok({ status: 'granted', path: '/data/notes.txt' });
    main = installFakeMain(async (name) => {
      if (name === 'layout.openFile') return answer();
      if (name === 'files.listOutside') return ok(LISTING);
      if (name === 'files.chooseOutside') return choice();
      if (name === 'files.watch' || name === 'files.unwatch' || name === 'layout.set' || name === 'files.read') return name === 'files.read' ? fail('not found: here') : ok();
      if (name === 'layout.get') return ok({ value: null });
      return fail(`unexpected ${name}`);
    });
  });
  afterEach(async () => {
    const open = sheet();
    if (open) fireEvent.click(within(open).getByRole('button', { name: 'Cancel' }));
    await settle();
    leaveRl2();
  });

  it('openChosenFor asks main’s chooser for a session of this Mac, and opens MAWS’s own sheet on that machine’s home for one there', async () => {
    await act(() => openChosenFor(A));
    expect(main.callsOf('layout.openFile')).toEqual([{ appSessionId: bareOf(A) }]);
    main.calls.splice(0);
    act(() => void openChosenFor(T));
    await waitFor(() => expect(sheet()).not.toBeNull());
    expect(within(sheet()!).getByRole('heading').textContent).toBe('Open a file on studio');
    expect(main.callsOf('files.listOutside')).toEqual([{ appSessionId: bareOf(T) }]);
    expect(main.callsOf('layout.openFile')).toEqual([]);
  });

  it('opens the granted file beside the chat as a kept tab, and reads the admission of an open tab of it again, as openChosen does', async () => {
    const readAdmission = vi.spyOn(useViewer.getState(), 'readAdmission');
    act(() => void openChosenFor(T));
    await chooseNotes();
    await waitFor(() => expect(filesOf(T)).toHaveLength(1));
    expect(main.callsOf('files.chooseOutside')).toEqual([{ appSessionId: bareOf(T), path: `${HOME}/notes.txt` }]);
    expect(paramsOf(filesOf(T)[0].id)).toEqual({ file: '/data/notes.txt', line: null });
    expect(readAdmission).toHaveBeenCalledWith(T, '/data/notes.txt');
    expect(sheet()).toBeNull();
    readAdmission.mockRestore();
  });

  // Fix wave (review finding 2): asked by a control that has not yet heard the offer move, it opens nothing there
  it('for a session there whose machine no longer offers the chooser to this person, opens no sheet and asks nothing; with the offer, it does (the control)', async () => {
    act(() => rosterSays(T, { owner: false }));
    act(() => void openChosenFor(T));
    await settle();
    expect(sheet()).toBeNull();
    expect(main.callsOf('files.listOutside')).toEqual([]);
    expect(main.callsOf('layout.openFile')).toEqual([]);
    act(() => rosterSays(T, {}));
    act(() => void openChosenFor(T));
    await waitFor(() => expect(sheet()).not.toBeNull());
    expect(main.callsOf('files.listOutside')).toHaveLength(1);
  });

  it('C6: asked again while the sheet is open, the sheet takes the keyboard and no second one opens', async () => {
    act(() => void openChosenFor(T));
    await waitFor(() => expect(sheet()).not.toBeNull());
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => void openChosenFor(T));
    await settle();
    expect(sheets()).toHaveLength(1);
    expect(sheet()!.contains(document.activeElement)).toBe(true);
    expect(main.callsOf('files.listOutside')).toHaveLength(1);
  });

  it('C3: Cancel while the choice is in flight closes the sheet, and the grant that arrives then opens nothing', async () => {
    const gate = deferred<void>();
    choice = async () => {
      await gate.promise;
      return ok({ status: 'granted', path: '/data/notes.txt' });
    };
    act(() => void openChosenFor(T));
    await chooseNotes();
    await waitFor(() => expect(main.callsOf('files.chooseOutside')).toHaveLength(1));
    fireEvent.click(within(sheet()!).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(sheet()).toBeNull();
    gate.resolve();
    await settle();
    expect(filesOf(T)).toEqual([]);
  });

  it('a grant that lands after the owners’ offer went, before the sheet heard of it, opens nothing; with the offer standing it opens (the control)', async () => {
    blind.on = true;
    try {
      const gate = deferred<void>();
      choice = async () => {
        await gate.promise;
        return ok({ status: 'granted', path: '/data/notes.txt' });
      };
      act(() => void openChosenFor(T));
      await chooseNotes();
      await waitFor(() => expect(main.callsOf('files.chooseOutside')).toHaveLength(1));
      act(() => rosterSays(T, { owner: false }));
      gate.resolve();
      await settle();
      expect(sheet()).toBeNull();
      expect(filesOf(T)).toEqual([]);
      // the control
      act(() => rosterSays(T, {}));
      choice = () => ok({ status: 'granted', path: '/data/notes.txt' });
      act(() => void openChosenFor(T));
      await chooseNotes();
      await waitFor(() => expect(filesOf(T)).toHaveLength(1));
    } finally {
      blind.on = false;
    }
  });

  it('C4: a choice that answers after its session left the page’s records opens nothing; after the chat in front changed, it opens beside the chosen session’s chat', async () => {
    const gate = deferred<void>();
    choice = async () => {
      await gate.promise;
      return ok({ status: 'granted', path: '/data/notes.txt' });
    };
    act(() => void openChosenFor(T));
    await chooseNotes();
    await waitFor(() => expect(main.callsOf('files.chooseOutside')).toHaveLength(1));
    act(() => useLayout.setState({ knownSession: (id) => id !== T }));
    gate.resolve();
    await settle();
    expect(filesOf(T)).toEqual([]);
    expect(notices()).toEqual([]);

    act(() => useLayout.setState({ knownSession: () => true, main: mainShowing(T) }));
    const again = deferred<void>();
    choice = async () => {
      await again.promise;
      return ok({ status: 'granted', path: '/data/notes.txt' });
    };
    act(() => void openChosenFor(T));
    await chooseNotes();
    await waitFor(() => expect(main.callsOf('files.chooseOutside')).toHaveLength(2));
    act(() => useLayout.setState({ main: mainShowing(A) })); // another chat in front now
    again.resolve();
    await waitFor(() => expect(filesOf(T)).toHaveLength(1));
    expect(filesOf(A)).toEqual([]);
  });

  describe('file.open', () => {
    beforeEach(() => {
      offs.push(connectOpenFile());
      act(() => useLayout.setState({ main: mainShowing(T) }));
    });

    it('is registered while such a chat is in front for one of the machine’s owners, and opens the sheet, never main’s chooser', async () => {
      expect(isActionEnabled('file.open')).toBe(true);
      act(() => runAction('file.open'));
      await waitFor(() => expect(sheet()).not.toBeNull());
      expect(main.callsOf('layout.openFile')).toEqual([]);
    });

    it('is removed while the helper has a sentence for files.chooseOutside, and registered again when it has none (R10)', () => {
      const cases = [{ owner: false }, { owner: undefined }, { capabilities: ['rl2.channel'] }, { state: 'down' as const, since: '2026-01-01T00:00:00.000Z' }, { state: 'connecting' as const }];
      for (const over of cases) {
        act(() => rosterSays(T, over));
        expect(isActionEnabled('file.open'), JSON.stringify(over)).toBe(false);
        act(() => rosterSays(T, {}));
        expect(isActionEnabled('file.open'), JSON.stringify(over)).toBe(true);
      }
    });

    it('is not registered for a terminal session there, which keeps U6e’s sentence', () => {
      act(() => overRl2(TERMINAL, {}, 'A'));
      act(() => useLayout.setState({ main: mainShowing(TERMINAL) }));
      expect(isActionEnabled('file.open')).toBe(false);
    });
  });
});
