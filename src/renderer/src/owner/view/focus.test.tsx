// The record line's focus hand-off once a stretch has changed shape while it was open (the whole-branch review's
// second look, 2026-11-15; M1's decision (j)): a press on `‹ fold to report` hands focus to the stretch's
// `› working record`, whose key is then its first row's, which may not be the key the open line carried: after the
// derivation regrouped the stretch (a run of one call unwrapped at completion) and after older rows paged in above it.
// Every text is invented.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { rowsOf } from '../../transcript/model/derive';
import { rowId } from '../../transcript/model/keys';
import { applyEvents, createState, withUi } from '../../transcript/model/reduce';
import type { Row } from '../../transcript/model/rows';
import { BASH_RESULT, builder } from '../../transcript/model/test-events';
import type { TranscriptSource } from '../../transcript/source/types';
import { Disclosures, NO_ACTIONS, TranscriptProvider, type TranscriptContextValue } from '../../transcript/view/context';
import { RowView } from '../../transcript/view/rows/Row';
import { mirrorRows } from './mirror';

const KEY = 'focus-test';
afterEach(() => {
  cleanup();
  useTranscriptStore.getState().drop(KEY);
});

// An earlier turn with a message (the view in force), then a turn that streams a commentary, a thought, one call, and
// its completion; the window first holds the rows from the thought on.
const COMMENTARY = rowId.text('m1' as never, 0);
function rowsAt(step: number, paged: boolean): Row[] {
  const b = builder();
  b.turn('u0', 'Set it up');
  b.text('m0', 0, '<message>Ready.</message>');
  b.end(['u0']);
  b.turn('u1', 'Read the second file');
  b.text('m1', 0, 'Looking at the second file first.');
  b.thinking('m2', 0, 'Which of the two holds the answer?');
  if (step >= 1) b.toolUse('t1', 'Bash', { command: 'cat second.txt' }, 'm2', 1);
  if (step >= 2) {
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.end(['u1']);
  }
  const state = applyEvents(createState(null, null), b.events);
  const rows = rowsOf(withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 }));
  return paged ? rows : rows.slice(rows.findIndex((r) => r.id === COMMENTARY) + 1);
}

const CONTEXT: TranscriptContextValue = { storeKey: KEY, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't' };

// A view of the key that composes `rows` (handed to the store as a mounted view's, as `Transcript` does) and draws them
// mirrored through the rows' own components.
function View({ rows }: { rows: Row[] }) {
  const openStretches = useTranscriptStore((state) => state.entries[KEY]?.state.ui.openStretches);
  useLayoutEffect(() => useTranscriptStore.getState().mountView(KEY, () => ({ rows, liveMarked: '' })), [rows]);
  return <TranscriptProvider value={CONTEXT}>{mirrorRows(rows, { openStretches }).map((row) => <RowView key={row.id} row={row} />)}</TranscriptProvider>;
}

async function attached() {
  const source: TranscriptSource = { key: KEY, subscribe: () => () => {}, snapshot: () => Promise.resolve([]) };
  await useTranscriptStore.getState().attach(KEY, source);
}
const line = (open: boolean) => document.querySelector<HTMLButtonElement>(`.owner-record-fold${open ? '[data-open]' : ':not([data-open])'} > button`)!;
const press = async (button: HTMLButtonElement) => {
  await act(async () => {
    fireEvent.click(button);
  });
};

describe('folding a stretch hands focus to its record line whatever key that line now carries', () => {
  it('after its run of one call unwrapped at completion', async () => {
    await attached();
    const view = render(<View rows={rowsAt(1, false)} />);
    await press(line(false)); // opened while the call's run heads it
    expect(document.activeElement).toBe(line(true));
    view.rerender(<View rows={rowsAt(2, false)} />); // completed: the thought, then the call
    await press(line(true));
    await waitFor(() => expect(line(false)).not.toBeNull()); // board ticket 850: once the fold's motion has run
    expect(document.activeElement).toBe(line(false));
  });

  it('after older rows paged in above it', async () => {
    await attached();
    const view = render(<View rows={rowsAt(2, false)} />);
    await press(line(false)); // opened while its thought heads it
    view.rerender(<View rows={rowsAt(2, true)} />); // paged up: the commentary above it heads it now
    await press(line(true));
    await waitFor(() => expect(line(false)).not.toBeNull()); // board ticket 850: once the fold's motion has run
    expect(document.activeElement).toBe(line(false));
  });
});
