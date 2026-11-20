// E1 (M3): the transcript actions behind the `maws` rows. The delivery row's two buttons go through `files.openExternal`
// and `files.reveal` with the row's session and the file's path, and answer what to show when main refused; the
// capsule's `openAsk` opens the Question sheet when a build registers it (M4) and does nothing otherwise.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { fakeClient } from '../../../../../test/support/fake-client';
import { registerPanelTool } from '../../panel/host';
import { A, panelOf, probeTool, resetPanelStores } from '../../test-support/panel';
import type { AskRowData } from '../../transcript';
import { mawsTranscriptActionsOver } from './actions';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE } from '../../../../../test/support/machine';
import { applyRemoteSession, resetRemoteLaneBStore } from '../../lane-b/remote-session';
import { remoteSessionState } from '../../lane-b/test-support/remote-session';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import { leaveRl2, overRl2 } from '../../test-support/code-disk'; // ticket 627

const PATH = '/repo/hello.txt';
const ASK: AskRowData = {
  askId: 'toolu_a', toolUseId: 'toolu_a' as never, title: null, context: null, blocking: true, questions: [{ id: 'q1', question: 'Proceed?', modality: 'text' }], state: 'answered',
  answers: [{ id: 'q1', question: 'Proceed?', status: 'answered', value: 'yes' }], error: null, cancelReason: null,
};

describe('the delivery row’s actions', () => {
  it('Open externally: files.openExternal with the session and path; null when opened, the refusal otherwise', async () => {
    const opened = fakeClient({ 'files.openExternal': { opened: true, message: null } });
    expect(await mawsTranscriptActionsOver(opened.client).openDelivered(A, PATH)).toBeNull();
    expect(opened.invoked('files.openExternal')).toEqual([{ appSessionId: A, path: PATH }]);

    const notOpened = fakeClient({ 'files.openExternal': { opened: false, message: 'no application' } });
    expect(await mawsTranscriptActionsOver(notOpened.client).openDelivered(A, PATH)).toBe('Not opened: no application');

    const refused = fakeClient();
    const answer = mawsTranscriptActionsOver(refused.client).openDelivered(A, PATH);
    await refused.fail('files.openExternal', 'not opened outside MAWS: /repo/hello.txt');
    expect(await answer).toBe('Refused: not opened outside MAWS: /repo/hello.txt');
  });

  // P5 O7 M5a (A10): a lane B session on another machine's file opens as a copy paged here
  it('Open externally on another machine’s session: remote.openCopy of the file there; null when opened, its words otherwise', async () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    applyRemoteSession(remoteSessionState(REMOTE));
    const opened = fakeClient({ 'remote.openCopy': { opened: true, message: null } });
    expect(await mawsTranscriptActionsOver(opened.client).openDelivered(REMOTE, PATH)).toBeNull();
    expect(opened.invoked('remote.openCopy')).toEqual([{ machine: OTHER_MACHINE, source: { appSessionId: REMOTE, path: PATH } }]);
    expect(opened.invoked('files.openExternal')).toEqual([]);
    const tooLarge = fakeClient({ 'remote.openCopy': { opened: false, message: 'too large to copy from mini' } });
    expect(await mawsTranscriptActionsOver(tooLarge.client).openDelivered(REMOTE, PATH)).toBe('Not opened: too large to copy from mini');
    resetRemoteLaneBStore();
  });

  // Ticket 627: a terminal (lane A) session over RL2 reads its files through no lane B adapter, so neither opens a copy
  // nor reveals here: each says the declared sentence and sends nothing; a lane B session's Reveal likewise
  it('Open externally and Reveal in Finder on a terminal session over RL2: the sentence, and nothing sent', async () => {
    const TERMINAL = addressOf(OTHER_MACHINE, 'app-a' as AppSessionId);
    overRl2(TERMINAL, {}, 'A');
    const f = fakeClient({ 'files.openExternal': { opened: true, message: null }, 'files.reveal': { revealed: true, message: null }, 'remote.openCopy': { opened: true, message: null } });
    const actions = mawsTranscriptActionsOver(f.client);
    expect(await actions.openDelivered(TERMINAL, PATH)).toBe(`Refused: ${REMOTE_UNAVAILABLE['files.openExternal']}`);
    expect(await actions.revealDelivered(TERMINAL, PATH)).toBe(`Refused: ${REMOTE_UNAVAILABLE['files.reveal']}`);
    const LANE_B = addressOf(OTHER_MACHINE, 'app-b' as AppSessionId);
    overRl2(LANE_B, {}, 'B');
    expect(await actions.revealDelivered(LANE_B, PATH)).toBe(`Refused: ${REMOTE_UNAVAILABLE['files.reveal']}`);
    expect([f.invoked('files.openExternal'), f.invoked('files.reveal'), f.invoked('remote.openCopy')]).toEqual([[], [], []]);
    leaveRl2();
  });

  it('Reveal in Finder: files.reveal with the session and path; null when revealed, the refusal otherwise', async () => {
    const revealed = fakeClient({ 'files.reveal': { revealed: true, message: null } });
    expect(await mawsTranscriptActionsOver(revealed.client).revealDelivered(A, PATH)).toBeNull();
    expect(revealed.invoked('files.reveal')).toEqual([{ appSessionId: A, path: PATH }]);

    const refused = fakeClient({ 'files.reveal': { revealed: false, message: 'outside the session’s directories' } });
    expect(await mawsTranscriptActionsOver(refused.client).revealDelivered(A, PATH)).toBe('Refused: outside the session’s directories');
  });
});

describe('openAsk', () => {
  beforeEach(() => resetPanelStores());
  afterEach(() => resetPanelStores());

  it('does nothing while no build registers the Question sheet', () => {
    mawsTranscriptActionsOver(fakeClient().client).openAsk(A, ASK);
    expect(panelOf(A)?.tabs ?? []).toEqual([]);
  });

  it('opens the sheet for the session with the ask’s id and its own data, activated', () => {
    const { tool, probe } = probeTool(ASK_SHEET_TOOL_ID, { multiInstance: false, pinnable: false });
    registerPanelTool(tool);
    mawsTranscriptActionsOver(fakeClient().client).openAsk('app-b' as AppSessionId, ASK);
    expect(probe.created.map((init) => [init.appSessionId, init.params])).toEqual([['app-b', { askId: 'toolu_a', historical: ASK }]]);
    expect(panelOf('app-b' as AppSessionId)?.tabs.map((tab) => tab.toolId)).toEqual([ASK_SHEET_TOOL_ID]);
  });
});
