// @vitest-environment happy-dom
// P5 O6 M6 (e2e:desk-web): the desk draws MAWS's transcript over its own keys (`desk:<project>:<session>`), which are no
// MAWS addresses, and has no MAWS bridge. Its pane mounts the transcript without MAWS's browser activity, so no desk key
// reaches the renderer client's addressing, which refuses a non-address with a console error (the page error every desk
// acceptance test failed on). The desk is frozen at O13 and retired at cutover (P5 Decision Log 1).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JsonObject } from 'desk-hub/protocol';
import { createRef } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { PlaneTranscript } from '../../../../../src/renderer/src/lane-a/plane-transcript';
import { FakePlane, settle } from '../../../../../src/renderer/src/lane-a/test-support/fake-plane';
import { readRecording, scriptOf } from '../../../../../src/renderer/src/lane-a/test-support/session-stream';
import type { DeskSession } from '../../shell/sessions';
import { deskTranscript } from '../source/desk-source';
import { TranscriptPane, useDeskTranscript } from './TranscriptPane';

const script = scriptOf(readRecording().session, null);
const session = {
  project: 'proj',
  session: 'sess-1',
  alias: 'maws-45',
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
  presence: { record: { status: 'busy' }, bridge: true },
  machineOnline: true,
} as unknown as DeskSession; // the fields the pane reads, as resubscribe.test.ts builds one

afterEach(cleanup);

function Pane({ controller, ownerLane }: { controller: PlaneTranscript; ownerLane?: boolean }) {
  const state = useDeskTranscript(controller, session);
  return <TranscriptPane controller={controller} state={state} variant="session" actions={{}} list={createRef<TranscriptListHandle>()} ownerLane={ownerLane} />;
}

it('draws a session’s transcript without asking MAWS for its browser activity: a desk key is never lowered as an address', async () => {
  const errors = vi.spyOn(console, 'error');
  try {
    const plane = new FakePlane('proj');
    const controller = deskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store: useTranscriptStore });
    render(<Pane controller={controller} />);
    await act(async () => plane.current.snapshot(script, 4));
    expect(controller.state.getState().phase).toBe('live');
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

// UX wave U2b (the execution document, M1's "The flag", R5): the desk's streamed rows never enter the store; they are
// handed to the transcript as its tail. So the session's first message, still streaming, puts the view in force from
// there: the earlier turn, closed, is drawn with no turn fold, and opening its record at once shows its work; when the
// stream starts over with nothing in it, the turn fold is back. The rows are invented.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-transcript-scroller')) return 4000;
      if (this.hasAttribute('data-index')) return 40;
      return 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

it('the first message, streaming from outside the store, puts the view in force; a stream that starts over takes it out', async () => {
  const SESSION = '0f0e0d0c-0000-4000-8000-00000000d35c';
  const time = (ms: number) => new Date(Date.parse('2026-10-15T09:00:00.000Z') + ms).toISOString();
  const base = (uuid: string, parentUuid: string | null, ms: number) => ({ uuid, parentUuid, timestamp: time(ms), sessionId: SESSION, isSidechain: false });
  const prompt = (uuid: string, parentUuid: string | null, ms: number, text: string): JsonObject => ({ ...base(uuid, parentUuid, ms), type: 'user', message: { role: 'user', content: text } });
  const assistant = (uuid: string, parentUuid: string, ms: number, id: string, content: JsonObject[]): JsonObject => ({
    ...base(uuid, parentUuid, ms), type: 'assistant', apiBlockIndex: 0,
    message: { id, type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
  const result = (uuid: string, parentUuid: string, ms: number, toolUseId: string, content: string): JsonObject => ({ ...base(uuid, parentUuid, ms), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] } });
  const WORK = 'Listed the notes first.';
  const rows: JsonObject[] = [
    prompt('d-1', null, 0, 'Tidy the notes'),
    assistant('d-2', 'd-1', 100, 'msg_d_1', [{ type: 'text', text: WORK }]),
    assistant('d-3', 'd-2', 200, 'msg_d_2', [{ type: 'tool_use', id: 'toolu_d_1', name: 'Bash', input: { command: 'ls notes' } }]),
    result('d-4', 'd-3', 300, 'toolu_d_1', 'notes.md'),
    assistant('d-5', 'd-4', 400, 'msg_d_3', [{ type: 'text', text: 'The notes are tidy.' }]),
    { ...base('d-6', 'd-5', 500), type: 'system', subtype: 'turn_duration', durationMs: 500 },
    prompt('d-7', 'd-6', 60_000, 'And the rest?'),
    assistant('d-8', 'd-7', 60_100, 'msg_d_4', [{ type: 'text', text: '<message>Starting the second part, and the rest after it.</message>' }]),
  ];
  const script = scriptOf(rows, null, { cutOff: 7 }); // the last reply streams half its chunks and is never written
  const before = script.findIndex((item) => item.kind === 'chunk' && item.body.step === 0 && item.body.turnId === 'turn-1');
  const records = () => screen.queryAllByRole('button', { name: '› working record' });
  const turnFolds = () => [...document.querySelectorAll('[data-kind="divider"] .transcript-divider > .transcript-disclosure')].map((line) => line.getAttribute('aria-expanded'));

  const plane = new FakePlane('proj');
  const controller = deskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store: useTranscriptStore });
  render(<Pane controller={controller} ownerLane />);
  await act(async () => plane.current.snapshot(script, script.length));
  await waitFor(() => expect(records().length).toBeGreaterThan(0));
  expect(screen.queryByText(WORK)).toBeNull();
  expect(turnFolds()).toEqual([]);
  fireEvent.click(records()[0]);
  await waitFor(() => expect(screen.getByText(WORK)).toBeTruthy());

  await act(async () => {
    plane.current.snapshot(script, before);
    await settle();
  });
  await waitFor(() => expect(records()).toEqual([]));
  await waitFor(() => expect(turnFolds()).toContain('false'));
  expect(screen.queryByText(WORK)).toBeNull();
});
