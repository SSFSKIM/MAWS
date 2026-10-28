// P2-D (the P2 spec, child P2-D, G4): the resume chooser's preview read over real engine transcripts
// (test/fixtures/transcripts/, recorded on the engine) and small synthesised ones for the edges.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECENT_TURN_ANSWER_MAX, RECENT_TURN_PROMPT_MAX, RecentTurnsSchema } from '@shared/ipc/schema/session';
import { NO_TURNS, readRecentTurns, recentTurnsOf } from './recent-turns';
import { linkedReadBlock } from '@shared/maws/linked-read'; // P4-A3

const ROOT = join(__dirname, '../../..');
const fixture = (name: string) => join(ROOT, 'test/fixtures/transcripts', `${name}.jsonl`);
const text = (name: string) => readFileSync(fixture(name), 'utf8');
const brief = (name: string, limit = 20) =>
  recentTurnsOf(text(name), limit, false).turns.map((t) => ({ prompt: t.prompt?.text ?? null, answer: t.answer?.text ?? null, tools: t.toolCalls }));

// A minimal chain: user, assistant, user, assistant…, each record's parent the one before.
function chain(entries: { type: 'user' | 'assistant'; content: unknown }[], from: string | null = null): string {
  let parent = from;
  return entries
    .map((entry, i) => {
      const uuid = `u-${i}-${entry.type}`;
      const record = { type: entry.type, uuid, parentUuid: parent, sessionId: 's-1', timestamp: `2026-10-09T10:00:${String(i).padStart(2, '0')}.000Z`, message: { role: entry.type, content: entry.content } };
      parent = uuid;
      return JSON.stringify(record);
    })
    .join('\n');
}

// The fixture's lines `from` to `to` (1-based, inclusive): a window into a recorded transcript.
const lines = (name: string, from: number, to?: number) => text(name).split('\n').slice(from - 1, to).join('\n');
const prompts = (answer: { turns: { prompt: { text: string } | null }[] }) => answer.turns.map((t) => t.prompt?.text ?? null);
// One record per line with explicit uuids and parents (progress rows, bash pairs).
const records = (...rows: Record<string, unknown>[]) =>
  rows.map((row, i) => JSON.stringify({ sessionId: 's-1', timestamp: `2026-10-09T11:00:${String(i).padStart(2, '0')}.000Z`, ...row })).join('\n');
const user = (uuid: string, parentUuid: string | null, content: unknown) => ({ type: 'user', uuid, parentUuid, message: { role: 'user', content } });
const assistant = (uuid: string, parentUuid: string, content: unknown[]) => ({ type: 'assistant', uuid, parentUuid, message: { role: 'assistant', content } });
const progress = (uuid: string, parentUuid: string) => ({ type: 'progress', uuid, parentUuid, data: { type: 'hook_progress' } });

describe('recentTurnsOf', () => {
  it.each([false, true])('l2-transcript-15: retains the full prompt preview with legacy or explicit human provenance (explicit: %s)', (explicit) => {
    const prompt = { ...user('p1', null, 'Explain the stopped turn'), ...(explicit && { origin: { kind: 'human' } }) };
    const answer = recentTurnsOf(records(prompt, assistant('a1', 'p1', [{ type: 'text', text: 'The turn was stopped.' }])), 5, false);
    expect(answer).toEqual({
      turns: [{ prompt: { text: 'Explain the stopped turn', at: '2026-10-09T11:00:00.000Z' }, answer: { text: 'The turn was stopped.', at: '2026-10-09T11:00:01.000Z' }, toolCalls: 0 }],
      earlier: false, source: 'transcript',
    });
  });

  it('reads a prompt as the human wrote it: a linked read sent with it is not its words (P4-A3)', () => {
    const id = '4c85e0e6-8cf5-4f06-a7eb-90a3e66fd806';
    const read = JSON.stringify({ status: 'read', artifactId: id, kind: 'document', title: 'Plan', revision: 3, markdown: 'x ^p1\n' }, null, 2);
    const words = `Fix [the plan](maws-artifact:${id}).`;
    const answer = recentTurnsOf(records(user('u1', null, [{ type: 'text', text: words }, { type: 'text', text: linkedReadBlock(read) }]), assistant('a1', 'u1', [{ type: 'text', text: 'Done.' }])), 20, false);
    expect(prompts(answer)).toEqual([words]);
  });
  it('one turn per human prompt, its last answer and its tool calls (a steer the engine took folds into its turn)', () => {
    expect(brief('w1-steer-next-disk')).toEqual([{ prompt: expect.stringMatching(/^Count to 8 with separate Bash sleep 1 calls/), answer: 'COUNTED', tools: 8 }]);
  });

  it('keeps the current chain: a rewound branch drops out', () => {
    expect(brief('rewind-real')).toEqual([
      { prompt: 'Remember the word APPLE. Reply OK.', answer: 'OK', tools: 0 },
      { prompt: expect.stringMatching(/^List every word I asked you to remember/), answer: 'APPLE', tools: 0 },
    ]);
  });

  it('reads a slash command as typed and says history precedes a compaction boundary', () => {
    const answer = recentTurnsOf(text('w1-compact'), 20, false);
    expect(answer.turns.map((t) => t.prompt?.text)).toEqual(['/compact', 'Reply TWO']);
    expect(answer.earlier).toBe(true);
  });

  it('an engine-initiated turn (a task notification) shows its answer with no prompt', () => {
    const turns = brief('subagent-parent');
    expect(turns[0]).toMatchObject({ prompt: expect.stringMatching(/^Dispatch two general-purpose Agent subagents/), tools: 2 });
    expect(turns.slice(1).map((t) => t.prompt)).toEqual([null, null]);
    expect(turns.at(-1)?.answer).toMatch(/^Both agents finished/);
  });

  it('the last `limit` turns, oldest first, and `earlier` when more precede them', () => {
    const all = recentTurnsOf(text('torn-tail'), 20, false);
    const two = recentTurnsOf(text('torn-tail'), 2, false);
    expect(two.turns).toEqual(all.turns.slice(-2));
    expect(all.earlier).toBe(false);
    expect(two.earlier).toBe(true);
  });

  it('a window cut mid-file whose chain does not reach a root has earlier turns', () => {
    const tail = chain([{ type: 'user', content: 'later' }, { type: 'assistant', content: [{ type: 'text', text: 'done' }] }], 'u-missing');
    expect(recentTurnsOf(tail, 5, true)).toEqual({ turns: [{ prompt: { text: 'later', at: '2026-10-09T10:00:00.000Z' }, answer: { text: 'done', at: '2026-10-09T10:00:01.000Z' }, toolCalls: 0 }], earlier: true, source: 'transcript' });
    expect(recentTurnsOf(chain([{ type: 'user', content: 'first' }]), 5, true).earlier, 'a chain rooted in the window').toBe(false);
  });

  it('the answer is owner-aware (no raw marks) and the prompt capped; an image-only prompt reads [Image]', () => {
    const answer = recentTurnsOf(
      chain([
        { type: 'user', content: 'x'.repeat(RECENT_TURN_PROMPT_MAX + 50) },
        { type: 'assistant', content: [{ type: 'text', text: 'Working notes\n<to-human>\nThe build is green.\n</to-human>' }] },
        { type: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }] },
      ]),
      5,
      false,
    );
    expect(answer.turns[0].prompt?.text).toHaveLength(RECENT_TURN_PROMPT_MAX);
    expect(answer.turns[0].answer?.text).toBe('The build is green.');
    expect(answer.turns[1].prompt?.text).toBe('[Image]');
    expect(RecentTurnsSchema.safeParse(answer).success).toBe(true);
  });

  it('a rewind anchor cuts the chain at once: the discarded turn is gone before the next prompt arrives', () => {
    // rewind-real.jsonl through the anchor's queue operations (line 29): the BANANA turn was rewound, nothing sent since
    expect(recentTurnsOf(lines('rewind-real', 1, 29), 20, false).turns.map((t) => [t.prompt?.text, t.answer?.text])).toEqual([['Remember the word APPLE. Reply OK.', 'OK']]);
    // the anchor's target lies before the window: nothing on the kept chain is proven, and never the discarded branch
    expect(recentTurnsOf(lines('rewind-real', 25, 29), 20, true)).toEqual({ turns: [], earlier: true, source: 'transcript' });
    // a prompt after the anchor is the leaf again, even when the anchor's target lies before the window
    const after = recentTurnsOf(lines('rewind-real', 25, 33), 20, true);
    expect(prompts(after)).toEqual([expect.stringMatching(/^List every word I asked you to remember/)]);
    expect(after.earlier).toBe(true);
  });

  it('a progress row is never the leaf: one written last, pointing at an earlier prompt, keeps the later turns', () => {
    const answer = recentTurnsOf(
      records(
        user('p1', null, 'first'),
        assistant('a1', 'p1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
        progress('g1', 'a1'),
        user('r1', 'g1', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }]), // walks through the progress row
        assistant('a1b', 'r1', [{ type: 'text', text: 'listed' }]),
        user('p2', 'a1b', 'second'),
        assistant('a2', 'p2', [{ type: 'text', text: 'done' }]),
        progress('g2', 'p1'),
      ),
      5,
      false,
    );
    expect(answer.turns.map((t) => [t.prompt?.text, t.answer?.text, t.toolCalls])).toEqual([['first', 'listed', 1], ['second', 'done', 0]]);
  });

  it('a progress row parented on itself (a malformed transcript) neither hangs the read nor loses the turns after it', () => {
    const answer = recentTurnsOf(
      records(
        user('p1', null, 'first'),
        assistant('a1', 'p1', [{ type: 'text', text: 'one' }]),
        { type: 'progress', uuid: 'g', parentUuid: 'g', data: { type: 'hook_progress' } },
        user('p2', 'g', 'second'),
        assistant('a2', 'p2', [{ type: 'text', text: 'two' }]),
      ),
      5,
      false,
    );
    expect(answer.turns.map((t) => [t.prompt?.text, t.answer?.text])).toEqual([['second', 'two']]);
  });

  it('a command’s output is never a prompt: a window starting after /compact shows no <local-command-stdout>', () => {
    const answer = recentTurnsOf(lines('w1-compact', 32), 20, true);
    expect(prompts(answer)).toEqual(['Reply TWO']);
    expect(answer.earlier).toBe(true);
    expect(prompts(recentTurnsOf(lines('w1-compact', 30), 20, true)), 'the caveat and the output fold into the command').toEqual(['/compact', 'Reply TWO']);
  });

  it('a bash input and its output are one prompt `! <command>`; the output alone is none', () => {
    const output = user('o1', 'b1', '<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr><bash-exit-code>0</bash-exit-code>');
    expect(recentTurnsOf(records(user('b1', null, '<bash-input>ls</bash-input>'), output), 5, false).turns.map((t) => [t.prompt?.text, t.answer, t.toolCalls])).toEqual([['! ls', null, 0]]);
    expect(recentTurnsOf(records(output), 5, true).turns).toEqual([]);
  });

  // test/fixtures/transcript-parallel-tool-group.jsonl, the chain follower's FX6 fixture: two parallel responses (m1 with
  // two tool calls, m3 with three), each result parented on the block that issued its tool
  const PARALLEL = readFileSync(join(ROOT, 'test/fixtures/transcript-parallel-tool-group.jsonl'), 'utf8');
  const parallelLines = PARALLEL.split('\n').filter(Boolean);

  it('keeps a parallel response whole: all five tool calls and the answer, as the chain follower does', () => {
    expect(recentTurnsOf(PARALLEL, 5, false).turns.map((t) => [t.prompt?.text, t.answer?.text, t.toolCalls])).toEqual([['Run independent checks.', 'All checks completed.', 5]]);
  });

  it('a fork or a rewind from the middle of a response recovers nothing of it', () => {
    const shown = (text: string) => recentTurnsOf(text, 5, false).turns.map((t) => [t.prompt?.text ?? null, t.toolCalls]);
    // a second writer's prompt parented on the response's first block: a real branch (the follower's W7 case)
    const fork = JSON.stringify({ type: 'user', uuid: 'foreign', parentUuid: 'a1', message: { role: 'user', content: 'A second writer prompt.' } });
    expect(shown([...parallelLines.slice(0, 6), fork].join('\n'))).toEqual([['Run independent checks.', 1], ['A second writer prompt.', 0]]);
    // a rewind anchor naming the first block: the rest of the response is cut
    const rewind = JSON.stringify({ type: 'last-prompt', lastPrompt: 'again', leafUuid: 'a1', rewound: true });
    expect(shown([...parallelLines.slice(0, 6), rewind].join('\n'))).toEqual([['Run independent checks.', 1]]);
  });

  it('a prompt or another response written inside a response, on one of its blocks, is never part of it', () => {
    // between rA and rB, parented on a1: the follower forks to it and back; it never adopts the foreign record
    for (const shape of [{ type: 'user', message: { role: 'user', content: 'A second writer prompt.' } }, { type: 'assistant', message: { role: 'assistant', id: 'different-response', content: [{ type: 'text', text: 'Another response.' }] } }]) {
      const foreign = JSON.stringify({ ...shape, uuid: 'foreign', parentUuid: 'a1' });
      const text = [...parallelLines.slice(0, 5), foreign, ...parallelLines.slice(5)].join('\n');
      expect(recentTurnsOf(text, 5, false).turns.map((t) => [t.prompt?.text, t.answer?.text, t.toolCalls]), shape.type).toEqual([['Run independent checks.', 'All checks completed.', 5]]);
    }
  });

  // P4-R7: a message the model sent through a message tool is the turn's message, read where its call sits, once the
  // tool accepted it; a refused call is a tool call the turn made, as the transcript draws it.
  describe('a message tool’s call', () => {
    const SENT = [{ type: 'text', text: 'sent' }];
    const call = (id: string, text: string, name = 'mcp__maws__message') => [{ type: 'tool_use', id, name, input: { text } }];
    const resultOf = (id: string, content: unknown = SENT, isError = false) => [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }];
    const turnOf = (...rows: Record<string, unknown>[]) => recentTurnsOf(records(...rows), 5, false).turns.map((t) => [t.answer?.text ?? null, t.toolCalls]);
    // a status before the next command, sent in the same response as that command
    const stages = (outcome: unknown[], name?: string) => [
      user('p1', null, 'Run the stages'),
      assistant('a1', 'p1', [{ type: 'text', text: 'Looking first.' }]),
      assistant('a2', 'a1', call('toolu_m', 'Stage 1 is done.\nMoving on.', name)),
      user('r2', 'a2', outcome),
      assistant('a3', 'r2', [{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'sh stage.sh 2' } }]),
      user('r3', 'a3', resultOf('toolu_b', 'ok')),
    ];

    it('accepted, it is the turn’s answer, at the call’s time, and no tool call', () => {
      const answer = recentTurnsOf(records(...stages(resultOf('toolu_m'))), 5, false);
      expect(answer.turns[0]).toMatchObject({ answer: { text: 'Stage 1 is done.', at: '2026-10-09T11:00:02.000Z' }, toolCalls: 1 });
    });

    // P4-R7z (the P4 spec's Decision Log 92): the to-human plugin's tool, the one a MAWS session messages through.
    it('a call of the to-human plugin’s message tool, accepted, is one of the turn’s tool calls and no answer', () => {
      expect(turnOf(...stages(resultOf('toolu_m'), 'mcp__to-human__message'))).toEqual([['Stage 1 is done.', 1]]);
    });

    it('a span written after it is the newer answer', () => {
      expect(turnOf(...stages(resultOf('toolu_m')), assistant('a4', 'r3', [{ type: 'text', text: '<message>All stages ran.</message>' }]))).toEqual([['All stages ran.', 1]]);
    });

    it('refused, it is one of the turn’s tool calls and the answer stays the text before it', () => {
      expect(turnOf(...stages(resultOf('toolu_m', 'MCP error: the server went away', true)))).toEqual([['Looking first.', 2]]);
    });

    // A call whose turn closed without its result sent nothing: the transcript draws the engine's cell, its divider
    // counting it. Still pending at the window's end, its turn may still be running, so it is not counted yet.
    it('its turn closed without a result, at the next prompt or the turn’s end, it is one of the turn’s tool calls and no answer', () => {
      const asked = [user('p1', null, 'Run the stages'), assistant('a1', 'p1', call('toolu_m', 'Stage 1 is done.'))];
      expect(turnOf(...asked, user('p2', 'a1', 'Go on'))).toEqual([[null, 1], [null, 0]]);
      expect(turnOf(...asked, { type: 'system', subtype: 'turn_duration', durationMs: 1200, uuid: 'd1', parentUuid: 'a1' })).toEqual([[null, 1]]);
      expect(turnOf(...asked)).toEqual([[null, 0]]);
    });

    it('a promptless turn holding only such a call is shown, its tool call counted', () => {
      // a window cut inside a turn: its prompt lies before the window
      const answer = recentTurnsOf(records(assistant('a1', 'before', call('toolu_m', 'Stage 1 is done.')), user('p2', 'a1', 'Go on')), 5, true);
      expect(answer.turns).toEqual([{ prompt: null, answer: null, toolCalls: 1 }, { prompt: { text: 'Go on', at: '2026-10-09T11:00:01.000Z' }, answer: null, toolCalls: 0 }]);
    });

    // spikes/protocol-probe/fixtures/p4/p4-r7-tool-stages.jsonl: the transcript as the engine wrote it (its meta row
    // `disk`, user and assistant records with their blocks; a record whose parent the probe left out is chained to the
    // one before it), each status's result written before the next command of the same response
    it('over the recorded transcript: four commands, the final span the answer', () => {
      const journal = readFileSync(join(ROOT, 'spikes/protocol-probe/fixtures/p4/p4-r7-tool-stages.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { direction: string; frame: { event?: string; records?: { type: string; uuid: string; parentUuid: string | null; messageId: string | null; blocks: unknown[] }[] } });
      const disk = journal.find((row) => row.direction === 'meta' && row.frame.event === 'disk')!.frame.records!;
      const kept = new Set(disk.map((record) => record.uuid));
      const text = records(...disk.map((record, i) => ({
        type: record.type, uuid: record.uuid, parentUuid: record.parentUuid === null || kept.has(record.parentUuid) ? record.parentUuid : disk[i - 1].uuid,
        message: { role: record.type, ...(record.messageId !== null && { id: record.messageId }), content: record.blocks },
      })));
      const [turn] = recentTurnsOf(text, 5, false).turns;
      expect(turn.prompt?.text).toMatch(/^Run the four stages of the pipeline one at a time/);
      expect(turn.answer?.text).toBe('Stage 4 of 4 is done, so the whole pipeline has run. It wrote `out/labels.csv` with 1,240 rows.'.slice(0, RECENT_TURN_ANSWER_MAX));
      expect(turn.toolCalls).toBe(4);
      // the same window cut before the final span: the last status sent is the answer
      expect(recentTurnsOf(text.split('\n').slice(0, -1).join('\n'), 5, false).turns[0]).toMatchObject({ answer: { text: expect.stringMatching(/^Stage 3 of 4 is done\. The classifier is trained\./) }, toolCalls: 4 });
    });

    // test/fixtures/transcript-to-human-final.jsonl: the turn ends on an accepted final call of the plugin's tool, then
    // the plugin's made-up answer, which said nothing and is no answer: the final message is.
    it('the to-human plugin’s answer after a final message is no answer of its turn: the message is', () => {
      const turn = readFileSync(join(ROOT, 'test/fixtures/transcript-to-human-final.jsonl'), 'utf8');
      const answers = (text: string) => recentTurnsOf(text, 5, false).turns.map((t) => [t.prompt?.text ?? null, t.answer?.text ?? null, t.toolCalls]);
      expect(answers(turn)).toEqual([['Run the stages and tell me how it went.', 'Both stages ran; 37 labels are missing.', 1]]);
    });
  });

  it('an empty or unparsable text has no turns', () => {
    expect(recentTurnsOf('', 5, false)).toEqual({ turns: [], earlier: false, source: 'transcript' });
    expect(recentTurnsOf('{"type":"user", torn', 5, true).turns).toEqual([]);
  });
});

describe('readRecentTurns', () => {
  it('no path or no file answers none', async () => {
    expect(await readRecentTurns(null, 5)).toEqual(NO_TURNS);
    expect(await readRecentTurns(join(tmpdir(), 'maws-no-such-transcript.jsonl'), 5)).toEqual(NO_TURNS);
  });

  it('a last record larger than the window (a prompt with an image) still says the conversation has earlier messages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-recent-'));
    const path = join(dir, 't.jsonl');
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(300 * 1024) } };
    writeFileSync(path, `${chain([{ type: 'user', content: 'first' }, { type: 'assistant', content: [{ type: 'text', text: 'done' }] }, { type: 'user', content: [image] }])}\n`);
    expect(await readRecentTurns(path, 5)).toEqual({ turns: [], earlier: true, source: 'transcript' });
  });

  it('reads the tail only: a window smaller than the file drops the turns before it and says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-recent-'));
    const path = join(dir, 't.jsonl');
    const turns = Array.from({ length: 40 }, (_, i) => [{ type: 'user' as const, content: `prompt ${i} ${'p'.repeat(200)}` }, { type: 'assistant' as const, content: [{ type: 'text', text: `answer ${i}` }] }]).flat();
    writeFileSync(path, `${chain(turns)}\n`);
    const whole = await readRecentTurns(path, 20);
    expect(whole.turns.at(-1)?.answer?.text).toBe('answer 39');
    expect(whole.earlier).toBe(true); // forty turns, twenty asked
    const window = await readRecentTurns(path, 20, undefined, 2_000);
    expect(window.turns.length).toBeLessThan(20);
    expect(window.turns.at(-1)?.answer?.text).toBe('answer 39');
    expect(window.earlier).toBe(true);
  });
});
