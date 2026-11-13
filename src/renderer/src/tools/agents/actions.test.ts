// UX wave U3, first landing (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, decision 22, Interfaces I): the
// app's "Open output" on a task's notice is the Log on the file, for the row's session, where that session is one MAWS
// runs; a terminal session's notice gets no act, as the background work list gives its jobs no Output.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { record } from '../../../../../test/support/builders';
import { at, OTHER_MACHINE } from '../../../../../test/support/machine';
import { useSessions } from '../../stores/sessions';
import { outputAction } from './actions';

const openLog = vi.hoisted(() => vi.fn(() => 'log-tab'));
vi.mock('./log/LogTool', () => ({ openLog }));

const RUN = at('run' as AppSessionId); // a session MAWS runs on this Mac
const ELSEWHERE = addressOf(OTHER_MACHINE, 'far' as AppSessionId); // one MAWS runs on another machine
const TERMINAL = at('term' as AppSessionId);
const SEAT = at('seat' as AppSessionId);
const OUTPUT = { taskId: null, path: '/tmp/work/bt1.output', title: 'Background command "count files" completed (exit code 0)' };

beforeEach(() =>
  useSessions.setState({
    records: new Map([
      [RUN, record(RUN)],
      [TERMINAL, record(TERMINAL, { holder: { kind: 'terminal', pid: 42 } as never })],
      [SEAT, record(SEAT, { holder: { kind: 'background_job' } as never })],
    ]),
    listed: new Map(),
  }),
);
afterEach(() => {
  openLog.mockClear();
  useSessions.setState({ records: new Map(), listed: new Map() });
});

describe('outputAction', () => {
  it('opens the Log on the row’s path for the row’s session, on this Mac and on another machine', () => {
    outputAction(RUN)!(OUTPUT);
    outputAction(ELSEWHERE)!(OUTPUT);
    expect(openLog.mock.calls).toEqual([
      [RUN, OUTPUT.path, OUTPUT.title],
      [ELSEWHERE, OUTPUT.path, OUTPUT.title],
    ]);
  });

  it('gives no act for a terminal session, a background job’s, another machine’s terminal session, or a row with no session', () => {
    const remoteTerminal = addressOf(OTHER_MACHINE, 'pane' as AppSessionId);
    useSessions.setState({ listed: new Map([[remoteTerminal, { lane: 'A' } as never]]) });
    expect([outputAction(TERMINAL), outputAction(SEAT), outputAction(remoteTerminal), outputAction(null)]).toEqual([null, null, null, null]);
    expect(openLog).not.toHaveBeenCalled();
  });
});
