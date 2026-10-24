// A turn the phone's layout cases add to a recording, after its last turn and before the session ends: a marked answer
// whose working record holds tool calls with inputs far wider than a phone — a command, a path, a search — and a Bash
// result whose lines run as long, so a case can see each tool row stay one line, truncated, and its detail scroll in
// place rather than widen the page.
import type { Recording, Step } from 'desk-hub/fake-machine';
import type { JsonObject } from 'desk-hub/protocol';

export const LONG_PROMPT = 'Check the phone layout of the session view and tell me what you find.';
export const LONG_COMMAND =
  'pnpm --filter desk-web exec playwright test e2e/phone.spec.ts --project=phone-webkit --grep "@layout a session channel on the phone" --reporter=list --workers=1 --retries=0 --output=/private/tmp/claude-501/desk-phone-record/test-results';
export const LONG_PATH = '/Users/owner/Developer/GitHub/MAWS/.claude/worktrees/desk-phone-record/apps/desk-web/src/views/project/a-file-whose-name-is-far-wider-than-a-phone-screen.tsx';
export const LONG_OUTPUT_LINE = `  ✓ [phone-webkit] › e2e/phone.spec.ts:240:1 › @layout a session channel on the phone draws its session view at 390 and 320 px, nothing wider than the screen (4.2s) ${'·'.repeat(40)}`;
export const LONG_ANSWER = 'The phone draws the session view: the working record unfolds in place and each tool call is one line.';

/** The session's end on the recording's timeline: its presence going to no process. */
const endOf = (recording: Recording) => recording.steps.findIndex((s) => s.k === 'presence' && s.record === null);

export function withLongInputs(recording: Recording): Recording {
  const main = recording.rows.main;
  const lastRow = main.at(-1)!;
  const end = endOf(recording);
  const at = recording.steps[end].at - 1;
  const base = Date.parse(String(lastRow.timestamp)) + 60_000;
  let parent = lastRow.uuid;
  const envelope = (i: number) => {
    const uuid = `10a91e55-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const row = { uuid, parentUuid: parent, timestamp: new Date(base + i * 1000).toISOString(), sessionId: recording.session, isSidechain: false, userType: 'external', cwd: lastRow.cwd, version: lastRow.version, entrypoint: 'cli' };
    parent = uuid;
    return row;
  };
  const call = (i: number, id: string, name: string, input: JsonObject) => ({
    ...envelope(i),
    type: 'assistant',
    message: { id: `msg_long${i}`, role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
  });
  const result = (i: number, id: string, content: string, toolUseResult: JsonObject) => ({
    ...envelope(i),
    type: 'user',
    promptId: 'p-long',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] },
    toolUseResult,
  });
  const output = [LONG_OUTPUT_LINE, LONG_OUTPUT_LINE.replace('4.2s', '3.9s'), '', '  2 passed (12.1s)'].join('\n');
  const file = Array.from({ length: 12 }, (_, n) => `export const line${n + 1} = '${'a long line of a file, '.repeat(6)}';`).join('\n');
  const rows: JsonObject[] = [
    { ...envelope(1), type: 'user', origin: { kind: 'human' }, promptId: 'p-long', message: { role: 'user', content: LONG_PROMPT } },
    call(2, 'toolu_long_bash', 'Bash', { command: LONG_COMMAND, description: 'Run the phone layout cases in WebKit at both narrow widths with every long command, path and search pattern' }),
    result(3, 'toolu_long_bash', output, { stdout: output, stderr: '', interrupted: false, isImage: false, noOutputExpected: false }),
    call(4, 'toolu_long_read', 'Read', { file_path: LONG_PATH }),
    result(5, 'toolu_long_read', file, { type: 'text', file: { filePath: LONG_PATH, content: file, numLines: 12, startLine: 1, totalLines: 12 } }),
    call(6, 'toolu_long_grep', 'Grep', { pattern: 'data-testid="session-view"|data-testid="channel-events"|data-testid="working-record"', path: LONG_PATH, output_mode: 'content' }),
    result(7, 'toolu_long_grep', `${LONG_PATH}:12:      data-testid="session-view"`, { mode: 'content', numFiles: 1, filenames: [LONG_PATH], content: `${LONG_PATH}:12:      data-testid="session-view"`, numLines: 1 }),
    {
      ...envelope(8),
      type: 'assistant',
      message: { id: 'msg_long8', role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'text', text: `<message>${LONG_ANSWER}</message>` }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
    },
    { ...envelope(9), type: 'system', subtype: 'turn_duration', durationMs: 9000, isMeta: false },
  ];
  const steps: Step[] = rows.map((row) => ({ at, k: 'row', agentId: null, row: row as never }));
  return { ...recording, rows: { ...recording.rows, main: [...main, ...(rows as never[])] }, steps: [...recording.steps.slice(0, end), ...steps, ...recording.steps.slice(end)] };
}
