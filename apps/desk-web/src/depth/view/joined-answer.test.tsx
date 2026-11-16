// @vitest-environment happy-dom
// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M3; "Reported to the architect", H): the desk draws a
// session from the rows its machine sends, through MAWS's reader of another machine's rows and MAWS's transcript model.
// When MAWS's answer envelope and a prompt waited together, the engine's file holds them as one line; the desk's session
// view draws that line as MAWS's window does: the person's words in their bubble, the envelope as its ask's answer, and
// nothing of the envelope on the page. Over the probes' recorded files, every row that carries a uuid sent as the
// plane's snapshot (as the routes test of MAWS's lane A feeds the same rows to the reader).
import { act, cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonObject } from 'desk-hub/protocol';
import { freshSource, subagentLookupOf, type PlaneTranscript } from '../../../../../src/renderer/src/lane-a/plane-transcript';
import { FakePlane } from '../../../../../src/renderer/src/lane-a/test-support/fake-plane';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { rowsOf, withAllExpanded } from '../../../../../src/renderer/src/transcript/model/derive';
import { applyEvents, createState, type TranscriptState } from '../../../../../src/renderer/src/transcript/model/reduce';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { DeskSession } from '../../shell/sessions';
import { deskTranscript } from '../source/desk-source';
import { TranscriptPane, useDeskTranscript } from './TranscriptPane';

const UXWAVE = join(import.meta.dirname, '../../../../../spikes/protocol-probe/fixtures/uxwave');
const rowsOfFile = (name: string): JsonObject[] =>
  readFileSync(join(UXWAVE, `${name}.transcript.jsonl`), 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject).filter((row) => typeof row.uuid === 'string');
const sessionIdOf = (rows: JsonObject[]): string => rows.map((row) => row.sessionId).find((id): id is string => typeof id === 'string')!;

const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
// what the person reads of the user rows and the asks' capsules
const reading = (rows: Row[]) =>
  rows.flatMap((row) => (row.kind === 'user' ? [{ user: row.messageUuid, text: row.text }] : row.kind === 'ask' ? [{ ask: row.askId, state: row.state, answers: row.answers }] : []));
const holdsEnvelope = (text: string) => text.includes('[MAWS ask') || text.includes('```json');

const session = {
  project: 'proj',
  session: 'sess-704',
  alias: 'maws-704',
  machine: 'mini',
  cwd: null,
  worktree: null,
  seat: '',
  member: true,
  ended: null,
  charge: null,
  status: null,
  state: null,
  joinedAt: 0,
  group: 'working',
  presence: { record: { status: 'idle' }, bridge: true },
  machineOnline: true,
} as unknown as DeskSession; // the fields the pane reads, as TranscriptPane.test.tsx builds one

function Pane({ controller }: { controller: PlaneTranscript }) {
  const state = useDeskTranscript(controller, session);
  return <TranscriptPane controller={controller} state={state} variant="session" actions={{}} list={createRef<TranscriptListHandle>()} />;
}

afterEach(cleanup);

describe('a joined answer drawn in the desk’s session view (ticket 704)', () => {
  it.each(['u704-end-prompt-first-1', 'u704-end-env-first-1', 'u704-end-image-1', 'u704-end-two-envelopes-1'])('%s: the person’s rows and the asks read as MAWS’s window reads the same rows, and the page holds nothing of the envelope', async (name) => {
    const rows = rowsOfFile(name);
    const window = drawn(applyEvents(createState(null, null), await freshSource(rows, sessionIdOf(rows), subagentLookupOf([])).snapshot()));
    const plane = new FakePlane('proj');
    const controller = deskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: name, agentId: null }, store: useTranscriptStore });
    const { container } = render(<Pane controller={controller} />);
    await act(async () => plane.current.send('snapshot', { rows: [...rows].reverse(), more: false, subagents: [], presence: { record: { status: 'idle' }, bridge: true }, streaming: [] }));
    expect(controller.state.getState().phase).toBe('live');
    const entry = useTranscriptStore.getState().entries[`desk:proj:${name}`];
    expect(entry).toBeDefined();
    const desk = reading(drawn(entry!.state));
    expect(desk).toEqual(reading(window));
    expect(desk.filter((row) => 'text' in row && holdsEnvelope(row.text))).toEqual([]);
    const asks = desk.filter((row) => 'ask' in row);
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.map((row) => (row as { state: string }).state)).toEqual(asks.map(() => 'answered'));
    expect(holdsEnvelope(container.textContent ?? '')).toBe(false);
    act(() => controller.close());
  });
});
