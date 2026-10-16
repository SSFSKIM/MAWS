// What the main subscription carries beside the transcript, as the depth column's diff and session info read it: DX4's
// `usage` (in the snapshot and after each main turn) and the diff answered to `Subscription.diff()`.
import type { SessionBodies } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { readRecording, scriptOf, snapshotAt } from '../../../test/double/session-stream';
import { DeskTranscript } from './desk-transcript';

const recording = readRecording();
const script = scriptOf(recording.session, null);
const TARGET = { machine: 'mini', session: 'sess-1', agentId: null };
const USAGE: SessionBodies['usage'] = { context: { tokens: 36820, window: 1_000_000, percent: 4 }, cost: { usd: 0.0032 } };
const LATER: SessionBodies['usage'] = { context: { tokens: 38686, window: 1_000_000, percent: 4 }, cost: { usd: 0.0053 } };
const DIFF = { base: 'main', text: 'diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-a\n+b\n' };

describe('session info and the diff on the main subscription', () => {
  let plane: FakePlane;
  let controller: DeskTranscript;
  let unmount: () => void;

  beforeEach(() => {
    plane = new FakePlane('proj');
    const store = createTranscriptStore();
    controller = new DeskTranscript({ plane, project: 'proj', target: TARGET, store });
    controller.open();
    unmount = mount(controller, store);
  });
  afterEach(() => {
    unmount();
    controller.close();
  });

  const usage = () => controller.state.getState().usage;

  it("takes context use and cost from the snapshot, updates them after a turn, and from a reconnect's fresh snapshot", async () => {
    expect(usage()).toBeUndefined(); // not known before the snapshot
    plane.send('snapshot', { ...snapshotAt(script, 4), usage: USAGE });
    expect(usage()).toEqual(USAGE);
    plane.send('usage', LATER);
    expect(usage()).toEqual(LATER);
    plane.current.listener.reset();
    await settle();
    expect(usage()).toBeUndefined(); // dropped with what the subscription delivered
    plane.send('snapshot', { ...snapshotAt(script, 6), usage: USAGE });
    expect(usage()).toEqual(USAGE);
  });

  it('reads a null usage (no bridge, or none yet) as unavailable, and an absent one the same', () => {
    plane.send('snapshot', { ...snapshotAt(script, 4), usage: null });
    expect(usage()).toBeNull();
    const second = new DeskTranscript({ plane, project: 'proj', target: { ...TARGET, session: 'sess-2' }, store: createTranscriptStore() });
    second.open();
    plane.send('snapshot', snapshotAt(script, 4)); // a producer that leaves it out
    expect(second.state.getState().usage).toBeNull();
    second.close();
  });

  it('asks for the diff only when told to, draws the answer, and asks again once on a fresh subscription when it was lost', async () => {
    plane.send('snapshot', snapshotAt(script, 4));
    expect(plane.current.diffs).toBe(0); // never polled
    controller.requestDiff();
    expect(plane.current.diffs).toBe(1);
    expect(controller.state.getState().diff).toEqual({ pending: true, answer: null });
    plane.send('diff', DIFF);
    expect(controller.state.getState().diff).toEqual({ pending: false, answer: DIFF });

    controller.requestDiff(); // the user's refresh: the last answer stays drawn until the new one
    expect(controller.state.getState().diff).toEqual({ pending: true, answer: DIFF });
    plane.current.listener.reset(); // the request went down with the socket
    await settle();
    expect(controller.state.getState().diff).toEqual({ pending: true, answer: DIFF });
    plane.send('snapshot', snapshotAt(script, 4));
    expect(plane.current.diffs).toBe(3);
    plane.send('diff', { ...DIFF, text: '' });
    expect(controller.state.getState().diff).toEqual({ pending: false, answer: { ...DIFF, text: '' } });
  });

  it("names the model of the transcript's latest response, and follows a live one", () => {
    expect(controller.state.getState().model).toBeNull();
    const rows = recording.session;
    const snapshot = snapshotAt(script, script.length);
    plane.send('snapshot', snapshot);
    const latest = rows.findLast((row) => row.type === 'assistant')!;
    expect(controller.state.getState().model).toBe((latest.message as { model: string }).model);
    plane.send('row', { row: { ...latest, uuid: 'later', message: { ...(latest.message as object), model: 'claude-opus-5-5' } }, agentId: null });
    expect(controller.state.getState().model).toBe('claude-opus-5-5');
    plane.send('row', { row: { ...latest, uuid: 'synthetic', message: { ...(latest.message as object), model: '<synthetic>' } }, agentId: null });
    expect(controller.state.getState().model).toBe('claude-opus-5-5');
  });

  it('never asks a subagent’s subscription for the diff', () => {
    const agent = new DeskTranscript({ plane, project: 'proj', target: { ...TARGET, agentId: 'a1' }, store: createTranscriptStore() });
    agent.open();
    plane.send('snapshot', snapshotAt(script, 4));
    agent.requestDiff();
    expect(plane.current.diffs).toBe(0);
    expect(agent.state.getState().usage).toBeUndefined();
    agent.close();
  });
});
