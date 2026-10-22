// What the main subscription carries beside the transcript, as the depth column's diff and session info read it: DX4's
// `usage` (in the snapshot and after each main turn) and the diff answered to `Subscription.diff()`.
import type { SessionBodies, StatusRead } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { readRecording, scriptOf, snapshotAt } from '../../../test/double/session-stream';
import { ReadError } from '../../shell/session-plane';
import { useSeenModels } from '../../state/models';
import { DeskTranscript } from './desk-transcript';

const recording = readRecording();
const script = scriptOf(recording.session, null);
const TARGET = { machine: 'mini', session: 'sess-1', agentId: null };
const USAGE: SessionBodies['usage'] = { context: { tokens: 36820, window: 1_000_000, percent: 4 }, cost: { usd: 0.0032 } };
const LATER: SessionBodies['usage'] = { context: { tokens: 38686, window: 1_000_000, percent: 4 }, cost: { usd: 0.0053 } };
const STATUS: StatusRead = { version: { version: '2.1.307', base: '2.1.300' }, model: null, cwd: '/w/maws', root: '/w/maws', repo: { branch: 'master' }, surfaces: ['cli'], override: null };
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
    plane.current.listener.interrupted();
    await settle();
    expect(usage()).toEqual(LATER); // kept, as all the subscription delivered is, until the fresh snapshot says again
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
    plane.current.listener.interrupted(); // the request went down with the socket
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
    // Each model a transcript answered from leads the project's list the pickers offer, newest first.
    expect(useSeenModels.getState().proj).toEqual(['claude-opus-5-5', (latest.message as { model: string }).model]);
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

describe("the engine's status, read on the main subscription (the control surface's M0)", () => {
  let plane: FakePlane;
  let controller: DeskTranscript;

  beforeEach(() => {
    plane = new FakePlane('proj');
    controller = new DeskTranscript({ plane, project: 'proj', target: TARGET, store: createTranscriptStore() });
    controller.open();
  });
  afterEach(() => controller.close());

  const status = () => controller.state.getState().status;

  it('reads it only when told to, again once per subscription open after that, the last answer kept meanwhile', async () => {
    controller.requestStatus(); // the tab opened before the snapshot: asked once it is in
    expect(plane.current.reads).toHaveLength(0);
    expect(status()).toEqual({ pending: true, answer: null, error: null });
    plane.send('snapshot', snapshotAt(script, 4));
    expect(plane.current.reads.map((r) => r.what)).toEqual(['status']);
    plane.current.reads[0].resolve(STATUS);
    await settle();
    expect(status()).toEqual({ pending: false, answer: STATUS, error: null });
    plane.send('usage', LATER); // a message on the sub is no reason to ask again
    expect(plane.current.reads).toHaveLength(1);

    plane.current.listener.interrupted();
    await settle();
    plane.send('snapshot', snapshotAt(script, 4)); // a fresh subscription: asked again, the answer drawn meanwhile
    expect(plane.current.reads).toHaveLength(2);
    expect(status()).toEqual({ pending: true, answer: STATUS, error: null });
    const later = { ...STATUS, root: '/other' };
    plane.current.reads[1].resolve(later);
    await settle();
    expect(status()?.answer).toEqual(later);
  });

  it("says the read's refusal, and leaves one the disruption cut to the fresh subscription", async () => {
    plane.send('snapshot', snapshotAt(script, 4));
    controller.requestStatus();
    plane.current.reads[0].reject(new ReadError('interrupted', 'the subscription went down before the answer'));
    await settle();
    expect(status()).toEqual({ pending: true, answer: null, error: null });
    plane.send('snapshot', snapshotAt(script, 4));
    plane.current.reads[1].reject(new ReadError('unsupported', 'no read status'));
    await settle();
    expect(status()).toEqual({ pending: false, answer: null, error: 'no read status' });
  });

  it('keeps the last answer when a Refresh fails, with the failure beside it, until a read succeeds', async () => {
    plane.send('snapshot', snapshotAt(script, 4));
    controller.requestStatus();
    plane.current.reads[0].resolve(STATUS);
    await settle();
    controller.requestStatus();
    plane.current.reads[1].reject(new ReadError('timeout', 'no answer within 15 s'));
    await settle();
    expect(status()).toEqual({ pending: false, answer: STATUS, error: 'no answer within 15 s' });
    controller.requestStatus();
    expect(status()).toEqual({ pending: true, answer: STATUS, error: null });
    plane.current.reads[2].resolve(STATUS);
    await settle();
    expect(status()).toEqual({ pending: false, answer: STATUS, error: null });
  });

  it('takes only the latest request’s answer (a Refresh over one on its way)', async () => {
    plane.send('snapshot', snapshotAt(script, 4));
    controller.requestStatus();
    controller.requestStatus();
    plane.current.reads[1].resolve(STATUS);
    plane.current.reads[0].resolve({ ...STATUS, root: '/stale' });
    await settle();
    expect(status()?.answer).toEqual(STATUS);
  });

  it('never reads it on a subagent’s subscription', () => {
    const agent = new DeskTranscript({ plane, project: 'proj', target: { ...TARGET, agentId: 'a1' }, store: createTranscriptStore() });
    agent.open();
    plane.send('snapshot', snapshotAt(script, 4));
    agent.requestStatus();
    expect(plane.current.reads).toHaveLength(0);
    expect(agent.state.getState().status).toBeNull();
    agent.close();
  });
});
