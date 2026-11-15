// Open File… in the window (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, M3; §D,
// decisions 14 to 16, sequence W1): `openChosen` asks main's chooser for a session and opens the chosen file beside the
// chat as a kept tab, says a refusal or an error as a notice, and opens nothing for a cancel or a session the page no
// longer knows; `file.open` is registered exactly while a session's chat of this Mac is in front. Invented paths.
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { connectOpenFile, openChosen } from './open-chosen';

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

  it('is mounted by the editor’s registrations', () => {
    offs.splice(0).forEach((off) => off()); // this suite's own connection and the tool
    expect(isActionEnabled('file.open')).toBe(false);
    const off = registerEditor();
    expect(isActionEnabled('file.open')).toBe(true);
    off();
    expect(isActionEnabled('file.open')).toBe(false);
  });
});
