// A synthetic Claude Code transcript of any length (the long-transcript window's tests; docs/doperpowers/plans/
// 2026-10-30-long-transcript-window.md): turns of a prompt, the silent request record the engine writes per model call,
// a reply, its turn_duration and a file-history snapshot, in one parentUuid chain; optionally a compaction (the chain
// restarting at a compact_boundary) and a terminal /rewind (a prompt parented on an earlier turn's end). Synthetic
// content only: nothing here comes from a real transcript.
import type { SessionId } from '../../src/shared/graph/ids';

export const LONG_SESSION = '22222222-2222-4222-8222-222222222222' as SessionId;
export const LONG_DIR = '/work/long';
const PAD = 'x'.repeat(600); // each prompt and reply about 0.6 KB of event JSON

// One turn: a prompt parented on `parent`, a reply, and its turn_duration; the silent request record the engine writes
// per model call between them. Returns the lines and the turn's last uuid.
export function turnLines(n: number, parent: string | null, at: number): { lines: string[]; last: string } {
  const ts = new Date(Date.parse('2026-09-01T00:00:00.000Z') + at * 1000).toISOString();
  const base = { sessionId: LONG_SESSION, cwd: LONG_DIR, version: '2.1.312', isSidechain: false, userType: 'external', timestamp: ts };
  return {
    lines: [
      JSON.stringify({ ...base, type: 'user', uuid: `u${n}`, parentUuid: parent, message: { role: 'user', content: `prompt ${n} ${PAD}` } }),
      JSON.stringify({ type: 'api-request', sessionId: LONG_SESSION, id: `r${n}`, params: { body: PAD } }),
      JSON.stringify({ ...base, type: 'assistant', uuid: `a${n}`, parentUuid: `u${n}`, message: { id: `msg_${n}`, role: 'assistant', model: 'm', content: [{ type: 'text', text: `reply ${n} ${PAD}` }] } }),
      JSON.stringify({ ...base, type: 'system', subtype: 'turn_duration', uuid: `d${n}`, parentUuid: `a${n}`, durationMs: 1000 }),
      JSON.stringify({ type: 'file-history-snapshot', messageId: `u${n}`, snapshot: { messageId: `u${n}`, trackedFileBackups: {} }, isSnapshotUpdate: false }),
    ],
    last: `d${n}`,
  };
}

// `turns` turns in one chain; with `rewindTo`, a last prompt parented on that turn's end (a terminal /rewind's shape) and
// one more turn after it.
export function longTranscript(turns: number, options: { rewindTo?: number; compactAt?: number; cronAt?: number } = {}): string[] {
  const lines: string[] = [];
  let parent: string | null = null;
  for (let n = 1; n <= turns; n++) {
    if (n === options.compactAt) {
      const ts = new Date(Date.parse('2026-09-01T00:00:00.000Z') + n * 1000 - 500).toISOString();
      lines.push(JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: `c${n}`, parentUuid: null, logicalParentUuid: parent, sessionId: LONG_SESSION, cwd: LONG_DIR, timestamp: ts, compactMetadata: { trigger: 'auto', preTokens: 1000 } }));
      parent = `c${n}`;
    }
    const turn: { lines: string[]; last: string } = n === options.cronAt ? cronTurnLines(n, parent, n, { id: 'cron0001', cron: '0 3 * * *', prompt: 'nightly check' }) : turnLines(n, parent, n);
    lines.push(...turn.lines);
    parent = turn.last;
  }
  if (options.rewindTo !== undefined) {
    const rewound = turnLines(turns + 1, `d${options.rewindTo}`, turns + 1);
    lines.push(...rewound.lines);
    lines.push(...turnLines(turns + 2, rewound.last, turns + 2).lines);
  }
  return lines;
}


// One turn whose reply schedules a session-only job (a `CronCreate` and its result, the engine's wording), then
// answers: for the Scheduled section's whole-history read. Returns the lines and the turn's last uuid.
export function cronTurnLines(n: number, parent: string | null, at: number, job: { id: string; cron: string; prompt: string }): { lines: string[]; last: string } {
  const ts = new Date(Date.parse('2026-09-01T00:00:00.000Z') + at * 1000).toISOString();
  const base = { sessionId: LONG_SESSION, cwd: LONG_DIR, version: '2.1.312', isSidechain: false, userType: 'external', timestamp: ts };
  const use = `toolu_cron_${n}`;
  return {
    lines: [
      JSON.stringify({ ...base, type: 'user', uuid: `u${n}`, parentUuid: parent, message: { role: 'user', content: `prompt ${n} ${PAD}` } }),
      JSON.stringify({ ...base, type: 'assistant', uuid: `t${n}`, parentUuid: `u${n}`, message: { id: `msg_t${n}`, role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: use, name: 'CronCreate', input: { cron: job.cron, prompt: job.prompt, recurring: true } }] } }),
      JSON.stringify({ ...base, type: 'user', uuid: `r${n}`, parentUuid: `t${n}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: use, content: `Scheduled recurring job ${job.id} (Every day at 3:00 AM). Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days.` }] } }),
      JSON.stringify({ ...base, type: 'assistant', uuid: `a${n}`, parentUuid: `r${n}`, message: { id: `msg_${n}`, role: 'assistant', model: 'm', content: [{ type: 'text', text: `reply ${n} ${PAD}` }] } }),
      JSON.stringify({ ...base, type: 'system', subtype: 'turn_duration', uuid: `d${n}`, parentUuid: `a${n}`, durationMs: 1000 }),
    ],
    last: `d${n}`,
  };
}
