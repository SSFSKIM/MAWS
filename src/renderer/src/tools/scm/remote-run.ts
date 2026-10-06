// The latest remote run of a session's checkout as the tool shows it (E6 execution document, Design §4 and §5): seeded
// from `scm.remote.last`, advanced by `scm.remote.output` events whose `seq` exceeds the last applied, and started
// with the plan the sheet confirmed. Pure; the store keeps one per session and decides which events reach it.
import type { RemotePlan, ScmRemoteLast, ScmRemoteOutput } from '@shared/ipc/schema/scm';

// Main's own cap (Design §4); the renderer keeps no more than main would send.
export const REMOTE_OUTPUT_CAP = 1024 * 1024;

export interface RemoteRun extends OutputLines {
  token: string;
  kind: 'push' | 'pr' | null; // null until the plan is known (events reached the store before `scm.push` answered)
  plan: RemotePlan | null;
  bytes: number; // UTF-8 bytes taken, up to REMOTE_OUTPUT_CAP
  seq: number; // the last event applied (0: none)
  exitCode: number | null;
  signal: string | null;
  running: boolean;
  truncated: boolean;
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

const encoder = new TextEncoder();

function withText(run: RemoteRun, text: string): RemoteRun {
  const room = REMOTE_OUTPUT_CAP - run.bytes;
  if (room <= 0) return text === '' ? run : { ...run, truncated: true };
  const fit = encoder.encodeInto(text, new Uint8Array(Math.min(room, text.length * 3)));
  const kept = fit.read < text.length ? text.slice(0, fit.read) : text;
  return { ...run, ...appendOutput(run, kept), bytes: run.bytes + fit.written, truncated: run.truncated || kept !== text };
}

export function runFromSnapshot(last: ScmRemoteLast): RemoteRun | null {
  if (last === null) return null;
  const run: RemoteRun = {
    token: last.token,
    kind: last.kind,
    plan: last.plan,
    lines: [],
    carriage: false,
    bytes: 0,
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
  return { token: plan.token, kind: plan.kind, plan, lines: [], carriage: false, bytes: 0, seq: 0, exitCode: null, signal: null, running: true, truncated: false };
}

// One live event of the session. The same run's applies when its `seq` is past the last applied. Another run's
// replaces the held one only when that one has ended: main runs one remote command per checkout at a time, so a token
// arriving while ours still runs is from an older run.
export function advanceRun(run: RemoteRun | null, event: ScmRemoteOutput): RemoteRun {
  let base = run;
  if (base === null || base.token !== event.token) {
    if (base !== null && base.running) return base;
    base = { token: event.token, kind: null, plan: null, lines: [], carriage: false, bytes: 0, seq: 0, exitCode: null, signal: null, running: true, truncated: false };
  } else if (event.seq <= base.seq) return base;
  let next: RemoteRun = { ...base, seq: event.seq };
  if (event.truncated) next = { ...next, truncated: true };
  if (event.kind === 'exit') return { ...next, running: false, exitCode: event.exitCode ?? null, signal: event.signal ?? null };
  return event.text ? withText(next, event.text) : next;
}
