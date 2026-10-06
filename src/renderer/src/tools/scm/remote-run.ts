// The latest remote run of a session's checkout as the tool shows it (E6 execution document, Design §4 and §5): seeded
// from `scm.remote.last`, advanced by `scm.remote.output` events whose `seq` exceeds the last applied, and started
// with the plan the sheet confirmed. Pure; the store keeps one per session and decides which events reach it. The
// output is bounded by main (1 MiB per run, then one `truncated` chunk), whose own notes (a timeout, a program that
// could not start) come outside that budget, so the renderer keeps every chunk it is sent and shows `truncated` as main
// marks it.
import type { RemotePlan, ScmRemoteLast, ScmRemoteOutput } from '@shared/ipc/schema/scm';

export interface RemoteRun extends OutputLines {
  token: string;
  kind: 'push' | 'pr' | null; // null until the plan is known (events reached the store before `scm.push` answered)
  plan: RemotePlan | null;
  seq: number; // the last event applied (0: none)
  exitCode: number | null;
  signal: string | null;
  running: boolean;
  truncated: boolean; // main dropped output past its cap
}

// Output as display lines. git writes progress with carriage returns (`Writing objects: 33%\r…66%\r…100%, done.`): the
// text after one replaces the line, as a terminal shows it, so `carriage` remembers a return the next text has yet to
// follow (the last state of a progress line stays shown until then).
export interface OutputLines {
  lines: string[]; // both streams as they arrived; the last entry is the open line ('' after a newline)
  carriage: boolean;
}

export function appendOutput(output: OutputLines, text: string): OutputLines {
  const lines = output.lines.length === 0 ? [''] : [...output.lines];
  let carriage = output.carriage;
  text.split('\n').forEach((segment, i) => {
    if (i > 0) {
      lines.push('');
      carriage = false;
    }
    segment.split('\r').forEach((part, j) => {
      if (j > 0) carriage = true;
      if (part === '') return;
      lines[lines.length - 1] = carriage ? part : lines[lines.length - 1] + part;
      carriage = false;
    });
  });
  return { lines, carriage };
}

const withText = (run: RemoteRun, text: string): RemoteRun => ({ ...run, ...appendOutput(run, text) });

export function runFromSnapshot(last: ScmRemoteLast): RemoteRun | null {
  if (last === null) return null;
  const run: RemoteRun = {
    token: last.token,
    kind: last.kind,
    plan: last.plan,
    lines: [],
    carriage: false,
    seq: last.seq,
    exitCode: last.exitCode,
    signal: last.signal,
    running: last.running,
    truncated: last.truncated,
  };
  return withText(run, last.output);
}

// `scm.push`/`scm.pr.create` answered `started` for the plan: the run it names, its plan filled in when its first
// events came first.
export function runStarted(run: RemoteRun | null, plan: RemotePlan): RemoteRun {
  if (run?.token === plan.token) return { ...run, plan, kind: plan.kind };
  return { token: plan.token, kind: plan.kind, plan, lines: [], carriage: false, seq: 0, exitCode: null, signal: null, running: true, truncated: false };
}

// One live event of the session. The same run's applies when its `seq` is past the last applied. Another run's
// replaces the held one only when that one has ended: main runs one remote command per checkout at a time, so a token
// arriving while ours still runs is from an older run.
export function advanceRun(run: RemoteRun | null, event: ScmRemoteOutput): RemoteRun {
  let base = run;
  if (base === null || base.token !== event.token) {
    if (base !== null && base.running) return base;
    base = { token: event.token, kind: null, plan: null, lines: [], carriage: false, seq: 0, exitCode: null, signal: null, running: true, truncated: false };
  } else if (event.seq <= base.seq) return base;
  const next: RemoteRun = { ...base, seq: event.seq, truncated: base.truncated || event.truncated === true };
  if (event.kind === 'exit') return { ...next, running: false, exitCode: event.exitCode ?? null, signal: event.signal ?? null };
  return event.text ? withText(next, event.text) : next;
}
