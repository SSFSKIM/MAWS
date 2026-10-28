// @vitest-environment happy-dom
// P5 O6 M6 (e2e:desk-web): the desk draws MAWS's transcript over its own keys (`desk:<project>:<session>`), which are no
// MAWS addresses, and has no MAWS bridge. Its pane mounts the transcript without MAWS's browser activity, so no desk key
// reaches the renderer client's addressing, which refuses a non-address with a console error (the page error every desk
// acceptance test failed on). The desk is frozen at O13 and retired at cutover (P5 Decision Log 1).
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { FakePlane } from '../../../test/double/fake-plane';
import { readRecording, scriptOf } from '../../../test/double/session-stream';
import type { DeskSession } from '../../shell/sessions';
import { DeskTranscript } from '../source/desk-transcript';
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

function Pane({ controller }: { controller: DeskTranscript }) {
  const state = useDeskTranscript(controller, session);
  return <TranscriptPane controller={controller} state={state} variant="session" actions={{}} list={createRef<TranscriptListHandle>()} />;
}

it('draws a session’s transcript without asking MAWS for its browser activity: a desk key is never lowered as an address', async () => {
  const errors = vi.spyOn(console, 'error');
  try {
    const plane = new FakePlane('proj');
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store: useTranscriptStore });
    render(<Pane controller={controller} />);
    await act(async () => plane.current.snapshot(script, 4));
    expect(controller.state.getState().phase).toBe('live');
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});
