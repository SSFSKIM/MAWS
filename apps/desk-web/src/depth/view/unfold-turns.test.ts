import type { SubagentMeta } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { readRecording, scriptOf } from '../../../test/double/session-stream';
import { DeskTranscript } from '../source/desk-transcript';
import { unfoldFinishedTurns } from './unfold-turns';

const recording = readRecording();
const metas: SubagentMeta[] = recording.subagents.map(({ agentId, meta }) => ({ agentId, meta }));
const script = scriptOf(recording.session, null);

describe("a fold's finished turns", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it('open once each; after a reset they open again, all but the one the reader folded', async () => {
    const plane = new FakePlane('proj', metas);
    const store = createTranscriptStore();
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store, range: { from: null, to: null } });
    controller.open();
    const unmount = mount(controller, store);
    const stop = unfoldFinishedTurns(store, controller.key);
    cleanups.push(() => (stop(), unmount(), controller.close()));

    plane.snapshot(script, script.length);
    await settle();
    await settle();
    const state = () => store.getState().entries[controller.key].state;
    const finished = () => [...state().turns].filter(([, turn]) => turn.state === 'closed').map(([id]) => id);
    expect(finished().length).toBeGreaterThanOrEqual(2);
    expect(finished().every((id) => state().ui.expandedTurns.has(id as never))).toBe(true);

    const [folded, ...rest] = finished();
    store.getState().toggleTurn(controller.key, folded as never); // the reader folds one
    expect(state().ui.expandedTurns.has(folded as never)).toBe(false);

    plane.current.listener.reset(); // a reconnect: MAWS's store forgets the key's disclosure
    await settle();
    plane.snapshot(script, script.length);
    await settle();
    await settle();
    expect(store.getState().entries[controller.key].phase).toBe('live');
    expect(rest.every((id) => state().ui.expandedTurns.has(id as never))).toBe(true);
    expect(state().ui.expandedTurns.has(folded as never)).toBe(false);
  });
});
