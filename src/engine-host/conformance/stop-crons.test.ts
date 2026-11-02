// P5 O2 M2: the Stop-hook probe's recordings (spikes/protocol-probe/fixtures/p5/p5-o2-stop-crons-*.jsonl, the pinned
// engine 2.1.283; findings-p5-o2-stop-crons.txt) replayed through whole EngineSessions (docs/doperpowers/plans/
// 2026-10-27-p5-o2-mawsd.md, M2 "Proves"). The recorded `initialize` carries the probe's Stop hook, which the app's
// replay handshake projects onto the session's own. The session sends each recorded prompt; the probe's own controls
// (its interrupt, its end) go to the replay as the probe wrote them, since what is under test is the work the session
// reads, not how it interrupts. The durable fixtures' scheduled-tasks file is the one their `durable_file` row recorded.
import { describe, expect, it } from 'vitest';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import { loadP5Journal } from '../../../test/support/fixtures';
import { isIdleRow } from '../budget';
import type { EngineSession } from '../session';
import { scheduledTasksPath } from '../durable-crons';
import type { ReplayTransport } from '../replay-transport';
import { replayedSession } from './session-harness';

type Work = NonNullable<EngineSessionStatus['work']>;
type Frame = { type: string; message?: { content: string }; request?: { subtype?: string } };
const metaRows = (rows: JournalRow[], event: string) => rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === event);
const metaOf = (rows: JournalRow[], event: string) => rows.find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === event)!.frame as Record<string, unknown>;

// `want` appears in `seen` in order (other states may come between).
function inOrder(seen: Work[], want: Work[]): void {
  let at = 0;
  for (const work of seen) if (at < want.length && JSON.stringify(work) === JSON.stringify(want[at])) at += 1;
  expect(want.slice(at), `states not seen in order after ${JSON.stringify(want.slice(0, at))}`).toEqual([]);
}

// Each recorded prompt is sent by the session; a recorded control the session does not author (the probe's interrupt)
// is written as recorded; the recorded end is a kill.
function drive(row: JournalRow, ctx: { session: EngineSession; transport: ReplayTransport; ready: () => Promise<void> }): void {
  const frame = row.frame as Frame;
  if (frame.type === 'user') void ctx.ready().then(() => ctx.session.send(frame.message!.content));
  else if (frame.type === 'control_request' && frame.request?.subtype === 'end_session') ctx.transport.kill('SIGTERM');
  else if (frame.type === 'control_request') void ctx.transport.write(row.frame as never);
  // a control_response is the session's own answer to the Stop callback
}

async function replay(name: string, opts: { spec?: Partial<LaunchSpec>; tasksFile?: (path: string) => string | null } = {}) {
  const works: Work[] = [];
  const statuses: EngineSessionStatus[] = [];
  const run = await replayedSession('pass3', name, drive, { // `pass3`: a label only, the journal is `load`'s
    load: () => loadP5Journal(name),
    spec: opts.spec,
    session: { scheduledTasksFile: opts.tasksFile ?? (() => null) },
    beforeStart: ({ session }) => session.on('status', (s: EngineSessionStatus) => {
      statuses.push(s);
      works.push({ crons: s.work!.crons, unknown: s.work!.unknown }); // O16 M5: a replay has no process tree (descendants 0)
    }),
  });
  expect(metaRows(run.journal.rows, 'replay_mismatch')).toEqual([]);
  return { ...run, works, statuses };
}

const job = (id: string, schedule: string, prompt: string, recurring = true) => ({ id, schedule, recurring, prompt });
const NIGHTLY = job('e6c78dde', '0 3 * * *', 'nightly report job');
const INTERRUPTED = job('2fa6f7ad', '0 5 * * *', 'interrupted turn job');

describe('the Stop callback, replayed from the probe (P5 O2 M2)', () => {
  it('main: each Stop\'s list reaches status().work, answered {} before its result; a turn interrupted after a CronCreate leaves the crons unknown until the next Stop', async () => {
    const run = await replay('p5-o2-stop-crons-main');
    const wakeup = run.works.flatMap((w) => w.crons).find((c) => !c.recurring)!; // the /loop's ScheduleWakeup one-shot
    inOrder(run.works, [
      { crons: [], unknown: 'dirty' }, // CronCreate (seq 27)
      { crons: [NIGHTLY], unknown: null }, // its Stop (seq 40)
      { crons: [NIGHTLY], unknown: 'dirty' }, // CronDelete (seq 58)
      { crons: [], unknown: null }, // its Stop (seq 71)
      { crons: [], unknown: 'turn_ended_without_stop' }, // CronCreate, then the interrupt (result seq 252, no Stop)
      { crons: [INTERRUPTED], unknown: null }, // the next turn's Stop repairs it (seq 270)
      { crons: [INTERRUPTED], unknown: 'dirty' }, // ScheduleWakeup (seq 288)
      { crons: [INTERRUPTED, wakeup], unknown: null }, // its Stop lists the one-shot (seq 301)
      { crons: [INTERRUPTED], unknown: null }, // the tick fired it; the tick's Stop (seq 322): no keepalive in -p
    ]);
    expect(wakeup.prompt).toContain('/loop');
    // every Stop answered {} at once, ahead of its turn's result
    const answers = run.journal.rows.filter((r) => r.direction === 'out' && (r.frame as Frame).type === 'control_response');
    expect(answers.map((r) => (r.frame as { response: { response: unknown } }).response.response)).toEqual(Array(answers.length).fill({}));
    expect(answers.length).toBeGreaterThanOrEqual(10);
    // the callback's event leaves the final text out; the journal keeps the whole frame
    const callbacks = run.events.filter((e): e is Extract<SessionEvent, { kind: 'hook.callback_requested' }> => e.kind === 'hook.callback_requested');
    expect(callbacks.length).toBe(answers.length);
    for (const c of callbacks) expect(c.input).not.toHaveProperty('last_assistant_message');
  });

  it('session-resume: a --resume holds the session unknown until its first Stop, which lists the resurrected session-only job', async () => {
    const rows = loadP5Journal('p5-o2-stop-crons-session-resume');
    const sessionId = (rows.find((r) => r.direction === 'in' && typeof (r.frame as { session_id?: unknown }).session_id === 'string')!.frame as { session_id: string }).session_id;
    const run = await replay('p5-o2-stop-crons-session-resume', { spec: { resume: { sessionId: sessionId as never, fork: false }, sessionId: null } });
    const minute = job('69d43fae', '* * * * *', '[[P5O2:FIRE]] session minute job');
    expect(run.works[0]).toEqual({ crons: [], unknown: 'resumed' }); // no cron record in this replay's store: unknown
    inOrder(run.works, [{ crons: [], unknown: 'resumed' }, { crons: [minute], unknown: null }]); // the fire's Stop (seq 19)
    const unread = run.statuses.filter((s) => s.process !== 'exited' && s.work?.unknown === 'resumed');
    expect(unread.length).toBeGreaterThan(0);
    for (const s of unread) expect(s.keepAlive).toContain('background_tasks'); // work: neither release takes it
  });
});

describe('the durable crons, replayed from the probe (P5 O2 M2, P5 Decision Log 46)', () => {
  // The file as the probe read it after the durable CronCreate (its `durable_file` row), in the recorded checkout
  const recorded = (name: string) => {
    const rows = loadP5Journal(name);
    const cwd = (metaOf(rows, 'spawn') as { cwd: string }).cwd;
    const file = metaOf(rows, 'durable_file') as { content: unknown };
    const sessionId = (rows.find((r) => r.direction === 'in' && typeof (r.frame as { session_id?: unknown }).session_id === 'string')!.frame as { session_id: string }).session_id;
    return { cwd, sessionId, tasksFile: (path: string) => (path === scheduledTasksPath(cwd) ? `${JSON.stringify(file.content, null, 2)}\n` : null) };
  };
  const MINUTE = job('efd35f19', '* * * * *', '[[P5O2:FIRE]] durable minute job');

  it('durable: the Stop after a durable CronCreate lists nothing, and the file read at it holds the session', async () => {
    const { tasksFile } = recorded('p5-o2-stop-crons-durable');
    const run = await replay('p5-o2-stop-crons-durable', { tasksFile });
    inOrder(run.works, [{ crons: [], unknown: 'dirty' }, { crons: [MINUTE], unknown: null }]); // the Stop (seq 40) listed []
    const held = run.statuses.filter((s) => s.process === 'ready' && s.work?.crons.length === 1);
    expect(held.length).toBeGreaterThan(0);
    for (const s of held) {
      expect(s.keepAlive).toContain('background_tasks');
      expect(isIdleRow(s, new Set())).toBe(false);
    }
  });

  it('durable-resume: the file read at the resume\'s launch holds the session before any Stop, and every Stop of the launch lists nothing', async () => {
    const { cwd, sessionId, tasksFile } = recorded('p5-o2-stop-crons-durable-resume');
    const run = await replay('p5-o2-stop-crons-durable-resume', { spec: { resume: { sessionId: sessionId as never, fork: false }, sessionId: null, cwd }, tasksFile });
    expect(run.works[0]).toEqual({ crons: [MINUTE], unknown: 'resumed' }); // read at the launch, before the fire (seq 9)
    inOrder(run.works, [{ crons: [MINUTE], unknown: 'resumed' }, { crons: [MINUTE], unknown: null }]); // the first Stop (seq 19) listed []
    expect(run.works.at(-1)).toEqual({ crons: [MINUTE], unknown: null });
    expect(run.statuses.filter((s) => s.process === 'ready').every((s) => !isIdleRow(s, new Set()))).toBe(true);
  });
});
