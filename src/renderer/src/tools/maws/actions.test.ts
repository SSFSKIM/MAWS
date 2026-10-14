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
