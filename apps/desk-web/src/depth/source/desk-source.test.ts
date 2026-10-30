// The depth column's wiring of the plane transcript (P5 O9 M3 lifted the transcript into MAWS's renderer): the desk's
// store keys, and each model a transcript answered from noted in its project's list. Its latency marks are
// `latency/latency.test.ts`'s.
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { FakePlane } from '../../../../../src/renderer/src/lane-a/test-support/fake-plane';
import { readRecording, scriptOf, snapshotAt } from '../../../../../src/renderer/src/lane-a/test-support/session-stream';
import { useSeenModels } from '../../state/models';
import { deskTranscript } from './desk-source';

describe("the desk's transcripts", () => {
  it('keeps a session’s transcript under `desk:<project>:<session>`, and a subagent’s under its agent id after it', () => {
    const plane = new FakePlane('proj');
    const store = createTranscriptStore();
    expect(deskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store }).key).toBe('desk:proj:sess-1');
    expect(deskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: 'a1' }, store }).key).toBe('desk:proj:sess-1:a1');
  });

  it("puts each model a transcript answered from first in its project's list, which the pickers offer", () => {
    const rows = readRecording().session;
    const script = scriptOf(rows, null);
    const plane = new FakePlane('models');
    const controller = deskTranscript({ plane, project: 'models', target: { machine: 'mini', session: 'sess-1', agentId: null }, store: createTranscriptStore() });
    controller.open();
    plane.send('snapshot', snapshotAt(script, script.length));
    const latest = rows.findLast((row) => row.type === 'assistant')!;
    plane.send('row', { row: { ...latest, uuid: 'later', message: { ...(latest.message as object), model: 'claude-opus-5-5' } }, agentId: null });
    expect(useSeenModels.getState().models).toEqual(['claude-opus-5-5', (latest.message as { model: string }).model]);
    controller.close();
  });
});
