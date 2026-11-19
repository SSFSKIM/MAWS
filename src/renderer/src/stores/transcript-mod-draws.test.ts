// UX wave U2b, M5 (the execution document, §E; decision 8; R6): what the store keeps of who draws the view. With the
// lane off and the mod drawing, no turn folds once the session holds a message; a change of who draws closes every
// stretch the mirror held open; a jump's reveal ends only for the row still revealed. Every text is invented.
import { afterEach, describe, expect, it } from 'vitest';
import { builder } from '../transcript/model/test-events';
import type { RowId } from '../transcript/model/rows';
import { useTranscriptStore } from './transcript';

const KEY = 'app-mod-draws';
afterEach(() => useTranscriptStore.getState().drop(KEY));
async function withSession(marked: boolean) {
  const b = builder();
  b.turn('u1', 'Count the files');
  b.toolUse('t1', 'Bash', { command: 'ls' });
  b.result('t1', 'ok');
  b.text('m1', 0, marked ? '<message>Three files.</message>' : 'Three files.');
  b.end(['u1']);
  const events = b.events;
  await useTranscriptStore.getState().attach(KEY, { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) });
}
const ui = () => useTranscriptStore.getState().entries[KEY]!.state.ui;
const view = (v: { lane: boolean; modDraws?: boolean }) => useTranscriptStore.getState().setToHumanView(KEY, { tailMessage: false, ...v });

describe('who draws the view, in the store', () => {
  it('with the lane off and the mod drawing, no turn folds once the session holds a message', async () => {
    await withSession(true);
    view({ lane: false });
    expect(ui().noTurnFold).toBeFalsy(); // MAWS's own transcript: the turn folds
    view({ lane: false, modDraws: true });
    expect(ui().noTurnFold).toBe(true);
    expect(useTranscriptStore.getState().rows(KEY).some((row) => row.kind === 'cell' || row.kind === 'group')).toBe(true); // the turn's work is in the rows
    view({ lane: false, modDraws: false });
    expect(ui().noTurnFold).toBe(false);
  });

  it('with the mod drawing and no message held, the turn folds as it does today', async () => {
    await withSession(false);
    view({ lane: false, modDraws: true });
    expect(ui().noTurnFold).toBeFalsy();
  });

  it('a change of who draws closes every stretch the mirror held open; a lane change alone keeps them', async () => {
    await withSession(true);
    view({ lane: true });
    useTranscriptStore.getState().toggleStretch(KEY, 'stretch-a');
    expect([...ui().openStretches!]).toEqual(['stretch-a']);
    view({ lane: true, modDraws: true });
    expect([...ui().openStretches!]).toEqual([]);
    useTranscriptStore.getState().toggleStretch(KEY, 'stretch-b');
    view({ lane: true, modDraws: false });
    expect([...ui().openStretches!]).toEqual([]);
  });

  it('a jump’s reveal ends for the row still revealed, and a later jump’s reveal is not ended by an earlier one', async () => {
    await withSession(true);
    const [first, second] = useTranscriptStore.getState().rows(KEY).filter((row) => row.kind === 'user' || row.kind === 'assistant_text').map((row) => row.id as RowId);
    useTranscriptStore.getState().jumpTo(KEY, first!);
    expect(ui().revealed).toBe(first);
    useTranscriptStore.getState().jumpTo(KEY, second!);
    useTranscriptStore.getState().clearRevealed(KEY, first!); // the first jump's end, told late
    expect(ui().revealed).toBe(second);
    useTranscriptStore.getState().clearRevealed(KEY, second!);
    expect(ui().revealed).toBeUndefined();
  });
});
