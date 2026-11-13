// The engine's `<task-notification>` blocks (SPEC 20.9), each a background task's notification, as the arrivals reader
// reads them (UX wave U3, UC-2, rules 3 and 6). Copied from the backfill's reader (`engine-host/fs/backfill.ts`,
// `parseTaskNotifications`) with UC-2's reading of the outcome: a block with no `<status>` reports no end (a monitor's
// event, the engine's notice that a command seems to wait for input, a check-in on a quiet command) and a status word
// the rule does not list claims none, where the backfill reads both as `completed`. Pure.

export interface TaskNotificationBlock {
  taskId: string | null;
  toolUseId: string | null;
  outcome: 'completed' | 'failed' | 'stopped' | null;
  summary: string; // the block's <summary>, else its first line
  durationMs: number | null; // the <duration_ms> an agent's and a workflow's <usage> carry
  outputFile: string | null;
  detail: string | null; // what came with it: the result, the note, the event's text, the lines after the block
}

const NOTIFICATION_OPENING = '<task-notification>';
const NOTIFICATION_BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const NOTIFICATION_PREAMBLE = '[SYSTEM NOTIFICATION - NOT USER INPUT]\n';

/**
 * The text of a carrier's notifications: a text that opens with a block, or, in a subagent's transcript, one the engine
 * marked as a notification (its origin's kind) that opens with the engine's preamble and has the blocks after a blank
 * line (DX4's reading rule: a person can type the preamble's words). Null for any other text.
 */
export function notificationText(text: string, originKind: unknown): string | null {
  if (text.trimStart().startsWith(NOTIFICATION_OPENING)) return text;
  if (originKind !== 'task-notification' || !text.startsWith(NOTIFICATION_PREAMBLE)) return null;
  const cut = text.indexOf(`\n\n${NOTIFICATION_OPENING}`);
  return cut < 0 ? null : text.slice(cut + 2);
}

/**
 * Each block of a notification text, in order (the engine joins the notifications it delivers at once into one carrier,
 * each block after a blank line: DX4's vectors, "several notifications in one row"). What follows a block up to the next
 * one is that block's own (the engine's advice after a check-in or a stall notice).
 */
export function taskNotificationBlocks(text: string): TaskNotificationBlock[] {
  const blocks = [...text.matchAll(NOTIFICATION_BLOCK)];
  return blocks.map((match, i) => {
    const end = match.index! + match[0].length;
    return readBlock(match[1]!, text.slice(end, blocks[i + 1]?.index ?? text.length).trim());
  });
}

// An agent's notification that says the agent was stopped (2.1.322's `Agent "<description>" was stopped`, with ` by
// Claude`, ` by user` or `: <error>` after it): the audit found two with no <status>, which read as stopped.
const AGENT_STOPPED = /^Agent "[\s\S]*" was stopped(?: by Claude| by user|: [\s\S]*)?$/;

function readBlock(inner: string, after: string): TaskNotificationBlock {
  const element = (name: string): string | null => {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(inner);
    return match === null ? null : match[1]!.trim();
  };
  const summary = element('summary') ?? firstLine(inner);
  const duration = element('duration_ms');
  const outputFile = element('output-file');
  const detail = [element('result'), element('note'), element('event'), after].filter((part): part is string => part !== null && part !== '').join('\n\n');
  return {
    taskId: element('task-id'),
    toolUseId: element('tool-use-id'),
    outcome: outcomeOf(element('status'), summary),
    summary,
    durationMs: duration !== null && /^\d+$/.test(duration) ? Number(duration) : null,
    outputFile: outputFile === null || outputFile === '' ? null : outputFile,
    detail: detail === '' ? null : detail,
  };
}

/** UC-2, rule 6: the outcome a block's `<status>` gives; no status reports no end, but for an agent the block says was stopped. */
function outcomeOf(status: string | null, summary: string): TaskNotificationBlock['outcome'] {
  if (status === null) return AGENT_STOPPED.test(summary) ? 'stopped' : null;
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'killed' || status === 'stopped' || status === 'cancelled' || status === 'interrupted') return 'stopped';
  return null;
}

/** A block's first line of text, for a block with no <summary> (the audit's 78, with no child tag at all). */
function firstLine(inner: string): string {
  return inner.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}
