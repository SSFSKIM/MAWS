// Settings and plugin hooks in the transcript (W1, A4; the owner's ruling of 2026-10-01 and Claude Desktop's pattern,
// `docs/doperpowers/evidence/ux-2026-10-01/r2-claude-desktop.txt` §6): a hook that ran and let things go on, or is
// still running, shows nothing, as the terminal shows nothing. Only a hook that got in the way is a row, a notice in
// Claude Desktop's words: a UserPromptSubmit hook that blocked the prompt ("A hook blocked your prompt", with Edit
// prompt), a Stop hook that sent Claude back to work ("Hook re-prompted Claude"), and otherwise a trouble line naming
// the hook (blocked, failed, cancelled).
//
// What blocks, on 2.1.283 (cli.pretty.js 919426-919470): exit code 2 (the wire's `hook_response` reads `outcome:
// "error"`, `exit_code: 2`, the reason on stderr), or JSON on stdout with `decision: "block"` or `continue: false` (the
// wire reads `outcome: "success"`; the reason is `reason`, or `stopReason`).
import type { SessionEvent } from '@shared/graph/events';
import { HOOK } from './copy';
import type { Row } from './rows';

type Event<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;
export type HookNotice = Pick<Extract<Row, { kind: 'error' }>, 'severity' | 'text' | 'action'>;

export interface HookRecord {
  started: Event<'hook.started'> | null;
  finished: Event<'hook.finished'> | null;
}

const REASON_MAX = 200;
const STOP_EVENTS = new Set(['Stop', 'SubagentStop']);

// The hook's JSON answer on stdout, when it printed one.
function jsonOf(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  if (!text.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const firstLine = (text: string): string | null => {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0)?.trim() ?? null;
  return line === null ? null : line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1)}…` : line;
};

// The notice a finished hook leaves, or null for one that ran and let things go on (and for one still running).
export function hookNotice(rec: HookRecord): HookNotice | null {
  const finished = rec.finished;
  if (finished === null) return null;
  const json = jsonOf(finished.stdout);
  const str = (value: unknown) => (typeof value === 'string' ? value : null);
  const blockedByJson = json !== null && (json.decision === 'block' || json.continue === false);
  const blocking = (finished.outcome === 'error' && finished.exitCode === 2) || (finished.outcome === 'success' && blockedByJson);
  if (blocking) {
    const reason = firstLine((blockedByJson ? (str(json!.reason) ?? str(json!.stopReason)) : null) ?? finished.stderr);
    if (finished.hookEvent === 'UserPromptSubmit') return { severity: 'notice', text: HOOK.blockedPrompt(reason), action: 'edit_prompt' };
    if (STOP_EVENTS.has(finished.hookEvent) && json?.continue !== false) return { severity: 'notice', text: HOOK.reprompted(reason) };
    return { severity: 'notice', text: HOOK.blocked(finished.hookName, reason) };
  }
  if (finished.outcome === 'cancelled') return { severity: 'notice', text: HOOK.cancelled(finished.hookName) };
  if (finished.outcome === 'error') return { severity: 'error', text: HOOK.failed(finished.hookName, finished.exitCode, firstLine(finished.stderr)) };
  return null;
}
