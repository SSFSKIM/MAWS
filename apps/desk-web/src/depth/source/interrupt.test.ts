// An interrupted turn ends at the engine's marker row (DC9 M5, the composite's writer's addition): MAWS's backfill keeps
// a turn open past `[Request interrupted by user]` (its live path ends it from the SDK result, which the desk never
// receives), so the desk's mapping ends it there, with an id derived from the marker row, so a reset, a rebuild and an
// older page replay it alike. Only the row the engine (or the bridge's interrupt) writes ends a turn: a typed prompt or
// a steer carrying the same words never does. A `turn_duration` after the marker ends nothing twice. The bridge's record
// of an interrupt that stopped backgrounded Bash calls carries its "Task …" lines after the marker; it is read as the
// marker alone, so it ends the turn and draws no prompt.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { freshSource, subagentLookupOf } from './desk-transcript';

const SESSION = 'sess-1';
let n = 0;
const at = (second: number) => `2026-10-17T10:00:${String(second).padStart(2, '0')}.000Z`;
const envelope = (second: number) => ({ uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, parentUuid: null, timestamp: at(second), sessionId: SESSION, isSidechain: false, userType: 'external', cwd: '/work', version: '2.1.300' });
const prompt = (text: string, second = 0): JsonObject => ({ ...envelope(second), type: 'user', origin: { kind: 'human' }, promptId: 'p1', message: { role: 'user', content: text } });
const assistant = (content: JsonObject[], second: number): JsonObject => ({ ...envelope(second), type: 'assistant', message: { id: `msg_${n}`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content, stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
/** A turn's work: a Bash call, its result, then text (a turn with work draws MAWS's divider). */
function answer(text: string, second: number): JsonObject[] {
  const id = `toolu_${String(n + 1).padStart(6, '0')}`;
  const call = assistant([{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls', description: 'List files' } }], second);
  const result = { ...envelope(second), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'a.txt', is_error: false }] }, toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false, isImage: false } };
  return [call, result, assistant([{ type: 'text', text }], second)];
}
/** The engine's marker row as 2.1.300 writes it (shape from local transcripts, scrubbed): a text block, no origin. */
const marker = (text: string, second: number, extra: Record<string, unknown> = {}): JsonObject => ({
  ...envelope(second), type: 'user', entrypoint: 'cli', promptId: 'p1', interruptedMessageId: 'msg_011interrupted', message: { role: 'user', content: [{ type: 'text', text }] }, ...extra,
});
/** A row the bridge appends (`$.session.append`) as the engine stores it (2.1.300 `cli.pretty.js:1462`): a user-role meta
 * row of text blocks, its origin the plugin's. The bridge's interrupt record and its steers both have this shape. */
const appended = (text: string, second: number, extra: Record<string, unknown> = {}): JsonObject => ({
  ...envelope(second), type: 'user', isMeta: true, origin: { kind: 'plugin', name: 'doperpowers' }, message: { role: 'user', content: [{ type: 'text', text }] }, ...extra,
});
const STOPPED = (task: string) => `Task ${task}, the Bash command the interrupt moved to the background, was then stopped: it is not running, and no notification will come for it.`;
const RUNNING = (task: string) => `Task ${task}, the Bash command the interrupt moved to the background, could not be stopped: it may still be running.`;
const turnDuration = (second: number): JsonObject => ({ ...envelope(second), type: 'system', subtype: 'turn_duration', durationMs: 5000, isMeta: false });

async function rowsOf(rows: JsonObject[]): Promise<{ rows: Row[]; turns: { state: string; ended: unknown }[] }> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
  const entry = store.getState().entries.fresh;
  return { rows: entry.rows, turns: entry.state.order.map((id) => entry.state.turns.get(id)!) };
}
const dividers = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'divider' ? [row.state] : []));

/** The Bash call an interrupt moved to the background: its call, its result written only after the interrupt's rows. */
const BG = 'toolu_bg000001';
const pendingCall = (second: number) => assistant([{ type: 'tool_use', id: BG, name: 'Bash', input: { command: 'sleep 600', description: 'Wait' } }], second);
const backgroundedResult = (second: number): JsonObject => ({
  ...envelope(second), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: BG, content: 'Command was manually backgrounded by user with ID: bk3x9a1. Output is being written to: /private/tmp/claude-501/-work/sess-1/tasks/bk3x9a1.output', is_error: false }] }, toolUseResult: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: 'bk3x9a1' },
});

describe('an interrupted turn', () => {
  it('reads working while the session has written no end', async () => {
    const { rows } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2)]);
    expect(dividers(rows)).toEqual(['working']);
  });

  it('ends at the engine’s marker, read as stopped, for both of its forms', async () => {
    for (const text of ['[Request interrupted by user]', '[Request interrupted by user for tool use]']) {
      const { rows, turns } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2), marker(text, 5)]);
      expect(dividers(rows), text).toEqual(['stopped']);
      expect(turns).toHaveLength(1);
      expect(turns[0].state).toBe('closed');
    }
  });

  it('ends at the bridge’s interrupt row, from the desk or from outside the terminal', async () => {
    for (const text of ['[Request interrupted by user from the desk]', '[Request interrupted by user from outside the terminal]']) {
      const { rows } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2), appended(text, 5)]);
      expect(dividers(rows), text).toEqual(['stopped']);
    }
  });

  it('ends at the bridge’s interrupt row that names the Bash calls it stopped, and draws no prompt for it', async () => {
    const text = ['[Request interrupted by user from the desk]', STOPPED('bk3x9a1'), RUNNING('b_7-q')].join('\n');
    const { rows, turns } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2), appended(text, 5)]);
    expect(dividers(rows)).toEqual(['stopped']);
    expect(turns).toHaveLength(1);
    expect(rows.filter((row) => row.kind === 'user')).toHaveLength(1); // the essay's prompt alone
    expect((turns[0].ended as { id: string }).id).toMatch(/#interrupt-end$/);
  });

  it('is ended once: a turn_duration after the marker neither ends it again nor ends another turn', async () => {
    const { rows, turns } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2), marker('[Request interrupted by user]', 5), turnDuration(6)]);
    expect(turns).toHaveLength(1);
    expect(dividers(rows)).toEqual(['stopped']);
    expect((turns[0].ended as { id: string }).id).toMatch(/#interrupt-end$/);
  });

  it('takes its duration from the turn’s start to the marker', async () => {
    const { rows } = await rowsOf([prompt('Write a long essay', 0), ...answer('Once upon', 2), marker('[Request interrupted by user]', 7)]);
    const divider = rows.find((row) => row.kind === 'divider') as Extract<Row, { kind: 'divider' }>;
    expect(divider.summary.durationMs).toBe(7000);
  });

  it('leaves the next prompt its own turn', async () => {
    const { turns, rows } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2), marker('[Request interrupted by user]', 5), prompt('Shorter, please', 9), ...answer('Fine.', 10)]);
    expect(turns.map((t) => t.state)).toEqual(['closed', 'open']);
    expect(dividers(rows)).toEqual(['stopped', 'working']);
  });

  it('ends at the bridge’s two rows (doperpowers #225): the marker, then its note; neither draws a bubble', async () => {
    for (const note of ['The interrupt came from the desk.', ['The interrupt came from outside the terminal.', STOPPED('bk3x9a1'), RUNNING('b_7-q')].join('\n')]) {
      const { rows, turns } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2), pendingCall(3), appended('[Request interrupted by user]', 5), appended(note, 5), backgroundedResult(6)]);
      expect(dividers(rows), note).toEqual(['stopped']);
      expect(turns).toHaveLength(1);
      expect((turns[0].ended as { id: string }).id).toMatch(/#interrupt-end$/);
      expect(rows.filter((row) => row.kind === 'user')).toHaveLength(1); // the essay's prompt alone
      expect(JSON.stringify(rows)).not.toContain('The interrupt came from');
    }
  });

  it('accepts a residual: a steer through a plugin older than #225 whose whole text is a marker ends the turn', async () => {
    // The bridge's steers are the same meta rows as its interrupt records; #225's steer refuses these texts, an older
    // plugin's does not, so the human's words are read as the interrupt they spell (the composite's writer's ruling).
    for (const text of ['[Request interrupted by user]', '[Request interrupted by user from the desk]']) {
      const { rows } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2), appended(text, 5)]);
      expect(dividers(rows), text).toEqual(['stopped']);
    }
  });

  it('is never ended by a typed prompt or a steer carrying the marker’s words', async () => {
    const steer = appended; // the bridge's steer row: its interrupt record's shape, the human's words as its text
    const bridgeLines = ['[Request interrupted by user from the desk]', STOPPED('bk3x9a1')].join('\n');
    for (const row of [
      prompt(bridgeLines, 5), // a typed prompt carrying the bridge's lines
      marker(bridgeLines, 5), // the bridge's lines on a row without its origin
      appended(`${bridgeLines}\nand then carry on`, 5), // the bridge's lines and one that is not its
      appended(['[Request interrupted by user from the desk]', 'Task bk3x9a1, the Bash command was stopped.'].join('\n'), 5), // a task line not the bridge's
      appended(bridgeLines, 5, { origin: { kind: 'plugin', name: 'another' } }), // another plugin's row
      appended('The interrupt came from the desk.', 5), // the new bridge's note alone, with no marker before it
      prompt('[Request interrupted by user] please continue', 5), // a typed prompt with the prefix
      { ...prompt('[Request interrupted by user]', 5) }, // typed whole: a person's prompt, whatever its words
      steer('[Request interrupted by user] then carry on', 5), // a steer row with the prefix
      steer('[sminos chat proj hub/abc:7 from human → @you] [Request interrupted by user]', 5), // a delivery frame
      marker('[Request interrupted by user]', 5, { isMeta: true }),
      marker('[Request interrupted by user]\nand more', 5),
    ]) {
      const { turns } = await rowsOf([prompt('Write a long essay'), ...answer('Once upon', 2), row]);
      const last = turns.at(-1)!;
      expect(last.state === 'closed' && (last.ended as { id?: string } | null)?.id?.endsWith('#interrupt-end'), JSON.stringify(row.message)).toBe(false);
    }
  });
});
